import { and, asc, eq, isNull } from 'drizzle-orm';
import type { Database } from '$server/db';
import { groupMembership, person, smallGroup } from '$server/db/schema';
import { uuidv7 } from '$server/db/id';
import { audit } from '$server/audit/log';
import { authorize, type Actor } from '$server/policy/policy';
import { auditarMovimento, moverNaTransacao, OrigemMudou, type Movimento } from './composicao';
import { GrupoRecusado } from './regras';

/**
 * Reorganização em lote (RF-04.4, RN-09, D-M04-5).
 *
 * Planejar → conferir → aplicar. A proposta NÃO é gravada em lugar nenhum:
 * viaja no formulário, junto com a origem que cada pessoa tinha quando foi
 * planejada. Aplicar confere essa origem de novo, pessoa por pessoa, dentro
 * de uma transação só — se alguém mudou de grupo no meio do caminho, nada é
 * aplicado. É o "a proposta expira" do fluxo F4, decidido pelo estado e não
 * pelo relógio.
 *
 * Quando a IA chegar (V2.0), ela produz um plano neste mesmo formato. A tela
 * de conferência e a aplicação não mudam: sugerir → revisar → confirmar.
 */

export type LinhaDoPlanejamento = {
	personId: string;
	nome: string;
	grupoAtualId: string | null;
};

/** Pessoas ativas e o grupo de cada uma — o ponto de partida da tela. */
export async function situacaoAtual(db: Database, actor: Actor): Promise<LinhaDoPlanejamento[]> {
	authorize(actor, 'group.assign_member');

	const linhas = await db
		.select({
			personId: person.id,
			nome: person.fullName,
			grupoAtualId: groupMembership.groupId
		})
		.from(person)
		.leftJoin(
			groupMembership,
			and(eq(groupMembership.personId, person.id), isNull(groupMembership.leftAt))
		)
		.where(and(eq(person.teamId, actor.teamId), isNull(person.deletedAt)))
		.orderBy(asc(person.fullNameNormalized));

	return linhas.map((l) => ({ ...l, grupoAtualId: l.grupoAtualId ?? null }));
}

export type PedidoDoPlano = {
	personId: string;
	/** Grupo que a pessoa tinha quando o plano foi montado. */
	de: string | null;
	para: string | null;
};

export type MovimentoPlanejado = PedidoDoPlano & {
	nome: string;
	deNome: string | null;
	paraNome: string | null;
};

export type BalancoDoGrupo = {
	id: string | null;
	nome: string;
	antes: number;
	depois: number;
	entram: string[];
	saem: string[];
};

export type Previa = {
	movimentos: MovimentoPlanejado[];
	/** Antes e depois de cada grupo afetado, mais "sem grupo". */
	balanco: BalancoDoGrupo[];
};

/**
 * Monta a prévia. NÃO grava nada (RN-09).
 *
 * Linhas sem mudança são descartadas aqui: a conferência mostra só o que vai
 * acontecer, e o botão de aplicar conta exatamente essas linhas.
 */
export async function planejar(
	db: Database,
	actor: Actor,
	pedidos: PedidoDoPlano[]
): Promise<Previa> {
	authorize(actor, 'group.assign_member');

	const mudancas = pedidos.filter((p) => p.de !== p.para);

	const grupos = await db
		.select({ id: smallGroup.id, nome: smallGroup.name, arquivadoEm: smallGroup.archivedAt })
		.from(smallGroup)
		.where(eq(smallGroup.teamId, actor.teamId));
	const grupoPorId = new Map(grupos.map((g) => [g.id, g]));

	for (const m of mudancas) {
		if (m.para) {
			const destino = grupoPorId.get(m.para);
			if (!destino)
				throw new GrupoRecusado('nao_encontrado', 'Um dos grupos de destino não existe.');
			if (destino.arquivadoEm) {
				throw new GrupoRecusado(
					'arquivado',
					`${destino.nome} está arquivado e não recebe pessoas.`
				);
			}
		}
	}

	const atual = await situacaoAtual(db, actor);
	const nomePorPessoa = new Map(atual.map((a) => [a.personId, a.nome]));

	const movimentos: MovimentoPlanejado[] = mudancas
		.filter((m) => nomePorPessoa.has(m.personId))
		.map((m) => ({
			...m,
			nome: nomePorPessoa.get(m.personId)!,
			deNome: m.de ? (grupoPorId.get(m.de)?.nome ?? null) : null,
			paraNome: m.para ? (grupoPorId.get(m.para)?.nome ?? null) : null
		}));

	// Balanço: parte da composição ATUAL e aplica os movimentos por cima.
	const contagem = new Map<string | null, number>();
	for (const a of atual) contagem.set(a.grupoAtualId, (contagem.get(a.grupoAtualId) ?? 0) + 1);

	const afetados = new Set<string | null>();
	for (const m of movimentos) {
		afetados.add(m.de);
		afetados.add(m.para);
	}

	const balanco: BalancoDoGrupo[] = [...afetados].map((id) => {
		const antes = contagem.get(id) ?? 0;
		const entram = movimentos.filter((m) => m.para === id).map((m) => m.nome);
		const saem = movimentos.filter((m) => m.de === id).map((m) => m.nome);
		return {
			id,
			nome: id ? (grupoPorId.get(id)?.nome ?? 'grupo removido') : 'Sem grupo',
			antes,
			depois: antes + entram.length - saem.length,
			entram,
			saem
		};
	});

	// "Sem grupo" por último; os grupos em ordem alfabética.
	balanco.sort((a, b) => {
		if (a.id === null) return 1;
		if (b.id === null) return -1;
		return a.nome.localeCompare(b.nome, 'pt-BR');
	});

	return { movimentos, balanco };
}

/** O lote foi recusado porque o estado mudou desde o planejamento. */
export class PlanoDesatualizado extends GrupoRecusado {
	readonly pessoas: string[];
	constructor(pessoas: string[]) {
		super(
			'desatualizado',
			`Desde que você planejou, ${pessoas.join(', ')} mudou de grupo. Nada foi aplicado — ` +
				'confira de novo a partir da situação atual.'
		);
		this.pessoas = pessoas;
	}
}

/**
 * Aplica os movimentos confirmados, todos ou nenhum.
 *
 * Aceite parcial é a pessoa desmarcar linhas ANTES de aplicar — o que chega
 * aqui é exatamente o que ela confirmou. Cada movimento confere a origem
 * planejada; qualquer divergência desfaz o lote inteiro e diz quem mudou.
 */
export async function aplicar(
	db: Database,
	actor: Actor,
	pedidos: PedidoDoPlano[],
	contexto: { ip?: string | null; userAgent?: string | null } = {}
): Promise<{ batchId: string; movimentos: Movimento[] }> {
	authorize(actor, 'group.assign_member');

	const mudancas = pedidos.filter((p) => p.de !== p.para);
	if (mudancas.length === 0) {
		throw new GrupoRecusado('sem_mudanca', 'Nenhuma mudança foi confirmada.');
	}

	const pessoasRepetidas = mudancas.length !== new Set(mudancas.map((m) => m.personId)).size;
	if (pessoasRepetidas) {
		throw new GrupoRecusado('sem_mudanca', 'A mesma pessoa aparece duas vezes no plano.');
	}

	const batchId = uuidv7();

	const movimentos = await db.transaction(async (tx) => {
		const feitos: Movimento[] = [];
		const mudaram: string[] = [];

		// Saídas antes das entradas não importam aqui — cada pessoa tem uma
		// linha só —, mas a ordem fixa por pessoa evita que duas aplicações
		// concorrentes travem uma à outra em ordem inversa.
		const ordenadas = [...mudancas].sort((a, b) => a.personId.localeCompare(b.personId));

		for (const m of ordenadas) {
			try {
				feitos.push(
					await moverNaTransacao(tx as unknown as Database, actor, {
						personId: m.personId,
						paraGrupoId: m.para,
						origemEsperada: m.de,
						motivo: 'Reorganização',
						batchId
					})
				);
			} catch (erro) {
				if (erro instanceof OrigemMudou) {
					mudaram.push(erro.nome);
					continue;
				}
				throw erro;
			}
		}

		// Conferidos TODOS antes de desistir: a mensagem lista cada pessoa que
		// mudou, e não só a primeira.
		if (mudaram.length > 0) throw new PlanoDesatualizado(mudaram);
		return feitos;
	});

	for (const m of movimentos) {
		await auditarMovimento(db, actor, m, { motivo: 'Reorganização', batchId, ...contexto });
	}
	await audit(db, {
		teamId: actor.teamId,
		actorPersonId: actor.personId,
		action: 'group.reorganizado',
		entity: 'group_membership',
		entityId: batchId,
		after: { movimentos: movimentos.length },
		ip: contexto.ip,
		userAgent: contexto.userAgent
	});

	return { batchId, movimentos };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Lê a tela de planejamento: para cada pessoa, `para-<id>` (destino escolhido)
 * e `de-<id>` (onde ela estava quando a tela foi aberta). Vazio = sem grupo.
 * Qualquer valor que não seja um id válido é ignorado — o formulário é do
 * navegador, e o navegador é de quem o controla.
 */
export function lerPlano(form: FormData): PedidoDoPlano[] {
	const pedidos: PedidoDoPlano[] = [];
	for (const [chave, valor] of form.entries()) {
		if (!chave.startsWith('para-')) continue;
		const personId = chave.slice('para-'.length);
		const de = String(form.get(`de-${personId}`) ?? '');
		const para = String(valor);
		if (!UUID.test(personId)) continue;
		if (de && !UUID.test(de)) continue;
		if (para && !UUID.test(para)) continue;
		pedidos.push({ personId, de: de || null, para: para || null });
	}
	return pedidos;
}

/** Lê os movimentos confirmados: `mov` = "personId|de|para", vazio = sem grupo. */
export function lerMovimentos(valores: FormDataEntryValue[]): PedidoDoPlano[] {
	const uuid = UUID;
	const pedidos: PedidoDoPlano[] = [];

	for (const valor of valores) {
		const [personId, de, para] = String(valor).split('|');
		if (!personId || !uuid.test(personId)) continue;
		if (de && !uuid.test(de)) continue;
		if (para && !uuid.test(para)) continue;
		pedidos.push({ personId, de: de || null, para: para || null });
	}
	return pedidos;
}

export function codificarMovimento(m: PedidoDoPlano): string {
	return `${m.personId}|${m.de ?? ''}|${m.para ?? ''}`;
}

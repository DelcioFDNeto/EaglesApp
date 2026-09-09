import { and, asc, eq, inArray, isNull, sql, type SQL } from 'drizzle-orm';
import type { Database } from '$server/db';
import {
	membershipStatus,
	person,
	personRelation,
	personStatusHistory,
	personView
} from '$server/db/schema';
import { audit } from '$server/audit/log';
import { authorize, authorizeAnywhere, canAnywhere, type Actor } from '$server/policy/policy';
import { normalizarTexto, type OrigemDoCadastro } from '$shared/pessoa';
import { consentimentosDe } from './consentimento';
import { regimeDe, type Regime } from './regime';
import { estagioPadrao } from './status';
import type { AtualizarPessoaEntrada, CriarPessoaEntrada } from './validacao';

/**
 * Serviço de pessoas.
 *
 * Três responsabilidades que não podem morar na rota:
 *   1. autorizar (o servidor decide, a tela só esconde o que já foi negado)
 *   2. aplicar o regime de dados (ADR 0003) ANTES de qualquer escrita
 *   3. auditar
 *
 * Toda leitura devolve o que o ator pode ver, não o que existe. Filtrar na
 * tela deixaria o dado sensível trafegar até o navegador de quem não pode vê-lo
 * — e ele estaria no HTML, a um "ver código-fonte" de distância.
 */

export type PessoaResumo = {
	id: string;
	fullName: string;
	statusId: string | null;
	statusNome: string | null;
	statusCor: string | null;
	/** Nulo quando o ator não tem `person.view_sensitive`. */
	phone: string | null;
	ehMenor: boolean | null;
};

export type PessoaDetalhe = {
	id: string;
	fullName: string;
	birthDate: string | null;
	ehMenor: boolean | null;
	idadeAnos: number | null;
	joinedAt: string | null;
	source: OrigemDoCadastro;
	statusId: string | null;
	statusNome: string | null;
	statusCor: string | null;
	createdAt: Date;
	/** Campos sensíveis: presentes só para quem tem permissão. */
	sensiveis: {
		phone: string | null;
		whatsapp: string | null;
		email: string | null;
		relationshipStatus: string | null;
		notes: string | null;
	} | null;
	regime: Regime;
};

/**
 * Lê `is_minor` e a idade da view derivada.
 *
 * Pelo construtor de consultas, e não por `db.execute()` com SQL cru: o
 * formato do retorno de `execute` diverge entre o PGlite dos testes e o
 * postgres.js da produção, e essa divergência já custou um 500 que os testes
 * de integração não pegavam.
 */
async function sinaisDeIdade(
	db: Database,
	ids: string[]
): Promise<Map<string, { ehMenor: boolean | null; idadeAnos: number | null }>> {
	const mapa = new Map<string, { ehMenor: boolean | null; idadeAnos: number | null }>();
	if (ids.length === 0) return mapa;

	const linhas = await db
		.select({ id: personView.id, isMinor: personView.isMinor, ageYears: personView.ageYears })
		.from(personView)
		.where(inArray(personView.id, ids));

	for (const linha of linhas) {
		mapa.set(linha.id, {
			ehMenor: linha.isMinor === null ? null : Boolean(linha.isMinor),
			idadeAnos: linha.ageYears === null ? null : Number(linha.ageYears)
		});
	}
	return mapa;
}

/** Alguém está vinculado como responsável legal desta pessoa? */
async function temResponsavelVinculado(db: Database, personId: string): Promise<boolean> {
	const [linha] = await db
		.select({ id: personRelation.id })
		.from(personRelation)
		.where(
			and(
				eq(personRelation.personB, personId),
				eq(personRelation.relationType, 'responsavel_legal')
			)
		)
		.limit(1);
	return !!linha;
}

// ---------------------------------------------------------------------------
// Leitura
// ---------------------------------------------------------------------------

export async function listarPessoas(
	db: Database,
	actor: Actor,
	filtros: { busca?: string; statusId?: string | null } = {}
): Promise<PessoaResumo[]> {
	// A lista da equipe não pertence a nenhum grupo: quem tem `person.view` em
	// qualquer escopo pode ver quem faz parte dos Eagles. O que é sensível —
	// contato, nascimento, observações — continua atrás de outra permissão.
	authorizeAnywhere(actor, 'person.view');

	const podeVerContato = canAnywhere(actor, 'person.view_sensitive');

	const condicoes: (SQL | undefined)[] = [
		eq(person.teamId, actor.teamId),
		isNull(person.deletedAt)
	];

	if (filtros.busca?.trim()) {
		const alvo = `%${normalizarTexto(filtros.busca)}%`;
		condicoes.push(sql`${person.fullNameNormalized} like ${alvo}`);
	}

	if (filtros.statusId) {
		condicoes.push(eq(person.currentStatusId, filtros.statusId));
	}

	const linhas = await db
		.select({
			id: person.id,
			fullName: person.fullName,
			phone: person.phone,
			statusId: person.currentStatusId,
			statusNome: membershipStatus.name,
			statusCor: membershipStatus.color
		})
		.from(person)
		.leftJoin(membershipStatus, eq(person.currentStatusId, membershipStatus.id))
		.where(and(...condicoes))
		.orderBy(asc(person.fullNameNormalized))
		.limit(200);

	const idades = await sinaisDeIdade(
		db,
		linhas.map((l) => l.id)
	);

	return linhas.map((l) => {
		const idade = idades.get(l.id) ?? { ehMenor: null, idadeAnos: null };

		return {
			id: l.id,
			fullName: l.fullName,
			statusId: l.statusId,
			statusNome: l.statusNome,
			statusCor: l.statusCor,
			// RN-32 — contato só para quem tem `person.view_sensitive`. Vale para
			// qualquer pessoa, e com mais razão para menor de idade.
			phone: podeVerContato ? l.phone : null,
			ehMenor: idade.ehMenor
		};
	});
}

export async function verPessoa(
	db: Database,
	actor: Actor,
	personId: string
): Promise<PessoaDetalhe | null> {
	authorizeAnywhere(actor, 'person.view');

	const [linha] = await db
		.select({
			p: person,
			statusNome: membershipStatus.name,
			statusCor: membershipStatus.color
		})
		.from(person)
		.leftJoin(membershipStatus, eq(person.currentStatusId, membershipStatus.id))
		.where(and(eq(person.id, personId), eq(person.teamId, actor.teamId), isNull(person.deletedAt)))
		.limit(1);

	if (!linha) return null;

	const idade = (await sinaisDeIdade(db, [personId])).get(personId) ?? {
		ehMenor: null,
		idadeAnos: null
	};
	const consentimentos = await consentimentosDe(db, personId);
	const regime = regimeDe(idade, consentimentos, {
		temResponsavelVinculado: await temResponsavelVinculado(db, personId)
	});

	// Ver os próprios dados nunca exige `view_sensitive` — é o escopo `self`.
	const ehEla = actor.personId === personId;
	const contatoVisivel = ehEla || canAnywhere(actor, 'person.view_sensitive');

	return {
		id: linha.p.id,
		fullName: linha.p.fullName,
		birthDate: linha.p.birthDate,
		ehMenor: idade.ehMenor,
		idadeAnos: idade.idadeAnos,
		joinedAt: linha.p.joinedAt,
		source: linha.p.source as OrigemDoCadastro,
		statusId: linha.p.currentStatusId,
		statusNome: linha.statusNome,
		statusCor: linha.statusCor,
		createdAt: linha.p.createdAt,
		sensiveis: contatoVisivel
			? {
					phone: linha.p.phone,
					whatsapp: linha.p.whatsapp,
					email: linha.p.email,
					relationshipStatus: linha.p.relationshipStatus,
					notes: linha.p.notes
				}
			: null,
		regime
	};
}

// ---------------------------------------------------------------------------
// Escrita
// ---------------------------------------------------------------------------

export class RegimeRestrito extends Error {
	readonly campos: string[];
	constructor(campos: string[], motivo: string) {
		super(motivo);
		this.name = 'RegimeRestrito';
		this.campos = campos;
	}
}

/**
 * Aplica o regime aos dados que chegaram (RN-30).
 *
 * Recusa em vez de silenciosamente descartar: quem preencheu o telefone de um
 * adolescente precisa saber que ele não foi guardado, e por quê. Descarte
 * silencioso faria o conselheiro achar que registrou.
 */
function exigirRegimeCompativel(
	regime: Regime,
	dados: Partial<Record<string, string | null>>
): void {
	if (!regime.restrito) return;

	const proibidos = ['phone', 'whatsapp', 'email', 'relationshipStatus', 'notes'].filter(
		(campo) => dados[campo] != null && dados[campo] !== ''
	);

	if (proibidos.length > 0) {
		throw new RegimeRestrito(proibidos, regime.motivo ?? 'Cadastro em regime restrito.');
	}
}

export async function criarPessoa(
	db: Database,
	actor: Actor,
	dados: CriarPessoaEntrada,
	contexto: { ip?: string | null; userAgent?: string | null; source?: OrigemDoCadastro } = {}
): Promise<string> {
	// Quem ainda não existe não pertence a grupo nenhum, então não há escopo a
	// verificar além de deter a permissão.
	authorizeAnywhere(actor, 'person.create');

	// Regime avaliado ANTES de gravar: pessoa nova nunca tem responsável
	// vinculado nem consentimento registrado, então menor de idade entra
	// obrigatoriamente em cadastro mínimo.
	const ehMenor = calcularEhMenor(dados.birthDate);
	const regime = regimeDe({ ehMenor }, {}, { temResponsavelVinculado: false });
	exigirRegimeCompativel(regime, dados as Record<string, string | null>);

	const padrao = dados.statusId ? null : await estagioPadrao(db, actor.teamId);
	const statusId = dados.statusId ?? padrao?.id ?? null;

	const criada = await db.transaction(async (tx) => {
		const [nova] = await tx
			.insert(person)
			.values({
				teamId: actor.teamId,
				fullName: dados.fullName,
				birthDate: dados.birthDate,
				phone: dados.phone,
				whatsapp: dados.whatsapp,
				email: dados.email,
				relationshipStatus: dados.relationshipStatus,
				joinedAt: dados.joinedAt,
				notes: dados.notes,
				currentStatusId: statusId,
				source: contexto.source ?? 'cadastro'
			})
			.returning({ id: person.id });

		if (!nova) throw new Error('não foi possível criar a pessoa');

		// A primeira atribuição de estágio também é histórico (RN-04): sem ela,
		// a linha do tempo começaria no ar.
		if (statusId) {
			await tx.insert(personStatusHistory).values({
				personId: nova.id,
				fromStatusId: null,
				toStatusId: statusId,
				changedByPersonId: actor.personId,
				reason: 'Cadastro inicial'
			});
		}

		return nova.id;
	});

	await audit(db, {
		teamId: actor.teamId,
		actorPersonId: actor.personId,
		action: 'person.criada',
		entity: 'person',
		entityId: criada,
		after: { fullName: dados.fullName, source: contexto.source ?? 'cadastro' },
		ip: contexto.ip,
		userAgent: contexto.userAgent
	});

	return criada;
}

export async function atualizarPessoa(
	db: Database,
	actor: Actor,
	personId: string,
	dados: AtualizarPessoaEntrada,
	contexto: { ip?: string | null; userAgent?: string | null } = {}
): Promise<void> {
	authorize(actor, 'person.update', { personId });

	const [antes] = await db
		.select()
		.from(person)
		.where(and(eq(person.id, personId), eq(person.teamId, actor.teamId), isNull(person.deletedAt)))
		.limit(1);

	if (!antes) throw new Error('Pessoa não encontrada.');

	// A data de nascimento pode estar mudando nesta mesma edição — o regime é
	// avaliado sobre o valor NOVO, não sobre o que estava gravado.
	const nascimento = dados.birthDate !== undefined ? dados.birthDate : antes.birthDate;
	const idade = { ehMenor: calcularEhMenor(nascimento) };
	const regime = regimeDe(idade, await consentimentosDe(db, personId), {
		temResponsavelVinculado: await temResponsavelVinculado(db, personId)
	});
	exigirRegimeCompativel(regime, dados as Record<string, string | null>);

	const mudancas: Record<string, unknown> = {};
	for (const campo of [
		'fullName',
		'birthDate',
		'phone',
		'whatsapp',
		'email',
		'relationshipStatus',
		'joinedAt',
		'notes'
	] as const) {
		if (dados[campo] !== undefined) mudancas[campo] = dados[campo];
	}

	if (Object.keys(mudancas).length === 0) return;

	await db
		.update(person)
		.set({ ...mudancas, updatedAt: new Date() })
		.where(eq(person.id, personId));

	await audit(db, {
		teamId: actor.teamId,
		actorPersonId: actor.personId,
		action: 'person.atualizada',
		entity: 'person',
		entityId: personId,
		before: recorte(antes, Object.keys(mudancas)),
		after: mudancas,
		ip: contexto.ip,
		userAgent: contexto.userAgent
	});
}

/**
 * Remoção lógica.
 *
 * Nunca DELETE: presença, histórico de estágio e, no futuro, movimentação
 * financeira apontam para a pessoa. Apagar de verdade deixaria buracos em
 * registros que precisam continuar íntegros.
 */
export async function removerPessoa(
	db: Database,
	actor: Actor,
	personId: string,
	contexto: { ip?: string | null; userAgent?: string | null } = {}
): Promise<void> {
	authorize(actor, 'person.delete', { personId });

	if (personId === actor.personId) {
		throw new Error('Você não pode remover o próprio cadastro.');
	}

	await db
		.update(person)
		.set({ deletedAt: new Date(), updatedAt: new Date() })
		.where(and(eq(person.id, personId), eq(person.teamId, actor.teamId)));

	await audit(db, {
		teamId: actor.teamId,
		actorPersonId: actor.personId,
		action: 'person.removida',
		entity: 'person',
		entityId: personId,
		ip: contexto.ip,
		userAgent: contexto.userAgent
	});
}

/**
 * Autocadastro de visitante (RF-02.3).
 *
 * A ÚNICA escrita do sistema sem um ator autenticado. Por isso vive numa
 * função separada, com nome explícito: quem ler `criarPessoa` não deve
 * descobrir por acaso que existe um caminho sem autorização.
 *
 * As proteções que substituem a autenticação:
 *   - a chave `autocadastro_visitante`, desligada por padrão (RN-29)
 *   - limite por IP, aplicado na rota
 *   - regime restrito sempre que a idade indicar menor (ADR 0003)
 *   - `source = 'autocadastro'`, para a liderança saber a procedência do dado
 *
 * O que esta função NÃO faz: criar conta de acesso, atribuir papel ou vincular
 * a grupo. Quem se cadastra aqui vira uma linha em `person` e nada mais — o
 * acesso continua nascendo de um convite emitido por alguém (ADR 0004).
 */
export async function autocadastrarVisitante(
	db: Database,
	teamId: string,
	dados: {
		fullName: string;
		birthDate: string | null;
		phone: string | null;
		nomeDoResponsavel: string | null;
		telefoneDoResponsavel: string | null;
	},
	contexto: { ip?: string | null; userAgent?: string | null } = {}
): Promise<{ id: string; ehMenor: boolean | null }> {
	const ehMenor = calcularEhMenor(dados.birthDate);
	const regime = regimeDe({ ehMenor }, {}, { temResponsavelVinculado: false });

	// Menor de idade NÃO informa o próprio contato num formulário público
	// (ADR 0003). O que ele preenche sobre o responsável vai para observação,
	// como recado para o conselheiro coletar o consentimento presencialmente.
	const podeGuardarContato = regime.podeGuardarContato;

	const recado =
		ehMenor !== false && (dados.nomeDoResponsavel || dados.telefoneDoResponsavel)
			? `Responsável informado no autocadastro: ${dados.nomeDoResponsavel ?? 'sem nome'}` +
				(dados.telefoneDoResponsavel ? ` — ${dados.telefoneDoResponsavel}` : '') +
				'. Falta coletar o consentimento presencialmente.'
			: null;

	const padrao = await estagioPadrao(db, teamId);

	const criada = await db.transaction(async (tx) => {
		const [nova] = await tx
			.insert(person)
			.values({
				teamId,
				fullName: dados.fullName,
				birthDate: dados.birthDate,
				phone: podeGuardarContato ? dados.phone : null,
				whatsapp: podeGuardarContato ? dados.phone : null,
				// O recado sobre o responsável é o único texto que escapa do regime
				// restrito, e de propósito: sem ele o conselheiro não sabe a quem
				// procurar para regularizar o cadastro.
				notes: recado,
				currentStatusId: padrao?.id ?? null,
				source: 'autocadastro'
			})
			.returning({ id: person.id });

		if (!nova) throw new Error('não foi possível registrar o autocadastro');

		if (padrao?.id) {
			await tx.insert(personStatusHistory).values({
				personId: nova.id,
				fromStatusId: null,
				toStatusId: padrao.id,
				changedByPersonId: null,
				reason: 'Autocadastro'
			});
		}

		return nova.id;
	});

	await audit(db, {
		teamId,
		actorPersonId: null,
		action: 'person.autocadastro',
		entity: 'person',
		entityId: criada,
		after: { fullName: dados.fullName, ehMenor },
		ip: contexto.ip,
		userAgent: contexto.userAgent
	});

	return { id: criada, ehMenor };
}

// ---------------------------------------------------------------------------
// Auxiliares
// ---------------------------------------------------------------------------

/**
 * Menoridade a partir da data de nascimento, para decidir o regime ANTES de a
 * linha existir no banco (e portanto antes de a view poder responder).
 *
 * `null` — data desconhecida — continua significando "trate como menor".
 */
function calcularEhMenor(birthDate: string | null | undefined): boolean | null {
	if (!birthDate) return null;
	const nasc = new Date(`${birthDate}T00:00:00Z`);
	if (Number.isNaN(nasc.getTime())) return null;

	const hoje = new Date();
	let anos = hoje.getUTCFullYear() - nasc.getUTCFullYear();
	const mes = hoje.getUTCMonth() - nasc.getUTCMonth();
	if (mes < 0 || (mes === 0 && hoje.getUTCDate() < nasc.getUTCDate())) anos--;

	return anos < 18;
}

function recorte(objeto: Record<string, unknown>, campos: string[]): Record<string, unknown> {
	const saida: Record<string, unknown> = {};
	for (const campo of campos) saida[campo] = objeto[campo];
	return saida;
}

export { calcularEhMenor };

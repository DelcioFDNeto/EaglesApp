import { and, asc, desc, eq, isNotNull, isNull, ne } from 'drizzle-orm';
import type { Database } from '../db';
import { mandatoLider, person, personRole, role } from '../db/schema';
import type { Actor } from '../policy/policy';
import { PAPEL_LIDER } from '../policy/roles';
import { audit } from '../audit/log';
import { ehLider, ehMaster, naoEhMaster } from './regras';

/**
 * Mandatos dos líderes.
 *
 * Regras (decididas com a liderança):
 *   - No máximo 2 líderes com mandato aberto (o banco também garante).
 *   - Mandato de 2 anos. Renova a partir de 90 dias antes do fim, por mais 2.
 *   - Mandato vencido e não encerrado CONTINUA valendo, com aviso, até alguém
 *     renovar ou substituir.
 *   - Master: nomeia, renova e encerra qualquer mandato.
 *   - Líder: nomeia quando há vaga, renova o PRÓPRIO mandato, encerra o
 *     próprio (renúncia ou passagem de bastão) e só encerra o do outro líder
 *     depois que ele venceu.
 *   - Sem sucessor, o último líder não sai (a equipe ficaria sem líder);
 *     o Master pode.
 */

export const MAXIMO_LIDERES = 2;
export const DURACAO_ANOS = 2;
export const JANELA_RENOVACAO_DIAS = 90;
/** Até quantos dias à frente a data de início do mandato pode ser marcada. */
export const INICIO_FUTURO_MAX_DIAS = 90;
export const AVISO_DIAS = 60;

const FUSO = 'America/Sao_Paulo';

// --- Datas (calendário local, AAAA-MM-DD) ------------------------------------

export function hoje(agora = new Date()): string {
	return new Intl.DateTimeFormat('en-CA', { timeZone: FUSO }).format(agora);
}

/** Soma anos mantendo o dia; 29/02 vira 28/02 em ano não bissexto. */
export function somarAnos(data: string, anos: number): string {
	const [a, m, d] = data.split('-').map(Number) as [number, number, number];
	const ultimoDia = new Date(Date.UTC(a + anos, m, 0)).getUTCDate();
	const dia = Math.min(d, ultimoDia);
	return `${a + anos}-${String(m).padStart(2, '0')}-${String(dia).padStart(2, '0')}`;
}

export function somarDias(data: string, dias: number): string {
	return new Date(Date.parse(`${data}T00:00:00Z`) + dias * 86_400_000).toISOString().slice(0, 10);
}

export function diasAte(data: string, referencia: string): number {
	const ms = Date.parse(`${data}T00:00:00Z`) - Date.parse(`${referencia}T00:00:00Z`);
	return Math.round(ms / 86_400_000);
}

export type Situacao = 'em_dia' | 'renovacao_aberta' | 'vencido';

/** O mandato vale até a véspera de `fim`; em `fim` ele vence. */
export function situacao(fim: string, referencia = hoje()): Situacao {
	const dias = diasAte(fim, referencia);
	if (dias <= 0) return 'vencido';
	if (dias <= JANELA_RENOVACAO_DIAS) return 'renovacao_aberta';
	return 'em_dia';
}

// --- Consulta ----------------------------------------------------------------

export type MandatoVisto = {
	id: string;
	personId: string;
	nome: string;
	inicio: string;
	fim: string;
	situacao: Situacao;
	/** Negativo quando vencido. */
	diasParaFim: number;
	podeRenovar: boolean;
	podeEncerrar: boolean;
};

type MandatoAberto = { id: string; personId: string; inicio: string; fim: string };

async function mandatosAbertos(db: Database, teamId: string) {
	return db
		.select({
			id: mandatoLider.id,
			personId: mandatoLider.personId,
			nome: person.fullName,
			inicio: mandatoLider.inicio,
			fim: mandatoLider.fim
		})
		.from(mandatoLider)
		.innerJoin(person, eq(person.id, mandatoLider.personId))
		.where(and(eq(mandatoLider.teamId, teamId), isNull(mandatoLider.encerradoEm)))
		.orderBy(asc(mandatoLider.inicio), asc(person.fullName));
}

function podeRenovar(actor: Actor, m: MandatoAberto, ref: string): boolean {
	if (situacao(m.fim, ref) === 'em_dia') return false;
	return ehMaster(actor) || m.personId === actor.personId;
}

function podeEncerrar(actor: Actor, m: MandatoAberto, ref: string): boolean {
	if (ehMaster(actor) || m.personId === actor.personId) return true;
	return ehLider(actor) && situacao(m.fim, ref) === 'vencido';
}

export async function verLideranca(db: Database, actor: Actor, referencia = hoje()) {
	const abertos = await mandatosAbertos(db, actor.teamId);

	const historico = await db
		.select({
			id: mandatoLider.id,
			nome: person.fullName,
			inicio: mandatoLider.inicio,
			fim: mandatoLider.fim,
			encerradoEm: mandatoLider.encerradoEm,
			motivo: mandatoLider.motivoEncerramento
		})
		.from(mandatoLider)
		.innerJoin(person, eq(person.id, mandatoLider.personId))
		.where(and(eq(mandatoLider.teamId, actor.teamId), isNotNull(mandatoLider.encerradoEm)))
		.orderBy(desc(mandatoLider.encerradoEm))
		.limit(10);

	const mandatos: MandatoVisto[] = abertos.map((m) => ({
		...m,
		situacao: situacao(m.fim, referencia),
		diasParaFim: diasAte(m.fim, referencia),
		podeRenovar: podeRenovar(actor, m, referencia),
		podeEncerrar: podeEncerrar(actor, m, referencia)
	}));

	return {
		mandatos,
		vagas: Math.max(0, MAXIMO_LIDERES - mandatos.length),
		podeNomear: (ehMaster(actor) || ehLider(actor)) && mandatos.length < MAXIMO_LIDERES,
		ehMaster: ehMaster(actor),
		historico,
		// Limites da data de início (ver `periodoDoMandato`), para o campo da tela.
		datas: {
			hoje: referencia,
			inicioMin: somarDias(somarAnos(referencia, -DURACAO_ANOS), 1),
			inicioMax: somarDias(referencia, INICIO_FUTURO_MAX_DIAS)
		}
	};
}

/**
 * Aviso para o Início: mandato vencido, ou vencendo nos próximos 60 dias.
 * Só para quem pode agir (Master e líderes).
 */
export async function avisoDeLideranca(
	db: Database,
	actor: Actor,
	referencia = hoje()
): Promise<string | null> {
	if (!ehMaster(actor) && !ehLider(actor)) return null;
	const abertos = await mandatosAbertos(db, actor.teamId);

	const vencidos = abertos.filter((m) => situacao(m.fim, referencia) === 'vencido');
	if (vencidos.length > 0) {
		const nomes = vencidos.map((m) => m.nome.split(' ')[0]).join(' e ');
		return `O mandato de ${nomes} venceu. Renove ou indique quem assume.`;
	}
	const proximos = abertos.filter((m) => diasAte(m.fim, referencia) <= AVISO_DIAS);
	if (proximos.length > 0) {
		const m = proximos[0]!;
		return `O mandato de ${m.nome.split(' ')[0]} termina em ${diasAte(m.fim, referencia)} dias.`;
	}
	if (abertos.length < MAXIMO_LIDERES) {
		return abertos.length === 0
			? 'A equipe está sem líderes. Nomeie em Liderança.'
			: 'Há uma vaga de líder aberta.';
	}
	return null;
}

// --- Ações -------------------------------------------------------------------

export type Falha = { ok: false; status: number; codigo: string; erro: string };
const falha = (status: number, codigo: string, erro: string): Falha => ({
	ok: false,
	status,
	codigo,
	erro
});

type Tx = Parameters<Parameters<Database['transaction']>[0]>[0];

/** A pessoa pode assumir a liderança? (mesma equipe, ativa, não Master, sem mandato aberto) */
async function validarCandidato(db: Database | Tx, teamId: string, personId: string) {
	const [alvo] = await db
		.select({ id: person.id, nome: person.fullName })
		.from(person)
		.where(
			and(
				eq(person.id, personId),
				eq(person.teamId, teamId),
				isNull(person.deletedAt),
				naoEhMaster(person.id)
			)
		)
		.limit(1);
	if (!alvo) return falha(404, 'pessoa_nao_encontrada', 'Pessoa não encontrada.');

	const [jaLider] = await db
		.select({ id: mandatoLider.id })
		.from(mandatoLider)
		.where(
			and(
				eq(mandatoLider.teamId, teamId),
				eq(mandatoLider.personId, personId),
				isNull(mandatoLider.encerradoEm)
			)
		)
		.limit(1);
	if (jaLider) return falha(409, 'ja_e_lider', `${alvo.nome} já é líder.`);

	return { ok: true as const, nome: alvo.nome };
}

async function idPapel(db: Database | Tx, teamId: string, chave: string) {
	const [r] = await db
		.select({ id: role.id })
		.from(role)
		.where(and(eq(role.teamId, teamId), eq(role.key, chave)))
		.limit(1);
	if (!r) throw new Error(`papel ${chave} não existe na equipe`);
	return r.id;
}

async function abrirMandato(
	tx: Tx,
	actor: Actor,
	personId: string,
	periodo: { inicio: string; fim: string }
) {
	const [criado] = await tx
		.insert(mandatoLider)
		.values({
			teamId: actor.teamId,
			personId,
			inicio: periodo.inicio,
			fim: periodo.fim,
			nomeadoPorPersonId: actor.personId
		})
		.returning({ id: mandatoLider.id });

	await tx
		.insert(personRole)
		.values({
			personId,
			roleId: await idPapel(tx, actor.teamId, PAPEL_LIDER),
			scopeType: 'global',
			scopeId: null,
			grantedByPersonId: actor.personId
		})
		.onConflictDoNothing();

	return criado!.id;
}

/** Tira o papel de líder; quem fica sem papel nenhum volta a ser membro. */
async function retirarPapelDeLider(tx: Tx, teamId: string, personId: string) {
	const papelLider = await idPapel(tx, teamId, PAPEL_LIDER);
	await tx
		.delete(personRole)
		.where(
			and(
				eq(personRole.personId, personId),
				eq(personRole.roleId, papelLider),
				eq(personRole.scopeType, 'global')
			)
		);

	const [outro] = await tx
		.select({ id: personRole.id })
		.from(personRole)
		.where(eq(personRole.personId, personId))
		.limit(1);
	if (!outro) {
		await tx.insert(personRole).values({
			personId,
			roleId: await idPapel(tx, teamId, 'membro'),
			scopeType: 'self',
			scopeId: null
		});
	}
}

/** O gatilho do banco recusou por excesso de líderes (corrida entre dois pedidos). */
function ehLimiteDoBanco(erro: unknown): boolean {
	const texto = String((erro as { message?: string })?.message ?? erro);
	return texto.includes('2 líderes com mandato aberto');
}

/**
 * Período do mandato a partir da data de início escolhida (ou hoje).
 *
 * A data define o CICLO de 2 anos; o acesso de líder começa na nomeação.
 *   - No passado: registra um mandato que já corre (ex.: começou em janeiro),
 *     desde que não nasça vencido.
 *   - No futuro: até 90 dias, para quem já foi escolhido para o próximo ciclo.
 */
export function periodoDoMandato(
	inicioEscolhido: string | null | undefined,
	referencia = hoje()
): { ok: true; inicio: string; fim: string } | Falha {
	const inicio = inicioEscolhido ?? referencia;

	const [a, m, d] = inicio.split('-').map(Number) as [number, number, number];
	const data = new Date(Date.UTC(a, m - 1, d));
	const valida =
		/^\d{4}-\d{2}-\d{2}$/.test(inicio) &&
		data.getUTCFullYear() === a &&
		data.getUTCMonth() === m - 1 &&
		data.getUTCDate() === d;
	if (!valida) return falha(400, 'inicio_invalido', 'Data de início inválida.');

	const fim = somarAnos(inicio, DURACAO_ANOS);
	if (fim <= referencia) {
		return falha(
			400,
			'inicio_invalido',
			'Com essa data de início o mandato já estaria vencido. Escolha uma data mais recente.'
		);
	}
	if (diasAte(inicio, referencia) > INICIO_FUTURO_MAX_DIAS) {
		return falha(
			400,
			'inicio_invalido',
			`A data de início pode ser no máximo ${INICIO_FUTURO_MAX_DIAS} dias à frente.`
		);
	}
	return { ok: true, inicio, fim };
}

export async function nomearLider(
	db: Database,
	actor: Actor,
	personId: string,
	opcoes: { inicio?: string | null } = {},
	referencia = hoje()
): Promise<{ ok: true; mandatoId: string; inicio: string; fim: string } | Falha> {
	if (!ehMaster(actor) && !ehLider(actor)) {
		return falha(403, 'sem_permissao', 'Só o Master e os líderes nomeiam líderes.');
	}

	const periodo = periodoDoMandato(opcoes.inicio, referencia);
	if (!periodo.ok) return periodo;

	const abertos = await mandatosAbertos(db, actor.teamId);
	if (abertos.length >= MAXIMO_LIDERES) {
		return falha(
			409,
			'sem_vaga',
			'A equipe já tem 2 líderes. Para trocar, encerre um mandato indicando o sucessor.'
		);
	}

	const candidato = await validarCandidato(db, actor.teamId, personId);
	if (!candidato.ok) return candidato;

	try {
		const { inicio, fim } = periodo;
		const mandatoId = await db.transaction((tx) =>
			abrirMandato(tx, actor, personId, { inicio, fim })
		);
		await audit(db, {
			teamId: actor.teamId,
			actorPersonId: actor.personId,
			action: 'lideranca.nomeado',
			entity: 'mandato_lider',
			entityId: mandatoId,
			after: { personId, inicio, fim }
		});
		return { ok: true, mandatoId, inicio, fim };
	} catch (erro) {
		if (ehLimiteDoBanco(erro)) {
			return falha(409, 'sem_vaga', 'A equipe já tem 2 líderes.');
		}
		throw erro;
	}
}

async function carregarAberto(db: Database, teamId: string, mandatoId: string) {
	const [m] = await db
		.select({
			id: mandatoLider.id,
			personId: mandatoLider.personId,
			inicio: mandatoLider.inicio,
			fim: mandatoLider.fim
		})
		.from(mandatoLider)
		.where(
			and(
				eq(mandatoLider.id, mandatoId),
				eq(mandatoLider.teamId, teamId),
				isNull(mandatoLider.encerradoEm)
			)
		)
		.limit(1);
	return m ?? null;
}

export async function renovarMandato(
	db: Database,
	actor: Actor,
	mandatoId: string,
	referencia = hoje()
): Promise<{ ok: true; mandatoId: string; fim: string } | Falha> {
	const m = await carregarAberto(db, actor.teamId, mandatoId);
	if (!m) return falha(404, 'mandato_nao_encontrado', 'Mandato não encontrado.');

	if (!ehMaster(actor) && m.personId !== actor.personId) {
		return falha(403, 'sem_permissao', 'Cada líder renova o próprio mandato.');
	}
	if (situacao(m.fim, referencia) === 'em_dia') {
		return falha(
			409,
			'fora_da_janela',
			`A renovação abre ${JANELA_RENOVACAO_DIAS} dias antes do fim do mandato.`
		);
	}

	// O novo período emenda no anterior (o ciclo de 2 anos se mantém). Se o
	// vencido ficou esquecido tanto tempo que o novo já nasceria vencido,
	// recomeça hoje.
	const inicio = somarAnos(m.fim, DURACAO_ANOS) > referencia ? m.fim : referencia;
	const fim = somarAnos(inicio, DURACAO_ANOS);

	const novoId = await db.transaction(async (tx) => {
		await tx
			.update(mandatoLider)
			.set({
				encerradoEm: new Date(),
				encerradoPorPersonId: actor.personId,
				motivoEncerramento: 'renovado'
			})
			.where(eq(mandatoLider.id, m.id));
		return abrirMandato(tx, actor, m.personId, { inicio, fim });
	});

	await audit(db, {
		teamId: actor.teamId,
		actorPersonId: actor.personId,
		action: 'lideranca.renovado',
		entity: 'mandato_lider',
		entityId: novoId,
		before: { mandatoId: m.id, fim: m.fim },
		after: { inicio, fim }
	});

	return { ok: true, mandatoId: novoId, fim };
}

export async function encerrarMandato(
	db: Database,
	actor: Actor,
	mandatoId: string,
	opcoes: { sucessorId?: string | null; inicio?: string | null } = {},
	referencia = hoje()
): Promise<{ ok: true; sucessorMandatoId: string | null } | Falha> {
	const m = await carregarAberto(db, actor.teamId, mandatoId);
	if (!m) return falha(404, 'mandato_nao_encontrado', 'Mandato não encontrado.');

	if (!podeEncerrar(actor, m, referencia)) {
		return falha(
			403,
			'sem_permissao',
			'Só é possível encerrar o mandato do outro líder depois que ele venceu.'
		);
	}

	const sucessorId = opcoes.sucessorId ?? null;
	// Só faz sentido com sucessor: é o início do mandato de quem assume.
	const periodo = periodoDoMandato(sucessorId ? opcoes.inicio : null, referencia);
	if (!periodo.ok) return periodo;

	if (sucessorId) {
		if (sucessorId === m.personId) {
			return falha(400, 'sucessor_invalido', 'O sucessor precisa ser outra pessoa.');
		}
		const candidato = await validarCandidato(db, actor.teamId, sucessorId);
		if (!candidato.ok) return candidato;
	} else if (!ehMaster(actor)) {
		const outros = await db
			.select({ id: mandatoLider.id })
			.from(mandatoLider)
			.where(
				and(
					eq(mandatoLider.teamId, actor.teamId),
					isNull(mandatoLider.encerradoEm),
					ne(mandatoLider.id, m.id)
				)
			);
		if (outros.length === 0) {
			return falha(
				409,
				'sem_sucessor',
				'Indique quem assume: sem isso a equipe ficaria sem líder.'
			);
		}
	}

	const motivo = sucessorId
		? 'substituido'
		: m.personId === actor.personId
			? 'renuncia'
			: 'encerrado';

	try {
		const sucessorMandatoId = await db.transaction(async (tx) => {
			await tx
				.update(mandatoLider)
				.set({
					encerradoEm: new Date(),
					encerradoPorPersonId: actor.personId,
					motivoEncerramento: motivo
				})
				.where(eq(mandatoLider.id, m.id));
			await retirarPapelDeLider(tx, actor.teamId, m.personId);

			if (!sucessorId) return null;
			return abrirMandato(tx, actor, sucessorId, { inicio: periodo.inicio, fim: periodo.fim });
		});

		await audit(db, {
			teamId: actor.teamId,
			actorPersonId: actor.personId,
			action: 'lideranca.encerrado',
			entity: 'mandato_lider',
			entityId: m.id,
			before: { personId: m.personId, fim: m.fim },
			after: sucessorId
				? { motivo, sucessorId, inicio: periodo.inicio, fim: periodo.fim }
				: { motivo }
		});

		return { ok: true, sucessorMandatoId };
	} catch (erro) {
		if (ehLimiteDoBanco(erro)) return falha(409, 'sem_vaga', 'A equipe já tem 2 líderes.');
		throw erro;
	}
}

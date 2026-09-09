import { and, desc, eq, inArray } from 'drizzle-orm';
import type { Database } from '$server/db';
import { consent, person } from '$server/db/schema';
import type { TipoDeConsentimento } from '$shared/pessoa';
import { audit } from '$server/audit/log';
import type { EstadoDeConsentimento } from './regime';

/**
 * Consentimento (ADR 0003).
 *
 * A tabela é um LOG DE EVENTOS, não um registro editável: conceder grava uma
 * linha, revogar grava outra. O estado atual é a linha mais recente de cada
 * (pessoa, tipo). O banco recusa UPDATE e DELETE por gatilho — o histórico de
 * consentimento é prova de obrigação legal, e prova reescrita não é prova.
 */

/** Estado atual de todos os tipos de consentimento de uma pessoa. */
export async function consentimentosDe(
	db: Database,
	personId: string
): Promise<EstadoDeConsentimento> {
	const linhas = await db
		.select({ kind: consent.kind, granted: consent.granted, at: consent.at })
		.from(consent)
		.where(eq(consent.personId, personId))
		.orderBy(desc(consent.at));

	const estado: EstadoDeConsentimento = {};
	// Vem ordenado do mais recente para o mais antigo: a primeira ocorrência de
	// cada tipo é a que vale, e as seguintes são histórico.
	for (const linha of linhas) {
		const tipo = linha.kind as TipoDeConsentimento;
		if (estado[tipo] === undefined) estado[tipo] = linha.granted;
	}
	return estado;
}

/** Estado atual para várias pessoas de uma vez — evita N+1 nas listagens. */
export async function consentimentosDeVarias(
	db: Database,
	personIds: string[]
): Promise<Map<string, EstadoDeConsentimento>> {
	const mapa = new Map<string, EstadoDeConsentimento>();
	if (personIds.length === 0) return mapa;

	const linhas = await db
		.select({
			personId: consent.personId,
			kind: consent.kind,
			granted: consent.granted,
			at: consent.at
		})
		.from(consent)
		.where(inArray(consent.personId, personIds))
		.orderBy(desc(consent.at));

	for (const linha of linhas) {
		let estado = mapa.get(linha.personId);
		if (!estado) {
			estado = {};
			mapa.set(linha.personId, estado);
		}
		const tipo = linha.kind as TipoDeConsentimento;
		if (estado[tipo] === undefined) estado[tipo] = linha.granted;
	}
	return mapa;
}

export type RegistroDeConsentimento = {
	personId: string;
	kind: TipoDeConsentimento;
	granted: boolean;
	/** O responsável legal, quando a pessoa é menor de idade. */
	grantedByPersonId?: string | null;
	/** Quem digitou — normalmente o conselheiro. */
	recordedByPersonId?: string | null;
	/** "Termo em papel assinado em 12/03, foto arquivada na pasta X." */
	evidence?: string | null;
	teamId?: string | null;
};

/**
 * Registra concessão ou revogação.
 *
 * RN-34 — revogar `dados_cadastrais` de quem está sob regime restrito não
 * apenas oculta: **apaga** o contato na mesma transação. "Você pode parar de
 * guardar meu telefone" precisa significar que o telefone deixou de existir,
 * não que ficou escondido atrás de uma permissão.
 */
export async function registrarConsentimento(
	db: Database,
	registro: RegistroDeConsentimento
): Promise<void> {
	await db.insert(consent).values({
		personId: registro.personId,
		kind: registro.kind,
		granted: registro.granted,
		grantedByPersonId: registro.grantedByPersonId ?? null,
		recordedByPersonId: registro.recordedByPersonId ?? null,
		evidence: registro.evidence ?? null
	});

	if (!registro.granted && registro.kind === 'dados_cadastrais') {
		await apagarDadosDeContato(db, registro.personId);
	}

	await audit(db, {
		teamId: registro.teamId ?? null,
		actorPersonId: registro.recordedByPersonId ?? null,
		action: registro.granted ? 'consent.concedido' : 'consent.revogado',
		entity: 'consent',
		entityId: registro.personId,
		after: { kind: registro.kind, granted: registro.granted }
	});
}

/**
 * Remove os dados que o consentimento revogado autorizava (RN-34).
 *
 * Exportada porque a revogação é o caminho normal, mas a liderança pode
 * precisar apagar a pedido do titular sem que haja linha de consentimento —
 * por exemplo, para um cadastro antigo feito antes desta estrutura existir.
 */
export async function apagarDadosDeContato(db: Database, personId: string): Promise<void> {
	await db
		.update(person)
		.set({
			phone: null,
			whatsapp: null,
			email: null,
			relationshipStatus: null,
			notes: null,
			updatedAt: new Date()
		})
		.where(eq(person.id, personId));
}

/** Histórico completo, do mais recente ao mais antigo. Para a tela de perfil. */
export async function historicoDeConsentimento(db: Database, personId: string) {
	return db
		.select()
		.from(consent)
		.where(eq(consent.personId, personId))
		.orderBy(desc(consent.at))
		.limit(50);
}

/** Alguém já consentiu este tipo e não revogou depois? */
export async function temConsentimento(
	db: Database,
	personId: string,
	kind: TipoDeConsentimento
): Promise<boolean> {
	const [linha] = await db
		.select({ granted: consent.granted })
		.from(consent)
		.where(and(eq(consent.personId, personId), eq(consent.kind, kind)))
		.orderBy(desc(consent.at))
		.limit(1);

	return linha?.granted === true;
}

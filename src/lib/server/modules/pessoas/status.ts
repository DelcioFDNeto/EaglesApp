import { and, asc, desc, eq } from 'drizzle-orm';
import type { Database } from '$server/db';
import { membershipStatus, person, personStatusHistory } from '$server/db/schema';
import { audit } from '$server/audit/log';

/**
 * Jornada da pessoa: visitante → participante recorrente → membro (RN-02).
 *
 * Os estágios são DADOS. Nenhuma função deste arquivo compara `key` com um
 * literal, e é isso que permite a liderança criar um estágio novo sem deploy.
 * Onde o comportamento muda conforme o estágio, ele lê uma propriedade da
 * linha — `isTerminal`, `isDefault`, `grantsRoleId`.
 *
 * RN-03 é uma consequência direta do desenho: não existe nenhuma transição
 * automática. Participar do Outside não promove ninguém porque **nada** promove
 * ninguém — toda mudança tem um autor humano e fica registrada com ele.
 */

export type Estagio = typeof membershipStatus.$inferSelect;

/** Estágios da equipe, na ordem da jornada. */
export async function listarEstagios(db: Database, teamId: string): Promise<Estagio[]> {
	return db
		.select()
		.from(membershipStatus)
		.where(eq(membershipStatus.teamId, teamId))
		.orderBy(asc(membershipStatus.position), asc(membershipStatus.name));
}

/** O estágio de quem acabou de chegar. Índice único garante que só há um. */
export async function estagioPadrao(db: Database, teamId: string): Promise<Estagio | null> {
	const [linha] = await db
		.select()
		.from(membershipStatus)
		.where(and(eq(membershipStatus.teamId, teamId), eq(membershipStatus.isDefault, true)))
		.limit(1);
	return linha ?? null;
}

export class EstagioInvalido extends Error {
	constructor(mensagem: string) {
		super(mensagem);
		this.name = 'EstagioInvalido';
	}
}

/**
 * Move a pessoa para outro estágio, registrando quem, quando e por quê (RN-04).
 *
 * A escrita em `person.current_status_id` e a linha do histórico acontecem
 * juntas. Separá-las abriria a janela em que a pessoa já está no estágio novo
 * mas o histórico não sabe — e o histórico é a única fonte para responder
 * "desde quando ela é membro?".
 */
export async function mudarEstagio(
	db: Database,
	entrada: {
		personId: string;
		paraEstagioId: string;
		porPersonId: string | null;
		motivo?: string | null;
		teamId: string;
		ip?: string | null;
		userAgent?: string | null;
	}
): Promise<void> {
	const [pessoa] = await db
		.select({ id: person.id, statusAtual: person.currentStatusId, teamId: person.teamId })
		.from(person)
		.where(eq(person.id, entrada.personId))
		.limit(1);

	if (!pessoa) throw new EstagioInvalido('Pessoa não encontrada.');

	const [destino] = await db
		.select()
		.from(membershipStatus)
		.where(
			and(
				eq(membershipStatus.id, entrada.paraEstagioId),
				eq(membershipStatus.teamId, pessoa.teamId)
			)
		)
		.limit(1);

	if (!destino) throw new EstagioInvalido('Esse estágio não existe nesta equipe.');

	// Mudar para o estágio em que já está não é erro, mas também não é evento:
	// gravaria uma linha de histórico que não conta nada.
	if (pessoa.statusAtual === destino.id) return;

	await db.transaction(async (tx) => {
		await tx.insert(personStatusHistory).values({
			personId: entrada.personId,
			fromStatusId: pessoa.statusAtual,
			toStatusId: destino.id,
			changedByPersonId: entrada.porPersonId,
			reason: entrada.motivo?.trim() || null
		});

		await tx
			.update(person)
			.set({ currentStatusId: destino.id, updatedAt: new Date() })
			.where(eq(person.id, entrada.personId));
	});

	await audit(db, {
		teamId: entrada.teamId,
		actorPersonId: entrada.porPersonId,
		action: 'person.status_alterado',
		entity: 'person',
		entityId: entrada.personId,
		before: { statusId: pessoa.statusAtual },
		after: { statusId: destino.id, motivo: entrada.motivo ?? null },
		ip: entrada.ip,
		userAgent: entrada.userAgent
	});
}

export type ItemDaLinhaDoTempo = {
	id: string;
	occurredAt: Date;
	de: string | null;
	para: string;
	motivo: string | null;
	porPersonId: string | null;
};

/**
 * Linha do tempo da pessoa (RF-02.5).
 *
 * Hoje só traz mudanças de estágio. Grupos entram no M04 e eventos no M05 —
 * a assinatura já devolve uma lista genérica para que os dois se juntem aqui
 * sem quebrar quem consome.
 */
export async function linhaDoTempo(db: Database, personId: string): Promise<ItemDaLinhaDoTempo[]> {
	// Duas consultas em vez de um self-join com alias: a tabela de estágios tem
	// meia dúzia de linhas, e o join duplo deixaria a consulta bem menos legível
	// para economizar um round-trip que não pesa nesta escala.
	const [linhas, estagios] = await Promise.all([
		db
			.select({
				id: personStatusHistory.id,
				occurredAt: personStatusHistory.occurredAt,
				fromStatusId: personStatusHistory.fromStatusId,
				toStatusId: personStatusHistory.toStatusId,
				motivo: personStatusHistory.reason,
				porPersonId: personStatusHistory.changedByPersonId
			})
			.from(personStatusHistory)
			.where(eq(personStatusHistory.personId, personId))
			.orderBy(desc(personStatusHistory.occurredAt)),

		db.select({ id: membershipStatus.id, name: membershipStatus.name }).from(membershipStatus)
	]);

	const nome = new Map(estagios.map((e) => [e.id, e.name]));

	return linhas.map((l) => ({
		id: l.id,
		occurredAt: l.occurredAt,
		de: l.fromStatusId ? (nome.get(l.fromStatusId) ?? null) : null,
		para: nome.get(l.toStatusId) ?? 'estágio removido',
		motivo: l.motivo,
		porPersonId: l.porPersonId
	}));
}

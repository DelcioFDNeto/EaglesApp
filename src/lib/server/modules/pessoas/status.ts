import { and, asc, desc, eq } from 'drizzle-orm';
import { ehId } from '$shared/formulario';
import type { Database } from '$server/db';
import {
	groupMembership,
	membershipStatus,
	person,
	personStatusHistory,
	smallGroup
} from '$server/db/schema';
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
	if (!ehId(entrada.personId)) throw new EstagioInvalido('Pessoa não encontrada.');
	if (!ehId(entrada.paraEstagioId)) throw new EstagioInvalido('Escolha um estágio da lista.');

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
	/** Estágio da jornada ou passagem por grupo. */
	tipo: 'estagio' | 'grupo';
	occurredAt: Date;
	de: string | null;
	/** Nulo só em grupo: a pessoa saiu e não entrou em outro. */
	para: string | null;
	motivo: string | null;
	porPersonId: string | null;
};

/**
 * Linha do tempo da pessoa (RF-02.5): estágios e grupos, do mais recente ao
 * mais antigo. Eventos entram no M05.
 *
 * Uma transferência são duas linhas no banco — o vínculo que fecha e o que
 * abre, no mesmo instante —, mas UM fato para quem lê: "PG Azul → PG Verde".
 */
export async function linhaDoTempo(db: Database, personId: string): Promise<ItemDaLinhaDoTempo[]> {
	// Duas consultas em vez de um self-join com alias: a tabela de estágios tem
	// meia dúzia de linhas, e o join duplo deixaria a consulta bem menos legível
	// para economizar um round-trip que não pesa nesta escala.
	const [linhas, estagios, passagens] = await Promise.all([
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

		db.select({ id: membershipStatus.id, name: membershipStatus.name }).from(membershipStatus),

		db
			.select({
				id: groupMembership.id,
				grupo: smallGroup.name,
				entrada: groupMembership.joinedAt,
				saida: groupMembership.leftAt,
				motivoDaSaida: groupMembership.leftReason,
				porQuemEntrou: groupMembership.addedByPersonId,
				porQuemSaiu: groupMembership.endedByPersonId
			})
			.from(groupMembership)
			.innerJoin(smallGroup, eq(smallGroup.id, groupMembership.groupId))
			.where(eq(groupMembership.personId, personId))
			.orderBy(asc(groupMembership.joinedAt))
	]);

	const nome = new Map(estagios.map((e) => [e.id, e.name]));

	// Cada item leva a ordem em que aconteceu, para desempatar instantes
	// iguais: uma transferência fecha e abre no MESMO instante, e um relógio de
	// resolução grossa pode dar o mesmo instante até a ações separadas.
	type ItemOrdenado = ItemDaLinhaDoTempo & { ordem: number };

	const itens: ItemOrdenado[] = [...linhas].reverse().map((l, ordem) => ({
		id: l.id,
		tipo: 'estagio' as const,
		occurredAt: l.occurredAt,
		de: l.fromStatusId ? (nome.get(l.fromStatusId) ?? null) : null,
		para: nome.get(l.toStatusId) ?? 'estágio removido',
		motivo: l.motivo,
		porPersonId: l.porPersonId,
		ordem
	}));

	const mesmoInstante = (a: Date | null, b: Date | null) =>
		a !== null && b !== null && a.getTime() === b.getTime();

	// Ordem cronológica das passagens. Com a mesma entrada, vem antes a que
	// fechou no instante em que a outra abriu — é a metade "de" de uma
	// transferência.
	const cronologicas = [...passagens].sort((a, b) => {
		const diferenca = a.entrada.getTime() - b.entrada.getTime();
		if (diferenca !== 0) return diferenca;
		if (mesmoInstante(a.saida, b.entrada)) return -1;
		if (mesmoInstante(b.saida, a.entrada)) return 1;
		return 0;
	});

	let ordem = 0;
	for (const p of cronologicas) {
		// Nunca a própria passagem: quem entrou e saiu no mesmo instante teria
		// a saída igual à entrada, e viraria "PG Azul → PG Azul".
		const anterior = cronologicas.find((o) => o.id !== p.id && mesmoInstante(o.saida, p.entrada));
		const seguinte = cronologicas.find((o) => o.id !== p.id && mesmoInstante(p.saida, o.entrada));

		itens.push({
			id: `${p.id}:entrada`,
			tipo: 'grupo',
			occurredAt: p.entrada,
			de: anterior?.grupo ?? null,
			para: p.grupo,
			motivo: anterior?.motivoDaSaida ?? null,
			porPersonId: p.porQuemEntrou,
			ordem: ordem++
		});

		// A saída que é metade de uma transferência já está no item acima.
		if (p.saida && !seguinte) {
			itens.push({
				id: `${p.id}:saida`,
				tipo: 'grupo',
				occurredAt: p.saida,
				de: p.grupo,
				para: null,
				motivo: p.motivoDaSaida,
				porPersonId: p.porQuemSaiu,
				ordem: ordem++
			});
		}
	}

	return itens
		.sort((a, b) => b.occurredAt.getTime() - a.occurredAt.getTime() || b.ordem - a.ordem)
		.map(({ ordem: _ordem, ...item }) => item);
}

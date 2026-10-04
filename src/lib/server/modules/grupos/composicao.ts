import { and, asc, eq, isNull, sql } from 'drizzle-orm';
import type { Database } from '$server/db';
import { groupMembership, person, smallGroup } from '$server/db/schema';
import { audit, type AuditAction } from '$server/audit/log';
import { authorize, can, type Actor } from '$server/policy/policy';
import { GrupoRecusado } from './regras';

/**
 * Composição dos grupos (RF-04.2): colocar, retirar e transferir.
 *
 * Tudo passa por `moverNaTransacao` — uma operação só, em vez de três
 * parecidas. Colocar é mover de "nenhum grupo" para um grupo; retirar é mover
 * para "nenhum grupo"; transferir é mover entre dois. As três regras que
 * importam valem igual para todas:
 *
 *   - permissão nas DUAS pontas (D-M04-3): `group.assign_member` no grupo de
 *     origem, se houver, e no de destino, se houver;
 *   - nada se sobrescreve (RN-07): o vínculo aberto é ENCERRADO e outro é
 *     aberto, no mesmo instante — o `now()` da transação;
 *   - um grupo por vez (RN-06): o índice único parcial do banco garante,
 *     inclusive contra duas requisições simultâneas.
 */

export type Movimento = {
	personId: string;
	nome: string;
	de: { id: string; nome: string } | null;
	para: { id: string; nome: string } | null;
};

export type PedidoDeMovimento = {
	personId: string;
	/** Destino; `null` = retirar de qualquer grupo. */
	paraGrupoId: string | null;
	/**
	 * Origem que quem pediu VIU. Quando informada, o movimento só acontece se a
	 * pessoa ainda estiver lá — é como a reorganização em lote detecta que o
	 * estado mudou entre planejar e aplicar (D-M04-5). `undefined` = não conferir.
	 */
	origemEsperada?: string | null;
	motivo?: string | null;
	batchId?: string | null;
};

/** A pessoa mudou de grupo entre o momento em que o pedido foi feito e agora. */
export class OrigemMudou extends GrupoRecusado {
	readonly personId: string;
	readonly nome: string;
	constructor(personId: string, nome: string) {
		super('desatualizado', `${nome} mudou de grupo desde que você planejou.`);
		this.personId = personId;
		this.nome = nome;
	}
}

/**
 * Executa um movimento dentro de uma transação já aberta.
 *
 * Exportada para a reorganização em lote e para o cadastro com grupo, que
 * precisam do movimento no MESMO commit que o resto da operação. Quem chama é
 * responsável pela transação; esta função não abre outra.
 */
export async function moverNaTransacao(
	tx: Database,
	actor: Actor,
	pedido: PedidoDeMovimento
): Promise<Movimento> {
	const [pessoa] = await tx
		.select({ id: person.id, nome: person.fullName })
		.from(person)
		.where(
			and(eq(person.id, pedido.personId), eq(person.teamId, actor.teamId), isNull(person.deletedAt))
		)
		.limit(1);
	if (!pessoa) throw new GrupoRecusado('nao_encontrado', 'Essa pessoa não existe.');

	// FOR UPDATE: duas transferências simultâneas da mesma pessoa esperam uma
	// pela outra aqui, e a segunda enxerga o resultado da primeira.
	const [aberto] = await tx
		.select({ id: groupMembership.id, groupId: groupMembership.groupId, nome: smallGroup.name })
		.from(groupMembership)
		.innerJoin(smallGroup, eq(smallGroup.id, groupMembership.groupId))
		.where(and(eq(groupMembership.personId, pessoa.id), isNull(groupMembership.leftAt)))
		.for('update', { of: groupMembership })
		.limit(1);

	const deId = aberto?.groupId ?? null;

	if (pedido.origemEsperada !== undefined && pedido.origemEsperada !== deId) {
		throw new OrigemMudou(pessoa.id, pessoa.nome);
	}

	if (deId === pedido.paraGrupoId) {
		throw new GrupoRecusado(
			'sem_mudanca',
			deId ? `${pessoa.nome} já está em ${aberto!.nome}.` : `${pessoa.nome} já está sem grupo.`
		);
	}

	// Permissão nas duas pontas. Um conselheiro não empurra ninguém para o
	// grupo de outro, nem tira alguém de um grupo que não é o seu.
	if (deId) authorize(actor, 'group.assign_member', { groupId: deId });

	let destino: { id: string; nome: string } | null = null;
	if (pedido.paraGrupoId) {
		authorize(actor, 'group.assign_member', { groupId: pedido.paraGrupoId });

		const [grupo] = await tx
			.select({ id: smallGroup.id, nome: smallGroup.name, arquivadoEm: smallGroup.archivedAt })
			.from(smallGroup)
			.where(and(eq(smallGroup.id, pedido.paraGrupoId), eq(smallGroup.teamId, actor.teamId)))
			.limit(1);
		if (!grupo) throw new GrupoRecusado('nao_encontrado', 'Esse grupo não existe.');
		if (grupo.arquivadoEm) {
			throw new GrupoRecusado('arquivado', `${grupo.nome} está arquivado e não recebe pessoas.`);
		}
		destino = { id: grupo.id, nome: grupo.nome };
	}

	if (aberto) {
		await tx
			.update(groupMembership)
			.set({
				leftAt: sql`now()`,
				leftReason:
					pedido.motivo ?? (destino ? `Transferido para ${destino.nome}` : 'Saiu do grupo'),
				endedByPersonId: actor.personId
			})
			.where(eq(groupMembership.id, aberto.id));
	}

	if (destino) {
		await tx.insert(groupMembership).values({
			groupId: destino.id,
			personId: pessoa.id,
			joinedAt: sql`now()`,
			addedByPersonId: actor.personId,
			batchId: pedido.batchId ?? null
		});
	}

	return {
		personId: pessoa.id,
		nome: pessoa.nome,
		de: aberto ? { id: aberto.groupId, nome: aberto.nome } : null,
		para: destino
	};
}

export function acaoDeAuditoria(m: Movimento): AuditAction {
	if (!m.de) return 'group.membro_adicionado';
	if (!m.para) return 'group.membro_retirado';
	return 'group.membro_transferido';
}

/** Registro de auditoria de um movimento — chamado depois do commit. */
export async function auditarMovimento(
	db: Database,
	actor: Actor,
	m: Movimento,
	extra: {
		motivo?: string | null;
		batchId?: string | null;
		ip?: string | null;
		userAgent?: string | null;
	}
): Promise<void> {
	await audit(db, {
		teamId: actor.teamId,
		actorPersonId: actor.personId,
		action: acaoDeAuditoria(m),
		entity: 'person',
		entityId: m.personId,
		before: { groupId: m.de?.id ?? null, grupo: m.de?.nome ?? null },
		after: {
			groupId: m.para?.id ?? null,
			grupo: m.para?.nome ?? null,
			motivo: extra.motivo ?? null,
			lote: extra.batchId ?? null
		},
		ip: extra.ip,
		userAgent: extra.userAgent
	});
}

/**
 * Coloca, retira ou transfere UMA pessoa.
 *
 * `paraGrupoId = null` retira a pessoa do grupo em que está.
 */
export async function mudarDeGrupo(
	db: Database,
	actor: Actor,
	pedido: { personId: string; paraGrupoId: string | null; motivo?: string | null },
	contexto: { ip?: string | null; userAgent?: string | null } = {}
): Promise<Movimento> {
	const movimento = await db.transaction((tx) =>
		moverNaTransacao(tx as unknown as Database, actor, {
			personId: pedido.personId,
			paraGrupoId: pedido.paraGrupoId,
			motivo: pedido.motivo ?? null
		})
	);

	await auditarMovimento(db, actor, movimento, { motivo: pedido.motivo, ...contexto });
	return movimento;
}

export type Candidato = {
	personId: string;
	nome: string;
	/** Grupo em que a pessoa está hoje, se estiver. */
	grupoAtual: string | null;
};

/**
 * Quem pode ser colocado neste grupo POR ESTE ATOR.
 *
 * Exclui quem já está nele e quem está num grupo de onde o ator não pode
 * tirar ninguém — a tela só oferece o que o servidor aceitaria. Para um
 * conselheiro, sobra quem está sem grupo; para a liderança, todo mundo.
 */
export async function candidatosParaGrupo(
	db: Database,
	actor: Actor,
	groupId: string
): Promise<Candidato[]> {
	authorize(actor, 'group.assign_member', { groupId });

	const linhas = await db
		.select({
			personId: person.id,
			nome: person.fullName,
			grupoId: groupMembership.groupId,
			grupoNome: smallGroup.name
		})
		.from(person)
		.leftJoin(
			groupMembership,
			and(eq(groupMembership.personId, person.id), isNull(groupMembership.leftAt))
		)
		.leftJoin(smallGroup, eq(smallGroup.id, groupMembership.groupId))
		.where(and(eq(person.teamId, actor.teamId), isNull(person.deletedAt)))
		.orderBy(asc(person.fullNameNormalized));

	return linhas
		.filter((l) => l.grupoId !== groupId)
		.filter((l) => !l.grupoId || can(actor, 'group.assign_member', { groupId: l.grupoId }))
		.map((l) => ({ personId: l.personId, nome: l.nome, grupoAtual: l.grupoNome }));
}

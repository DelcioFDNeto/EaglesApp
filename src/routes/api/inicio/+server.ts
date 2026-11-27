import { json } from '@sveltejs/kit';
import { and, asc, desc, eq, gte, isNull, ne } from 'drizzle-orm';
import { db } from '$server/db';
import {
	announcement,
	escala,
	event,
	eventType,
	group,
	groupMember,
	person,
	personProfile,
	responsabilidade
} from '$server/db/schema';
import { autenticarAtor } from '$lib/server/auth/middleware';
import { can, groupsWhere, type Actor } from '$server/policy/policy';
import type { Database } from '$server/db';
import { naoEhMaster } from '$server/lideranca/regras';
import { avisoDeLideranca } from '$server/lideranca/mandatos';

/**
 * Dados iniciais da tela /inicio para a pessoa autenticada.
 * Retorna nome, próximo encontro e próximas responsabilidades atribuídas.
 */
export const GET = async ({ request, locals }) => {
	const banco = db();
	const auth = await autenticarAtor(request, banco, locals?.actor);
	if (!auth) {
		return json({ erro: 'Não autenticado' }, { status: 401 });
	}

	const { actor } = auth;
	if (
		!can(actor, 'event.view', { personId: actor.personId }) &&
		!can(actor, 'person.view', { personId: actor.personId })
	) {
		return json({ erro: 'Sem permissão para acessar o início.' }, { status: 403 });
	}

	const [pessoa] = await banco
		.select({ id: person.id, fullName: person.fullName })
		.from(person)
		.where(eq(person.id, actor.personId))
		.limit(1);

	if (!pessoa) {
		return json({ erro: 'Pessoa não encontrada.' }, { status: 404 });
	}

	const agora = new Date();
	const [proximoEvento] = await banco
		.select({
			id: event.id,
			title: event.title,
			startsAt: event.startsAt,
			location: event.location,
			status: event.status,
			tipoNome: eventType.name
		})
		.from(event)
		.leftJoin(eventType, eq(eventType.id, event.eventTypeId))
		.where(
			and(eq(event.teamId, actor.teamId), ne(event.status, 'cancelled'), gte(event.startsAt, agora))
		)
		.orderBy(asc(event.startsAt))
		.limit(1);

	let proximasResponsabilidades: Array<{
		id: string;
		eventId: string;
		eventoTitulo: string;
		eventoInicio: Date;
		responsabilidadeNome: string;
		status: string;
	}> = [];

	if (can(actor, 'responsibility.view', { personId: actor.personId })) {
		try {
			proximasResponsabilidades = await banco
				.select({
					id: escala.id,
					eventId: escala.eventId,
					eventoTitulo: event.title,
					eventoInicio: event.startsAt,
					responsabilidadeNome: responsabilidade.nome,
					status: escala.status
				})
				.from(escala)
				.innerJoin(event, eq(event.id, escala.eventId))
				.innerJoin(responsabilidade, eq(responsabilidade.id, escala.responsabilidadeId))
				.where(
					and(
						eq(escala.personId, actor.personId),
						eq(event.teamId, actor.teamId),
						ne(escala.status, 'trocada'),
						gte(event.startsAt, agora)
					)
				)
				.orderBy(asc(event.startsAt))
				.limit(3);
		} catch {
			// Tabela M07 ainda não migrada em ambiente legado: degrada com segurança
			proximasResponsabilidades = [];
		}
	}

	let ultimoAviso: { id: string; title: string; body: string; publishedAt: Date | null } | null =
		null;
	try {
		const [vinculo] = await banco
			.select({ groupId: groupMember.groupId })
			.from(groupMember)
			.where(eq(groupMember.personId, actor.personId))
			.limit(1);
		const [perfil] = await banco
			.select({ status: personProfile.status })
			.from(personProfile)
			.where(eq(personProfile.personId, actor.personId))
			.limit(1);

		const publicados = await banco
			.select({
				id: announcement.id,
				title: announcement.title,
				body: announcement.body,
				audienceScope: announcement.audienceScope,
				groupId: announcement.groupId,
				targetStatus: announcement.targetStatus,
				publishedAt: announcement.publishedAt
			})
			.from(announcement)
			.where(and(eq(announcement.teamId, actor.teamId), eq(announcement.status, 'published')))
			.orderBy(desc(announcement.publishedAt))
			.limit(10);

		const meuGrupoId = vinculo?.groupId ?? null;
		const meuStatus = perfil?.status ?? 'visitante';
		const visivel = publicados.find(
			(a) =>
				a.audienceScope === 'all' ||
				(a.audienceScope === 'group' && meuGrupoId !== null && a.groupId === meuGrupoId) ||
				(a.audienceScope === 'status' && a.targetStatus === meuStatus)
		);
		if (visivel) {
			ultimoAviso = {
				id: visivel.id,
				title: visivel.title,
				body: visivel.body,
				publishedAt: visivel.publishedAt
			};
		}
	} catch {
		ultimoAviso = null;
	}

	const papeis = [...new Set(actor.assignments.map((a) => a.roleKey))];
	const permissoes = [...new Set(actor.assignments.flatMap((a) => [...a.permissions]))];

	return json({
		nome: pessoa.fullName,
		papeis,
		permissoes,
		proximoEvento: proximoEvento ?? null,
		proximasResponsabilidades,
		ultimoAviso,
		// Só para Master e líderes: mandato vencendo/vencido ou vaga aberta.
		avisoLideranca: await avisoDeLideranca(banco, actor),
		primeirosPassos: await primeirosPassos(banco, actor)
	});
};

/**
 * Para quem organiza, o que ainda falta para o app servir à comunidade:
 * um app recém-instalado não tem PG, pessoas nem encontros, e a tela inicial
 * vazia não diz por onde começar.
 *
 * Cada passo só vem para quem pode fazê-lo (`null` = não se aplica). Some da
 * tela quando tudo estiver feito. Só diz "feito ou não": nada de contagens.
 */
async function primeirosPassos(banco: Database, actor: Actor) {
	const podeOuEmAlgumPg = (p: Parameters<typeof can>[1]) =>
		can(actor, p) || groupsWhere(actor, p).length > 0;

	const existe = async (consulta: Promise<unknown[]>) => (await consulta).length > 0;

	const [pg, tipoEvento, pessoas, evento] = await Promise.all([
		can(actor, 'group.manage')
			? existe(
					banco
						.select({ id: group.id })
						.from(group)
						.where(and(eq(group.teamId, actor.teamId), isNull(group.archivedAt)))
						.limit(1)
				)
			: null,
		podeOuEmAlgumPg('event.manage')
			? existe(
					banco
						.select({ id: eventType.id })
						.from(eventType)
						.where(and(eq(eventType.teamId, actor.teamId), eq(eventType.active, true)))
						.limit(1)
				)
			: null,
		podeOuEmAlgumPg('person.create')
			? existe(
					banco
						.select({ id: person.id })
						.from(person)
						.where(
							and(
								eq(person.teamId, actor.teamId),
								ne(person.id, actor.personId),
								isNull(person.deletedAt),
								naoEhMaster(person.id)
							)
						)
						.limit(1)
				)
			: null,
		podeOuEmAlgumPg('event.manage')
			? existe(
					banco.select({ id: event.id }).from(event).where(eq(event.teamId, actor.teamId)).limit(1)
				)
			: null
	]);

	return { pg, tipoEvento, pessoas, evento };
}

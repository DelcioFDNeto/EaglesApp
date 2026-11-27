import { json } from '@sveltejs/kit';
import { and, asc, count, desc, eq, gt, gte, inArray, isNull, ne } from 'drizzle-orm';
import { db } from '$server/db';
import {
	aiSuggestion,
	announcement,
	escala,
	event,
	eventType,
	financeTransaction,
	group,
	groupMember,
	invite,
	notification,
	person,
	personProfile,
	personRole,
	responsabilidade,
	role
} from '$server/db/schema';
import { autenticarAtor, flagAtiva } from '$lib/server/auth/middleware';
import { can, groupsWhere, type Actor } from '$server/policy/policy';
import type { Database } from '$server/db';
import { naoEhMaster } from '$server/lideranca/regras';
import { avisoDeLideranca } from '$server/lideranca/mandatos';
import {
	STATUS_MEMBRO,
	carregarDados,
	frequenciaDaEquipe,
	frequenciaDaPessoa
} from '$server/presenca/frequencia';
import { calcularResumoFinanceiro } from '$server/financeiro/calculos';

const DIA_MS = 86_400_000;

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

	let notificacoesNaoLidas = 0;
	try {
		const [row] = await banco
			.select({ total: count() })
			.from(notification)
			.where(
				and(
					eq(notification.teamId, actor.teamId),
					eq(notification.personId, actor.personId),
					isNull(notification.readAt)
				)
			);
		notificacoesNaoLidas = Number(row?.total ?? 0);
	} catch {
		// Tabela ainda não migrada em ambiente legado: degrada com segurança
		notificacoesNaoLidas = 0;
	}

	const papeis = [...new Set(actor.assignments.map((a) => a.roleKey))];
	const permissoes = [...new Set(actor.assignments.flatMap((a) => [...a.permissions]))];

	const [avisoLideranca, passos, dashboard] = await Promise.all([
		avisoDeLideranca(banco, actor),
		primeirosPassos(banco, actor),
		montarDashboard(banco, actor, agora)
	]);

	return json({
		nome: pessoa.fullName,
		papeis,
		permissoes,
		notificacoesNaoLidas,
		proximoEvento: proximoEvento ?? null,
		proximasResponsabilidades,
		ultimoAviso,
		// Só para Master e líderes: mandato vencendo/vencido ou vaga aberta.
		avisoLideranca,
		primeirosPassos: passos,
		dashboard
	});
};

type DashboardPendencias = {
	convitesAbertos?: number;
	escalasPropostas?: number;
	despesasPendentes?: number;
	sugestoesIaPendentes?: number;
};

/**
 * Monta o resumo do dashboard por perfil (§22), filtrando cada indicador
 * individualmente via `can(...)` para nunca vazar métricas financeiras ou
 * pastorais a papéis sem permissão. O Master nunca entra nas contagens da equipe.
 */
async function montarDashboard(banco: Database, actor: Actor, agora: Date) {
	const perfil: 'lider' | 'conselheiro' | 'membro' | 'visitante' =
		can(actor, 'rbac.manage') || can(actor, 'finance.view_all')
			? 'lider'
			: can(actor, 'attendance.report') || can(actor, 'person.create')
				? 'conselheiro'
				: can(actor, 'group.view', { personId: actor.personId }) ||
					  can(actor, 'finance.view_own', { personId: actor.personId })
					? 'membro'
					: 'visitante';

	if (perfil === 'visitante') {
		return { perfil: 'visitante' as const };
	}

	if (perfil === 'membro') {
		const [meuSubgrupo, minhaFrequencia90d, minhasContribuicoes] = await Promise.all([
			can(actor, 'group.view', { personId: actor.personId })
				? (async () => {
						try {
							const [g] = await banco
								.select({ id: group.id, nome: group.name })
								.from(groupMember)
								.innerJoin(
									group,
									and(
										eq(group.id, groupMember.groupId),
										eq(group.teamId, actor.teamId),
										isNull(group.archivedAt)
									)
								)
								.where(eq(groupMember.personId, actor.personId))
								.limit(1);
							return g ?? null;
						} catch {
							return null;
						}
					})()
				: Promise.resolve(null),

			can(actor, 'attendance.view', { personId: actor.personId })
				? (async () => {
						try {
							const de90 = new Date(agora.getTime() - 90 * DIA_MS);
							const dados = await carregarDados(banco, actor.teamId, { de: de90, ate: agora });
							const res = frequenciaDaPessoa(actor.personId, dados);
							return {
								taxa: res.pg.taxa,
								presencas: res.pg.presencas,
								esperados: res.pg.esperados
							};
						} catch {
							return { taxa: null, presencas: 0, esperados: 0 };
						}
					})()
				: Promise.resolve(undefined),

			can(actor, 'finance.view_own', { personId: actor.personId })
				? (async () => {
						try {
							const entradas = await banco
								.select({ amountCents: financeTransaction.amountCents })
								.from(financeTransaction)
								.where(
									and(
										eq(financeTransaction.teamId, actor.teamId),
										eq(financeTransaction.personId, actor.personId),
										eq(financeTransaction.kind, 'entrada'),
										eq(financeTransaction.status, 'confirmada'),
										isNull(financeTransaction.reversesTransactionId)
									)
								);
							return {
								totalCents: entradas.reduce((soma, r) => soma + Math.trunc(r.amountCents), 0),
								quantidade: entradas.length
							};
						} catch {
							return { totalCents: 0, quantidade: 0 };
						}
					})()
				: Promise.resolve(undefined)
		]);

		return {
			perfil: 'membro' as const,
			meuSubgrupo,
			...(minhaFrequencia90d !== undefined ? { minhaFrequencia90d } : {}),
			...(minhasContribuicoes !== undefined ? { minhasContribuicoes } : {})
		};
	}

	// Líder e Conselheiro — cada bloco depende explicitamente da sua permissão.
	const de30 = new Date(agora.getTime() - 30 * DIA_MS);
	const podeFrequencia = can(actor, 'attendance.report');
	const podePessoas = can(actor, 'person.view');
	const podeSubgrupos = can(actor, 'group.view');
	const podeConvites = can(actor, 'person.invite');
	const podeEscalas = can(actor, 'responsibility.manage');
	const podeFinanceiroTotal = can(actor, 'finance.view_all');
	const podeDespesasPendentes = can(actor, 'finance.approve') || podeFinanceiroTotal;
	const podeIaAnalise = can(actor, 'ai.use_analytics');
	const podeIaFinanceiro = can(actor, 'ai.use_finance') && podeFinanceiroTotal;

	const [
		frequenciaPg30d,
		pessoasNovas30d,
		subgrupos,
		convitesAbertos,
		escalasPropostas,
		despesasPendentes,
		sugestoesIaPendentes,
		financeiro
	] = await Promise.all([
		podeFrequencia
			? (async () => {
					try {
						const [[tipoPg], dados] = await Promise.all([
							banco
								.select({ id: eventType.id })
								.from(eventType)
								.where(and(eq(eventType.teamId, actor.teamId), eq(eventType.slug, 'pg')))
								.limit(1),
							carregarDados(banco, actor.teamId, { de: de30, ate: agora })
						]);
						const res = frequenciaDaEquipe(dados, undefined, tipoPg ? { tipoId: tipoPg.id } : {});
						return {
							taxaPresenca: res.taxaPresenca,
							chamadas: res.chamadas,
							mediaPresentes: res.presencaMedia
						};
					} catch {
						return { taxaPresenca: null, chamadas: 0, mediaPresentes: null };
					}
				})()
			: Promise.resolve(undefined),

		podePessoas
			? (async () => {
					try {
						const [row] = await banco
							.select({ total: count() })
							.from(person)
							.innerJoin(personProfile, eq(personProfile.personId, person.id))
							.where(
								and(
									eq(person.teamId, actor.teamId),
									isNull(person.deletedAt),
									naoEhMaster(person.id),
									gte(person.createdAt, de30),
									inArray(personProfile.status, ['visitante', 'recorrente'])
								)
							);
						return Number(row?.total ?? 0);
					} catch {
						return 0;
					}
				})()
			: Promise.resolve(undefined),

		podeSubgrupos
			? (async () => {
					try {
						const [ativosRows, alocadosRows, pessoasEquipe, papeisMembro] = await Promise.all([
							banco
								.select({ total: count() })
								.from(group)
								.where(and(eq(group.teamId, actor.teamId), isNull(group.archivedAt))),
							banco
								.select({ personId: groupMember.personId })
								.from(groupMember)
								.innerJoin(
									group,
									and(
										eq(group.id, groupMember.groupId),
										eq(group.teamId, actor.teamId),
										isNull(group.archivedAt)
									)
								)
								.innerJoin(
									person,
									and(
										eq(person.id, groupMember.personId),
										eq(person.teamId, actor.teamId),
										isNull(person.deletedAt),
										naoEhMaster(person.id)
									)
								),
							banco
								.select({ id: person.id, status: personProfile.status })
								.from(person)
								.leftJoin(personProfile, eq(personProfile.personId, person.id))
								.where(
									and(
										eq(person.teamId, actor.teamId),
										isNull(person.deletedAt),
										naoEhMaster(person.id)
									)
								),
							banco
								.select({ personId: personRole.personId })
								.from(personRole)
								.innerJoin(role, eq(role.id, personRole.roleId))
								.where(
									and(
										eq(role.teamId, actor.teamId),
										inArray(role.key, ['membro', 'conselheiro', 'lider'])
									)
								)
						]);

						const alocados = new Set(alocadosRows.map((r) => r.personId));
						const comPapelMembro = new Set(papeisMembro.map((r) => r.personId));
						const membrosSemSubgrupo = pessoasEquipe.filter((p) => {
							const ehMembro = p.status ? STATUS_MEMBRO.has(p.status) : comPapelMembro.has(p.id);
							return ehMembro && !alocados.has(p.id);
						}).length;

						return {
							ativos: Number(ativosRows[0]?.total ?? 0),
							pessoasAlocadas: alocados.size,
							membrosSemSubgrupo
						};
					} catch {
						return { ativos: 0, pessoasAlocadas: 0, membrosSemSubgrupo: 0 };
					}
				})()
			: Promise.resolve(undefined),

		podeConvites
			? (async () => {
					try {
						const [row] = await banco
							.select({ total: count() })
							.from(invite)
							.innerJoin(person, eq(person.id, invite.personId))
							.where(
								and(
									eq(invite.teamId, actor.teamId),
									isNull(invite.usedAt),
									isNull(invite.revokedAt),
									gt(invite.expiresAt, agora),
									isNull(person.deletedAt),
									naoEhMaster(person.id)
								)
							);
						return Number(row?.total ?? 0);
					} catch {
						return 0;
					}
				})()
			: Promise.resolve(undefined),

		podeEscalas
			? (async () => {
					try {
						const [row] = await banco
							.select({ total: count() })
							.from(escala)
							.innerJoin(event, eq(event.id, escala.eventId))
							.innerJoin(
								person,
								and(
									eq(person.id, escala.personId),
									isNull(person.deletedAt),
									naoEhMaster(person.id)
								)
							)
							.where(
								and(
									eq(event.teamId, actor.teamId),
									ne(event.status, 'cancelled'),
									gte(event.startsAt, agora),
									eq(escala.status, 'proposta')
								)
							);
						return Number(row?.total ?? 0);
					} catch {
						return 0;
					}
				})()
			: Promise.resolve(undefined),

		podeDespesasPendentes
			? (async () => {
					try {
						const [row] = await banco
							.select({ total: count() })
							.from(financeTransaction)
							.where(
								and(
									eq(financeTransaction.teamId, actor.teamId),
									eq(financeTransaction.status, 'pendente_aprovacao')
								)
							);
						return Number(row?.total ?? 0);
					} catch {
						return 0;
					}
				})()
			: Promise.resolve(undefined),

		podeIaAnalise
			? (async () => {
					try {
						const ativa = await flagAtiva(banco, actor.teamId, 'ia_assistente');
						if (!ativa) return undefined;
						const [row] = await banco
							.select({ total: count() })
							.from(aiSuggestion)
							.where(
								and(
									eq(aiSuggestion.teamId, actor.teamId),
									eq(aiSuggestion.status, 'pendente'),
									podeIaFinanceiro ? undefined : ne(aiSuggestion.kind, 'resumo_financeiro')
								)
							);
						return Number(row?.total ?? 0);
					} catch {
						return undefined;
					}
				})()
			: Promise.resolve(undefined),

		podeFinanceiroTotal
			? (async () => {
					try {
						const movs = await banco
							.select({
								kind: financeTransaction.kind,
								amountCents: financeTransaction.amountCents,
								status: financeTransaction.status,
								reversesTransactionId: financeTransaction.reversesTransactionId
							})
							.from(financeTransaction)
							.where(eq(financeTransaction.teamId, actor.teamId));
						const resumo = calcularResumoFinanceiro(movs);
						return {
							arrecadadoCents: resumo.arrecadadoCents,
							despesasCents: resumo.despesasCents,
							saldoCents: resumo.saldoCents
						};
					} catch {
						return { arrecadadoCents: 0, despesasCents: 0, saldoCents: 0 };
					}
				})()
			: Promise.resolve(undefined)
	]);

	const pendencias: DashboardPendencias = {};
	if (convitesAbertos !== undefined) pendencias.convitesAbertos = convitesAbertos;
	if (escalasPropostas !== undefined) pendencias.escalasPropostas = escalasPropostas;
	if (despesasPendentes !== undefined) pendencias.despesasPendentes = despesasPendentes;
	if (sugestoesIaPendentes !== undefined) pendencias.sugestoesIaPendentes = sugestoesIaPendentes;

	return {
		perfil,
		...(frequenciaPg30d !== undefined ? { frequenciaPg30d } : {}),
		...(pessoasNovas30d !== undefined ? { pessoasNovas30d } : {}),
		...(subgrupos !== undefined ? { subgrupos } : {}),
		pendencias,
		...(financeiro !== undefined ? { financeiro } : {})
	};
}

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

	const [subgrupo, tipoEvento, pessoas, evento] = await Promise.all([
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

	return { subgrupo, pg: subgrupo, tipoEvento, pessoas, evento };
}

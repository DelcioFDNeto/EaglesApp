import { json } from '@sveltejs/kit';
import { and, desc, eq, inArray, isNull } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '$server/db';
import { draftSession, person } from '$server/db/schema';
import { autenticarAtor } from '$lib/server/auth/middleware';
import { can, groupsWhere } from '$server/policy/policy';
import { audit } from '$server/audit/log';
import { naoEhMaster } from '$server/lideranca/regras';
import { FOCOS_DRAFT } from '$shared/atributos';

const timeSalvoSchema = z.object({
	nome: z.string().trim().min(1, 'Informe o nome de cada time.').max(40),
	membros: z
		.array(
			z.object({
				personId: z.string().uuid(),
				nome: z.string().trim().min(1).max(120)
			})
		)
		.min(1, 'Cada time precisa ter pelo menos 1 pessoa.')
});

const salvarDraftSchema = z.object({
	titulo: z.string().trim().min(2, 'Informe um título para o draft.').max(120),
	observacao: z
		.string()
		.trim()
		.max(500)
		.nullable()
		.optional()
		.transform((v) => v || null),
	foco: z.enum(FOCOS_DRAFT).default('equilibrado'),
	times: z.array(timeSalvoSchema).min(2, 'O draft precisa ter pelo menos 2 times.').max(8)
});

/**
 * Sessões de Draft salvas da equipe.
 *
 * GET  — qualquer membro Eagles (`person.view`) consulta os drafts salvos.
 * POST — líderes, conselheiros e Master (`person.update` global) salvam.
 */
export const GET = async ({ request, locals }) => {
	const banco = db();
	const auth = await autenticarAtor(request, banco, locals?.actor);
	if (!auth) return json({ erro: 'Não autenticado' }, { status: 401 });

	const { actor } = auth;
	const podeVer =
		can(actor, 'person.view') ||
		can(actor, 'person.view', { personId: actor.personId }) ||
		groupsWhere(actor, 'person.view').length > 0;
	if (!podeVer) {
		return json({ erro: 'Sem permissão para ver drafts salvos.' }, { status: 403 });
	}

	const sessoes = await banco
		.select()
		.from(draftSession)
		.where(eq(draftSession.teamId, actor.teamId))
		.orderBy(desc(draftSession.createdAt))
		.limit(20);

	const autoresIds = [...new Set(sessoes.map((s) => s.createdByPersonId))];
	const autores = new Map(
		autoresIds.length === 0
			? []
			: (
					await banco
						.select({ id: person.id, nome: person.fullName })
						.from(person)
						.where(and(inArray(person.id, autoresIds), naoEhMaster(person.id)))
				).map((p) => [p.id, p.nome])
	);

	return json({
		podeGerenciar: can(actor, 'person.update'),
		sessoes: sessoes.map((s) => ({
			id: s.id,
			titulo: s.title,
			observacao: s.notes,
			foco: s.focus,
			times: s.teams,
			criadoPor: autores.get(s.createdByPersonId) ?? null,
			criadoEm: s.createdAt
		}))
	});
};

export const POST = async ({ request, locals, getClientAddress }) => {
	const banco = db();
	const auth = await autenticarAtor(request, banco, locals?.actor);
	if (!auth) return json({ erro: 'Não autenticado' }, { status: 401 });

	const { actor } = auth;
	if (!can(actor, 'person.update')) {
		return json(
			{ erro: 'Apenas líderes e conselheiros podem salvar sessões de draft.' },
			{ status: 403 }
		);
	}

	const corpo = await request.json().catch(() => null);
	const parsed = salvarDraftSchema.safeParse(corpo);
	if (!parsed.success) {
		const issue = parsed.error.issues[0];
		return json({ erro: issue?.message ?? 'Dados inválidos.' }, { status: 400 });
	}

	const { titulo, observacao, foco, times } = parsed.data;
	const todosIds = times.flatMap((t) => t.membros.map((m) => m.personId));
	const unicos = new Set(todosIds);
	if (unicos.size !== todosIds.length) {
		return json(
			{ erro: 'A mesma pessoa não pode estar em dois times ao mesmo tempo.' },
			{ status: 400 }
		);
	}

	// Confirma que todas as pessoas pertencem à equipe e usa os nomes oficiais do banco.
	const validas = await banco
		.select({ id: person.id, nome: person.fullName })
		.from(person)
		.where(
			and(
				eq(person.teamId, actor.teamId),
				isNull(person.deletedAt),
				naoEhMaster(person.id),
				inArray(person.id, [...unicos])
			)
		);

	if (validas.length !== unicos.size) {
		return json({ erro: 'Um ou mais participantes não pertencem à equipe.' }, { status: 400 });
	}
	const nomePorId = new Map(validas.map((p) => [p.id, p.nome]));
	const timesLimpos = times.map((t) => ({
		nome: t.nome,
		membros: t.membros.map((m) => ({
			personId: m.personId,
			nome: nomePorId.get(m.personId) ?? m.nome
		}))
	}));

	const [salva] = await banco
		.insert(draftSession)
		.values({
			teamId: actor.teamId,
			title: titulo,
			notes: observacao ?? null,
			focus: foco,
			teams: timesLimpos,
			createdByPersonId: actor.personId
		})
		.returning();

	await audit(banco, {
		teamId: actor.teamId,
		actorPersonId: actor.personId,
		action: 'draft.salvo',
		entity: 'draft_session',
		entityId: salva!.id,
		after: { titulo, foco, quantidadeTimes: timesLimpos.length, totalParticipantes: unicos.size },
		ip: getClientAddress(),
		userAgent: request.headers.get('user-agent')
	});

	return json(
		{
			ok: true,
			mensagem: 'Draft salvo.',
			sessao: {
				id: salva!.id,
				titulo: salva!.title,
				observacao: salva!.notes,
				foco: salva!.focus,
				times: salva!.teams,
				criadoEm: salva!.createdAt
			}
		},
		{ status: 201 }
	);
};

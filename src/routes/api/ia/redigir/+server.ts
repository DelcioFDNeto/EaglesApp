import { json } from '@sveltejs/kit';
import { z } from 'zod';
import { db } from '$server/db';
import { aiInteractionLog, aiSuggestion } from '$server/db/schema';
import { autenticarAtor, flagAtiva } from '$lib/server/auth/middleware';
import { can, groupsWhere } from '$server/policy/policy';
import { redigirAviso, resumirAtaComTarefas } from '$server/ia/motor';

const redigirSchema = z.discriminatedUnion('modo', [
	z.object({
		modo: z.literal('aviso'),
		tema: z.string().trim().min(2).max(160),
		detalhes: z.string().trim().min(5).max(3000),
		tom: z.enum(['acolhedor', 'objetivo', 'lembrete']).default('acolhedor'),
		publico: z.string().trim().max(80).optional()
	}),
	z.object({
		modo: z.literal('ata'),
		textoAta: z.string().trim().min(10).max(10000)
	})
]);

/**
 * RF-10.1 (redação de aviso) e RF-10.7 (resumo de ata + tarefas).
 * Exige `ia_assistente` ligada (RN-29) e permissão `ai.use_basic` (RN-26).
 */
export const POST = async ({ request, locals }) => {
	const banco = db();
	const auth = await autenticarAtor(request, banco, locals?.actor);
	if (!auth) {
		return json({ erro: 'Não autenticado' }, { status: 401 });
	}

	const { actor } = auth;
	if (!(await flagAtiva(banco, actor.teamId, 'ia_assistente'))) {
		return json(
			{ erro: 'O assistente de IA está desligado nas configurações da equipe.' },
			{ status: 403 }
		);
	}

	const podeUsar =
		can(actor, 'ai.use_basic', { personId: actor.personId }) ||
		groupsWhere(actor, 'ai.use_basic').length > 0;
	if (!podeUsar) {
		return json(
			{ erro: 'Você não tem permissão para usar recursos básicos de IA.' },
			{ status: 403 }
		);
	}

	let corpo: unknown;
	try {
		corpo = await request.json();
	} catch {
		return json({ erro: 'Corpo da requisição inválido.' }, { status: 400 });
	}

	const resultado = redigirSchema.safeParse(corpo);
	if (!resultado.success) {
		return json(
			{ erro: 'Dados inválidos.', detalhes: resultado.error.flatten().fieldErrors },
			{ status: 400 }
		);
	}

	const dados = resultado.data;
	const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

	if (dados.modo === 'aviso') {
		const saida = redigirAviso(dados);
		const [sugestao] = await banco
			.insert(aiSuggestion)
			.values({
				teamId: actor.teamId,
				kind: 'redacao_aviso',
				requestedByPersonId: actor.personId,
				inputSnapshot: { tema: dados.tema, tom: dados.tom, publico: dados.publico ?? null },
				output: saida,
				status: 'pendente',
				expiresAt
			})
			.returning();

		await banco.insert(aiInteractionLog).values({
			teamId: actor.teamId,
			actorPersonId: actor.personId,
			kind: 'redacao_aviso',
			permissionUsed: 'ai.use_basic',
			provider: 'deterministico',
			promptSummary: `Redação de aviso: ${dados.tema.slice(0, 100)}`,
			tokensEstimated: Math.ceil((dados.tema.length + dados.detalhes.length) / 4)
		});

		return json({ ok: true, sugestao, resultado: saida }, { status: 201 });
	}

	const saida = resumirAtaComTarefas(dados.textoAta);
	const [sugestao] = await banco
		.insert(aiSuggestion)
		.values({
			teamId: actor.teamId,
			kind: 'resumo_ata',
			requestedByPersonId: actor.personId,
			inputSnapshot: { tamanhoCaracteres: dados.textoAta.length },
			output: saida,
			status: 'pendente',
			expiresAt
		})
		.returning();

	await banco.insert(aiInteractionLog).values({
		teamId: actor.teamId,
		actorPersonId: actor.personId,
		kind: 'resumo_ata',
		permissionUsed: 'ai.use_basic',
		provider: 'deterministico',
		promptSummary: `Resumo de ata (${dados.textoAta.length} chars)`,
		tokensEstimated: Math.ceil(dados.textoAta.length / 4)
	});

	return json({ ok: true, sugestao, resultado: saida }, { status: 201 });
};

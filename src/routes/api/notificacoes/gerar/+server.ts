import { json } from '@sveltejs/kit';
import { z } from 'zod';
import { db } from '$server/db';
import { autenticarAtor, flagAtiva } from '$lib/server/auth/middleware';
import { can, groupsWhere } from '$server/policy/policy';
import { gerarLembretesAutomaticos } from '$server/notificacoes/motor';

const gerarSchema = z
	.object({
		ignorarSilencio: z.boolean().optional()
	})
	.optional();

/**
 * Dispara manualmente a geração idempotente de lembretes automáticos da equipe.
 * Restrito a líderes e conselheiros (`announcement.send` ou `event.manage`).
 */
export const POST = async ({ request, locals }) => {
	const banco = db();
	const auth = await autenticarAtor(request, banco, locals?.actor);
	if (!auth) {
		return json({ erro: 'Não autenticado' }, { status: 401 });
	}

	const { actor } = auth;
	const podeGerar =
		can(actor, 'announcement.send') ||
		can(actor, 'event.manage') ||
		groupsWhere(actor, 'announcement.send').length > 0 ||
		groupsWhere(actor, 'event.manage').length > 0;

	if (!podeGerar) {
		return json(
			{ erro: 'Apenas líderes e conselheiros podem disparar lembretes automáticos.' },
			{ status: 403 }
		);
	}

	const ativa = await flagAtiva(banco, actor.teamId, 'notificacoes_ativas');
	if (!ativa) {
		return json(
			{
				erro: 'As notificações automáticas estão desligadas. Ative em Administração para gerar lembretes.'
			},
			{ status: 400 }
		);
	}

	let opcoes: { ignorarSilencio?: boolean } | undefined;
	const texto = await request.text().catch(() => '');
	if (texto.trim().length > 0) {
		let corpo: unknown;
		try {
			corpo = JSON.parse(texto);
		} catch {
			return json({ erro: 'Corpo da requisição inválido.' }, { status: 400 });
		}
		const parsed = gerarSchema.safeParse(corpo);
		if (!parsed.success) {
			return json({ erro: 'Parâmetros inválidos.' }, { status: 400 });
		}
		opcoes = parsed.data;
	}

	const resultado = await gerarLembretesAutomaticos(banco, new Date(), {
		teamId: actor.teamId,
		ignorarSilencio: opcoes?.ignorarSilencio ?? false
	});

	const mensagem =
		resultado.total === 0
			? 'Nenhum lembrete pendente para enviar agora.'
			: resultado.total === 1
				? '1 lembrete gerado.'
				: `${resultado.total} lembretes gerados (${resultado.eventos} encontros, ${resultado.rsvp} RSVP, ${resultado.escalas} escalas).`;

	return json({
		ok: true,
		resultado,
		mensagem
	});
};

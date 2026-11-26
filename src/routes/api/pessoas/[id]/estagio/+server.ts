import { json } from '@sveltejs/kit';
import { z } from 'zod';
import { db } from '$server/db';
import { autenticarAtor, isUuid } from '$lib/server/auth/middleware';
import { can } from '$server/policy/policy';
import { audit } from '$server/audit/log';
import { alcancaAlvo, carregarAlvo } from '$server/pessoas/alvo';
import {
	ESTAGIOS,
	ROTULO_ESTAGIO,
	aplicarEstagio,
	podeMudarEstagio
} from '$server/pessoas/jornada';

const schema = z
	.object({
		estagio: z.enum(ESTAGIOS),
		motivo: z
			.string()
			.trim()
			.max(500)
			.nullable()
			.optional()
			.transform((v) => v || null)
	})
	.strict();

/**
 * Move a pessoa na jornada: visitante → recorrente → membro Eagles.
 *
 * Regras (decisão do usuário, 26/11/2026):
 *   - conselheiro, no PG da pessoa, move entre visitante e recorrente;
 *   - entrar em `membro` ou sair dele é dos líderes (`person.update` global);
 *   - o acesso acompanha: só `membro` tem o papel base de membro.
 *
 * Cada mudança grava o histórico (quem, quando, de onde, para onde, por quê)
 * e vai para a auditoria com a troca de papel, se houve.
 */
export const POST = async ({ request, params, locals, getClientAddress }) => {
	const banco = db();
	const auth = await autenticarAtor(request, banco, locals?.actor);
	if (!auth) return json({ erro: 'Não autenticado' }, { status: 401 });

	const { actor } = auth;
	if (!isUuid(params.id)) return json({ erro: 'Identificador inválido.' }, { status: 400 });

	const parsed = schema.safeParse(await request.json().catch(() => null));
	if (!parsed.success) {
		return json({ erro: 'Escolha um estágio válido.' }, { status: 400 });
	}
	const { estagio, motivo } = parsed.data;

	const alvo = await carregarAlvo(banco, actor.teamId, params.id);
	if (!alvo) return json({ erro: 'Pessoa não encontrada.' }, { status: 404 });

	const contexto = { groupId: alvo.groupId, personId: alvo.id };
	if (!can(actor, 'person.view', contexto)) {
		return json({ erro: 'Pessoa não encontrada.' }, { status: 404 });
	}

	const atual = alvo.perfil?.status ?? 'visitante';
	if (atual === estagio) {
		return json({ ok: true, alterado: false, mensagem: 'A pessoa já está neste estágio.' });
	}

	if (!alcancaAlvo(actor, alvo) || !podeMudarEstagio(actor, atual, estagio, alvo.groupId)) {
		return json(
			{
				erro:
					estagio === 'membro' || atual === 'membro'
						? 'Só os líderes marcam a entrada ou a saída de um membro Eagles.'
						: 'Você não pode mudar o estágio desta pessoa.'
			},
			{ status: 403 }
		);
	}

	const papeis = await banco.transaction((tx) =>
		aplicarEstagio(tx, {
			teamId: actor.teamId,
			personId: alvo.id,
			de: atual,
			para: estagio,
			motivo,
			porPersonId: actor.personId,
			groupId: alvo.groupId
		})
	);

	await audit(banco, {
		teamId: actor.teamId,
		actorPersonId: actor.personId,
		action: 'person.estagio_alterado',
		entity: 'person',
		entityId: alvo.id,
		before: { estagio: atual, papelBase: papeis.papelAntes },
		after: { estagio, papelBase: papeis.papelDepois, motivo },
		ip: getClientAddress(),
		userAgent: request.headers.get('user-agent')
	});

	return json({
		ok: true,
		alterado: true,
		mensagem: `Estágio de ${alvo.nome.split(' ')[0]}: ${ROTULO_ESTAGIO[estagio]}.`
	});
};

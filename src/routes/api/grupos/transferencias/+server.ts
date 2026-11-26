import { json } from '@sveltejs/kit';
import { z } from 'zod';
import { db } from '$server/db';
import { autenticarAtor } from '$lib/server/auth/middleware';
import { can } from '$server/policy/policy';
import { audit } from '$server/audit/log';
import { alcancaAlvo, carregarAlvo, type Alvo } from '$server/pessoas/alvo';
import { grupoAtivo, moverPessoa, podeTransferir } from '$server/grupos/transferencia';

const schema = z
	.object({
		pessoas: z
			.array(z.string().uuid())
			.min(1, 'Escolha ao menos uma pessoa.')
			.max(200)
			.refine((ids) => new Set(ids).size === ids.length, 'Há pessoas repetidas.'),
		/** null = tirar de todos os PGs (só líderes). */
		paraGrupoId: z.string().uuid().nullable(),
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
 * Move uma ou mais pessoas de PG, de uma vez: é assim que se reorganiza
 * (seção 5). Tudo ou nada: se alguém da lista não puder ser movido por quem
 * pede, nada muda, e a resposta diz quem barrou.
 *
 * Exige `group.assign_member`: global (líder), ou no PG de origem de cada
 * pessoa (conselheiro, só para outro PG). Regras em `$server/grupos/transferencia`.
 */
export const POST = async ({ request, locals, getClientAddress }) => {
	const banco = db();
	const auth = await autenticarAtor(request, banco, locals?.actor);
	if (!auth) return json({ erro: 'Não autenticado' }, { status: 401 });
	const { actor } = auth;

	const parsed = schema.safeParse(await request.json().catch(() => null));
	if (!parsed.success) {
		return json({ erro: parsed.error.issues[0]?.message ?? 'Dados inválidos.' }, { status: 400 });
	}
	const { pessoas, paraGrupoId, motivo } = parsed.data;

	let destinoNome: string | null = null;
	if (paraGrupoId) {
		const destino = await grupoAtivo(banco, actor.teamId, paraGrupoId);
		if (!destino) {
			return json({ erro: 'PG de destino não encontrado ou arquivado.' }, { status: 404 });
		}
		destinoNome = destino.name;
	}

	const alvos: Alvo[] = [];
	for (const id of pessoas) {
		const alvo = await carregarAlvo(banco, actor.teamId, id);
		// Quem não pode nem ver a pessoa também não fica sabendo que ela existe.
		if (!alvo || !can(actor, 'person.view', { groupId: alvo.groupId, personId: alvo.id })) {
			return json({ erro: 'Pessoa não encontrada.' }, { status: 404 });
		}
		alvos.push(alvo);
	}

	const barradas = alvos.filter(
		(a) =>
			a.groupId !== paraGrupoId &&
			(!podeTransferir(actor, a.groupId, paraGrupoId) || !alcancaAlvo(actor, a))
	);
	if (barradas.length > 0) {
		return json(
			{
				erro:
					paraGrupoId === null
						? 'Só os líderes tiram alguém de todos os PGs.'
						: `Você não pode mover: ${barradas.map((b) => b.nome).join(', ')}. ` +
							'Conselheiros movem só quem está no próprio PG.',
				barradas: barradas.map((b) => b.id)
			},
			{ status: 403 }
		);
	}

	const mover = alvos.filter((a) => a.groupId !== paraGrupoId);
	if (mover.length > 0) {
		await banco.transaction(async (tx) => {
			for (const a of mover) {
				await moverPessoa(tx, {
					teamId: actor.teamId,
					personId: a.id,
					de: a.groupId,
					para: paraGrupoId,
					motivo,
					origem: 'manual',
					porPersonId: actor.personId
				});
			}
		});

		for (const a of mover) {
			await audit(banco, {
				teamId: actor.teamId,
				actorPersonId: actor.personId,
				action: 'group.membro_transferido',
				entity: 'person',
				entityId: a.id,
				before: { groupId: a.groupId },
				after: { groupId: paraGrupoId, motivo },
				ip: getClientAddress(),
				userAgent: request.headers.get('user-agent')
			});
		}
	}

	const n = mover.length;
	return json({
		ok: true,
		movidas: n,
		inalteradas: alvos.length - n,
		mensagem:
			n === 0
				? 'Ninguém mudou: todos já estavam nesse PG.'
				: `${n} ${n === 1 ? 'pessoa movida' : 'pessoas movidas'} ${
						destinoNome ? `para ${destinoNome}` : 'para fora dos PGs'
					}.`
	});
};

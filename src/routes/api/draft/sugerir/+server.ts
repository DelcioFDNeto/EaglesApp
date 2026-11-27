import { json } from '@sveltejs/kit';
import { and, eq, inArray, isNull } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '$server/db';
import { person, personAttribute } from '$server/db/schema';
import { autenticarAtor } from '$lib/server/auth/middleware';
import { can, groupsWhere } from '$server/policy/policy';
import { naoEhMaster } from '$server/lideranca/regras';
import { balancearDraft } from '$server/draft/balancear';
import { FOCOS_DRAFT } from '$shared/atributos';

const sugerirSchema = z.object({
	participantesIds: z
		.array(z.string().uuid('Participante inválido.'))
		.min(2, 'Selecione pelo menos 2 participantes.')
		.max(80, 'Máximo de 80 participantes por draft.'),
	quantidadeTimes: z
		.number({ message: 'Informe a quantidade de times.' })
		.int()
		.min(2, 'Mínimo de 2 times.')
		.max(8, 'Máximo de 8 times.'),
	nomesTimes: z.array(z.string().trim().max(40)).max(8).optional(),
	foco: z.enum(FOCOS_DRAFT).default('equilibrado')
});

/**
 * Gera sugestão determinística de divisão de times equilibrados nos 4 atributos.
 * Qualquer membro Eagles (`person.view`) pode simular; nada é gravado aqui.
 */
export const POST = async ({ request, locals }) => {
	const banco = db();
	const auth = await autenticarAtor(request, banco, locals?.actor);
	if (!auth) return json({ erro: 'Não autenticado' }, { status: 401 });

	const { actor } = auth;
	const podeVer =
		can(actor, 'person.view') ||
		can(actor, 'person.view', { personId: actor.personId }) ||
		groupsWhere(actor, 'person.view').length > 0;
	if (!podeVer) {
		return json({ erro: 'Sem permissão para montar draft.' }, { status: 403 });
	}

	const corpo = await request.json().catch(() => null);
	const parsed = sugerirSchema.safeParse(corpo);
	if (!parsed.success) {
		const issue = parsed.error.issues[0];
		return json({ erro: issue?.message ?? 'Parâmetros inválidos.' }, { status: 400 });
	}

	const idsUnicos = [...new Set(parsed.data.participantesIds)];
	if (idsUnicos.length < parsed.data.quantidadeTimes) {
		return json(
			{
				erro: `Selecione pelo menos ${parsed.data.quantidadeTimes} pessoas para montar ${parsed.data.quantidadeTimes} times.`
			},
			{ status: 400 }
		);
	}

	const linhas = await banco
		.select({
			id: person.id,
			nome: person.fullName,
			physical: personAttribute.physical,
			biblical: personAttribute.biblical,
			mental: personAttribute.mental,
			motor: personAttribute.motor,
			heightCm: personAttribute.heightCm,
			strengths: personAttribute.strengths
		})
		.from(person)
		.leftJoin(personAttribute, eq(personAttribute.personId, person.id))
		.where(
			and(
				eq(person.teamId, actor.teamId),
				isNull(person.deletedAt),
				naoEhMaster(person.id),
				inArray(person.id, idsUnicos)
			)
		);

	if (linhas.length < parsed.data.quantidadeTimes) {
		return json(
			{ erro: 'Participantes válidos insuficientes para a quantidade de times.' },
			{ status: 400 }
		);
	}

	const resultado = balancearDraft({
		participantes: linhas.map((l) => ({
			personId: l.id,
			nome: l.nome,
			fisico: l.physical ?? null,
			biblico: l.biblical ?? null,
			mental: l.mental ?? null,
			coordenacaoMotora: l.motor ?? null,
			alturaCm: l.heightCm ?? null,
			pontosFortes: l.strengths ?? null
		})),
		quantidadeTimes: parsed.data.quantidadeTimes,
		nomesTimes: parsed.data.nomesTimes,
		foco: parsed.data.foco
	});

	return json({ ok: true, ...resultado });
};

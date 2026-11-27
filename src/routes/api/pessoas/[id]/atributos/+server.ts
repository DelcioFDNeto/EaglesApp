import { json } from '@sveltejs/kit';
import { and, eq } from 'drizzle-orm';
import { db } from '$server/db';
import { person, personAttribute } from '$server/db/schema';
import { autenticarAtor, isUuid } from '$lib/server/auth/middleware';
import { can, groupsWhere } from '$server/policy/policy';
import { audit } from '$server/audit/log';
import { alcancaAlvo, carregarAlvo } from '$server/pessoas/alvo';
import { naoEhMaster } from '$server/lideranca/regras';
import { MAIORIDADE, MENSAGEM_MENOR, idadeEm } from '$server/pessoas/menores';
import {
	atributosCompletosSchema,
	pesoParaDecimos,
	serializarAtributos
} from '$server/draft/atributos';

/**
 * Perfil de atributos (Draft) de uma pessoa.
 *
 * GET — qualquer membro Eagles (`person.view` em qualquer escopo) pode
 *       consultar os atributos de outros membros (sem dados sensíveis).
 * PUT — líderes, conselheiros (para não-líderes) e Master (`person.update`).
 */

export const GET = async ({ request, params, locals }) => {
	const banco = db();
	const auth = await autenticarAtor(request, banco, locals?.actor);
	if (!auth) return json({ erro: 'Não autenticado' }, { status: 401 });

	const { actor } = auth;
	const podeVer =
		can(actor, 'person.view') ||
		can(actor, 'person.view', { personId: actor.personId }) ||
		groupsWhere(actor, 'person.view').length > 0;
	if (!podeVer) {
		return json({ erro: 'Sem permissão para ver perfis de atributos.' }, { status: 403 });
	}
	if (!isUuid(params.id)) return json({ erro: 'Identificador inválido.' }, { status: 400 });

	const alvo = await carregarAlvo(banco, actor.teamId, params.id);
	if (!alvo) return json({ erro: 'Pessoa não encontrada.' }, { status: 404 });

	const [linha] = await banco
		.select()
		.from(personAttribute)
		.where(eq(personAttribute.personId, alvo.id))
		.limit(1);

	let avaliadoPorNome: string | null = null;
	if (linha?.evaluatedByPersonId) {
		const [autor] = await banco
			.select({ nome: person.fullName })
			.from(person)
			.where(and(eq(person.id, linha.evaluatedByPersonId), naoEhMaster(person.id)))
			.limit(1);
		avaliadoPorNome = autor?.nome ?? null;
	}

	const contexto = { groupId: alvo.groupId, personId: alvo.id };
	return json({
		pessoa: {
			id: alvo.id,
			nome: alvo.nome,
			grupo: alvo.groupId ? { id: alvo.groupId, nome: alvo.grupoNome } : null
		},
		atributos: serializarAtributos(linha, avaliadoPorNome),
		podeEditar: can(actor, 'person.update', contexto) && alcancaAlvo(actor, alvo)
	});
};

export const PUT = async ({ request, params, locals, getClientAddress }) => {
	const banco = db();
	const auth = await autenticarAtor(request, banco, locals?.actor);
	if (!auth) return json({ erro: 'Não autenticado' }, { status: 401 });

	const { actor } = auth;
	if (!isUuid(params.id)) return json({ erro: 'Identificador inválido.' }, { status: 400 });

	const corpo = await request.json().catch(() => null);
	const parsed = atributosCompletosSchema.safeParse(corpo);
	if (!parsed.success) {
		const issue = parsed.error.issues[0];
		return json(
			{ erro: issue?.message ?? 'Dados de atributos inválidos.', campo: issue?.path[0] ?? null },
			{ status: 400 }
		);
	}
	const dados = parsed.data;

	const alvo = await carregarAlvo(banco, actor.teamId, params.id);
	if (!alvo) return json({ erro: 'Pessoa não encontrada.' }, { status: 404 });

	const contexto = { groupId: alvo.groupId, personId: alvo.id };
	if (!can(actor, 'person.update', contexto) || !alcancaAlvo(actor, alvo)) {
		return json({ erro: 'Sem permissão para editar os atributos desta pessoa.' }, { status: 403 });
	}

	const [atual] = await banco
		.select()
		.from(personAttribute)
		.where(eq(personAttribute.personId, alvo.id))
		.limit(1);

	const proximo = {
		physical: dados.fisico !== undefined ? dados.fisico : (atual?.physical ?? null),
		biblical: dados.biblico !== undefined ? dados.biblico : (atual?.biblical ?? null),
		mental: dados.mental !== undefined ? dados.mental : (atual?.mental ?? null),
		motor: dados.coordenacaoMotora !== undefined ? dados.coordenacaoMotora : (atual?.motor ?? null),
		heightCm: dados.alturaCm !== undefined ? dados.alturaCm : (atual?.heightCm ?? null),
		weightTenthsKg:
			dados.pesoKg !== undefined ? pesoParaDecimos(dados.pesoKg) : (atual?.weightTenthsKg ?? null),
		dominantSide:
			dados.lateralidade !== undefined ? dados.lateralidade : (atual?.dominantSide ?? null),
		shirtSize:
			dados.tamanhoCamiseta !== undefined ? dados.tamanhoCamiseta : (atual?.shirtSize ?? null),
		strengths: dados.pontosFortes !== undefined ? dados.pontosFortes : (atual?.strengths ?? null),
		draftNotes:
			dados.observacaoDraft !== undefined ? dados.observacaoDraft : (atual?.draftNotes ?? null)
	};

	const temAlgumDado = Object.values(proximo).some((v) => v !== null);
	if (alvo.birthDate && idadeEm(alvo.birthDate) < MAIORIDADE && temAlgumDado) {
		return json({ erro: MENSAGEM_MENOR, campo: 'dataNascimento' }, { status: 400 });
	}

	const camposMudados: string[] = [];
	const mapeamento: Array<[string, keyof typeof proximo]> = [
		['fisico', 'physical'],
		['biblico', 'biblical'],
		['mental', 'mental'],
		['coordenacaoMotora', 'motor'],
		['alturaCm', 'heightCm'],
		['pesoKg', 'weightTenthsKg'],
		['lateralidade', 'dominantSide'],
		['tamanhoCamiseta', 'shirtSize'],
		['pontosFortes', 'strengths'],
		['observacaoDraft', 'draftNotes']
	];
	for (const [nomeCampo, coluna] of mapeamento) {
		if ((atual?.[coluna] ?? null) !== proximo[coluna]) {
			camposMudados.push(nomeCampo);
		}
	}

	if (camposMudados.length === 0) {
		return json({
			ok: true,
			alterado: false,
			mensagem: 'Nada mudou nos atributos.',
			atributos: serializarAtributos(atual)
		});
	}

	const mudouNota = camposMudados.some((c) =>
		['fisico', 'biblico', 'mental', 'coordenacaoMotora'].includes(c)
	);
	const agora = new Date();
	const valores = {
		...proximo,
		...(mudouNota && { evaluatedByPersonId: actor.personId, evaluatedAt: agora }),
		updatedAt: agora
	};

	let salvo: typeof personAttribute.$inferSelect | undefined;
	if (atual) {
		[salvo] = await banco
			.update(personAttribute)
			.set(valores)
			.where(eq(personAttribute.id, atual.id))
			.returning();
	} else {
		[salvo] = await banco
			.insert(personAttribute)
			.values({ personId: alvo.id, ...valores })
			.returning();
	}

	await audit(banco, {
		teamId: actor.teamId,
		actorPersonId: actor.personId,
		action: 'person.atributos_atualizados',
		entity: 'person',
		entityId: alvo.id,
		after: { campos: camposMudados },
		ip: getClientAddress(),
		userAgent: request.headers.get('user-agent')
	});

	let avaliadoPorNome: string | null = null;
	if (salvo?.evaluatedByPersonId) {
		const [autor] = await banco
			.select({ nome: person.fullName })
			.from(person)
			.where(and(eq(person.id, salvo.evaluatedByPersonId), naoEhMaster(person.id)))
			.limit(1);
		avaliadoPorNome = autor?.nome ?? null;
	}

	return json({
		ok: true,
		alterado: true,
		mensagem: 'Atributos atualizados.',
		atributos: serializarAtributos(salvo, avaliadoPorNome)
	});
};

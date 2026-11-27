import { z } from 'zod';
import { can, groupsWhere, type Actor } from '$server/policy/policy';
import type { personAttribute } from '$server/db/schema';
import {
	ALTURA_MAX_CM,
	ALTURA_MIN_CM,
	LATERALIDADES,
	NOTA_MAX,
	NOTA_MIN,
	PESO_MAX_KG,
	PESO_MIN_KG,
	TAMANHOS_CAMISETA,
	arredondar1,
	atributosCompletos,
	mediaAtributos,
	type AtributosPessoa,
	type Lateralidade,
	type TamanhoCamiseta
} from '$shared/atributos';

/**
 * Pode visualizar o módulo de Draft e o perfil de atributos dos membros?
 *
 * Membros Eagles (escopo `self`), Conselheiros, Líderes e Master têm `person.view`.
 * Visitantes têm apenas `event.view`, então recebem 403.
 */
export function podeVerDraft(actor: Actor | null): boolean {
	if (!actor) return false;
	return (
		can(actor, 'person.view') ||
		can(actor, 'person.view', { personId: actor.personId }) ||
		groupsWhere(actor, 'person.view').length > 0
	);
}

/** Pode salvar/excluir sessões oficiais de Draft da equipe (líderes, conselheiros e master). */
export function podeGerenciarDraft(actor: Actor | null): boolean {
	if (!actor) return false;
	return can(actor, 'person.update');
}

const notaSchema = z
	.number({ message: 'Informe um número inteiro de 0 a 10.' })
	.int('A nota deve ser um número inteiro de 0 a 10.')
	.min(NOTA_MIN, `A nota mínima é ${NOTA_MIN}.`)
	.max(NOTA_MAX, `A nota máxima é ${NOTA_MAX}.`)
	.nullable();

const alturaSchema = z
	.number({ message: 'Informe a altura em centímetros.' })
	.int('Informe a altura em centímetros inteiros (ex.: 178).')
	.min(ALTURA_MIN_CM, `Altura mínima: ${ALTURA_MIN_CM} cm.`)
	.max(ALTURA_MAX_CM, `Altura máxima: ${ALTURA_MAX_CM} cm.`)
	.nullable();

const pesoSchema = z
	.number({ message: 'Informe o peso em kg.' })
	.min(PESO_MIN_KG, `Peso mínimo: ${PESO_MIN_KG} kg.`)
	.max(PESO_MAX_KG, `Peso máximo: ${PESO_MAX_KG} kg.`)
	.transform((v) => arredondar1(v))
	.nullable();

const textoOpcional = (max: number) =>
	z
		.string()
		.trim()
		.max(max, `Use no máximo ${max} caracteres.`)
		.nullable()
		.transform((v) => v || null);

/** Campos complementares que a própria pessoa também pode atualizar em "Meu perfil". */
export const atributosBasicosSchema = z.object({
	alturaCm: alturaSchema.optional(),
	pesoKg: pesoSchema.optional(),
	lateralidade: z.enum(LATERALIDADES).nullable().optional(),
	tamanhoCamiseta: z.enum(TAMANHOS_CAMISETA).nullable().optional(),
	pontosFortes: textoOpcional(280).optional()
});

/** Avaliação completa feita por líderes ou conselheiros (`PUT /api/pessoas/[id]/atributos`). */
export const atributosCompletosSchema = atributosBasicosSchema
	.extend({
		fisico: notaSchema.optional(),
		biblico: notaSchema.optional(),
		mental: notaSchema.optional(),
		coordenacaoMotora: notaSchema.optional(),
		observacaoDraft: textoOpcional(500).optional()
	})
	.strict();

export type LinhaAtributo = typeof personAttribute.$inferSelect;

export function pesoParaDecimos(pesoKg: number | null): number | null {
	if (pesoKg === null) return null;
	return Math.round(pesoKg * 10);
}

export function decimosParaPeso(decimos: number | null): number | null {
	if (decimos === null) return null;
	return arredondar1(decimos / 10);
}

export function serializarAtributos(
	linha: LinhaAtributo | null | undefined,
	avaliadoPorNome: string | null = null
): AtributosPessoa {
	const notas = {
		fisico: linha?.physical ?? null,
		biblico: linha?.biblical ?? null,
		mental: linha?.mental ?? null,
		coordenacaoMotora: linha?.motor ?? null
	};
	return {
		...notas,
		media: mediaAtributos(notas),
		completo: atributosCompletos(notas),
		alturaCm: linha?.heightCm ?? null,
		pesoKg: decimosParaPeso(linha?.weightTenthsKg ?? null),
		lateralidade: (linha?.dominantSide as Lateralidade | null) ?? null,
		tamanhoCamiseta: (linha?.shirtSize as TamanhoCamiseta | null) ?? null,
		pontosFortes: linha?.strengths ?? null,
		observacaoDraft: linha?.draftNotes ?? null,
		avaliadoEm: linha?.evaluatedAt ? linha.evaluatedAt.toISOString() : null,
		avaliadoPor: avaliadoPorNome
	};
}

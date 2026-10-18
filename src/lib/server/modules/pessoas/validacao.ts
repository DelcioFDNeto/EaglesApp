import { z } from 'zod';
import { ehData } from '$shared/fuso';
import {
	IDADE_MINIMA,
	SITUACOES_DE_RELACIONAMENTO,
	TIPOS_DE_VINCULO,
	somenteDigitos
} from '$shared/pessoa';

/**
 * Validação do cadastro de pessoas.
 *
 * A regra que orienta tudo aqui é RN-05: **só o nome é obrigatório**. Todo o
 * resto aceita vazio, porque o cadastro é progressivo — a pessoa apareceu uma
 * vez no PG e alguém anotou o nome; o telefone chega quando a relação chegar.
 *
 * Campo vazio vira `null`, nunca string vazia: `''` no banco é um valor que
 * finge ser preenchido e quebra toda consulta por "quem não tem telefone".
 */

/**
 * Campo opcional: trata ausência, `null`, `''` e '   ' como a mesma coisa —
 * ausência — e sempre devolve `string | null`.
 *
 * Aceitar a chave AUSENTE importa: num POST de formulário todos os campos
 * chegam preenchidos com string vazia, mas quem chama o serviço direto (teste,
 * importação, futura API) passa só o que tem. Um schema que exige a chave
 * presente força o chamador a mandar `''`, que é justamente o valor que este
 * projeto não quer ver no banco.
 */
const opcional = () =>
	z.union([z.string(), z.null(), z.undefined()]).transform((v) => {
		if (v == null) return null;
		const limpo = v.trim();
		return limpo === '' ? null : limpo;
	});

const NOME_MIN = 2;
const NOME_MAX = 120;

export const nomeSchema = z
	.string()
	.trim()
	.min(NOME_MIN, 'Informe o nome completo.')
	.max(NOME_MAX, `O nome pode ter no máximo ${NOME_MAX} caracteres.`)
	// Colapsa espaços internos: "Ana  Clara" e "Ana Clara" são a mesma pessoa,
	// e a busca por nome normalizado depende dessa limpeza para casar com a
	// coluna gerada no banco, que não colapsa espaços.
	.transform((v) => v.replace(/\s+/g, ' '));

export const telefoneSchema = opcional().refine(
	(v) => v === null || (somenteDigitos(v).length >= 8 && somenteDigitos(v).length <= 15),
	'Telefone incompleto. Use DDD + número, ou deixe em branco.'
);

export const emailSchema = opcional().refine(
	(v) => v === null || z.string().email().safeParse(v).success,
	'E-mail inválido. Confira ou deixe em branco.'
);

/** Data passada, de 1900 para cá — nascimento, entrada na comunidade. */
function dataPassadaSchema(mensagem: string) {
	return opcional()
		.refine((v) => v === null || ehData(v), 'Data inválida.')
		.refine((v) => {
			if (v === null) return true;
			const data = new Date(`${v}T00:00:00Z`);
			if (Number.isNaN(data.getTime())) return false;
			const hoje = new Date();
			return data <= hoje && data >= new Date('1900-01-02T00:00:00Z');
		}, mensagem);
}

export const dataDeNascimentoSchema = dataPassadaSchema(
	'Data de nascimento fora do intervalo possível.'
);

export const situacaoDeRelacionamentoSchema = opcional().refine(
	(v) => v === null || SITUACOES_DE_RELACIONAMENTO.some((s) => s.valor === v),
	'Situação de relacionamento desconhecida.'
);

/** Cadastro feito por líder ou conselheiro. */
export const criarPessoaSchema = z.object({
	fullName: nomeSchema,
	birthDate: dataDeNascimentoSchema,
	phone: telefoneSchema,
	whatsapp: telefoneSchema,
	email: emailSchema,
	relationshipStatus: situacaoDeRelacionamentoSchema,
	// Antes reaproveitava o schema do nascimento — e o erro falava em "data de
	// nascimento" no campo da data de entrada (revisão de 17/10/2026).
	joinedAt: dataPassadaSchema('A data de entrada não pode ser no futuro nem antes de 1900.'),
	notes: opcional(),
	statusId: opcional()
});

export type CriarPessoaEntrada = z.infer<typeof criarPessoaSchema>;

export const atualizarPessoaSchema = criarPessoaSchema.partial().extend({
	fullName: nomeSchema.optional()
});

export type AtualizarPessoaEntrada = z.infer<typeof atualizarPessoaSchema>;

/**
 * Autocadastro público de visitante (RF-02.3).
 *
 * Deliberadamente mais curto que o cadastro interno: quem está chegando
 * preenche isso em pé, no celular, na porta do PG. Cada campo a mais é uma
 * chance a mais de desistir.
 *
 * A data de nascimento vem ANTES de qualquer campo opcional, porque é ela que
 * decide se os campos de contato podem sequer ser exibidos (ADR 0003).
 */
export const autocadastroSchema = z.object({
	fullName: nomeSchema,
	birthDate: dataDeNascimentoSchema,
	phone: telefoneSchema,
	/** Preenchido apenas quando quem se cadastra é menor de idade. */
	nomeDoResponsavel: opcional(),
	telefoneDoResponsavel: telefoneSchema
});

export type AutocadastroEntrada = z.infer<typeof autocadastroSchema>;

export const vinculoSchema = z.object({
	outraPessoaId: z.string().uuid('Selecione uma pessoa.'),
	tipo: z.enum(TIPOS_DE_VINCULO.map((t) => t.valor) as [string, ...string[]])
});

/** Idade em anos completos numa data de referência. */
export function idadeEm(nascimento: string, referencia = new Date()): number {
	const n = new Date(`${nascimento}T00:00:00Z`);
	let anos = referencia.getUTCFullYear() - n.getUTCFullYear();
	const mes = referencia.getUTCMonth() - n.getUTCMonth();
	if (mes < 0 || (mes === 0 && referencia.getUTCDate() < n.getUTCDate())) anos--;
	return anos;
}

/** Menor de 18 — o que a LGPD art. 14 considera, não o piso dos Eagles. */
export function ehMenorDeIdade(nascimento: string | null): boolean | null {
	if (!nascimento) return null;
	return idadeEm(nascimento) < 18;
}

/**
 * Abaixo do piso de idade acordado com a liderança (D-03).
 *
 * Não é a mesma pergunta que `ehMenorDeIdade`: alguém de 17 anos é menor
 * perante a lei e ainda assim está acima do piso dos Eagles.
 */
export function abaixoDoPisoDeIdade(nascimento: string | null): boolean {
	if (!nascimento) return false;
	return idadeEm(nascimento) < IDADE_MINIMA;
}

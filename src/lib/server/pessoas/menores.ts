/**
 * Regras de idade (ADR 0003, revisão de 18/08/2026).
 *
 *   - Piso de 16 anos: ninguém mais novo entra no cadastro.
 *   - 16 e 17 anos ainda são menores perante a LGPD. Sem o consentimento do
 *     responsável (RN-30), o cadastro fica mínimo: nome e presença. Como o
 *     fluxo de consentimento ainda não existe, contato, observações e dados
 *     de família de um menor são recusados — ausência do dado, não aviso.
 *
 * A data que vale é `person.birth_date`. Idade é sempre calculada na hora,
 * nunca armazenada.
 */

export const IDADE_MINIMA = 16;
export const MAIORIDADE = 18;

/** Idade completa em anos na data `hoje`. */
export function idadeEm(nascimento: string, hoje: Date = new Date()): number {
	const [a, m, d] = nascimento.split('-').map(Number) as [number, number, number];
	let idade = hoje.getFullYear() - a;
	const mes = hoje.getMonth() + 1;
	if (mes < m || (mes === m && hoje.getDate() < d)) idade--;
	return idade;
}

/** `YYYY-MM-DD` válido e não futuro? */
export function dataDeNascimentoValida(valor: string, hoje: Date = new Date()): boolean {
	if (!/^\d{4}-\d{2}-\d{2}$/.test(valor)) return false;
	const [a, m, d] = valor.split('-').map(Number) as [number, number, number];
	const data = new Date(a, m - 1, d);
	if (data.getFullYear() !== a || data.getMonth() !== m - 1 || data.getDate() !== d) return false;
	return a >= 1900 && idadeEm(valor, hoje) >= 0;
}

/** Campos que um menor sem consentimento do responsável não pode ter (RN-30). */
export const CAMPOS_RESTRITOS_MENOR = [
	'telefone',
	'whatsapp',
	'email',
	'observacoes',
	'relacionamento',
	'irmaos',
	'vinculosFamiliares'
] as const;

export const MENSAGEM_MENOR =
	'Pessoas de 16 e 17 anos ficam só com nome e presença até o responsável dar consentimento ' +
	'(LGPD). O registro de consentimento ainda não existe no app, então contato, observações ' +
	'e dados de família não podem ser guardados.';

/**
 * Confere a data de nascimento e, para menor, que nenhum campo restrito
 * ficaria preenchido. `restritosPreenchidos` são os nomes dos campos restritos
 * que terão valor depois da gravação. Devolve a mensagem de erro, ou null.
 */
export function validarIdade(
	nascimento: string | null,
	restritosPreenchidos: string[],
	temAcessoComContato: boolean,
	hoje: Date = new Date()
): string | null {
	if (!nascimento) return null;
	if (!dataDeNascimentoValida(nascimento, hoje)) return 'Data de nascimento inválida.';

	const idade = idadeEm(nascimento, hoje);
	if (idade < IDADE_MINIMA) {
		return `A idade mínima para participar é de ${IDADE_MINIMA} anos.`;
	}
	if (idade < MAIORIDADE && (restritosPreenchidos.length > 0 || temAcessoComContato)) {
		return MENSAGEM_MENOR;
	}
	return null;
}

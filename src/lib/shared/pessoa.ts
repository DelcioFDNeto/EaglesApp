/**
 * Vocabulário do cadastro de pessoas, compartilhado entre servidor e navegador.
 *
 * Fica em `$shared` porque os formulários precisam das mesmas listas e das
 * mesmas mensagens que o servidor usa para validar. Duplicar os rótulos nas
 * telas garante que um dia eles divirjam da validação — e a pessoa recebe um
 * erro sobre uma opção que a tela nem oferecia.
 */

export const SITUACOES_DE_RELACIONAMENTO = [
	{ valor: 'solteiro', rotulo: 'Solteiro(a)' },
	{ valor: 'namorando', rotulo: 'Namorando' },
	{ valor: 'noivo', rotulo: 'Noivo(a)' },
	{ valor: 'casado', rotulo: 'Casado(a)' }
] as const;

export type SituacaoDeRelacionamento = (typeof SITUACOES_DE_RELACIONAMENTO)[number]['valor'];

export const TIPOS_DE_VINCULO = [
	{ valor: 'irmao', rotulo: 'Irmão(ã)', simetrico: true },
	{ valor: 'conjuge', rotulo: 'Cônjuge', simetrico: true },
	{ valor: 'namorado', rotulo: 'Namorado(a)', simetrico: true },
	{ valor: 'responsavel_legal', rotulo: 'Responsável legal', simetrico: false }
] as const;

export type TipoDeVinculo = (typeof TIPOS_DE_VINCULO)[number]['valor'];

export function ehVinculoSimetrico(tipo: TipoDeVinculo): boolean {
	return TIPOS_DE_VINCULO.find((t) => t.valor === tipo)?.simetrico ?? false;
}

/** Tipos de consentimento previstos no ADR 0003. */
export const TIPOS_DE_CONSENTIMENTO = [
	{ valor: 'dados_cadastrais', rotulo: 'Guardar dados de cadastro' },
	{ valor: 'foto', rotulo: 'Usar foto' },
	{ valor: 'compartilhamento_externo', rotulo: 'Compartilhar fora do app' },
	{ valor: 'uso_ia', rotulo: 'Usar em análises com IA' }
] as const;

export type TipoDeConsentimento = (typeof TIPOS_DE_CONSENTIMENTO)[number]['valor'];

/** Como a pessoa entrou no sistema. */
export type OrigemDoCadastro = 'cadastro' | 'autocadastro' | 'importacao';

/** Idade mínima acordada com a liderança (D-03). */
export const IDADE_MINIMA = 16;

/**
 * Normaliza texto para comparação: sem acento, minúsculo, espaços colapsados.
 *
 * Precisa produzir EXATAMENTE o mesmo resultado que a coluna gerada
 * `person.full_name_normalized` no banco, senão a busca não encontra o que
 * está gravado. Por isso a lista de acentos é a mesma da migração 0002.
 */
export function normalizarTexto(valor: string): string {
	return (
		valor
			.normalize('NFD')
			// Remove os diacríticos separados pelo NFD.
			.replace(/[\u0300-\u036f]/g, '')
			.toLowerCase()
			.trim()
			.replace(/\s+/g, ' ')
	);
}

/** Só os dígitos — para comparar telefones digitados de formas diferentes. */
export function somenteDigitos(valor: string): string {
	return valor.replace(/\D/g, '');
}

/**
 * Telefone brasileiro em formato legível. Não valida: formata o que dá,
 * devolve o original quando não reconhece. Cadastro progressivo aceita
 * número estrangeiro e número incompleto.
 */
export function formatarTelefone(valor: string | null): string {
	if (!valor) return '';
	const d = somenteDigitos(valor);
	if (d.length === 11) return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
	if (d.length === 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
	return valor;
}

/** Primeiro nome — usado em saudação e em lista compacta. */
export function primeiroNome(nomeCompleto: string): string {
	return nomeCompleto.trim().split(/\s+/)[0] ?? nomeCompleto;
}

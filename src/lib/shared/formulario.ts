/**
 * Formato único de falha de formulário.
 *
 * O SvelteKit tipa `form` como a UNIÃO de tudo que as ações retornam. Quando
 * cada `fail()` devolve um objeto com chaves diferentes, a união vira um tipo
 * em que nenhuma propriedade existe em todos os ramos — e a tela não consegue
 * ler `form.erros` sem o TypeScript reclamar.
 *
 * Declarar o retorno com este tipo faz todos os ramos terem o mesmo formato.
 * É também o "formato de erro padronizado" que o M01 definiu: campo, código e
 * mensagem em português, dizendo o que aconteceu e como resolver.
 */
export type FalhaDeFormulario<Extra = Record<string, never>> = {
	/** Mensagem geral, quando o problema não é de um campo específico. */
	erro?: string;
	/** O que a pessoa digitou, para não perder o preenchimento. */
	valores?: Record<string, string>;
	/** Mensagem por campo, na chave do campo. */
	erros?: Record<string, string | undefined>;
} & Partial<Extra>;

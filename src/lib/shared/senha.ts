/**
 * Constantes de senha compartilhadas entre servidor e navegador.
 *
 * Ficam aqui, e não em `$server/auth/password`, porque a tela precisa delas
 * para escrever a mensagem de ajuda — e importar `$server` no cliente
 * arrastaria o Argon2id e a conexão de banco para o bundle do navegador.
 * O SvelteKit bloqueia esse import, e com razão.
 */

export const MIN_PASSWORD_LENGTH = 10;

export type PasswordProblem = 'curta' | 'comum' | 'contem_nome';

export const PASSWORD_PROBLEM_MESSAGE: Record<PasswordProblem, string> = {
	curta: `A senha precisa ter pelo menos ${MIN_PASSWORD_LENGTH} caracteres.`,
	comum: 'Essa senha é muito comum. Escolha outra que só você saiba.',
	contem_nome: 'A senha não pode conter o seu nome.'
};

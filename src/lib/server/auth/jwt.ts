import jwt from 'jsonwebtoken';
import { randomBytes } from 'node:crypto';

/**
 * Utilitário de JWT para a API separada (Opção B: Firebase Hosting + API separada).
 *
 * O frontend no Firebase não tem sessão server-side, então a autenticação
 * é feita por JWT enviado no header Authorization: Bearer <token>.
 *
 * O JWT sozinho NÃO basta para autenticar: ele carrega o `sessionId`, e o
 * middleware confere no banco que essa sessão continua viva (ver
 * `autenticarAtor`). É isso que faz "sair" e "desconectar outros aparelhos"
 * terem efeito imediato (ADR 0004).
 */

const ALGORITMO = 'HS256' as const;
const TAMANHO_MINIMO_SEGREDO = 32;

export type JwtPayload = {
	personId: string;
	email?: string;
	sessionId?: string;
};

let segredoEmCache: string | null = null;

/**
 * Lido no primeiro uso, não na importação: o `vite build` importa os módulos
 * de rota para analisá-los, e falhar ali impediria gerar o frontend estático,
 * que nem usa JWT.
 *
 * Sem `JWT_SECRET` fora do modo de desenvolvimento, a API se recusa a emitir
 * ou aceitar tokens. Um segredo padrão conhecido deixaria qualquer pessoa
 * forjar o token de um líder.
 */
function segredo(): string {
	if (segredoEmCache) return segredoEmCache;

	const definido = process.env.JWT_SECRET;

	if (definido) {
		if (definido.length < TAMANHO_MINIMO_SEGREDO) {
			throw new Error(
				`JWT_SECRET precisa ter pelo menos ${TAMANHO_MINIMO_SEGREDO} caracteres. ` +
					'Gere um com: openssl rand -hex 32'
			);
		}
		segredoEmCache = definido;
		return segredoEmCache;
	}

	if (import.meta.env?.DEV) {
		// Desenvolvimento e testes: segredo aleatório por processo. Tokens deixam
		// de valer ao reiniciar o servidor, o que é aceitável fora de produção.
		segredoEmCache = randomBytes(32).toString('hex');
		return segredoEmCache;
	}

	throw new Error('JWT_SECRET não definida. Configure a variável de ambiente da API.');
}

/**
 * O token vence junto com a sessão que ele representa (`session.expires_at`,
 * 30 dias pelo ADR 0004). Antes ele tinha prazo próprio de 7 dias e derrubava
 * todo mundo bem antes de a sessão acabar. Revogar continua sendo imediato:
 * o middleware confere a sessão no banco a cada requisição.
 */
export function gerarToken(payload: JwtPayload, expiraEm: Date) {
	const segundos = Math.floor((expiraEm.getTime() - Date.now()) / 1000);
	if (segundos <= 0) throw new Error('sessão já expirada: não há token a emitir');
	return jwt.sign(payload, segredo(), { expiresIn: segundos, algorithm: ALGORITMO });
}

export function gerarTokenReset() {
	return randomBytes(32).toString('hex');
}

export function validarToken(token: string): JwtPayload {
	return jwt.verify(token, segredo(), { algorithms: [ALGORITMO] }) as JwtPayload;
}

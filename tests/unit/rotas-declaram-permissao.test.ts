/**
 * Guarda de arquitetura: negação por padrão.
 *
 * A regra da seção 11.4: "rota sem declaração de permissão é rota bloqueada —
 * a ausência de declaração é erro de teste, não porta aberta."
 *
 * Este arquivo varre todos os `+page.server.ts` e `+server.ts` do projeto e
 * exige que cada um faça uma de três coisas:
 *
 *   a) chamar `authorize(...)` ou `can(...)`   → rota protegida pelo motor RBAC
 *   b) estar na lista `ROTAS_PUBLICAS`         → pública por decisão consciente
 *   c) falhar o teste                          → alguém esqueceu
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { describe, expect, it } from 'vitest';

const RAIZ_ROTAS = join(process.cwd(), 'src', 'routes');

/**
 * Rotas genuinamente públicas (ou pré-autenticação). Todas as rotas de dados
 * (M02–M07) passam por `can(...)` ou `authorize(...)` e NÃO entram nesta lista.
 */
const ROTAS_PUBLICAS: Record<string, string> = {
	'api/auth/convite/[token]/+server.ts':
		'Aceite de convite: protegido pelo token de 256 bits e por rate limit.',
	'api/health/+server.ts': 'Monitor externo e CI consultam sem credencial; não devolve dado.',
	'api/auth/login/+server.ts':
		'Autenticação: recebe credenciais e emite JWT + sessão; não expõe dado privado.',
	'api/auth/me/+server.ts':
		'Ping de identidade: confere a sessão do JWT e devolve só id e email da própria pessoa.',
	'api/auth/esqueci-senha/+server.ts':
		'Redefinição de senha: gera token de uso único sem revelar se o e-mail existe.',
	'api/auth/resetar-senha/+server.ts':
		'Redefinição de senha: valida token de uso único e atualiza senha.',
	'api/auth/logout/+server.ts': 'Logout: revoga a sessão do próprio token; idempotente.',
	'api/auth/solicitar-cadastro/+server.ts':
		'Solicitação de acesso: registra interesse para convite posterior do conselheiro.'
};

function listarArquivosDeRota(dir: string, acumulado: string[] = []): string[] {
	for (const entrada of readdirSync(dir)) {
		const caminho = join(dir, entrada);
		if (statSync(caminho).isDirectory()) {
			listarArquivosDeRota(caminho, acumulado);
		} else if (entrada === '+page.server.ts' || entrada === '+server.ts') {
			acumulado.push(caminho);
		}
	}
	return acumulado;
}

const arquivos = listarArquivosDeRota(RAIZ_ROTAS);

function chave(caminho: string): string {
	return relative(RAIZ_ROTAS, caminho).split(sep).join('/');
}

describe('toda rota de servidor declara sua permissão', () => {
	it('encontrou rotas para verificar', () => {
		expect(arquivos.length).toBeGreaterThan(0);
	});

	for (const arquivo of arquivos) {
		const rota = chave(arquivo);

		it(`${rota}`, () => {
			const fonte = readFileSync(arquivo, 'utf8');

			const verificaPermissao = /\bauthorize\s*\(/.test(fonte) || /\bcan\s*\(/.test(fonte);

			const publicaPorDecisao = rota in ROTAS_PUBLICAS;

			if (publicaPorDecisao) {
				expect(
					verificaPermissao,
					`"${rota}" está listada como pública mas verifica permissão. ` +
						`Remova-a de ROTAS_PUBLICAS.`
				).toBe(false);
				return;
			}

			expect(
				verificaPermissao,
				`"${rota}" não chama authorize() nem can(). Ou proteja a rota, ou ` +
					`declare-a em ROTAS_PUBLICAS com o motivo.`
			).toBe(true);
		});
	}

	it('a lista de públicas não tem entrada morta', () => {
		const existentes = new Set(arquivos.map(chave));
		const fantasmas = Object.keys(ROTAS_PUBLICAS).filter((r) => !existentes.has(r));
		expect(
			fantasmas,
			`ROTAS_PUBLICAS aponta para arquivos que não existem: ${fantasmas.join(', ')}`
		).toEqual([]);
	});
});

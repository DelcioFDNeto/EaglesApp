/**
 * Guarda de arquitetura: negação por padrão.
 *
 * A regra da seção 11.4: "rota sem declaração de permissão é rota bloqueada —
 * a ausência de declaração é erro de teste, não porta aberta."
 *
 * Este arquivo é a execução dessa regra. Ele varre todos os `+page.server.ts`
 * e `+server.ts` do projeto e exige que cada um faça uma de três coisas:
 *
 *   a) chamar `authorize(...)` ou `can(...)`   → rota protegida
 *   b) estar na lista `ROTAS_PUBLICAS`         → pública por decisão consciente
 *   c) falhar o teste                          → alguém esqueceu
 *
 * Adicionar uma rota à lista de públicas é deliberado e fica visível no diff,
 * que é exatamente o ponto: a decisão de expor algo tem que ser vista por
 * alguém, não acontecer por omissão.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { describe, expect, it } from 'vitest';

const RAIZ_ROTAS = join(process.cwd(), 'src', 'routes');

/**
 * Rotas públicas por decisão. Cada uma com o motivo — se o motivo não couber
 * numa linha, provavelmente a rota não deveria ser pública.
 */
const ROTAS_PUBLICAS: Record<string, string> = {
	'+page.server.ts': 'Raiz: só redireciona conforme a sessão, não expõe dado.',
	'entrar/+page.server.ts': 'Autenticação: precisa ser alcançável por quem não entrou.',
	'convite/[token]/+page.server.ts':
		'Aceite de convite: protegido pelo token de 256 bits e por rate limit.',
	'sair/+page.server.ts': 'Encerra a própria sessão; sem sessão, nada acontece.',
	'api/health/+server.ts': 'Monitor externo e CI consultam sem credencial; não devolve dado.'
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

/** Caminho relativo com barra normal, para comparar em qualquer sistema. */
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
				// Uma rota pública que passou a verificar permissão deve sair da
				// lista — lista desatualizada engana quem lê.
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

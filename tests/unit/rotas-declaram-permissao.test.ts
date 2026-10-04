/**
 * Guarda de arquitetura: negação por padrão.
 *
 * A regra da seção 11.4: "rota sem declaração de permissão é rota bloqueada —
 * a ausência de declaração é erro de teste, não porta aberta."
 *
 * Este arquivo é a execução dessa regra. Ele varre todos os `+page.server.ts`
 * e `+server.ts` do projeto e exige que cada um faça uma de quatro coisas:
 *
 *   a) chamar `authorize(...)` ou `can(...)`   → rota protegida
 *   b) estar em `ROTAS_DA_PROPRIA_CONTA`       → exige sessão, não papel
 *   c) estar na lista `ROTAS_PUBLICAS`         → pública por decisão consciente
 *   d) falhar o teste                          → alguém esqueceu
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
	'api/health/+server.ts': 'Monitor externo e CI consultam sem credencial; não devolve dado.',
	'sou-novo/+page.server.ts':
		'Autocadastro de visitante: público por decisão, atrás de chave desligada por padrão e com limite por IP.'
};

/**
 * Rotas da PRÓPRIA CONTA: exigem sessão, mas não papel nem permissão.
 *
 * Categoria criada no M03. `/conta/sessoes` exigia `person.view` sobre a
 * própria pessoa e com isso barrava o conselheiro — cujos papéis são de grupo
 * e não autorizam sem `groupId`. Ver os próprios aparelhos e confirmar a
 * própria senha são segurança da conta, não poder sobre a comunidade.
 *
 * O teste confere que cada uma recusa quem não tem sessão.
 */
const ROTAS_DA_PROPRIA_CONTA: Record<string, string> = {
	'conta/sessoes/+page.server.ts': 'Ver e encerrar os próprios aparelhos conectados.',
	'conta/confirmar/+page.server.ts': 'Confirmar a própria senha antes de uma ação sensível.'
};

/**
 * Os pontos de entrada da política. Uma rota protegida chama pelo menos um.
 *
 * A lista fica aqui, explícita, porque foi exatamente o que falhou quando o
 * M02 acrescentou `canAnywhere`: o teste passou a acusar rotas protegidas como
 * desprotegidas. Melhor uma lista que alguém atualiza conscientemente do que
 * um regex esperto que erra em silêncio.
 */
const VERIFICADORES = [
	'authorize',
	'authorizeAnywhere',
	'can',
	'canAnywhere',
	'canGlobally'
] as const;

function listarArquivosDeRota(dir: string, acumulado: string[] = []): string[] {
	for (const entrada of readdirSync(dir)) {
		const caminho = join(dir, entrada);
		if (statSync(caminho).isDirectory()) {
			listarArquivosDeRota(caminho, acumulado);
		} else if (
			entrada === '+page.server.ts' ||
			entrada === '+server.ts' ||
			// Layout também carrega dado e também pode vazá-lo. Entrou no M03,
			// junto com o primeiro layout com `load` (a navegação).
			entrada === '+layout.server.ts'
		) {
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

			const verificaPermissao = VERIFICADORES.some((nome) =>
				new RegExp(`\\b${nome}\\s*\\(`).test(fonte)
			);

			const publicaPorDecisao = rota in ROTAS_PUBLICAS;

			if (rota in ROTAS_DA_PROPRIA_CONTA) {
				// Sem permissão a declarar, mas com sessão obrigatória: a rota precisa
				// mandar quem não está autenticado para a entrada.
				expect(
					/if\s*\(\s*!locals\.(actor|session)/.test(fonte) &&
						/redirect\(\s*303,\s*'\/entrar/.test(fonte),
					`"${rota}" é da própria conta mas não recusa quem não tem sessão.`
				).toBe(true);
				return;
			}

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

	it('as listas de exceção não têm entrada morta', () => {
		const existentes = new Set(arquivos.map(chave));
		const fantasmas = [
			...Object.keys(ROTAS_PUBLICAS),
			...Object.keys(ROTAS_DA_PROPRIA_CONTA)
		].filter((r) => !existentes.has(r));
		expect(
			fantasmas,
			`As listas de exceção apontam para arquivos que não existem: ${fantasmas.join(', ')}`
		).toEqual([]);
	});
});

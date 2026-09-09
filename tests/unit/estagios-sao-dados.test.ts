import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ESTAGIOS_SEMENTE } from '../../src/lib/server/modules/pessoas/estagios-semente';

/**
 * Guarda de arquitetura: estágios da jornada são DADOS, não enum (RN-02).
 *
 * O briefing exige que a liderança crie estágios novos sem alteração de
 * código. Isso só se sustenta enquanto nenhuma regra comparar a chave do
 * estágio com um literal — `if (status === 'membro')` transforma a tabela num
 * enum disfarçado, e o estágio novo criado pela liderança não faz nada.
 *
 * Este teste varre o código de domínio e de rotas procurando as chaves
 * semeadas escritas à mão. Onde o comportamento precisa variar, leia uma
 * PROPRIEDADE da linha (`isTerminal`, `isDefault`, `grantsRoleId`) — é o que
 * continua funcionando para um estágio que ainda não existe.
 */

const RAIZES = [
	join(process.cwd(), 'src', 'lib', 'server', 'modules'),
	join(process.cwd(), 'src', 'routes')
];

/**
 * Onde a chave literal é legítima.
 *
 * A semente PRECISA escrever as chaves — é ela que as cria. Qualquer outro
 * arquivo nesta lista deveria vir com uma justificativa ao lado.
 */
const PERMITIDOS = new Set(['estagios-semente.ts']);

function listarFontes(dir: string, acumulado: string[] = []): string[] {
	for (const entrada of readdirSync(dir)) {
		const caminho = join(dir, entrada);
		if (statSync(caminho).isDirectory()) {
			listarFontes(caminho, acumulado);
		} else if (/\.(ts|svelte)$/.test(entrada)) {
			acumulado.push(caminho);
		}
	}
	return acumulado;
}

const arquivos = RAIZES.flatMap((raiz) => listarFontes(raiz));

describe('estágios da jornada são dados, não enum', () => {
	it('encontrou arquivos para verificar', () => {
		expect(arquivos.length).toBeGreaterThan(0);
	});

	for (const chave of ESTAGIOS_SEMENTE.map((e) => e.key)) {
		it(`nenhum código compara com '${chave}'`, () => {
			const infratores: string[] = [];

			for (const arquivo of arquivos) {
				const nome = arquivo.split(sep).at(-1)!;
				if (PERMITIDOS.has(nome)) continue;

				const fonte = readFileSync(arquivo, 'utf8');
				if (new RegExp(`['"\`]${chave}['"\`]`).test(fonte)) {
					infratores.push(relative(process.cwd(), arquivo));
				}
			}

			expect(
				infratores,
				`A chave '${chave}' aparece escrita à mão em: ${infratores.join(', ')}. ` +
					`Leia uma propriedade do estágio em vez da chave — senão um estágio ` +
					`criado pela liderança não terá o mesmo comportamento.`
			).toEqual([]);
		});
	}
});

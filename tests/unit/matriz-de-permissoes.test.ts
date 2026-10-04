/**
 * A matriz papel × permissão × escopo, inteira (entregável do M03, seção 19.1).
 *
 * Os testes de `policy.test.ts` escolhem casos; este cobre TODOS: cada papel
 * semeado, cada permissão do catálogo, cada tipo de contexto. É onde um erro
 * deixa de ser bug e vira vazamento.
 *
 * O resultado esperado vem de uma especificação de escopo escrita aqui, à mão,
 * e não de uma chamada à própria política. Um teste que calcula o esperado
 * com o código que está testando só prova que o código concorda consigo mesmo.
 */

import { describe, expect, it } from 'vitest';
import { can, canAnywhere, type Actor } from '../../src/lib/server/policy/policy';
import {
	ALL_PERMISSIONS,
	RECURSOS,
	recursoDe,
	type Permission,
	type PolicyContext,
	type ScopeType
} from '../../src/lib/server/policy/permissions';
import { ROLE_SEEDS } from '../../src/lib/server/policy/roles';

const EU = 'pessoa-eu';
const OUTRA = 'pessoa-outra';
const MEU_GRUPO = 'grupo-meu';
const OUTRO_GRUPO = 'grupo-outro';

const CONTEXTOS = {
	'sem contexto': {},
	'a própria pessoa': { personId: EU },
	'outra pessoa': { personId: OUTRA },
	'o próprio grupo': { groupId: MEU_GRUPO },
	'outro grupo': { groupId: OUTRO_GRUPO }
} as const satisfies Record<string, PolicyContext>;

type NomeDoContexto = keyof typeof CONTEXTOS;

/**
 * A especificação de escopo da seção 11.2, como tabela.
 *
 * - global: vale em qualquer contexto
 * - group:  só quando o contexto aponta o grupo do escopo
 * - self:   só quando o contexto aponta a própria pessoa
 *
 * "Sem contexto" só autoriza o global: pedir uma ação sem dizer sobre qual
 * grupo ou pessoa é ambíguo, e ambiguidade se resolve negando.
 */
const ESCOPO_AUTORIZA: Record<ScopeType, Record<NomeDoContexto, boolean>> = {
	global: {
		'sem contexto': true,
		'a própria pessoa': true,
		'outra pessoa': true,
		'o próprio grupo': true,
		'outro grupo': true
	},
	group: {
		'sem contexto': false,
		'a própria pessoa': false,
		'outra pessoa': false,
		'o próprio grupo': true,
		'outro grupo': false
	},
	self: {
		'sem contexto': false,
		'a própria pessoa': true,
		'outra pessoa': false,
		'o próprio grupo': false,
		'outro grupo': false
	}
};

function atorCom(papel: (typeof ROLE_SEEDS)[number]): Actor {
	return {
		personId: EU,
		teamId: 'eagles',
		assignments: [
			{
				roleKey: papel.key,
				scopeType: papel.defaultScope,
				scopeId: papel.defaultScope === 'group' ? MEU_GRUPO : null,
				permissions: new Set(papel.permissions)
			}
		]
	};
}

describe('matriz completa: papel × permissão × contexto', () => {
	for (const papel of ROLE_SEEDS) {
		it(`${papel.name} (escopo ${papel.defaultScope})`, () => {
			const ator = atorCom(papel);
			const temPermissao = new Set<Permission>(papel.permissions);
			const divergencias: string[] = [];

			for (const permissao of ALL_PERMISSIONS) {
				for (const [nome, contexto] of Object.entries(CONTEXTOS) as [
					NomeDoContexto,
					PolicyContext
				][]) {
					const esperado = temPermissao.has(permissao) && ESCOPO_AUTORIZA[papel.defaultScope][nome];
					const obtido = can(ator, permissao, contexto);
					if (obtido !== esperado) {
						divergencias.push(`${permissao} em "${nome}": esperava ${esperado}, veio ${obtido}`);
					}
				}
			}

			expect(divergencias).toEqual([]);
		});
	}

	it('verificou o produto cartesiano inteiro', () => {
		// Se alguém esvaziar uma das listas, os testes acima passariam sem
		// verificar nada. Esta conta fecha essa porta.
		const total = ROLE_SEEDS.length * ALL_PERMISSIONS.length * Object.keys(CONTEXTOS).length;
		expect(total).toBe(4 * ALL_PERMISSIONS.length * 5);
		expect(ALL_PERMISSIONS.length).toBeGreaterThan(30);
	});
});

describe('canAnywhere responde só "o papel inclui a permissão?"', () => {
	for (const papel of ROLE_SEEDS) {
		it(`${papel.name}`, () => {
			const ator = atorCom(papel);
			const temPermissao = new Set<Permission>(papel.permissions);
			const divergencias = ALL_PERMISSIONS.filter(
				(p) => canAnywhere(ator, p) !== temPermissao.has(p)
			);
			expect(divergencias).toEqual([]);
		});
	}
});

/**
 * A mesma matriz, como documento.
 *
 * Gravada em `__snapshots__/matriz-de-permissoes.md`. Quem mudar a semente de
 * papéis vê a mudança no diff como uma linha de tabela legível — "conselheiro
 * passou a ter finance.view_all" salta aos olhos de quem revisa, enquanto a
 * mesma mudança num array de strings passaria batida.
 */
describe('a matriz documentada', () => {
	it('confere com a semente de papéis', async () => {
		const marca: Record<ScopeType, string> = {
			global: '✓ global',
			group: '✓ no grupo',
			self: '✓ próprio'
		};

		const linhas = [
			'# Matriz de permissões — semente de papéis',
			'',
			'Gerado por `tests/unit/matriz-de-permissoes.test.ts`. Não edite à mão:',
			'mude a semente em `src/lib/server/policy/roles.ts` e rode os testes com `-u`.',
			'',
			'Esta é a configuração de INSTALAÇÃO. Depois de semeados, papéis e',
			'permissões são editados na tela de administração, e o banco passa a valer.',
			''
		];

		const cabecalho = ['Permissão', ...ROLE_SEEDS.map((r) => r.name)];
		for (const recurso of RECURSOS) {
			const permissoes = ALL_PERMISSIONS.filter((p) => recursoDe(p) === recurso.prefixo);
			if (permissoes.length === 0) continue;

			linhas.push(`## ${recurso.rotulo}`, '');
			linhas.push(`| ${cabecalho.join(' | ')} |`);
			linhas.push(`| ${cabecalho.map(() => '---').join(' | ')} |`);
			for (const permissao of permissoes) {
				const celulas = ROLE_SEEDS.map((r) =>
					r.permissions.includes(permissao) ? marca[r.defaultScope] : '—'
				);
				linhas.push(`| \`${permissao}\` | ${celulas.join(' | ')} |`);
			}
			linhas.push('');
		}

		await expect(linhas.join('\n')).toMatchFileSnapshot('./__snapshots__/matriz-de-permissoes.md');
	});

	it('todo recurso do catálogo tem rótulo — senão some da tabela', () => {
		const prefixos = new Set<string>(RECURSOS.map((r) => r.prefixo));
		const orfas = ALL_PERMISSIONS.filter((p) => !prefixos.has(recursoDe(p)));
		expect(orfas).toEqual([]);
	});
});

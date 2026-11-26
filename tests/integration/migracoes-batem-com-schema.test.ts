/**
 * Guarda de deriva: as migrações SQL produzem o schema que o código espera?
 *
 * As migrações 0002–0006 foram escritas à mão. Se uma coluna, FK ou índice
 * do `schema/index.ts` não estiver nelas (ou vice-versa), o código roda contra
 * um banco diferente do que acha que tem — e o erro só aparece em produção.
 *
 * Aplica todas as migrações num Postgres real (PGlite) e pede ao drizzle-kit
 * o que faltaria para o banco igualar o schema.
 *
 * A comparação é por SIGNIFICADO, não por texto. Diferenças só de
 * representação são aceitas de propósito:
 *   - nomes de FK, unique e índice (as migrações à mão usam `*_fk`, `*_key`);
 *   - unique como constraint × unique como índice (mesmo efeito);
 *   - DEFAULT no `id` (o banco gera, o schema também gera no app com uuidv7);
 *   - CHECKs, gatilhos e views que vivem só no SQL (0001_regras_de_banco).
 *
 * O que NÃO é aceito: coluna faltando, sobrando ou com tipo/nulidade
 * diferente; FK com alvo ou ON DELETE diferente; unique ou índice ausente.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import * as schema from '../../src/lib/server/db/schema';
import { criarBancoDeTeste, type BancoDeTeste } from './helpers/banco';

// A build ESM de drizzle-kit/api faz require dinâmico de "fs" e quebra no
// Vitest; a build CJS funciona.
const { pushSchema } = createRequire(import.meta.url)(
	'drizzle-kit/api'
) as typeof import('drizzle-kit/api');

let ctx: BancoDeTeste;
let comandos: string[];

const ON_DELETE: Record<string, string> = {
	a: 'no action',
	r: 'restrict',
	c: 'cascade',
	n: 'set null',
	d: 'set default'
};

const semAspas = (s: string) => s.replace(/"/g, '').replace(/^public\./, '');

async function linhas<T>(sql: string): Promise<T[]> {
	return (await ctx.cliente.query<T>(sql)).rows;
}

describe('migrações × schema', () => {
	beforeAll(async () => {
		ctx = await criarBancoDeTeste();
		comandos = (await pushSchema(schema, ctx.db as never)).statementsToExecute;
	}, 60_000);

	afterAll(async () => {
		await ctx?.fechar();
	});

	it('nenhuma tabela ou coluna diverge (nome, tipo, nulidade)', () => {
		const divergentes = comandos.filter(
			(c) =>
				/\b(CREATE|DROP) TABLE\b|\bADD COLUMN\b|\bDROP COLUMN\b|\bRENAME\b/.test(c) ||
				(/\bALTER COLUMN\b/.test(c) && !/ALTER COLUMN "id" DROP DEFAULT/.test(c))
		);
		expect(divergentes, divergentes.join('\n')).toEqual([]);
	});

	it('toda FK do schema existe no banco com o mesmo alvo e ON DELETE', async () => {
		const noBanco = new Set(
			(
				await linhas<{ tabela: string; coluna: string; alvo: string; ref: string; del: string }>(`
					select c.conrelid::regclass::text as tabela, a.attname as coluna,
					       c.confrelid::regclass::text as alvo, af.attname as ref, c.confdeltype as del
					from pg_constraint c
					join pg_attribute a on a.attrelid = c.conrelid and a.attnum = c.conkey[1]
					join pg_attribute af on af.attrelid = c.confrelid and af.attnum = c.confkey[1]
					where c.contype = 'f'`)
			).map(
				(l) =>
					`${semAspas(l.tabela)}.${l.coluna} → ${semAspas(l.alvo)}.${l.ref} (${ON_DELETE[l.del]})`
			)
		);

		const fk =
			/ALTER TABLE "([^"]+)" ADD CONSTRAINT "[^"]+" FOREIGN KEY \("([^"]+)"\) REFERENCES "(?:public"\.")?([^"]+)"\("([^"]+)"\) ON DELETE ([a-z ]+?) ON UPDATE/;

		const esperadas = comandos
			.map((c) => fk.exec(c))
			.filter((m): m is RegExpExecArray => m !== null)
			.map(([, tabela, coluna, alvo, ref, del]) => `${tabela}.${coluna} → ${alvo}.${ref} (${del})`);

		// Sanidade: o teste só vale se de fato conferiu FKs (as renomeadas voltam
		// como ADD no diff). Se o formato do drizzle-kit mudar, o regex para de
		// casar e isto acusa, em vez de passar sem verificar nada.
		expect(esperadas.length).toBeGreaterThan(30);
		expect(noBanco.size).toBeGreaterThan(30);

		const faltando = esperadas.filter((esperada) => !noBanco.has(esperada));

		expect(
			faltando,
			`FKs do schema ausentes ou diferentes no banco:\n${faltando.join('\n')}`
		).toEqual([]);
	});

	it('todo unique e índice do schema existe no banco sobre as mesmas colunas', async () => {
		const indices = await linhas<{ tabela: string; colunas: string; unico: boolean }>(`
			select t.relname as tabela, i.indisunique as unico,
			       string_agg(a.attname, ',' order by k.ord) as colunas
			from pg_index i
			join pg_class t on t.oid = i.indrelid
			join pg_namespace n on n.oid = t.relnamespace and n.nspname = 'public'
			cross join lateral unnest(i.indkey) with ordinality as k(attnum, ord)
			join pg_attribute a on a.attrelid = t.oid and a.attnum = k.attnum
			group by i.indexrelid, t.relname, i.indisunique`);

		const existe = (tabela: string, colunas: string, unico: boolean) =>
			indices.some((x) => x.tabela === tabela && x.colunas === colunas && (!unico || x.unico));

		const cols = (lista: string) =>
			lista
				.split(',')
				.map(semAspas)
				.map((s) => s.trim())
				.join(',');

		const faltando: string[] = [];
		let conferidos = 0;
		for (const c of comandos) {
			const constraint = /ALTER TABLE "([^"]+)" ADD CONSTRAINT "[^"]+" UNIQUE\(([^)]+)\)/.exec(c);
			const indice = /CREATE (UNIQUE )?INDEX "[^"]+" ON "([^"]+)" USING \w+ \(([^)]+)\)/.exec(c);

			if (constraint || indice) conferidos++;
			if (constraint && !existe(constraint[1]!, cols(constraint[2]!), true)) faltando.push(c);
			if (indice && !existe(indice[2]!, cols(indice[3]!), Boolean(indice[1]))) faltando.push(c);
		}

		expect(conferidos).toBeGreaterThan(0);
		expect(faltando, faltando.join('\n')).toEqual([]);
	});
});

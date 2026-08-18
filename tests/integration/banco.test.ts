/**
 * Testes das garantias que vivem no BANCO, não no código.
 *
 * Convenção de código se esquece; restrição de banco, não. Estes testes provam
 * que as regras da migração 0001 realmente funcionam — contra Postgres de
 * verdade (PGlite), não contra mock.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { criarBancoDeTeste, type BancoDeTeste } from './helpers/banco';
import { auditLog, person, personRole } from '../../src/lib/server/db/schema';

let ctx: BancoDeTeste;

beforeAll(async () => {
	ctx = await criarBancoDeTeste();
}, 60_000);

afterAll(async () => {
	await ctx?.fechar();
});

describe('migrações', () => {
	it('aplicam do zero e criam as 12 tabelas', async () => {
		const r = await ctx.db.execute(
			sql`select table_name from information_schema.tables where table_schema = 'public' and table_type = 'BASE TABLE'`
		);
		const tabelas = (r as unknown as { rows: { table_name: string }[] }).rows.map(
			(x) => x.table_name
		);

		for (const esperada of [
			'team',
			'person',
			'user_account',
			'session',
			'invite',
			'permission',
			'role',
			'role_permission',
			'person_role',
			'setting',
			'feature_flag',
			'audit_log'
		]) {
			expect(tabelas, `tabela "${esperada}" não foi criada`).toContain(esperada);
		}
	});

	it('semearam o catálogo completo de permissões', async () => {
		const r = await ctx.db.execute(sql`select count(*)::int as n from permission`);
		const { n } = (r as unknown as { rows: { n: number }[] }).rows[0]!;
		expect(n).toBeGreaterThan(20);
	});
});

describe('auditoria é append-only (RN-28)', () => {
	it('aceita inserção', async () => {
		await ctx.db.insert(auditLog).values({
			teamId: ctx.teamId,
			action: 'auth.login',
			entity: 'session'
		});

		const r = await ctx.db.execute(sql`select count(*)::int as n from audit_log`);
		expect((r as unknown as { rows: { n: number }[] }).rows[0]!.n).toBeGreaterThan(0);
	});

	it('RECUSA update — mesmo vindo do dono da tabela', async () => {
		await expect(ctx.db.execute(sql`update audit_log set action = 'adulterado'`)).rejects.toThrow(
			/append-only/i
		);
	});

	it('RECUSA delete', async () => {
		await expect(ctx.db.execute(sql`delete from audit_log`)).rejects.toThrow(/append-only/i);
	});
});

describe('person_view — menoridade derivada (ADR 0003)', () => {
	async function criarPessoa(nome: string, nascimento: string | null) {
		const [p] = await ctx.db
			.insert(person)
			.values({ teamId: ctx.teamId, fullName: nome, birthDate: nascimento })
			.returning({ id: person.id });
		return p!.id;
	}

	function anosAtras(n: number): string {
		const d = new Date();
		d.setFullYear(d.getFullYear() - n);
		d.setDate(d.getDate() - 1); // garante que o aniversário já passou
		return d.toISOString().slice(0, 10);
	}

	it('marca menor quem tem menos de 18', async () => {
		const id = await criarPessoa('Adolescente de 16', anosAtras(16));
		const r = await ctx.db.execute(
			sql`select is_minor, age_years from person_view where id = ${id}`
		);
		const linha = (r as unknown as { rows: { is_minor: boolean; age_years: number }[] }).rows[0]!;
		expect(linha.is_minor).toBe(true);
		expect(linha.age_years).toBe(16);
	});

	it('não marca menor quem tem 18 ou mais', async () => {
		const id = await criarPessoa('Adulto de 18', anosAtras(18));
		const r = await ctx.db.execute(sql`select is_minor from person_view where id = ${id}`);
		expect((r as unknown as { rows: { is_minor: boolean }[] }).rows[0]!.is_minor).toBe(false);
	});

	it('devolve NULL quando a data de nascimento é desconhecida', async () => {
		// NULL significa "trate pelo regime restrito", nunca "é maior".
		const id = await criarPessoa('Visitante sem data', null);
		const r = await ctx.db.execute(sql`select is_minor from person_view where id = ${id}`);
		expect((r as unknown as { rows: { is_minor: boolean | null }[] }).rows[0]!.is_minor).toBeNull();
	});

	it('recusa data de nascimento no futuro', async () => {
		const amanha = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
		await expect(criarPessoa('Viajante do tempo', amanha)).rejects.toThrow(/plausivel|check/i);
	});
});

describe('coerência do escopo de papel', () => {
	async function pessoaQualquer() {
		const [p] = await ctx.db
			.insert(person)
			.values({ teamId: ctx.teamId, fullName: 'Fulano ' + Math.random() })
			.returning({ id: person.id });
		return p!.id;
	}

	it('aceita papel global sem escopo', async () => {
		const personId = await pessoaQualquer();
		await expect(
			ctx.db.insert(personRole).values({
				personId,
				roleId: ctx.papeis.lider!,
				scopeType: 'global',
				scopeId: null
			})
		).resolves.toBeDefined();
	});

	it('RECUSA papel global COM escopo de grupo', async () => {
		const personId = await pessoaQualquer();
		await expect(
			ctx.db.insert(personRole).values({
				personId,
				roleId: ctx.papeis.lider!,
				scopeType: 'global',
				scopeId: '018f0000-0000-7000-8000-000000000001'
			})
		).rejects.toThrow(/coerente|check/i);
	});

	it('RECUSA papel de grupo SEM escopo — o dado corrompido que a política ignora', async () => {
		const personId = await pessoaQualquer();
		await expect(
			ctx.db.insert(personRole).values({
				personId,
				roleId: ctx.papeis.conselheiro!,
				scopeType: 'group',
				scopeId: null
			})
		).rejects.toThrow(/coerente|check/i);
	});

	it('RECUSA tipo de escopo inventado', async () => {
		const personId = await pessoaQualquer();
		await expect(
			ctx.db.insert(personRole).values({
				personId,
				roleId: ctx.papeis.membro!,
				scopeType: 'superusuario',
				scopeId: null
			})
		).rejects.toThrow(/valido|check/i);
	});
});

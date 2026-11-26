/**
 * Handlers reais que ainda não tinham teste: Pessoas (M02), Grupos (M04),
 * Início, Tipos de evento (M05), Contas e Categorias (M09) e Modelos (M08).
 *
 * Foco em autorização: a matriz líder / conselheiro de grupo / membro e o
 * isolamento entre equipes (um líder de outra equipe recebe 404, nunca o
 * dado — anti-IDOR).
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { criarBancoDeTeste, type BancoDeTeste } from './helpers/banco';
import { tokenPara } from './helpers/token';
import { setTestDatabase } from '../../src/lib/server/db';
import {
	financeCategory,
	group as groupTable,
	groupMember,
	messageTemplate,
	person as personTable,
	personProfile,
	personRole as personRoleTable,
	team as teamTable,
	userAccount as userAccountTable
} from '../../src/lib/server/db/schema';
import { hashPassword } from '../../src/lib/server/auth/password';
import { resetEnvCache } from '../../src/lib/server/env';

import * as pessoasRoute from '../../src/routes/api/pessoas/+server';
import * as pessoaMeRoute from '../../src/routes/api/pessoas/me/+server';
import * as gruposRoute from '../../src/routes/api/grupos/+server';
import * as grupoRoute from '../../src/routes/api/grupos/[id]/+server';
import * as inicioRoute from '../../src/routes/api/inicio/+server';
import * as tiposRoute from '../../src/routes/api/eventos/tipos/+server';
import * as contasRoute from '../../src/routes/api/financeiro/contas/+server';
import * as categoriaRoute from '../../src/routes/api/financeiro/categorias/[id]/+server';
import * as modeloRoute from '../../src/routes/api/comunicacao/modelos/[id]/+server';

let ctx: BancoDeTeste;
let grupo1: string;
let grupo2: string;
const id: Record<string, string> = {};
const tk: Record<string, string> = {};

function evento(
	method: string,
	path: string,
	token: string | null,
	opts: { body?: unknown; params?: Record<string, string> } = {}
) {
	return {
		request: new Request(`https://app.eagles.test${path}`, {
			method,
			headers: {
				'Content-Type': 'application/json',
				...(token ? { Authorization: `Bearer ${token}` } : {})
			},
			body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined
		}),
		params: opts.params ?? {},
		locals: {},
		url: new URL(`https://app.eagles.test${path}`),
		getClientAddress: () => '203.0.113.20'
	} as any;
}

async function criarPessoa(
	teamId: string,
	nome: string,
	papel: string,
	escopo: 'global' | 'group' | 'self',
	opts: { grupo?: string; telefone?: string } = {}
) {
	const [p] = await ctx.db
		.insert(personTable)
		.values({ teamId, fullName: nome })
		.returning({ id: personTable.id });
	if (!p) throw new Error('falha ao criar pessoa');

	await ctx.db.insert(userAccountTable).values({
		personId: p.id,
		email: `${nome.split(' ')[0]!.toLowerCase()}@eagles.test`,
		passwordHash: await hashPassword('senha12345')
	});
	await ctx.db.insert(personRoleTable).values({
		personId: p.id,
		roleId: ctx.papeis[papel]!,
		scopeType: escopo,
		scopeId: escopo === 'group' ? opts.grupo! : null
	});
	if (opts.grupo) {
		await ctx.db
			.insert(groupMember)
			.values({ groupId: opts.grupo, personId: p.id, roleKey: papel });
	}
	if (opts.telefone) {
		await ctx.db.insert(personProfile).values({ personId: p.id, phone: opts.telefone });
	}
	return p.id;
}

async function corpo(res: Response) {
	return { status: res.status, json: await res.json() };
}

describe('Pessoas, Grupos, Início, Tipos, Contas, Categorias e Modelos — autorização', () => {
	beforeAll(async () => {
		process.env.DATABASE_URL = 'postgres://teste@localhost:5432/teste';
		process.env.PUBLIC_ORIGIN = 'https://app.eagles.test';
		process.env.NODE_ENV = 'test';
		resetEnvCache();

		ctx = await criarBancoDeTeste();
		setTestDatabase(ctx.db);

		const grupos = await ctx.db
			.insert(groupTable)
			.values([
				{ teamId: ctx.teamId, name: 'PG Alpha', slug: 'pg-alpha' },
				{ teamId: ctx.teamId, name: 'PG Beta', slug: 'pg-beta' }
			])
			.returning({ id: groupTable.id });
		grupo1 = grupos[0]!.id;
		grupo2 = grupos[1]!.id;

		id.lider = await criarPessoa(ctx.teamId, 'Ana Líder', 'lider', 'global');
		id.conselheiro = await criarPessoa(ctx.teamId, 'João Conselheiro', 'conselheiro', 'group', {
			grupo: grupo1
		});
		id.membro = await criarPessoa(ctx.teamId, 'Pedro Membro', 'membro', 'self', {
			grupo: grupo1,
			telefone: '91999990001'
		});
		id.colega = await criarPessoa(ctx.teamId, 'Maria Colega', 'membro', 'self', {
			grupo: grupo1,
			telefone: '91999990002'
		});
		id.outroGrupo = await criarPessoa(ctx.teamId, 'Lucas Beta', 'membro', 'self', {
			grupo: grupo2
		});

		const [bears] = await ctx.db
			.insert(teamTable)
			.values({ slug: 'bears', name: 'Bears' })
			.returning({ id: teamTable.id });
		id.liderOutraEquipe = await criarPessoa(bears!.id, 'Bia Bears', 'lider', 'global');

		for (const [chave, pessoaId] of Object.entries(id)) {
			tk[chave] = await tokenPara(ctx.db, pessoaId);
		}
	}, 90_000);

	afterAll(async () => {
		setTestDatabase(null);
		await ctx?.fechar();
	});

	it('toda rota recusa requisição sem token', async () => {
		const sem = [
			pessoasRoute.GET(evento('GET', '/api/pessoas', null)),
			pessoaMeRoute.GET(evento('GET', '/api/pessoas/me', null)),
			gruposRoute.GET(evento('GET', '/api/grupos', null)),
			grupoRoute.GET(evento('GET', '/api/grupos/x', null, { params: { id: grupo1 } })),
			inicioRoute.GET(evento('GET', '/api/inicio', null)),
			tiposRoute.GET(evento('GET', '/api/eventos/tipos', null)),
			contasRoute.GET(evento('GET', '/api/financeiro/contas', null))
		];
		for (const res of await Promise.all(sem)) expect(res.status).toBe(401);
	});

	describe('pessoas', () => {
		it('líder vê a equipe inteira, e só a dele', async () => {
			const { status, json } = await corpo(
				await pessoasRoute.GET(evento('GET', '/api/pessoas', tk.lider!))
			);
			expect(status).toBe(200);
			const ids = json.pessoas.map((p: any) => p.id);
			expect(ids).toContain(id.outroGrupo);
			expect(ids).not.toContain(id.liderOutraEquipe);
		});

		it('conselheiro vê só o próprio grupo; membro não lista ninguém', async () => {
			const { json } = await corpo(
				await pessoasRoute.GET(evento('GET', '/api/pessoas', tk.conselheiro!))
			);
			const ids = json.pessoas.map((p: any) => p.id);
			expect(ids).toEqual(expect.arrayContaining([id.membro, id.colega]));
			expect(ids).not.toContain(id.outroGrupo);

			const membro = await pessoasRoute.GET(evento('GET', '/api/pessoas', tk.membro!));
			expect(membro.status).toBe(403);
		});

		it('filtra por grupo', async () => {
			const { json } = await corpo(
				await pessoasRoute.GET(evento('GET', `/api/pessoas?grupo=${grupo2}`, tk.lider!))
			);
			expect(json.pessoas.map((p: any) => p.id)).toEqual([id.outroGrupo]);
		});

		it('membro edita o próprio perfil mas não muda o próprio status', async () => {
			const put = await pessoaMeRoute.PUT(
				evento('PUT', '/api/pessoas/me', tk.membro!, {
					body: { telefone: '91988887777', status: 'lider' }
				})
			);
			expect(put.status).toBe(200);

			const { status, json } = await corpo(
				await pessoaMeRoute.GET(evento('GET', '/api/pessoas/me', tk.membro!))
			);
			expect(status).toBe(200);
			expect(json.id).toBe(id.membro);
			expect(json.perfil.telefone).toBe('91988887777');
			expect(json.perfil.status).toBe('visitante');
			expect(json.podeAlterarStatus).toBe(false);
		});

		it('valida o corpo do perfil', async () => {
			const res = await pessoaMeRoute.PUT(
				evento('PUT', '/api/pessoas/me', tk.membro!, { body: { email: 'nao-e-email' } })
			);
			expect(res.status).toBe(400);
		});
	});

	describe('grupos', () => {
		it('membro vê os grupos da equipe sem poder gerenciar', async () => {
			const { status, json } = await corpo(
				await gruposRoute.GET(evento('GET', '/api/grupos', tk.membro!))
			);
			expect(status).toBe(200);
			expect(json.podeGerenciar).toBe(false);
			const alpha = json.grupos.find((g: any) => g.id === grupo1);
			expect(alpha.membroCount).toBe(3);
		});

		it('só líder cria grupo; slug repetido ou inválido é recusado', async () => {
			const novo = { name: 'PG Gama', slug: 'pg-gama' };
			expect(
				(await gruposRoute.POST(evento('POST', '/api/grupos', tk.conselheiro!, { body: novo })))
					.status
			).toBe(403);

			const criado = await gruposRoute.POST(
				evento('POST', '/api/grupos', tk.lider!, { body: novo })
			);
			expect(criado.status).toBe(201);

			expect(
				(await gruposRoute.POST(evento('POST', '/api/grupos', tk.lider!, { body: novo }))).status
			).toBe(400);
			expect(
				(
					await gruposRoute.POST(
						evento('POST', '/api/grupos', tk.lider!, { body: { name: 'X', slug: 'Com Espaço' } })
					)
				).status
			).toBe(400);
		});

		it('detalhe: telefone dos outros só para quem tem view_sensitive', async () => {
			const params = { id: grupo1 };
			const membro = await corpo(
				await grupoRoute.GET(evento('GET', `/api/grupos/${grupo1}`, tk.membro!, { params }))
			);
			expect(membro.status).toBe(200);
			const colegaVistoPorMembro = membro.json.membros.find((m: any) => m.id === id.colega);
			expect(colegaVistoPorMembro.telefone).toBeNull();
			const euMesmo = membro.json.membros.find((m: any) => m.id === id.membro);
			expect(euMesmo.telefone).not.toBeNull();

			const conselheiro = await corpo(
				await grupoRoute.GET(evento('GET', `/api/grupos/${grupo1}`, tk.conselheiro!, { params }))
			);
			const colegaVistoPorConselheiro = conselheiro.json.membros.find(
				(m: any) => m.id === id.colega
			);
			expect(colegaVistoPorConselheiro.telefone).toBe('91999990002');
		});

		it('id inválido é 400; grupo de outra equipe é 404', async () => {
			expect(
				(
					await grupoRoute.GET(
						evento('GET', '/api/grupos/abc', tk.lider!, { params: { id: 'abc' } })
					)
				).status
			).toBe(400);
			expect(
				(
					await grupoRoute.GET(
						evento('GET', `/api/grupos/${grupo1}`, tk.liderOutraEquipe!, {
							params: { id: grupo1 }
						})
					)
				).status
			).toBe(404);
		});
	});

	it('início devolve nome e papéis da própria pessoa', async () => {
		const { status, json } = await corpo(
			await inicioRoute.GET(evento('GET', '/api/inicio', tk.membro!))
		);
		expect(status).toBe(200);
		expect(json.nome).toBe('Pedro Membro');
		expect(json.papeis).toEqual(['membro']);
		expect(json.permissoes).not.toContain('finance.view_all');
	});

	describe('tipos de evento', () => {
		it('membro lista; só quem gerencia eventos cria; repetido e cor inválida são 400', async () => {
			expect((await tiposRoute.GET(evento('GET', '/api/eventos/tipos', tk.membro!))).status).toBe(
				200
			);

			const tipo = { name: 'Culto', slug: 'culto', color: '#112233' };
			expect(
				(await tiposRoute.POST(evento('POST', '/api/eventos/tipos', tk.membro!, { body: tipo })))
					.status
			).toBe(403);
			expect(
				(await tiposRoute.POST(evento('POST', '/api/eventos/tipos', tk.lider!, { body: tipo })))
					.status
			).toBe(201);
			expect(
				(await tiposRoute.POST(evento('POST', '/api/eventos/tipos', tk.lider!, { body: tipo })))
					.status
			).toBe(400);
			expect(
				(
					await tiposRoute.POST(
						evento('POST', '/api/eventos/tipos', tk.lider!, {
							body: { name: 'Vigília', slug: 'vigilia', color: 'vermelho' }
						})
					)
				).status
			).toBe(400);

			const lista = await corpo(
				await tiposRoute.GET(evento('GET', '/api/eventos/tipos', tk.lider!))
			);
			expect(lista.json.tipos.map((t: any) => t.slug)).toContain('culto');
		});
	});

	describe('financeiro: contas e categorias', () => {
		it('contas: membro não vê; conselheiro vê mas não cria; líder cria uma vez', async () => {
			expect(
				(await contasRoute.GET(evento('GET', '/api/financeiro/contas', tk.membro!))).status
			).toBe(403);
			expect(
				(await contasRoute.GET(evento('GET', '/api/financeiro/contas', tk.conselheiro!))).status
			).toBe(200);

			const conta = { name: 'Caixa principal', kind: 'pix' };
			expect(
				(
					await contasRoute.POST(
						evento('POST', '/api/financeiro/contas', tk.conselheiro!, { body: conta })
					)
				).status
			).toBe(403);
			expect(
				(
					await contasRoute.POST(
						evento('POST', '/api/financeiro/contas', tk.lider!, { body: conta })
					)
				).status
			).toBe(201);
			expect(
				(
					await contasRoute.POST(
						evento('POST', '/api/financeiro/contas', tk.lider!, { body: conta })
					)
				).status
			).toBe(400);

			const lista = await corpo(
				await contasRoute.GET(evento('GET', '/api/financeiro/contas', tk.lider!))
			);
			expect(lista.json.contas.map((c: any) => c.name)).toContain('Caixa principal');
		});

		it('categoria: só líder edita e desativa; outra equipe recebe 404', async () => {
			const [cat] = await ctx.db
				.insert(financeCategory)
				.values({ teamId: ctx.teamId, name: 'Ofertas', slug: 'ofertas', kind: 'entrada' })
				.returning({ id: financeCategory.id });
			const params = { id: cat!.id };
			const caminho = `/api/financeiro/categorias/${cat!.id}`;

			expect(
				(
					await categoriaRoute.PUT(
						evento('PUT', caminho, tk.conselheiro!, { params, body: { name: 'Dízimos' } })
					)
				).status
			).toBe(403);
			expect(
				(
					await categoriaRoute.PUT(
						evento('PUT', caminho, tk.liderOutraEquipe!, { params, body: { name: 'Dízimos' } })
					)
				).status
			).toBe(404);

			const ok = await corpo(
				await categoriaRoute.PUT(
					evento('PUT', caminho, tk.lider!, { params, body: { name: 'Ofertas especiais' } })
				)
			);
			expect(ok.status).toBe(200);
			expect(ok.json.categoria.name).toBe('Ofertas especiais');

			expect(
				(
					await categoriaRoute.DELETE(
						evento('DELETE', '/api/financeiro/categorias/x', tk.lider!, { params: { id: 'x' } })
					)
				).status
			).toBe(400);
			expect(
				(await categoriaRoute.DELETE(evento('DELETE', caminho, tk.lider!, { params }))).status
			).toBe(200);

			const [depois] = await ctx.db
				.select({ active: financeCategory.active })
				.from(financeCategory)
				.where(eq(financeCategory.id, cat!.id));
			expect(depois?.active).toBe(false);
		});
	});

	describe('comunicação: modelos', () => {
		it('conselheiro edita e desativa; membro não; outra equipe recebe 404', async () => {
			const [modelo] = await ctx.db
				.insert(messageTemplate)
				.values({ teamId: ctx.teamId, name: 'Lembrete', content: 'Oi {{nome}}!' })
				.returning({ id: messageTemplate.id });
			const params = { id: modelo!.id };
			const caminho = `/api/comunicacao/modelos/${modelo!.id}`;
			const body = { content: 'Olá {{nome}}, até quinta!' };

			expect(
				(await modeloRoute.PUT(evento('PUT', caminho, tk.membro!, { params, body }))).status
			).toBe(403);
			expect(
				(await modeloRoute.PUT(evento('PUT', caminho, tk.liderOutraEquipe!, { params, body })))
					.status
			).toBe(404);

			const ok = await corpo(
				await modeloRoute.PUT(evento('PUT', caminho, tk.conselheiro!, { params, body }))
			);
			expect(ok.status).toBe(200);
			expect(ok.json.modelo.content).toBe(body.content);

			expect(
				(
					await modeloRoute.PUT(
						evento('PUT', caminho, tk.conselheiro!, { params, body: { category: 'spam' } })
					)
				).status
			).toBe(400);

			expect(
				(await modeloRoute.DELETE(evento('DELETE', caminho, tk.conselheiro!, { params }))).status
			).toBe(200);
			const [depois] = await ctx.db
				.select({ active: messageTemplate.active })
				.from(messageTemplate)
				.where(eq(messageTemplate.id, modelo!.id));
			expect(depois?.active).toBe(false);
		});
	});
});

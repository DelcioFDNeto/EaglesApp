/**
 * Cadastro progressivo (RF-02.1) e convite de acesso (RF-01.2, ADR 0004)
 * contra PGlite, pelos handlers reais.
 *
 * O caminho que importa: o conselheiro cadastra alguém no próprio PG só com
 * nome e telefone, gera o convite, a pessoa define a senha pelo link e entra
 * digitando o telefone do jeito que quiser.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { criarBancoDeTeste, type BancoDeTeste } from './helpers/banco';
import { tokenPara } from './helpers/token';
import { setTestDatabase } from '../../src/lib/server/db';
import {
	group as groupTable,
	groupMember,
	person as personTable,
	personRole as personRoleTable,
	team as teamTable,
	userAccount
} from '../../src/lib/server/db/schema';
import { hashPassword } from '../../src/lib/server/auth/password';
import { resetRateLimits } from '../../src/lib/server/auth/ratelimit';
import { resetEnvCache } from '../../src/lib/server/env';

import * as pessoasRoute from '../../src/routes/api/pessoas/+server';
import * as conviteRoute from '../../src/routes/api/pessoas/[id]/convite/+server';
import * as aceiteRoute from '../../src/routes/api/auth/convite/[token]/+server';
import * as loginRoute from '../../src/routes/api/auth/login/+server';

let ctx: BancoDeTeste;
let grupo1: string;
let grupo2: string;
const id: Record<string, string> = {};
const tk: Record<string, string> = {};

const SENHA = 'uma senha longa e boa';

function evento(
	method: string,
	path: string,
	token: string | null,
	opts: { body?: unknown; params?: Record<string, string> } = {}
) {
	return {
		request: new Request(`https://api.eagles.test${path}`, {
			method,
			headers: {
				'Content-Type': 'application/json',
				...(token ? { Authorization: `Bearer ${token}` } : {})
			},
			body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined
		}),
		params: opts.params ?? {},
		locals: {},
		url: new URL(`https://api.eagles.test${path}`),
		getClientAddress: () => '203.0.113.40'
	} as any;
}

async function criarComPapel(teamId: string, nome: string, papel: string, grupo?: string) {
	const [p] = await ctx.db
		.insert(personTable)
		.values({ teamId, fullName: nome })
		.returning({ id: personTable.id });
	await ctx.db.insert(userAccount).values({
		personId: p!.id,
		email: `${nome.split(' ')[0]!.toLowerCase()}@eagles.test`,
		passwordHash: await hashPassword('senha12345')
	});
	await ctx.db.insert(personRoleTable).values({
		personId: p!.id,
		roleId: ctx.papeis[papel]!,
		scopeType: papel === 'lider' ? 'global' : papel === 'conselheiro' ? 'group' : 'self',
		scopeId: papel === 'conselheiro' ? grupo! : null
	});
	if (grupo) {
		await ctx.db.insert(groupMember).values({ groupId: grupo, personId: p!.id, roleKey: papel });
	}
	return p!.id;
}

const cadastrar = (token: string, body: unknown) =>
	pessoasRoute.POST(evento('POST', '/api/pessoas', token, { body }));

const convidar = (token: string, personId: string, body?: unknown) =>
	conviteRoute.POST(
		evento('POST', `/api/pessoas/${personId}/convite`, token, { params: { id: personId }, body })
	);

async function listar(token: string) {
	const res = await pessoasRoute.GET(evento('GET', '/api/pessoas', token));
	return res.json();
}

const tokenDoLink = (url: string) => url.split('/convite/')[1]!;

describe('cadastro de pessoas e convite de acesso', () => {
	beforeAll(async () => {
		process.env.DATABASE_URL = 'postgres://teste@localhost:5432/teste';
		process.env.PUBLIC_ORIGIN = 'https://eagles.web.app';
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

		id.lider = await criarComPapel(ctx.teamId, 'Ana Líder', 'lider');
		id.conselheiro = await criarComPapel(ctx.teamId, 'João Conselheiro', 'conselheiro', grupo1);
		id.membro = await criarComPapel(ctx.teamId, 'Pedro Membro', 'membro', grupo1);

		const [bears] = await ctx.db
			.insert(teamTable)
			.values({ slug: 'bears', name: 'Bears' })
			.returning({ id: teamTable.id });
		id.liderOutraEquipe = await criarComPapel(bears!.id, 'Bia Bears', 'lider');

		for (const [chave, pessoaId] of Object.entries(id)) {
			tk[chave] = await tokenPara(ctx.db, pessoaId);
		}
	}, 90_000);

	afterAll(async () => {
		setTestDatabase(null);
		await ctx?.fechar();
	});

	beforeEach(() => resetRateLimits());

	describe('cadastro', () => {
		it('membro não cadastra; conselheiro só no próprio PG e precisa escolher o grupo', async () => {
			expect((await cadastrar(tk.membro!, { nome: 'Fulano', grupoId: grupo1 })).status).toBe(403);
			expect((await cadastrar(tk.conselheiro!, { nome: 'Fulano', grupoId: grupo2 })).status).toBe(
				403
			);
			const semGrupo = await cadastrar(tk.conselheiro!, { nome: 'Fulano' });
			expect(semGrupo.status).toBe(403);
			expect((await semGrupo.json()).campo).toBe('grupoId');
		});

		it('só o nome é obrigatório (líder, sem grupo)', async () => {
			const res = await cadastrar(tk.lider!, { nome: 'Visitante Sem Contato' });
			expect(res.status).toBe(201);
			id.semContato = (await res.json()).pessoa.id;

			const [conta] = await ctx.db
				.select()
				.from(userAccount)
				.where(eq(userAccount.personId, id.semContato!));
			expect(conta).toBeUndefined();
		});

		it('valida nome e telefone, e recusa contato que já é login de outra pessoa', async () => {
			expect((await cadastrar(tk.lider!, { nome: 'X' })).status).toBe(400);

			const telefoneRuim = await cadastrar(tk.lider!, { nome: 'Fulano', telefone: '123' });
			expect(telefoneRuim.status).toBe(400);
			expect((await telefoneRuim.json()).campo).toBe('telefone');

			const emailRepetido = await cadastrar(tk.lider!, {
				nome: 'Fulano',
				email: 'ANA@eagles.test'
			});
			expect(emailRepetido.status).toBe(409);
			expect((await emailRepetido.json()).codigo).toBe('contato_em_uso');
		});

		it('outra equipe não enxerga o grupo', async () => {
			const res = await cadastrar(tk.liderOutraEquipe!, { nome: 'Intruso', grupoId: grupo1 });
			expect(res.status).toBe(404);
		});
	});

	describe('fluxo completo: conselheiro cadastra → convida → pessoa entra pelo telefone', () => {
		it('percorre o caminho de um novo membro', async () => {
			// 1. Cadastro com o telefone digitado de qualquer jeito
			const criado = await cadastrar(tk.conselheiro!, {
				nome: 'Carla Nova',
				telefone: '+55 (91) 98888-1111',
				grupoId: grupo1
			});
			expect(criado.status).toBe(201);
			const carlaId = (await criado.json()).pessoa.id;

			// O telefone duplicado agora é barrado
			expect(
				(await cadastrar(tk.lider!, { nome: 'Outra Carla', telefone: '91988881111' })).status
			).toBe(409);

			// 2. Na lista: sem acesso, com contato, convidável pelo conselheiro
			const lista = await listar(tk.conselheiro!);
			expect(lista.podeCadastrar).toBe(true);
			expect(lista.gruposParaCadastro).toEqual([{ id: grupo1, nome: 'PG Alpha' }]);
			const carla = lista.pessoas.find((p: any) => p.id === carlaId);
			expect(carla).toMatchObject({
				acesso: 'sem_acesso',
				temContato: true,
				podeConvidar: true,
				grupo: 'PG Alpha'
			});

			// 3. Convite: link, login e WhatsApp já na conversa dela
			const convite = await convidar(tk.conselheiro!, carlaId);
			expect(convite.status).toBe(201);
			const dados = await convite.json();
			expect(dados.url.startsWith('https://eagles.web.app/convite/')).toBe(true);
			expect(dados.login).toEqual({ tipo: 'telefone', valor: '(91) 98888-1111' });
			expect(dados.whatsapp.startsWith('https://wa.me/5591988881111?text=')).toBe(true);
			expect(decodeURIComponent(dados.whatsapp)).toContain(dados.url);
			expect(dados.mensagem).toContain('Oi, Carla!');

			expect(
				(await listar(tk.conselheiro!)).pessoas.find((p: any) => p.id === carlaId).acesso
			).toBe('convidado');

			// 4. A pessoa abre o link: vê o nome e com o que vai entrar
			const token = tokenDoLink(dados.url);
			const ver = await aceiteRoute.GET(evento('GET', '/x', null, { params: { token } }));
			expect(await ver.json()).toEqual({
				estado: 'valido',
				nome: 'Carla Nova',
				login: { tipo: 'telefone', valor: '(91) 98888-1111' }
			});

			const aceite = await aceiteRoute.POST(
				evento('POST', '/x', null, {
					params: { token },
					body: { senha: SENHA, confirmacao: SENHA }
				})
			);
			expect(aceite.status).toBe(201);

			// 5. Entra digitando o telefone num formato diferente do cadastro
			for (const identificador of ['91 98888-1111', '+5591988881111']) {
				const login = await loginRoute.POST(
					evento('POST', '/api/auth/login', null, { body: { identificador, senha: SENHA } })
				);
				expect(login.status, identificador).toBe(200);
			}

			// 6. Agora tem acesso: some o "Convidar" e o reenvio é recusado
			const depois = (await listar(tk.conselheiro!)).pessoas.find((p: any) => p.id === carlaId);
			expect(depois).toMatchObject({ acesso: 'ativo', podeConvidar: false });
			const deNovo = await convidar(tk.conselheiro!, carlaId);
			expect(deNovo.status).toBe(409);
			expect((await deNovo.json()).codigo).toBe('ja_tem_acesso');
		});
	});

	describe('convite', () => {
		it('sem contato, pede o telefone; com ele, grava o login e convida', async () => {
			const sem = await convidar(tk.lider!, id.semContato!);
			expect(sem.status).toBe(400);
			expect((await sem.json()).codigo).toBe('sem_contato');

			const com = await convidar(tk.lider!, id.semContato!, { telefone: '(91) 97777-2222' });
			expect(com.status).toBe(201);
			expect((await com.json()).login.valor).toBe('(91) 97777-2222');

			const [conta] = await ctx.db
				.select({ phone: userAccount.phone, senha: userAccount.passwordHash })
				.from(userAccount)
				.where(eq(userAccount.personId, id.semContato!));
			expect(conta).toEqual({ phone: '91977772222', senha: null });
		});

		it('reenviar revoga o link anterior', async () => {
			const primeiro = await (await convidar(tk.lider!, id.semContato!)).json();
			const segundo = await (await convidar(tk.lider!, id.semContato!)).json();
			expect(segundo.url).not.toBe(primeiro.url);

			const velho = await aceiteRoute.GET(
				evento('GET', '/x', null, { params: { token: tokenDoLink(primeiro.url) } })
			);
			expect((await velho.json()).estado).toBe('invalido');
			const novo = await aceiteRoute.GET(
				evento('GET', '/x', null, { params: { token: tokenDoLink(segundo.url) } })
			);
			expect((await novo.json()).estado).toBe('valido');
		});

		it('matriz: membro não convida; conselheiro só no próprio PG; outra equipe recebe 404', async () => {
			const noBeta = await cadastrar(tk.lider!, {
				nome: 'Lucas Beta',
				telefone: '91966663333',
				grupoId: grupo2
			});
			const lucasId = (await noBeta.json()).pessoa.id;

			expect((await convidar(tk.membro!, lucasId)).status).toBe(403);
			expect((await convidar(tk.conselheiro!, lucasId)).status).toBe(403);
			expect((await convidar(tk.liderOutraEquipe!, lucasId)).status).toBe(404);
			expect((await convidar(tk.lider!, lucasId)).status).toBe(201);

			const lucasVistoPeloLider = (await listar(tk.lider!)).pessoas.find(
				(p: any) => p.id === lucasId
			);
			expect(lucasVistoPeloLider.acesso).toBe('convidado');
			const listaDoConselheiro = await listar(tk.conselheiro!);
			expect(listaDoConselheiro.pessoas.some((p: any) => p.id === lucasId)).toBe(false);
		});

		it('recusa id inválido, sem token e convite para si mesmo', async () => {
			expect((await convidar(tk.lider!, 'abc')).status).toBe(400);
			expect(
				(await conviteRoute.POST(evento('POST', '/x', null, { params: { id: id.membro! } }))).status
			).toBe(401);
			expect((await convidar(tk.lider!, id.lider!)).status).toBe(400);
		});
	});
});

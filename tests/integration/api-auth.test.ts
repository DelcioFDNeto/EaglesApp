/**
 * Handlers reais de autenticação (M01) contra PGlite.
 *
 * Cobre o que o frontend estático usa para entrar e sair: login (com rate
 * limit), identidade, logout e revogação de sessões com efeito imediato no
 * JWT, aceite de convite, redefinição de senha, solicitação de cadastro e
 * health. O e-mail é simulado: o teste captura o link em vez de enviar.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { criarBancoDeTeste, type BancoDeTeste } from './helpers/banco';
import { setTestDatabase } from '../../src/lib/server/db';
import {
	cadastroPendente,
	person as personTable,
	personRole as personRoleTable,
	senhaReset,
	userAccount as userAccountTable
} from '../../src/lib/server/db/schema';
import { hashPassword } from '../../src/lib/server/auth/password';
import { issueInvite } from '../../src/lib/server/auth/invite';
import { resetRateLimits } from '../../src/lib/server/auth/ratelimit';
import { resetEnvCache } from '../../src/lib/server/env';

const enviarEmailReset = vi.hoisted(() => vi.fn(async (_para: string, _link: string) => {}));
vi.mock('../../src/lib/server/auth/email', () => ({ enviarEmailReset }));

import * as loginRoute from '../../src/routes/api/auth/login/+server';
import * as meRoute from '../../src/routes/api/auth/me/+server';
import * as logoutRoute from '../../src/routes/api/auth/logout/+server';
import * as conviteRoute from '../../src/routes/api/auth/convite/[token]/+server';
import * as esqueciRoute from '../../src/routes/api/auth/esqueci-senha/+server';
import * as resetarRoute from '../../src/routes/api/auth/resetar-senha/+server';
import * as cadastroRoute from '../../src/routes/api/auth/solicitar-cadastro/+server';
import * as sessoesRoute from '../../src/routes/api/sessoes/+server';
import * as revogarRoute from '../../src/routes/api/sessoes/revogar-outras/+server';
import * as healthRoute from '../../src/routes/api/health/+server';

let ctx: BancoDeTeste;
let liderId: string;

const SENHA = 'uma frase longa e secreta';

function evento(
	method: string,
	path: string,
	opts: { token?: string; body?: unknown; params?: Record<string, string>; ip?: string } = {}
) {
	return {
		request: new Request(`https://app.eagles.test${path}`, {
			method,
			headers: {
				'Content-Type': 'application/json',
				'User-Agent': 'Mozilla/5.0 (Linux; Android 14)',
				...(opts.token ? { Authorization: `Bearer ${opts.token}` } : {})
			},
			body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined
		}),
		params: opts.params ?? {},
		locals: {},
		url: new URL(`https://app.eagles.test${path}`),
		getClientAddress: () => opts.ip ?? '203.0.113.10'
	} as any;
}

async function criarPessoa(nome: string, email: string | null, senha: string | null) {
	const [p] = await ctx.db
		.insert(personTable)
		.values({ teamId: ctx.teamId, fullName: nome })
		.returning({ id: personTable.id });
	if (!p) throw new Error('falha ao criar pessoa');

	if (email) {
		await ctx.db.insert(userAccountTable).values({
			personId: p.id,
			email,
			passwordHash: senha ? await hashPassword(senha) : null
		});
	}

	await ctx.db
		.insert(personRoleTable)
		.values({ personId: p.id, roleId: ctx.papeis.membro!, scopeType: 'self', scopeId: null });

	return p.id;
}

async function entrar(identificador: string, senha: string, ip?: string) {
	const res = await loginRoute.POST(
		evento('POST', '/api/auth/login', { body: { identificador, senha }, ip })
	);
	return { status: res.status, corpo: await res.json() };
}

async function statusDoMe(token: string) {
	return (await meRoute.GET(evento('GET', '/api/auth/me', { token }))).status;
}

describe('M01 — autenticação via API (JWT + sessão no banco)', () => {
	beforeAll(async () => {
		process.env.DATABASE_URL = 'postgres://teste@localhost:5432/teste';
		process.env.PUBLIC_ORIGIN = 'https://app.eagles.test';
		process.env.NODE_ENV = 'test';
		resetEnvCache();

		ctx = await criarBancoDeTeste();
		setTestDatabase(ctx.db);

		liderId = await criarPessoa('Ana Líder', 'ana@eagles.test', SENHA);
	}, 60_000);

	afterAll(async () => {
		setTestDatabase(null);
		await ctx?.fechar();
	});

	beforeEach(() => {
		resetRateLimits();
		enviarEmailReset.mockClear();
	});

	describe('login, identidade e logout', () => {
		it('entra com e-mail (sem diferenciar maiúsculas) e o token identifica a pessoa', async () => {
			const { status, corpo } = await entrar('ANA@eagles.test', SENHA);
			expect(status).toBe(200);
			expect(corpo.pessoa.id).toBe(liderId);

			const me = await meRoute.GET(evento('GET', '/api/auth/me', { token: corpo.token }));
			expect(me.status).toBe(200);
			expect((await me.json()).pessoa.id).toBe(liderId);
		});

		it('recusa senha errada e corpo inválido sem revelar o motivo', async () => {
			expect((await entrar('ana@eagles.test', 'senha errada demais')).status).toBe(401);
			expect((await entrar('ninguem@eagles.test', SENHA)).status).toBe(401);
			expect((await entrar('', '')).status).toBe(400);
		});

		it('bloqueia a conta após 5 tentativas, antes de chegar ao hash', async () => {
			for (let i = 0; i < 5; i++) {
				expect((await entrar('alvo@eagles.test', 'chute', `198.51.100.${i}`)).status).toBe(401);
			}
			// Mesmo vindo de outro IP e com a senha certa: o limite é da conta.
			expect((await entrar('alvo@eagles.test', SENHA, '198.51.100.99')).status).toBe(429);
		});

		it('logout revoga a sessão: o MESMO JWT deixa de valer na hora', async () => {
			const { corpo } = await entrar('ana@eagles.test', SENHA);
			expect(await statusDoMe(corpo.token)).toBe(200);

			const sair = await logoutRoute.POST(
				evento('POST', '/api/auth/logout', { token: corpo.token })
			);
			expect(sair.status).toBe(200);

			expect(await statusDoMe(corpo.token)).toBe(401);
		});

		it('recusa token sem sessão, com assinatura falsa ou ausente', async () => {
			expect(await statusDoMe('nao-e-um-jwt')).toBe(401);
			expect((await meRoute.GET(evento('GET', '/api/auth/me'))).status).toBe(401);
			// Logout sem token é idempotente.
			expect((await logoutRoute.POST(evento('POST', '/api/auth/logout'))).status).toBe(200);
		});
	});

	describe('sessões', () => {
		it('lista os aparelhos e "desconectar outros" derruba só os outros', async () => {
			const celular = (await entrar('ana@eagles.test', SENHA)).corpo.token;
			const computador = (await entrar('ana@eagles.test', SENHA)).corpo.token;

			const lista = await sessoesRoute.GET(evento('GET', '/api/sessoes', { token: celular }));
			expect(lista.status).toBe(200);
			const sessoes = await lista.json();
			expect(sessoes.length).toBeGreaterThanOrEqual(2);
			expect(sessoes.filter((s: any) => s.atual)).toHaveLength(1);
			expect(sessoes[0].aparelho).toBe('Celular Android');

			const rev = await revogarRoute.POST(
				evento('POST', '/api/sessoes/revogar-outras', { token: celular })
			);
			expect(rev.status).toBe(200);
			expect((await rev.json()).revogadas).toBeGreaterThanOrEqual(1);

			expect(await statusDoMe(celular)).toBe(200);
			expect(await statusDoMe(computador)).toBe(401);
		});

		it('exige autenticação', async () => {
			expect((await sessoesRoute.GET(evento('GET', '/api/sessoes'))).status).toBe(401);
			expect((await revogarRoute.POST(evento('POST', '/api/sessoes/revogar-outras'))).status).toBe(
				401
			);
		});
	});

	describe('convite', () => {
		it('mostra o nome, valida a senha, cria o acesso e não aceita o link de novo', async () => {
			const convidadoId = await criarPessoa('Bruno Convidado', null, null);
			const { token: conviteToken } = await issueInvite(ctx.db, {
				teamId: ctx.teamId,
				personId: convidadoId,
				createdByPersonId: liderId
			});
			const caminho = `/api/auth/convite/${conviteToken}`;
			const params = { token: conviteToken };

			const ver = await conviteRoute.GET(evento('GET', caminho, { params }));
			expect(await ver.json()).toEqual({ estado: 'valido', nome: 'Bruno Convidado' });

			const diferentes = await conviteRoute.POST(
				evento('POST', caminho, { params, body: { senha: SENHA, confirmacao: 'outra coisa' } })
			);
			expect(diferentes.status).toBe(400);
			expect((await diferentes.json()).erros.confirmacao).toBeTruthy();

			const fraca = await conviteRoute.POST(
				evento('POST', caminho, { params, body: { senha: '123', confirmacao: '123' } })
			);
			expect(fraca.status).toBe(400);
			expect((await fraca.json()).erros.senha).toBeTruthy();

			const aceito = await conviteRoute.POST(
				evento('POST', caminho, { params, body: { senha: SENHA, confirmacao: SENHA } })
			);
			expect(aceito.status).toBe(201);
			const { token } = await aceito.json();
			expect(await statusDoMe(token)).toBe(200);

			const deNovo = await conviteRoute.GET(evento('GET', caminho, { params }));
			expect((await deNovo.json()).estado).toBe('invalido');
		});

		it('recusa token inventado', async () => {
			const res = await conviteRoute.GET(
				evento('GET', '/api/auth/convite/xyz', { params: { token: 'xyz' } })
			);
			expect((await res.json()).estado).toBe('invalido');
		});
	});

	describe('redefinição de senha', () => {
		const pedir = (email: unknown, ip?: string) =>
			esqueciRoute.POST(evento('POST', '/api/auth/esqueci-senha', { body: { email }, ip }));
		const redefinir = (token: string, novaSenha: string) =>
			resetarRoute.POST(evento('POST', '/api/auth/resetar-senha', { body: { token, novaSenha } }));

		it('responde igual para e-mail com e sem conta e só envia para quem tem', async () => {
			const semConta = await pedir('ninguem@eagles.test');
			const comConta = await pedir('carla@eagles.test');
			expect(semConta.status).toBe(200);
			expect(await semConta.json()).toEqual(await comConta.json());
			expect(enviarEmailReset).not.toHaveBeenCalled();

			expect((await pedir('isto nao e email')).status).toBe(400);
			expect((await pedir(undefined)).status).toBe(400);
		});

		it('fluxo completo: link por e-mail → nova senha → sessões antigas caem → link não reutiliza', async () => {
			const carlaId = await criarPessoa('Carla Souza', 'Carla@Eagles.test', SENHA);
			const antiga = (await entrar('carla@eagles.test', SENHA)).corpo.token;

			expect((await pedir('carla@eagles.test')).status).toBe(200);
			expect(enviarEmailReset).toHaveBeenCalledTimes(1);
			const [para, link] = enviarEmailReset.mock.calls[0]!;
			expect(para).toBe('Carla@Eagles.test');
			expect(link.startsWith('https://app.eagles.test/resetar-senha?token=')).toBe(true);
			const token = new URL(link).searchParams.get('token')!;

			// O banco guarda o hash, não o token do link.
			const [linha] = await ctx.db
				.select({ token: senhaReset.token, personId: senhaReset.personId })
				.from(senhaReset)
				.where(eq(senhaReset.personId, carlaId));
			expect(linha?.token).not.toBe(token);

			// Senha fraca é recusada e NÃO queima o link.
			const fraca = await redefinir(token, '123');
			expect(fraca.status).toBe(400);

			const nova = 'outra frase longa e secreta';
			const ok = await redefinir(token, nova);
			expect(ok.status).toBe(200);

			expect(await statusDoMe(antiga)).toBe(401);
			expect((await entrar('carla@eagles.test', SENHA)).status).toBe(401);
			expect((await entrar('carla@eagles.test', nova)).status).toBe(200);

			expect((await redefinir(token, 'mais uma frase secreta')).status).toBe(400);
		});

		it('recusa token inventado e corpo inválido', async () => {
			expect((await redefinir('inventado', 'uma senha qualquer longa')).status).toBe(400);
			const semCorpo = await resetarRoute.POST(evento('POST', '/api/auth/resetar-senha'));
			expect(semCorpo.status).toBe(400);
		});

		it('limita pedidos por IP', async () => {
			for (let i = 0; i < 5; i++) {
				expect((await pedir(`p${i}@eagles.test`, '192.0.2.50')).status).toBe(200);
			}
			expect((await pedir('p9@eagles.test', '192.0.2.50')).status).toBe(429);
		});
	});

	describe('solicitação de cadastro', () => {
		const solicitar = (body: unknown) =>
			cadastroRoute.POST(evento('POST', '/api/auth/solicitar-cadastro', { body }));

		it('registra o pedido uma vez, mesmo enviado duas vezes', async () => {
			const corpo = { nome: 'Diego Novo', email: 'Diego@Eagles.test', telefone: '' };
			const primeiro = await solicitar(corpo);
			expect(primeiro.status).toBe(200);
			expect((await primeiro.json()).ok).toBe(true);
			expect((await solicitar(corpo)).status).toBe(200);

			const linhas = await ctx.db
				.select()
				.from(cadastroPendente)
				.where(eq(cadastroPendente.email, 'diego@eagles.test'));
			expect(linhas).toHaveLength(1);
			expect(linhas[0]?.telefone).toBeNull();
		});

		it('valida os campos em vez de estourar no banco', async () => {
			expect((await solicitar({ nome: 'Ed' })).status).toBe(400);
			expect((await solicitar({ nome: 'Ed Silva', email: 'x' })).status).toBe(400);
			expect((await solicitar(null)).status).toBe(400);
		});
	});

	it('health responde sem credencial e sem expor dados', async () => {
		const res = await healthRoute.GET(evento('GET', '/api/health'));
		expect(res.status).toBe(200);
		const corpo = await res.json();
		expect(corpo.status).toBe('ok');
		expect(Object.keys(corpo).sort()).toEqual(['banco', 'latenciaMs', 'status']);
	});
});

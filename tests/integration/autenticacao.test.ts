/**
 * Fluxo de acesso ponta a ponta, contra Postgres real.
 *
 * Cobre o caminho que toda pessoa dos Eagles vai percorrer uma vez:
 * convite emitido pelo conselheiro → link → senha → sessão → revogação.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { criarBancoDeTeste, type BancoDeTeste } from './helpers/banco';
import { person, personRole, userAccount } from '../../src/lib/server/db/schema';
import { consumeInvite, issueInvite, lookupInvite } from '../../src/lib/server/auth/invite';
import { hashPassword, verifyPassword } from '../../src/lib/server/auth/password';
import {
	createSession,
	revokeOtherSessions,
	revokeSession,
	validateSession
} from '../../src/lib/server/auth/session';
import { loadActor } from '../../src/lib/server/policy/actor';
import { can } from '../../src/lib/server/policy/policy';
import { resetEnvCache } from '../../src/lib/server/env';

let ctx: BancoDeTeste;

beforeAll(async () => {
	process.env.DATABASE_URL = 'postgres://teste@localhost:5432/teste';
	process.env.PUBLIC_ORIGIN = 'https://app.eagles.test';
	process.env.NODE_ENV = 'test';
	resetEnvCache();

	ctx = await criarBancoDeTeste();
}, 60_000);

afterAll(async () => {
	await ctx?.fechar();
});

async function criarPessoa(nome: string): Promise<string> {
	const [p] = await ctx.db
		.insert(person)
		.values({ teamId: ctx.teamId, fullName: nome })
		.returning({ id: person.id });
	return p!.id;
}

describe('convite', () => {
	let conselheiroId: string;

	beforeEach(async () => {
		conselheiroId = await criarPessoa('Conselheiro Pedro');
	});

	it('emite convite com link e validade', async () => {
		const pessoaId = await criarPessoa('Marina Souza');

		const convite = await issueInvite(ctx.db, {
			teamId: ctx.teamId,
			personId: pessoaId,
			createdByPersonId: conselheiroId
		});

		expect(convite.url).toContain('https://app.eagles.test/convite/');
		expect(convite.expiresAt.getTime()).toBeGreaterThan(Date.now());
	});

	it('resolve o token e devolve o nome da pessoa', async () => {
		const pessoaId = await criarPessoa('João Batista');
		const { token } = await issueInvite(ctx.db, {
			teamId: ctx.teamId,
			personId: pessoaId,
			createdByPersonId: conselheiroId
		});

		const resultado = await lookupInvite(ctx.db, token);
		expect(resultado.ok).toBe(true);
		if (resultado.ok) {
			expect(resultado.fullName).toBe('João Batista');
			expect(resultado.personId).toBe(pessoaId);
		}
	});

	it('recusa token inexistente sem vazar nada', async () => {
		const r = await lookupInvite(ctx.db, 'a'.repeat(43));
		expect(r).toEqual({ ok: false, reason: 'inexistente' });
	});

	it('recusa token curto sem consultar o banco', async () => {
		expect(await lookupInvite(ctx.db, 'curto')).toEqual({ ok: false, reason: 'inexistente' });
		expect(await lookupInvite(ctx.db, '')).toEqual({ ok: false, reason: 'inexistente' });
	});

	it('só pode ser consumido UMA vez — a proteção contra clique duplo', async () => {
		const pessoaId = await criarPessoa('Clara Dupla');
		const { token } = await issueInvite(ctx.db, {
			teamId: ctx.teamId,
			personId: pessoaId,
			createdByPersonId: conselheiroId
		});

		const encontrado = await lookupInvite(ctx.db, token);
		expect(encontrado.ok).toBe(true);
		if (!encontrado.ok) return;

		// Dois envios simultâneos: exatamente um vence.
		const [primeiro, segundo] = await Promise.all([
			consumeInvite(ctx.db, encontrado.inviteId),
			consumeInvite(ctx.db, encontrado.inviteId)
		]);

		expect([primeiro, segundo].filter(Boolean)).toHaveLength(1);
		expect(await lookupInvite(ctx.db, token)).toEqual({ ok: false, reason: 'usado' });
	});

	it('emitir novo convite revoga o anterior', async () => {
		const pessoaId = await criarPessoa('Rafael Novo');

		const antigo = await issueInvite(ctx.db, {
			teamId: ctx.teamId,
			personId: pessoaId,
			createdByPersonId: conselheiroId
		});
		const novo = await issueInvite(ctx.db, {
			teamId: ctx.teamId,
			personId: pessoaId,
			createdByPersonId: conselheiroId
		});

		expect(await lookupInvite(ctx.db, antigo.token)).toEqual({ ok: false, reason: 'revogado' });
		expect((await lookupInvite(ctx.db, novo.token)).ok).toBe(true);
	});

	it('recusa convite para quem já tem senha definida', async () => {
		const pessoaId = await criarPessoa('Ja Tem Acesso');
		await ctx.db
			.insert(userAccount)
			.values({ personId: pessoaId, passwordHash: await hashPassword('uma senha qualquer') });

		const { token } = await issueInvite(ctx.db, {
			teamId: ctx.teamId,
			personId: pessoaId,
			createdByPersonId: conselheiroId
		});

		expect(await lookupInvite(ctx.db, token)).toEqual({ ok: false, reason: 'ja_tem_conta' });
	});
});

describe('sessão', () => {
	async function contaComSenha(nome: string, senha: string) {
		const personId = await criarPessoa(nome);
		const [conta] = await ctx.db
			.insert(userAccount)
			.values({ personId, passwordHash: await hashPassword(senha) })
			.returning({ id: userAccount.id });
		return { personId, accountId: conta!.id };
	}

	it('cria sessão válida e a resolve pelo token', async () => {
		const { accountId, personId } = await contaComSenha('Ana Sessão', 'senha longa de teste');

		const { token } = await createSession(ctx.db, accountId, {
			ip: '10.0.0.1',
			userAgent: 'iPhone'
		});

		const resolvida = await validateSession(ctx.db, token);
		expect(resolvida).not.toBeNull();
		expect(resolvida!.personId).toBe(personId);
	});

	it('o token em claro NÃO fica no banco — só o hash', async () => {
		const { accountId } = await contaComSenha('Bruno Hash', 'senha longa de teste');
		const { token, record } = await createSession(ctx.db, accountId);

		expect(record.tokenHash).not.toBe(token);
		expect(record.tokenHash).toMatch(/^[0-9a-f]{64}$/);
	});

	it('recusa token inexistente ou vazio', async () => {
		expect(await validateSession(ctx.db, undefined)).toBeNull();
		expect(await validateSession(ctx.db, 'inventado')).toBeNull();
	});

	it('revogação tem efeito IMEDIATO — a razão de não usar JWT', async () => {
		const { accountId } = await contaComSenha('Carla Revoga', 'senha longa de teste');
		const { token, record } = await createSession(ctx.db, accountId);

		expect(await validateSession(ctx.db, token)).not.toBeNull();

		await revokeSession(ctx.db, record.id);

		expect(await validateSession(ctx.db, token)).toBeNull();
	});

	it('"sair de todos os dispositivos" preserva o atual', async () => {
		const { accountId } = await contaComSenha('Diego Multi', 'senha longa de teste');

		const atual = await createSession(ctx.db, accountId, { userAgent: 'iPhone' });
		const outra1 = await createSession(ctx.db, accountId, { userAgent: 'Android' });
		const outra2 = await createSession(ctx.db, accountId, { userAgent: 'Windows' });

		const revogadas = await revokeOtherSessions(ctx.db, accountId, atual.record.id);

		expect(revogadas).toBe(2);
		expect(await validateSession(ctx.db, atual.token)).not.toBeNull();
		expect(await validateSession(ctx.db, outra1.token)).toBeNull();
		expect(await validateSession(ctx.db, outra2.token)).toBeNull();
	});

	it('conta desativada não autentica, mesmo com sessão viva', async () => {
		const { accountId } = await contaComSenha('Elisa Desativada', 'senha longa de teste');
		const { token } = await createSession(ctx.db, accountId);

		await ctx.db
			.update(userAccount)
			.set({ disabledAt: new Date() })
			.where(eq(userAccount.id, accountId));

		expect(await validateSession(ctx.db, token)).toBeNull();
	});
});

describe('actor carregado do banco', () => {
	it('conselheiro de um grupo só age naquele grupo', async () => {
		const personId = await criarPessoa('Conselheiro do Azul');
		const PG_AZUL = '018f0000-0000-7000-8000-00000000aaaa';
		const PG_VERDE = '018f0000-0000-7000-8000-00000000bbbb';

		await ctx.db.insert(personRole).values({
			personId,
			roleId: ctx.papeis.conselheiro!,
			scopeType: 'group',
			scopeId: PG_AZUL
		});

		const actor = await loadActor(ctx.db, personId);
		expect(actor).not.toBeNull();

		expect(can(actor, 'attendance.record', { groupId: PG_AZUL })).toBe(true);
		expect(can(actor, 'attendance.record', { groupId: PG_VERDE })).toBe(false);
		expect(can(actor, 'rbac.manage', { groupId: PG_AZUL })).toBe(false);
	});

	it('líder global age em qualquer contexto', async () => {
		const personId = await criarPessoa('Líder Global');
		await ctx.db.insert(personRole).values({
			personId,
			roleId: ctx.papeis.lider!,
			scopeType: 'global',
			scopeId: null
		});

		const actor = await loadActor(ctx.db, personId);
		expect(can(actor, 'finance.view_all')).toBe(true);
		expect(can(actor, 'attendance.record', { groupId: 'qualquer-grupo' })).toBe(true);
	});

	it('pessoa sem papel não pode nada', async () => {
		const personId = await criarPessoa('Sem Papel');
		const actor = await loadActor(ctx.db, personId);

		expect(actor).not.toBeNull();
		expect(actor!.assignments).toHaveLength(0);
		expect(can(actor, 'person.view', { personId })).toBe(false);
	});

	it('papel expirado é ignorado', async () => {
		const personId = await criarPessoa('Papel Vencido');
		await ctx.db.insert(personRole).values({
			personId,
			roleId: ctx.papeis.lider!,
			scopeType: 'global',
			scopeId: null,
			expiresAt: new Date(Date.now() - 1000)
		});

		const actor = await loadActor(ctx.db, personId);
		expect(actor!.assignments).toHaveLength(0);
		expect(can(actor, 'finance.view_all')).toBe(false);
	});

	it('pessoa removida não vira actor', async () => {
		const personId = await criarPessoa('Pessoa Removida');
		await ctx.db.update(person).set({ deletedAt: new Date() }).where(eq(person.id, personId));

		expect(await loadActor(ctx.db, personId)).toBeNull();
	});

	it('mesmo papel em dois grupos vira duas atribuições', async () => {
		const personId = await criarPessoa('Conselheiro Duplo');
		const A = '018f0000-0000-7000-8000-00000000cccc';
		const B = '018f0000-0000-7000-8000-00000000dddd';

		await ctx.db.insert(personRole).values([
			{ personId, roleId: ctx.papeis.conselheiro!, scopeType: 'group', scopeId: A },
			{ personId, roleId: ctx.papeis.conselheiro!, scopeType: 'group', scopeId: B }
		]);

		const actor = await loadActor(ctx.db, personId);
		expect(actor!.assignments).toHaveLength(2);
		expect(can(actor, 'attendance.record', { groupId: A })).toBe(true);
		expect(can(actor, 'attendance.record', { groupId: B })).toBe(true);
	});
});

describe('fluxo completo: convite → senha → entrada', () => {
	it('percorre o caminho real de um novo membro', async () => {
		const conselheiroId = await criarPessoa('Conselheiro Emissor');
		const novaPessoaId = await criarPessoa('Membro Novo');

		await ctx.db.insert(personRole).values({
			personId: novaPessoaId,
			roleId: ctx.papeis.membro!,
			scopeType: 'self',
			scopeId: null
		});

		// 1. Conselheiro emite o convite
		const convite = await issueInvite(ctx.db, {
			teamId: ctx.teamId,
			personId: novaPessoaId,
			createdByPersonId: conselheiroId
		});

		// 2. Pessoa abre o link
		const encontrado = await lookupInvite(ctx.db, convite.token);
		expect(encontrado.ok).toBe(true);
		if (!encontrado.ok) return;
		expect(encontrado.fullName).toBe('Membro Novo');

		// 3. Define a senha
		expect(await consumeInvite(ctx.db, encontrado.inviteId)).toBe(true);
		const senha = 'meu encontro de quinta';
		const [conta] = await ctx.db
			.insert(userAccount)
			.values({ personId: encontrado.personId, passwordHash: await hashPassword(senha) })
			.returning({ id: userAccount.id, passwordHash: userAccount.passwordHash });

		// 4. Já entra autenticada
		const { token } = await createSession(ctx.db, conta!.id);
		const sessao = await validateSession(ctx.db, token);
		expect(sessao!.personId).toBe(novaPessoaId);

		// 5. E a senha realmente funciona no login seguinte
		expect(await verifyPassword(conta!.passwordHash, senha)).toBe(true);
		expect(await verifyPassword(conta!.passwordHash, 'senha errada aqui')).toBe(false);

		// 6. Com as permissões de membro, e só elas
		const actor = await loadActor(ctx.db, novaPessoaId);
		expect(can(actor, 'event.view', { personId: novaPessoaId })).toBe(true);
		expect(can(actor, 'finance.view_own', { personId: novaPessoaId })).toBe(true);
		expect(can(actor, 'finance.view_all', { personId: novaPessoaId })).toBe(false);
		expect(can(actor, 'person.update', { personId: novaPessoaId })).toBe(false);

		// 7. O convite não serve de novo
		expect(await lookupInvite(ctx.db, convite.token)).toEqual({ ok: false, reason: 'usado' });
	});
});

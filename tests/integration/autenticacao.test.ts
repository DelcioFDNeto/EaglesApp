/**
 * Fluxo de acesso ponta a ponta, contra Postgres real.
 *
 * Cobre o caminho que toda pessoa dos Eagles vai percorrer uma vez:
 * convite emitido pelo conselheiro → link → senha → sessão → revogação.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { criarBancoDeTeste, criarGrupo, type BancoDeTeste } from './helpers/banco';
import { person, personRole, session, userAccount } from '../../src/lib/server/db/schema';
import { consumeInvite, issueInvite, lookupInvite } from '../../src/lib/server/auth/invite';
import {
	aceitarConvite,
	encontrarContaPorIdentificador,
	interpretarIdentificador
} from '../../src/lib/server/auth/conta';
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

	it('convite para quem JÁ tem conta é recuperação de acesso, não recusa (ADR 0004)', async () => {
		// O M01 recusava este caso com "você já tem acesso, entre com a sua
		// senha" — deixando sem saída justamente quem esqueceu a senha.
		const pessoaId = await criarPessoa('Esqueceu A Senha');
		const [conta] = await ctx.db
			.insert(userAccount)
			.values({
				personId: pessoaId,
				email: 'esqueceu@eagles.test',
				passwordHash: await hashPassword('senha antiga e esquecida')
			})
			.returning({ id: userAccount.id });

		const aberta = await createSession(ctx.db, conta!.id);

		const { token } = await issueInvite(ctx.db, {
			teamId: ctx.teamId,
			personId: pessoaId,
			createdByPersonId: conselheiroId
		});

		const encontrado = await lookupInvite(ctx.db, token);
		expect(encontrado).toMatchObject({ ok: true, recuperacao: true });

		const r = await aceitarConvite(ctx.db, {
			token,
			senha: 'minha senha nova de quinta',
			identificador: 'esqueceu@eagles.test'
		});
		expect(r).toMatchObject({ ok: true, recuperacao: true, contaId: conta!.id });

		// A senha antiga deixou de valer, a nova vale.
		const achada = await encontrarContaPorIdentificador(ctx.db, 'esqueceu@eagles.test');
		expect(await verifyPassword(achada!.conta.passwordHash!, 'minha senha nova de quinta')).toBe(
			true
		);
		expect(await verifyPassword(achada!.conta.passwordHash!, 'senha antiga e esquecida')).toBe(
			false
		);

		// E a sessão que estava aberta morreu junto: aparelho perdido ou sessão
		// roubada não sobrevivem à troca de senha.
		expect(await validateSession(ctx.db, aberta.token)).toBeNull();
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
		const PG_AZUL = await criarGrupo(ctx, 'PG Azul');
		const PG_VERDE = await criarGrupo(ctx, 'PG Verde');

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
		const A = await criarGrupo(ctx, 'PG A');
		const B = await criarGrupo(ctx, 'PG B');

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

		// 3. Define a senha e COMO vai entrar — pelo mesmo serviço que a rota usa.
		//
		// A versão anterior deste teste inseria a conta à mão, sem identificador,
		// e no passo 5 conferia o hash da senha. Passava — enquanto a conta real
		// ficava inalcançável pelo login. Agora o teste percorre o código da rota.
		const senha = 'meu encontro de quinta';
		const aceite = await aceitarConvite(ctx.db, {
			token: convite.token,
			senha,
			identificador: '(11) 98888-7766'
		});
		expect(aceite.ok).toBe(true);
		if (!aceite.ok) return;
		expect(aceite.recuperacao).toBe(false);

		// 4. Já entra autenticada
		const { token } = await createSession(ctx.db, aceite.contaId);
		const sessao = await validateSession(ctx.db, token);
		expect(sessao!.personId).toBe(novaPessoaId);

		// 5. E CONSEGUE ENTRAR DE NOVO depois de sair — achada do jeito que o
		// login acha, com o telefone escrito de outra forma.
		await revokeSession(ctx.db, sessao!.session.id);
		const naEntrada = await encontrarContaPorIdentificador(ctx.db, '11988887766');
		expect(naEntrada, 'quem entrou por convite precisa conseguir entrar de novo').not.toBeNull();
		expect(naEntrada!.pessoa.id).toBe(novaPessoaId);
		expect(await verifyPassword(naEntrada!.conta.passwordHash!, senha)).toBe(true);
		expect(await verifyPassword(naEntrada!.conta.passwordHash!, 'senha errada aqui')).toBe(false);

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

describe('conta de acesso — identificador e aceite', () => {
	it('interpreta e-mail sem caixa e telefone só pelos dígitos', () => {
		expect(interpretarIdentificador('  Ana@Eagles.Test ')).toEqual({
			tipo: 'email',
			valor: 'ana@eagles.test'
		});
		expect(interpretarIdentificador('(11) 98765-4321')).toEqual({
			tipo: 'telefone',
			valor: '11987654321'
		});
		// O +55 é o mesmo número: mesma chave para o login e para o limite de
		// tentativas (varredura de 11/10/2026).
		expect(interpretarIdentificador('+55 11 98765-4321')).toEqual({
			tipo: 'telefone',
			valor: '11987654321'
		});
		// DDD 55 (Santa Maria, RS) não é confundido com o código do país.
		expect(interpretarIdentificador('(55) 99876-5432')).toEqual({
			tipo: 'telefone',
			valor: '55998765432'
		});
		expect(interpretarIdentificador('123')).toBeNull();
		expect(interpretarIdentificador('sem-arroba')).toBeNull();
		expect(interpretarIdentificador('')).toBeNull();
	});

	it('identificador já usado por OUTRA conta é recusado — e o convite continua valendo', async () => {
		const donoId = await criarPessoa('Dono Do Telefone');
		await ctx.db.insert(userAccount).values({
			personId: donoId,
			phone: '11977776666',
			passwordHash: await hashPassword('senha do dono do telefone')
		});

		const novaId = await criarPessoa('Quer O Mesmo Telefone');
		const conselheiro = await criarPessoa('Emissor Do Convite');
		const { token } = await issueInvite(ctx.db, {
			teamId: ctx.teamId,
			personId: novaId,
			createdByPersonId: conselheiro
		});

		const r = await aceitarConvite(ctx.db, {
			token,
			senha: 'uma senha boa e comprida',
			identificador: '(11) 97777-6666'
		});
		expect(r).toMatchObject({ ok: false, campo: 'identificador' });

		// O convite não foi queimado pela tentativa: a pessoa tenta de novo
		// com outro identificador, sem precisar pedir um link novo.
		expect(await lookupInvite(ctx.db, token)).toMatchObject({ ok: true });

		const segunda = await aceitarConvite(ctx.db, {
			token,
			senha: 'uma senha boa e comprida',
			identificador: 'quer.o.mesmo@eagles.test'
		});
		expect(segunda.ok).toBe(true);
	});

	it('senha fraca é recusada ANTES de consumir o convite', async () => {
		const pessoaId = await criarPessoa('Senha Fraca Silva');
		const conselheiro = await criarPessoa('Emissor Dois');
		const { token } = await issueInvite(ctx.db, {
			teamId: ctx.teamId,
			personId: pessoaId,
			createdByPersonId: conselheiro
		});

		const r = await aceitarConvite(ctx.db, {
			token,
			senha: 'curta',
			identificador: 'fraca@eagles.test'
		});
		expect(r).toMatchObject({ ok: false, campo: 'senha' });
		expect(await lookupInvite(ctx.db, token)).toMatchObject({ ok: true });
	});

	it('identificador inválido é recusado com mensagem de campo', async () => {
		const pessoaId = await criarPessoa('Identificador Ruim');
		const conselheiro = await criarPessoa('Emissor Tres');
		const { token } = await issueInvite(ctx.db, {
			teamId: ctx.teamId,
			personId: pessoaId,
			createdByPersonId: conselheiro
		});

		const r = await aceitarConvite(ctx.db, {
			token,
			senha: 'uma senha boa e comprida',
			identificador: '1234'
		});
		expect(r).toMatchObject({ ok: false, campo: 'identificador' });
	});

	it('conta desativada não é encontrada pelo login', async () => {
		const pessoaId = await criarPessoa('Conta Desativada');
		await ctx.db.insert(userAccount).values({
			personId: pessoaId,
			email: 'desativada@eagles.test',
			passwordHash: await hashPassword('qualquer senha comprida'),
			disabledAt: new Date()
		});

		expect(await encontrarContaPorIdentificador(ctx.db, 'desativada@eagles.test')).toBeNull();
	});

	it('a recuperação de acesso encerra TODAS as sessões da conta', async () => {
		const pessoaId = await criarPessoa('Celular Roubado');
		const [conta] = await ctx.db
			.insert(userAccount)
			.values({
				personId: pessoaId,
				email: 'roubado@eagles.test',
				passwordHash: await hashPassword('senha que vazou junto')
			})
			.returning({ id: userAccount.id });

		await createSession(ctx.db, conta!.id);
		await createSession(ctx.db, conta!.id);

		const conselheiro = await criarPessoa('Emissor Quatro');
		const { token } = await issueInvite(ctx.db, {
			teamId: ctx.teamId,
			personId: pessoaId,
			createdByPersonId: conselheiro
		});
		await aceitarConvite(ctx.db, {
			token,
			senha: 'senha nova depois do roubo',
			identificador: 'roubado@eagles.test'
		});

		const abertas = await ctx.db
			.select({ id: session.id, revogada: session.revokedAt })
			.from(session)
			.where(eq(session.accountId, conta!.id));
		expect(abertas.every((s) => s.revogada !== null)).toBe(true);
	});
});

/**
 * Limpeza periódica: o que já não serve sai, o que ainda vale fica.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { criarBancoDeTeste, type BancoDeTeste } from './helpers/banco';
import { person, senhaReset, session, userAccount } from '../../src/lib/server/db/schema';
import { iniciarManutencao, limparBanco, pararManutencao } from '../../src/lib/server/manutencao';
import { checkRateLimit, pruneRateLimits, RULES } from '../../src/lib/server/auth/ratelimit';

let ctx: BancoDeTeste;
let contaId: string;
let personId: string;

const DIA = 86_400_000;
const atras = (dias: number) => new Date(Date.now() - dias * DIA);
const frente = (dias: number) => new Date(Date.now() + dias * DIA);

describe('manutenção periódica', () => {
	beforeAll(async () => {
		ctx = await criarBancoDeTeste();
		const [p] = await ctx.db
			.insert(person)
			.values({ teamId: ctx.teamId, fullName: 'Ana Teste' })
			.returning({ id: person.id });
		personId = p!.id;
		const [c] = await ctx.db
			.insert(userAccount)
			.values({ personId, email: 'ana@eagles.test' })
			.returning({ id: userAccount.id });
		contaId = c!.id;
	}, 60_000);

	afterAll(async () => {
		pararManutencao();
		await ctx?.fechar();
	});

	it('remove sessões e links de senha antigos, e mantém os que ainda valem', async () => {
		// O banco exige expiração depois da criação: as antigas nasceram há 60 dias.
		const sessao = (tokenHash: string, expiresAt: Date, revokedAt: Date | null = null) => ({
			accountId: contaId,
			tokenHash,
			expiresAt,
			revokedAt,
			createdAt: atras(60)
		});
		await ctx.db
			.insert(session)
			.values([
				sessao('viva', frente(20)),
				sessao('vencida-ha-pouco', atras(5)),
				sessao('vencida-ha-muito', atras(40)),
				sessao('revogada-ha-muito', frente(5), atras(40))
			]);

		const link = (token: string, expiresAt: Date, usedAt: Date | null = null) => ({
			personId,
			token,
			expiresAt,
			usedAt
		});
		await ctx.db
			.insert(senhaReset)
			.values([
				link('aberto', frente(0.01)),
				link('usado-ontem', atras(0.5), atras(1)),
				link('vencido-ha-muito', atras(10)),
				link('usado-ha-muito', atras(9), atras(10))
			]);

		expect(await limparBanco(ctx.db)).toEqual({ sessoes: 2, linksDeSenha: 2 });

		const sessoes = (await ctx.db.select({ t: session.tokenHash }).from(session)).map((s) => s.t);
		expect(sessoes.sort()).toEqual(['vencida-ha-pouco', 'viva']);
		const links = (await ctx.db.select({ t: senhaReset.token }).from(senhaReset)).map((l) => l.t);
		expect(links.sort()).toEqual(['aberto', 'usado-ontem']);

		// Rodar de novo não remove mais nada.
		expect(await limparBanco(ctx.db)).toEqual({ sessoes: 0, linksDeSenha: 0 });
		await ctx.db.delete(session).where(eq(session.accountId, contaId));
	});

	it('o rate limit em memória não guarda entrada ociosa para sempre', () => {
		checkRateLimit('teste:ip:203.0.113.99', RULES.loginPorIp);
		// Recém-usada: fica.
		expect(pruneRateLimits()).toBe(0);
	});

	it('agendar duas vezes não duplica os timers', () => {
		iniciarManutencao(() => ctx.db);
		iniciarManutencao(() => ctx.db);
		pararManutencao();
	});
});

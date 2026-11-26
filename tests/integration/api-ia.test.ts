/**
 * Testes de integração reais do M10 — Assistente de IA contra PGlite.
 * Cobre RN-26 (escopo de permissões), RN-27 (confirmação humana obrigatória),
 * RN-29 (feature flag desligada por padrão), LGPD seção 12.6 (pseudonimização de menor),
 * `ai_interaction_log` e `audit_log`.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { criarBancoDeTeste, type BancoDeTeste } from './helpers/banco';
import { setTestDatabase } from '../../src/lib/server/db';
import {
	aiInteractionLog,
	aiSuggestion,
	auditLog,
	event as eventTable,
	eventType as eventTypeTable,
	financeCategory,
	financeTransaction,
	group as groupTable,
	groupMember,
	person as personTable,
	personProfile,
	personRole as personRoleTable,
	presence,
	userAccount as userAccountTable,
	groupMemberHistory
} from '../../src/lib/server/db/schema';
import { hashPassword } from '../../src/lib/server/auth/password';
import { tokenPara } from './helpers/token';
import { resetEnvCache } from '../../src/lib/server/env';

import * as flagsRoute from '../../src/routes/api/admin/flags/+server';
import * as statusRoute from '../../src/routes/api/ia/status/+server';
import * as redigirRoute from '../../src/routes/api/ia/redigir/+server';
import * as analisarRoute from '../../src/routes/api/ia/analisar/+server';
import * as decidirRoute from '../../src/routes/api/ia/sugestoes/[id]/decidir/+server';

let ctx: BancoDeTeste;
let liderId: string;
let conselheiroId: string;
let membroId: string;
let visitanteId: string;
let menorId: string;
let pessoaOutroGrupoId: string;

let tokenLider: string;
let tokenConselheiro: string;
let tokenMembro: string;
let tokenVisitante: string;

let pgAzulId: string;
let pgVerdeId: string;

function req(method: string, path: string, token: string, body?: unknown): Request {
	return new Request(`https://app.eagles.test${path}`, {
		method,
		headers: {
			'Content-Type': 'application/json',
			Authorization: `Bearer ${token}`
		},
		body: body !== undefined ? JSON.stringify(body) : undefined
	});
}

async function criarPessoaComConta(opts: {
	nome: string;
	email: string;
	roleId: string;
	scopeType: 'global' | 'group' | 'self';
	scopeId?: string | null;
	birthDate?: string | null;
	statusPerfil?: string;
}) {
	const [p] = await ctx.db
		.insert(personTable)
		.values({
			teamId: ctx.teamId,
			fullName: opts.nome,
			birthDate: opts.birthDate ?? null
		})
		.returning({ id: personTable.id });

	await ctx.db.insert(userAccountTable).values({
		personId: p!.id,
		email: opts.email,
		passwordHash: await hashPassword('senha12345')
	});

	await ctx.db.insert(personRoleTable).values({
		personId: p!.id,
		roleId: opts.roleId,
		scopeType: opts.scopeType,
		scopeId: opts.scopeId ?? null
	});

	await ctx.db.insert(personProfile).values({
		personId: p!.id,
		status: opts.statusPerfil ?? 'membro'
	});

	return p!.id;
}

describe('M10 — Assistente de IA (RN-26, RN-27, RN-29 e LGPD)', () => {
	beforeAll(async () => {
		process.env.DATABASE_URL = 'postgres://teste@localhost:5432/teste';
		process.env.PUBLIC_ORIGIN = 'https://app.eagles.test';
		process.env.NODE_ENV = 'test';
		resetEnvCache();

		ctx = await criarBancoDeTeste();
		setTestDatabase(ctx.db);

		const [gAzul] = await ctx.db
			.insert(groupTable)
			.values({ teamId: ctx.teamId, name: 'PG Azul', slug: 'pg-azul' })
			.returning({ id: groupTable.id });
		const [gVerde] = await ctx.db
			.insert(groupTable)
			.values({ teamId: ctx.teamId, name: 'PG Verde', slug: 'pg-verde' })
			.returning({ id: groupTable.id });
		pgAzulId = gAzul!.id;
		pgVerdeId = gVerde!.id;

		liderId = await criarPessoaComConta({
			nome: 'Líder Ana',
			email: 'ana@eagles.test',
			roleId: ctx.papeis.lider!,
			scopeType: 'global',
			birthDate: '1995-04-10',
			statusPerfil: 'lider'
		});
		conselheiroId = await criarPessoaComConta({
			nome: 'Conselheiro Bruno',
			email: 'bruno@eagles.test',
			roleId: ctx.papeis.conselheiro!,
			scopeType: 'group',
			scopeId: pgAzulId,
			birthDate: '1996-08-20',
			statusPerfil: 'conselheiro'
		});
		membroId = await criarPessoaComConta({
			nome: 'Membro Carlos',
			email: 'carlos@eagles.test',
			roleId: ctx.papeis.membro!,
			scopeType: 'self',
			birthDate: '2000-02-15',
			statusPerfil: 'membro'
		});
		visitanteId = await criarPessoaComConta({
			nome: 'Visitante Diana',
			email: 'diana@eagles.test',
			roleId: ctx.papeis.visitante!,
			scopeType: 'self',
			birthDate: '2001-05-12',
			statusPerfil: 'visitante'
		});
		menorId = await criarPessoaComConta({
			nome: 'Gabriel Menor Secreto',
			email: 'gabriel@eagles.test',
			roleId: ctx.papeis.membro!,
			scopeType: 'self',
			birthDate: '2012-09-01',
			statusPerfil: 'membro'
		});
		pessoaOutroGrupoId = await criarPessoaComConta({
			nome: 'Elena PG Verde',
			email: 'elena@eagles.test',
			roleId: ctx.papeis.membro!,
			scopeType: 'self',
			birthDate: '1999-11-11',
			statusPerfil: 'membro'
		});

		// Alocações iniciais: todos do Azul no PG Azul, Elena no PG Verde
		await ctx.db.insert(groupMember).values([
			{ groupId: pgAzulId, personId: conselheiroId, roleKey: 'conselheiro' },
			{ groupId: pgAzulId, personId: membroId, roleKey: 'membro' },
			{ groupId: pgAzulId, personId: menorId, roleKey: 'membro' },
			{ groupId: pgVerdeId, personId: pessoaOutroGrupoId, roleKey: 'membro' }
		]);

		// Cria um evento e presenças para diferenciar frequências
		const [tipo] = await ctx.db
			.insert(eventTypeTable)
			.values({ teamId: ctx.teamId, name: 'PG', slug: 'pg' })
			.returning({ id: eventTypeTable.id });
		const [ev] = await ctx.db
			.insert(eventTable)
			.values({
				teamId: ctx.teamId,
				eventTypeId: tipo!.id,
				title: 'PG Semanal',
				startsAt: new Date()
			})
			.returning({ id: eventTable.id });
		await ctx.db.insert(presence).values([
			{ eventId: ev!.id, personId: liderId, status: 'present', registrationMethod: 'manual' },
			{ eventId: ev!.id, personId: conselheiroId, status: 'present', registrationMethod: 'manual' }
		]);

		// Cria movimentação financeira para teste de resumo financeiro
		const [cat] = await ctx.db
			.insert(financeCategory)
			.values({
				teamId: ctx.teamId,
				name: 'Contribuição',
				slug: 'contribuicao',
				kind: 'entrada'
			})
			.returning({ id: financeCategory.id });
		await ctx.db.insert(financeTransaction).values({
			teamId: ctx.teamId,
			categoryId: cat!.id,
			kind: 'entrada',
			amountCents: 50000,
			occurredAt: new Date(),
			paymentMethod: 'pix',
			description: 'Caixa inicial',
			responsiblePersonId: liderId,
			status: 'confirmada'
		});

		tokenLider = await tokenPara(ctx.db, liderId);
		tokenConselheiro = await tokenPara(ctx.db, conselheiroId);
		tokenMembro = await tokenPara(ctx.db, membroId);
		tokenVisitante = await tokenPara(ctx.db, visitanteId);
	}, 60_000);

	afterAll(async () => {
		setTestDatabase(null);
		await ctx?.fechar();
	});

	it('bloqueia uso enquanto feature flag `ia_assistente` estiver desligada (RN-29)', async () => {
		const resStatus = await statusRoute.GET({
			request: req('GET', '/api/ia/status', tokenLider),
			locals: {}
		} as any);
		expect(resStatus.status).toBe(200);
		expect((await resStatus.json()).iaAtiva).toBe(false);

		const resRedigir = await redigirRoute.POST({
			request: req('POST', '/api/ia/redigir', tokenLider, {
				modo: 'aviso',
				tema: 'Encontro',
				detalhes: 'Quinta-feira às 20h.'
			}),
			locals: {}
		} as any);
		expect(resRedigir.status).toBe(403);

		const resAnalisar = await analisarRoute.POST({
			request: req('POST', '/api/ia/analisar', tokenLider, { tipo: 'sinais_atencao' }),
			locals: {}
		} as any);
		expect(resAnalisar.status).toBe(403);
	});

	it('respeita escopo de permissões por papel (RN-26) após ligar `ia_assistente`', async () => {
		// Líder liga `ia_assistente`
		const resFlag = await flagsRoute.PUT({
			request: req('PUT', '/api/admin/flags', tokenLider, {
				key: 'ia_assistente',
				enabled: true
			}),
			locals: {}
		} as any);
		expect(resFlag.status).toBe(200);

		// Visitante não tem acesso à IA (403)
		expect(
			(
				await statusRoute.GET({
					request: req('GET', '/api/ia/status', tokenVisitante),
					locals: {}
				} as any)
			).status
		).toBe(403);

		// Membro pode redigir aviso/ata (`ai.use_basic`), mas NÃO pode fazer análises ou financeiro
		const resMembroAviso = await redigirRoute.POST({
			request: req('POST', '/api/ia/redigir', tokenMembro, {
				modo: 'aviso',
				tema: 'PG Quinta',
				detalhes: 'Nos encontramos às 20h no salão.'
			}),
			locals: {}
		} as any);
		expect(resMembroAviso.status).toBe(201);

		expect(
			(
				await analisarRoute.POST({
					request: req('POST', '/api/ia/analisar', tokenMembro, { tipo: 'sinais_atencao' }),
					locals: {}
				} as any)
			).status
		).toBe(403);

		expect(
			(
				await analisarRoute.POST({
					request: req('POST', '/api/ia/analisar', tokenMembro, { tipo: 'resumo_financeiro' }),
					locals: {}
				} as any)
			).status
		).toBe(403);

		// Conselheiro (PG Azul) analisa `sinais_atencao` APENAS do PG Azul — nunca vê Elena do PG Verde!
		const resCons = await analisarRoute.POST({
			request: req('POST', '/api/ia/analisar', tokenConselheiro, { tipo: 'sinais_atencao' }),
			locals: {}
		} as any);
		expect(resCons.status).toBe(201);
		const dCons = await resCons.json();
		const idsSinalizados = dCons.resultado.sinais.map((s: any) => s.personId);
		expect(idsSinalizados).toContain(membroId);
		expect(idsSinalizados).toContain(menorId);
		expect(idsSinalizados).not.toContain(pessoaOutroGrupoId);

		// Menor de idade pseudonimizado no output (seção 12.6)
		const sinalMenor = dCons.resultado.sinais.find((s: any) => s.personId === menorId);
		expect(sinalMenor.menor).toBe(true);
		expect(sinalMenor.rotulo).not.toContain('Gabriel');
		expect(sinalMenor.mensagem).not.toContain('Gabriel');

		// Conselheiro NÃO pode gerar divisão global de grupos nem resumo financeiro
		expect(
			(
				await analisarRoute.POST({
					request: req('POST', '/api/ia/analisar', tokenConselheiro, { tipo: 'divisao_grupos' }),
					locals: {}
				} as any)
			).status
		).toBe(403);
		expect(
			(
				await analisarRoute.POST({
					request: req('POST', '/api/ia/analisar', tokenConselheiro, { tipo: 'resumo_financeiro' }),
					locals: {}
				} as any)
			).status
		).toBe(403);

		// Líder gera resumo financeiro (`ai.use_finance` + `finance.view_all`)
		const resFin = await analisarRoute.POST({
			request: req('POST', '/api/ia/analisar', tokenLider, { tipo: 'resumo_financeiro' }),
			locals: {}
		} as any);
		expect(resFin.status).toBe(201);
		const dFin = await resFin.json();
		expect(dFin.resultado.resumo).toContain('positivo');
	});

	it('exige confirmação humana antes de aplicar divisão de grupos e registra auditoria (RN-27)', async () => {
		const membrosAntes = await ctx.db.select().from(groupMember);
		const mapaAntes = new Map(membrosAntes.map((m) => [m.personId, m.groupId]));

		// Líder gera proposta de divisão de grupos
		const resProp = await analisarRoute.POST({
			request: req('POST', '/api/ia/analisar', tokenLider, { tipo: 'divisao_grupos' }),
			locals: {}
		} as any);
		expect(resProp.status).toBe(201);
		const { sugestao, resultado } = await resProp.json();
		expect(sugestao.status).toBe('pendente');

		// Menor está pseudonimizado na proposta
		const alocMenor = resultado.alocacoes.find((a: any) => a.personId === menorId);
		expect(alocMenor.menor).toBe(true);
		expect(alocMenor.rotulo).not.toContain('Gabriel');

		// RN-27: NENHUMA transferência foi aplicada enquanto pendente!
		const membrosDurante = await ctx.db.select().from(groupMember);
		for (const m of membrosDurante) {
			expect(m.groupId).toBe(mapaAntes.get(m.personId));
		}

		// Conselheiro não pode aprovar divisão de grupos (403)
		expect(
			(
				await decidirRoute.POST({
					request: req('POST', `/api/ia/sugestoes/${sugestao.id}/decidir`, tokenConselheiro, {
						decisao: 'aceitar'
					}),
					params: { id: sugestao.id },
					locals: {}
				} as any)
			).status
		).toBe(403);

		// Líder confirma explicitamente a proposta
		const resDec = await decidirRoute.POST({
			request: req('POST', `/api/ia/sugestoes/${sugestao.id}/decidir`, tokenLider, {
				decisao: 'aceitar'
			}),
			params: { id: sugestao.id },
			locals: {}
		} as any);
		expect(resDec.status).toBe(200);
		const dDec = await resDec.json();
		expect(dDec.sugestao.status).toBe('aceita');

		// Verifica estado final no banco: sugestão aceita, `ai_interaction_log` e `audit_log` populados
		const [sugDb] = await ctx.db
			.select()
			.from(aiSuggestion)
			.where(eq(aiSuggestion.id, sugestao.id));
		expect(sugDb!.status).toBe('aceita');
		expect(sugDb!.decidedByPersonId).toBe(liderId);

		// Cada transferência aplicada deixa rastro no histórico de PG, com origem "ia".
		const aplicadas = (sugDb!.appliedChanges as { transferenciasAplicadas: number })
			.transferenciasAplicadas;
		const caminhoIa = await ctx.db
			.select()
			.from(groupMemberHistory)
			.where(eq(groupMemberHistory.origin, 'ia'));
		expect(caminhoIa).toHaveLength(aplicadas);
		for (const c of caminhoIa) expect(c.changedByPersonId).toBe(liderId);

		const logsIa = await ctx.db.select().from(aiInteractionLog);
		expect(logsIa.length).toBeGreaterThanOrEqual(4);

		const logsAud = await ctx.db
			.select()
			.from(auditLog)
			.where(eq(auditLog.entity, 'ai_suggestion'));
		expect(
			logsAud.some((l) => l.action === 'ai.suggestion_accepted' && l.entityId === sugestao.id)
		).toBe(true);

		// Não permite decidir duas vezes a mesma sugestão
		expect(
			(
				await decidirRoute.POST({
					request: req('POST', `/api/ia/sugestoes/${sugestao.id}/decidir`, tokenLider, {
						decisao: 'rejeitar'
					}),
					params: { id: sugestao.id },
					locals: {}
				} as any)
			).status
		).toBe(400);
	});
});

/**
 * Testes de integração reais do Dashboard por papel em `GET /api/inicio` (§22) contra PGlite.
 * Valida:
 *   - Líder: financeiro, frequência PG 30d, pessoas novas 30d, subgrupos, pendências, IA e notificações;
 *   - Conselheiro: frequência, subgrupos e pendências operacionais, SEM vazar dados financeiros nem pendências de despesa;
 *   - Membro: meuSubgrupo, minhaFrequencia90d e minhasContribuicoes, SEM vazar dados da equipe/admin;
 *   - Visitante: experiência mínima `{ perfil: 'visitante' }` sem nenhuma métrica interna;
 *   - Master nunca entra nas contagens da equipe (`naoEhMaster`).
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { criarBancoDeTeste, type BancoDeTeste } from './helpers/banco';
import { setTestDatabase } from '../../src/lib/server/db';
import {
	aiSuggestion,
	escala,
	event as eventTable,
	eventType as eventTypeTable,
	financeCategory,
	financeTransaction,
	group as groupTable,
	groupMember,
	invite,
	notification,
	person as personTable,
	personProfile,
	personRole as personRoleTable,
	presence,
	responsabilidade,
	userAccount as userAccountTable
} from '../../src/lib/server/db/schema';
import { hashPassword } from '../../src/lib/server/auth/password';
import { tokenPara } from './helpers/token';
import { resetEnvCache } from '../../src/lib/server/env';

import * as inicioRoute from '../../src/routes/api/inicio/+server';
import * as flagsRoute from '../../src/routes/api/admin/flags/+server';

let ctx: BancoDeTeste;

let masterId: string;
let liderId: string;
let conselheiroId: string;
let membroId: string;
let membroSemGrupoId: string;
let visitanteId: string;

let tokenLider: string;
let tokenConselheiro: string;
let tokenMembro: string;
let tokenVisitante: string;

let pgAzulId: string;
let pgVerdeId: string;

const DIA_MS = 86_400_000;

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

async function criarPessoa(opts: {
	nome: string;
	email?: string;
	roleId?: string;
	scopeType?: 'global' | 'group' | 'self';
	statusPerfil: string;
	createdAt?: Date;
	deletedAt?: Date | null;
}) {
	const [p] = await ctx.db
		.insert(personTable)
		.values({
			teamId: ctx.teamId,
			fullName: opts.nome,
			createdAt: opts.createdAt ?? new Date(),
			deletedAt: opts.deletedAt ?? null
		})
		.returning({ id: personTable.id });

	if (opts.email) {
		await ctx.db.insert(userAccountTable).values({
			personId: p!.id,
			email: opts.email,
			passwordHash: await hashPassword('senha12345')
		});
	}

	if (opts.roleId && opts.scopeType) {
		await ctx.db.insert(personRoleTable).values({
			personId: p!.id,
			roleId: opts.roleId,
			scopeType: opts.scopeType,
			scopeId: null
		});
	}

	await ctx.db.insert(personProfile).values({
		personId: p!.id,
		status: opts.statusPerfil
	});

	return p!.id;
}

describe('§22 — Dashboard por papel em GET /api/inicio', () => {
	beforeAll(async () => {
		process.env.DATABASE_URL = 'postgres://teste@localhost:5432/teste';
		process.env.PUBLIC_ORIGIN = 'https://app.eagles.test';
		process.env.NODE_ENV = 'test';
		resetEnvCache();

		ctx = await criarBancoDeTeste();
		setTestDatabase(ctx.db);

		const agora = Date.now();

		// 2 subgrupos ativos + 1 arquivado (não deve contar)
		const [gAzul] = await ctx.db
			.insert(groupTable)
			.values({ teamId: ctx.teamId, name: 'PG Azul', slug: 'pg-azul' })
			.returning({ id: groupTable.id });
		const [gVerde] = await ctx.db
			.insert(groupTable)
			.values({ teamId: ctx.teamId, name: 'PG Verde', slug: 'pg-verde' })
			.returning({ id: groupTable.id });
		await ctx.db.insert(groupTable).values({
			teamId: ctx.teamId,
			name: 'PG Arquivado',
			slug: 'pg-arquivado',
			archivedAt: new Date(agora - 10 * DIA_MS)
		});
		pgAzulId = gAzul!.id;
		pgVerdeId = gVerde!.id;

		// Master (deve ser excluído de todas as métricas da equipe!)
		masterId = await criarPessoa({
			nome: 'Dev Master',
			email: 'master@eagles.test',
			roleId: ctx.papeis.master!,
			scopeType: 'global',
			statusPerfil: 'visitante',
			createdAt: new Date(agora - 2 * DIA_MS)
		});

		// Equipe principal (4 membros ativos: Líder, Conselheiro, Membro, Membro Sem Grupo)
		liderId = await criarPessoa({
			nome: 'Líder Ana',
			email: 'ana@eagles.test',
			roleId: ctx.papeis.lider!,
			scopeType: 'global',
			statusPerfil: 'lider',
			createdAt: new Date(agora - 120 * DIA_MS)
		});
		conselheiroId = await criarPessoa({
			nome: 'Conselheiro Bruno',
			email: 'bruno@eagles.test',
			roleId: ctx.papeis.conselheiro!,
			scopeType: 'global',
			statusPerfil: 'conselheiro',
			createdAt: new Date(agora - 120 * DIA_MS)
		});
		membroId = await criarPessoa({
			nome: 'Membro Carlos',
			email: 'carlos@eagles.test',
			roleId: ctx.papeis.membro!,
			scopeType: 'self',
			statusPerfil: 'membro',
			createdAt: new Date(agora - 120 * DIA_MS)
		});
		membroSemGrupoId = await criarPessoa({
			nome: 'Membro Elisa',
			email: 'elisa@eagles.test',
			roleId: ctx.papeis.membro!,
			scopeType: 'self',
			statusPerfil: 'membro',
			createdAt: new Date(agora - 120 * DIA_MS)
		});

		// Pessoas novas nos últimos 30d: visitante + recorrente recente = 2
		visitanteId = await criarPessoa({
			nome: 'Visitante Diana',
			email: 'diana@eagles.test',
			roleId: ctx.papeis.visitante!,
			scopeType: 'self',
			statusPerfil: 'visitante',
			createdAt: new Date(agora - 3 * DIA_MS)
		});
		const recorrenteRecenteId = await criarPessoa({
			nome: 'Recorrente Felipe',
			statusPerfil: 'recorrente',
			createdAt: new Date(agora - 12 * DIA_MS)
		});

		// NÃO devem entrar em `pessoasNovas30d`: visitante antigo (>30d) e visitante excluído
		await criarPessoa({
			nome: 'Visitante Antigo',
			statusPerfil: 'visitante',
			createdAt: new Date(agora - 50 * DIA_MS)
		});
		await criarPessoa({
			nome: 'Visitante Removido',
			statusPerfil: 'visitante',
			createdAt: new Date(agora - 2 * DIA_MS),
			deletedAt: new Date(agora - DIA_MS)
		});

		// Alocações em subgrupos: 3 pessoas da equipe (líder no Verde, conselheiro e membro no Azul) + Master (excluído)
		// Membro sem subgrupo: apenas `membroSemGrupoId` (1)
		await ctx.db.insert(groupMember).values([
			{ groupId: pgVerdeId, personId: liderId, roleKey: 'lider' },
			{ groupId: pgAzulId, personId: conselheiroId, roleKey: 'conselheiro' },
			{ groupId: pgAzulId, personId: membroId, roleKey: 'membro' },
			{ groupId: pgVerdeId, personId: masterId, roleKey: 'master' }
		]);

		// Tipo de evento PG e encontros (1 nos últimos 30d, 1 há 50d, 1 futuro)
		const [tipoPg] = await ctx.db
			.insert(eventTypeTable)
			.values({ teamId: ctx.teamId, name: 'PG (Pequeno Grupo)', slug: 'pg' })
			.returning({ id: eventTypeTable.id });

		const [pgRecente] = await ctx.db
			.insert(eventTable)
			.values({
				teamId: ctx.teamId,
				eventTypeId: tipoPg!.id,
				title: 'PG da Semana Passada',
				startsAt: new Date(agora - 7 * DIA_MS)
			})
			.returning({ id: eventTable.id });

		const [pgAntigo] = await ctx.db
			.insert(eventTable)
			.values({
				teamId: ctx.teamId,
				eventTypeId: tipoPg!.id,
				title: 'PG de 50 dias atrás',
				startsAt: new Date(agora - 50 * DIA_MS)
			})
			.returning({ id: eventTable.id });

		const [pgFuturo] = await ctx.db
			.insert(eventTable)
			.values({
				teamId: ctx.teamId,
				eventTypeId: tipoPg!.id,
				title: 'Próximo PG',
				startsAt: new Date(agora + 4 * DIA_MS)
			})
			.returning({ id: eventTable.id });

		// Presenças:
		// - PG recente (7d): 3 dos 4 membros ativos presentes → taxa 75%, chamadas 1, média 3
		// - PG antigo (50d): membro ausente → para Membro nos últimos 90d: 1 de 2 (50%)
		await ctx.db.insert(presence).values([
			{
				eventId: pgRecente!.id,
				personId: liderId,
				status: 'present',
				registrationMethod: 'manual'
			},
			{
				eventId: pgRecente!.id,
				personId: conselheiroId,
				status: 'present',
				registrationMethod: 'manual'
			},
			{
				eventId: pgRecente!.id,
				personId: membroId,
				status: 'present',
				registrationMethod: 'manual'
			},
			{
				eventId: pgRecente!.id,
				personId: membroSemGrupoId,
				status: 'absent',
				registrationMethod: 'manual'
			},
			{ eventId: pgAntigo!.id, personId: liderId, status: 'present', registrationMethod: 'manual' },
			{ eventId: pgAntigo!.id, personId: membroId, status: 'absent', registrationMethod: 'manual' }
		]);

		// Convites: 1 aberto válido + 1 expirado + 1 já usado + 1 revogado (só o primeiro deve contar)
		await ctx.db.insert(invite).values([
			{
				teamId: ctx.teamId,
				personId: recorrenteRecenteId,
				tokenHash: 'hash-aberto-1',
				createdByPersonId: liderId,
				expiresAt: new Date(agora + 5 * DIA_MS)
			},
			{
				teamId: ctx.teamId,
				personId: recorrenteRecenteId,
				tokenHash: 'hash-expirado',
				createdByPersonId: liderId,
				createdAt: new Date(agora - 10 * DIA_MS),
				expiresAt: new Date(agora - DIA_MS)
			},
			{
				teamId: ctx.teamId,
				personId: recorrenteRecenteId,
				tokenHash: 'hash-usado',
				createdByPersonId: liderId,
				expiresAt: new Date(agora + 5 * DIA_MS),
				usedAt: new Date(agora - DIA_MS)
			},
			{
				teamId: ctx.teamId,
				personId: recorrenteRecenteId,
				tokenHash: 'hash-revogado',
				createdByPersonId: liderId,
				expiresAt: new Date(agora + 5 * DIA_MS),
				revokedAt: new Date(agora - DIA_MS)
			}
		]);

		// Responsabilidades e escalas futuras: 1 proposta + 1 confirmada (só proposta conta)
		const [respMensagem] = await ctx.db
			.insert(responsabilidade)
			.values({ teamId: ctx.teamId, nome: 'Mensagem' })
			.returning({ id: responsabilidade.id });
		const [respMusica] = await ctx.db
			.insert(responsabilidade)
			.values({ teamId: ctx.teamId, nome: 'Música' })
			.returning({ id: responsabilidade.id });

		await ctx.db.insert(escala).values([
			{
				eventId: pgFuturo!.id,
				responsabilidadeId: respMensagem!.id,
				personId: membroId,
				status: 'proposta',
				origem: 'gerada'
			},
			{
				eventId: pgFuturo!.id,
				responsabilidadeId: respMusica!.id,
				personId: conselheiroId,
				status: 'confirmada',
				origem: 'manual'
			}
		]);

		// Financeiro:
		// - 2 entradas confirmadas do Membro (15000 + 10000 = 25000, qtd 2)
		// - 1 entrada geral confirmada (50000) → arrecadado = 75000
		// - 1 saída confirmada (20000) → saldo = 55000
		// - 1 saída pendente_aprovacao (8000) → despesasPendentes = 1
		const [catEntrada] = await ctx.db
			.insert(financeCategory)
			.values({
				teamId: ctx.teamId,
				name: 'Contribuição',
				slug: 'contribuicao',
				kind: 'entrada'
			})
			.returning({ id: financeCategory.id });
		const [catSaida] = await ctx.db
			.insert(financeCategory)
			.values({
				teamId: ctx.teamId,
				name: 'Lanche',
				slug: 'lanche',
				kind: 'saida'
			})
			.returning({ id: financeCategory.id });

		await ctx.db.insert(financeTransaction).values([
			{
				teamId: ctx.teamId,
				categoryId: catEntrada!.id,
				kind: 'entrada',
				amountCents: 15000,
				occurredAt: new Date(agora - 15 * DIA_MS),
				paymentMethod: 'pix',
				description: 'Contribuição outubro',
				responsiblePersonId: liderId,
				personId: membroId,
				status: 'confirmada'
			},
			{
				teamId: ctx.teamId,
				categoryId: catEntrada!.id,
				kind: 'entrada',
				amountCents: 10000,
				occurredAt: new Date(agora - 5 * DIA_MS),
				paymentMethod: 'pix',
				description: 'Contribuição novembro',
				responsiblePersonId: liderId,
				personId: membroId,
				status: 'confirmada'
			},
			{
				teamId: ctx.teamId,
				categoryId: catEntrada!.id,
				kind: 'entrada',
				amountCents: 50000,
				occurredAt: new Date(agora - 20 * DIA_MS),
				paymentMethod: 'pix',
				description: 'Caixa geral',
				responsiblePersonId: liderId,
				status: 'confirmada'
			},
			{
				teamId: ctx.teamId,
				categoryId: catSaida!.id,
				kind: 'saida',
				amountCents: 20000,
				occurredAt: new Date(agora - 4 * DIA_MS),
				paymentMethod: 'pix',
				description: 'Lanche PG',
				responsiblePersonId: liderId,
				status: 'confirmada'
			},
			{
				teamId: ctx.teamId,
				categoryId: catSaida!.id,
				kind: 'saida',
				amountCents: 8000,
				occurredAt: new Date(agora - DIA_MS),
				paymentMethod: 'pix',
				description: 'Material aguardando aprovação',
				responsiblePersonId: conselheiroId,
				status: 'pendente_aprovacao'
			}
		]);

		// Sugestões de IA pendentes: 1 analítica + 1 financeira (para testar RN-26 + feature flag)
		await ctx.db.insert(aiSuggestion).values([
			{
				teamId: ctx.teamId,
				kind: 'sinais_atencao',
				requestedByPersonId: liderId,
				inputSnapshot: {},
				output: {},
				status: 'pendente'
			},
			{
				teamId: ctx.teamId,
				kind: 'resumo_financeiro',
				requestedByPersonId: liderId,
				inputSnapshot: {},
				output: {},
				status: 'pendente'
			},
			{
				teamId: ctx.teamId,
				kind: 'sinais_atencao',
				requestedByPersonId: liderId,
				inputSnapshot: {},
				output: {},
				status: 'aceita'
			}
		]);

		// Notificações: 2 não lidas + 1 lida para Líder; 1 não lida para Membro
		await ctx.db.insert(notification).values([
			{
				teamId: ctx.teamId,
				personId: liderId,
				kind: 'financeiro',
				title: 'Despesa pendente',
				body: 'Há uma despesa aguardando aprovação.'
			},
			{
				teamId: ctx.teamId,
				personId: liderId,
				kind: 'escala',
				title: 'Escala proposta',
				body: 'Revise a escala do próximo PG.'
			},
			{
				teamId: ctx.teamId,
				personId: liderId,
				kind: 'sistema',
				title: 'Aviso lido',
				body: 'Já foi lido.',
				readAt: new Date(agora - DIA_MS)
			},
			{
				teamId: ctx.teamId,
				personId: membroId,
				kind: 'evento',
				title: 'Próximo PG',
				body: 'Confirme sua presença.'
			}
		]);

		tokenLider = await tokenPara(ctx.db, liderId);
		tokenConselheiro = await tokenPara(ctx.db, conselheiroId);
		tokenMembro = await tokenPara(ctx.db, membroId);
		tokenVisitante = await tokenPara(ctx.db, visitanteId);
	}, 60_000);

	afterAll(async () => {
		setTestDatabase(null);
		await ctx?.fechar();
	});

	it('Líder recebe resumo financeiro, frequência PG 30d, pessoas novas, subgrupos, pendências e notificações não lidas', async () => {
		const res = await inicioRoute.GET({
			request: req('GET', '/api/inicio', tokenLider),
			locals: {}
		} as any);
		expect(res.status).toBe(200);
		const d = await res.json();

		expect(d.notificacoesNaoLidas).toBe(2);
		expect(d.dashboard).toBeDefined();
		expect(d.dashboard.perfil).toBe('lider');

		// Frequência PG 30d (3 de 4 membros ativos no PG de 7 dias atrás; Master excluído)
		expect(d.dashboard.frequenciaPg30d).toEqual({
			taxaPresenca: 75,
			chamadas: 1,
			mediaPresentes: 3
		});

		// Pessoas novas 30d: Visitante Diana + Recorrente Felipe = 2 (exclui Master, antigo e removido)
		expect(d.dashboard.pessoasNovas30d).toBe(2);

		// Subgrupos: 2 ativos (exclui arquivado), 3 alocadas (exclui Master), 1 membro sem subgrupo (Elisa)
		expect(d.dashboard.subgrupos).toEqual({
			ativos: 2,
			pessoasAlocadas: 3,
			membrosSemSubgrupo: 1
		});

		// Financeiro (exclusivo de quem tem finance.view_all)
		expect(d.dashboard.financeiro).toEqual({
			arrecadadoCents: 75000,
			despesasCents: 20000,
			saldoCents: 55000
		});

		// Pendências (IA ainda desligada por padrão RN-29 → sugestoesIaPendentes ausente)
		expect(d.dashboard.pendencias).toEqual({
			convitesAbertos: 1,
			escalasPropostas: 1,
			despesasPendentes: 1
		});
		expect(d.dashboard.pendencias.sugestoesIaPendentes).toBeUndefined();

		// Ao ligar `ia_assistente`, sugestões pendentes passam a aparecer respeitando escopo
		const resFlag = await flagsRoute.PUT({
			request: req('PUT', '/api/admin/flags', tokenLider, {
				key: 'ia_assistente',
				enabled: true
			}),
			locals: {}
		} as any);
		expect(resFlag.status).toBe(200);

		const resComIa = await inicioRoute.GET({
			request: req('GET', '/api/inicio', tokenLider),
			locals: {}
		} as any);
		const dComIa = await resComIa.json();
		expect(dComIa.dashboard.pendencias.sugestoesIaPendentes).toBe(2);
	});

	it('Conselheiro recebe frequência, subgrupos e pendências operacionais, mas NUNCA recebe financeiro nem despesas pendentes', async () => {
		const res = await inicioRoute.GET({
			request: req('GET', '/api/inicio', tokenConselheiro),
			locals: {}
		} as any);
		expect(res.status).toBe(200);
		const d = await res.json();

		expect(d.notificacoesNaoLidas).toBe(0);
		expect(d.dashboard.perfil).toBe('conselheiro');
		expect(d.dashboard.frequenciaPg30d).toEqual({
			taxaPresenca: 75,
			chamadas: 1,
			mediaPresentes: 3
		});
		expect(d.dashboard.pessoasNovas30d).toBe(2);
		expect(d.dashboard.subgrupos).toEqual({
			ativos: 2,
			pessoasAlocadas: 3,
			membrosSemSubgrupo: 1
		});
		expect(d.dashboard.pendencias.convitesAbertos).toBe(1);
		expect(d.dashboard.pendencias.escalasPropostas).toBe(1);
		// RN-26: com `ia_assistente` ligada, vê apenas a sugestão analítica, não a financeira
		expect(d.dashboard.pendencias.sugestoesIaPendentes).toBe(1);

		// Segurança: ZERO dado financeiro de equipe ou pendência de aprovação de despesa
		expect('financeiro' in d.dashboard).toBe(false);
		expect(d.dashboard.financeiro).toBeUndefined();
		expect('despesasPendentes' in d.dashboard.pendencias).toBe(false);
		expect(d.dashboard.pendencias.despesasPendentes).toBeUndefined();
	});

	it('Membro recebe meuSubgrupo, minhasContribuicoes e minhaFrequencia90d, mas NUNCA recebe dados financeiros/admin da equipe', async () => {
		const res = await inicioRoute.GET({
			request: req('GET', '/api/inicio', tokenMembro),
			locals: {}
		} as any);
		expect(res.status).toBe(200);
		const d = await res.json();

		expect(d.notificacoesNaoLidas).toBe(1);
		expect(d.dashboard.perfil).toBe('membro');
		expect(d.dashboard.meuSubgrupo).toEqual({ id: pgAzulId, nome: 'PG Azul' });
		expect(d.dashboard.minhaFrequencia90d).toEqual({
			taxa: 50,
			presencas: 1,
			esperados: 2
		});
		expect(d.dashboard.minhasContribuicoes).toEqual({
			totalCents: 25000,
			quantidade: 2
		});

		// Segurança: ZERO métrica da equipe ou administrativa
		expect(d.dashboard.financeiro).toBeUndefined();
		expect(d.dashboard.frequenciaPg30d).toBeUndefined();
		expect(d.dashboard.pessoasNovas30d).toBeUndefined();
		expect(d.dashboard.subgrupos).toBeUndefined();
		expect(d.dashboard.pendencias).toBeUndefined();
	});

	it('Visitante recebe apenas `{ perfil: "visitante" }` sem nenhuma métrica interna', async () => {
		const res = await inicioRoute.GET({
			request: req('GET', '/api/inicio', tokenVisitante),
			locals: {}
		} as any);
		expect(res.status).toBe(200);
		const d = await res.json();

		expect(d.notificacoesNaoLidas).toBe(0);
		expect(d.dashboard).toEqual({ perfil: 'visitante' });
		expect(Object.keys(d.dashboard)).toEqual(['perfil']);
	});
});

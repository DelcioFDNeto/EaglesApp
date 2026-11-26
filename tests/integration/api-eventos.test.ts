/**
 * Testes de integração reais dos handlers de M05 (Eventos) e M06 (Presença/Check-in)
 * contra PGlite (PostgreSQL real em WASM).
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { criarBancoDeTeste, type BancoDeTeste } from './helpers/banco';
import { setTestDatabase } from '../../src/lib/server/db';
import {
	eventType,
	featureFlag,
	group as groupTable,
	groupMember,
	person as personTable,
	personRole as personRoleTable,
	team as teamTable,
	userAccount as userAccountTable
} from '../../src/lib/server/db/schema';
import { hashPassword } from '../../src/lib/server/auth/password';
import { tokenPara } from './helpers/token';
import { resetEnvCache } from '../../src/lib/server/env';

import * as eventosRoute from '../../src/routes/api/eventos/+server';
import * as eventoDetalheRoute from '../../src/routes/api/eventos/[id]/+server';
import * as inscricoesRoute from '../../src/routes/api/eventos/[id]/inscricoes/+server';
import * as presencaRoute from '../../src/routes/api/eventos/[id]/presenca/+server';
import * as relatorioRoute from '../../src/routes/api/eventos/[id]/relatorio-presenca/+server';
import * as checkinRoute from '../../src/routes/api/eventos/[id]/checkin/+server';
import * as checkinScanRoute from '../../src/routes/api/eventos/[id]/checkin-scan/+server';

let ctx: BancoDeTeste;
let liderId: string;
let membroId: string;
let outroTimeMembroId: string;
let tokenLider: string;
let tokenMembro: string;
let tokenOutroTime: string;
let grupoId: string;
let tipoEventoId: string;

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

async function criarPessoa(
	teamId: string,
	nome: string,
	email: string,
	roleId: string,
	scopeType: 'global' | 'group' | 'self',
	scopeId: string | null = null
) {
	const [p] = await ctx.db
		.insert(personTable)
		.values({ teamId, fullName: nome })
		.returning({ id: personTable.id });
	if (!p) throw new Error('falha ao criar pessoa');

	await ctx.db.insert(userAccountTable).values({
		personId: p.id,
		email,
		passwordHash: await hashPassword('senha12345')
	});

	await ctx.db.insert(personRoleTable).values({
		personId: p.id,
		roleId,
		scopeType,
		scopeId
	});

	return p.id;
}

describe('M05 e M06 — Handlers reais de Eventos, RSVP, Presença e Check-in', () => {
	beforeAll(async () => {
		process.env.DATABASE_URL = 'postgres://teste@localhost:5432/teste';
		process.env.PUBLIC_ORIGIN = 'https://app.eagles.test';
		process.env.NODE_ENV = 'test';
		resetEnvCache();

		ctx = await criarBancoDeTeste();
		setTestDatabase(ctx.db);

		const [g] = await ctx.db
			.insert(groupTable)
			.values({
				teamId: ctx.teamId,
				name: 'PG Alpha',
				slug: 'pg-alpha',
				description: 'Grupo de teste'
			})
			.returning({ id: groupTable.id });
		grupoId = g!.id;

		liderId = await criarPessoa(
			ctx.teamId,
			'Líder Ana',
			'ana@eagles.test',
			ctx.papeis.lider!,
			'global'
		);
		membroId = await criarPessoa(
			ctx.teamId,
			'Membro João',
			'joao@eagles.test',
			ctx.papeis.membro!,
			'self'
		);

		await ctx.db.insert(groupMember).values({
			groupId: grupoId,
			personId: membroId,
			roleKey: 'membro'
		});

		// Outra equipe para validar isolamento multi-equipe (anti-IDOR)
		const [outraEquipe] = await ctx.db
			.insert(teamTable)
			.values({ slug: 'bears', name: 'Bears' })
			.returning({ id: teamTable.id });
		outroTimeMembroId = await criarPessoa(
			outraEquipe!.id,
			'Visitante Bears',
			'bears@test.local',
			ctx.papeis.lider!,
			'global'
		);

		tokenLider = await tokenPara(ctx.db, liderId);
		tokenMembro = await tokenPara(ctx.db, membroId);
		tokenOutroTime = await tokenPara(ctx.db, outroTimeMembroId);

		const [te] = await ctx.db
			.insert(eventType)
			.values({
				teamId: ctx.teamId,
				name: 'Encontro',
				slug: 'encontro',
				color: '#A91825'
			})
			.returning({ id: eventType.id });
		tipoEventoId = te!.id;
	}, 60_000);

	afterAll(async () => {
		setTestDatabase(null);
		await ctx?.fechar();
	});

	let eventoId: string;

	beforeEach(async () => {
		const res = await eventosRoute.POST({
			request: req('POST', '/api/eventos', tokenLider, {
				eventTypeId: tipoEventoId,
				title: 'PG Quinta-feira',
				startsAt: new Date(Date.now() + 86_400_000).toISOString(),
				endsAt: new Date(Date.now() + 93_600_000).toISOString(),
				location: 'Casa da Ana',
				groupId: grupoId,
				rsvpEnabled: true
			}),
			locals: {}
		} as any);
		expect(res.status).toBe(201);
		const body = await res.json();
		eventoId = body.evento.id;
	});

	it('bloqueia criação de evento por membro comum (403) e retorna rsvpOptions no detalhe', async () => {
		const resNegado = await eventosRoute.POST({
			request: req('POST', '/api/eventos', tokenMembro, {
				eventTypeId: tipoEventoId,
				title: 'Tentativa membro',
				startsAt: new Date(Date.now() + 86_400_000).toISOString()
			}),
			locals: {}
		} as any);
		expect(resNegado.status).toBe(403);

		const resDetalhe = await eventoDetalheRoute.GET({
			request: req('GET', `/api/eventos/${eventoId}`, tokenMembro),
			params: { id: eventoId },
			locals: {}
		} as any);
		expect(resDetalhe.status).toBe(200);
		const detalhe = await resDetalhe.json();
		expect(Array.isArray(detalhe.evento.rsvpOptions)).toBe(true);
		expect(detalhe.evento.rsvpOptions.length).toBeGreaterThan(0);

		// Isolamento entre equipes (IDOR)
		const resOutroTime = await eventoDetalheRoute.GET({
			request: req('GET', `/api/eventos/${eventoId}`, tokenOutroTime),
			params: { id: eventoId },
			locals: {}
		} as any);
		expect(resOutroTime.status).toBe(404);
	});

	it('valida opção de RSVP, impede membro de marcar presença e respeita RN-15 no relatório', async () => {
		// Opção inválida é recusada
		const resInvalido = await inscricoesRoute.POST({
			request: req('POST', `/api/eventos/${eventoId}/inscricoes`, tokenMembro, {
				option: 'opcao_inexistente'
			}),
			params: { id: eventoId },
			locals: {}
		} as any);
		expect(resInvalido.status).toBe(400);

		// Membro responde "nao_vou" (não deve contar como falta!) e líder responde "confirmado"
		const resNaoVou = await inscricoesRoute.POST({
			request: req('POST', `/api/eventos/${eventoId}/inscricoes`, tokenMembro, {
				option: 'nao_vou'
			}),
			params: { id: eventoId },
			locals: {}
		} as any);
		expect(resNaoVou.status).toBe(200);

		const resConfirma = await inscricoesRoute.POST({
			request: req('POST', `/api/eventos/${eventoId}/inscricoes`, tokenLider, {
				option: 'confirmado'
			}),
			params: { id: eventoId },
			locals: {}
		} as any);
		expect(resConfirma.status).toBe(200);

		// Membro não pode marcar presença (403)
		const resPresencaMembro = await presencaRoute.POST({
			request: req('POST', `/api/eventos/${eventoId}/presenca`, tokenMembro, {
				personId: membroId,
				status: 'present'
			}),
			params: { id: eventoId },
			locals: {}
		} as any);
		expect(resPresencaMembro.status).toBe(403);

		// Líder registra presença do próprio líder
		const resPresencaLider = await presencaRoute.POST({
			request: req('POST', `/api/eventos/${eventoId}/presenca`, tokenLider, {
				personId: liderId,
				status: 'present'
			}),
			params: { id: eventoId },
			locals: {}
		} as any);
		expect(resPresencaLider.status).toBe(200);

		// GET /presenca com notExists real não dá erro 500 e devolve resumo real para líder
		const resListaLider = await presencaRoute.GET({
			request: req('GET', `/api/eventos/${eventoId}/presenca`, tokenLider),
			params: { id: eventoId },
			locals: {}
		} as any);
		expect(resListaLider.status).toBe(200);
		const listaLider = await resListaLider.json();
		expect(listaLider.resumo.totalInscritos).toBe(1); // apenas quem confirmou positivo (RN-15)
		expect(listaLider.resumo.totalPresencas).toBe(1);
		expect(listaLider.resumo.totalAusentes).toBe(0);
		expect(listaLider.inscritosSemPresenca.map((p: any) => p.id)).toContain(membroId);

		// Membro não acessa relatório geral (anti-vigilância)
		const resRelatorioMembro = await relatorioRoute.GET({
			request: req('GET', `/api/eventos/${eventoId}/relatorio-presenca`, tokenMembro),
			params: { id: eventoId },
			locals: {}
		} as any);
		expect(resRelatorioMembro.status).toBe(403);

		// Líder obtém relatório com contadores reais (não zerados)
		const resRelatorioLider = await relatorioRoute.GET({
			request: req('GET', `/api/eventos/${eventoId}/relatorio-presenca`, tokenLider),
			params: { id: eventoId },
			locals: {}
		} as any);
		expect(resRelatorioLider.status).toBe(200);
		const relatorio = await resRelatorioLider.json();
		expect(relatorio.resumo.totalInscritos).toBe(1);
		expect(relatorio.resumo.totalPresencas).toBe(1);
		expect(relatorio.resumo.taxaPresenca).toBe(100);
	});

	it('bloqueia check-in QR quando feature flag está desligada (RN-14/RN-29) e impede forjar personId quando ligada', async () => {
		// Por padrão (RN-29), checkin_qrcode nasce desligada → 403
		const resDesligado = await checkinRoute.POST({
			request: req('POST', `/api/eventos/${eventoId}/checkin`, tokenLider, {
				expiresInMinutes: 60
			}),
			params: { id: eventoId },
			locals: {}
		} as any);
		expect(resDesligado.status).toBe(403);

		// Habilita explicitamente a flag checkin_qrcode
		await ctx.db.insert(featureFlag).values({
			teamId: ctx.teamId,
			key: 'checkin_qrcode',
			enabled: true,
			description: 'Check-in por QR Code'
		});

		const resGerar = await checkinRoute.POST({
			request: req('POST', `/api/eventos/${eventoId}/checkin`, tokenLider, {
				expiresInMinutes: 60
			}),
			params: { id: eventoId },
			locals: {}
		} as any);
		expect(resGerar.status).toBe(201);
		const { qrCode } = await resGerar.json();

		// Membro não pode ler o QR Code pelo GET (403)
		const resGetMembro = await checkinRoute.GET({
			request: req('GET', `/api/eventos/${eventoId}/checkin`, tokenMembro),
			params: { id: eventoId },
			locals: {}
		} as any);
		expect(resGetMembro.status).toBe(403);

		// Membro escaneia QR Code tentando passar personId de outro — grava para o PRÓPRIO membro
		const resScan = await checkinScanRoute.POST({
			request: req('POST', `/api/eventos/${eventoId}/checkin-scan`, tokenMembro, {
				qrCode,
				personId: liderId
			}),
			params: { id: eventoId },
			locals: {}
		} as any);
		expect(resScan.status).toBe(200);
		const scanBody = await resScan.json();
		expect(scanBody.personId).toBe(membroId);
	});
});

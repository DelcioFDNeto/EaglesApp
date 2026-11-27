/**
 * Testes de integração do fluxo completo de Check-in por QR Code (§9 / RN-14 / RN-29)
 * contra PGlite (PostgreSQL real em WASM).
 */

import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { criarBancoDeTeste, type BancoDeTeste } from './helpers/banco';
import { setTestDatabase } from '../../src/lib/server/db';
import {
	eventCheckin,
	eventType,
	featureFlag,
	group as groupTable,
	groupMember,
	person as personTable,
	personRole as personRoleTable,
	userAccount as userAccountTable
} from '../../src/lib/server/db/schema';
import { hashPassword } from '../../src/lib/server/auth/password';
import { tokenPara } from './helpers/token';
import { resetEnvCache } from '../../src/lib/server/env';

import * as eventosRoute from '../../src/routes/api/eventos/+server';
import * as eventoDetalheRoute from '../../src/routes/api/eventos/[id]/+server';
import * as presencaRoute from '../../src/routes/api/eventos/[id]/presenca/+server';
import * as checkinRoute from '../../src/routes/api/eventos/[id]/checkin/+server';
import * as checkinScanRoute from '../../src/routes/api/eventos/[id]/checkin-scan/+server';

let ctx: BancoDeTeste;
let liderId: string;
let membroId: string;
let tokenLider: string;
let tokenMembro: string;
let grupoId: string;
let tipoEventoId: string;
let eventoId: string;

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
	scopeType: 'global' | 'group' | 'self'
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
		scopeId: null
	});

	return p.id;
}

async function definirFlagCheckin(enabled: boolean) {
	await ctx.db
		.insert(featureFlag)
		.values({
			teamId: ctx.teamId,
			key: 'checkin_qrcode',
			enabled,
			description: 'Check-in opcional por QR Code'
		})
		.onConflictDoUpdate({
			target: [featureFlag.teamId, featureFlag.key],
			set: { enabled, updatedAt: new Date() }
		});
}

describe('§9 — Check-in por QR Code: estado no detalhe do evento e ciclo completo', () => {
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
				name: 'PG Águias',
				slug: 'pg-aguias',
				description: 'Grupo para teste de check-in QR'
			})
			.returning({ id: groupTable.id });
		grupoId = g!.id;

		liderId = await criarPessoa(
			ctx.teamId,
			'Líder Marcos',
			'marcos@eagles.test',
			ctx.papeis.lider!,
			'global'
		);
		membroId = await criarPessoa(
			ctx.teamId,
			'Membro Lucas',
			'lucas@eagles.test',
			ctx.papeis.membro!,
			'self'
		);

		await ctx.db.insert(groupMember).values({
			groupId: grupoId,
			personId: membroId,
			roleKey: 'membro'
		});

		tokenLider = await tokenPara(ctx.db, liderId);
		tokenMembro = await tokenPara(ctx.db, membroId);

		const [te] = await ctx.db
			.insert(eventType)
			.values({
				teamId: ctx.teamId,
				name: 'Encontro PG',
				slug: 'encontro-pg',
				color: '#A91825'
			})
			.returning({ id: eventType.id });
		tipoEventoId = te!.id;
	}, 60_000);

	afterAll(async () => {
		setTestDatabase(null);
		await ctx?.fechar();
	});

	beforeEach(async () => {
		await ctx.db.delete(featureFlag).where(eq(featureFlag.teamId, ctx.teamId));

		const res = await eventosRoute.POST({
			request: req('POST', '/api/eventos', tokenLider, {
				eventTypeId: tipoEventoId,
				title: 'PG de Quinta',
				startsAt: new Date(Date.now() + 3_600_000).toISOString(),
				endsAt: new Date(Date.now() + 10_800_000).toISOString(),
				location: 'Sala Principal',
				groupId: grupoId,
				rsvpEnabled: true
			}),
			locals: {}
		} as any);
		expect(res.status).toBe(201);
		const body = await res.json();
		eventoId = body.evento.id;
	});

	it('retorna checkinQrAtivo: false e meuCheckin: null por padrão (RN-29)', async () => {
		const res = await eventoDetalheRoute.GET({
			request: req('GET', `/api/eventos/${eventoId}`, tokenMembro),
			params: { id: eventoId },
			locals: {}
		} as any);
		expect(res.status).toBe(200);
		const data = await res.json();
		expect(data.checkinQrAtivo).toBe(false);
		expect(data.meuCheckin).toBeNull();
	});

	it('fluxo completo: flag ligada → líder gera QR → membro escaneia → GET /api/eventos/[id] reflete meuCheckin', async () => {
		await definirFlagCheckin(true);

		// Antes de gerar QR: flag ligada, sem check-in pessoal
		const resAntes = await eventoDetalheRoute.GET({
			request: req('GET', `/api/eventos/${eventoId}`, tokenMembro),
			params: { id: eventoId },
			locals: {}
		} as any);
		expect(resAntes.status).toBe(200);
		const antes = await resAntes.json();
		expect(antes.checkinQrAtivo).toBe(true);
		expect(antes.meuCheckin).toBeNull();

		// Sem QR gerado ainda → GET /checkin retorna 404
		const resSemQr = await checkinRoute.GET({
			request: req('GET', `/api/eventos/${eventoId}/checkin`, tokenLider),
			params: { id: eventoId },
			locals: {}
		} as any);
		expect(resSemQr.status).toBe(404);

		// Líder gera QR Code válido por 2 horas
		const resGerar = await checkinRoute.POST({
			request: req('POST', `/api/eventos/${eventoId}/checkin`, tokenLider, {
				expiresInMinutes: 120
			}),
			params: { id: eventoId },
			locals: {}
		} as any);
		expect(resGerar.status).toBe(201);
		const gerado = await resGerar.json();
		expect(gerado.qrCode).toMatch(new RegExp(`^eagles-checkin-${eventoId}-`));

		// GET /checkin devolve o mesmo QR Code ativo para o líder
		const resAtivo = await checkinRoute.GET({
			request: req('GET', `/api/eventos/${eventoId}/checkin`, tokenLider),
			params: { id: eventoId },
			locals: {}
		} as any);
		expect(resAtivo.status).toBe(200);
		const ativo = await resAtivo.json();
		expect(ativo.qrCode).toBe(gerado.qrCode);

		// Membro faz check-in com o código gerado
		const resScan = await checkinScanRoute.POST({
			request: req('POST', `/api/eventos/${eventoId}/checkin-scan`, tokenMembro, {
				qrCode: gerado.qrCode
			}),
			params: { id: eventoId },
			locals: {}
		} as any);
		expect(resScan.status).toBe(200);
		const scan = await resScan.json();
		expect(scan.ok).toBe(true);
		expect(scan.personId).toBe(membroId);

		// GET /api/eventos/[id] para o membro reflete meuCheckin com metodo: 'qr_code'
		const resDepoisMembro = await eventoDetalheRoute.GET({
			request: req('GET', `/api/eventos/${eventoId}`, tokenMembro),
			params: { id: eventoId },
			locals: {}
		} as any);
		expect(resDepoisMembro.status).toBe(200);
		const depoisMembro = await resDepoisMembro.json();
		expect(depoisMembro.checkinQrAtivo).toBe(true);
		expect(depoisMembro.meuCheckin).toMatchObject({
			status: 'present',
			metodo: 'qr_code'
		});

		// Para o líder (que não fez check-in), meuCheckin continua null
		const resDepoisLider = await eventoDetalheRoute.GET({
			request: req('GET', `/api/eventos/${eventoId}`, tokenLider),
			params: { id: eventoId },
			locals: {}
		} as any);
		expect(resDepoisLider.status).toBe(200);
		const depoisLider = await resDepoisLider.json();
		expect(depoisLider.meuCheckin).toBeNull();
	});

	it('rejeita QR Code inválido, desativado ou expirado com 400', async () => {
		await definirFlagCheckin(true);

		const resGerar1 = await checkinRoute.POST({
			request: req('POST', `/api/eventos/${eventoId}/checkin`, tokenLider, {
				expiresInMinutes: 30
			}),
			params: { id: eventoId },
			locals: {}
		} as any);
		expect(resGerar1.status).toBe(201);
		const { qrCode: codigoAntigo } = await resGerar1.json();

		// Código inexistente → 400
		const resInvalido = await checkinScanRoute.POST({
			request: req('POST', `/api/eventos/${eventoId}/checkin-scan`, tokenMembro, {
				qrCode: 'eagles-checkin-invalido-000'
			}),
			params: { id: eventoId },
			locals: {}
		} as any);
		expect(resInvalido.status).toBe(400);

		// Gerar novo QR desativa o anterior → antigo retorna 400
		const resGerar2 = await checkinRoute.POST({
			request: req('POST', `/api/eventos/${eventoId}/checkin`, tokenLider, {
				expiresInMinutes: 60
			}),
			params: { id: eventoId },
			locals: {}
		} as any);
		expect(resGerar2.status).toBe(201);
		const { qrCode: codigoAtual } = await resGerar2.json();

		const resAntigo = await checkinScanRoute.POST({
			request: req('POST', `/api/eventos/${eventoId}/checkin-scan`, tokenMembro, {
				qrCode: codigoAntigo
			}),
			params: { id: eventoId },
			locals: {}
		} as any);
		expect(resAntigo.status).toBe(400);

		// Força expiração no banco respeitando o constraint expires_at > created_at → 400
		await ctx.db
			.update(eventCheckin)
			.set({
				createdAt: new Date(Date.now() - 120_000),
				expiresAt: new Date(Date.now() - 60_000)
			})
			.where(eq(eventCheckin.qrCode, codigoAtual));

		const resExpirado = await checkinScanRoute.POST({
			request: req('POST', `/api/eventos/${eventoId}/checkin-scan`, tokenMembro, {
				qrCode: codigoAtual
			}),
			params: { id: eventoId },
			locals: {}
		} as any);
		expect(resExpirado.status).toBe(400);
		const bodyExpirado = await resExpirado.json();
		expect(bodyExpirado.erro).toContain('expirado');
	});

	it('não considera presença absent como meuCheckin, mas considera late', async () => {
		await definirFlagCheckin(true);

		const resFalta = await presencaRoute.POST({
			request: req('POST', `/api/eventos/${eventoId}/presenca`, tokenLider, {
				personId: membroId,
				status: 'absent',
				registrationMethod: 'manual'
			}),
			params: { id: eventoId },
			locals: {}
		} as any);
		expect(resFalta.status).toBe(200);

		const resDetalheFalta = await eventoDetalheRoute.GET({
			request: req('GET', `/api/eventos/${eventoId}`, tokenMembro),
			params: { id: eventoId },
			locals: {}
		} as any);
		expect((await resDetalheFalta.json()).meuCheckin).toBeNull();

		const resAtraso = await presencaRoute.POST({
			request: req('POST', `/api/eventos/${eventoId}/presenca`, tokenLider, {
				personId: membroId,
				status: 'late',
				registrationMethod: 'manual'
			}),
			params: { id: eventoId },
			locals: {}
		} as any);
		expect(resAtraso.status).toBe(200);

		const resDetalheAtraso = await eventoDetalheRoute.GET({
			request: req('GET', `/api/eventos/${eventoId}`, tokenMembro),
			params: { id: eventoId },
			locals: {}
		} as any);
		expect((await resDetalheAtraso.json()).meuCheckin).toMatchObject({
			status: 'late',
			metodo: 'manual'
		});
	});
});

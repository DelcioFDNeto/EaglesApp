/**
 * Testes de integração reais do §7 (Escala com RSVP + frequência 90d +
 * endpoint GET /api/escalas/[id]/substitutos) contra PGlite.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { criarBancoDeTeste, type BancoDeTeste } from './helpers/banco';
import { setTestDatabase } from '../../src/lib/server/db';
import {
	escala,
	event as eventTable,
	eventRegistration,
	eventType,
	group as groupTable,
	groupMember,
	person as personTable,
	personRole as personRoleTable,
	presence,
	responsabilidade as responsabilidadeTable,
	userAccount as userAccountTable
} from '../../src/lib/server/db/schema';
import { hashPassword } from '../../src/lib/server/auth/password';
import { tokenPara } from './helpers/token';
import { resetEnvCache } from '../../src/lib/server/env';

import * as gerarEscalaRoute from '../../src/routes/api/escalas/gerar/+server';
import * as substitutosRoute from '../../src/routes/api/escalas/[id]/substitutos/+server';

let ctx: BancoDeTeste;

let liderId: string;
let conselheiroAzulId: string;
let conselheiroVerdeId: string;

let membroAusenteId: string;
let membroConfirmadoAtivoId: string;
let membroConfirmadoNovoId: string;
let membroSemRsvpId: string;
let membroTalvezId: string;

let tokenLider: string;
let tokenConselheiroAzul: string;
let tokenConselheiroVerde: string;
let tokenMembro: string;

let grupoAzulId: string;
let grupoVerdeId: string;
let eventoFuturoId: string;
let respMensagemId: string;
let respMusicaId: string;

function req(method: string, path: string, token?: string, body?: unknown): Request {
	const headers: Record<string, string> = { 'Content-Type': 'application/json' };
	if (token) headers.Authorization = `Bearer ${token}`;
	return new Request(`https://app.eagles.test${path}`, {
		method,
		headers,
		body: body !== undefined ? JSON.stringify(body) : undefined
	});
}

async function criarPessoa(opts: {
	nome: string;
	email: string;
	roleId: string;
	scopeType: 'global' | 'group' | 'self';
	scopeId?: string | null;
}) {
	const [p] = await ctx.db
		.insert(personTable)
		.values({ teamId: ctx.teamId, fullName: opts.nome })
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

	return p!.id;
}

describe('§7 — Integração: escala com RSVP/frequência e sugestão de substitutos', () => {
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
		grupoAzulId = gAzul!.id;
		grupoVerdeId = gVerde!.id;

		liderId = await criarPessoa({
			nome: 'Líder Lucas',
			email: 'lider@eagles.test',
			roleId: ctx.papeis.lider!,
			scopeType: 'global'
		});
		conselheiroAzulId = await criarPessoa({
			nome: 'Conselheiro Azul',
			email: 'conselheiro-azul@eagles.test',
			roleId: ctx.papeis.conselheiro!,
			scopeType: 'group',
			scopeId: grupoAzulId
		});
		conselheiroVerdeId = await criarPessoa({
			nome: 'Conselheiro Verde',
			email: 'conselheiro-verde@eagles.test',
			roleId: ctx.papeis.conselheiro!,
			scopeType: 'group',
			scopeId: grupoVerdeId
		});

		membroAusenteId = await criarPessoa({
			nome: 'Arthur Ausente',
			email: 'arthur@eagles.test',
			roleId: ctx.papeis.membro!,
			scopeType: 'self'
		});
		membroConfirmadoAtivoId = await criarPessoa({
			nome: 'Zoe Confirmada Ativa',
			email: 'zoe@eagles.test',
			roleId: ctx.papeis.membro!,
			scopeType: 'self'
		});
		membroConfirmadoNovoId = await criarPessoa({
			nome: 'Bianca Confirmada Nova',
			email: 'bianca@eagles.test',
			roleId: ctx.papeis.membro!,
			scopeType: 'self'
		});
		membroSemRsvpId = await criarPessoa({
			nome: 'Carlos Sem RSVP',
			email: 'carlos@eagles.test',
			roleId: ctx.papeis.membro!,
			scopeType: 'self'
		});
		membroTalvezId = await criarPessoa({
			nome: 'Diana Talvez',
			email: 'diana@eagles.test',
			roleId: ctx.papeis.membro!,
			scopeType: 'self'
		});

		await ctx.db.insert(groupMember).values([
			{ groupId: grupoAzulId, personId: membroAusenteId, roleKey: 'membro' },
			{ groupId: grupoAzulId, personId: membroConfirmadoAtivoId, roleKey: 'membro' },
			{ groupId: grupoAzulId, personId: membroConfirmadoNovoId, roleKey: 'membro' },
			{ groupId: grupoAzulId, personId: membroSemRsvpId, roleKey: 'membro' },
			{ groupId: grupoAzulId, personId: membroTalvezId, roleKey: 'membro' }
		]);

		const [te] = await ctx.db
			.insert(eventType)
			.values({ teamId: ctx.teamId, name: 'PG Semanal', slug: 'pg-semanal' })
			.returning({ id: eventType.id });

		// 3 eventos passados nos últimos 30 dias para registrar frequência 90d
		const agora = Date.now();
		const eventosPassados: string[] = [];
		for (let i = 1; i <= 3; i++) {
			const dataPassada = new Date(agora - i * 7 * 24 * 60 * 60 * 1000);
			const [evPass] = await ctx.db
				.insert(eventTable)
				.values({
					teamId: ctx.teamId,
					eventTypeId: te!.id,
					groupId: grupoAzulId,
					title: `PG Passado ${i}`,
					startsAt: dataPassada
				})
				.returning({ id: eventTable.id });
			eventosPassados.push(evPass!.id);
		}

		// Presenças recentes:
		// - membroAusente: 3 presenças (mesmo assíduo, deve ser pulado por marcar nao_vou!)
		// - membroConfirmadoAtivo: 3 presenças (2 present + 1 late)
		// - membroConfirmadoNovo: 1 presença
		// - membroSemRsvp: 2 presenças
		// - membroTalvez: 2 presenças
		await ctx.db.insert(presence).values([
			{ eventId: eventosPassados[0]!, personId: membroAusenteId, status: 'present' },
			{ eventId: eventosPassados[1]!, personId: membroAusenteId, status: 'present' },
			{ eventId: eventosPassados[2]!, personId: membroAusenteId, status: 'present' },
			{ eventId: eventosPassados[0]!, personId: membroConfirmadoAtivoId, status: 'present' },
			{ eventId: eventosPassados[1]!, personId: membroConfirmadoAtivoId, status: 'late' },
			{ eventId: eventosPassados[2]!, personId: membroConfirmadoAtivoId, status: 'present' },
			{ eventId: eventosPassados[0]!, personId: membroConfirmadoNovoId, status: 'present' },
			{ eventId: eventosPassados[0]!, personId: membroSemRsvpId, status: 'present' },
			{ eventId: eventosPassados[1]!, personId: membroSemRsvpId, status: 'present' },
			{ eventId: eventosPassados[0]!, personId: membroTalvezId, status: 'present' },
			{ eventId: eventosPassados[1]!, personId: membroTalvezId, status: 'present' }
		]);

		// Evento futuro com RSVP customizado + padrão
		const [evFut] = await ctx.db
			.insert(eventTable)
			.values({
				teamId: ctx.teamId,
				eventTypeId: te!.id,
				groupId: grupoAzulId,
				title: 'PG Azul — Próxima Semana',
				startsAt: new Date(agora + 3 * 24 * 60 * 60 * 1000),
				rsvpOptions: [
					{ key: 'confirmado', label: 'Confirmado', confirma: true },
					{ key: 'vou_carona', label: 'Vou de carona', confirma: true },
					{ key: 'talvez', label: 'Talvez', confirma: false },
					{ key: 'nao_vou', label: 'Não vou', confirma: false }
				]
			})
			.returning({ id: eventTable.id });
		eventoFuturoId = evFut!.id;

		// Respostas de RSVP no evento futuro
		await ctx.db.insert(eventRegistration).values([
			{ eventId: eventoFuturoId, personId: membroAusenteId, option: 'nao_vou' },
			{ eventId: eventoFuturoId, personId: membroConfirmadoAtivoId, option: 'confirmado' },
			{ eventId: eventoFuturoId, personId: membroConfirmadoNovoId, option: 'vou_carona' },
			{ eventId: eventoFuturoId, personId: membroTalvezId, option: 'talvez' }
			// membroSemRsvpId não respondeu -> null
		]);

		// Responsabilidades
		const [r1] = await ctx.db
			.insert(responsabilidadeTable)
			.values({
				teamId: ctx.teamId,
				nome: 'Mensagem',
				intervaloMinimoDias: 14,
				ordem: 1
			})
			.returning({ id: responsabilidadeTable.id });
		const [r2] = await ctx.db
			.insert(responsabilidadeTable)
			.values({
				teamId: ctx.teamId,
				nome: 'Música',
				intervaloMinimoDias: 14,
				ordem: 2
			})
			.returning({ id: responsabilidadeTable.id });
		respMensagemId = r1!.id;
		respMusicaId = r2!.id;

		tokenLider = await tokenPara(ctx.db, liderId);
		tokenConselheiroAzul = await tokenPara(ctx.db, conselheiroAzulId);
		tokenConselheiroVerde = await tokenPara(ctx.db, conselheiroVerdeId);
		tokenMembro = await tokenPara(ctx.db, membroSemRsvpId);
	}, 60_000);

	afterAll(async () => {
		setTestDatabase(null);
		await ctx?.fechar();
	});

	it('POST /api/escalas/gerar pula quem marcou nao_vou e prioriza confirmado + maior frequência 90d', async () => {
		const res = await gerarEscalaRoute.POST({
			request: req('POST', '/api/escalas/gerar', tokenLider, {
				eventoId: eventoFuturoId,
				responsabilidadeIds: [respMensagemId, respMusicaId]
			}),
			locals: {}
		} as any);

		expect(res.status).toBe(201);
		const body = await res.json();
		expect(body.ok).toBe(true);
		expect(body.itens).toHaveLength(2);

		// Nenhum item pode conter quem marcou `nao_vou`
		expect(body.itens.some((i: any) => i.personId === membroAusenteId)).toBe(false);

		// Mensagem (ordem 1): Zoe (confirmado + 3 presenças em 90d) ganha de Bianca (confirmado + 1 presença)
		const itemMensagem = body.itens.find((i: any) => i.responsabilidadeId === respMensagemId);
		expect(itemMensagem.personId).toBe(membroConfirmadoAtivoId);
		expect(itemMensagem.justificativa.toLowerCase()).toContain('presença confirmada');
		expect(itemMensagem.justificativa).toContain('3 presenças');

		// Música (ordem 2): Bianca (vou_carona => confirmado via rsvpOptions) vem antes de sem RSVP e talvez
		const itemMusica = body.itens.find((i: any) => i.responsabilidadeId === respMusicaId);
		expect(itemMusica.personId).toBe(membroConfirmadoNovoId);
	});

	it('GET /api/escalas/[id]/substitutos retorna substitutos ranqueados para conselheiro/lider e 403 para membro ou outro grupo', async () => {
		// Cria uma atribuição para o membroConfirmadoAtivoId na responsabilidade Mensagem
		const [itemMensagem] = await ctx.db
			.select({ id: escala.id })
			.from(escala)
			.where(and(eq(escala.eventId, eventoFuturoId), eq(escala.responsabilidadeId, respMensagemId)))
			.limit(1);

		expect(itemMensagem).toBeTruthy();
		const escalaId = itemMensagem!.id;

		// Sem autenticação -> 401
		const res401 = await substitutosRoute.GET({
			request: req('GET', `/api/escalas/${escalaId}/substitutos`),
			params: { id: escalaId },
			locals: {}
		} as any);
		expect(res401.status).toBe(401);

		// Membro -> 403
		const resMembro = await substitutosRoute.GET({
			request: req('GET', `/api/escalas/${escalaId}/substitutos`, tokenMembro),
			params: { id: escalaId },
			locals: {}
		} as any);
		expect(resMembro.status).toBe(403);

		// Conselheiro de outro grupo (PG Verde) -> 403
		const resOutroConselheiro = await substitutosRoute.GET({
			request: req('GET', `/api/escalas/${escalaId}/substitutos`, tokenConselheiroVerde),
			params: { id: escalaId },
			locals: {}
		} as any);
		expect(resOutroConselheiro.status).toBe(403);

		// Conselheiro do PG Azul -> 200 com top 3 ranqueados
		const resConselheiro = await substitutosRoute.GET({
			request: req('GET', `/api/escalas/${escalaId}/substitutos`, tokenConselheiroAzul),
			params: { id: escalaId },
			locals: {}
		} as any);
		expect(resConselheiro.status).toBe(200);
		const dCons = await resConselheiro.json();
		expect(dCons.ok).toBe(true);
		expect(dCons.substitutos).toHaveLength(3);

		// Exclui pessoa atual (membroConfirmadoAtivoId) e quem marcou nao_vou (membroAusenteId)
		const idsSugeridos = dCons.substitutos.map((s: any) => s.personId);
		expect(idsSugeridos).not.toContain(membroConfirmadoAtivoId);
		expect(idsSugeridos).not.toContain(membroAusenteId);

		// Ordem esperada:
		// 1º: Carlos (livre no evento, rsvp null)
		// 2º: Diana (livre no evento, rsvp talvez)
		// 3º: Bianca (já escalada em Música neste evento, rsvp confirmado)
		expect(idsSugeridos).toEqual([membroSemRsvpId, membroTalvezId, membroConfirmadoNovoId]);
		expect(dCons.substitutos[0]).toMatchObject({
			personId: membroSemRsvpId,
			respeitaIntervalo: true,
			rsvp: null,
			carga90Dias: 0,
			frequencia90d: 2
		});
		expect(typeof dCons.substitutos[0].justificativa).toBe('string');

		// Líder global -> 200 com mesmo resultado
		const resLider = await substitutosRoute.GET({
			request: req('GET', `/api/escalas/${escalaId}/substitutos`, tokenLider),
			params: { id: escalaId },
			locals: {}
		} as any);
		expect(resLider.status).toBe(200);
		const dLider = await resLider.json();
		expect(dLider.substitutos.map((s: any) => s.personId)).toEqual(idsSugeridos);
	});
});

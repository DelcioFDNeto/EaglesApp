/**
 * Testes de integração reais do sistema de Notificações (§19 / F6 / RN-29) contra PGlite.
 * Cobre feature flag, gatilhos baseados em eventos, lembretes agendados + deduplicação,
 * janela de silêncio, opt-out por categoria, limite diário, API de leitura/marcação e Web Push.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { criarBancoDeTeste, type BancoDeTeste } from './helpers/banco';
import { setTestDatabase } from '../../src/lib/server/db';
import {
	event as eventTable,
	eventRegistration,
	eventType,
	featureFlag,
	financeCategory,
	group as groupTable,
	groupMember,
	notification,
	notificationPreference,
	person as personTable,
	personRole as personRoleTable,
	responsabilidade,
	userAccount as userAccountTable
} from '../../src/lib/server/db/schema';
import { hashPassword } from '../../src/lib/server/auth/password';
import { tokenPara } from './helpers/token';
import { resetEnvCache } from '../../src/lib/server/env';
import {
	estaEmSilencio,
	gerarLembretesAutomaticos,
	notificarPessoa
} from '../../src/lib/server/notificacoes/motor';

import * as notificacoesRoute from '../../src/routes/api/notificacoes/+server';
import * as gerarRoute from '../../src/routes/api/notificacoes/gerar/+server';
import * as pushRoute from '../../src/routes/api/notificacoes/push/+server';
import * as anunciosRoute from '../../src/routes/api/comunicacao/anuncios/+server';
import * as transferenciasRoute from '../../src/routes/api/grupos/transferencias/+server';
import * as escalasRoute from '../../src/routes/api/escalas/+server';
import * as movimentacoesRoute from '../../src/routes/api/financeiro/movimentacoes/+server';

let ctx: BancoDeTeste;
let liderId: string;
let conselheiroId: string;
let membroAId: string;
let membroBId: string;
let visitanteId: string;

let tokenLider: string;
let tokenConselheiro: string;
let tokenMembroA: string;
let tokenMembroB: string;
let tokenVisitante: string;

let grupoAId: string;
let grupoBId: string;
let tipoEventoId: string;
let respId: string;
let categoriaEntradaId: string;

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
	nome: string,
	email: string,
	roleId: string,
	scopeType: 'global' | 'group' | 'self',
	scopeId: string | null = null
) {
	const [p] = await ctx.db
		.insert(personTable)
		.values({ teamId: ctx.teamId, fullName: nome })
		.returning({ id: personTable.id });

	await ctx.db.insert(userAccountTable).values({
		personId: p!.id,
		email,
		passwordHash: await hashPassword('senha12345')
	});

	await ctx.db.insert(personRoleTable).values({
		personId: p!.id,
		roleId,
		scopeType,
		scopeId
	});

	return p!.id;
}

describe('§19 — Notificações in-app, lembretes automáticos, gatilhos e Web Push', () => {
	beforeAll(async () => {
		process.env.DATABASE_URL = 'postgres://teste@localhost:5432/teste';
		process.env.PUBLIC_ORIGIN = 'https://app.eagles.test';
		process.env.NODE_ENV = 'test';
		resetEnvCache();

		ctx = await criarBancoDeTeste();
		setTestDatabase(ctx.db);

		const [gA] = await ctx.db
			.insert(groupTable)
			.values({ teamId: ctx.teamId, name: 'PG Águia', slug: 'pg-aguia' })
			.returning({ id: groupTable.id });
		const [gB] = await ctx.db
			.insert(groupTable)
			.values({ teamId: ctx.teamId, name: 'PG Falcão', slug: 'pg-falcao' })
			.returning({ id: groupTable.id });
		grupoAId = gA!.id;
		grupoBId = gB!.id;

		liderId = await criarPessoa('Líder Marcos', 'marcos@eagles.test', ctx.papeis.lider!, 'global');
		conselheiroId = await criarPessoa(
			'Conselheira Júlia',
			'julia@eagles.test',
			ctx.papeis.conselheiro!,
			'global'
		);
		membroAId = await criarPessoa('Membro Lucas', 'lucas@eagles.test', ctx.papeis.membro!, 'self');
		membroBId = await criarPessoa('Membro Sofia', 'sofia@eagles.test', ctx.papeis.membro!, 'self');
		visitanteId = await criarPessoa(
			'Visitante Pedro',
			'pedro@eagles.test',
			ctx.papeis.visitante!,
			'self'
		);

		await ctx.db.insert(groupMember).values([
			{ groupId: grupoAId, personId: membroAId, roleKey: 'membro' },
			{ groupId: grupoBId, personId: membroBId, roleKey: 'membro' }
		]);

		// Sem janela de silêncio para membroA e membroB durante os testes de gatilhos em tempo real
		// (garante determinismo em qualquer horário de execução do vitest).
		await ctx.db.insert(notificationPreference).values([
			{ personId: membroAId, quietStartHour: 0, quietEndHour: 0 },
			{ personId: membroBId, quietStartHour: 0, quietEndHour: 0 }
		]);

		const [te] = await ctx.db
			.insert(eventType)
			.values({ teamId: ctx.teamId, name: 'Encontro', slug: 'encontro' })
			.returning({ id: eventType.id });
		tipoEventoId = te!.id;

		const [resp] = await ctx.db
			.insert(responsabilidade)
			.values({ teamId: ctx.teamId, nome: 'Louvor' })
			.returning({ id: responsabilidade.id });
		respId = resp!.id;

		const [cat] = await ctx.db
			.insert(financeCategory)
			.values({
				teamId: ctx.teamId,
				name: 'Contribuição mensal',
				slug: 'contribuicao-mensal',
				kind: 'entrada',
				isDonation: false
			})
			.returning({ id: financeCategory.id });
		categoriaEntradaId = cat!.id;

		tokenLider = await tokenPara(ctx.db, liderId);
		tokenConselheiro = await tokenPara(ctx.db, conselheiroId);
		tokenMembroA = await tokenPara(ctx.db, membroAId);
		tokenMembroB = await tokenPara(ctx.db, membroBId);
		tokenVisitante = await tokenPara(ctx.db, visitanteId);
	}, 60_000);

	afterAll(async () => {
		setTestDatabase(null);
		await ctx?.fechar();
	});

	it('não cria notificações quando a flag notificacoes_ativas está desligada (RN-29)', async () => {
		const resLista = await notificacoesRoute.GET({
			request: req('GET', '/api/notificacoes', tokenMembroA),
			url: new URL('https://app.eagles.test/api/notificacoes'),
			locals: {}
		} as any);
		expect(resLista.status).toBe(200);
		const corpo = await resLista.json();
		expect(corpo.notificacoesAtivasNoSistema).toBe(false);
		expect(corpo.naoLidas).toBe(0);
		expect(corpo.notificacoes).toHaveLength(0);

		const r = await notificarPessoa(ctx.db, {
			teamId: ctx.teamId,
			personId: membroAId,
			kind: 'anuncio',
			title: 'Aviso ignorado',
			body: 'Flag desligada.'
		});
		expect(r).toEqual({ criada: false, motivo: 'desativada' });

		// Publicar anúncio com flag desligada não gera notificações
		const resAnuncio = await anunciosRoute.POST({
			request: req('POST', '/api/comunicacao/anuncios', tokenLider, {
				title: 'Aviso sem flag',
				body: 'Não deve criar notificação.',
				audienceScope: 'all',
				publicarAgora: true
			}),
			locals: {}
		} as any);
		expect(resAnuncio.status).toBe(201);

		const lembretes = await gerarLembretesAutomaticos(ctx.db);
		expect(lembretes.total).toBe(0);

		// POST /api/notificacoes/gerar bloqueia membro (403) e avisa líder quando flag está desligada (400)
		const resGerarMembro = await gerarRoute.POST({
			request: req('POST', '/api/notificacoes/gerar', tokenMembroA, {}),
			locals: {}
		} as any);
		expect(resGerarMembro.status).toBe(403);

		const resGerarFlagOff = await gerarRoute.POST({
			request: req('POST', '/api/notificacoes/gerar', tokenLider, {}),
			locals: {}
		} as any);
		expect(resGerarFlagOff.status).toBe(400);

		const todas = await ctx.db.select().from(notification);
		expect(todas).toHaveLength(0);
	});

	it('cria notificações em tempo real para anúncio, transferência, escala e contribuição quando a flag está ligada', async () => {
		await ctx.db.insert(featureFlag).values({
			teamId: ctx.teamId,
			key: 'notificacoes_ativas',
			enabled: true,
			description: 'Notificações automáticas e lembretes'
		});

		// 1. Anúncio publicado para PG Águia → notifica membroA, não membroB
		const resAnuncio = await anunciosRoute.POST({
			request: req('POST', '/api/comunicacao/anuncios', tokenLider, {
				title: 'Ensaio no sábado',
				body: 'Cheguem 15 minutos antes no salão.',
				audienceScope: 'group',
				groupId: grupoAId,
				publicarAgora: true
			}),
			locals: {}
		} as any);
		expect(resAnuncio.status).toBe(201);

		const notifsADepoisAnuncio = await ctx.db
			.select()
			.from(notification)
			.where(eq(notification.personId, membroAId));
		expect(
			notifsADepoisAnuncio.some((n) => n.kind === 'anuncio' && n.title === 'Ensaio no sábado')
		).toBe(true);

		const notifsBDepoisAnuncio = await ctx.db
			.select()
			.from(notification)
			.where(eq(notification.personId, membroBId));
		expect(notifsBDepoisAnuncio.some((n) => n.kind === 'anuncio')).toBe(false);

		// 2. Transferência de membroB para PG Águia → notifica membroB
		const resTransf = await transferenciasRoute.POST({
			request: req('POST', '/api/grupos/transferencias', tokenLider, {
				pessoas: [membroBId],
				paraGrupoId: grupoAId,
				motivo: 'Reorganização semestral'
			}),
			locals: {},
			getClientAddress: () => '127.0.0.1'
		} as any);
		expect(resTransf.status).toBe(200);

		const notifsBDepoisTransf = await ctx.db
			.select()
			.from(notification)
			.where(eq(notification.personId, membroBId));
		expect(
			notifsBDepoisTransf.some((n) => n.kind === 'grupo' && n.href === `/grupos/${grupoAId}`)
		).toBe(true);

		// 3. Escala atribuída para membroA → notifica membroA
		const agoraDia = new Date('2026-11-27T17:00:00Z'); // 14h BRT
		const [eventoProximo] = await ctx.db
			.insert(eventTable)
			.values({
				teamId: ctx.teamId,
				eventTypeId: tipoEventoId,
				groupId: grupoAId,
				title: 'Encontro PG Águia',
				location: 'Auditório',
				startsAt: new Date(agoraDia.getTime() + 18 * 3_600_000),
				rsvpEnabled: true
			})
			.returning({ id: eventTable.id });

		const resEscala = await escalasRoute.POST({
			request: req('POST', '/api/escalas', tokenConselheiro, {
				eventoId: eventoProximo!.id,
				responsabilidadeId: respId,
				personId: membroAId
			}),
			locals: {}
		} as any);
		expect(resEscala.status).toBe(201);

		const notifsADepoisEscala = await ctx.db
			.select()
			.from(notification)
			.where(eq(notification.personId, membroAId));
		expect(
			notifsADepoisEscala.some(
				(n) => n.kind === 'escala' && n.href === `/eventos/${eventoProximo!.id}`
			)
		).toBe(true);

		// 4. Contribuição confirmada vinculada a membroA → notifica membroA
		const resFin = await movimentacoesRoute.POST({
			request: req('POST', '/api/financeiro/movimentacoes', tokenLider, {
				kind: 'entrada',
				categoryId: categoriaEntradaId,
				amountCents: 5000,
				paymentMethod: 'pix',
				description: 'Novembro/2026',
				personId: membroAId
			}),
			locals: {}
		} as any);
		expect(resFin.status).toBe(201);

		const notifsADepoisFin = await ctx.db
			.select()
			.from(notification)
			.where(eq(notification.personId, membroAId));
		expect(
			notifsADepoisFin.some(
				(n) => n.kind === 'financeiro' && n.body.includes('50,00') && n.href === '/financeiro'
			)
		).toBe(true);

		// 5. Lembretes automáticos agendados + deduplicação (gerarLembretesAutomaticos 2x)
		// membroB já respondeu RSVP; membroA ainda não respondeu
		await ctx.db.insert(eventRegistration).values({
			eventId: eventoProximo!.id,
			personId: membroBId,
			option: 'confirmado'
		});

		const primeiraRodada = await gerarLembretesAutomaticos(ctx.db, agoraDia, {
			teamId: ctx.teamId
		});
		expect(primeiraRodada.eventos).toBe(2); // membroA e membroB (ambos no PG Águia)
		expect(primeiraRodada.rsvp).toBe(1); // apenas membroA (membroB já confirmou)
		expect(primeiraRodada.escalas).toBe(1); // membroA escalado no evento
		expect(primeiraRodada.total).toBe(4);

		// Segunda rodada idêntica: deduplicação garante 0 novas notificações
		const segundaRodada = await gerarLembretesAutomaticos(ctx.db, agoraDia, {
			teamId: ctx.teamId
		});
		expect(segundaRodada).toEqual({ eventos: 0, rsvp: 0, escalas: 0, total: 0 });

		// Endpoint manual /api/notificacoes/gerar funciona para líder e conselheiro
		const resGerarLider = await gerarRoute.POST({
			request: req('POST', '/api/notificacoes/gerar', tokenLider, {}),
			locals: {}
		} as any);
		expect(resGerarLider.status).toBe(200);
		const dGerar = await resGerarLider.json();
		expect(dGerar.ok).toBe(true);

		const resGerarConselheiro = await gerarRoute.POST({
			request: req('POST', '/api/notificacoes/gerar', tokenConselheiro, {}),
			locals: {}
		} as any);
		expect(resGerarConselheiro.status).toBe(200);
	});

	it('respeita janela de silêncio (22h–7h BRT), opt-out por categoria e limite diário', async () => {
		// Testes puros do helper estaEmSilencio
		expect(estaEmSilencio(22, 22, 7)).toBe(true);
		expect(estaEmSilencio(23, 22, 7)).toBe(true);
		expect(estaEmSilencio(0, 22, 7)).toBe(true);
		expect(estaEmSilencio(6, 22, 7)).toBe(true);
		expect(estaEmSilencio(7, 22, 7)).toBe(false);
		expect(estaEmSilencio(14, 22, 7)).toBe(false);
		expect(estaEmSilencio(21, 22, 7)).toBe(false);
		// Datas em UTC convertidas para America/Sao_Paulo (-03:00)
		expect(estaEmSilencio(new Date('2026-11-27T02:00:00Z'), 22, 7)).toBe(true); // 23h BRT
		expect(estaEmSilencio(new Date('2026-11-27T17:00:00Z'), 22, 7)).toBe(false); // 14h BRT

		// Configura visitante com silêncio 22h–7h e opt-out de lembretes de evento
		await ctx.db.insert(notificationPreference).values({
			personId: visitanteId,
			announcementsEnabled: true,
			eventRemindersEnabled: false,
			rsvpRemindersEnabled: true,
			responsibilityRemindersEnabled: true,
			quietStartHour: 22,
			quietEndHour: 7
		});

		const hora23Brt = new Date('2026-11-28T02:00:00Z'); // 23:00 BRT de 27/11
		const hora14Brt = new Date('2026-11-28T17:00:00Z'); // 14:00 BRT de 28/11

		// 23h BRT → suprimida por janela de silêncio
		const emSilencio = await notificarPessoa(ctx.db, {
			teamId: ctx.teamId,
			personId: visitanteId,
			kind: 'anuncio',
			title: 'Aviso noturno',
			body: 'Não deve incomodar de madrugada.',
			agora: hora23Brt
		});
		expect(emSilencio).toEqual({ criada: false, motivo: 'silencio' });

		// 14h BRT com categoria desabilitada → suprimida por preferência
		const optOut = await notificarPessoa(ctx.db, {
			teamId: ctx.teamId,
			personId: visitanteId,
			kind: 'evento',
			title: 'Lembrete desativado',
			body: 'Usuário desmarcou lembretes de evento.',
			agora: hora14Brt
		});
		expect(optOut).toEqual({ criada: false, motivo: 'preferencia' });

		// 14h BRT com categoria habilitada → cria até 5 no mesmo dia; 6ª bate no limite diário
		for (let i = 1; i <= 5; i++) {
			const ok = await notificarPessoa(ctx.db, {
				teamId: ctx.teamId,
				personId: visitanteId,
				kind: 'anuncio',
				title: `Aviso ${i}`,
				body: `Corpo ${i}`,
				agora: hora14Brt
			});
			expect(ok.criada).toBe(true);
		}

		const sexta = await notificarPessoa(ctx.db, {
			teamId: ctx.teamId,
			personId: visitanteId,
			kind: 'anuncio',
			title: 'Aviso 6 (excesso)',
			body: 'Deve ser bloqueado pelo limite diário.',
			agora: hora14Brt
		});
		expect(sexta).toEqual({ criada: false, motivo: 'limite_diario' });

		// Alta prioridade (escala/grupo/financeiro) ainda passa até o teto de 10 no dia
		const altaPrioridade = await notificarPessoa(ctx.db, {
			teamId: ctx.teamId,
			personId: visitanteId,
			kind: 'escala',
			title: 'Escala urgente',
			body: 'Limite de alta prioridade é 10/dia.',
			agora: hora14Brt
		});
		expect(altaPrioridade.criada).toBe(true);
	});

	it('lista e marca notificações como lidas via API (incluindo visitante e isolamento entre usuários)', async () => {
		// Visitante consegue ler as próprias notificações
		const resVis = await notificacoesRoute.GET({
			request: req('GET', '/api/notificacoes', tokenVisitante),
			url: new URL('https://app.eagles.test/api/notificacoes'),
			locals: {}
		} as any);
		expect(resVis.status).toBe(200);
		const dadosVis = await resVis.json();
		expect(dadosVis.naoLidas).toBeGreaterThanOrEqual(1);
		expect(dadosVis.podeGerarLembretes).toBe(false);

		// MembroA lista suas notificações não lidas
		const resA = await notificacoesRoute.GET({
			request: req('GET', '/api/notificacoes?apenasNaoLidas=1', tokenMembroA),
			url: new URL('https://app.eagles.test/api/notificacoes?apenasNaoLidas=1'),
			locals: {}
		} as any);
		expect(resA.status).toBe(200);
		const dadosA = await resA.json();
		const naoLidasInicial = dadosA.naoLidas as number;
		expect(naoLidasInicial).toBeGreaterThanOrEqual(3);
		const primeiraId = dadosA.notificacoes[0].id as string;

		// MembroB NÃO consegue marcar notificação de membroA como lida
		const resCross = await notificacoesRoute.PATCH({
			request: req('PATCH', '/api/notificacoes', tokenMembroB, { id: primeiraId }),
			locals: {}
		} as any);
		expect(resCross.status).toBe(200);
		expect((await resCross.json()).marcadas).toBe(0);

		// MembroA marca uma como lida → naoLidas diminui em 1
		const resUma = await notificacoesRoute.PATCH({
			request: req('PATCH', '/api/notificacoes', tokenMembroA, { id: primeiraId }),
			locals: {}
		} as any);
		expect(resUma.status).toBe(200);
		const dUma = await resUma.json();
		expect(dUma.marcadas).toBe(1);
		expect(dUma.naoLidas).toBe(naoLidasInicial - 1);

		// MembroA marca todas como lidas → naoLidas === 0
		const resTodas = await notificacoesRoute.PATCH({
			request: req('PATCH', '/api/notificacoes', tokenMembroA, { todas: true }),
			locals: {}
		} as any);
		expect(resTodas.status).toBe(200);
		const dTodas = await resTodas.json();
		expect(dTodas.naoLidas).toBe(0);

		const resApos = await notificacoesRoute.GET({
			request: req('GET', '/api/notificacoes?apenasNaoLidas=1', tokenMembroA),
			url: new URL('https://app.eagles.test/api/notificacoes?apenasNaoLidas=1'),
			locals: {}
		} as any);
		const dApos = await resApos.json();
		expect(dApos.naoLidas).toBe(0);
		expect(dApos.notificacoes).toHaveLength(0);
	});

	it('registra, consulta e remove assinatura Web Push (GET/POST/DELETE /api/notificacoes/push)', async () => {
		const endpoint = 'https://fcm.googleapis.com/fcm/send/exemplo-assinatura-eagles-001';

		// Estado inicial
		const resIni = await pushRoute.GET({
			request: req('GET', '/api/notificacoes/push', tokenMembroA),
			locals: {}
		} as any);
		expect(resIni.status).toBe(200);
		expect((await resIni.json()).ativo).toBe(false);

		// Registro da assinatura Web Push
		const resPost = await pushRoute.POST({
			request: req('POST', '/api/notificacoes/push', tokenMembroA, {
				endpoint,
				keys: {
					p256dh:
						'BEl62iUYgUivxIkv69yViEuiBIa-Ib9-SkvMeAtA3LFgDzkrxZJjSgSnfckjBJuBkr3qBUYIHBQFLXYp5Nksh8U',
					auth: 'tBHItJI5svbpez7KI4CCXg'
				}
			}),
			locals: {}
		} as any);
		expect(resPost.status).toBe(201);

		const resAposPost = await pushRoute.GET({
			request: req('GET', '/api/notificacoes/push', tokenMembroA),
			locals: {}
		} as any);
		const dAposPost = await resAposPost.json();
		expect(dAposPost.ativo).toBe(true);
		expect(dAposPost.totalAssinaturas).toBe(1);

		// Upsert no mesmo endpoint não duplica
		const resUpsert = await pushRoute.POST({
			request: req('POST', '/api/notificacoes/push', tokenMembroA, {
				endpoint,
				p256dh:
					'BEl62iUYgUivxIkv69yViEuiBIa-Ib9-SkvMeAtA3LFgDzkrxZJjSgSnfckjBJuBkr3qBUYIHBQFLXYp5Nksh8U',
				auth: 'tBHItJI5svbpez7KI4CCXg'
			}),
			locals: {}
		} as any);
		expect(resUpsert.status).toBe(201);

		const resAposUpsert = await pushRoute.GET({
			request: req('GET', '/api/notificacoes/push', tokenMembroA),
			locals: {}
		} as any);
		expect((await resAposUpsert.json()).totalAssinaturas).toBe(1);

		// Remoção via DELETE
		const resDel = await pushRoute.DELETE({
			request: req(
				'DELETE',
				`/api/notificacoes/push?endpoint=${encodeURIComponent(endpoint)}`,
				tokenMembroA
			),
			url: new URL(
				`https://app.eagles.test/api/notificacoes/push?endpoint=${encodeURIComponent(endpoint)}`
			),
			locals: {}
		} as any);
		expect(resDel.status).toBe(200);
		expect((await resDel.json()).removidas).toBe(1);

		const resFim = await pushRoute.GET({
			request: req('GET', '/api/notificacoes/push', tokenMembroA),
			locals: {}
		} as any);
		expect((await resFim.json()).ativo).toBe(false);
	});
});

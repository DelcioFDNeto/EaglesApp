/**
 * Testes de integração reais do M08 (Comunicação) contra PGlite.
 * Cobre RF-09.1, RF-09.2, RF-09.3, RF-09.4, F6, RN-29 e RN-33.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { criarBancoDeTeste, type BancoDeTeste } from './helpers/banco';
import { setTestDatabase } from '../../src/lib/server/db';
import {
	escala,
	event as eventTable,
	eventType,
	group as groupTable,
	groupMember,
	person as personTable,
	personProfile,
	personRole as personRoleTable,
	responsabilidade,
	userAccount as userAccountTable
} from '../../src/lib/server/db/schema';
import { hashPassword } from '../../src/lib/server/auth/password';
import { tokenPara } from './helpers/token';
import { resetEnvCache } from '../../src/lib/server/env';

import * as anunciosRoute from '../../src/routes/api/comunicacao/anuncios/+server';
import * as anuncioIdRoute from '../../src/routes/api/comunicacao/anuncios/[id]/+server';
import * as modelosRoute from '../../src/routes/api/comunicacao/modelos/+server';
import * as renderizarRoute from '../../src/routes/api/comunicacao/renderizar/+server';
import * as preferenciasRoute from '../../src/routes/api/comunicacao/preferencias/+server';

let ctx: BancoDeTeste;
let liderId: string;
let conselheiroAId: string;
let membroAId: string;
let membroBId: string;
let tokenLider: string;
let tokenConselheiroA: string;
let tokenMembroA: string;
let tokenMembroB: string;
let grupoAId: string;
let grupoBId: string;
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

describe('M08 — Comunicação (anúncios, modelos WhatsApp e preferências)', () => {
	beforeAll(async () => {
		process.env.DATABASE_URL = 'postgres://teste@localhost:5432/teste';
		process.env.PUBLIC_ORIGIN = 'https://app.eagles.test';
		process.env.NODE_ENV = 'test';
		resetEnvCache();

		ctx = await criarBancoDeTeste();
		setTestDatabase(ctx.db);

		const [gA] = await ctx.db
			.insert(groupTable)
			.values({ teamId: ctx.teamId, name: 'PG Azul', slug: 'pg-azul' })
			.returning({ id: groupTable.id });
		const [gB] = await ctx.db
			.insert(groupTable)
			.values({ teamId: ctx.teamId, name: 'PG Verde', slug: 'pg-verde' })
			.returning({ id: groupTable.id });
		grupoAId = gA!.id;
		grupoBId = gB!.id;

		liderId = await criarPessoa('Líder Ana', 'ana@eagles.test', ctx.papeis.lider!, 'global');
		conselheiroAId = await criarPessoa(
			'Conselheiro João',
			'joao@eagles.test',
			ctx.papeis.conselheiro!,
			'group',
			grupoAId
		);
		membroAId = await criarPessoa('Membro Carla', 'carla@eagles.test', ctx.papeis.membro!, 'self');
		membroBId = await criarPessoa('Membro Bruno', 'bruno@eagles.test', ctx.papeis.membro!, 'self');

		await ctx.db.insert(groupMember).values([
			{ groupId: grupoAId, personId: membroAId, roleKey: 'membro' },
			{ groupId: grupoBId, personId: membroBId, roleKey: 'membro' }
		]);

		// Contato sensível no perfil de membroA para garantir que RN-33 não o vaze no WhatsApp
		await ctx.db.insert(personProfile).values({
			personId: membroAId,
			phone: '11999990000',
			whatsapp: '11999990000',
			email: 'carla@eagles.test',
			status: 'membro'
		});

		tokenLider = await tokenPara(ctx.db, liderId);
		tokenConselheiroA = await tokenPara(ctx.db, conselheiroAId);
		tokenMembroA = await tokenPara(ctx.db, membroAId);
		tokenMembroB = await tokenPara(ctx.db, membroBId);

		const [te] = await ctx.db
			.insert(eventType)
			.values({ teamId: ctx.teamId, name: 'PG', slug: 'pg' })
			.returning({ id: eventType.id });

		const [ev] = await ctx.db
			.insert(eventTable)
			.values({
				teamId: ctx.teamId,
				eventTypeId: te!.id,
				groupId: grupoAId,
				title: 'PG Azul da Semana',
				location: 'Salão 2',
				startsAt: new Date(Date.now() + 86_400_000)
			})
			.returning({ id: eventTable.id });
		eventoId = ev!.id;

		const [resp] = await ctx.db
			.insert(responsabilidade)
			.values({ teamId: ctx.teamId, nome: 'Mensagem' })
			.returning({ id: responsabilidade.id });

		await ctx.db.insert(escala).values({
			eventId: eventoId,
			responsabilidadeId: resp!.id,
			personId: membroAId,
			status: 'confirmada',
			origem: 'manual'
		});
	}, 60_000);

	afterAll(async () => {
		setTestDatabase(null);
		await ctx?.fechar();
	});

	it('respeita escopo de conselheiro e filtra anúncios por público-alvo (RF-09.2)', async () => {
		// Membro não cria anúncio
		const resMembro = await anunciosRoute.POST({
			request: req('POST', '/api/comunicacao/anuncios', tokenMembroA, {
				title: 'Teste',
				body: 'Corpo',
				audienceScope: 'all'
			}),
			locals: {}
		} as any);
		expect(resMembro.status).toBe(403);

		// Conselheiro do PG Azul NÃO pode criar aviso para o PG Verde (escopo de grupo)
		const resOutroGrupo = await anunciosRoute.POST({
			request: req('POST', '/api/comunicacao/anuncios', tokenConselheiroA, {
				title: 'Aviso errado',
				body: 'Não deveria criar',
				audienceScope: 'group',
				groupId: grupoBId,
				publicarAgora: true
			}),
			locals: {}
		} as any);
		expect(resOutroGrupo.status).toBe(403);

		// Conselheiro do PG Azul cria rascunho para o PG Azul e publica via PATCH
		const resRascunho = await anunciosRoute.POST({
			request: req('POST', '/api/comunicacao/anuncios', tokenConselheiroA, {
				title: 'Lanche do PG Azul',
				body: 'Tragam refrigerante!',
				audienceScope: 'group',
				groupId: grupoAId,
				publicarAgora: false
			}),
			locals: {}
		} as any);
		expect(resRascunho.status).toBe(201);
		const { anuncio } = await resRascunho.json();
		expect(anuncio.status).toBe('draft');

		// Enquanto rascunho, membroA não vê
		const resAntes = await anunciosRoute.GET({
			request: req('GET', '/api/comunicacao/anuncios', tokenMembroA),
			locals: {}
		} as any);
		expect((await resAntes.json()).anuncios).toHaveLength(0);

		// Publica via PATCH
		const resPub = await anuncioIdRoute.PATCH({
			request: req('PATCH', `/api/comunicacao/anuncios/${anuncio.id}`, tokenConselheiroA, {
				status: 'published'
			}),
			params: { id: anuncio.id },
			locals: {}
		} as any);
		expect(resPub.status).toBe(200);

		// MembroA (PG Azul) vê; MembroB (PG Verde) NÃO vê
		const listaA = await (
			await anunciosRoute.GET({
				request: req('GET', '/api/comunicacao/anuncios', tokenMembroA),
				locals: {}
			} as any)
		).json();
		const listaB = await (
			await anunciosRoute.GET({
				request: req('GET', '/api/comunicacao/anuncios', tokenMembroB),
				locals: {}
			} as any)
		).json();

		expect(listaA.anuncios.map((a: any) => a.id)).toContain(anuncio.id);
		expect(listaB.anuncios.map((a: any) => a.id)).not.toContain(anuncio.id);
	});

	it('cria modelo e renderiza mensagem WhatsApp sem vazar telefone/e-mail (RF-09.1, RF-09.3, RN-33)', async () => {
		const resModelo = await modelosRoute.POST({
			request: req('POST', '/api/comunicacao/modelos', tokenLider, {
				name: 'Convite PG',
				category: 'evento',
				content: '*{{evento}}* ({{grupo}})\nLocal: {{local}}\n\n{{escala}}\nLink: {{link}}'
			}),
			locals: {}
		} as any);
		expect(resModelo.status).toBe(201);
		const { modelo } = await resModelo.json();

		const resRender = await renderizarRoute.POST({
			request: req('POST', '/api/comunicacao/renderizar', tokenMembroA, {
				templateId: modelo.id,
				eventoId,
				linkBase: 'https://eagles.web.app'
			}),
			locals: {}
		} as any);
		expect(resRender.status).toBe(200);
		const body = await resRender.json();

		expect(body.texto).toContain('*PG Azul da Semana* (PG Azul)');
		expect(body.texto).toContain('• Mensagem: Membro Carla');
		expect(body.texto).toContain(`https://eagles.web.app/eventos/${eventoId}`);
		// RN-33: nunca inclui telefone ou e-mail no texto de WhatsApp
		expect(body.texto).not.toContain('11999990000');
		expect(body.texto).not.toContain('carla@eagles.test');
		expect(body.whatsappUrl.startsWith('https://wa.me/?text=')).toBe(true);
	});

	it('mantém notificações desligadas por padrão (RN-29) e persiste preferências/janela de silêncio (F6)', async () => {
		const resGet = await preferenciasRoute.GET({
			request: req('GET', '/api/comunicacao/preferencias', tokenMembroA),
			locals: {}
		} as any);
		expect(resGet.status).toBe(200);
		const inicial = await resGet.json();
		expect(inicial.notificacoesAtivasNoSistema).toBe(false);
		expect(inicial.preferencias.quietStartHour).toBe(22);
		expect(inicial.preferencias.quietEndHour).toBe(7);

		const resPut = await preferenciasRoute.PUT({
			request: req('PUT', '/api/comunicacao/preferencias', tokenMembroA, {
				announcementsEnabled: true,
				eventRemindersEnabled: true,
				rsvpRemindersEnabled: false,
				responsibilityRemindersEnabled: true,
				quietStartHour: 21,
				quietEndHour: 8
			}),
			locals: {}
		} as any);
		expect(resPut.status).toBe(200);

		const depois = await (
			await preferenciasRoute.GET({
				request: req('GET', '/api/comunicacao/preferencias', tokenMembroA),
				locals: {}
			} as any)
		).json();
		expect(depois.preferencias.rsvpRemindersEnabled).toBe(false);
		expect(depois.preferencias.quietStartHour).toBe(21);
		expect(depois.preferencias.quietEndHour).toBe(8);
	});
});

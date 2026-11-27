/**
 * M06, ciclo 4: histórico de respostas (RN-12), chamada completa e relatórios
 * de frequência (RF-06.3/06.4), contra PostgreSQL real (PGlite).
 */

import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { criarBancoDeTeste, type BancoDeTeste } from './helpers/banco';
import { setTestDatabase } from '../../src/lib/server/db';
import {
	event as eventTable,
	eventRegistration,
	eventType,
	group as groupTable,
	groupMember,
	groupMemberHistory,
	person as personTable,
	personRole as personRoleTable,
	presence,
	rsvpHistory,
	team as teamTable,
	userAccount as userAccountTable
} from '../../src/lib/server/db/schema';
import { hashPassword } from '../../src/lib/server/auth/password';

// Argon2id custa ~600 ms de CPU: um hash por arquivo, reaproveitado por todas as
// pessoas de teste (a senha é a mesma). Com a bateria em paralelo, um hash por
// pessoa estourava o tempo das preparações.
const hashDeTeste = hashPassword('senha12345');
import { tokenPara } from './helpers/token';
import { resetEnvCache } from '../../src/lib/server/env';

import * as inscricoesRoute from '../../src/routes/api/eventos/[id]/inscricoes/+server';
import * as presencaRoute from '../../src/routes/api/eventos/[id]/presenca/+server';
import * as relatorioRoute from '../../src/routes/api/eventos/[id]/relatorio-presenca/+server';
import * as frequenciaRoute from '../../src/routes/api/frequencia/+server';
import * as frequenciaPessoaRoute from '../../src/routes/api/frequencia/pessoa/[id]/+server';

let ctx: BancoDeTeste;
const pg: Record<string, string> = {};
const id: Record<string, string> = {};
const tk: Record<string, string> = {};
let tipoId: string;

function chamar(
	token: string,
	opts: { body?: unknown; params?: Record<string, string>; method?: string; busca?: string } = {}
) {
	const url = `https://app.eagles.test/api${opts.busca ?? ''}`;
	return {
		request: new Request(url, {
			method: opts.method ?? (opts.body === undefined ? 'GET' : 'POST'),
			headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
			body: opts.body === undefined ? undefined : JSON.stringify(opts.body)
		}),
		params: opts.params ?? {},
		url: new URL(url),
		locals: {},
		getClientAddress: () => '127.0.0.1'
	} as any;
}

async function criar(
	nome: string,
	papel: string,
	opts: { escopo?: 'global' | 'group' | 'self'; grupo?: string; teamId?: string } = {}
) {
	const escopo = opts.escopo ?? 'self';
	const [p] = await ctx.db
		.insert(personTable)
		.values({ teamId: opts.teamId ?? ctx.teamId, fullName: nome })
		.returning({ id: personTable.id });
	await ctx.db.insert(userAccountTable).values({
		personId: p!.id,
		email: `${nome.toLowerCase().replace(/\s+/g, '.')}@eagles.test`,
		passwordHash: await hashDeTeste
	});
	await ctx.db.insert(personRoleTable).values({
		personId: p!.id,
		roleId: ctx.papeis[papel]!,
		scopeType: escopo,
		scopeId: escopo === 'group' ? opts.grupo! : null
	});
	if (opts.grupo) {
		const desde = new Date('2026-01-01T12:00:00Z');
		await ctx.db
			.insert(groupMember)
			.values({ groupId: opts.grupo, personId: p!.id, joinedAt: desde });
		await ctx.db.insert(groupMemberHistory).values({
			teamId: opts.teamId ?? ctx.teamId,
			personId: p!.id,
			toGroupId: opts.grupo,
			origin: 'cadastro',
			occurredAt: desde
		});
	}
	return p!.id;
}

async function evento(titulo: string, diasAtras: number, grupo: string | null) {
	const [e] = await ctx.db
		.insert(eventTable)
		.values({
			teamId: ctx.teamId,
			eventTypeId: tipoId,
			title: titulo,
			startsAt: new Date(Date.now() - diasAtras * 86_400_000),
			groupId: grupo
		})
		.returning({ id: eventTable.id });
	return e!.id;
}

const responder = (token: string, eventoId: string, option: string, guests = 0) =>
	inscricoesRoute.POST(chamar(token, { body: { option, guests }, params: { id: eventoId } }));
const marcar = (token: string, eventoId: string, personId: string, status = 'present') =>
	presencaRoute.POST(chamar(token, { body: { personId, status }, params: { id: eventoId } }));

describe('M06 — histórico de respostas, chamada e frequência', () => {
	beforeAll(async () => {
		process.env.DATABASE_URL = 'postgres://teste@localhost:5432/teste';
		process.env.PUBLIC_ORIGIN = 'https://app.eagles.test';
		process.env.NODE_ENV = 'test';
		resetEnvCache();
		ctx = await criarBancoDeTeste();
		setTestDatabase(ctx.db);

		const grupos = await ctx.db
			.insert(groupTable)
			.values([
				{ teamId: ctx.teamId, name: 'PG A', slug: 'pg-a' },
				{ teamId: ctx.teamId, name: 'PG B', slug: 'pg-b' }
			])
			.returning({ id: groupTable.id });
		pg.A = grupos[0]!.id;
		pg.B = grupos[1]!.id;

		const [t] = await ctx.db
			.insert(eventType)
			.values({ teamId: ctx.teamId, name: 'PG', slug: 'pg' })
			.returning({ id: eventType.id });
		tipoId = t!.id;

		id.lider = await criar('Lider Ana', 'lider', { escopo: 'global' });
		id.conselheiroA = await criar('Conselheiro Pedro', 'conselheiro', {
			escopo: 'group',
			grupo: pg.A
		});
		id.joao = await criar('Joao', 'membro', { grupo: pg.A });
		id.rita = await criar('Rita', 'membro', { grupo: pg.A });
		id.leticia = await criar('Leticia', 'membro', { grupo: pg.B });

		const [outra] = await ctx.db
			.insert(teamTable)
			.values({ slug: 'bears', name: 'Bears' })
			.returning({ id: teamTable.id });
		id.estranho = await criar('Lider Bears', 'lider', { escopo: 'global', teamId: outra!.id });

		for (const k of ['lider', 'conselheiroA', 'joao', 'leticia', 'estranho']) {
			tk[k] = await tokenPara(ctx.db, id[k]!);
		}
	}, 60_000);

	afterAll(async () => {
		setTestDatabase(null);
		await ctx?.fechar();
	});

	describe('histórico de respostas (RN-12)', () => {
		it('cada troca de resposta vira uma linha; repetir a mesma resposta não', async () => {
			const e = await evento('PG futuro', -2, pg.A!);
			await responder(tk.joao!, e, 'confirmado');
			await responder(tk.joao!, e, 'confirmado');
			await responder(tk.joao!, e, 'nao_vou');
			await responder(tk.joao!, e, 'convidado', 2);

			const linhas = await ctx.db
				.select()
				.from(rsvpHistory)
				.where(eq(rsvpHistory.eventId, e))
				.orderBy(rsvpHistory.answeredAt);
			expect(linhas.map((l) => [l.option, l.guests])).toEqual([
				['confirmado', 0],
				['nao_vou', 0],
				['convidado', 2]
			]);

			const rel = await (
				await relatorioRoute.GET(chamar(tk.conselheiroA!, { params: { id: e } }))
			).json();
			expect(rel.mudancasDeResposta).toHaveLength(1);
			expect(rel.mudancasDeResposta[0].respostas.map((r: any) => r.option)).toEqual([
				'confirmado',
				'nao_vou',
				'convidado'
			]);
		});

		it('não aceita edição nem exclusão direta, mas some junto com o evento', async () => {
			const e = await evento('PG para apagar', -3, pg.A!);
			await responder(tk.joao!, e, 'talvez');
			await expect(ctx.db.update(rsvpHistory).set({ option: 'x' })).rejects.toThrow();
			await expect(ctx.db.delete(rsvpHistory).where(eq(rsvpHistory.eventId, e))).rejects.toThrow();

			await ctx.db.delete(eventTable).where(eq(eventTable.id, e));
			const resto = await ctx.db.select().from(rsvpHistory).where(eq(rsvpHistory.eventId, e));
			expect(resto).toHaveLength(0);
		});
	});

	describe('chamada', () => {
		it('lista o PG inteiro e quem respondeu, inclusive quem não usou o app', async () => {
			const e = await evento('PG de quinta', 1, pg.A!);
			await responder(tk.leticia!, e, 'confirmado'); // de outro PG, mas respondeu

			const antes = await (
				await presencaRoute.GET(chamar(tk.conselheiroA!, { params: { id: e } }))
			).json();
			const nomes = antes.paraChamada.map((p: any) => p.nome);
			expect(nomes).toEqual(['Conselheiro Pedro', 'Joao', 'Leticia', 'Rita']);
			expect(antes.paraChamada.find((p: any) => p.nome === 'Leticia').confirmou).toBe(true);

			expect((await marcar(tk.conselheiroA!, e, id.rita!)).status).toBe(200);
			const depois = await (
				await presencaRoute.GET(chamar(tk.conselheiroA!, { params: { id: e } }))
			).json();
			expect(depois.paraChamada.map((p: any) => p.nome)).not.toContain('Rita');

			// Toque errado: desfazer devolve a pessoa à chamada.
			const desfeito = await presencaRoute.DELETE(
				chamar(tk.conselheiroA!, {
					body: { personId: id.rita },
					params: { id: e },
					method: 'DELETE'
				})
			);
			expect(desfeito.status).toBe(200);
			const deNovo = await (
				await presencaRoute.GET(chamar(tk.conselheiroA!, { params: { id: e } }))
			).json();
			expect(deNovo.paraChamada.map((p: any) => p.nome)).toContain('Rita');

			expect(
				(
					await presencaRoute.DELETE(
						chamar(tk.joao!, { body: { personId: id.rita }, params: { id: e }, method: 'DELETE' })
					)
				).status
			).toBe(403);
		});

		it('opção personalizada marcada como "vou" conta como confirmação', async () => {
			const [e] = await ctx.db
				.insert(eventTable)
				.values({
					teamId: ctx.teamId,
					eventTypeId: tipoId,
					title: 'Com opções próprias',
					startsAt: new Date(Date.now() + 86_400_000),
					groupId: pg.A,
					rsvpOptions: [
						{ key: 'vou_de_carona', label: 'Vou de carona' },
						{ key: 'sim', label: 'Sim', confirma: true },
						{ key: 'nao_posso', label: 'Não posso' }
					]
				})
				.returning({ id: eventTable.id });
			await responder(tk.joao!, e!.id, 'vou_de_carona');
			await responder(tk.leticia!, e!.id, 'nao_posso');
			const r = await (
				await presencaRoute.GET(chamar(tk.conselheiroA!, { params: { id: e!.id } }))
			).json();
			expect(r.resumo.totalInscritos).toBe(1);
		});
	});

	describe('relatório de frequência', () => {
		let e1: string;
		let e2: string;

		beforeAll(async () => {
			// Dois PGs passados com chamada: Joao veio nos dois, Rita em um.
			e1 = await evento('PG semana 1', 14, pg.A!);
			e2 = await evento('PG semana 2', 7, pg.A!);
			await marcar(tk.conselheiroA!, e1, id.joao!);
			await marcar(tk.conselheiroA!, e1, id.rita!);
			await marcar(tk.conselheiroA!, e2, id.joao!, 'late');
		});

		it('conselheiro vê o próprio PG em ordem alfabética', async () => {
			const res = await frequenciaRoute.GET(chamar(tk.conselheiroA!));
			expect(res.status).toBe(200);
			const r = await res.json();
			expect(r.escopo).toBe('pg');
			expect(r.grupo.id).toBe(pg.A);
			const joao = r.pessoas.find((p: any) => p.nome === 'Joao');
			const rita = r.pessoas.find((p: any) => p.nome === 'Rita');
			expect(joao).toMatchObject({ presencas: joao.esperados, faltasSeguidas: 0 });
			expect(rita.faltasSeguidas).toBeGreaterThanOrEqual(1);
			const nomes = r.pessoas.map((p: any) => p.nome);
			expect(nomes).toEqual([...nomes].sort((a: string, b: string) => a.localeCompare(b, 'pt-BR')));
		});

		it('conselheiro não vê outro PG nem a visão da equipe; membro não vê relatório', async () => {
			expect(
				(await frequenciaRoute.GET(chamar(tk.conselheiroA!, { busca: `?grupo=${pg.B}` }))).status
			).toBe(403);
			expect((await frequenciaRoute.GET(chamar(tk.joao!))).status).toBe(403);
		});

		it('líder vê a equipe por PG, sem nomes', async () => {
			const r = await (await frequenciaRoute.GET(chamar(tk.lider!))).json();
			expect(r.escopo).toBe('equipe');
			const a = r.porPg.find((x: any) => x.grupo.id === pg.A);
			expect(a.chamadas).toBeGreaterThanOrEqual(2);
			expect(a).not.toHaveProperty('pessoas');
			expect(JSON.stringify(r)).not.toContain('Rita');
		});

		it('período inválido ou longo demais é recusado', async () => {
			expect(
				(await frequenciaRoute.GET(chamar(tk.lider!, { busca: '?de=2026-05-01&ate=2026-01-01' })))
					.status
			).toBe(400);
			expect(
				(await frequenciaRoute.GET(chamar(tk.lider!, { busca: '?de=2020-01-01&ate=2026-01-01' })))
					.status
			).toBe(400);
		});

		it('a pessoa vê a própria frequência; quem cuida do PG também; mais ninguém', async () => {
			const propria = await frequenciaPessoaRoute.GET(
				chamar(tk.joao!, { params: { id: id.joao! } })
			);
			expect(propria.status).toBe(200);
			const d = await propria.json();
			expect(d.pg.presencas).toBe(d.pg.esperados);
			expect(d.recentes.length).toBeGreaterThan(0);

			expect(
				(await frequenciaPessoaRoute.GET(chamar(tk.conselheiroA!, { params: { id: id.rita! } })))
					.status
			).toBe(200);
			// Colega do mesmo PG não vê a frequência do outro.
			expect(
				(await frequenciaPessoaRoute.GET(chamar(tk.joao!, { params: { id: id.rita! } }))).status
			).toBe(403);
			// Conselheiro do A não vê quem é do B.
			expect(
				(await frequenciaPessoaRoute.GET(chamar(tk.conselheiroA!, { params: { id: id.leticia! } })))
					.status
			).toBe(403);
			expect(
				(await frequenciaPessoaRoute.GET(chamar(tk.estranho!, { params: { id: id.joao! } }))).status
			).toBe(404);
		});
	});

	describe('migração 0011', () => {
		it('o histórico começa com a resposta atual de cada um', async () => {
			const e = await evento('Antigo', 30, pg.A!);
			const quando = new Date('2026-02-01T10:00:00Z');
			await ctx.db.insert(eventRegistration).values({
				eventId: e,
				personId: id.rita!,
				option: 'talvez',
				guests: 0,
				updatedAt: quando
			});
			const comandos = readFileSync(
				'src/lib/server/db/migrations/0011_presenca_historico.sql',
				'utf8'
			).split('--> statement-breakpoint');
			await ctx.cliente.exec(comandos.find((c) => c.includes('INSERT INTO "rsvp_history"'))!);

			const [linha] = await ctx.db.select().from(rsvpHistory).where(eq(rsvpHistory.eventId, e));
			expect(linha).toMatchObject({ personId: id.rita, option: 'talvez', answeredAt: quando });
		});

		it('o histórico de PG também deixa a pessoa ser apagada (cascata), mas não a linha solta', async () => {
			const p = await criar('Para Apagar', 'membro', { grupo: pg.B });
			await expect(
				ctx.db.delete(groupMemberHistory).where(eq(groupMemberHistory.personId, p))
			).rejects.toThrow();
			await ctx.db.delete(personTable).where(eq(personTable.id, p));
			const resto = await ctx.db
				.select()
				.from(groupMemberHistory)
				.where(eq(groupMemberHistory.personId, p));
			expect(resto).toHaveLength(0);
		});
	});
});

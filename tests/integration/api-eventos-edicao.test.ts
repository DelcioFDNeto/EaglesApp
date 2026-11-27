/**
 * M05, ciclo 1: editar, cancelar e reativar eventos; editar e desativar tipos.
 *
 * O que estes testes protegem:
 *   - escopo de grupo: conselheiro do PG A não mexe em evento do PG B, nem
 *     move um evento para lá, nem cria evento da equipe toda;
 *   - cancelar não apaga nada: as respostas de presença ficam (decisão do
 *     usuário) e o cancelamento diz quem, quando e por quê;
 *   - trocar as opções de resposta não pode apagar o significado do histórico;
 *   - toda mudança vai para a auditoria, com antes/depois só do que mudou.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { and, desc, eq } from 'drizzle-orm';
import { criarBancoDeTeste, type BancoDeTeste } from './helpers/banco';
import { setTestDatabase } from '../../src/lib/server/db';
import {
	auditLog,
	event as eventTable,
	eventRegistration,
	eventType,
	group as groupTable,
	groupMember,
	person as personTable,
	personRole as personRoleTable,
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

import * as eventosRoute from '../../src/routes/api/eventos/+server';
import * as eventoRoute from '../../src/routes/api/eventos/[id]/+server';
import * as inscricoesRoute from '../../src/routes/api/eventos/[id]/inscricoes/+server';
import * as opcoesRoute from '../../src/routes/api/eventos/opcoes/+server';
import * as tiposRoute from '../../src/routes/api/eventos/tipos/+server';
import * as tipoRoute from '../../src/routes/api/eventos/tipos/[id]/+server';

let ctx: BancoDeTeste;
let pgA: string;
let pgB: string;
let tipoPg: string;
let liderId: string;
let conselheiroAId: string;
let membroAId: string;
let membroBId: string;
let estranhoId: string;
const tokens: Record<string, string> = {};

function req(method: string, token: string, body?: unknown): Request {
	return new Request('https://app.eagles.test/api/eventos', {
		method,
		headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
		body: body !== undefined ? JSON.stringify(body) : undefined
	});
}

async function pessoa(
	teamId: string,
	nome: string,
	papel: string,
	escopo: 'global' | 'group' | 'self',
	scopeId: string | null = null
) {
	const [p] = await ctx.db
		.insert(personTable)
		.values({ teamId, fullName: nome })
		.returning({ id: personTable.id });
	await ctx.db.insert(userAccountTable).values({
		personId: p!.id,
		email: `${nome.toLowerCase().replace(/\s+/g, '.')}@eagles.test`,
		passwordHash: await hashDeTeste
	});
	await ctx.db
		.insert(personRoleTable)
		.values({ personId: p!.id, roleId: papel, scopeType: escopo, scopeId });
	return p!.id;
}

const amanha = (horas = 0) => new Date(Date.now() + 86_400_000 + horas * 3_600_000).toISOString();

async function criarEvento(token: string, extra: Record<string, unknown> = {}) {
	return eventosRoute.POST({
		request: req('POST', token, {
			eventTypeId: tipoPg,
			title: 'PG de quinta',
			startsAt: amanha(),
			endsAt: amanha(2),
			groupId: pgA,
			...extra
		}),
		locals: {}
	} as any);
}

async function novoEventoId(extra: Record<string, unknown> = {}) {
	const res = await criarEvento(tokens.lider!, extra);
	expect(res.status).toBe(201);
	return (await res.json()).evento.id as string;
}

function editar(token: string, id: string, body: unknown) {
	return eventoRoute.PATCH({
		request: req('PATCH', token, body),
		params: { id },
		locals: {}
	} as any);
}

function detalhe(token: string, id: string) {
	return eventoRoute.GET({ request: req('GET', token), params: { id }, locals: {} } as any);
}

function responder(token: string, id: string, option: string) {
	return inscricoesRoute.POST({
		request: req('POST', token, { option }),
		params: { id },
		locals: {}
	} as any);
}

async function ultimaAuditoria(entityId: string) {
	const [linha] = await ctx.db
		.select()
		.from(auditLog)
		.where(eq(auditLog.entityId, entityId))
		.orderBy(desc(auditLog.at))
		.limit(1);
	return linha;
}

describe('M05 — eventos: edição, cancelamento, tipos e formulário', () => {
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
		pgA = grupos[0]!.id;
		pgB = grupos[1]!.id;

		const [t] = await ctx.db
			.insert(eventType)
			.values({ teamId: ctx.teamId, name: 'PG', slug: 'pg' })
			.returning({ id: eventType.id });
		tipoPg = t!.id;

		liderId = await pessoa(ctx.teamId, 'Lider Ana', ctx.papeis.lider!, 'global');
		conselheiroAId = await pessoa(
			ctx.teamId,
			'Conselheiro Pedro',
			ctx.papeis.conselheiro!,
			'group',
			pgA
		);
		membroAId = await pessoa(ctx.teamId, 'Membro Joao', ctx.papeis.membro!, 'self');
		membroBId = await pessoa(ctx.teamId, 'Membro Leticia', ctx.papeis.membro!, 'self');
		await ctx.db.insert(groupMember).values([
			{ groupId: pgA, personId: membroAId },
			{ groupId: pgB, personId: membroBId }
		]);

		const [outra] = await ctx.db
			.insert(teamTable)
			.values({ slug: 'bears', name: 'Bears' })
			.returning({ id: teamTable.id });
		estranhoId = await pessoa(outra!.id, 'Lider Bears', ctx.papeis.lider!, 'global');

		tokens.lider = await tokenPara(ctx.db, liderId);
		tokens.conselheiroA = await tokenPara(ctx.db, conselheiroAId);
		tokens.membroA = await tokenPara(ctx.db, membroAId);
		tokens.estranho = await tokenPara(ctx.db, estranhoId);
	}, 60_000);

	afterAll(async () => {
		setTestDatabase(null);
		await ctx?.fechar();
	});

	describe('edição e permissões', () => {
		it('líder edita e a auditoria guarda antes/depois só do que mudou', async () => {
			const id = await novoEventoId();
			const criado = await ultimaAuditoria(id);
			expect(criado?.action).toBe('event.criado');

			const res = await editar(tokens.lider!, id, {
				title: 'PG de quinta (sala nova)',
				location: 'Salão 2',
				description: null
			});
			expect(res.status).toBe(200);
			expect((await res.json()).alterado).toBe(true);

			const d = await (await detalhe(tokens.lider!, id)).json();
			expect(d.evento.title).toBe('PG de quinta (sala nova)');
			expect(d.evento.location).toBe('Salão 2');
			expect(d.evento.responsavelNome).toBe('Lider Ana');

			const log = await ultimaAuditoria(id);
			expect(log?.action).toBe('event.atualizado');
			expect(log?.actorPersonId).toBe(liderId);
			expect(log?.after).toEqual({ title: 'PG de quinta (sala nova)', location: 'Salão 2' });
			expect(log?.before).toEqual({ title: 'PG de quinta', location: null });
		});

		it('não grava nada quando nada muda', async () => {
			const id = await novoEventoId();
			const res = await editar(tokens.lider!, id, { title: 'PG de quinta' });
			expect((await res.json()).alterado).toBe(false);
			expect((await ultimaAuditoria(id))?.action).toBe('event.criado');
		});

		it('membro não edita (403); outra equipe nem vê (404); campo desconhecido é recusado', async () => {
			const id = await novoEventoId();
			expect((await editar(tokens.membroA!, id, { title: 'x' })).status).toBe(403);
			expect((await editar(tokens.estranho!, id, { title: 'x' })).status).toBe(404);
			expect((await editar(tokens.lider!, id, { teamId: ctx.teamId })).status).toBe(400);
		});

		it('conselheiro só mexe no próprio PG e não move eventos para fora dele', async () => {
			const doA = await novoEventoId({ groupId: pgA });
			const doB = await novoEventoId({ groupId: pgB });
			const daEquipe = await novoEventoId({ groupId: undefined });

			expect((await editar(tokens.conselheiroA!, doA, { title: 'Ok' })).status).toBe(200);
			expect((await editar(tokens.conselheiroA!, doB, { title: 'Não' })).status).toBe(403);
			expect((await editar(tokens.conselheiroA!, daEquipe, { title: 'Não' })).status).toBe(403);
			// Mover o próprio evento para o PG de outro, ou para a equipe toda.
			expect((await editar(tokens.conselheiroA!, doA, { groupId: pgB })).status).toBe(403);
			expect((await editar(tokens.conselheiroA!, doA, { groupId: null })).status).toBe(403);
			// Criar evento sem PG (da equipe toda) exige permissão global.
			expect((await criarEvento(tokens.conselheiroA!, { groupId: undefined })).status).toBe(403);
			expect((await criarEvento(tokens.conselheiroA!, { groupId: pgA })).status).toBe(201);
		});

		it('término antes do início é recusado, inclusive mudando só um dos lados', async () => {
			const id = await novoEventoId();
			expect((await editar(tokens.lider!, id, { endsAt: amanha(-5) })).status).toBe(400);
			expect((await editar(tokens.lider!, id, { startsAt: amanha(5) })).status).toBe(400);
			expect((await editar(tokens.lider!, id, { startsAt: amanha(5), endsAt: null })).status).toBe(
				200
			);
		});

		it('responsável de outra equipe é recusado, ao criar e ao editar', async () => {
			expect((await criarEvento(tokens.lider!, { responsiblePersonId: estranhoId })).status).toBe(
				404
			);
			const id = await novoEventoId();
			expect((await editar(tokens.lider!, id, { responsiblePersonId: estranhoId })).status).toBe(
				404
			);
			expect((await editar(tokens.lider!, id, { responsiblePersonId: membroAId })).status).toBe(
				200
			);
		});
	});

	describe('cancelamento', () => {
		it('cancelar mantém as respostas, registra quem e por quê, e fecha novas respostas', async () => {
			const id = await novoEventoId();
			expect((await responder(tokens.membroA!, id, 'confirmado')).status).toBe(200);

			const res = await editar(tokens.lider!, id, {
				status: 'cancelled',
				motivoCancelamento: 'Chuva forte'
			});
			expect(res.status).toBe(200);

			const respostas = await ctx.db
				.select()
				.from(eventRegistration)
				.where(eq(eventRegistration.eventId, id));
			expect(respostas).toHaveLength(1);
			expect(respostas[0]!.option).toBe('confirmado');

			const d = await (await detalhe(tokens.membroA!, id)).json();
			expect(d.evento.status).toBe('cancelled');
			expect(d.evento.cancelamento).toMatchObject({ por: 'Lider Ana', motivo: 'Chuva forte' });
			expect(d.inscricoes).toHaveLength(1);

			expect((await responder(tokens.membroA!, id, 'talvez')).status).toBe(400);
			expect((await ultimaAuditoria(id))?.action).toBe('event.cancelado');
		});

		it('reativar limpa o cancelamento e as respostas antigas continuam lá', async () => {
			const id = await novoEventoId();
			await responder(tokens.membroA!, id, 'talvez');
			await editar(tokens.lider!, id, { status: 'cancelled' });

			const res = await editar(tokens.lider!, id, { status: 'scheduled' });
			expect(res.status).toBe(200);

			const d = await (await detalhe(tokens.lider!, id)).json();
			expect(d.evento.status).toBe('scheduled');
			expect(d.evento.cancelamento).toBeNull();
			expect(d.inscricoes.map((i: any) => i.option)).toEqual(['talvez']);
			expect((await ultimaAuditoria(id))?.action).toBe('event.reativado');
		});

		it('o banco recusa status cancelado sem data, e data sem status cancelado', async () => {
			const id = await novoEventoId();
			await expect(
				ctx.db.update(eventTable).set({ status: 'cancelled' }).where(eq(eventTable.id, id))
			).rejects.toThrow();
			await expect(
				ctx.db.update(eventTable).set({ cancelledAt: new Date() }).where(eq(eventTable.id, id))
			).rejects.toThrow();
			await expect(
				ctx.db.update(eventTable).set({ status: 'adiado' }).where(eq(eventTable.id, id))
			).rejects.toThrow();
		});
	});

	describe('opções de resposta', () => {
		it('opção com respostas pode mudar de rótulo mas não sumir; opção sem respostas pode sair', async () => {
			const id = await novoEventoId({
				rsvpOptions: [
					{ key: 'vou', label: 'Vou' },
					{ key: 'nao_vou', label: 'Não vou' },
					{ key: 'talvez', label: 'Talvez' }
				]
			});
			await responder(tokens.membroA!, id, 'vou');

			const remover = await editar(tokens.lider!, id, {
				rsvpOptions: [{ key: 'nao_vou', label: 'Não vou' }]
			});
			expect(remover.status).toBe(409);
			expect((await remover.json()).erro).toContain('Vou');

			const ok = await editar(tokens.lider!, id, {
				rsvpOptions: [
					{ key: 'vou', label: 'Estarei lá' },
					{ key: 'nao_vou', label: 'Não vou' }
				]
			});
			expect(ok.status).toBe(200);

			const repetida = await editar(tokens.lider!, id, {
				rsvpOptions: [
					{ key: 'vou', label: 'A' },
					{ key: 'vou', label: 'B' }
				]
			});
			expect(repetida.status).toBe(400);
		});
	});

	describe('tipos de evento', () => {
		let tipoTemp: string;

		beforeAll(async () => {
			const res = await tiposRoute.POST({
				request: req('POST', tokens.conselheiroA!, { name: 'Acampamento', slug: 'acampamento' }),
				locals: {}
			} as any);
			// Criar continua aberto a conselheiros.
			expect(res.status).toBe(201);
			tipoTemp = (await res.json()).tipo.id;
		});

		function editarTipo(token: string, id: string, body: unknown) {
			return tipoRoute.PUT({ request: req('PUT', token, body), params: { id }, locals: {} } as any);
		}

		it('só quem tem event.manage global edita ou desativa tipos', async () => {
			expect((await editarTipo(tokens.conselheiroA!, tipoTemp, { name: 'X' })).status).toBe(403);
			expect((await editarTipo(tokens.membroA!, tipoTemp, { name: 'X' })).status).toBe(403);
			expect((await editarTipo(tokens.estranho!, tipoTemp, { name: 'X' })).status).toBe(404);
			expect((await editarTipo(tokens.lider!, tipoTemp, { slug: 'novo' })).status).toBe(400);

			const res = await editarTipo(tokens.lider!, tipoTemp, { name: 'Acampamento anual' });
			expect(res.status).toBe(200);
			const [log] = await ctx.db
				.select()
				.from(auditLog)
				.where(and(eq(auditLog.entityId, tipoTemp), eq(auditLog.action, 'event_type.atualizado')));
			expect(log?.after).toEqual({ name: 'Acampamento anual' });
		});

		it('tipo desativado some das opções e não serve para evento novo, mas o antigo segue editável', async () => {
			const antigo = await novoEventoId({ eventTypeId: tipoTemp });

			expect((await editarTipo(tokens.lider!, tipoTemp, { active: false })).status).toBe(200);

			const opcoes = await (
				await opcoesRoute.GET({ request: req('GET', tokens.lider!), locals: {} } as any)
			).json();
			expect(opcoes.tipos.map((t: any) => t.id)).not.toContain(tipoTemp);

			expect((await criarEvento(tokens.lider!, { eventTypeId: tipoTemp })).status).toBe(400);
			expect((await editar(tokens.lider!, antigo, { title: 'Ainda vale' })).status).toBe(200);

			const outro = await novoEventoId();
			expect((await editar(tokens.lider!, outro, { eventTypeId: tipoTemp })).status).toBe(400);

			const lista = await (
				await tiposRoute.GET({ request: req('GET', tokens.lider!), locals: {} } as any)
			).json();
			expect(lista.tipos.find((t: any) => t.id === tipoTemp)?.active).toBe(false);
			expect(lista.podeEditarTipos).toBe(true);
		});
	});

	describe('opções do formulário', () => {
		function opcoes(token: string) {
			return opcoesRoute.GET({ request: req('GET', token), locals: {} } as any);
		}

		it('conselheiro vê só os próprios PGs e as pessoas deles; não pode criar sem PG', async () => {
			const res = await opcoes(tokens.conselheiroA!);
			expect(res.status).toBe(200);
			const o = await res.json();
			expect(o.podeSemGrupo).toBe(false);
			expect(o.grupos.map((g: any) => g.id)).toEqual([pgA]);
			const ids = o.pessoas.map((p: any) => p.id);
			expect(ids).toContain(membroAId);
			expect(ids).toContain(conselheiroAId);
			expect(ids).not.toContain(membroBId);
			expect(o.pessoas[0]).not.toHaveProperty('whatsapp');
		});

		it('líder vê todos os PGs e a equipe; membro não abre o formulário; outra equipe não se mistura', async () => {
			const o = await (await opcoes(tokens.lider!)).json();
			expect(o.podeSemGrupo).toBe(true);
			expect(o.grupos).toHaveLength(2);
			expect(o.pessoas.map((p: any) => p.id)).toEqual(
				expect.arrayContaining([liderId, conselheiroAId, membroAId, membroBId])
			);
			expect(o.pessoas.map((p: any) => p.id)).not.toContain(estranhoId);

			expect((await opcoes(tokens.membroA!)).status).toBe(403);
		});
	});
});

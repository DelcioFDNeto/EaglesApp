/**
 * M04, ciclo 3: editar e arquivar PGs; transferir pessoas, com histórico.
 *
 * Decisões do usuário (26/11/2026) que estes testes fixam:
 *   - conselheiro edita nome e descrição do PRÓPRIO PG; criar e arquivar
 *     são dos líderes;
 *   - conselheiro move quem está no PG dele para qualquer outro PG, mas não
 *     traz ninguém de outro PG nem deixa alguém sem PG.
 */

import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { criarBancoDeTeste, type BancoDeTeste } from './helpers/banco';
import { setTestDatabase } from '../../src/lib/server/db';
import {
	auditLog,
	event as eventTable,
	eventType,
	group as groupTable,
	groupMember,
	groupMemberHistory,
	person as personTable,
	personProfile,
	personRole as personRoleTable,
	role as roleTable,
	rolePermission,
	team as teamTable,
	userAccount as userAccountTable
} from '../../src/lib/server/db/schema';
import { hashPassword } from '../../src/lib/server/auth/password';
import { tokenPara } from './helpers/token';
import { resetEnvCache } from '../../src/lib/server/env';

import * as gruposRoute from '../../src/routes/api/grupos/+server';
import * as grupoRoute from '../../src/routes/api/grupos/[id]/+server';
import * as transferenciasRoute from '../../src/routes/api/grupos/transferencias/+server';
import * as pessoasRoute from '../../src/routes/api/pessoas/+server';
import * as pessoaRoute from '../../src/routes/api/pessoas/[id]/+server';
import * as eventosRoute from '../../src/routes/api/eventos/+server';

let ctx: BancoDeTeste;
const pg: Record<string, string> = {};
const id: Record<string, string> = {};
const tk: Record<string, string> = {};
let tipoId: string;

function chamar(
	token: string,
	body?: unknown,
	params: Record<string, string> = {},
	method = body === undefined ? 'GET' : 'POST',
	busca = ''
) {
	return {
		request: new Request(`https://app.eagles.test/api${busca}`, {
			method,
			headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
			body: body === undefined ? undefined : JSON.stringify(body)
		}),
		params,
		url: new URL(`https://app.eagles.test/api${busca}`),
		locals: {},
		getClientAddress: () => '127.0.0.1'
	} as any;
}

const transferir = (
	token: string,
	pessoas: string[],
	paraGrupoId: string | null,
	motivo?: string
) => transferenciasRoute.POST(chamar(token, { pessoas, paraGrupoId, motivo }));
const editarPg = (token: string, grupo: string, body: unknown) =>
	grupoRoute.PATCH(chamar(token, body, { id: grupo }, 'PATCH'));
const verPg = (token: string, grupo: string) =>
	grupoRoute.GET(chamar(token, undefined, { id: grupo }));

async function criar(
	nome: string,
	papel: string,
	opts: {
		escopo?: 'global' | 'group' | 'self';
		grupo?: string;
		escopoId?: string;
		teamId?: string;
	} = {}
) {
	const escopo = opts.escopo ?? 'self';
	const [p] = await ctx.db
		.insert(personTable)
		.values({ teamId: opts.teamId ?? ctx.teamId, fullName: nome })
		.returning({ id: personTable.id });
	await ctx.db.insert(userAccountTable).values({
		personId: p!.id,
		email: `${nome.toLowerCase().replace(/\s+/g, '.')}@eagles.test`,
		passwordHash: await hashPassword('senha12345')
	});
	await ctx.db.insert(personRoleTable).values({
		personId: p!.id,
		roleId: ctx.papeis[papel]!,
		scopeType: escopo,
		scopeId: escopo === 'group' ? (opts.escopoId ?? opts.grupo!) : null
	});
	await ctx.db
		.insert(personProfile)
		.values({ personId: p!.id, status: 'membro', groupId: opts.grupo ?? null });
	if (opts.grupo) {
		await ctx.db.insert(groupMember).values({ groupId: opts.grupo, personId: p!.id });
	}
	return p!.id;
}

async function pgDe(pessoa: string) {
	const [m] = await ctx.db
		.select({ groupId: groupMember.groupId })
		.from(groupMember)
		.where(eq(groupMember.personId, pessoa));
	return m?.groupId ?? null;
}

async function caminhoDe(pessoa: string) {
	return ctx.db.select().from(groupMemberHistory).where(eq(groupMemberHistory.personId, pessoa));
}

describe('M04 — grupos: editar, arquivar e transferir', () => {
	beforeAll(async () => {
		process.env.DATABASE_URL = 'postgres://teste@localhost:5432/teste';
		process.env.PUBLIC_ORIGIN = 'https://app.eagles.test';
		process.env.NODE_ENV = 'test';
		resetEnvCache();

		ctx = await criarBancoDeTeste();
		setTestDatabase(ctx.db);

		const grupos = await ctx.db
			.insert(groupTable)
			.values(
				['A', 'B', 'C', 'D'].map((l) => ({ teamId: ctx.teamId, name: `PG ${l}`, slug: `pg-${l}` }))
			)
			.returning({ id: groupTable.id, name: groupTable.name });
		for (const g of grupos) pg[g.name.slice(3)] = g.id;

		const [t] = await ctx.db
			.insert(eventType)
			.values({ teamId: ctx.teamId, name: 'PG', slug: 'pg' })
			.returning({ id: eventType.id });
		tipoId = t!.id;

		id.lider = await criar('Lider Ana', 'lider', { escopo: 'global' });
		id.liderNoA = await criar('Lider Bruno', 'lider', { escopo: 'global', grupo: pg.A });
		id.conselheiroA = await criar('Conselheiro Pedro', 'conselheiro', {
			escopo: 'group',
			grupo: pg.A
		});
		id.conselheiroB = await criar('Conselheira Marina', 'conselheiro', {
			escopo: 'group',
			grupo: pg.B
		});
		id.a1 = await criar('Joao Silva', 'membro', { grupo: pg.A });
		id.a2 = await criar('Rita Lopes', 'membro', { grupo: pg.A });
		id.b1 = await criar('Leticia Reis', 'membro', { grupo: pg.B });
		id.semPg = await criar('Sem Pg', 'membro');
		id.membro = await criar('Membro Comum', 'membro', { grupo: pg.D });

		const [outra] = await ctx.db
			.insert(teamTable)
			.values({ slug: 'bears', name: 'Bears' })
			.returning({ id: teamTable.id });
		id.estranho = await criar('Lider Bears', 'lider', { escopo: 'global', teamId: outra!.id });

		for (const k of ['lider', 'conselheiroA', 'conselheiroB', 'membro', 'estranho']) {
			tk[k] = await tokenPara(ctx.db, id[k]!);
		}
	}, 60_000);

	afterAll(async () => {
		setTestDatabase(null);
		await ctx?.fechar();
	});

	describe('transferir', () => {
		it('conselheiro move do próprio PG para outro: PG atual, perfil, histórico e auditoria', async () => {
			const res = await transferir(tk.conselheiroA!, [id.a1!], pg.B!, 'Mudou de bairro');
			expect(res.status).toBe(200);
			expect((await res.json()).movidas).toBe(1);

			expect(await pgDe(id.a1!)).toBe(pg.B);
			const [perfil] = await ctx.db
				.select({ groupId: personProfile.groupId })
				.from(personProfile)
				.where(eq(personProfile.personId, id.a1!));
			expect(perfil?.groupId).toBe(pg.B);

			const [linha] = await caminhoDe(id.a1!);
			expect(linha).toMatchObject({
				fromGroupId: pg.A,
				toGroupId: pg.B,
				reason: 'Mudou de bairro',
				origin: 'manual',
				changedByPersonId: id.conselheiroA
			});

			const [log] = await ctx.db
				.select()
				.from(auditLog)
				.where(and(eq(auditLog.entityId, id.a1!), eq(auditLog.action, 'group.membro_transferido')));
			expect(log?.before).toEqual({ groupId: pg.A });
		});

		it('quem recebe vê quem chegou, de onde e por quê; quem enviou vê quem saiu', async () => {
			const noB = await (await verPg(tk.conselheiroB!, pg.B!)).json();
			expect(noB.movimentacao[0]).toMatchObject({
				tipo: 'chegou',
				pessoa: { id: id.a1, nome: 'Joao Silva' },
				outroGrupo: 'PG A',
				motivo: 'Mudou de bairro',
				por: 'Conselheiro Pedro'
			});
			const noA = await (await verPg(tk.conselheiroA!, pg.A!)).json();
			expect(noA.movimentacao[0]).toMatchObject({ tipo: 'saiu', outroGrupo: 'PG B' });

			// Membro vê o PG, mas não a movimentação das pessoas.
			const comoMembro = await (await verPg(tk.membro!, pg.B!)).json();
			expect(comoMembro.movimentacao).toEqual([]);
		});

		it('conselheiro não traz de outro PG, não tira de todos e não alcança líder', async () => {
			// Leticia está no PG B: para o conselheiro do A, ela nem é visível.
			expect((await transferir(tk.conselheiroA!, [id.b1!], pg.A!)).status).toBe(404);
			// Joao saiu do A: o conselheiro do A não o traz de volta.
			expect((await transferir(tk.conselheiroA!, [id.a1!], pg.A!)).status).toBe(404);

			const semPg = await transferir(tk.conselheiroA!, [id.a2!], null);
			expect(semPg.status).toBe(403);
			expect((await semPg.json()).erro).toContain('líderes');

			// Tudo ou nada: com a líder na lista, nem Rita sai do lugar.
			const lote = await transferir(tk.conselheiroA!, [id.a2!, id.liderNoA!], pg.C!);
			expect(lote.status).toBe(403);
			expect((await lote.json()).barradas).toEqual([id.liderNoA]);
			expect(await pgDe(id.a2!)).toBe(pg.A);

			expect((await transferir(tk.membro!, [id.membro!], pg.A!)).status).toBe(403);
			expect((await transferir(tk.estranho!, [id.a2!], pg.C!)).status).toBe(404);
		});

		it('líder põe quem não tem PG, move em lote e tira de todos', async () => {
			expect((await transferir(tk.lider!, [id.semPg!], pg.C!, 'Chegou agora')).status).toBe(200);
			const [entrada] = await caminhoDe(id.semPg!);
			expect(entrada).toMatchObject({ fromGroupId: null, toGroupId: pg.C });

			const lote = await transferir(tk.lider!, [id.semPg!, id.a2!], pg.C!);
			expect(await lote.json()).toMatchObject({ movidas: 1, inalteradas: 1 });

			expect((await transferir(tk.lider!, [id.semPg!], null, 'Afastou-se')).status).toBe(200);
			expect(await pgDe(id.semPg!)).toBeNull();
			expect((await caminhoDe(id.semPg!)).map((c) => c.toGroupId)).toContain(null);
		});

		it('lista repetida ou vazia é recusada, e o histórico não aceita edição nem exclusão', async () => {
			expect((await transferir(tk.lider!, [], pg.A!)).status).toBe(400);
			expect((await transferir(tk.lider!, [id.a2!, id.a2!], pg.A!)).status).toBe(400);

			await expect(ctx.db.update(groupMemberHistory).set({ reason: 'apagado' })).rejects.toThrow();
			await expect(ctx.db.delete(groupMemberHistory)).rejects.toThrow();
		});
	});

	describe('editar e arquivar PG', () => {
		it('conselheiro edita o próprio PG, não o dos outros, e não arquiva', async () => {
			expect(
				(await editarPg(tk.conselheiroA!, pg.A!, { name: 'PG A — Centro', description: 'Quintas' }))
					.status
			).toBe(200);
			expect((await editarPg(tk.conselheiroA!, pg.B!, { name: 'Não' })).status).toBe(403);
			expect((await editarPg(tk.conselheiroA!, pg.A!, { arquivado: true })).status).toBe(403);
			expect((await editarPg(tk.lider!, pg.A!, { slug: 'novo' })).status).toBe(400);

			const d = await (await verPg(tk.conselheiroA!, pg.A!)).json();
			expect(d.grupo.name).toBe('PG A — Centro');
			expect(d.permissoes).toMatchObject({
				podeEditar: true,
				podeArquivar: false,
				podeTransferir: true,
				podeTirarDeTodos: false
			});
		});

		it('arquivar exige PG vazio e sem eventos marcados', async () => {
			const cheio = await editarPg(tk.lider!, pg.C!, { arquivado: true });
			expect(cheio.status).toBe(409);
			expect((await cheio.json()).codigo).toBe('pg_com_integrantes');

			await transferir(tk.lider!, [id.a2!], pg.A!);
			const criado = await eventosRoute.POST(
				chamar(tk.lider!, {
					eventTypeId: tipoId,
					title: 'PG C',
					startsAt: new Date(Date.now() + 86_400_000).toISOString(),
					groupId: pg.C
				})
			);
			const eventoId = (await criado.json()).evento.id;

			const comEvento = await editarPg(tk.lider!, pg.C!, { arquivado: true });
			expect(comEvento.status).toBe(409);
			expect((await comEvento.json()).codigo).toBe('pg_com_eventos');

			await ctx.db
				.update(eventTable)
				.set({ status: 'cancelled', cancelledAt: new Date() })
				.where(eq(eventTable.id, eventoId));
			expect((await editarPg(tk.lider!, pg.C!, { arquivado: true })).status).toBe(200);
		});

		it('PG arquivado some das listas e não recebe ninguém nem evento; pode ser reativado', async () => {
			const lista = await (await gruposRoute.GET(chamar(tk.lider!))).json();
			expect(lista.grupos.map((g: any) => g.id)).not.toContain(pg.C);
			const comArquivados = await (
				await gruposRoute.GET(chamar(tk.lider!, undefined, {}, 'GET', '?arquivados=1'))
			).json();
			expect(comArquivados.grupos.map((g: any) => g.id)).toContain(pg.C);
			// Pedir arquivados sem ser líder não mostra nada a mais.
			const conselheiro = await (
				await gruposRoute.GET(chamar(tk.conselheiroA!, undefined, {}, 'GET', '?arquivados=1'))
			).json();
			expect(conselheiro.grupos.map((g: any) => g.id)).not.toContain(pg.C);

			expect((await transferir(tk.lider!, [id.a2!], pg.C!)).status).toBe(404);
			const evento = await eventosRoute.POST(
				chamar(tk.lider!, {
					eventTypeId: tipoId,
					title: 'Não',
					startsAt: new Date(Date.now() + 86_400_000).toISOString(),
					groupId: pg.C
				})
			);
			expect(evento.status).toBe(404);
			expect(
				(await pessoasRoute.POST(chamar(tk.lider!, { nome: 'Nova Pessoa', grupoId: pg.C }))).status
			).toBe(404);

			expect((await editarPg(tk.lider!, pg.C!, { arquivado: false })).status).toBe(200);
			const [log] = await ctx.db
				.select()
				.from(auditLog)
				.where(and(eq(auditLog.entityId, pg.C!), eq(auditLog.action, 'group.reativado')));
			expect(log).toBeDefined();
		});
	});

	describe('ficha da pessoa e cadastro', () => {
		it('a ficha mostra o caminho entre PGs e só os destinos permitidos', async () => {
			const comoConselheiro = await (
				await pessoaRoute.GET(chamar(tk.conselheiroA!, undefined, { id: id.a2! }))
			).json();
			const destinos = comoConselheiro.permissoes.mudarDePg.destinos.map((d: any) => d.id);
			expect(destinos).not.toContain(pg.A);
			expect(destinos).toEqual(expect.arrayContaining([pg.B, pg.C, pg.D]));
			expect(comoConselheiro.permissoes.mudarDePg.podeTirarDeTodos).toBe(false);
			expect(comoConselheiro.historicoGrupos[0]).toMatchObject({
				de: 'PG C',
				para: 'PG A — Centro'
			});

			const comoLider = await (
				await pessoaRoute.GET(chamar(tk.lider!, undefined, { id: id.a2! }))
			).json();
			expect(comoLider.permissoes.mudarDePg.podeTirarDeTodos).toBe(true);
		});

		it('cadastrar alguém num PG já grava a entrada no histórico', async () => {
			const res = await pessoasRoute.POST(
				chamar(tk.conselheiroB!, { nome: 'Caio Prado', grupoId: pg.B })
			);
			const nova = (await res.json()).pessoa.id;
			const [entrada] = await caminhoDe(nova);
			expect(entrada).toMatchObject({ fromGroupId: null, toGroupId: pg.B, origin: 'cadastro' });
		});
	});

	describe('migração 0010', () => {
		const comandos = readFileSync(
			'src/lib/server/db/migrations/0010_grupos_transferencia.sql',
			'utf8'
		).split('--> statement-breakpoint');

		it('o retrato inicial registra quem já estava em cada PG', async () => {
			// Vínculo do jeito antigo: direto em group_member, sem histórico.
			const [p] = await ctx.db
				.insert(personTable)
				.values({ teamId: ctx.teamId, fullName: 'Antigo do D' })
				.returning({ id: personTable.id });
			const desde = new Date('2026-03-01T22:00:00Z');
			await ctx.db.insert(groupMember).values({ groupId: pg.D!, personId: p!.id, joinedAt: desde });

			const retrato = comandos.find((c) => c.includes('Já estava no PG'))!;
			await ctx.cliente.exec(retrato);

			const [linha] = await caminhoDe(p!.id);
			expect(linha).toMatchObject({ fromGroupId: null, toGroupId: pg.D, origin: 'cadastro' });
			expect(linha!.occurredAt).toEqual(desde);
		});

		it('concede group.update a líder e conselheiro já instalados, sem duplicar', async () => {
			const [outra] = await ctx.db
				.insert(teamTable)
				.values({ slug: 'tigers', name: 'Tigers' })
				.returning({ id: teamTable.id });
			const [antigo] = await ctx.db
				.insert(roleTable)
				.values({ teamId: outra!.id, key: 'conselheiro', name: 'Conselheiro', isSystem: true })
				.returning({ id: roleTable.id });

			const concessao = comandos.find((c) => c.includes('INSERT INTO "role_permission"'))!;
			await ctx.cliente.exec(concessao);
			await ctx.cliente.exec(concessao);

			const linhas = await ctx.db
				.select()
				.from(rolePermission)
				.where(
					and(
						eq(rolePermission.roleId, antigo!.id),
						eq(rolePermission.permissionKey, 'group.update')
					)
				);
			expect(linhas).toHaveLength(1);
		});
	});
});

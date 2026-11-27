/**
 * M02, ciclo 2: editar pessoa e movê-la na jornada, com histórico.
 *
 * Decisões do usuário (26/11/2026) que estes testes fixam:
 *   - só o estágio `membro` dá acesso de membro (visitante e recorrente ficam
 *     com acesso de visitante), e a troca é automática;
 *   - conselheiro, no próprio PG, move entre visitante e recorrente; entrar
 *     em membro ou sair dele é dos líderes.
 * E a regra de idade da ADR 0003: piso de 16 anos; 16–17 só nome e presença.
 */

import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { and, desc, eq } from 'drizzle-orm';
import { criarBancoDeTeste, type BancoDeTeste } from './helpers/banco';
import { setTestDatabase } from '../../src/lib/server/db';
import {
	auditLog,
	group as groupTable,
	groupMember,
	person as personTable,
	personProfile,
	personRole as personRoleTable,
	personStatusHistory,
	role as roleTable,
	team as teamTable,
	userAccount as userAccountTable
} from '../../src/lib/server/db/schema';
import { hashPassword } from '../../src/lib/server/auth/password';

// Argon2id custa ~600 ms de CPU: um hash por arquivo, reaproveitado por todas as
// pessoas de teste (a senha é a mesma). Com a bateria em paralelo, um hash por
// pessoa estourava o tempo das preparações.
const hashDeTeste = hashPassword('senha12345');
import { loadActor } from '../../src/lib/server/policy/actor';
import { can } from '../../src/lib/server/policy/policy';
import { tokenPara } from './helpers/token';
import { resetEnvCache } from '../../src/lib/server/env';

import * as pessoasRoute from '../../src/routes/api/pessoas/+server';
import * as pessoaRoute from '../../src/routes/api/pessoas/[id]/+server';
import * as estagioRoute from '../../src/routes/api/pessoas/[id]/estagio/+server';
import * as meRoute from '../../src/routes/api/pessoas/me/+server';

let ctx: BancoDeTeste;
let pgA: string;
let pgB: string;
const id: Record<string, string> = {};
const tk: Record<string, string> = {};

function chamar(
	token: string | null,
	body?: unknown,
	params: Record<string, string> = {},
	method = body === undefined ? 'GET' : 'POST'
) {
	return {
		request: new Request('https://app.eagles.test/api/pessoas', {
			method,
			headers: {
				'Content-Type': 'application/json',
				...(token ? { Authorization: `Bearer ${token}` } : {})
			},
			body: body === undefined ? undefined : JSON.stringify(body)
		}),
		params,
		url: new URL('https://app.eagles.test/api/pessoas'),
		locals: {},
		getClientAddress: () => '127.0.0.1'
	} as any;
}

const ver = (token: string, pessoa: string) =>
	pessoaRoute.GET(chamar(token, undefined, { id: pessoa }));
const editar = (token: string, pessoa: string, body: unknown) =>
	pessoaRoute.PATCH(chamar(token, body, { id: pessoa }));
const mover = (token: string, pessoa: string, estagio: string, motivo?: string) =>
	estagioRoute.POST(chamar(token, { estagio, motivo }, { id: pessoa }));

async function criar(
	nome: string,
	papel: string,
	opts: {
		escopo?: 'global' | 'group' | 'self';
		grupo?: string;
		estagio?: string;
		conta?: boolean;
		teamId?: string;
	} = {}
) {
	const escopo = opts.escopo ?? 'self';
	const [p] = await ctx.db
		.insert(personTable)
		.values({ teamId: opts.teamId ?? ctx.teamId, fullName: nome })
		.returning({ id: personTable.id });
	if (opts.conta !== false) {
		await ctx.db.insert(userAccountTable).values({
			personId: p!.id,
			email: `${nome.toLowerCase().replace(/\s+/g, '.')}@eagles.test`,
			passwordHash: await hashDeTeste
		});
	}
	await ctx.db.insert(personRoleTable).values({
		personId: p!.id,
		roleId: ctx.papeis[papel]!,
		scopeType: escopo,
		scopeId: escopo === 'group' ? opts.grupo! : null
	});
	if (opts.grupo) {
		await ctx.db.insert(groupMember).values({ groupId: opts.grupo, personId: p!.id });
	}
	await ctx.db
		.insert(personProfile)
		.values({ personId: p!.id, status: opts.estagio ?? 'visitante' });
	return p!.id;
}

async function papeisBase(pessoa: string) {
	const linhas = await ctx.db
		.select({ key: roleTable.key })
		.from(personRoleTable)
		.innerJoin(roleTable, eq(roleTable.id, personRoleTable.roleId))
		.where(and(eq(personRoleTable.personId, pessoa), eq(personRoleTable.scopeType, 'self')));
	return linhas.map((l) => l.key).sort();
}

async function estagioDe(pessoa: string) {
	const [p] = await ctx.db
		.select({ status: personProfile.status, joinedAt: personProfile.joinedAt })
		.from(personProfile)
		.where(eq(personProfile.personId, pessoa));
	return p!;
}

/** Data de nascimento de alguém com `anos` completos hoje. */
function nascidoHa(anos: number, diasAMais = 0) {
	const d = new Date();
	d.setFullYear(d.getFullYear() - anos);
	d.setDate(d.getDate() - diasAMais);
	return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

describe('M02 — editar pessoa e jornada', () => {
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

		id.lider = await criar('Lider Ana', 'lider', { escopo: 'global', estagio: 'membro' });
		// Líder que também participa do PG A: o conselheiro de A não mexe nela.
		id.liderNoPg = await criar('Lider Bruno', 'lider', {
			escopo: 'global',
			grupo: pgA,
			estagio: 'membro'
		});
		id.conselheiro = await criar('Conselheiro Pedro', 'conselheiro', {
			escopo: 'group',
			grupo: pgA,
			estagio: 'membro'
		});
		id.membro = await criar('Membro Joao', 'membro', { grupo: pgA, estagio: 'membro' });
		id.visitante = await criar('Visitante Carla', 'visitante', { grupo: pgA, conta: false });
		id.visitanteB = await criar('Visitante Davi', 'visitante', { grupo: pgB, conta: false });
		id.master = await criar('Dev Master', 'master', { escopo: 'global' });

		const [outra] = await ctx.db
			.insert(teamTable)
			.values({ slug: 'bears', name: 'Bears' })
			.returning({ id: teamTable.id });
		id.estranho = await criar('Lider Bears', 'lider', { escopo: 'global', teamId: outra!.id });

		for (const k of ['lider', 'conselheiro', 'membro', 'estranho']) {
			tk[k] = await tokenPara(ctx.db, id[k]!);
		}
	}, 60_000);

	afterAll(async () => {
		setTestDatabase(null);
		await ctx?.fechar();
	});

	describe('ver uma pessoa', () => {
		it('conselheiro vê quem é do próprio PG, com dados e o que pode fazer', async () => {
			const res = await ver(tk.conselheiro!, id.visitante!);
			expect(res.status).toBe(200);
			const d = await res.json();
			expect(d.pessoa.estagio).toBe('visitante');
			expect(d.pessoa.grupo.nome).toBe('PG A');
			expect(d.pessoa.dados).not.toBeNull();
			expect(d.permissoes.podeEditar).toBe(true);
			expect(d.permissoes.estagiosPermitidos).toEqual(['recorrente']);
			expect(d.historico).toEqual([]);
		});

		it('fora do alcance: outro PG 403, membro 403, outra equipe e Master 404', async () => {
			expect((await ver(tk.conselheiro!, id.visitanteB!)).status).toBe(403);
			expect((await ver(tk.membro!, id.visitante!)).status).toBe(403);
			expect((await ver(tk.estranho!, id.visitante!)).status).toBe(404);
			expect((await ver(tk.lider!, id.master!)).status).toBe(404);
		});

		it('líder pode levar a membro; conselheiro não vê essa opção', async () => {
			const d = await (await ver(tk.lider!, id.visitante!)).json();
			expect(d.permissoes.estagiosPermitidos).toEqual(['recorrente', 'membro']);
			const doMembro = await (await ver(tk.conselheiro!, id.membro!)).json();
			expect(doMembro.permissoes.estagiosPermitidos).toEqual([]);
		});
	});

	describe('mudar o estágio', () => {
		it('conselheiro leva visitante a recorrente: histórico e auditoria, acesso continua de visitante', async () => {
			const res = await mover(tk.conselheiro!, id.visitante!, 'recorrente', 'Vem toda quinta');
			expect(res.status).toBe(200);

			expect((await estagioDe(id.visitante!)).status).toBe('recorrente');
			expect(await papeisBase(id.visitante!)).toEqual(['visitante']);

			const d = await (await ver(tk.conselheiro!, id.visitante!)).json();
			expect(d.historico[0]).toMatchObject({
				de: 'visitante',
				para: 'recorrente',
				motivo: 'Vem toda quinta',
				por: 'Conselheiro Pedro'
			});

			const [log] = await ctx.db
				.select()
				.from(auditLog)
				.where(
					and(eq(auditLog.entityId, id.visitante!), eq(auditLog.action, 'person.estagio_alterado'))
				);
			expect(log?.after).toMatchObject({ estagio: 'recorrente', papelBase: 'visitante' });
		});

		it('conselheiro não marca entrada nem saída de membro', async () => {
			const entrar = await mover(tk.conselheiro!, id.visitante!, 'membro');
			expect(entrar.status).toBe(403);
			expect((await entrar.json()).erro).toContain('líderes');
			expect((await mover(tk.conselheiro!, id.membro!, 'recorrente')).status).toBe(403);
			expect((await estagioDe(id.visitante!)).status).toBe('recorrente');
		});

		it('líder leva a membro: acesso de membro de verdade e data de entrada', async () => {
			expect((await mover(tk.lider!, id.visitante!, 'membro')).status).toBe(200);
			expect(await papeisBase(id.visitante!)).toEqual(['membro']);
			const { joinedAt } = await estagioDe(id.visitante!);
			expect(joinedAt).not.toBeNull();

			const ator = await loadActor(ctx.db, id.visitante!);
			expect(can(ator, 'responsibility.view', { personId: id.visitante! })).toBe(true);
		});

		it('saindo de membro, o acesso volta a visitante; a data de entrada fica', async () => {
			const entradaAntes = (await estagioDe(id.visitante!)).joinedAt;
			expect((await mover(tk.lider!, id.visitante!, 'recorrente', 'Mudou de cidade')).status).toBe(
				200
			);
			expect(await papeisBase(id.visitante!)).toEqual(['visitante']);
			expect((await estagioDe(id.visitante!)).joinedAt).toEqual(entradaAntes);

			const ator = await loadActor(ctx.db, id.visitante!);
			expect(can(ator, 'responsibility.view', { personId: id.visitante! })).toBe(false);
		});

		it('não mexe nos papéis de escopo de grupo nem no topo; mesmo estágio não grava nada', async () => {
			expect((await mover(tk.lider!, id.conselheiro!, 'recorrente')).status).toBe(200);
			const ator = await loadActor(ctx.db, id.conselheiro!);
			expect(can(ator, 'person.update', { groupId: pgA })).toBe(true);
			await mover(tk.lider!, id.conselheiro!, 'membro');

			// Conselheiro não alcança a líder que participa do PG dele.
			expect((await mover(tk.conselheiro!, id.liderNoPg!, 'visitante')).status).toBe(403);

			const antes = await ctx.db
				.select()
				.from(personStatusHistory)
				.where(eq(personStatusHistory.personId, id.membro!));
			const res = await mover(tk.lider!, id.membro!, 'membro');
			expect((await res.json()).alterado).toBe(false);
			const depois = await ctx.db
				.select()
				.from(personStatusHistory)
				.where(eq(personStatusHistory.personId, id.membro!));
			expect(depois).toHaveLength(antes.length);
		});

		it('recusa estágio que não é da jornada e pessoa fora do alcance', async () => {
			expect((await mover(tk.lider!, id.membro!, 'lider')).status).toBe(400);
			expect((await mover(tk.conselheiro!, id.visitanteB!, 'recorrente')).status).toBe(404);
			expect((await mover(tk.estranho!, id.membro!, 'recorrente')).status).toBe(404);
		});
	});

	describe('editar dados', () => {
		it('conselheiro edita contato e observações; a auditoria guarda só os nomes dos campos', async () => {
			const res = await editar(tk.conselheiro!, id.visitante!, {
				telefone: '(91) 98888-1234',
				observacoes: 'Prefere ser chamada de Carlinha',
				relacionamento: 'casada'
			});
			expect(res.status).toBe(200);

			const d = await (await ver(tk.conselheiro!, id.visitante!)).json();
			expect(d.pessoa.dados.telefone).toBe('91988881234');
			expect(d.pessoa.dados.observacoes).toBe('Prefere ser chamada de Carlinha');

			const [log] = await ctx.db
				.select()
				.from(auditLog)
				.where(and(eq(auditLog.entityId, id.visitante!), eq(auditLog.action, 'person.atualizada')))
				.orderBy(desc(auditLog.at))
				.limit(1);
			expect(log?.after).toEqual({ campos: ['telefone', 'relacionamento', 'observacoes'] });
			expect(JSON.stringify(log)).not.toContain('98888');
		});

		it('recusa telefone inválido, campo desconhecido e quem não alcança a pessoa', async () => {
			expect((await editar(tk.conselheiro!, id.visitante!, { telefone: '123' })).status).toBe(400);
			expect((await editar(tk.lider!, id.visitante!, { status: 'membro' })).status).toBe(400);
			expect((await editar(tk.membro!, id.visitante!, { nome: 'Outro' })).status).toBe(403);
			expect((await editar(tk.conselheiro!, id.visitanteB!, { nome: 'Outro' })).status).toBe(403);
			expect((await editar(tk.conselheiro!, id.liderNoPg!, { nome: 'Outro' })).status).toBe(403);
			expect((await editar(tk.lider!, id.liderNoPg!, { nome: 'Lider Bruno Lima' })).status).toBe(
				200
			);
		});
	});

	describe('idade (ADR 0003)', () => {
		it('piso de 16 anos e data inválida', async () => {
			const menos = await editar(tk.lider!, id.visitanteB!, { dataNascimento: nascidoHa(15) });
			expect(menos.status).toBe(400);
			expect((await menos.json()).erro).toContain('16 anos');
			expect(
				(await editar(tk.lider!, id.visitanteB!, { dataNascimento: '2999-01-01' })).status
			).toBe(400);
			expect(
				(await editar(tk.lider!, id.visitanteB!, { dataNascimento: '2008-02-30' })).status
			).toBe(400);
		});

		it('16–17 anos: só nome e presença — contato e observações são recusados', async () => {
			// Sem contato nem conta: o menor pode ficar no cadastro mínimo.
			const ok = await editar(tk.lider!, id.visitanteB!, { dataNascimento: nascidoHa(17) });
			expect(ok.status).toBe(200);

			const d = await (await ver(tk.lider!, id.visitanteB!)).json();
			expect(d.pessoa.ehMenor).toBe(true);
			expect(d.pessoa.dados.idade).toBe(17);

			const contato = await editar(tk.lider!, id.visitanteB!, { whatsapp: '91977776666' });
			expect(contato.status).toBe(400);
			expect((await contato.json()).erro).toContain('consentimento');

			// Quem tem contato não pode virar menor sem antes tirar o contato.
			expect(
				(await editar(tk.lider!, id.visitante!, { dataNascimento: nascidoHa(16) })).status
			).toBe(400);

			// Aos 18 anos completos, tudo liberado.
			expect(
				(
					await editar(tk.lider!, id.visitanteB!, {
						dataNascimento: nascidoHa(18),
						whatsapp: '91977776666'
					})
				).status
			).toBe(200);
		});

		it('o próprio perfil grava o nascimento em person e respeita o piso', async () => {
			const me = (body: unknown) => meRoute.PUT(chamar(tk.membro!, body, {}, 'PUT'));

			expect((await me({ dataNascimento: nascidoHa(15) })).status).toBe(400);
			expect((await me({ dataNascimento: '1995-06-10', status: 'lider' })).status).toBe(200);

			const [p] = await ctx.db
				.select({ birthDate: personTable.birthDate })
				.from(personTable)
				.where(eq(personTable.id, id.membro!));
			expect(p?.birthDate).toBe('1995-06-10');
			// O estágio não muda pelo próprio perfil.
			expect((await estagioDe(id.membro!)).status).toBe('membro');
		});
	});

	describe('cadastro', () => {
		it('conselheiro cadastra visitante ou recorrente no próprio PG, nunca membro', async () => {
			const lista = await (await pessoasRoute.GET(chamar(tk.conselheiro!))).json();
			expect(lista.estagiosParaCadastro).toEqual(['visitante', 'recorrente']);

			const membro = await pessoasRoute.POST(
				chamar(tk.conselheiro!, { nome: 'Eva Souza', grupoId: pgA, estagio: 'membro' })
			);
			expect(membro.status).toBe(403);

			const rec = await pessoasRoute.POST(
				chamar(tk.conselheiro!, { nome: 'Eva Souza', grupoId: pgA, estagio: 'recorrente' })
			);
			expect(rec.status).toBe(201);
			const novaId = (await rec.json()).pessoa.id;
			expect((await estagioDe(novaId)).status).toBe('recorrente');
			expect(await papeisBase(novaId)).toEqual(['visitante']);

			const [h] = await ctx.db
				.select()
				.from(personStatusHistory)
				.where(eq(personStatusHistory.personId, novaId));
			expect(h).toMatchObject({ fromStatus: null, toStatus: 'recorrente', reason: 'Cadastro' });
		});

		it('sem estágio, nasce visitante; líder cadastra direto como membro', async () => {
			const padrao = await pessoasRoute.POST(chamar(tk.lider!, { nome: 'Fabio Reis' }));
			const padraoId = (await padrao.json()).pessoa.id;
			expect((await estagioDe(padraoId)).status).toBe('visitante');

			const res = await pessoasRoute.POST(
				chamar(tk.lider!, { nome: 'Gabi Rocha', grupoId: pgB, estagio: 'membro' })
			);
			expect(res.status).toBe(201);
			const gabi = (await res.json()).pessoa.id;
			expect(await papeisBase(gabi)).toEqual(['membro']);
			expect((await estagioDe(gabi)).joinedAt).not.toBeNull();
		});
	});

	describe('migração 0009 (dados antigos)', () => {
		it('alinha estágio com o acesso, cria perfil que faltava e traz o nascimento para person', async () => {
			// O jeito antigo: membro com perfil "visitante", pessoa sem perfil,
			// nascimento só no perfil.
			const [velho] = await ctx.db
				.insert(personTable)
				.values({ teamId: ctx.teamId, fullName: 'Membro Antigo' })
				.returning({ id: personTable.id });
			await ctx.db
				.insert(personRoleTable)
				.values({ personId: velho!.id, roleId: ctx.papeis.membro!, scopeType: 'self' });
			await ctx.db
				.insert(personProfile)
				.values({ personId: velho!.id, status: 'visitante', birthDate: '1990-01-15' });

			const [semPerfil] = await ctx.db
				.insert(personTable)
				.values({ teamId: ctx.teamId, fullName: 'Sem Perfil' })
				.returning({ id: personTable.id });

			const visitanteDeVerdade = await criar('Visitante Real', 'visitante', { conta: false });

			const sql = readFileSync('src/lib/server/db/migrations/0009_jornada_estagio.sql', 'utf8');
			for (const comando of sql.split('--> statement-breakpoint')) {
				await ctx.cliente.exec(comando);
			}

			expect((await estagioDe(velho!.id)).status).toBe('membro');
			expect((await estagioDe(semPerfil!.id)).status).toBe('visitante');
			expect((await estagioDe(visitanteDeVerdade)).status).toBe('visitante');
			const [p] = await ctx.db
				.select({ birthDate: personTable.birthDate })
				.from(personTable)
				.where(eq(personTable.id, velho!.id));
			expect(p?.birthDate).toBe('1990-01-15');
		});
	});
});

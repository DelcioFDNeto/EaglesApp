/**
 * Liderança: Master acima de todos e invisível; no máximo 2 líderes, com
 * mandato de 2 anos, renovado ou substituído.
 *
 * As regras de data recebem uma "data de referência", então o teste anda no
 * tempo sem esperar 2 anos: janela de renovação, vencimento, sucessão.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { and, eq, isNull } from 'drizzle-orm';
import { criarBancoDeTeste, type BancoDeTeste } from './helpers/banco';
import { tokenPara } from './helpers/token';
import { setTestDatabase } from '../../src/lib/server/db';
import {
	mandatoLider,
	person as personTable,
	personRole,
	role,
	userAccount
} from '../../src/lib/server/db/schema';
import { hashPassword } from '../../src/lib/server/auth/password';
import { resetEnvCache } from '../../src/lib/server/env';
import { loadActor } from '../../src/lib/server/policy/actor';
import {
	avisoDeLideranca,
	diasAte,
	encerrarMandato,
	hoje,
	periodoDoMandato,
	renovarMandato,
	somarDias,
	situacao,
	somarAnos,
	verLideranca
} from '../../src/lib/server/lideranca/mandatos';

import * as liderancaRoute from '../../src/routes/api/lideranca/+server';
import * as renovarRoute from '../../src/routes/api/lideranca/[id]/renovar/+server';
import * as encerrarRoute from '../../src/routes/api/lideranca/[id]/encerrar/+server';
import * as atribuicoesRoute from '../../src/routes/api/admin/atribuicoes/+server';
import * as atribuicaoRoute from '../../src/routes/api/admin/atribuicoes/[id]/+server';
import * as papeisRoute from '../../src/routes/api/admin/papeis/+server';
import * as papelRoute from '../../src/routes/api/admin/papeis/[id]/+server';
import * as pessoasRoute from '../../src/routes/api/pessoas/+server';
import * as conviteRoute from '../../src/routes/api/pessoas/[id]/convite/+server';

let ctx: BancoDeTeste;
const id: Record<string, string> = {};
const tk: Record<string, string> = {};

function evento(
	method: string,
	path: string,
	token: string,
	opts: { body?: unknown; params?: Record<string, string> } = {}
) {
	return {
		request: new Request(`https://api.eagles.test${path}`, {
			method,
			headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
			body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined
		}),
		params: opts.params ?? {},
		locals: {},
		url: new URL(`https://api.eagles.test${path}`),
		getClientAddress: () => '203.0.113.50'
	} as any;
}

async function criarPessoa(nome: string, papel: string) {
	const [p] = await ctx.db
		.insert(personTable)
		.values({ teamId: ctx.teamId, fullName: nome })
		.returning({ id: personTable.id });
	await ctx.db.insert(userAccount).values({
		personId: p!.id,
		email: `${nome.split(' ')[0]!.toLowerCase()}@eagles.test`,
		passwordHash: await hashPassword('senha12345')
	});
	await ctx.db.insert(personRole).values({
		personId: p!.id,
		roleId: ctx.papeis[papel]!,
		scopeType: papel === 'master' ? 'global' : 'self',
		scopeId: null
	});
	return p!.id;
}

const ator = async (chave: string) => (await loadActor(ctx.db, id[chave]!))!;
const papeisDe = async (chave: string) =>
	[...new Set((await ator(chave)).assignments.map((a) => a.roleKey))].sort();

async function mandatoAberto(chave: string) {
	const [m] = await ctx.db
		.select()
		.from(mandatoLider)
		.where(and(eq(mandatoLider.personId, id[chave]!), isNull(mandatoLider.encerradoEm)));
	return m;
}

const nomearHttp = (token: string, personId: string, inicio?: string) =>
	liderancaRoute.POST(evento('POST', '/api/lideranca', token, { body: { personId, inicio } }));

describe('datas do mandato', () => {
	it('2 anos certos, inclusive a partir de 29/02', () => {
		expect(somarAnos('2026-03-01', 2)).toBe('2028-03-01');
		expect(somarAnos('2028-02-29', 2)).toBe('2030-02-28');
	});

	it('data de início escolhida: passado sem nascer vencido, até 90 dias à frente', () => {
		const ref = '2026-11-26';
		expect(periodoDoMandato(null, ref)).toEqual({ ok: true, inicio: ref, fim: '2028-11-26' });
		// Mandato que já corre desde janeiro: entra com o ciclo certo.
		expect(periodoDoMandato('2026-01-01', ref)).toEqual({
			ok: true,
			inicio: '2026-01-01',
			fim: '2028-01-01'
		});
		expect(periodoDoMandato('2024-11-27', ref)).toMatchObject({ ok: true, fim: '2026-11-27' });
		// Já nasceria vencido (fim = hoje).
		expect(periodoDoMandato('2024-11-26', ref)).toMatchObject({
			ok: false,
			codigo: 'inicio_invalido'
		});
		expect(periodoDoMandato('2027-02-24', ref)).toMatchObject({ ok: true }); // 90 dias
		expect(periodoDoMandato('2027-02-25', ref)).toMatchObject({ ok: false }); // 91
		expect(periodoDoMandato('2026-02-30', ref)).toMatchObject({ ok: false });
		expect(periodoDoMandato('26/11/2026', ref)).toMatchObject({ ok: false });
	});

	it('em dia → janela de renovação (90 dias) → vencido no dia do fim', () => {
		expect(situacao('2028-03-01', '2027-12-01')).toBe('em_dia');
		expect(situacao('2028-03-01', '2027-12-02')).toBe('renovacao_aberta');
		expect(situacao('2028-03-01', '2028-02-29')).toBe('renovacao_aberta');
		expect(situacao('2028-03-01', '2028-03-01')).toBe('vencido');
		expect(diasAte('2028-03-01', '2028-03-05')).toBe(-4);
	});
});

describe('liderança: Master, 2 líderes e mandatos', () => {
	beforeAll(async () => {
		process.env.DATABASE_URL = 'postgres://teste@localhost:5432/teste';
		process.env.PUBLIC_ORIGIN = 'https://eagles.web.app';
		process.env.NODE_ENV = 'test';
		resetEnvCache();

		ctx = await criarBancoDeTeste();
		setTestDatabase(ctx.db);

		id.master = await criarPessoa('Dev Master', 'master');
		for (const nome of ['Ana', 'Bruno', 'Carla', 'Diego', 'Elisa']) {
			id[nome.toLowerCase()] = await criarPessoa(`${nome} Silva`, 'membro');
		}
		for (const [chave, pessoaId] of Object.entries(id)) {
			tk[chave] = await tokenPara(ctx.db, pessoaId);
		}
	}, 90_000);

	afterAll(async () => {
		setTestDatabase(null);
		await ctx?.fechar();
	});

	describe('nomeação e limite de 2', () => {
		it('membro não acessa a liderança', async () => {
			const res = await liderancaRoute.GET(evento('GET', '/api/lideranca', tk.carla!));
			expect(res.status).toBe(403);
			expect((await nomearHttp(tk.carla!, id.carla!)).status).toBe(403);
		});

		it('o Master nomeia 2 líderes por 2 anos; a terceira nomeação é recusada', async () => {
			expect((await nomearHttp(tk.master!, id.ana!)).status).toBe(201);
			// Ana, já líder, nomeia o segundo (vaga aberta).
			expect((await nomearHttp(tk.ana!, id.bruno!)).status).toBe(201);

			const terceiro = await nomearHttp(tk.master!, id.carla!);
			expect(terceiro.status).toBe(409);
			expect((await terceiro.json()).codigo).toBe('sem_vaga');

			const visao = await (await liderancaRoute.GET(evento('GET', '/x', tk.ana!))).json();
			expect(visao.vagas).toBe(0);
			expect(visao.podeNomear).toBe(false);
			expect(visao.mandatos.map((m: any) => m.nome).sort()).toEqual(['Ana Silva', 'Bruno Silva']);
			for (const m of visao.mandatos) expect(m.fim).toBe(somarAnos(m.inicio, 2));

			expect(await papeisDe('ana')).toEqual(['lider', 'membro']);
		});

		it('o banco também barra o terceiro líder (gatilho), mesmo por fora da aplicação', async () => {
			await expect(
				ctx.db.insert(mandatoLider).values({
					teamId: ctx.teamId,
					personId: id.carla!,
					inicio: '2026-01-01',
					fim: '2028-01-01'
				})
			).rejects.toThrow();
		});

		it('não nomeia quem já é líder nem o Master', async () => {
			const visao = await verLideranca(ctx.db, await ator('master'));
			// Abre uma vaga (Master encerra o Bruno sem sucessor) para testar só o candidato.
			const bruno = visao.mandatos.find((m) => m.personId === id.bruno)!;
			await encerrarMandato(ctx.db, await ator('master'), bruno.id);

			expect((await nomearHttp(tk.ana!, id.ana!)).status).toBe(409);
			expect((await nomearHttp(tk.ana!, id.master!)).status).toBe(404);

			// Data de início que faria o mandato nascer vencido: recusada.
			const vencidoDeNascenca = await nomearHttp(tk.ana!, id.bruno!, somarAnos(hoje(), -2));
			expect(vencidoDeNascenca.status).toBe(400);
			expect((await vencidoDeNascenca.json()).codigo).toBe('inicio_invalido');

			// Devolve o Bruno à liderança com um mandato que já corria há 300 dias.
			const inicio = somarDias(hoje(), -300);
			const res = await nomearHttp(tk.ana!, id.bruno!, inicio);
			expect(res.status).toBe(201);
			expect(await res.json()).toMatchObject({ inicio, fim: somarAnos(inicio, 2) });
			expect(await mandatoAberto('bruno')).toMatchObject({ inicio, fim: somarAnos(inicio, 2) });
		});
	});

	describe('renovação', () => {
		it('só abre 90 dias antes do fim, e cada líder renova o próprio', async () => {
			const ana = (await mandatoAberto('ana'))!;

			const cedo = await renovarRoute.POST(
				evento('POST', '/x', tk.ana!, { params: { id: ana.id } })
			);
			expect(cedo.status).toBe(409);
			expect((await cedo.json()).codigo).toBe('fora_da_janela');

			// Um mês antes do fim: dentro da janela de 90 dias, qualquer que seja a data.
			const naJanela = new Date(Date.parse(`${ana.fim}T00:00:00Z`) - 30 * 86_400_000)
				.toISOString()
				.slice(0, 10);
			expect(situacao(ana.fim, naJanela)).toBe('renovacao_aberta');
			const doOutro = await renovarMandato(ctx.db, await ator('bruno'), ana.id, naJanela);
			expect(doOutro).toMatchObject({ ok: false, codigo: 'sem_permissao' });

			const renovado = await renovarMandato(ctx.db, await ator('ana'), ana.id, naJanela);
			expect(renovado).toMatchObject({ ok: true, fim: somarAnos(ana.fim, 2) });

			// O ciclo emenda: o novo mandato começa onde o anterior terminava.
			const novo = (await mandatoAberto('ana'))!;
			expect(novo.inicio).toBe(ana.fim);
			const [antigo] = await ctx.db.select().from(mandatoLider).where(eq(mandatoLider.id, ana.id));
			expect(antigo!.motivoEncerramento).toBe('renovado');
		});

		it('vencido há muito tempo, a renovação recomeça na data de hoje', async () => {
			const bruno = (await mandatoAberto('bruno'))!;
			const muitoDepois = somarAnos(bruno.fim, 3);
			const r = await renovarMandato(ctx.db, await ator('master'), bruno.id, muitoDepois);
			expect(r).toMatchObject({ ok: true, fim: somarAnos(muitoDepois, 2) });
		});
	});

	describe('vencimento e substituição', () => {
		it('mandato vencido continua dando acesso, e o Início avisa', async () => {
			const ana = (await mandatoAberto('ana'))!;
			const depoisDoFim = somarAnos(ana.fim, 1);
			expect(situacao(ana.fim, depoisDoFim)).toBe('vencido');

			expect(await papeisDe('ana')).toContain('lider');
			expect((await ator('ana')).assignments.some((a) => a.permissions.has('rbac.manage'))).toBe(
				true
			);

			const aviso = await avisoDeLideranca(ctx.db, await ator('bruno'), depoisDoFim);
			expect(aviso).toBe('O mandato de Ana venceu. Renove ou indique quem assume.');
			expect(await avisoDeLideranca(ctx.db, await ator('carla'), depoisDoFim)).toBeNull();
		});

		it('um líder só encerra o mandato do outro depois que venceu — e já indica o sucessor', async () => {
			const ana = (await mandatoAberto('ana'))!;

			const emDia = await encerrarRoute.POST(
				evento('POST', '/x', tk.bruno!, { params: { id: ana.id }, body: { sucessorId: id.carla } })
			);
			expect(emDia.status).toBe(403);

			const vencido = somarAnos(ana.fim, 1);
			// O mandato da Carla emenda onde o da Ana terminou: o ciclo se mantém.
			const troca = await encerrarMandato(
				ctx.db,
				await ator('bruno'),
				ana.id,
				{ sucessorId: id.carla, inicio: ana.fim },
				vencido
			);
			expect(troca.ok).toBe(true);
			expect(await mandatoAberto('carla')).toMatchObject({
				inicio: ana.fim,
				fim: somarAnos(ana.fim, 2)
			});

			expect(await papeisDe('ana')).toEqual(['membro']);
			expect(await papeisDe('carla')).toEqual(['lider', 'membro']);
			const [registro] = await ctx.db
				.select()
				.from(mandatoLider)
				.where(eq(mandatoLider.id, ana.id));
			expect(registro).toMatchObject({ motivoEncerramento: 'substituido' });
		});

		it('quem não tinha outro papel volta a ser membro ao sair', async () => {
			// Elisa entra na liderança só com o papel de líder…
			await ctx.db.delete(personRole).where(eq(personRole.personId, id.elisa!));
			const carla = (await mandatoAberto('carla'))!;
			await encerrarMandato(ctx.db, await ator('master'), carla.id, { sucessorId: id.elisa });
			expect(await papeisDe('elisa')).toEqual(['lider']);

			// …e, ao sair, não fica sem acesso nenhum.
			const elisa = (await mandatoAberto('elisa'))!;
			await encerrarMandato(ctx.db, await ator('elisa'), elisa.id, { sucessorId: id.carla });
			expect(await papeisDe('elisa')).toEqual(['membro']);
		});

		it('o último líder não sai sem sucessor; o Master pode encerrar', async () => {
			const carla = (await mandatoAberto('carla'))!;
			const renuncia = await encerrarRoute.POST(
				evento('POST', '/x', tk.carla!, { params: { id: carla.id } })
			);
			expect(renuncia.status).toBe(200); // ainda há o Bruno

			const bruno = (await mandatoAberto('bruno'))!;
			const ultimo = await encerrarRoute.POST(
				evento('POST', '/x', tk.bruno!, { params: { id: bruno.id } })
			);
			expect(ultimo.status).toBe(409);
			expect((await ultimo.json()).codigo).toBe('sem_sucessor');

			const peloMaster = await encerrarMandato(ctx.db, await ator('master'), bruno.id);
			expect(peloMaster.ok).toBe(true);
			expect(await avisoDeLideranca(ctx.db, await ator('master'))).toBe(
				'A equipe está sem líderes. Nomeie em Liderança.'
			);

			// Volta a ter um líder (Diego) para os testes de RBAC.
			expect((await nomearHttp(tk.master!, id.diego!)).status).toBe(201);
		});
	});

	describe('ninguém chega ao nível de líder por fora do mandato', () => {
		it('a atribuição comum não dá nem tira o papel de líder', async () => {
			const darLider = await atribuicoesRoute.POST(
				evento('POST', '/x', tk.diego!, {
					body: { personId: id.carla, roleId: ctx.papeis.lider, scopeType: 'global' }
				})
			);
			expect(darLider.status).toBe(400);
			expect((await darLider.json()).codigo).toBe('papel_reservado');

			const [atribuicaoLider] = await ctx.db
				.select({ id: personRole.id })
				.from(personRole)
				.where(and(eq(personRole.personId, id.diego!), eq(personRole.roleId, ctx.papeis.lider!)));
			const tirar = await atribuicaoRoute.DELETE(
				evento('DELETE', '/x', tk.diego!, { params: { id: atribuicaoLider!.id } })
			);
			expect(tirar.status).toBe(400);
		});

		it('nenhum outro papel recebe "rbac.manage", e só o Master edita o papel de líder', async () => {
			const novo = await papeisRoute.POST(
				evento('POST', '/x', tk.diego!, {
					body: { key: 'vice', name: 'Vice', permissions: ['rbac.manage', 'person.view'] }
				})
			);
			expect(novo.status).toBe(400);
			expect((await novo.json()).codigo).toBe('permissao_reservada');

			const ampliarConselheiro = await papelRoute.PUT(
				evento('PUT', '/x', tk.diego!, {
					params: { id: ctx.papeis.conselheiro! },
					body: { permissions: ['person.view', 'rbac.manage'] }
				})
			);
			expect(ampliarConselheiro.status).toBe(400);

			const mexerNoLider = await papelRoute.PUT(
				evento('PUT', '/x', tk.diego!, {
					params: { id: ctx.papeis.lider! },
					body: { name: 'Chefe' }
				})
			);
			expect(mexerNoLider.status).toBe(403);

			const peloMaster = await papelRoute.PUT(
				evento('PUT', '/x', tk.master!, {
					params: { id: ctx.papeis.lider! },
					body: { description: 'Líder da equipe (mandato de 2 anos).' }
				})
			);
			expect(peloMaster.status).toBe(200);
		});
	});

	describe('o Master é invisível para a equipe', () => {
		it('não aparece em pessoas, papéis nem atribuições, e não pode ser convidado nem tocado', async () => {
			const pessoas = await (
				await pessoasRoute.GET(evento('GET', '/api/pessoas', tk.diego!))
			).json();
			expect(pessoas.pessoas.some((p: any) => p.id === id.master)).toBe(false);

			const papeis = await (await papeisRoute.GET(evento('GET', '/x', tk.diego!))).json();
			expect(papeis.papeis.some((r: any) => r.key === 'master')).toBe(false);
			expect(papeis.atribuicoes.some((a: any) => a.personId === id.master)).toBe(false);
			expect(papeis.papeis.find((r: any) => r.key === 'lider').reservado).toBe(true);

			const convite = await conviteRoute.POST(
				evento('POST', '/x', tk.diego!, { params: { id: id.master! } })
			);
			expect(convite.status).toBe(404);

			const [atribuicaoMaster] = await ctx.db
				.select({ id: personRole.id })
				.from(personRole)
				.innerJoin(role, eq(role.id, personRole.roleId))
				.where(and(eq(personRole.personId, id.master!), eq(role.key, 'master')));
			const tirar = await atribuicaoRoute.DELETE(
				evento('DELETE', '/x', tk.diego!, { params: { id: atribuicaoMaster!.id } })
			);
			expect(tirar.status).toBe(404);

			const darPapelAoMaster = await atribuicoesRoute.POST(
				evento('POST', '/x', tk.diego!, {
					body: { personId: id.master, roleId: ctx.papeis.conselheiro, scopeType: 'global' }
				})
			);
			expect(darPapelAoMaster.status).toBe(404);
		});

		it('o próprio Master vê o papel Master na administração', async () => {
			const papeis = await (await papeisRoute.GET(evento('GET', '/x', tk.master!))).json();
			expect(papeis.papeis.some((r: any) => r.key === 'master')).toBe(true);
		});
	});
});

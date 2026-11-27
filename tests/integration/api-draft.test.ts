/**
 * Integração real (PGlite) do módulo de Perfil de Atributos e Draft:
 *   - Visibilidade entre membros Eagles sem vazamento de dados sensíveis;
 *   - Visitante bloqueado (403); Master invisível;
 *   - Avaliação (0–10) restrita a líderes e conselheiros (respeitando alcancaAlvo);
 *   - Autoedição de dados complementares (altura, peso, lateralidade, camiseta,
 *     pontos fortes) via `/api/pessoas/me` sem alterar notas de avaliação;
 *   - Proteção de menores (16–17 anos, ADR 0003);
 *   - Sugestão determinística de times e persistência de sessões de Draft.
 */

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
	userAccount as userAccountTable
} from '../../src/lib/server/db/schema';
import { hashPassword } from '../../src/lib/server/auth/password';
import { tokenPara } from './helpers/token';
import { resetEnvCache } from '../../src/lib/server/env';

import * as atributosRoute from '../../src/routes/api/pessoas/[id]/atributos/+server';
import * as pessoaRoute from '../../src/routes/api/pessoas/[id]/+server';
import * as meRoute from '../../src/routes/api/pessoas/me/+server';
import * as perfisDraftRoute from '../../src/routes/api/draft/perfis/+server';
import * as sugerirDraftRoute from '../../src/routes/api/draft/sugerir/+server';
import * as sessoesDraftRoute from '../../src/routes/api/draft/sessoes/+server';
import * as sessaoDraftRoute from '../../src/routes/api/draft/sessoes/[id]/+server';

const hashDeTeste = hashPassword('senha12345');

let ctx: BancoDeTeste;
let subgrupoA: string;
const id = {
	master: '',
	lider: '',
	conselheiro: '',
	membro1: '',
	membro2: '',
	membro3: '',
	membro4: '',
	visitante: '',
	menor: ''
};
const tk = {
	lider: '',
	conselheiro: '',
	membro1: '',
	visitante: ''
};

function chamar(
	token: string | null,
	body?: unknown,
	params: Record<string, string> = {},
	method = body === undefined ? 'GET' : 'POST'
) {
	return {
		request: new Request('https://app.eagles.test/api/draft', {
			method,
			headers: {
				'Content-Type': 'application/json',
				...(token ? { Authorization: `Bearer ${token}` } : {})
			},
			body: body === undefined ? undefined : JSON.stringify(body)
		}),
		params,
		url: new URL('https://app.eagles.test/api/draft'),
		locals: {},
		getClientAddress: () => '127.0.0.1'
	} as any;
}

async function criar(
	nome: string,
	papel: 'master' | 'lider' | 'conselheiro' | 'membro' | 'visitante',
	opts: {
		grupo?: string;
		estagio?: string;
		birthDate?: string;
		telefone?: string;
		conta?: boolean;
	} = {}
) {
	const escopo =
		papel === 'master' || papel === 'lider' || papel === 'conselheiro' ? 'global' : 'self';
	const [p] = await ctx.db
		.insert(personTable)
		.values({
			teamId: ctx.teamId,
			fullName: nome,
			birthDate: opts.birthDate ?? null
		})
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
		scopeId: null
	});

	if (opts.grupo) {
		await ctx.db.insert(groupMember).values({ groupId: opts.grupo, personId: p!.id });
	}

	await ctx.db.insert(personProfile).values({
		personId: p!.id,
		status: opts.estagio ?? (papel === 'visitante' ? 'visitante' : 'membro'),
		phone: opts.telefone ?? null,
		whatsapp: opts.telefone ?? null,
		notes: opts.telefone ? 'Observação pastoral reservada' : null
	});

	return p!.id;
}

beforeAll(async () => {
	process.env.DATABASE_URL ??= 'postgres://eagles:eagles@localhost:5432/eagles_test';
	process.env.PUBLIC_ORIGIN ??= 'https://app.eagles.test';
	resetEnvCache();
	ctx = await criarBancoDeTeste();
	setTestDatabase(ctx.db);

	const [g] = await ctx.db
		.insert(groupTable)
		.values({ teamId: ctx.teamId, slug: 'subgrupo-a', name: 'Subgrupo A' })
		.returning({ id: groupTable.id });
	subgrupoA = g!.id;

	id.master = await criar('Dev Master', 'master');
	id.lider = await criar('Ana Lider', 'lider', { telefone: '91999990001' });
	id.conselheiro = await criar('Pedro Conselheiro', 'conselheiro', { grupo: subgrupoA });
	id.membro1 = await criar('Joao Membro', 'membro', {
		grupo: subgrupoA,
		telefone: '91999990002'
	});
	id.membro2 = await criar('Leticia Membro', 'membro', { grupo: subgrupoA });
	id.membro3 = await criar('Gustavo Membro', 'membro');
	id.membro4 = await criar('Camila Membro', 'membro');
	id.visitante = await criar('Thiago Visitante', 'visitante');
	const hoje = new Date();
	const menorNascimento = `${hoje.getFullYear() - 17}-05-10`;
	id.menor = await criar('Lucas Menor', 'visitante', {
		birthDate: menorNascimento,
		conta: false
	});

	tk.lider = await tokenPara(ctx.db, id.lider);
	tk.conselheiro = await tokenPara(ctx.db, id.conselheiro);
	tk.membro1 = await tokenPara(ctx.db, id.membro1);
	tk.visitante = await tokenPara(ctx.db, id.visitante);
}, 30_000);

afterAll(async () => {
	setTestDatabase(null);
	await ctx?.fechar();
});

describe('API de Atributos e Draft', () => {
	it('conselheiro avalia atributos (0–10) e medidas de um membro com auditoria', async () => {
		const res = await atributosRoute.PUT(
			chamar(
				tk.conselheiro,
				{
					fisico: 9,
					biblico: 7,
					mental: 8,
					coordenacaoMotora: 8,
					alturaCm: 182,
					pesoKg: 78.5,
					lateralidade: 'destro',
					tamanhoCamiseta: 'G',
					pontosFortes: 'Velocidade e liderança em circuito',
					observacaoDraft: 'Bom para provas de equipe'
				},
				{ id: id.membro1 },
				'PUT'
			)
		);
		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body.alterado).toBe(true);
		expect(body.atributos).toMatchObject({
			fisico: 9,
			biblico: 7,
			mental: 8,
			coordenacaoMotora: 8,
			media: 8,
			completo: true,
			alturaCm: 182,
			pesoKg: 78.5,
			lateralidade: 'destro',
			tamanhoCamiseta: 'G',
			pontosFortes: 'Velocidade e liderança em circuito',
			observacaoDraft: 'Bom para provas de equipe',
			avaliadoPor: 'Pedro Conselheiro'
		});

		const [log] = await ctx.db
			.select()
			.from(auditLog)
			.where(
				and(eq(auditLog.entityId, id.membro1), eq(auditLog.action, 'person.atributos_atualizados'))
			)
			.orderBy(desc(auditLog.at))
			.limit(1);
		expect(log).toBeDefined();

		// Ficha da pessoa também já devolve os atributos.
		const fichaRes = await pessoaRoute.GET(chamar(tk.conselheiro, undefined, { id: id.membro1 }));
		expect(fichaRes.status).toBe(200);
		const ficha = await fichaRes.json();
		expect(ficha.pessoa.atributos.media).toBe(8);
		expect(ficha.permissoes.podeEditarAtributos).toBe(true);
	});

	it('respeita hierarquia e limites: membro não avalia, conselheiro não edita líder, notas fora de 0–10 falham', async () => {
		// Membro tentando avaliar
		const rMembro = await atributosRoute.PUT(
			chamar(tk.membro1, { fisico: 10 }, { id: id.membro2 }, 'PUT')
		);
		expect(rMembro.status).toBe(403);

		// Conselheiro tentando editar líder
		const rConselheiroLider = await atributosRoute.PUT(
			chamar(tk.conselheiro, { fisico: 8 }, { id: id.lider }, 'PUT')
		);
		expect(rConselheiroLider.status).toBe(403);

		// Líder pode avaliar líder e demais membros
		const rLider = await atributosRoute.PUT(
			chamar(
				tk.lider,
				{ fisico: 7, biblico: 9, mental: 9, coordenacaoMotora: 7, alturaCm: 168 },
				{ id: id.lider },
				'PUT'
			)
		);
		expect(rLider.status).toBe(200);

		// Nota fora do intervalo 0–10 ou decimal
		const rNotaInvalida = await atributosRoute.PUT(
			chamar(tk.lider, { fisico: 11 }, { id: id.membro2 }, 'PUT')
		);
		expect(rNotaInvalida.status).toBe(400);

		const rAlturaInvalida = await atributosRoute.PUT(
			chamar(tk.lider, { alturaCm: 80 }, { id: id.membro2 }, 'PUT')
		);
		expect(rAlturaInvalida.status).toBe(400);
	});

	it('bloqueia atributos e medidas para menor de 18 anos sem consentimento (ADR 0003)', async () => {
		const res = await atributosRoute.PUT(
			chamar(tk.lider, { fisico: 7, alturaCm: 170 }, { id: id.menor }, 'PUT')
		);
		expect(res.status).toBe(400);
		const body = await res.json();
		expect(body.erro).toMatch(/16 e 17 anos|LGPD/i);
	});

	it('membro atualiza próprios dados complementares em /api/pessoas/me sem alterar notas da liderança', async () => {
		const putRes = await meRoute.PUT(
			chamar(
				tk.membro1,
				{
					alturaCm: 183,
					pesoKg: 79.2,
					lateralidade: 'ambidestro',
					tamanhoCamiseta: 'GG',
					pontosFortes: 'Corrida e trabalho em equipe',
					// Campos de nota não existem no schema de autoedição e não alteram avaliação:
					fisico: 10
				},
				{},
				'PUT'
			)
		);
		expect(putRes.status).toBe(200);

		const getRes = await meRoute.GET(chamar(tk.membro1));
		expect(getRes.status).toBe(200);
		const me = await getRes.json();
		expect(me.atributos).toMatchObject({
			fisico: 9, // preservado da avaliação do conselheiro
			biblico: 7,
			mental: 8,
			coordenacaoMotora: 8,
			alturaCm: 183,
			pesoKg: 79.2,
			lateralidade: 'ambidestro',
			tamanhoCamiseta: 'GG',
			pontosFortes: 'Corrida e trabalho em equipe'
		});
	});

	it('todos os membros visualizam perfis de atributos no Draft sem vazar dados sensíveis nem Master; visitante recebe 403', async () => {
		const rVisitante = await perfisDraftRoute.GET(chamar(tk.visitante));
		expect(rVisitante.status).toBe(403);

		const rMembro = await perfisDraftRoute.GET(chamar(tk.membro1));
		expect(rMembro.status).toBe(200);
		const data = await rMembro.json();

		expect(data.podeAvaliar).toBe(false);
		expect(data.podeSalvarDraft).toBe(false);

		// Master invisível
		const nomes = data.perfis.map((p: any) => p.nome);
		expect(nomes).not.toContain('Dev Master');
		expect(nomes).toContain('Ana Lider');
		expect(nomes).toContain('Joao Membro');

		// Nenhum dado sensível exposto (telefone, email, observações pastorais)
		const serializado = JSON.stringify(data);
		expect(serializado).not.toContain('91999990001');
		expect(serializado).not.toContain('91999990002');
		expect(serializado).not.toContain('Observação pastoral reservada');

		// Membro pode ler atributos individuais de outro membro, mas não a ficha pastoral completa
		const rAttrOutro = await atributosRoute.GET(chamar(tk.membro1, undefined, { id: id.lider }));
		expect(rAttrOutro.status).toBe(200);
		const rFichaOutro = await pessoaRoute.GET(chamar(tk.membro1, undefined, { id: id.lider }));
		expect(rFichaOutro.status).toBe(403);
	});

	it('sugere times equilibrados e salva/consulta/remove sessões de Draft respeitando permissões', async () => {
		// Avalia os demais membros para um draft completo
		await atributosRoute.PUT(
			chamar(
				tk.lider,
				{ fisico: 6, biblico: 9, mental: 8, coordenacaoMotora: 8 },
				{ id: id.membro2 },
				'PUT'
			)
		);
		await atributosRoute.PUT(
			chamar(
				tk.lider,
				{ fisico: 8, biblico: 6, mental: 7, coordenacaoMotora: 8 },
				{ id: id.membro3 },
				'PUT'
			)
		);
		await atributosRoute.PUT(
			chamar(
				tk.lider,
				{ fisico: 6, biblico: 8, mental: 8, coordenacaoMotora: 7 },
				{ id: id.membro4 },
				'PUT'
			)
		);

		// Visitante bloqueado
		const rVis = await sugerirDraftRoute.POST(
			chamar(tk.visitante, {
				participantesIds: [id.membro1, id.membro2, id.membro3, id.membro4],
				quantidadeTimes: 2
			})
		);
		expect(rVis.status).toBe(403);

		// Membro pode simular o Draft
		const rSug = await sugerirDraftRoute.POST(
			chamar(tk.membro1, {
				participantesIds: [id.membro1, id.membro2, id.membro3, id.membro4],
				quantidadeTimes: 2,
				nomesTimes: ['Time Vermelho', 'Time Azul'],
				foco: 'equilibrado'
			})
		);
		expect(rSug.status).toBe(200);
		const sug = await rSug.json();
		expect(sug.times).toHaveLength(2);
		expect(sug.times[0].totalMembros).toBe(2);
		expect(sug.times[1].totalMembros).toBe(2);
		expect(sug.equilibrio.diferencaGeral).toBeLessThanOrEqual(0.5);

		const timesPayload = sug.times.map((t: any) => ({
			nome: t.nome,
			membros: t.membros.map((m: any) => ({ personId: m.personId, nome: m.nome }))
		}));

		// Membro NÃO salva sessão oficial
		const rSalvarMembro = await sessoesDraftRoute.POST(
			chamar(tk.membro1, { titulo: 'Teste Membro', foco: 'equilibrado', times: timesPayload })
		);
		expect(rSalvarMembro.status).toBe(403);

		// Conselheiro salva sessão oficial
		const rSalvar = await sessoesDraftRoute.POST(
			chamar(tk.conselheiro, {
				titulo: 'Draft Gincana de Maio',
				observacao: 'Provas às 15h',
				foco: 'equilibrado',
				times: timesPayload
			})
		);
		expect(rSalvar.status).toBe(201);
		const salva = await rSalvar.json();
		const sessaoId = salva.sessao.id as string;

		// Membro consulta sessões salvas
		const rListar = await sessoesDraftRoute.GET(chamar(tk.membro1));
		expect(rListar.status).toBe(200);
		const listadas = await rListar.json();
		expect(
			listadas.sessoes.some((s: any) => s.id === sessaoId && s.titulo === 'Draft Gincana de Maio')
		).toBe(true);

		// Membro não remove; conselheiro remove
		const rDelMembro = await sessaoDraftRoute.DELETE(
			chamar(tk.membro1, undefined, { id: sessaoId }, 'DELETE')
		);
		expect(rDelMembro.status).toBe(403);

		const rDel = await sessaoDraftRoute.DELETE(
			chamar(tk.conselheiro, undefined, { id: sessaoId }, 'DELETE')
		);
		expect(rDel.status).toBe(200);
	});
});

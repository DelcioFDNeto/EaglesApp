import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { and, eq, sql } from 'drizzle-orm';
import { criarBancoDeTeste, criarGrupo, type BancoDeTeste } from './helpers/banco';
import {
	attendance,
	event,
	groupMembership,
	person,
	personRole,
	rsvp,
	rsvpHistory
} from '../../src/lib/server/db/schema';
import { PolicyDenied, type Actor } from '../../src/lib/server/policy/policy';
import { loadActor } from '../../src/lib/server/policy/actor';
import {
	cancelarEvento,
	criarEvento,
	encerrarSerie,
	garantirOcorrencias
} from '../../src/lib/server/modules/eventos/eventos';
import { EventoRecusado, type Alvo } from '../../src/lib/server/modules/eventos/regras';
import { eventoSchema } from '../../src/lib/server/modules/eventos/validacao';
import { criarPessoaSchema } from '../../src/lib/server/modules/pessoas/validacao';
import {
	quemRespondeu,
	responder,
	totaisDoEvento
} from '../../src/lib/server/modules/presenca/rsvp';
import { paineisDeResposta } from '../../src/lib/server/modules/presenca/painel';
import {
	arquivarResposta,
	definirRespostasDoTipo,
	respostasDoTipo
} from '../../src/lib/server/modules/presenca/respostas';
import {
	cadastrarNaPorta,
	listaDePresenca,
	registrarLista
} from '../../src/lib/server/modules/presenca/lista';
import {
	confirmacaoXPresenca,
	frequenciaDaPessoa,
	frequenciaDoGrupo,
	relatorio
} from '../../src/lib/server/modules/presenca/frequencia';
import { hojeNoFuso, somarDias } from '../../src/lib/shared/fuso';

/**
 * Módulo 06 — presença.
 *
 * Cada cenário de frequência usa um grupo próprio: a frequência soma todos os
 * eventos com lista da equipe, e um cenário não pode contaminar o outro.
 */

const FUSO = 'America/Sao_Paulo';
const DIA = 86_400_000;

let ctx: BancoDeTeste;
let azul: string;
let verde: string;
let lider: Actor;
let conselheiroAzul: Actor;
let membroAzul: Actor;
let membroVerde: Actor;
let contador = 0;

const hoje = () => hojeNoFuso(FUSO);
const diasAtras = (n: number) => somarDias(hoje(), -n);
const ha = (dias: number) => new Date(Date.now() - dias * DIA);

/**
 * Uma pessoa da equipe, cadastrada e no grupo desde `desde` — com papel,
 * se pedido. As passagens por grupo são append-only: a data de entrada vai
 * no INSERT.
 */
async function pessoa(
	nome: string,
	opcoes: { grupo?: string; desde?: Date; papel?: string; escopo?: string } = {}
): Promise<{ id: string; actor: Actor | null }> {
	const desde = opcoes.desde ?? ha(120);
	const [p] = await ctx.db
		.insert(person)
		.values({ teamId: ctx.teamId, fullName: nome, createdAt: desde })
		.returning({ id: person.id });
	if (opcoes.grupo) {
		await ctx.db
			.insert(groupMembership)
			.values({ groupId: opcoes.grupo, personId: p!.id, joinedAt: desde });
	}
	if (!opcoes.papel) return { id: p!.id, actor: null };
	await ctx.db.insert(personRole).values({
		personId: p!.id,
		roleId: ctx.papeis[opcoes.papel]!,
		scopeType: opcoes.escopo ? 'group' : opcoes.papel === 'lider' ? 'global' : 'self',
		scopeId: opcoes.escopo ?? null
	});
	return { id: p!.id, actor: (await loadActor(ctx.db, p!.id))! };
}

const ator = async (...args: Parameters<typeof pessoa>) => (await pessoa(...args)).actor!;

/** Um encontro do grupo, publicado, na data local pedida, às 20h. */
async function encontro(
	grupo: string,
	data: string,
	extra: Record<string, unknown> = {},
	publico: Alvo[] = [{ tipo: 'grupo', groupId: grupo }]
): Promise<string> {
	const dados = eventoSchema.parse({
		tipoId: ctx.tiposDeEvento.encontro_pg,
		titulo: `Encontro ${++contador}`,
		grupoId: grupo,
		data,
		horaInicio: '20:00',
		publicar: true,
		...extra
	});
	return (await criarEvento(ctx.db, lider, dados, publico)).id;
}

beforeAll(async () => {
	ctx = await criarBancoDeTeste();
	azul = await criarGrupo(ctx, 'PG Azul');
	verde = await criarGrupo(ctx, 'PG Verde');
	lider = await ator('Líder', { papel: 'lider' });
	conselheiroAzul = await ator('Conselheiro Azul', { papel: 'conselheiro', escopo: azul });
	membroAzul = await ator('Membro Azul', { papel: 'membro', grupo: azul });
	membroVerde = await ator('Membro Verde', { papel: 'membro', grupo: verde });
});

afterAll(async () => {
	await ctx.fechar();
});

// ---------------------------------------------------------------------------
// RSVP (D-M06-2, D-M06-3)
// ---------------------------------------------------------------------------

describe('você vai? — RSVP versionado pelo banco', () => {
	let futuro: string;

	beforeAll(async () => {
		futuro = await encontro(azul, somarDias(hoje(), 3));
	});

	it('responder e mudar de ideia: uma resposta atual, duas no histórico', async () => {
		await responder(ctx.db, membroAzul, futuro, { respostaId: ctx.respostas.vou! });
		await responder(ctx.db, membroAzul, futuro, { respostaId: ctx.respostas.nao_vou! });

		const atuais = await ctx.db.select().from(rsvp).where(eq(rsvp.eventId, futuro));
		expect(atuais).toHaveLength(1);
		expect(atuais[0]!.optionId).toBe(ctx.respostas.nao_vou);

		const historico = await ctx.db
			.select()
			.from(rsvpHistory)
			.where(and(eq(rsvpHistory.eventId, futuro), eq(rsvpHistory.personId, membroAzul.personId)));
		expect(historico.map((h) => h.optionId).sort()).toEqual(
			[ctx.respostas.vou!, ctx.respostas.nao_vou!].sort()
		);
	});

	it('o histórico é do banco: preenchido mesmo por um INSERT direto, e não se altera', async () => {
		const outro = await encontro(azul, somarDias(hoje(), 4));
		await ctx.db.insert(rsvp).values({
			eventId: outro,
			personId: membroAzul.personId,
			optionId: ctx.respostas.talvez!,
			respondedByPersonId: membroAzul.personId
		});
		const [h] = await ctx.db.select().from(rsvpHistory).where(eq(rsvpHistory.eventId, outro));
		expect(h?.optionId).toBe(ctx.respostas.talvez);

		await expect(
			ctx.db.execute(sql`update rsvp_history set guests = 3 where event_id = ${outro}`)
		).rejects.toThrow();
		await expect(
			ctx.db.execute(sql`delete from rsvp_history where event_id = ${outro}`)
		).rejects.toThrow();
		await expect(
			ctx.db.execute(
				sql`update rsvp set person_id = ${membroVerde.personId} where event_id = ${outro}`
			)
		).rejects.toThrow(/não muda de evento nem de pessoa/);
	});

	it('convidados só com resposta que aceita convidados', async () => {
		const e = await encontro(azul, somarDias(hoje(), 5));
		await responder(ctx.db, membroAzul, e, { respostaId: ctx.respostas.vou!, convidados: 2 });
		let [r] = await ctx.db.select().from(rsvp).where(eq(rsvp.eventId, e));
		expect(r!.guests).toBe(2);

		await responder(ctx.db, membroAzul, e, { respostaId: ctx.respostas.talvez!, convidados: 5 });
		[r] = await ctx.db.select().from(rsvp).where(eq(rsvp.eventId, e));
		expect(r!.guests).toBe(0);

		// E o banco recusa o atalho.
		await expect(
			ctx.db.execute(sql`update rsvp set guests = 4 where event_id = ${e}`)
		).rejects.toThrow(/não aceita convidados/);
	});

	it('quem não vê o evento não responde — "não existe", e não "proibido"', async () => {
		await expect(
			responder(ctx.db, membroVerde, futuro, { respostaId: ctx.respostas.vou! })
		).rejects.toMatchObject({ motivo: 'nao_encontrado' });
	});

	it('evento cancelado não recebe resposta — nem pelo serviço, nem pelo banco', async () => {
		const e = await encontro(azul, somarDias(hoje(), 6));
		await cancelarEvento(ctx.db, lider, e, 'Chuva');
		await expect(
			responder(ctx.db, membroAzul, e, { respostaId: ctx.respostas.vou! })
		).rejects.toBeInstanceOf(EventoRecusado);
		await expect(
			ctx.db.insert(rsvp).values({
				eventId: e,
				personId: membroAzul.personId,
				optionId: ctx.respostas.vou!,
				respondedByPersonId: membroAzul.personId
			})
		).rejects.toThrow();
	});

	it('cada tipo oferece as suas respostas (RN-11): reunião de liderança não tem "talvez"', async () => {
		const reuniao = await encontro(verde, somarDias(hoje(), 2), {
			tipoId: ctx.tiposDeEvento.reuniao_lideranca
		});
		const oferecidas = await respostasDoTipo(
			ctx.db,
			ctx.teamId,
			ctx.tiposDeEvento.reuniao_lideranca!
		);
		expect(oferecidas.map((r) => r.id).sort()).toEqual(
			[ctx.respostas.vou!, ctx.respostas.nao_vou!].sort()
		);
		await expect(
			responder(ctx.db, membroVerde, reuniao, { respostaId: ctx.respostas.talvez! })
		).rejects.toBeInstanceOf(EventoRecusado);
		await expect(
			ctx.db.insert(rsvp).values({
				eventId: reuniao,
				personId: membroVerde.personId,
				optionId: ctx.respostas.talvez!,
				respondedByPersonId: membroVerde.personId
			})
		).rejects.toThrow(/não oferece essa resposta/);
	});

	it('resposta arquivada sai das opções; tipo sem escolha volta a oferecer todas', async () => {
		const tipo = ctx.tiposDeEvento.evento_especial!;
		await definirRespostasDoTipo(ctx.db, lider, tipo, [
			ctx.respostas.vou!,
			ctx.respostas.atrasado!
		]);
		expect((await respostasDoTipo(ctx.db, ctx.teamId, tipo)).map((r) => r.id)).toHaveLength(2);

		await arquivarResposta(ctx.db, lider, ctx.respostas.atrasado!, true);
		expect((await respostasDoTipo(ctx.db, ctx.teamId, tipo)).map((r) => r.id)).toEqual([
			ctx.respostas.vou
		]);

		await arquivarResposta(ctx.db, lider, ctx.respostas.atrasado!, false);
		await definirRespostasDoTipo(ctx.db, lider, tipo, []);
		expect(await respostasDoTipo(ctx.db, ctx.teamId, tipo)).toHaveLength(4);
	});

	it('configurar respostas é da liderança', async () => {
		await expect(
			definirRespostasDoTipo(ctx.db, conselheiroAzul, ctx.tiposDeEvento.encontro_pg!, [])
		).rejects.toBeInstanceOf(PolicyDenied);
	});

	it('totais para quem vê o evento; NOMES só para quem cuida do grupo (D-M06-8)', async () => {
		const e = await encontro(azul, somarDias(hoje(), 7));
		await responder(ctx.db, membroAzul, e, { respostaId: ctx.respostas.vou!, convidados: 1 });

		const totais = await totaisDoEvento(ctx.db, e);
		expect(totais.find((t) => t.respostaId === ctx.respostas.vou)).toMatchObject({
			pessoas: 1,
			convidados: 1
		});

		expect(await quemRespondeu(ctx.db, membroAzul, e)).toBeNull();
		const nomes = await quemRespondeu(ctx.db, conselheiroAzul, e);
		expect(nomes?.map((n) => n.nome)).toEqual(['Membro Azul']);
	});

	it('o painel do "você vai?" traz a resposta da própria pessoa', async () => {
		const [ev] = await ctx.db.select().from(event).where(eq(event.id, futuro));
		const paineis = await paineisDeResposta(ctx.db, membroAzul, [
			{
				id: futuro,
				tipo: { id: ev!.typeId },
				publicado: true,
				cancelado: false,
				inicio: ev!.startsAt,
				fim: ev!.endsAt
			}
		]);
		expect(paineis.get(futuro)).toMatchObject({
			podeResponder: true,
			minha: { respostaId: ctx.respostas.nao_vou }
		});
	});
});

// ---------------------------------------------------------------------------
// Lista de presença (D-M06-4, D-M06-6)
// ---------------------------------------------------------------------------

describe('lista de presença', () => {
	let ontem: string;

	beforeAll(async () => {
		ontem = await encontro(azul, diasAtras(1));
	});

	it('os marcados passam a ser a presença; refazer a lista substitui', async () => {
		await registrarLista(ctx.db, conselheiroAzul, ontem, [membroAzul.personId]);
		let presentes = await ctx.db.select().from(attendance).where(eq(attendance.eventId, ontem));
		expect(presentes.map((p) => p.personId)).toEqual([membroAzul.personId]);

		const [e] = await ctx.db.select().from(event).where(eq(event.id, ontem));
		expect(e!.attendanceTakenAt).not.toBeNull();
		expect(e!.attendanceTakenByPersonId).toBe(conselheiroAzul.personId);

		const r = await registrarLista(ctx.db, conselheiroAzul, ontem, [membroVerde.personId]);
		expect(r).toMatchObject({ presentes: 1, entraram: 1, sairam: 1 });
		presentes = await ctx.db.select().from(attendance).where(eq(attendance.eventId, ontem));
		expect(presentes.map((p) => p.personId)).toEqual([membroVerde.personId]);
	});

	it('id malformado ou de fora da equipe é ignorado, não vira erro', async () => {
		const r = await registrarLista(ctx.db, conselheiroAzul, ontem, [
			membroAzul.personId,
			"x' or 1=1 --",
			'00000000-0000-4000-8000-000000000000'
		]);
		expect(r.presentes).toBe(1);
	});

	it('a lista separa esperados de quem veio sem ser esperado', async () => {
		await registrarLista(ctx.db, conselheiroAzul, ontem, [
			membroAzul.personId,
			membroVerde.personId
		]);
		const lista = await listaDePresenca(ctx.db, conselheiroAzul, ontem);
		expect(lista.esperados.map((l) => l.personId)).toContain(membroAzul.personId);
		expect(lista.esperados.map((l) => l.personId)).not.toContain(membroVerde.personId);
		expect(lista.alemDoEsperado.map((l) => l.personId)).toEqual([membroVerde.personId]);
	});

	it('encontro futuro não tem lista ainda', async () => {
		const amanha = await encontro(azul, somarDias(hoje(), 1));
		await expect(registrarLista(ctx.db, conselheiroAzul, amanha, [])).rejects.toMatchObject({
			motivo: 'periodo_invalido'
		});
	});

	it('conselheiro não faz a lista do PG vizinho; membro não faz lista nenhuma', async () => {
		const vizinho = await encontro(verde, diasAtras(1));
		await expect(registrarLista(ctx.db, conselheiroAzul, vizinho, [])).rejects.toBeInstanceOf(
			PolicyDenied
		);
		await expect(listaDePresenca(ctx.db, membroAzul, ontem)).rejects.toBeInstanceOf(PolicyDenied);
	});

	it('evento cancelado não tem lista — e o banco recusa presença nele', async () => {
		const e = await encontro(azul, diasAtras(2));
		await cancelarEvento(ctx.db, lider, e, null);
		await expect(registrarLista(ctx.db, conselheiroAzul, e, [])).rejects.toBeInstanceOf(
			EventoRecusado
		);
		await expect(
			ctx.db.insert(attendance).values({
				eventId: e,
				personId: membroAzul.personId,
				recordedByPersonId: lider.personId
			})
		).rejects.toThrow(/cancelado não tem presença/);
	});

	it('quem chegou pela primeira vez se cadastra na porta, já no grupo do evento (F1)', async () => {
		const e = await encontro(azul, diasAtras(3));
		const id = await cadastrarNaPorta(
			ctx.db,
			conselheiroAzul,
			e,
			criarPessoaSchema.parse({ fullName: 'Visitante da Porta' })
		);
		await registrarLista(ctx.db, conselheiroAzul, e, [id]);

		const [m] = await ctx.db.select().from(groupMembership).where(eq(groupMembership.personId, id));
		expect(m?.groupId).toBe(azul);
		const lista = await listaDePresenca(ctx.db, conselheiroAzul, e);
		expect(lista.alemDoEsperado.map((l) => l.nome)).toContain('Visitante da Porta');
	});
});

// ---------------------------------------------------------------------------
// Frequência (D-M06-4, D-M06-5) e sinais (D-M06-7)
// ---------------------------------------------------------------------------

describe('frequência — o que conta e o que não conta', () => {
	let grupo: string;
	let conselheiro: Actor;
	let joana: Actor;

	beforeAll(async () => {
		grupo = await criarGrupo(ctx, 'PG Frequência');
		conselheiro = await ator('Conselheiro F', { papel: 'conselheiro', escopo: grupo });
		joana = await ator('Joana', { papel: 'membro', grupo });
	});

	it('sem lista feita, ninguém faltou — nem quem respondeu "não vou"', async () => {
		const e = await encontro(grupo, diasAtras(5));
		await ctx.db.insert(rsvp).values({
			eventId: e,
			personId: joana.personId,
			optionId: ctx.respostas.nao_vou!,
			respondedByPersonId: joana.personId
		});
		const f = await frequenciaDaPessoa(ctx.db, joana, joana.personId);
		expect(f?.frequencia).toMatchObject({ esperados: 0, percentual: null });
	});

	it('com lista feita, quem era esperado e não está marcado faltou', async () => {
		const e1 = await encontro(grupo, diasAtras(14));
		const e2 = await encontro(grupo, diasAtras(7));
		await registrarLista(ctx.db, conselheiro, e1, [joana.personId]);
		await registrarLista(ctx.db, conselheiro, e2, []);
		const f = await frequenciaDaPessoa(ctx.db, joana, joana.personId);
		expect(f?.frequencia).toMatchObject({ esperados: 2, presentes: 1, percentual: 50 });
	});

	it('tipo que não conta para frequência não entra na conta (G3)', async () => {
		const reuniao = await encontro(grupo, diasAtras(3), {
			tipoId: ctx.tiposDeEvento.reuniao_lideranca
		});
		await registrarLista(ctx.db, conselheiro, reuniao, []);
		const f = await frequenciaDaPessoa(ctx.db, joana, joana.personId);
		expect(f?.frequencia.esperados).toBe(2);
	});

	it('quem entrou no grupo depois não aparece como faltoso antes (D-M06-5)', async () => {
		const novato = await pessoa('Novato', { grupo, desde: ha(1) });
		const porPessoa = await frequenciaDoGrupo(ctx.db, conselheiro, grupo);
		expect(porPessoa.get(novato.id)).toMatchObject({ esperados: 0, percentual: null, sinais: [] });
		expect(porPessoa.get(joana.personId)?.percentual).toBe(50);
	});

	it('frequência de alguém: a própria pessoa e quem cuida do grupo — não os pares', async () => {
		const colega = await ator('Colega', { papel: 'membro', grupo });
		expect(await frequenciaDaPessoa(ctx.db, colega, joana.personId)).toBeNull();
		expect(await frequenciaDaPessoa(ctx.db, conselheiroAzul, joana.personId)).toBeNull();
		expect(await frequenciaDaPessoa(ctx.db, conselheiro, joana.personId)).not.toBeNull();
		expect(await frequenciaDaPessoa(ctx.db, lider, joana.personId)).not.toBeNull();
	});

	it('a visão do grupo é de quem cuida dele', async () => {
		await expect(frequenciaDoGrupo(ctx.db, joana, grupo)).rejects.toBeInstanceOf(PolicyDenied);
		await expect(frequenciaDoGrupo(ctx.db, conselheiroAzul, grupo)).rejects.toBeInstanceOf(
			PolicyDenied
		);
	});
});

describe('sinais de atenção, não ranking (D-M06-7)', () => {
	let grupo: string;
	let rafael: string;
	let isabela: string;

	beforeAll(async () => {
		grupo = await criarGrupo(ctx, 'PG Sinais');
		rafael = (await pessoa('Rafael', { grupo })).id;
		await pessoa('Constante', { grupo });

		// Cinco encontros semanais com lista. Rafael veio aos dois primeiros e
		// sumiu; Isabela chegou no terceiro, pela porta, e não faltou mais.
		const encontros: string[] = [];
		for (const semanas of [5, 4, 3, 2, 1])
			encontros.push(await encontro(grupo, diasAtras(semanas * 7)));
		await registrarLista(ctx.db, lider, encontros[0]!, [rafael]);
		await registrarLista(ctx.db, lider, encontros[1]!, [rafael]);
		isabela = await cadastrarNaPorta(
			ctx.db,
			lider,
			encontros[2]!,
			criarPessoaSchema.parse({ fullName: 'Isabela' })
		);
		for (const e of encontros.slice(2)) await registrarLista(ctx.db, lider, e, [isabela]);
	});

	it('"não vem há 3 encontros" para quem costumava vir', async () => {
		const porPessoa = await frequenciaDoGrupo(ctx.db, lider, grupo);
		expect(porPessoa.get(rafael)).toMatchObject({ sinais: ['sumiu'], faltasSeguidas: 3 });
	});

	it('"já veio 3 vezes em 60 dias" para quem ainda está no estágio de chegada', async () => {
		const porPessoa = await frequenciaDoGrupo(ctx.db, lider, grupo);
		expect(porPessoa.get(isabela)).toMatchObject({
			sinais: ['visitante_frequente'],
			presencasRecentes: 3
		});
	});
});

// ---------------------------------------------------------------------------
// Relatório (RF-06.3) e confirmação × presença (RF-06.4)
// ---------------------------------------------------------------------------

describe('relatório de frequência', () => {
	let grupo: string;
	let conselheiro: Actor;
	let evento: string;
	const periodo = () => ({ de: ha(30), ate: new Date(Date.now() + DIA) });

	beforeAll(async () => {
		grupo = await criarGrupo(ctx, 'PG Relatório');
		conselheiro = await ator('Conselheiro R', { papel: 'conselheiro', escopo: grupo });
		const zelia = await pessoa('Zélia', { grupo });
		const ana = await pessoa('Ana', { grupo });
		const bruno = await pessoa('Bruno', { grupo });
		evento = await encontro(grupo, diasAtras(2));

		// Ana confirmou e veio; Bruno confirmou e não veio; Zélia veio sem confirmar.
		for (const p of [ana.id, bruno.id]) {
			await ctx.db.insert(rsvp).values({
				eventId: evento,
				personId: p,
				optionId: ctx.respostas.vou!,
				respondedByPersonId: p
			});
		}
		await registrarLista(ctx.db, conselheiro, evento, [ana.id, zelia.id]);
	});

	it('em ordem alfabética — e não por frequência', async () => {
		const r = await relatorio(ctx.db, conselheiro, { ...periodo(), grupoId: grupo });
		expect(r.pessoas.map((p) => p.nome)).toEqual(['Ana', 'Bruno', 'Zélia']);
		expect(r.pessoas.map((p) => p.percentual)).toEqual([100, 0, 100]);
	});

	it('confirmação × presença do encontro', async () => {
		const r = await relatorio(ctx.db, conselheiro, { ...periodo(), grupoId: grupo });
		expect(r.eventos.find((e) => e.id === evento)).toMatchObject({
			esperados: 3,
			confirmaram: 2,
			vieram: 2,
			confirmaramEVieram: 1,
			confirmaramENaoVieram: 1,
			vieramSemConfirmar: 1
		});
		expect(await confirmacaoXPresenca(ctx.db, conselheiro, evento)).toMatchObject({
			confirmaram: 2,
			vieram: 2
		});
		expect(await confirmacaoXPresenca(ctx.db, membroAzul, evento)).toBeNull();
	});

	it('o escopo de quem pede: o conselheiro, só o grupo dele; sem grupo, só a liderança', async () => {
		await expect(relatorio(ctx.db, conselheiro, periodo())).rejects.toBeInstanceOf(PolicyDenied);
		await expect(
			relatorio(ctx.db, conselheiro, { ...periodo(), grupoId: azul })
		).rejects.toBeInstanceOf(PolicyDenied);
		await expect(
			relatorio(ctx.db, membroAzul, { ...periodo(), grupoId: azul })
		).rejects.toBeInstanceOf(PolicyDenied);

		const todos = await relatorio(ctx.db, lider, periodo());
		expect(todos.pessoas.map((p) => p.nome)).toEqual(
			expect.arrayContaining(['Ana', 'Bruno', 'Zélia', 'Membro Azul'])
		);
	});

	it('filtro por tipo', async () => {
		const r = await relatorio(ctx.db, lider, {
			...periodo(),
			grupoId: grupo,
			tipoId: ctx.tiposDeEvento.evento_especial
		});
		expect(r.eventos).toEqual([]);
		expect(r.pessoas).toEqual([]);
	});
});

// ---------------------------------------------------------------------------
// D-M06-9 — encerrar série com respostas cancela, não apaga
// ---------------------------------------------------------------------------

describe('encerrar o encontro semanal que já tem respostas', () => {
	it('a data com resposta fica, cancelada; as outras saem; a resposta continua', async () => {
		const grupo = await criarGrupo(ctx, 'PG Encerra');
		const membro = await ator('Membro E', { papel: 'membro', grupo });
		const dados = eventoSchema.parse({
			tipoId: ctx.tiposDeEvento.encontro_pg,
			titulo: 'PG Encerra',
			grupoId: grupo,
			recorrencia: 'semanal',
			data: somarDias(hoje(), 2),
			horaInicio: '20:00',
			publicar: true
		});
		const { id: serieId } = await criarEvento(ctx.db, lider, dados, [
			{ tipo: 'grupo', groupId: grupo }
		]);
		await garantirOcorrencias(ctx.db, ctx.teamId);

		const ocorrencias = await ctx.db
			.select()
			.from(event)
			.where(eq(event.seriesId, serieId))
			.orderBy(event.startsAt);
		expect(ocorrencias.length).toBeGreaterThan(1);
		const primeira = ocorrencias[0]!;
		await responder(ctx.db, membro, primeira.id, { respostaId: ctx.respostas.vou! });

		const r = await encerrarSerie(ctx.db, lider, serieId, hoje());
		expect(r).toEqual({ canceladas: 1, removidas: ocorrencias.length - 1 });

		const restantes = await ctx.db.select().from(event).where(eq(event.seriesId, serieId));
		expect(restantes).toHaveLength(1);
		expect(restantes[0]).toMatchObject({
			id: primeira.id,
			status: 'cancelado',
			cancelReason: 'Encontro semanal encerrado'
		});
		expect(await ctx.db.select().from(rsvp).where(eq(rsvp.eventId, primeira.id))).toHaveLength(1);
	});
});

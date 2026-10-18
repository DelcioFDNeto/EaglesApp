import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { and, count, eq, gte, isNotNull, sql } from 'drizzle-orm';
import { criarBancoDeTeste, criarGrupo, type BancoDeTeste } from './helpers/banco';
import {
	event,
	eventAudience,
	eventSeries,
	eventType,
	groupMembership,
	person,
	personRole,
	role,
	rolePermission,
	team
} from '../../src/lib/server/db/schema';
import { PolicyDenied, type Actor } from '../../src/lib/server/policy/policy';
import { loadActor } from '../../src/lib/server/policy/actor';
import {
	agendaDoMes,
	cancelarEvento,
	criarEvento,
	editarEvento,
	editarSerie,
	encerrarSerie,
	eventoPorCodigo,
	garantirOcorrencias,
	HORIZONTE_SEMANAS,
	proximosEventos,
	publicarEvento,
	publicarSerie,
	verEvento
} from '../../src/lib/server/modules/eventos/eventos';
import { EventoRecusado, type Alvo } from '../../src/lib/server/modules/eventos/regras';
import {
	eventoSchema,
	ocorrenciaSchema,
	serieSchema,
	tipoSchema
} from '../../src/lib/server/modules/eventos/validacao';
import { arquivarTipo, criarTipo, listarTipos } from '../../src/lib/server/modules/eventos/tipos';
import { textoDoEvento } from '../../src/lib/server/modules/eventos/compartilhar';
import { arquivarGrupo } from '../../src/lib/server/modules/grupos/grupos';
import { datasEntre } from '../../src/lib/server/modules/eventos/recorrencia';
import {
	dataNoFuso,
	diaDaSemana,
	hojeNoFuso,
	horaNoFuso,
	instanteLocal,
	somarDias
} from '../../src/lib/shared/fuso';

/**
 * Módulo 05 — eventos.
 *
 * Como no M04, os cenários usam dois grupos e atores de cada lado: a
 * visibilidade só se prova quando existe alguém que NÃO deveria ver.
 */

const FUSO = 'America/Sao_Paulo';

let ctx: BancoDeTeste;
let azul: string;
let verde: string;
let lider: Actor;
let conselheiroAzul: Actor;
let membroAzul: Actor;
let membroVerde: Actor;
let visitante: Actor;
let contador = 0;

const hoje = () => hojeNoFuso(FUSO);
/** Próxima data com o dia da semana pedido, a partir de `depois` dias. */
function proxima(dia: number, depois = 1): string {
	let d = somarDias(hoje(), depois);
	while (diaDaSemana(d) !== dia) d = somarDias(d, 1);
	return d;
}

async function atorCom(papel: string, opcoes: { escopo?: string; grupo?: string } = {}) {
	contador++;
	const [p] = await ctx.db
		.insert(person)
		.values({ teamId: ctx.teamId, fullName: `Ator ${papel} ${contador}` })
		.returning({ id: person.id });
	await ctx.db.insert(personRole).values({
		personId: p!.id,
		roleId: ctx.papeis[papel]!,
		scopeType: opcoes.escopo ? 'group' : papel === 'lider' ? 'global' : 'self',
		scopeId: opcoes.escopo ?? null
	});
	if (opcoes.grupo) {
		await ctx.db.insert(groupMembership).values({ groupId: opcoes.grupo, personId: p!.id });
	}
	return (await loadActor(ctx.db, p!.id))!;
}

function dados(campos: Record<string, unknown>) {
	return eventoSchema.parse({
		tipoId: ctx.tiposDeEvento.encontro_geral,
		titulo: `Evento ${++contador}`,
		data: proxima(6, 3),
		horaInicio: '19:00',
		publicar: true,
		...campos
	});
}

async function novo(actor: Actor, campos: Record<string, unknown>, publico: Alvo[]) {
	return (await criarEvento(ctx.db, actor, dados(campos), publico)).id;
}

beforeAll(async () => {
	ctx = await criarBancoDeTeste();
	azul = await criarGrupo(ctx, 'PG Azul');
	verde = await criarGrupo(ctx, 'PG Verde');
	lider = await atorCom('lider');
	conselheiroAzul = await atorCom('conselheiro', { escopo: azul });
	membroAzul = await atorCom('membro', { grupo: azul });
	membroVerde = await atorCom('membro', { grupo: verde });
	visitante = await atorCom('visitante');
});

afterAll(async () => {
	await ctx.fechar();
});

// ---------------------------------------------------------------------------
// Banco
// ---------------------------------------------------------------------------

describe('regras do banco', () => {
	let eventoId: string;
	let codigo: string;

	beforeAll(async () => {
		eventoId = await novo(lider, {}, [{ tipo: 'equipe' }]);
		const [e] = await ctx.db.select().from(event).where(eq(event.id, eventoId));
		codigo = e!.publicCode;
	});

	it('o código público tem 10 caracteres e não muda', async () => {
		expect(codigo).toMatch(/^[A-Za-z0-9]{10}$/);
		await expect(
			ctx.db.execute(sql`update event set public_code = 'outrocodig' where id = ${eventoId}`)
		).rejects.toThrow(/não mudam/);
	});

	it('termina depois de começar; situação só agendado ou cancelado', async () => {
		await expect(
			ctx.db.execute(
				sql`update event set ends_at = starts_at - interval '1 hour' where id = ${eventoId}`
			)
		).rejects.toThrow(/fim_depois_do_inicio|check/i);
		await expect(
			ctx.db.execute(sql`update event set status = 'adiado' where id = ${eventoId}`)
		).rejects.toThrow(/status_valido|check/i);
	});

	it('evento avulso não se apaga: cancela-se', async () => {
		await expect(ctx.db.execute(sql`delete from event where id = ${eventoId}`)).rejects.toThrow(
			/cancele/
		);
	});

	it('público: exatamente um dono e um alvo coerente, sem repetição', async () => {
		await expect(ctx.db.insert(eventAudience).values({ kind: 'equipe' })).rejects.toThrow(
			/um_dono|check/i
		);
		await expect(
			ctx.db.insert(eventAudience).values({ eventId: eventoId, kind: 'grupo' })
		).rejects.toThrow(/alvo_coerente|check/i);
		await expect(
			ctx.db.insert(eventAudience).values({ eventId: eventoId, kind: 'equipe' })
		).rejects.toThrow(/evento_unico|unique|duplicate/i);
	});

	it('tipo de outra equipe é recusado', async () => {
		const [outra] = await ctx.db
			.insert(team)
			.values({ slug: 'bears', name: 'Bears' })
			.returning({ id: team.id });
		const [tipo] = await ctx.db
			.insert(eventType)
			.values({ teamId: outra!.id, key: 'x', name: 'Tipo dos Bears' })
			.returning({ id: eventType.id });
		await expect(
			ctx.db.execute(sql`update event set type_id = ${tipo!.id} where id = ${eventoId}`)
		).rejects.toThrow(/outra equipe/);
	});

	it('o dia de uma série não muda: encerra-se e cria-se outra', async () => {
		const { id } = await criarEvento(
			ctx.db,
			lider,
			dados({ recorrencia: 'semanal', data: proxima(4) }),
			[{ tipo: 'equipe' }]
		);
		await expect(
			ctx.db.execute(sql`update event_series set weekday = 2 where id = ${id}`)
		).rejects.toThrow(/encerre-a e crie outra/);
	});
});

// ---------------------------------------------------------------------------
// Materialização (D-M05-2) e fuso (D-M05-3)
// ---------------------------------------------------------------------------

describe('encontro semanal e materialização', () => {
	let serieId: string;
	const inicio = () => proxima(4);

	beforeAll(async () => {
		serieId = (
			await criarEvento(
				ctx.db,
				conselheiroAzul,
				dados({
					tipoId: ctx.tiposDeEvento.encontro_pg,
					titulo: 'PG Azul semanal',
					grupoId: azul,
					recorrencia: 'semanal',
					data: inicio(),
					horaInicio: '20:00',
					horaFim: '22:30'
				}),
				[{ tipo: 'grupo', groupId: azul }]
			)
		).id;
	});

	async function ocorrencias() {
		return ctx.db
			.select()
			.from(event)
			.where(eq(event.seriesId, serieId))
			.orderBy(event.occurrenceDate);
	}

	it(`materializa ${HORIZONTE_SEMANAS} semanas, às 20h no fuso da equipe`, async () => {
		const linhas = await ocorrencias();
		const esperadas = datasEntre(
			{ diaDaSemana: 4, intervaloSemanas: 1, inicio: inicio(), fim: null },
			inicio(),
			somarDias(hoje(), HORIZONTE_SEMANAS * 7)
		);

		expect(linhas.map((l) => l.occurrenceDate)).toEqual(esperadas);
		for (const l of linhas) {
			expect(dataNoFuso(l.startsAt, FUSO)).toBe(l.occurrenceDate);
			expect(horaNoFuso(l.startsAt, FUSO)).toBe('20:00');
			expect(horaNoFuso(l.endsAt!, FUSO)).toBe('22:30');
		}
	});

	it('cada ocorrência recebe o público da série', async () => {
		const linhas = await ocorrencias();
		const [publico] = await ctx.db
			.select({ n: count() })
			.from(eventAudience)
			.where(sql`${eventAudience.eventId} in (select id from event where series_id = ${serieId})`);
		expect(Number(publico!.n)).toBe(linhas.length);
	});

	it('materializar de novo, ou de trás para frente, não duplica nada', async () => {
		const antes = (await ocorrencias()).length;
		expect(await garantirOcorrencias(ctx.db, ctx.teamId)).toBe(0);

		// Simula uma materialização interrompida: o marcador volta, as linhas ficam.
		await ctx.db
			.update(eventSeries)
			.set({ materializedUntil: somarDias(inicio(), -1) })
			.where(eq(eventSeries.id, serieId));
		await Promise.all([
			garantirOcorrencias(ctx.db, ctx.teamId),
			garantirOcorrencias(ctx.db, ctx.teamId)
		]);

		expect((await ocorrencias()).length).toBe(antes);
		const [publico] = await ctx.db
			.select({ n: count() })
			.from(eventAudience)
			.where(sql`${eventAudience.eventId} in (select id from event where series_id = ${serieId})`);
		expect(Number(publico!.n), 'o público também não duplica').toBe(antes);
	});

	it('a janela anda com o tempo: uma semana depois, uma ocorrência a mais', async () => {
		const antes = (await ocorrencias()).length;
		const daquiAUmaSemana = new Date(Date.now() + 7 * 86_400_000);
		expect(await garantirOcorrencias(ctx.db, ctx.teamId, { serieId, agora: daquiAUmaSemana })).toBe(
			1
		);
		expect((await ocorrencias()).length).toBe(antes + 1);
	});

	it('série que "já existe há anos" não materializa o passado', async () => {
		const { id } = await criarEvento(
			ctx.db,
			lider,
			dados({ recorrencia: 'semanal', data: '2024-01-04' }),
			[{ tipo: 'equipe' }]
		);
		const [primeira] = await ctx.db
			.select({ data: event.occurrenceDate })
			.from(event)
			.where(eq(event.seriesId, id))
			.orderBy(event.occurrenceDate)
			.limit(1);
		expect(primeira!.data! >= hoje()).toBe(true);
	});

	it('ocorrência editada ou cancelada sobrevive à edição da série (D-M05-4)', async () => {
		const [primeira, segunda, terceira] = await ocorrencias();

		await editarEvento(
			ctx.db,
			conselheiroAzul,
			primeira!.id,
			ocorrenciaSchema.parse({
				titulo: 'PG Azul — especial de aniversário',
				data: primeira!.occurrenceDate,
				horaInicio: '19:00'
			}),
			[{ tipo: 'grupo', groupId: azul }]
		);
		await cancelarEvento(ctx.db, conselheiroAzul, segunda!.id, 'Feriado');

		const alcancadas = await editarSerie(
			ctx.db,
			conselheiroAzul,
			serieId,
			serieSchema.parse({ titulo: 'PG Azul', horaInicio: '20:30', local: 'Casa da Marina' }),
			[{ tipo: 'grupo', groupId: azul }]
		);

		const depois = await ocorrencias();
		const porId = new Map(depois.map((o) => [o.id, o]));
		expect(porId.get(primeira!.id)!.title).toBe('PG Azul — especial de aniversário');
		expect(horaNoFuso(porId.get(primeira!.id)!.startsAt, FUSO)).toBe('19:00');
		expect(porId.get(segunda!.id)!.status).toBe('cancelado');
		expect(porId.get(terceira!.id)!.title).toBe('PG Azul');
		expect(horaNoFuso(porId.get(terceira!.id)!.startsAt, FUSO)).toBe('20:30');
		expect(alcancadas).toBe(depois.length - 2);
	});

	it('encerrar remove as datas futuras não ajustadas — e a série não volta', async () => {
		const antes = await ocorrencias();
		const corte = antes[3]!.occurrenceDate!;

		const { removidas } = await encerrarSerie(ctx.db, conselheiroAzul, serieId, corte);
		await garantirOcorrencias(ctx.db, ctx.teamId, {
			agora: new Date(Date.now() + 60 * 86_400_000)
		});

		const depois = await ocorrencias();
		expect(depois.every((o) => o.occurrenceDate! < corte || o.isException)).toBe(true);
		expect(removidas).toBe(
			antes.filter((o) => o.occurrenceDate! >= corte && !o.isException).length
		);
	});

	it('não se encerra no passado', async () => {
		await expect(
			encerrarSerie(ctx.db, conselheiroAzul, serieId, somarDias(hoje(), -1))
		).rejects.toMatchObject({ motivo: 'ja_aconteceu' });
	});

	it('ocorrência que já aconteceu não se apaga, nem pelo banco', async () => {
		const [qualquer] = await ocorrencias();
		await ctx.db.execute(
			sql`update event set starts_at = now() - interval '1 day', ends_at = null where id = ${qualquer!.id}`
		);
		await expect(ctx.db.execute(sql`delete from event where id = ${qualquer!.id}`)).rejects.toThrow(
			/cancele/
		);
	});
});

// ---------------------------------------------------------------------------
// Visibilidade (D-M05-7) — e a regra pura conferida contra o SQL
// ---------------------------------------------------------------------------

describe('quem vê o quê', () => {
	const ids: Record<string, string> = {};
	let atores: Record<string, Actor>;

	beforeAll(async () => {
		atores = { lider, conselheiroAzul, membroAzul, membroVerde, visitante };
		const data = proxima(5, 10);
		const mais = (titulo: string) => ({ titulo, data });

		ids.pgAzul = await novo(lider, { ...mais('Vis PG Azul'), grupoId: azul }, [
			{ tipo: 'grupo', groupId: azul }
		]);
		ids.pgVerde = await novo(lider, { ...mais('Vis PG Verde'), grupoId: verde }, [
			{ tipo: 'grupo', groupId: verde }
		]);
		ids.geral = await novo(lider, mais('Vis Encontro geral'), [{ tipo: 'equipe' }]);
		ids.rascunhoAzul = await novo(
			lider,
			{ ...mais('Vis Rascunho Azul'), grupoId: azul, publicar: false },
			[{ tipo: 'grupo', groupId: azul }]
		);
		ids.soJoao = await novo(lider, mais('Vis Conversa'), [
			{ tipo: 'pessoa', personId: membroAzul.personId }
		]);
		ids.rascunhoGeral = await novo(lider, { ...mais('Vis Rascunho geral'), publicar: false }, [
			{ tipo: 'equipe' }
		]);
	});

	const esperado: Record<string, string[]> = {
		lider: ['pgAzul', 'pgVerde', 'geral', 'rascunhoAzul', 'soJoao', 'rascunhoGeral'],
		conselheiroAzul: ['pgAzul', 'geral', 'rascunhoAzul'],
		membroAzul: ['pgAzul', 'geral', 'soJoao'],
		membroVerde: ['pgVerde', 'geral'],
		visitante: ['geral']
	};

	for (const [quem, lista] of Object.entries(esperado)) {
		it(`${quem} vê exatamente: ${lista.join(', ')}`, async () => {
			const actor = atores[quem]!;
			const visiveis = [];
			for (const [nome, id] of Object.entries(ids)) {
				if (await verEvento(ctx.db, actor, id)) visiveis.push(nome);
			}
			expect(visiveis.sort()).toEqual([...lista].sort());
		});
	}

	it('a agenda (SQL) e a regra pura dão a MESMA resposta para todo ator e evento', async () => {
		const mes = dataNoFuso(new Date(), FUSO).slice(0, 7);
		const meses = [mes, somarDias(`${mes}-01`, 40).slice(0, 7)];

		for (const [quem, actor] of Object.entries(atores)) {
			const naAgenda = new Set<string>();
			for (const m of meses) {
				for (const dia of await agendaDoMes(ctx.db, actor, m, { tipo: 'tudo' })) {
					for (const e of dia.eventos) naAgenda.add(e.id);
				}
			}
			for (const [nome, id] of Object.entries(ids)) {
				const pelaRegra = (await verEvento(ctx.db, actor, id)) !== null;
				expect(naAgenda.has(id), `${quem} × ${nome}`).toBe(pelaRegra);
			}
		}
	});

	it('"minha agenda" do líder não vem com o PG de cada grupo', async () => {
		const meus = await proximosEventos(ctx.db, lider, { limite: 100 });
		const titulos = meus.map((e) => e.titulo);
		expect(titulos).toContain('Vis Encontro geral');
		expect(titulos).not.toContain('Vis PG Verde');
	});

	it('a agenda do grupo mostra o que é do grupo ou o convida', async () => {
		const doAzul = (await proximosEventos(ctx.db, lider, { limite: 100, grupoId: azul })).map(
			(e) => e.titulo
		);
		expect(doAzul).toContain('Vis PG Azul');
		expect(doAzul).not.toContain('Vis PG Verde');
		expect(doAzul).not.toContain('Vis Encontro geral');
	});
});

// ---------------------------------------------------------------------------
// Escopo (D-M05-5) e rascunho (D-M05-6)
// ---------------------------------------------------------------------------

describe('escopo de quem cria', () => {
	it('conselheiro cria no próprio grupo, convidando o grupo e pessoas avulsas', async () => {
		const id = await novo(conselheiroAzul, { grupoId: azul }, [
			{ tipo: 'grupo', groupId: azul },
			{ tipo: 'pessoa', personId: membroVerde.personId }
		]);
		expect(await verEvento(ctx.db, membroVerde, id), 'a pessoa avulsa convidada vê').not.toBeNull();
	});

	it('conselheiro NÃO convida a equipe inteira nem outro grupo', async () => {
		for (const publico of [[{ tipo: 'equipe' }], [{ tipo: 'grupo', groupId: verde }]] as Alvo[][]) {
			const erro = await criarEvento(
				ctx.db,
				conselheiroAzul,
				dados({ grupoId: azul }),
				publico
			).catch((e: unknown) => e);
			expect(erro).toBeInstanceOf(EventoRecusado);
			expect((erro as EventoRecusado).motivo).toBe('publico_fora_do_escopo');
		}
	});

	it('conselheiro não cria evento geral nem evento do grupo vizinho', async () => {
		await expect(
			criarEvento(ctx.db, conselheiroAzul, dados({}), [{ tipo: 'grupo', groupId: azul }])
		).rejects.toBeInstanceOf(PolicyDenied);
		await expect(
			criarEvento(ctx.db, conselheiroAzul, dados({ grupoId: verde }), [
				{ tipo: 'grupo', groupId: verde }
			])
		).rejects.toBeInstanceOf(PolicyDenied);
	});

	it('membro não cria evento', async () => {
		await expect(
			criarEvento(ctx.db, membroAzul, dados({}), [{ tipo: 'equipe' }])
		).rejects.toBeInstanceOf(PolicyDenied);
	});

	it('conselheiro não edita nem cancela o evento do grupo vizinho', async () => {
		const id = await novo(lider, { grupoId: verde }, [{ tipo: 'grupo', groupId: verde }]);
		await expect(cancelarEvento(ctx.db, conselheiroAzul, id, null)).rejects.toBeInstanceOf(
			PolicyDenied
		);
	});

	it('quem gerencia sem poder publicar cria rascunho, e não consegue publicar', async () => {
		// Papel personalizado: organiza eventos do grupo, mas não publica.
		const [organizador] = await ctx.db
			.insert(role)
			.values({
				teamId: ctx.teamId,
				key: 'organizador',
				name: 'Organizador',
				defaultScope: 'group'
			})
			.returning({ id: role.id });
		await ctx.db.insert(rolePermission).values([
			{ roleId: organizador!.id, permissionKey: 'event.view' },
			{ roleId: organizador!.id, permissionKey: 'event.manage' }
		]);
		const [p] = await ctx.db
			.insert(person)
			.values({ teamId: ctx.teamId, fullName: 'Organizadora' })
			.returning({ id: person.id });
		await ctx.db
			.insert(personRole)
			.values({ personId: p!.id, roleId: organizador!.id, scopeType: 'group', scopeId: azul });
		const organizadora = (await loadActor(ctx.db, p!.id))!;

		await expect(
			criarEvento(ctx.db, organizadora, dados({ grupoId: azul }), [
				{ tipo: 'grupo', groupId: azul }
			])
		).rejects.toBeInstanceOf(PolicyDenied);

		const id = await novo(organizadora, { grupoId: azul, publicar: false }, [
			{ tipo: 'grupo', groupId: azul }
		]);
		expect(await verEvento(ctx.db, membroAzul, id), 'rascunho não aparece para o grupo').toBeNull();
		await expect(publicarEvento(ctx.db, organizadora, id)).rejects.toBeInstanceOf(PolicyDenied);

		await publicarEvento(ctx.db, conselheiroAzul, id);
		expect(await verEvento(ctx.db, membroAzul, id)).not.toBeNull();
	});

	it('publicar a série publica as datas futuras e as que ainda serão criadas', async () => {
		const { id } = await criarEvento(
			ctx.db,
			conselheiroAzul,
			dados({ grupoId: azul, recorrencia: 'semanal', data: proxima(3), publicar: false }),
			[{ tipo: 'grupo', groupId: azul }]
		);
		await publicarSerie(ctx.db, conselheiroAzul, id);
		await garantirOcorrencias(ctx.db, ctx.teamId, {
			agora: new Date(Date.now() + 14 * 86_400_000)
		});

		const rascunhos = await ctx.db
			.select({ n: count() })
			.from(event)
			.where(and(eq(event.seriesId, id), sql`${event.publishedAt} is null`));
		expect(Number(rascunhos[0]!.n)).toBe(0);
	});
});

// ---------------------------------------------------------------------------
// Link público (D-M05-8) e compartilhamento
// ---------------------------------------------------------------------------

describe('evento de vários dias (varredura de 11/10/2026)', () => {
	it('editar só o título não encurta o retiro de sexta a domingo', async () => {
		const sexta = proxima(5, 10);
		const domingo = somarDias(sexta, 2);
		const id = await novo(
			lider,
			{ titulo: 'Retiro', data: sexta, dataFim: domingo, horaInicio: '09:00', horaFim: '17:00' },
			[{ tipo: 'equipe' }]
		);

		// O que o formulário de edição manda: os valores que ele mesmo preencheu.
		await editarEvento(
			ctx.db,
			lider,
			id,
			ocorrenciaSchema.parse({
				titulo: 'Retiro de primavera',
				data: sexta,
				dataFim: domingo,
				horaInicio: '09:00',
				horaFim: '17:00'
			}),
			[{ tipo: 'equipe' }]
		);
		const [e] = await ctx.db.select().from(event).where(eq(event.id, id));
		expect(dataNoFuso(e!.endsAt!, FUSO)).toBe(domingo);
		expect(horaNoFuso(e!.endsAt!, FUSO)).toBe('17:00');
		expect((await verEvento(ctx.db, lider, id))?.dataFim).toBe(domingo);
	});

	it('a virada de sábado para domingo também se edita', async () => {
		const sabado = proxima(6, 10);
		const id = await novo(lider, { data: sabado, horaInicio: '22:00' }, [{ tipo: 'equipe' }]);
		await editarEvento(
			ctx.db,
			lider,
			id,
			ocorrenciaSchema.parse({
				titulo: 'Vigília',
				data: sabado,
				dataFim: somarDias(sabado, 1),
				horaInicio: '22:00',
				horaFim: '02:00'
			}),
			[{ tipo: 'equipe' }]
		);
		const [e] = await ctx.db.select().from(event).where(eq(event.id, id));
		expect(dataNoFuso(e!.endsAt!, FUSO)).toBe(somarDias(sabado, 1));
	});

	it('continua em "próximos" enquanto acontece — não some no segundo dia (revisão)', async () => {
		const sexta = proxima(5, 10);
		const id = await novo(
			lider,
			{
				titulo: 'Retiro em andamento',
				data: sexta,
				dataFim: somarDias(sexta, 2),
				horaInicio: '09:00',
				horaFim: '17:00'
			},
			[{ tipo: 'equipe' }]
		);
		const ids = async (agora: Date) =>
			(await proximosEventos(ctx.db, lider, { limite: 100, agora })).map((e) => e.id);

		expect(await ids(instanteLocal(somarDias(sexta, 1), '12:00', FUSO))).toContain(id);
		expect(await ids(instanteLocal(somarDias(sexta, 2), '16:00', FUSO))).toContain(id);
		// Terminou no domingo às 17h: na segunda, já não é "próximo".
		expect(await ids(instanteLocal(somarDias(sexta, 3), '12:00', FUSO))).not.toContain(id);
	});

	it('"das 22h à 0h" é aceito sem data de fim — e editar não o desloca (revisão)', async () => {
		const sexta = proxima(5, 10);
		const id = await novo(lider, { data: sexta, horaInicio: '22:00', horaFim: '00:00' }, [
			{ tipo: 'equipe' }
		]);
		const fimEsperado = instanteLocal(somarDias(sexta, 1), '00:00', FUSO);
		const [criado] = await ctx.db.select().from(event).where(eq(event.id, id));
		expect(criado!.endsAt).toEqual(fimEsperado);

		const v = await verEvento(ctx.db, lider, id);
		await editarEvento(
			ctx.db,
			lider,
			id,
			ocorrenciaSchema.parse({
				titulo: 'Noite de louvor',
				data: sexta,
				horaInicio: '22:00',
				horaFim: v!.horaFim
			}),
			[{ tipo: 'equipe' }]
		);
		const [editado] = await ctx.db.select().from(event).where(eq(event.id, id));
		expect(editado!.endsAt).toEqual(fimEsperado);
	});

	it('encontro semanal até a meia-noite também (revisão)', async () => {
		const { id } = await criarEvento(
			ctx.db,
			lider,
			dados({ recorrencia: 'semanal', data: proxima(3), horaInicio: '20:00', horaFim: '00:00' }),
			[{ tipo: 'equipe' }]
		);
		const [serie] = await ctx.db.select().from(eventSeries).where(eq(eventSeries.id, id));
		expect(serie!.durationMinutes).toBe(240);
	});
});

describe('link público', () => {
	it('mostra o evento publicado, sem nada sobre pessoas', async () => {
		const id = await novo(
			lider,
			{ titulo: 'Churrasco', local: 'Sítio', responsavelId: membroAzul.personId },
			[{ tipo: 'pessoa', personId: membroAzul.personId }]
		);
		const [e] = await ctx.db.select().from(event).where(eq(event.id, id));
		const publico = await eventoPorCodigo(ctx.db, e!.publicCode);

		expect(publico).toMatchObject({ titulo: 'Churrasco', local: 'Sítio', cancelado: false });
		const texto = JSON.stringify(publico);
		const [dono] = await ctx.db
			.select({ nome: person.fullName })
			.from(person)
			.where(eq(person.id, membroAzul.personId));
		expect(texto, 'nem o responsável, nem quem foi convidado').not.toContain(dono!.nome);
	});

	it('rascunho não existe para o link; código malformado também não', async () => {
		const id = await novo(lider, { publicar: false }, [{ tipo: 'equipe' }]);
		const [e] = await ctx.db.select().from(event).where(eq(event.id, id));
		expect(await eventoPorCodigo(ctx.db, e!.publicCode)).toBeNull();
		expect(await eventoPorCodigo(ctx.db, "x' or 1=1 --")).toBeNull();
	});

	it('evento cancelado continua respondendo, marcado como cancelado', async () => {
		const id = await novo(lider, {}, [{ tipo: 'equipe' }]);
		await cancelarEvento(ctx.db, lider, id, 'Chuva');
		const [e] = await ctx.db.select().from(event).where(eq(event.id, id));
		expect((await eventoPorCodigo(ctx.db, e!.publicCode))?.cancelado).toBe(true);
	});

	it('texto do WhatsApp: data, hora, local e link — e nenhum nome de pessoa', () => {
		const texto = textoDoEvento(
			{
				titulo: 'PG Azul',
				data: '2026-10-15',
				hora: '20:00',
				local: 'Casa do Pedro',
				cancelado: false
			},
			'https://eagles.app/e/abcdefghij'
		);
		expect(texto).toBe(
			'*PG Azul*\nQuinta, 15/10 às 20h\n📍 Casa do Pedro\n\nMais informações: https://eagles.app/e/abcdefghij'
		);
	});

	it('texto do WhatsApp com o fim: a mesma redação da página do evento (revisão)', () => {
		const link = 'https://eagles.app/e/abcdefghij';
		const base = { titulo: 'Retiro', local: null, cancelado: false };
		expect(
			textoDoEvento(
				{ ...base, data: '2026-10-16', hora: '19:00', dataFim: '2026-10-18', horaFim: '17:00' },
				link
			)
		).toContain('Sexta, 16/10 às 19h — até domingo, 18 de outubro, 17h');
		expect(
			textoDoEvento(
				{ ...base, data: '2026-10-15', hora: '20:00', dataFim: '2026-10-15', horaFim: '22:00' },
				link
			)
		).toContain('Quinta, 15/10 das 20h às 22h');
	});

	it('os códigos são todos diferentes', async () => {
		const codigos = await ctx.db.select({ c: event.publicCode }).from(event);
		expect(new Set(codigos.map((c) => c.c)).size).toBe(codigos.length);
	});
});

// ---------------------------------------------------------------------------
// Tipos (D-M05-10) e grupo
// ---------------------------------------------------------------------------

describe('tipos de evento', () => {
	it('só quem administra configura', async () => {
		await expect(
			criarTipo(ctx.db, conselheiroAzul, tipoSchema.parse({ nome: 'Culto' }))
		).rejects.toBeInstanceOf(PolicyDenied);
	});

	it('marcar um tipo como encontro do grupo desmarca o anterior', async () => {
		await criarTipo(ctx.db, lider, tipoSchema.parse({ nome: 'Célula', ehEncontroDoGrupo: true }));
		const tipos = await listarTipos(ctx.db, ctx.teamId);
		expect(tipos.filter((t) => t.ehEncontroDoGrupo).map((t) => t.nome)).toEqual(['Célula']);
	});

	it('tipo com série em andamento não se arquiva; arquivado não serve a evento novo', async () => {
		await expect(
			arquivarTipo(ctx.db, lider, ctx.tiposDeEvento.encontro_pg!, true)
		).rejects.toMatchObject({ motivo: 'tipo_arquivado' });

		const id = await criarTipo(ctx.db, lider, tipoSchema.parse({ nome: 'Vigília' }));
		await arquivarTipo(ctx.db, lider, id, true);
		await expect(
			criarEvento(ctx.db, lider, dados({ tipoId: id }), [{ tipo: 'equipe' }])
		).rejects.toMatchObject({ motivo: 'tipo_arquivado' });
	});
});

describe('grupo com encontros marcados', () => {
	it('não se arquiva enquanto houver encontro semanal ou evento futuro', async () => {
		const g = await criarGrupo(ctx, 'PG Lilás');
		const { id } = await criarEvento(
			ctx.db,
			lider,
			dados({ grupoId: g, recorrencia: 'semanal', data: proxima(1) }),
			[{ tipo: 'grupo', groupId: g }]
		);

		await expect(arquivarGrupo(ctx.db, lider, g)).rejects.toMatchObject({
			motivo: 'tem_encontros'
		});
		await expect(
			ctx.db.execute(sql`update small_group set archived_at = now() where id = ${g}`)
		).rejects.toThrow(/encontros marcados/);

		await encerrarSerie(ctx.db, lider, id, hoje());
		const futuros = await ctx.db
			.select({ id: event.id })
			.from(event)
			.where(and(eq(event.groupId, g), gte(event.startsAt, new Date()), isNotNull(event.id)));
		for (const f of futuros) await cancelarEvento(ctx.db, lider, f.id, null);

		await arquivarGrupo(ctx.db, lider, g);
	});
});

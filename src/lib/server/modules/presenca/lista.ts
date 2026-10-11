import { and, eq, inArray, isNull, notInArray } from 'drizzle-orm';
import { ehId } from '$shared/formulario';
import type { Database } from '$server/db';
import { attendance, event, person, rsvp, rsvpOption, smallGroup } from '$server/db/schema';
import { audit } from '$server/audit/log';
import { authorize, type Actor } from '$server/policy/policy';
import { fusoDaEquipe } from '$server/modules/eventos/eventos';
import { EventoRecusado } from '$server/modules/eventos/regras';
import { criarPessoa } from '$server/modules/pessoas/pessoas';
import type { CriarPessoaEntrada } from '$server/modules/pessoas/validacao';
import { dataNoFuso, hojeNoFuso, horaNoFuso } from '$shared/fuso';
import { esperadoNo, frequenciaDe, JANELA_DE_FREQUENCIA_SEMANAS } from './calculo';
import {
	eventosComLista,
	passagensDaEquipe,
	pessoasDaEquipe,
	presencasDe,
	publicosDe
} from './frequencia';
import type { Significado } from './respostas';

/**
 * Lista de presença do conselheiro (RF-06.2, D-M06-6) — o F3 da seção 10:
 * "toca nos nomes presentes, lista pré-ordenada por frequência".
 *
 * PERMISSÃO: `attendance.record` no grupo do evento (global, se for geral).
 *
 * A lista inteira vai numa gravação só: o conjunto marcado PASSA A SER a
 * presença do evento, e o evento ganha "lista feita" (D-M06-4).
 */

const DIA = 86_400_000;

export type LinhaDaLista = {
	personId: string;
	nome: string;
	presente: boolean;
	resposta: { texto: string; significado: Significado; convidados: number } | null;
	/** Frequência das 8 semanas anteriores — ordena a lista (F3). */
	percentual: number | null;
};

export type ListaDePresenca = {
	evento: {
		id: string;
		titulo: string;
		data: string;
		hora: string;
		grupo: { id: string; nome: string } | null;
		cancelado: boolean;
		jaComecou: boolean;
		listaFeitaEm: Date | null;
	};
	esperados: LinhaDaLista[];
	/** Não era esperado e já está marcado — o visitante, quem veio de outro PG. */
	alemDoEsperado: (LinhaDaLista & { grupo: string | null })[];
	/** O resto da equipe — para marcar quem apareceu sem ser esperado. */
	outros: (LinhaDaLista & { grupo: string | null })[];
};

async function eventoDaEquipe(db: Database, actor: Actor, eventId: string) {
	if (!ehId(eventId)) throw new EventoRecusado('nao_encontrado', 'Esse evento não existe.');
	const [e] = await db
		.select({
			id: event.id,
			titulo: event.title,
			inicio: event.startsAt,
			groupId: event.groupId,
			grupoNome: smallGroup.name,
			status: event.status,
			listaFeitaEm: event.attendanceTakenAt
		})
		.from(event)
		.leftJoin(smallGroup, eq(smallGroup.id, event.groupId))
		.where(and(eq(event.id, eventId), eq(event.teamId, actor.teamId)))
		.limit(1);
	if (!e) throw new EventoRecusado('nao_encontrado', 'Esse evento não existe.');
	return e;
}

export async function listaDePresenca(
	db: Database,
	actor: Actor,
	eventId: string
): Promise<ListaDePresenca> {
	const e = await eventoDaEquipe(db, actor, eventId);
	authorize(actor, 'attendance.record', { groupId: e.groupId });

	const fuso = await fusoDaEquipe(db, actor.teamId);
	const de = new Date(e.inicio.getTime() - JANELA_DE_FREQUENCIA_SEMANAS * 7 * DIA);

	const [pessoas, passagens, publicos, anteriores, presentes, respostas] = await Promise.all([
		pessoasDaEquipe(db, actor.teamId),
		passagensDaEquipe(db, actor.teamId),
		publicosDe(db, [eventId]),
		eventosComLista(db, actor.teamId, { de, ate: e.inicio }),
		presencasDe(db, [eventId]),
		db
			.select({
				personId: rsvp.personId,
				texto: rsvpOption.label,
				significado: rsvpOption.semantic,
				convidados: rsvp.guests
			})
			.from(rsvp)
			.innerJoin(rsvpOption, eq(rsvpOption.id, rsvp.optionId))
			.where(eq(rsvp.eventId, eventId))
	]);
	const presencasAnteriores = await presencasDe(
		db,
		anteriores.map((a) => a.id)
	);

	const esteEvento = { id: eventId, inicio: e.inicio, publico: publicos.get(eventId) ?? [] };
	const respostaDe = new Map(respostas.map((r) => [r.personId, r]));

	const linha = (p: (typeof pessoas)[number]): LinhaDaLista => {
		const r = respostaDe.get(p.id);
		return {
			personId: p.id,
			nome: p.nome,
			presente: presentes.has(`${eventId}:${p.id}`),
			resposta: r
				? { texto: r.texto, significado: r.significado as Significado, convidados: r.convidados }
				: null,
			percentual: frequenciaDe(p, anteriores, passagens, presencasAnteriores).percentual
		};
	};

	// Esperados: quem era convidado no momento do evento (D-M06-5). Quem não
	// era, mas está marcado — inclusive quem foi cadastrado na porta, depois de
	// o encontro começar — aparece à parte, já marcado.
	const esperados: LinhaDaLista[] = [];
	const alemDoEsperado: ListaDePresenca['alemDoEsperado'] = [];
	const outros: ListaDePresenca['outros'] = [];
	for (const p of pessoas) {
		const l = linha(p);
		if (esperadoNo(esteEvento, p, passagens)) esperados.push(l);
		else if (l.presente) alemDoEsperado.push({ ...l, grupo: p.grupoAtual?.nome ?? null });
		else outros.push({ ...l, grupo: p.grupoAtual?.nome ?? null });
	}

	// F3: os mais frequentes primeiro — o conselheiro acha os nomes mais
	// depressa. Quem ainda não tem histórico vai para o fim, em ordem alfabética.
	esperados.sort(
		(a, b) => (b.percentual ?? -1) - (a.percentual ?? -1) || a.nome.localeCompare(b.nome, 'pt-BR')
	);

	return {
		evento: {
			id: e.id,
			titulo: e.titulo,
			data: dataNoFuso(e.inicio, fuso),
			hora: horaNoFuso(e.inicio, fuso),
			grupo: e.groupId ? { id: e.groupId, nome: e.grupoNome! } : null,
			cancelado: e.status === 'cancelado',
			jaComecou: dataNoFuso(e.inicio, fuso) <= hojeNoFuso(fuso),
			listaFeitaEm: e.listaFeitaEm
		},
		esperados,
		alemDoEsperado,
		outros
	};
}

type ContextoDeRequisicao = { ip?: string | null; userAgent?: string | null };

/** A lista deste evento pode ser feita agora? Recusa evento cancelado ou futuro. */
async function exigirListaAberta(
	db: Database,
	actor: Actor,
	e: { status: string; inicio: Date }
): Promise<void> {
	if (e.status === 'cancelado') {
		throw new EventoRecusado('ja_aconteceu', 'Evento cancelado não tem lista de presença.');
	}
	const fuso = await fusoDaEquipe(db, actor.teamId);
	if (dataNoFuso(e.inicio, fuso) > hojeNoFuso(fuso)) {
		throw new EventoRecusado(
			'periodo_invalido',
			'A lista de presença se faz no dia do encontro ou depois.'
		);
	}
}

/**
 * Grava a lista: os marcados PASSAM A SER a presença do evento — quem foi
 * desmarcado sai, quem foi marcado entra — e o evento fica com lista feita.
 *
 * Só no dia do evento ou depois: lista de um encontro que não aconteceu
 * diria que alguém faltou a algo que ainda vai acontecer.
 */
export async function registrarLista(
	db: Database,
	actor: Actor,
	eventId: string,
	presentes: string[],
	contexto: ContextoDeRequisicao = {}
): Promise<{ presentes: number; entraram: number; sairam: number }> {
	const e = await eventoDaEquipe(db, actor, eventId);
	authorize(actor, 'attendance.record', { groupId: e.groupId });
	await exigirListaAberta(db, actor, e);

	const pedidos = [...new Set(presentes)].filter(ehId);
	const validos =
		pedidos.length === 0
			? []
			: (
					await db
						.select({ id: person.id })
						.from(person)
						.where(
							and(
								inArray(person.id, pedidos),
								eq(person.teamId, actor.teamId),
								isNull(person.deletedAt)
							)
						)
				).map((p) => p.id);

	const resultado = await db.transaction(async (tx) => {
		const antes = new Set(
			(
				await tx
					.select({ personId: attendance.personId })
					.from(attendance)
					.where(eq(attendance.eventId, eventId))
			).map((a) => a.personId)
		);

		await tx
			.delete(attendance)
			.where(
				and(
					eq(attendance.eventId, eventId),
					validos.length > 0 ? notInArray(attendance.personId, validos) : undefined
				)
			);

		const novos = validos.filter((id) => !antes.has(id));
		if (novos.length > 0) {
			await tx
				.insert(attendance)
				.values(
					novos.map((personId) => ({ eventId, personId, recordedByPersonId: actor.personId }))
				)
				.onConflictDoNothing();
		}

		await tx
			.update(event)
			.set({
				attendanceTakenAt: new Date(),
				attendanceTakenByPersonId: actor.personId,
				updatedAt: new Date()
			})
			.where(eq(event.id, eventId));

		return {
			presentes: validos.length,
			entraram: novos.length,
			sairam: [...antes].filter((id) => !validos.includes(id)).length
		};
	});

	await audit(db, {
		teamId: actor.teamId,
		actorPersonId: actor.personId,
		action: 'attendance.lista_registrada',
		entity: 'event',
		entityId: eventId,
		after: resultado,
		...contexto
	});
	return resultado;
}

/**
 * Quem chegou pela primeira vez (F1): cadastrado ali mesmo, no grupo do
 * evento, com o regime de dados do cadastro normal (ADR 0003) — idade
 * desconhecida guarda só o nome. Devolve o id, para entrar na lista.
 */
export async function cadastrarNaPorta(
	db: Database,
	actor: Actor,
	eventId: string,
	dados: CriarPessoaEntrada,
	contexto: ContextoDeRequisicao = {}
): Promise<string> {
	const e = await eventoDaEquipe(db, actor, eventId);
	authorize(actor, 'attendance.record', { groupId: e.groupId });
	// ANTES de cadastrar: se a lista vai ser recusada (evento cancelado com a
	// tela aberta, data futura), a pessoa não pode ficar criada — e cada nova
	// tentativa criaria outra (varredura de 11/10/2026).
	await exigirListaAberta(db, actor, e);

	const id = await criarPessoa(db, actor, dados, { ...contexto, grupoId: e.groupId });

	await audit(db, {
		teamId: actor.teamId,
		actorPersonId: actor.personId,
		action: 'attendance.visitante_na_porta',
		entity: 'person',
		entityId: id,
		after: { eventId },
		...contexto
	});
	return id;
}

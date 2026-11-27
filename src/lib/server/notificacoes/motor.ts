import { and, eq, gte, inArray, isNull, lt, lte, ne, sql } from 'drizzle-orm';
import type { Database } from '$server/db';
import {
	escala,
	event as eventTable,
	eventRegistration,
	featureFlag,
	groupMember,
	notification,
	notificationPreference,
	person as personTable,
	personProfile,
	personRole,
	responsabilidade,
	role as roleTable,
	userAccount
} from '$server/db/schema';
import { flagAtiva } from '$lib/server/auth/middleware';
import { naoEhMaster } from '$server/lideranca/regras';

export type NotificationKind =
	'evento' | 'rsvp' | 'escala' | 'anuncio' | 'financeiro' | 'grupo' | 'sistema';

export type NotificarPessoaParams = {
	teamId: string;
	personId: string;
	kind: NotificationKind;
	title: string;
	body: string;
	href?: string | null;
	dedupeKey?: string | null;
	ignorarSilencio?: boolean;
	agora?: Date;
	/** Opcional: quando o chamador já validou `notificacoes_ativas` para a equipe. */
	flagJaVerificada?: boolean;
};

export type ResultadoNotificacao = {
	criada: boolean;
	id?: string;
	motivo?: 'desativada' | 'preferencia' | 'silencio' | 'limite_diario' | 'duplicada' | 'erro';
};

export type ResultadoLembretes = {
	eventos: number;
	rsvp: number;
	escalas: number;
	total: number;
};

const LIMITE_DIARIO_PADRAO = 5;
const LIMITE_DIARIO_ALTA_PRIORIDADE = 10;
const TIPOS_ALTA_PRIORIDADE = new Set<NotificationKind>(['escala', 'grupo', 'financeiro']);
const FUSO_BR = 'America/Sao_Paulo';

/**
 * Retorna a hora (0–23) no fuso `America/Sao_Paulo` para um instante dado.
 */
export function horaEmSaoPaulo(agora: Date = new Date()): number {
	const partes = new Intl.DateTimeFormat('en-US', {
		timeZone: FUSO_BR,
		hour: '2-digit',
		hourCycle: 'h23'
	}).formatToParts(agora);
	const hora = Number(partes.find((p) => p.type === 'hour')?.value ?? '0');
	return Number.isFinite(hora) ? hora % 24 : 0;
}

/**
 * Formata data/hora curta no fuso `America/Sao_Paulo` para textos de notificação.
 */
export function formatarDataHoraCurta(data: Date): string {
	return new Intl.DateTimeFormat('pt-BR', {
		timeZone: FUSO_BR,
		day: '2-digit',
		month: '2-digit',
		hour: '2-digit',
		minute: '2-digit'
	}).format(data);
}

/**
 * Verifica se o horário atual está dentro da janela de silêncio da pessoa (padrão 22h–7h).
 * Suporta virada de meia-noite (ex.: 22 → 7) e aceita tanto hora inteira (0–23) quanto `Date`.
 */
export function estaEmSilencio(
	horaAtual: number | Date,
	quietStartHour = 22,
	quietEndHour = 7
): boolean {
	const hora =
		horaAtual instanceof Date
			? horaEmSaoPaulo(horaAtual)
			: ((Math.floor(horaAtual) % 24) + 24) % 24;
	const inicio = ((Math.floor(quietStartHour) % 24) + 24) % 24;
	const fim = ((Math.floor(quietEndHour) % 24) + 24) % 24;

	if (inicio === fim) return false;
	if (inicio < fim) return hora >= inicio && hora < fim;
	return hora >= inicio || hora < fim;
}

function intervaloDoDiaSaoPaulo(agora: Date): { inicio: Date; fim: Date } {
	const diaIso = new Intl.DateTimeFormat('en-CA', {
		timeZone: FUSO_BR,
		year: 'numeric',
		month: '2-digit',
		day: '2-digit'
	}).format(agora);
	const inicio = new Date(`${diaIso}T00:00:00-03:00`);
	const fim = new Date(inicio.getTime() + 86_400_000);
	return { inicio, fim };
}

function categoriaHabilitada(
	kind: NotificationKind,
	prefs: {
		announcementsEnabled: boolean;
		eventRemindersEnabled: boolean;
		rsvpRemindersEnabled: boolean;
		responsibilityRemindersEnabled: boolean;
	}
): boolean {
	switch (kind) {
		case 'anuncio':
			return prefs.announcementsEnabled;
		case 'evento':
			return prefs.eventRemindersEnabled;
		case 'rsvp':
			return prefs.rsvpRemindersEnabled;
		case 'escala':
			return prefs.responsibilityRemindersEnabled;
		case 'grupo':
		case 'financeiro':
		case 'sistema':
			return true;
	}
}

/**
 * Cria uma notificação in-app respeitando:
 *   1. Feature flag `notificacoes_ativas` da equipe (RN-29, desligada por padrão);
 *   2. Preferências de categoria da pessoa;
 *   3. Janela de silêncio (padrão 22h–7h BRT), salvo `ignorarSilencio: true`;
 *   4. Limite diário anti-excesso (5 padrão; 10 para escala/grupo/financeiro);
 *   5. Deduplicação via índice único parcial `(person_id, dedupe_key)`.
 *
 * Melhor esforço: nunca lança exceção para não quebrar o fluxo chamador.
 */
export async function notificarPessoa(
	banco: Database,
	params: NotificarPessoaParams
): Promise<ResultadoNotificacao> {
	try {
		if (!params.flagJaVerificada) {
			const ativa = await flagAtiva(banco, params.teamId, 'notificacoes_ativas');
			if (!ativa) {
				return { criada: false, motivo: 'desativada' };
			}
		}

		const [pref] = await banco
			.select()
			.from(notificationPreference)
			.where(eq(notificationPreference.personId, params.personId))
			.limit(1);

		const prefs = {
			announcementsEnabled: pref?.announcementsEnabled ?? true,
			eventRemindersEnabled: pref?.eventRemindersEnabled ?? true,
			rsvpRemindersEnabled: pref?.rsvpRemindersEnabled ?? true,
			responsibilityRemindersEnabled: pref?.responsibilityRemindersEnabled ?? true,
			quietStartHour: pref?.quietStartHour ?? 22,
			quietEndHour: pref?.quietEndHour ?? 7
		};

		if (!categoriaHabilitada(params.kind, prefs)) {
			return { criada: false, motivo: 'preferencia' };
		}

		const agora = params.agora ?? new Date();
		if (
			!params.ignorarSilencio &&
			estaEmSilencio(agora, prefs.quietStartHour, prefs.quietEndHour)
		) {
			return { criada: false, motivo: 'silencio' };
		}

		const { inicio, fim } = intervaloDoDiaSaoPaulo(agora);
		const [contagem] = await banco
			.select({ total: sql<number>`count(*)::int` })
			.from(notification)
			.where(
				and(
					eq(notification.personId, params.personId),
					gte(notification.createdAt, inicio),
					lt(notification.createdAt, fim)
				)
			);

		const limite = TIPOS_ALTA_PRIORIDADE.has(params.kind)
			? LIMITE_DIARIO_ALTA_PRIORIDADE
			: LIMITE_DIARIO_PADRAO;
		if ((contagem?.total ?? 0) >= limite) {
			return { criada: false, motivo: 'limite_diario' };
		}

		const [inserida] = await banco
			.insert(notification)
			.values({
				teamId: params.teamId,
				personId: params.personId,
				kind: params.kind,
				title: params.title.trim().slice(0, 160),
				body: params.body.trim().slice(0, 600),
				href: params.href ?? null,
				dedupeKey: params.dedupeKey ?? null,
				createdAt: agora
			})
			.onConflictDoNothing()
			.returning({ id: notification.id });

		if (!inserida) {
			return { criada: false, motivo: 'duplicada' };
		}

		return { criada: true, id: inserida.id };
	} catch (erro) {
		console.error('[NOTIFICACOES] falha ao criar notificação:', erro);
		return { criada: false, motivo: 'erro' };
	}
}

/**
 * Carrega IDs de pessoas ativas (não excluídas, não Master, conta não desabilitada)
 * de uma equipe, informando quais são apenas visitantes.
 */
async function carregarPessoasAtivasDaEquipe(
	banco: Database,
	teamId: string
): Promise<{ todosIds: string[]; membrosAtivosIds: string[] }> {
	const pessoas = await banco
		.select({
			id: personTable.id,
			disabledAt: userAccount.disabledAt
		})
		.from(personTable)
		.leftJoin(userAccount, eq(userAccount.personId, personTable.id))
		.where(
			and(
				eq(personTable.teamId, teamId),
				isNull(personTable.deletedAt),
				naoEhMaster(personTable.id)
			)
		);

	const ativas = pessoas.filter((p) => p.disabledAt === null).map((p) => p.id);
	if (ativas.length === 0) {
		return { todosIds: [], membrosAtivosIds: [] };
	}

	const papeis = await banco
		.select({
			personId: personRole.personId,
			roleKey: roleTable.key
		})
		.from(personRole)
		.innerJoin(roleTable, eq(roleTable.id, personRole.roleId))
		.where(inArray(personRole.personId, ativas));

	const papeisPorPessoa = new Map<string, Set<string>>();
	for (const p of papeis) {
		const conj = papeisPorPessoa.get(p.personId) ?? new Set<string>();
		conj.add(p.roleKey);
		papeisPorPessoa.set(p.personId, conj);
	}

	const membrosAtivosIds = ativas.filter((id) => {
		const conj = papeisPorPessoa.get(id);
		if (!conj || conj.size === 0) return true;
		// Exclui apenas quem tem exclusivamente o papel visitante
		return !(conj.size === 1 && conj.has('visitante'));
	});

	return { todosIds: ativas, membrosAtivosIds };
}

/**
 * Notifica o público-alvo correspondente quando um anúncio é publicado.
 */
export async function notificarAnuncioPublicado(
	banco: Database,
	anuncio: {
		id: string;
		teamId: string;
		title: string;
		body: string;
		audienceScope: string;
		groupId: string | null;
		targetStatus: string | null;
		eventId: string | null;
		authorPersonId: string;
	},
	agora: Date = new Date()
): Promise<number> {
	try {
		const ativa = await flagAtiva(banco, anuncio.teamId, 'notificacoes_ativas');
		if (!ativa) return 0;

		const { todosIds } = await carregarPessoasAtivasDaEquipe(banco, anuncio.teamId);
		if (todosIds.length === 0) return 0;

		let destinatarios: string[] = [];

		if (anuncio.audienceScope === 'group' && anuncio.groupId) {
			const vinculos = await banco
				.select({ personId: groupMember.personId })
				.from(groupMember)
				.where(
					and(eq(groupMember.groupId, anuncio.groupId), inArray(groupMember.personId, todosIds))
				);
			destinatarios = vinculos.map((v) => v.personId);
		} else if (anuncio.audienceScope === 'status' && anuncio.targetStatus) {
			const perfis = await banco
				.select({ personId: personProfile.personId, status: personProfile.status })
				.from(personProfile)
				.where(inArray(personProfile.personId, todosIds));
			const statusPorPessoa = new Map(perfis.map((p) => [p.personId, p.status]));
			destinatarios = todosIds.filter(
				(id) => (statusPorPessoa.get(id) ?? 'visitante') === anuncio.targetStatus
			);
		} else {
			destinatarios = todosIds;
		}

		const filtrados = destinatarios.filter((id) => id !== anuncio.authorPersonId);
		const trecho =
			anuncio.body.length > 220 ? `${anuncio.body.slice(0, 217).trimEnd()}…` : anuncio.body;
		const href = anuncio.eventId ? `/eventos/${anuncio.eventId}` : '/comunicacao';

		let enviadas = 0;
		for (const personId of filtrados) {
			const res = await notificarPessoa(banco, {
				teamId: anuncio.teamId,
				personId,
				kind: 'anuncio',
				title: anuncio.title,
				body: trecho,
				href,
				dedupeKey: `anuncio:${anuncio.id}`,
				agora,
				flagJaVerificada: true
			});
			if (res.criada) enviadas++;
		}

		return enviadas;
	} catch (erro) {
		console.error('[NOTIFICACOES] falha ao notificar anúncio:', erro);
		return 0;
	}
}

/**
 * Gera lembretes automáticos idempotentes para equipes com `notificacoes_ativas = true`:
 *   1. Encontros não cancelados nas próximas 24h (`kind: 'evento'`);
 *   2. Confirmações de presença (RSVP) pendentes para encontros com `rsvpEnabled = true`
 *      entre 12h e 48h à frente (`kind: 'rsvp'`);
 *   3. Responsabilidades atribuídas (`escala.status !== 'trocada'`) em encontros nas
 *      próximas 48h (`kind: 'escala'`).
 */
export async function gerarLembretesAutomaticos(
	banco: Database,
	agora: Date = new Date(),
	options?: { teamId?: string; ignorarSilencio?: boolean }
): Promise<ResultadoLembretes> {
	const filtrosFlag = [eq(featureFlag.key, 'notificacoes_ativas'), eq(featureFlag.enabled, true)];
	if (options?.teamId) {
		filtrosFlag.push(eq(featureFlag.teamId, options.teamId));
	}

	const equipesAtivas = await banco
		.select({ teamId: featureFlag.teamId })
		.from(featureFlag)
		.where(and(...filtrosFlag));

	if (equipesAtivas.length === 0) {
		return { eventos: 0, rsvp: 0, escalas: 0, total: 0 };
	}

	const em12h = new Date(agora.getTime() + 12 * 3_600_000);
	const em24h = new Date(agora.getTime() + 24 * 3_600_000);
	const em48h = new Date(agora.getTime() + 48 * 3_600_000);

	let eventosCount = 0;
	let rsvpCount = 0;
	let escalasCount = 0;

	for (const { teamId } of equipesAtivas) {
		const { todosIds, membrosAtivosIds } = await carregarPessoasAtivasDaEquipe(banco, teamId);
		const todosSet = new Set(todosIds);
		if (todosIds.length === 0) continue;

		// Carrega membros por subgrupo uma vez por equipe
		const todosVinculos = await banco
			.select({ groupId: groupMember.groupId, personId: groupMember.personId })
			.from(groupMember)
			.where(inArray(groupMember.personId, todosIds));
		const membrosPorGrupo = new Map<string, string[]>();
		for (const v of todosVinculos) {
			const lista = membrosPorGrupo.get(v.groupId) ?? [];
			lista.push(v.personId);
			membrosPorGrupo.set(v.groupId, lista);
		}

		// Busca encontros não cancelados nas próximas 48h (cobre 24h de evento e 12h–48h de RSVP)
		const encontros = await banco
			.select({
				id: eventTable.id,
				title: eventTable.title,
				startsAt: eventTable.startsAt,
				location: eventTable.location,
				groupId: eventTable.groupId,
				rsvpEnabled: eventTable.rsvpEnabled
			})
			.from(eventTable)
			.where(
				and(
					eq(eventTable.teamId, teamId),
					ne(eventTable.status, 'cancelled'),
					gte(eventTable.startsAt, agora),
					lte(eventTable.startsAt, em48h)
				)
			);

		if (encontros.length > 0) {
			const encontroIds = encontros.map((e) => e.id);
			const respostas = await banco
				.select({
					eventId: eventRegistration.eventId,
					personId: eventRegistration.personId,
					option: eventRegistration.option
				})
				.from(eventRegistration)
				.where(inArray(eventRegistration.eventId, encontroIds));

			const respostasPorEvento = new Map<string, Map<string, string>>();
			for (const r of respostas) {
				const mapa = respostasPorEvento.get(r.eventId) ?? new Map<string, string>();
				mapa.set(r.personId, r.option);
				respostasPorEvento.set(r.eventId, mapa);
			}

			for (const ev of encontros) {
				const rsvpMapa = respostasPorEvento.get(ev.id) ?? new Map<string, string>();
				const publicoBase = ev.groupId ? (membrosPorGrupo.get(ev.groupId) ?? []) : membrosAtivosIds;
				const dataHora = formatarDataHoraCurta(ev.startsAt);

				// 1. Lembrete de encontro nas próximas 24h
				if (ev.startsAt <= em24h) {
					const destinatarios = new Set<string>(publicoBase);
					for (const [pid, opcao] of rsvpMapa.entries()) {
						if (todosSet.has(pid) && opcao !== 'nao_vou') {
							destinatarios.add(pid);
						}
					}
					for (const [pid, opcao] of rsvpMapa.entries()) {
						if (opcao === 'nao_vou') {
							destinatarios.delete(pid);
						}
					}

					for (const personId of destinatarios) {
						const res = await notificarPessoa(banco, {
							teamId,
							personId,
							kind: 'evento',
							title: `Lembrete: ${ev.title}`,
							body: `Começa em ${dataHora}${ev.location ? ` · ${ev.location}` : ''}.`,
							href: `/eventos/${ev.id}`,
							dedupeKey: `lembrete:evento:${ev.id}:24h`,
							ignorarSilencio: options?.ignorarSilencio,
							agora,
							flagJaVerificada: true
						});
						if (res.criada) eventosCount++;
					}
				}

				// 2. Lembrete de RSVP pendente para encontros entre 12h e 48h
				if (ev.rsvpEnabled && ev.startsAt >= em12h && ev.startsAt <= em48h) {
					for (const personId of publicoBase) {
						if (rsvpMapa.has(personId)) continue;
						const res = await notificarPessoa(banco, {
							teamId,
							personId,
							kind: 'rsvp',
							title: `Confirme sua presença: ${ev.title}`,
							body: `O encontro será em ${dataHora}. Responda se você vai participar.`,
							href: `/eventos/${ev.id}`,
							dedupeKey: `lembrete:rsvp:${ev.id}`,
							ignorarSilencio: options?.ignorarSilencio,
							agora,
							flagJaVerificada: true
						});
						if (res.criada) rsvpCount++;
					}
				}
			}

			// 3. Lembretes de responsabilidades atribuídas nos encontros das próximas 48h
			const escalasProximas = await banco
				.select({
					escalaId: escala.id,
					eventId: escala.eventId,
					personId: escala.personId,
					responsabilidadeNome: responsabilidade.nome,
					eventoTitulo: eventTable.title,
					eventoInicio: eventTable.startsAt,
					eventoLocal: eventTable.location
				})
				.from(escala)
				.innerJoin(eventTable, eq(eventTable.id, escala.eventId))
				.innerJoin(responsabilidade, eq(responsabilidade.id, escala.responsabilidadeId))
				.where(
					and(
						inArray(escala.eventId, encontroIds),
						ne(escala.status, 'trocada'),
						inArray(escala.personId, todosIds)
					)
				);

			for (const item of escalasProximas) {
				const dataHora = formatarDataHoraCurta(item.eventoInicio);
				const res = await notificarPessoa(banco, {
					teamId,
					personId: item.personId,
					kind: 'escala',
					title: `Você está na escala: ${item.responsabilidadeNome}`,
					body: `${item.eventoTitulo} em ${dataHora}${item.eventoLocal ? ` · ${item.eventoLocal}` : ''}.`,
					href: `/eventos/${item.eventId}`,
					dedupeKey: `lembrete:escala:${item.escalaId}`,
					ignorarSilencio: options?.ignorarSilencio,
					agora,
					flagJaVerificada: true
				});
				if (res.criada) escalasCount++;
			}
		}
	}

	return {
		eventos: eventosCount,
		rsvp: rsvpCount,
		escalas: escalasCount,
		total: eventosCount + rsvpCount + escalasCount
	};
}

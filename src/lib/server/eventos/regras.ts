import { and, eq, isNull } from 'drizzle-orm';
import { z } from 'zod';
import type { Database } from '$server/db';
import { eventRegistration, eventType, group, person } from '$server/db/schema';
import { naoEhMaster } from '$server/lideranca/regras';

/**
 * Regras de eventos compartilhadas entre criar (POST) e editar (PATCH).
 *
 * Ficam num lugar só porque as duas rotas precisam responder igual à mesma
 * pergunta ("este tipo, grupo e responsável valem para esta equipe?"): duas
 * cópias divergiriam, e divergência aqui é IDOR.
 */

export const STATUS_EVENTO = ['scheduled', 'ongoing', 'completed', 'cancelled'] as const;
export type StatusEvento = (typeof STATUS_EVENTO)[number];

export const opcoesRsvpSchema = z
	.array(
		z.object({
			key: z
				.string()
				.trim()
				.min(1)
				.max(50)
				.regex(/^[a-z0-9_]+$/, 'Use apenas letras minúsculas, números e _.'),
			label: z.string().trim().min(1).max(80)
		})
	)
	.min(1, 'O evento precisa de pelo menos uma opção de resposta.')
	.max(12)
	.refine((ops) => new Set(ops.map((o) => o.key)).size === ops.length, {
		message: 'Há opções de resposta repetidas.'
	});

export type OpcaoRsvp = z.infer<typeof opcoesRsvpSchema>[number];

/** Erro de regra de negócio, com o status HTTP que a rota deve devolver. */
export type ErroRegra = { status: 400 | 404 | 409; erro: string };

/**
 * Confere que tipo, grupo e responsável existem e pertencem à equipe.
 *
 * `exigirTipoAtivo`: um tipo desativado não serve para evento novo nem para
 * trocar o tipo de um evento, mas um evento que já o usa continua válido.
 */
export async function validarReferencias(
	banco: Database,
	teamId: string,
	refs: {
		eventTypeId?: string;
		exigirTipoAtivo?: boolean;
		groupId?: string | null;
		responsiblePersonId?: string | null;
	}
): Promise<ErroRegra | null> {
	if (refs.eventTypeId !== undefined) {
		const [tipo] = await banco
			.select({ id: eventType.id, active: eventType.active })
			.from(eventType)
			.where(and(eq(eventType.id, refs.eventTypeId), eq(eventType.teamId, teamId)))
			.limit(1);
		if (!tipo) return { status: 404, erro: 'Tipo de evento não encontrado.' };
		if (refs.exigirTipoAtivo && !tipo.active) {
			return { status: 400, erro: 'Este tipo de evento está desativado.' };
		}
	}

	if (refs.groupId) {
		const [g] = await banco
			.select({ id: group.id })
			.from(group)
			.where(and(eq(group.id, refs.groupId), eq(group.teamId, teamId)))
			.limit(1);
		if (!g) return { status: 404, erro: 'Grupo não encontrado.' };
	}

	if (refs.responsiblePersonId) {
		const [p] = await banco
			.select({ id: person.id })
			.from(person)
			.where(
				and(
					eq(person.id, refs.responsiblePersonId),
					eq(person.teamId, teamId),
					isNull(person.deletedAt),
					naoEhMaster(person.id)
				)
			)
			.limit(1);
		if (!p) return { status: 404, erro: 'Responsável não encontrado.' };
	}

	return null;
}

/** O término, quando existe, vem depois do início. */
export function validarPeriodo(inicio: Date, fim: Date | null): ErroRegra | null {
	if (fim && fim <= inicio) {
		return { status: 400, erro: 'O término do evento deve ser posterior ao início.' };
	}
	return null;
}

/**
 * Trocar as opções de resposta não pode apagar o histórico: uma opção que já
 * tem respostas pode mudar de rótulo, mas não sumir. Senão as respostas
 * antigas ficariam apontando para uma chave que ninguém sabe ler.
 */
export async function validarTrocaDeOpcoes(
	banco: Database,
	eventId: string,
	atuais: OpcaoRsvp[],
	novas: OpcaoRsvp[]
): Promise<ErroRegra | null> {
	const chavesNovas = new Set(novas.map((o) => o.key));
	const usadas = await banco
		.selectDistinct({ option: eventRegistration.option })
		.from(eventRegistration)
		.where(eq(eventRegistration.eventId, eventId));

	const removidasComResposta = usadas.map((u) => u.option).filter((k) => !chavesNovas.has(k));
	if (removidasComResposta.length === 0) return null;

	const rotulo = (k: string) => atuais.find((o) => o.key === k)?.label ?? k;
	return {
		status: 409,
		erro:
			'Estas opções já têm respostas e não podem ser removidas (o rótulo pode mudar): ' +
			removidasComResposta.map(rotulo).join(', ') +
			'.'
	};
}

/** `rsvp_options` vem do banco como jsonb; aqui vira a lista tipada. */
export function lerOpcoes(valor: unknown): OpcaoRsvp[] {
	if (!Array.isArray(valor)) return [];
	return valor.filter(
		(o): o is OpcaoRsvp =>
			typeof o === 'object' &&
			o !== null &&
			typeof o.key === 'string' &&
			typeof o.label === 'string'
	);
}

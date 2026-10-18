import { z } from 'zod';
import { CORES_DE_GRUPO } from '$shared/grupo';
import { ehData, ehHora, somarDias } from '$shared/fuso';
import { ehId } from '$shared/formulario';
import type { Alvo } from './regras';

/**
 * Validação dos formulários de evento, série e tipo.
 *
 * Datas e horas chegam como texto local (`AAAA-MM-DD`, `HH:MM`) e assim
 * seguem até o serviço, que as converte no fuso da equipe. Converter aqui
 * exigiria saber a equipe — e a validação não deveria depender do banco.
 */

const opcional = (max: number, mensagem: string) =>
	z
		.union([z.string(), z.null(), z.undefined()])
		.transform((v) => {
			const limpo = v?.trim() ?? '';
			return limpo === '' ? null : limpo;
		})
		.refine((v) => v === null || v.length <= max, mensagem);

const uuidOpcional = z
	.union([z.string(), z.null(), z.undefined()])
	.transform((v) => (v?.trim() ? v.trim() : null))
	.refine((v) => v === null || ehId(v), 'Escolha uma opção da lista.');

const titulo = z
	.string()
	.trim()
	.min(2, 'Dê um título ao evento.')
	.max(120, 'O título pode ter no máximo 120 caracteres.')
	.transform((v) => v.replace(/\s+/g, ' '));

const data = (mensagem: string) => z.string().trim().refine(ehData, mensagem);
const dataOpcional = opcional(10, 'Data inválida.').refine(
	(v) => v === null || ehData(v),
	'Data inválida.'
);
const hora = z.string().trim().refine(ehHora, 'Horário inválido. Use o formato 20:00.');
const horaOpcional = opcional(5, 'Horário inválido.').refine(
	(v) => v === null || ehHora(v),
	'Horário inválido. Use o formato 20:00.'
);

/** Campos comuns a evento avulso, série e edição. */
const base = {
	tipoId: z.string().uuid('Escolha o tipo do evento.'),
	titulo,
	descricao: opcional(1000, 'A descrição pode ter no máximo 1000 caracteres.'),
	local: opcional(200, 'O local pode ter no máximo 200 caracteres.'),
	responsavelId: uuidOpcional,
	horaInicio: hora,
	horaFim: horaOpcional
};

export const eventoSchema = z
	.object({
		...base,
		grupoId: uuidOpcional,
		data: data('Escolha a data.'),
		dataFim: dataOpcional,
		recorrencia: z.enum(['unica', 'semanal']).default('unica'),
		intervaloSemanas: z.coerce.number().int().min(1).max(4).default(1),
		terminaEm: dataOpcional,
		publicar: z.boolean().default(false)
	})
	.superRefine((v, ctx) => {
		if (v.dataFim && v.dataFim < v.data) {
			ctx.addIssue({ code: 'custom', path: ['dataFim'], message: 'Termina antes de começar.' });
		}
		if (v.recorrencia === 'semanal' && v.dataFim && v.dataFim !== v.data) {
			ctx.addIssue({
				code: 'custom',
				path: ['dataFim'],
				message: 'Encontro semanal começa e termina no mesmo dia.'
			});
		}
		if (v.terminaEm && v.terminaEm < v.data) {
			ctx.addIssue({
				code: 'custom',
				path: ['terminaEm'],
				message: 'A série não pode terminar antes de começar.'
			});
		}
		const mesmoDia = !v.dataFim || v.dataFim === v.data;
		if (v.horaFim && mesmoDia && !terminaDepois(v.horaInicio, v.horaFim)) {
			ctx.addIssue({ code: 'custom', path: ['horaFim'], message: 'Termina antes de começar.' });
		}
	});

export type EventoEntrada = z.output<typeof eventoSchema>;

export const ocorrenciaSchema = z
	.object({
		titulo,
		descricao: base.descricao,
		local: base.local,
		responsavelId: uuidOpcional,
		data: data('Escolha a data.'),
		dataFim: dataOpcional,
		horaInicio: hora,
		horaFim: horaOpcional
	})
	.superRefine((v, ctx) => {
		if (v.dataFim && v.dataFim < v.data) {
			ctx.addIssue({ code: 'custom', path: ['dataFim'], message: 'Termina antes de começar.' });
		}
		const mesmoDia = !v.dataFim || v.dataFim === v.data;
		if (v.horaFim && mesmoDia && !terminaDepois(v.horaInicio, v.horaFim)) {
			ctx.addIssue({ code: 'custom', path: ['horaFim'], message: 'Termina antes de começar.' });
		}
	});

export type OcorrenciaEntrada = z.output<typeof ocorrenciaSchema>;

export const serieSchema = z
	.object({
		titulo,
		descricao: base.descricao,
		local: base.local,
		responsavelId: uuidOpcional,
		horaInicio: hora,
		horaFim: horaOpcional
	})
	.superRefine((v, ctx) => {
		if (v.horaFim && !terminaDepois(v.horaInicio, v.horaFim)) {
			ctx.addIssue({ code: 'custom', path: ['horaFim'], message: 'Termina antes de começar.' });
		}
	});

export type SerieEntrada = z.output<typeof serieSchema>;

export const tipoSchema = z.object({
	nome: z
		.string()
		.trim()
		.min(2, 'Dê um nome ao tipo.')
		.max(60, 'O nome pode ter no máximo 60 caracteres.'),
	cor: opcional(7, 'Cor inválida.').refine(
		(v) => v === null || CORES_DE_GRUPO.some((c) => c.valor === v),
		'Escolha uma das cores da lista.'
	),
	ehEncontroDoGrupo: z.boolean().default(false),
	/** Entra na frequência (G3 do M06). Reunião de liderança, por exemplo, não. */
	contaParaFrequencia: z.boolean().default(true)
});

export type TipoEntrada = z.output<typeof tipoSchema>;

/**
 * Fim `00:00` no mesmo dia é a meia-noite do FIM do dia — "das 20h à 0h" —,
 * e não o começo dele. Sem isso, "22:00 até 00:00" era recusado como
 * "termina antes de começar" (revisão de 17/10/2026).
 */
const comoFim = (hora: string) => (hora === '00:00' ? '24:00' : hora);

/** A hora de fim vem depois da de início, no mesmo dia? */
export function terminaDepois(inicio: string, fim: string): boolean {
	return comoFim(fim) > inicio;
}

/** Minutos entre duas horas `HH:MM` do mesmo dia — `00:00` no fim é meia-noite. */
export function minutosEntre(inicio: string, fim: string): number {
	const [h1, m1] = inicio.split(':').map(Number) as [number, number];
	const [h2, m2] = comoFim(fim).split(':').map(Number) as [number, number];
	return h2 * 60 + m2 - (h1 * 60 + m1);
}

/**
 * Data e hora locais em que o evento termina, ou nulo se não tem fim.
 * Sem data de fim, é no mesmo dia; sem hora, no fim dele.
 */
export function fimLocal(d: {
	data: string;
	dataFim: string | null;
	horaFim: string | null;
}): { data: string; hora: string } | null {
	if (!d.horaFim && !d.dataFim) return null;
	const data = d.dataFim ?? d.data;
	if (d.horaFim === '00:00' && data === d.data) {
		return { data: somarDias(d.data, 1), hora: '00:00' };
	}
	return { data, hora: d.horaFim ?? '23:59' };
}

/**
 * Lê o público do formulário.
 *
 * `convite` = 'equipe' ou 'escolhidos'; com 'escolhidos', vale o que estiver
 * marcado em `grupos` e `pessoas`. Ids malformados são descartados — o
 * formulário é do navegador, e o navegador é de quem o controla.
 */
export function lerPublico(form: FormData): Alvo[] {
	if (String(form.get('convite') ?? '') === 'equipe') return [{ tipo: 'equipe' }];

	const unicos = (chave: string) => [...new Set(form.getAll(chave).map(String))].filter(ehId);

	return [
		...unicos('grupos').map((groupId) => ({ tipo: 'grupo' as const, groupId })),
		...unicos('pessoas').map((personId) => ({ tipo: 'pessoa' as const, personId }))
	];
}

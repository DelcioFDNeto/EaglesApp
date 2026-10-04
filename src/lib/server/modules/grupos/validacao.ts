import { z } from 'zod';
import { CORES_DE_GRUPO } from '$shared/grupo';

/**
 * Validação dos dados do grupo.
 *
 * Só o nome é obrigatório — o combinado (dia, horário, local) costuma nascer
 * depois do grupo. Campo vazio vira `null`, nunca `''`, pela mesma razão do
 * cadastro de pessoas (RN-05).
 */

const opcional = (max: number, mensagem: string) =>
	z
		.union([z.string(), z.null(), z.undefined()])
		.transform((v) => {
			if (v == null) return null;
			const limpo = v.trim();
			return limpo === '' ? null : limpo;
		})
		.refine((v) => v === null || v.length <= max, mensagem);

export const dadosDoGrupoSchema = z.object({
	name: z
		.string()
		.trim()
		.min(2, 'Dê um nome ao grupo.')
		.max(60, 'O nome pode ter no máximo 60 caracteres.')
		.transform((v) => v.replace(/\s+/g, ' ')),

	color: opcional(7, 'Cor inválida.').refine(
		(v) => v === null || CORES_DE_GRUPO.some((c) => c.valor === v),
		'Escolha uma das cores da lista.'
	),

	description: opcional(500, 'A descrição pode ter no máximo 500 caracteres.'),

	meetingWeekday: opcional(1, 'Dia da semana inválido.')
		.refine((v) => v === null || /^[0-6]$/.test(v), 'Dia da semana inválido.')
		.transform((v) => (v === null ? null : Number(v))),

	meetingTime: opcional(5, 'Horário inválido.').refine(
		(v) => v === null || /^([01]\d|2[0-3]):[0-5]\d$/.test(v),
		'Horário inválido. Use o formato 20:00.'
	),

	location: opcional(200, 'O local pode ter no máximo 200 caracteres.')
});

export type DadosDoGrupo = z.output<typeof dadosDoGrupoSchema>;
export type DadosDoGrupoEntrada = z.input<typeof dadosDoGrupoSchema>;

/** Motivo de saída — opcional, curto. */
export const motivoSchema = z.union([z.string(), z.null(), z.undefined()]).transform((v) => {
	const limpo = v?.trim() ?? '';
	return limpo === '' ? null : limpo.slice(0, 200);
});

const CAMPOS = [
	'name',
	'color',
	'description',
	'meetingWeekday',
	'meetingTime',
	'location'
] as const;

/**
 * Lê e valida os dados do grupo vindos de um formulário.
 *
 * Devolve também os valores brutos, para a tela não perder o que foi digitado
 * quando a validação recusa.
 */
export function lerDadosDoGrupo(
	form: FormData
):
	| { ok: true; dados: DadosDoGrupo; valores: Record<string, string> }
	| { ok: false; valores: Record<string, string>; erros: Record<string, string | undefined> } {
	const valores = Object.fromEntries(CAMPOS.map((c) => [c, String(form.get(c) ?? '')]));
	const parsed = dadosDoGrupoSchema.safeParse(valores);

	if (!parsed.success) {
		const campos = parsed.error.flatten().fieldErrors;
		return {
			ok: false,
			valores,
			erros: Object.fromEntries(
				Object.entries(campos).map(([campo, mensagens]) => [campo, mensagens?.[0]])
			)
		};
	}
	return { ok: true, dados: parsed.data, valores };
}

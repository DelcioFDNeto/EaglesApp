/**
 * Vocabulário de grupos compartilhado entre servidor e tela.
 *
 * Nada aqui decide permissão: são rótulos, a paleta e a formatação do
 * "combinado" do grupo (dia, horário, local).
 */

export const DIAS_DA_SEMANA = [
	{ valor: '0', rotulo: 'Domingo', curto: 'Dom' },
	{ valor: '1', rotulo: 'Segunda', curto: 'Seg' },
	{ valor: '2', rotulo: 'Terça', curto: 'Ter' },
	{ valor: '3', rotulo: 'Quarta', curto: 'Qua' },
	{ valor: '4', rotulo: 'Quinta', curto: 'Qui' },
	{ valor: '5', rotulo: 'Sexta', curto: 'Sex' },
	{ valor: '6', rotulo: 'Sábado', curto: 'Sáb' }
] as const;

/**
 * Paleta fechada, em vez de um seletor de cor livre: a cor serve para
 * distinguir grupos de relance na lista, e oito tons bem separados fazem isso
 * melhor do que dois azuis quase iguais escolhidos por pessoas diferentes.
 * Todos com contraste suficiente para o texto branco da etiqueta.
 */
export const CORES_DE_GRUPO = [
	{ valor: '#2563EB', rotulo: 'Azul' },
	{ valor: '#16A34A', rotulo: 'Verde' },
	{ valor: '#B45309', rotulo: 'Âmbar' },
	{ valor: '#DC2626', rotulo: 'Vermelho' },
	{ valor: '#7C3AED', rotulo: 'Roxo' },
	{ valor: '#0F766E', rotulo: 'Verde-água' },
	{ valor: '#DB2777', rotulo: 'Rosa' },
	{ valor: '#475569', rotulo: 'Cinza' }
] as const;

/** "20:00:00" → "20h"; "19:30:00" → "19h30". */
export function formatarHorario(horario: string | null | undefined): string | null {
	if (!horario) return null;
	const [h, m] = horario.split(':');
	if (!h) return null;
	const hora = String(Number(h));
	return m && m !== '00' ? `${hora}h${m}` : `${hora}h`;
}

/** "Quinta, 20h · Casa do Pedro" — ou só o que estiver preenchido. */
export function formatarCombinado(grupo: {
	diaDaSemana: number | null;
	horario: string | null;
	local: string | null;
}): string | null {
	const dia = grupo.diaDaSemana === null ? null : DIAS_DA_SEMANA[grupo.diaDaSemana]?.rotulo;
	const quando = [dia, formatarHorario(grupo.horario)].filter(Boolean).join(', ');
	const partes = [quando, grupo.local].filter(Boolean);
	return partes.length > 0 ? partes.join(' · ') : null;
}

/** Valor do seletor de grupo que significa "nenhum grupo". */
export const SEM_GRUPO = 'sem-grupo';

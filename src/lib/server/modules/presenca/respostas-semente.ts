/**
 * Respostas de presença iniciais (RN-11).
 *
 * SEMENTE, não modelo: a liderança edita as respostas e escolhe quais cada
 * tipo de evento oferece. `semantic` é o que os indicadores leem — o texto
 * pode mudar à vontade (D-M06-1).
 */

export type RespostaSemente = {
	key: string;
	label: string;
	semantic: 'sim' | 'talvez' | 'nao';
	allowsGuests: boolean;
	position: number;
};

export const RESPOSTAS_SEMENTE: RespostaSemente[] = [
	{ key: 'vou', label: 'Vou', semantic: 'sim', allowsGuests: true, position: 10 },
	{
		key: 'atrasado',
		label: 'Vou chegar atrasado',
		semantic: 'sim',
		allowsGuests: false,
		position: 20
	},
	{ key: 'talvez', label: 'Talvez', semantic: 'talvez', allowsGuests: false, position: 30 },
	{ key: 'nao_vou', label: 'Não vou', semantic: 'nao', allowsGuests: false, position: 40 }
];

/**
 * Quais respostas cada tipo da semente oferece. Tipo fora daqui oferece
 * todas. Reunião de liderança é "vou" ou "não vou" — sem talvez.
 */
export const RESPOSTAS_POR_TIPO: Record<string, string[]> = {
	reuniao_lideranca: ['vou', 'nao_vou']
};

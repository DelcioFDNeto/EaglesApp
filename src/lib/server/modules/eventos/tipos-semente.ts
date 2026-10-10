/**
 * Tipos de evento iniciais (RN-10).
 *
 * SEMENTE, não modelo — mesma ressalva dos estágios e dos papéis: depois de
 * semeados, os tipos vivem no banco e a liderança os edita pela tela.
 *
 * `isGroupMeeting` marca o tipo do encontro semanal do grupo. É a
 * propriedade, não a chave, que o atalho do grupo procura.
 */

export type TipoSemente = {
	key: string;
	name: string;
	color: string;
	isGroupMeeting: boolean;
	position: number;
};

export const TIPOS_SEMENTE: TipoSemente[] = [
	{
		key: 'encontro_pg',
		name: 'Encontro de PG',
		color: '#2563EB',
		isGroupMeeting: true,
		position: 10
	},
	{
		key: 'encontro_geral',
		name: 'Encontro geral',
		color: '#DC2626',
		isGroupMeeting: false,
		position: 20
	},
	{
		key: 'reuniao_lideranca',
		name: 'Reunião de liderança',
		color: '#475569',
		isGroupMeeting: false,
		position: 30
	},
	{
		key: 'evento_especial',
		name: 'Evento especial',
		color: '#7C3AED',
		isGroupMeeting: false,
		position: 40
	}
];

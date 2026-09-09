/**
 * Estágios iniciais da jornada (RN-02).
 *
 * ATENÇÃO, mesma ressalva dos papéis em `policy/roles.ts`: isto é SEMENTE, não
 * o modelo. Depois de semeados, os estágios vivem no banco e a liderança os
 * edita. Mexer neste arquivo não muda um sistema já instalado.
 *
 * A jornada do briefing é visitante → participante recorrente → membro. "Saiu"
 * entra como estágio terminal porque a alternativa — apagar a pessoa — perderia
 * a frequência e o histórico de quem talvez volte no ano que vem.
 */

export type EstagioSemente = {
	key: string;
	name: string;
	description: string;
	position: number;
	color: string;
	isDefault: boolean;
	isTerminal: boolean;
};

export const ESTAGIOS_SEMENTE: EstagioSemente[] = [
	{
		key: 'visitante',
		name: 'Visitante',
		description: 'Apareceu uma ou poucas vezes. Ainda estamos nos conhecendo.',
		position: 10,
		color: '#AE9195',
		isDefault: true,
		isTerminal: false
	},
	{
		key: 'participante_recorrente',
		name: 'Participante recorrente',
		description: 'Vem com frequência e já faz parte da convivência do PG.',
		position: 20,
		color: '#B45309',
		isDefault: false,
		isTerminal: false
	},
	{
		key: 'membro',
		name: 'Membro Eagles',
		description: 'Membro dos Eagles.',
		position: 30,
		color: '#A91825',
		isDefault: false,
		isTerminal: false
	},
	{
		key: 'afastado',
		name: 'Afastado',
		description: 'Parou de participar. O histórico fica preservado.',
		position: 40,
		color: '#8A7275',
		isDefault: false,
		isTerminal: true
	}
];

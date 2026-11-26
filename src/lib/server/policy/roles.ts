/**
 * Papéis iniciais do sistema.
 *
 * ATENÇÃO: isto NÃO é o RBAC em código. É apenas a SEMENTE usada na primeira
 * migração. Depois de semeados, papéis e permissões vivem no banco e são
 * editáveis pela administração (RF-03.1). Alterar este arquivo não altera um
 * sistema já instalado — para isso existe a tela de gestão de papéis (M03).
 *
 * `isSystem: true` protege o papel de exclusão acidental, mas NÃO congela suas
 * permissões: a liderança pode ajustá-las (seção 11.3).
 */

import { ALL_PERMISSIONS, type Permission, type ScopeType } from './permissions';

/**
 * Papéis com regra própria, fora da gestão comum de papéis:
 *
 * - `master`: o desenvolvedor. Acima de todos, invisível para a equipe, com o
 *   catálogo inteiro de permissões (ver `loadActor`). Só nasce pelo script de
 *   primeiro acesso; ninguém da equipe atribui, edita ou remove.
 * - `lider`: o maior nível da equipe. No máximo 2, por mandato de 2 anos
 *   (`mandato_lider`). Só entra e sai pela tela de Liderança, nunca pela
 *   atribuição comum de papéis.
 */
export const PAPEL_MASTER = 'master';
export const PAPEL_LIDER = 'lider';
export const PAPEIS_RESERVADOS: readonly string[] = [PAPEL_MASTER, PAPEL_LIDER];

/**
 * Só líderes e Master podem ter esta permissão: quem distribui permissões
 * teria, na prática, o mesmo nível dos líderes.
 */
export const PERMISSAO_RESERVADA_A_LIDERES: Permission = 'rbac.manage';

export type RoleSeed = {
	key: string;
	name: string;
	description: string;
	isSystem: boolean;
	/** Escopo em que este papel costuma ser atribuído. Documental — o escopo real fica em `person_role`. */
	defaultScope: ScopeType;
	permissions: Permission[];
};

const MEMBRO_PERMISSIONS: Permission[] = [
	'person.view',
	'group.view',
	'event.view',
	'attendance.view',
	'responsibility.view',
	'finance.view_own',
	'ai.use_basic'
];

const CONSELHEIRO_PERMISSIONS: Permission[] = [
	...MEMBRO_PERMISSIONS,
	'person.create',
	'person.update',
	'person.view_sensitive',
	'person.invite',
	'group.assign_member',
	'event.manage',
	'event.publish',
	'attendance.record',
	'attendance.report',
	'responsibility.manage',
	'finance.view_group',
	'finance.create',
	'announcement.create',
	'announcement.send',
	'ai.use_analytics'
];

export const ROLE_SEEDS: RoleSeed[] = [
	{
		key: PAPEL_MASTER,
		name: 'Master',
		description: 'Acesso do desenvolvedor do sistema. Invisível para a equipe.',
		isSystem: true,
		defaultScope: 'global',
		permissions: [...ALL_PERMISSIONS]
	},
	{
		key: 'lider',
		name: 'Líder',
		description: 'Administração geral dos Eagles.',
		isSystem: true,
		defaultScope: 'global',
		// O líder recebe todas as permissões existentes na semeadura.
		// Ainda assim passa pela mesma verificação: não há atalho de superusuário.
		permissions: [
			...CONSELHEIRO_PERMISSIONS,
			'person.delete',
			'person.export',
			'group.manage',
			'finance.view_all',
			'finance.approve',
			'finance.reverse',
			'ai.use_finance',
			'settings.manage',
			'rbac.manage',
			'audit.view'
		]
	},
	{
		key: 'conselheiro',
		name: 'Conselheiro',
		description: 'Cuida de um ou mais grupos e das pessoas neles.',
		isSystem: true,
		defaultScope: 'group',
		permissions: CONSELHEIRO_PERMISSIONS
	},
	{
		key: 'membro',
		name: 'Membro',
		description: 'Membro dos Eagles.',
		isSystem: true,
		defaultScope: 'self',
		permissions: MEMBRO_PERMISSIONS
	},
	{
		key: 'visitante',
		name: 'Visitante',
		description: 'Acesso limitado a eventos autorizados. Sem acesso financeiro.',
		isSystem: true,
		defaultScope: 'self',
		permissions: ['event.view']
	}
];

export const SYSTEM_ROLE_KEYS = ROLE_SEEDS.map((r) => r.key);

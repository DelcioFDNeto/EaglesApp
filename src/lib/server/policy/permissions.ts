/**
 * Catálogo de permissões do Eagles App.
 *
 * Permissões são strings `recurso.acao`. Este arquivo é a ÚNICA fonte de
 * verdade sobre quais permissões existem — o banco é semeado a partir dele.
 *
 * Regra de ouro (RN-08, seção 11.4 da arquitetura): nenhuma rota acessa dados
 * sem declarar uma destas permissões. Rota sem declaração é rota negada, e o
 * teste `tests/unit/routes-declaram-permissao.test.ts` falha se alguém esquecer.
 */

export const PERMISSIONS = {
	// --- Pessoas -------------------------------------------------------------
	'person.view': 'Ver pessoas',
	'person.create': 'Cadastrar pessoas',
	'person.update': 'Editar pessoas',
	'person.delete': 'Remover pessoas',
	'person.view_sensitive': 'Ver dados sensíveis (contato, relacionamento, vínculos)',
	'person.export': 'Exportar lista de pessoas',
	'person.invite': 'Emitir convite de acesso',

	// --- Subgrupos -----------------------------------------------------------
	'group.view': 'Ver subgrupos',
	'group.manage': 'Criar, editar e arquivar subgrupos',
	'group.update': 'Editar nome e descrição do subgrupo',
	'group.assign_member': 'Transferir membros entre subgrupos',

	// --- Eventos -------------------------------------------------------------
	'event.view': 'Ver eventos',
	'event.manage': 'Criar e editar eventos',
	'event.publish': 'Publicar evento para o público-alvo',

	// --- Presença ------------------------------------------------------------
	'attendance.view': 'Ver presença',
	'attendance.record': 'Registrar presença efetiva',
	'attendance.report': 'Ver relatórios de frequência',

	// --- Responsabilidades ---------------------------------------------------
	'responsibility.view': 'Ver responsabilidades',
	'responsibility.manage': 'Atribuir e alterar responsabilidades',

	// --- Financeiro ----------------------------------------------------------
	'finance.view_own': 'Ver as próprias contribuições',
	'finance.view_group': 'Ver o financeiro por subgrupo',
	'finance.view_all': 'Ver todo o financeiro',
	'finance.create': 'Lançar movimentações',
	'finance.approve': 'Aprovar despesas',
	'finance.reverse': 'Estornar movimentações',

	// --- Comunicação ---------------------------------------------------------
	'announcement.create': 'Criar anúncios',
	'announcement.send': 'Enviar anúncios',

	// --- IA ------------------------------------------------------------------
	'ai.use_basic': 'Usar a IA para textos pessoais',
	'ai.use_analytics': 'Usar a IA para análises de participação',
	'ai.use_finance': 'Usar a IA sobre dados financeiros',

	// --- Administração -------------------------------------------------------
	'settings.manage': 'Alterar configurações do sistema',
	'rbac.manage': 'Gerenciar papéis e permissões',
	'audit.view': 'Consultar a auditoria'
} as const;

export type Permission = keyof typeof PERMISSIONS;

export const ALL_PERMISSIONS = Object.keys(PERMISSIONS) as Permission[];

export function isPermission(value: string): value is Permission {
	return Object.prototype.hasOwnProperty.call(PERMISSIONS, value);
}

/**
 * Escopo de uma atribuição de papel.
 *
 * Este é o coração do modelo (seção 5.2): autoridade e pertencimento são eixos
 * independentes. "Conselheiro do PG Azul" = papel conselheiro + escopo do grupo.
 */
export type ScopeType = 'global' | 'group' | 'self';

/** Contexto do recurso sobre o qual a permissão está sendo verificada. */
export type PolicyContext = {
	/** Grupo ao qual o recurso pertence, quando aplicável. */
	groupId?: string | null;
	/** Pessoa dona do recurso, quando aplicável (para escopo `self`). */
	personId?: string | null;
};

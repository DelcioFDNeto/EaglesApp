import { can, type Actor, type RoleAssignment } from '$server/policy/policy';
import type { Permission } from '$server/policy/permissions';
import { REAUTH_WINDOW_MINUTES } from '$shared/sessao';

/**
 * As travas da administração de acesso (D-M03-2).
 *
 * Funções puras, sem banco: são as regras que mais importam acertar, e assim
 * se testam em milissegundos, uma por uma. Quem consulta o banco — a contagem
 * de administradores ativos — vive em `administradores.ts`.
 */

export type MotivoDeRecusa =
	| 'reautenticacao'
	| 'propria_conta'
	| 'escalada'
	| 'ultimo_administrador'
	| 'papel_de_sistema'
	| 'papel_com_pessoas'
	| 'escopo_de_grupo'
	| 'nao_encontrado'
	| 'nome_em_uso'
	| 'sem_papel'
	| 'regime_restrito'
	| 'conta_desativada';

/**
 * Recusa de uma alteração de acesso, com a explicação para a tela.
 *
 * Toda recusa diz o motivo e o que fazer. "Acesso negado" sozinho não ajuda
 * quem está tentando organizar os papéis da equipe.
 */
export class AcessoRecusado extends Error {
	readonly motivo: MotivoDeRecusa;
	constructor(motivo: MotivoDeRecusa, mensagem: string) {
		super(mensagem);
		this.name = 'AcessoRecusado';
		this.motivo = motivo;
	}
}

/**
 * Permissões que o ator detém em escopo GLOBAL.
 *
 * É o teto do que ele pode conceder. Escopo de grupo não entra: quem é
 * conselheiro de um PG não está autorizado a distribuir esse poder para a
 * equipe inteira.
 */
export function permissoesGlobaisDe(actor: Actor): ReadonlySet<Permission> {
	const todas = new Set<Permission>();
	for (const a of actor.assignments) {
		if (a.scopeType !== 'global') continue;
		for (const p of a.permissions) todas.add(p);
	}
	return todas;
}

/**
 * Trava 2 — ninguém concede o que não tem.
 *
 * Devolve as permissões pedidas que o ator NÃO detém globalmente. Lista vazia
 * significa que a concessão é legítima.
 *
 * Sem esta trava, alguém com `rbac.manage` e mais nada criaria um papel com
 * `finance.view_all` e o daria a um amigo — ou a uma segunda conta sua.
 */
export function permissoesQueFaltam(actor: Actor, pedidas: Iterable<Permission>): Permission[] {
	const teto = permissoesGlobaisDe(actor);
	return [...new Set(pedidas)].filter((p) => !teto.has(p)).sort();
}

export function exigirSemEscalada(actor: Actor, pedidas: Iterable<Permission>): void {
	const faltam = permissoesQueFaltam(actor, pedidas);
	if (faltam.length > 0) {
		throw new AcessoRecusado(
			'escalada',
			`Você não pode conceder uma permissão que não tem: ${faltam.join(', ')}.`
		);
	}
}

/**
 * Trava 5 — convite não é atalho para poder (varredura de 11/10/2026).
 *
 * Quem emite um convite recebe o link e pode abri-lo antes de mandá-lo; na
 * recuperação, aceitar troca a senha E o identificador de entrada. Emitir um
 * convite equivale, portanto, a obter tudo o que a conta convidada pode fazer.
 * Sem esta trava, o conselheiro de um PG em que o líder é membro geraria um
 * "convite de recuperação" para o líder e ficaria com a conta dele.
 *
 * Só convida quem já detém cada permissão da pessoa NO MESMO ALCANCE: global
 * para o que é global, o grupo (ou global) para o que é do grupo, e poder
 * sobre a pessoa para o que é dela mesma. Devolve o que falta; vazio = pode.
 */
export function permissoesForaDoAlcance(
	actor: Actor,
	alvo: { personId: string; groupId: string | null; assignments: readonly RoleAssignment[] }
): Permission[] {
	const faltam = new Set<Permission>();
	for (const a of alvo.assignments) {
		const ctx =
			a.scopeType === 'global'
				? {}
				: a.scopeType === 'group'
					? { groupId: a.scopeId }
					: { personId: alvo.personId, groupId: alvo.groupId };
		for (const p of a.permissions) if (!can(actor, p, ctx)) faltam.add(p);
	}
	return [...faltam].sort();
}

/** Trava 3 — ninguém altera o próprio acesso (princípio dos quatro olhos). */
export function exigirOutraPessoa(actor: Actor, alvoPersonId: string): void {
	if (actor.personId === alvoPersonId) {
		throw new AcessoRecusado(
			'propria_conta',
			'Ninguém altera o próprio acesso. Peça a outra pessoa da liderança.'
		);
	}
}

/** Reautenticação recente (ADR 0004), exigida por toda alteração de acesso. */
export function exigirReautenticacao(reautenticadoRecentemente: boolean): void {
	if (!reautenticadoRecentemente) {
		throw new AcessoRecusado(
			'reautenticacao',
			`Confirme sua senha antes de alterar acessos. A confirmação vale por ${REAUTH_WINDOW_MINUTES} minutos.`
		);
	}
}

/** Contexto de toda operação sensível de acesso. */
export type ContextoSensivel = {
	reautenticadoRecentemente: boolean;
	ip?: string | null;
	userAgent?: string | null;
};

/**
 * Chave técnica de um papel personalizado, a partir do nome.
 *
 * Só identifica o papel internamente — quem administra vê o nome. Sem acento,
 * minúscula, com `_` no lugar do resto.
 */
export function chaveDoNome(nome: string): string {
	const base = nome
		.normalize('NFD')
		.replace(/[̀-ͯ]/g, '')
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '_')
		.replace(/^_+|_+$/g, '')
		.slice(0, 40);
	return base || 'papel';
}

/** Código HTTP de cada recusa, para as ações de formulário. */
export function statusDaRecusa(motivo: MotivoDeRecusa): 400 | 403 | 404 | 409 {
	switch (motivo) {
		case 'reautenticacao':
		case 'propria_conta':
		case 'escalada':
			return 403;
		case 'nao_encontrado':
			return 404;
		case 'ultimo_administrador':
		case 'papel_com_pessoas':
		case 'nome_em_uso':
		case 'conta_desativada':
			return 409;
		default:
			return 400;
	}
}

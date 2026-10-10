import { can, canAnywhere, groupsWhere, type Actor } from '$server/policy/policy';

/**
 * Regras de eventos que não precisam de banco (D-M05-5, D-M05-6, D-M05-7).
 *
 * Puras, como as travas do M03: são as que mais importam acertar, e assim se
 * testam em milissegundos. A listagem da agenda repete a regra de
 * visibilidade em SQL, por eficiência — e um teste de integração confere, para
 * cada ator e cada evento, que as duas respostas coincidem.
 */

export type Alvo =
	{ tipo: 'equipe' } | { tipo: 'grupo'; groupId: string } | { tipo: 'pessoa'; personId: string };

export type MotivoDeRecusaDeEvento =
	| 'nao_encontrado'
	| 'publico_fora_do_escopo'
	| 'sem_publico'
	| 'tipo_arquivado'
	| 'grupo_arquivado'
	| 'serie_encerrada'
	| 'periodo_invalido'
	| 'nome_em_uso'
	| 'ja_aconteceu';

export class EventoRecusado extends Error {
	readonly motivo: MotivoDeRecusaDeEvento;
	constructor(motivo: MotivoDeRecusaDeEvento, mensagem: string) {
		super(mensagem);
		this.name = 'EventoRecusado';
		this.motivo = motivo;
	}
}

export function statusDaRecusaDeEvento(motivo: MotivoDeRecusaDeEvento): 400 | 403 | 404 | 409 {
	switch (motivo) {
		case 'nao_encontrado':
			return 404;
		case 'publico_fora_do_escopo':
			return 403;
		case 'nome_em_uso':
		case 'serie_encerrada':
		case 'ja_aconteceu':
			return 409;
		default:
			return 400;
	}
}

/**
 * Pode criar ou editar um evento do grupo `groupId` — ou geral, se nulo?
 *
 * `can` sem grupo no contexto só passa com escopo global: evento que não é de
 * grupo nenhum é da equipe inteira, e isso é decisão da liderança.
 */
export function podeGerenciar(actor: Actor | null, groupId: string | null): boolean {
	return can(actor, 'event.manage', { groupId });
}

export function podePublicar(actor: Actor | null, groupId: string | null): boolean {
	return can(actor, 'event.publish', { groupId });
}

/**
 * D-M05-5 — quais convites o ator NÃO pode fazer.
 *
 * Escopo global convida qualquer um. Escopo de grupo convida os próprios
 * grupos e pessoas avulsas; "a equipe inteira" e outros grupos, não.
 */
export function alvosForaDoEscopo(actor: Actor, publico: Alvo[]): Alvo[] {
	if (can(actor, 'event.manage')) return [];
	return publico.filter((alvo) => {
		if (alvo.tipo === 'equipe') return true;
		if (alvo.tipo === 'grupo') return !can(actor, 'event.manage', { groupId: alvo.groupId });
		return false;
	});
}

/** O evento, do ponto de vista de quem decide se ele é visível. */
export type EventoParaVisibilidade = {
	groupId: string | null;
	publicado: boolean;
};

/**
 * D-M05-7 — quem vê o quê.
 *
 * 1. Quem pode gerenciar o evento o vê sempre — rascunho incluído.
 * 2. Rascunho, ninguém mais.
 * 3. Publicado: `event.view` global vê tudo; `event.view` no grupo do evento
 *    vê o evento; e qualquer um com `event.view` vê aquilo para que foi
 *    convidado — a equipe, o grupo dele (ou um grupo que acompanha), ele.
 */
export function podeVerEvento(
	actor: Actor | null,
	evento: EventoParaVisibilidade,
	publico: Alvo[],
	meuGrupo: string | null
): boolean {
	if (!actor) return false;
	if (podeGerenciar(actor, evento.groupId)) return true;
	if (!evento.publicado) return false;
	if (can(actor, 'event.view')) return true;
	if (evento.groupId && can(actor, 'event.view', { groupId: evento.groupId })) return true;
	if (!canAnywhere(actor, 'event.view')) return false;
	return foiConvidado(actor, publico, meuGrupo);
}

/**
 * O ator está no público? É a "minha agenda" de cada um (D-M05-7).
 *
 * Grupo convidado conta se for o grupo DELE ou um que ele acompanha com
 * `event.view` de escopo de grupo — o conselheiro que não é membro do PG que
 * aconselha continua vendo o encontro dele.
 */
export function foiConvidado(actor: Actor, publico: Alvo[], meuGrupo: string | null): boolean {
	const acompanho = new Set(groupsWhere(actor, 'event.view'));
	return publico.some(
		(a) =>
			a.tipo === 'equipe' ||
			(a.tipo === 'pessoa' && a.personId === actor.personId) ||
			(a.tipo === 'grupo' && (a.groupId === meuGrupo || acompanho.has(a.groupId)))
	);
}

/** Público padrão (D-M05-5): evento de grupo convida o grupo; geral, a equipe. */
export function publicoPadrao(groupId: string | null): Alvo[] {
	return groupId ? [{ tipo: 'grupo', groupId }] : [{ tipo: 'equipe' }];
}

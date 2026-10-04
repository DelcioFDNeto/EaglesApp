import type { Actor } from '$server/policy/policy';
import {
	ALL_PERMISSIONS,
	PERMISSIONS,
	PERMISSOES_SENSIVEIS,
	RECURSOS,
	recursoDe,
	type Permission
} from '$server/policy/permissions';
import { permissoesGlobaisDe } from './regras';

export type PermissaoNaTela = {
	chave: Permission;
	descricao: string;
	sensivel: boolean;
	marcada: boolean;
	/**
	 * Desmarcada E fora do alcance de quem edita: não pode ser concedida
	 * (trava "ninguém concede o que não tem"). A tela a mostra desabilitada,
	 * com o porquê — o servidor recusaria de qualquer jeito.
	 *
	 * Uma permissão MARCADA nunca é bloqueada, mesmo que quem edita não a
	 * tenha: retirar é sempre permitido. E há um motivo técnico — caixa
	 * desabilitada não é enviada pelo formulário, então bloquear uma marcada
	 * a faria sumir do papel sem que ninguém tivesse pedido.
	 */
	bloqueada: boolean;
};

export type GrupoDePermissoes = { rotulo: string; permissoes: PermissaoNaTela[] };

/** O catálogo inteiro, agrupado por recurso, do ponto de vista de quem edita. */
export function gruposDePermissoes(
	actor: Actor,
	marcadas: ReadonlySet<Permission>
): GrupoDePermissoes[] {
	const teto = permissoesGlobaisDe(actor);

	return RECURSOS.map((recurso) => ({
		rotulo: recurso.rotulo,
		permissoes: ALL_PERMISSIONS.filter((p) => recursoDe(p) === recurso.prefixo).map((p) => ({
			chave: p,
			descricao: PERMISSIONS[p],
			sensivel: PERMISSOES_SENSIVEIS.has(p),
			marcada: marcadas.has(p),
			bloqueada: !marcadas.has(p) && !teto.has(p)
		}))
	})).filter((g) => g.permissoes.length > 0);
}

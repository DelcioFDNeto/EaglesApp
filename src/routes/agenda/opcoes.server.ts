import type { Database } from '$server/db';
import { can, type Actor } from '$server/policy/policy';
import { gruposAtivos } from '$server/modules/grupos/grupos';
import { pessoasParaEscolha } from '$server/modules/pessoas/pessoas';
import { listarTipos } from '$server/modules/eventos/tipos';

/**
 * Opções dos formulários de evento, calculadas para QUEM está preenchendo.
 *
 * A tela só oferece o que o servidor aceitaria (D-M05-5): grupos onde a
 * pessoa gerencia eventos, "toda a equipe" só com escopo global. O serviço
 * confere de novo — isto é conveniência, não proteção.
 */
export async function opcoesDoFormulario(db: Database, actor: Actor) {
	const [tipos, grupos, pessoas] = await Promise.all([
		listarTipos(db, actor.teamId),
		gruposAtivos(db, actor.teamId),
		pessoasParaEscolha(db, actor)
	]);

	const gerencioTudo = can(actor, 'event.manage');
	const meusGrupos = grupos.filter((g) => can(actor, 'event.manage', { groupId: g.id }));

	return {
		tipos: tipos.map((t) => ({ valor: t.id, rotulo: t.nome })),
		grupos: meusGrupos.map((g) => ({ valor: g.id, rotulo: g.nome })),
		pessoas: pessoas.map((p) => ({ valor: p.id, rotulo: p.nome })),
		podeCriarEventoGeral: gerencioTudo,
		podeConvidarEquipe: gerencioTudo
	};
}

/** O que o formulário enviou, para devolver à tela quando algo for recusado. */
export function valoresDoFormulario(form: FormData) {
	const valores: Record<string, string> = {};
	for (const [chave, valor] of form.entries()) {
		if (chave !== 'grupos' && chave !== 'pessoas') valores[chave] = String(valor);
	}
	return {
		valores,
		convite: {
			convite: String(form.get('convite') ?? 'padrao'),
			grupos: form.getAll('grupos').map(String),
			pessoas: form.getAll('pessoas').map(String)
		}
	};
}

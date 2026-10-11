import { redirect } from '@sveltejs/kit';
import { db } from '$server/db';
import { canAnywhere } from '$server/policy/policy';
import { PERMISSIONS } from '$server/policy/permissions';
import { featureFlag } from '$server/db/schema';
import { listarGrupos, meusGrupos } from '$server/modules/grupos/grupos';
import { proximosEventos } from '$server/modules/eventos/eventos';
import { paineisDeResposta } from '$server/modules/presenca/painel';
import { eq } from 'drizzle-orm';
import type { PageServerLoad } from './$types';

/**
 * Início — o dashboard.
 *
 * PERMISSÃO: `event.view` no escopo da própria pessoa.
 *
 * No M01 esta tela não mostra evento nenhum, porque eventos são o M05. Ela
 * existe para provar o caminho completo: sessão → política → dado → tela.
 * O estado vazio aqui é o estado verdadeiro, não um placeholder.
 */
export const load: PageServerLoad = async ({ locals }) => {
	if (!locals.actor) redirect(303, '/entrar');

	// Declaração explícita da permissão desta rota. A ausência desta linha é
	// pega pelo teste `rotas-declaram-permissao`.
	//
	// `canAnywhere`, e não `authorize` com contexto de pessoa: o painel é do
	// próprio usuário e não pertence a grupo nenhum (correção do M02).
	//
	// E não LANÇA quando falta a permissão: quem entrou mas ainda não tem papel
	// recebia uma tela de erro genérica. Agora recebe a explicação do que
	// aconteceu e a quem procurar (M03).
	if (!canAnywhere(locals.actor, 'event.view')) {
		return {
			semAcesso: true as const,
			nome: locals.displayName ?? 'Eagles',
			papeis: [],
			permissoes: [],
			catalogoPermissoes: {},
			funcionalidades: {},
			grupos: [],
			proximos: [],
			resposta: null
		};
	}

	const banco = db();

	const flags = await banco
		.select({ key: featureFlag.key, enabled: featureFlag.enabled })
		.from(featureFlag)
		.where(eq(featureFlag.teamId, locals.actor.teamId));

	// "Seu grupo": o PG de quem é membro e os PGs de quem é responsável. O
	// conselheiro abre o app e chega ao próprio grupo em um toque (F3).
	const grupos = canAnywhere(locals.actor, 'group.view')
		? await (async () => {
				const meus = new Set(await meusGrupos(banco, locals.actor!));
				if (meus.size === 0) return [];
				return (await listarGrupos(banco, locals.actor!)).filter((g) => meus.has(g.id));
			})()
		: [];

	// "Minha agenda" (D-M05-7): o que foi publicado PARA a pessoa — a
	// equipe, o grupo dela, ela mesma —, não a agenda da equipe inteira.
	const proximos = await proximosEventos(banco, locals.actor, { limite: 3 });

	// "Você vai?" no próximo encontro que ainda aceita resposta (F2): o
	// membro abre o app na quinta e confirma sem procurar o evento.
	const paineis = await paineisDeResposta(banco, locals.actor, proximos);
	const proximoAberto = proximos.find((e) => paineis.get(e.id)?.podeResponder);

	// Quais permissões esta pessoa realmente tem — o menu se monta a partir
	// disto, e não de "se papel === conselheiro".
	const minhasPermissoes = [
		...new Set(locals.actor.assignments.flatMap((a) => [...a.permissions]))
	].sort();

	return {
		semAcesso: false as const,
		nome: locals.displayName ?? 'Eagles',
		papeis: [...new Set(locals.actor.assignments.map((a) => a.roleKey))],
		permissoes: minhasPermissoes,
		catalogoPermissoes: PERMISSIONS as Record<string, string>,
		funcionalidades: Object.fromEntries(flags.map((f) => [f.key, f.enabled])),
		grupos: grupos.map((g) => ({ id: g.id, nome: g.nome, cor: g.cor, membros: g.membros })),
		proximos: proximos.map((e) => ({
			...e,
			inicio: e.inicio.toISOString(),
			fim: e.fim?.toISOString() ?? null
		})),
		resposta: proximoAberto
			? { eventoId: proximoAberto.id, painel: paineis.get(proximoAberto.id)! }
			: null
	};
};

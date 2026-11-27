import { json } from '@sveltejs/kit';
import { db } from '$server/db';
import { autenticarAtor, isUuid } from '$lib/server/auth/middleware';
import { can } from '$server/policy/policy';
import { carregarAlvo } from '$server/pessoas/alvo';
import {
	carregarDados,
	frequenciaDaPessoa,
	indexar,
	lerPeriodo
} from '$server/presenca/frequencia';

/**
 * Frequência de uma pessoa: no próprio PG (em %), nos outros eventos (só
 * contagem), por mês, e os encontros recentes com resposta × presença.
 *
 * Quem vê: a própria pessoa (`attendance.view`), ou quem tem
 * `attendance.report` no PG atual dela (ou global). Ninguém mais: frequência
 * só para quem tem responsabilidade pastoral sobre a pessoa (seção 4).
 */
export const GET = async ({ request, params, url, locals }) => {
	const banco = db();
	const auth = await autenticarAtor(request, banco, locals?.actor);
	if (!auth) return json({ erro: 'Não autenticado' }, { status: 401 });
	const { actor } = auth;

	if (!isUuid(params.id)) return json({ erro: 'Identificador inválido.' }, { status: 400 });

	const alvo = await carregarAlvo(banco, actor.teamId, params.id);
	if (!alvo) return json({ erro: 'Pessoa não encontrada.' }, { status: 404 });

	const ehEla = alvo.id === actor.personId;
	const pode = ehEla
		? can(actor, 'attendance.view', { personId: actor.personId })
		: can(actor, 'attendance.report', { groupId: alvo.groupId });
	if (!pode) {
		return json({ erro: 'Sem permissão para ver a frequência desta pessoa.' }, { status: 403 });
	}

	const periodo = lerPeriodo(url);
	if (!periodo) return json({ erro: 'Período inválido (máximo de 2 anos).' }, { status: 400 });

	const dados = await carregarDados(banco, actor.teamId, periodo);
	return json({
		periodo,
		pessoa: { id: alvo.id, nome: alvo.nome },
		...frequenciaDaPessoa(alvo.id, dados, indexar(dados))
	});
};

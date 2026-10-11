import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { criarBancoDeTeste, type BancoDeTeste } from './helpers/banco';
import { person, personRole, userAccount } from '../../src/lib/server/db/schema';
import { loadActor } from '../../src/lib/server/policy/actor';
import type { Actor } from '../../src/lib/server/policy/policy';
import { hashPassword } from '../../src/lib/server/auth/password';
import { listarPessoas } from '../../src/lib/server/modules/pessoas/pessoas';
import { EstagioInvalido, mudarEstagio } from '../../src/lib/server/modules/pessoas/status';
import { mudarDeGrupo } from '../../src/lib/server/modules/grupos/composicao';
import { GrupoRecusado } from '../../src/lib/server/modules/grupos/regras';
import { atribuirPapel, removerAtribuicao } from '../../src/lib/server/modules/rbac/atribuicoes';
import { AcessoRecusado } from '../../src/lib/server/modules/rbac/regras';
import { arquivarTipo, atualizarTipo } from '../../src/lib/server/modules/eventos/tipos';
import { tipoSchema } from '../../src/lib/server/modules/eventos/validacao';
import { verEvento } from '../../src/lib/server/modules/eventos/eventos';
import { EventoRecusado } from '../../src/lib/server/modules/eventos/regras';
import { registrarLista } from '../../src/lib/server/modules/presenca/lista';
import { arquivarResposta } from '../../src/lib/server/modules/presenca/respostas';

/**
 * Varredura de 11/10/2026: ids chegam do formulário e da URL — do navegador,
 * portanto de quem o controla. Um id malformado que chegasse ao Postgres
 * virava erro de sintaxe e uma página 500. Cada serviço que recebe id de fora
 * responde "não encontrado" com a recusa do próprio domínio.
 */

const RUIM = "x' or 1=1 --";
const COM_REAUTH = { reautenticadoRecentemente: true };

let ctx: BancoDeTeste;
let lider: Actor;
let alguem: string;

beforeAll(async () => {
	ctx = await criarBancoDeTeste();
	const [l] = await ctx.db
		.insert(person)
		.values({ teamId: ctx.teamId, fullName: 'Líder Malformado' })
		.returning({ id: person.id });
	await ctx.db
		.insert(personRole)
		.values({ personId: l!.id, roleId: ctx.papeis.lider!, scopeType: 'global' });
	await ctx.db.insert(userAccount).values({
		personId: l!.id,
		email: 'malformado@eagles.test',
		passwordHash: await hashPassword('uma senha de teste comprida')
	});
	lider = (await loadActor(ctx.db, l!.id))!;
	const [p] = await ctx.db
		.insert(person)
		.values({ teamId: ctx.teamId, fullName: 'Alguém' })
		.returning({ id: person.id });
	alguem = p!.id;
});

afterAll(async () => {
	await ctx.fechar();
});

describe('id malformado vira "não encontrado", nunca erro do banco', () => {
	it('filtros da lista de pessoas são ignorados', async () => {
		await expect(
			listarPessoas(ctx.db, lider, { statusId: RUIM, grupoId: 'abc' })
		).resolves.toBeInstanceOf(Array);
	});

	it('mudar de grupo', async () => {
		await expect(
			mudarDeGrupo(ctx.db, lider, { personId: RUIM, paraGrupoId: null })
		).rejects.toBeInstanceOf(GrupoRecusado);
		await expect(
			mudarDeGrupo(ctx.db, lider, { personId: alguem, paraGrupoId: RUIM })
		).rejects.toBeInstanceOf(GrupoRecusado);
	});

	it('atribuir e remover papel', async () => {
		await expect(
			atribuirPapel(ctx.db, lider, { personId: alguem, roleId: RUIM }, COM_REAUTH)
		).rejects.toBeInstanceOf(AcessoRecusado);
		await expect(removerAtribuicao(ctx.db, lider, '', COM_REAUTH)).rejects.toBeInstanceOf(
			AcessoRecusado
		);
	});

	it('mudar de estágio', async () => {
		await expect(
			mudarEstagio(ctx.db, {
				personId: alguem,
				paraEstagioId: RUIM,
				porPersonId: lider.personId,
				teamId: ctx.teamId
			})
		).rejects.toBeInstanceOf(EstagioInvalido);
	});

	it('tipos de evento e respostas', async () => {
		await expect(
			atualizarTipo(ctx.db, lider, RUIM, tipoSchema.parse({ nome: 'Qualquer' }))
		).rejects.toBeInstanceOf(EventoRecusado);
		await expect(arquivarTipo(ctx.db, lider, RUIM, true)).rejects.toBeInstanceOf(EventoRecusado);
		await expect(arquivarResposta(ctx.db, lider, RUIM, true)).rejects.toBeInstanceOf(
			EventoRecusado
		);
	});

	it('evento e lista de presença', async () => {
		expect(await verEvento(ctx.db, lider, RUIM)).toBeNull();
		await expect(registrarLista(ctx.db, lider, RUIM, [])).rejects.toBeInstanceOf(EventoRecusado);
	});
});

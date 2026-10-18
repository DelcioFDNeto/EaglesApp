/**
 * A rota de edição de pessoa, com a ação de verdade (revisão de 17/10/2026).
 *
 * O serviço já recusava escrever nascimento e contato para quem não os vê —
 * mas a rota não tratava a recusa: virava página de erro com status 500, e o
 * log de erro de servidor ficava com um "bug" que era só uma recusa. O mesmo
 * para a pessoa removida enquanto o formulário estava aberto.
 *
 * O `db()` da aplicação é trocado pelo PGlite do teste; o resto é a rota.
 */

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { isHttpError, isRedirect } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import { criarBancoDeTeste, type BancoDeTeste } from './helpers/banco';
import { person } from '../../src/lib/server/db/schema';
import type { Actor } from '../../src/lib/server/policy/policy';

const estado = vi.hoisted(() => ({ banco: null as unknown }));
vi.mock('$server/db', () => ({ db: () => estado.banco }));

const { actions } = await import('../../src/routes/pessoas/[id=id]/editar/+page.server');

let ctx: BancoDeTeste;

/** Papel personalizado: edita pessoas, mas não vê dados sensíveis. */
let editorSemContato: Actor;

async function novaPessoa(nome: string): Promise<string> {
	const [p] = await ctx.db
		.insert(person)
		.values({ teamId: ctx.teamId, fullName: nome, birthDate: '1990-01-01', phone: '11999990000' })
		.returning({ id: person.id });
	return p!.id;
}

async function enviar(personId: string, campos: Record<string, string>) {
	const corpo = new FormData();
	for (const [k, v] of Object.entries(campos)) corpo.set(k, v);
	return actions.default!({
		request: new Request(`http://localhost/pessoas/${personId}/editar`, {
			method: 'POST',
			body: corpo
		}),
		locals: { actor: editorSemContato },
		params: { id: personId },
		getClientAddress: () => '127.0.0.1'
	} as never);
}

beforeAll(async () => {
	ctx = await criarBancoDeTeste();
	estado.banco = ctx.db;
	editorSemContato = {
		personId: await novaPessoa('Quem Edita Sem Ver'),
		teamId: ctx.teamId,
		assignments: [
			{
				roleKey: 'secretaria',
				scopeType: 'global',
				scopeId: null,
				permissions: new Set(['person.view', 'person.update'] as const)
			}
		]
	};
});

afterAll(async () => {
	await ctx?.fechar();
});

describe('editar pessoa — o que a rota responde', () => {
	it('salvar só o nome funciona, e o telefone continua lá', async () => {
		const id = await novaPessoa('Nome Antigo');
		await expect(enviar(id, { fullName: 'Nome Novo' })).rejects.toSatisfy(isRedirect);
		const [p] = await ctx.db.select().from(person).where(eq(person.id, id));
		expect(p).toMatchObject({ fullName: 'Nome Novo', phone: '11999990000' });
	});

	it('nascimento ou contato de quem não os vê: 403 na tela, não erro 500', async () => {
		const id = await novaPessoa('Alvo Da Edição');
		const r = await enviar(id, { fullName: 'Alvo Da Edição', phone: '11988887777' });
		expect(r).toMatchObject({ status: 403, data: { erro: expect.stringMatching(/contato/) } });

		const [p] = await ctx.db.select().from(person).where(eq(person.id, id));
		expect(p!.phone, 'nada foi gravado').toBe('11999990000');
	});

	it('pessoa removida com o formulário aberto: 404, não erro 500', async () => {
		const id = await novaPessoa('Removida No Meio');
		await ctx.db.update(person).set({ deletedAt: new Date() }).where(eq(person.id, id));
		const erro = await enviar(id, { fullName: 'Removida No Meio' }).catch((e: unknown) => e);
		expect(isHttpError(erro) && erro.status).toBe(404);
	});
});

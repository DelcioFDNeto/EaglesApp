import { describe, expect, it } from 'vitest';
import type { Actor, RoleAssignment } from '../../src/lib/server/policy/policy';
import type { ScopeType } from '../../src/lib/server/policy/permissions';
import { ROLE_SEEDS } from '../../src/lib/server/policy/roles';
import {
	alvosForaDoEscopo,
	foiConvidado,
	podeVerEvento,
	publicoPadrao,
	type Alvo
} from '../../src/lib/server/modules/eventos/regras';

/**
 * Regras puras dos eventos (D-M05-5, D-M05-7), com os papéis da semente.
 * A conferência contra o SQL da agenda está em `eventos.test.ts`.
 */

const AZUL = 'grupo-azul';
const VERDE = 'grupo-verde';

function atribuicao(
	roleKey: string,
	scopeType: ScopeType,
	scopeId: string | null = null
): RoleAssignment {
	const semente = ROLE_SEEDS.find((r) => r.key === roleKey)!;
	return { roleKey, scopeType, scopeId, permissions: new Set(semente.permissions) };
}

const ator = (personId: string, ...assignments: RoleAssignment[]): Actor => ({
	personId,
	teamId: 'eagles',
	assignments
});

const lider = ator('ana', atribuicao('lider', 'global'));
const conselheiroAzul = ator('pedro', atribuicao('conselheiro', 'group', AZUL));
const membro = ator('joao', atribuicao('membro', 'self'));
const semPapel = ator('ninguem');

describe('quem pode convidar quem (D-M05-5)', () => {
	const todos: Alvo[] = [
		{ tipo: 'equipe' },
		{ tipo: 'grupo', groupId: AZUL },
		{ tipo: 'grupo', groupId: VERDE },
		{ tipo: 'pessoa', personId: 'visitante' }
	];

	it('escopo global convida qualquer um', () => {
		expect(alvosForaDoEscopo(lider, todos)).toEqual([]);
	});

	it('escopo de grupo convida o próprio grupo e pessoas avulsas — e só', () => {
		expect(alvosForaDoEscopo(conselheiroAzul, todos)).toEqual([
			{ tipo: 'equipe' },
			{ tipo: 'grupo', groupId: VERDE }
		]);
	});

	it('público padrão: o grupo do evento, ou a equipe', () => {
		expect(publicoPadrao(AZUL)).toEqual([{ tipo: 'grupo', groupId: AZUL }]);
		expect(publicoPadrao(null)).toEqual([{ tipo: 'equipe' }]);
	});
});

describe('quem vê o quê (D-M05-7)', () => {
	const doAzul = { groupId: AZUL, publicado: true };
	const rascunhoDoAzul = { groupId: AZUL, publicado: false };
	const geral = { groupId: null, publicado: true };

	it('rascunho: só quem pode gerenciar', () => {
		expect(podeVerEvento(conselheiroAzul, rascunhoDoAzul, [], null)).toBe(true);
		expect(podeVerEvento(lider, rascunhoDoAzul, [], null)).toBe(true);
		expect(podeVerEvento(membro, rascunhoDoAzul, [{ tipo: 'equipe' }], AZUL)).toBe(false);
	});

	it('o conselheiro vê o evento do grupo mesmo sem ser convidado pessoalmente', () => {
		expect(podeVerEvento(conselheiroAzul, doAzul, [], null)).toBe(true);
	});

	it('o membro vê o que foi publicado para ele: equipe, o grupo dele, ele', () => {
		expect(podeVerEvento(membro, geral, [{ tipo: 'equipe' }], null)).toBe(true);
		expect(podeVerEvento(membro, doAzul, [{ tipo: 'grupo', groupId: AZUL }], AZUL)).toBe(true);
		expect(podeVerEvento(membro, doAzul, [{ tipo: 'grupo', groupId: AZUL }], VERDE)).toBe(false);
		expect(podeVerEvento(membro, geral, [{ tipo: 'pessoa', personId: 'joao' }], null)).toBe(true);
		expect(podeVerEvento(membro, geral, [{ tipo: 'pessoa', personId: 'outra' }], null)).toBe(false);
	});

	it('sem papel nenhum, nem o convite basta', () => {
		expect(podeVerEvento(semPapel, geral, [{ tipo: 'equipe' }], null)).toBe(false);
		expect(podeVerEvento(null, geral, [{ tipo: 'equipe' }], null)).toBe(false);
	});

	it('o grupo que o conselheiro acompanha conta como convite para ele', () => {
		expect(foiConvidado(conselheiroAzul, [{ tipo: 'grupo', groupId: AZUL }], null)).toBe(true);
		expect(foiConvidado(conselheiroAzul, [{ tipo: 'grupo', groupId: VERDE }], null)).toBe(false);
	});
});

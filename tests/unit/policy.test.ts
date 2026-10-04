/**
 * Testes da camada de autorização.
 *
 * Estes testes existem ANTES das telas por decisão explícita: a matriz
 * papel × permissão × escopo é onde um erro deixa de ser bug e vira vazamento.
 * Meta de cobertura deste arquivo: 100% (RNF-14).
 */

import { describe, expect, it } from 'vitest';
import {
	authorize,
	authorizeAnywhere,
	can,
	canAnywhere,
	canGlobally,
	groupsWhere,
	PolicyDenied,
	type Actor,
	type RoleAssignment
} from '../../src/lib/server/policy/policy';
import { ALL_PERMISSIONS, type Permission } from '../../src/lib/server/policy/permissions';
import { ROLE_SEEDS } from '../../src/lib/server/policy/roles';

const PG_AZUL = 'grupo-azul';
const PG_VERDE = 'grupo-verde';

function permsOf(roleKey: string): ReadonlySet<Permission> {
	const seed = ROLE_SEEDS.find((r) => r.key === roleKey);
	if (!seed) throw new Error(`papel inexistente na semente: ${roleKey}`);
	return new Set(seed.permissions);
}

function assignment(
	roleKey: string,
	scopeType: RoleAssignment['scopeType'],
	scopeId: string | null = null
): RoleAssignment {
	return { roleKey, scopeType, scopeId, permissions: permsOf(roleKey) };
}

function actor(personId: string, ...assignments: RoleAssignment[]): Actor {
	return { personId, teamId: 'eagles', assignments };
}

const lider = actor('p-lider', assignment('lider', 'global'));
const conselheiroAzul = actor('p-consAzul', assignment('conselheiro', 'group', PG_AZUL));
const conselheiroDuplo = actor(
	'p-consDuplo',
	assignment('conselheiro', 'group', PG_AZUL),
	assignment('conselheiro', 'group', PG_VERDE)
);
const membro = actor('p-membro', assignment('membro', 'self'));
const visitante = actor('p-visita', assignment('visitante', 'self'));

describe('negação por padrão', () => {
	it('nega tudo para quem não está autenticado', () => {
		for (const p of ALL_PERMISSIONS) {
			expect(can(null, p, { groupId: PG_AZUL, personId: 'qualquer' })).toBe(false);
		}
	});

	it('nega quando a pessoa não tem nenhum papel', () => {
		const semPapel = actor('p-orfa');
		for (const p of ALL_PERMISSIONS) {
			expect(can(semPapel, p)).toBe(false);
		}
	});

	it('nega permissão que o papel não possui, mesmo no escopo certo', () => {
		expect(can(conselheiroAzul, 'rbac.manage', { groupId: PG_AZUL })).toBe(false);
		expect(can(conselheiroAzul, 'finance.view_all', { groupId: PG_AZUL })).toBe(false);
		expect(can(conselheiroAzul, 'group.manage', { groupId: PG_AZUL })).toBe(false);
	});
});

describe('escopo global — líder', () => {
	it('autoriza em qualquer contexto', () => {
		expect(can(lider, 'person.view')).toBe(true);
		expect(can(lider, 'person.view', { groupId: PG_VERDE })).toBe(true);
		expect(can(lider, 'attendance.record', { groupId: PG_AZUL })).toBe(true);
		expect(can(lider, 'finance.view_all')).toBe(true);
	});

	it('canGlobally reconhece o líder e rejeita o conselheiro', () => {
		expect(canGlobally(lider, 'person.view')).toBe(true);
		expect(canGlobally(conselheiroAzul, 'person.view')).toBe(false);
	});

	it('não é superusuário: permissão fora da semente continua negada', () => {
		const liderLimitado: Actor = actor('p-x', {
			roleKey: 'lider',
			scopeType: 'global',
			scopeId: null,
			permissions: new Set<Permission>(['person.view'])
		});
		expect(can(liderLimitado, 'person.view')).toBe(true);
		expect(can(liderLimitado, 'finance.view_all')).toBe(false);
	});
});

describe('escopo de grupo — o teste que mais importa', () => {
	it('autoriza no próprio grupo', () => {
		expect(can(conselheiroAzul, 'attendance.record', { groupId: PG_AZUL })).toBe(true);
		expect(can(conselheiroAzul, 'person.view_sensitive', { groupId: PG_AZUL })).toBe(true);
	});

	it('NEGA no grupo de outro conselheiro', () => {
		expect(can(conselheiroAzul, 'attendance.record', { groupId: PG_VERDE })).toBe(false);
		expect(can(conselheiroAzul, 'person.view_sensitive', { groupId: PG_VERDE })).toBe(false);
		expect(can(conselheiroAzul, 'finance.create', { groupId: PG_VERDE })).toBe(false);
	});

	it('NEGA quando o contexto não diz de qual grupo se trata', () => {
		// Ambiguidade resolve-se negando: pedir "registrar presença" sem dizer
		// em qual grupo não pode virar "em todos".
		expect(can(conselheiroAzul, 'attendance.record')).toBe(false);
		expect(can(conselheiroAzul, 'attendance.record', { groupId: null })).toBe(false);
		expect(can(conselheiroAzul, 'attendance.record', { groupId: undefined })).toBe(false);
	});

	it('autoriza nos dois grupos de quem cuida de dois', () => {
		expect(can(conselheiroDuplo, 'attendance.record', { groupId: PG_AZUL })).toBe(true);
		expect(can(conselheiroDuplo, 'attendance.record', { groupId: PG_VERDE })).toBe(true);
		expect(can(conselheiroDuplo, 'attendance.record', { groupId: 'grupo-amarelo' })).toBe(false);
	});

	it('groupsWhere devolve exatamente os grupos autorizados', () => {
		expect(groupsWhere(conselheiroAzul, 'attendance.record')).toEqual([PG_AZUL]);
		expect(groupsWhere(conselheiroDuplo, 'attendance.record').sort()).toEqual(
			[PG_AZUL, PG_VERDE].sort()
		);
		expect(groupsWhere(conselheiroAzul, 'rbac.manage')).toEqual([]);
		expect(groupsWhere(lider, 'attendance.record')).toEqual([]); // global não é por grupo
		expect(groupsWhere(null, 'attendance.record')).toEqual([]);
	});

	it('ignora atribuição de grupo com scopeId nulo (dado corrompido)', () => {
		const quebrado = actor('p-q', assignment('conselheiro', 'group', null));
		expect(can(quebrado, 'attendance.record', { groupId: PG_AZUL })).toBe(false);
	});
});

describe('escopo self — membro', () => {
	it('autoriza sobre os próprios dados', () => {
		expect(can(membro, 'finance.view_own', { personId: 'p-membro' })).toBe(true);
		expect(can(membro, 'person.view', { personId: 'p-membro' })).toBe(true);
	});

	it('NEGA sobre os dados de outra pessoa', () => {
		expect(can(membro, 'finance.view_own', { personId: 'p-outro' })).toBe(false);
		expect(can(membro, 'person.view', { personId: 'p-outro' })).toBe(false);
	});

	it('NEGA sem contexto de pessoa', () => {
		expect(can(membro, 'finance.view_own')).toBe(false);
	});

	it('membro não escreve nada de ninguém', () => {
		expect(can(membro, 'person.update', { personId: 'p-membro' })).toBe(false);
		expect(can(membro, 'attendance.record', { personId: 'p-membro' })).toBe(false);
		expect(can(membro, 'event.manage', { personId: 'p-membro' })).toBe(false);
	});
});

describe('visitante — RN-24: zero acesso financeiro', () => {
	const financeiras: Permission[] = [
		'finance.view_own',
		'finance.view_group',
		'finance.view_all',
		'finance.create',
		'finance.approve',
		'finance.reverse'
	];

	it('nega toda permissão financeira em qualquer contexto', () => {
		for (const p of financeiras) {
			expect(can(visitante, p, { personId: 'p-visita' })).toBe(false);
			expect(can(visitante, p, { groupId: PG_AZUL })).toBe(false);
			expect(can(visitante, p)).toBe(false);
		}
	});

	it('vê apenas eventos', () => {
		expect(can(visitante, 'event.view', { personId: 'p-visita' })).toBe(true);
		expect(can(visitante, 'person.view', { personId: 'p-visita' })).toBe(false);
		expect(can(visitante, 'attendance.view', { personId: 'p-visita' })).toBe(false);
	});
});

describe('authorize', () => {
	it('não lança quando autorizado', () => {
		expect(() => authorize(lider, 'person.view')).not.toThrow();
	});

	it('lança PolicyDenied com permissão e contexto quando negado', () => {
		try {
			authorize(conselheiroAzul, 'attendance.record', { groupId: PG_VERDE });
			expect.unreachable('deveria ter lançado');
		} catch (e) {
			expect(e).toBeInstanceOf(PolicyDenied);
			const erro = e as PolicyDenied;
			expect(erro.permission).toBe('attendance.record');
			expect(erro.context.groupId).toBe(PG_VERDE);
		}
	});

	it('lança para ator nulo', () => {
		expect(() => authorize(null, 'person.view')).toThrow(PolicyDenied);
	});
});

describe('integridade da semente de papéis', () => {
	it('todo papel referencia apenas permissões existentes', () => {
		const validas = new Set<string>(ALL_PERMISSIONS);
		for (const role of ROLE_SEEDS) {
			for (const p of role.permissions) {
				expect(validas.has(p), `papel "${role.key}" referencia permissão inexistente "${p}"`).toBe(
					true
				);
			}
		}
	});

	it('os quatro papéis básicos existem e são de sistema', () => {
		for (const key of ['lider', 'conselheiro', 'membro', 'visitante']) {
			const r = ROLE_SEEDS.find((x) => x.key === key);
			expect(r, `papel "${key}" ausente`).toBeDefined();
			expect(r!.isSystem).toBe(true);
		}
	});

	it('nenhum papel repete permissão', () => {
		for (const role of ROLE_SEEDS) {
			expect(new Set(role.permissions).size, `papel "${role.key}" tem permissão duplicada`).toBe(
				role.permissions.length
			);
		}
	});

	it('a hierarquia de leitura se mantém: líder ⊇ conselheiro ⊇ membro', () => {
		const l = permsOf('lider');
		const c = permsOf('conselheiro');
		const m = permsOf('membro');
		for (const p of c) expect(l.has(p), `líder não tem "${p}" que o conselheiro tem`).toBe(true);
		for (const p of m) expect(c.has(p), `conselheiro não tem "${p}" que o membro tem`).toBe(true);
	});

	it('toda permissão do catálogo é usada por algum papel', () => {
		const usadas = new Set(ROLE_SEEDS.flatMap((r) => r.permissions));
		const orfas = ALL_PERMISSIONS.filter((p) => !usadas.has(p));
		expect(orfas, `permissões que nenhum papel concede: ${orfas.join(', ')}`).toEqual([]);
	});
});

describe('canAnywhere — detém a permissão em algum escopo?', () => {
	it('é falso para quem não está autenticado', () => {
		expect(canAnywhere(null, 'person.view')).toBe(false);
	});

	it('reconhece a permissão de um papel com escopo de grupo SEM pedir o grupo', () => {
		// É a razão de existir: a lista de pessoas e o painel inicial não
		// pertencem a grupo nenhum, e exigir groupId negaria uma ação legítima.
		expect(can(conselheiroAzul, 'person.view')).toBe(false);
		expect(canAnywhere(conselheiroAzul, 'person.view')).toBe(true);
	});

	it('continua negando o que nenhum papel da pessoa inclui', () => {
		expect(canAnywhere(conselheiroAzul, 'finance.view_all')).toBe(false);
		expect(canAnywhere(visitante, 'person.view')).toBe(false);
	});

	it('NÃO substitui a verificação sobre um registro concreto', () => {
		// "Pode editar alguém" e "pode editar ESTA pessoa" são perguntas
		// diferentes. canAnywhere responde só a primeira.
		expect(canAnywhere(conselheiroAzul, 'person.update')).toBe(true);
		expect(can(conselheiroAzul, 'person.update', { groupId: PG_VERDE })).toBe(false);
	});

	it('authorizeAnywhere lança PolicyDenied quando nega', () => {
		expect(() => authorizeAnywhere(visitante, 'person.view')).toThrow(PolicyDenied);
		expect(() => authorizeAnywhere(null, 'event.view')).toThrow(PolicyDenied);
		expect(() => authorizeAnywhere(conselheiroAzul, 'person.view')).not.toThrow();
	});
});

import { describe, expect, it } from 'vitest';
import {
	chaveDoNome,
	permissoesQueFaltam,
	statusDaRecusa
} from '../../src/lib/server/modules/rbac/regras';
import { destinoInterno } from '../../src/lib/shared/redirecionamento';
import type { Actor } from '../../src/lib/server/policy/policy';

describe('destino de retorno depois da senha — sem redirecionamento aberto', () => {
	it('aceita caminho interno, com busca', () => {
		expect(destinoInterno('/admin/papeis/novo')).toBe('/admin/papeis/novo');
		expect(destinoInterno('/pessoas?busca=ana')).toBe('/pessoas?busca=ana');
	});

	it.each([
		['esquema explícito', 'https://golpe.example/entrar'],
		['javascript:', 'javascript:alert(1)'],
		['protocolo relativo', '//golpe.example'],
		['barra invertida', '/\\golpe.example'],
		['barra invertida no meio', '/a\\b'],
		['quebra de linha', '/inicio\nSet-Cookie: x=y'],
		['tabulação', '/\tgolpe.example'],
		['relativo sem barra', 'admin/papeis'],
		['vazio', ''],
		['nulo', null]
	])('recusa %s', (_caso, valor) => {
		expect(destinoInterno(valor)).toBe('/inicio');
	});
});

describe('teto do que se pode conceder', () => {
	const ator: Actor = {
		personId: 'p',
		teamId: 'eagles',
		assignments: [
			{
				roleKey: 'secretaria',
				scopeType: 'global',
				scopeId: null,
				permissions: new Set(['rbac.manage', 'person.view'])
			},
			{
				roleKey: 'conselheiro',
				scopeType: 'group',
				scopeId: 'pg-azul',
				permissions: new Set(['person.view_sensitive', 'event.manage'])
			}
		]
	};

	it('o que o ator tem globalmente pode ser concedido', () => {
		expect(permissoesQueFaltam(ator, ['person.view', 'rbac.manage'])).toEqual([]);
	});

	it('o que ele tem só NUM GRUPO não pode — não se distribui para a equipe um poder de PG', () => {
		expect(permissoesQueFaltam(ator, ['person.view_sensitive', 'event.manage'])).toEqual([
			'event.manage',
			'person.view_sensitive'
		]);
	});

	it('aponta só o que falta, sem repetir', () => {
		expect(permissoesQueFaltam(ator, ['audit.view', 'audit.view', 'person.view'])).toEqual([
			'audit.view'
		]);
	});
});

describe('chave técnica de papel personalizado', () => {
	it('sem acento, minúscula, com sublinhado', () => {
		expect(chaveDoNome('Apoio à Recepção')).toBe('apoio_a_recepcao');
		expect(chaveDoNome('  Secretaria / Tesouraria ')).toBe('secretaria_tesouraria');
	});

	it('nunca fica vazia', () => {
		expect(chaveDoNome('!!!')).toBe('papel');
	});
});

describe('código HTTP das recusas', () => {
	it('separa falta de poder, conflito e não encontrado', () => {
		expect(statusDaRecusa('escalada')).toBe(403);
		expect(statusDaRecusa('reautenticacao')).toBe(403);
		expect(statusDaRecusa('ultimo_administrador')).toBe(409);
		expect(statusDaRecusa('papel_com_pessoas')).toBe(409);
		expect(statusDaRecusa('nao_encontrado')).toBe(404);
		expect(statusDaRecusa('sem_papel')).toBe(400);
	});
});

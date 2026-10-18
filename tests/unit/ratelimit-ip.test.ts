import { describe, expect, it } from 'vitest';
import { chaveDeIp } from '../../src/lib/server/auth/ratelimit';

/**
 * A chave por IP dos limites (revisão de 17/10/2026).
 *
 * Com IPv6, cada cliente recebe um /64 inteiro — 2^64 endereços. Contando por
 * endereço, quem quisesse fugir do limite de login por IP trocaria de endereço
 * a cada tentativa.
 */
describe('chave de limite por IP', () => {
	it('IPv4 é o próprio endereço', () => {
		expect(chaveDeIp('203.0.113.7')).toBe('203.0.113.7');
	});

	it('IPv4 mapeado em IPv6 é o mesmo IPv4', () => {
		expect(chaveDeIp('::ffff:203.0.113.7')).toBe('203.0.113.7');
		expect(chaveDeIp('::FFFF:203.0.113.7')).toBe('203.0.113.7');
	});

	it('endereços do mesmo /64 são uma chave só', () => {
		const a = chaveDeIp('2804:14c:5b80:8a11:1c2d:3e4f:5a6b:7c8d');
		const b = chaveDeIp('2804:14c:5b80:8a11::1');
		expect(a).toBe('2804:14c:5b80:8a11::/64');
		expect(b).toBe(a);
	});

	it('/64 diferentes são chaves diferentes', () => {
		expect(chaveDeIp('2804:14c:5b80:8a12::1')).not.toBe(chaveDeIp('2804:14c:5b80:8a11::1'));
	});

	it('a mesma rede escrita de formas diferentes é a mesma chave', () => {
		const formas = [
			'2001:0db8:0000:0042:0000:8a2e:0370:7334',
			'2001:db8:0:42::8a2e:370:7334',
			'2001:DB8:0:42:0:8A2E:370:7334',
			'2001:db8:0:42::',
			'2001:db8:0:42::1%eth0'
		];
		expect(new Set(formas.map(chaveDeIp))).toEqual(new Set(['2001:db8:0:42::/64']));
	});

	it('o "::" no começo ou no meio do prefixo vira zeros', () => {
		expect(chaveDeIp('::1')).toBe('0:0:0:0::/64');
		expect(chaveDeIp('2001:db8::7')).toBe('2001:db8:0:0::/64');
	});
});

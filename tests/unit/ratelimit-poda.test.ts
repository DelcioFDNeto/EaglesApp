import { afterEach, describe, expect, it, vi } from 'vitest';
import { checkRateLimit, contarBaldes, resetRateLimits } from '../../src/lib/server/auth/ratelimit';

/**
 * O limite de tentativas vive em memória, e as chaves são escolhidas por quem
 * tenta entrar ("login:conta:<qualquer coisa>"). Sem poda, cada identificador
 * inventado ficaria no mapa até o processo reiniciar (varredura de 11/10/2026).
 */

const REGRA = { limit: 5, windowSeconds: 60, blockSeconds: 60 };

afterEach(() => {
	vi.useRealTimers();
	resetRateLimits();
});

describe('poda do limite de tentativas', () => {
	it('baldes ociosos há mais de uma hora somem na consulta seguinte', () => {
		vi.useFakeTimers({ now: new Date('2026-10-11T12:00:00Z') });
		resetRateLimits();
		for (let i = 0; i < 50; i++) checkRateLimit(`login:conta:bruto:inventado${i}`, REGRA);
		expect(contarBaldes()).toBe(50);

		vi.setSystemTime(new Date('2026-10-11T14:00:00Z'));
		checkRateLimit('login:ip:203.0.113.7', REGRA);
		expect(contarBaldes(), 'só o balde novo sobrevive').toBe(1);
	});

	it('quem está bloqueado continua bloqueado — a poda não perdoa', () => {
		vi.useFakeTimers({ now: new Date('2026-10-11T12:00:00Z') });
		resetRateLimits();
		const longo = { limit: 1, windowSeconds: 60, blockSeconds: 3 * 60 * 60 };
		checkRateLimit('login:conta:email:alvo@eagles.test', longo);
		expect(checkRateLimit('login:conta:email:alvo@eagles.test', longo).allowed).toBe(false);

		vi.setSystemTime(new Date('2026-10-11T13:30:00Z'));
		checkRateLimit('outra:chave', REGRA);
		expect(checkRateLimit('login:conta:email:alvo@eagles.test', longo).allowed).toBe(false);
	});
});

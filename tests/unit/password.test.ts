import { describe, expect, it } from 'vitest';
import {
	hashPassword,
	needsRehash,
	validatePassword,
	verifyPassword
} from '../../src/lib/server/auth/password';
import { generateToken, hashToken, tokensMatch } from '../../src/lib/server/auth/token';
import { uuidv7 } from '../../src/lib/server/db/id';

describe('hash de senha', () => {
	it('gera hash no formato PHC com os parâmetros da OWASP', async () => {
		const hash = await hashPassword('uma senha bem comprida');
		expect(hash).toMatch(/^\$argon2id\$v=19\$m=19456,t=2,p=1\$[\w+/]+\$[\w+/]+$/);
	});

	it('gera hashes diferentes para a mesma senha (sal aleatório)', async () => {
		const a = await hashPassword('mesma senha aqui');
		const b = await hashPassword('mesma senha aqui');
		expect(a).not.toBe(b);
	});

	it('confere a senha correta', async () => {
		const hash = await hashPassword('minha frase secreta');
		expect(await verifyPassword(hash, 'minha frase secreta')).toBe(true);
	});

	it('recusa a senha errada', async () => {
		const hash = await hashPassword('minha frase secreta');
		expect(await verifyPassword(hash, 'minha frase secretA')).toBe(false);
		expect(await verifyPassword(hash, '')).toBe(false);
	});

	it('recusa hash nulo ou malformado sem explodir', async () => {
		expect(await verifyPassword(null, 'x')).toBe(false);
		expect(await verifyPassword('', 'x')).toBe(false);
		expect(await verifyPassword('não é um hash', 'x')).toBe(false);
		expect(await verifyPassword('$argon2i$v=19$m=1,t=1,p=1$aaa$bbb', 'x')).toBe(false);
	});

	it('normaliza unicode: mesma senha digitada em formas diferentes confere', async () => {
		// "José" com É composto (e + acento) vs. É precomposto.
		const composta = 'José senha longa';
		const precomposta = 'José senha longa';
		const hash = await hashPassword(composta);
		expect(await verifyPassword(hash, precomposta)).toBe(true);
	});

	it('detecta hash com parâmetros defasados', () => {
		expect(needsRehash('$argon2id$v=19$m=4096,t=1,p=1$a$b')).toBe(true);
		expect(needsRehash('$argon2id$v=19$m=19456,t=2,p=1$a$b')).toBe(false);
		expect(needsRehash('lixo')).toBe(true);
	});
});

describe('política de senha', () => {
	it('recusa senha curta', () => {
		expect(validatePassword('curta')).toBe('curta');
		expect(validatePassword('123456789')).toBe('curta'); // 9 caracteres
	});

	it('aceita senha longa', () => {
		expect(validatePassword('uma frase que eu lembro')).toBeNull();
	});

	it('recusa senha da lista de comuns', () => {
		expect(validatePassword('senha123456')).toBe('comum');
		expect(validatePassword('EAGLES2026')).toBe('comum');
	});

	it('recusa senha que contém o primeiro nome', () => {
		expect(validatePassword('marina123456', 'Marina Souza')).toBe('contem_nome');
		expect(validatePassword('MARINAgostosa1', 'marina souza')).toBe('contem_nome');
	});

	it('não confunde nome curto com coincidência', () => {
		// "Ana" tem 3 letras: curto demais para virar regra sem falso positivo.
		expect(validatePassword('ananas e bananas', 'Ana Clara')).toBeNull();
	});
});

describe('tokens de sessão e convite', () => {
	it('gera token base64url sem preenchimento, seguro em URL', () => {
		const t = generateToken();
		expect(t).toMatch(/^[A-Za-z0-9_-]+$/);
		expect(t.length).toBeGreaterThanOrEqual(43);
	});

	it('gera tokens distintos', () => {
		const tokens = new Set(Array.from({ length: 500 }, generateToken));
		expect(tokens.size).toBe(500);
	});

	it('hash é estável e distinto por token', () => {
		const a = generateToken();
		const b = generateToken();
		expect(hashToken(a)).toBe(hashToken(a));
		expect(hashToken(a)).not.toBe(hashToken(b));
		expect(hashToken(a)).toMatch(/^[0-9a-f]{64}$/);
	});

	it('compara hashes corretamente', () => {
		const a = hashToken('x');
		expect(tokensMatch(a, hashToken('x'))).toBe(true);
		expect(tokensMatch(a, hashToken('y'))).toBe(false);
		expect(tokensMatch('', '')).toBe(false);
	});
});

describe('uuid v7', () => {
	it('tem o formato e a versão corretos', () => {
		const id = uuidv7();
		expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
	});

	it('é ordenável no tempo — a razão de existir', async () => {
		const primeiro = uuidv7();
		await new Promise((r) => setTimeout(r, 3));
		const segundo = uuidv7();
		expect(primeiro < segundo).toBe(true);
	});

	it('não colide', () => {
		const ids = new Set(Array.from({ length: 5000 }, uuidv7));
		expect(ids.size).toBe(5000);
	});
});

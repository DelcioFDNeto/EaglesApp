import { describe, expect, it } from 'vitest';
import {
	formatarTelefone,
	linkWhatsApp,
	normalizarTelefone,
	telefoneValido
} from '../../src/lib/shared/telefone';

describe('telefone (login e WhatsApp)', () => {
	it('qualquer forma de digitar vira a mesma chave de login', () => {
		const formas = ['+55 (91) 98888-1111', '55 91 98888 1111', '(91) 98888-1111', '91988881111'];
		for (const f of formas) expect(normalizarTelefone(f), f).toBe('91988881111');
	});

	it('não corta o 55 de um número que só começa com 55 (DDD 55, RS)', () => {
		expect(normalizarTelefone('(55) 99999-0001')).toBe('55999990001');
	});

	it('aceita fixo e celular com DDD; recusa curto, longo e DDD inválido', () => {
		expect(telefoneValido('(91) 3222-1111')).toBe(true);
		expect(telefoneValido('(91) 98888-1111')).toBe(true);
		expect(telefoneValido('98888-1111')).toBe(false);
		expect(telefoneValido('123')).toBe(false);
		expect(telefoneValido('(01) 98888-1111')).toBe(false);
		expect(telefoneValido('9198888111122')).toBe(false);
	});

	it('monta o link do WhatsApp com o 55 e a mensagem codificada', () => {
		expect(linkWhatsApp('Oi & tchau', '(91) 98888-1111')).toBe(
			'https://wa.me/5591988881111?text=Oi%20%26%20tchau'
		);
		expect(linkWhatsApp('Oi')).toBe('https://wa.me/?text=Oi');
	});

	it('formata para exibir', () => {
		expect(formatarTelefone('91988881111')).toBe('(91) 98888-1111');
		expect(formatarTelefone('9132221111')).toBe('(91) 3222-1111');
	});
});

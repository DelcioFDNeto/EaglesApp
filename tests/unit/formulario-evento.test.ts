import { describe, expect, it } from 'vitest';
import {
	OPCOES_PADRAO,
	deInputLocal,
	gerarChave,
	paraApi,
	paraInputLocal,
	validar,
	type DadosFormulario
} from '../../src/lib/eventos/formulario';

const base = (extra: Partial<DadosFormulario> = {}): DadosFormulario => ({
	title: 'PG de quinta',
	eventTypeId: 'tipo-1',
	groupId: 'pg-a',
	inicio: '2026-12-03T19:30',
	fim: '2026-12-03T21:30',
	location: '',
	responsiblePersonId: '',
	description: '',
	rsvpEnabled: true,
	rsvpOptions: [...OPCOES_PADRAO],
	...extra
});

describe('formulário de evento', () => {
	it('datetime-local ida e volta preserva o instante', () => {
		const iso = deInputLocal('2026-12-03T19:30');
		expect(iso).not.toBeNull();
		expect(paraInputLocal(iso)).toBe('2026-12-03T19:30');
		expect(deInputLocal('')).toBeNull();
		expect(deInputLocal('lixo')).toBeNull();
		expect(paraInputLocal(null)).toBe('');
	});

	it('gera chave sem acento e sem colidir com as existentes', () => {
		expect(gerarChave('Vou de carona!', [])).toBe('vou_de_carona');
		expect(gerarChave('Não vou', ['nao_vou'])).toBe('nao_vou_2');
		expect(gerarChave('Não vou', ['nao_vou', 'nao_vou_2'])).toBe('nao_vou_3');
		expect(gerarChave('🎉', [])).toBe('opcao');
		expect(gerarChave('x'.repeat(80), []).length).toBeLessThanOrEqual(50);
	});

	it('aceita um evento completo', () => {
		expect(validar(base(), { podeSemGrupo: false })).toEqual({});
	});

	it('exige nome, tipo, início e — para conselheiro — o PG', () => {
		const erros = validar(base({ title: '  ', eventTypeId: '', inicio: '', groupId: '' }), {
			podeSemGrupo: false
		});
		expect(Object.keys(erros).sort()).toEqual(['eventTypeId', 'groupId', 'inicio', 'title']);
		expect(validar(base({ groupId: '' }), { podeSemGrupo: true }).groupId).toBeUndefined();
	});

	it('término antes do início usa a mesma mensagem do servidor', () => {
		expect(validar(base({ fim: '2026-12-03T18:00' }), { podeSemGrupo: true }).fim).toBe(
			'O término do evento deve ser posterior ao início.'
		);
	});

	it('opções de resposta: ao menos uma, sem texto vazio e sem repetir', () => {
		const ctx = { podeSemGrupo: true };
		expect(validar(base({ rsvpOptions: [] }), ctx).rsvpOptions).toBeDefined();
		expect(
			validar(base({ rsvpOptions: [{ key: 'a', label: ' ' }] }), ctx).rsvpOptions
		).toBeDefined();
		expect(
			validar(
				base({
					rsvpOptions: [
						{ key: 'a', label: 'Vou' },
						{ key: 'b', label: 'vou' }
					]
				}),
				ctx
			).rsvpOptions
		).toBeDefined();
		// Sem pedir confirmação, as opções não importam.
		expect(validar(base({ rsvpEnabled: false, rsvpOptions: [] }), ctx)).toEqual({});
	});

	it('ao criar omite o que está vazio; ao editar manda null para apagar', () => {
		const criar = paraApi(base(), 'criar');
		expect(criar.location).toBeUndefined();
		expect(criar.responsiblePersonId).toBeUndefined();

		const editar = paraApi(base({ groupId: '', fim: '' }), 'editar');
		expect(editar.location).toBeNull();
		expect(editar.groupId).toBeNull();
		expect(editar.endsAt).toBeNull();
		expect(editar.startsAt).toBe(deInputLocal('2026-12-03T19:30'));
	});
});

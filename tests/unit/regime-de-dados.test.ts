import { describe, expect, it } from 'vitest';
import { regimeDe } from '../../src/lib/server/modules/pessoas/regime';

/**
 * Regime de tratamento de dados (ADR 0003).
 *
 * A regra mais importante do M02, e a que mais custa se estiver errada: ela
 * decide se o telefone de um adolescente pode ser guardado. Os testes cobrem
 * principalmente os casos em que o sistema deve dizer NÃO.
 */

const MAIOR = { ehMenor: false };
const MENOR = { ehMenor: true };
const DESCONHECIDO = { ehMenor: null };

describe('regime de dados — maior de idade', () => {
	it('pode guardar contato sem consentimento registrado', () => {
		const r = regimeDe(MAIOR);
		expect(r.restrito).toBe(false);
		expect(r.podeGuardarContato).toBe(true);
		expect(r.podeGuardarObservacoes).toBe(true);
	});

	it('NÃO pode guardar foto sem consentimento — privacidade de imagem independe da idade', () => {
		expect(regimeDe(MAIOR).podeGuardarFoto).toBe(false);
		expect(regimeDe(MAIOR, { foto: true }).podeGuardarFoto).toBe(true);
	});

	it('respeita a revogação de compartilhamento externo', () => {
		expect(regimeDe(MAIOR).podeCompartilharExternamente).toBe(true);
		expect(regimeDe(MAIOR, { compartilhamento_externo: false }).podeCompartilharExternamente).toBe(
			false
		);
	});

	it('respeita a revogação de uso em IA', () => {
		expect(regimeDe(MAIOR, { uso_ia: false }).podeUsarEmIa).toBe(false);
	});
});

describe('regime de dados — menor de idade (RN-30 a RN-33)', () => {
	it('sem responsável e sem consentimento, fica em cadastro mínimo', () => {
		const r = regimeDe(MENOR);
		expect(r.restrito).toBe(true);
		expect(r.podeGuardarContato).toBe(false);
		expect(r.podeGuardarObservacoes).toBe(false);
		expect(r.podeGuardarFoto).toBe(false);
		expect(r.motivo).toBeTruthy();
	});

	it('consentimento SEM responsável vinculado não basta', () => {
		const r = regimeDe(MENOR, { dados_cadastrais: true }, { temResponsavelVinculado: false });
		expect(r.restrito).toBe(true);
	});

	it('responsável vinculado SEM consentimento não basta', () => {
		const r = regimeDe(MENOR, {}, { temResponsavelVinculado: true });
		expect(r.restrito).toBe(true);
	});

	it('com responsável E consentimento, sai do regime restrito', () => {
		const r = regimeDe(MENOR, { dados_cadastrais: true }, { temResponsavelVinculado: true });
		expect(r.restrito).toBe(false);
		expect(r.podeGuardarContato).toBe(true);
	});

	it('RN-31 — foto exige consentimento próprio, além de sair do restrito', () => {
		const semFoto = regimeDe(MENOR, { dados_cadastrais: true }, { temResponsavelVinculado: true });
		expect(semFoto.podeGuardarFoto).toBe(false);

		const comFoto = regimeDe(
			MENOR,
			{ dados_cadastrais: true, foto: true },
			{ temResponsavelVinculado: true }
		);
		expect(comFoto.podeGuardarFoto).toBe(true);
	});

	it('RN-33 — NUNCA compartilha externamente, nem com consentimento explícito', () => {
		const r = regimeDe(
			MENOR,
			{ dados_cadastrais: true, compartilhamento_externo: true },
			{ temResponsavelVinculado: true }
		);
		expect(r.podeCompartilharExternamente).toBe(false);
	});

	it('IA exige consentimento explícito, e não apenas ausência de recusa', () => {
		const semDizer = regimeDe(MENOR, { dados_cadastrais: true }, { temResponsavelVinculado: true });
		expect(semDizer.podeUsarEmIa).toBe(false);
	});
});

describe('regime de dados — idade desconhecida', () => {
	/**
	 * O caso que mais importa acertar. Data de nascimento vazia é o estado
	 * NORMAL de um cadastro progressivo recém-criado. Se `null` caísse no ramo
	 * de maior de idade, todo visitante novo entraria sem proteção nenhuma.
	 */
	it('é tratada como MENOR, nunca como maior', () => {
		const r = regimeDe(DESCONHECIDO);
		expect(r.restrito).toBe(true);
		expect(r.podeGuardarContato).toBe(false);
	});

	it('explica na mensagem que falta a data de nascimento', () => {
		expect(regimeDe(DESCONHECIDO).motivo).toMatch(/nascimento/i);
	});

	it('nem com consentimento vira maior de idade sozinha', () => {
		const r = regimeDe(
			DESCONHECIDO,
			{ dados_cadastrais: true },
			{ temResponsavelVinculado: false }
		);
		expect(r.restrito).toBe(true);
	});
});

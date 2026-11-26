import { describe, expect, it } from 'vitest';
import {
	estaNaJanelaDeSilencio,
	formatarEscalaParaWhatsapp,
	gerarLinkWhatsapp,
	podeNotificarAgora,
	renderizarModelo
} from '../../src/lib/server/comunicacao/mensagens';

describe('M08 — Comunicação: modelos, WhatsApp e ciclo de vida F6', () => {
	it('renderiza variáveis e remove chaves ausentes sem sujeira', () => {
		const texto = renderizarModelo(
			'*{{evento}}*\nData: {{data}}\nLocal: {{local}}\n\n{{escala}}\n{{inexistente}}',
			{
				evento: 'PG Azul',
				data: 'qui., 26/11 20:00',
				local: 'Casa da Ana',
				escala: '*Escala:*\n• Mensagem: Lucas'
			}
		);

		expect(texto).toContain('*PG Azul*');
		expect(texto).toContain('Casa da Ana');
		expect(texto).toContain('• Mensagem: Lucas');
		expect(texto).not.toContain('{{');
	});

	it('formata escala para WhatsApp omitindo itens trocados e gera link wa.me', () => {
		const bloco = formatarEscalaParaWhatsapp([
			{ responsabilidadeNome: 'Mensagem', pessoaNome: 'Ana', status: 'confirmada' },
			{ responsabilidadeNome: 'Música', pessoaNome: 'Pedro', status: 'trocada' },
			{ responsabilidadeNome: 'Música', pessoaNome: 'Maria', status: 'confirmada' }
		]);

		expect(bloco).toContain('Ana');
		expect(bloco).toContain('Maria');
		expect(bloco).not.toContain('Pedro');

		const url = gerarLinkWhatsapp(bloco);
		expect(url.startsWith('https://wa.me/?text=')).toBe(true);
	});

	it('avalia corretamente janela de silêncio noturna (22h–7h) e diurna', () => {
		expect(estaNaJanelaDeSilencio(23, 22, 7)).toBe(true);
		expect(estaNaJanelaDeSilencio(3, 22, 7)).toBe(true);
		expect(estaNaJanelaDeSilencio(7, 22, 7)).toBe(false);
		expect(estaNaJanelaDeSilencio(14, 22, 7)).toBe(false);

		expect(estaNaJanelaDeSilencio(14, 13, 15)).toBe(true);
		expect(estaNaJanelaDeSilencio(16, 13, 15)).toBe(false);
	});

	it('aplica as 4 barreiras do fluxo F6 (flag, preferência, silêncio e agrupamento 12h)', () => {
		const base = {
			flagNotificacoesAtiva: true,
			usuarioAceitaTipo: true,
			horaLocal: 15,
			quietStartHour: 22,
			quietEndHour: 7,
			ultimaNotificacaoSimilarMs: null as number | null,
			agoraMs: 1_700_000_000_000
		};

		expect(podeNotificarAgora(base).permitido).toBe(true);
		expect(podeNotificarAgora({ ...base, flagNotificacoesAtiva: false })).toEqual({
			permitido: false,
			motivo: 'feature_flag_desligada'
		});
		expect(podeNotificarAgora({ ...base, usuarioAceitaTipo: false })).toEqual({
			permitido: false,
			motivo: 'preferencia_usuario'
		});
		expect(podeNotificarAgora({ ...base, horaLocal: 23 })).toEqual({
			permitido: false,
			motivo: 'janela_silencio'
		});
		expect(
			podeNotificarAgora({
				...base,
				ultimaNotificacaoSimilarMs: base.agoraMs - 2 * 60 * 60 * 1000
			})
		).toEqual({
			permitido: false,
			motivo: 'agrupar_12h'
		});
	});
});

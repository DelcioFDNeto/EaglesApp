/**
 * Serviço puro de comunicação do Eagles App (M08 — RF-09.1, RF-09.3, F6, RN-33).
 *
 * Regras centrais:
 *   - Variáveis suportadas nos modelos: {{evento}}, {{data}}, {{local}}, {{grupo}},
 *     {{escala}}, {{titulo}}, {{mensagem}}, {{link}}.
 *   - RN-33: textos prontos para WhatsApp NUNCA incluem telefone, e-mail ou foto
 *     (proteção especial para menores e privacidade de grupo externo).
 *   - F6: janela de silêncio (padrão 22h–7h) e limite anti-excesso de notificações.
 */

export type VariaveisMensagem = {
	evento?: string | null;
	data?: string | null;
	local?: string | null;
	grupo?: string | null;
	escala?: string | null;
	titulo?: string | null;
	mensagem?: string | null;
	link?: string | null;
};

export const VARIAVEIS_SUPORTADAS = [
	{ chave: 'evento', descricao: 'Nome do encontro' },
	{ chave: 'data', descricao: 'Data e horário formatados' },
	{ chave: 'local', descricao: 'Local do encontro' },
	{ chave: 'grupo', descricao: 'Nome do grupo (PG)' },
	{ chave: 'escala', descricao: 'Lista de responsabilidades e nomes' },
	{ chave: 'titulo', descricao: 'Título do aviso' },
	{ chave: 'mensagem', descricao: 'Texto principal do aviso' },
	{ chave: 'link', descricao: 'Link para confirmar presença' }
] as const;

export const MODELOS_PADRAO = [
	{
		name: 'Convite de encontro',
		category: 'evento' as const,
		content:
			'*{{evento}}*\nData: {{data}}\nLocal: {{local}}\n\n{{escala}}\nConfirme sua presença: {{link}}'
	},
	{
		name: 'Escala da semana',
		category: 'escala' as const,
		content: '*Escala — {{evento}}*\nData: {{data}}\n\n{{escala}}'
	},
	{
		name: 'Lembrete de RSVP',
		category: 'lembrete' as const,
		content:
			'Oi, pessoal! Nosso encontro *{{evento}}* será em {{data}} ({{local}}).\nConfirme sua presença em um toque: {{link}}'
	}
];

/**
 * Renderiza um modelo substituindo `{{chave}}` pelos valores informados.
 * Variáveis ausentes são limpas sem deixar `{{...}}` quebrado para o usuário.
 */
export function renderizarModelo(template: string, variaveis: VariaveisMensagem): string {
	const mapa: Record<string, string> = {
		evento: variaveis.evento?.trim() ?? '',
		data: variaveis.data?.trim() ?? '',
		local: variaveis.local?.trim() ?? '',
		grupo: variaveis.grupo?.trim() ?? '',
		escala: variaveis.escala?.trim() ?? '',
		titulo: variaveis.titulo?.trim() ?? '',
		mensagem: variaveis.mensagem?.trim() ?? '',
		link: variaveis.link?.trim() ?? ''
	};

	return template
		.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_match, chave: string) => {
			return mapa[chave.toLowerCase()] ?? '';
		})
		.replace(/\n{3,}/g, '\n\n')
		.trim();
}

/**
 * Formata a lista de escala apenas com responsabilidade e primeiro/nome completo,
 * nunca expondo telefone, e-mail ou foto (RN-33).
 */
export function formatarEscalaParaWhatsapp(
	itens: Array<{ responsabilidadeNome: string; pessoaNome: string; status?: string }>
): string {
	const ativos = itens.filter((i) => i.status !== 'trocada');
	if (ativos.length === 0) return '';
	return `*Escala:*\n${ativos.map((i) => `• ${i.responsabilidadeNome}: ${i.pessoaNome}`).join('\n')}`;
}

/**
 * Monta link `wa.me` pronto para compartilhamento (RF-09.1).
 */
export function gerarLinkWhatsapp(texto: string): string {
	return `https://wa.me/?text=${encodeURIComponent(texto.trim())}`;
}

/**
 * Avalia se uma hora local (0–23) cai dentro da janela de silêncio do usuário (F6).
 * Suporta intervalos que atravessam a meia-noite (ex.: 22h → 7h) e diurnos (ex.: 13h → 15h).
 */
export function estaNaJanelaDeSilencio(
	horaAtual: number,
	quietStartHour: number,
	quietEndHour: number
): boolean {
	if (quietStartHour === quietEndHour) return false;
	if (quietStartHour < quietEndHour) {
		return horaAtual >= quietStartHour && horaAtual < quietEndHour;
	}
	return horaAtual >= quietStartHour || horaAtual < quietEndHour;
}

/**
 * Avalia o ciclo de vida F6 antes de disparar uma notificação.
 */
export function podeNotificarAgora(params: {
	flagNotificacoesAtiva: boolean;
	usuarioAceitaTipo: boolean;
	horaLocal: number;
	quietStartHour: number;
	quietEndHour: number;
	ultimaNotificacaoSimilarMs?: number | null;
	agoraMs?: number;
}): { permitido: boolean; motivo?: string } {
	if (!params.flagNotificacoesAtiva) {
		return { permitido: false, motivo: 'feature_flag_desligada' };
	}
	if (!params.usuarioAceitaTipo) {
		return { permitido: false, motivo: 'preferencia_usuario' };
	}
	if (estaNaJanelaDeSilencio(params.horaLocal, params.quietStartHour, params.quietEndHour)) {
		return { permitido: false, motivo: 'janela_silencio' };
	}
	const agora = params.agoraMs ?? Date.now();
	if (
		params.ultimaNotificacaoSimilarMs != null &&
		agora - params.ultimaNotificacaoSimilarMs < 12 * 60 * 60 * 1000
	) {
		return { permitido: false, motivo: 'agrupar_12h' };
	}
	return { permitido: true };
}

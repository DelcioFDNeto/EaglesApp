import { env } from '$server/env';
import { dataCurtaComDia, horaCurta, terminaEmOutroDia } from '$shared/fuso';

/**
 * Compartilhar no WhatsApp (seção 18): texto pronto + link público.
 *
 * Deep link `wa.me` — custo zero, sem API paga, sem risco de banimento. Quem
 * compartilha escolhe o grupo de WhatsApp e toca em enviar.
 *
 * O texto não carrega NENHUM dado de pessoa — nem quem organiza, nem quem
 * vai (RN-33): o destino é um grupo cujo conteúdo não controlamos.
 */

export function linkPublico(codigo: string): string {
	return `${env().PUBLIC_ORIGIN}/e/${codigo}`;
}

export function textoDoEvento(
	evento: {
		titulo: string;
		data: string;
		hora: string;
		dataFim?: string | null;
		local: string | null;
		cancelado: boolean;
	},
	link: string
): string {
	const quando =
		`${dataCurtaComDia(evento.data)} às ${horaCurta(evento.hora)}` +
		(terminaEmOutroDia(evento) ? ` até ${dataCurtaComDia(evento.dataFim!)}` : '');
	const linhas = [
		evento.cancelado ? `*CANCELADO — ${evento.titulo}*` : `*${evento.titulo}*`,
		quando,
		...(evento.local ? [`📍 ${evento.local}`] : []),
		'',
		evento.cancelado ? `Detalhes: ${link}` : `Mais informações: ${link}`
	];
	return linhas.join('\n');
}

export function linkDoWhatsapp(texto: string): string {
	return `https://wa.me/?text=${encodeURIComponent(texto)}`;
}

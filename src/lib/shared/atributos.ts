/**
 * Regras compartilhadas de Perfil de Atributos e Draft (cliente e servidor).
 *
 * Os 4 eixos usam escala inteira de 0 a 10 (opcionais até avaliação).
 * Os dados complementares são todos opcionais e não invasivos.
 */

export const ATRIBUTOS = [
	{
		chave: 'fisico',
		rotulo: 'Físico',
		sigla: 'FIS',
		descricao: 'Resistência, velocidade, força e disposição física.'
	},
	{
		chave: 'biblico',
		rotulo: 'Bíblico',
		sigla: 'BIB',
		descricao: 'Conhecimento bíblico, memória de versículos e contexto.'
	},
	{
		chave: 'mental',
		rotulo: 'Mental',
		sigla: 'MEN',
		descricao: 'Raciocínio rápido, estratégia, foco e calma sob pressão.'
	},
	{
		chave: 'coordenacaoMotora',
		rotulo: 'Coordenação Motora',
		sigla: 'MOT',
		descricao: 'Agilidade, equilíbrio, precisão e habilidades práticas.'
	}
] as const;

export type ChaveAtributo = (typeof ATRIBUTOS)[number]['chave'];

export const NOTA_MIN = 0;
export const NOTA_MAX = 10;
export const ALTURA_MIN_CM = 100;
export const ALTURA_MAX_CM = 250;
export const PESO_MIN_KG = 30;
export const PESO_MAX_KG = 250;

export const LATERALIDADES = ['destro', 'canhoto', 'ambidestro'] as const;
export type Lateralidade = (typeof LATERALIDADES)[number];

export const ROTULO_LATERALIDADE: Record<Lateralidade, string> = {
	destro: 'Destro',
	canhoto: 'Canhoto',
	ambidestro: 'Ambidestro'
};

export const TAMANHOS_CAMISETA = ['PP', 'P', 'M', 'G', 'GG', 'XG'] as const;
export type TamanhoCamiseta = (typeof TAMANHOS_CAMISETA)[number];

export const FOCOS_DRAFT = ['equilibrado', 'fisico', 'biblico', 'mental', 'coordenacao'] as const;
export type FocoDraft = (typeof FOCOS_DRAFT)[number];

export const ROTULO_FOCO_DRAFT: Record<FocoDraft, string> = {
	equilibrado: 'Equilibrado (4 atributos)',
	fisico: 'Priorizar Físico',
	biblico: 'Priorizar Bíblico',
	mental: 'Priorizar Mental',
	coordenacao: 'Priorizar Coordenação Motora'
};

export type NotasAtributos = {
	fisico: number | null;
	biblico: number | null;
	mental: number | null;
	coordenacaoMotora: number | null;
};

export type AtributosPessoa = NotasAtributos & {
	media: number | null;
	completo: boolean;
	alturaCm: number | null;
	pesoKg: number | null;
	lateralidade: Lateralidade | null;
	tamanhoCamiseta: TamanhoCamiseta | null;
	pontosFortes: string | null;
	observacaoDraft: string | null;
	avaliadoEm: string | null;
	avaliadoPor: string | null;
};

export type PerfilDraft = {
	id: string;
	nome: string;
	estagio: string;
	grupo: { id: string; nome: string } | null;
	atributos: AtributosPessoa;
};

export const ATRIBUTOS_VAZIOS: AtributosPessoa = {
	fisico: null,
	biblico: null,
	mental: null,
	coordenacaoMotora: null,
	media: null,
	completo: false,
	alturaCm: null,
	pesoKg: null,
	lateralidade: null,
	tamanhoCamiseta: null,
	pontosFortes: null,
	observacaoDraft: null,
	avaliadoEm: null,
	avaliadoPor: null
};

export function arredondar1(valor: number): number {
	return Math.round(valor * 10) / 10;
}

/** Média aritmética das notas preenchidas (0,0 a 10,0), ou null se nenhuma foi avaliada. */
export function mediaAtributos(notas: NotasAtributos): number | null {
	const valores = [notas.fisico, notas.biblico, notas.mental, notas.coordenacaoMotora].filter(
		(v): v is number => typeof v === 'number' && Number.isFinite(v)
	);
	if (valores.length === 0) return null;
	const soma = valores.reduce((acc, v) => acc + v, 0);
	return arredondar1(soma / valores.length);
}

/** Todos os 4 atributos estão preenchidos? */
export function atributosCompletos(notas: NotasAtributos): boolean {
	return (
		notas.fisico !== null &&
		notas.biblico !== null &&
		notas.mental !== null &&
		notas.coordenacaoMotora !== null
	);
}

/** Há pelo menos algum dado preenchido no perfil de atributos? */
export function temAlgumAtributo(a: AtributosPessoa | null | undefined): boolean {
	if (!a) return false;
	return (
		a.fisico !== null ||
		a.biblico !== null ||
		a.mental !== null ||
		a.coordenacaoMotora !== null ||
		a.alturaCm !== null ||
		a.pesoKg !== null ||
		a.lateralidade !== null ||
		a.tamanhoCamiseta !== null ||
		Boolean(a.pontosFortes) ||
		Boolean(a.observacaoDraft)
	);
}

/** Faixa descritiva para dar significado além do número (WCAG: nunca só cor/número solto). */
export function faixaNota(nota: number | null): string {
	if (nota === null) return 'Não avaliado';
	if (nota <= 2) return 'Inicial';
	if (nota <= 4) return 'Em desenvolvimento';
	if (nota <= 6) return 'Sólido';
	if (nota <= 8) return 'Forte';
	return 'Destaque';
}

export function formatarNota(valor: number | null): string {
	if (valor === null) return '—';
	return valor.toLocaleString('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: 1 });
}

export function formatarMedia(valor: number | null): string {
	if (valor === null) return '—';
	return valor.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
}

/** 178 → "1,78 m" */
export function formatarAltura(cm: number | null): string | null {
	if (cm === null) return null;
	const metros = (cm / 100).toLocaleString('pt-BR', {
		minimumFractionDigits: 2,
		maximumFractionDigits: 2
	});
	return `${metros} m`;
}

/** 72.5 → "72,5 kg" */
export function formatarPeso(kg: number | null): string | null {
	if (kg === null) return null;
	const texto = kg.toLocaleString('pt-BR', {
		minimumFractionDigits: Number.isInteger(kg) ? 0 : 1,
		maximumFractionDigits: 1
	});
	return `${texto} kg`;
}

/** Converte entrada de texto "72,5" ou "72.5" em número (ou null se vazio / NaN se inválido). */
export function parsePesoTexto(texto: string): number | null {
	const limpo = texto.trim();
	if (!limpo) return null;
	const normalizado = limpo.replace(',', '.');
	if (!/^\d+(?:\.\d{1,2})?$/.test(normalizado)) return Number.NaN;
	return arredondar1(Number(normalizado));
}

export type MediasTimeDraft = {
	geral: number | null;
	fisico: number | null;
	biblico: number | null;
	mental: number | null;
	coordenacaoMotora: number | null;
	alturaCm: number | null;
};

export type TimeDraftCalculado = {
	nome: string;
	membros: Array<{
		personId: string;
		nome: string;
		fisico: number | null;
		biblico: number | null;
		mental: number | null;
		coordenacaoMotora: number | null;
		media: number | null;
		alturaCm: number | null;
		pontosFortes: string | null;
		semAvaliacao: boolean;
	}>;
	totalMembros: number;
	medias: MediasTimeDraft;
};

export type EquilibrioDraft = {
	diferencaGeral: number;
	diferencas: Record<ChaveAtributo, number>;
	nivel: 'excelente' | 'bom' | 'atencao';
	semAvaliacaoCount: number;
	resumo: string;
};

function mediaOpcional(valores: Array<number | null>): number | null {
	const validos = valores.filter((v): v is number => v !== null && Number.isFinite(v));
	if (validos.length === 0) return null;
	return arredondar1(validos.reduce((acc, v) => acc + v, 0) / validos.length);
}

/** Calcula médias por atributo e altura média de um time (usado no servidor e em ajustes manuais). */
export function calcularMediasTime(
	membros: Array<NotasAtributos & { alturaCm?: number | null }>
): MediasTimeDraft {
	const fisico = mediaOpcional(membros.map((m) => m.fisico));
	const biblico = mediaOpcional(membros.map((m) => m.biblico));
	const mental = mediaOpcional(membros.map((m) => m.mental));
	const coordenacaoMotora = mediaOpcional(membros.map((m) => m.coordenacaoMotora));
	const mediasIndividuais = membros.map((m) => mediaAtributos(m));
	const geral = mediaOpcional(mediasIndividuais);
	const alturas = membros.map((m) => m.alturaCm ?? null);
	const alturaMedia = mediaOpcional(alturas);

	return {
		geral,
		fisico,
		biblico,
		mental,
		coordenacaoMotora,
		alturaCm: alturaMedia !== null ? Math.round(alturaMedia) : null
	};
}

function amplitude(valores: Array<number | null>): number {
	const validos = valores.filter((v): v is number => v !== null && Number.isFinite(v));
	if (validos.length < 2) return 0;
	return arredondar1(Math.max(...validos) - Math.min(...validos));
}

/** Calcula quão equilibrados estão os times após sugestão automática ou ajuste manual. */
export function calcularEquilibrioTimes(
	times: Array<{ medias: MediasTimeDraft; membros: Array<{ semAvaliacao: boolean }> }>
): EquilibrioDraft {
	const diferencaGeral = amplitude(times.map((t) => t.medias.geral));
	const diferencas: Record<ChaveAtributo, number> = {
		fisico: amplitude(times.map((t) => t.medias.fisico)),
		biblico: amplitude(times.map((t) => t.medias.biblico)),
		mental: amplitude(times.map((t) => t.medias.mental)),
		coordenacaoMotora: amplitude(times.map((t) => t.medias.coordenacaoMotora))
	};
	const semAvaliacaoCount = times.reduce(
		(acc, t) => acc + t.membros.filter((m) => m.semAvaliacao).length,
		0
	);

	const nivel: EquilibrioDraft['nivel'] =
		diferencaGeral <= 0.5 ? 'excelente' : diferencaGeral <= 1.2 ? 'bom' : 'atencao';

	const base = times.every((t) => t.medias.geral === null)
		? 'Nenhuma pessoa selecionada tem notas preenchidas ainda; os times foram divididos por tamanho.'
		: diferencaGeral === 0
			? `Times empatados na média geral entre os ${times.length} times.`
			: `Diferença máxima de ${formatarMedia(diferencaGeral)} ponto na média geral entre os ${times.length} times.`;

	const complemento =
		semAvaliacaoCount > 0
			? ` ${semAvaliacaoCount} ${semAvaliacaoCount === 1 ? 'pessoa ainda sem avaliação completa entrou' : 'pessoas ainda sem avaliação completa entraram'} com peso neutro.`
			: '';

	return {
		diferencaGeral,
		diferencas,
		nivel,
		semAvaliacaoCount,
		resumo: `${base}${complemento}`
	};
}

/**
 * Monta texto pronto para WhatsApp dos times do Draft.
 * Regra de privacidade (RN-33): envia apenas título, nomes dos times e nomes
 * dos participantes — nunca telefone, e-mail, medidas corporais ou notas individuais.
 */
export function mensagemWhatsAppDraft(
	titulo: string,
	times: Array<{ nome: string; membros: Array<{ nome: string }> }>,
	observacao?: string | null
): string {
	const cabecalho = titulo.trim() ? `*${titulo.trim()}*` : '*Times do Draft · Eagles*';
	const blocos = times.map((t) => {
		const lista = t.membros.map((m) => `• ${m.nome}`).join('\n');
		return `*${t.nome}* (${t.membros.length})\n${lista}`;
	});
	const partes = [cabecalho, ...blocos];
	if (observacao?.trim()) partes.push(observacao.trim());
	return partes.join('\n\n');
}

export function urlWhatsAppDraft(texto: string): string {
	return `https://wa.me/?text=${encodeURIComponent(texto)}`;
}

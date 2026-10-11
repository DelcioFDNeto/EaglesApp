/**
 * Datas e horas no fuso da equipe (D-M05-3).
 *
 * Funções puras, compartilhadas entre servidor e tela: a mesma conversão nos
 * dois lados é o que impede a tela de mostrar uma hora antes de hidratar e
 * outra depois. Usam só o `Intl` — que no Node e nos navegadores carrega as
 * regras de fuso do sistema, horário de verão incluído.
 *
 * Datas locais circulam como texto `AAAA-MM-DD` e horas como `HH:MM`: são
 * valores do calendário da equipe, não instantes, e `Date` os confundiria.
 */

export const FUSO_PADRAO = 'America/Sao_Paulo';

type Partes = { ano: number; mes: number; dia: number; hora: number; minuto: number };

const formatadores = new Map<string, Intl.DateTimeFormat>();

function formatadorDePartes(fuso: string): Intl.DateTimeFormat {
	let f = formatadores.get(fuso);
	if (!f) {
		f = new Intl.DateTimeFormat('en-US', {
			timeZone: fuso,
			hourCycle: 'h23',
			year: 'numeric',
			month: '2-digit',
			day: '2-digit',
			hour: '2-digit',
			minute: '2-digit',
			second: '2-digit'
		});
		formatadores.set(fuso, f);
	}
	return f;
}

function partesNoFuso(instante: Date, fuso: string): Partes & { segundo: number } {
	const valores: Record<string, number> = {};
	for (const p of formatadorDePartes(fuso).formatToParts(instante)) {
		if (p.type !== 'literal') valores[p.type] = Number(p.value);
	}
	return {
		ano: valores.year!,
		mes: valores.month!,
		dia: valores.day!,
		hora: valores.hour!,
		minuto: valores.minute!,
		segundo: valores.second!
	};
}

/** Quantos ms o relógio do fuso está à frente do UTC naquele instante. */
function deslocamento(instante: Date, fuso: string): number {
	const p = partesNoFuso(instante, fuso);
	const comoUtc = Date.UTC(p.ano, p.mes - 1, p.dia, p.hora, p.minuto, p.segundo);
	return comoUtc - Math.floor(instante.getTime() / 1000) * 1000;
}

const dois = (n: number) => String(n).padStart(2, '0');

/** Data local `AAAA-MM-DD` de um instante, no fuso. */
export function dataNoFuso(instante: Date, fuso: string): string {
	const p = partesNoFuso(instante, fuso);
	return `${p.ano}-${dois(p.mes)}-${dois(p.dia)}`;
}

/** Hora local `HH:MM` de um instante, no fuso. */
export function horaNoFuso(instante: Date, fuso: string): string {
	const p = partesNoFuso(instante, fuso);
	return `${dois(p.hora)}:${dois(p.minuto)}`;
}

/** "Hoje" no calendário da equipe — que não é o "hoje" do servidor em UTC. */
export function hojeNoFuso(fuso: string, agora: Date = new Date()): string {
	return dataNoFuso(agora, fuso);
}

/**
 * O instante em que o relógio do fuso marca `data` às `hora`.
 *
 * Calcula o deslocamento uma vez, corrige, e confere de novo: perto de uma
 * mudança de horário de verão, o deslocamento do palpite e o do resultado
 * podem diferir. Hora que não existe (o relógio pula de 0h para 1h) vira a
 * primeira hora válida depois dela; hora que existe duas vezes fica com a
 * primeira.
 */
export function instanteLocal(data: string, hora: string, fuso: string): Date {
	const [ano, mes, dia] = data.split('-').map(Number) as [number, number, number];
	const [h, m] = hora.split(':').map(Number) as [number, number];
	const comoUtc = Date.UTC(ano, mes - 1, dia, h, m);

	const primeiro = comoUtc - deslocamento(new Date(comoUtc), fuso);
	const segundo = comoUtc - deslocamento(new Date(primeiro), fuso);
	if (primeiro === segundo) return new Date(primeiro);

	// Mudança de horário entre o palpite e o resultado. Fica com o candidato
	// cuja hora local é a pedida; se nenhum for (hora que não existe), com o
	// mais tardio — a primeira hora válida depois do salto.
	for (const candidato of [Math.min(primeiro, segundo), Math.max(primeiro, segundo)]) {
		if (horaNoFuso(new Date(candidato), fuso) === `${dois(h)}:${dois(m)}`) {
			return new Date(candidato);
		}
	}
	return new Date(Math.max(primeiro, segundo));
}

/** `AAAA-MM-DD` + n dias, no calendário (sem fuso: é aritmética de datas). */
export function somarDias(data: string, dias: number): string {
	const [ano, mes, dia] = data.split('-').map(Number) as [number, number, number];
	const d = new Date(Date.UTC(ano, mes - 1, dia + dias));
	return `${d.getUTCFullYear()}-${dois(d.getUTCMonth() + 1)}-${dois(d.getUTCDate())}`;
}

/** 0 = domingo … 6 = sábado. */
export function diaDaSemana(data: string): number {
	const [ano, mes, dia] = data.split('-').map(Number) as [number, number, number];
	return new Date(Date.UTC(ano, mes - 1, dia)).getUTCDay();
}

/** Dias entre duas datas locais (b − a). */
export function diasEntre(a: string, b: string): number {
	const [a1, a2, a3] = a.split('-').map(Number) as [number, number, number];
	const [b1, b2, b3] = b.split('-').map(Number) as [number, number, number];
	return Math.round((Date.UTC(b1, b2 - 1, b3) - Date.UTC(a1, a2 - 1, a3)) / 86_400_000);
}

/** Primeiro e último dia do mês `AAAA-MM`. */
export function limitesDoMes(mes: string): { inicio: string; fim: string } {
	const [ano, m] = mes.split('-').map(Number) as [number, number];
	const ultimo = new Date(Date.UTC(ano, m, 0)).getUTCDate();
	return { inicio: `${ano}-${dois(m)}-01`, fim: `${ano}-${dois(m)}-${dois(ultimo)}` };
}

/** `AAAA-MM` deslocado de n meses. */
export function somarMeses(mes: string, n: number): string {
	const [ano, m] = mes.split('-').map(Number) as [number, number];
	const d = new Date(Date.UTC(ano, m - 1 + n, 1));
	return `${d.getUTCFullYear()}-${dois(d.getUTCMonth() + 1)}`;
}

/**
 * `AAAA-MM-DD` que existe no calendário. A volta pela data é necessária: o V8
 * aceita "2026-02-31" e o transforma em 3 de março — passava na validação e
 * quebrava no Postgres, ou movia o evento em silêncio (varredura de 11/10/2026).
 */
export const ehData = (v: string) => {
	if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
	const d = new Date(`${v}T00:00:00Z`);
	return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
};
export const ehHora = (v: string) => /^([01]\d|2[0-3]):[0-5]\d$/.test(v);
export const ehMes = (v: string) => /^\d{4}-(0[1-9]|1[0-2])$/.test(v);

// ---------------------------------------------------------------------------
// Formatação para a tela — sempre com o fuso explícito
// ---------------------------------------------------------------------------

const DIAS = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];
const MESES = [
	'janeiro',
	'fevereiro',
	'março',
	'abril',
	'maio',
	'junho',
	'julho',
	'agosto',
	'setembro',
	'outubro',
	'novembro',
	'dezembro'
];

/** "quinta, 21 de agosto" — de uma data local. */
export function dataPorExtenso(data: string): string {
	const [, mes, dia] = data.split('-').map(Number) as [number, number, number];
	return `${DIAS[diaDaSemana(data)]}, ${dia} de ${MESES[mes - 1]}`;
}

/** "Quinta, 21/08" — o formato curto do texto do WhatsApp. */
export function dataCurtaComDia(data: string): string {
	const [, mes, dia] = data.split('-').map(Number) as [number, number, number];
	const nome = DIAS[diaDaSemana(data)]!;
	return `${nome[0]!.toUpperCase()}${nome.slice(1)}, ${dois(dia)}/${dois(mes)}`;
}

/** "outubro de 2026" — de um mês `AAAA-MM`. */
export function mesPorExtenso(mes: string): string {
	const [ano, m] = mes.split('-').map(Number) as [number, number];
	return `${MESES[m - 1]} de ${ano}`;
}

/** Termina em outro dia — retiro, acampamento, virada de madrugada. */
export function terminaEmOutroDia(e: { data: string; dataFim?: string | null }): boolean {
	return !!e.dataFim && e.dataFim !== e.data;
}

/** "20h", "19h30" — de uma hora `HH:MM`. */
export function horaCurta(hora: string): string {
	const [h, m] = hora.split(':');
	return m && m !== '00' ? `${Number(h)}h${m}` : `${Number(h)}h`;
}

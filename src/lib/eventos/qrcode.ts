/**
 * Gerador de QR Code ISO/IEC 18004 (Modo Byte, Correção de Erro Nível M) em
 * TypeScript puro, sem dependências externas.
 *
 * Suporta versões 1 a 12 (até 287 bytes UTF-8), cobrindo com folga tanto o
 * código bruto `eagles-checkin-<uuid>-<uuid>` (~88 chars, Versão 6) quanto a
 * URL completa de check-in com `?checkin=...` (~170+ chars, Versão 9–10).
 */

interface InfoVersao {
	versao: number;
	totalCodewords: number;
	ecPorBloco: number;
	blocosG1: number;
	dadosG1: number;
	blocosG2: number;
	dadosG2: number;
	alinhamento: readonly number[];
}

/**
 * Tabela ISO/IEC 18004 (Anexo E + Tabela 9) para Nível M (recuperação ~15%).
 * Versões 1–9 usam indicador de tamanho de 8 bits; versões 10–12 usam 16 bits.
 */
const VERSOES_M: readonly InfoVersao[] = [
	{
		versao: 1,
		totalCodewords: 26,
		ecPorBloco: 10,
		blocosG1: 1,
		dadosG1: 16,
		blocosG2: 0,
		dadosG2: 0,
		alinhamento: []
	},
	{
		versao: 2,
		totalCodewords: 44,
		ecPorBloco: 16,
		blocosG1: 1,
		dadosG1: 28,
		blocosG2: 0,
		dadosG2: 0,
		alinhamento: [6, 18]
	},
	{
		versao: 3,
		totalCodewords: 70,
		ecPorBloco: 26,
		blocosG1: 1,
		dadosG1: 44,
		blocosG2: 0,
		dadosG2: 0,
		alinhamento: [6, 22]
	},
	{
		versao: 4,
		totalCodewords: 100,
		ecPorBloco: 18,
		blocosG1: 2,
		dadosG1: 32,
		blocosG2: 0,
		dadosG2: 0,
		alinhamento: [6, 26]
	},
	{
		versao: 5,
		totalCodewords: 134,
		ecPorBloco: 24,
		blocosG1: 2,
		dadosG1: 43,
		blocosG2: 0,
		dadosG2: 0,
		alinhamento: [6, 30]
	},
	{
		versao: 6,
		totalCodewords: 172,
		ecPorBloco: 16,
		blocosG1: 4,
		dadosG1: 27,
		blocosG2: 0,
		dadosG2: 0,
		alinhamento: [6, 34]
	},
	{
		versao: 7,
		totalCodewords: 196,
		ecPorBloco: 18,
		blocosG1: 4,
		dadosG1: 31,
		blocosG2: 0,
		dadosG2: 0,
		alinhamento: [6, 22, 38]
	},
	{
		versao: 8,
		totalCodewords: 242,
		ecPorBloco: 22,
		blocosG1: 2,
		dadosG1: 38,
		blocosG2: 2,
		dadosG2: 39,
		alinhamento: [6, 24, 42]
	},
	{
		versao: 9,
		totalCodewords: 292,
		ecPorBloco: 22,
		blocosG1: 3,
		dadosG1: 36,
		blocosG2: 2,
		dadosG2: 37,
		alinhamento: [6, 26, 46]
	},
	{
		versao: 10,
		totalCodewords: 346,
		ecPorBloco: 26,
		blocosG1: 4,
		dadosG1: 43,
		blocosG2: 1,
		dadosG2: 44,
		alinhamento: [6, 28, 50]
	},
	{
		versao: 11,
		totalCodewords: 404,
		ecPorBloco: 30,
		blocosG1: 1,
		dadosG1: 50,
		blocosG2: 4,
		dadosG2: 51,
		alinhamento: [6, 30, 54]
	},
	{
		versao: 12,
		totalCodewords: 466,
		ecPorBloco: 22,
		blocosG1: 6,
		dadosG1: 36,
		blocosG2: 2,
		dadosG2: 37,
		alinhamento: [6, 32, 58]
	}
];

/** Nível de correção M = 00 na tabela de formato ISO/IEC 18004. */
const NIVEL_EC_M = 0;

/** Polinômio primitivo de GF(256) definido pela ISO/IEC 18004: x^8+x^4+x^3+x^2+1. */
const GF_PRIM = 0x11d;
const GF_EXP = new Uint8Array(512);
const GF_LOG = new Uint8Array(256);

{
	let x = 1;
	for (let i = 0; i < 255; i++) {
		GF_EXP[i] = x;
		GF_LOG[x] = i;
		x <<= 1;
		if (x & 0x100) {
			x ^= GF_PRIM;
		}
	}
	for (let i = 255; i < 512; i++) {
		GF_EXP[i] = GF_EXP[i - 255] ?? 0;
	}
}

function gfMul(a: number, b: number): number {
	if (a === 0 || b === 0) return 0;
	const logA = GF_LOG[a] ?? 0;
	const logB = GF_LOG[b] ?? 0;
	return GF_EXP[logA + logB] ?? 0;
}

function polinomioGeradorRs(grau: number): Uint8Array {
	let poli = new Uint8Array([1]);
	for (let i = 0; i < grau; i++) {
		const proximo = new Uint8Array(poli.length + 1);
		const fator = GF_EXP[i] ?? 0;
		for (let j = 0; j < poli.length; j++) {
			const coef = poli[j] ?? 0;
			proximo[j] = (proximo[j] ?? 0) ^ coef;
			proximo[j + 1] = (proximo[j + 1] ?? 0) ^ gfMul(coef, fator);
		}
		poli = proximo;
	}
	return poli;
}

function calcularEcReedSolomon(dados: Uint8Array, qtdEc: number): Uint8Array {
	const gerador = polinomioGeradorRs(qtdEc);
	const resto = new Uint8Array(qtdEc);
	for (let i = 0; i < dados.length; i++) {
		const fator = (dados[i] ?? 0) ^ (resto[0] ?? 0);
		for (let j = 0; j < qtdEc - 1; j++) {
			resto[j] = resto[j + 1] ?? 0;
		}
		resto[qtdEc - 1] = 0;
		if (fator !== 0) {
			for (let j = 0; j < qtdEc; j++) {
				resto[j] = (resto[j] ?? 0) ^ gfMul(gerador[j + 1] ?? 0, fator);
			}
		}
	}
	return resto;
}

function totalDados(info: InfoVersao): number {
	return info.blocosG1 * info.dadosG1 + info.blocosG2 * info.dadosG2;
}

function bitsContagemByte(versao: number): number {
	return versao <= 9 ? 8 : 16;
}

function escolherVersao(qtdBytes: number): InfoVersao {
	for (const info of VERSOES_M) {
		const bitsDisponiveis = totalDados(info) * 8;
		const bitsNecessarios = 4 + bitsContagemByte(info.versao) + qtdBytes * 8;
		if (bitsNecessarios <= bitsDisponiveis) {
			return info;
		}
	}
	throw new RangeError(
		`Conteúdo muito longo para QR Code (${qtdBytes} bytes; máximo suportado: 287 bytes).`
	);
}

function codificarDadosByte(bytes: Uint8Array, info: InfoVersao): Uint8Array {
	const capacidadeDados = totalDados(info);
	const capacidadeBits = capacidadeDados * 8;
	const bits: number[] = [];

	const empurrarBits = (valor: number, comprimento: number) => {
		for (let i = comprimento - 1; i >= 0; i--) {
			bits.push((valor >>> i) & 1);
		}
	};

	// Indicador de modo Byte: 0100
	empurrarBits(0b0100, 4);
	// Contagem de bytes (8 bits em V1–V9, 16 bits em V10+)
	empurrarBits(bytes.length, bitsContagemByte(info.versao));
	// Payload UTF-8
	for (let i = 0; i < bytes.length; i++) {
		empurrarBits(bytes[i] ?? 0, 8);
	}

	// Terminador (até 4 zeros)
	const terminador = Math.min(4, capacidadeBits - bits.length);
	for (let i = 0; i < terminador; i++) {
		bits.push(0);
	}

	// Alinhamento em múltiplo de 8 bits
	while (bits.length % 8 !== 0) {
		bits.push(0);
	}

	// Bytes de preenchimento alternados (0xEC, 0x11)
	const padBytes = [0xec, 0x11];
	let idxPad = 0;
	while (bits.length < capacidadeBits) {
		empurrarBits(padBytes[idxPad % 2] ?? 0xec, 8);
		idxPad++;
	}

	const resultado = new Uint8Array(capacidadeDados);
	for (let i = 0; i < capacidadeDados; i++) {
		let byte = 0;
		for (let b = 0; b < 8; b++) {
			byte = (byte << 1) | (bits[i * 8 + b] ?? 0);
		}
		resultado[i] = byte;
	}
	return resultado;
}

function intercalarBlocos(dados: Uint8Array, info: InfoVersao): Uint8Array {
	const blocosDados: Uint8Array[] = [];
	const blocosEc: Uint8Array[] = [];
	let offset = 0;

	for (let i = 0; i < info.blocosG1; i++) {
		const bloco = dados.subarray(offset, offset + info.dadosG1);
		offset += info.dadosG1;
		blocosDados.push(bloco);
		blocosEc.push(calcularEcReedSolomon(bloco, info.ecPorBloco));
	}

	for (let i = 0; i < info.blocosG2; i++) {
		const bloco = dados.subarray(offset, offset + info.dadosG2);
		offset += info.dadosG2;
		blocosDados.push(bloco);
		blocosEc.push(calcularEcReedSolomon(bloco, info.ecPorBloco));
	}

	const saida = new Uint8Array(info.totalCodewords);
	let pos = 0;
	const maxDados = Math.max(info.dadosG1, info.dadosG2);

	for (let i = 0; i < maxDados; i++) {
		for (const bloco of blocosDados) {
			if (i < bloco.length) {
				saida[pos++] = bloco[i] ?? 0;
			}
		}
	}

	for (let i = 0; i < info.ecPorBloco; i++) {
		for (const ec of blocosEc) {
			saida[pos++] = ec[i] ?? 0;
		}
	}

	return saida;
}

function calcularBitsFormato(mascara: number): number {
	const dados = (NIVEL_EC_M << 3) | (mascara & 0b111);
	let resto = dados << 10;
	for (let bit = 14; bit >= 10; bit--) {
		if ((resto >>> bit) & 1) {
			resto ^= 0x537 << (bit - 10);
		}
	}
	return ((dados << 10) | resto) ^ 0x5412;
}

function calcularBitsVersao(versao: number): number {
	let resto = versao << 12;
	for (let bit = 17; bit >= 12; bit--) {
		if ((resto >>> bit) & 1) {
			resto ^= 0x1f25 << (bit - 12);
		}
	}
	return (versao << 12) | resto;
}

function criarGrade(tamanho: number): boolean[][] {
	return Array.from({ length: tamanho }, () => new Array<boolean>(tamanho).fill(false));
}

function marcarModulo(
	modulos: boolean[][],
	funcao: boolean[][],
	linha: number,
	coluna: number,
	escuro: boolean
): void {
	const linhaMod = modulos[linha];
	const linhaFunc = funcao[linha];
	if (linhaMod && linhaFunc && coluna >= 0 && coluna < linhaMod.length) {
		linhaMod[coluna] = escuro;
		linhaFunc[coluna] = true;
	}
}

function desenharLocalizador(
	modulos: boolean[][],
	funcao: boolean[][],
	topo: number,
	esquerda: number
): void {
	for (let dr = -1; dr <= 7; dr++) {
		for (let dc = -1; dc <= 7; dc++) {
			const r = topo + dr;
			const c = esquerda + dc;
			const dentro = dr >= 0 && dr <= 6 && dc >= 0 && dc <= 6;
			const escuro =
				dentro &&
				(dr === 0 ||
					dr === 6 ||
					dc === 0 ||
					dc === 6 ||
					(dr >= 2 && dr <= 4 && dc >= 2 && dc <= 4));
			marcarModulo(modulos, funcao, r, c, escuro);
		}
	}
}

function desenharAlinhamento(
	modulos: boolean[][],
	funcao: boolean[][],
	centroLinha: number,
	centroColuna: number
): void {
	for (let dr = -2; dr <= 2; dr++) {
		for (let dc = -2; dc <= 2; dc++) {
			const dist = Math.max(Math.abs(dr), Math.abs(dc));
			marcarModulo(modulos, funcao, centroLinha + dr, centroColuna + dc, dist === 0 || dist === 2);
		}
	}
}

function escreverInformacaoFormato(modulos: boolean[][], mascara: number): void {
	const n = modulos.length;
	const bits = calcularBitsFormato(mascara);
	const bit = (i: number): boolean => ((bits >>> i) & 1) === 1;

	const definir = (r: number, c: number, valor: boolean) => {
		const row = modulos[r];
		if (row && c >= 0 && c < n) row[c] = valor;
	};

	// Cópia 1 (ao redor do localizador superior esquerdo)
	for (let i = 0; i <= 5; i++) definir(i, 8, bit(i));
	definir(7, 8, bit(6));
	definir(8, 8, bit(7));
	definir(8, 7, bit(8));
	for (let i = 9; i <= 14; i++) definir(8, 14 - i, bit(i));

	// Cópia 2 (abaixo do superior direito e à direita do inferior esquerdo)
	for (let i = 0; i <= 7; i++) definir(8, n - 1 - i, bit(i));
	for (let i = 8; i <= 14; i++) definir(n - 15 + i, 8, bit(i));
}

function escreverInformacaoVersao(modulos: boolean[][], funcao: boolean[][], versao: number): void {
	if (versao < 7) return;
	const n = modulos.length;
	const bits = calcularBitsVersao(versao);
	for (let i = 0; i < 18; i++) {
		const escuro = ((bits >>> i) & 1) === 1;
		const a = Math.floor(i / 3);
		const b = i % 3;
		// Bloco inferior esquerdo (3x6) e bloco superior direito (6x3)
		marcarModulo(modulos, funcao, n - 11 + b, a, escuro);
		marcarModulo(modulos, funcao, a, n - 11 + b, escuro);
	}
}

function condicaoMascara(mascara: number, r: number, c: number): boolean {
	switch (mascara) {
		case 0:
			return (r + c) % 2 === 0;
		case 1:
			return r % 2 === 0;
		case 2:
			return c % 3 === 0;
		case 3:
			return (r + c) % 3 === 0;
		case 4:
			return (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0;
		case 5:
			return ((r * c) % 2) + ((r * c) % 3) === 0;
		case 6:
			return (((r * c) % 2) + ((r * c) % 3)) % 2 === 0;
		case 7:
			return (((r + c) % 2) + ((r * c) % 3)) % 2 === 0;
		default:
			return false;
	}
}

function aplicarMascara(base: boolean[][], funcao: boolean[][], mascara: number): boolean[][] {
	const n = base.length;
	const resultado = criarGrade(n);
	for (let r = 0; r < n; r++) {
		const linhaBase = base[r]!;
		const linhaFunc = funcao[r]!;
		const linhaRes = resultado[r]!;
		for (let c = 0; c < n; c++) {
			const valor = linhaBase[c] ?? false;
			const reservado = linhaFunc[c] ?? false;
			linhaRes[c] = reservado ? valor : condicaoMascara(mascara, r, c) ? !valor : valor;
		}
	}
	escreverInformacaoFormato(resultado, mascara);
	return resultado;
}

function contarPadraoLocalizador(linha: boolean[]): number {
	let ocorrencias = 0;
	for (let i = 0; i <= linha.length - 11; i++) {
		const p1 =
			linha[i] &&
			!linha[i + 1] &&
			linha[i + 2] &&
			linha[i + 3] &&
			linha[i + 4] &&
			!linha[i + 5] &&
			linha[i + 6] &&
			!linha[i + 7] &&
			!linha[i + 8] &&
			!linha[i + 9] &&
			!linha[i + 10];
		const p2 =
			!linha[i] &&
			!linha[i + 1] &&
			!linha[i + 2] &&
			!linha[i + 3] &&
			linha[i + 4] &&
			!linha[i + 5] &&
			linha[i + 6] &&
			linha[i + 7] &&
			linha[i + 8] &&
			!linha[i + 9] &&
			linha[i + 10];
		if (p1 || p2) ocorrencias++;
	}
	return ocorrencias;
}

function calcularPenalidade(matriz: boolean[][]): number {
	const n = matriz.length;
	let pontos = 0;

	// Regra 1: sequências >= 5 módulos iguais na mesma linha ou coluna
	for (let r = 0; r < n; r++) {
		let cor = matriz[r]?.[0] ?? false;
		let seq = 1;
		for (let c = 1; c < n; c++) {
			const atual = matriz[r]?.[c] ?? false;
			if (atual === cor) {
				seq++;
			} else {
				if (seq >= 5) pontos += 3 + (seq - 5);
				cor = atual;
				seq = 1;
			}
		}
		if (seq >= 5) pontos += 3 + (seq - 5);
	}

	for (let c = 0; c < n; c++) {
		let cor = matriz[0]?.[c] ?? false;
		let seq = 1;
		for (let r = 1; r < n; r++) {
			const atual = matriz[r]?.[c] ?? false;
			if (atual === cor) {
				seq++;
			} else {
				if (seq >= 5) pontos += 3 + (seq - 5);
				cor = atual;
				seq = 1;
			}
		}
		if (seq >= 5) pontos += 3 + (seq - 5);
	}

	// Regra 2: blocos 2x2 da mesma cor
	for (let r = 0; r < n - 1; r++) {
		for (let c = 0; c < n - 1; c++) {
			const v = matriz[r]?.[c] ?? false;
			if (
				v === (matriz[r]?.[c + 1] ?? false) &&
				v === (matriz[r + 1]?.[c] ?? false) &&
				v === (matriz[r + 1]?.[c + 1] ?? false)
			) {
				pontos += 3;
			}
		}
	}

	// Regra 3: padrões semelhantes ao localizador em linhas e colunas
	for (let r = 0; r < n; r++) {
		pontos += contarPadraoLocalizador(matriz[r]!) * 40;
	}
	const colunaBuf = new Array<boolean>(n);
	for (let c = 0; c < n; c++) {
		for (let r = 0; r < n; r++) {
			colunaBuf[r] = matriz[r]?.[c] ?? false;
		}
		pontos += contarPadraoLocalizador(colunaBuf) * 40;
	}

	// Regra 4: equilíbrio entre módulos claros e escuros
	let escuros = 0;
	for (let r = 0; r < n; r++) {
		for (let c = 0; c < n; c++) {
			if (matriz[r]?.[c]) escuros++;
		}
	}
	const total = n * n;
	const k = Math.max(0, Math.ceil(Math.abs(escuros * 20 - total * 10) / total) - 1);
	pontos += k * 10;

	return pontos;
}

/**
 * Gera a matriz booleana ISO/IEC 18004 (`true` = módulo escuro, `false` = módulo claro)
 * com dimensão `21 + 4 * (versao - 1)` (sem quiet zone).
 */
export function gerarMatrizQr(texto: string): boolean[][] {
	if (!texto) {
		throw new Error('Texto do QR Code não pode ser vazio.');
	}

	const bytes = new TextEncoder().encode(texto);
	const info = escolherVersao(bytes.length);
	const dados = codificarDadosByte(bytes, info);
	const codewords = intercalarBlocos(dados, info);

	const n = 17 + 4 * info.versao;
	const modulos = criarGrade(n);
	const funcao = criarGrade(n);

	// 1. Localizadores + separadores
	desenharLocalizador(modulos, funcao, 0, 0);
	desenharLocalizador(modulos, funcao, 0, n - 7);
	desenharLocalizador(modulos, funcao, n - 7, 0);

	// 2. Padrões de temporização (timing patterns)
	for (let i = 8; i < n - 8; i++) {
		marcarModulo(modulos, funcao, 6, i, i % 2 === 0);
		marcarModulo(modulos, funcao, i, 6, i % 2 === 0);
	}

	// 3. Padrões de alinhamento (V2+)
	for (const cy of info.alinhamento) {
		for (const cx of info.alinhamento) {
			const sobrepoeLocalizador =
				(cy <= 8 && cx <= 8) || (cy <= 8 && cx >= n - 9) || (cy >= n - 9 && cx <= 8);
			if (!sobrepoeLocalizador) {
				desenharAlinhamento(modulos, funcao, cy, cx);
			}
		}
	}

	// 4. Módulo escuro fixo (4*v + 9, 8)
	marcarModulo(modulos, funcao, 4 * info.versao + 9, 8, true);

	// 5. Reserva das áreas de informação de formato
	for (let i = 0; i <= 8; i++) {
		if (i !== 6) {
			marcarModulo(modulos, funcao, 8, i, false);
			marcarModulo(modulos, funcao, i, 8, false);
		}
	}
	for (let i = n - 8; i < n; i++) {
		marcarModulo(modulos, funcao, 8, i, false);
	}
	for (let i = n - 7; i < n; i++) {
		marcarModulo(modulos, funcao, i, 8, false);
	}

	// 6. Informação de versão (V7+)
	escreverInformacaoVersao(modulos, funcao, info.versao);

	// 7. Preenchimento dos bits em zigue-zague da direita para a esquerda
	let indiceBit = 0;
	const totalBits = codewords.length * 8;
	let subindo = true;

	for (let direita = n - 1; direita >= 1; direita -= 2) {
		if (direita === 6) direita = 5;
		for (let passo = 0; passo < n; passo++) {
			const linha = subindo ? n - 1 - passo : passo;
			for (let desloc = 0; desloc < 2; desloc++) {
				const coluna = direita - desloc;
				if (!(funcao[linha]?.[coluna] ?? true)) {
					let escuro = false;
					if (indiceBit < totalBits) {
						const byte = codewords[indiceBit >>> 3] ?? 0;
						escuro = ((byte >>> (7 - (indiceBit & 7))) & 1) === 1;
					}
					modulos[linha]![coluna] = escuro;
					indiceBit++;
				}
			}
		}
		subindo = !subindo;
	}

	// 8. Escolha da melhor máscara (0–7) pela menor penalidade ISO/IEC 18004
	let melhorMatriz = aplicarMascara(modulos, funcao, 0);
	let menorPenalidade = calcularPenalidade(melhorMatriz);

	for (let mascara = 1; mascara < 8; mascara++) {
		const candidata = aplicarMascara(modulos, funcao, mascara);
		const penalidade = calcularPenalidade(candidata);
		if (penalidade < menorPenalidade) {
			menorPenalidade = penalidade;
			melhorMatriz = candidata;
		}
	}

	return melhorMatriz;
}

/**
 * Gera uma string SVG pura com quiet zone branco de 4 módulos (escaneável em
 * temas claro e escuro) e módulos nítidos (`shape-rendering="crispEdges"`).
 */
export function gerarSvgQr(texto: string, tamanhoPx = 240): string {
	const matriz = gerarMatrizQr(texto);
	const n = matriz.length;
	const quietZone = 4;
	const dim = n + quietZone * 2;
	const tamanho = Number.isFinite(tamanhoPx) && tamanhoPx > 0 ? Math.round(tamanhoPx) : 240;

	const comandos: string[] = [];
	for (let r = 0; r < n; r++) {
		const linha = matriz[r]!;
		let c = 0;
		while (c < n) {
			if (!linha[c]) {
				c++;
				continue;
			}
			const inicio = c;
			while (c < n && linha[c]) {
				c++;
			}
			const largura = c - inicio;
			comandos.push(`M${inicio + quietZone},${r + quietZone}h${largura}v1h-${largura}z`);
		}
	}

	return (
		`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${dim} ${dim}" ` +
		`width="${tamanho}" height="${tamanho}" shape-rendering="crispEdges" ` +
		`role="img" aria-label="QR Code de check-in do evento">` +
		`<rect width="${dim}" height="${dim}" fill="#FFFFFF"/>` +
		`<path d="${comandos.join('')}" fill="#000000"/>` +
		`</svg>`
	);
}

/**
 * Extrai o token de check-in de uma entrada escaneada ou digitada: aceita tanto
 * o código bruto (`eagles-checkin-...`) quanto um link contendo `?checkin=...`.
 */
export function extrairCodigoCheckin(entrada: string): string {
	const limpo = entrada.trim();
	if (!limpo) return '';

	if (limpo.startsWith('?')) {
		const param = new URLSearchParams(limpo).get('checkin');
		return param ? param.trim() : limpo;
	}

	if (
		limpo.startsWith('http://') ||
		limpo.startsWith('https://') ||
		limpo.includes('?checkin=') ||
		limpo.includes('&checkin=')
	) {
		try {
			const url =
				limpo.startsWith('http://') || limpo.startsWith('https://')
					? new URL(limpo)
					: new URL(limpo, 'https://eagles.local');
			const param = url.searchParams.get('checkin');
			if (param && param.trim()) {
				return param.trim();
			}
		} catch {
			// Se não for URL válida, retorna o texto original limpo
		}
	}

	return limpo;
}

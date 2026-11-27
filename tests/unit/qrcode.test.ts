import { describe, expect, it } from 'vitest';
import { extrairCodigoCheckin, gerarMatrizQr, gerarSvgQr } from '../../src/lib/eventos/qrcode';

const GF_EXP = new Uint8Array(512);
const GF_LOG = new Uint8Array(256);
{
	let x = 1;
	for (let i = 0; i < 255; i++) {
		GF_EXP[i] = x;
		GF_LOG[x] = i;
		x <<= 1;
		if (x & 0x100) x ^= 0x11d;
	}
	for (let i = 255; i < 512; i++) GF_EXP[i] = GF_EXP[i - 255]!;
}

function gfMul(a: number, b: number): number {
	return a === 0 || b === 0 ? 0 : GF_EXP[GF_LOG[a]! + GF_LOG[b]!]!;
}

/** Verifica que o bloco (dados + EC) zera o polinômio em todas as raízes α^0..α^(ec-1). */
function verificarSindromeRs(blocoCompleto: number[], qtdEc: number): boolean {
	for (let raiz = 0; raiz < qtdEc; raiz++) {
		const alpha = GF_EXP[raiz]!;
		let soma = 0;
		for (const coef of blocoCompleto) {
			soma = gfMul(soma, alpha) ^ coef;
		}
		if (soma !== 0) return false;
	}
	return true;
}

function lerBitsFormato(matriz: boolean[][]): { copia1: number; copia2: number } {
	const n = matriz.length;
	let copia1 = 0;
	for (let i = 0; i <= 5; i++) if (matriz[i]![8]) copia1 |= 1 << i;
	if (matriz[7]![8]) copia1 |= 1 << 6;
	if (matriz[8]![8]) copia1 |= 1 << 7;
	if (matriz[8]![7]) copia1 |= 1 << 8;
	for (let i = 9; i <= 14; i++) if (matriz[8]![14 - i]) copia1 |= 1 << i;

	let copia2 = 0;
	for (let i = 0; i <= 7; i++) if (matriz[8]![n - 1 - i]) copia2 |= 1 << i;
	for (let i = 8; i <= 14; i++) if (matriz[n - 15 + i]![8]) copia2 |= 1 << i;

	return { copia1, copia2 };
}

function mascaraAtiva(mascara: number, r: number, c: number): boolean {
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

/** Decodificador independente de teste para validar conformidade ISO/IEC 18004 ponta a ponta. */
function decodificarQrNivelM(
	matriz: boolean[][],
	params: {
		versao: number;
		totalCodewords: number;
		ecPorBloco: number;
		blocosG1: number;
		dadosG1: number;
		blocosG2: number;
		dadosG2: number;
		alinhamento: number[];
	}
): { texto: string; rsValido: boolean; nivelEc: number; mascara: number } {
	const n = matriz.length;
	const { copia1, copia2 } = lerBitsFormato(matriz);
	expect(copia1).toBe(copia2);

	const formatoBruto = copia1 ^ 0x5412;
	// Verifica resto BCH(15, 5) mod 0x537 == 0
	let rem = formatoBruto;
	for (let bit = 14; bit >= 10; bit--) {
		if ((rem >>> bit) & 1) rem ^= 0x537 << (bit - 10);
	}
	expect(rem).toBe(0);

	const dadosFormato = formatoBruto >>> 10;
	const nivelEc = dadosFormato >>> 3;
	const mascara = dadosFormato & 0b111;

	// Marca módulos funcionais para extrair exatamente os bits de dados
	const funcao = Array.from({ length: n }, () => new Array<boolean>(n).fill(false));
	const marcarArea = (r0: number, r1: number, c0: number, c1: number) => {
		for (let r = Math.max(0, r0); r <= Math.min(n - 1, r1); r++) {
			for (let c = Math.max(0, c0); c <= Math.min(n - 1, c1); c++) {
				funcao[r]![c] = true;
			}
		}
	};
	marcarArea(0, 7, 0, 7);
	marcarArea(0, 7, n - 8, n - 1);
	marcarArea(n - 8, n - 1, 0, 7);
	marcarArea(6, 6, 0, n - 1);
	marcarArea(0, n - 1, 6, 6);
	marcarArea(8, 8, 0, 8);
	marcarArea(0, 8, 8, 8);
	marcarArea(8, 8, n - 8, n - 1);
	marcarArea(n - 8, n - 1, 8, 8);
	for (const cy of params.alinhamento) {
		for (const cx of params.alinhamento) {
			if (!((cy <= 8 && cx <= 8) || (cy <= 8 && cx >= n - 9) || (cy >= n - 9 && cx <= 8))) {
				marcarArea(cy - 2, cy + 2, cx - 2, cx + 2);
			}
		}
	}
	if (params.versao >= 7) {
		marcarArea(n - 11, n - 9, 0, 5);
		marcarArea(0, 5, n - 11, n - 9);
	}

	const bits: number[] = [];
	let subindo = true;
	for (let direita = n - 1; direita >= 1; direita -= 2) {
		if (direita === 6) direita = 5;
		for (let passo = 0; passo < n; passo++) {
			const r = subindo ? n - 1 - passo : passo;
			for (let d = 0; d < 2; d++) {
				const c = direita - d;
				if (!funcao[r]![c]) {
					const bruto = matriz[r]![c]!;
					const desmascarado = mascaraAtiva(mascara, r, c) ? !bruto : bruto;
					bits.push(desmascarado ? 1 : 0);
				}
			}
		}
		subindo = !subindo;
	}

	const codewords: number[] = [];
	for (let i = 0; i < params.totalCodewords; i++) {
		let v = 0;
		for (let b = 0; b < 8; b++) v = (v << 1) | bits[i * 8 + b]!;
		codewords.push(v);
	}

	// Desintercala blocos de dados e EC
	const totalBlocos = params.blocosG1 + params.blocosG2;
	const blocosDados: number[][] = Array.from({ length: totalBlocos }, () => []);
	const blocosEc: number[][] = Array.from({ length: totalBlocos }, () => []);
	let pos = 0;
	const maxDados = Math.max(params.dadosG1, params.dadosG2);
	for (let i = 0; i < maxDados; i++) {
		for (let b = 0; b < totalBlocos; b++) {
			const lim = b < params.blocosG1 ? params.dadosG1 : params.dadosG2;
			if (i < lim) blocosDados[b]!.push(codewords[pos++]!);
		}
	}
	for (let i = 0; i < params.ecPorBloco; i++) {
		for (let b = 0; b < totalBlocos; b++) {
			blocosEc[b]!.push(codewords[pos++]!);
		}
	}

	const rsValido = blocosDados.every((d, idx) =>
		verificarSindromeRs([...d, ...blocosEc[idx]!], params.ecPorBloco)
	);

	// Lê stream de dados em modo Byte
	const dadosBytes = blocosDados.flat();
	const streamBits: number[] = [];
	for (const byte of dadosBytes) {
		for (let i = 7; i >= 0; i--) streamBits.push((byte >>> i) & 1);
	}
	let cursor = 0;
	const ler = (qtd: number) => {
		let v = 0;
		for (let i = 0; i < qtd; i++) v = (v << 1) | streamBits[cursor++]!;
		return v;
	};
	expect(ler(4)).toBe(0b0100); // modo Byte
	const len = ler(params.versao <= 9 ? 8 : 16);
	const out = new Uint8Array(len);
	for (let i = 0; i < len; i++) out[i] = ler(8);

	return {
		texto: new TextDecoder().decode(out),
		rsValido,
		nivelEc,
		mascara
	};
}

describe('QR Code ISO/IEC 18004 (src/lib/eventos/qrcode.ts)', () => {
	const FINDER_7X7 = [
		[true, true, true, true, true, true, true],
		[true, false, false, false, false, false, true],
		[true, false, true, true, true, false, true],
		[true, false, true, true, true, false, true],
		[true, false, true, true, true, false, true],
		[true, false, false, false, false, false, true],
		[true, true, true, true, true, true, true]
	];

	function verificarLocalizadores(matriz: boolean[][]) {
		const n = matriz.length;
		const cantos: Array<[number, number]> = [
			[0, 0],
			[0, n - 7],
			[n - 7, 0]
		];
		for (const [r0, c0] of cantos) {
			for (let r = 0; r < 7; r++) {
				for (let c = 0; c < 7; c++) {
					expect(matriz[r0 + r]![c0 + c]).toBe(FINDER_7X7[r]![c]);
				}
			}
		}

		// Separadores brancos ao redor dos 3 localizadores
		for (let i = 0; i < 8; i++) {
			expect(matriz[7]![i]).toBe(false);
			expect(matriz[i]![7]).toBe(false);
			expect(matriz[7]![n - 1 - i]).toBe(false);
			expect(matriz[i]![n - 8]).toBe(false);
			expect(matriz[n - 8]![i]).toBe(false);
			expect(matriz[n - 1 - i]![7]).toBe(false);
		}

		// Padrões de temporização e módulo escuro fixo
		for (let i = 8; i < n - 8; i++) {
			expect(matriz[6]![i]).toBe(i % 2 === 0);
			expect(matriz[i]![6]).toBe(i % 2 === 0);
		}
		expect(matriz[n - 8]![8]).toBe(true);
	}

	it('gera Versão 1 (21x21) com localizadores, formato e decodificação exata', () => {
		const matriz = gerarMatrizQr('Eagles-PG');
		expect(matriz.length).toBe(21);
		for (const linha of matriz) expect(linha.length).toBe(21);

		verificarLocalizadores(matriz);

		const dec = decodificarQrNivelM(matriz, {
			versao: 1,
			totalCodewords: 26,
			ecPorBloco: 10,
			blocosG1: 1,
			dadosG1: 16,
			blocosG2: 0,
			dadosG2: 0,
			alinhamento: []
		});
		expect(dec.nivelEc).toBe(0); // Nível M
		expect(dec.rsValido).toBe(true);
		expect(dec.texto).toBe('Eagles-PG');
	});

	it('codifica token real de 88 caracteres (eagles-checkin-<uuid>-<uuid>) em Versão 6 (41x41) com RS válido', () => {
		const codigo =
			'eagles-checkin-0195a0b1-2345-7678-89ab-cdef01234567-98765432-10fe-4dc0-9ba8-76543210fedc';
		expect(codigo.length).toBe(88);

		const matriz = gerarMatrizQr(codigo);
		const v = 6;
		expect(matriz.length).toBe(21 + 4 * (v - 1));
		verificarLocalizadores(matriz);

		const dec = decodificarQrNivelM(matriz, {
			versao: 6,
			totalCodewords: 172,
			ecPorBloco: 16,
			blocosG1: 4,
			dadosG1: 27,
			blocosG2: 0,
			dadosG2: 0,
			alinhamento: [6, 34]
		});
		expect(dec.rsValido).toBe(true);
		expect(dec.texto).toBe(codigo);
	});

	it('codifica URL completa de check-in (~171 chars) em Versão 9 (53x53) e Versão 10 (57x57) com info de versão e blocos G1/G2', () => {
		const codigo =
			'eagles-checkin-0195a0b1-2345-7678-89ab-cdef01234567-98765432-10fe-4dc0-9ba8-76543210fedc';
		const url = `https://eagles-app-pg.web.app/eventos/0195a0b1-2345-7678-89ab-cdef01234567?checkin=${codigo}`;
		expect(url.length).toBe(171);

		const matrizV9 = gerarMatrizQr(url);
		expect(matrizV9.length).toBe(21 + 4 * (9 - 1));
		verificarLocalizadores(matrizV9);

		const decV9 = decodificarQrNivelM(matrizV9, {
			versao: 9,
			totalCodewords: 292,
			ecPorBloco: 22,
			blocosG1: 3,
			dadosG1: 36,
			blocosG2: 2,
			dadosG2: 37,
			alinhamento: [6, 26, 46]
		});
		expect(decV9.rsValido).toBe(true);
		expect(decV9.texto).toBe(url);

		// Testa também Versão 10 (indicador de comprimento de 16 bits)
		const textoV10 = `${url}&origem=encontro-semanal-dos-eagles`;
		expect(textoV10.length).toBeGreaterThan(180);
		expect(textoV10.length).toBeLessThanOrEqual(213);

		const matrizV10 = gerarMatrizQr(textoV10);
		expect(matrizV10.length).toBe(21 + 4 * (10 - 1));
		verificarLocalizadores(matrizV10);

		const decV10 = decodificarQrNivelM(matrizV10, {
			versao: 10,
			totalCodewords: 346,
			ecPorBloco: 26,
			blocosG1: 4,
			dadosG1: 43,
			blocosG2: 1,
			dadosG2: 44,
			alinhamento: [6, 28, 50]
		});
		expect(decV10.rsValido).toBe(true);
		expect(decV10.texto).toBe(textoV10);
	});

	it('gera SVG nítido com quiet zone branco de 4 módulos e dimensões corretas', () => {
		const codigo =
			'eagles-checkin-0195a0b1-2345-7678-89ab-cdef01234567-98765432-10fe-4dc0-9ba8-76543210fedc';
		const svg = gerarSvgQr(codigo, 260);
		const n = gerarMatrizQr(codigo).length;
		const dimEsperada = n + 8; // 4 módulos de quiet zone em cada lado

		expect(svg).toContain(`viewBox="0 0 ${dimEsperada} ${dimEsperada}"`);
		expect(svg).toContain('width="260"');
		expect(svg).toContain('height="260"');
		expect(svg).toContain('shape-rendering="crispEdges"');
		expect(svg).toContain(`<rect width="${dimEsperada}" height="${dimEsperada}" fill="#FFFFFF"/>`);
		expect(svg).toContain('fill="#000000"');
		// Primeiro módulo escuro do localizador superior esquerdo começa exatamente em (4, 4)
		expect(svg).toContain('M4,4h7v1h-7z');
		// Nunca interpola conteúdo arbitrário no SVG
		expect(svg).not.toContain(codigo);
	});

	it('recusa texto vazio ou acima da capacidade suportada', () => {
		expect(() => gerarMatrizQr('')).toThrow();
		expect(() => gerarMatrizQr('a'.repeat(300))).toThrow(RangeError);
	});

	it('extrai código de check-in de token bruto, URL completa ou caminho relativo', () => {
		const token =
			'eagles-checkin-0195a0b1-2345-7678-89ab-cdef01234567-98765432-10fe-4dc0-9ba8-76543210fedc';

		expect(extrairCodigoCheckin(token)).toBe(token);
		expect(extrairCodigoCheckin(`  ${token}  `)).toBe(token);
		expect(extrairCodigoCheckin(`https://eagles-app-pg.web.app/eventos/123?checkin=${token}`)).toBe(
			token
		);
		expect(
			extrairCodigoCheckin(
				`https://eagles-app-pg.web.app/eventos/123?aba=presenca&checkin=${encodeURIComponent(token)}#qr`
			)
		).toBe(token);
		expect(extrairCodigoCheckin(`/eventos/123?checkin=${token}`)).toBe(token);
		expect(extrairCodigoCheckin(`?checkin=${token}`)).toBe(token);
		expect(extrairCodigoCheckin('   ')).toBe('');
	});
});

import { randomBytes } from 'node:crypto';

/**
 * UUID v7 — identificador ordenável no tempo.
 *
 * Por que não v4: chaves aleatórias espalham as escritas por todo o índice
 * B-tree, o que fragmenta páginas e piora a localidade de cache. O v7 começa
 * com o timestamp em milissegundos, então registros criados juntos ficam
 * juntos no índice.
 *
 * Por que não `bigserial`: um id sequencial visível revela o volume da
 * organização ("somos 47 pessoas") e permite enumerar registros por tentativa.
 *
 * Implementado aqui porque o Postgres só passou a oferecer `uuidv7()` nativo
 * na versão 18, e a produção roda 16.
 *
 * Layout (RFC 9562):
 *   48 bits  timestamp unix em ms
 *    4 bits  versão (0b0111)
 *   12 bits  aleatório
 *    2 bits  variante (0b10)
 *   62 bits  aleatório
 */
export function uuidv7(): string {
	const bytes = randomBytes(16);
	const ms = Date.now();

	// 48 bits de timestamp, big-endian, nos bytes 0..5
	bytes[0] = (ms / 0x10000000000) & 0xff;
	bytes[1] = (ms / 0x100000000) & 0xff;
	bytes[2] = (ms / 0x1000000) & 0xff;
	bytes[3] = (ms / 0x10000) & 0xff;
	bytes[4] = (ms / 0x100) & 0xff;
	bytes[5] = ms & 0xff;

	// versão 7 nos 4 bits altos do byte 6
	bytes[6] = (bytes[6]! & 0x0f) | 0x70;
	// variante RFC 4122 nos 2 bits altos do byte 8
	bytes[8] = (bytes[8]! & 0x3f) | 0x80;

	const hex = bytes.toString('hex');
	return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

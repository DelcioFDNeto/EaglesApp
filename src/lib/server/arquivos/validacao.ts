/**
 * Validação e sanitização segura de uploads (§8, §11, §13, §25).
 *
 * Princípios:
 *   - Limite rígido de 3 MB (bate com o CHECK do banco em `file_asset`).
 *   - O MIME confiável é SEMPRE derivado dos magic bytes reais do arquivo,
 *     nunca da extensão nem apenas do header Content-Type enviado pelo cliente.
 *   - Se o cliente informar um MIME incompatível com os magic bytes, rejeitamos.
 *   - Escopo restringe os tipos aceitos (`perfil_foto` aceita só imagens).
 *   - Nome do arquivo é sanitizado para impedir path traversal e quebra de header.
 */

export const MAX_BYTES = 3 * 1024 * 1024; // 3 MB (3.145.728 bytes)

export const ESCOPOS_VALIDOS = ['perfil_foto', 'comprovante', 'evento_anexo'] as const;
export type EscopoArquivo = (typeof ESCOPOS_VALIDOS)[number];

export const MIMES_PERMITIDOS = [
	'image/jpeg',
	'image/png',
	'image/webp',
	'application/pdf'
] as const;
export type MimePermitido = (typeof MIMES_PERMITIDOS)[number];

export const MIMES_IMAGEM: readonly MimePermitido[] = ['image/jpeg', 'image/png', 'image/webp'];

export const MIMES_POR_ESCOPO: Record<EscopoArquivo, readonly MimePermitido[]> = {
	perfil_foto: MIMES_IMAGEM,
	comprovante: MIMES_PERMITIDOS,
	evento_anexo: MIMES_PERMITIDOS
};

const EXTENSAO_POR_MIME: Record<MimePermitido, string> = {
	'image/jpeg': 'jpg',
	'image/png': 'png',
	'image/webp': 'webp',
	'application/pdf': 'pdf'
};

export const ARQUIVO_URL_INTERNA_RE =
	/^\/api\/arquivos\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function ehEscopoArquivo(valor: unknown): valor is EscopoArquivo {
	return typeof valor === 'string' && (ESCOPOS_VALIDOS as readonly string[]).includes(valor);
}

/**
 * Valida URL de foto de perfil: aceita vazio (para remover), caminho interno
 * seguro `/api/arquivos/<uuid>` ou URL externa `http://`/`https://`.
 */
export function ehUrlFotoValida(valor: string): boolean {
	if (valor === '') return true;
	if (ARQUIVO_URL_INTERNA_RE.test(valor)) return true;
	try {
		const url = new URL(valor);
		return url.protocol === 'https:' || url.protocol === 'http:';
	} catch {
		return false;
	}
}

/**
 * Detecta o MIME real inspecionando os magic bytes iniciais do buffer:
 *   - JPEG: FF D8 FF
 *   - PNG:  89 50 4E 47 0D 0A 1A 0A
 *   - WebP: "RIFF" (0..3) e "WEBP" (8..11)
 *   - PDF:  "%PDF-" (0..4)
 */
export function detectarMimePorMagicBytes(bytes: Uint8Array): MimePermitido | null {
	if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
		return 'image/jpeg';
	}

	if (
		bytes.length >= 8 &&
		bytes[0] === 0x89 &&
		bytes[1] === 0x50 &&
		bytes[2] === 0x4e &&
		bytes[3] === 0x47 &&
		bytes[4] === 0x0d &&
		bytes[5] === 0x0a &&
		bytes[6] === 0x1a &&
		bytes[7] === 0x0a
	) {
		return 'image/png';
	}

	if (
		bytes.length >= 12 &&
		bytes[0] === 0x52 && // R
		bytes[1] === 0x49 && // I
		bytes[2] === 0x46 && // F
		bytes[3] === 0x46 && // F
		bytes[8] === 0x57 && // W
		bytes[9] === 0x45 && // E
		bytes[10] === 0x42 && // B
		bytes[11] === 0x50 // P
	) {
		return 'image/webp';
	}

	if (
		bytes.length >= 5 &&
		bytes[0] === 0x25 && // %
		bytes[1] === 0x50 && // P
		bytes[2] === 0x44 && // D
		bytes[3] === 0x46 && // F
		bytes[4] === 0x2d // -
	) {
		return 'application/pdf';
	}

	return null;
}

/**
 * Sanitiza o nome de arquivo enviado pelo usuário:
 *   - remove separadores de caminho e segmentos de diretório (`/` e `\`)
 *   - remove caracteres de controle (0x00–0x1F, 0x7F)
 *   - mantém apenas caracteres ASCII/latinos seguros (`a-z`, `A-Z`, `0-9`, `À-ÿ`, `.`, `-`, `_`, espaço)
 *   - impede sequências `..` e limita o comprimento a 120 caracteres.
 */
export function sanitizarNomeArquivo(nome: string, mimeFallback?: MimePermitido): string {
	const somenteBase = nome.split(/[/\\]/).pop() ?? '';

	const limpo = somenteBase
		// eslint-disable-next-line no-control-regex
		.replace(/[\u0000-\u001f\u007f]/g, '')
		.replace(/[^a-zA-Z0-9\u00C0-\u00FF._ -]/g, '_')
		.replace(/\.{2,}/g, '.')
		.replace(/\s+/g, ' ')
		.replace(/^[.\s_-]+/, '')
		.replace(/[\s.]+$/, '');

	if (!limpo) {
		const ext = mimeFallback ? `.${EXTENSAO_POR_MIME[mimeFallback]}` : '';
		return `arquivo${ext}`;
	}

	if (limpo.length <= 120) {
		return limpo;
	}

	const ultimoPonto = limpo.lastIndexOf('.');
	if (ultimoPonto > 0 && limpo.length - ultimoPonto <= 10) {
		const ext = limpo.slice(ultimoPonto);
		const base = limpo.slice(0, 120 - ext.length).replace(/[\s.]+$/, '');
		return `${base || 'arquivo'}${ext}`;
	}

	return limpo.slice(0, 120).replace(/[\s.]+$/, '') || 'arquivo';
}

/**
 * Gera valor seguro para o cabeçalho `Content-Disposition: inline` (RFC 6266).
 * O parâmetro `filename` usa apenas ASCII seguro para evitar erro de ByteString.
 */
export function cabecalhoContentDisposition(filename: string): string {
	const seguro = sanitizarNomeArquivo(filename);
	const ascii =
		seguro
			.normalize('NFD')
			.replace(/[\u0300-\u036f]/g, '')
			.replace(/[^a-zA-Z0-9._ -]/g, '_')
			.trim() || 'arquivo';

	if (ascii === seguro) {
		return `inline; filename="${ascii}"`;
	}
	return `inline; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(seguro)}`;
}

function normalizarMimeDeclarado(mimeType: string | undefined | null): string | null {
	if (!mimeType) return null;
	const base = mimeType.split(';')[0]?.trim().toLowerCase() ?? '';
	if (!base || base === 'application/octet-stream') return null;
	if (base === 'image/jpg') return 'image/jpeg';
	return base;
}

export type ResultadoValidacaoArquivo =
	| {
			ok: true;
			bytes: Uint8Array;
			dataBase64: string;
			mimeType: MimePermitido;
			filename: string;
			sizeBytes: number;
	  }
	| {
			ok: false;
			erro: string;
	  };

/**
 * Valida conteúdo binário, tamanho, magic bytes, coerência de MIME e escopo.
 */
export function validarArquivo(params: {
	bytes: Uint8Array;
	filename: string;
	mimeType?: string | null;
	scope: EscopoArquivo;
}): ResultadoValidacaoArquivo {
	const { bytes, filename, mimeType, scope } = params;

	if (bytes.length === 0) {
		return { ok: false, erro: 'O arquivo enviado está vazio.' };
	}

	if (bytes.length > MAX_BYTES) {
		return { ok: false, erro: 'O arquivo excede o limite máximo de 3 MB.' };
	}

	const mimeReal = detectarMimePorMagicBytes(bytes);
	if (!mimeReal) {
		return {
			ok: false,
			erro: 'Formato de arquivo não permitido ou conteúdo incompatível com um arquivo válido.'
		};
	}

	const mimeDeclarado = normalizarMimeDeclarado(mimeType);
	if (mimeDeclarado && mimeDeclarado !== mimeReal) {
		return {
			ok: false,
			erro: 'O tipo MIME informado não corresponde ao conteúdo real do arquivo.'
		};
	}

	if (!MIMES_POR_ESCOPO[scope].includes(mimeReal)) {
		return {
			ok: false,
			erro:
				scope === 'perfil_foto'
					? 'Foto de perfil aceita apenas imagens JPEG, PNG ou WebP.'
					: 'Tipo de arquivo não permitido para este escopo.'
		};
	}

	const nomeSeguro = sanitizarNomeArquivo(filename, mimeReal);
	const dataBase64 = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString(
		'base64'
	);

	return {
		ok: true,
		bytes,
		dataBase64,
		mimeType: mimeReal,
		filename: nomeSeguro,
		sizeBytes: bytes.length
	};
}

export type DecodificacaoBase64 = { ok: true; bytes: Uint8Array } | { ok: false; erro: string };

const MAX_BASE64_CHARS = Math.ceil((MAX_BYTES + 1) * (4 / 3)) + 16;

/**
 * Decodifica string base64 (com ou sem prefixo data URI), rejeitando payloads
 * vazios, malformados ou maiores que 3 MB antes de alocar grandes buffers.
 */
export function decodificarBase64(bruto: string): DecodificacaoBase64 {
	const semPrefixo = bruto.trim().replace(/^data:[a-z0-9/+.-]+;base64,/i, '');
	const limpo = semPrefixo.replace(/\s+/g, '');

	if (limpo.length === 0) {
		return { ok: false, erro: 'O arquivo enviado está vazio.' };
	}

	if (limpo.length > MAX_BASE64_CHARS) {
		return { ok: false, erro: 'O arquivo excede o limite máximo de 3 MB.' };
	}

	if (limpo.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(limpo)) {
		return { ok: false, erro: 'Conteúdo do arquivo em base64 inválido.' };
	}

	const buf = Buffer.from(limpo, 'base64');
	if (buf.length === 0) {
		return { ok: false, erro: 'O arquivo enviado está vazio.' };
	}

	if (buf.length > MAX_BYTES) {
		return { ok: false, erro: 'O arquivo excede o limite máximo de 3 MB.' };
	}

	return { ok: true, bytes: new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength) };
}

export type EntradaUploadBruta =
	| {
			ok: true;
			bytes: Uint8Array;
			filename: string;
			mimeType: string | null;
			scope?: unknown;
			titulo?: string;
	  }
	| {
			ok: false;
			erro: string;
	  };

/**
 * Lê upload tanto de `multipart/form-data` (navegador) quanto de JSON
 * (`{ filename, mimeType?, dataBase64, scope?, titulo? }`).
 */
export async function lerEntradaUpload(request: Request): Promise<EntradaUploadBruta> {
	const contentType = request.headers.get('content-type')?.toLowerCase() ?? '';

	if (contentType.includes('multipart/form-data')) {
		let formData: FormData;
		try {
			formData = await request.formData();
		} catch {
			return { ok: false, erro: 'Formulário de envio inválido.' };
		}

		const entradaArquivo = formData.get('file');
		if (!entradaArquivo || typeof entradaArquivo === 'string') {
			return { ok: false, erro: 'Nenhum arquivo foi enviado.' };
		}

		if (entradaArquivo.size === 0) {
			return { ok: false, erro: 'O arquivo enviado está vazio.' };
		}
		if (entradaArquivo.size > MAX_BYTES) {
			return { ok: false, erro: 'O arquivo excede o limite máximo de 3 MB.' };
		}

		const scopeRaw = formData.get('scope');
		const tituloRaw = formData.get('titulo');
		const bytes = new Uint8Array(await entradaArquivo.arrayBuffer());

		return {
			ok: true,
			bytes,
			filename: entradaArquivo.name || 'arquivo',
			mimeType: entradaArquivo.type || null,
			scope: typeof scopeRaw === 'string' ? scopeRaw.trim() : undefined,
			titulo: typeof tituloRaw === 'string' ? tituloRaw.trim() : undefined
		};
	}

	let corpo: unknown;
	try {
		corpo = await request.json();
	} catch {
		return { ok: false, erro: 'Corpo da requisição inválido.' };
	}

	if (!corpo || typeof corpo !== 'object') {
		return { ok: false, erro: 'Corpo da requisição inválido.' };
	}

	const obj = corpo as Record<string, unknown>;
	if (typeof obj.dataBase64 !== 'string') {
		return { ok: false, erro: 'Campo dataBase64 é obrigatório.' };
	}

	const decodificado = decodificarBase64(obj.dataBase64);
	if (!decodificado.ok) {
		return decodificado;
	}

	const filename = typeof obj.filename === 'string' ? obj.filename : 'arquivo';
	const mimeType = typeof obj.mimeType === 'string' ? obj.mimeType : null;
	const titulo = typeof obj.titulo === 'string' ? obj.titulo.trim() : undefined;

	return {
		ok: true,
		bytes: decodificado.bytes,
		filename,
		mimeType,
		scope: obj.scope,
		titulo
	};
}

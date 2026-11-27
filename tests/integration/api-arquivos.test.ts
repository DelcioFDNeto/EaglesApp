/**
 * Testes de integração reais de Upload Seguro de Arquivos & Anexos de Evento
 * (§8 anexos, §11 foto de perfil, §13 comprovantes, §25 segurança de uploads) contra PGlite.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { and, desc, eq } from 'drizzle-orm';
import { criarBancoDeTeste, type BancoDeTeste } from './helpers/banco';
import { setTestDatabase } from '../../src/lib/server/db';
import {
	auditLog,
	event as eventTable,
	eventType,
	group as groupTable,
	person as personTable,
	personRole as personRoleTable,
	team as teamTable,
	userAccount as userAccountTable
} from '../../src/lib/server/db/schema';
import { hashPassword } from '../../src/lib/server/auth/password';
import { tokenPara } from './helpers/token';
import { resetEnvCache } from '../../src/lib/server/env';
import {
	MAX_BYTES,
	detectarMimePorMagicBytes,
	sanitizarNomeArquivo
} from '../../src/lib/server/arquivos/validacao';

import * as arquivosRoute from '../../src/routes/api/arquivos/+server';
import * as arquivoRoute from '../../src/routes/api/arquivos/[id]/+server';
import * as eventoAnexosRoute from '../../src/routes/api/eventos/[id]/anexos/+server';
import * as eventoAnexoRoute from '../../src/routes/api/eventos/[id]/anexos/[anexoId]/+server';
import * as perfilMeRoute from '../../src/routes/api/pessoas/me/+server';

const hashDeTeste = hashPassword('senha12345');

// Payloads binários mínimos com magic bytes reais.
const PNG_VALIDO = new Uint8Array([
	0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
	0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4,
	0x89
]);

const JPEG_VALIDO = new Uint8Array([
	0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0xff, 0xd9
]);

const WEBP_VALIDO = new Uint8Array([
	0x52, 0x49, 0x46, 0x46, 0x10, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50, 0x56, 0x50, 0x38, 0x20
]);

const PDF_VALIDO = new TextEncoder().encode(
	'%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\n%%EOF\n'
);

function toBase64(bytes: Uint8Array): string {
	return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString('base64');
}

function reqJson(method: string, path: string, token: string, body?: unknown): Request {
	return new Request(`https://app.eagles.test${path}`, {
		method,
		headers: {
			'Content-Type': 'application/json',
			Authorization: `Bearer ${token}`
		},
		body: body !== undefined ? JSON.stringify(body) : undefined
	});
}

function reqMultipart(path: string, token: string, formData: FormData): Request {
	return new Request(`https://app.eagles.test${path}`, {
		method: 'POST',
		headers: {
			Authorization: `Bearer ${token}`
		},
		body: formData
	});
}

let ctx: BancoDeTeste;
let liderId: string;
let conselheiroAId: string;
let membroId: string;
let menorId: string;
let visitanteId: string;
let outraEquipeLiderId: string;

let tokenLider: string;
let tokenConselheiroA: string;
let tokenMembro: string;
let tokenMenor: string;
let tokenVisitante: string;
let tokenOutraEquipe: string;

let pgAId: string;
let pgBId: string;
let eventoPgAId: string;
let eventoPgBId: string;

async function criarPessoa(params: {
	teamId?: string;
	nome: string;
	email: string;
	roleId: string;
	scopeType: 'global' | 'group' | 'self';
	scopeId?: string | null;
	birthDate?: string | null;
}) {
	const [p] = await ctx.db
		.insert(personTable)
		.values({
			teamId: params.teamId ?? ctx.teamId,
			fullName: params.nome,
			birthDate: params.birthDate ?? null
		})
		.returning({ id: personTable.id });

	await ctx.db.insert(userAccountTable).values({
		personId: p!.id,
		email: params.email,
		passwordHash: await hashDeTeste
	});

	await ctx.db.insert(personRoleTable).values({
		personId: p!.id,
		roleId: params.roleId,
		scopeType: params.scopeType,
		scopeId: params.scopeId ?? null
	});

	return p!.id;
}

describe('§8 / §11 / §25 — Uploads seguros, foto de perfil e anexos de evento', () => {
	beforeAll(async () => {
		process.env.DATABASE_URL = 'postgres://teste@localhost:5432/teste';
		process.env.PUBLIC_ORIGIN = 'https://app.eagles.test';
		process.env.NODE_ENV = 'test';
		resetEnvCache();

		ctx = await criarBancoDeTeste();
		setTestDatabase(ctx.db);

		const grupos = await ctx.db
			.insert(groupTable)
			.values([
				{ teamId: ctx.teamId, name: 'PG Águia', slug: 'pg-aguia' },
				{ teamId: ctx.teamId, name: 'PG Falcão', slug: 'pg-falcao' }
			])
			.returning({ id: groupTable.id });
		pgAId = grupos[0]!.id;
		pgBId = grupos[1]!.id;

		const [tipo] = await ctx.db
			.insert(eventType)
			.values({ teamId: ctx.teamId, name: 'Encontro', slug: 'encontro' })
			.returning({ id: eventType.id });

		const amanha = new Date(Date.now() + 86_400_000);
		const eventos = await ctx.db
			.insert(eventTable)
			.values([
				{
					teamId: ctx.teamId,
					eventTypeId: tipo!.id,
					groupId: pgAId,
					title: 'Encontro PG Águia',
					startsAt: amanha
				},
				{
					teamId: ctx.teamId,
					eventTypeId: tipo!.id,
					groupId: pgBId,
					title: 'Encontro PG Falcão',
					startsAt: amanha
				}
			])
			.returning({ id: eventTable.id });
		eventoPgAId = eventos[0]!.id;
		eventoPgBId = eventos[1]!.id;

		// Data de nascimento de 17 anos atrás (sempre < 18, independente do ano de execução).
		const hoje = new Date();
		const anoMenor = hoje.getFullYear() - 17;
		const mes = String(hoje.getMonth() + 1).padStart(2, '0');
		const dia = String(Math.min(hoje.getDate(), 28)).padStart(2, '0');
		const nascimentoMenor = `${anoMenor}-${mes}-${dia}`;

		liderId = await criarPessoa({
			nome: 'Líder Ana',
			email: 'lider@eagles.test',
			roleId: ctx.papeis.lider!,
			scopeType: 'global',
			birthDate: '1995-05-10'
		});
		conselheiroAId = await criarPessoa({
			nome: 'Conselheiro Carlos',
			email: 'conselheiro@eagles.test',
			roleId: ctx.papeis.conselheiro!,
			scopeType: 'group',
			scopeId: pgAId,
			birthDate: '1997-03-20'
		});
		membroId = await criarPessoa({
			nome: 'Membro Lucas',
			email: 'membro@eagles.test',
			roleId: ctx.papeis.membro!,
			scopeType: 'self',
			birthDate: '2000-08-15'
		});
		menorId = await criarPessoa({
			nome: 'Jovem Menor',
			email: 'menor@eagles.test',
			roleId: ctx.papeis.membro!,
			scopeType: 'self',
			birthDate: nascimentoMenor
		});
		visitanteId = await criarPessoa({
			nome: 'Visitante Pedro',
			email: 'visitante@eagles.test',
			roleId: ctx.papeis.visitante!,
			scopeType: 'self'
		});

		const [outraEquipe] = await ctx.db
			.insert(teamTable)
			.values({ slug: 'bears', name: 'Bears' })
			.returning({ id: teamTable.id });
		outraEquipeLiderId = await criarPessoa({
			teamId: outraEquipe!.id,
			nome: 'Líder Bears',
			email: 'lider@bears.test',
			roleId: ctx.papeis.lider!,
			scopeType: 'global'
		});

		tokenLider = await tokenPara(ctx.db, liderId);
		tokenConselheiroA = await tokenPara(ctx.db, conselheiroAId);
		tokenMembro = await tokenPara(ctx.db, membroId);
		tokenMenor = await tokenPara(ctx.db, menorId);
		tokenVisitante = await tokenPara(ctx.db, visitanteId);
		tokenOutraEquipe = await tokenPara(ctx.db, outraEquipeLiderId);
	}, 60_000);

	afterAll(async () => {
		setTestDatabase(null);
		await ctx?.fechar();
	});

	it('valida magic bytes e sanitiza nomes de arquivo contra path traversal e controle', () => {
		expect(detectarMimePorMagicBytes(JPEG_VALIDO)).toBe('image/jpeg');
		expect(detectarMimePorMagicBytes(PNG_VALIDO)).toBe('image/png');
		expect(detectarMimePorMagicBytes(WEBP_VALIDO)).toBe('image/webp');
		expect(detectarMimePorMagicBytes(PDF_VALIDO)).toBe('application/pdf');
		expect(
			detectarMimePorMagicBytes(new TextEncoder().encode('<script>alert(1)</script>'))
		).toBeNull();

		expect(sanitizarNomeArquivo('../../etc/passwd')).toBe('passwd');
		expect(sanitizarNomeArquivo('C:\\temp\\foto\r\n"evil;.png')).toBe('foto_evil_.png');
		const nomeLongo = `${'a'.repeat(150)}.pdf`;
		const sanitizado = sanitizarNomeArquivo(nomeLongo);
		expect(sanitizado.length).toBeLessThanOrEqual(120);
		expect(sanitizado.endsWith('.pdf')).toBe(true);
	});

	it('rejeita .jpg falsificado com texto/HTML, MIME divergente, arquivo vazio, > 3 MB e PDF em perfil_foto (400)', async () => {
		// 1. Spoofed .jpg contendo script HTML
		const htmlMalicioso = new TextEncoder().encode('<html><script>alert(1)</script></html>');
		const resSpoof = await arquivosRoute.POST({
			request: reqJson('POST', '/api/arquivos', tokenMembro, {
				scope: 'perfil_foto',
				filename: 'avatar.jpg',
				mimeType: 'image/jpeg',
				dataBase64: toBase64(htmlMalicioso)
			}),
			locals: {}
		} as any);
		expect(resSpoof.status).toBe(400);

		// 2. MIME informado diverge dos magic bytes reais (diz JPEG, mas é PNG)
		const resMismatch = await arquivosRoute.POST({
			request: reqJson('POST', '/api/arquivos', tokenMembro, {
				scope: 'perfil_foto',
				filename: 'foto.jpg',
				mimeType: 'image/jpeg',
				dataBase64: toBase64(PNG_VALIDO)
			}),
			locals: {}
		} as any);
		expect(resMismatch.status).toBe(400);

		// 3. Arquivo vazio
		const resVazio = await arquivosRoute.POST({
			request: reqJson('POST', '/api/arquivos', tokenMembro, {
				scope: 'perfil_foto',
				filename: 'vazio.png',
				dataBase64: ''
			}),
			locals: {}
		} as any);
		expect(resVazio.status).toBe(400);

		// 4. Acima de 3 MB (via multipart e via JSON)
		const gigante = new Uint8Array(MAX_BYTES + 10);
		gigante.set(PNG_VALIDO, 0);
		const fdGigante = new FormData();
		fdGigante.append('scope', 'perfil_foto');
		fdGigante.append('file', new File([gigante], 'enorme.png', { type: 'image/png' }));

		const resGiganteMultipart = await arquivosRoute.POST({
			request: reqMultipart('/api/arquivos', tokenMembro, fdGigante),
			locals: {}
		} as any);
		expect(resGiganteMultipart.status).toBe(400);

		const resGiganteJson = await arquivosRoute.POST({
			request: reqJson('POST', '/api/arquivos', tokenMembro, {
				scope: 'perfil_foto',
				filename: 'enorme.png',
				dataBase64: toBase64(gigante)
			}),
			locals: {}
		} as any);
		expect(resGiganteJson.status).toBe(400);

		// 5. PDF recusado para perfil_foto (só imagens)
		const resPdfPerfil = await arquivosRoute.POST({
			request: reqJson('POST', '/api/arquivos', tokenMembro, {
				scope: 'perfil_foto',
				filename: 'documento.pdf',
				mimeType: 'application/pdf',
				dataBase64: toBase64(PDF_VALIDO)
			}),
			locals: {}
		} as any);
		expect(resPdfPerfil.status).toBe(400);
	});

	it('envia PNG válido de perfil_foto, salva /api/arquivos/<id> em PUT /api/pessoas/me e baixa bytes brutos com nosniff', async () => {
		const fd = new FormData();
		fd.append('scope', 'perfil_foto');
		fd.append('file', new File([PNG_VALIDO], '../minha foto.png', { type: 'image/png' }));

		const resUpload = await arquivosRoute.POST({
			request: reqMultipart('/api/arquivos', tokenMembro, fd),
			locals: {}
		} as any);
		expect(resUpload.status).toBe(201);
		const dadosUpload = await resUpload.json();
		expect(dadosUpload.ok).toBe(true);
		expect(dadosUpload.arquivo.mimeType).toBe('image/png');
		expect(dadosUpload.arquivo.sizeBytes).toBe(PNG_VALIDO.byteLength);
		expect(dadosUpload.arquivo.filename).toBe('minha foto.png');
		expect(dadosUpload.arquivo.url).toBe(`/api/arquivos/${dadosUpload.arquivo.id}`);

		const arquivoId = dadosUpload.arquivo.id as string;
		const urlInterna = dadosUpload.arquivo.url as string;

		// Auditoria registrou file.enviado
		const [logEnvio] = await ctx.db
			.select()
			.from(auditLog)
			.where(and(eq(auditLog.entityId, arquivoId), eq(auditLog.action, 'file.enviado')))
			.orderBy(desc(auditLog.at))
			.limit(1);
		expect(logEnvio?.actorPersonId).toBe(membroId);

		// Salva caminho relativo /api/arquivos/<uuid> via PUT /api/pessoas/me
		const resPerfil = await perfilMeRoute.PUT({
			request: reqJson('PUT', '/api/pessoas/me', tokenMembro, {
				fotoUrl: urlInterna
			}),
			locals: {}
		} as any);
		expect(resPerfil.status).toBe(200);

		const resMe = await perfilMeRoute.GET({
			request: reqJson('GET', '/api/pessoas/me', tokenMembro),
			locals: {}
		} as any);
		expect(resMe.status).toBe(200);
		expect((await resMe.json()).perfil.fotoUrl).toBe(urlInterna);

		// PUT /api/pessoas/me rejeita esquema perigoso e caminho relativo inválido
		const resJsUrl = await perfilMeRoute.PUT({
			request: reqJson('PUT', '/api/pessoas/me', tokenMembro, {
				fotoUrl: 'javascript:alert(1)'
			}),
			locals: {}
		} as any);
		expect(resJsUrl.status).toBe(400);

		const resCaminhoRuim = await perfilMeRoute.PUT({
			request: reqJson('PUT', '/api/pessoas/me', tokenMembro, {
				fotoUrl: '/api/arquivos/nao-e-uuid'
			}),
			locals: {}
		} as any);
		expect(resCaminhoRuim.status).toBe(400);

		// Download retorna bytes exatos com cabeçalhos de segurança
		const resDownload = await arquivoRoute.GET({
			request: reqJson('GET', urlInterna, tokenMembro),
			params: { id: arquivoId },
			locals: {}
		} as any);
		expect(resDownload.status).toBe(200);
		expect(resDownload.headers.get('content-type')).toBe('image/png');
		expect(resDownload.headers.get('x-content-type-options')).toBe('nosniff');
		expect(resDownload.headers.get('content-disposition')).toContain('inline; filename=');
		expect(resDownload.headers.get('cache-control')).toBe('private, max-age=3600');

		const baixado = new Uint8Array(await resDownload.arrayBuffer());
		expect(baixado).toEqual(PNG_VALIDO);

		// Outra equipe não acessa o arquivo (404)
		const resOutraEquipe = await arquivoRoute.GET({
			request: reqJson('GET', urlInterna, tokenOutraEquipe),
			params: { id: arquivoId },
			locals: {}
		} as any);
		expect(resOutraEquipe.status).toBe(404);

		// Visitante não tem person.view → 403 em perfil_foto
		const resVisitanteFoto = await arquivoRoute.GET({
			request: reqJson('GET', urlInterna, tokenVisitante),
			params: { id: arquivoId },
			locals: {}
		} as any);
		expect(resVisitanteFoto.status).toBe(403);

		// Remoção pelo próprio autor funciona e registra auditoria file.removido
		const resDel = await arquivoRoute.DELETE({
			request: reqJson('DELETE', urlInterna, tokenMembro),
			params: { id: arquivoId },
			locals: {}
		} as any);
		expect(resDel.status).toBe(200);

		const [logRem] = await ctx.db
			.select()
			.from(auditLog)
			.where(and(eq(auditLog.entityId, arquivoId), eq(auditLog.action, 'file.removido')))
			.limit(1);
		expect(logRem?.actorPersonId).toBe(membroId);
	});

	it('envia, lista, baixa e remove anexo PDF em evento com controle de permissões e escopo de grupo', async () => {
		// Membro NÃO pode enviar anexo (403)
		const resMembroPost = await eventoAnexosRoute.POST({
			request: reqJson('POST', `/api/eventos/${eventoPgAId}/anexos`, tokenMembro, {
				filename: 'roteiro.pdf',
				titulo: 'Roteiro do Encontro',
				dataBase64: toBase64(PDF_VALIDO)
			}),
			params: { id: eventoPgAId },
			locals: {}
		} as any);
		expect(resMembroPost.status).toBe(403);

		// Conselheiro do PG A NÃO pode anexar no evento do PG B (403)
		const resConselheiroOutroPg = await eventoAnexosRoute.POST({
			request: reqJson('POST', `/api/eventos/${eventoPgBId}/anexos`, tokenConselheiroA, {
				filename: 'roteiro.pdf',
				dataBase64: toBase64(PDF_VALIDO)
			}),
			params: { id: eventoPgBId },
			locals: {}
		} as any);
		expect(resConselheiroOutroPg.status).toBe(403);

		// Conselheiro do PG A envia PDF no evento do PG A (201)
		const resPost = await eventoAnexosRoute.POST({
			request: reqJson('POST', `/api/eventos/${eventoPgAId}/anexos`, tokenConselheiroA, {
				filename: 'roteiro-acampamento.pdf',
				titulo: 'Roteiro Oficial',
				mimeType: 'application/pdf',
				dataBase64: toBase64(PDF_VALIDO)
			}),
			params: { id: eventoPgAId },
			locals: {}
		} as any);
		expect(resPost.status).toBe(201);
		const criado = (await resPost.json()).anexo;
		expect(criado.titulo).toBe('Roteiro Oficial');
		expect(criado.mimeType).toBe('application/pdf');
		expect(criado.url).toBe(`/api/arquivos/${criado.fileAssetId}`);

		// Membro lista anexos (200) e baixa o PDF (200)
		const resListaMembro = await eventoAnexosRoute.GET({
			request: reqJson('GET', `/api/eventos/${eventoPgAId}/anexos`, tokenMembro),
			params: { id: eventoPgAId },
			locals: {}
		} as any);
		expect(resListaMembro.status).toBe(200);
		const lista = (await resListaMembro.json()).anexos;
		expect(lista).toHaveLength(1);
		expect(lista[0].id).toBe(criado.id);

		const resDownloadMembro = await arquivoRoute.GET({
			request: reqJson('GET', criado.url, tokenMembro),
			params: { id: criado.fileAssetId },
			locals: {}
		} as any);
		expect(resDownloadMembro.status).toBe(200);
		expect(resDownloadMembro.headers.get('content-type')).toBe('application/pdf');
		expect(resDownloadMembro.headers.get('x-content-type-options')).toBe('nosniff');
		expect(new Uint8Array(await resDownloadMembro.arrayBuffer())).toEqual(PDF_VALIDO);

		// Membro NÃO pode remover anexo (403)
		const resMembroDel = await eventoAnexoRoute.DELETE({
			request: reqJson('DELETE', `/api/eventos/${eventoPgAId}/anexos/${criado.id}`, tokenMembro),
			params: { id: eventoPgAId, anexoId: criado.id },
			locals: {}
		} as any);
		expect(resMembroDel.status).toBe(403);

		// Líder remove anexo (200) e tanto anexo quanto file_asset somem
		const resLiderDel = await eventoAnexoRoute.DELETE({
			request: reqJson('DELETE', `/api/eventos/${eventoPgAId}/anexos/${criado.id}`, tokenLider),
			params: { id: eventoPgAId, anexoId: criado.id },
			locals: {}
		} as any);
		expect(resLiderDel.status).toBe(200);

		const resListaDepois = await eventoAnexosRoute.GET({
			request: reqJson('GET', `/api/eventos/${eventoPgAId}/anexos`, tokenMembro),
			params: { id: eventoPgAId },
			locals: {}
		} as any);
		expect((await resListaDepois.json()).anexos).toHaveLength(0);

		const resDownloadDepois = await arquivoRoute.GET({
			request: reqJson('GET', criado.url, tokenLider),
			params: { id: criado.fileAssetId },
			locals: {}
		} as any);
		expect(resDownloadDepois.status).toBe(404);

		// Auditoria registrou adição e remoção
		const logsAnexo = await ctx.db
			.select({ action: auditLog.action })
			.from(auditLog)
			.where(eq(auditLog.entityId, criado.id));
		const acoes = logsAnexo.map((l) => l.action);
		expect(acoes).toContain('event.anexo_adicionado');
		expect(acoes).toContain('event.anexo_removido');
	});

	it('bloqueia menor de 18 anos ao tentar enviar perfil_foto (ADR 0003 → 400)', async () => {
		const resMenor = await arquivosRoute.POST({
			request: reqJson('POST', '/api/arquivos', tokenMenor, {
				scope: 'perfil_foto',
				filename: 'selfie.png',
				mimeType: 'image/png',
				dataBase64: toBase64(PNG_VALIDO)
			}),
			locals: {}
		} as any);
		expect(resMenor.status).toBe(400);
	});

	it('bloqueia visitante ao tentar baixar ou enviar comprovante financeiro (403)', async () => {
		// Visitante não pode enviar comprovante (403)
		const resVisUpload = await arquivosRoute.POST({
			request: reqJson('POST', '/api/arquivos', tokenVisitante, {
				scope: 'comprovante',
				filename: 'pix.pdf',
				dataBase64: toBase64(PDF_VALIDO)
			}),
			locals: {}
		} as any);
		expect(resVisUpload.status).toBe(403);

		// Líder envia comprovante válido (201)
		const resLiderUpload = await arquivosRoute.POST({
			request: reqJson('POST', '/api/arquivos', tokenLider, {
				scope: 'comprovante',
				filename: 'comprovante-pix.pdf',
				mimeType: 'application/pdf',
				dataBase64: toBase64(PDF_VALIDO)
			}),
			locals: {}
		} as any);
		expect(resLiderUpload.status).toBe(201);
		const comp = (await resLiderUpload.json()).arquivo;

		// Visitante é bloqueado no download do comprovante (403)
		const resVisDownload = await arquivoRoute.GET({
			request: reqJson('GET', comp.url, tokenVisitante),
			params: { id: comp.id },
			locals: {}
		} as any);
		expect(resVisDownload.status).toBe(403);

		// Líder baixa normalmente (200)
		const resLiderDownload = await arquivoRoute.GET({
			request: reqJson('GET', comp.url, tokenLider),
			params: { id: comp.id },
			locals: {}
		} as any);
		expect(resLiderDownload.status).toBe(200);
		expect(resLiderDownload.headers.get('x-content-type-options')).toBe('nosniff');
	});
});

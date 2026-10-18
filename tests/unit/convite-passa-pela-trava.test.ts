/**
 * Guarda de arquitetura: o aceite de convite passa pela trava 5.
 *
 * `lookupInvite` e `aceitarConvite` (auth) só conhecem o token. Quem confere
 * se o emissor AINDA poderia emitir — o membro convidado pode ter virado líder
 * desde então — é `abrirConvite` / `aceitarConviteDeAcesso`, em
 * `rbac/convites`. Uma rota que chamasse o auth direto reabriria o atalho que
 * a revisão de 17/10/2026 fechou, sem nenhum teste de integração perceber: eles
 * testam os serviços, não o import da rota.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

const RAIZ_ROTAS = join(process.cwd(), 'src', 'routes');

function arquivos(dir: string): string[] {
	return readdirSync(dir).flatMap((nome) => {
		const caminho = join(dir, nome);
		if (statSync(caminho).isDirectory()) return arquivos(caminho);
		return /\.(ts|svelte)$/.test(nome) ? [caminho] : [];
	});
}

describe('o aceite de convite passa pela trava 5', () => {
	it('nenhuma rota chama lookupInvite ou aceitarConvite direto do auth', () => {
		const atalhos = arquivos(RAIZ_ROTAS).filter((arquivo) =>
			/\b(lookupInvite|aceitarConvite)\b/.test(readFileSync(arquivo, 'utf8'))
		);
		expect(
			atalhos.map((a) => relative(RAIZ_ROTAS, a)),
			'use abrirConvite / aceitarConviteDeAcesso, de $server/modules/rbac/convites'
		).toEqual([]);
	});
});

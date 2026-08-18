import { json } from '@sveltejs/kit';
import { sql } from 'drizzle-orm';
import { db } from '$server/db';
import type { RequestHandler } from './$types';

/**
 * Verificação de saúde.
 *
 * PERMISSÃO: pública por necessidade — o Caddy, o CI e o Uptime Kuma
 * consultam sem credencial.
 *
 * Por isso não devolve versão, host, contagem de registros nem nada que ajude
 * alguém a mapear o sistema. Só responde "de pé" ou "não".
 */
export const GET: RequestHandler = async () => {
	const inicio = Date.now();

	try {
		await db().execute(sql`select 1`);
	} catch {
		return json({ status: 'degradado', banco: false }, { status: 503 });
	}

	return json(
		{ status: 'ok', banco: true, latenciaMs: Date.now() - inicio },
		{ headers: { 'cache-control': 'no-store' } }
	);
};

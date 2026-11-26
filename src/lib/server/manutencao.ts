import { and, isNotNull, lt, or } from 'drizzle-orm';
import type { Database } from './db';
import { senhaReset } from './db/schema';
import { pruneSessions } from './auth/session';
import { pruneRateLimits } from './auth/ratelimit';

/**
 * Limpeza periódica da API.
 *
 * Sem isto, duas coisas só cresciam enquanto a API estivesse no ar:
 *   - o mapa do rate limit em memória (uma entrada por IP e por e-mail
 *     tentado — um ataque de força bruta o faria crescer sem limite);
 *   - as tabelas de sessões e de links de redefinição de senha.
 *
 * Roda dentro do próprio processo da API (iniciado em `hooks.server.ts`): para
 * uma VPS com uma instância, uma fila externa (pg-boss) seria peça a mais para
 * operar sem ganho. Cada tarefa é idempotente — duas instâncias rodando a mesma
 * limpeza não causam problema.
 */

const A_CADA_10_MIN = 10 * 60_000;
const A_CADA_6_H = 6 * 60 * 60_000;
const DIAS_GUARDAR_RESET = 7;

export type ResultadoLimpeza = { sessoes: number; linksDeSenha: number };

/** Remove o que já não serve a ninguém no banco. */
export async function limparBanco(db: Database): Promise<ResultadoLimpeza> {
	const sessoes = await pruneSessions(db);

	// Link de redefinição usado ou vencido há mais de 7 dias: só ocupa espaço.
	const corte = new Date(Date.now() - DIAS_GUARDAR_RESET * 86_400_000);
	const links = await db
		.delete(senhaReset)
		.where(
			or(
				lt(senhaReset.expiresAt, corte),
				and(isNotNull(senhaReset.usedAt), lt(senhaReset.usedAt, corte))
			)
		)
		.returning({ id: senhaReset.id });

	return { sessoes, linksDeSenha: links.length };
}

let timers: ReturnType<typeof setInterval>[] = [];

/**
 * Agenda as limpezas. Chamar de novo não duplica os agendamentos.
 * Os timers não seguram o processo vivo (`unref`): parar a API é imediato.
 */
export function iniciarManutencao(banco: () => Database): void {
	if (timers.length > 0) return;

	const memoria = setInterval(() => {
		const removidos = pruneRateLimits();
		if (removidos > 0)
			console.log(`[MANUTENÇÃO] rate limit: ${removidos} entradas ociosas removidas`);
	}, A_CADA_10_MIN);

	const rodarBanco = async () => {
		try {
			const r = await limparBanco(banco());
			if (r.sessoes + r.linksDeSenha > 0) {
				console.log(
					`[MANUTENÇÃO] ${r.sessoes} sessões e ${r.linksDeSenha} links de senha antigos removidos`
				);
			}
		} catch (erro) {
			console.error('[MANUTENÇÃO] falha na limpeza do banco', erro);
		}
	};

	// Primeira rodada um minuto depois de subir: não disputa com as migrações
	// nem atrasa as primeiras requisições.
	const primeira = setTimeout(rodarBanco, 60_000);
	const banco6h = setInterval(rodarBanco, A_CADA_6_H);

	for (const t of [memoria, primeira, banco6h]) t.unref?.();
	timers = [memoria, primeira as unknown as ReturnType<typeof setInterval>, banco6h];
}

/** Apenas para testes. */
export function pararManutencao(): void {
	for (const t of timers) clearInterval(t);
	timers = [];
}

import { fail, redirect } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '$server/db';
import { userAccount } from '$server/db/schema';
import { chaveDoIdentificador, encontrarContaPorIdentificador } from '$server/auth/conta';
import { verifyPassword, hashPassword, needsRehash } from '$server/auth/password';
import { createSession, setSessionCookie } from '$server/auth/session';
import { checkRateLimit, clearRateLimit, regraLoginPorIp, RULES } from '$server/auth/ratelimit';
import { audit } from '$server/audit/log';
import { env } from '$server/env';
import { destinoInterno } from '$shared/redirecionamento';
import type { Actions, PageServerLoad } from './$types';

/**
 * Entrada no sistema.
 *
 * PERMISSÃO: pública (rota de autenticação).
 *
 * Ordem das verificações — importa muito:
 *   1. rate limit por IP        ← antes de tocar no banco
 *   2. rate limit por conta     ← antes de tocar no Argon2id
 *   3. busca da conta
 *   4. verificação da senha     ← ~610 ms de CPU; só chega aqui quem passou
 *
 * Inverter 2 e 4 transformaria o login numa alavanca de consumo de CPU.
 */

const schema = z.object({
	identificador: z.string().trim().min(1, 'Informe seu e-mail ou telefone.'),
	senha: z.string().min(1, 'Informe sua senha.')
});

/** Mensagem única para credencial errada: não revela se a conta existe. */
const CREDENCIAL_INVALIDA = 'E-mail/telefone ou senha incorretos.';

// `?voltar=` traz de volta quem chegou pelo link de um evento ("entrar para
// confirmar", D-M06-3). Só caminho interno: `destinoInterno` barra o
// redirecionamento aberto logo depois da senha.
export const load: PageServerLoad = async ({ locals, url }) => {
	if (locals.actor) redirect(303, destinoInterno(url.searchParams.get('voltar')));
	return {};
};

export const actions: Actions = {
	default: async ({ request, cookies, getClientAddress, url }) => {
		const ip = getClientAddress();
		const userAgent = request.headers.get('user-agent');

		// 1. Limite por IP — barra varredura em muitas contas.
		const porIp = checkRateLimit(`login:ip:${ip}`, regraLoginPorIp());
		if (!porIp.allowed) {
			return fail(429, {
				erro: `Muitas tentativas deste dispositivo. Tente de novo em ${Math.ceil(porIp.retryAfterSeconds / 60)} minutos.`
			});
		}

		const form = await request.formData();
		const parsed = schema.safeParse({
			identificador: form.get('identificador'),
			senha: form.get('senha')
		});

		if (!parsed.success) {
			const campos = parsed.error.flatten().fieldErrors;
			return fail(400, {
				identificador: String(form.get('identificador') ?? ''),
				erros: {
					identificador: campos.identificador?.[0],
					senha: campos.senha?.[0]
				}
			});
		}

		const { identificador, senha } = parsed.data;
		// Chave NORMALIZADA: `(11) 98765-4321` e `11987654321` são a mesma conta.
		// Com a chave crua, bastava variar a formatação do telefone para zerar o
		// limite de tentativas por conta.
		const chaveConta = chaveDoIdentificador(identificador);

		// 2. Limite por conta — antes do Argon2id.
		const porConta = checkRateLimit(`login:conta:${chaveConta}`, RULES.loginPorConta);
		if (!porConta.allowed) {
			return fail(429, {
				identificador,
				erro: `Muitas tentativas nesta conta. Tente de novo em ${Math.ceil(porConta.retryAfterSeconds / 60)} minutos, ou peça um novo convite ao seu conselheiro.`
			});
		}

		const banco = db();

		// 3. Busca a conta — e-mail sem diferenciar maiúsculas, telefone só pelos
		// dígitos. A regra vive em `$server/auth/conta`, a mesma que o aceite do
		// convite usa para gravar: as duas pontas não podem divergir.
		const linha = await encontrarContaPorIdentificador(banco, identificador);
		// Estreitado ANTES de desestruturar: o TypeScript não propaga a guarda
		// de `linha.conta.passwordHash` através de `const { conta } = linha`.
		const hashArmazenado = linha?.conta.passwordHash ?? null;

		// Conta inexistente: mesma mensagem e mesma forma da senha errada.
		// (O tempo difere — quem não existe não paga o Argon2id — mas o rate
		// limit por conta já impede transformar isso em enumeração útil.)
		if (!linha || !hashArmazenado) {
			await audit(banco, {
				action: 'auth.login_falhou',
				entity: 'user_account',
				after: { identificador: chaveConta, motivo: 'conta_inexistente' },
				ip,
				userAgent
			});
			return fail(400, { identificador, erro: CREDENCIAL_INVALIDA });
		}

		const { conta, pessoa } = linha;

		if (conta.lockedUntil && conta.lockedUntil > new Date()) {
			const minutos = Math.ceil((conta.lockedUntil.getTime() - Date.now()) / 60000);
			return fail(429, {
				identificador,
				erro: `Conta temporariamente bloqueada. Tente de novo em ${minutos} minutos.`
			});
		}

		// 4. Só agora o custo de CPU.
		const senhaConfere = await verifyPassword(hashArmazenado, senha);

		if (!senhaConfere) {
			const tentativas = conta.failedAttempts + 1;
			const estourou = tentativas >= env().MAX_LOGIN_ATTEMPTS;

			await banco
				.update(userAccount)
				.set({
					failedAttempts: tentativas,
					// Bloqueio progressivo: 5 min, 10, 20, 40… até 2 horas.
					lockedUntil: estourou
						? new Date(
								Date.now() +
									Math.min(2 ** (tentativas - env().MAX_LOGIN_ATTEMPTS) * 5, 120) * 60_000
							)
						: null,
					updatedAt: new Date()
				})
				.where(eq(userAccount.id, conta.id));

			await audit(banco, {
				teamId: pessoa.teamId,
				actorPersonId: pessoa.id,
				action: estourou ? 'auth.conta_bloqueada' : 'auth.login_falhou',
				entity: 'user_account',
				entityId: conta.id,
				after: { tentativas },
				ip,
				userAgent
			});

			return fail(400, { identificador, erro: CREDENCIAL_INVALIDA });
		}

		// --- Sucesso ---------------------------------------------------------
		clearRateLimit(`login:conta:${chaveConta}`);

		// Custo do Argon2id aumentou desde o cadastro? Reidrata em silêncio.
		const novoHash = needsRehash(hashArmazenado) ? await hashPassword(senha) : null;

		await banco
			.update(userAccount)
			.set({
				failedAttempts: 0,
				lockedUntil: null,
				lastLoginAt: new Date(),
				...(novoHash ? { passwordHash: novoHash } : {}),
				updatedAt: new Date()
			})
			.where(eq(userAccount.id, conta.id));

		const { token, record } = await createSession(banco, conta.id, { ip, userAgent });
		setSessionCookie(cookies, token, record.expiresAt);

		await audit(banco, {
			teamId: pessoa.teamId,
			actorPersonId: pessoa.id,
			action: 'auth.login',
			entity: 'session',
			entityId: record.id,
			ip,
			userAgent
		});

		redirect(303, destinoInterno(url.searchParams.get('voltar')));
	}
};

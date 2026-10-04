import { and, eq, isNull, ne, sql } from 'drizzle-orm';
import type { Database } from '../db';
import { person, session, userAccount } from '../db/schema';
import { audit } from '../audit/log';
import { consumeInvite, INVITE_REASON_MESSAGE, lookupInvite } from './invite';
import { hashPassword, PASSWORD_PROBLEM_MESSAGE, validatePassword } from './password';

/**
 * Conta de acesso: como se entra, e como se cria ou recupera a entrada.
 *
 * Estas regras viviam inline nas rotas `/entrar` e `/convite/[token]`, e foi
 * exatamente isso que deixou passar o defeito mais grave do M01: o aceite do
 * convite criava a conta SEM e-mail e SEM telefone. O login procura a conta por
 * um dos dois, então quem entrava por convite ficava trancado para fora assim
 * que a primeira sessão terminava.
 *
 * O teste de integração não pegou porque reimplementava a rota à mão e, no
 * passo "a senha funciona no login seguinte", conferia o hash — nunca procurava
 * a conta do jeito que o login procura. Com as duas pontas aqui, o teste usa o
 * mesmo código que a rota usa.
 */

export type Identificador = { tipo: 'email'; valor: string } | { tipo: 'telefone'; valor: string };

/**
 * Interpreta o que a pessoa digitou para entrar.
 *
 * Telefone vira SÓ DÍGITOS. Sem isso, `11987654321` e `(11) 98765-4321` seriam
 * contas diferentes para o login — e, pior, chaves diferentes para o limite de
 * tentativas por conta, que se contornaria mudando a formatação.
 */
export function interpretarIdentificador(texto: string | null | undefined): Identificador | null {
	const limpo = (texto ?? '').trim();
	if (!limpo) return null;

	if (limpo.includes('@')) {
		const email = limpo.toLowerCase();
		return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? { tipo: 'email', valor: email } : null;
	}

	const digitos = limpo.replace(/\D/g, '');
	// 10 ou 11 dígitos é número brasileiro com DDD; até 13 cobre o +55 na frente.
	return digitos.length >= 10 && digitos.length <= 13 ? { tipo: 'telefone', valor: digitos } : null;
}

/** Chave estável do identificador — a mesma para qualquer formatação. */
export function chaveDoIdentificador(texto: string): string {
	const id = interpretarIdentificador(texto);
	return id ? `${id.tipo}:${id.valor}` : `bruto:${texto.trim().toLowerCase()}`;
}

/**
 * Encontra a conta ATIVA de quem tenta entrar.
 *
 * Conta desativada e pessoa removida não aparecem: para o login, não existem.
 */
export async function encontrarContaPorIdentificador(db: Database, texto: string) {
	const id = interpretarIdentificador(texto);
	if (!id) return null;

	const condicao =
		id.tipo === 'email'
			? sql`lower(${userAccount.email}) = ${id.valor}`
			: eq(userAccount.phone, id.valor);

	const [linha] = await db
		.select({ conta: userAccount, pessoa: person })
		.from(userAccount)
		.innerJoin(person, eq(userAccount.personId, person.id))
		.where(and(condicao, isNull(userAccount.disabledAt), isNull(person.deletedAt)))
		.limit(1);

	return linha ?? null;
}

export type ResultadoDoAceite =
	| { ok: true; contaId: string; personId: string; teamId: string; recuperacao: boolean }
	| { ok: false; mensagem: string; campo?: 'identificador' | 'senha' };

/** Violação de unicidade do Postgres — vale para o postgres.js e para o PGlite. */
function ehViolacaoDeUnicidade(erro: unknown): boolean {
	return (
		typeof erro === 'object' &&
		erro !== null &&
		'code' in erro &&
		(erro as { code: unknown }).code === '23505'
	);
}

/**
 * Aceita um convite: define a senha e o identificador de entrada.
 *
 * Serve a dois casos, como determina o ADR 0004:
 *
 *   - PRIMEIRO ACESSO — a conta é criada.
 *   - RECUPERAÇÃO — a pessoa já tinha conta e esqueceu a senha; um novo convite
 *     é o caminho de volta. A senha antiga deixa de valer e TODAS as sessões
 *     abertas são encerradas, para que um aparelho perdido ou uma sessão
 *     roubada morra junto com a senha velha.
 *
 * O M01 recusava o segundo caso ("você já tem acesso, entre com a sua senha"),
 * o que deixava sem saída justamente quem não sabia a senha.
 *
 * Consumo do convite, gravação da conta e encerramento de sessões acontecem na
 * MESMA transação. Se o identificador escolhido já pertencer a outra conta, a
 * unicidade do banco recusa, a transação volta inteira — e o convite continua
 * valendo para uma segunda tentativa com outro identificador.
 */
export async function aceitarConvite(
	db: Database,
	entrada: {
		token: string;
		senha: string;
		identificador: string;
		ip?: string | null;
		userAgent?: string | null;
	}
): Promise<ResultadoDoAceite> {
	const convite = await lookupInvite(db, entrada.token);
	if (!convite.ok) {
		return { ok: false, mensagem: INVITE_REASON_MESSAGE[convite.reason] };
	}

	const identificador = interpretarIdentificador(entrada.identificador);
	if (!identificador) {
		return {
			ok: false,
			campo: 'identificador',
			mensagem: 'Informe um e-mail válido ou um telefone com DDD.'
		};
	}

	const problema = validatePassword(entrada.senha, convite.fullName);
	if (problema) {
		return { ok: false, campo: 'senha', mensagem: PASSWORD_PROBLEM_MESSAGE[problema] };
	}

	const [existente] = await db
		.select({ id: userAccount.id })
		.from(userAccount)
		.where(eq(userAccount.personId, convite.personId))
		.limit(1);

	// Verificação antecipada, para a mensagem sair sem custo de transação. A
	// garantia de verdade é a unicidade do banco, tratada logo abaixo.
	const comparacao =
		identificador.tipo === 'email'
			? sql`lower(${userAccount.email}) = ${identificador.valor}`
			: eq(userAccount.phone, identificador.valor);
	const [emUso] = await db
		.select({ id: userAccount.id })
		.from(userAccount)
		.where(existente ? and(comparacao, ne(userAccount.id, existente.id)) : comparacao)
		.limit(1);

	const MENSAGEM_EM_USO =
		identificador.tipo === 'email'
			? 'Esse e-mail já é usado por outra pessoa para entrar. Use outro, ou o seu telefone.'
			: 'Esse telefone já é usado por outra pessoa para entrar. Use outro, ou o seu e-mail.';

	if (emUso) return { ok: false, campo: 'identificador', mensagem: MENSAGEM_EM_USO };

	const passwordHash = await hashPassword(entrada.senha);
	const valores =
		identificador.tipo === 'email'
			? { email: identificador.valor }
			: { phone: identificador.valor };

	let contaId: string;
	try {
		contaId = await db.transaction(async (tx) => {
			// Consumir ANTES de gravar: dois envios simultâneos disputam o mesmo
			// UPDATE condicional, e só um passa. Sem isso, um clique duplo criaria
			// duas contas para a mesma pessoa.
			if (!(await consumeInvite(tx as unknown as Database, convite.inviteId))) {
				throw new ConviteJaUsado();
			}

			if (existente) {
				await tx
					.update(userAccount)
					.set({
						...valores,
						passwordHash,
						failedAttempts: 0,
						lockedUntil: null,
						updatedAt: new Date()
					})
					.where(eq(userAccount.id, existente.id));

				await tx
					.update(session)
					.set({ revokedAt: new Date() })
					.where(and(eq(session.accountId, existente.id), isNull(session.revokedAt)));

				return existente.id;
			}

			const [criada] = await tx
				.insert(userAccount)
				.values({ personId: convite.personId, passwordHash, ...valores })
				.returning({ id: userAccount.id });
			if (!criada) throw new Error('não foi possível criar a conta');
			return criada.id;
		});
	} catch (erro) {
		if (erro instanceof ConviteJaUsado) {
			return { ok: false, mensagem: 'Este convite já foi usado. Entre com a sua senha.' };
		}
		if (ehViolacaoDeUnicidade(erro)) {
			return { ok: false, campo: 'identificador', mensagem: MENSAGEM_EM_USO };
		}
		throw erro;
	}

	const recuperacao = !!existente;

	await audit(db, {
		teamId: convite.teamId,
		actorPersonId: convite.personId,
		action: recuperacao ? 'auth.acesso_recuperado' : 'invite.aceito',
		entity: 'user_account',
		entityId: contaId,
		after: { identificador: identificador.tipo },
		ip: entrada.ip,
		userAgent: entrada.userAgent
	});

	return { ok: true, contaId, personId: convite.personId, teamId: convite.teamId, recuperacao };
}

class ConviteJaUsado extends Error {}

/** A pessoa tem conta com identificador de entrada? Para a tela de acesso. */
export async function situacaoDaConta(db: Database, personId: string) {
	const [conta] = await db
		.select({
			id: userAccount.id,
			temSenha: sql<boolean>`${userAccount.passwordHash} is not null`,
			temIdentificador: sql<boolean>`(${userAccount.email} is not null or ${userAccount.phone} is not null)`,
			desativada: sql<boolean>`${userAccount.disabledAt} is not null`,
			ultimoAcesso: userAccount.lastLoginAt
		})
		.from(userAccount)
		.where(eq(userAccount.personId, personId))
		.limit(1);

	return conta ?? null;
}

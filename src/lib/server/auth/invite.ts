import { and, eq, isNull } from 'drizzle-orm';
import type { Database } from '../db';
import { invite, person, userAccount } from '../db/schema';
import { env } from '../env';
import { generateToken, hashToken } from './token';

/**
 * Convites de acesso (ADR 0004).
 *
 * A conta nasce ligada a uma pessoa que JÁ existe no cadastro. Isso evita o
 * registro duplicado clássico — a pessoa que já tem 8 meses de histórico de
 * presença criando um segundo cadastro em branco ao instalar o app.
 *
 * Não existe autocadastro de conta. O autocadastro público do M02 cria uma
 * `person` de visitante, sem acesso.
 */

export type InviteIssued = { token: string; url: string; expiresAt: Date };

export async function issueInvite(
	db: Database,
	params: { teamId: string; personId: string; createdByPersonId: string }
): Promise<InviteIssued> {
	const token = generateToken();
	const expiresAt = new Date(Date.now() + env().INVITE_TTL_DAYS * 24 * 60 * 60 * 1000);

	// Um convite anterior ainda aberto é revogado: dois links válidos para a
	// mesma pessoa é superfície de ataque sem utilidade.
	await db
		.update(invite)
		.set({ revokedAt: new Date() })
		.where(
			and(eq(invite.personId, params.personId), isNull(invite.usedAt), isNull(invite.revokedAt))
		);

	await db.insert(invite).values({
		teamId: params.teamId,
		personId: params.personId,
		tokenHash: hashToken(token),
		createdByPersonId: params.createdByPersonId,
		expiresAt
	});

	return {
		token,
		url: `${env().PUBLIC_ORIGIN}/convite/${token}`,
		expiresAt
	};
}

export type InviteLookup =
	| {
			ok: true;
			inviteId: string;
			personId: string;
			teamId: string;
			fullName: string;
			/**
			 * A pessoa já tem senha: este convite é uma RECUPERAÇÃO de acesso
			 * (ADR 0004), não um primeiro acesso. Aceitá-lo troca a senha e
			 * encerra todas as sessões abertas.
			 */
			recuperacao: boolean;
	  }
	| { ok: false; reason: 'inexistente' | 'expirado' | 'usado' | 'revogado' };

/**
 * Resolve um token de convite.
 *
 * Distingue os motivos de recusa de propósito: aqui a informação é útil e não
 * perigosa — o token tem 256 bits, então não há o que enumerar, e dizer
 * "este convite expirou" evita que a pessoa fique presa sem entender.
 */
export async function lookupInvite(db: Database, token: string): Promise<InviteLookup> {
	if (!token || token.length < 20) return { ok: false, reason: 'inexistente' };

	const linhas = await db
		.select({ convite: invite, pessoa: person, conta: userAccount })
		.from(invite)
		.innerJoin(person, eq(invite.personId, person.id))
		.leftJoin(userAccount, eq(userAccount.personId, person.id))
		.where(eq(invite.tokenHash, hashToken(token)))
		.limit(1);

	const linha = linhas[0];
	if (!linha) return { ok: false, reason: 'inexistente' };

	const { convite, pessoa, conta } = linha;

	if (convite.revokedAt) return { ok: false, reason: 'revogado' };
	if (convite.usedAt) return { ok: false, reason: 'usado' };
	if (convite.expiresAt <= new Date()) return { ok: false, reason: 'expirado' };
	// Quem já tem senha NÃO é recusado. O ADR 0004 define o novo convite como o
	// caminho de recuperação de acesso; recusar aqui deixava sem saída
	// justamente quem esqueceu a senha (defeito do M01, corrigido no M03).
	return {
		ok: true,
		inviteId: convite.id,
		personId: pessoa.id,
		teamId: pessoa.teamId,
		fullName: pessoa.fullName,
		recuperacao: !!conta?.passwordHash
	};
}

/** Marca o convite como usado. Só tem efeito se ainda estiver aberto. */
export async function consumeInvite(db: Database, inviteId: string): Promise<boolean> {
	const linhas = await db
		.update(invite)
		.set({ usedAt: new Date() })
		.where(and(eq(invite.id, inviteId), isNull(invite.usedAt), isNull(invite.revokedAt)))
		.returning({ id: invite.id });

	return linhas.length === 1;
}

export const INVITE_REASON_MESSAGE: Record<Exclude<InviteLookup, { ok: true }>['reason'], string> =
	{
		inexistente: 'Este convite não existe. Peça um novo link ao seu conselheiro.',
		expirado: 'Este convite expirou. Peça um novo link ao seu conselheiro.',
		usado: 'Este convite já foi usado. Entre com a sua senha.',
		revogado: 'Este convite foi cancelado. Peça um novo link ao seu conselheiro.'
	};

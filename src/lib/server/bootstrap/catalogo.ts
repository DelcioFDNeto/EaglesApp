import { and, eq } from 'drizzle-orm';
import type { Database } from '../db';
import { eventType, featureFlag, permission, role, rolePermission, team } from '../db/schema';
import { ALL_PERMISSIONS, PERMISSIONS } from '../policy/permissions';
import { ROLE_SEEDS } from '../policy/roles';

/**
 * O mínimo para um banco recém-migrado funcionar: a equipe, o catálogo de
 * permissões, os papéis do sistema, o tipo de evento padrão (PG — Pequeno
 * Grupo) e as funcionalidades opcionais (todas DESLIGADAS, RN-29).
 *
 * As migrações criam só a estrutura; sem isto ninguém tem papel, e sem papel
 * todo acesso é negado. Usado pelo primeiro acesso em produção
 * (`deploy/primeiro-master.ts`).
 *
 * IDEMPOTENTE: rodar de novo não duplica nada nem desfaz ajustes que a
 * liderança tenha feito nos papéis pela tela de administração — só acrescenta
 * o que falta.
 */

export const TIPO_EVENTO_PG = {
	slug: 'pg',
	name: 'PG (Pequeno Grupo)',
	description: 'Reunião de membros e visitantes para mensagem bíblica, comida e confraternização.',
	color: '#A91825'
} as const;

export const TIPOS_EVENTO_PADRAO = [TIPO_EVENTO_PG] as const;

export const FUNCIONALIDADES = [
	['checkin_qrcode', 'Check-in por QR Code nos encontros'],
	['aprovacao_despesas', 'Fluxo de aprovação antes de registrar despesa'],
	['notificacoes_push', 'Lembretes por notificação no celular'],
	['ia_assistente', 'Assistente de IA para líderes e conselheiros'],
	['campos_personalizados', 'Campos extras no cadastro de pessoas']
] as const;

export type Catalogo = {
	teamId: string;
	/** id do papel por chave (`lider`, `conselheiro`, ...). */
	papeis: Record<string, string>;
};

export async function garantirCatalogo(
	db: Database,
	equipe: { slug: string; nome: string } = { slug: 'eagles', nome: 'Eagles' }
): Promise<Catalogo> {
	let [linhaEquipe] = await db
		.select({ id: team.id })
		.from(team)
		.where(eq(team.slug, equipe.slug))
		.limit(1);

	if (!linhaEquipe) {
		[linhaEquipe] = await db
			.insert(team)
			.values({ slug: equipe.slug, name: equipe.nome })
			.returning({ id: team.id });
	}
	if (!linhaEquipe) throw new Error('não foi possível criar a equipe');
	const teamId = linhaEquipe.id;

	await db
		.insert(permission)
		.values(ALL_PERMISSIONS.map((key) => ({ key, description: PERMISSIONS[key] })))
		.onConflictDoNothing();

	const papeis: Record<string, string> = {};

	for (const semente of ROLE_SEEDS) {
		let [existente] = await db
			.select({ id: role.id })
			.from(role)
			.where(and(eq(role.teamId, teamId), eq(role.key, semente.key)))
			.limit(1);

		if (!existente) {
			[existente] = await db
				.insert(role)
				.values({
					teamId,
					key: semente.key,
					name: semente.name,
					description: semente.description,
					isSystem: semente.isSystem
				})
				.returning({ id: role.id });

			if (!existente) throw new Error(`não foi possível criar o papel ${semente.key}`);

			// Permissões só na criação: depois o papel é da liderança, que pode
			// ter tirado alguma de propósito (seção 11.3).
			await db
				.insert(rolePermission)
				.values(semente.permissions.map((p) => ({ roleId: existente!.id, permissionKey: p })))
				.onConflictDoNothing();
		}

		papeis[semente.key] = existente.id;
	}

	await db
		.insert(eventType)
		.values(
			TIPOS_EVENTO_PADRAO.map((t) => ({
				teamId,
				slug: t.slug,
				name: t.name,
				description: t.description,
				color: t.color,
				active: true
			}))
		)
		.onConflictDoNothing();

	await db
		.insert(featureFlag)
		.values(
			FUNCIONALIDADES.map(([key, description]) => ({ teamId, key, description, enabled: false }))
		)
		.onConflictDoNothing();

	return { teamId, papeis };
}

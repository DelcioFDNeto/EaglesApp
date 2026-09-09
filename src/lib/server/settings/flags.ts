import { and, eq } from 'drizzle-orm';
import type { Database } from '$server/db';
import { featureFlag } from '$server/db/schema';

/**
 * Chaves de funcionalidade.
 *
 * Fonte ÚNICA do catálogo: a semeadura, a tela de configurações e quem lê a
 * chave em tempo de execução usam esta lista. Antes ela vivia inline no seed,
 * e uma chave nova exigiria lembrar de dois lugares.
 *
 * TODAS nascem desligadas (RN-29). O estado padrão de instalação é o sistema
 * menos burocrático possível; ligar cada controle é decisão consciente da
 * liderança, não padrão que ninguém escolheu.
 */

export const FUNCIONALIDADES = {
	checkin_qrcode: 'Check-in por QR Code nos encontros',
	aprovacao_despesas: 'Fluxo de aprovação antes de registrar despesa',
	notificacoes_push: 'Lembretes por notificação no celular',
	ia_assistente: 'Assistente de IA para líderes e conselheiros',
	campos_personalizados: 'Campos extras no cadastro de pessoas',
	autocadastro_visitante: 'Link público para visitante se cadastrar sozinho'
} as const;

export type ChaveDeFuncionalidade = keyof typeof FUNCIONALIDADES;

export const TODAS_AS_FUNCIONALIDADES = Object.keys(FUNCIONALIDADES) as ChaveDeFuncionalidade[];

/**
 * A chave está ligada?
 *
 * Ausente no banco = **desligada**. Uma instalação nova, ou uma chave criada
 * numa versão posterior à semeadura, não pode ligar sozinha uma funcionalidade
 * que ninguém pediu.
 */
export async function funcionalidadeLigada(
	db: Database,
	teamId: string,
	chave: ChaveDeFuncionalidade
): Promise<boolean> {
	const [linha] = await db
		.select({ enabled: featureFlag.enabled })
		.from(featureFlag)
		.where(and(eq(featureFlag.teamId, teamId), eq(featureFlag.key, chave)))
		.limit(1);

	return linha?.enabled === true;
}

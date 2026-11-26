/**
 * Catálogo oficial de chaves de funcionalidade opcionais (RF-11.1 / RN-29).
 *
 * Regra RN-29: TODAS nascem desligadas (`enabled = false`). Ligar qualquer
 * controle é uma decisão consciente da liderança.
 */

export type DefinicaoFeatureFlag = {
	key: string;
	nome: string;
	descricao: string;
	modulo: string;
};

export const CATALOGO_FEATURE_FLAGS: DefinicaoFeatureFlag[] = [
	{
		key: 'checkin_qrcode',
		nome: 'Check-in por QR Code',
		descricao:
			'Permite gerar QR Code temporário nos encontros para registro de presença. Nunca condiciona a entrada de ninguém (RN-14).',
		modulo: 'M06 · Presença'
	},
	{
		key: 'aprovacao_despesas',
		nome: 'Aprovação de despesas',
		descricao:
			'Quando ligada, despesas lançadas por conselheiros aguardam aprovação da liderança antes de entrar no saldo (RN-23).',
		modulo: 'M09 · Financeiro'
	},
	{
		key: 'notificacoes_ativas',
		nome: 'Notificações e lembretes',
		descricao:
			'Ativa lembretes automáticos respeitando as preferências individuais e a janela de silêncio 22h–7h (Fluxo F6).',
		modulo: 'M08 · Comunicação'
	},
	{
		key: 'ia_assistente',
		nome: 'Assistente de IA',
		descricao:
			'Habilita sugestões assistidas respeitando rigorosamente as permissões de quem pergunta (RN-26 / RN-27).',
		modulo: 'M10 · IA'
	}
];

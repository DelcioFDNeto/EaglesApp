/**
 * Opções de resposta de presença: o que cada uma significa.
 *
 * Servidor e tela compartilham isto. A pergunta é sempre a mesma: esta
 * resposta é um "vou"? É ela que alimenta "confirmou e veio" e a taxa de
 * confirmação.
 */

export type OpcaoRsvp = {
	key: string;
	label: string;
	/** Conta como "vou"? Sem valor, vale o padrão da chave (abaixo). */
	confirma?: boolean;
};

/** Respostas que, sem marcação explícita, contam como "vou". */
const CHAVES_QUE_CONFIRMAM = new Set(['confirmado', 'atrasado', 'convidado']);

/** Chaves que nunca são um "vou" por padrão (negativas ou indecisas). */
const CHAVES_QUE_NAO_CONFIRMAM = /^(nao|talvez)/;

/**
 * A opção conta como confirmação de presença?
 *
 * Opções criadas antes desta marcação existir seguem a chave: as cinco
 * padrão são conhecidas; uma chave nova que comece com "nao" ou "talvez"
 * não confirma; as demais ("vou_de_carona") confirmam.
 */
export function opcaoConfirma(opcao: Pick<OpcaoRsvp, 'key' | 'confirma'>): boolean {
	if (typeof opcao.confirma === 'boolean') return opcao.confirma;
	if (CHAVES_QUE_CONFIRMAM.has(opcao.key)) return true;
	return !CHAVES_QUE_NAO_CONFIRMAM.test(opcao.key);
}

/** Conjunto das chaves que confirmam, a partir das opções do evento. */
export function chavesQueConfirmam(opcoes: readonly OpcaoRsvp[]): Set<string> {
	const chaves = new Set(opcoes.filter(opcaoConfirma).map((o) => o.key));
	// Resposta dada a uma opção padrão que o evento não tem mais segue valendo.
	for (const k of CHAVES_QUE_CONFIRMAM) {
		if (!opcoes.some((o) => o.key === k)) chaves.add(k);
	}
	return chaves;
}

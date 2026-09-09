import type { TipoDeConsentimento } from '$shared/pessoa';

/**
 * Regime de tratamento de dados pessoais (ADR 0003).
 *
 * PONTO ÚNICO de decisão sobre o que pode ser guardado de quem. Telas,
 * serviços e, no futuro, o pipeline de IA consultam esta função — ninguém
 * reimplementa a regra.
 *
 * A postura é restritiva por padrão, e a razão é concreta: o sistema vai
 * guardar telefone e foto de adolescentes de uma comunidade. Errar para o lado
 * permissivo é vazamento; errar para o lado restritivo é um campo a menos.
 *
 * Hoje não há menores cadastrados (D-03) e a idade mínima é 16. Este código
 * existe testado e inativo — a alternativa seria escrevê-lo às pressas no dia
 * em que o primeiro adolescente de 16 anos aparecer no PG.
 */

/** O que se sabe sobre a idade da pessoa. */
export type SinalDeIdade = {
	/**
	 * Vindo de `person_view.is_minor`.
	 *
	 * `null` significa data de nascimento desconhecida — e é tratado como
	 * MENOR, nunca como maior. Um cadastro incompleto não pode ser a porta de
	 * entrada para guardar o contato de um adolescente.
	 */
	ehMenor: boolean | null;
};

export type EstadoDeConsentimento = Partial<Record<TipoDeConsentimento, boolean>>;

export type Regime = {
	/** Regime restrito: cadastro mínimo, só nome e presença (RN-30). */
	restrito: boolean;
	/** Motivo legível, para explicar na tela por que o campo não aparece. */
	motivo: string | null;
	podeGuardarContato: boolean;
	podeGuardarFoto: boolean;
	podeGuardarObservacoes: boolean;
	/** Compartilhar dados desta pessoa no WhatsApp (RN-33). */
	podeCompartilharExternamente: boolean;
	/** Entrar no pipeline de IA, sempre pseudonimizado. */
	podeUsarEmIa: boolean;
};

const LIVRE: Regime = {
	restrito: false,
	motivo: null,
	podeGuardarContato: true,
	podeGuardarFoto: false,
	podeGuardarObservacoes: true,
	podeCompartilharExternamente: true,
	podeUsarEmIa: true
};

/**
 * Decide o regime a partir da idade, dos consentimentos e da existência de um
 * responsável legal vinculado.
 *
 * Maior de idade também precisa consentir para FOTO (RNF-09): privacidade de
 * imagem não é questão de idade. Os demais campos, para adulto, não dependem
 * de consentimento registrado — quem informa o próprio telefone ao conselheiro
 * está consentindo ali.
 */
export function regimeDe(
	idade: SinalDeIdade,
	consentimentos: EstadoDeConsentimento = {},
	opcoes: { temResponsavelVinculado?: boolean } = {}
): Regime {
	const ehMaiorConhecido = idade.ehMenor === false;

	if (ehMaiorConhecido) {
		return {
			...LIVRE,
			podeGuardarFoto: consentimentos.foto === true,
			podeCompartilharExternamente: consentimentos.compartilhamento_externo !== false,
			podeUsarEmIa: consentimentos.uso_ia !== false
		};
	}

	// Daqui para baixo: menor de idade, ou idade desconhecida.
	const idadeDesconhecida = idade.ehMenor === null;
	const temResponsavel = opcoes.temResponsavelVinculado === true;
	const consentiuCadastro = consentimentos.dados_cadastrais === true;

	// RN-30 — sem responsável vinculado E sem consentimento, cadastro mínimo.
	const restrito = !(temResponsavel && consentiuCadastro);

	return {
		restrito,
		motivo: restrito
			? idadeDesconhecida
				? 'Data de nascimento não informada. Enquanto ela faltar, o cadastro fica restrito ao nome — é o regime que protege quem pode ser menor de idade.'
				: 'Menor de idade sem responsável legal vinculado e sem consentimento registrado. O cadastro fica restrito ao nome (RN-30).'
			: null,
		podeGuardarContato: !restrito,
		// RN-31 — foto de menor exige consentimento específico do responsável.
		podeGuardarFoto: !restrito && consentimentos.foto === true,
		podeGuardarObservacoes: !restrito,
		// RN-33 — dado de menor NUNCA vai para o WhatsApp, mesmo com
		// consentimento: o destino é um grupo cujo conteúdo não controlamos.
		podeCompartilharExternamente: false,
		podeUsarEmIa: !restrito && consentimentos.uso_ia === true
	};
}

/** Campos que o regime restrito proíbe de gravar. */
export const CAMPOS_SENSIVEIS = [
	'phone',
	'whatsapp',
	'email',
	'relationshipStatus',
	'notes'
] as const;

export type CampoSensivel = (typeof CAMPOS_SENSIVEIS)[number];

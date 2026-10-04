import { and, count, eq, gt, isNull, or } from 'drizzle-orm';
import type { Database } from '$server/db';
import { personRole } from '$server/db/schema';
import { audit } from '$server/audit/log';
import { issueInvite } from '$server/auth/invite';
import { situacaoDaConta } from '$server/auth/conta';
import { authorize, type Actor } from '$server/policy/policy';
import { verPessoa } from '$server/modules/pessoas/pessoas';
import { AcessoRecusado, exigirReautenticacao, type ContextoSensivel } from './regras';

/**
 * Emissão de convite de acesso (RF-01.2 — lacuna G1 do M01).
 *
 * O serviço de convite existia desde o M01, mas nenhuma tela o chamava:
 * ninguém novo conseguia entrar no app.
 *
 * Três condições antes de emitir:
 *
 *   1. `person.invite` SOBRE a pessoa. Hoje só o escopo global passa — o de
 *      grupo chega com os grupos (M04), como `person.update`.
 *   2. A pessoa já tem PAPEL. Uma conta sem papel entraria num app em que não
 *      pode fazer nada (D-M03-5).
 *   3. A pessoa NÃO está em regime restrito de dados. ADR 0004: "conta de
 *      acesso para menor de idade só é emitida com o consentimento previsto no
 *      ADR 0003". Data de nascimento desconhecida conta como possível menor.
 *
 * Convite para quem JÁ tem conta é RECUPERAÇÃO: aceitá-lo troca a senha e
 * encerra todas as sessões. Por isso exige reautenticação — é redefinir a
 * credencial de outra pessoa. O primeiro convite não exige: quem ainda não tem
 * conta não tem credencial a perder.
 */

export type ConviteEmitido = {
	url: string;
	expiraEm: Date;
	recuperacao: boolean;
	primeiroNome: string;
	/** WhatsApp da pessoa, só dígitos com DDI — para abrir a conversa direto. */
	whatsapp: string | null;
};

export async function emitirConvite(
	db: Database,
	actor: Actor,
	personId: string,
	contexto: ContextoSensivel
): Promise<ConviteEmitido> {
	authorize(actor, 'person.invite', { personId });

	const pessoa = await verPessoa(db, actor, personId);
	if (!pessoa) throw new AcessoRecusado('nao_encontrado', 'Essa pessoa não existe.');

	if (pessoa.regime.restrito) {
		throw new AcessoRecusado(
			'regime_restrito',
			pessoa.ehMenor === null
				? 'Informe a data de nascimento antes de convidar. Sem ela, o cadastro segue o regime de proteção de menores.'
				: 'Menor de idade só recebe acesso com responsável vinculado e consentimento registrado.'
		);
	}

	const [comPapel] = await db
		.select({ total: count() })
		.from(personRole)
		.where(
			and(
				eq(personRole.personId, personId),
				or(isNull(personRole.expiresAt), gt(personRole.expiresAt, new Date()))
			)
		);
	if (Number(comPapel?.total ?? 0) === 0) {
		throw new AcessoRecusado(
			'sem_papel',
			'Atribua um papel antes de convidar — sem papel, a pessoa entraria num app em que não pode fazer nada.'
		);
	}

	const conta = await situacaoDaConta(db, personId);
	const recuperacao = !!conta?.temSenha;
	if (recuperacao) exigirReautenticacao(contexto.reautenticadoRecentemente);

	const emitido = await issueInvite(db, {
		teamId: actor.teamId,
		personId,
		createdByPersonId: actor.personId
	});

	await audit(db, {
		teamId: actor.teamId,
		actorPersonId: actor.personId,
		action: 'invite.emitido',
		entity: 'person',
		entityId: personId,
		after: { recuperacao, expiraEm: emitido.expiresAt.toISOString() },
		ip: contexto.ip,
		userAgent: contexto.userAgent
	});

	const digitos = (pessoa.sensiveis?.whatsapp ?? pessoa.sensiveis?.phone ?? '').replace(/\D/g, '');
	const whatsapp =
		digitos.length === 10 || digitos.length === 11
			? `55${digitos}`
			: digitos.length >= 12
				? digitos
				: null;

	return {
		url: emitido.url,
		expiraEm: emitido.expiresAt,
		recuperacao,
		primeiroNome: pessoa.fullName.split(' ')[0] ?? pessoa.fullName,
		whatsapp
	};
}

/**
 * Texto do convite para o WhatsApp.
 *
 * Mora no servidor para que o link do `wa.me` saia pronto da ação — a tela só
 * exibe. O link vai DENTRO do texto, nunca como parâmetro solto: quem recebe
 * vê de onde veio e para que serve antes de tocar.
 */
export function textoDoConvite(c: ConviteEmitido): string {
	const validade = new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit' }).format(
		c.expiraEm
	);
	return c.recuperacao
		? `Oi, ${c.primeiroNome}! Aqui está o link para você recuperar seu acesso ao app dos Eagles. Ao usar, você escolhe uma senha nova: ${c.url}\n\nO link vale até ${validade}.`
		: `Oi, ${c.primeiroNome}! Aqui está o seu acesso ao app dos Eagles — é onde ficam os encontros, a confirmação de presença e as escalas: ${c.url}\n\nO link vale até ${validade}.`;
}

export function linkDoWhatsapp(c: ConviteEmitido): string {
	const texto = encodeURIComponent(textoDoConvite(c));
	return c.whatsapp ? `https://wa.me/${c.whatsapp}?text=${texto}` : `https://wa.me/?text=${texto}`;
}

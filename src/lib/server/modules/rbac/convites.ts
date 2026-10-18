import { and, count, eq } from 'drizzle-orm';
import type { Database } from '$server/db';
import { personRole } from '$server/db/schema';
import { audit } from '$server/audit/log';
import {
	INVITE_REASON_MESSAGE,
	issueInvite,
	lookupInvite,
	revogarConvite,
	type InviteLookup
} from '$server/auth/invite';
import { aceitarConvite, situacaoDaConta, type ResultadoDoAceite } from '$server/auth/conta';
import { authorize, PolicyDenied, type Actor } from '$server/policy/policy';
import { loadActor } from '$server/policy/actor';
import { atribuicaoVigente } from '$server/policy/vigencia';
import { contextoDaPessoa } from '$server/modules/grupos/contexto';
import { fusoDaEquipe } from '$server/modules/eventos/eventos';
import { verPessoa } from '$server/modules/pessoas/pessoas';
import {
	AcessoRecusado,
	exigirReautenticacao,
	permissoesForaDoAlcance,
	type ContextoSensivel
} from './regras';

/**
 * Emissão de convite de acesso (RF-01.2 — lacuna G1 do M01).
 *
 * O serviço de convite existia desde o M01, mas nenhuma tela o chamava:
 * ninguém novo conseguia entrar no app.
 *
 * Quatro condições antes de emitir:
 *
 *   1. `person.invite` SOBRE a pessoa. Hoje só o escopo global passa — o de
 *      grupo chega com os grupos (M04), como `person.update`.
 *   2. A pessoa já tem PAPEL. Uma conta sem papel entraria num app em que não
 *      pode fazer nada (D-M03-5).
 *   3. A pessoa NÃO está em regime restrito de dados. ADR 0004: "conta de
 *      acesso para menor de idade só é emitida com o consentimento previsto no
 *      ADR 0003". Data de nascimento desconhecida conta como possível menor.
 *   4. Quem emite já detém, no mesmo alcance, tudo o que a conta convidada vai
 *      poder (trava 5, `permissoesForaDoAlcance`): quem tem o link tem a conta.
 *
 * As quatro valem também NO ACEITE (`abrirConvite`, `aceitarConviteDeAcesso`):
 * o link vive dias, e nesse tempo a pessoa pode ganhar um papel que quem
 * emitiu não tem — ou quem emitiu pode perder o seu. Conferidas só na emissão,
 * bastava guardar o link de um membro comum e esperar a promoção dele
 * (revisão de 17/10/2026).
 *
 * Convite para quem JÁ tem conta é RECUPERAÇÃO: aceitá-lo troca a senha e
 * encerra todas as sessões. Por isso exige reautenticação — é redefinir a
 * credencial de outra pessoa. O primeiro convite não exige: quem ainda não tem
 * conta não tem credencial a perder.
 */

export type ConviteEmitido = {
	url: string;
	expiraEm: Date;
	/** Fuso da equipe — a validade no texto é a do calendário dela, não do servidor. */
	fuso: string;
	recuperacao: boolean;
	primeiroNome: string;
	/** WhatsApp da pessoa, só dígitos com DDI — para abrir a conversa direto. */
	whatsapp: string | null;
};

/**
 * As condições 1 a 4, sobre o estado de AGORA. Lança `PolicyDenied` ou
 * `AcessoRecusado`; devolve a pessoa como o emissor a vê.
 */
async function exigirConvitePossivel(db: Database, emissor: Actor, personId: string) {
	const ctxDaPessoa = await contextoDaPessoa(db, personId);
	authorize(emissor, 'person.invite', ctxDaPessoa);

	const pessoa = await verPessoa(db, emissor, personId);
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
		.where(and(eq(personRole.personId, personId), atribuicaoVigente()));
	if (Number(comPapel?.total ?? 0) === 0) {
		throw new AcessoRecusado(
			'sem_papel',
			'Atribua um papel antes de convidar — sem papel, a pessoa entraria num app em que não pode fazer nada.'
		);
	}

	const alvo = await loadActor(db, personId);
	const faltam = alvo ? permissoesForaDoAlcance(emissor, { ...ctxDaPessoa, ...alvo }) : [];
	if (faltam.length > 0) {
		throw new AcessoRecusado(
			'escalada',
			'Esta pessoa tem acessos que você não tem — o convite dela precisa vir de quem administra os acessos da equipe.'
		);
	}

	return pessoa;
}

export async function emitirConvite(
	db: Database,
	actor: Actor,
	personId: string,
	contexto: ContextoSensivel
): Promise<ConviteEmitido> {
	const pessoa = await exigirConvitePossivel(db, actor, personId);

	const conta = await situacaoDaConta(db, personId);
	if (conta?.desativada) {
		throw new AcessoRecusado(
			'conta_desativada',
			'A conta desta pessoa está desativada. Um convite não a reativa — fale com quem administra os acessos.'
		);
	}
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
		fuso: await fusoDaEquipe(db, actor.teamId),
		recuperacao,
		primeiroNome: pessoa.fullName.split(' ')[0] ?? pessoa.fullName,
		whatsapp
	};
}

/** Quem emitiu o convite ainda poderia emiti-lo hoje? */
async function emissorAindaPode(
	db: Database,
	convite: { personId: string; emitidoPor: string | null }
): Promise<boolean> {
	if (!convite.emitidoPor) return false;
	// Removido do cadastro, quem emitiu não tem ator — e o link morre junto.
	const emissor = await loadActor(db, convite.emitidoPor);
	if (!emissor) return false;
	try {
		await exigirConvitePossivel(db, emissor, convite.personId);
		return true;
	} catch (erro) {
		if (erro instanceof AcessoRecusado || erro instanceof PolicyDenied) return false;
		throw erro;
	}
}

/**
 * Abre um convite para a tela de aceite: o token vale E quem o emitiu ainda
 * poderia emiti-lo. Sem efeito colateral — é um GET, e a prévia de link do
 * WhatsApp também o abre.
 */
export async function abrirConvite(db: Database, token: string): Promise<InviteLookup> {
	const convite = await lookupInvite(db, token);
	if (!convite.ok) return convite;
	return (await emissorAindaPode(db, convite)) ? convite : { ok: false, reason: 'revogado' };
}

/**
 * Aceite de convite, como a rota o faz: as condições da emissão de novo, e só
 * então a troca de credencial (`aceitarConvite`, em auth).
 *
 * O convite que não passa é cancelado e a tentativa fica na auditoria: um link
 * guardado até a promoção de quem foi convidado é exatamente o que a trava 5
 * existe para barrar.
 */
export async function aceitarConviteDeAcesso(
	db: Database,
	entrada: Parameters<typeof aceitarConvite>[1]
): Promise<ResultadoDoAceite> {
	const convite = await lookupInvite(db, entrada.token);
	if (!convite.ok) return { ok: false, mensagem: INVITE_REASON_MESSAGE[convite.reason] };

	if (!(await emissorAindaPode(db, convite))) {
		await revogarConvite(db, convite.inviteId);
		await audit(db, {
			teamId: convite.teamId,
			actorPersonId: null,
			action: 'invite.revogado',
			entity: 'person',
			entityId: convite.personId,
			after: { motivo: 'emissor_sem_alcance', emitidoPor: convite.emitidoPor },
			ip: entrada.ip,
			userAgent: entrada.userAgent
		});
		return { ok: false, mensagem: INVITE_REASON_MESSAGE.revogado };
	}

	return aceitarConvite(db, entrada);
}

/**
 * Texto do convite para o WhatsApp.
 *
 * Mora no servidor para que o link do `wa.me` saia pronto da ação — a tela só
 * exibe. O link vai DENTRO do texto, nunca como parâmetro solto: quem recebe
 * vê de onde veio e para que serve antes de tocar.
 */
export function textoDoConvite(c: ConviteEmitido): string {
	const validade = new Intl.DateTimeFormat('pt-BR', {
		day: '2-digit',
		month: '2-digit',
		timeZone: c.fuso
	}).format(c.expiraEm);
	return c.recuperacao
		? `Oi, ${c.primeiroNome}! Aqui está o link para você recuperar seu acesso ao app dos Eagles. Ao usar, você escolhe uma senha nova: ${c.url}\n\nO link vale até ${validade}.`
		: `Oi, ${c.primeiroNome}! Aqui está o seu acesso ao app dos Eagles — é onde ficam os encontros, a confirmação de presença e as escalas: ${c.url}\n\nO link vale até ${validade}.`;
}

export function linkDoWhatsapp(c: ConviteEmitido): string {
	const texto = encodeURIComponent(textoDoConvite(c));
	return c.whatsapp ? `https://wa.me/${c.whatsapp}?text=${texto}` : `https://wa.me/?text=${texto}`;
}

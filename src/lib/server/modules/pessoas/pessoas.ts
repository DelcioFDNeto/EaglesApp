import { and, asc, eq, inArray, isNull, sql, type SQL } from 'drizzle-orm';
import { ehId } from '$shared/formulario';
import type { Database } from '$server/db';
import {
	groupMembership,
	membershipStatus,
	person,
	personRelation,
	personRole,
	personStatusHistory,
	personView,
	smallGroup
} from '$server/db/schema';
import { audit } from '$server/audit/log';
import { authorize, authorizeAnywhere, can, PolicyDenied, type Actor } from '$server/policy/policy';
import { normalizarTexto, type OrigemDoCadastro } from '$shared/pessoa';
import { SEM_GRUPO } from '$shared/grupo';
import { contextoDaPessoa } from '$server/modules/grupos/contexto';
import {
	auditarMovimento,
	moverNaTransacao,
	type Movimento
} from '$server/modules/grupos/composicao';
import { revogarConvitesDaPessoa } from '$server/auth/invite';
import { revogarSessoesDaPessoa } from '$server/auth/session';
import {
	contarAdministradoresAtivos,
	exigirAdministradorRestante,
	travarAdministracao
} from '$server/modules/rbac/administradores';
import { AcessoRecusado } from '$server/modules/rbac/regras';
import { consentimentosDe } from './consentimento';
import { CAMPOS_SENSIVEIS, regimeDe, type Regime } from './regime';
import { estagioPadrao } from './status';
import { ehMenorDeIdade, type AtualizarPessoaEntrada, type CriarPessoaEntrada } from './validacao';

/**
 * Serviço de pessoas.
 *
 * Três responsabilidades que não podem morar na rota:
 *   1. autorizar (o servidor decide, a tela só esconde o que já foi negado)
 *   2. aplicar o regime de dados (ADR 0003) ANTES de qualquer escrita
 *   3. auditar
 *
 * Toda leitura devolve o que o ator pode ver, não o que existe. Filtrar na
 * tela deixaria o dado sensível trafegar até o navegador de quem não pode vê-lo
 * — e ele estaria no HTML, a um "ver código-fonte" de distância.
 *
 * Desde o M04, toda verificação SOBRE uma pessoa leva o grupo dela no
 * contexto (D-M04-4). O conselheiro do PG Azul vê o contato e edita as pessoas
 * do PG Azul — e de mais ninguém. Quem está sem grupo só é alcançado por
 * escopo global.
 */

export type GrupoDaPessoa = { id: string; nome: string; cor: string | null };

export type PessoaResumo = {
	id: string;
	fullName: string;
	statusId: string | null;
	statusNome: string | null;
	statusCor: string | null;
	grupo: GrupoDaPessoa | null;
	/** Nulo quando o ator não tem `person.view_sensitive` no grupo da pessoa. */
	phone: string | null;
	ehMenor: boolean | null;
};

export type PessoaDetalhe = {
	id: string;
	fullName: string;
	birthDate: string | null;
	ehMenor: boolean | null;
	idadeAnos: number | null;
	joinedAt: string | null;
	source: OrigemDoCadastro;
	statusId: string | null;
	statusNome: string | null;
	statusCor: string | null;
	grupo: (GrupoDaPessoa & { desde: Date }) | null;
	createdAt: Date;
	/** Campos sensíveis: presentes só para quem tem permissão no grupo da pessoa. */
	sensiveis: {
		phone: string | null;
		whatsapp: string | null;
		email: string | null;
		relationshipStatus: string | null;
		notes: string | null;
	} | null;
	regime: Regime;
};

/**
 * Lê `is_minor` e a idade da view derivada.
 *
 * Pelo construtor de consultas, e não por `db.execute()` com SQL cru: o
 * formato do retorno de `execute` diverge entre o PGlite dos testes e o
 * postgres.js da produção, e essa divergência já custou um 500 que os testes
 * de integração não pegavam.
 */
export async function sinaisDeIdade(
	db: Database,
	ids: string[]
): Promise<Map<string, { ehMenor: boolean | null; idadeAnos: number | null }>> {
	const mapa = new Map<string, { ehMenor: boolean | null; idadeAnos: number | null }>();
	if (ids.length === 0) return mapa;

	const linhas = await db
		.select({ id: personView.id, isMinor: personView.isMinor, ageYears: personView.ageYears })
		.from(personView)
		.where(inArray(personView.id, ids));

	for (const linha of linhas) {
		mapa.set(linha.id, {
			ehMenor: linha.isMinor === null ? null : Boolean(linha.isMinor),
			idadeAnos: linha.ageYears === null ? null : Number(linha.ageYears)
		});
	}
	return mapa;
}

/** Alguém está vinculado como responsável legal desta pessoa? */
export async function temResponsavelVinculado(db: Database, personId: string): Promise<boolean> {
	const [linha] = await db
		.select({ id: personRelation.id })
		.from(personRelation)
		.where(
			and(
				eq(personRelation.personB, personId),
				eq(personRelation.relationType, 'responsavel_legal')
			)
		)
		.limit(1);
	return !!linha;
}

// ---------------------------------------------------------------------------
// Leitura
// ---------------------------------------------------------------------------

export async function listarPessoas(
	db: Database,
	actor: Actor,
	filtros: { busca?: string; statusId?: string | null; grupoId?: string | null } = {}
): Promise<PessoaResumo[]> {
	// A lista da equipe não pertence a nenhum grupo: quem tem `person.view` em
	// qualquer escopo pode ver quem faz parte dos Eagles. O que é sensível —
	// contato, nascimento, observações — continua atrás de outra permissão,
	// decidida linha a linha com o grupo de cada pessoa.
	authorizeAnywhere(actor, 'person.view');

	const condicoes: (SQL | undefined)[] = [
		eq(person.teamId, actor.teamId),
		isNull(person.deletedAt)
	];

	if (filtros.busca?.trim()) {
		const alvo = `%${normalizarTexto(filtros.busca)}%`;
		condicoes.push(sql`${person.fullNameNormalized} like ${alvo}`);
	}

	// Filtros vêm da URL: id malformado é filtro ignorado, não erro 500.
	if (filtros.statusId && ehId(filtros.statusId)) {
		condicoes.push(eq(person.currentStatusId, filtros.statusId));
	}

	if (filtros.grupoId === SEM_GRUPO) {
		condicoes.push(isNull(groupMembership.id));
	} else if (filtros.grupoId && ehId(filtros.grupoId)) {
		condicoes.push(eq(groupMembership.groupId, filtros.grupoId));
	}

	const linhas = await db
		.select({
			id: person.id,
			fullName: person.fullName,
			phone: person.phone,
			statusId: person.currentStatusId,
			statusNome: membershipStatus.name,
			statusCor: membershipStatus.color,
			grupoId: smallGroup.id,
			grupoNome: smallGroup.name,
			grupoCor: smallGroup.color
		})
		.from(person)
		.leftJoin(membershipStatus, eq(person.currentStatusId, membershipStatus.id))
		.leftJoin(
			groupMembership,
			and(eq(groupMembership.personId, person.id), isNull(groupMembership.leftAt))
		)
		.leftJoin(smallGroup, eq(smallGroup.id, groupMembership.groupId))
		.where(and(...condicoes))
		.orderBy(asc(person.fullNameNormalized))
		.limit(200);

	const idades = await sinaisDeIdade(
		db,
		linhas.map((l) => l.id)
	);

	return linhas.map((l) => {
		const idade = idades.get(l.id) ?? { ehMenor: null, idadeAnos: null };

		// RN-32 — contato só para quem tem `person.view_sensitive` NO GRUPO da
		// pessoa. Até o M03 isto era `canAnywhere`, e o conselheiro de um PG
		// via o telefone de todos os outros (lacuna G1 do M04).
		const podeVerContato =
			l.id === actor.personId ||
			can(actor, 'person.view_sensitive', { personId: l.id, groupId: l.grupoId });

		return {
			id: l.id,
			fullName: l.fullName,
			statusId: l.statusId,
			statusNome: l.statusNome,
			statusCor: l.statusCor,
			grupo: l.grupoId ? { id: l.grupoId, nome: l.grupoNome!, cor: l.grupoCor } : null,
			phone: podeVerContato ? l.phone : null,
			// "É menor" revela a idade: vai com o contato.
			ehMenor: podeVerContato ? idade.ehMenor : null
		};
	});
}

/**
 * Nome e id de todas as pessoas ativas — para seletores ("quem será o
 * responsável?"). Sem contato, sem limite de 200: escolher de uma lista
 * cortada deixaria gente de fora sem aviso.
 */
export async function pessoasParaEscolha(
	db: Database,
	actor: Actor
): Promise<{ id: string; nome: string }[]> {
	authorizeAnywhere(actor, 'person.view');

	return db
		.select({ id: person.id, nome: person.fullName })
		.from(person)
		.where(and(eq(person.teamId, actor.teamId), isNull(person.deletedAt)))
		.orderBy(asc(person.fullNameNormalized));
}

export async function verPessoa(
	db: Database,
	actor: Actor,
	personId: string
): Promise<PessoaDetalhe | null> {
	authorizeAnywhere(actor, 'person.view');

	const [linha] = await db
		.select({
			p: person,
			statusNome: membershipStatus.name,
			statusCor: membershipStatus.color
		})
		.from(person)
		.leftJoin(membershipStatus, eq(person.currentStatusId, membershipStatus.id))
		.where(and(eq(person.id, personId), eq(person.teamId, actor.teamId), isNull(person.deletedAt)))
		.limit(1);

	if (!linha) return null;

	const idade = (await sinaisDeIdade(db, [personId])).get(personId) ?? {
		ehMenor: null,
		idadeAnos: null
	};
	const consentimentos = await consentimentosDe(db, personId);
	const regime = regimeDe(idade, consentimentos, {
		temResponsavelVinculado: await temResponsavelVinculado(db, personId)
	});

	const [grupo] = await db
		.select({
			id: smallGroup.id,
			nome: smallGroup.name,
			cor: smallGroup.color,
			desde: groupMembership.joinedAt
		})
		.from(groupMembership)
		.innerJoin(smallGroup, eq(smallGroup.id, groupMembership.groupId))
		.where(and(eq(groupMembership.personId, personId), isNull(groupMembership.leftAt)))
		.limit(1);

	// Ver os próprios dados nunca exige `view_sensitive` — é o escopo `self`.
	// Para os outros, a permissão vale no grupo da pessoa (D-M04-4).
	const ehEla = actor.personId === personId;
	const contatoVisivel =
		ehEla || can(actor, 'person.view_sensitive', { personId, groupId: grupo?.id ?? null });

	return {
		id: linha.p.id,
		fullName: linha.p.fullName,
		// A data exata é dado pessoal: vai junto com o contato. A idade, que o
		// perfil mostra a todos, continua em `idadeAnos`.
		birthDate: contatoVisivel ? linha.p.birthDate : null,
		ehMenor: idade.ehMenor,
		idadeAnos: idade.idadeAnos,
		joinedAt: linha.p.joinedAt,
		source: linha.p.source as OrigemDoCadastro,
		statusId: linha.p.currentStatusId,
		statusNome: linha.statusNome,
		statusCor: linha.statusCor,
		grupo: grupo ?? null,
		createdAt: linha.p.createdAt,
		sensiveis: contatoVisivel
			? {
					phone: linha.p.phone,
					whatsapp: linha.p.whatsapp,
					email: linha.p.email,
					relationshipStatus: linha.p.relationshipStatus,
					notes: linha.p.notes
				}
			: null,
		regime
	};
}

// ---------------------------------------------------------------------------
// Escrita
// ---------------------------------------------------------------------------

/** A pessoa não está no cadastro desta equipe — ou já saiu dele. */
export class PessoaNaoEncontrada extends Error {
	constructor() {
		super('Essa pessoa não está no cadastro.');
		this.name = 'PessoaNaoEncontrada';
	}
}

export class RegimeRestrito extends Error {
	readonly campos: string[];
	constructor(campos: string[], motivo: string) {
		super(motivo);
		this.name = 'RegimeRestrito';
		this.campos = campos;
	}
}

/**
 * Aplica o regime aos dados que chegaram (RN-30).
 *
 * Recusa em vez de silenciosamente descartar: quem preencheu o telefone de um
 * adolescente precisa saber que ele não foi guardado, e por quê. Descarte
 * silencioso faria o conselheiro achar que registrou.
 */
function exigirRegimeCompativel(
	regime: Regime,
	dados: Partial<Record<string, string | null>>
): void {
	if (!regime.restrito) return;

	const proibidos = CAMPOS_SENSIVEIS.filter((campo) => dados[campo] != null && dados[campo] !== '');

	if (proibidos.length > 0) {
		throw new RegimeRestrito(proibidos, regime.motivo ?? 'Cadastro em regime restrito.');
	}
}

export async function criarPessoa(
	db: Database,
	actor: Actor,
	dados: CriarPessoaEntrada,
	contexto: {
		ip?: string | null;
		userAgent?: string | null;
		source?: OrigemDoCadastro;
		/** Grupo em que a pessoa já entra. Obrigatório para quem não cadastra globalmente. */
		grupoId?: string | null;
	} = {}
): Promise<string> {
	// Com grupo, a permissão vale no escopo dele — e colocar alguém no grupo é
	// também `group.assign_member` ali. Sem grupo, só o escopo global: um
	// conselheiro criaria alguém que ele mesmo deixaria de enxergar no
	// instante seguinte (D-M04-4).
	const grupoId = contexto.grupoId ?? null;
	if (grupoId) {
		authorize(actor, 'person.create', { groupId: grupoId });
		authorize(actor, 'group.assign_member', { groupId: grupoId });
	} else {
		authorize(actor, 'person.create');
	}

	// Regime avaliado ANTES de gravar: pessoa nova nunca tem responsável
	// vinculado nem consentimento registrado, então menor de idade entra
	// obrigatoriamente em cadastro mínimo.
	const ehMenor = calcularEhMenor(dados.birthDate);
	const regime = regimeDe({ ehMenor }, {}, { temResponsavelVinculado: false });
	exigirRegimeCompativel(regime, dados as Record<string, string | null>);

	const padrao = dados.statusId ? null : await estagioPadrao(db, actor.teamId);
	const statusId = dados.statusId ?? padrao?.id ?? null;

	const { criada, movimento } = await db.transaction(async (tx) => {
		const [nova] = await tx
			.insert(person)
			.values({
				teamId: actor.teamId,
				fullName: dados.fullName,
				birthDate: dados.birthDate,
				phone: dados.phone,
				whatsapp: dados.whatsapp,
				email: dados.email,
				relationshipStatus: dados.relationshipStatus,
				joinedAt: dados.joinedAt,
				notes: dados.notes,
				currentStatusId: statusId,
				source: contexto.source ?? 'cadastro'
			})
			.returning({ id: person.id });

		if (!nova) throw new Error('não foi possível criar a pessoa');

		// A primeira atribuição de estágio também é histórico (RN-04): sem ela,
		// a linha do tempo começaria no ar.
		if (statusId) {
			await tx.insert(personStatusHistory).values({
				personId: nova.id,
				fromStatusId: null,
				toStatusId: statusId,
				changedByPersonId: actor.personId,
				reason: 'Cadastro inicial'
			});
		}

		// No mesmo commit: se o grupo estiver arquivado ou não existir, a
		// pessoa também não é criada — e o cadastro não fica pela metade.
		const movimento: Movimento | null = grupoId
			? await moverNaTransacao(tx as unknown as Database, actor, {
					personId: nova.id,
					paraGrupoId: grupoId,
					motivo: 'Cadastro inicial'
				})
			: null;

		return { criada: nova.id, movimento };
	});

	await audit(db, {
		teamId: actor.teamId,
		actorPersonId: actor.personId,
		action: 'person.criada',
		entity: 'person',
		entityId: criada,
		after: { fullName: dados.fullName, source: contexto.source ?? 'cadastro' },
		ip: contexto.ip,
		userAgent: contexto.userAgent
	});

	if (movimento) {
		await auditarMovimento(db, actor, movimento, {
			motivo: 'Cadastro inicial',
			ip: contexto.ip,
			userAgent: contexto.userAgent
		});
	}

	return criada;
}

export async function atualizarPessoa(
	db: Database,
	actor: Actor,
	personId: string,
	dados: AtualizarPessoaEntrada,
	contexto: { ip?: string | null; userAgent?: string | null } = {}
): Promise<void> {
	if (!ehId(personId)) throw new PessoaNaoEncontrada();
	const ctx = await contextoDaPessoa(db, personId);
	authorize(actor, 'person.update', ctx);

	// Quem não VÊ o nascimento e o contato desta pessoa também não os escreve.
	// Sem isto, um papel com `person.update` e sem `view_sensitive` receberia o
	// formulário com esses campos vazios — e salvar só o nome os apagaria.
	const veSensiveis = actor.personId === personId || can(actor, 'person.view_sensitive', ctx);
	if (
		!veSensiveis &&
		(['birthDate', ...CAMPOS_SENSIVEIS] as const).some((c) => dados[c] !== undefined)
	) {
		throw new PolicyDenied('person.view_sensitive', ctx);
	}

	const [antes] = await db
		.select()
		.from(person)
		.where(and(eq(person.id, personId), eq(person.teamId, actor.teamId), isNull(person.deletedAt)))
		.limit(1);

	if (!antes) throw new PessoaNaoEncontrada();

	// A data de nascimento pode estar mudando nesta mesma edição — o regime é
	// avaliado sobre o valor NOVO, não sobre o que estava gravado.
	const nascimento = dados.birthDate !== undefined ? dados.birthDate : antes.birthDate;
	const idade = { ehMenor: calcularEhMenor(nascimento) };
	const regime = regimeDe(idade, await consentimentosDe(db, personId), {
		temResponsavelVinculado: await temResponsavelVinculado(db, personId)
	});
	exigirRegimeCompativel(regime, dados as Record<string, string | null>);

	const mudancas: Record<string, unknown> = {};
	for (const campo of [
		'fullName',
		'birthDate',
		'phone',
		'whatsapp',
		'email',
		'relationshipStatus',
		'joinedAt',
		'notes'
	] as const) {
		if (dados[campo] !== undefined) mudancas[campo] = dados[campo];
	}

	if (Object.keys(mudancas).length === 0) return;

	await db
		.update(person)
		.set({ ...mudancas, updatedAt: new Date() })
		.where(eq(person.id, personId));

	await audit(db, {
		teamId: actor.teamId,
		actorPersonId: actor.personId,
		action: 'person.atualizada',
		entity: 'person',
		entityId: personId,
		before: recorte(antes, Object.keys(mudancas)),
		after: mudancas,
		ip: contexto.ip,
		userAgent: contexto.userAgent
	});
}

/**
 * Remoção lógica.
 *
 * Nunca DELETE: presença, histórico de estágio e, no futuro, movimentação
 * financeira apontam para a pessoa. Apagar de verdade deixaria buracos em
 * registros que precisam continuar íntegros.
 */
export async function removerPessoa(
	db: Database,
	actor: Actor,
	personId: string,
	contexto: { ip?: string | null; userAgent?: string | null } = {}
): Promise<void> {
	if (!ehId(personId)) throw new PessoaNaoEncontrada();
	authorize(actor, 'person.delete', await contextoDaPessoa(db, personId));

	if (personId === actor.personId) {
		throw new AcessoRecusado('propria_conta', 'Você não pode remover o próprio cadastro.');
	}

	const efeitos = await db.transaction(async (tx) => {
		// Remover pessoa pode remover um administrador: mesma serialização e
		// mesma trava da retirada de papel (D-M03-2, trava 4).
		await travarAdministracao(tx as unknown as Database, actor.teamId);
		const administradoresAntes = await contarAdministradoresAtivos(
			tx as unknown as Database,
			actor.teamId
		);

		// Primeiro a pessoa, e só se ela está NESTA equipe e ainda no cadastro.
		// Antes, o resto da remoção (grupos, papéis) filtrava só pelo id: valia
		// para a pessoa de outra equipe, e remover duas vezes reescrevia a data
		// da remoção e duplicava a auditoria (revisão de 17/10/2026).
		const [removida] = await tx
			.update(person)
			.set({ deletedAt: new Date(), updatedAt: new Date() })
			.where(
				and(eq(person.id, personId), eq(person.teamId, actor.teamId), isNull(person.deletedAt))
			)
			.returning({ id: person.id });
		if (!removida) throw new PessoaNaoEncontrada();

		// Quem sai do cadastro sai também do grupo — senão continuaria contando
		// como membro e impediria o grupo de ser arquivado. O vínculo é
		// encerrado, não apagado: a passagem pelo grupo continua na história.
		await tx
			.update(groupMembership)
			.set({
				leftAt: sql`now()`,
				leftReason: 'Cadastro removido',
				endedByPersonId: actor.personId
			})
			.where(and(eq(groupMembership.personId, personId), isNull(groupMembership.leftAt)));

		// E sai dos papéis. Atribuição de quem saiu do cadastro não autoriza
		// nada, mas travava o arquivamento do grupo e a exclusão do papel —
		// sem aparecer em tela nenhuma (varredura de 11/10/2026).
		const removidos = await tx
			.delete(personRole)
			.where(eq(personRole.personId, personId))
			.returning({
				id: personRole.id,
				roleId: personRole.roleId,
				scopeType: personRole.scopeType,
				scopeId: personRole.scopeId
			});

		// E sai do app agora, não "quando a sessão expirar": aparelhos
		// desconectados e convites pendentes cancelados.
		const sessoesEncerradas = await revogarSessoesDaPessoa(tx as unknown as Database, personId);
		const convitesCancelados = await revogarConvitesDaPessoa(tx as unknown as Database, personId);

		// A remoção não pode ZERAR os administradores. Se já não havia nenhum,
		// não foi ela que trancou a equipe.
		if (administradoresAntes > 0) {
			await exigirAdministradorRestante(tx as unknown as Database, actor.teamId);
		}
		return {
			...(removidos.length > 0 && { papeisRemovidos: removidos }),
			...(sessoesEncerradas > 0 && { sessoesEncerradas }),
			...(convitesCancelados > 0 && { convitesCancelados })
		};
	});

	await audit(db, {
		teamId: actor.teamId,
		actorPersonId: actor.personId,
		action: 'person.removida',
		entity: 'person',
		entityId: personId,
		after: Object.keys(efeitos).length > 0 ? efeitos : undefined,
		ip: contexto.ip,
		userAgent: contexto.userAgent
	});
}

/**
 * Autocadastro de visitante (RF-02.3).
 *
 * A ÚNICA escrita do sistema sem um ator autenticado. Por isso vive numa
 * função separada, com nome explícito: quem ler `criarPessoa` não deve
 * descobrir por acaso que existe um caminho sem autorização.
 *
 * As proteções que substituem a autenticação:
 *   - a chave `autocadastro_visitante`, desligada por padrão (RN-29)
 *   - limite por IP, aplicado na rota
 *   - regime restrito sempre que a idade indicar menor (ADR 0003)
 *   - `source = 'autocadastro'`, para a liderança saber a procedência do dado
 *
 * O que esta função NÃO faz: criar conta de acesso, atribuir papel ou vincular
 * a grupo. Quem se cadastra aqui vira uma linha em `person` e nada mais — o
 * acesso continua nascendo de um convite emitido por alguém (ADR 0004).
 */
export async function autocadastrarVisitante(
	db: Database,
	teamId: string,
	dados: {
		fullName: string;
		birthDate: string | null;
		phone: string | null;
		nomeDoResponsavel: string | null;
		telefoneDoResponsavel: string | null;
	},
	contexto: { ip?: string | null; userAgent?: string | null } = {}
): Promise<{ id: string; ehMenor: boolean | null }> {
	const ehMenor = calcularEhMenor(dados.birthDate);
	const regime = regimeDe({ ehMenor }, {}, { temResponsavelVinculado: false });

	// Menor de idade NÃO informa o próprio contato num formulário público
	// (ADR 0003). O que ele preenche sobre o responsável vai para observação,
	// como recado para o conselheiro coletar o consentimento presencialmente.
	const podeGuardarContato = regime.podeGuardarContato;

	const recado =
		ehMenor !== false && (dados.nomeDoResponsavel || dados.telefoneDoResponsavel)
			? `Responsável informado no autocadastro: ${dados.nomeDoResponsavel ?? 'sem nome'}` +
				(dados.telefoneDoResponsavel ? ` — ${dados.telefoneDoResponsavel}` : '') +
				'. Falta coletar o consentimento presencialmente.'
			: null;

	const padrao = await estagioPadrao(db, teamId);

	const criada = await db.transaction(async (tx) => {
		const [nova] = await tx
			.insert(person)
			.values({
				teamId,
				fullName: dados.fullName,
				birthDate: dados.birthDate,
				phone: podeGuardarContato ? dados.phone : null,
				whatsapp: podeGuardarContato ? dados.phone : null,
				// O recado sobre o responsável é o único texto que escapa do regime
				// restrito, e de propósito: sem ele o conselheiro não sabe a quem
				// procurar para regularizar o cadastro.
				notes: recado,
				currentStatusId: padrao?.id ?? null,
				source: 'autocadastro'
			})
			.returning({ id: person.id });

		if (!nova) throw new Error('não foi possível registrar o autocadastro');

		if (padrao?.id) {
			await tx.insert(personStatusHistory).values({
				personId: nova.id,
				fromStatusId: null,
				toStatusId: padrao.id,
				changedByPersonId: null,
				reason: 'Autocadastro'
			});
		}

		return nova.id;
	});

	await audit(db, {
		teamId,
		actorPersonId: null,
		action: 'person.autocadastro',
		entity: 'person',
		entityId: criada,
		after: { fullName: dados.fullName, ehMenor },
		ip: contexto.ip,
		userAgent: contexto.userAgent
	});

	return { id: criada, ehMenor };
}

// ---------------------------------------------------------------------------
// Auxiliares
// ---------------------------------------------------------------------------

/**
 * Menoridade a partir da data de nascimento, para decidir o regime ANTES de a
 * linha existir no banco (e portanto antes de a view poder responder). Uma
 * regra de idade só — a mesma do autocadastro (`ehMenorDeIdade`).
 *
 * `null` — data desconhecida — continua significando "trate como menor".
 */
function calcularEhMenor(birthDate: string | null | undefined): boolean | null {
	return ehMenorDeIdade(birthDate ?? null);
}

function recorte(objeto: Record<string, unknown>, campos: string[]): Record<string, unknown> {
	const saida: Record<string, unknown> = {};
	for (const campo of campos) saida[campo] = objeto[campo];
	return saida;
}

export { calcularEhMenor };

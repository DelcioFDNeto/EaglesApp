import { and, eq, inArray, isNull, or } from 'drizzle-orm';
import { ehId } from '$shared/formulario';
import type { Database } from '$server/db';
import { person, personRelation } from '$server/db/schema';
import { audit } from '$server/audit/log';
import { authorize, type Actor } from '$server/policy/policy';
import { contextoDaPessoa } from '$server/modules/grupos/contexto';
import { ehVinculoSimetrico, type TipoDeVinculo } from '$shared/pessoa';

/**
 * Vínculos entre pessoas: irmão, cônjuge, namorado e responsável legal.
 *
 * Existem por dois motivos concretos: o responsável legal é exigência do
 * ADR 0003, e os demais alimentam a sugestão de divisão de grupos do M04 —
 * separar irmãos ou casais no mesmo PG costuma ser decisão consciente da
 * liderança, e para decidir ela precisa que o sistema saiba do vínculo.
 */

export type VinculoDe = {
	id: string;
	outraPessoaId: string;
	outraPessoaNome: string;
	tipo: TipoDeVinculo;
	/** Nesta relação, a pessoa consultada é o responsável pelo outro? */
	souOResponsavel: boolean;
};

/**
 * Ordena o par conforme a regra do banco.
 *
 * Simétricos guardam UMA linha com `person_a < person_b` (CHECK na migração
 * 0003). Dirigidos preservam a ordem que veio: em `responsavel_legal`,
 * `person_a` é quem responde por `person_b`.
 */
function ordenarPar(
	a: string,
	b: string,
	tipo: TipoDeVinculo
): { personA: string; personB: string } {
	if (!ehVinculoSimetrico(tipo)) return { personA: a, personB: b };
	return a < b ? { personA: a, personB: b } : { personA: b, personB: a };
}

export class VinculoInvalido extends Error {
	constructor(mensagem: string) {
		super(mensagem);
		this.name = 'VinculoInvalido';
	}
}

/** A pessoa está no cadastro desta equipe? */
async function estaNoCadastro(db: Database, teamId: string, personId: string): Promise<boolean> {
	const [linha] = await db
		.select({ id: person.id })
		.from(person)
		.where(and(eq(person.id, personId), eq(person.teamId, teamId), isNull(person.deletedAt)))
		.limit(1);
	return !!linha;
}

/** Vínculos de uma pessoa, olhando os dois lados da tabela. */
export async function vinculosDe(db: Database, personId: string): Promise<VinculoDe[]> {
	const linhas = await db
		.select({
			id: personRelation.id,
			personA: personRelation.personA,
			personB: personRelation.personB,
			tipo: personRelation.relationType
		})
		.from(personRelation)
		.where(or(eq(personRelation.personA, personId), eq(personRelation.personB, personId)));

	if (linhas.length === 0) return [];

	// Os nomes numa segunda consulta. Um join com OR nas duas pontas traria
	// cada vínculo duplicado e ainda exigiria alias para saber qual nome é de
	// quem — duas consultas simples são mais fáceis de ler e de conferir.
	const outrosIds = [
		...new Set(linhas.map((l) => (l.personA === personId ? l.personB : l.personA)))
	];

	const nomes = new Map(
		(
			await db
				.select({ id: person.id, fullName: person.fullName })
				.from(person)
				.where(inArray(person.id, outrosIds))
		).map((p) => [p.id, p.fullName])
	);

	return linhas.map((l) => {
		const souA = l.personA === personId;
		const outra = souA ? l.personB : l.personA;
		return {
			id: l.id,
			outraPessoaId: outra,
			outraPessoaNome: nomes.get(outra) ?? 'pessoa removida',
			tipo: l.tipo as TipoDeVinculo,
			souOResponsavel: l.tipo === 'responsavel_legal' && souA
		};
	});
}

export async function criarVinculo(
	db: Database,
	actor: Actor,
	entrada: { pessoaId: string; outraPessoaId: string; tipo: TipoDeVinculo }
): Promise<void> {
	if (!ehId(entrada.pessoaId) || !ehId(entrada.outraPessoaId)) {
		throw new VinculoInvalido('A outra pessoa não existe.');
	}
	authorize(actor, 'person.update', await contextoDaPessoa(db, entrada.pessoaId));

	if (entrada.pessoaId === entrada.outraPessoaId) {
		throw new VinculoInvalido('Não dá para vincular uma pessoa a ela mesma.');
	}

	// O vínculo é das DUAS pessoas — e "responsável legal" muda o regime de
	// dados de quem é o dependente (ADR 0003). Quem só pode editar um dos lados
	// não decide pelo outro (varredura de 11/10/2026).
	if (!(await estaNoCadastro(db, actor.teamId, entrada.outraPessoaId))) {
		throw new VinculoInvalido('A outra pessoa não existe.');
	}
	authorize(actor, 'person.update', await contextoDaPessoa(db, entrada.outraPessoaId));

	const { personA, personB } = ordenarPar(entrada.pessoaId, entrada.outraPessoaId, entrada.tipo);

	const [criado] = await db
		.insert(personRelation)
		.values({
			teamId: actor.teamId,
			personA,
			personB,
			relationType: entrada.tipo,
			createdByPersonId: actor.personId
		})
		.onConflictDoNothing()
		.returning({ id: personRelation.id });

	// Sem linha retornada = o vínculo já existia. Repetir não é erro: quem
	// clicou queria que o vínculo existisse, e ele existe.
	if (!criado) return;

	await audit(db, {
		teamId: actor.teamId,
		actorPersonId: actor.personId,
		action: 'person.vinculo_criado',
		entity: 'person_relation',
		entityId: criado.id,
		after: { personA, personB, tipo: entrada.tipo }
	});
}

export async function removerVinculo(
	db: Database,
	actor: Actor,
	vinculoId: string,
	pessoaId: string
): Promise<void> {
	if (!ehId(vinculoId) || !ehId(pessoaId)) return;
	authorize(actor, 'person.update', await contextoDaPessoa(db, pessoaId));

	const [antes] = await db
		.select()
		.from(personRelation)
		.where(and(eq(personRelation.id, vinculoId), eq(personRelation.teamId, actor.teamId)))
		.limit(1);

	if (!antes) return;

	// A permissão foi conferida sobre `pessoaId`. Sem esta linha, quem pode
	// editar alguém do próprio grupo apagaria o vínculo entre duas pessoas de
	// outro grupo — bastava mandar o id do vínculo alheio (lacuna G6 do M04).
	if (antes.personA !== pessoaId && antes.personB !== pessoaId) return;

	// Desfazer também é decidir pelos dois lados: tirar o "responsável legal"
	// muda o regime do menor tanto quanto criá-lo. O criar já conferia os dois;
	// o remover, só um (revisão de 17/10/2026). Quem saiu do cadastro não tem
	// lado a proteger — o vínculo com ela se desfaz por quem cuida da outra.
	const outra = antes.personA === pessoaId ? antes.personB : antes.personA;
	if (await estaNoCadastro(db, actor.teamId, outra)) {
		authorize(actor, 'person.update', await contextoDaPessoa(db, outra));
	}

	await db.delete(personRelation).where(eq(personRelation.id, vinculoId));

	await audit(db, {
		teamId: actor.teamId,
		actorPersonId: actor.personId,
		action: 'person.vinculo_removido',
		entity: 'person_relation',
		entityId: vinculoId,
		before: { personA: antes.personA, personB: antes.personB, tipo: antes.relationType }
	});
}

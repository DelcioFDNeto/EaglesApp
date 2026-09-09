import { and, eq, inArray, or } from 'drizzle-orm';
import type { Database } from '$server/db';
import { person, personRelation } from '$server/db/schema';
import { audit } from '$server/audit/log';
import { authorize, type Actor } from '$server/policy/policy';
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
	authorize(actor, 'person.update', { personId: entrada.pessoaId });

	if (entrada.pessoaId === entrada.outraPessoaId) {
		throw new VinculoInvalido('Não dá para vincular uma pessoa a ela mesma.');
	}

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
	authorize(actor, 'person.update', { personId: pessoaId });

	const [antes] = await db
		.select()
		.from(personRelation)
		.where(and(eq(personRelation.id, vinculoId), eq(personRelation.teamId, actor.teamId)))
		.limit(1);

	if (!antes) return;

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

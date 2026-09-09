import { and, eq, isNull, or, sql } from 'drizzle-orm';
import type { Database } from '$server/db';
import { person } from '$server/db/schema';
import { normalizarTexto, somenteDigitos } from '$shared/pessoa';

/**
 * Detecção de possível duplicidade no cadastro (RF-02.6).
 *
 * AVISA, NUNCA BLOQUEIA. Duas pessoas podem ter o mesmo nome — é comum em
 * família, e "João Silva" não é identificador. Um sistema que recusa o segundo
 * cadastro força quem está na porta do PG a inventar contorno ("João Silva 2"),
 * e aí o dado sujo entra de qualquer jeito, só que pior.
 *
 * O objetivo é que o conselheiro veja "já existe uma Ana Clara Souza" e decida.
 */

export type PossivelDuplicata = {
	id: string;
	fullName: string;
	motivo: 'nome' | 'telefone';
};

/**
 * Procura candidatos a duplicata de alguém prestes a ser cadastrado.
 *
 * Dois sinais, ambos baratos e com índice:
 *   - nome exatamente igual depois de normalizado (sem acento, sem caixa)
 *   - telefone com os mesmos dígitos, em qualquer um dos dois campos
 *
 * Deliberadamente NÃO faz busca por similaridade. `pg_trgm` traria "Ana" ≈
 * "Ane" e um monte de falso positivo; alarme que quase sempre erra é alarme
 * que se aprende a ignorar, e aí o alarme verdadeiro passa junto.
 */
export async function procurarPossiveisDuplicatas(
	db: Database,
	teamId: string,
	dados: { fullName: string; phone?: string | null; whatsapp?: string | null },
	opcoes: { ignorarPersonId?: string } = {}
): Promise<PossivelDuplicata[]> {
	const nomeNormalizado = normalizarTexto(dados.fullName);
	const telefones = [dados.phone, dados.whatsapp]
		.map((t) => (t ? somenteDigitos(t) : ''))
		.filter((t) => t.length >= 8);

	const porTelefone =
		telefones.length > 0
			? or(
					...telefones.flatMap((t) => [
						sql`regexp_replace(coalesce(${person.phone}, ''), '\\D', '', 'g') = ${t}`,
						sql`regexp_replace(coalesce(${person.whatsapp}, ''), '\\D', '', 'g') = ${t}`
					])
				)
			: undefined;

	const linhas = await db
		.select({
			id: person.id,
			fullName: person.fullName,
			nomeIgual: sql<boolean>`${person.fullNameNormalized} = ${nomeNormalizado}`
		})
		.from(person)
		.where(
			and(
				eq(person.teamId, teamId),
				isNull(person.deletedAt),
				or(sql`${person.fullNameNormalized} = ${nomeNormalizado}`, porTelefone)
			)
		)
		.limit(5);

	return linhas
		.filter((l) => l.id !== opcoes.ignorarPersonId)
		.map((l) => ({
			id: l.id,
			fullName: l.fullName,
			motivo: l.nomeIgual ? ('nome' as const) : ('telefone' as const)
		}));
}

/** Mensagem pronta para a tela, no plural certo. */
export function mensagemDeDuplicata(duplicatas: PossivelDuplicata[]): string {
	if (duplicatas.length === 0) return '';

	const porTelefone = duplicatas.some((d) => d.motivo === 'telefone');
	const alvo = porTelefone ? 'o mesmo telefone' : 'o mesmo nome';

	return duplicatas.length === 1
		? `Já existe alguém com ${alvo}: ${duplicatas[0]!.fullName}. Confira antes de cadastrar de novo.`
		: `Já existem ${duplicatas.length} pessoas com ${alvo}. Confira antes de cadastrar de novo.`;
}

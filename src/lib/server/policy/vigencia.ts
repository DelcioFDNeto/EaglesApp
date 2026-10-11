import { and, gt, isNull, or, sql, type SQL } from 'drizzle-orm';
import { person, personRole } from '../db/schema';

/**
 * Atribuição de papel EM VIGOR: sem validade, ou com validade no futuro.
 *
 * Uma regra só, para a política (quem pode o quê), as telas (quem é
 * responsável) e as travas (arquivar grupo, excluir papel). Ela existia em
 * seis cópias, e as travas já tinham divergido das telas: contavam atribuições
 * vencidas que ninguém via — e o grupo nunca se arquivava (varredura de
 * 11/10/2026).
 */
export function atribuicaoVigente(): SQL {
	return or(isNull(personRole.expiresAt), gt(personRole.expiresAt, sql`now()`))!;
}

/**
 * Vigente E de quem continua no cadastro — o responsável de verdade.
 * A consulta precisa juntar `person`.
 */
export function atribuicaoAtiva(): SQL {
	return and(atribuicaoVigente(), isNull(person.deletedAt))!;
}

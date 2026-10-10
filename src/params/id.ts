import type { ParamMatcher } from '@sveltejs/kit';
import { ehId } from '$shared/formulario';

/**
 * `[id=id]`: só casa com um uuid. Um id malformado na URL vira 404 no
 * roteador — antes chegava ao Postgres como erro de sintaxe e voltava 500.
 */
export const match: ParamMatcher = (param) => ehId(param);

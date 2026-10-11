import { error, fail } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import { db } from '$server/db';
import { team } from '$server/db/schema';
import { checkRateLimit, RULES } from '$server/auth/ratelimit';
import { funcionalidadeLigada } from '$server/settings/flags';
import { autocadastrarVisitante } from '$server/modules/pessoas/pessoas';
import { autocadastroSchema } from '$server/modules/pessoas/validacao';
import { ehMenorDeIdade } from '$server/modules/pessoas/validacao';
import type { FalhaDeFormulario } from '$shared/formulario';
import type { Actions, PageServerLoad } from './$types';

/** Formato único das falhas desta rota — ver `$shared/formulario`. */
type Falha = FalhaDeFormulario<{ ehMenor: boolean }>;

/**
 * Autocadastro de visitante (RF-02.3).
 *
 * PERMISSÃO: pública POR DECISÃO, e por isso cercada por três coisas:
 *
 *   1. a chave `autocadastro_visitante`, **desligada por padrão** (RN-29) —
 *      com ela desligada a rota responde 404, e não uma página dizendo
 *      "recurso desativado", que só entregaria que o endereço existe;
 *   2. limite por IP, porque é o único formulário público que escreve no banco;
 *   3. regime restrito para menor de idade (ADR 0003) — quem é menor não
 *      preenche o próprio contato aqui.
 *
 * O cadastro cria uma `person` e nada mais: nenhuma conta, nenhum papel,
 * nenhum grupo. Acesso continua nascendo de convite (ADR 0004).
 */

/** A instalação tem uma equipe só ("Eagles"), sem interface — ADR 0001. */
async function equipeUnica() {
	const [linha] = await db()
		.select({ id: team.id })
		.from(team)
		.where(eq(team.slug, 'eagles'))
		.limit(1);
	return linha ?? null;
}

export const load: PageServerLoad = async () => {
	const equipe = await equipeUnica();
	if (!equipe) error(404, 'Não encontrado.');

	if (!(await funcionalidadeLigada(db(), equipe.id, 'autocadastro_visitante'))) {
		error(404, 'Não encontrado.');
	}

	return {};
};

export const actions: Actions = {
	default: async ({ request, getClientAddress }) => {
		const equipe = await equipeUnica();
		if (!equipe) error(404, 'Não encontrado.');

		if (!(await funcionalidadeLigada(db(), equipe.id, 'autocadastro_visitante'))) {
			error(404, 'Não encontrado.');
		}

		const ip = getClientAddress();
		const muitos = (segundos: number): Falha => ({
			erro:
				`Muitos cadastros deste dispositivo. Tente de novo em ` +
				`${Math.ceil(segundos / 60)} minutos, ou peça ajuda a alguém dos Eagles.`
		});

		// Envios, válidos ou não: freio contra robô, folgado para gente.
		const tentativas = checkRateLimit(
			`autocadastro:tentativa:${ip}`,
			RULES.autocadastroTentativasPorIp
		);
		if (!tentativas.allowed) return fail(429, muitos(tentativas.retryAfterSeconds));

		const form = await request.formData();
		const bruto = Object.fromEntries(form) as Record<string, string>;

		const parsed = autocadastroSchema.safeParse(bruto);

		if (!parsed.success) {
			const campos = parsed.error.flatten().fieldErrors;
			const falha: Falha = {
				valores: bruto,
				erros: Object.fromEntries(
					Object.entries(campos).map(([campo, mensagens]) => [campo, mensagens?.[0]])
				)
			};
			return fail(400, falha);
		}

		const ehMenor = ehMenorDeIdade(parsed.data.birthDate);

		// Menor de idade precisa informar quem responde por ele. Sem isso o
		// conselheiro não tem a quem procurar para coletar o consentimento.
		if (ehMenor === true && !parsed.data.nomeDoResponsavel) {
			const falha: Falha = {
				valores: bruto,
				ehMenor: true,
				erros: { nomeDoResponsavel: 'Informe o nome de quem é responsável por você.' }
			};
			return fail(400, falha);
		}

		// A cota de CADASTROS só se gasta com cadastro válido — o erro de
		// digitação de um não bloqueia quem está atrás no mesmo Wi-Fi.
		const limite = checkRateLimit(`autocadastro:${ip}`, RULES.autocadastroPorIp);
		if (!limite.allowed) return fail(429, muitos(limite.retryAfterSeconds));

		const { ehMenor: menor } = await autocadastrarVisitante(db(), equipe.id, parsed.data, {
			ip,
			userAgent: request.headers.get('user-agent')
		});

		return { pronto: true, ehMenor: menor };
	}
};

import { error, fail, redirect } from '@sveltejs/kit';
import { db } from '$server/db';
import { canAnywhere, PolicyDenied } from '$server/policy/policy';
import { cadastrarNaPorta, listaDePresenca, registrarLista } from '$server/modules/presenca/lista';
import { EventoRecusado, statusDaRecusaDeEvento } from '$server/modules/eventos/regras';
import { RegimeRestrito } from '$server/modules/pessoas/pessoas';
import { criarPessoaSchema } from '$server/modules/pessoas/validacao';
import { GrupoRecusado } from '$server/modules/grupos/regras';
import type { FalhaDeFormulario } from '$shared/formulario';
import type { Actions, PageServerLoad } from './$types';

/**
 * Lista de presença (RF-06.2, D-M06-6) — o F3 da seção 10.
 *
 * PERMISSÃO: `attendance.record` no grupo do evento, verificado pelo serviço
 * (o grupo só se sabe depois de carregar o evento). A rota declara o mínimo:
 * deter a permissão em algum escopo.
 *
 * Um formulário, um botão: os marcados passam a ser a presença do evento. Se
 * algo for recusado, as marcações voltam para a tela — ninguém refaz a lista.
 */

type Falha = FalhaDeFormulario<{ presentes: string[] }>;

const NEGADO = 'Você não pode fazer a lista de presença deste evento.';

export const load: PageServerLoad = async ({ locals, params }) => {
	if (!locals.actor) redirect(303, '/entrar');
	if (!canAnywhere(locals.actor, 'attendance.record')) error(403, NEGADO);

	try {
		const lista = await listaDePresenca(db(), locals.actor, params.id);
		return {
			...lista,
			evento: { ...lista.evento, listaFeitaEm: lista.evento.listaFeitaEm?.toISOString() ?? null }
		};
	} catch (erro) {
		if (erro instanceof PolicyDenied) error(403, NEGADO);
		if (erro instanceof EventoRecusado) error(404, erro.message);
		throw erro;
	}
};

export const actions: Actions = {
	default: async ({ locals, params, request, getClientAddress }) => {
		if (!locals.actor) redirect(303, '/entrar');
		if (!canAnywhere(locals.actor, 'attendance.record')) error(403, NEGADO);

		const form = await request.formData();
		const presentes = [...new Set(form.getAll('presentes').map(String))];
		const contexto = { ip: getClientAddress(), userAgent: request.headers.get('user-agent') };
		const valores = {
			visitanteNome: String(form.get('visitanteNome') ?? ''),
			visitanteNascimento: String(form.get('visitanteNascimento') ?? ''),
			visitanteWhatsapp: String(form.get('visitanteWhatsapp') ?? '')
		};

		try {
			// Quem chegou pela primeira vez (F1): cadastrado no grupo do evento e
			// já presente, na mesma gravação da lista.
			if (valores.visitanteNome.trim()) {
				const parsed = criarPessoaSchema.safeParse({
					fullName: valores.visitanteNome,
					birthDate: valores.visitanteNascimento,
					phone: valores.visitanteWhatsapp,
					whatsapp: valores.visitanteWhatsapp
				});
				if (!parsed.success) {
					const campos = parsed.error.flatten().fieldErrors;
					return fail(400, {
						presentes,
						valores,
						erros: {
							visitanteNome: campos.fullName?.[0],
							visitanteNascimento: campos.birthDate?.[0],
							visitanteWhatsapp: campos.phone?.[0]
						}
					} satisfies Falha);
				}
				presentes.push(
					await cadastrarNaPorta(db(), locals.actor, params.id, parsed.data, contexto)
				);
			}

			const r = await registrarLista(db(), locals.actor, params.id, presentes, contexto);
			return {
				sucesso:
					r.presentes === 1 ? 'Lista salva: 1 presente.' : `Lista salva: ${r.presentes} presentes.`
			};
		} catch (erro) {
			if (erro instanceof RegimeRestrito) {
				return fail(422, {
					presentes,
					valores,
					erros: {
						visitanteWhatsapp:
							'Sem a data de nascimento (ou para menor de idade), o cadastro guarda só o nome. Deixe o WhatsApp em branco ou informe o nascimento.'
					}
				} satisfies Falha);
			}
			if (erro instanceof EventoRecusado) {
				return fail(statusDaRecusaDeEvento(erro.motivo), {
					presentes,
					valores,
					erro: erro.message
				} satisfies Falha);
			}
			if (erro instanceof GrupoRecusado || erro instanceof PolicyDenied) {
				return fail(403, {
					presentes,
					valores,
					erro:
						erro instanceof GrupoRecusado
							? erro.message
							: 'Você não pode cadastrar pessoas neste grupo. Peça a quem cuida dele.'
				} satisfies Falha);
			}
			throw erro;
		}
	}
};

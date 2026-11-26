import { json } from '@sveltejs/kit';
import { and, asc, eq, ne } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '$server/db';
import {
	announcement,
	escala,
	event as eventTable,
	group as groupTable,
	messageTemplate,
	person as personTable,
	responsabilidade as responsabilidadeTable
} from '$server/db/schema';
import { autenticarAtor } from '$lib/server/auth/middleware';
import { can, groupsWhere } from '$server/policy/policy';
import {
	formatarEscalaParaWhatsapp,
	gerarLinkWhatsapp,
	renderizarModelo,
	type VariaveisMensagem
} from '$server/comunicacao/mensagens';

const renderizarSchema = z.object({
	templateId: z.string().uuid().optional(),
	conteudo: z.string().trim().min(1).max(4000).optional(),
	eventoId: z.string().uuid().optional(),
	anuncioId: z.string().uuid().optional(),
	linkBase: z.string().url().optional()
});

/**
 * Renderiza um texto pronto para WhatsApp a partir de um modelo + evento/aviso real (RF-09.1 / RF-09.3).
 * Nunca inclui telefone, e-mail ou foto de participantes (RN-33).
 */
export const POST = async ({ request, locals }) => {
	const banco = db();
	const auth = await autenticarAtor(request, banco, locals?.actor);
	if (!auth) {
		return json({ erro: 'Não autenticado' }, { status: 401 });
	}

	const { actor } = auth;
	const podeUsar =
		can(actor, 'event.view', { personId: actor.personId }) ||
		can(actor, 'announcement.create') ||
		groupsWhere(actor, 'announcement.create').length > 0;
	if (!podeUsar) {
		return json({ erro: 'Sem permissão para gerar mensagens.' }, { status: 403 });
	}

	let corpo: unknown;
	try {
		corpo = await request.json();
	} catch {
		return json({ erro: 'Corpo da requisição inválido.' }, { status: 400 });
	}

	const resultado = renderizarSchema.safeParse(corpo);
	if (!resultado.success) {
		return json(
			{ erro: 'Dados inválidos.', detalhes: resultado.error.flatten().fieldErrors },
			{ status: 400 }
		);
	}

	const dados = resultado.data;
	let templateTexto = dados.conteudo ?? '';

	if (dados.templateId) {
		const [modelo] = await banco
			.select({ content: messageTemplate.content })
			.from(messageTemplate)
			.where(
				and(
					eq(messageTemplate.id, dados.templateId),
					eq(messageTemplate.teamId, actor.teamId)
				)
			)
			.limit(1);

		if (!modelo) {
			return json({ erro: 'Modelo de mensagem não encontrado.' }, { status: 404 });
		}
		templateTexto = modelo.content;
	}

	if (!templateTexto) {
		return json({ erro: 'Informe um modelo ou texto para renderizar.' }, { status: 400 });
	}

	const variaveis: VariaveisMensagem = {};

	if (dados.eventoId) {
		const [ev] = await banco
			.select({
				id: eventTable.id,
				title: eventTable.title,
				startsAt: eventTable.startsAt,
				location: eventTable.location,
				groupName: groupTable.name
			})
			.from(eventTable)
			.leftJoin(groupTable, eq(groupTable.id, eventTable.groupId))
			.where(and(eq(eventTable.id, dados.eventoId), eq(eventTable.teamId, actor.teamId)))
			.limit(1);

		if (!ev) {
			return json({ erro: 'Evento não encontrado.' }, { status: 404 });
		}

		variaveis.evento = ev.title;
		variaveis.data = new Date(ev.startsAt).toLocaleDateString('pt-BR', {
			weekday: 'short',
			day: '2-digit',
			month: '2-digit',
			hour: '2-digit',
			minute: '2-digit'
		});
		variaveis.local = ev.location ?? 'A confirmar';
		variaveis.grupo = ev.groupName ?? 'Eagles';
		if (dados.linkBase) {
			variaveis.link = `${dados.linkBase.replace(/\/$/, '')}/eventos/${ev.id}`;
		}

		const itensEscala = await banco
			.select({
				responsabilidadeNome: responsabilidadeTable.nome,
				pessoaNome: personTable.fullName,
				status: escala.status
			})
			.from(escala)
			.innerJoin(personTable, eq(personTable.id, escala.personId))
			.innerJoin(responsabilidadeTable, eq(responsabilidadeTable.id, escala.responsabilidadeId))
			.where(and(eq(escala.eventId, ev.id), ne(escala.status, 'trocada')))
			.orderBy(asc(escala.ordem), asc(responsabilidadeTable.nome));

		variaveis.escala = formatarEscalaParaWhatsapp(itensEscala);
	}

	if (dados.anuncioId) {
		const [av] = await banco
			.select({ title: announcement.title, body: announcement.body })
			.from(announcement)
			.where(and(eq(announcement.id, dados.anuncioId), eq(announcement.teamId, actor.teamId)))
			.limit(1);

		if (!av) {
			return json({ erro: 'Aviso não encontrado.' }, { status: 404 });
		}

		variaveis.titulo = av.title;
		variaveis.mensagem = av.body;
	}

	const texto = renderizarModelo(templateTexto, variaveis);
	return json({
		ok: true,
		texto,
		whatsappUrl: gerarLinkWhatsapp(texto)
	});
};

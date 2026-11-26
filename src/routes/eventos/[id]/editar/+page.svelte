<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import Aviso from '$ui/Aviso.svelte';
	import Marca from '$ui/Marca.svelte';
	import FormularioEvento, { type OpcoesFormulario } from '$lib/eventos/FormularioEvento.svelte';
	import { paraInputLocal, type DadosFormulario } from '$lib/eventos/formulario';
	import { api } from '$lib/api';

	const eventoId = page.params.id ?? '';

	let opcoes = $state<OpcoesFormulario | null>(null);
	let inicial = $state<DadosFormulario | null>(null);
	let chavesComResposta = $state<string[]>([]);
	let titulo = $state('');
	let carregando = $state(true);
	let erro = $state<string | undefined>(undefined);
	let erroServidor = $state<string | undefined>(undefined);
	let salvando = $state(false);

	onMount(async () => {
		try {
			const [resEvento, resOpcoes] = await Promise.all([
				api.get(`/api/eventos/${eventoId}`),
				api.get('/api/eventos/opcoes')
			]);
			const d = await resEvento.json().catch(() => ({}));
			const o = await resOpcoes.json().catch(() => ({}));

			if (!resEvento.ok) {
				erro = d.erro ?? 'Não foi possível carregar o evento.';
				return;
			}
			if (!resOpcoes.ok || !d.permissoesEvento?.podeGerenciarEvento) {
				erro = 'Você não tem permissão para editar este evento.';
				return;
			}

			const ev = d.evento;
			titulo = ev.title;

			// O que o evento já usa continua escolhível, mesmo que hoje não
			// estivesse na lista: tipo desativado depois, responsável de fora do PG.
			const tipos = [...o.tipos];
			if (ev.eventType && !tipos.some((t: any) => t.id === ev.eventTypeId)) {
				tipos.push({ id: ev.eventTypeId, name: `${ev.eventType.name} (desativado)` });
			}
			const pessoas = [...o.pessoas];
			if (ev.responsiblePersonId && !pessoas.some((p: any) => p.id === ev.responsiblePersonId)) {
				pessoas.push({
					id: ev.responsiblePersonId,
					nome: ev.responsavelNome ?? 'Responsável atual'
				});
			}
			opcoes = { ...o, tipos, pessoas };

			chavesComResposta = [...new Set<string>((d.inscricoes ?? []).map((i: any) => i.option))];

			inicial = {
				title: ev.title,
				eventTypeId: ev.eventTypeId,
				groupId: ev.groupId ?? '',
				inicio: paraInputLocal(ev.startsAt),
				fim: paraInputLocal(ev.endsAt),
				location: ev.location ?? '',
				responsiblePersonId: ev.responsiblePersonId ?? '',
				description: ev.description ?? '',
				rsvpEnabled: ev.rsvpEnabled,
				rsvpOptions: (ev.rsvpOptions ?? []).map((op: any) => ({ key: op.key, label: op.label }))
			};
		} catch (e: any) {
			erro =
				e.message === 'sem_conexao'
					? 'Editar evento exige conexão com a internet.'
					: 'Não foi possível carregar o evento.';
		} finally {
			carregando = false;
		}
	});

	async function salvar(corpo: Record<string, unknown>) {
		salvando = true;
		erroServidor = undefined;
		try {
			const res = await api.patch(`/api/eventos/${eventoId}`, corpo);
			const d = await res.json().catch(() => ({}));
			if (res.ok) {
				await goto(`/eventos/${eventoId}`);
			} else {
				erroServidor = d.erro ?? 'Não foi possível salvar o evento.';
			}
		} catch {
			erroServidor = 'Sem conexão. Nada foi salvo; tente de novo.';
		} finally {
			salvando = false;
		}
	}
</script>

<svelte:head>
	<title>Editar {titulo || 'evento'} · Eagles</title>
</svelte:head>

<main class="conteudo">
	<div class="pilha">
		<a href={`/eventos/${eventoId}`} class="voltar">← Voltar ao evento</a>

		<header>
			<h1>Editar evento</h1>
		</header>

		{#if carregando}
			<div class="carregando">
				<Marca tamanho={44} />
				<p>Carregando…</p>
			</div>
		{:else if erro}
			<Aviso tom="erro">{erro}</Aviso>
		{:else if opcoes && inicial}
			<FormularioEvento
				modo="editar"
				{inicial}
				{opcoes}
				{chavesComResposta}
				{salvando}
				{erroServidor}
				voltarHref={`/eventos/${eventoId}`}
				onsalvar={salvar}
			/>
		{/if}
	</div>
</main>

<style>
	.voltar {
		font-size: var(--texto-sm);
		font-weight: 600;
		min-height: var(--toque-min);
		display: inline-flex;
		align-items: center;
		align-self: flex-start;
	}

	.carregando {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: var(--esp-3);
		padding: var(--esp-6) var(--esp-4);
		color: var(--cor-texto-2);
		font-size: var(--texto-sm);
	}
</style>

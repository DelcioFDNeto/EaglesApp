<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import Aviso from '$ui/Aviso.svelte';
	import Marca from '$ui/Marca.svelte';
	import FormularioEvento, { type OpcoesFormulario } from '$lib/eventos/FormularioEvento.svelte';
	import { OPCOES_PADRAO, type DadosFormulario } from '$lib/eventos/formulario';
	import { api } from '$lib/api';

	let opcoes = $state<OpcoesFormulario | null>(null);
	let inicial = $state<DadosFormulario | null>(null);
	let carregando = $state(true);
	let erro = $state<string | undefined>(undefined);
	let erroServidor = $state<string | undefined>(undefined);
	let salvando = $state(false);

	onMount(async () => {
		try {
			const res = await api.get('/api/eventos/opcoes');
			const d = await res.json().catch(() => ({}));
			if (!res.ok) {
				erro = d.erro ?? 'Não foi possível abrir o formulário.';
				return;
			}
			opcoes = d;
			const tipoPg = (d.tipos ?? []).find((t: any) => t.slug === 'pg');
			inicial = {
				title: '',
				// Se existir o tipo "PG (Pequeno Grupo)", já vem selecionado por ser o encontro principal.
				eventTypeId: tipoPg?.id ?? (d.tipos.length === 1 ? d.tipos[0].id : ''),
				// Papel restrito a um único subgrupo: o subgrupo dele já vem escolhido.
				groupId: !d.podeSemGrupo && d.grupos.length === 1 ? d.grupos[0].id : '',
				inicio: '',
				fim: '',
				location: '',
				responsiblePersonId: '',
				description: '',
				rsvpEnabled: true,
				rsvpOptions: OPCOES_PADRAO.map((o) => ({ ...o }))
			};
		} catch (e: any) {
			erro =
				e.message === 'sem_conexao'
					? 'Criar evento exige conexão com a internet.'
					: 'Não foi possível abrir o formulário.';
		} finally {
			carregando = false;
		}
	});

	async function salvar(corpo: Record<string, unknown>) {
		salvando = true;
		erroServidor = undefined;
		try {
			const res = await api.post('/api/eventos', corpo);
			const d = await res.json().catch(() => ({}));
			if (res.ok) {
				await goto(`/eventos/${d.evento.id}`);
			} else {
				erroServidor = d.erro ?? 'Não foi possível criar o evento.';
			}
		} catch {
			erroServidor = 'Sem conexão. O evento não foi criado; tente de novo.';
		} finally {
			salvando = false;
		}
	}
</script>

<svelte:head>
	<title>Novo evento · Eagles</title>
</svelte:head>

<main class="conteudo">
	<div class="pilha">
		<a href="/eventos" class="voltar">← Eventos</a>

		<header>
			<h1>Novo evento</h1>
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
				modo="criar"
				{inicial}
				{opcoes}
				{salvando}
				{erroServidor}
				voltarHref="/eventos"
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

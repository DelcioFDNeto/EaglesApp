<script lang="ts">
	import Marca from '$ui/Marca.svelte';
	import Botao from '$ui/Botao.svelte';
	import Aviso from '$ui/Aviso.svelte';
	import { dataPorExtenso, horaCurta } from '$shared/fuso';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	const e = $derived(data.evento);
	const quando = $derived(
		e.horaFim ? `das ${horaCurta(e.hora)} às ${horaCurta(e.horaFim)}` : `às ${horaCurta(e.hora)}`
	);
</script>

<svelte:head>
	<title>{e.titulo} · {e.equipe}</title>
	<meta name="robots" content="noindex, nofollow" />
</svelte:head>

<main class="conteudo">
	<header>
		<Marca tamanho={44} />
		<p class="equipe">{e.equipe}</p>
	</header>

	{#if e.cancelado}
		<Aviso tom="aviso" titulo="Evento cancelado">Este encontro não vai acontecer.</Aviso>
	{/if}

	<article class="cartao">
		<p class="tipo">{[e.tipo, e.grupo].filter(Boolean).join(' · ')}</p>
		<h1 class:riscado={e.cancelado}>{e.titulo}</h1>
		<p class="quando"><strong>{dataPorExtenso(e.data)}</strong>, {quando}</p>
		{#if e.local}<p class="local">📍 {e.local}</p>{/if}
		{#if e.descricao}<p class="descricao">{e.descricao}</p>{/if}
	</article>

	<div class="acoes">
		{#if data.autenticado}
			<Botao href="/agenda" variante="secundario">Abrir minha agenda</Botao>
		{:else}
			<Botao href="/entrar" variante="secundario">Entrar no app</Botao>
			{#if data.autocadastro}
				<p class="primeira-vez">
					É sua primeira vez? <a href="/sou-novo">Conte quem você é</a> — leva um minuto.
				</p>
			{/if}
		{/if}
	</div>
</main>

<style>
	.conteudo {
		max-width: 480px;
		margin-inline: auto;
		padding: var(--esp-6) var(--esp-3);
		display: flex;
		flex-direction: column;
		gap: var(--esp-4);
	}

	header {
		display: flex;
		align-items: center;
		gap: var(--esp-3);
	}

	.equipe {
		font-weight: 800;
		letter-spacing: -0.02em;
		font-size: var(--texto-lg);
	}

	.cartao {
		background: var(--cor-superficie);
		border: 1px solid var(--cor-linha);
		border-top: 4px solid var(--cor-marca);
		border-radius: var(--raio-lg);
		padding: var(--esp-4);
		display: flex;
		flex-direction: column;
		gap: var(--esp-2);
	}

	.tipo {
		font-size: var(--texto-xs);
		font-weight: 700;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		color: var(--cor-marca);
	}

	h1 {
		font-size: var(--texto-2xl);
		overflow-wrap: anywhere;
	}

	.riscado {
		text-decoration: line-through;
		color: var(--cor-texto-3);
	}

	.quando::first-letter {
		text-transform: uppercase;
	}

	.local {
		color: var(--cor-texto-2);
		overflow-wrap: anywhere;
	}

	.descricao {
		white-space: pre-line;
		font-size: var(--texto-sm);
		color: var(--cor-texto-2);
	}

	.acoes {
		display: flex;
		flex-direction: column;
		gap: var(--esp-3);
	}

	.primeira-vez {
		font-size: var(--texto-sm);
		color: var(--cor-texto-2);
	}
</style>

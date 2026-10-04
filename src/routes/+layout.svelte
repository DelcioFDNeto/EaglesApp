<script lang="ts">
	import '$lib/styles/app.css';
	import type { Snippet } from 'svelte';
	import BarraInferior from '$ui/BarraInferior.svelte';
	import type { LayoutData } from './$types';

	let { data, children }: { data: LayoutData; children: Snippet } = $props();
</script>

<svelte:head>
	<meta name="color-scheme" content="light dark" />
</svelte:head>

<!--
	Com a barra presente, o conteúdo ganha espaço embaixo para que o último
	botão de um formulário nunca fique escondido atrás dela.
-->
<div class:com-navegacao={!!data.navegacao}>
	{@render children()}
</div>

{#if data.navegacao}
	<BarraInferior itens={data.navegacao} />
{/if}

<style>
	.com-navegacao {
		padding-bottom: calc(56px + env(safe-area-inset-bottom) + var(--esp-4));
	}
</style>

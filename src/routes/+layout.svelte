<script lang="ts">
	import '$lib/styles/app.css';
	import type { Snippet } from 'svelte';
	import { onMount } from 'svelte';
	import { page } from '$app/state';
	import IndicadorConexao from '$lib/ui/IndicadorConexao.svelte';
	import Moldura from '$lib/ui/Moldura.svelte';
	import PainelEntrada from '$lib/ui/PainelEntrada.svelte';
	import { usaMoldura } from '$lib/navegacao';

	let { children }: { children: Snippet } = $props();

	// Entrada, convite e senha ficam sem menu; o resto do app vive na moldura.
	const comMoldura = $derived(usaMoldura(page.url.pathname));

	onMount(() => {
		if ('serviceWorker' in navigator) {
			navigator.serviceWorker
				.register('/service-worker.js')
				// eslint-disable-next-line no-console
				.catch((err) => console.warn('[SW] Falha ao registrar:', err));
		}
	});
</script>

<svelte:head>
	<meta name="color-scheme" content="light dark" />
	<meta name="apple-mobile-web-app-capable" content="yes" />
	<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
	<meta name="apple-mobile-web-app-title" content="Eagles" />
</svelte:head>

<IndicadorConexao />

{#if comMoldura}
	<Moldura>
		{@render children()}
	</Moldura>
{:else if page.url.pathname === '/'}
	<!-- A raiz só redireciona: sem painel. -->
	{@render children()}
{:else}
	<PainelEntrada>
		{@render children()}
	</PainelEntrada>
{/if}

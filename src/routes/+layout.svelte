<script lang="ts">
	import '$lib/styles/app.css';
	import type { Snippet } from 'svelte';
	import { onMount } from 'svelte';
	import IndicadorConexao from '$lib/ui/IndicadorConexao.svelte';

	let { children }: { children: Snippet } = $props();

	onMount(() => {
		if ('serviceWorker' in navigator) {
			navigator.serviceWorker
				.register('/service-worker.js')
				.then(() => {
					// eslint-disable-next-line no-console
					console.log('[SW] Registrado com sucesso');
				})
				// eslint-disable-next-line no-console
				.catch((err) => console.warn('[SW] Falha ao registrar:', err));
		}
	});
</script>

<svelte:head>
	<meta name="color-scheme" content="light dark" />
	<link rel="manifest" href="/manifest.webmanifest" />
	<link rel="apple-touch-icon" href="/apple-touch-icon.png" />
	<meta name="apple-mobile-web-app-capable" content="yes" />
	<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
	<meta name="apple-mobile-web-app-title" content="Eagles" />
	<meta name="theme-color" content="#A91825" />
</svelte:head>

<IndicadorConexao />

{@render children()}

<script lang="ts">
	import '$lib/styles/app.css';
	import type { Snippet } from 'svelte';

	let { children }: { children: Snippet } = $props();
</script>

<svelte:head>
	<meta name="color-scheme" content="light dark" />
</svelte:head>

{@render children()}

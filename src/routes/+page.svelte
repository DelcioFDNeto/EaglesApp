<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import Marca from '$ui/Marca.svelte';

	onMount(() => {
		const token = localStorage.getItem('eagles_token');
		goto(token ? '/inicio' : '/entrar', { replaceState: true });
	});
</script>

<svelte:head>
	<title>Eagles</title>
</svelte:head>

<main class="centro">
	<Marca tamanho={56} comNome />
</main>

<style>
	.centro {
		min-height: 100dvh;
		display: grid;
		place-items: center;
	}
</style>

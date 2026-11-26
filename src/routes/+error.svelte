<script lang="ts">
	import { page } from '$app/state';
	import Botao from '$ui/Botao.svelte';
	import Aviso from '$ui/Aviso.svelte';
	import Marca from '$ui/Marca.svelte';

	const status = $derived(page.status);
	const mensagemErro = $derived(
		page.error?.message ?? 'Não foi possível carregar esta página.'
	);
</script>

<svelte:head>
	<title>Erro · Eagles</title>
</svelte:head>

<main>
	<div class="cartao">
		<header>
			<Marca tamanho={40} comNome />
			<h1>{status === 404 ? 'Página não encontrada' : 'Algo deu errado'}</h1>
		</header>

		<Aviso tom="erro">
			{mensagemErro}
		</Aviso>

		<div class="acoes">
			<Botao largura="cheia" onclick={() => window.location.reload()}>
				Tentar novamente
			</Botao>
			<Botao variante="texto" largura="cheia" href="/inicio">
				Voltar ao início
			</Botao>
		</div>

		<p class="ajuda">
			{#if status === 404}
				Confira o endereço ou volte para a tela inicial.
			{:else}
				Se o problema continuar, tente novamente em alguns instantes.
			{/if}
		</p>
	</div>
</main>

<style>
	main {
		min-height: 100dvh;
		display: grid;
		place-items: center;
		padding: var(--esp-4);
	}

	.cartao {
		width: 100%;
		max-width: 400px;
		display: flex;
		flex-direction: column;
		gap: var(--esp-5);
	}

	header {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: var(--esp-2);
		text-align: center;
	}

	h1 {
		font-size: var(--texto-2xl);
		font-weight: 800;
	}

	.acoes {
		display: flex;
		flex-direction: column;
		gap: var(--esp-2);
	}

	.ajuda {
		font-size: var(--texto-sm);
		color: var(--cor-texto-2);
		text-align: center;
		text-wrap: pretty;
		margin: 0;
	}
</style>

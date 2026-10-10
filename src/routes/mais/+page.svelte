<script lang="ts">
	import BarraDeTopo from '$ui/BarraDeTopo.svelte';
	import Botao from '$ui/Botao.svelte';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	const itens = $derived(
		[
			{
				href: '/conta/sessoes',
				titulo: 'Minha conta',
				descricao: 'Aparelhos conectados e encerrar sessões',
				mostrar: true
			},
			{
				href: '/admin/papeis',
				titulo: 'Papéis e acessos',
				descricao: 'Quem pode fazer o quê no app',
				mostrar: data.podeAdministrarAcessos
			},
			{
				href: '/admin/tipos-de-evento',
				titulo: 'Tipos de evento',
				descricao: 'Encontro de PG, encontro geral, eventos especiais…',
				mostrar: data.podeConfigurar
			}
		].filter((i) => i.mostrar)
	);
</script>

<svelte:head>
	<title>Mais · Eagles</title>
</svelte:head>

<BarraDeTopo titulo="Mais" />

<main class="conteudo">
	<ul class="lista">
		{#each itens as item (item.href)}
			<li>
				<a href={item.href}>
					<span class="titulo">{item.titulo}</span>
					<span class="descricao">{item.descricao}</span>
				</a>
			</li>
		{/each}
	</ul>

	<form method="POST" action="/sair">
		<Botao tipo="submit" variante="secundario">Sair</Botao>
	</form>
</main>

<style>
	.conteudo {
		max-width: 560px;
		margin-inline: auto;
		padding: var(--esp-4) var(--esp-3) var(--esp-6);
		display: flex;
		flex-direction: column;
		gap: var(--esp-4);
	}

	.lista {
		list-style: none;
		padding: 0;
		margin: 0;
		display: flex;
		flex-direction: column;
		gap: var(--esp-2);
	}

	.lista a {
		display: flex;
		flex-direction: column;
		gap: var(--esp-1);
		padding: var(--esp-3);
		background: var(--cor-superficie);
		border: 1px solid var(--cor-linha);
		border-radius: var(--raio);
		color: inherit;
		text-decoration: none;
	}

	.lista a:hover {
		border-color: var(--cor-marca);
	}

	.lista a:focus-visible {
		outline: 2px solid var(--cor-foco);
		outline-offset: 2px;
	}

	.titulo {
		font-weight: 700;
	}

	.descricao {
		font-size: var(--texto-sm);
		color: var(--cor-texto-2);
	}
</style>

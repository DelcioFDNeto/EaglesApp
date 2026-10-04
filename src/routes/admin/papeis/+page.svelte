<script lang="ts">
	import BarraDeTopo from '$ui/BarraDeTopo.svelte';
	import Botao from '$ui/Botao.svelte';
	import Aviso from '$ui/Aviso.svelte';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	const ALCANCE = {
		global: 'Toda a equipe',
		group: 'Um grupo',
		self: 'Os próprios dados'
	} as const;
</script>

<svelte:head>
	<title>Acessos · Eagles</title>
</svelte:head>

<BarraDeTopo titulo="Papéis e acessos">
	{#snippet acoes()}
		<Botao href="/admin/papeis/novo" variante="primario">Novo papel</Botao>
	{/snippet}
</BarraDeTopo>

<main class="conteudo">
	{#if data.excluido}
		<Aviso tom="sucesso">O papel "{data.excluido}" foi excluído.</Aviso>
	{/if}

	<p class="legenda">
		Um papel é um conjunto de permissões. Para dar acesso a alguém, abra o perfil da pessoa e use
		“Gerenciar acesso”.
	</p>

	<ul class="lista">
		{#each data.papeis as papel (papel.id)}
			<li>
				<a href="/admin/papeis/{papel.id}">
					<span class="topo">
						<span class="nome">{papel.name}</span>
						{#if papel.isSystem}<span class="selo">básico</span>{/if}
					</span>
					{#if papel.description}<span class="descricao">{papel.description}</span>{/if}
					<span class="numeros">
						<span>{papel.pessoas} {papel.pessoas === 1 ? 'pessoa' : 'pessoas'}</span>
						<span aria-hidden="true">·</span>
						<span>{papel.permissoes} {papel.permissoes === 1 ? 'permissão' : 'permissões'}</span>
						<span aria-hidden="true">·</span>
						<span>{ALCANCE[papel.defaultScope]}</span>
					</span>
				</a>
			</li>
		{/each}
	</ul>
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

	.legenda {
		font-size: var(--texto-sm);
		color: var(--cor-texto-3);
		text-wrap: pretty;
	}

	.lista {
		list-style: none;
		padding: 0;
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
		transition: border-color var(--transicao);
	}

	.lista a:hover {
		border-color: var(--cor-marca);
	}

	.lista a:focus-visible {
		outline: 2px solid var(--cor-foco);
		outline-offset: 2px;
	}

	.topo {
		display: flex;
		align-items: center;
		gap: var(--esp-2);
	}

	.nome {
		font-weight: 700;
		letter-spacing: -0.01em;
	}

	.selo {
		font-size: var(--texto-xs);
		font-weight: 600;
		color: var(--cor-texto-3);
		border: 1px solid var(--cor-linha-forte);
		border-radius: 999px;
		padding: 0 var(--esp-2);
	}

	.descricao {
		font-size: var(--texto-sm);
		color: var(--cor-texto-2);
	}

	.numeros {
		display: flex;
		flex-wrap: wrap;
		gap: var(--esp-2);
		font-size: var(--texto-xs);
		color: var(--cor-texto-3);
		font-variant-numeric: tabular-nums;
	}
</style>

<script lang="ts">
	import BarraDeTopo from '$ui/BarraDeTopo.svelte';
	import Botao from '$ui/Botao.svelte';
	import EstadoVazio from '$ui/EstadoVazio.svelte';
	import { formatarCombinado } from '$shared/grupo';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();
</script>

<svelte:head>
	<title>Grupos · Eagles</title>
</svelte:head>

<BarraDeTopo titulo={data.verArquivados ? 'Grupos arquivados' : 'Grupos'}>
	{#snippet acoes()}
		{#if data.podeCriar && !data.verArquivados}
			<Botao href="/grupos/novo" variante="primario">Novo grupo</Botao>
		{/if}
	{/snippet}
</BarraDeTopo>

<main class="conteudo">
	{#if data.grupos.length === 0}
		<EstadoVazio titulo={data.verArquivados ? 'Nenhum grupo arquivado' : 'Ainda não há grupos'}>
			{#if data.verArquivados}
				Grupos arquivados aparecem aqui, com a história de quem passou por eles.
			{:else if data.podeCriar}
				Crie os PGs e depois distribua as pessoas — uma a uma, pelo perfil, ou todas de uma vez,
				pela reorganização.
			{:else}
				Quando a liderança criar os PGs, eles aparecem aqui.
			{/if}
			{#snippet acao()}
				{#if data.verArquivados}
					<Botao href="/grupos" variante="secundario">Voltar aos grupos ativos</Botao>
				{:else if data.podeCriar}
					<Botao href="/grupos/novo">Criar o primeiro grupo</Botao>
				{/if}
			{/snippet}
		</EstadoVazio>
	{:else}
		<ul class="lista">
			{#each data.grupos as g (g.id)}
				{@const combinado = formatarCombinado(g)}
				<li>
					<a href="/grupos/{g.id}" style={g.cor ? `--cor-grupo: ${g.cor}` : undefined}>
						<span class="topo">
							<span class="ponto" aria-hidden="true"></span>
							<span class="nome">{g.nome}</span>
							{#if g.meu}<span class="selo">seu grupo</span>{/if}
						</span>
						{#if combinado}<span class="combinado">{combinado}</span>{/if}
						<span class="numeros">
							<span>{g.membros} {g.membros === 1 ? 'pessoa' : 'pessoas'}</span>
							{#if g.responsaveis.length > 0}
								<span aria-hidden="true">·</span>
								<span>{g.responsaveis.map((r) => r.nome.split(' ')[0]).join(', ')}</span>
							{:else if !data.verArquivados}
								<span aria-hidden="true">·</span>
								<span>sem responsável</span>
							{/if}
						</span>
					</a>
				</li>
			{/each}
		</ul>
	{/if}

	<nav class="rodape" aria-label="Mais opções de grupos">
		{#if data.podeReorganizar && !data.verArquivados}
			<Botao href="/grupos/reorganizar" variante="secundario">Reorganizar os grupos</Botao>
		{/if}
		{#if data.verArquivados}
			<a href="/grupos">Ver grupos ativos</a>
		{:else}
			<a href="/grupos?arquivados=1">Ver grupos arquivados</a>
		{/if}
	</nav>
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
		border-left: 4px solid var(--cor-grupo, var(--cor-linha-forte));
		border-radius: var(--raio);
		color: inherit;
		text-decoration: none;
		transition: border-color var(--transicao);
	}

	.lista a:hover {
		border-color: var(--cor-marca);
		border-left-color: var(--cor-grupo, var(--cor-marca));
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

	.ponto {
		width: 0.625rem;
		height: 0.625rem;
		border-radius: 50%;
		background: var(--cor-grupo, var(--cor-texto-3));
		flex: none;
	}

	.nome {
		font-weight: 700;
		letter-spacing: -0.01em;
	}

	.selo {
		font-size: var(--texto-xs);
		font-weight: 600;
		color: var(--cor-marca);
		border: 1px solid currentColor;
		border-radius: 999px;
		padding: 0 var(--esp-2);
	}

	.combinado {
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

	.rodape {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		justify-content: space-between;
		gap: var(--esp-3);
		font-size: var(--texto-sm);
	}

	.rodape a {
		color: var(--cor-texto-2);
	}
</style>

<script lang="ts">
	import BarraDeTopo from '$ui/BarraDeTopo.svelte';
	import Botao from '$ui/Botao.svelte';
	import Etiqueta from '$ui/Etiqueta.svelte';
	import EstadoVazio from '$ui/EstadoVazio.svelte';
	import { formatarTelefone } from '$shared/pessoa';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	const filtrando = $derived(data.busca !== '' || data.statusId !== '' || data.grupoId !== '');
</script>

<svelte:head>
	<title>Pessoas · Eagles</title>
</svelte:head>

<BarraDeTopo titulo="Pessoas">
	{#snippet acoes()}
		{#if data.podeCadastrar}
			<Botao href="/pessoas/nova" variante="primario">Cadastrar</Botao>
		{/if}
	{/snippet}
</BarraDeTopo>

<main class="conteudo">
	<!--
		Busca por formulário GET: funciona sem JavaScript, deixa o resultado num
		endereço que pode ser compartilhado e o botão voltar do navegador se
		comporta como a pessoa espera.
	-->
	<form class="filtros" method="GET" role="search">
		<label class="busca">
			<span class="sr">Buscar por nome</span>
			<input
				type="search"
				name="busca"
				value={data.busca}
				placeholder="Buscar por nome"
				autocomplete="off"
			/>
		</label>

		<label class="status">
			<span class="sr">Filtrar por estágio</span>
			<select name="status" value={data.statusId}>
				<option value="">Todos os estágios</option>
				{#each data.estagios as e (e.valor)}
					<option value={e.valor}>{e.rotulo}</option>
				{/each}
			</select>
		</label>

		<label class="status">
			<span class="sr">Filtrar por grupo</span>
			<select name="grupo" value={data.grupoId}>
				<option value="">Todos os grupos</option>
				{#each data.grupos as g (g.valor)}
					<option value={g.valor}>{g.rotulo}</option>
				{/each}
			</select>
		</label>

		<Botao tipo="submit" variante="secundario">Filtrar</Botao>
	</form>

	{#if data.pessoas.length === 0}
		<EstadoVazio titulo={filtrando ? 'Ninguém com esse filtro' : 'Ainda não há ninguém cadastrado'}>
			{#if filtrando}
				Tente outro nome, ou limpe o filtro para ver todo mundo.
			{:else}
				Comece pelas pessoas que já frequentam os PGs. Só o nome é obrigatório — o resto você
				completa quando souber.
			{/if}
			{#snippet acao()}
				{#if filtrando}
					<Botao href="/pessoas" variante="secundario">Limpar filtro</Botao>
				{:else if data.podeCadastrar}
					<Botao href="/pessoas/nova">Cadastrar a primeira pessoa</Botao>
				{/if}
			{/snippet}
		</EstadoVazio>
	{:else}
		<p class="contagem" aria-live="polite">
			{data.pessoas.length}
			{data.pessoas.length === 1 ? 'pessoa' : 'pessoas'}
		</p>

		<ul class="lista">
			{#each data.pessoas as pessoa (pessoa.id)}
				<li>
					<a href="/pessoas/{pessoa.id}">
						<span class="nome">{pessoa.fullName}</span>

						<span class="meta">
							{#if pessoa.statusNome}
								<Etiqueta cor={pessoa.statusCor}>{pessoa.statusNome}</Etiqueta>
							{/if}
							{#if pessoa.grupo}
								<span class="grupo">{pessoa.grupo.nome}</span>
							{/if}
							{#if pessoa.phone}
								<span class="telefone">{formatarTelefone(pessoa.phone)}</span>
							{/if}
						</span>
					</a>
				</li>
			{/each}
		</ul>
	{/if}
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

	.filtros {
		display: flex;
		flex-wrap: wrap;
		gap: var(--esp-2);
	}

	.busca {
		flex: 1 1 12rem;
	}

	.status {
		flex: 1 1 9rem;
	}

	.filtros input,
	.filtros select {
		width: 100%;
		min-height: var(--toque-min);
		padding: 0 var(--esp-3);
		background: var(--cor-superficie);
		color: var(--cor-texto);
		border: 1px solid var(--cor-linha-forte);
		border-radius: var(--raio);
		font-size: 16px;
	}

	.grupo {
		font-size: var(--texto-sm);
		color: var(--cor-texto-2);
	}

	.filtros input:focus-visible,
	.filtros select:focus-visible {
		outline: 2px solid var(--cor-foco);
		outline-offset: 2px;
	}

	.sr {
		position: absolute;
		width: 1px;
		height: 1px;
		overflow: hidden;
		clip-path: inset(50%);
		white-space: nowrap;
	}

	.contagem {
		font-size: var(--texto-sm);
		color: var(--cor-texto-3);
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
		gap: var(--esp-2);
		padding: var(--esp-3);
		min-height: var(--toque-min);
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

	.nome {
		font-weight: 600;
		letter-spacing: -0.01em;
	}

	.meta {
		display: flex;
		align-items: center;
		flex-wrap: wrap;
		gap: var(--esp-2);
	}

	.telefone {
		font-size: var(--texto-sm);
		color: var(--cor-texto-3);
		font-variant-numeric: tabular-nums;
	}
</style>

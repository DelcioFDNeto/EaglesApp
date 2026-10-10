<script lang="ts">
	import BarraDeTopo from '$ui/BarraDeTopo.svelte';
	import Botao from '$ui/Botao.svelte';
	import EstadoVazio from '$ui/EstadoVazio.svelte';
	import CartaoDeEvento from '$ui/CartaoDeEvento.svelte';
	import { dataPorExtenso, mesPorExtenso } from '$shared/fuso';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	const filtro = $derived(data.ver === 'minha' ? '' : `&ver=${data.ver}`);
</script>

<svelte:head>
	<title>Agenda · Eagles</title>
</svelte:head>

<BarraDeTopo titulo="Agenda">
	{#snippet acoes()}
		{#if data.podeCriar}
			<Botao href="/agenda/novo" variante="primario">Novo evento</Botao>
		{/if}
	{/snippet}
</BarraDeTopo>

<main class="conteudo">
	<!--
		Navegação e filtro por GET: funcionam sem JavaScript e deixam o mês e o
		filtro no endereço — dá para mandar o link de "outubro do PG Azul".
	-->
	<nav class="meses" aria-label="Mês">
		<a href="?mes={data.anterior}{filtro}" aria-label="Mês anterior">‹</a>
		<h1>{mesPorExtenso(data.mes)}</h1>
		<a href="?mes={data.seguinte}{filtro}" aria-label="Próximo mês">›</a>
	</nav>

	{#if data.opcoes.length > 1}
		<form class="filtro" method="GET">
			<input type="hidden" name="mes" value={data.mes} />
			<label>
				<span class="sr">Ver</span>
				<select name="ver" value={data.ver}>
					{#each data.opcoes as o (o.valor)}
						<option value={o.valor}>{o.rotulo}</option>
					{/each}
				</select>
			</label>
			<Botao tipo="submit" variante="secundario">Ver</Botao>
		</form>
	{/if}

	{#if !data.ehMesAtual}
		<a class="hoje" href="/agenda{data.ver === 'minha' ? '' : `?ver=${data.ver}`}"
			>Voltar para hoje</a
		>
	{/if}

	{#if data.dias.length === 0}
		<EstadoVazio titulo="Nada marcado neste mês">
			{#if data.podeCriar}
				Crie o encontro semanal do seu grupo, ou um evento avulso.
			{:else}
				Quando houver encontros para você, eles aparecem aqui.
			{/if}
		</EstadoVazio>
	{:else}
		{#each data.dias as dia (dia.data)}
			<section
				class="dia"
				class:passado={dia.data < data.hoje}
				aria-label={dataPorExtenso(dia.data)}
			>
				<h2>
					{dataPorExtenso(dia.data)}
					{#if dia.data === data.hoje}<span class="selo-hoje">hoje</span>{/if}
				</h2>
				<ul>
					{#each dia.eventos as evento (evento.id)}
						<li><CartaoDeEvento {evento} /></li>
					{/each}
				</ul>
			</section>
		{/each}
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

	.meses {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--esp-2);
	}

	.meses h1 {
		font-size: var(--texto-xl);
		text-align: center;
	}

	.meses h1::first-letter {
		text-transform: uppercase;
	}

	.meses a {
		display: grid;
		place-items: center;
		width: var(--toque-min);
		height: var(--toque-min);
		border: 1px solid var(--cor-linha-forte);
		border-radius: var(--raio);
		color: var(--cor-texto);
		text-decoration: none;
		font-size: var(--texto-xl);
	}

	.filtro {
		display: flex;
		gap: var(--esp-2);
	}

	.filtro label {
		flex: 1;
	}

	select {
		width: 100%;
		min-height: var(--toque-min);
		padding: 0 var(--esp-3);
		background: var(--cor-superficie);
		color: var(--cor-texto);
		border: 1px solid var(--cor-linha-forte);
		border-radius: var(--raio);
		font-size: 16px;
	}

	select:focus-visible,
	.meses a:focus-visible {
		outline: 2px solid var(--cor-foco);
		outline-offset: 2px;
	}

	.hoje {
		font-size: var(--texto-sm);
		align-self: flex-start;
	}

	.dia h2 {
		font-size: var(--texto-sm);
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.04em;
		color: var(--cor-texto-2);
		margin-bottom: var(--esp-2);
		display: flex;
		align-items: center;
		gap: var(--esp-2);
	}

	.passado {
		opacity: 0.7;
	}

	.selo-hoje {
		font-size: var(--texto-xs);
		color: var(--cor-sobre-marca);
		background: var(--cor-marca);
		border-radius: 999px;
		padding: 0 var(--esp-2);
		letter-spacing: 0;
		text-transform: none;
	}

	.sr {
		position: absolute;
		width: 1px;
		height: 1px;
		overflow: hidden;
		clip-path: inset(50%);
		white-space: nowrap;
	}

	ul {
		list-style: none;
		padding: 0;
		margin: 0;
		display: flex;
		flex-direction: column;
		gap: var(--esp-2);
	}
</style>

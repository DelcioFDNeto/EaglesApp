<script lang="ts">
	import BarraDeTopo from '$ui/BarraDeTopo.svelte';
	import Botao from '$ui/Botao.svelte';
	import Campo from '$ui/Campo.svelte';
	import Seletor from '$ui/Seletor.svelte';
	import EstadoVazio from '$ui/EstadoVazio.svelte';
	import { dataCurtaComDia } from '$shared/fuso';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	const vezes = (n: number) => (n === 1 ? '1 vez' : `${n} vezes`);
</script>

<svelte:head>
	<title>Frequência · Eagles</title>
</svelte:head>

<BarraDeTopo titulo="Frequência" voltar="/mais" />

<main class="conteudo">
	<!-- GET: o endereço é o relatório — funciona sem JavaScript e se compartilha. -->
	<form method="GET" class="filtros cartao" aria-label="Filtros">
		<div class="lado-a-lado">
			<Campo id="de" rotulo="De" tipo="date" valor={data.filtro.de} max={data.hoje} />
			<Campo id="ate" rotulo="Até" tipo="date" valor={data.filtro.ate} max={data.hoje} />
		</div>
		<Seletor
			id="grupo"
			rotulo="Grupo"
			opcoes={data.grupos}
			valor={data.filtro.grupo}
			vazio={data.podeVerTodos ? 'Todos os grupos' : undefined}
		/>
		<Seletor
			id="tipo"
			rotulo="Tipo de encontro"
			opcoes={data.tipos}
			valor={data.filtro.tipo}
			vazio="Todos os tipos"
		/>
		<Botao tipo="submit" variante="secundario">Ver</Botao>
	</form>

	<p class="nota">
		Só entram encontros com <strong>lista de presença feita</strong>. Encontro sem lista não conta
		falta para ninguém, e quem entrou no grupo depois não era esperado antes.
	</p>

	{#if data.eventos.length === 0}
		<EstadoVazio titulo="Nenhuma lista feita neste período">
			A frequência aparece quando o conselheiro marca quem veio num encontro.
		</EstadoVazio>
	{:else}
		<section class="cartao" aria-label="Pessoas">
			<h2>Pessoas <span class="contagem">{data.pessoas.length}</span></h2>
			<!-- Ordem alfabética, de propósito (D-M06-7): isto não é ranking. -->
			<ul class="pessoas">
				{#each data.pessoas as p (p.personId)}
					<li>
						<a href="/pessoas/{p.personId}" class="nome">{p.nome}</a>
						{#if p.grupo}<span class="grupo">{p.grupo}</span>{/if}
						<span class="numeros">
							{#if p.percentual !== null}
								<strong>{p.percentual}%</strong>
								<span>esteve em {p.presentes} de {p.esperados}</span>
							{:else}
								<span>sem encontro esperado</span>
							{/if}
							{#if p.foraDoEsperado > 0}
								<span class="extra">+ visitou {vezes(p.foraDoEsperado)}</span>
							{/if}
						</span>
					</li>
				{/each}
			</ul>
		</section>

		<section class="cartao" aria-label="Encontros">
			<h2>Encontros <span class="contagem">{data.eventos.length}</span></h2>
			<ul class="eventos">
				{#each data.eventos as e (e.id)}
					<li>
						<a href="/agenda/{e.id}" class="nome">{e.titulo}</a>
						<span class="data">{dataCurtaComDia(e.data)}</span>
						<dl>
							<div>
								<dt>Vieram</dt>
								<dd>{e.vieram}</dd>
							</div>
							<div>
								<dt>Esperados</dt>
								<dd>{e.esperados}</dd>
							</div>
							<div>
								<dt>Confirmaram</dt>
								<dd>{e.confirmaram}</dd>
							</div>
							<div>
								<dt>Confirmaram e não vieram</dt>
								<dd>{e.confirmaramENaoVieram}</dd>
							</div>
							<div>
								<dt>Vieram sem confirmar</dt>
								<dd>{e.vieramSemConfirmar}</dd>
							</div>
						</dl>
					</li>
				{/each}
			</ul>
		</section>
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

	.cartao {
		background: var(--cor-superficie);
		border: 1px solid var(--cor-linha);
		border-radius: var(--raio-lg);
		padding: var(--esp-4);
		display: flex;
		flex-direction: column;
		gap: var(--esp-3);
	}

	.lado-a-lado {
		display: grid;
		grid-template-columns: repeat(2, minmax(0, 1fr));
		gap: var(--esp-3);
	}

	.nota {
		font-size: var(--texto-sm);
		color: var(--cor-texto-2);
		text-wrap: pretty;
	}

	h2 {
		font-size: var(--texto-lg);
		display: flex;
		align-items: center;
		gap: var(--esp-2);
	}

	.contagem {
		font-size: var(--texto-sm);
		font-weight: 600;
		color: var(--cor-texto-3);
	}

	.pessoas,
	.eventos {
		list-style: none;
		padding: 0;
		margin: 0;
		display: flex;
		flex-direction: column;
	}

	.pessoas li,
	.eventos li {
		display: flex;
		flex-wrap: wrap;
		align-items: baseline;
		gap: 2px var(--esp-2);
		padding-block: var(--esp-2);
		border-top: 1px solid var(--cor-linha);
	}

	.pessoas li:first-child,
	.eventos li:first-child {
		border-top: 0;
	}

	.nome {
		font-weight: 600;
		overflow-wrap: anywhere;
	}

	.grupo,
	.data {
		font-size: var(--texto-sm);
		color: var(--cor-texto-3);
	}

	.numeros {
		flex-basis: 100%;
		display: flex;
		flex-wrap: wrap;
		gap: var(--esp-1) var(--esp-2);
		font-size: var(--texto-sm);
		color: var(--cor-texto-2);
	}

	.extra {
		color: var(--cor-texto-3);
	}

	dl {
		flex-basis: 100%;
		display: flex;
		flex-wrap: wrap;
		gap: var(--esp-1) var(--esp-3);
		font-size: var(--texto-sm);
	}

	dl div {
		display: flex;
		gap: var(--esp-1);
	}

	dt {
		color: var(--cor-texto-3);
	}

	dd {
		font-weight: 700;
		margin: 0;
	}
</style>

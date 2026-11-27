<script lang="ts">
	import Icone from '$ui/Icone.svelte';
	import { TITULO_SECAO, itensBarraInferior, itensNavegacao, type Secao } from '$lib/navegacao';
	import { sessao } from '$lib/sessao.svelte';

	// "Mais" do celular: tudo o que não coube na barra inferior.
	const itens = $derived(itensNavegacao(sessao.dados?.permissoes ?? []));
	const naBarra = $derived(new Set(itensBarraInferior(itens).map((i) => i.href)));
	const restantes = $derived(itens.filter((i) => !naBarra.has(i.href)));

	const SECOES: Secao[] = ['dia_a_dia', 'cuidar', 'administrar', 'conta'];

	let saindo = $state(false);
	async function sair() {
		saindo = true;
		await sessao.sair();
		saindo = false;
	}
</script>

<svelte:head>
	<title>Mais · Eagles</title>
</svelte:head>

<main class="conteudo">
	<div class="pilha">
		<h1>Mais</h1>

		{#each SECOES as secao (secao)}
			{@const doGrupo = restantes.filter((i) => i.secao === secao)}
			{#if doGrupo.length > 0}
				<section aria-label={TITULO_SECAO[secao] ?? 'Outras seções'}>
					{#if TITULO_SECAO[secao]}<h2>{TITULO_SECAO[secao]}</h2>{/if}
					<ul class="lista">
						{#each doGrupo as item (item.href)}
							<li>
								<a href={item.href} class="linha">
									<Icone nome={item.icone} />
									<span>{item.rotulo}</span>
									<span class="seta" aria-hidden="true">›</span>
								</a>
							</li>
						{/each}
					</ul>
				</section>
			{/if}
		{/each}

		<button type="button" class="linha sair" onclick={sair} disabled={saindo}>
			<Icone nome="sair" />
			<span>{saindo ? 'Saindo…' : 'Sair'}</span>
		</button>
	</div>
</main>

<style>
	section {
		display: flex;
		flex-direction: column;
		gap: var(--esp-2);
	}

	h2 {
		font-size: var(--texto-sm);
		font-weight: 700;
		letter-spacing: 0.04em;
		text-transform: uppercase;
		color: var(--cor-texto-3);
		font-family: var(--fonte);
	}

	.lista {
		list-style: none;
		padding: 0;
		border: 1px solid var(--cor-linha);
		border-radius: var(--raio-lg);
		background: var(--cor-superficie);
		overflow: hidden;
	}

	.lista li + li {
		border-top: 1px solid var(--cor-linha);
	}

	.linha {
		width: 100%;
		display: flex;
		align-items: center;
		gap: var(--esp-3);
		min-height: 52px;
		padding: 0 var(--esp-4);
		color: var(--cor-texto);
		font: inherit;
		font-weight: 600;
		text-decoration: none;
		background: none;
		border: 0;
		text-align: left;
		cursor: pointer;
	}

	.linha :global(svg) {
		color: var(--cor-texto-2);
		flex: none;
	}

	.seta {
		margin-left: auto;
		color: var(--cor-texto-3);
		font-size: var(--texto-lg);
	}

	.sair {
		border: 1px solid var(--cor-linha);
		border-radius: var(--raio-lg);
		background: var(--cor-superficie);
		color: var(--cor-erro);
	}

	.sair :global(svg) {
		color: var(--cor-erro);
	}

	.sair:disabled {
		opacity: 0.6;
	}
</style>

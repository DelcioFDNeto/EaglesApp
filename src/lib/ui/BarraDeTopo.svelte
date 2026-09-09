<script lang="ts">
	import type { Snippet } from 'svelte';
	import Marca from './Marca.svelte';

	/**
	 * Barra fixa do topo da área autenticada.
	 *
	 * `voltar` transforma a marca num link de retorno: no celular, a navegação
	 * dentro do app precisa de um caminho de volta visível, sem depender do
	 * botão do navegador — que no PWA instalado nem sempre está à mão.
	 */
	let {
		voltar = undefined,
		titulo = undefined,
		acoes = undefined
	}: {
		voltar?: string;
		titulo?: string;
		acoes?: Snippet;
	} = $props();
</script>

<header>
	<div class="barra">
		{#if voltar}
			<a class="voltar" href={voltar}>
				<svg viewBox="0 0 20 20" width="18" height="18" aria-hidden="true">
					<path
						d="M12 4l-6 6 6 6"
						fill="none"
						stroke="currentColor"
						stroke-width="1.8"
						stroke-linecap="round"
						stroke-linejoin="round"
					/>
				</svg>
				<span>Voltar</span>
			</a>
		{:else}
			<a class="marca" href="/inicio"><Marca tamanho={28} comNome /></a>
		{/if}

		{#if titulo}<h1>{titulo}</h1>{/if}

		<div class="acoes">
			{#if acoes}{@render acoes()}{/if}
		</div>
	</div>
</header>

<style>
	header {
		border-bottom: 1px solid var(--cor-linha);
		background: var(--cor-superficie);
		position: sticky;
		top: 0;
		z-index: 10;
	}

	.barra {
		max-width: 560px;
		margin-inline: auto;
		padding: var(--esp-2) var(--esp-3);
		display: flex;
		align-items: center;
		gap: var(--esp-3);
	}

	h1 {
		font-size: var(--texto-base);
		font-weight: 700;
		letter-spacing: -0.02em;
		/* Trunca em vez de quebrar a barra em duas linhas num nome comprido. */
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.acoes {
		margin-left: auto;
		display: flex;
		align-items: center;
		gap: var(--esp-2);
	}

	.voltar,
	.marca {
		display: inline-flex;
		align-items: center;
		gap: var(--esp-1);
		color: var(--cor-texto-2);
		text-decoration: none;
		font-size: var(--texto-sm);
		font-weight: 600;
		min-height: var(--toque-min);
	}

	.voltar:hover {
		color: var(--cor-marca);
	}

	.voltar:focus-visible,
	.marca:focus-visible {
		outline: 2px solid var(--cor-foco);
		outline-offset: 2px;
		border-radius: var(--raio);
	}
</style>

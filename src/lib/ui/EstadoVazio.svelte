<script lang="ts">
	import type { Snippet } from 'svelte';

	/**
	 * Estado vazio.
	 *
	 * Diz o que está acontecendo com voz humana e, quando faz sentido, oferece a
	 * saída. Nunca "Nenhum registro encontrado": isso informa o banco de dados,
	 * não a pessoa.
	 */
	let {
		titulo,
		children = undefined,
		acao = undefined
	}: {
		titulo: string;
		children?: Snippet;
		acao?: Snippet;
	} = $props();
</script>

<div class="vazio">
	<h2>{titulo}</h2>
	{#if children}<p>{@render children()}</p>{/if}
	{#if acao}<div class="acao">{@render acao()}</div>{/if}
</div>

<style>
	.vazio {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: var(--esp-3);
		padding: var(--esp-6) var(--esp-4);
		text-align: center;
		background: var(--cor-superficie);
		border: 1px dashed var(--cor-linha-forte);
		border-radius: var(--raio-lg);
	}

	h2 {
		font-size: var(--texto-lg);
		font-weight: 700;
		letter-spacing: -0.02em;
	}

	p {
		max-width: 38ch;
		color: var(--cor-texto-2);
		font-size: var(--texto-sm);
		text-wrap: pretty;
	}
</style>

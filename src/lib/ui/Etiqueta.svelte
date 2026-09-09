<script lang="ts">
	import type { Snippet } from 'svelte';

	/**
	 * Etiqueta de estágio da jornada.
	 *
	 * A cor vem do banco, porque os estágios são configuráveis (RN-02) — mas a
	 * cor nunca é o único portador da informação: o nome do estágio está sempre
	 * escrito ao lado (RNF-12).
	 */
	let {
		cor = undefined,
		children
	}: {
		cor?: string | null;
		children: Snippet;
	} = $props();
</script>

<span class="etiqueta" style={cor ? `--cor-etiqueta: ${cor}` : undefined}>
	<span class="ponto" aria-hidden="true"></span>
	{@render children()}
</span>

<style>
	.etiqueta {
		--cor-etiqueta: var(--cor-texto-3);
		display: inline-flex;
		align-items: center;
		gap: var(--esp-2);
		padding: 2px var(--esp-3) 2px var(--esp-2);
		border: 1px solid var(--cor-linha);
		border-radius: 999px;
		background: var(--cor-superficie);
		font-size: var(--texto-xs);
		font-weight: 600;
		color: var(--cor-texto-2);
		white-space: nowrap;
	}

	.ponto {
		width: 8px;
		height: 8px;
		border-radius: 50%;
		background: var(--cor-etiqueta);
		flex: none;
	}
</style>

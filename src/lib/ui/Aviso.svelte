<script lang="ts">
	import type { Snippet } from 'svelte';

	type Tom = 'info' | 'sucesso' | 'aviso' | 'erro';

	let {
		tom = 'info',
		titulo = undefined,
		children
	}: { tom?: Tom; titulo?: string; children: Snippet } = $props();

	// Todo tom tem ícone próprio: quem não distingue as cores continua
	// distinguindo a mensagem (RNF-12).
	const caminhos: Record<Tom, string> = {
		info: 'M10 6.2v.6M10 9v5',
		sucesso: 'M6 10.5l2.6 2.6L14 7.8',
		aviso: 'M10 6v5M10 13.4v.6',
		erro: 'M7 7l6 6M13 7l-6 6'
	};
</script>

<!-- A classe base é `caixa`, não `aviso`: um dos tons também se chama "aviso",
     e classe base com o mesmo nome de um modificador é colisão de cascata. -->
<div class="caixa tom-{tom}" role={tom === 'erro' ? 'alert' : 'status'}>
	<svg viewBox="0 0 20 20" width="18" height="18" aria-hidden="true">
		{#if tom !== 'sucesso'}
			<circle cx="10" cy="10" r="8.5" fill="none" stroke="currentColor" stroke-width="1.4" />
		{/if}
		<path
			d={caminhos[tom]}
			fill="none"
			stroke="currentColor"
			stroke-width="1.8"
			stroke-linecap="round"
			stroke-linejoin="round"
		/>
	</svg>

	<div class="corpo">
		{#if titulo}<strong>{titulo}</strong>{/if}
		<div>{@render children()}</div>
	</div>
</div>

<style>
	.caixa {
		display: flex;
		gap: var(--esp-3);
		padding: var(--esp-3) var(--esp-4);
		border: 1px solid;
		border-radius: var(--raio);
		font-size: var(--texto-sm);
		line-height: 1.5;
	}

	.caixa svg {
		flex: none;
		margin-top: 1px;
	}

	.corpo {
		display: flex;
		flex-direction: column;
		gap: var(--esp-1);
	}

	strong {
		font-weight: 700;
	}

	.tom-info {
		background: var(--cor-superficie-2);
		border-color: var(--cor-linha);
		color: var(--cor-texto-2);
	}

	.tom-sucesso {
		background: var(--cor-sucesso-suave);
		border-color: var(--cor-sucesso);
		color: var(--cor-sucesso);
	}

	.tom-aviso {
		background: var(--cor-aviso-suave);
		border-color: var(--cor-aviso);
		color: var(--cor-aviso);
	}

	.tom-erro {
		background: var(--cor-erro-suave);
		border-color: var(--cor-erro);
		color: var(--cor-erro);
	}
</style>

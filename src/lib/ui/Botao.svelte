<script lang="ts">
	import type { Snippet } from 'svelte';

	type Variante = 'primario' | 'secundario' | 'texto' | 'destrutivo';

	let {
		variante = 'primario',
		tipo = 'button',
		carregando = false,
		desabilitado = false,
		largura = 'auto',
		href = undefined,
		onclick = undefined,
		children,
		...resto
	}: {
		variante?: Variante;
		tipo?: 'button' | 'submit' | 'reset';
		carregando?: boolean;
		desabilitado?: boolean;
		largura?: 'auto' | 'cheia';
		href?: string;
		onclick?: (e: MouseEvent) => void;
		children: Snippet;
		[key: string]: unknown;
	} = $props();

	const inativo = $derived(desabilitado || carregando);

	function handleClick(e: MouseEvent) {
		if (inativo) {
			e.preventDefault();
			e.stopPropagation();
			return;
		}
		onclick?.(e);
	}
</script>

{#if href && !inativo}
	<a {href} class="botao {variante}" class:cheia={largura === 'cheia'} {...resto}>
		{@render children()}
	</a>
{:else}
	<button
		type={tipo}
		class="botao {variante}"
		class:cheia={largura === 'cheia'}
		class:ocupado={carregando}
		disabled={desabilitado}
		aria-disabled={inativo || undefined}
		aria-busy={carregando || undefined}
		onclick={handleClick}
		{...resto}
	>
		{#if carregando}
			<!-- O rótulo permanece: trocar por "Carregando" faz o botão mudar de
			     largura e o leitor de tela perder o contexto da ação. -->
			<span class="giro" aria-hidden="true"></span>
		{/if}
		{@render children()}
	</button>
{/if}

<style>
	.botao {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		gap: var(--esp-2);

		min-height: var(--toque-min);
		padding: 0 var(--esp-5);

		border: 1px solid transparent;
		border-radius: var(--raio);

		font-size: var(--texto-base);
		font-weight: 600;
		text-decoration: none;
		overflow-wrap: anywhere;

		cursor: pointer;
		transition:
			background-color var(--transicao),
			border-color var(--transicao),
			color var(--transicao),
			opacity var(--transicao),
			transform 90ms cubic-bezier(0.2, 0, 0.2, 1),
			box-shadow var(--transicao);
	}

	.cheia {
		width: 100%;
	}

	.botao:disabled,
	.botao.ocupado {
		opacity: 0.65;
		cursor: not-allowed;
	}

	/* Feedback tátil de clique — só no botão, nunca em containers. */
	.botao:active:not(:disabled):not(.ocupado) {
		transform: scale(0.97);
	}

	/* Anel de foco visível para acessibilidade */
	.botao:focus-visible {
		outline: 2px solid var(--cor-foco);
		outline-offset: 2px;
	}

	/* --- Primário: a ação que a tela quer que você faça --------------------- */
	.primario {
		background: var(--cor-marca);
		color: var(--cor-sobre-marca);
	}

	/* --- Secundário --------------------------------------------------------- */
	.secundario {
		background: var(--cor-superficie);
		color: var(--cor-texto);
		border-color: var(--cor-linha-forte);
	}

	/* --- Texto -------------------------------------------------------------- */
	.texto {
		background: transparent;
		color: var(--cor-marca);
		padding-inline: var(--esp-3);
	}

	/* --- Destrutivo ---------------------------------------------------------
	   NUNCA preenchido de vermelho: contorno + cor de perigo. */
	.destrutivo {
		background: transparent;
		color: var(--cor-perigo);
		border-color: var(--cor-perigo);
	}

	@media (hover: hover) {
		.primario:hover:not(:disabled):not(.ocupado) {
			background: var(--cor-marca-hover);
		}
		.secundario:hover:not(:disabled):not(.ocupado) {
			border-color: var(--cor-marca);
			color: var(--cor-marca);
		}
		.texto:hover:not(:disabled):not(.ocupado) {
			background: var(--cor-marca-suave);
		}
		.destrutivo:hover:not(:disabled):not(.ocupado) {
			background: var(--cor-perigo-suave);
		}
	}

	.giro {
		width: 1em;
		height: 1em;
		border: 2px solid currentColor;
		border-top-color: transparent;
		border-radius: 50%;
		animation: girar 700ms linear infinite;
	}

	@keyframes girar {
		to {
			transform: rotate(360deg);
		}
	}
</style>

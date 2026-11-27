<script lang="ts">
	import type { Snippet } from 'svelte';

	let { children }: { children: Snippet } = $props();
</script>

<!--
	Telas de fora do app (entrar, convite, senha, pedir acesso). No celular, só
	o formulário, como sempre. No desktop, a tela larga ganha um painel da
	marca à esquerda: a mesma águia do ícone e da prévia de links, para quem
	chega pelo convite reconhecer onde está.
-->
<div class="entrada">
	<aside class="painel-marca" aria-hidden="true">
		<div class="marca-grande">
			<img src="/icone-512.png" alt="" width="320" height="320" decoding="async" />
			<p class="nome">Eagles</p>
			<p class="frase">Encontros, PGs e escalas dos Eagles num só lugar.</p>
		</div>
	</aside>
	<div class="lado-formulario">
		{@render children()}
	</div>
</div>

<style>
	.painel-marca {
		display: none;
	}

	@media (min-width: 960px) {
		.entrada {
			display: grid;
			grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
			min-height: 100dvh;
		}

		.painel-marca {
			display: grid;
			place-items: center;
			padding: var(--esp-7);
			/* O mesmo vermelho do fundo do ícone: a imagem se funde sem borda. */
			background: #a91825;
			color: #fff;
		}

		.marca-grande {
			display: flex;
			flex-direction: column;
			align-items: center;
			text-align: center;
			gap: var(--esp-2);
			max-width: 26rem;
		}

		img {
			width: min(320px, 70%);
			height: auto;
		}

		.nome {
			font-family: var(--fonte-titulo);
			font-size: 3.5rem;
			font-weight: 800;
			letter-spacing: -0.04em;
			line-height: 1;
		}

		/* A marca já está no painel: não repete no alto do formulário. */
		.lado-formulario :global(header .marca) {
			display: none;
		}

		.frase {
			font-size: var(--texto-lg);
			/* Branco levemente rosado: 4,5:1+ sobre o vermelho da marca. */
			color: #fbedee;
			text-wrap: balance;
		}
	}
</style>

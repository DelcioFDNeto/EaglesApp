<script lang="ts">
	let { tamanho = 40, comNome = false }: { tamanho?: number; comNome?: boolean } = $props();

	// Acima de 48px a tela pede a versão de 192px, para não borrar em telas densas.
	const fonte = $derived(tamanho > 48 ? '/marca-192.png' : '/marca-96.png');
</script>

<!--
	Marca do Eagles App: a águia da logo oficial (Eagles.png), recortada sem o
	letreiro e posta num quadrado arredondado, como ícone de aplicativo. É a
	mesma arte do ícone instalado e da prévia de links, para a pessoa reconhecer
	o app em qualquer lugar.

	Pendência de identidade: a arte original é um JPEG de 640px. Uma versão
	vetorial deixaria a marca nítida em qualquer tamanho.
-->
<span class="marca" style="--t: {tamanho}px">
	<img
		src={fonte}
		srcset="/marca-96.png 1x, /marca-192.png 2x"
		width={tamanho}
		height={tamanho}
		alt={comNome ? '' : 'Eagles'}
		decoding="async"
	/>
	{#if comNome}<strong>Eagles</strong>{/if}
</span>

<style>
	.marca {
		display: inline-flex;
		align-items: center;
		gap: var(--esp-2);
	}

	img {
		width: var(--t);
		height: var(--t);
		flex: none;
		/* Mesmo arredondado relativo dos ícones de app (~22%). */
		border-radius: calc(var(--t) * 0.22);
		box-shadow: inset 0 0 0 1px rgb(0 0 0 / 0.08);
	}

	strong {
		font-family: var(--fonte-titulo);
		font-size: calc(var(--t) * 0.62);
		font-weight: 800;
		letter-spacing: -0.03em;
		color: var(--cor-texto);
	}
</style>

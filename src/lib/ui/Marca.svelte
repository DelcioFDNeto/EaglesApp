<script lang="ts">
	let { tamanho = 40, comNome = false }: { tamanho?: number; comNome?: boolean } = $props();
</script>

<!--
	Marca do Eagles App.

	Silhueta simplificada da águia da logo, desenhada em SVG para escalar sem
	peso e herdar a cor do tema. A logo completa (Eagles.png) é usada no ícone
	do PWA e na tela de entrada; aqui vale a versão que funciona a 24px.

	Pendência de identidade: a arte original tem fundo sólido. Falta a versão
	transparente/vetorial para substituir este desenho pelo traço oficial.
-->
<span class="marca" style="--t: {tamanho}px">
	<svg viewBox="0 0 24 24" width={tamanho} height={tamanho} aria-hidden={comNome}>
		<path
			d="M3 9c3-3.4 6.6-5 10.6-5 1.6 0 3 .3 4.4.9-1 .5-1.8 1.2-2.4 2 1.5-.3 2.9-.2 4.4.4-1.2.9-2 2-2.4 3.3 1 .1 1.9.5 2.7 1.1-3.2 1-5 3.1-6.4 5.7-1.3 2.4-3.3 3.8-6 4-1.6.1-3-.3-4.3-1.2 1.6-.2 2.9-.9 3.9-2C4.7 17.6 3.2 15.6 3 13c.8.5 1.6.8 2.5.8C4 12.4 3.2 10.8 3 9Z"
			fill="currentColor"
		/>
	</svg>
	{#if comNome}<strong>Eagles</strong>{/if}
</span>

<style>
	.marca {
		display: inline-flex;
		align-items: center;
		gap: var(--esp-2);
		color: var(--cor-marca);
	}

	strong {
		font-size: calc(var(--t) * 0.46);
		font-weight: 800;
		letter-spacing: -0.03em;
		color: var(--cor-texto);
	}
</style>

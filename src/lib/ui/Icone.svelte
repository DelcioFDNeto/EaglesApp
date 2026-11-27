<script lang="ts" module>
	import type { NomeIcone } from '$lib/navegacao';

	type Forma =
		| { d: string }
		| { c: [number, number, number] }
		| { r: [number, number, number, number, number] };

	/**
	 * Ícones de traço, grade 16×16, mesmo desenho dos atalhos que a tela inicial
	 * já usava. Traço em `currentColor`: herdam a cor do texto ao redor.
	 */
	const FORMAS: Record<NomeIcone, Forma[]> = {
		inicio: [
			{ d: 'M2.5 7.2 8 2.8l5.5 4.4V13a.8.8 0 0 1-.8.8H9.6V10H6.4v3.8H3.3a.8.8 0 0 1-.8-.8Z' }
		],
		eventos: [{ r: [2, 3, 12, 11, 1.5] }, { d: 'M5 1.5v3M11 1.5v3M2 6.5h12' }],
		grupos: [
			{ c: [5.5, 5.5, 2.2] },
			{ c: [11, 6, 1.8] },
			{
				d: 'M1.8 13c.4-2.2 1.9-3.3 3.7-3.3S8.8 10.8 9.2 13M9.8 13c.2-1.5 1.1-2.4 2.3-2.4 1 0 1.8.6 2.1 2.4'
			}
		],
		escalas: [{ d: 'M3 4.5h10M3 8h10M3 11.5h6' }, { d: 'M11 11.5l1.2 1.2L14.5 10' }],
		comunicacao: [
			{
				d: 'M2.5 3.5h11a1 1 0 0 1 1 1v6.5a1 1 0 0 1-1 1H6.2L3 14.2V12h-.5a1 1 0 0 1-1-1V4.5a1 1 0 0 1 1-1z'
			}
		],
		sino: [
			{
				d: 'M8 2.2a3.6 3.6 0 0 0-3.6 3.6v2.7L3.1 11h9.8l-1.3-2.5V5.8A3.6 3.6 0 0 0 8 2.2Z'
			},
			{ d: 'M6.4 12.6a1.8 1.8 0 0 0 3.2 0' }
		],
		pessoas: [
			{ c: [6, 5.2, 2.4] },
			{ d: 'M1.8 13.5c.6-2.4 2.2-3.6 4.2-3.6 1.3 0 2.4.5 3.2 1.5' },
			{ d: 'M12.5 8.5v5M10 11h5' }
		],
		frequencia: [{ d: 'M2.5 13.5h11' }, { d: 'M4.5 11V8M8 11V4.5M11.5 11V6.5' }],
		draft: [
			{ d: 'M8 2 14 8 8 14 2 8Z' },
			{ d: 'M8 2v12M2 8h12' },
			{ d: 'M8 4.6 11.4 8 8 11.4 4.6 8Z' }
		],
		financeiro: [{ r: [2, 3.5, 12, 9, 1.4] }, { c: [8, 8, 1.8] }],
		assistente: [{ r: [2.5, 2.5, 11, 11, 2] }, { d: 'M5.5 6h5M5.5 8.5h5M5.5 11h3' }],
		lideranca: [{ d: 'M2.5 12.5h11M3.5 12.5 2.5 5l3.2 2.6L8 3.5l2.3 4.1L13.5 5l-1 7.5' }],
		admin: [
			{ c: [8, 8, 2.2] },
			{
				d: 'M8 2v1.6M8 12.4V14M2 8h1.6M12.4 8H14M3.8 3.8l1.1 1.1M11.1 11.1l1.1 1.1M12.2 3.8l-1.1 1.1M4.9 11.1l-1.1 1.1'
			}
		],
		perfil: [{ c: [8, 5.2, 2.6] }, { d: 'M3 13.5c.7-2.6 2.6-3.8 5-3.8s4.3 1.2 5 3.8' }],
		sessoes: [{ r: [2, 2.5, 8, 11, 1.4] }, { d: 'M12 5.5h1.5a1 1 0 0 1 1 1v6a1 1 0 0 1-1 1H10' }],
		mais: [{ c: [3.5, 8, 0.6] }, { c: [8, 8, 0.6] }, { c: [12.5, 8, 0.6] }],
		sair: [{ d: 'M6 13.5H3.5a1 1 0 0 1-1-1v-9a1 1 0 0 1 1-1H6M10.5 11l3-3-3-3M13.5 8H6.5' }]
	};
</script>

<script lang="ts">
	let { nome, tamanho = 20 }: { nome: NomeIcone; tamanho?: number } = $props();
</script>

<svg
	viewBox="0 0 16 16"
	width={tamanho}
	height={tamanho}
	aria-hidden="true"
	fill="none"
	stroke="currentColor"
	stroke-width="1.4"
	stroke-linecap="round"
	stroke-linejoin="round"
>
	{#each FORMAS[nome] as f, i (i)}
		{#if 'd' in f}
			<path d={f.d} />
		{:else if 'c' in f}
			<circle cx={f.c[0]} cy={f.c[1]} r={f.c[2]} />
		{:else}
			<rect x={f.r[0]} y={f.r[1]} width={f.r[2]} height={f.r[3]} rx={f.r[4]} />
		{/if}
	{/each}
</svg>

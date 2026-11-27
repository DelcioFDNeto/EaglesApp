<script lang="ts">
	import { ATRIBUTOS, formatarNota, type NotasAtributos } from '$shared/atributos';

	/**
	 * Gráfico radar de 4 eixos (Físico, Mental, Coordenação Motora, Bíblico),
	 * escala fixa 0–10. Aceita 1 série (ficha individual) ou até 3 séries
	 * sobrepostas (comparação no Draft), diferenciando por cor + padrão de traço
	 * para nunca depender apenas de cor (WCAG 2.1 AA).
	 */
	export type SerieRadar = {
		rotulo: string;
		notas: NotasAtributos;
	};

	let {
		series,
		tamanho = 240,
		titulo = 'Perfil de atributos'
	}: {
		series: SerieRadar[];
		tamanho?: number;
		titulo?: string;
	} = $props();

	const CX = 150;
	const CY = 122;
	const RAIO = 76;
	const ANEIS = [0.25, 0.5, 0.75, 1];

	// Ordem horária: topo (Físico), direita (Mental), baixo (Coordenação), esquerda (Bíblico).
	const EIXOS = [
		{ chave: 'fisico' as const, rotulo: 'Físico', dx: 0, dy: -1, lx: 0, ly: -16, anchor: 'middle' },
		{ chave: 'mental' as const, rotulo: 'Mental', dx: 1, dy: 0, lx: 12, ly: 4, anchor: 'start' },
		{
			chave: 'coordenacaoMotora' as const,
			rotulo: 'Coordenação',
			dx: 0,
			dy: 1,
			lx: 0,
			ly: 22,
			anchor: 'middle'
		},
		{ chave: 'biblico' as const, rotulo: 'Bíblico', dx: -1, dy: 0, lx: -12, ly: 4, anchor: 'end' }
	];

	const ESTILOS: ReadonlyArray<{ stroke: string; fill: string; dash?: string }> = [
		{ stroke: 'var(--cor-marca)', fill: 'var(--cor-marca)' },
		{ stroke: 'var(--cor-sucesso)', fill: 'var(--cor-sucesso)', dash: '6 3' },
		{ stroke: 'var(--cor-aviso)', fill: 'var(--cor-aviso)', dash: '2 3' }
	];

	function estiloDaSerie(idx: number) {
		return ESTILOS[idx] ?? { stroke: 'var(--cor-marca)', fill: 'var(--cor-marca)' };
	}

	function ponto(dx: number, dy: number, valor: number | null) {
		const frac = valor === null ? 0 : Math.max(0, Math.min(10, valor)) / 10;
		return {
			x: CX + dx * RAIO * frac,
			y: CY + dy * RAIO * frac
		};
	}

	function poligono(notas: NotasAtributos) {
		return EIXOS.map((e) => {
			const p = ponto(e.dx, e.dy, notas[e.chave]);
			return `${p.x.toFixed(1)},${p.y.toFixed(1)}`;
		}).join(' ');
	}

	function anel(frac: number) {
		return EIXOS.map(
			(e) => `${(CX + e.dx * RAIO * frac).toFixed(1)},${(CY + e.dy * RAIO * frac).toFixed(1)}`
		).join(' ');
	}

	const descricaoAcessivel = $derived.by(() => {
		const partes = series.map((s) => {
			const itens = ATRIBUTOS.map((a) => `${a.rotulo} ${formatarNota(s.notas[a.chave])}`).join(
				', '
			);
			return `${s.rotulo}: ${itens}`;
		});
		return `${titulo}. ${partes.join(' | ')}`;
	});
</script>

<div class="radar">
	<svg
		viewBox="0 0 300 246"
		width={tamanho}
		height={Math.round((tamanho * 246) / 300)}
		role="img"
		aria-label={descricaoAcessivel}
	>
		<!-- Grade em losangos (2,5 / 5 / 7,5 / 10) -->
		{#each ANEIS as frac (frac)}
			<polygon points={anel(frac)} class="anel" />
		{/each}

		<!-- Eixos -->
		{#each EIXOS as e (e.chave)}
			<line x1={CX} y1={CY} x2={CX + e.dx * RAIO} y2={CY + e.dy * RAIO} class="eixo" />
		{/each}

		<!-- Escala discreta no eixo vertical -->
		<text x={CX + 4} y={CY - RAIO * 0.5 + 3} class="marca-escala">5</text>
		<text x={CX + 4} y={CY - RAIO + 10} class="marca-escala">10</text>

		<!-- Séries -->
		{#each series.slice(0, 3) as s, idx (s.rotulo + idx)}
			{@const estilo = estiloDaSerie(idx)}
			<polygon
				points={poligono(s.notas)}
				fill={estilo.fill}
				fill-opacity={series.length === 1 ? 0.18 : 0.11}
				stroke={estilo.stroke}
				stroke-width="2.2"
				stroke-linejoin="round"
				stroke-dasharray={estilo.dash}
			/>
			{#each EIXOS as e (e.chave)}
				{#if s.notas[e.chave] !== null}
					{@const pt = ponto(e.dx, e.dy, s.notas[e.chave])}
					<circle cx={pt.x} cy={pt.y} r="3.6" fill={estilo.stroke} />
				{/if}
			{/each}
		{/each}

		<!-- Rótulos dos 4 eixos -->
		{#each EIXOS as e (e.chave)}
			{@const valorUnico = series.length === 1 ? (series[0]?.notas[e.chave] ?? null) : null}
			<text
				x={CX + e.dx * RAIO + e.lx}
				y={CY + e.dy * RAIO + e.ly}
				text-anchor={e.anchor}
				class="rotulo-eixo"
			>
				{e.rotulo}{#if series.length === 1 && valorUnico !== null}
					({valorUnico}){/if}
			</text>
		{/each}
	</svg>

	{#if series.length > 1}
		<ul class="legenda" aria-label="Legenda da comparação">
			{#each series.slice(0, 3) as s, idx (s.rotulo + idx)}
				{@const estilo = estiloDaSerie(idx)}
				<li>
					<svg width="22" height="10" viewBox="0 0 22 10" aria-hidden="true">
						<line
							x1="1"
							y1="5"
							x2="21"
							y2="5"
							stroke={estilo.stroke}
							stroke-width="2.4"
							stroke-dasharray={estilo.dash}
						/>
					</svg>
					<span>{s.rotulo}</span>
				</li>
			{/each}
		</ul>
	{/if}
</div>

<style>
	.radar {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: var(--esp-2);
	}

	.radar svg {
		max-width: 100%;
		height: auto;
		display: block;
	}

	.anel {
		fill: none;
		stroke: var(--cor-linha);
		stroke-width: 1;
	}

	.eixo {
		stroke: var(--cor-linha);
		stroke-width: 1;
	}

	.marca-escala {
		font-size: 9px;
		fill: var(--cor-texto-3);
		font-weight: 600;
	}

	.rotulo-eixo {
		font-size: 11px;
		font-weight: 700;
		fill: var(--cor-texto-2);
	}

	.legenda {
		list-style: none;
		padding: 0;
		margin: 0;
		display: flex;
		flex-wrap: wrap;
		justify-content: center;
		gap: var(--esp-2) var(--esp-4);
		font-size: var(--texto-xs);
		color: var(--cor-texto-2);
		font-weight: 600;
	}

	.legenda li {
		display: inline-flex;
		align-items: center;
		gap: var(--esp-1);
	}
</style>

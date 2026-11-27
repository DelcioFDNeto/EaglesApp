<script lang="ts">
	/**
	 * Evolução mensal de uma porcentagem (uma série só).
	 *
	 * Colunas finas (≤ 24px) saindo de uma linha de base, topo arredondado,
	 * escala fixa de 0 a 100%. Sem legenda: o título diz o que é. Só o último
	 * mês leva o valor escrito; os outros aparecem ao passar o mouse ou focar
	 * pelo teclado, e todos estão na tabela logo abaixo.
	 */
	let {
		titulo,
		pontos,
		rotuloValor = 'Presença'
	}: {
		titulo: string;
		pontos: Array<{ mes: string; taxa: number | null; chamadas?: number }>;
		rotuloValor?: string;
	} = $props();

	const nomeMes = (mes: string, longo = false) => {
		const [a, m] = mes.split('-').map(Number) as [number, number];
		return new Date(a, m - 1, 1)
			.toLocaleDateString('pt-BR', longo ? { month: 'long', year: 'numeric' } : { month: 'short' })
			.replace('.', '');
	};

	let ativo = $state<string | null>(null);
	const ultimo = $derived(pontos.at(-1)?.mes ?? null);
</script>

<figure class="grafico">
	<figcaption>{titulo}</figcaption>

	<div class="area" role="group" aria-label={titulo}>
		<div class="grade" aria-hidden="true">
			<span style="bottom: 100%">100%</span>
			<span style="bottom: 50%">50%</span>
			<span style="bottom: 0%">0%</span>
		</div>

		<div class="colunas">
			{#each pontos as p (p.mes)}
				{@const altura = p.taxa ?? 0}
				<button
					type="button"
					class="coluna"
					aria-label={`${nomeMes(p.mes, true)}: ${p.taxa === null ? 'sem chamada' : `${p.taxa}%`}`}
					onmouseenter={() => (ativo = p.mes)}
					onmouseleave={() => (ativo = null)}
					onfocus={() => (ativo = p.mes)}
					onblur={() => (ativo = null)}
				>
					<span class="trilho">
						{#if p.taxa !== null}
							<span class="barra" style="height: {altura}%"></span>
						{/if}
						{#if (p.mes === ultimo && ativo === null) || ativo === p.mes}
							<span class="valor" style="bottom: {altura}%">
								{p.taxa === null ? '—' : `${p.taxa}%`}
							</span>
						{/if}
						{#if ativo === p.mes}
							<span class="dica" role="tooltip">
								<strong>{nomeMes(p.mes, true)}</strong>
								<span>{rotuloValor}: {p.taxa === null ? 'sem chamada' : `${p.taxa}%`}</span>
								{#if p.chamadas !== undefined}<span>{p.chamadas} chamada(s)</span>{/if}
							</span>
						{/if}
					</span>
					<span class="mes" aria-hidden="true">{nomeMes(p.mes)}</span>
				</button>
			{/each}
		</div>
	</div>

	<details class="tabela">
		<summary>Ver em tabela</summary>
		<table>
			<thead>
				<tr>
					<th scope="col">Mês</th>
					<th scope="col">{rotuloValor}</th>
					{#if pontos.some((p) => p.chamadas !== undefined)}<th scope="col">Chamadas</th>{/if}
				</tr>
			</thead>
			<tbody>
				{#each pontos as p (p.mes)}
					<tr>
						<td>{nomeMes(p.mes, true)}</td>
						<td>{p.taxa === null ? '—' : `${p.taxa}%`}</td>
						{#if p.chamadas !== undefined}<td>{p.chamadas}</td>{/if}
					</tr>
				{/each}
			</tbody>
		</table>
	</details>
</figure>

<style>
	.grafico {
		display: flex;
		flex-direction: column;
		gap: var(--esp-3);
		margin: 0;
	}

	figcaption {
		font-family: var(--fonte-titulo);
		font-size: var(--texto-lg);
		font-weight: 700;
	}

	.area {
		position: relative;
		height: 180px;
		margin: var(--esp-4) 0 var(--esp-6) 40px;
	}

	/* Grade recessiva: três linhas finas, sólidas, um tom acima da superfície. */
	.grade span {
		position: absolute;
		left: -40px;
		right: 0;
		transform: translateY(50%);
		border-bottom: 1px solid var(--cor-linha);
		font-size: var(--texto-xs);
		color: var(--cor-texto-3);
		line-height: 0;
		padding-bottom: 0;
	}

	.colunas {
		position: absolute;
		inset: 0;
		display: flex;
		align-items: stretch;
		justify-content: space-around;
		gap: 2px;
	}

	.coluna {
		position: relative;
		flex: 1;
		max-width: 72px;
		display: flex;
		flex-direction: column;
		align-items: center;
		padding: 0;
		border: 0;
		background: none;
		font: inherit;
		color: inherit;
		outline: none;
		cursor: default;
	}

	.coluna:focus-visible .trilho {
		outline: 2px solid var(--cor-foco);
		outline-offset: 2px;
		border-radius: var(--raio-sm);
	}

	.trilho {
		position: relative;
		flex: 1;
		width: 100%;
		display: flex;
		justify-content: center;
		align-items: flex-end;
	}

	.barra {
		display: block;
		width: 24px;
		max-width: 60%;
		min-height: 2px;
		background: var(--cor-marca);
		/* Topo arredondado, base reta na linha de base. */
		border-radius: 4px 4px 0 0;
	}

	.valor {
		position: absolute;
		transform: translateY(-4px);
		font-size: var(--texto-xs);
		font-weight: 700;
		color: var(--cor-texto);
		white-space: nowrap;
	}

	.mes {
		position: absolute;
		bottom: -22px;
		font-size: var(--texto-xs);
		color: var(--cor-texto-2);
		white-space: nowrap;
	}

	.dica {
		position: absolute;
		bottom: calc(100% + 6px);
		z-index: 5;
		display: flex;
		flex-direction: column;
		gap: 2px;
		padding: var(--esp-2) var(--esp-3);
		background: var(--cor-superficie);
		border: 1px solid var(--cor-linha-forte);
		border-radius: var(--raio);
		box-shadow: var(--sombra-2);
		font-size: var(--texto-xs);
		color: var(--cor-texto-2);
		white-space: nowrap;
		pointer-events: none;
	}

	.dica strong {
		color: var(--cor-texto);
		text-transform: capitalize;
	}

	.tabela summary {
		font-size: var(--texto-sm);
		font-weight: 600;
		color: var(--cor-marca);
		cursor: pointer;
		min-height: var(--toque-min);
		display: flex;
		align-items: center;
	}

	table {
		width: 100%;
		border-collapse: collapse;
		font-size: var(--texto-sm);
	}

	th,
	td {
		text-align: left;
		padding: var(--esp-2) var(--esp-1);
		border-bottom: 1px solid var(--cor-linha);
	}

	td:first-child {
		text-transform: capitalize;
	}
</style>

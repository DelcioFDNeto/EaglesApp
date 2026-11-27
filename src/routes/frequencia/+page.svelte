<script lang="ts">
	import { onMount } from 'svelte';
	import Aviso from '$ui/Aviso.svelte';
	import Marca from '$ui/Marca.svelte';
	import GraficoMensal from '$ui/GraficoMensal.svelte';
	import { api } from '$lib/api';

	type Periodo = 30 | 90 | 365;
	const PERIODOS: Array<{ dias: Periodo; rotulo: string }> = [
		{ dias: 30, rotulo: '30 dias' },
		{ dias: 90, rotulo: '3 meses' },
		{ dias: 365, rotulo: '12 meses' }
	];
	/** Valor do seletor que pede a visão da equipe (só líderes). */
	const EQUIPE = '';

	let dados = $state<any>(null);
	let carregando = $state(true);
	let erro = $state<string | undefined>(undefined);
	let periodo = $state<Periodo>(90);
	let grupo = $state<string>(EQUIPE);

	onMount(carregar);

	function iso(d: Date) {
		return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
	}

	async function carregar() {
		carregando = true;
		erro = undefined;
		const ate = new Date();
		const de = new Date(+ate - periodo * 86_400_000);
		const qs = new URLSearchParams({ de: iso(de), ate: iso(ate) });
		if (grupo) qs.set('grupo', grupo);
		try {
			const res = await api.get(`/api/frequencia?${qs}`);
			const d = await res.json().catch(() => ({}));
			if (!res.ok && !d.grupos) {
				erro = d.erro ?? 'Não foi possível carregar a frequência.';
				return;
			}
			dados = d;
			// Conselheiro sem PG escolhido: o servidor pede para escolher.
			if (!res.ok) {
				if (!grupo && d.grupos?.length) {
					grupo = d.grupos[0].id;
					return carregar();
				}
				erro = d.erro;
			} else if (d.grupo && !grupo) {
				grupo = d.grupo.id;
			}
		} catch {
			erro = 'Sem conexão. Não foi possível carregar a frequência.';
		} finally {
			carregando = false;
		}
	}

	const pct = (v: number | null) => (v === null ? '—' : `${v}%`);
	/** 7.4 → "7,4" (número em português). */
	const num = (v: number | null) =>
		v === null ? '—' : v.toLocaleString('pt-BR', { maximumFractionDigits: 1 });
	const dataCurta = (s: string | null) =>
		s ? new Date(s).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' }) : null;
</script>

<svelte:head>
	<title>Frequência · Eagles</title>
</svelte:head>

<main class="conteudo largo">
	<div class="pilha">
		<header>
			<h1>Frequência</h1>
			<p class="sub">
				Para cuidar de quem está se afastando, não para cobrar. Conta só os encontros em que a
				chamada foi feita, e não responder nunca conta como falta.
			</p>
		</header>

		<div class="filtros" role="group" aria-label="Filtros">
			{#if dados?.grupos?.length > 1 || dados?.podeVerEquipe}
				<label class="filtro-pg">
					<span class="visualmente-oculto">PG</span>
					<select bind:value={grupo} onchange={carregar}>
						{#if dados?.podeVerEquipe}<option value={EQUIPE}>Todos os PGs</option>{/if}
						{#each dados?.grupos ?? [] as g (g.id)}
							<option value={g.id}>{g.nome}</option>
						{/each}
					</select>
				</label>
			{/if}
			<div class="periodos" role="radiogroup" aria-label="Período">
				{#each PERIODOS as p (p.dias)}
					<button
						type="button"
						role="radio"
						aria-checked={periodo === p.dias}
						class:ativo={periodo === p.dias}
						onclick={() => {
							periodo = p.dias;
							carregar();
						}}
					>
						{p.rotulo}
					</button>
				{/each}
			</div>
		</div>

		{#if erro}<Aviso tom="erro">{erro}</Aviso>{/if}

		{#if carregando && !dados}
			<div class="estado">
				<Marca tamanho={44} />
				<p>Carregando…</p>
			</div>
		{:else if dados?.escopo === 'pg'}
			{@const c = dados.confirmacao}
			<section
				class="indicadores"
				aria-label="Resumo de {dados.grupo.nome}"
				class:recarregando={carregando}
			>
				<div class="indicador">
					<span class="rotulo">Presença</span>
					<strong>{pct(dados.taxaPresenca)}</strong>
					<span class="detalhe">de quem era esperado</span>
				</div>
				<div class="indicador">
					<span class="rotulo">Chamadas feitas</span>
					<strong>{dados.chamadas}</strong>
					<span class="detalhe">
						{dados.semChamada > 0
							? `${dados.semChamada} encontro(s) sem chamada`
							: 'em todos os encontros'}
					</span>
				</div>
				<div class="indicador">
					<span class="rotulo">Por encontro</span>
					<strong>{num(dados.presencaMedia)}</strong>
					<span class="detalhe">pessoas em média</span>
				</div>
				<div class="indicador">
					<span class="rotulo">Confirmou e veio</span>
					<strong>{c.confirmaram > 0 ? `${c.confirmaramEVieram} de ${c.confirmaram}` : '—'}</strong>
					<span class="detalhe">
						{c.vieramSemConfirmar > 0
							? `${c.vieramSemConfirmar} vieram sem confirmar`
							: 'ninguém veio sem confirmar'}
					</span>
				</div>
			</section>

			{#if dados.chamadas === 0}
				<div class="vazio">
					<h2>Nenhuma chamada neste período</h2>
					<p>
						A frequência aparece depois que alguém registrar quem veio aos encontros de
						{dados.grupo.nome}. Abra o encontro e use a lista de chamada.
					</p>
				</div>
			{:else}
				<div class="duas-colunas">
					<section class="bloco">
						<GraficoMensal
							titulo="Presença por mês"
							pontos={dados.evolucao.map((e: any) => ({
								mes: e.mes,
								taxa: e.taxa,
								chamadas: e.chamadas
							}))}
						/>
					</section>

					<section class="bloco" aria-labelledby="titulo-pessoas">
						<h2 id="titulo-pessoas">Pessoas</h2>
						<p class="legenda">Em ordem alfabética. Toque no nome para ver a caminhada.</p>
						<ul class="medidores">
							{#each dados.pessoas as p (p.id)}
								<li>
									<div class="linha-nome">
										<a href={`/pessoas/${p.id}`}>{p.nome}</a>
										<span class="numero">{p.presencas} de {p.esperados}</span>
									</div>
									<div
										class="trilho"
										role="meter"
										aria-valuemin="0"
										aria-valuemax="100"
										aria-valuenow={p.taxa ?? 0}
										aria-label="Presença de {p.nome}"
									>
										<div class="preenchido" style="width: {p.taxa ?? 0}%"></div>
									</div>
									{#if p.faltasSeguidas >= 2}
										<span class="atencao">
											<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
												<circle
													cx="8"
													cy="8"
													r="6.5"
													fill="none"
													stroke="currentColor"
													stroke-width="1.4"
												/>
												<path
													d="M8 4.8v3.6M8 10.8v.4"
													stroke="currentColor"
													stroke-width="1.6"
													stroke-linecap="round"
												/>
											</svg>
											{`Não veio nos últimos ${p.faltasSeguidas} encontros`}{p.ultimaPresenca
												? ` · veio pela última vez em ${dataCurta(p.ultimaPresenca)}`
												: ''}
										</span>
									{:else if p.faltasAvisadas > 0}
										<span class="detalhe">
											{p.faltasAvisadas}
											{p.faltasAvisadas === 1 ? 'falta' : 'faltas'} com resposta "não vou" ou "talvez"
										</span>
									{/if}
								</li>
							{/each}
						</ul>
					</section>
				</div>
			{/if}
		{:else if dados?.escopo === 'equipe'}
			<section class="bloco" aria-labelledby="titulo-por-pg" class:recarregando={carregando}>
				<h2 id="titulo-por-pg">Por PG</h2>
				{#if dados.porPg.length === 0}
					<p class="legenda">Nenhum PG ainda.</p>
				{:else}
					<ul class="medidores">
						{#each dados.porPg as g (g.grupo.id)}
							<li>
								<div class="linha-nome">
									<button
										type="button"
										class="link"
										onclick={() => ((grupo = g.grupo.id), carregar())}
									>
										{g.grupo.nome}
									</button>
									<span class="numero">{pct(g.taxaPresenca)}</span>
								</div>
								<div
									class="trilho"
									role="meter"
									aria-valuemin="0"
									aria-valuemax="100"
									aria-valuenow={g.taxaPresenca ?? 0}
									aria-label="Presença em {g.grupo.nome}"
								>
									<div class="preenchido" style="width: {g.taxaPresenca ?? 0}%"></div>
								</div>
								<span class="detalhe">
									{g.chamadas}
									{g.chamadas === 1 ? 'chamada' : 'chamadas'}{#if g.presencaMedia !== null}
										· {num(g.presencaMedia)} pessoas por encontro{/if}{#if g.semChamada > 0}
										· {g.semChamada} sem chamada{/if}
								</span>
							</li>
						{/each}
					</ul>
				{/if}
			</section>

			{#if dados.eventosDaEquipe.length > 0}
				<section class="bloco" aria-labelledby="titulo-equipe">
					<h2 id="titulo-equipe">Eventos da equipe toda</h2>
					<p class="legenda">
						Sem porcentagem: nesses eventos não dá para saber quem era esperado.
					</p>
					<table>
						<thead>
							<tr>
								<th scope="col">Tipo</th>
								<th scope="col">Eventos</th>
								<th scope="col">Com chamada</th>
								<th scope="col">Pessoas por evento</th>
							</tr>
						</thead>
						<tbody>
							{#each dados.eventosDaEquipe as t (t.tipo)}
								<tr>
									<td>{t.tipo}</td>
									<td>{t.eventos}</td>
									<td>{t.chamadas}</td>
									<td>{num(t.presencaMedia)}</td>
								</tr>
							{/each}
						</tbody>
					</table>
				</section>
			{/if}
		{/if}
	</div>
</main>

<style>
	header {
		display: flex;
		flex-direction: column;
		gap: var(--esp-1);
	}

	.sub,
	.legenda {
		color: var(--cor-texto-2);
		font-size: var(--texto-sm);
		max-width: 70ch;
	}

	/* --- Filtros: uma linha acima de tudo --- */

	.filtros {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: var(--esp-3);
	}

	select {
		min-height: var(--toque-min);
		padding: 0 var(--esp-3);
		background: var(--cor-superficie);
		color: var(--cor-texto);
		border: 1px solid var(--cor-linha-forte);
		border-radius: var(--raio);
		font-size: 16px;
		font-family: inherit;
	}

	.periodos {
		display: inline-flex;
		padding: 3px;
		gap: 2px;
		background: var(--cor-superficie-2);
		border: 1px solid var(--cor-linha);
		border-radius: var(--raio);
	}

	.periodos button {
		min-height: 38px;
		padding: 0 var(--esp-3);
		border: 0;
		border-radius: calc(var(--raio) - 3px);
		background: none;
		color: var(--cor-texto-2);
		font: inherit;
		font-size: var(--texto-sm);
		font-weight: 600;
		cursor: pointer;
	}

	.periodos button.ativo {
		background: var(--cor-superficie);
		color: var(--cor-texto);
		box-shadow: var(--sombra-1);
	}

	/* --- Indicadores --- */

	.indicadores {
		display: grid;
		grid-template-columns: repeat(2, minmax(0, 1fr));
		gap: var(--esp-2);
	}

	@media (min-width: 760px) {
		.indicadores {
			grid-template-columns: repeat(4, minmax(0, 1fr));
		}
	}

	.indicador {
		display: flex;
		flex-direction: column;
		gap: 2px;
		padding: var(--esp-3) var(--esp-4);
		background: var(--cor-superficie);
		border: 1px solid var(--cor-linha);
		border-radius: var(--raio);
	}

	.indicador .rotulo {
		font-size: var(--texto-sm);
		color: var(--cor-texto-2);
		font-weight: 600;
	}

	.indicador strong {
		font-family: var(--fonte-titulo);
		font-size: var(--texto-2xl);
		font-weight: 800;
		line-height: 1.2;
	}

	.detalhe {
		font-size: var(--texto-xs);
		color: var(--cor-texto-2);
	}

	.recarregando {
		opacity: 0.55;
		transition: opacity var(--transicao);
	}

	/* --- Blocos --- */

	.duas-colunas {
		display: flex;
		flex-direction: column;
		gap: var(--esp-6);
	}

	@media (min-width: 1180px) {
		.duas-colunas {
			display: grid;
			grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
			align-items: start;
		}
	}

	.bloco {
		display: flex;
		flex-direction: column;
		gap: var(--esp-2);
	}

	.bloco h2 {
		font-size: var(--texto-lg);
	}

	/* --- Lista de medidores: nome, barra, número --- */

	.medidores {
		list-style: none;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: var(--esp-4);
		margin-top: var(--esp-2);
	}

	.medidores li {
		display: flex;
		flex-direction: column;
		gap: var(--esp-1);
	}

	.linha-nome {
		display: flex;
		justify-content: space-between;
		align-items: baseline;
		gap: var(--esp-3);
	}

	.linha-nome a,
	.link {
		font-weight: 600;
		color: var(--cor-texto);
		text-decoration: underline;
		text-decoration-color: var(--cor-linha-forte);
		text-underline-offset: 3px;
		overflow-wrap: anywhere;
	}

	.link {
		background: none;
		border: 0;
		padding: 0;
		font: inherit;
		font-weight: 600;
		cursor: pointer;
		text-align: left;
	}

	.numero {
		flex: none;
		font-size: var(--texto-sm);
		font-weight: 600;
		color: var(--cor-texto-2);
		font-variant-numeric: tabular-nums;
	}

	/* Trilho num tom claro da mesma cor da barra. */
	.trilho {
		height: 8px;
		border-radius: var(--raio-cheio);
		background: var(--cor-marca-suave);
		overflow: hidden;
	}

	.preenchido {
		height: 100%;
		background: var(--cor-marca);
		border-radius: var(--raio-cheio);
	}

	.atencao {
		display: inline-flex;
		align-items: center;
		gap: var(--esp-1);
		font-size: var(--texto-xs);
		font-weight: 600;
		color: var(--cor-aviso);
	}

	.atencao svg {
		flex: none;
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

	th {
		color: var(--cor-texto-2);
		font-weight: 600;
	}

	.vazio,
	.estado {
		display: flex;
		flex-direction: column;
		align-items: center;
		text-align: center;
		gap: var(--esp-3);
		padding: var(--esp-6) var(--esp-4);
		color: var(--cor-texto-2);
		font-size: var(--texto-sm);
	}

	.vazio h2 {
		color: var(--cor-texto);
		font-size: var(--texto-lg);
	}

	.vazio p {
		max-width: 44ch;
	}
</style>

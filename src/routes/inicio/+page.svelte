<script lang="ts">
	import { page } from '$app/state';
	import { onMount } from 'svelte';
	import Marca from '$ui/Marca.svelte';
	import Aviso from '$ui/Aviso.svelte';
	import Botao from '$ui/Botao.svelte';
	import InstalarPwa from '$ui/InstalarPwa.svelte';
	import { apiCache, type Inicio } from '$lib/api';
	import { sessao } from '$lib/sessao.svelte';

	const boasVindas = $derived(page.url.searchParams.get('boas-vindas') === '1');

	let inicio = $state<Inicio | null>(null);
	let primeiroNome = $derived(inicio?.nome?.split(' ')[0] ?? '');
	let carregando = $state(true);
	let erro = $state<string | undefined>(undefined);

	const podeCriarEvento = $derived((inicio?.permissoes ?? []).includes('event.manage'));
	const podeVerDraft = $derived((inicio?.permissoes ?? []).includes('person.view'));
	const dashboard = $derived(inicio?.dashboard ?? null);
	const ehPainelLideranca = $derived(
		dashboard?.perfil === 'lider' || dashboard?.perfil === 'conselheiro'
	);

	function formatarCentavos(cents: number): string {
		const inteiro = Math.trunc(cents);
		const negativo = inteiro < 0;
		const abs = Math.abs(inteiro);
		const reais = Math.floor(abs / 100);
		const resto = abs % 100;
		return `${negativo ? '-' : ''}R$ ${reais.toLocaleString('pt-BR')},${String(resto).padStart(2, '0')}`;
	}

	function formatarMedia(valor: number | null): string {
		return valor === null ? '—' : valor.toLocaleString('pt-BR', { maximumFractionDigits: 1 });
	}

	type KpiCard = {
		href: string;
		rotulo: string;
		valor: string;
		detalhe: string;
		negativo?: boolean;
	};

	const kpisLideranca = $derived.by((): KpiCard[] => {
		if (!dashboard || (dashboard.perfil !== 'lider' && dashboard.perfil !== 'conselheiro')) {
			return [];
		}
		const lista: KpiCard[] = [];
		if (dashboard.frequenciaPg30d) {
			const f = dashboard.frequenciaPg30d;
			lista.push({
				href: '/frequencia',
				rotulo: 'Frequência PG (30d)',
				valor: f.taxaPresenca !== null ? `${f.taxaPresenca}%` : '—',
				detalhe:
					f.chamadas > 0
						? `${f.chamadas} ${f.chamadas === 1 ? 'chamada' : 'chamadas'}${f.mediaPresentes !== null ? ` · média ${formatarMedia(f.mediaPresentes)}` : ''}`
						: 'Sem chamadas no período'
			});
		}
		if (dashboard.pessoasNovas30d !== undefined) {
			lista.push({
				href: '/pessoas',
				rotulo: 'Pessoas novas (30d)',
				valor: String(dashboard.pessoasNovas30d),
				detalhe: 'Visitantes e recorrentes'
			});
		}
		if (dashboard.subgrupos) {
			const s = dashboard.subgrupos;
			const aloc = `${s.pessoasAlocadas} ${s.pessoasAlocadas === 1 ? 'alocada' : 'alocadas'}`;
			const sem = s.membrosSemSubgrupo > 0 ? ` · ${s.membrosSemSubgrupo} sem subgrupo` : '';
			lista.push({
				href: '/grupos',
				rotulo: 'Subgrupos ativos',
				valor: String(s.ativos),
				detalhe: `${aloc}${sem}`
			});
		}
		if (dashboard.financeiro) {
			const fin = dashboard.financeiro;
			lista.push({
				href: '/financeiro',
				rotulo: 'Saldo em caixa',
				valor: formatarCentavos(fin.saldoCents),
				detalhe: `Entradas ${formatarCentavos(fin.arrecadadoCents)}`,
				negativo: fin.saldoCents < 0
			});
		}
		return lista;
	});

	type ItemPendencia = {
		href: string;
		titulo: string;
		subtitulo: string;
		total: number;
	};

	const pendenciasLista = $derived.by((): ItemPendencia[] => {
		if (
			!dashboard ||
			(dashboard.perfil !== 'lider' && dashboard.perfil !== 'conselheiro') ||
			!dashboard.pendencias
		) {
			return [];
		}
		const p = dashboard.pendencias;
		const itens: ItemPendencia[] = [];
		if (p.convitesAbertos && p.convitesAbertos > 0) {
			itens.push({
				href: '/pessoas',
				titulo: 'Convites abertos',
				subtitulo: 'Aguardando aceite de acesso',
				total: p.convitesAbertos
			});
		}
		if (p.escalasPropostas && p.escalasPropostas > 0) {
			itens.push({
				href: '/responsabilidades',
				titulo: 'Escalas propostas',
				subtitulo: 'Próximos encontros para confirmar',
				total: p.escalasPropostas
			});
		}
		if (p.despesasPendentes && p.despesasPendentes > 0) {
			itens.push({
				href: '/financeiro',
				titulo: 'Despesas para aprovar',
				subtitulo: 'Lançamentos aguardando revisão',
				total: p.despesasPendentes
			});
		}
		if (p.sugestoesIaPendentes && p.sugestoesIaPendentes > 0) {
			itens.push({
				href: '/assistente',
				titulo: 'Sugestões do assistente',
				subtitulo: 'Propostas aguardando revisão',
				total: p.sugestoesIaPendentes
			});
		}
		return itens;
	});

	// "sexta-feira, 27 de novembro" → "Sexta-feira, 27 de novembro" (só a primeira letra).
	const hoje = (() => {
		const t = new Intl.DateTimeFormat('pt-BR', {
			weekday: 'long',
			day: 'numeric',
			month: 'long'
		}).format(new Date());
		return t.charAt(0).toUpperCase() + t.slice(1);
	})();

	const formatadorData = new Intl.DateTimeFormat('pt-BR', {
		weekday: 'short',
		day: '2-digit',
		month: 'short',
		hour: '2-digit',
		minute: '2-digit'
	});

	/**
	 * Primeiros passos de quem organiza, na ordem em que um depende do outro.
	 * Só entram os que se aplicam à pessoa; o bloco some quando tudo está feito.
	 */
	const passos = $derived.by(() => {
		const p = inicio?.primeirosPassos;
		if (!p) return [];
		const subgrupo = p.subgrupo ?? p.pg ?? null;
		return [
			{
				feito: p.pessoas,
				titulo: 'Cadastrar pessoas e enviar convites',
				texto: 'O convite vai pelo WhatsApp; a pessoa só define a senha.',
				href: '/pessoas'
			},
			{
				feito: p.evento,
				titulo: 'Marcar o primeiro PG ou encontro',
				texto: 'O tipo PG (Pequeno Grupo) já vem pronto. Depois, cada um confirma em um toque.',
				href: '/eventos/novo'
			},
			{
				feito: p.tipoEvento,
				titulo: 'Conferir os tipos de evento',
				texto: 'PG (Pequeno Grupo), Outside, viagem e outros compromissos.',
				href: '/eventos/tipos'
			},
			{
				feito: subgrupo,
				titulo: 'Criar o primeiro subgrupo',
				texto: 'Opcional para organizar e acompanhar a equipe em subgrupos.',
				href: '/grupos'
			}
		].filter((x): x is typeof x & { feito: boolean } => x.feito !== null);
	});
	const faltaAlgumPasso = $derived(passos.some((p) => !p.feito));
	// Sem nada para a coluna da direita, o painel fica numa coluna só, centrada.
	const temLateral = $derived(
		(inicio?.proximasResponsabilidades?.length ?? 0) > 0 ||
			Boolean(inicio?.ultimoAviso) ||
			pendenciasLista.length > 0 ||
			(ehPainelLideranca && podeVerDraft)
	);
	const usarLarguraAmpla = $derived(temLateral || kpisLideranca.length > 0);
	const proximoPasso = $derived(passos.find((p) => !p.feito));

	async function carregarInicio() {
		carregando = true;
		erro = undefined;
		try {
			inicio = await apiCache.inicio();
			sessao.definir(inicio);
		} catch (e: any) {
			erro =
				e.message === 'sem_conexao'
					? 'Você está offline. Tente novamente quando a conexão voltar.'
					: 'Não foi possível carregar o início. Tente novamente.';
		} finally {
			carregando = false;
		}
	}

	onMount(() => {
		carregarInicio();
	});

	function rotuloStatusEscala(status: string) {
		switch (status) {
			case 'proposta':
				return 'Proposta';
			case 'confirmada':
				return 'Confirmada';
			case 'cumprida':
				return 'Cumprida';
			default:
				return status;
		}
	}
</script>

<svelte:head>
	<title>Início · Eagles</title>
</svelte:head>

<main class="conteudo" class:largo={usarLarguraAmpla}>
	{#if carregando}
		<div class="carregando" aria-live="polite">
			<Marca tamanho={44} />
			<p>Carregando…</p>
		</div>
	{:else if erro}
		<div class="vazio">
			<h1>Não foi possível carregar</h1>
			<p>{erro}</p>
			<Botao onclick={carregarInicio}>Tentar novamente</Botao>
		</div>
	{:else}
		<div class="pilha">
			{#if boasVindas}
				<Aviso tom="sucesso">
					Acesso criado, {primeiroNome}. Você já pode ver os encontros e confirmar presença.
				</Aviso>
			{/if}

			<header class="saudacao">
				<p class="hoje">{hoje}</p>
				<h1>Olá, {primeiroNome}</h1>
			</header>

			{#if inicio?.avisoLideranca}
				<Aviso tom="aviso" titulo="Liderança">
					{inicio.avisoLideranca} <a href="/lideranca">Abrir liderança</a>
				</Aviso>
			{/if}

			<InstalarPwa />

			{#if kpisLideranca.length > 0}
				<section class="indicadores" aria-label="Indicadores da equipe">
					{#each kpisLideranca as kpi (kpi.href)}
						<a href={kpi.href} class="indicador">
							<span class="rotulo">{kpi.rotulo}</span>
							<strong class="valor" class:negativo={kpi.negativo}>{kpi.valor}</strong>
							<span class="detalhe">{kpi.detalhe}</span>
						</a>
					{/each}
				</section>
			{/if}

			<div class="painel" class:duas-colunas={temLateral}>
				<div class="coluna">
					{#if inicio?.proximoEvento}
						<section class="destaque" aria-labelledby="titulo-proximo-evento">
							<span class="etiqueta">{inicio.proximoEvento.tipoNome ?? 'Próximo encontro'}</span>
							<h2 id="titulo-proximo-evento">{inicio.proximoEvento.title}</h2>
							<p class="meta">
								{formatadorData.format(new Date(inicio.proximoEvento.startsAt))}
								{#if inicio.proximoEvento.location}
									· {inicio.proximoEvento.location}
								{/if}
							</p>
							<Botao href={`/eventos/${inicio.proximoEvento.id}`} largura="cheia">
								Confirmar presença
							</Botao>
						</section>
					{:else}
						<section class="destaque sem-evento" aria-labelledby="titulo-sem-evento">
							<h2 id="titulo-sem-evento">Nenhum encontro marcado</h2>
							<p class="meta">
								{podeCriarEvento
									? 'Marque o próximo encontro para as pessoas confirmarem presença.'
									: 'Quando o próximo encontro for marcado, ele aparece aqui para você confirmar presença em um toque.'}
							</p>
							{#if podeCriarEvento && !faltaAlgumPasso}
								<Botao href="/eventos/novo">Marcar encontro</Botao>
							{/if}
						</section>
					{/if}

					{#if faltaAlgumPasso}
						<section class="passos" aria-labelledby="titulo-passos">
							<div class="cabecalho-bloco">
								<h2 id="titulo-passos">Primeiros passos</h2>
								<span class="progresso">
									{passos.filter((p) => p.feito).length} de {passos.length}
								</span>
							</div>
							<ol>
								{#each passos as passo (passo.href)}
									<li class:feito={passo.feito} class:atual={passo === proximoPasso}>
										<span class="marcador" aria-hidden="true">
											{#if passo.feito}
												<svg viewBox="0 0 16 16" width="14" height="14">
													<path
														d="M3.5 8.5l3 3 6-7"
														fill="none"
														stroke="currentColor"
														stroke-width="2"
														stroke-linecap="round"
														stroke-linejoin="round"
													/>
												</svg>
											{/if}
										</span>
										<div class="passo-texto">
											{#if passo.feito}
												<strong>{passo.titulo}</strong>
												<span>Feito</span>
											{:else}
												<a href={passo.href}>{passo.titulo}</a>
												<span>{passo.texto}</span>
											{/if}
										</div>
									</li>
								{/each}
							</ol>
						</section>
					{/if}

					{#if dashboard?.perfil === 'membro'}
						<section class="bloco" aria-labelledby="titulo-seu-resumo">
							<div class="cabecalho-bloco">
								<h2 id="titulo-seu-resumo">Seu resumo</h2>
							</div>
							<div class="resumo-membro">
								{#if dashboard.meuSubgrupo}
									<a href={`/grupos/${dashboard.meuSubgrupo.id}`} class="indicador">
										<span class="rotulo">Meu subgrupo</span>
										<strong class="valor">{dashboard.meuSubgrupo.nome}</strong>
										<span class="detalhe">Ver integrantes e encontros</span>
									</a>
								{:else}
									<a href="/grupos" class="indicador">
										<span class="rotulo">Meu subgrupo</span>
										<strong class="valor">Sem subgrupo</strong>
										<span class="detalhe">Ver subgrupos dos Eagles</span>
									</a>
								{/if}

								{#if dashboard.minhaFrequencia90d}
									{@const freq = dashboard.minhaFrequencia90d}
									<a href="/perfil" class="indicador">
										<span class="rotulo">Minha frequência (90d)</span>
										<strong class="valor">
											{freq.taxa !== null ? `${freq.taxa}%` : '—'}
										</strong>
										<span class="detalhe">
											{freq.esperados > 0
												? `${freq.presencas} de ${freq.esperados} ${freq.esperados === 1 ? 'encontro' : 'encontros'}`
												: 'Sem chamadas no período'}
										</span>
									</a>
								{/if}

								{#if dashboard.minhasContribuicoes}
									{@const contrib = dashboard.minhasContribuicoes}
									<a href="/financeiro" class="indicador">
										<span class="rotulo">Minhas contribuições</span>
										<strong class="valor">{formatarCentavos(contrib.totalCents)}</strong>
										<span class="detalhe">
											{contrib.quantidade === 0
												? 'Nenhum registro'
												: contrib.quantidade === 1
													? '1 registro confirmado'
													: `${contrib.quantidade} registros confirmados`}
										</span>
									</a>
								{/if}
							</div>

							{#if podeVerDraft}
								<a href="/draft" class="linha-link">
									<div class="linha-texto">
										<strong>Draft de equipes</strong>
										<span>Consulte os perfis e times salvos</span>
									</div>
									<svg class="seta" viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
										<path
											d="M6 3.5 10.5 8 6 12.5"
											fill="none"
											stroke="currentColor"
											stroke-width="1.6"
											stroke-linecap="round"
											stroke-linejoin="round"
										/>
									</svg>
								</a>
							{/if}
						</section>
					{/if}
				</div>

				<div class="coluna">
					{#if pendenciasLista.length > 0}
						<section class="bloco" aria-labelledby="titulo-pendencias">
							<div class="cabecalho-bloco">
								<h2 id="titulo-pendencias">Pendências</h2>
							</div>
							<ul class="lista-simples">
								{#each pendenciasLista as item (item.href)}
									<li>
										<a href={item.href} class="linha-link">
											<div class="linha-texto">
												<strong>{item.titulo}</strong>
												<span>{item.subtitulo}</span>
											</div>
											<span class="tag tag-proposta">
												{item.total}
												{item.total === 1 ? 'pendente' : 'pendentes'}
											</span>
										</a>
									</li>
								{/each}
							</ul>
						</section>
					{/if}

					{#if inicio?.proximasResponsabilidades && inicio.proximasResponsabilidades.length > 0}
						<section class="bloco" aria-labelledby="titulo-minhas-escalas">
							<div class="cabecalho-bloco">
								<h2 id="titulo-minhas-escalas">Suas responsabilidades</h2>
								<a href="/responsabilidades" class="ver-tudo">Ver todas</a>
							</div>
							<ul class="lista-simples">
								{#each inicio.proximasResponsabilidades as r (r.id)}
									<li>
										<a href={`/eventos/${r.eventId}`} class="linha-link">
											<div class="linha-texto">
												<strong>{r.responsabilidadeNome}</strong>
												<span>
													{r.eventoTitulo} · {formatadorData.format(new Date(r.eventoInicio))}
												</span>
											</div>
											<span class="tag tag-{r.status}">{rotuloStatusEscala(r.status)}</span>
										</a>
									</li>
								{/each}
							</ul>
						</section>
					{/if}

					{#if inicio?.ultimoAviso}
						<section class="bloco" aria-labelledby="titulo-ultimo-aviso">
							<div class="cabecalho-bloco">
								<h2 id="titulo-ultimo-aviso">Último aviso</h2>
								<a href="/comunicacao" class="ver-tudo">Ver todos</a>
							</div>
							<a href="/comunicacao" class="linha-link">
								<div class="linha-texto">
									<strong>{inicio.ultimoAviso.title}</strong>
									<span class="trecho">{inicio.ultimoAviso.body}</span>
								</div>
							</a>
						</section>
					{/if}

					{#if ehPainelLideranca && podeVerDraft}
						<section class="bloco" aria-labelledby="titulo-atalho-draft">
							<div class="cabecalho-bloco">
								<h2 id="titulo-atalho-draft">Organização</h2>
							</div>
							<a href="/draft" class="linha-link">
								<div class="linha-texto">
									<strong>Draft de equipes</strong>
									<span>Monte times equilibrados para provas e atividades</span>
								</div>
								<svg class="seta" viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
									<path
										d="M6 3.5 10.5 8 6 12.5"
										fill="none"
										stroke="currentColor"
										stroke-width="1.6"
										stroke-linecap="round"
										stroke-linejoin="round"
									/>
								</svg>
							</a>
						</section>
					{/if}
				</div>
			</div>
		</div>
	{/if}
</main>

<style>
	.saudacao {
		display: flex;
		flex-direction: column;
		gap: 2px;
		margin-top: var(--esp-2);
	}

	.hoje {
		font-size: var(--texto-sm);
		font-weight: 600;
		color: var(--cor-texto-2);
	}

	h1 {
		font-size: var(--texto-2xl);
		font-weight: 800;
		color: var(--cor-texto);
	}

	/* --- Indicadores (Líder / Conselheiro) e Resumo (Membro) --- */

	.indicadores {
		display: grid;
		grid-template-columns: repeat(2, minmax(0, 1fr));
		gap: var(--esp-2);
	}

	@media (min-width: 720px) {
		.indicadores {
			grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
			gap: var(--esp-3);
		}
	}

	.resumo-membro {
		display: grid;
		grid-template-columns: minmax(0, 1fr);
		gap: var(--esp-2);
	}

	@media (min-width: 560px) {
		.resumo-membro {
			grid-template-columns: repeat(auto-fit, minmax(170px, 1fr));
		}
	}

	.indicador {
		display: flex;
		flex-direction: column;
		gap: 2px;
		min-height: var(--toque-min);
		padding: var(--esp-3) var(--esp-4);
		background: var(--cor-superficie);
		border: 1px solid var(--cor-linha);
		border-radius: var(--raio);
		text-decoration: none;
		color: var(--cor-texto);
		transition:
			background-color var(--transicao),
			border-color var(--transicao),
			transform var(--transicao);
	}

	@media (hover: hover) {
		.indicador:hover {
			background: var(--cor-superficie-2);
			border-color: var(--cor-marca);
		}
	}

	.indicador:active,
	.linha-link:active {
		transform: scale(0.985);
	}

	@media (prefers-reduced-motion: reduce) {
		.indicador:active,
		.linha-link:active {
			transform: none;
		}
	}

	.indicador .rotulo {
		font-size: var(--texto-sm);
		font-weight: 600;
		color: var(--cor-texto-2);
	}

	.indicador .valor {
		font-family: var(--fonte-titulo);
		font-size: var(--texto-xl);
		font-weight: 800;
		line-height: 1.2;
		color: var(--cor-texto);
		font-variant-numeric: tabular-nums;
		overflow-wrap: anywhere;
	}

	.indicador .valor.negativo {
		color: var(--cor-erro);
	}

	.indicador .detalhe {
		font-size: var(--texto-xs);
		color: var(--cor-texto-2);
	}

	.seta {
		flex: none;
		color: var(--cor-texto-2);
	}

	.painel,
	.coluna {
		display: flex;
		flex-direction: column;
		gap: var(--esp-5);
	}

	/* Desktop largo: o encontro e os passos à esquerda, o resto à direita. */
	@media (min-width: 1180px) {
		.painel.duas-colunas {
			display: grid;
			grid-template-columns: minmax(0, 3fr) minmax(0, 2fr);
			align-items: start;
			gap: var(--esp-6);
		}

		h1 {
			font-size: var(--texto-3xl);
		}
	}

	.destaque {
		display: flex;
		flex-direction: column;
		gap: var(--esp-3);
		padding: var(--esp-5);
		background: var(--cor-superficie);
		border: 1px solid var(--cor-linha);
		border-radius: var(--raio-lg);
		box-shadow: var(--sombra-2);
	}

	.sem-evento {
		box-shadow: none;
	}

	.sem-evento :global(.botao) {
		align-self: flex-start;
	}

	.etiqueta {
		align-self: flex-start;
		font-size: var(--texto-xs);
		font-weight: 700;
		padding: 2px 8px;
		border-radius: var(--raio-cheio);
		background: var(--cor-marca-suave);
		color: var(--cor-marca);
	}

	.destaque h2 {
		font-size: var(--texto-xl);
		margin: 0;
	}

	.meta {
		font-size: var(--texto-sm);
		color: var(--cor-texto-2);
		margin: 0;
	}

	/* --- Primeiros passos --- */

	.passos {
		display: flex;
		flex-direction: column;
		gap: var(--esp-3);
	}

	.progresso {
		font-size: var(--texto-sm);
		font-weight: 600;
		color: var(--cor-texto-2);
	}

	.passos ol {
		list-style: none;
		padding: 0;
		display: flex;
		flex-direction: column;
		border: 1px solid var(--cor-linha);
		border-radius: var(--raio-lg);
		background: var(--cor-superficie);
		overflow: hidden;
	}

	.passos li {
		display: flex;
		align-items: flex-start;
		gap: var(--esp-3);
		padding: var(--esp-3) var(--esp-4);
	}

	.passos li + li {
		border-top: 1px solid var(--cor-linha);
	}

	.marcador {
		flex: none;
		display: grid;
		place-items: center;
		width: 22px;
		height: 22px;
		margin-top: 1px;
		border-radius: var(--raio-cheio);
		border: 2px solid var(--cor-linha-forte);
	}

	.feito .marcador {
		border-color: var(--cor-sucesso);
		background: var(--cor-sucesso);
		color: var(--cor-superficie);
	}

	.atual .marcador {
		border-color: var(--cor-marca);
	}

	.passo-texto {
		display: flex;
		flex-direction: column;
		gap: 2px;
		min-width: 0;
	}

	.passo-texto a {
		font-weight: 700;
		color: var(--cor-texto);
		text-decoration: underline;
		text-decoration-color: var(--cor-linha-forte);
		text-underline-offset: 3px;
	}

	.atual .passo-texto a {
		color: var(--cor-marca);
		text-decoration-color: currentColor;
	}

	.passo-texto span {
		font-size: var(--texto-sm);
		color: var(--cor-texto-2);
	}

	.feito strong {
		font-weight: 600;
		color: var(--cor-texto-2);
	}

	/* --- Blocos da direita --- */

	.bloco {
		display: flex;
		flex-direction: column;
		gap: var(--esp-2);
	}

	.cabecalho-bloco {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		gap: var(--esp-2);
	}

	.cabecalho-bloco h2 {
		font-size: var(--texto-lg);
	}

	.ver-tudo {
		font-size: var(--texto-sm);
		font-weight: 600;
		min-height: var(--toque-min);
		display: inline-flex;
		align-items: center;
	}

	.lista-simples {
		list-style: none;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: var(--esp-2);
	}

	.linha-link {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--esp-3);
		min-height: var(--toque-min);
		padding: var(--esp-3) var(--esp-4);
		background: var(--cor-superficie);
		border: 1px solid var(--cor-linha);
		border-radius: var(--raio);
		text-decoration: none;
		color: var(--cor-texto);
		transition:
			background-color var(--transicao),
			border-color var(--transicao),
			transform var(--transicao);
	}

	@media (hover: hover) {
		.linha-link:hover {
			background: var(--cor-superficie-2);
			border-color: var(--cor-marca);
		}
	}

	.linha-texto {
		display: flex;
		flex-direction: column;
		gap: 2px;
		min-width: 0;
	}

	.linha-texto strong {
		font-size: var(--texto-base);
	}

	.linha-texto span {
		font-size: var(--texto-sm);
		color: var(--cor-texto-2);
	}

	/* Três linhas do aviso, sem cortar palavra no meio com reticências manuais. */
	.trecho {
		display: -webkit-box;
		-webkit-line-clamp: 3;
		line-clamp: 3;
		-webkit-box-orient: vertical;
		overflow: hidden;
	}

	.tag {
		flex: none;
		font-size: var(--texto-xs);
		font-weight: 700;
		padding: 2px 8px;
		border-radius: var(--raio-cheio);
	}

	.tag-confirmada,
	.tag-cumprida {
		background: var(--cor-sucesso-suave);
		color: var(--cor-sucesso);
	}

	.tag-proposta {
		background: var(--cor-aviso-suave);
		color: var(--cor-aviso);
	}

	.vazio,
	.carregando {
		display: flex;
		flex-direction: column;
		align-items: center;
		text-align: center;
		gap: var(--esp-3);
		padding: var(--esp-7) var(--esp-4);
	}

	.vazio p,
	.carregando p {
		color: var(--cor-texto-2);
		font-size: var(--texto-sm);
		max-width: 36ch;
		margin: 0;
	}
</style>

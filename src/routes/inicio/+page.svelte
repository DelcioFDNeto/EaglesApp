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
		return [
			{
				feito: p.pg,
				titulo: 'Criar o primeiro PG',
				texto: 'Os PGs organizam as pessoas e os encontros.',
				href: '/grupos'
			},
			{
				feito: p.tipoEvento,
				titulo: 'Cadastrar os tipos de evento',
				texto: 'Ex.: PG, Encontro dos Eagles, Outside.',
				href: '/eventos/tipos'
			},
			{
				feito: p.pessoas,
				titulo: 'Cadastrar pessoas e enviar convites',
				texto: 'O convite vai pelo WhatsApp; a pessoa só define a senha.',
				href: '/pessoas'
			},
			{
				feito: p.evento,
				titulo: 'Marcar o primeiro encontro',
				texto: 'Depois disso, cada um confirma presença em um toque.',
				href: '/eventos/novo'
			}
		].filter((x): x is typeof x & { feito: boolean } => x.feito !== null);
	});
	const faltaAlgumPasso = $derived(passos.some((p) => !p.feito));
	// Sem nada para a coluna da direita, o painel fica numa coluna só, centrada.
	const temLateral = $derived(
		(inicio?.proximasResponsabilidades?.length ?? 0) > 0 || Boolean(inicio?.ultimoAviso)
	);
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

<main class="conteudo" class:largo={temLateral}>
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
				</div>

				<div class="coluna">
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
		padding: var(--esp-3) var(--esp-4);
		background: var(--cor-superficie);
		border: 1px solid var(--cor-linha);
		border-radius: var(--raio);
		text-decoration: none;
		color: var(--cor-texto);
		transition:
			background-color var(--transicao),
			border-color var(--transicao);
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

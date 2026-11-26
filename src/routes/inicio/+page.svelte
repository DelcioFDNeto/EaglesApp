<script lang="ts">
	import { page } from '$app/state';
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import Marca from '$ui/Marca.svelte';
	import Aviso from '$ui/Aviso.svelte';
	import Botao from '$ui/Botao.svelte';
	import InstalarPwa from '$ui/InstalarPwa.svelte';
	import { api, apiCache, type Inicio } from '$lib/api';

	const boasVindas = $derived(page.url.searchParams.get('boas-vindas') === '1');
	let inicio = $state<Inicio | null>(null);
	let primeiroNome = $derived(inicio?.nome?.split(' ')[0] ?? '');
	let carregando = $state(true);
	let saindo = $state(false);
	let erro = $state<string | undefined>(undefined);

	const podeVerFinanceiro = $derived(
		(inicio?.permissoes ?? []).some(
			(p) => p === 'finance.view_all' || p === 'finance.view_group' || p === 'finance.view_own'
		)
	);

	const podeVerAdmin = $derived(
		(inicio?.permissoes ?? []).some(
			(p) => p === 'settings.manage' || p === 'rbac.manage' || p === 'audit.view'
		)
	);

	const podeVerLideranca = $derived((inicio?.permissoes ?? []).includes('rbac.manage'));

	const podeGerenciarPessoas = $derived(
		(inicio?.permissoes ?? []).some((p) => p === 'person.create' || p === 'person.invite')
	);

	const podeVerAssistente = $derived(
		(inicio?.permissoes ?? []).some(
			(p) => p === 'ai.use_basic' || p === 'ai.use_analytics' || p === 'ai.use_finance'
		)
	);

	const formatadorData = new Intl.DateTimeFormat('pt-BR', {
		weekday: 'short',
		day: '2-digit',
		month: 'short',
		hour: '2-digit',
		minute: '2-digit'
	});

	async function carregarInicio() {
		carregando = true;
		erro = undefined;
		try {
			inicio = await apiCache.inicio();
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

	async function sair() {
		saindo = true;
		try {
			await api.post('/api/auth/logout');
		} catch {
			// Mesmo sem conexão, encerramos a sessão local.
		} finally {
			localStorage.removeItem('eagles_token');
			saindo = false;
			await goto('/entrar');
		}
	}

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

<header>
	<div class="barra">
		<Marca tamanho={28} comNome />
		<Botao variante="texto" onclick={sair} carregando={saindo}>Sair</Botao>
	</div>
</header>

{#if carregando}
	<main class="conteudo">
		<div class="pilha">
			<div class="carregando">
				<Marca tamanho={44} />
				<p>Carregando…</p>
			</div>
		</div>
	</main>
{:else if erro}
	<main class="conteudo">
		<div class="pilha">
			<div class="vazio">
				<Marca tamanho={44} />
				<h2>Não foi possível carregar</h2>
				<p>{erro}</p>
				<Botao onclick={carregarInicio} largura="cheia">Tentar novamente</Botao>
			</div>
		</div>
	</main>
{:else}
	<main class="conteudo">
		<div class="pilha">
			{#if boasVindas}
				<Aviso tom="sucesso">
					Acesso criado, {primeiroNome}. Você já pode ver os encontros e confirmar presença.
				</Aviso>
			{/if}

			<h1>Olá, {primeiroNome}</h1>

			{#if inicio?.avisoLideranca}
				<Aviso tom="aviso" titulo="Liderança">
					{inicio.avisoLideranca} <a href="/lideranca">Abrir liderança</a>
				</Aviso>
			{/if}

			<InstalarPwa />

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
						Ver encontro e confirmar presença
					</Botao>
				</section>
			{:else}
				<section class="vazio">
					<Marca tamanho={44} />
					<h2>Ainda não há encontros agendados</h2>
					<p>
						Quando o próximo encontro dos Eagles estiver marcado, ele aparece aqui para você
						confirmar presença em um toque.
					</p>
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
							<span
								>{inicio.ultimoAviso.body.slice(0, 120)}{inicio.ultimoAviso.body.length > 120
									? '…'
									: ''}</span
							>
						</div>
					</a>
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

			<nav class="atalhos" aria-label="Navegação principal">
				<a href="/eventos" class="atalho">
					<svg viewBox="0 0 16 16" width="18" height="18" aria-hidden="true">
						<rect
							x="2"
							y="3"
							width="12"
							height="11"
							rx="1.5"
							fill="none"
							stroke="currentColor"
							stroke-width="1.4"
						/>
						<path
							d="M5 1.5v3M11 1.5v3M2 6.5h12"
							fill="none"
							stroke="currentColor"
							stroke-width="1.4"
							stroke-linecap="round"
						/>
					</svg>
					<span>Eventos</span>
				</a>
				<a href="/responsabilidades" class="atalho">
					<svg viewBox="0 0 16 16" width="18" height="18" aria-hidden="true">
						<path
							d="M3 4.5h10M3 8h10M3 11.5h6"
							fill="none"
							stroke="currentColor"
							stroke-width="1.4"
							stroke-linecap="round"
						/>
						<path
							d="M11 11.5l1.2 1.2L14.5 10"
							fill="none"
							stroke="currentColor"
							stroke-width="1.4"
							stroke-linecap="round"
							stroke-linejoin="round"
						/>
					</svg>
					<span>Responsabilidades e escalas</span>
				</a>
				<a href="/comunicacao" class="atalho">
					<svg viewBox="0 0 16 16" width="18" height="18" aria-hidden="true">
						<path
							d="M2.5 3.5h11a1 1 0 0 1 1 1v6.5a1 1 0 0 1-1 1H6.2L3 14.2V12h-.5a1 1 0 0 1-1-1V4.5a1 1 0 0 1 1-1z"
							fill="none"
							stroke="currentColor"
							stroke-width="1.4"
							stroke-linejoin="round"
						/>
					</svg>
					<span>Comunicação e avisos</span>
				</a>
				{#if podeVerFinanceiro}
					<a href="/financeiro" class="atalho">
						<svg viewBox="0 0 16 16" width="18" height="18" aria-hidden="true">
							<rect
								x="2"
								y="3.5"
								width="12"
								height="9"
								rx="1.4"
								fill="none"
								stroke="currentColor"
								stroke-width="1.4"
							/>
							<circle cx="8" cy="8" r="1.8" fill="none" stroke="currentColor" stroke-width="1.4" />
						</svg>
						<span>Financeiro</span>
					</a>
				{/if}
				{#if podeVerAdmin}
					<a href="/admin" class="atalho">
						<svg viewBox="0 0 16 16" width="18" height="18" aria-hidden="true">
							<circle cx="8" cy="8" r="2.2" fill="none" stroke="currentColor" stroke-width="1.4" />
							<path
								d="M8 2v1.6M8 12.4V14M2 8h1.6M12.4 8H14M3.8 3.8l1.1 1.1M11.1 11.1l1.1 1.1M12.2 3.8l-1.1 1.1M4.9 11.1l-1.1 1.1"
								fill="none"
								stroke="currentColor"
								stroke-width="1.4"
								stroke-linecap="round"
							/>
						</svg>
						<span>Administração</span>
					</a>
				{/if}
				{#if podeVerAssistente}
					<a href="/assistente" class="atalho">
						<svg viewBox="0 0 16 16" width="18" height="18" aria-hidden="true">
							<rect
								x="2.5"
								y="2.5"
								width="11"
								height="11"
								rx="2"
								fill="none"
								stroke="currentColor"
								stroke-width="1.4"
							/>
							<path
								d="M5.5 6h5M5.5 8.5h5M5.5 11h3"
								fill="none"
								stroke="currentColor"
								stroke-width="1.4"
								stroke-linecap="round"
							/>
						</svg>
						<span>Assistente de IA</span>
					</a>
				{/if}
				{#if podeVerLideranca}
					<a href="/lideranca" class="atalho">
						<svg viewBox="0 0 16 16" width="18" height="18" aria-hidden="true">
							<path
								d="M2.5 12.5h11M3.5 12.5 2.5 5l3.2 2.6L8 3.5l2.3 4.1L13.5 5l-1 7.5"
								fill="none"
								stroke="currentColor"
								stroke-width="1.4"
								stroke-linejoin="round"
								stroke-linecap="round"
							/>
						</svg>
						<span>Liderança</span>
					</a>
				{/if}
				{#if podeGerenciarPessoas}
					<a href="/pessoas" class="atalho">
						<svg viewBox="0 0 16 16" width="18" height="18" aria-hidden="true">
							<circle
								cx="6"
								cy="5.2"
								r="2.4"
								fill="none"
								stroke="currentColor"
								stroke-width="1.4"
							/>
							<path
								d="M1.8 13.5c.6-2.4 2.2-3.6 4.2-3.6 1.3 0 2.4.5 3.2 1.5"
								fill="none"
								stroke="currentColor"
								stroke-width="1.4"
								stroke-linecap="round"
							/>
							<path
								d="M12.5 8.5v5M10 11h5"
								fill="none"
								stroke="currentColor"
								stroke-width="1.4"
								stroke-linecap="round"
							/>
						</svg>
						<span>Pessoas e convites</span>
					</a>
				{/if}
				<a href="/grupos" class="atalho">
					<svg viewBox="0 0 16 16" width="18" height="18" aria-hidden="true">
						<circle
							cx="5.5"
							cy="5.5"
							r="2.2"
							fill="none"
							stroke="currentColor"
							stroke-width="1.4"
						/>
						<circle cx="11" cy="6" r="1.8" fill="none" stroke="currentColor" stroke-width="1.4" />
						<path
							d="M1.8 13c.4-2.2 1.9-3.3 3.7-3.3S8.8 10.8 9.2 13M9.8 13c.2-1.5 1.1-2.4 2.3-2.4 1 0 1.8.6 2.1 2.4"
							fill="none"
							stroke="currentColor"
							stroke-width="1.4"
							stroke-linecap="round"
						/>
					</svg>
					<span>Grupos (PGs)</span>
				</a>
				<a href="/perfil" class="atalho">
					<svg viewBox="0 0 16 16" width="18" height="18" aria-hidden="true">
						<circle cx="8" cy="5.2" r="2.6" fill="none" stroke="currentColor" stroke-width="1.4" />
						<path
							d="M3 13.5c.7-2.6 2.6-3.8 5-3.8s4.3 1.2 5 3.8"
							fill="none"
							stroke="currentColor"
							stroke-width="1.4"
							stroke-linecap="round"
						/>
					</svg>
					<span>Meu perfil</span>
				</a>
				<a href="/conta/sessoes" class="atalho">
					<svg viewBox="0 0 16 16" width="18" height="18" aria-hidden="true">
						<rect
							x="2"
							y="2.5"
							width="8"
							height="11"
							rx="1.4"
							fill="none"
							stroke="currentColor"
							stroke-width="1.4"
						/>
						<path
							d="M12 5.5h1.5a1 1 0 0 1 1 1v6a1 1 0 0 1-1 1H10"
							fill="none"
							stroke="currentColor"
							stroke-width="1.4"
							stroke-linecap="round"
						/>
					</svg>
					<span>Dispositivos conectados</span>
				</a>
			</nav>
		</div>
	</main>
{/if}

<style>
	header {
		border-bottom: 1px solid var(--cor-linha);
		background: var(--cor-superficie);
		position: sticky;
		top: 0;
		z-index: 10;
	}

	.barra {
		max-width: 560px;
		margin-inline: auto;
		padding: var(--esp-2) var(--esp-3);
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--esp-3);
	}

	h1 {
		font-size: var(--texto-2xl);
		font-weight: 800;
		margin-top: var(--esp-2);
		color: var(--cor-texto);
	}

	.destaque {
		display: flex;
		flex-direction: column;
		gap: var(--esp-3);
		padding: var(--esp-4);
		background: var(--cor-superficie);
		border: 1px solid var(--cor-linha);
		border-radius: var(--raio-lg);
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
		font-size: var(--texto-xs);
		color: var(--cor-texto-2);
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
		padding: var(--esp-6) var(--esp-4);
	}

	.vazio p,
	.carregando p {
		color: var(--cor-texto-2);
		font-size: var(--texto-sm);
		max-width: 36ch;
		margin: 0;
	}

	.atalhos {
		display: flex;
		flex-direction: column;
		gap: var(--esp-1);
		padding-top: var(--esp-2);
		border-top: 1px solid var(--cor-linha);
	}

	.atalho {
		min-height: var(--toque-min);
		display: flex;
		align-items: center;
		gap: var(--esp-3);
		font-size: var(--texto-base);
		font-weight: 600;
		color: var(--cor-texto);
		text-decoration: none;
		border-radius: var(--raio);
		padding: var(--esp-2) var(--esp-3);
		transition:
			background-color var(--transicao),
			color var(--transicao);
	}

	.atalho svg {
		flex: none;
		color: var(--cor-marca);
	}

	@media (hover: hover) {
		.atalho:hover,
		.linha-link:hover {
			background: var(--cor-superficie-2);
			border-color: var(--cor-marca);
		}
	}
</style>

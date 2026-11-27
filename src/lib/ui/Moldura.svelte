<script lang="ts">
	import type { Snippet } from 'svelte';
	import { onMount } from 'svelte';
	import { page } from '$app/state';
	import Marca from './Marca.svelte';
	import Icone from './Icone.svelte';
	import {
		TITULO_SECAO,
		estaAtivo,
		itensBarraInferior,
		itensNavegacao,
		type Secao
	} from '$lib/navegacao';
	import { sessao } from '$lib/sessao.svelte';

	let { children }: { children: Snippet } = $props();

	let saindo = $state(false);

	onMount(() => {
		sessao.carregar();
	});

	const itens = $derived(itensNavegacao(sessao.dados?.permissoes ?? []));
	const naBarra = $derived(itensBarraInferior(itens));
	const caminho = $derived(page.url.pathname);
	// "Mais" fica aceso na própria tela e em qualquer seção que não está na barra.
	const maisAtivo = $derived(
		caminho === '/menu' ||
			(!naBarra.some((i) => estaAtivo(caminho, i.href)) &&
				itens.some((i) => estaAtivo(caminho, i.href)))
	);

	const SECOES_LATERAL: Secao[] = ['dia_a_dia', 'cuidar', 'administrar'];
	const conta = $derived(itens.filter((i) => i.secao === 'conta'));
	const naoLidas = $derived(sessao.notificacoesNaoLidas);
	const rotuloSino = $derived(
		naoLidas > 0
			? `Notificações (${naoLidas} não ${naoLidas === 1 ? 'lida' : 'lidas'})`
			: 'Notificações'
	);

	const iniciais = $derived(
		(sessao.dados?.nome ?? '')
			.split(/\s+/)
			.filter(Boolean)
			.slice(0, 2)
			.map((p) => p[0]!.toUpperCase())
			.join('')
	);

	async function sair() {
		saindo = true;
		await sessao.sair();
		saindo = false;
	}
</script>

<a class="pular" href="#conteudo">Pular para o conteúdo</a>

<div class="moldura">
	<!-- Desktop: menu lateral fixo -->
	<aside class="lateral">
		<div class="topo-lateral">
			<a href="/inicio" class="marca-link" aria-label="Eagles, início">
				<Marca tamanho={34} comNome />
			</a>
			<a
				href="/notificacoes"
				class="botao-sino"
				aria-current={estaAtivo(caminho, '/notificacoes') ? 'page' : undefined}
				aria-label={rotuloSino}
				title="Notificações"
			>
				<Icone nome="sino" tamanho={20} />
				{#if naoLidas > 0}
					<span class="badge-sino" aria-hidden="true">{naoLidas > 99 ? '99+' : naoLidas}</span>
				{/if}
			</a>
		</div>

		<nav aria-label="Menu principal">
			{#each SECOES_LATERAL as secao (secao)}
				{@const doGrupo = itens.filter((i) => i.secao === secao)}
				{#if doGrupo.length > 0}
					<div class="grupo-menu">
						{#if TITULO_SECAO[secao]}<p class="titulo-secao">{TITULO_SECAO[secao]}</p>{/if}
						<ul>
							{#each doGrupo as item (item.href)}
								<li>
									<a
										href={item.href}
										class="item"
										aria-current={estaAtivo(caminho, item.href) ? 'page' : undefined}
									>
										<Icone nome={item.icone} />
										<span>{item.rotulo}</span>
									</a>
								</li>
							{/each}
						</ul>
					</div>
				{/if}
			{/each}
		</nav>

		<div class="rodape-lateral">
			{#if sessao.dados}
				<a
					href="/perfil"
					class="quem"
					aria-current={estaAtivo(caminho, '/perfil') ? 'page' : undefined}
				>
					<span class="avatar" aria-hidden="true">{iniciais}</span>
					<span class="quem-texto">
						<strong>{sessao.dados.nome}</strong>
						<span>Meu perfil</span>
					</span>
				</a>
			{/if}
			<ul>
				{#each conta.filter((i) => i.href !== '/perfil') as item (item.href)}
					<li>
						<a
							href={item.href}
							class="item item-pequeno"
							aria-current={estaAtivo(caminho, item.href) ? 'page' : undefined}
						>
							<Icone nome={item.icone} tamanho={18} />
							<span>{item.rotulo}</span>
						</a>
					</li>
				{/each}
				<li>
					<button type="button" class="item item-pequeno" onclick={sair} disabled={saindo}>
						<Icone nome="sair" tamanho={18} />
						<span>{saindo ? 'Saindo…' : 'Sair'}</span>
					</button>
				</li>
			</ul>
		</div>
	</aside>

	<!-- Celular: faixa de marca no topo -->
	<header class="topo-movel">
		<a href="/inicio" class="marca-link" aria-label="Eagles, início">
			<Marca tamanho={30} comNome />
		</a>
		<div class="acoes-topo">
			<a
				href="/notificacoes"
				class="botao-sino"
				aria-current={estaAtivo(caminho, '/notificacoes') ? 'page' : undefined}
				aria-label={rotuloSino}
				title="Notificações"
			>
				<Icone nome="sino" tamanho={20} />
				{#if naoLidas > 0}
					<span class="badge-sino" aria-hidden="true">{naoLidas > 99 ? '99+' : naoLidas}</span>
				{/if}
			</a>
			{#if sessao.dados}
				<a href="/perfil" class="avatar" aria-label="Meu perfil">{iniciais}</a>
			{/if}
		</div>
	</header>

	<div class="area" id="conteudo" tabindex="-1">
		{@render children()}
	</div>

	<!-- Celular: barra inferior -->
	<nav class="barra-inferior" aria-label="Atalhos">
		{#each naBarra as item (item.href)}
			<a
				href={item.href}
				class="aba"
				aria-current={estaAtivo(caminho, item.href) ? 'page' : undefined}
			>
				<span class="aba-icone"><Icone nome={item.icone} tamanho={22} /></span>
				<span class="aba-rotulo">{item.rotuloCurto}</span>
			</a>
		{/each}
		<a href="/menu" class="aba" aria-current={maisAtivo ? 'page' : undefined}>
			<span class="aba-icone"><Icone nome="mais" tamanho={22} /></span>
			<span class="aba-rotulo">Mais</span>
		</a>
	</nav>
</div>

<style>
	.moldura {
		--largura-lateral: 256px;
		--altura-barra: 64px;
		min-height: 100dvh;
	}

	/* Atalho de teclado: aparece só ao receber foco. */
	.pular {
		position: absolute;
		left: var(--esp-3);
		top: -100px;
		z-index: 50;
		padding: var(--esp-2) var(--esp-3);
		background: var(--cor-superficie);
		border: 2px solid var(--cor-foco);
		border-radius: var(--raio);
		font-weight: 600;
	}

	.pular:focus {
		top: var(--esp-3);
	}

	.area:focus {
		outline: none;
	}

	.marca-link {
		display: inline-flex;
		text-decoration: none;
		border-radius: var(--raio);
	}

	.avatar {
		display: inline-grid;
		place-items: center;
		flex: none;
		width: 36px;
		height: 36px;
		border-radius: var(--raio-cheio);
		background: var(--cor-marca-suave);
		color: var(--cor-marca);
		font-family: var(--fonte-titulo);
		font-size: var(--texto-sm);
		font-weight: 800;
		text-decoration: none;
	}

	.acoes-topo {
		display: flex;
		align-items: center;
		gap: var(--esp-2);
	}

	.botao-sino {
		position: relative;
		display: inline-grid;
		place-items: center;
		flex: none;
		min-width: var(--toque-min);
		min-height: var(--toque-min);
		border-radius: var(--raio);
		color: var(--cor-texto-2);
		text-decoration: none;
		transition:
			background-color var(--transicao),
			color var(--transicao),
			transform 90ms cubic-bezier(0.2, 0, 0.2, 1);
	}

	.botao-sino[aria-current='page'] {
		background: var(--cor-marca-suave);
		color: var(--cor-marca);
	}

	.botao-sino:active {
		transform: scale(0.95);
	}

	@media (hover: hover) {
		.botao-sino:hover {
			background: var(--cor-superficie-2);
			color: var(--cor-texto);
		}
	}

	.badge-sino {
		position: absolute;
		top: 4px;
		right: 4px;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		min-width: 18px;
		height: 18px;
		padding: 0 5px;
		border-radius: var(--raio-cheio);
		background: var(--cor-marca);
		color: var(--cor-sobre-marca);
		border: 2px solid var(--cor-superficie);
		font-size: 0.6875rem;
		font-weight: 700;
		line-height: 1;
	}

	/* ---------------- Celular (padrão) ---------------- */

	.lateral {
		display: none;
	}

	.topo-movel {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--esp-3);
		padding: var(--esp-2) var(--esp-4);
		min-height: 56px;
		border-bottom: 1px solid var(--cor-linha);
		background: var(--cor-superficie);
	}

	.topo-movel .avatar {
		width: var(--toque-min);
		height: var(--toque-min);
	}

	.area {
		/* O conteúdo não fica escondido atrás da barra inferior. */
		padding-bottom: calc(var(--altura-barra) + env(safe-area-inset-bottom) + var(--esp-4));
	}

	.barra-inferior {
		position: fixed;
		inset: auto 0 0 0;
		z-index: 20;
		display: flex;
		height: calc(var(--altura-barra) + env(safe-area-inset-bottom));
		padding: 0 var(--esp-1) env(safe-area-inset-bottom);
		background: var(--cor-superficie);
		border-top: 1px solid var(--cor-linha);
	}

	.aba {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 2px;
		color: var(--cor-texto-2);
		text-decoration: none;
		-webkit-tap-highlight-color: transparent;
	}

	.aba-icone {
		display: grid;
		place-items: center;
		width: 56px;
		height: 30px;
		border-radius: var(--raio-cheio);
		transition: background-color var(--transicao);
	}

	.aba-rotulo {
		font-size: var(--texto-xs);
		font-weight: 600;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
		max-width: 100%;
	}

	.aba[aria-current='page'] {
		color: var(--cor-marca);
	}

	.aba[aria-current='page'] .aba-icone {
		background: var(--cor-marca-suave);
	}

	.aba:active .aba-icone {
		transform: scale(0.94);
	}

	/* ---------------- Desktop ---------------- */

	@media (min-width: 960px) {
		.moldura {
			display: grid;
			grid-template-columns: var(--largura-lateral) minmax(0, 1fr);
			--altura-barra: 0px;
		}

		.topo-movel,
		.barra-inferior {
			display: none;
		}

		.area {
			padding-bottom: var(--esp-7);
		}

		.lateral {
			position: sticky;
			top: 0;
			height: 100dvh;
			display: flex;
			flex-direction: column;
			gap: var(--esp-5);
			padding: var(--esp-5) var(--esp-3) var(--esp-4);
			background: var(--cor-superficie);
			border-right: 1px solid var(--cor-linha);
			overflow-y: auto;
		}

		.topo-lateral {
			display: flex;
			align-items: center;
			justify-content: space-between;
			gap: var(--esp-2);
			padding: 0 var(--esp-1) 0 var(--esp-2);
		}

		.lateral nav {
			display: flex;
			flex-direction: column;
			gap: var(--esp-4);
		}

		.lateral ul {
			list-style: none;
			padding: 0;
			display: flex;
			flex-direction: column;
			gap: 2px;
		}

		.titulo-secao {
			padding: 0 var(--esp-3) var(--esp-1);
			font-size: var(--texto-xs);
			font-weight: 700;
			letter-spacing: 0.04em;
			text-transform: uppercase;
			color: var(--cor-texto-3);
		}

		.item {
			width: 100%;
			display: flex;
			align-items: center;
			gap: var(--esp-3);
			min-height: 42px;
			padding: 0 var(--esp-3);
			border: 0;
			border-radius: var(--raio);
			background: none;
			color: var(--cor-texto-2);
			font: inherit;
			font-weight: 600;
			text-align: left;
			text-decoration: none;
			cursor: pointer;
			transition:
				background-color var(--transicao),
				color var(--transicao);
		}

		.item-pequeno {
			min-height: 38px;
			font-size: var(--texto-sm);
		}

		@media (hover: hover) {
			.item:hover {
				background: var(--cor-superficie-2);
				color: var(--cor-texto);
			}
		}

		.item[aria-current='page'] {
			background: var(--cor-marca-suave);
			color: var(--cor-marca);
		}

		.item:disabled {
			opacity: 0.6;
			cursor: progress;
		}

		.rodape-lateral {
			margin-top: auto;
			display: flex;
			flex-direction: column;
			gap: var(--esp-2);
			padding-top: var(--esp-4);
			border-top: 1px solid var(--cor-linha);
		}

		.quem {
			display: flex;
			align-items: center;
			gap: var(--esp-3);
			padding: var(--esp-2) var(--esp-3);
			border-radius: var(--raio);
			color: var(--cor-texto);
			text-decoration: none;
		}

		@media (hover: hover) {
			.quem:hover {
				background: var(--cor-superficie-2);
			}
		}

		.quem[aria-current='page'] {
			background: var(--cor-marca-suave);
		}

		.quem-texto {
			display: flex;
			flex-direction: column;
			min-width: 0;
			line-height: 1.3;
		}

		.quem-texto strong {
			font-size: var(--texto-sm);
			white-space: nowrap;
			overflow: hidden;
			text-overflow: ellipsis;
		}

		.quem-texto span {
			font-size: var(--texto-xs);
			color: var(--cor-texto-2);
		}

		/* O conteúdo ganha largura de leitura confortável no desktop. */
		.area :global(.conteudo) {
			max-width: 760px;
			padding: var(--esp-7) var(--esp-6) 0;
		}

		.area :global(.conteudo.largo) {
			max-width: 1080px;
		}
	}
</style>

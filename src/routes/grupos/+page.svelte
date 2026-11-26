<script lang="ts">
	import { onMount } from 'svelte';
	import Botao from '$ui/Botao.svelte';
	import Campo from '$ui/Campo.svelte';
	import Aviso from '$ui/Aviso.svelte';
	import Marca from '$ui/Marca.svelte';
	import { api } from '$lib/api';

	let grupos: any[] = $state([]);
	let podeGerenciar = $state(false);
	let carregando = $state(true);
	let erro = $state<string | undefined>(undefined);
	let mensagem = $state<string | undefined>(undefined);
	let criando = $state(false);
	let novoNome = $state('');
	let novoSlug = $state('');
	let novaDescricao = $state('');

	onMount(() => {
		carregarGrupos();
	});

	async function carregarGrupos() {
		carregando = true;
		erro = undefined;
		try {
			const res = await api.get('/api/grupos');
			if (res.ok) {
				const data = await res.json();
				grupos = data.grupos ?? [];
				podeGerenciar = Boolean(data.podeGerenciar);
			} else {
				const data = await res.json().catch(() => ({}));
				erro = data.erro ?? 'Não foi possível carregar os grupos.';
			}
		} catch (e: any) {
			erro =
				e.message === 'sem_conexao'
					? 'Você está offline. Os grupos podem estar desatualizados.'
					: 'Erro ao carregar grupos.';
		} finally {
			carregando = false;
		}
	}

	async function criarGrupo() {
		if (!novoNome.trim() || !novoSlug.trim()) return;
		criando = true;
		erro = undefined;
		mensagem = undefined;

		try {
			const res = await api.post('/api/grupos', {
				name: novoNome.trim(),
				slug: novoSlug.trim().toLowerCase(),
				description: novaDescricao.trim() || undefined
			});
			const data = await res.json().catch(() => ({}));
			if (res.ok) {
				mensagem = 'Grupo criado com sucesso.';
				novoNome = '';
				novoSlug = '';
				novaDescricao = '';
				await carregarGrupos();
			} else {
				erro = data.erro ?? 'Não foi possível criar o grupo.';
			}
		} catch (e: any) {
			erro =
				e.message === 'sem_conexao'
					? 'Você está offline. Tente novamente quando houver conexão.'
					: 'Erro ao criar grupo.';
		} finally {
			criando = false;
		}
	}
</script>

<svelte:head>
	<title>Grupos · Eagles</title>
</svelte:head>

<main class="conteudo">
	<div class="pilha">
		<a href="/inicio" class="voltar">← Início</a>

		<header>
			<h1>Grupos (PGs)</h1>
			<p class="sub">
				Cada membro participa de um PG por vez. Toque em um grupo para ver os integrantes.
			</p>
		</header>

		{#if erro}
			<Aviso tom="erro">{erro}</Aviso>
		{/if}
		{#if mensagem}
			<Aviso tom="sucesso">{mensagem}</Aviso>
		{/if}

		{#if carregando}
			<div class="carregando">
				<Marca tamanho={44} />
				<p>Carregando grupos…</p>
			</div>
		{:else}
			{#if grupos.length === 0}
				<div class="vazio">
					<Marca tamanho={44} />
					<h2>Ainda não há grupos</h2>
					<p>Nenhum PG foi cadastrado ainda. A liderança pode criar o primeiro abaixo.</p>
				</div>
			{:else}
				<ul class="lista-grupos">
					{#each grupos as g (g.id)}
						<li>
							<a class="grupo-item" href={`/grupos/${g.id}`}>
								<div class="grupo-info">
									<div class="topo-grupo">
										<strong>{g.name}</strong>
										{#if g.slug}<span class="slug">#{g.slug}</span>{/if}
									</div>
									{#if g.description}
										<p class="descricao">{g.description}</p>
									{/if}
									<p class="contagem">
										{g.membroCount} {g.membroCount === 1 ? 'membro' : 'membros'}
									</p>
								</div>
								<span class="seta" aria-hidden="true">›</span>
							</a>
						</li>
					{/each}
				</ul>
			{/if}

			{#if podeGerenciar}
				<section class="criar-grupo">
					<h2>Criar novo grupo</h2>
					<form
						onsubmit={(e) => {
							e.preventDefault();
							criarGrupo();
						}}
					>
						<Campo id="nome" rotulo="Nome do grupo" bind:valor={novoNome} obrigatorio />
						<Campo
							id="slug"
							rotulo="Identificador (slug)"
							ajuda="Use apenas letras minúsculas, números e hífen (ex.: pg-azul)."
							bind:valor={novoSlug}
							obrigatorio
						/>
						<Campo id="descricao" rotulo="Descrição" bind:valor={novaDescricao} />
						<Botao tipo="submit" largura="cheia" carregando={criando}>
							Criar grupo
						</Botao>
					</form>
				</section>
			{/if}
		{/if}
	</div>
</main>

<style>
	.voltar {
		font-size: var(--texto-sm);
		font-weight: 600;
		min-height: var(--toque-min);
		display: inline-flex;
		align-items: center;
		align-self: flex-start;
	}

	header {
		display: flex;
		flex-direction: column;
		gap: var(--esp-1);
	}

	.sub {
		color: var(--cor-texto-2);
		font-size: var(--texto-sm);
		margin: 0;
	}

	form {
		display: flex;
		flex-direction: column;
		gap: var(--esp-3);
	}

	.lista-grupos {
		list-style: none;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: var(--esp-2);
	}

	.grupo-item {
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
		transition: border-color var(--transicao), background-color var(--transicao);
	}

	@media (hover: hover) {
		.grupo-item:hover {
			border-color: var(--cor-marca);
			background: var(--cor-superficie-2);
		}
	}

	.grupo-info {
		flex: 1;
		display: flex;
		flex-direction: column;
		gap: var(--esp-1);
		min-width: 0;
	}

	.topo-grupo {
		display: flex;
		align-items: center;
		flex-wrap: wrap;
		gap: var(--esp-2);
	}

	.topo-grupo strong {
		font-size: var(--texto-base);
		font-weight: 700;
	}

	.slug {
		font-size: var(--texto-xs);
		font-weight: 600;
		color: var(--cor-marca);
		background: var(--cor-marca-suave);
		padding: 1px 6px;
		border-radius: var(--raio-cheio);
	}

	.descricao {
		font-size: var(--texto-sm);
		color: var(--cor-texto-2);
		margin: 0;
	}

	.contagem {
		font-size: var(--texto-xs);
		color: var(--cor-texto-3);
		font-weight: 600;
	}

	.seta {
		font-size: var(--texto-lg);
		color: var(--cor-texto-3);
	}

	.criar-grupo {
		margin-top: var(--esp-3);
		padding-top: var(--esp-4);
		border-top: 1px solid var(--cor-linha);
		display: flex;
		flex-direction: column;
		gap: var(--esp-3);
	}

	.criar-grupo h2 {
		font-size: var(--texto-lg);
	}

	.carregando,
	.vazio {
		display: flex;
		flex-direction: column;
		align-items: center;
		text-align: center;
		gap: var(--esp-3);
		padding: var(--esp-6) var(--esp-4);
	}

	.carregando p,
	.vazio p {
		color: var(--cor-texto-2);
		font-size: var(--texto-sm);
		max-width: 36ch;
	}
</style>

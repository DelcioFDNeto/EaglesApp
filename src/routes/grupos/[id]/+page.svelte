<script lang="ts">
	import { page } from '$app/state';
	import { onMount } from 'svelte';
	import Aviso from '$ui/Aviso.svelte';
	import Marca from '$ui/Marca.svelte';
	import { api } from '$lib/api';

	let grupo = $state<any>(null);
	let membros: any[] = $state([]);
	let carregando = $state(true);
	let erro = $state<string | undefined>(undefined);

	const STATUS_ROTULO: Record<string, string> = {
		visitante: 'Visitante',
		recorrente: 'Recorrente',
		membro: 'Membro',
		conselheiro: 'Conselheiro',
		lider: 'Líder'
	};

	onMount(async () => {
		const grupoId = page.params.id ?? '';
		carregando = true;
		erro = undefined;
		try {
			const res = await api.get(`/api/grupos/${grupoId}`);
			if (res.ok) {
				const data = await res.json();
				grupo = data.grupo;
				membros = data.membros ?? [];
			} else {
				const data = await res.json().catch(() => ({}));
				erro = data.erro ?? 'Não foi possível carregar o grupo.';
			}
		} catch (e: any) {
			erro =
				e.message === 'sem_conexao'
					? 'Você está offline. Os dados do grupo podem estar desatualizados.'
					: 'Erro ao carregar o grupo.';
		} finally {
			carregando = false;
		}
	});

	function rotuloStatus(s: string | null | undefined) {
		return STATUS_ROTULO[s ?? 'visitante'] ?? s ?? 'Visitante';
	}
</script>

<svelte:head>
	<title>{grupo?.name || 'Grupo'} · Eagles</title>
</svelte:head>

<main class="conteudo">
	<div class="pilha">
		<a href="/grupos" class="voltar">← Grupos</a>

		<header>
			<div class="topo">
				<h1>{grupo?.name || 'Carregando…'}</h1>
				{#if grupo?.slug}<span class="slug">#{grupo.slug}</span>{/if}
			</div>
			{#if grupo?.description}<p class="sub">{grupo.description}</p>{/if}
		</header>

		{#if erro}
			<Aviso tom="erro">{erro}</Aviso>
		{/if}

		{#if carregando && !grupo}
			<div class="carregando">
				<Marca tamanho={44} />
				<p>Carregando grupo…</p>
			</div>
		{:else if grupo}
			<div class="grupo-resumo">
				<p class="contagem">
					{membros.length} {membros.length === 1 ? 'integrante' : 'integrantes'}
				</p>
			</div>

			<h2>Integrantes</h2>

			{#if membros.length === 0}
				<div class="vazio">
					<p>Este grupo ainda não tem integrantes vinculados.</p>
				</div>
			{:else}
				<ul class="lista-membros">
					{#each membros as m (m.id)}
						<li class="membro-item">
							<div class="membro-info">
								<strong>{m.nome}</strong>
								{#if m.funcao}<span class="funcao">{m.funcao}</span>{/if}
								{#if m.whatsapp}
									<span class="contato">
										<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
											<path d="M3.5 2.5h2.2l1 2.8-1.4 1.1a8.5 8.5 0 0 0 4.3 4.3l1.1-1.4 2.8 1v2.2a1 1 0 0 1-1 1A10 10 0 0 1 2.5 3.5a1 1 0 0 1 1-1z" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round" />
										</svg>
										{m.whatsapp}
									</span>
								{/if}
							</div>
							<span class="status-chip chip-{m.status || 'visitante'}">
								{rotuloStatus(m.status)}
							</span>
						</li>
					{/each}
				</ul>
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

	.topo {
		display: flex;
		align-items: center;
		flex-wrap: wrap;
		gap: var(--esp-2);
	}

	.sub {
		color: var(--cor-texto-2);
		font-size: var(--texto-sm);
		margin: 0;
	}

	.slug {
		font-size: var(--texto-xs);
		font-weight: 600;
		color: var(--cor-marca);
		background: var(--cor-marca-suave);
		padding: 2px 8px;
		border-radius: var(--raio-cheio);
	}

	.grupo-resumo {
		padding: var(--esp-3) var(--esp-4);
		background: var(--cor-superficie-2);
		border-radius: var(--raio);
		border: 1px solid var(--cor-linha);
	}

	.contagem {
		font-size: var(--texto-sm);
		font-weight: 700;
		color: var(--cor-texto);
	}

	h2 {
		font-size: var(--texto-lg);
	}

	.lista-membros {
		list-style: none;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: var(--esp-2);
	}

	.membro-item {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--esp-3);
		padding: var(--esp-3) var(--esp-4);
		background: var(--cor-superficie);
		border: 1px solid var(--cor-linha);
		border-radius: var(--raio);
	}

	.membro-info {
		flex: 1;
		display: flex;
		flex-direction: column;
		gap: 2px;
		min-width: 0;
	}

	.membro-info strong {
		font-size: var(--texto-base);
		font-weight: 600;
	}

	.funcao {
		font-size: var(--texto-xs);
		font-weight: 600;
		color: var(--cor-marca);
	}

	.contato {
		display: inline-flex;
		align-items: center;
		gap: var(--esp-1);
		font-size: var(--texto-xs);
		color: var(--cor-texto-2);
	}

	.status-chip {
		flex: none;
		padding: 2px 8px;
		border-radius: var(--raio-cheio);
		font-size: var(--texto-xs);
		font-weight: 700;
	}

	.chip-visitante {
		background: var(--cor-superficie-2);
		color: var(--cor-texto-2);
		border: 1px solid var(--cor-linha);
	}

	.chip-recorrente {
		background: var(--cor-marca-suave);
		color: var(--cor-marca);
		border: 1px solid var(--cor-marca);
	}

	.chip-membro {
		background: var(--cor-sucesso-suave);
		color: var(--cor-sucesso);
		border: 1px solid var(--cor-sucesso);
	}

	.chip-conselheiro,
	.chip-lider {
		background: var(--cor-marca);
		color: var(--cor-sobre-marca);
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
	}
</style>

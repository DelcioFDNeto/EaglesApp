<script lang="ts">
	import { onMount } from 'svelte';
	import Aviso from '$ui/Aviso.svelte';
	import Botao from '$ui/Botao.svelte';
	import Marca from '$ui/Marca.svelte';
	import { api } from '$lib/api';

	let eventos: any[] = $state([]);
	let podeCriar = $state(false);
	let carregando = $state(true);
	let erro = $state<string | undefined>(undefined);

	const STATUS_EVENTO: Record<string, string> = {
		scheduled: 'Agendado',
		ongoing: 'Em andamento',
		completed: 'Concluído',
		cancelled: 'Cancelado'
	};

	onMount(async () => {
		carregando = true;
		erro = undefined;
		try {
			const res = await api.get('/api/eventos');
			if (res.ok) {
				const data = await res.json();
				eventos = data.eventos ?? [];
				podeCriar = Boolean(data.podeCriar);
			} else {
				const data = await res.json().catch(() => ({}));
				erro = data.erro ?? 'Não foi possível carregar os eventos.';
			}
		} catch (e: any) {
			erro =
				e.message === 'sem_conexao'
					? 'Você está offline. Os eventos podem estar desatualizados.'
					: 'Erro ao carregar eventos.';
		} finally {
			carregando = false;
		}
	});

	function formatarData(data: string | null) {
		if (!data) return 'Data não definida';
		return new Date(data).toLocaleDateString('pt-BR', {
			weekday: 'short',
			day: '2-digit',
			month: 'short',
			hour: '2-digit',
			minute: '2-digit'
		});
	}

	function rotuloStatus(status: string) {
		return STATUS_EVENTO[status] ?? status;
	}
</script>

<svelte:head>
	<title>Eventos · Eagles</title>
</svelte:head>

<main class="conteudo">
	<div class="pilha">
		<a href="/inicio" class="voltar">← Início</a>

		<header>
			<h1>Eventos</h1>
			<p class="sub">
				Encontros, PGs e compromissos dos Eagles. Toque para ver detalhes e confirmar presença.
			</p>
			{#if podeCriar}
				<div class="acoes-cabecalho">
					<Botao href="/eventos/novo">Novo evento</Botao>
					<a href="/eventos/tipos" class="link-secundario">Tipos de evento</a>
				</div>
			{/if}
		</header>

		{#if erro}
			<Aviso tom="erro">{erro}</Aviso>
		{/if}

		{#if carregando}
			<div class="carregando">
				<Marca tamanho={44} />
				<p>Carregando eventos…</p>
			</div>
		{:else if eventos.length === 0}
			<div class="vazio">
				<Marca tamanho={44} />
				<h2>Ainda não há eventos</h2>
				<p>
					{podeCriar
						? 'Crie o primeiro encontro para as pessoas poderem confirmar presença.'
						: 'Não há encontros cadastrados no momento.'}
				</p>
			</div>
		{:else}
			<ul class="lista-eventos">
				{#each eventos as e (e.id)}
					<li>
						<a class="evento-item" href={`/eventos/${e.id}`}>
							<div class="evento-info">
								<div class="topo-evento">
									{#if e.eventType}
										<span class="tipo" style="--cor: {e.eventType.color ?? '#A91825'}">
											{e.eventType.name}
										</span>
									{/if}
									<span class="status status-{e.status}">{rotuloStatus(e.status)}</span>
								</div>

								<strong>{e.title}</strong>

								{#if e.status === 'cancelled' && e.cancelReason}
									<p class="descricao">Cancelado: {e.cancelReason}</p>
								{:else if e.description}
									<p class="descricao">{e.description}</p>
								{/if}

								<div class="detalhes">
									<span class="meta">
										<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
											<rect
												x="2"
												y="3"
												width="12"
												height="11"
												rx="1.5"
												fill="none"
												stroke="currentColor"
												stroke-width="1.3"
											/>
											<path
												d="M5 1.5v3M11 1.5v3M2 6.5h12"
												fill="none"
												stroke="currentColor"
												stroke-width="1.3"
												stroke-linecap="round"
											/>
										</svg>
										{formatarData(e.startsAt)}
									</span>
									{#if e.location}
										<span class="meta">
											<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
												<path
													d="M8 14s4.5-4.1 4.5-7.5a4.5 4.5 0 1 0-9 0C3.5 9.9 8 14 8 14z"
													fill="none"
													stroke="currentColor"
													stroke-width="1.3"
												/>
												<circle
													cx="8"
													cy="6.5"
													r="1.4"
													fill="none"
													stroke="currentColor"
													stroke-width="1.3"
												/>
											</svg>
											{e.location}
										</span>
									{/if}
								</div>
							</div>
							<span class="seta" aria-hidden="true">›</span>
						</a>
					</li>
				{/each}
			</ul>
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

	.acoes-cabecalho {
		display: flex;
		align-items: center;
		flex-wrap: wrap;
		gap: var(--esp-3);
		margin-top: var(--esp-2);
	}

	.link-secundario {
		font-size: var(--texto-sm);
		font-weight: 600;
		min-height: var(--toque-min);
		display: inline-flex;
		align-items: center;
	}

	.lista-eventos {
		list-style: none;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: var(--esp-2);
	}

	.evento-item {
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
			border-color var(--transicao),
			background-color var(--transicao);
	}

	@media (hover: hover) {
		.evento-item:hover {
			border-color: var(--cor-marca);
			background: var(--cor-superficie-2);
		}
	}

	.evento-info {
		flex: 1;
		display: flex;
		flex-direction: column;
		gap: var(--esp-1);
		min-width: 0;
	}

	.topo-evento {
		display: flex;
		align-items: center;
		flex-wrap: wrap;
		gap: var(--esp-2);
	}

	.tipo {
		font-size: var(--texto-xs);
		font-weight: 700;
		color: var(--cor-texto);
		background: color-mix(in srgb, var(--cor) 18%, transparent);
		border: 1px solid color-mix(in srgb, var(--cor) 45%, transparent);
		padding: 1px 8px;
		border-radius: var(--raio-cheio);
	}

	.evento-info strong {
		font-size: var(--texto-base);
		font-weight: 700;
	}

	.descricao {
		font-size: var(--texto-sm);
		color: var(--cor-texto-2);
		margin: 0;
	}

	.detalhes {
		display: flex;
		align-items: center;
		flex-wrap: wrap;
		gap: var(--esp-3);
		font-size: var(--texto-xs);
		color: var(--cor-texto-2);
		margin-top: var(--esp-1);
	}

	.meta {
		display: inline-flex;
		align-items: center;
		gap: var(--esp-1);
	}

	.status {
		font-size: var(--texto-xs);
		font-weight: 700;
		padding: 1px 8px;
		border-radius: var(--raio-cheio);
	}

	.status-scheduled {
		background: var(--cor-marca-suave);
		color: var(--cor-marca);
	}

	.status-ongoing {
		background: var(--cor-sucesso-suave);
		color: var(--cor-sucesso);
	}

	.status-completed {
		background: var(--cor-superficie-2);
		color: var(--cor-texto-2);
	}

	.status-cancelled {
		background: var(--cor-erro-suave);
		color: var(--cor-erro);
	}

	.seta {
		font-size: var(--texto-lg);
		color: var(--cor-texto-3);
		flex: none;
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

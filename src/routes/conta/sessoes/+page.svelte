<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import Botao from '$ui/Botao.svelte';
	import Aviso from '$ui/Aviso.svelte';
	import { api, apiCache } from '$lib/api';

	let sessoes: any[] = $state([]);
	let carregando = $state(true);
	let erro = $state<string | undefined>(undefined);
	let confirmando = $state(false);
	let revogando = $state(false);

	const formatador = new Intl.DateTimeFormat('pt-BR', {
		day: '2-digit',
		month: 'short',
		hour: '2-digit',
		minute: '2-digit'
	});

	const outras = $derived(sessoes.filter((s) => !s.atual).length);

	const textoOutras = $derived(
		outras === 1
			? 'Outro aparelho precisa entrar de novo com a senha.'
			: `Outros ${outras} aparelhos precisam entrar de novo com a senha.`
	);

	const textoConfirmacao = $derived(
		outras === 1 ? 'Um aparelho será desconectado.' : `${outras} aparelhos serão desconectados.`
	);

	onMount(async () => {
		try {
			sessoes = await apiCache.sessoes();
		} catch (e: any) {
			erro =
				e.message === 'sem_conexao'
					? 'Você está offline. Os dispositivos conectados estão indisponíveis sem conexão.'
					: 'Não foi possível carregar os dispositivos. Tente novamente.';
		} finally {
			carregando = false;
		}
	});

	async function revogarOutras() {
		revogando = true;
		erro = undefined;
		try {
			const res = await api.post('/api/sessoes/revogar-outras');
			if (res.ok) {
				await res.json().catch(() => ({}));
				sessoes = sessoes.filter((s) => s.atual);
				confirmando = false;
			} else {
				const dados = await res.json().catch(() => ({}));
				erro = dados.erro ?? 'Não foi possível desconectar os outros aparelhos.';
			}
		} catch (e: any) {
			erro =
				e.message === 'sem_conexao'
					? 'Você está offline. Não é possível desconectar dispositivos sem conexão.'
					: 'Erro ao desconectar dispositivos.';
		} finally {
			revogando = false;
		}
	}
</script>

<svelte:head>
	<title>Dispositivos conectados · Eagles</title>
</svelte:head>

<main class="conteudo">
	<div class="pilha">
		<a href="/inicio" class="voltar">← Início</a>

		<header>
			<h1>Dispositivos conectados</h1>
			<p class="legenda">
				Cada aparelho em que você entrou aparece aqui. Se algum não for seu, desconecte.
			</p>
		</header>

		{#if carregando}
			<div class="carregando">
				<p>Carregando dispositivos…</p>
			</div>
		{:else if erro}
			<Aviso tom="erro">{erro}</Aviso>
			<Botao onclick={() => location.reload()} variante="texto">Tentar novamente</Botao>
		{:else}
			<ul>
				{#each sessoes as s (s.id)}
					<li class:atual={s.atual}>
						<div>
							<strong>{s.aparelho}</strong>
							<span>Entrou em {formatador.format(new Date(s.criadaEm))}</span>
						</div>
						{#if s.atual}<span class="marcador">este aparelho</span>{/if}
					</li>
				{/each}
			</ul>

			{#if outras > 0}
				<section class="atencao">
					<h2>Desconectar os outros aparelhos</h2>
					<p>{textoOutras}</p>

					{#if !confirmando}
						<Botao variante="destrutivo" onclick={() => (confirmando = true)}>
							Desconectar outros aparelhos
						</Botao>
					{:else}
						<form
							onsubmit={(e) => {
								e.preventDefault();
								revogarOutras();
							}}
						>
							<p class="confirmar" role="alert" aria-live="polite">
								Tem certeza? {textoConfirmacao}
							</p>
							<div class="acoes">
								<Botao tipo="submit" variante="destrutivo" carregando={revogando}>
									Sim, desconectar
								</Botao>
								<Botao variante="texto" tipo="button" onclick={() => (confirmando = false)}>
									Cancelar
								</Botao>
							</div>
						</form>
					{/if}
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
	}

	h1 {
		font-size: var(--texto-2xl);
	}

	h2 {
		font-size: var(--texto-lg);
	}

	.legenda {
		font-size: var(--texto-sm);
		color: var(--cor-texto-2);
		text-wrap: pretty;
	}

	ul {
		list-style: none;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: var(--esp-2);
	}

	li {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--esp-3);
		padding: var(--esp-3) var(--esp-4);
		background: var(--cor-superficie);
		border: 1px solid var(--cor-linha);
		border-radius: var(--raio);
	}

	li.atual {
		border-color: var(--cor-marca);
	}

	li div {
		display: flex;
		flex-direction: column;
		gap: 2px;
		min-width: 0;
	}

	li strong {
		font-size: inherit;
		font-weight: 600;
		overflow-wrap: break-word;
		word-break: break-word;
	}

	li span {
		font-size: var(--texto-xs);
		color: var(--cor-texto-2);
		overflow-wrap: break-word;
		word-break: break-word;
	}

	.marcador {
		flex: none;
		font-size: var(--texto-xs);
		font-weight: 700;
		padding: 2px 8px;
		border-radius: var(--raio-cheio);
		background: var(--cor-marca-suave);
		color: var(--cor-marca);
	}

	.atencao {
		display: flex;
		flex-direction: column;
		gap: var(--esp-3);
		padding: var(--esp-4);
		background: var(--cor-superficie-2);
		border: 1px solid var(--cor-linha);
		border-radius: var(--raio);
		margin-top: var(--esp-4);
	}

	.atencao h2 {
		margin: 0;
		font-size: var(--texto-lg);
		overflow-wrap: break-word;
		word-break: break-word;
	}

	.atencao p {
		font-size: var(--texto-sm);
		color: var(--cor-texto-2);
		margin: 0;
		text-wrap: pretty;
	}

	.confirmar {
		font-weight: 600;
		color: var(--cor-texto);
		margin-bottom: var(--esp-3);
	}

	.acoes {
		display: flex;
		gap: var(--esp-2);
		flex-wrap: wrap;
	}

	.carregando {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		padding: var(--esp-6);
	}
</style>

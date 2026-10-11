<script lang="ts">
	import { FUSO_PADRAO } from '$shared/fuso';
	import { enhance } from '$app/forms';
	import Botao from '$ui/Botao.svelte';
	import Aviso from '$ui/Aviso.svelte';
	import type { ActionData, PageData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	let confirmando = $state(false);

	const formatador = new Intl.DateTimeFormat('pt-BR', {
		timeZone: FUSO_PADRAO,
		day: '2-digit',
		month: 'short',
		hour: '2-digit',
		minute: '2-digit'
	});

	const outras = $derived(data.sessoes.filter((s) => !s.atual).length);
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

		{#if form?.sucesso}
			<Aviso tom="sucesso">{form.sucesso}</Aviso>
		{/if}
		{#if form?.erro}
			<Aviso tom="aviso">{form.erro}</Aviso>
		{/if}

		<ul>
			{#each data.sessoes as s (s.id)}
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
			<section class="perigo">
				<h2>Desconectar os outros aparelhos</h2>
				<p>
					Você continua conectado neste dispositivo. Os outros {outras === 1
						? 'precisará entrar'
						: 'precisarão entrar'} de novo com a senha.
				</p>

				{#if !confirmando}
					<!--
						Ação destrutiva: botão de contorno, nunca preenchido de vermelho,
						e com confirmação textual antes de executar.
					-->
					<Botao variante="destrutivo" onclick={() => (confirmando = true)}>
						Desconectar outros aparelhos
					</Botao>
				{:else}
					<form method="POST" action="?/revogarOutras" use:enhance>
						<p class="confirmar">
							Tem certeza? {outras === 1
								? 'Um aparelho será desconectado'
								: `${outras} aparelhos serão desconectados`}.
						</p>
						<div class="acoes">
							<Botao tipo="submit" variante="destrutivo">Sim, desconectar</Botao>
							<Botao variante="texto" onclick={() => (confirmando = false)}>Cancelar</Botao>
						</div>
					</form>
				{/if}
			</section>
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
		font-size: var(--texto-base);
	}

	.legenda {
		font-size: var(--texto-sm);
		color: var(--cor-texto-3);
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
	}

	li span {
		font-size: var(--texto-xs);
		color: var(--cor-texto-3);
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

	.perigo {
		display: flex;
		flex-direction: column;
		gap: var(--esp-3);
		padding: var(--esp-4);
		border: 1px solid var(--cor-linha);
		border-left: 3px solid var(--cor-perigo);
		border-radius: var(--raio);
		background: var(--cor-superficie);
		margin-top: var(--esp-4);
	}

	.perigo p {
		font-size: var(--texto-sm);
		color: var(--cor-texto-2);
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
</style>

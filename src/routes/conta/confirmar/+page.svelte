<script lang="ts">
	import { enhance } from '$app/forms';
	import BarraDeTopo from '$ui/BarraDeTopo.svelte';
	import Botao from '$ui/Botao.svelte';
	import Campo from '$ui/Campo.svelte';
	import Aviso from '$ui/Aviso.svelte';
	import type { ActionData, PageData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	let enviando = $state(false);
</script>

<svelte:head>
	<title>Confirmar senha · Eagles</title>
</svelte:head>

<BarraDeTopo voltar={data.voltar} titulo="Confirmar senha" />

<main class="conteudo">
	<section class="cartao">
		<h1>Antes de continuar</h1>
		<p>
			Alterar acessos é uma ação sensível. Confirme sua senha — a confirmação vale pelos próximos
			{data.minutos} minutos.
		</p>

		{#if form?.erro}
			<Aviso tom="erro">{form.erro}</Aviso>
		{/if}

		<form
			method="POST"
			action="?voltar={encodeURIComponent(data.voltar)}"
			use:enhance={() => {
				enviando = true;
				return async ({ update }) => {
					await update();
					enviando = false;
				};
			}}
		>
			<!-- O campo de usuário oculto ajuda o gerenciador de senhas a oferecer a senha certa. -->
			<input type="hidden" autocomplete="username" value={data.nome} />
			<Campo
				id="senha"
				rotulo="Sua senha"
				tipo="password"
				autocomplete="current-password"
				obrigatorio
			/>
			<Botao tipo="submit" largura="cheia" carregando={enviando}>Confirmar</Botao>
		</form>
	</section>
</main>

<style>
	.conteudo {
		max-width: 560px;
		margin-inline: auto;
		padding: var(--esp-4) var(--esp-3) var(--esp-6);
	}

	.cartao {
		background: var(--cor-superficie);
		border: 1px solid var(--cor-linha);
		border-radius: var(--raio-lg);
		padding: var(--esp-4);
		display: flex;
		flex-direction: column;
		gap: var(--esp-4);
	}

	h1 {
		font-size: var(--texto-xl);
		font-weight: 800;
		letter-spacing: -0.03em;
	}

	p {
		color: var(--cor-texto-2);
		font-size: var(--texto-sm);
		text-wrap: pretty;
	}

	form {
		display: flex;
		flex-direction: column;
		gap: var(--esp-4);
	}
</style>

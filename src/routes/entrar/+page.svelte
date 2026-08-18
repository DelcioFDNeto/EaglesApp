<script lang="ts">
	import { enhance } from '$app/forms';
	import Botao from '$ui/Botao.svelte';
	import Campo from '$ui/Campo.svelte';
	import Aviso from '$ui/Aviso.svelte';
	import Marca from '$ui/Marca.svelte';
	import type { ActionData } from './$types';

	let { form }: { form: ActionData } = $props();

	let enviando = $state(false);
</script>

<svelte:head>
	<title>Entrar · Eagles</title>
</svelte:head>

<main>
	<div class="cartao">
		<header>
			<Marca tamanho={56} />
			<h1>Eagles</h1>
			<p class="sub">Entre para ver seus encontros e responsabilidades.</p>
		</header>

		{#if form?.erro}
			<Aviso tom="erro">{form.erro}</Aviso>
		{/if}

		<!--
			`use:enhance` melhora a experiência, mas o formulário é HTML puro:
			sem JavaScript ele envia por POST normal e funciona igual. É um
			critério de aceitação do M01, não um detalhe.
		-->
		<form
			method="POST"
			use:enhance={() => {
				enviando = true;
				return async ({ update }) => {
					await update();
					enviando = false;
				};
			}}
		>
			<Campo
				id="identificador"
				rotulo="E-mail ou telefone"
				valor={form?.identificador ?? ''}
				erro={form?.erros?.identificador}
				autocomplete="username"
				obrigatorio
			/>

			<Campo
				id="senha"
				rotulo="Senha"
				tipo="password"
				erro={form?.erros?.senha}
				autocomplete="current-password"
				obrigatorio
			/>

			<Botao tipo="submit" largura="cheia" carregando={enviando}>Entrar</Botao>
		</form>

		<footer>
			<p>
				Não consegue entrar? Peça um novo convite ao seu conselheiro — ele gera um link novo em
				segundos.
			</p>
		</footer>
	</div>
</main>

<style>
	main {
		min-height: 100dvh;
		display: grid;
		place-items: center;
		padding: var(--esp-4);
	}

	.cartao {
		width: 100%;
		max-width: 400px;
		display: flex;
		flex-direction: column;
		gap: var(--esp-5);
	}

	header {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: var(--esp-2);
		text-align: center;
	}

	h1 {
		font-size: var(--texto-3xl);
		font-weight: 800;
		letter-spacing: -0.04em;
	}

	.sub {
		color: var(--cor-texto-2);
		font-size: var(--texto-sm);
		max-width: 26ch;
	}

	form {
		display: flex;
		flex-direction: column;
		gap: var(--esp-4);
	}

	footer p {
		font-size: var(--texto-sm);
		color: var(--cor-texto-3);
		text-align: center;
		text-wrap: pretty;
	}
</style>

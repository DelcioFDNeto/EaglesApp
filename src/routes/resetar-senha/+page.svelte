<script lang="ts">
	import { page } from '$app/state';
	import Botao from '$ui/Botao.svelte';
	import Campo from '$ui/Campo.svelte';
	import Aviso from '$ui/Aviso.svelte';
	import Marca from '$ui/Marca.svelte';
	import { api } from '$lib/api';

	const urlParams = new URL(page.url).searchParams;
	let token = $derived(urlParams.get('token') ?? '');
	let erro = $state<string | undefined>(undefined);
	let sucesso = $state<string | undefined>(undefined);
	let enviando = $state(false);

	async function handleSubmit(e: SubmitEvent) {
		e.preventDefault();
		erro = undefined;
		sucesso = undefined;
		enviando = true;

		const form = e.target as HTMLFormElement;
		const novaSenha = (form.elements.namedItem('senha') as HTMLInputElement).value;
		const confirmacao = (form.elements.namedItem('confirmacao') as HTMLInputElement).value;

		if (novaSenha !== confirmacao) {
			erro = 'As senhas não são iguais.';
			enviando = false;
			return;
		}

		const res = await api.post('/api/auth/resetar-senha', {
			token,
			novaSenha
		});
		const data = await res.json();

		if (res.ok) {
			sucesso = data.mensagem ?? 'Senha redefinida com sucesso.';
		} else {
			erro = data.erro ?? 'Não foi possível redefinir a senha.';
		}

		enviando = false;
	}
</script>

<svelte:head>
	<title>Redefinir senha · Eagles</title>
</svelte:head>

<main>
	<div class="cartao">
		<header>
			<Marca tamanho={56} comNome />
			<h1>Nova senha</h1>
			<p class="sub">
				Crie uma nova senha para acessar o Eagles. Ela deve ser diferente da anterior.
			</p>
		</header>

		{#if !token}
			<Aviso tom="erro">Link de redefinição inválido. Solicite um novo em "Esqueci minha senha".</Aviso>
		{/if}

		{#if erro}
			<Aviso tom="erro">{erro}</Aviso>
		{/if}
		{#if sucesso}
			<Aviso tom="sucesso">{sucesso}</Aviso>
		{/if}

		{#if token}
			<form onsubmit={handleSubmit}>
				<Campo
					id="senha"
					rotulo="Nova senha"
					tipo="password"
					autocomplete="new-password"
					obrigatorio
				/>

				<Campo
					id="confirmacao"
					rotulo="Confirmar senha"
					tipo="password"
					autocomplete="new-password"
					obrigatorio
				/>

				<Botao tipo="submit" largura="cheia" carregando={enviando}>
					Redefinir senha
				</Botao>
			</form>
		{/if}

		<footer>
			<p class="link">
				<Botao variante="texto" href="/entrar">Voltar para a entrada</Botao>
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

	footer {
		display: flex;
		flex-direction: column;
		gap: var(--esp-2);
	}

	.link {
		margin: 0;
		text-align: center;
	}
</style>
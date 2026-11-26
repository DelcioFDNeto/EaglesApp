<script lang="ts">
	import { goto } from '$app/navigation';
	import Botao from '$ui/Botao.svelte';
	import Campo from '$ui/Campo.svelte';
	import Aviso from '$ui/Aviso.svelte';
	import Marca from '$ui/Marca.svelte';
	import { api } from '$lib/api';

	let identificador = $state('');
	let senha = $state('');
	let erro = $state<string | undefined>(undefined);
	let enviando = $state(false);

	async function handleSubmit(e: SubmitEvent) {
		e.preventDefault();
		erro = undefined;
		enviando = true;

		try {
			const res = await api.post('/api/auth/login', {
				identificador: identificador.trim(),
				senha
			});
			const data = await res.json().catch(() => ({}));

			if (res.ok && data.token) {
				localStorage.setItem('eagles_token', data.token);
				await goto('/inicio');
			} else {
				erro = data.erro ?? 'Não foi possível entrar. Confira os dados e tente novamente.';
			}
		} catch {
			erro = 'Não foi possível conectar ao servidor. Verifique sua internet e tente novamente.';
		} finally {
			enviando = false;
		}
	}
</script>

<svelte:head>
	<title>Entrar · Eagles</title>
</svelte:head>

<main>
	<div class="cartao">
		<header>
			<Marca tamanho={56} comNome />
			<h1>Entrar</h1>
			<p class="sub">Digite seu e-mail ou telefone e senha para acessar o Eagles.</p>
		</header>

		{#if erro}
			<Aviso tom="erro">{erro}</Aviso>
		{/if}

		<form onsubmit={handleSubmit}>
			<Campo
				id="identificador"
				rotulo="E-mail ou telefone"
				bind:valor={identificador}
				autocomplete="username"
				obrigatorio
			/>

			<Campo
				id="senha"
				rotulo="Senha"
				tipo="password"
				bind:valor={senha}
				autocomplete="current-password"
				obrigatorio
			/>

			<Botao tipo="submit" largura="cheia" carregando={enviando}>
				Entrar
			</Botao>
		</form>

		<footer>
			<p class="acoes-rodape">
				<Botao variante="texto" href="/esqueci-senha">Esqueci minha senha</Botao>
				<Botao variante="texto" href="/solicitar-cadastro">Solicitar acesso</Botao>
			</p>
			<p>
				O acesso aos Eagles é feito por convite do seu conselheiro ou líder.
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
		max-width: 28ch;
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

	footer p {
		font-size: var(--texto-sm);
		color: var(--cor-texto-2);
		text-align: center;
		text-wrap: pretty;
		margin: 0;
	}

	.acoes-rodape {
		display: flex;
		flex-wrap: wrap;
		justify-content: center;
		gap: var(--esp-1);
	}
</style>

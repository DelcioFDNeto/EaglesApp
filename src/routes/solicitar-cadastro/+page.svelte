<script lang="ts">
	import Botao from '$ui/Botao.svelte';
	import Campo from '$ui/Campo.svelte';
	import Aviso from '$ui/Aviso.svelte';
	import Marca from '$ui/Marca.svelte';
	import { api } from '$lib/api';

	let mensagem = $state<string | undefined>(undefined);
	let erro = $state<string | undefined>(undefined);
	let enviando = $state(false);

	async function handleSubmit(e: SubmitEvent) {
		e.preventDefault();
		erro = undefined;
		mensagem = undefined;
		enviando = true;

		const form = e.target as HTMLFormElement;
		const nome = (form.elements.namedItem('nome') as HTMLInputElement).value;
		const email = (form.elements.namedItem('email') as HTMLInputElement).value;
		const telefone = (form.elements.namedItem('telefone') as HTMLInputElement).value;

		const res = await api.post('/api/auth/solicitar-cadastro', {
			nome,
			email,
			telefone: telefone || undefined
		});
		const data = await res.json();

		if (res.ok) {
			mensagem = data.mensagem ?? 'Solicitação enviada.';
		} else {
			erro = data.erro ?? 'Não foi possível enviar a solicitação.';
		}

		enviando = false;
	}
</script>

<svelte:head>
	<title>Solicitar cadastro · Eagles</title>
</svelte:head>

<main>
	<div class="cartao">
		<header>
			<Marca tamanho={56} comNome />
			<h1>Solicitar acesso</h1>
			<p class="sub">
				O acesso ao Eagles é feito por convite do conselheiro. Preencha seus dados para
				solicitar um convite.
			</p>
		</header>

		{#if erro}
			<Aviso tom="erro">{erro}</Aviso>
		{/if}
		{#if mensagem}
			<Aviso tom="sucesso">{mensagem}</Aviso>
		{/if}

		<form onsubmit={handleSubmit}>
			<Campo
				id="nome"
				rotulo="Nome completo"
				autocomplete="name"
				obrigatorio
			/>

			<Campo
				id="email"
				rotulo="E-mail"
				tipo="email"
				autocomplete="email"
				obrigatorio
			/>

			<Campo
				id="telefone"
				rotulo="Telefone (opcional)"
				tipo="tel"
				autocomplete="tel"
			/>

			<Botao tipo="submit" largura="cheia" carregando={enviando}>
				Enviar solicitação
			</Botao>
		</form>

		<footer>
			<p class="link">
				<Botao variante="texto" href="/entrar">Já tenho acesso. Entrar</Botao>
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
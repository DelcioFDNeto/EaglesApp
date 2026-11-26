<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import Botao from '$ui/Botao.svelte';
	import Campo from '$ui/Campo.svelte';
	import Aviso from '$ui/Aviso.svelte';
	import Marca from '$ui/Marca.svelte';
	import { MIN_PASSWORD_LENGTH } from '$shared/senha';
	import { api } from '$lib/api';

	type Estado =
		| { estado: 'carregando' }
		| {
				estado: 'valido';
				nome: string;
				login: { tipo: 'telefone' | 'email'; valor: string } | null;
		  }
		| { estado: 'invalido' | 'bloqueado'; mensagem: string };

	const SEM_CONEXAO =
		'Não foi possível conectar ao servidor. Verifique sua internet e tente novamente.';

	let data = $state<Estado>({ estado: 'carregando' });
	let senha = $state('');
	let confirmacao = $state('');
	let erro = $state<string | undefined>(undefined);
	let erros = $state<{ senha?: string; confirmacao?: string }>({});
	let enviando = $state(false);

	const caminho = $derived(`/api/auth/convite/${encodeURIComponent(page.params.token ?? '')}`);

	onMount(async () => {
		try {
			const res = await api.get(caminho);
			const corpo = await res.json().catch(() => null);
			data = corpo?.estado ? corpo : { estado: 'invalido', mensagem: SEM_CONEXAO };
		} catch {
			data = { estado: 'invalido', mensagem: SEM_CONEXAO };
		}
	});

	async function enviar(e: SubmitEvent) {
		e.preventDefault();
		erro = undefined;
		erros = {};
		enviando = true;

		try {
			const res = await api.post(caminho, { senha, confirmacao });
			const corpo = await res.json().catch(() => ({}));

			if (res.ok && corpo.token) {
				localStorage.setItem('eagles_token', corpo.token);
				await goto('/inicio?boas-vindas=1', { replaceState: true });
				return;
			}

			erros = corpo.erros ?? {};
			erro = corpo.erro ?? (corpo.erros ? undefined : 'Não foi possível criar seu acesso.');
		} catch {
			erro = SEM_CONEXAO;
		} finally {
			enviando = false;
		}
	}
</script>

<svelte:head>
	<title>Seu acesso · Eagles</title>
</svelte:head>

<main>
	<div class="cartao">
		<header>
			<Marca tamanho={56} />
			{#if data.estado === 'valido'}
				<h1>Oi, {data.nome.split(' ')[0]}!</h1>
				<p class="sub">Escolha uma senha para entrar no Eagles.</p>
				{#if data.login}
					<p class="login">
						Depois, para entrar, use o {data.login.tipo === 'telefone' ? 'telefone' : 'e-mail'}
						<strong>{data.login.valor}</strong> e esta senha.
					</p>
				{/if}
			{:else}
				<h1>Eagles</h1>
			{/if}
		</header>

		{#if data.estado === 'carregando'}
			<p class="sub" role="status">Conferindo seu convite…</p>
		{:else if data.estado !== 'valido'}
			<Aviso tom="aviso">{data.mensagem}</Aviso>
			<Botao href="/entrar" variante="secundario" largura="cheia">Ir para a entrada</Botao>
		{:else}
			{#if erro}
				<Aviso tom="erro">{erro}</Aviso>
			{/if}

			<form onsubmit={enviar}>
				<Campo
					id="senha"
					rotulo="Sua senha"
					tipo="password"
					bind:valor={senha}
					erro={erros.senha}
					ajuda="Pelo menos {MIN_PASSWORD_LENGTH} caracteres. Uma frase que só você lembra funciona melhor que símbolos."
					autocomplete="new-password"
					obrigatorio
				/>

				<Campo
					id="confirmacao"
					rotulo="Repita a senha"
					tipo="password"
					bind:valor={confirmacao}
					erro={erros.confirmacao}
					autocomplete="new-password"
					obrigatorio
				/>

				<Botao tipo="submit" largura="cheia" carregando={enviando}>Criar meu acesso</Botao>
			</form>

			<p class="rodape">
				Ao criar seu acesso você passa a ver os encontros, confirmar presença e acompanhar suas
				responsabilidades.
			</p>
		{/if}
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
	}

	form {
		display: flex;
		flex-direction: column;
		gap: var(--esp-4);
	}

	.login {
		font-size: var(--texto-sm);
		color: var(--cor-texto-2);
		background: var(--cor-superficie-2);
		border: 1px solid var(--cor-linha);
		border-radius: var(--raio);
		padding: var(--esp-2) var(--esp-3);
		text-wrap: pretty;
	}

	.rodape {
		font-size: var(--texto-sm);
		color: var(--cor-texto-3);
		text-align: center;
		text-wrap: pretty;
	}
</style>

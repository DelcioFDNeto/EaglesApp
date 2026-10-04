<script lang="ts">
	import { enhance } from '$app/forms';
	import Botao from '$ui/Botao.svelte';
	import Campo from '$ui/Campo.svelte';
	import Aviso from '$ui/Aviso.svelte';
	import Marca from '$ui/Marca.svelte';
	import { MIN_PASSWORD_LENGTH } from '$shared/senha';
	import type { ActionData, PageData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	let enviando = $state(false);
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
				<p class="sub">
					{#if data.recuperacao}
						Vamos recuperar seu acesso. Escolha uma senha nova — a antiga deixa de valer e os
						aparelhos que estavam conectados saem da conta.
					{:else}
						Escolha como você vai entrar no Eagles.
					{/if}
				</p>
			{:else}
				<h1>Eagles</h1>
			{/if}
		</header>

		{#if data.estado !== 'valido'}
			<Aviso tom="aviso">{data.mensagem}</Aviso>
			<Botao href="/entrar" variante="secundario" largura="cheia">Ir para a entrada</Botao>
		{:else}
			{#if form?.erro}
				<Aviso tom="erro">{form.erro}</Aviso>
			{/if}

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
				<!--
					O identificador é OBRIGATÓRIO. A versão do M01 criava a conta só com
					a senha, e o login procura a conta por e-mail ou telefone — quem
					entrava por convite ficava trancado para fora ao sair.

					Sem preenchimento automático com o cadastro, de propósito: o link
					pode ser encaminhado, e a página não deve entregar o contato de
					ninguém a quem o abrir.
				-->
				<Campo
					id="identificador"
					rotulo="E-mail ou telefone"
					valor={form?.identificador ?? ''}
					erro={form?.erros?.identificador}
					autocomplete="username"
					ajuda="É com ele e a senha que você entra da próxima vez. Use o que você usa no dia a dia."
					obrigatorio
				/>

				<Campo
					id="senha"
					rotulo="Sua senha"
					tipo="password"
					erro={form?.erros?.senha}
					ajuda="Pelo menos {MIN_PASSWORD_LENGTH} caracteres. Uma frase que só você lembra funciona melhor que símbolos."
					autocomplete="new-password"
					obrigatorio
				/>

				<Campo
					id="confirmacao"
					rotulo="Repita a senha"
					tipo="password"
					erro={form?.erros?.confirmacao}
					autocomplete="new-password"
					obrigatorio
				/>

				<Botao tipo="submit" largura="cheia" carregando={enviando}>
					{data.recuperacao ? 'Salvar nova senha' : 'Criar meu acesso'}
				</Botao>
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

	.rodape {
		font-size: var(--texto-sm);
		color: var(--cor-texto-3);
		text-align: center;
		text-wrap: pretty;
	}
</style>

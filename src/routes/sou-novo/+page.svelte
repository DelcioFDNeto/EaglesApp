<script lang="ts">
	import { enhance } from '$app/forms';
	import Marca from '$ui/Marca.svelte';
	import Botao from '$ui/Botao.svelte';
	import Campo from '$ui/Campo.svelte';
	import Aviso from '$ui/Aviso.svelte';
	import { IDADE_MINIMA } from '$shared/pessoa';
	import type { ActionData } from './$types';

	let { form }: { form: ActionData } = $props();

	let enviando = $state(false);

	/**
	 * A data de nascimento vem ANTES de qualquer campo opcional, e é ela que
	 * decide quais campos aparecem (ADR 0003). Quem é menor de idade não
	 * preenche o próprio contato aqui — preenche quem responde por ele.
	 */
	let nascimento = $state('');

	const ehMenor = $derived.by(() => {
		if (!nascimento) return null;
		const n = new Date(`${nascimento}T00:00:00Z`);
		if (Number.isNaN(n.getTime())) return null;
		const hoje = new Date();
		let anos = hoje.getUTCFullYear() - n.getUTCFullYear();
		const mes = hoje.getUTCMonth() - n.getUTCMonth();
		if (mes < 0 || (mes === 0 && hoje.getUTCDate() < n.getUTCDate())) anos--;
		return anos < 18;
	});

	// Sem JavaScript o formulário mostra os dois blocos e o servidor decide o
	// que guardar — nunca fica um caminho inacessível.
	const mostrarContatoProprio = $derived(ehMenor !== true);
	const mostrarResponsavel = $derived(ehMenor === true || form?.ehMenor === true);

	const valor = (campo: string) => form?.valores?.[campo] ?? '';
	const erroDe = (campo: string) => form?.erros?.[campo];
</script>

<svelte:head>
	<title>Eagles · Sou novo por aqui</title>
</svelte:head>

<main>
	<div class="cartao">
		<header>
			<Marca tamanho={56} />
			<h1>Que bom te ver aqui</h1>
			<p class="sub">
				Deixe seu nome para a gente lembrar de você. Leva menos de um minuto, e você não precisa
				criar senha nenhuma.
			</p>
		</header>

		{#if form?.pronto}
			<Aviso tom="sucesso" titulo="Pronto!">
				{#if form.ehMenor}
					Recebemos seu nome. Alguém dos Eagles vai conversar com seu responsável para completar o
					cadastro.
				{:else}
					Recebemos seu nome. Fique à vontade — alguém dos Eagles vai te procurar.
				{/if}
			</Aviso>
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
				<Campo
					id="fullName"
					rotulo="Seu nome"
					valor={valor('fullName')}
					erro={erroDe('fullName')}
					autocomplete="name"
					obrigatorio
				/>

				<Campo
					id="birthDate"
					rotulo="Data de nascimento"
					tipo="date"
					bind:valor={nascimento}
					erro={erroDe('birthDate')}
					ajuda="Os Eagles são a partir dos {IDADE_MINIMA} anos."
				/>

				{#if mostrarContatoProprio}
					<Campo
						id="phone"
						rotulo="Telefone ou WhatsApp"
						tipo="tel"
						valor={valor('phone')}
						erro={erroDe('phone')}
						inputmode="tel"
						autocomplete="tel"
						ajuda="Opcional. Serve para te avisarmos dos encontros."
					/>
				{/if}

				{#if mostrarResponsavel}
					<div class="responsavel">
						<p class="explicacao">
							Como você tem menos de 18 anos, precisamos falar com quem é responsável por você antes
							de guardar qualquer contato.
						</p>

						<Campo
							id="nomeDoResponsavel"
							rotulo="Nome do seu responsável"
							valor={valor('nomeDoResponsavel')}
							erro={erroDe('nomeDoResponsavel')}
							obrigatorio
						/>

						<Campo
							id="telefoneDoResponsavel"
							rotulo="Telefone do responsável"
							tipo="tel"
							valor={valor('telefoneDoResponsavel')}
							erro={erroDe('telefoneDoResponsavel')}
							inputmode="tel"
						/>
					</div>
				{/if}

				<Botao tipo="submit" largura="cheia" carregando={enviando}>Enviar</Botao>
			</form>
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
		font-size: var(--texto-2xl);
		font-weight: 800;
		letter-spacing: -0.03em;
		text-wrap: balance;
	}

	.sub {
		color: var(--cor-texto-2);
		font-size: var(--texto-sm);
		text-wrap: pretty;
	}

	form {
		display: flex;
		flex-direction: column;
		gap: var(--esp-4);
	}

	.responsavel {
		display: flex;
		flex-direction: column;
		gap: var(--esp-4);
		padding: var(--esp-3);
		background: var(--cor-superficie-2);
		border-radius: var(--raio);
	}

	.explicacao {
		font-size: var(--texto-sm);
		color: var(--cor-texto-2);
		text-wrap: pretty;
	}
</style>

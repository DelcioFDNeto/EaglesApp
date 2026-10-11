<script lang="ts">
	import { enhance } from '$app/forms';
	import BarraDeTopo from '$ui/BarraDeTopo.svelte';
	import Botao from '$ui/Botao.svelte';
	import Campo from '$ui/Campo.svelte';
	import Seletor from '$ui/Seletor.svelte';
	import AreaDeTexto from '$ui/AreaDeTexto.svelte';
	import Aviso from '$ui/Aviso.svelte';
	import { SITUACOES_DE_RELACIONAMENTO } from '$shared/pessoa';
	import type { ActionData, PageData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	let enviando = $state(false);

	const p = $derived(data.pessoa);

	// Valor do formulário: o que voltou da tentativa anterior tem prioridade
	// sobre o que está gravado, para a pessoa não perder o que digitou.
	const valor = (campo: string, gravado: string | null | undefined) =>
		form?.valores?.[campo] ?? gravado ?? '';

	const erroDe = (campo: string) => form?.erros?.[campo];
</script>

<svelte:head>
	<title>Editar {p.fullName} · Eagles</title>
</svelte:head>

<BarraDeTopo voltar="/pessoas/{p.id}" titulo="Editar" />

<main class="conteudo">
	{#if form?.erro}
		<Aviso tom="erro" titulo="Não deu para salvar">{form.erro}</Aviso>
	{/if}

	{#if p.regime.restrito}
		<Aviso tom="info" titulo="Cadastro em regime restrito">{p.regime.motivo}</Aviso>
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
			rotulo="Nome completo"
			valor={valor('fullName', p.fullName)}
			erro={erroDe('fullName')}
			autocomplete="name"
			obrigatorio
		/>

		<!--
			Nascimento e contato só aparecem — e só se editam — para quem pode vê-los.
			Mostrá-los vazios a quem não pode faria o "salvar" apagá-los.
		-->
		{#if !p.sensiveis}
			<p class="legenda">
				Data de nascimento e contato só aparecem para quem pode ver os dados sensíveis desta pessoa.
			</p>
		{:else}
			<Campo
				id="birthDate"
				rotulo="Data de nascimento"
				tipo="date"
				valor={valor('birthDate', p.birthDate)}
				erro={erroDe('birthDate')}
			/>
		{/if}

		{#if p.sensiveis && p.regime.podeGuardarContato}
			<Campo
				id="phone"
				rotulo="Telefone"
				tipo="tel"
				valor={valor('phone', p.sensiveis?.phone)}
				erro={erroDe('phone')}
				inputmode="tel"
			/>

			<Campo
				id="whatsapp"
				rotulo="WhatsApp"
				tipo="tel"
				valor={valor('whatsapp', p.sensiveis?.whatsapp)}
				erro={erroDe('whatsapp')}
				inputmode="tel"
			/>

			<Campo
				id="email"
				rotulo="E-mail"
				tipo="email"
				valor={valor('email', p.sensiveis?.email)}
				erro={erroDe('email')}
				inputmode="email"
			/>

			<Seletor
				id="relationshipStatus"
				rotulo="Situação de relacionamento"
				valor={valor('relationshipStatus', p.sensiveis?.relationshipStatus)}
				erro={erroDe('relationshipStatus')}
				opcoes={SITUACOES_DE_RELACIONAMENTO.map((s) => ({ valor: s.valor, rotulo: s.rotulo }))}
				vazio="Prefiro não informar"
			/>

			<Campo
				id="joinedAt"
				rotulo="Participa desde"
				tipo="date"
				valor={valor('joinedAt', p.joinedAt)}
				erro={erroDe('joinedAt')}
			/>

			<AreaDeTexto
				id="notes"
				rotulo="Observações"
				valor={valor('notes', p.sensiveis?.notes)}
				erro={erroDe('notes')}
			/>
		{/if}

		<Botao tipo="submit" largura="cheia" carregando={enviando}>Salvar</Botao>
	</form>
</main>

<style>
	.conteudo {
		max-width: 560px;
		margin-inline: auto;
		padding: var(--esp-4) var(--esp-3) var(--esp-6);
		display: flex;
		flex-direction: column;
		gap: var(--esp-4);
	}

	form {
		display: flex;
		flex-direction: column;
		gap: var(--esp-4);
	}

	.legenda {
		font-size: var(--texto-sm);
		color: var(--cor-texto-3);
	}
</style>

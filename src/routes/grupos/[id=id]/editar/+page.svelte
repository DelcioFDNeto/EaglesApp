<script lang="ts">
	import { enhance } from '$app/forms';
	import BarraDeTopo from '$ui/BarraDeTopo.svelte';
	import Botao from '$ui/Botao.svelte';
	import Aviso from '$ui/Aviso.svelte';
	import CamposDoGrupo from '../../CamposDoGrupo.svelte';
	import type { ActionData, PageData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();
	let enviando = $state(false);
</script>

<svelte:head>
	<title>Editar {data.grupo.nome} · Eagles</title>
</svelte:head>

<BarraDeTopo voltar="/grupos/{data.grupo.id}" />

<main class="conteudo">
	<h1>Editar {data.grupo.nome}</h1>

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
		<CamposDoGrupo valores={form?.valores ?? data.valores} erros={form?.erros ?? {}} />
		<Botao tipo="submit" carregando={enviando}>Salvar</Botao>
	</form>
</main>

<style>
	.conteudo {
		max-width: 560px;
		margin-inline: auto;
		padding: var(--esp-4) var(--esp-3) var(--esp-6);
		display: flex;
		flex-direction: column;
		gap: var(--esp-3);
	}

	h1 {
		font-size: var(--texto-2xl);
	}

	form {
		display: flex;
		flex-direction: column;
		gap: var(--esp-4);
	}
</style>

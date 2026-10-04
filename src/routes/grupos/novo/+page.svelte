<script lang="ts">
	import { enhance } from '$app/forms';
	import BarraDeTopo from '$ui/BarraDeTopo.svelte';
	import Botao from '$ui/Botao.svelte';
	import CamposDoGrupo from '../CamposDoGrupo.svelte';
	import type { ActionData } from './$types';

	let { form }: { form: ActionData } = $props();
	let enviando = $state(false);
</script>

<svelte:head>
	<title>Novo grupo · Eagles</title>
</svelte:head>

<BarraDeTopo voltar="/grupos" />

<main class="conteudo">
	<h1>Novo grupo</h1>
	<p class="legenda">Só o nome é obrigatório. Dia, horário e local podem vir depois.</p>

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
		<CamposDoGrupo valores={form?.valores ?? {}} erros={form?.erros ?? {}} />
		<Botao tipo="submit" carregando={enviando}>Criar grupo</Botao>
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

	.legenda {
		font-size: var(--texto-sm);
		color: var(--cor-texto-3);
	}

	form {
		display: flex;
		flex-direction: column;
		gap: var(--esp-4);
	}
</style>

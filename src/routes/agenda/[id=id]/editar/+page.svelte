<script lang="ts">
	import { enhance } from '$app/forms';
	import BarraDeTopo from '$ui/BarraDeTopo.svelte';
	import Botao from '$ui/Botao.svelte';
	import Aviso from '$ui/Aviso.svelte';
	import Campo from '$ui/Campo.svelte';
	import Seletor from '$ui/Seletor.svelte';
	import AreaDeTexto from '$ui/AreaDeTexto.svelte';
	import CamposDoConvite from '../../CamposDoConvite.svelte';
	import type { ActionData, PageData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	const valores = $derived<Record<string, string>>(form?.valores ?? data.valores);
	const erros = $derived<Record<string, string | undefined>>(form?.erros ?? {});
	const v = (campo: string) => valores[campo] ?? '';

	let enviando = $state(false);
</script>

<svelte:head>
	<title>Editar {data.evento.titulo} · Eagles</title>
</svelte:head>

<BarraDeTopo voltar="/agenda/{data.evento.id}" />

<main class="conteudo">
	<h1>Editar evento</h1>

	{#if data.evento.serieId}
		<Aviso tom="info" titulo="Só esta data">
			Este evento faz parte de um encontro semanal. O que você mudar aqui vale só para esta data —
			para mudar todas, <a href="/agenda/series/{data.evento.serieId}">edite o encontro semanal</a>.
		</Aviso>
	{/if}

	{#if form?.erro}
		<Aviso tom="erro">{form.erro}</Aviso>
	{/if}

	<form
		method="POST"
		use:enhance={() => {
			enviando = true;
			return async ({ update }) => {
				await update({ reset: false });
				enviando = false;
			};
		}}
	>
		<Campo id="titulo" rotulo="Título" valor={v('titulo')} erro={erros.titulo} obrigatorio />
		<Campo id="data" rotulo="Data" tipo="date" valor={v('data')} erro={erros.data} obrigatorio />
		<div class="lado-a-lado">
			<Campo
				id="horaInicio"
				rotulo="Começa"
				tipo="time"
				valor={v('horaInicio')}
				erro={erros.horaInicio}
				obrigatorio
			/>
			<Campo id="horaFim" rotulo="Termina" tipo="time" valor={v('horaFim')} erro={erros.horaFim} />
		</div>
		{#if !data.evento.serieId}
			<Campo
				id="dataFim"
				rotulo="Termina em outro dia?"
				tipo="date"
				valor={v('dataFim')}
				erro={erros.dataFim}
				ajuda="Para acampamento, retiro: a data do último dia."
			/>
		{/if}
		<Campo id="local" rotulo="Local" valor={v('local')} erro={erros.local} />

		<CamposDoConvite
			grupos={data.grupos}
			pessoas={data.pessoas}
			podeConvidarEquipe={data.podeConvidarEquipe}
			valores={form?.convite ?? data.convite}
			erro={erros.convite}
			permitirPadrao={false}
		/>

		<AreaDeTexto
			id="descricao"
			rotulo="Descrição"
			valor={v('descricao')}
			erro={erros.descricao}
			linhas={3}
		/>
		<Seletor
			id="responsavelId"
			rotulo="Responsável"
			opcoes={data.pessoas}
			valor={v('responsavelId')}
			erro={erros.responsavelId}
			vazio="Ninguém em especial"
		/>

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

	.lado-a-lado {
		display: grid;
		grid-template-columns: repeat(2, minmax(0, 1fr));
		gap: var(--esp-3);
	}
</style>

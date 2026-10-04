<script lang="ts">
	import { enhance } from '$app/forms';
	import BarraDeTopo from '$ui/BarraDeTopo.svelte';
	import Botao from '$ui/Botao.svelte';
	import Campo from '$ui/Campo.svelte';
	import Aviso from '$ui/Aviso.svelte';
	import PedidoDeReautenticacao from '$ui/PedidoDeReautenticacao.svelte';
	import ListaDePermissoes from '../ListaDePermissoes.svelte';
	import type { ActionData, PageData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	let enviando = $state(false);

	// Depois de uma recusa, as caixas voltam como a pessoa as deixou.
	const grupos = $derived(
		form?.permissoes
			? data.grupos.map((g) => ({
					...g,
					permissoes: g.permissoes.map((p) => ({
						...p,
						marcada: form.permissoes!.includes(p.chave)
					}))
				}))
			: data.grupos
	);

	const alcance = $derived(form?.defaultScope ?? 'self');
</script>

<svelte:head>
	<title>Novo papel · Eagles</title>
</svelte:head>

<BarraDeTopo voltar="/admin/papeis" titulo="Novo papel" />

<main class="conteudo">
	{#if !data.reautenticado}
		<PedidoDeReautenticacao acao="criar um papel" />
	{:else}
		{#if form?.erro}
			<Aviso tom="erro" titulo="Não deu para criar">{form.erro}</Aviso>
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
			<Campo
				id="name"
				rotulo="Nome do papel"
				valor={form?.valores?.name ?? ''}
				erro={form?.erros?.name}
				obrigatorio
				ajuda="Como aparece para quem administra. Ex.: Secretaria, Apoio à recepção."
			/>
			<Campo
				id="description"
				rotulo="Para que serve (opcional)"
				valor={form?.valores?.description ?? ''}
				erro={form?.erros?.description}
			/>

			<fieldset class="alcance">
				<legend>Alcance</legend>
				<label>
					<input type="radio" name="defaultScope" value="global" checked={alcance === 'global'} />
					<span>
						<strong>Toda a equipe</strong>
						<span class="ajuda">As permissões valem sobre qualquer pessoa ou grupo.</span>
					</span>
				</label>
				<label>
					<input type="radio" name="defaultScope" value="self" checked={alcance !== 'global'} />
					<span>
						<strong>Só os próprios dados</strong>
						<span class="ajuda">Cada pessoa com este papel age apenas sobre si mesma.</span>
					</span>
				</label>
				{#if form?.erros?.defaultScope}
					<p class="erro" role="alert">{form.erros.defaultScope}</p>
				{/if}
			</fieldset>

			<h2>Permissões</h2>
			<ListaDePermissoes {grupos} />

			<Botao tipo="submit" largura="cheia" carregando={enviando}>Criar papel</Botao>
		</form>
	{/if}
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

	h2 {
		font-size: var(--texto-lg);
		font-weight: 700;
		letter-spacing: -0.02em;
	}

	.alcance {
		border: 1px solid var(--cor-linha);
		border-radius: var(--raio);
		background: var(--cor-superficie);
		padding: var(--esp-2) var(--esp-3) var(--esp-3);
		margin: 0;
		display: flex;
		flex-direction: column;
		gap: var(--esp-2);
	}

	legend {
		font-size: var(--texto-sm);
		font-weight: 700;
		color: var(--cor-texto-2);
		padding: 0 var(--esp-1);
	}

	.alcance label {
		display: flex;
		gap: var(--esp-3);
		align-items: flex-start;
		min-height: var(--toque-min);
		cursor: pointer;
	}

	.alcance input {
		width: 20px;
		height: 20px;
		margin-top: 2px;
		accent-color: var(--cor-marca);
	}

	.alcance span {
		display: flex;
		flex-direction: column;
		font-size: var(--texto-sm);
	}

	.ajuda {
		color: var(--cor-texto-3);
	}

	.erro {
		font-size: var(--texto-sm);
		color: var(--cor-erro);
	}
</style>

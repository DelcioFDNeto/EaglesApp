<script lang="ts">
	import { FUSO_PADRAO } from '$shared/fuso';
	import { enhance } from '$app/forms';
	import BarraDeTopo from '$ui/BarraDeTopo.svelte';
	import Botao from '$ui/Botao.svelte';
	import Campo from '$ui/Campo.svelte';
	import Aviso from '$ui/Aviso.svelte';
	import PedidoDeReautenticacao from '$ui/PedidoDeReautenticacao.svelte';
	import ListaDePermissoes from '../ListaDePermissoes.svelte';
	import type { ActionData, PageData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	const p = $derived(data.papel);
	let salvando = $state(false);

	const ALCANCE = {
		global: 'Toda a equipe',
		group: 'Um grupo — atribuído pela tela do grupo',
		self: 'Os próprios dados'
	} as const;

	const grupos = $derived(
		form && 'permissoes' in form && form.permissoes
			? data.grupos.map((g) => ({
					...g,
					permissoes: g.permissoes.map((x) => ({
						...x,
						marcada: form.permissoes!.includes(x.chave)
					}))
				}))
			: data.grupos
	);

	const dataCurta = new Intl.DateTimeFormat('pt-BR', {
		timeZone: FUSO_PADRAO,
		dateStyle: 'short'
	});
</script>

<svelte:head>
	<title>{p.name} · Acessos · Eagles</title>
</svelte:head>

<BarraDeTopo voltar="/admin/papeis" titulo={p.name} />

<main class="conteudo">
	{#if data.criado}
		<Aviso tom="sucesso" titulo="Papel criado">
			Agora você pode atribuí-lo pela tela de acesso de cada pessoa.
		</Aviso>
	{/if}
	{#if form && 'salvo' in form && form.salvo}
		<Aviso tom="sucesso"
			>Alterações salvas. Valem a partir da próxima tela de quem tem o papel.</Aviso
		>
	{/if}
	{#if form && 'erro' in form && form.erro}
		<Aviso tom="erro" titulo="Não deu para salvar">{form.erro}</Aviso>
	{/if}

	<section class="cartao" aria-label="Resumo do papel">
		<p class="alcance"><strong>Alcance:</strong> {ALCANCE[p.defaultScope]}</p>
		{#if p.isSystem}
			<p class="legenda">
				Papel básico: não pode ser excluído, mas as permissões podem ser ajustadas.
			</p>
		{/if}
	</section>

	{#if !data.reautenticado}
		<PedidoDeReautenticacao acao="alterar este papel" />
	{:else}
		<form
			method="POST"
			action="?/salvar"
			use:enhance={() => {
				salvando = true;
				return async ({ update }) => {
					await update({ reset: false });
					salvando = false;
				};
			}}
		>
			<Campo
				id="name"
				rotulo="Nome"
				valor={form && 'valores' in form && form.valores ? form.valores.name : p.name}
				erro={form && 'erros' in form ? form.erros?.name : undefined}
				obrigatorio
			/>
			<Campo
				id="description"
				rotulo="Para que serve (opcional)"
				valor={form && 'valores' in form && form.valores
					? form.valores.description
					: (p.description ?? '')}
			/>

			<h2>Permissões</h2>
			<ListaDePermissoes {grupos} />

			<Botao tipo="submit" largura="cheia" carregando={salvando}>Salvar alterações</Botao>
		</form>
	{/if}

	<section class="cartao" aria-label="Quem tem este papel">
		<h2>Quem tem este papel</h2>
		{#if p.quemTem.length === 0}
			<p class="legenda">Ninguém, por enquanto.</p>
		{:else}
			<ul class="pessoas">
				{#each p.quemTem as q (q.atribuicaoId)}
					<li>
						<a href="/pessoas/{q.personId}/acesso">{q.fullName}</a>
						<span class="desde">desde {dataCurta.format(new Date(q.desde))}</span>
					</li>
				{/each}
			</ul>
		{/if}
	</section>

	{#if !p.isSystem && data.reautenticado}
		<!--
			Destrutivo: contorno e ícone, nunca preenchido de vermelho (Anexo A.2),
			com confirmação textual. Fica num `details` para não estar ao alcance
			de um toque acidental.
		-->
		<details class="perigo">
			<summary>Excluir este papel</summary>
			{#if p.pessoas > 0}
				<p>
					Ainda há {p.pessoas}
					{p.pessoas === 1 ? 'pessoa' : 'pessoas'} com este papel. Retire o papel de cada uma antes de
					excluir — assim cada remoção fica registrada.
				</p>
			{:else}
				<form method="POST" action="?/excluir" use:enhance>
					<label class="confirmo">
						<input type="checkbox" name="confirmo" value="sim" required />
						Confirmo a exclusão de “{p.name}”.
					</label>
					<Botao tipo="submit" variante="destrutivo">Excluir papel</Botao>
				</form>
			{/if}
		</details>
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

	.cartao {
		background: var(--cor-superficie);
		border: 1px solid var(--cor-linha);
		border-radius: var(--raio-lg);
		padding: var(--esp-4);
		display: flex;
		flex-direction: column;
		gap: var(--esp-3);
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
		font-size: var(--texto-sm);
	}

	.legenda {
		font-size: var(--texto-sm);
		color: var(--cor-texto-3);
		text-wrap: pretty;
	}

	.pessoas {
		list-style: none;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: var(--esp-2);
		font-size: var(--texto-sm);
	}

	.pessoas li {
		display: flex;
		flex-wrap: wrap;
		gap: var(--esp-2);
		align-items: baseline;
	}

	.pessoas a {
		color: var(--cor-marca);
		font-weight: 600;
	}

	.desde {
		color: var(--cor-texto-3);
	}

	.perigo {
		border: 1px solid var(--cor-perigo);
		border-radius: var(--raio);
		background: var(--cor-superficie);
		padding: 0 var(--esp-3);
	}

	.perigo summary {
		min-height: var(--toque-min);
		display: flex;
		align-items: center;
		font-size: var(--texto-sm);
		font-weight: 700;
		color: var(--cor-perigo);
		cursor: pointer;
	}

	.perigo p,
	.perigo form {
		padding-bottom: var(--esp-3);
		font-size: var(--texto-sm);
	}

	.confirmo {
		display: flex;
		gap: var(--esp-2);
		align-items: center;
		font-size: var(--texto-sm);
	}
</style>

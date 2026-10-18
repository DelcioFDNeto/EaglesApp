<script lang="ts">
	import { enhance } from '$app/forms';
	import BarraDeTopo from '$ui/BarraDeTopo.svelte';
	import Botao from '$ui/Botao.svelte';
	import Aviso from '$ui/Aviso.svelte';
	import Campo from '$ui/Campo.svelte';
	import Etiqueta from '$ui/Etiqueta.svelte';
	import VoceVai from '$ui/VoceVai.svelte';
	import { dataPorExtenso, periodoPorExtenso } from '$shared/fuso';
	import type { ActionData, PageData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	const e = $derived(data.evento);
	const quando = $derived(periodoPorExtenso(e));

	let enviando = $state<string | null>(null);
	function comCarregamento(nome: string) {
		return () => {
			enviando = nome;
			return async ({ update }: { update: () => Promise<void> }) => {
				await update();
				enviando = null;
			};
		};
	}
</script>

<svelte:head>
	<title>{e.titulo} · Eagles</title>
</svelte:head>

<BarraDeTopo voltar="/agenda?mes={e.data.slice(0, 7)}">
	{#snippet acoes()}
		{#if data.podeGerenciar}
			<Botao href="/agenda/{e.id}/editar" variante="secundario">Editar</Botao>
		{/if}
	{/snippet}
</BarraDeTopo>

<main class="conteudo" style={e.tipo.cor ? `--cor-tipo: ${e.tipo.cor}` : undefined}>
	{#if data.criado}
		<Aviso tom="sucesso" titulo={e.publicado ? 'Evento publicado' : 'Rascunho salvo'}>
			{e.publicado
				? 'Quem foi convidado já vê na agenda. Compartilhe o link no WhatsApp do grupo.'
				: 'Só quem cuida da agenda vê um rascunho. Publique quando estiver pronto.'}
		</Aviso>
	{/if}
	{#if data.salvo}
		<Aviso tom="sucesso">Alterações salvas.</Aviso>
	{/if}
	{#if form?.erro}
		<Aviso tom="erro">{form.erro}</Aviso>
	{/if}
	{#if form?.sucesso}
		<Aviso tom="sucesso">{form.sucesso}</Aviso>
	{/if}

	{#if e.cancelado}
		<Aviso tom="aviso" titulo="Evento cancelado">
			{e.motivoDoCancelamento ?? 'Este evento não vai acontecer.'}
		</Aviso>
	{/if}

	<section class="cartao identidade" aria-label="Evento">
		<div class="chips">
			<Etiqueta cor={e.tipo.cor}>{e.tipo.nome}</Etiqueta>
			{#if !e.publicado}<span class="selo">rascunho</span>{/if}
		</div>
		<h1 class:riscado={e.cancelado}>{e.titulo}</h1>
		<p class="quando">
			<strong>{dataPorExtenso(e.data)}</strong>, {quando}
		</p>
		{#if e.local}<p class="local">📍 {e.local}</p>{/if}
		{#if e.grupo}
			<p class="grupo">Encontro do <a href="/grupos/{e.grupo.id}">{e.grupo.nome}</a></p>
		{/if}
		{#if e.descricao}<p class="descricao">{e.descricao}</p>{/if}
	</section>

	{#if e.publicado && (data.resposta.podeResponder || data.resposta.totais.length > 0)}
		<section class="cartao" aria-label="Você vai?">
			<VoceVai painel={data.resposta} acao="?/responder" />
		</section>
	{/if}

	{#if data.confirmacao || data.podeFazerLista}
		<section class="cartao" aria-label="Presença">
			<h3>Presença</h3>
			{#if data.confirmacao}
				<!-- RF-06.4: confirmação × presença, depois da lista feita. -->
				<dl class="numeros">
					<div>
						<dt>Confirmaram</dt>
						<dd>{data.confirmacao.confirmaram}</dd>
					</div>
					<div>
						<dt>Vieram</dt>
						<dd>{data.confirmacao.vieram}</dd>
					</div>
					<div>
						<dt>Confirmaram e vieram</dt>
						<dd>{data.confirmacao.confirmaramEVieram}</dd>
					</div>
					<div>
						<dt>Vieram sem confirmar</dt>
						<dd>{data.confirmacao.vieramSemConfirmar}</dd>
					</div>
				</dl>
			{:else if e.listaFeitaEm === null}
				<p class="legenda">A lista ainda não foi feita. Sem lista, ninguém conta como ausente.</p>
			{/if}
			{#if data.podeFazerLista}
				<Botao href="/agenda/{e.id}/presenca" variante={e.listaFeitaEm ? 'secundario' : 'primario'}>
					{e.listaFeitaEm ? 'Rever a lista de presença' : 'Fazer a lista de presença'}
				</Botao>
			{/if}
		</section>
	{/if}

	<section class="cartao" aria-label="Convidados">
		<h3>Quem está convidado</h3>
		<ul class="publico">
			{#each e.publico as alvo (alvo.tipo + alvo.nome)}
				<li>{alvo.nome}</li>
			{/each}
		</ul>
		{#if e.responsavel}
			<p class="legenda">Responsável: {e.responsavel.nome}</p>
		{/if}
	</section>

	{#if data.quemRespondeu && data.quemRespondeu.length > 0}
		<section class="cartao" aria-label="Quem respondeu">
			<h3>Quem respondeu</h3>
			<ul class="respostas">
				{#each data.quemRespondeu as r (r.personId)}
					<li>
						<a href="/pessoas/{r.personId}">{r.nome}</a>
						<span class="resposta {r.significado}">
							{r.texto}{#if r.convidados > 0}&nbsp;+{r.convidados}{/if}
						</span>
					</li>
				{/each}
			</ul>
		</section>
	{/if}

	{#if data.compartilhar}
		<section class="cartao" aria-label="Compartilhar">
			<h3>Compartilhar</h3>
			<Botao href={data.compartilhar.whatsapp} variante="primario" target="_blank" rel="noopener">
				Compartilhar no WhatsApp
			</Botao>
			<label class="link">
				<span>Link do evento</span>
				<input type="text" readonly value={data.compartilhar.link} />
			</label>
			<p class="legenda">Abre sem login, só com as informações do evento — nunca com quem vai.</p>
		</section>
	{/if}

	{#if e.serieId && data.podeGerenciar}
		<section class="cartao" aria-label="Encontro semanal">
			<h3>Encontro semanal</h3>
			<p class="legenda">
				{#if e.ehExcecao}
					Esta data foi ajustada à parte: mudanças no encontro semanal não a alteram.
				{:else}
					Esta data faz parte de um encontro que se repete. Editar aqui muda só esta data.
				{/if}
			</p>
			<Botao href="/agenda/series/{e.serieId}" variante="secundario">Ver o encontro semanal</Botao>
		</section>
	{/if}

	{#if data.podeGerenciar || (data.podePublicar && !e.publicado)}
		<section class="cartao" aria-label="Ações">
			{#if data.podePublicar && !e.publicado && !e.cancelado}
				<form method="POST" action="?/publicar" use:enhance={comCarregamento('publicar')}>
					<Botao tipo="submit" carregando={enviando === 'publicar'}>Publicar</Botao>
				</form>
			{/if}

			{#if data.podeGerenciar}
				{#if e.cancelado}
					<form method="POST" action="?/reativar" use:enhance={comCarregamento('reativar')}>
						<Botao tipo="submit" variante="secundario" carregando={enviando === 'reativar'}>
							Reativar o evento
						</Botao>
					</form>
				{:else}
					<form
						method="POST"
						action="?/cancelar"
						class="cancelar"
						use:enhance={comCarregamento('cancelar')}
					>
						<Campo
							id="motivo"
							rotulo="Motivo do cancelamento (opcional)"
							ajuda="Aparece para quem abrir o evento, inclusive pelo link."
						/>
						<Botao tipo="submit" variante="destrutivo" carregando={enviando === 'cancelar'}>
							Cancelar este evento
						</Botao>
					</form>
				{/if}
			{/if}
		</section>
	{/if}
</main>

<style>
	.numeros {
		display: grid;
		grid-template-columns: repeat(2, minmax(0, 1fr));
		gap: var(--esp-2);
		margin: 0;
	}

	.numeros div {
		padding: var(--esp-2) var(--esp-3);
		background: var(--cor-superficie-2);
		border-radius: var(--raio);
	}

	.numeros dt {
		font-size: var(--texto-xs);
		color: var(--cor-texto-3);
	}

	.numeros dd {
		margin: 0;
		font-size: var(--texto-xl);
		font-weight: 700;
		font-variant-numeric: tabular-nums;
	}

	.respostas {
		list-style: none;
		padding: 0;
		margin: 0;
		display: flex;
		flex-direction: column;
	}

	.respostas li {
		display: flex;
		justify-content: space-between;
		gap: var(--esp-2);
		padding: var(--esp-2) 0;
		border-bottom: 1px solid var(--cor-linha);
	}

	.respostas li:last-child {
		border-bottom: 0;
	}

	.resposta {
		font-size: var(--texto-sm);
		font-weight: 600;
		color: var(--cor-sucesso);
		white-space: nowrap;
	}

	.resposta.talvez {
		color: var(--cor-aviso);
	}

	.resposta.nao {
		color: var(--cor-texto-3);
	}

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

	.identidade {
		border-top: 4px solid var(--cor-tipo, var(--cor-linha-forte));
		gap: var(--esp-2);
	}

	.chips {
		display: flex;
		align-items: center;
		gap: var(--esp-2);
	}

	.selo {
		font-size: var(--texto-xs);
		font-weight: 600;
		color: var(--cor-texto-2);
		border: 1px dashed var(--cor-linha-forte);
		border-radius: 999px;
		padding: 0 var(--esp-2);
	}

	h1 {
		font-size: var(--texto-2xl);
		overflow-wrap: anywhere;
	}

	.riscado {
		text-decoration: line-through;
		color: var(--cor-texto-3);
	}

	h3 {
		font-size: var(--texto-lg);
	}

	.quando::first-letter {
		text-transform: uppercase;
	}

	.local,
	.grupo {
		color: var(--cor-texto-2);
		overflow-wrap: anywhere;
	}

	.descricao {
		white-space: pre-line;
		font-size: var(--texto-sm);
		color: var(--cor-texto-2);
	}

	.publico {
		margin: 0;
		padding-left: var(--esp-4);
	}

	.legenda {
		font-size: var(--texto-sm);
		color: var(--cor-texto-3);
	}

	.link {
		display: flex;
		flex-direction: column;
		gap: var(--esp-1);
		font-size: var(--texto-sm);
		font-weight: 600;
	}

	.link input {
		min-height: var(--toque-min);
		padding: 0 var(--esp-3);
		border: 1px solid var(--cor-linha-forte);
		border-radius: var(--raio);
		background: var(--cor-superficie-2);
		color: var(--cor-texto);
		font-size: 16px;
	}

	.cancelar {
		display: flex;
		flex-direction: column;
		gap: var(--esp-3);
	}
</style>

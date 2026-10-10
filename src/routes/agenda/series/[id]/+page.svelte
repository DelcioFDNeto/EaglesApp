<script lang="ts">
	import { enhance } from '$app/forms';
	import BarraDeTopo from '$ui/BarraDeTopo.svelte';
	import Botao from '$ui/Botao.svelte';
	import Aviso from '$ui/Aviso.svelte';
	import Campo from '$ui/Campo.svelte';
	import Seletor from '$ui/Seletor.svelte';
	import AreaDeTexto from '$ui/AreaDeTexto.svelte';
	import CartaoDeEvento from '$ui/CartaoDeEvento.svelte';
	import CamposDoConvite from '../../CamposDoConvite.svelte';
	import { DIAS_DA_SEMANA } from '$shared/grupo';
	import { dataPorExtenso, horaCurta } from '$shared/fuso';
	import type { ActionData, PageData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	const s = $derived(data.serie);
	const valores = $derived<Record<string, string>>(form?.valores ?? data.valores);
	const erros = $derived<Record<string, string | undefined>>(form?.erros ?? {});
	const v = (campo: string) => valores[campo] ?? '';

	const frequencia = $derived(
		s.intervaloSemanas === 1
			? `Toda ${DIAS_DA_SEMANA[s.diaDaSemana]?.rotulo.toLowerCase()}`
			: `${DIAS_DA_SEMANA[s.diaDaSemana]?.rotulo}, a cada ${s.intervaloSemanas} semanas`
	);

	const periodo = $derived(
		[`Desde ${dataPorExtenso(s.inicio)}`, s.fim ? `até ${dataPorExtenso(s.fim)}` : null]
			.filter(Boolean)
			.join(' · ')
	);

	let enviando = $state<string | null>(null);
	function comCarregamento(nome: string) {
		return () => {
			enviando = nome;
			return async ({ update }: { update: (o?: { reset?: boolean }) => Promise<void> }) => {
				await update({ reset: false });
				enviando = null;
			};
		};
	}
</script>

<svelte:head>
	<title>{s.titulo} · encontro semanal · Eagles</title>
</svelte:head>

<BarraDeTopo voltar={s.grupo ? `/grupos/${s.grupo.id}` : '/agenda'} />

<main class="conteudo">
	{#if data.criada}
		<Aviso tom="sucesso" titulo="Encontro semanal criado">
			As próximas {12} semanas já estão na agenda{s.publicada
				? ', visíveis para quem foi convidado.'
				: ' como rascunho.'}
		</Aviso>
	{/if}
	{#if form?.erro}
		<Aviso tom="erro">{form.erro}</Aviso>
	{/if}
	{#if form?.sucesso}
		<Aviso tom="sucesso">{form.sucesso}</Aviso>
	{/if}

	<section class="cartao identidade" aria-label="Encontro semanal">
		<p class="eyebrow">
			Encontro semanal{#if !s.publicada}
				· rascunho{/if}
		</p>
		<h1>{s.titulo}</h1>
		<p class="quando">
			{frequencia}, {horaCurta(s.hora)}{#if s.horaFim}–{horaCurta(s.horaFim)}{/if}
		</p>
		<p class="legenda">
			{periodo}
			{#if s.grupo}<span aria-hidden="true"> · </span><a href="/grupos/{s.grupo.id}"
					>{s.grupo.nome}</a
				>{/if}
		</p>
		{#if s.encerrada}<p class="encerrada">Encerrado.</p>{/if}
	</section>

	{#if s.proximas.length > 0}
		<section class="cartao" aria-label="Próximas datas">
			<h3>Próximas datas</h3>
			<ul class="lista">
				{#each s.proximas as evento (evento.id)}
					<li><CartaoDeEvento {evento} mostrarData /></li>
				{/each}
			</ul>
		</section>
	{/if}

	{#if data.podePublicar && !s.publicada && !s.encerrada}
		<section class="cartao" aria-label="Publicar">
			<p class="legenda">Rascunho: só quem cuida da agenda vê estas datas.</p>
			<form method="POST" action="?/publicar" use:enhance={comCarregamento('publicar')}>
				<Botao tipo="submit" carregando={enviando === 'publicar'}>Publicar</Botao>
			</form>
		</section>
	{/if}

	{#if !s.encerrada}
		<section class="cartao" aria-label="Editar o encontro semanal">
			<h3>Mudar todas as datas futuras</h3>
			<p class="legenda">
				Vale para as próximas datas, menos as que foram ajustadas à parte. O passado não muda. Para
				mudar o dia da semana, encerre este encontro e crie outro.
			</p>
			<form
				method="POST"
				action="?/salvar"
				class="formulario"
				use:enhance={comCarregamento('salvar')}
			>
				<Campo id="titulo" rotulo="Título" valor={v('titulo')} erro={erros.titulo} obrigatorio />
				<div class="lado-a-lado">
					<Campo
						id="horaInicio"
						rotulo="Começa"
						tipo="time"
						valor={v('horaInicio')}
						erro={erros.horaInicio}
						obrigatorio
					/>
					<Campo
						id="horaFim"
						rotulo="Termina"
						tipo="time"
						valor={v('horaFim')}
						erro={erros.horaFim}
					/>
				</div>
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
				<Botao tipo="submit" variante="secundario" carregando={enviando === 'salvar'}>
					Salvar para as datas futuras
				</Botao>
			</form>
		</section>

		<section class="cartao" aria-label="Encerrar">
			<h3>Encerrar</h3>
			<p class="legenda">
				As datas a partir do dia escolhido saem da agenda. As que já passaram continuam na história.
			</p>
			<form
				method="POST"
				action="?/encerrar"
				class="formulario"
				use:enhance={comCarregamento('encerrar')}
			>
				<Campo
					id="aPartirDe"
					rotulo="Não acontece mais a partir de"
					tipo="date"
					valor={data.hoje}
					min={data.hoje}
					erro={erros.aPartirDe}
				/>
				<Botao tipo="submit" variante="destrutivo" carregando={enviando === 'encerrar'}>
					Encerrar o encontro semanal
				</Botao>
			</form>
		</section>
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

	.identidade {
		gap: var(--esp-1);
	}

	.eyebrow {
		font-size: var(--texto-xs);
		font-weight: 700;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		color: var(--cor-marca);
	}

	h1 {
		font-size: var(--texto-2xl);
		overflow-wrap: anywhere;
	}

	h3 {
		font-size: var(--texto-lg);
	}

	.quando {
		font-weight: 600;
	}

	.legenda {
		font-size: var(--texto-sm);
		color: var(--cor-texto-3);
		text-wrap: pretty;
	}

	.encerrada {
		font-weight: 600;
		color: var(--cor-aviso);
	}

	.lista {
		list-style: none;
		padding: 0;
		margin: 0;
		display: flex;
		flex-direction: column;
		gap: var(--esp-2);
	}

	.formulario {
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

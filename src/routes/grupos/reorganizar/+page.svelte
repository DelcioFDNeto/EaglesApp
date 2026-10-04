<script lang="ts">
	import { enhance } from '$app/forms';
	import BarraDeTopo from '$ui/BarraDeTopo.svelte';
	import Botao from '$ui/Botao.svelte';
	import Aviso from '$ui/Aviso.svelte';
	import type { ActionData, PageData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	const previa = $derived(form && 'previa' in form ? form.previa : null);
	const escolhas = $derived<Record<string, string>>(
		form && 'escolhas' in form && form.escolhas ? form.escolhas : {}
	);
	const aplicado = $derived(form && 'aplicado' in form ? form.aplicado : null);
	const erro = $derived(form && 'erro' in form ? form.erro : null);

	/** Pessoas agrupadas pelo grupo ATUAL, na ordem da lista de grupos. */
	const secoes = $derived.by(() => {
		const porGrupo = new Map<string, typeof data.pessoas>();
		for (const p of data.pessoas) {
			const chave = p.grupoAtualId ?? '';
			porGrupo.set(chave, [...(porGrupo.get(chave) ?? []), p]);
		}
		return [
			...data.grupos.map((g) => ({
				id: g.valor,
				nome: g.rotulo,
				pessoas: porGrupo.get(g.valor) ?? []
			})),
			{ id: '', nome: 'Sem grupo', pessoas: porGrupo.get('') ?? [] }
		].filter((s) => s.pessoas.length > 0);
	});

	let enviando = $state<'planejar' | 'aplicar' | null>(null);
	function comCarregamento(nome: 'planejar' | 'aplicar') {
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
	<title>Reorganizar os grupos · Eagles</title>
</svelte:head>

<BarraDeTopo voltar="/grupos" />

<main class="conteudo">
	<h1>Reorganizar os grupos</h1>
	<p class="legenda">
		Escolha o destino de cada pessoa e confira antes de aplicar. Nada muda até você confirmar — e
		ninguém é avisado automaticamente: você decide como contar.
	</p>

	{#if aplicado !== null}
		<Aviso tom="sucesso" titulo="Reorganização aplicada">
			{aplicado}
			{aplicado === 1 ? 'mudança registrada' : 'mudanças registradas'}, cada uma na linha do tempo
			da pessoa. <a href="/grupos">Ver os grupos</a>
		</Aviso>
	{/if}

	{#if erro}
		<Aviso tom="erro">{erro}</Aviso>
	{/if}

	{#if previa}
		<section class="cartao conferencia" aria-label="Conferir antes de aplicar">
			<h2>Conferir</h2>

			{#if previa.movimentos.length === 0}
				<p class="legenda">Nenhuma mudança: todos os destinos escolhidos são os grupos atuais.</p>
			{:else}
				<ul class="balanco">
					{#each previa.balanco as b (b.id ?? 'sem-grupo')}
						<li>
							<span class="grupo">{b.nome}</span>
							<span class="numeros">
								{b.antes} → <strong>{b.depois}</strong>
							</span>
							{#if b.entram.length > 0}
								<span class="entram">entram: {b.entram.join(', ')}</span>
							{/if}
							{#if b.saem.length > 0}
								<span class="saem">saem: {b.saem.join(', ')}</span>
							{/if}
						</li>
					{/each}
				</ul>

				<form method="POST" action="?/aplicar" use:enhance={comCarregamento('aplicar')}>
					<fieldset>
						<legend>Mudanças — desmarque o que não quiser aplicar</legend>
						{#each previa.movimentos as m (m.personId)}
							<label class="movimento">
								<input type="checkbox" name="mov" value={m.codigo} checked />
								<span>
									<strong>{m.nome}</strong>
									<span class="trajeto"
										>{m.deNome ?? 'sem grupo'} → {m.paraNome ?? 'sem grupo'}</span
									>
								</span>
							</label>
						{/each}
					</fieldset>
					<Botao tipo="submit" carregando={enviando === 'aplicar'}
						>Aplicar as mudanças marcadas</Botao
					>
				</form>
			{/if}
		</section>
	{/if}

	<form
		method="POST"
		action="?/planejar"
		class="planejamento"
		use:enhance={comCarregamento('planejar')}
	>
		{#each secoes as secao (secao.id)}
			<fieldset class="cartao">
				<legend>{secao.nome} <span class="contagem">({secao.pessoas.length})</span></legend>
				{#each secao.pessoas as p (p.personId)}
					<div class="linha">
						<label for="para-{p.personId}">{p.nome}</label>
						<input type="hidden" name="de-{p.personId}" value={p.grupoAtualId ?? ''} />
						<select
							id="para-{p.personId}"
							name="para-{p.personId}"
							value={escolhas[p.personId] ?? p.grupoAtualId ?? ''}
						>
							{#each data.grupos as g (g.valor)}
								<option value={g.valor}>{g.rotulo}</option>
							{/each}
							<option value="">Sem grupo</option>
						</select>
					</div>
				{/each}
			</fieldset>
		{/each}

		<div class="acoes">
			<Botao tipo="submit" variante="secundario" carregando={enviando === 'planejar'}>
				Ver o que muda
			</Botao>
		</div>
	</form>
</main>

<style>
	.conteudo {
		max-width: 640px;
		margin-inline: auto;
		padding: var(--esp-4) var(--esp-3) var(--esp-6);
		display: flex;
		flex-direction: column;
		gap: var(--esp-4);
	}

	h1 {
		font-size: var(--texto-2xl);
	}

	h2 {
		font-size: var(--texto-xl);
	}

	.legenda {
		font-size: var(--texto-sm);
		color: var(--cor-texto-3);
		text-wrap: pretty;
	}

	.cartao {
		background: var(--cor-superficie);
		border: 1px solid var(--cor-linha);
		border-radius: var(--raio-lg);
		padding: var(--esp-4);
		display: flex;
		flex-direction: column;
		gap: var(--esp-2);
		margin: 0;
	}

	.conferencia {
		border-color: var(--cor-marca);
	}

	legend {
		font-weight: 700;
		padding: 0 var(--esp-1);
	}

	.contagem {
		font-weight: 400;
		color: var(--cor-texto-3);
	}

	.planejamento {
		display: flex;
		flex-direction: column;
		gap: var(--esp-3);
	}

	.linha {
		display: grid;
		grid-template-columns: 1fr minmax(8rem, 12rem);
		align-items: center;
		gap: var(--esp-2);
		padding: var(--esp-1) 0;
		border-bottom: 1px solid var(--cor-linha);
	}

	.linha:last-child {
		border-bottom: 0;
	}

	.linha label {
		font-size: var(--texto-sm);
		overflow-wrap: anywhere;
	}

	select {
		width: 100%;
		min-height: var(--toque-min);
		padding: 0 var(--esp-2);
		background: var(--cor-superficie);
		color: var(--cor-texto);
		border: 1px solid var(--cor-linha-forte);
		border-radius: var(--raio);
		font-size: 16px;
	}

	select:focus-visible,
	.movimento:has(input:focus-visible) {
		outline: 2px solid var(--cor-foco);
		outline-offset: 2px;
	}

	.acoes {
		display: flex;
		justify-content: flex-end;
	}

	.balanco {
		list-style: none;
		padding: 0;
		margin: 0;
		display: flex;
		flex-direction: column;
		gap: var(--esp-2);
	}

	.balanco li {
		display: flex;
		flex-wrap: wrap;
		align-items: baseline;
		gap: var(--esp-1) var(--esp-3);
		padding-bottom: var(--esp-2);
		border-bottom: 1px solid var(--cor-linha);
	}

	.grupo {
		font-weight: 700;
	}

	.numeros {
		font-variant-numeric: tabular-nums;
	}

	.entram,
	.saem {
		flex-basis: 100%;
		font-size: var(--texto-sm);
		color: var(--cor-texto-2);
	}

	form fieldset {
		border: 0;
		padding: 0;
		margin: 0 0 var(--esp-3);
		display: flex;
		flex-direction: column;
		gap: var(--esp-1);
	}

	.movimento {
		display: flex;
		align-items: center;
		gap: var(--esp-3);
		min-height: var(--toque-min);
		cursor: pointer;
	}

	.movimento input {
		width: 1.25rem;
		height: 1.25rem;
		accent-color: var(--cor-marca);
		flex: none;
	}

	.movimento span {
		display: flex;
		flex-direction: column;
	}

	.trajeto {
		font-size: var(--texto-sm);
		color: var(--cor-texto-2);
	}
</style>

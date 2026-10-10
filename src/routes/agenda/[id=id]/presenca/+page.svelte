<script lang="ts">
	import { enhance } from '$app/forms';
	import BarraDeTopo from '$ui/BarraDeTopo.svelte';
	import Botao from '$ui/Botao.svelte';
	import Aviso from '$ui/Aviso.svelte';
	import Campo from '$ui/Campo.svelte';
	import { dataPorExtenso, horaCurta } from '$shared/fuso';
	import type { ActionData, PageData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	const e = $derived(data.evento);
	/** Depois de uma recusa, as marcações que a pessoa fez voltam para a tela. */
	const marcado = (id: string, presente: boolean) =>
		form && 'presentes' in form && form.presentes ? form.presentes.includes(id) : presente;
	const valores = $derived<Record<string, string>>(
		(form && 'valores' in form && form.valores) || {}
	);
	const erros = $derived<Record<string, string | undefined>>(
		(form && 'erros' in form && form.erros) || {}
	);
	const valor = (campo: string) => valores[campo] ?? '';
	const erro = (campo: string) => erros[campo];

	let enviando = $state(false);
</script>

<svelte:head>
	<title>Presença · {e.titulo} · Eagles</title>
</svelte:head>

<BarraDeTopo voltar="/agenda/{e.id}" />

<main class="conteudo">
	<header>
		<p class="eyebrow">Lista de presença</p>
		<h1>{e.titulo}</h1>
		<p class="quando">{dataPorExtenso(e.data)}, {horaCurta(e.hora)}</p>
	</header>

	{#if form && 'sucesso' in form && form.sucesso}
		<Aviso tom="sucesso">{form.sucesso}</Aviso>
	{/if}
	{#if form && 'erro' in form && form.erro}
		<Aviso tom="erro">{form.erro}</Aviso>
	{/if}

	{#if e.cancelado}
		<Aviso tom="aviso" titulo="Evento cancelado">Evento cancelado não tem lista de presença.</Aviso>
	{:else if !e.jaComecou}
		<Aviso tom="info" titulo="Ainda não é o dia">
			A lista se faz no dia do encontro ou depois. Antes disso, ela diria que alguém faltou a algo
			que ainda vai acontecer.
		</Aviso>
	{:else}
		<p class="legenda">
			Toque em quem veio e salve no fim — vai tudo de uma vez. Quem não estiver marcado conta como
			ausente <strong>neste</strong> encontro; sem lista feita, ninguém conta.
		</p>

		<form
			method="POST"
			use:enhance={({ formElement }) => {
				enviando = true;
				return async ({ result, update }) => {
					// `reset: false`: se o envio falhar, as marcações ficam na tela.
					await update({ reset: false });
					// Salvou: quem chegou na porta já está na lista — os campos
					// esvaziam, senão um segundo "salvar" o cadastraria de novo.
					if (result.type === 'success') {
						for (const campo of ['visitanteNome', 'visitanteNascimento', 'visitanteWhatsapp']) {
							const el = formElement.elements.namedItem(campo);
							if (el instanceof HTMLInputElement) el.value = '';
						}
					}
					enviando = false;
				};
			}}
		>
			<fieldset class="lista">
				<legend>Esperados ({data.esperados.length})</legend>
				{#each data.esperados as p (p.personId)}
					<label class="pessoa">
						<input
							type="checkbox"
							name="presentes"
							value={p.personId}
							checked={marcado(p.personId, p.presente)}
						/>
						<span class="nome">{p.nome}</span>
						{#if p.resposta}
							<span class="resposta {p.resposta.significado}">
								{p.resposta.texto}{#if p.resposta.convidados > 0}&nbsp;+{p.resposta.convidados}{/if}
							</span>
						{/if}
						{#if p.percentual !== null}<span class="freq">{p.percentual}%</span>{/if}
					</label>
				{:else}
					<p class="legenda">Ninguém estava convidado para este evento.</p>
				{/each}
			</fieldset>

			{#if data.alemDoEsperado.length > 0}
				<fieldset class="lista">
					<legend>Também vieram</legend>
					{#each data.alemDoEsperado as p (p.personId)}
						<label class="pessoa">
							<input
								type="checkbox"
								name="presentes"
								value={p.personId}
								checked={marcado(p.personId, true)}
							/>
							<span class="nome">{p.nome}</span>
							{#if p.grupo}<span class="freq">{p.grupo}</span>{/if}
						</label>
					{/each}
				</fieldset>
			{/if}

			<!-- `details` nativo: abre sem JavaScript. -->
			<details>
				<summary>Mais alguém veio?</summary>
				<div class="lista">
					{#each data.outros as p (p.personId)}
						<label class="pessoa">
							<input
								type="checkbox"
								name="presentes"
								value={p.personId}
								checked={marcado(p.personId, false)}
							/>
							<span class="nome">{p.nome}</span>
							{#if p.grupo}<span class="freq">{p.grupo}</span>{/if}
						</label>
					{/each}
				</div>
			</details>

			<fieldset class="na-porta">
				<legend>Chegou alguém pela primeira vez?</legend>
				<p class="legenda">
					Só o nome basta. Entra {e.grupo ? `no ${e.grupo.nome}` : 'na equipe'}, já presente.
				</p>
				<Campo
					id="visitanteNome"
					rotulo="Nome"
					valor={valor('visitanteNome')}
					erro={erro('visitanteNome')}
					autocomplete="off"
				/>
				<Campo
					id="visitanteNascimento"
					rotulo="Data de nascimento (opcional)"
					tipo="date"
					valor={valor('visitanteNascimento')}
					erro={erro('visitanteNascimento')}
				/>
				<Campo
					id="visitanteWhatsapp"
					rotulo="WhatsApp (opcional)"
					tipo="tel"
					inputmode="tel"
					valor={valor('visitanteWhatsapp')}
					erro={erro('visitanteWhatsapp')}
					ajuda="Só é guardado com a data de nascimento de quem é maior de idade."
				/>
			</fieldset>

			<div class="salvar">
				<Botao tipo="submit" carregando={enviando}>Salvar a lista</Botao>
			</div>
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

	.quando::first-letter {
		text-transform: uppercase;
	}

	.legenda {
		font-size: var(--texto-sm);
		color: var(--cor-texto-3);
		text-wrap: pretty;
	}

	form {
		display: flex;
		flex-direction: column;
		gap: var(--esp-4);
	}

	fieldset {
		border: 0;
		padding: 0;
		margin: 0;
	}

	legend {
		font-weight: 700;
		margin-bottom: var(--esp-2);
	}

	.lista {
		display: flex;
		flex-direction: column;
		background: var(--cor-superficie);
		border: 1px solid var(--cor-linha);
		border-radius: var(--raio-lg);
		padding: var(--esp-1) var(--esp-3);
	}

	fieldset.lista legend {
		padding-top: var(--esp-3);
	}

	.pessoa {
		display: flex;
		align-items: center;
		gap: var(--esp-3);
		min-height: 3.25rem;
		border-bottom: 1px solid var(--cor-linha);
		cursor: pointer;
	}

	.pessoa:last-child {
		border-bottom: 0;
	}

	.pessoa input {
		width: 1.5rem;
		height: 1.5rem;
		accent-color: var(--cor-marca);
		flex: none;
	}

	.pessoa:has(input:focus-visible) {
		outline: 2px solid var(--cor-foco);
		outline-offset: 2px;
	}

	.pessoa:has(input:checked) .nome {
		font-weight: 700;
	}

	.nome {
		flex: 1;
		min-width: 0;
		overflow-wrap: anywhere;
	}

	.resposta {
		font-size: var(--texto-xs);
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

	.freq {
		font-size: var(--texto-xs);
		color: var(--cor-texto-3);
		font-variant-numeric: tabular-nums;
		white-space: nowrap;
	}

	details summary {
		cursor: pointer;
		font-weight: 600;
		min-height: var(--toque-min);
		display: flex;
		align-items: center;
	}

	.na-porta {
		display: flex;
		flex-direction: column;
		gap: var(--esp-3);
		padding: var(--esp-3);
		border: 1px solid var(--cor-linha);
		border-radius: var(--raio-lg);
		background: var(--cor-superficie-2);
	}

	.salvar {
		position: sticky;
		bottom: calc(56px + env(safe-area-inset-bottom) + var(--esp-2));
	}
</style>

<script lang="ts">
	import { enhance } from '$app/forms';

	/**
	 * "Você vai?" — RSVP em um toque (F2, RF-06.1).
	 *
	 * Cada resposta é um botão do mesmo formulário: um toque, uma ida ao
	 * servidor, e funciona sem JavaScript. Com JavaScript, a escolha aparece
	 * marcada NA HORA (RNF-02: menos de 300 ms percebidos) e volta atrás se o
	 * servidor recusar.
	 */
	export type PainelDaTela = {
		podeResponder: boolean;
		respostas: { id: string; texto: string; significado: string; aceitaConvidados: boolean }[];
		minha: { respostaId: string; convidados: number } | null;
		totais: {
			respostaId: string;
			texto: string;
			significado: string;
			pessoas: number;
			convidados: number;
		}[];
	};

	let {
		painel,
		acao,
		titulo = 'Você vai?'
	}: {
		painel: PainelDaTela;
		/** Endereço da ação — `?/responder` ou a de outra página. */
		acao: string;
		titulo?: string;
	} = $props();

	let escolhida = $state<string | null>(null);
	let erro = $state<string | null>(null);
	const atual = $derived(escolhida ?? painel.minha?.respostaId ?? null);
	const aceitaConvidados = $derived(painel.respostas.some((r) => r.aceitaConvidados));

	const resumo = $derived.by(() => {
		const por = (s: string) =>
			painel.totais.filter((t) => t.significado === s).reduce((n, t) => n + t.pessoas, 0);
		const convidados = painel.totais.reduce((n, t) => n + t.convidados, 0);
		const partes = [
			por('sim') ? `${por('sim')} ${por('sim') === 1 ? 'vai' : 'vão'}` : null,
			por('talvez') ? `${por('talvez')} talvez` : null,
			por('nao') ? `${por('nao')} não ${por('nao') === 1 ? 'vai' : 'vão'}` : null,
			convidados ? `+${convidados} ${convidados === 1 ? 'convidado' : 'convidados'}` : null
		].filter(Boolean);
		return partes.join(' · ');
	});
</script>

{#if painel.podeResponder && painel.respostas.length > 0}
	<form
		class="voce-vai"
		method="POST"
		action={acao}
		use:enhance={({ submitter }) => {
			const anterior = escolhida;
			escolhida = (submitter as HTMLButtonElement | null)?.value ?? null;
			erro = null;
			return async ({ result, update }) => {
				if (result.type === 'failure' || result.type === 'error') {
					escolhida = anterior;
					erro = 'Não deu para registrar. Tente de novo.';
				}
				await update({ reset: false });
				if (result.type === 'success') escolhida = null;
			};
		}}
	>
		<p class="titulo">{titulo}</p>
		<div class="botoes" role="group" aria-label={titulo}>
			{#each painel.respostas as r (r.id)}
				<button
					type="submit"
					name="respostaId"
					value={r.id}
					class="resposta {r.significado}"
					aria-pressed={atual === r.id}
				>
					{r.texto}
				</button>
			{/each}
		</div>
		{#if aceitaConvidados}
			<label class="convidados">
				<span>Levo mais</span>
				<input
					type="number"
					name="convidados"
					min="0"
					max="20"
					inputmode="numeric"
					value={painel.minha?.convidados ?? 0}
				/>
				<span>pessoa(s)</span>
			</label>
		{/if}
		{#if erro}<p class="erro" role="alert">{erro}</p>{/if}
		{#if resumo}<p class="resumo">{resumo}</p>{/if}
	</form>
{:else if resumo}
	<p class="resumo">{resumo}</p>
{/if}

<style>
	.voce-vai {
		display: flex;
		flex-direction: column;
		gap: var(--esp-2);
	}

	.titulo {
		font-weight: 700;
	}

	.botoes {
		display: flex;
		flex-wrap: wrap;
		gap: var(--esp-2);
	}

	.resposta {
		min-height: var(--toque-min);
		padding: 0 var(--esp-3);
		border: 1px solid var(--cor-linha-forte);
		border-radius: 999px;
		background: var(--cor-superficie);
		color: var(--cor-texto);
		font: inherit;
		font-weight: 600;
		cursor: pointer;
		transition:
			background var(--transicao),
			border-color var(--transicao);
	}

	.resposta:hover {
		border-color: var(--cor-marca);
	}

	.resposta:focus-visible {
		outline: 2px solid var(--cor-foco);
		outline-offset: 2px;
	}

	.resposta[aria-pressed='true'] {
		background: var(--cor-marca);
		border-color: var(--cor-marca);
		color: var(--cor-sobre-marca);
	}

	.resposta.nao[aria-pressed='true'] {
		background: var(--cor-texto-2);
		border-color: var(--cor-texto-2);
	}

	.convidados {
		display: flex;
		align-items: center;
		gap: var(--esp-2);
		font-size: var(--texto-sm);
		color: var(--cor-texto-2);
	}

	.convidados input {
		width: 4.5rem;
		min-height: var(--toque-min);
		padding: 0 var(--esp-2);
		border: 1px solid var(--cor-linha-forte);
		border-radius: var(--raio);
		background: var(--cor-superficie);
		color: var(--cor-texto);
		font-size: 16px;
	}

	.resumo {
		font-size: var(--texto-sm);
		color: var(--cor-texto-2);
	}

	.erro {
		font-size: var(--texto-sm);
		color: var(--cor-erro);
	}
</style>

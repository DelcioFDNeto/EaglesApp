<script lang="ts">
	import { dataPorExtenso, horaCurta } from '$shared/fuso';

	/**
	 * Um evento numa lista — agenda, início, tela do grupo.
	 *
	 * Recebe data e hora JÁ no fuso da equipe, calculadas no servidor
	 * (D-M05-3): a tela não converte nada, então não há como mostrar uma hora
	 * antes de hidratar e outra depois.
	 */
	export type EventoDoCartao = {
		id: string;
		titulo: string;
		tipo: { nome: string; cor: string | null };
		data: string;
		hora: string;
		horaFim: string | null;
		local: string | null;
		grupo: { nome: string } | null;
		cancelado: boolean;
		publicado: boolean;
	};

	let {
		evento,
		mostrarData = false
	}: {
		evento: EventoDoCartao;
		/** Na agenda, a data já está no cabeçalho do dia. */
		mostrarData?: boolean;
	} = $props();

	// O que já está no título não se repete: "PG Azul" do PG Azul, ou a
	// "Reunião de liderança" do tipo Reunião de liderança.
	const detalhes = $derived(
		[
			evento.tipo.nome !== evento.titulo ? evento.tipo.nome : null,
			evento.grupo && evento.grupo.nome !== evento.titulo ? evento.grupo.nome : null,
			evento.local
		].filter((d): d is string => !!d)
	);

	const quando = $derived(
		evento.horaFim
			? `${horaCurta(evento.hora)}–${horaCurta(evento.horaFim)}`
			: horaCurta(evento.hora)
	);
</script>

<a
	class="cartao"
	class:cancelado={evento.cancelado}
	href="/agenda/{evento.id}"
	style={evento.tipo.cor ? `--cor-tipo: ${evento.tipo.cor}` : undefined}
>
	<span class="quando">
		{#if mostrarData}<span class="dia">{dataPorExtenso(evento.data)}</span>{/if}
		<span class="hora">{quando}</span>
	</span>
	<span class="corpo">
		<span class="titulo">{evento.titulo}</span>
		<span class="meta">
			{#each detalhes as detalhe, i (i)}
				{#if i > 0}<span aria-hidden="true">·</span>{/if}<span class="detalhe">{detalhe}</span>
			{/each}
		</span>
		{#if evento.cancelado || !evento.publicado}
			<span class="selos">
				{#if evento.cancelado}<span class="selo selo-cancelado">cancelado</span>{/if}
				{#if !evento.publicado}<span class="selo">rascunho</span>{/if}
			</span>
		{/if}
	</span>
</a>

<style>
	.cartao {
		display: grid;
		grid-template-columns: minmax(4.5rem, auto) 1fr;
		gap: var(--esp-3);
		padding: var(--esp-3);
		background: var(--cor-superficie);
		border: 1px solid var(--cor-linha);
		border-left: 4px solid var(--cor-tipo, var(--cor-linha-forte));
		border-radius: var(--raio);
		color: inherit;
		text-decoration: none;
		transition: border-color var(--transicao);
	}

	.cartao:hover {
		border-color: var(--cor-marca);
		border-left-color: var(--cor-tipo, var(--cor-marca));
	}

	.cartao:focus-visible {
		outline: 2px solid var(--cor-foco);
		outline-offset: 2px;
	}

	.cancelado .titulo {
		text-decoration: line-through;
		color: var(--cor-texto-3);
	}

	.quando {
		display: flex;
		flex-direction: column;
		font-variant-numeric: tabular-nums;
	}

	.dia {
		font-size: var(--texto-xs);
		color: var(--cor-texto-3);
	}

	.hora {
		font-weight: 700;
	}

	.corpo {
		display: flex;
		flex-direction: column;
		gap: var(--esp-1);
		min-width: 0;
	}

	.titulo {
		font-weight: 600;
		overflow-wrap: anywhere;
	}

	.meta {
		display: flex;
		flex-wrap: wrap;
		gap: 0 var(--esp-2);
		font-size: var(--texto-sm);
		color: var(--cor-texto-2);
	}

	.detalhe {
		overflow-wrap: anywhere;
	}

	.selos {
		display: flex;
		gap: var(--esp-1);
	}

	.selo {
		font-size: var(--texto-xs);
		font-weight: 600;
		color: var(--cor-texto-2);
		border: 1px dashed var(--cor-linha-forte);
		border-radius: 999px;
		padding: 0 var(--esp-2);
	}

	.selo-cancelado {
		color: var(--cor-erro);
		border: 1px solid currentColor;
	}
</style>

<script lang="ts">
	let {
		id,
		rotulo,
		valor = $bindable(''),
		erro = undefined,
		ajuda = undefined,
		linhas = 4,
		...resto
	}: {
		id: string;
		rotulo: string;
		valor?: string;
		erro?: string;
		ajuda?: string;
		linhas?: number;
		[key: string]: unknown;
	} = $props();

	const idAjuda = $derived(`${id}-ajuda`);
	const idErro = $derived(`${id}-erro`);
	const descritoPor = $derived(
		[erro ? idErro : null, ajuda ? idAjuda : null].filter(Boolean).join(' ') || undefined
	);
</script>

<div class="campo">
	<label for={id}>{rotulo}</label>

	<textarea
		{id}
		name={id}
		rows={linhas}
		bind:value={valor}
		class:invalido={!!erro}
		aria-invalid={erro ? 'true' : undefined}
		aria-describedby={descritoPor}
		{...resto}
	></textarea>

	{#if ajuda}
		<p id={idAjuda} class="ajuda">{ajuda}</p>
	{/if}

	{#if erro}
		<p id={idErro} class="erro" role="alert">{erro}</p>
	{/if}
</div>

<style>
	.campo {
		display: flex;
		flex-direction: column;
		gap: var(--esp-2);
	}

	label {
		font-size: var(--texto-sm);
		font-weight: 600;
		color: var(--cor-texto-2);
	}

	textarea {
		padding: var(--esp-3);
		background: var(--cor-superficie);
		color: var(--cor-texto);
		border: 1px solid var(--cor-linha-forte);
		border-radius: var(--raio);
		font-size: 16px;
		font-family: inherit;
		resize: vertical;
		transition: border-color var(--transicao);
	}

	textarea.invalido {
		border-color: var(--cor-erro);
	}

	textarea:focus-visible {
		outline: 2px solid var(--cor-foco);
		outline-offset: 2px;
	}

	.ajuda {
		font-size: var(--texto-sm);
		color: var(--cor-texto-3);
	}

	.erro {
		font-size: var(--texto-sm);
		color: var(--cor-erro);
	}
</style>

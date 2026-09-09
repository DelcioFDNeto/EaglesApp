<script lang="ts">
	let {
		id,
		rotulo,
		valor = $bindable(''),
		opcoes,
		vazio = undefined,
		erro = undefined,
		ajuda = undefined,
		obrigatorio = false,
		...resto
	}: {
		id: string;
		rotulo: string;
		valor?: string;
		opcoes: ReadonlyArray<{ valor: string; rotulo: string }>;
		/** Texto da opção neutra. Ausente = o campo não aceita "nenhum". */
		vazio?: string;
		erro?: string;
		ajuda?: string;
		obrigatorio?: boolean;
		[key: string]: unknown;
	} = $props();

	const idAjuda = $derived(`${id}-ajuda`);
	const idErro = $derived(`${id}-erro`);
	const descritoPor = $derived(
		[erro ? idErro : null, ajuda ? idAjuda : null].filter(Boolean).join(' ') || undefined
	);
</script>

<div class="campo">
	<label for={id}>
		{rotulo}
		{#if obrigatorio}<span class="obrigatorio" aria-hidden="true">*</span>{/if}
	</label>

	<select
		{id}
		name={id}
		bind:value={valor}
		class:invalido={!!erro}
		aria-invalid={erro ? 'true' : undefined}
		aria-describedby={descritoPor}
		{...resto}
	>
		{#if vazio !== undefined}
			<option value="">{vazio}</option>
		{/if}
		{#each opcoes as opcao (opcao.valor)}
			<option value={opcao.valor}>{opcao.rotulo}</option>
		{/each}
	</select>

	{#if ajuda}
		<p id={idAjuda} class="ajuda">{ajuda}</p>
	{/if}

	{#if erro}
		<p id={idErro} class="erro" role="alert">
			<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
				<circle cx="8" cy="8" r="7" fill="none" stroke="currentColor" stroke-width="1.5" />
				<path
					d="M8 4.5v4.2M8 11.2v.6"
					stroke="currentColor"
					stroke-width="1.6"
					stroke-linecap="round"
				/>
			</svg>
			{erro}
		</p>
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

	.obrigatorio {
		color: var(--cor-marca);
		margin-left: 2px;
	}

	select {
		min-height: var(--toque-min);
		padding: 0 var(--esp-3);
		background: var(--cor-superficie);
		color: var(--cor-texto);
		border: 1px solid var(--cor-linha-forte);
		border-radius: var(--raio);
		/* 16px evita o zoom automático do Safari no iPhone ao focar. */
		font-size: 16px;
		transition: border-color var(--transicao);
	}

	select:hover {
		border-color: var(--cor-texto-3);
	}

	select.invalido {
		border-color: var(--cor-erro);
	}

	select:focus-visible {
		outline: 2px solid var(--cor-foco);
		outline-offset: 2px;
	}

	.ajuda {
		font-size: var(--texto-sm);
		color: var(--cor-texto-3);
	}

	.erro {
		display: flex;
		align-items: center;
		gap: var(--esp-2);
		font-size: var(--texto-sm);
		color: var(--cor-erro);
	}
</style>

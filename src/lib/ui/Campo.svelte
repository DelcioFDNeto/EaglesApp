<script lang="ts">
	let {
		id,
		rotulo,
		tipo = 'text',
		valor = $bindable(''),
		erro = undefined,
		ajuda = undefined,
		obrigatorio = false,
		autocomplete = undefined,
		inputmode = undefined,
		...resto
	}: {
		id: string;
		rotulo: string;
		tipo?: 'text' | 'email' | 'password' | 'tel' | 'date';
		valor?: string;
		erro?: string;
		ajuda?: string;
		obrigatorio?: boolean;
		autocomplete?: AutoFill;
		inputmode?: 'text' | 'email' | 'tel' | 'numeric';
		[key: string]: unknown;
	} = $props();

	const idAjuda = $derived(`${id}-ajuda`);
	const idErro = $derived(`${id}-erro`);

	// O input aponta para a mensagem de erro E para a de ajuda, para o leitor
	// de tela anunciar as duas quando existirem.
	const descritoPor = $derived(
		[erro ? idErro : null, ajuda ? idAjuda : null].filter(Boolean).join(' ') || undefined
	);
</script>

<div class="campo">
	<label for={id}>
		{rotulo}
		{#if obrigatorio}<span class="obrigatorio" aria-hidden="true">*</span>{/if}
	</label>

	<input
		{id}
		name={id}
		type={tipo}
		bind:value={valor}
		class:invalido={!!erro}
		aria-invalid={erro ? 'true' : undefined}
		aria-describedby={descritoPor}
		aria-required={obrigatorio || undefined}
		{autocomplete}
		{inputmode}
		{...resto}
	/>

	{#if ajuda}
		<p id={idAjuda} class="ajuda">{ajuda}</p>
	{/if}

	{#if erro}
		<!-- Ícone + texto: o erro nunca é comunicado só pela cor (RNF-12). -->
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

	input {
		min-height: var(--toque-min);
		padding: 0 var(--esp-3);

		background: var(--cor-superficie);
		color: var(--cor-texto);
		border: 1px solid var(--cor-linha-forte);
		border-radius: var(--raio);

		/* 16px evita o zoom automático do Safari no iPhone ao focar o campo. */
		font-size: 16px;

		transition: border-color var(--transicao);
	}

	input:hover {
		border-color: var(--cor-texto-3);
	}

	input:disabled {
		background: var(--cor-superficie-2);
		opacity: 0.7;
		cursor: not-allowed;
	}

	input.invalido {
		border-color: var(--cor-erro);
	}

	.ajuda {
		font-size: var(--texto-sm);
		color: var(--cor-texto-3);
	}

	.erro {
		display: flex;
		align-items: center;
		gap: var(--esp-1);
		font-size: var(--texto-sm);
		font-weight: 500;
		color: var(--cor-erro);
	}

	.erro svg {
		flex: none;
	}
</style>

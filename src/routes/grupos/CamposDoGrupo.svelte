<script lang="ts">
	import Campo from '$ui/Campo.svelte';
	import AreaDeTexto from '$ui/AreaDeTexto.svelte';
	import Seletor from '$ui/Seletor.svelte';
	import { CORES_DE_GRUPO, DIAS_DA_SEMANA } from '$shared/grupo';

	/**
	 * Campos do grupo, compartilhados por "novo" e "editar".
	 *
	 * A cor é um grupo de botões de rádio nativos, e não um seletor de cor:
	 * funciona sem JavaScript, é acessível por teclado e mantém a paleta
	 * fechada (ver `CORES_DE_GRUPO`).
	 */
	let {
		valores,
		erros = {}
	}: {
		valores: Record<string, string>;
		erros?: Record<string, string | undefined>;
	} = $props();
</script>

<Campo
	id="name"
	rotulo="Nome do grupo"
	valor={valores.name ?? ''}
	erro={erros.name}
	obrigatorio
	ajuda="Como a comunidade chama o grupo — “PG Azul”, “PG de quinta”."
/>

<fieldset class="cores">
	<legend>Cor</legend>
	<div class="opcoes">
		<label class="cor">
			<input type="radio" name="color" value="" checked={!valores.color} />
			<span class="amostra sem" aria-hidden="true"></span>
			<span>Sem cor</span>
		</label>
		{#each CORES_DE_GRUPO as c (c.valor)}
			<label class="cor">
				<input type="radio" name="color" value={c.valor} checked={valores.color === c.valor} />
				<span class="amostra" style="background: {c.valor}" aria-hidden="true"></span>
				<span>{c.rotulo}</span>
			</label>
		{/each}
	</div>
	{#if erros.color}<p class="erro">{erros.color}</p>{/if}
</fieldset>

<div class="lado-a-lado">
	<Seletor
		id="meetingWeekday"
		rotulo="Dia do encontro"
		opcoes={DIAS_DA_SEMANA}
		valor={valores.meetingWeekday ?? ''}
		erro={erros.meetingWeekday}
		vazio="Ainda não definido"
	/>
	<Campo
		id="meetingTime"
		rotulo="Horário"
		tipo="time"
		valor={valores.meetingTime ?? ''}
		erro={erros.meetingTime}
	/>
</div>

<Campo id="location" rotulo="Local" valor={valores.location ?? ''} erro={erros.location} />

<AreaDeTexto
	id="description"
	rotulo="Descrição (opcional)"
	valor={valores.description ?? ''}
	erro={erros.description}
	linhas={3}
/>

<style>
	.cores {
		border: 0;
		padding: 0;
		margin: 0;
		display: flex;
		flex-direction: column;
		gap: var(--esp-2);
	}

	legend {
		font-size: var(--texto-sm);
		font-weight: 600;
		margin-bottom: var(--esp-2);
	}

	.opcoes {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(7.5rem, 1fr));
		gap: var(--esp-2);
	}

	.cor {
		display: flex;
		align-items: center;
		gap: var(--esp-2);
		min-height: var(--toque-min);
		padding: 0 var(--esp-2);
		border: 1px solid var(--cor-linha);
		border-radius: var(--raio);
		font-size: var(--texto-sm);
		cursor: pointer;
	}

	.cor:has(input:checked) {
		border-color: var(--cor-marca);
		box-shadow: inset 0 0 0 1px var(--cor-marca);
	}

	.cor:has(input:focus-visible) {
		outline: 2px solid var(--cor-foco);
		outline-offset: 2px;
	}

	.cor input {
		position: absolute;
		opacity: 0;
		width: 1px;
		height: 1px;
	}

	.amostra {
		width: 1rem;
		height: 1rem;
		border-radius: 50%;
		flex: none;
	}

	.amostra.sem {
		border: 1px dashed var(--cor-linha-forte);
	}

	.erro {
		font-size: var(--texto-sm);
		color: var(--cor-erro);
	}

	.lado-a-lado {
		display: grid;
		grid-template-columns: repeat(2, minmax(0, 1fr));
		gap: var(--esp-3);
	}
</style>

<script lang="ts">
	/**
	 * Quem está convidado (RF-05.5, D-M05-5).
	 *
	 * Tudo nativo — rádio, caixas e `select multiple` —, para funcionar sem
	 * JavaScript. O padrão é o caso comum: o grupo do evento, ou a equipe
	 * inteira se o evento for geral. As opções que o servidor recusaria nem
	 * aparecem: "toda a equipe" só para quem tem escopo global.
	 */
	let {
		grupos,
		pessoas,
		podeConvidarEquipe,
		valores,
		erro = undefined,
		permitirPadrao = true
	}: {
		grupos: ReadonlyArray<{ valor: string; rotulo: string }>;
		pessoas: ReadonlyArray<{ valor: string; rotulo: string }>;
		podeConvidarEquipe: boolean;
		valores: { convite: string; grupos: string[]; pessoas: string[] };
		erro?: string;
		/** Na edição, o público já existe: "o padrão" não faz sentido. */
		permitirPadrao?: boolean;
	} = $props();

	const marcado = (v: string) => valores.convite === v;
</script>

<fieldset class="convite" aria-describedby={erro ? 'convite-erro' : undefined}>
	<legend>Quem está convidado</legend>

	{#if permitirPadrao}
		<label class="opcao">
			<input type="radio" name="convite" value="padrao" checked={marcado('padrao')} />
			<span>
				O grupo do evento
				<small>ou a equipe inteira, se o evento não for de um grupo</small>
			</span>
		</label>
	{/if}

	{#if podeConvidarEquipe}
		<label class="opcao">
			<input type="radio" name="convite" value="equipe" checked={marcado('equipe')} />
			<span>Toda a equipe</span>
		</label>
	{/if}

	<label class="opcao">
		<input type="radio" name="convite" value="escolhidos" checked={marcado('escolhidos')} />
		<span>Grupos e pessoas que eu escolher</span>
	</label>

	<div class="escolhidos">
		{#if grupos.length > 0}
			<p class="rotulo">Grupos</p>
			<div class="grupos">
				{#each grupos as g (g.valor)}
					<label class="caixa">
						<input
							type="checkbox"
							name="grupos"
							value={g.valor}
							checked={valores.grupos.includes(g.valor)}
						/>
						<span>{g.rotulo}</span>
					</label>
				{/each}
			</div>
		{/if}

		<label class="rotulo" for="pessoas">Pessoas avulsas</label>
		<select id="pessoas" name="pessoas" multiple size="5">
			{#each pessoas as p (p.valor)}
				<option value={p.valor} selected={valores.pessoas.includes(p.valor)}>{p.rotulo}</option>
			{/each}
		</select>
		<p class="ajuda">
			Um visitante, um palestrante convidado. Valem quando a opção acima estiver marcada.
		</p>
	</div>

	{#if erro}<p id="convite-erro" class="erro" role="alert">{erro}</p>{/if}
</fieldset>

<style>
	.convite {
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

	.opcao,
	.caixa {
		display: flex;
		align-items: flex-start;
		gap: var(--esp-2);
		min-height: var(--toque-min);
		cursor: pointer;
	}

	.opcao input,
	.caixa input {
		width: 1.15rem;
		height: 1.15rem;
		margin-top: 0.2rem;
		accent-color: var(--cor-marca);
		flex: none;
	}

	.opcao span {
		display: flex;
		flex-direction: column;
	}

	small {
		font-size: var(--texto-sm);
		color: var(--cor-texto-3);
	}

	.escolhidos {
		display: flex;
		flex-direction: column;
		gap: var(--esp-2);
		padding: var(--esp-3);
		border: 1px solid var(--cor-linha);
		border-radius: var(--raio);
		background: var(--cor-superficie-2);
	}

	.rotulo {
		font-size: var(--texto-sm);
		font-weight: 600;
	}

	.grupos {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(9rem, 1fr));
		gap: 0 var(--esp-2);
	}

	select {
		width: 100%;
		padding: var(--esp-1);
		background: var(--cor-superficie);
		color: var(--cor-texto);
		border: 1px solid var(--cor-linha-forte);
		border-radius: var(--raio);
		font-size: 16px;
	}

	select:focus-visible,
	.opcao:has(input:focus-visible),
	.caixa:has(input:focus-visible) {
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

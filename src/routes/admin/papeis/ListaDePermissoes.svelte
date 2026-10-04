<script lang="ts">
	import type { GrupoDePermissoes } from '$server/modules/rbac/catalogo';

	/**
	 * Caixas de permissão, agrupadas por recurso.
	 *
	 * `name="permissoes"` em todas: o servidor lê com `getAll`. Funciona sem
	 * JavaScript, como o resto dos formulários do app.
	 */
	let { grupos }: { grupos: GrupoDePermissoes[] } = $props();
</script>

<div class="grupos">
	{#each grupos as grupo (grupo.rotulo)}
		<fieldset>
			<legend>{grupo.rotulo}</legend>
			{#each grupo.permissoes as p (p.chave)}
				<label class:bloqueada={p.bloqueada}>
					<input
						type="checkbox"
						name="permissoes"
						value={p.chave}
						checked={p.marcada}
						disabled={p.bloqueada}
						aria-describedby={p.bloqueada ? `${p.chave}-motivo` : undefined}
					/>
					<span class="texto">
						<span class="descricao">
							{p.descricao}
							{#if p.sensivel}<span class="sensivel">sensível</span>{/if}
						</span>
						<code>{p.chave}</code>
						{#if p.bloqueada}
							<span class="motivo" id="{p.chave}-motivo"
								>Você não tem esta permissão para concedê-la.</span
							>
						{/if}
					</span>
				</label>
			{/each}
		</fieldset>
	{/each}
</div>

<style>
	.grupos {
		display: flex;
		flex-direction: column;
		gap: var(--esp-4);
	}

	fieldset {
		border: 1px solid var(--cor-linha);
		border-radius: var(--raio);
		background: var(--cor-superficie);
		padding: var(--esp-2) var(--esp-3) var(--esp-3);
		margin: 0;
		display: flex;
		flex-direction: column;
		gap: var(--esp-1);
	}

	legend {
		font-size: var(--texto-sm);
		font-weight: 700;
		color: var(--cor-texto-2);
		padding: 0 var(--esp-1);
	}

	label {
		display: flex;
		align-items: flex-start;
		gap: var(--esp-3);
		padding: var(--esp-2) 0;
		min-height: var(--toque-min);
		cursor: pointer;
	}

	label.bloqueada {
		cursor: not-allowed;
		opacity: 0.6;
	}

	input {
		width: 20px;
		height: 20px;
		margin-top: 2px;
		flex: none;
		accent-color: var(--cor-marca);
	}

	input:focus-visible {
		outline: 2px solid var(--cor-foco);
		outline-offset: 2px;
	}

	.texto {
		display: flex;
		flex-direction: column;
		gap: 2px;
		font-size: var(--texto-sm);
	}

	.descricao {
		font-weight: 600;
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: var(--esp-2);
	}

	code {
		font-family: var(--fonte-mono);
		font-size: var(--texto-xs);
		color: var(--cor-texto-3);
	}

	/* Destaque de atenção, não de erro: tom de aviso, sempre com o texto. */
	.sensivel {
		font-size: var(--texto-xs);
		font-weight: 700;
		color: var(--cor-aviso);
		background: var(--cor-aviso-suave);
		border-radius: 999px;
		padding: 0 var(--esp-2);
	}

	.motivo {
		font-size: var(--texto-xs);
		color: var(--cor-texto-3);
	}
</style>

<script lang="ts">
	import RadarAtributos from '$ui/RadarAtributos.svelte';
	import {
		ATRIBUTOS,
		ROTULO_LATERALIDADE,
		faixaNota,
		formatarAltura,
		formatarMedia,
		formatarPeso,
		temAlgumAtributo,
		type AtributosPessoa
	} from '$shared/atributos';

	let {
		nome,
		atributos,
		compacto = false
	}: {
		nome: string;
		atributos: AtributosPessoa;
		compacto?: boolean;
	} = $props();

	const temAlgumaNota = $derived(
		atributos.fisico !== null ||
			atributos.biblico !== null ||
			atributos.mental !== null ||
			atributos.coordenacaoMotora !== null
	);

	const dadosComplementares = $derived.by(() => {
		const itens: Array<{ rotulo: string; valor: string }> = [];
		if (atributos.alturaCm !== null) {
			itens.push({
				rotulo: 'Altura',
				valor: `${formatarAltura(atributos.alturaCm)} (${atributos.alturaCm} cm)`
			});
		}
		if (atributos.pesoKg !== null) {
			itens.push({ rotulo: 'Peso', valor: formatarPeso(atributos.pesoKg) ?? '' });
		}
		if (atributos.lateralidade) {
			itens.push({
				rotulo: 'Mão / pé dominante',
				valor: ROTULO_LATERALIDADE[atributos.lateralidade]
			});
		}
		if (atributos.tamanhoCamiseta) {
			itens.push({ rotulo: 'Camiseta', valor: atributos.tamanhoCamiseta });
		}
		if (atributos.pontosFortes) {
			itens.push({ rotulo: 'Pontos fortes', valor: atributos.pontosFortes });
		}
		if (atributos.observacaoDraft) {
			itens.push({ rotulo: 'Observação para provas', valor: atributos.observacaoDraft });
		}
		return itens;
	});

	function formatarData(iso: string | null) {
		if (!iso) return '';
		return new Date(iso).toLocaleDateString('pt-BR', {
			day: '2-digit',
			month: 'short',
			year: 'numeric'
		});
	}
</script>

{#if !temAlgumAtributo(atributos)}
	<p class="vazio">Nenhum atributo ou medida preenchido ainda.</p>
{:else}
	<div class="resumo" class:compacto>
		{#if temAlgumaNota}
			<div class="grade-notas">
				<div class="coluna-radar">
					<RadarAtributos
						tamanho={compacto ? 200 : 232}
						titulo={`Atributos de ${nome}`}
						series={[{ rotulo: nome, notas: atributos }]}
					/>
					{#if atributos.media !== null}
						<p class="media-geral">
							Média geral: <strong>{formatarMedia(atributos.media)}</strong> / 10
						</p>
					{/if}
				</div>

				<ul class="barras" aria-label={`Notas de ${nome}`}>
					{#each ATRIBUTOS as a (a.chave)}
						{@const nota = atributos[a.chave]}
						<li>
							<div class="linha-barra">
								<span class="nome-attr">{a.rotulo}</span>
								<span class="nota-attr">
									<strong>{nota === null ? '—' : nota}</strong>
									<small>{faixaNota(nota)}</small>
								</span>
							</div>
							<div
								class="trilho"
								role="meter"
								aria-valuemin="0"
								aria-valuemax="10"
								aria-valuenow={nota ?? 0}
								aria-label={`${a.rotulo}: ${nota === null ? 'não avaliado' : `${nota} de 10`}`}
							>
								{#if nota !== null}
									<div class="preenchido" style={`width: ${nota * 10}%`}></div>
								{/if}
							</div>
						</li>
					{/each}
				</ul>
			</div>
		{/if}

		{#if dadosComplementares.length > 0}
			<dl class="ficha-fisica">
				{#each dadosComplementares as item (item.rotulo)}
					<div
						class="spec"
						class:largo={item.rotulo === 'Pontos fortes' ||
							item.rotulo === 'Observação para provas'}
					>
						<dt>{item.rotulo}</dt>
						<dd>{item.valor}</dd>
					</div>
				{/each}
			</dl>
		{/if}

		{#if atributos.avaliadoEm}
			<p class="rodape-avaliacao">
				Avaliado em {formatarData(atributos.avaliadoEm)}{#if atributos.avaliadoPor}
					· por {atributos.avaliadoPor}{/if}
			</p>
		{/if}
	</div>
{/if}

<style>
	.vazio {
		margin: 0;
		font-size: var(--texto-sm);
		color: var(--cor-texto-2);
	}

	.resumo {
		display: flex;
		flex-direction: column;
		gap: var(--esp-4);
	}

	.grade-notas {
		display: grid;
		gap: var(--esp-4);
		align-items: center;
	}

	@media (min-width: 36rem) {
		.grade-notas {
			grid-template-columns: auto 1fr;
		}
	}

	.coluna-radar {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: var(--esp-1);
	}

	.media-geral {
		margin: 0;
		font-size: var(--texto-sm);
		color: var(--cor-texto-2);
	}

	.media-geral strong {
		font-family: var(--fonte-titulo);
		font-size: var(--texto-lg);
		color: var(--cor-marca);
	}

	.barras {
		list-style: none;
		padding: 0;
		margin: 0;
		display: flex;
		flex-direction: column;
		gap: var(--esp-3);
	}

	.barras li {
		display: flex;
		flex-direction: column;
		gap: var(--esp-1);
	}

	.linha-barra {
		display: flex;
		justify-content: space-between;
		align-items: baseline;
		gap: var(--esp-2);
	}

	.nome-attr {
		font-size: var(--texto-sm);
		font-weight: 600;
		color: var(--cor-texto);
	}

	.nota-attr {
		display: inline-flex;
		align-items: baseline;
		gap: var(--esp-2);
		font-size: var(--texto-sm);
	}

	.nota-attr strong {
		font-family: var(--fonte-titulo);
		color: var(--cor-texto);
	}

	.nota-attr small {
		font-size: var(--texto-xs);
		color: var(--cor-texto-2);
	}

	.trilho {
		height: 8px;
		background: var(--cor-superficie-2);
		border-radius: var(--raio-cheio);
		overflow: hidden;
	}

	.preenchido {
		height: 100%;
		background: var(--cor-marca);
		border-radius: var(--raio-cheio);
	}

	.ficha-fisica {
		margin: 0;
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(135px, 1fr));
		gap: var(--esp-3);
		padding: var(--esp-3);
		background: var(--cor-superficie);
		border: 1px solid var(--cor-linha);
		border-radius: var(--raio);
	}

	.spec {
		display: flex;
		flex-direction: column;
		gap: 2px;
	}

	.spec.largo {
		grid-column: 1 / -1;
	}

	.spec dt {
		font-size: var(--texto-xs);
		font-weight: 600;
		color: var(--cor-texto-3);
	}

	.spec dd {
		margin: 0;
		font-size: var(--texto-sm);
		color: var(--cor-texto);
		overflow-wrap: anywhere;
		white-space: pre-line;
	}

	.rodape-avaliacao {
		margin: 0;
		font-size: var(--texto-xs);
		color: var(--cor-texto-3);
	}
</style>

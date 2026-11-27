<script lang="ts">
	import { untrack } from 'svelte';
	import Botao from '$ui/Botao.svelte';
	import Campo from '$ui/Campo.svelte';
	import Aviso from '$ui/Aviso.svelte';
	import { api } from '$lib/api';
	import {
		ATRIBUTOS,
		LATERALIDADES,
		NOTA_MAX,
		NOTA_MIN,
		ROTULO_LATERALIDADE,
		TAMANHOS_CAMISETA,
		faixaNota,
		formatarAltura,
		parsePesoTexto,
		type AtributosPessoa,
		type ChaveAtributo,
		type Lateralidade,
		type TamanhoCamiseta
	} from '$shared/atributos';

	let {
		pessoaId,
		pessoaNome,
		inicial,
		onSalvo,
		onCancelar
	}: {
		pessoaId: string;
		pessoaNome: string;
		inicial: AtributosPessoa;
		onSalvo: (atributos: AtributosPessoa, mensagem: string) => void;
		onCancelar: () => void;
	} = $props();

	const snap = untrack(() => inicial);
	let notas = $state<Record<ChaveAtributo, number | null>>({
		fisico: snap.fisico,
		biblico: snap.biblico,
		mental: snap.mental,
		coordenacaoMotora: snap.coordenacaoMotora
	});
	let alturaTexto = $state(snap.alturaCm !== null ? String(snap.alturaCm) : '');
	let pesoTexto = $state(
		snap.pesoKg !== null ? snap.pesoKg.toLocaleString('pt-BR', { maximumFractionDigits: 1 }) : ''
	);
	let lateralidade = $state<Lateralidade | ''>(snap.lateralidade ?? '');
	let tamanhoCamiseta = $state<TamanhoCamiseta | ''>(snap.tamanhoCamiseta ?? '');
	let pontosFortes = $state(snap.pontosFortes ?? '');
	let observacaoDraft = $state(snap.observacaoDraft ?? '');

	let salvando = $state(false);
	let erro = $state<string | undefined>(undefined);
	let campoErro = $state<string | null>(null);

	const previewAltura = $derived.by(() => {
		const n = Number(alturaTexto.trim());
		if (!alturaTexto.trim() || !Number.isInteger(n) || n < 100 || n > 250) return null;
		return formatarAltura(n);
	});

	function ajustarNota(chave: ChaveAtributo, delta: number) {
		const atual = notas[chave];
		if (atual === null) {
			notas[chave] = 5;
			return;
		}
		notas[chave] = Math.max(NOTA_MIN, Math.min(NOTA_MAX, atual + delta));
	}

	async function salvar(e: SubmitEvent) {
		e.preventDefault();
		erro = undefined;
		campoErro = null;

		let alturaCm: number | null = null;
		if (alturaTexto.trim()) {
			const n = Number(alturaTexto.trim());
			if (!Number.isInteger(n) || n < 100 || n > 250) {
				erro = 'Informe a altura em centímetros inteiros entre 100 e 250 (ex.: 178).';
				campoErro = 'alturaCm';
				return;
			}
			alturaCm = n;
		}

		let pesoKg: number | null = null;
		if (pesoTexto.trim()) {
			const p = parsePesoTexto(pesoTexto);
			if (p === null || Number.isNaN(p) || p < 30 || p > 250) {
				erro = 'Informe um peso válido entre 30 e 250 kg (ex.: 72,5).';
				campoErro = 'pesoKg';
				return;
			}
			pesoKg = p;
		}

		salvando = true;
		try {
			const res = await api.put(`/api/pessoas/${pessoaId}/atributos`, {
				fisico: notas.fisico,
				biblico: notas.biblico,
				mental: notas.mental,
				coordenacaoMotora: notas.coordenacaoMotora,
				alturaCm,
				pesoKg,
				lateralidade: lateralidade || null,
				tamanhoCamiseta: tamanhoCamiseta || null,
				pontosFortes: pontosFortes.trim() || null,
				observacaoDraft: observacaoDraft.trim() || null
			});
			const d = await res.json().catch(() => ({}));
			if (!res.ok) {
				erro = d.erro ?? 'Não foi possível salvar os atributos.';
				campoErro = d.campo ?? null;
				return;
			}
			onSalvo(d.atributos, d.mensagem ?? 'Atributos atualizados.');
		} catch {
			erro = 'Sem conexão. Nada foi salvo.';
		} finally {
			salvando = false;
		}
	}
</script>

<form class="editor" onsubmit={salvar} novalidate aria-label={`Avaliar atributos de ${pessoaNome}`}>
	{#if erro && !campoErro}
		<Aviso tom="erro">{erro}</Aviso>
	{/if}

	<fieldset class="grupo-notas">
		<legend>Atributos de Draft (escala 0 a 10)</legend>
		<p class="dica">
			Deixe em branco o que ainda não foi observado. As notas ajudam a equilibrar os times sem
			pressionar ninguém.
		</p>

		<div class="lista-atributos">
			{#each ATRIBUTOS as a (a.chave)}
				{@const valor = notas[a.chave]}
				<div class="item-atributo">
					<div class="topo-atributo">
						<div>
							<label for={`nota-${pessoaId}-${a.chave}`}>{a.rotulo}</label>
							<p class="desc-atributo">{a.descricao}</p>
						</div>
						<div class="valor-badge" class:vazio={valor === null}>
							<strong>{valor === null ? '—' : `${valor}/10`}</strong>
							<span>{faixaNota(valor)}</span>
						</div>
					</div>

					<div class="controles-nota">
						<button
							type="button"
							class="btn-passo"
							aria-label={`Diminuir ${a.rotulo}`}
							disabled={valor === NOTA_MIN}
							onclick={() => ajustarNota(a.chave, -1)}
						>
							−
						</button>
						<input
							id={`nota-${pessoaId}-${a.chave}`}
							type="range"
							min={NOTA_MIN}
							max={NOTA_MAX}
							step="1"
							value={valor ?? 5}
							aria-valuetext={valor === null
								? 'Não avaliado'
								: `${valor} de 10, ${faixaNota(valor)}`}
							oninput={(ev) => {
								notas[a.chave] = Number(ev.currentTarget.value);
							}}
						/>
						<button
							type="button"
							class="btn-passo"
							aria-label={`Aumentar ${a.rotulo}`}
							disabled={valor === NOTA_MAX}
							onclick={() => ajustarNota(a.chave, 1)}
						>
							+
						</button>
						{#if valor !== null}
							<button type="button" class="btn-limpar" onclick={() => (notas[a.chave] = null)}>
								Limpar
							</button>
						{:else}
							<button type="button" class="btn-definir" onclick={() => (notas[a.chave] = 5)}>
								Avaliar
							</button>
						{/if}
					</div>
				</div>
			{/each}
		</div>
	</fieldset>

	<fieldset class="grupo-complemento">
		<legend>Dados complementares (opcionais)</legend>

		<div class="par">
			<Campo
				id={`altura-${pessoaId}`}
				rotulo="Altura (cm)"
				inputmode="numeric"
				placeholder="Ex.: 178"
				ajuda={previewAltura ? `Equivale a ${previewAltura}.` : 'Em centímetros, entre 100 e 250.'}
				erro={campoErro === 'alturaCm' ? erro : undefined}
				bind:valor={alturaTexto}
			/>
			<Campo
				id={`peso-${pessoaId}`}
				rotulo="Peso (kg)"
				placeholder="Ex.: 72,5"
				ajuda="Opcional. Entre 30 e 250 kg."
				erro={campoErro === 'pesoKg' ? erro : undefined}
				bind:valor={pesoTexto}
			/>
		</div>

		<div class="par">
			<div class="campo-select">
				<label for={`lat-${pessoaId}`}>Mão / pé dominante</label>
				<select id={`lat-${pessoaId}`} bind:value={lateralidade}>
					<option value="">Não informado</option>
					{#each LATERALIDADES as l (l)}
						<option value={l}>{ROTULO_LATERALIDADE[l]}</option>
					{/each}
				</select>
			</div>

			<div class="campo-select">
				<span class="rotulo-grupo" id={`camiseta-lbl-${pessoaId}`}>Tamanho de camiseta</span>
				<div class="pilulas" role="radiogroup" aria-labelledby={`camiseta-lbl-${pessoaId}`}>
					{#each TAMANHOS_CAMISETA as t (t)}
						<button
							type="button"
							role="radio"
							aria-checked={tamanhoCamiseta === t}
							class="pilula"
							class:ativa={tamanhoCamiseta === t}
							onclick={() => (tamanhoCamiseta = tamanhoCamiseta === t ? '' : t)}
						>
							{t}
						</button>
					{/each}
				</div>
			</div>
		</div>

		<Campo
			id={`pontos-${pessoaId}`}
			rotulo="Pontos fortes e especialidades"
			maxlength="280"
			placeholder="Ex.: velocidade, memória bíblica, liderança em prova"
			bind:valor={pontosFortes}
		/>

		<div class="campo-textarea">
			<label for={`obs-draft-${pessoaId}`}>Observação para provas e draft</label>
			<textarea
				id={`obs-draft-${pessoaId}`}
				rows="2"
				maxlength="500"
				placeholder="Ex.: prefere provas de estratégia; evitar impacto forte no joelho"
				bind:value={observacaoDraft}
			></textarea>
		</div>
	</fieldset>

	<div class="acoes">
		<Botao tipo="submit" carregando={salvando}>Salvar atributos</Botao>
		<Botao variante="texto" desabilitado={salvando} onclick={onCancelar}>Cancelar</Botao>
	</div>
</form>

<style>
	.editor {
		display: flex;
		flex-direction: column;
		gap: var(--esp-4);
	}

	fieldset {
		border: 0;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: var(--esp-3);
	}

	legend {
		font-family: var(--fonte-titulo);
		font-size: var(--texto-base);
		font-weight: 700;
		color: var(--cor-texto);
		margin-bottom: var(--esp-1);
	}

	.dica {
		margin: 0;
		font-size: var(--texto-sm);
		color: var(--cor-texto-2);
	}

	.lista-atributos {
		display: flex;
		flex-direction: column;
		gap: var(--esp-3);
	}

	.item-atributo {
		display: flex;
		flex-direction: column;
		gap: var(--esp-2);
		padding: var(--esp-3);
		background: var(--cor-superficie);
		border: 1px solid var(--cor-linha);
		border-radius: var(--raio);
	}

	.topo-atributo {
		display: flex;
		justify-content: space-between;
		align-items: flex-start;
		gap: var(--esp-3);
	}

	.topo-atributo label {
		font-size: var(--texto-sm);
		font-weight: 700;
		color: var(--cor-texto);
	}

	.desc-atributo {
		margin: 2px 0 0;
		font-size: var(--texto-xs);
		color: var(--cor-texto-2);
	}

	.valor-badge {
		flex: none;
		display: flex;
		flex-direction: column;
		align-items: flex-end;
		text-align: right;
	}

	.valor-badge strong {
		font-family: var(--fonte-titulo);
		font-size: var(--texto-base);
		color: var(--cor-marca);
	}

	.valor-badge.vazio strong {
		color: var(--cor-texto-3);
	}

	.valor-badge span {
		font-size: var(--texto-xs);
		color: var(--cor-texto-2);
	}

	.controles-nota {
		display: flex;
		align-items: center;
		gap: var(--esp-2);
	}

	.controles-nota input[type='range'] {
		flex: 1;
		min-height: var(--toque-min);
		accent-color: var(--cor-marca);
		cursor: pointer;
	}

	.btn-passo {
		width: var(--toque-min);
		height: var(--toque-min);
		flex: none;
		border: 1px solid var(--cor-linha-forte);
		border-radius: var(--raio);
		background: var(--cor-superficie);
		color: var(--cor-texto);
		font-size: var(--texto-lg);
		font-weight: 700;
		cursor: pointer;
	}

	.btn-passo:disabled {
		opacity: 0.4;
		cursor: not-allowed;
	}

	.btn-limpar,
	.btn-definir {
		min-height: var(--toque-min);
		padding: 0 var(--esp-3);
		flex: none;
		border-radius: var(--raio);
		font-size: var(--texto-xs);
		font-weight: 700;
		font-family: inherit;
		cursor: pointer;
	}

	.btn-limpar {
		border: 1px solid var(--cor-linha);
		background: transparent;
		color: var(--cor-texto-2);
	}

	.btn-definir {
		border: 1px solid var(--cor-marca);
		background: var(--cor-marca-suave);
		color: var(--cor-marca);
	}

	.par {
		display: grid;
		gap: var(--esp-3);
	}

	@media (min-width: 34rem) {
		.par {
			grid-template-columns: 1fr 1fr;
		}
	}

	.campo-select,
	.campo-textarea {
		display: flex;
		flex-direction: column;
		gap: var(--esp-2);
	}

	.campo-select label,
	.rotulo-grupo,
	.campo-textarea label {
		font-size: var(--texto-sm);
		font-weight: 600;
		color: var(--cor-texto-2);
	}

	select,
	textarea {
		padding: var(--esp-2) var(--esp-3);
		background: var(--cor-superficie);
		color: var(--cor-texto);
		border: 1px solid var(--cor-linha-forte);
		border-radius: var(--raio);
		font-size: 16px;
		font-family: inherit;
	}

	select {
		min-height: var(--toque-min);
		padding: 0 var(--esp-3);
	}

	textarea {
		resize: vertical;
	}

	select:focus-visible,
	textarea:focus-visible,
	.btn-passo:focus-visible,
	.btn-limpar:focus-visible,
	.btn-definir:focus-visible,
	.pilula:focus-visible {
		outline: 2px solid var(--cor-foco);
		outline-offset: 2px;
	}

	.pilulas {
		display: flex;
		flex-wrap: wrap;
		gap: var(--esp-1);
	}

	.pilula {
		min-width: var(--toque-min);
		min-height: var(--toque-min);
		padding: 0 var(--esp-2);
		border: 1px solid var(--cor-linha-forte);
		border-radius: var(--raio-sm);
		background: var(--cor-superficie);
		color: var(--cor-texto);
		font-size: var(--texto-sm);
		font-weight: 700;
		font-family: inherit;
		cursor: pointer;
	}

	.pilula.ativa {
		border-color: var(--cor-marca);
		background: var(--cor-marca);
		color: var(--cor-sobre-marca);
	}

	.acoes {
		display: flex;
		flex-wrap: wrap;
		gap: var(--esp-2);
	}
</style>

<script lang="ts">
	import { onMount } from 'svelte';
	import Botao from '$ui/Botao.svelte';
	import Campo from '$ui/Campo.svelte';
	import Aviso from '$ui/Aviso.svelte';
	import Marca from '$ui/Marca.svelte';
	import { api } from '$lib/api';

	type Aba = 'redigir' | 'analises' | 'sugestoes';

	interface PermissoesIa {
		basico: boolean;
		analitico: boolean;
		financeiro: boolean;
		podeAplicarGrupos: boolean;
	}

	let aba = $state<Aba>('redigir');
	let carregando = $state(true);
	let erro = $state<string | undefined>(undefined);
	let mensagem = $state<string | undefined>(undefined);
	let semPermissao = $state(false);

	let iaAtiva = $state(false);
	let permissoesIa = $state<PermissoesIa>({
		basico: false,
		analitico: false,
		financeiro: false,
		podeAplicarGrupos: false
	});
	let sugestoes = $state<any[]>([]);

	// Formulário: redigir aviso (RF-10.1)
	let avisoTema = $state('');
	let avisoDetalhes = $state('');
	let avisoTom = $state<'acolhedor' | 'objetivo' | 'lembrete'>('acolhedor');
	let avisoPublico = $state('');
	let gerandoAviso = $state(false);
	let resultadoAviso = $state<{
		tituloSugerido: string;
		textoApp: string;
		textoWhatsapp: string;
	} | null>(null);
	let copiado = $state(false);

	// Formulário: resumir ata (RF-10.7)
	let textoAta = $state('');
	let gerandoAta = $state(false);
	let resultadoAta = $state<{
		resumo: string;
		decisoes: string[];
		tarefas: Array<{ descricao: string; responsavelSugerido: string | null }>;
	} | null>(null);

	// Análises assistidas (RF-10.2, RF-10.4, RF-10.5)
	let gerandoAnalise = $state<string | null>(null);
	let decidindoId = $state<string | null>(null);

	const pendentesCount = $derived(sugestoes.filter((s) => s.status === 'pendente').length);
	const podeVerAnalises = $derived(permissoesIa.analitico || permissoesIa.financeiro);

	const KIND_LABEL: Record<string, string> = {
		redacao_aviso: 'Redação de aviso',
		resumo_ata: 'Resumo de ata',
		sinais_atencao: 'Sinais de atenção',
		divisao_grupos: 'Divisão de grupos',
		resumo_financeiro: 'Resumo financeiro'
	};

	const STATUS_LABEL: Record<string, string> = {
		pendente: 'Pendente de revisão',
		aceita: 'Confirmada',
		rejeitada: 'Descartada',
		expirada: 'Expirada'
	};

	onMount(() => {
		carregarStatus();
	});

	async function carregarStatus() {
		carregando = true;
		erro = undefined;
		semPermissao = false;
		try {
			const res = await api.get('/api/ia/status');
			if (res.status === 403) {
				semPermissao = true;
				carregando = false;
				return;
			}
			if (!res.ok) {
				const d = await res.json().catch(() => ({}));
				erro = d.erro ?? 'Não foi possível carregar o assistente.';
				return;
			}
			const d = await res.json();
			iaAtiva = Boolean(d.iaAtiva);
			permissoesIa = d.permissoesIa ?? permissoesIa;
			sugestoes = d.sugestoes ?? [];

			if (!permissoesIa.basico && (permissoesIa.analitico || permissoesIa.financeiro)) {
				aba = 'analises';
			}
		} catch (e: any) {
			erro =
				e.message === 'sem_conexao'
					? 'O assistente de IA exige conexão com a internet.'
					: 'Não foi possível carregar o assistente.';
		} finally {
			carregando = false;
		}
	}

	async function gerarAviso() {
		if (!avisoTema.trim() || !avisoDetalhes.trim()) return;
		gerandoAviso = true;
		erro = undefined;
		mensagem = undefined;
		copiado = false;
		try {
			const res = await api.post('/api/ia/redigir', {
				modo: 'aviso',
				tema: avisoTema.trim(),
				detalhes: avisoDetalhes.trim(),
				tom: avisoTom,
				publico: avisoPublico.trim() || undefined
			});
			const d = await res.json().catch(() => ({}));
			if (res.ok) {
				resultadoAviso = d.resultado ?? null;
				mensagem = 'Rascunho gerado. Revise antes de publicar ou enviar.';
				await carregarStatus();
			} else {
				erro = d.erro ?? 'Não foi possível gerar o rascunho.';
			}
		} catch {
			erro = 'Erro ao conectar com o assistente.';
		} finally {
			gerandoAviso = false;
		}
	}

	async function copiarTextoWhatsapp(texto: string) {
		try {
			await navigator.clipboard.writeText(texto);
			copiado = true;
			setTimeout(() => {
				copiado = false;
			}, 2500);
		} catch {
			erro = 'Não foi possível copiar automaticamente.';
		}
	}

	async function gerarResumoAta() {
		if (textoAta.trim().length < 10) {
			erro = 'Cole ao menos algumas linhas da ata para resumir.';
			return;
		}
		gerandoAta = true;
		erro = undefined;
		mensagem = undefined;
		try {
			const res = await api.post('/api/ia/redigir', {
				modo: 'ata',
				textoAta: textoAta.trim()
			});
			const d = await res.json().catch(() => ({}));
			if (res.ok) {
				resultadoAta = d.resultado ?? null;
				mensagem = 'Ata resumida e registrada na fila de revisão.';
				await carregarStatus();
			} else {
				erro = d.erro ?? 'Não foi possível resumir a ata.';
			}
		} catch {
			erro = 'Erro ao processar a ata.';
		} finally {
			gerandoAta = false;
		}
	}

	async function executarAnalise(tipo: 'sinais_atencao' | 'divisao_grupos' | 'resumo_financeiro') {
		gerandoAnalise = tipo;
		erro = undefined;
		mensagem = undefined;
		try {
			const res = await api.post('/api/ia/analisar', { tipo });
			const d = await res.json().catch(() => ({}));
			if (res.ok) {
				mensagem =
					tipo === 'divisao_grupos'
						? 'Proposta criada como pendente. Revise e confirme na aba Sugestões para aplicar.'
						: 'Análise concluída e salva na aba Sugestões para revisão.';
				await carregarStatus();
				aba = 'sugestoes';
			} else {
				erro = d.erro ?? 'Não foi possível concluir a análise.';
			}
		} catch {
			erro = 'Erro ao executar análise.';
		} finally {
			gerandoAnalise = null;
		}
	}

	async function decidirSugestao(id: string, decisao: 'aceitar' | 'rejeitar') {
		decidindoId = id;
		erro = undefined;
		mensagem = undefined;
		try {
			const res = await api.post(`/api/ia/sugestoes/${id}/decidir`, { decisao });
			const d = await res.json().catch(() => ({}));
			if (res.ok) {
				mensagem = d.mensagem ?? 'Decisão registrada.';
				await carregarStatus();
			} else {
				erro = d.erro ?? 'Não foi possível registrar sua decisão.';
			}
		} catch {
			erro = 'Erro ao confirmar decisão.';
		} finally {
			decidindoId = null;
		}
	}

	function formatarDataHora(iso: string | null) {
		if (!iso) return '—';
		return new Date(iso).toLocaleDateString('pt-BR', {
			day: '2-digit',
			month: '2-digit',
			year: 'numeric',
			hour: '2-digit',
			minute: '2-digit'
		});
	}

	function podeDecidir(s: any): boolean {
		if (s.status !== 'pendente' || !iaAtiva) return false;
		if (s.kind === 'divisao_grupos') return permissoesIa.podeAplicarGrupos;
		return true;
	}
</script>

<svelte:head>
	<title>Assistente de IA · Eagles</title>
</svelte:head>

<main class="conteudo">
	<div class="pilha">
		<header>
			<h1>Assistente de IA</h1>
			<p class="sub">
				Apoio para redação, atas e análises dentro do seu escopo. Nenhuma mudança é aplicada sem sua
				confirmação.
			</p>
		</header>

		{#if erro}
			<Aviso tom="erro">{erro}</Aviso>
		{/if}
		{#if mensagem}
			<Aviso tom="sucesso">{mensagem}</Aviso>
		{/if}

		{#if carregando}
			<div class="carregando">
				<Marca tamanho={44} />
				<p>Carregando assistente…</p>
			</div>
		{:else if semPermissao}
			<section class="vazio">
				<h2>Acesso restrito</h2>
				<p>Seu perfil atual não inclui permissões para o assistente de IA.</p>
			</section>
		{:else}
			{#if !iaAtiva}
				<Aviso tom="aviso">
					O assistente de IA está desligado nas configurações da equipe. A liderança pode ativar a
					chave <strong>Assistente de IA</strong> em <a href="/admin">Administração</a>.
				</Aviso>
			{/if}

			<div class="abas" role="tablist" aria-label="Seções do assistente de IA">
				{#if permissoesIa.basico}
					<button
						type="button"
						role="tab"
						aria-selected={aba === 'redigir'}
						class="aba"
						class:ativa={aba === 'redigir'}
						onclick={() => (aba = 'redigir')}
					>
						Redigir e ata
					</button>
				{/if}
				{#if podeVerAnalises}
					<button
						type="button"
						role="tab"
						aria-selected={aba === 'analises'}
						class="aba"
						class:ativa={aba === 'analises'}
						onclick={() => (aba = 'analises')}
					>
						Análises e grupos
					</button>
				{/if}
				<button
					type="button"
					role="tab"
					aria-selected={aba === 'sugestoes'}
					class="aba"
					class:ativa={aba === 'sugestoes'}
					onclick={() => (aba = 'sugestoes')}
				>
					Sugestões ({pendentesCount})
				</button>
			</div>

			{#if aba === 'redigir' && permissoesIa.basico}
				<section class="painel" aria-label="Redação de aviso e resumo de ata">
					<form
						class="bloco"
						onsubmit={(e) => {
							e.preventDefault();
							gerarAviso();
						}}
					>
						<h2>Redigir aviso para a comunidade</h2>
						<p class="desc">
							Gera uma versão para o mural do app e outra formatada para copiar no WhatsApp.
						</p>
						<Campo
							id="ia-tema"
							rotulo="Tema do aviso"
							placeholder="Ex.: Retiro de fim de ano"
							bind:valor={avisoTema}
							obrigatorio
						/>
						<div class="grade-2">
							<div class="campo-select">
								<label for="ia-tom">Tom</label>
								<select id="ia-tom" bind:value={avisoTom}>
									<option value="acolhedor">Acolhedor</option>
									<option value="objetivo">Objetivo</option>
									<option value="lembrete">Lembrete rápido</option>
								</select>
							</div>
							<Campo
								id="ia-publico"
								rotulo="Público (opcional)"
								placeholder="Ex.: PG Azul"
								bind:valor={avisoPublico}
							/>
						</div>
						<div class="campo-textarea">
							<label for="ia-detalhes">Informações principais</label>
							<textarea
								id="ia-detalhes"
								rows="3"
								placeholder="Data, horário, local e o que levar…"
								bind:value={avisoDetalhes}
								required
							></textarea>
						</div>
						<Botao tipo="submit" largura="cheia" carregando={gerandoAviso} desabilitado={!iaAtiva}>
							Gerar rascunho de aviso
						</Botao>

						{#if resultadoAviso}
							<div class="previa" role="status" aria-live="polite">
								<h3>{resultadoAviso.tituloSugerido}</h3>
								<pre class="texto-gerado">{resultadoAviso.textoWhatsapp}</pre>
								<div class="acoes-linha">
									<Botao
										variante="secundario"
										onclick={() => copiarTextoWhatsapp(resultadoAviso!.textoWhatsapp)}
									>
										{copiado ? 'Copiado' : 'Copiar para WhatsApp'}
									</Botao>
									<a
										class="link-acao"
										href={`https://wa.me/?text=${encodeURIComponent(resultadoAviso.textoWhatsapp)}`}
										target="_blank"
										rel="noopener noreferrer"
									>
										Abrir no WhatsApp
									</a>
								</div>
							</div>
						{/if}
					</form>

					<form
						class="bloco"
						onsubmit={(e) => {
							e.preventDefault();
							gerarResumoAta();
						}}
					>
						<h2>Resumir ata e extrair tarefas</h2>
						<p class="desc">
							Cole os tópicos da reunião (um por linha). O assistente separa decisões e tarefas com
							responsável sugerido.
						</p>
						<div class="campo-textarea">
							<label for="ia-ata">Anotações da reunião</label>
							<textarea
								id="ia-ata"
								rows="5"
								placeholder="- Ficou definido o encontro no dia 15&#10;- Ana: confirmar reserva do salão&#10;- Preparar escala de música (João)"
								bind:value={textoAta}
								required
							></textarea>
						</div>
						<Botao tipo="submit" largura="cheia" carregando={gerandoAta} desabilitado={!iaAtiva}>
							Resumir ata
						</Botao>

						{#if resultadoAta}
							<div class="previa" role="status" aria-live="polite">
								<p class="resumo-texto">{resultadoAta.resumo}</p>
								{#if resultadoAta.decisoes.length > 0}
									<div class="sublista">
										<strong>Decisões</strong>
										<ul>
											{#each resultadoAta.decisoes as dec}
												<li>{dec}</li>
											{/each}
										</ul>
									</div>
								{/if}
								{#if resultadoAta.tarefas.length > 0}
									<div class="sublista">
										<strong>Tarefas extraídas</strong>
										<ul>
											{#each resultadoAta.tarefas as t}
												<li>
													{t.descricao}
													{#if t.responsavelSugerido}
														<span class="meta"> · Sugestão: {t.responsavelSugerido}</span>
													{/if}
												</li>
											{/each}
										</ul>
									</div>
								{/if}
							</div>
						{/if}
					</form>
				</section>
			{:else if aba === 'analises' && podeVerAnalises}
				<section class="painel" aria-label="Análises assistidas por escopo">
					<p class="desc">
						Menores de 18 anos são pseudonimizados automaticamente antes de qualquer análise (LGPD).
						Toda proposta fica pendente até confirmação humana.
					</p>

					<ul class="lista">
						{#if permissoesIa.analitico}
							<li class="item">
								<div class="item-topo">
									<div class="item-info">
										<strong>Sinais de atenção pastoral</strong>
										<p class="desc">
											Identifica visitantes com 3+ presenças em 60 dias e membros sem registro
											recente dentro dos seus grupos.
										</p>
									</div>
									<Botao
										carregando={gerandoAnalise === 'sinais_atencao'}
										desabilitado={!iaAtiva}
										onclick={() => executarAnalise('sinais_atencao')}
									>
										Analisar sinais
									</Botao>
								</div>
							</li>
						{/if}

						{#if permissoesIa.podeAplicarGrupos}
							<li class="item">
								<div class="item-topo">
									<div class="item-info">
										<strong>Proposta de divisão equilibrada de grupos</strong>
										<p class="desc">
											Distribui pessoas equilibrando tamanho e frequência. Gera uma proposta
											pendente que só altera os PGs após sua confirmação explícita.
										</p>
									</div>
									<Botao
										carregando={gerandoAnalise === 'divisao_grupos'}
										desabilitado={!iaAtiva}
										onclick={() => executarAnalise('divisao_grupos')}
									>
										Gerar proposta
									</Botao>
								</div>
							</li>
						{/if}

						{#if permissoesIa.financeiro}
							<li class="item">
								<div class="item-topo">
									<div class="item-info">
										<strong>Resumo financeiro em linguagem natural</strong>
										<p class="desc">
											Sintetiza arrecadação, despesas, pendências de aprovação e principal categoria
											de saída do caixa.
										</p>
									</div>
									<Botao
										carregando={gerandoAnalise === 'resumo_financeiro'}
										desabilitado={!iaAtiva}
										onclick={() => executarAnalise('resumo_financeiro')}
									>
										Gerar resumo
									</Botao>
								</div>
							</li>
						{/if}
					</ul>
				</section>
			{:else}
				<section class="painel" aria-label="Fila de revisão de sugestões da IA">
					{#if sugestoes.length === 0}
						<div class="vazio">
							<h2>Nenhuma sugestão registrada</h2>
							<p>Gere um rascunho ou análise nas outras abas para revisar e confirmar aqui.</p>
						</div>
					{:else}
						<ul class="lista">
							{#each sugestoes as s (s.id)}
								<li class="item">
									<div class="badges">
										<span class="chip chip-sistema">{KIND_LABEL[s.kind] ?? s.kind}</span>
										<span
											class="chip"
											class:chip-pendente={s.status === 'pendente'}
											class:chip-sucesso={s.status === 'aceita'}
											class:chip-neutro={s.status === 'rejeitada' || s.status === 'expirada'}
										>
											{STATUS_LABEL[s.status] ?? s.status}
										</span>
									</div>

									<span class="meta">Gerada em {formatarDataHora(s.createdAt)}</span>

									{#if s.output?.resumo}
										<p class="resumo-texto">{s.output.resumo}</p>
									{/if}

									{#if s.kind === 'redacao_aviso' && s.output?.textoApp}
										<p class="resumo-texto">
											<strong>{s.output.tituloSugerido}</strong>
										</p>
										<pre class="texto-gerado">{s.output.textoApp}</pre>
									{/if}

									{#if s.kind === 'resumo_financeiro' && Array.isArray(s.output?.destaques)}
										<ul class="subitens">
											{#each s.output.destaques as d}
												<li>{d}</li>
											{/each}
										</ul>
									{/if}

									{#if s.kind === 'sinais_atencao' && Array.isArray(s.output?.sinais) && s.output.sinais.length > 0}
										<ul class="subitens">
											{#each s.output.sinais as sn}
												<li>
													{sn.mensagem}
													{#if sn.menor}
														<span class="chip chip-neutro">Pseudonimizado</span>
													{/if}
												</li>
											{/each}
										</ul>
									{/if}

									{#if s.kind === 'divisao_grupos' && Array.isArray(s.output?.alocacoes) && s.output.alocacoes.length > 0}
										<ul class="subitens">
											{#each s.output.alocacoes as al}
												<li>
													<strong>{al.rotulo}</strong> → {al.grupoSugeridoNome}
													{#if al.mudou}
														<span class="chip chip-pendente">Transferência</span>
													{/if}
													{#if al.menor}
														<span class="chip chip-neutro">Menor protegido</span>
													{/if}
												</li>
											{/each}
										</ul>
									{/if}

									{#if s.appliedChanges?.transferenciasAplicadas !== undefined}
										<span class="meta">
											Transferências aplicadas: {s.appliedChanges.transferenciasAplicadas}
										</span>
									{/if}

									{#if podeDecidir(s)}
										<div class="acoes-linha">
											<Botao
												carregando={decidindoId === s.id}
												onclick={() => decidirSugestao(s.id, 'aceitar')}
											>
												{s.kind === 'divisao_grupos'
													? 'Aplicar divisão confirmada'
													: 'Confirmar sugestão'}
											</Botao>
											<Botao
												variante="destrutivo"
												desabilitado={decidindoId === s.id}
												onclick={() => decidirSugestao(s.id, 'rejeitar')}
											>
												Descartar
											</Botao>
										</div>
									{/if}
								</li>
							{/each}
						</ul>
					{/if}
				</section>
			{/if}
		{/if}
	</div>
</main>

<style>
	header {
		display: flex;
		flex-direction: column;
		gap: var(--esp-1);
	}

	.sub,
	.desc {
		color: var(--cor-texto-2);
		font-size: var(--texto-sm);
	}

	.abas {
		display: flex;
		gap: var(--esp-1);
		border-bottom: 1px solid var(--cor-linha);
		overflow-x: auto;
	}

	.aba {
		min-height: var(--toque-min);
		padding: 0 var(--esp-3);
		background: transparent;
		border: none;
		border-bottom: 2px solid transparent;
		font-size: var(--texto-sm);
		font-weight: 600;
		color: var(--cor-texto-2);
		cursor: pointer;
		white-space: nowrap;
	}

	.aba.ativa {
		color: var(--cor-marca);
		border-bottom-color: var(--cor-marca);
	}

	.painel,
	.bloco {
		display: flex;
		flex-direction: column;
		gap: var(--esp-3);
	}

	.bloco {
		padding: var(--esp-4);
		background: var(--cor-superficie);
		border: 1px solid var(--cor-linha);
		border-radius: var(--raio);
	}

	.bloco h2 {
		font-size: var(--texto-lg);
	}

	.grade-2 {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
		gap: var(--esp-3);
	}

	.campo-select,
	.campo-textarea {
		display: flex;
		flex-direction: column;
		gap: var(--esp-2);
	}

	.campo-select label,
	.campo-textarea label {
		font-size: var(--texto-sm);
		font-weight: 600;
		color: var(--cor-texto-2);
	}

	.campo-select select,
	.campo-textarea textarea {
		width: 100%;
		min-height: var(--toque-min);
		padding: var(--esp-2) var(--esp-3);
		border: 1px solid var(--cor-linha-forte);
		border-radius: var(--raio);
		background: var(--cor-superficie);
		color: var(--cor-texto);
		font-size: var(--texto-base);
		font-family: inherit;
		resize: vertical;
	}

	.previa {
		display: flex;
		flex-direction: column;
		gap: var(--esp-2);
		padding-top: var(--esp-3);
		border-top: 1px solid var(--cor-linha);
	}

	.previa h3 {
		font-size: var(--texto-base);
	}

	.texto-gerado {
		margin: 0;
		padding: var(--esp-3);
		background: var(--cor-superficie-2);
		border: 1px solid var(--cor-linha);
		border-radius: var(--raio-sm);
		font-family: inherit;
		font-size: var(--texto-sm);
		line-height: 1.5;
		white-space: pre-wrap;
		overflow-wrap: anywhere;
	}

	.resumo-texto {
		font-size: var(--texto-sm);
		color: var(--cor-texto);
		line-height: 1.5;
	}

	.sublista {
		display: flex;
		flex-direction: column;
		gap: var(--esp-1);
		font-size: var(--texto-sm);
	}

	.sublista ul,
	.subitens {
		margin: 0;
		padding-left: var(--esp-4);
		display: flex;
		flex-direction: column;
		gap: var(--esp-1);
		font-size: var(--texto-sm);
	}

	.lista {
		list-style: none;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: var(--esp-2);
	}

	.item {
		display: flex;
		flex-direction: column;
		gap: var(--esp-2);
		padding: var(--esp-4);
		background: var(--cor-superficie);
		border: 1px solid var(--cor-linha);
		border-radius: var(--raio);
	}

	.item-topo {
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		gap: var(--esp-3);
		flex-wrap: wrap;
	}

	.item-info {
		flex: 1;
		display: flex;
		flex-direction: column;
		gap: 4px;
		min-width: 190px;
	}

	.badges {
		display: flex;
		align-items: center;
		flex-wrap: wrap;
		gap: var(--esp-2);
	}

	.chip {
		display: inline-flex;
		align-items: center;
		font-size: var(--texto-xs);
		font-weight: 700;
		padding: 2px 8px;
		border-radius: var(--raio-cheio);
	}

	.chip-sistema {
		background: var(--cor-marca-suave);
		color: var(--cor-marca);
	}

	.chip-pendente {
		background: var(--cor-aviso-suave);
		color: var(--cor-aviso);
	}

	.chip-sucesso {
		background: var(--cor-sucesso-suave);
		color: var(--cor-sucesso);
	}

	.chip-neutro {
		background: var(--cor-superficie-2);
		color: var(--cor-texto-2);
	}

	.meta {
		font-size: var(--texto-xs);
		color: var(--cor-texto-3);
	}

	.acoes-linha {
		display: flex;
		align-items: center;
		flex-wrap: wrap;
		gap: var(--esp-2);
		padding-top: var(--esp-1);
	}

	.link-acao {
		min-height: var(--toque-min);
		display: inline-flex;
		align-items: center;
		padding: 0 var(--esp-3);
		font-size: var(--texto-sm);
		font-weight: 600;
	}

	.vazio,
	.carregando {
		display: flex;
		flex-direction: column;
		align-items: center;
		text-align: center;
		gap: var(--esp-2);
		padding: var(--esp-6) var(--esp-4);
	}

	.vazio p,
	.carregando p {
		color: var(--cor-texto-2);
		font-size: var(--texto-sm);
		max-width: 36ch;
	}
</style>

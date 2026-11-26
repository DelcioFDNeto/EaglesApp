<script lang="ts">
	import { onMount } from 'svelte';
	import Botao from '$ui/Botao.svelte';
	import Campo from '$ui/Campo.svelte';
	import Aviso from '$ui/Aviso.svelte';
	import Marca from '$ui/Marca.svelte';
	import { api } from '$lib/api';

	type Aba = 'avisos' | 'modelos' | 'preferencias';

	let aba = $state<Aba>('avisos');
	let carregando = $state(true);
	let erro = $state<string | undefined>(undefined);
	let mensagem = $state<string | undefined>(undefined);

	// Avisos
	let anuncios = $state<any[]>([]);
	let podeCriar = $state(false);
	let podePublicar = $state(false);
	let grupos = $state<any[]>([]);
	let eventos = $state<any[]>([]);

	let novoTitulo = $state('');
	let novoCorpo = $state('');
	let novoEscopo = $state<'all' | 'group' | 'status'>('all');
	let novoGrupoId = $state('');
	let novoStatusAlvo = $state<'visitante' | 'recorrente' | 'membro' | 'conselheiro' | 'lider'>(
		'membro'
	);
	let novoEventoId = $state('');
	let publicarAgora = $state(true);
	let salvandoAnuncio = $state(false);

	// Modelos & WhatsApp
	let modelos = $state<any[]>([]);
	let modelosPadrao = $state<any[]>([]);
	let variaveis = $state<Array<{ chave: string; descricao: string }>>([]);
	let podeGerenciarModelos = $state(false);

	let modeloSelecionadoKey = $state('');
	let eventoParaTextoId = $state('');
	let textoGerado = $state('');
	let whatsappUrlGerada = $state('');
	let gerandoTexto = $state(false);

	let novoModeloNome = $state('');
	let novoModeloCategoria = $state<'evento' | 'escala' | 'lembrete' | 'aviso'>('evento');
	let novoModeloConteudo = $state('');
	let salvandoModelo = $state(false);

	// Preferências (F6)
	let notificacoesAtivasNoSistema = $state(false);
	let prefAnuncios = $state(true);
	let prefEventos = $state(true);
	let prefRsvp = $state(true);
	let prefResponsabilidades = $state(true);
	let silencioInicio = $state(22);
	let silencioFim = $state(7);
	let salvandoPref = $state(false);

	const STATUS_ANUNCIO: Record<string, string> = {
		draft: 'Rascunho',
		published: 'Publicado',
		archived: 'Arquivado'
	};

	const CATEGORIA_MODELO: Record<string, string> = {
		evento: 'Encontro',
		escala: 'Escala',
		lembrete: 'Lembrete',
		aviso: 'Aviso'
	};

	const HORAS = Array.from({ length: 24 }, (_, i) => i);

	onMount(() => {
		carregarTudo();
	});

	async function carregarTudo() {
		carregando = true;
		erro = undefined;
		try {
			const [resAnuncios, resModelos, resPref, resEventos, resGrupos] = await Promise.all([
				api.get('/api/comunicacao/anuncios'),
				api.get('/api/comunicacao/modelos'),
				api.get('/api/comunicacao/preferencias'),
				api.get('/api/eventos'),
				api.get('/api/grupos')
			]);

			if (resAnuncios.ok) {
				const d = await resAnuncios.json();
				anuncios = d.anuncios ?? [];
				podeCriar = Boolean(d.podeCriar);
				podePublicar = Boolean(d.podePublicar);
			}

			if (resModelos.ok) {
				const d = await resModelos.json();
				modelos = d.modelos ?? [];
				modelosPadrao = d.modelosPadrao ?? [];
				variaveis = d.variaveis ?? [];
				podeGerenciarModelos = Boolean(d.podeGerenciar);
				if (!modeloSelecionadoKey) {
					if (modelos.length > 0) {
						modeloSelecionadoKey = `db:${modelos[0].id}`;
					} else if (modelosPadrao.length > 0) {
						modeloSelecionadoKey = 'padrao:0';
					}
				}
			}

			if (resPref.ok) {
				const d = await resPref.json();
				notificacoesAtivasNoSistema = Boolean(d.notificacoesAtivasNoSistema);
				if (d.preferencias) {
					prefAnuncios = d.preferencias.announcementsEnabled;
					prefEventos = d.preferencias.eventRemindersEnabled;
					prefRsvp = d.preferencias.rsvpRemindersEnabled;
					prefResponsabilidades = d.preferencias.responsibilityRemindersEnabled;
					silencioInicio = d.preferencias.quietStartHour;
					silencioFim = d.preferencias.quietEndHour;
				}
			}

			if (resEventos.ok) {
				const d = await resEventos.json();
				eventos = d.eventos ?? [];
				if (!eventoParaTextoId && eventos.length > 0) {
					eventoParaTextoId = eventos[0].id;
				}
			}

			if (resGrupos.ok) {
				const d = await resGrupos.json();
				grupos = d.grupos ?? [];
				if (!novoGrupoId && grupos.length > 0) {
					novoGrupoId = grupos[0].id;
				}
			}
		} catch (e: any) {
			erro =
				e.message === 'sem_conexao'
					? 'Você está offline. Tente novamente quando houver conexão.'
					: 'Não foi possível carregar os avisos e modelos.';
		} finally {
			carregando = false;
		}
	}

	async function criarAnuncio() {
		if (!novoTitulo.trim() || !novoCorpo.trim()) return;
		salvandoAnuncio = true;
		erro = undefined;
		mensagem = undefined;
		try {
			const res = await api.post('/api/comunicacao/anuncios', {
				title: novoTitulo.trim(),
				body: novoCorpo.trim(),
				audienceScope: novoEscopo,
				groupId: novoEscopo === 'group' ? novoGrupoId || null : null,
				targetStatus: novoEscopo === 'status' ? novoStatusAlvo : null,
				eventId: novoEventoId || null,
				publicarAgora: podePublicar && publicarAgora
			});
			const d = await res.json().catch(() => ({}));
			if (res.ok) {
				mensagem = podePublicar && publicarAgora ? 'Aviso publicado.' : 'Rascunho salvo.';
				novoTitulo = '';
				novoCorpo = '';
				novoEventoId = '';
				await carregarTudo();
			} else {
				erro = d.erro ?? 'Não foi possível salvar o aviso.';
			}
		} catch {
			erro = 'Erro ao salvar o aviso.';
		} finally {
			salvandoAnuncio = false;
		}
	}

	async function alterarStatusAnuncio(id: string, status: 'published' | 'archived') {
		erro = undefined;
		mensagem = undefined;
		try {
			const res = await api.patch(`/api/comunicacao/anuncios/${id}`, { status });
			const d = await res.json().catch(() => ({}));
			if (res.ok) {
				mensagem = status === 'published' ? 'Aviso publicado.' : 'Aviso arquivado.';
				await carregarTudo();
			} else {
				erro = d.erro ?? 'Não foi possível atualizar o aviso.';
			}
		} catch {
			erro = 'Erro ao atualizar o aviso.';
		}
	}

	async function removerAnuncio(id: string) {
		erro = undefined;
		mensagem = undefined;
		try {
			const res = await api.delete(`/api/comunicacao/anuncios/${id}`);
			if (res.ok) {
				mensagem = 'Aviso removido.';
				await carregarTudo();
			} else {
				const d = await res.json().catch(() => ({}));
				erro = d.erro ?? 'Não foi possível remover o aviso.';
			}
		} catch {
			erro = 'Erro ao remover o aviso.';
		}
	}

	async function gerarMensagemWhatsapp() {
		if (!modeloSelecionadoKey) return;
		gerandoTexto = true;
		erro = undefined;
		try {
			const payload: Record<string, unknown> = {
				linkBase: window.location.origin
			};
			if (eventoParaTextoId) payload.eventoId = eventoParaTextoId;

			if (modeloSelecionadoKey.startsWith('db:')) {
				payload.templateId = modeloSelecionadoKey.slice(3);
			} else if (modeloSelecionadoKey.startsWith('padrao:')) {
				const idx = Number.parseInt(modeloSelecionadoKey.slice(7), 10);
				payload.conteudo = modelosPadrao[idx]?.content ?? '';
			}

			const res = await api.post('/api/comunicacao/renderizar', payload);
			const d = await res.json().catch(() => ({}));
			if (res.ok) {
				textoGerado = d.texto ?? '';
				whatsappUrlGerada = d.whatsappUrl ?? '';
			} else {
				erro = d.erro ?? 'Não foi possível montar o texto.';
			}
		} catch {
			erro = 'Erro ao montar o texto.';
		} finally {
			gerandoTexto = false;
		}
	}

	async function criarModelo() {
		if (!novoModeloNome.trim() || !novoModeloConteudo.trim()) return;
		salvandoModelo = true;
		erro = undefined;
		mensagem = undefined;
		try {
			const res = await api.post('/api/comunicacao/modelos', {
				name: novoModeloNome.trim(),
				category: novoModeloCategoria,
				content: novoModeloConteudo.trim()
			});
			const d = await res.json().catch(() => ({}));
			if (res.ok) {
				mensagem = 'Modelo salvo.';
				novoModeloNome = '';
				novoModeloConteudo = '';
				await carregarTudo();
			} else {
				erro = d.erro ?? 'Não foi possível salvar o modelo.';
			}
		} catch {
			erro = 'Erro ao salvar modelo.';
		} finally {
			salvandoModelo = false;
		}
	}

	async function desativarModelo(id: string) {
		erro = undefined;
		mensagem = undefined;
		try {
			const res = await api.delete(`/api/comunicacao/modelos/${id}`);
			if (res.ok) {
				mensagem = 'Modelo desativado.';
				await carregarTudo();
			} else {
				const d = await res.json().catch(() => ({}));
				erro = d.erro ?? 'Não foi possível desativar o modelo.';
			}
		} catch {
			erro = 'Erro ao desativar modelo.';
		}
	}

	async function salvarPreferencias() {
		salvandoPref = true;
		erro = undefined;
		mensagem = undefined;
		try {
			const res = await api.put('/api/comunicacao/preferencias', {
				announcementsEnabled: prefAnuncios,
				eventRemindersEnabled: prefEventos,
				rsvpRemindersEnabled: prefRsvp,
				responsibilityRemindersEnabled: prefResponsabilidades,
				quietStartHour: Number(silencioInicio),
				quietEndHour: Number(silencioFim)
			});
			const d = await res.json().catch(() => ({}));
			if (res.ok) {
				mensagem = d.mensagem ?? 'Preferências salvas.';
			} else {
				erro = d.erro ?? 'Não foi possível salvar suas preferências.';
			}
		} catch {
			erro = 'Erro ao salvar preferências.';
		} finally {
			salvandoPref = false;
		}
	}

	function abrirWhatsappTexto(texto: string) {
		window.open(
			`https://wa.me/?text=${encodeURIComponent(texto.trim())}`,
			'_blank',
			'noopener,noreferrer'
		);
	}

	async function copiarTexto(texto: string) {
		try {
			await navigator.clipboard.writeText(texto);
			mensagem = 'Texto copiado para a área de transferência.';
		} catch {
			erro = 'Não foi possível copiar automaticamente. Selecione o texto manualmente.';
		}
	}

	function rotuloPublico(a: any) {
		if (a.audienceScope === 'group') return a.groupName ? `Grupo ${a.groupName}` : 'Grupo';
		if (a.audienceScope === 'status') return `Status: ${a.targetStatus ?? ''}`;
		return 'Todos os Eagles';
	}

	function formatarData(data: string | null) {
		if (!data) return '';
		return new Date(data).toLocaleDateString('pt-BR', {
			day: '2-digit',
			month: '2-digit',
			hour: '2-digit',
			minute: '2-digit'
		});
	}
</script>

<svelte:head>
	<title>Comunicação e avisos · Eagles</title>
</svelte:head>

<main class="conteudo">
	<div class="pilha">
		<a href="/inicio" class="voltar">← Início</a>

		<header>
			<h1>Comunicação</h1>
			<p class="sub">
				Avisos internos, textos prontos para o WhatsApp e preferências de lembretes.
			</p>
		</header>

		<div class="abas" role="tablist" aria-label="Seções de comunicação">
			<button
				type="button"
				role="tab"
				aria-selected={aba === 'avisos'}
				class="aba"
				class:ativa={aba === 'avisos'}
				onclick={() => (aba = 'avisos')}
			>
				Avisos ({anuncios.length})
			</button>
			<button
				type="button"
				role="tab"
				aria-selected={aba === 'modelos'}
				class="aba"
				class:ativa={aba === 'modelos'}
				onclick={() => (aba = 'modelos')}
			>
				Modelos e WhatsApp
			</button>
			<button
				type="button"
				role="tab"
				aria-selected={aba === 'preferencias'}
				class="aba"
				class:ativa={aba === 'preferencias'}
				onclick={() => (aba = 'preferencias')}
			>
				Preferências
			</button>
		</div>

		{#if erro}
			<Aviso tom="erro">{erro}</Aviso>
		{/if}
		{#if mensagem}
			<Aviso tom="sucesso">{mensagem}</Aviso>
		{/if}

		{#if carregando}
			<div class="carregando">
				<Marca tamanho={44} />
				<p>Carregando comunicação…</p>
			</div>
		{:else if aba === 'avisos'}
			<section class="painel" aria-label="Avisos internos">
				{#if anuncios.length === 0}
					<div class="vazio">
						<Marca tamanho={40} />
						<h2>Nenhum aviso publicado</h2>
						<p>Os avisos importantes da liderança e do seu PG aparecem aqui.</p>
					</div>
				{:else}
					<ul class="lista">
						{#each anuncios as a (a.id)}
							<li class="item item-vertical">
								<div class="item-topo">
									<div class="item-info">
										<div class="badges">
											<span class="chip chip-publico">{rotuloPublico(a)}</span>
											{#if a.status !== 'published'}
												<span class="chip chip-{a.status}">
													{STATUS_ANUNCIO[a.status] ?? a.status}
												</span>
											{/if}
										</div>
										<strong>{a.title}</strong>
										<span class="meta">
											Por {a.authorName}
											{#if a.publishedAt}
												· {formatarData(a.publishedAt)}{/if}
										</span>
									</div>
								</div>

								<p class="corpo-aviso">{a.body}</p>

								<div class="acoes-item">
									<Botao
										variante="texto"
										onclick={() => abrirWhatsappTexto(`*${a.title}*\n\n${a.body}`)}
									>
										WhatsApp
									</Botao>
									<Botao variante="texto" onclick={() => copiarTexto(`${a.title}\n\n${a.body}`)}>
										Copiar
									</Botao>
									{#if podePublicar && a.status === 'draft'}
										<Botao variante="texto" onclick={() => alterarStatusAnuncio(a.id, 'published')}>
											Publicar
										</Botao>
									{/if}
									{#if podeCriar && a.status === 'published'}
										<Botao variante="texto" onclick={() => alterarStatusAnuncio(a.id, 'archived')}>
											Arquivar
										</Botao>
									{/if}
									{#if podeCriar}
										<Botao variante="destrutivo" onclick={() => removerAnuncio(a.id)}>
											Excluir
										</Botao>
									{/if}
								</div>
							</li>
						{/each}
					</ul>
				{/if}

				{#if podeCriar}
					<section class="subsecao">
						<h2>Novo aviso</h2>
						<form
							class="form-bloco"
							onsubmit={(e) => {
								e.preventDefault();
								criarAnuncio();
							}}
						>
							<Campo id="titulo-aviso" rotulo="Título" bind:valor={novoTitulo} obrigatorio />

							<div class="campo-select">
								<label for="escopo-aviso">Público-alvo</label>
								<select id="escopo-aviso" bind:value={novoEscopo}>
									<option value="all">Todos os Eagles</option>
									{#if grupos.length > 0}
										<option value="group">Grupo específico (PG)</option>
									{/if}
									<option value="status">Por status na comunidade</option>
								</select>
							</div>

							{#if novoEscopo === 'group' && grupos.length > 0}
								<div class="campo-select">
									<label for="grupo-aviso">Grupo</label>
									<select id="grupo-aviso" bind:value={novoGrupoId}>
										{#each grupos as g (g.id)}
											<option value={g.id}>{g.name}</option>
										{/each}
									</select>
								</div>
							{/if}

							{#if novoEscopo === 'status'}
								<div class="campo-select">
									<label for="status-aviso">Status alvo</label>
									<select id="status-aviso" bind:value={novoStatusAlvo}>
										<option value="visitante">Visitante</option>
										<option value="recorrente">Participante recorrente</option>
										<option value="membro">Membro</option>
										<option value="conselheiro">Conselheiro</option>
										<option value="lider">Líder</option>
									</select>
								</div>
							{/if}

							{#if eventos.length > 0}
								<div class="campo-select">
									<label for="evento-aviso">Vincular encontro (opcional)</label>
									<select id="evento-aviso" bind:value={novoEventoId}>
										<option value="">Sem vínculo</option>
										{#each eventos as ev (ev.id)}
											<option value={ev.id}>{ev.title}</option>
										{/each}
									</select>
								</div>
							{/if}

							<div class="campo-textarea">
								<label for="corpo-aviso">Mensagem</label>
								<textarea
									id="corpo-aviso"
									rows="4"
									bind:value={novoCorpo}
									placeholder="Escreva o aviso de forma direta e clara…"
									required
								></textarea>
							</div>

							{#if podePublicar}
								<label class="check-linha">
									<input type="checkbox" bind:checked={publicarAgora} />
									<span>Publicar imediatamente para o público selecionado</span>
								</label>
							{/if}

							<Botao tipo="submit" largura="cheia" carregando={salvandoAnuncio}>
								{podePublicar && publicarAgora ? 'Publicar aviso' : 'Salvar rascunho'}
							</Botao>
						</form>
					</section>
				{/if}
			</section>
		{:else if aba === 'modelos'}
			<section class="painel" aria-label="Modelos e gerador para WhatsApp">
				<div class="bloco-gerador">
					<h2>Gerar texto pronto para WhatsApp</h2>
					<p class="sub">
						Preenche automaticamente data, local e escala — sem incluir telefone, e-mail ou foto dos
						participantes.
					</p>

					<div class="campo-select">
						<label for="seletor-modelo">Modelo</label>
						<select id="seletor-modelo" bind:value={modeloSelecionadoKey}>
							{#if modelos.length > 0}
								<optgroup label="Modelos da equipe">
									{#each modelos as m (m.id)}
										<option value={`db:${m.id}`}>{m.name}</option>
									{/each}
								</optgroup>
							{/if}
							{#if modelosPadrao.length > 0}
								<optgroup label="Modelos iniciais">
									{#each modelosPadrao as mp, idx (mp.name)}
										<option value={`padrao:${idx}`}>{mp.name}</option>
									{/each}
								</optgroup>
							{/if}
						</select>
					</div>

					{#if eventos.length > 0}
						<div class="campo-select">
							<label for="seletor-evento-texto">Encontro de referência</label>
							<select id="seletor-evento-texto" bind:value={eventoParaTextoId}>
								{#each eventos as ev (ev.id)}
									<option value={ev.id}>{ev.title}</option>
								{/each}
							</select>
						</div>
					{/if}

					<Botao onclick={gerarMensagemWhatsapp} carregando={gerandoTexto} largura="cheia">
						Montar mensagem
					</Botao>

					{#if textoGerado}
						<div class="preview">
							<label for="texto-pronto">Pré-visualização editável</label>
							<textarea id="texto-pronto" rows="6" bind:value={textoGerado}></textarea>
							<div class="acoes-linha">
								<Botao onclick={() => abrirWhatsappTexto(textoGerado)}>Abrir no WhatsApp</Botao>
								<Botao variante="secundario" onclick={() => copiarTexto(textoGerado)}>
									Copiar texto
								</Botao>
							</div>
						</div>
					{/if}
				</div>

				{#if modelos.length > 0}
					<section class="subsecao">
						<h2>Modelos salvos</h2>
						<ul class="lista">
							{#each modelos as m (m.id)}
								<li class="item item-vertical">
									<div class="item-topo">
										<div class="item-info">
											<strong>{m.name}</strong>
											<span class="meta">
												{CATEGORIA_MODELO[m.category] ?? m.category}
											</span>
										</div>
										{#if podeGerenciarModelos}
											<Botao variante="destrutivo" onclick={() => desativarModelo(m.id)}>
												Desativar
											</Botao>
										{/if}
									</div>
									<pre class="codigo-modelo">{m.content}</pre>
								</li>
							{/each}
						</ul>
					</section>
				{/if}

				{#if podeGerenciarModelos}
					<section class="subsecao">
						<h2>Novo modelo reutilizável</h2>
						<form
							class="form-bloco"
							onsubmit={(e) => {
								e.preventDefault();
								criarModelo();
							}}
						>
							<Campo
								id="nome-modelo"
								rotulo="Nome do modelo"
								bind:valor={novoModeloNome}
								obrigatorio
							/>
							<div class="campo-select">
								<label for="cat-modelo">Categoria</label>
								<select id="cat-modelo" bind:value={novoModeloCategoria}>
									<option value="evento">Encontro</option>
									<option value="escala">Escala</option>
									<option value="lembrete">Lembrete</option>
									<option value="aviso">Aviso</option>
								</select>
							</div>
							<div class="campo-textarea">
								<label for="conteudo-modelo">Conteúdo com variáveis</label>
								<textarea
									id="conteudo-modelo"
									rows="4"
									bind:value={novoModeloConteudo}
									placeholder="*{'{{evento}}'}* em {'{{data}}'} ({'{{local}}'})"
									required
								></textarea>
								{#if variaveis.length > 0}
									<p class="dica-vars">
										Variáveis disponíveis:
										{variaveis.map((v) => `{{${v.chave}}}`).join(', ')}
									</p>
								{/if}
							</div>
							<Botao tipo="submit" largura="cheia" carregando={salvandoModelo}>Salvar modelo</Botao>
						</form>
					</section>
				{/if}
			</section>
		{:else}
			<section class="painel" aria-label="Preferências de notificação">
				{#if !notificacoesAtivasNoSistema}
					<Aviso tom="aviso">
						Notificações automáticas estão desligadas nas configurações gerais dos Eagles. Suas
						preferências abaixo já ficam salvas para quando forem ativadas.
					</Aviso>
				{/if}

				<form
					class="form-bloco"
					onsubmit={(e) => {
						e.preventDefault();
						salvarPreferencias();
					}}
				>
					<fieldset class="grupo-checks">
						<legend>O que você quer receber</legend>
						<label class="check-linha">
							<input type="checkbox" bind:checked={prefAnuncios} />
							<span>Avisos publicados para a comunidade ou meu PG</span>
						</label>
						<label class="check-linha">
							<input type="checkbox" bind:checked={prefEventos} />
							<span>Lembretes de próximos encontros</span>
						</label>
						<label class="check-linha">
							<input type="checkbox" bind:checked={prefRsvp} />
							<span>Lembretes quando ainda não confirmei presença</span>
						</label>
						<label class="check-linha">
							<input type="checkbox" bind:checked={prefResponsabilidades} />
							<span>Lembretes quando estou escalado em uma responsabilidade</span>
						</label>
					</fieldset>

					<fieldset class="grupo-checks">
						<legend>Janela de silêncio</legend>
						<p class="sub">Nenhuma notificação será enviada neste intervalo (padrão: 22h às 7h).</p>
						<div class="grade-horas">
							<div class="campo-select">
								<label for="silencio-inicio">Das</label>
								<select id="silencio-inicio" bind:value={silencioInicio}>
									{#each HORAS as h (h)}
										<option value={h}>{String(h).padStart(2, '0')}h</option>
									{/each}
								</select>
							</div>
							<div class="campo-select">
								<label for="silencio-fim">Até</label>
								<select id="silencio-fim" bind:value={silencioFim}>
									{#each HORAS as h (h)}
										<option value={h}>{String(h).padStart(2, '0')}h</option>
									{/each}
								</select>
							</div>
						</div>
					</fieldset>

					<Botao tipo="submit" largura="cheia" carregando={salvandoPref}>Salvar preferências</Botao>
				</form>
			</section>
		{/if}
	</div>
</main>

<style>
	.voltar {
		font-size: var(--texto-sm);
		font-weight: 600;
		min-height: var(--toque-min);
		display: inline-flex;
		align-items: center;
		align-self: flex-start;
	}

	header {
		display: flex;
		flex-direction: column;
		gap: var(--esp-1);
	}

	.sub {
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
	.form-bloco,
	.bloco-gerador,
	.preview {
		display: flex;
		flex-direction: column;
		gap: var(--esp-3);
	}

	.bloco-gerador {
		padding: var(--esp-4);
		background: var(--cor-superficie);
		border: 1px solid var(--cor-linha);
		border-radius: var(--raio-lg);
	}

	.bloco-gerador h2,
	.subsecao h2 {
		font-size: var(--texto-lg);
	}

	.campo-select,
	.campo-textarea {
		display: flex;
		flex-direction: column;
		gap: var(--esp-2);
	}

	.campo-select label,
	.campo-textarea label,
	.preview label {
		font-size: var(--texto-sm);
		font-weight: 600;
		color: var(--cor-texto-2);
	}

	.campo-select select,
	.campo-textarea textarea,
	.preview textarea {
		padding: var(--esp-2) var(--esp-3);
		background: var(--cor-superficie);
		color: var(--cor-texto);
		border: 1px solid var(--cor-linha-forte);
		border-radius: var(--raio);
		font-size: 16px;
		font-family: inherit;
	}

	.campo-select select {
		min-height: var(--toque-min);
	}

	.dica-vars {
		font-size: var(--texto-xs);
		color: var(--cor-texto-3);
		font-family: var(--fonte-mono);
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
	}

	.item-info {
		display: flex;
		flex-direction: column;
		gap: 4px;
		min-width: 0;
	}

	.badges {
		display: flex;
		flex-wrap: wrap;
		gap: var(--esp-1);
	}

	.chip {
		font-size: var(--texto-xs);
		font-weight: 700;
		padding: 2px 8px;
		border-radius: var(--raio-cheio);
	}

	.chip-publico {
		background: var(--cor-marca-suave);
		color: var(--cor-marca);
	}

	.chip-draft {
		background: var(--cor-aviso-suave);
		color: var(--cor-aviso);
	}

	.chip-archived {
		background: var(--cor-superficie-2);
		color: var(--cor-texto-2);
	}

	.meta {
		font-size: var(--texto-xs);
		color: var(--cor-texto-2);
	}

	.corpo-aviso {
		font-size: var(--texto-sm);
		color: var(--cor-texto);
		white-space: pre-wrap;
	}

	.codigo-modelo {
		font-family: var(--fonte-mono);
		font-size: var(--texto-xs);
		background: var(--cor-superficie-2);
		padding: var(--esp-3);
		border-radius: var(--raio-sm);
		white-space: pre-wrap;
		overflow-wrap: anywhere;
	}

	.acoes-item,
	.acoes-linha {
		display: flex;
		flex-wrap: wrap;
		gap: var(--esp-2);
	}

	.acoes-item {
		padding-top: var(--esp-2);
		border-top: 1px solid var(--cor-linha);
	}

	.subsecao {
		padding-top: var(--esp-4);
		border-top: 1px solid var(--cor-linha);
		display: flex;
		flex-direction: column;
		gap: var(--esp-3);
	}

	.grupo-checks {
		border: 1px solid var(--cor-linha);
		border-radius: var(--raio);
		padding: var(--esp-4);
		background: var(--cor-superficie);
		display: flex;
		flex-direction: column;
		gap: var(--esp-2);
	}

	.grupo-checks legend {
		font-family: var(--fonte-titulo);
		font-weight: 700;
		font-size: var(--texto-base);
		padding-inline: var(--esp-1);
	}

	.check-linha {
		display: flex;
		align-items: center;
		gap: var(--esp-2);
		min-height: var(--toque-min);
		font-size: var(--texto-sm);
		cursor: pointer;
	}

	.grade-horas {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: var(--esp-3);
	}

	.carregando,
	.vazio {
		display: flex;
		flex-direction: column;
		align-items: center;
		text-align: center;
		gap: var(--esp-3);
		padding: var(--esp-6) var(--esp-4);
	}

	.carregando p,
	.vazio p {
		color: var(--cor-texto-2);
		font-size: var(--texto-sm);
		max-width: 36ch;
	}
</style>

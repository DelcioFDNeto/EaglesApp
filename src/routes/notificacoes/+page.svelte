<script lang="ts">
	import { onMount } from 'svelte';
	import Botao from '$ui/Botao.svelte';
	import Aviso from '$ui/Aviso.svelte';
	import Marca from '$ui/Marca.svelte';
	import { api } from '$lib/api';
	import { sessao } from '$lib/sessao.svelte';

	type ItemNotificacao = {
		id: string;
		kind: 'evento' | 'rsvp' | 'escala' | 'anuncio' | 'financeiro' | 'grupo' | 'sistema';
		title: string;
		body: string;
		href: string | null;
		readAt: string | null;
		createdAt: string;
	};

	type Filtro = 'todas' | 'nao_lidas';

	let filtro = $state<Filtro>('todas');
	let carregando = $state(true);
	let erro = $state<string | undefined>(undefined);
	let mensagem = $state<string | undefined>(undefined);

	let notificacoesAtivasNoSistema = $state(false);
	let podeGerarLembretes = $state(false);
	let naoLidas = $state(0);
	let notificacoes = $state<ItemNotificacao[]>([]);

	let marcandoTodas = $state(false);
	let marcandoId = $state<string | null>(null);
	let gerandoLembretes = $state(false);

	// Web Push (opcional)
	let pushSuportado = $state(false);
	let pushPermissao = $state<NotificationPermission | 'unsupported'>('unsupported');
	let pushAtivoNoServidor = $state(false);
	let pushTotalAssinaturas = $state(0);
	let vapidPublicKey = $state<string | null>(null);
	let pushProcessando = $state(false);
	let pushInfo = $state<string | undefined>(undefined);

	const podeAbrirAdmin = $derived(
		(sessao.dados?.permissoes ?? []).some((p) => p === 'settings.manage' || p === 'rbac.manage')
	);

	const ROTULO_TIPO: Record<ItemNotificacao['kind'], string> = {
		evento: 'Encontro',
		rsvp: 'Presença',
		escala: 'Escala',
		anuncio: 'Aviso',
		financeiro: 'Financeiro',
		grupo: 'Subgrupo',
		sistema: 'Sistema'
	};

	const formatadorData = new Intl.DateTimeFormat('pt-BR', {
		day: '2-digit',
		month: '2-digit',
		hour: '2-digit',
		minute: '2-digit'
	});

	onMount(() => {
		detectarSuportePush();
		carregarTudo();
	});

	function detectarSuportePush() {
		if (
			typeof window !== 'undefined' &&
			'Notification' in window &&
			'serviceWorker' in navigator &&
			'PushManager' in window
		) {
			pushSuportado = true;
			pushPermissao = Notification.permission;
		} else {
			pushSuportado = false;
			pushPermissao = 'unsupported';
		}
	}

	async function carregarNotificacoes(novoFiltro: Filtro = filtro) {
		const query = novoFiltro === 'nao_lidas' ? '?apenasNaoLidas=1' : '';
		const res = await api.get(`/api/notificacoes${query}`);
		if (!res.ok) {
			const d = await res.json().catch(() => ({}));
			throw new Error(d.erro ?? 'Não foi possível carregar suas notificações.');
		}
		const d = await res.json();
		notificacoesAtivasNoSistema = Boolean(d.notificacoesAtivasNoSistema);
		podeGerarLembretes = Boolean(d.podeGerarLembretes);
		naoLidas = typeof d.naoLidas === 'number' ? d.naoLidas : 0;
		notificacoes = d.notificacoes ?? [];
		sessao.setNotificacoesNaoLidas(naoLidas);
	}

	async function carregarStatusPush() {
		const res = await api.get('/api/notificacoes/push');
		if (!res.ok) return;
		const d = await res.json();
		pushAtivoNoServidor = Boolean(d.ativo);
		pushTotalAssinaturas = typeof d.totalAssinaturas === 'number' ? d.totalAssinaturas : 0;
		vapidPublicKey = typeof d.vapidPublicKey === 'string' ? d.vapidPublicKey : null;
	}

	async function carregarTudo() {
		carregando = true;
		erro = undefined;
		try {
			await Promise.all([carregarNotificacoes(filtro), carregarStatusPush()]);
		} catch (e: unknown) {
			const msg = e instanceof Error ? e.message : '';
			erro =
				msg === 'sem_conexao'
					? 'Você está offline. Tente novamente quando a conexão voltar.'
					: msg || 'Não foi possível carregar as notificações.';
		} finally {
			carregando = false;
		}
	}

	async function trocarFiltro(novo: Filtro) {
		if (filtro === novo) return;
		filtro = novo;
		erro = undefined;
		try {
			await carregarNotificacoes(novo);
		} catch (e: unknown) {
			erro = e instanceof Error ? e.message : 'Não foi possível atualizar a lista.';
		}
	}

	async function marcarComoLida(id: string) {
		marcandoId = id;
		erro = undefined;
		try {
			const res = await api.patch('/api/notificacoes', { id });
			const d = await res.json().catch(() => ({}));
			if (!res.ok) {
				erro = d.erro ?? 'Não foi possível marcar a notificação como lida.';
				return;
			}
			const agoraIso = new Date().toISOString();
			if (filtro === 'nao_lidas') {
				notificacoes = notificacoes.filter((n) => n.id !== id);
			} else {
				notificacoes = notificacoes.map((n) => (n.id === id ? { ...n, readAt: agoraIso } : n));
			}
			naoLidas = typeof d.naoLidas === 'number' ? d.naoLidas : Math.max(0, naoLidas - 1);
			sessao.setNotificacoesNaoLidas(naoLidas);
		} catch {
			erro = 'Erro ao atualizar a notificação.';
		} finally {
			marcandoId = null;
		}
	}

	async function marcarTodasComoLidas() {
		marcandoTodas = true;
		erro = undefined;
		mensagem = undefined;
		try {
			const res = await api.patch('/api/notificacoes', { todas: true });
			const d = await res.json().catch(() => ({}));
			if (!res.ok) {
				erro = d.erro ?? 'Não foi possível marcar todas como lidas.';
				return;
			}
			const agoraIso = new Date().toISOString();
			if (filtro === 'nao_lidas') {
				notificacoes = [];
			} else {
				notificacoes = notificacoes.map((n) => (n.readAt ? n : { ...n, readAt: agoraIso }));
			}
			naoLidas = 0;
			sessao.setNotificacoesNaoLidas(0);
			mensagem = 'Todas as notificações foram marcadas como lidas.';
		} catch {
			erro = 'Erro ao atualizar as notificações.';
		} finally {
			marcandoTodas = false;
		}
	}

	async function gerarLembretesAgora() {
		gerandoLembretes = true;
		erro = undefined;
		mensagem = undefined;
		try {
			const res = await api.post('/api/notificacoes/gerar', {});
			const d = await res.json().catch(() => ({}));
			if (!res.ok) {
				erro = d.erro ?? 'Não foi possível gerar os lembretes.';
				return;
			}
			mensagem = d.mensagem ?? 'Verificação de lembretes concluída.';
			await carregarNotificacoes(filtro);
		} catch {
			erro = 'Erro ao disparar lembretes.';
		} finally {
			gerandoLembretes = false;
		}
	}

	function base64UrlParaUint8Array(base64Url: string): Uint8Array<ArrayBuffer> {
		const padding = '='.repeat((4 - (base64Url.length % 4)) % 4);
		const base64 = (base64Url + padding).replace(/-/g, '+').replace(/_/g, '/');
		const raw = atob(base64);
		const saida = new Uint8Array(new ArrayBuffer(raw.length));
		for (let i = 0; i < raw.length; i++) {
			saida[i] = raw.charCodeAt(i);
		}
		return saida;
	}

	async function ativarWebPush() {
		if (!pushSuportado) return;
		pushProcessando = true;
		erro = undefined;
		pushInfo = undefined;
		try {
			const perm = await Notification.requestPermission();
			pushPermissao = perm;
			if (perm !== 'granted') {
				pushInfo =
					perm === 'denied'
						? 'Permissão bloqueada no navegador. Você pode alterá-la nas configurações do site.'
						: 'Permissão não concedida agora.';
				return;
			}

			const reg = await navigator.serviceWorker.ready;
			let sub = await reg.pushManager.getSubscription();
			if (!sub) {
				if (!vapidPublicKey) {
					pushInfo =
						'Permissão concedida no navegador. O servidor ainda não tem chave VAPID configurada para envio em segundo plano; suas notificações continuam chegando aqui dentro do app.';
					return;
				}
				sub = await reg.pushManager.subscribe({
					userVisibleOnly: true,
					applicationServerKey: base64UrlParaUint8Array(vapidPublicKey)
				});
			}

			const jsonSub = sub.toJSON();
			const res = await api.post('/api/notificacoes/push', {
				endpoint: jsonSub.endpoint,
				keys: jsonSub.keys
			});
			const d = await res.json().catch(() => ({}));
			if (!res.ok) {
				erro = d.erro ?? 'Não foi possível registrar alertas neste aparelho.';
				return;
			}
			mensagem = d.mensagem ?? 'Alertas neste aparelho ativados.';
			await carregarStatusPush();
		} catch {
			erro = 'Não foi possível ativar os alertas push neste navegador.';
		} finally {
			pushProcessando = false;
		}
	}

	async function desativarWebPush() {
		pushProcessando = true;
		erro = undefined;
		pushInfo = undefined;
		try {
			let endpointAtual: string | undefined;
			if (pushSuportado) {
				const reg = await navigator.serviceWorker.ready.catch(() => null);
				const sub = await reg?.pushManager.getSubscription().catch(() => null);
				if (sub) {
					endpointAtual = sub.endpoint;
					await sub.unsubscribe().catch(() => {});
				}
			}

			const query = endpointAtual ? `?endpoint=${encodeURIComponent(endpointAtual)}` : '';
			const res = await api.delete(`/api/notificacoes/push${query}`);
			const d = await res.json().catch(() => ({}));
			if (!res.ok) {
				erro = d.erro ?? 'Não foi possível desativar os alertas push.';
				return;
			}
			mensagem = d.mensagem ?? 'Alertas neste aparelho desativados.';
			await carregarStatusPush();
		} catch {
			erro = 'Erro ao remover a assinatura de alertas.';
		} finally {
			pushProcessando = false;
		}
	}

	function aoAbrirDestino(item: ItemNotificacao) {
		if (!item.readAt) {
			void marcarComoLida(item.id);
		}
	}
</script>

<svelte:head>
	<title>Notificações · Eagles</title>
</svelte:head>

<main class="conteudo">
	<div class="pilha">
		<header class="cabecalho">
			<div>
				<h1>Notificações</h1>
				<p class="sub">
					{#if naoLidas > 0}
						Você tem {naoLidas}
						{naoLidas === 1 ? 'notificação não lida' : 'notificações não lidas'}.
					{:else}
						Lembretes de encontros, presença, escalas e avisos da comunidade.
					{/if}
				</p>
			</div>
			<a href="/comunicacao" class="link-preferencias"> Preferências e silêncio (22h–7h) </a>
		</header>

		{#if !carregando && !notificacoesAtivasNoSistema}
			<Aviso tom="aviso" titulo="Notificações automáticas desligadas">
				As notificações automáticas estão desativadas nas configurações dos Eagles.
				{#if podeAbrirAdmin}
					Você pode ativá-las em <a href="/admin">Administração</a>.
				{:else}
					A liderança pode ativá-las em Administração.
				{/if}
			</Aviso>
		{/if}

		{#if erro}
			<Aviso tom="erro">
				{erro}
				{#if !carregando && notificacoes.length === 0}
					<div class="retry-wrap">
						<Botao variante="secundario" onclick={carregarTudo}>Tentar novamente</Botao>
					</div>
				{/if}
			</Aviso>
		{/if}

		{#if mensagem}
			<Aviso tom="sucesso">{mensagem}</Aviso>
		{/if}

		{#if carregando}
			<div class="carregando" aria-live="polite">
				<Marca tamanho={44} />
				<p>Carregando notificações…</p>
			</div>
		{:else}
			<div class="barra-controles">
				<div class="abas" role="tablist" aria-label="Filtrar notificações">
					<button
						type="button"
						role="tab"
						aria-selected={filtro === 'todas'}
						class="aba"
						class:ativa={filtro === 'todas'}
						onclick={() => trocarFiltro('todas')}
					>
						Todas
					</button>
					<button
						type="button"
						role="tab"
						aria-selected={filtro === 'nao_lidas'}
						class="aba"
						class:ativa={filtro === 'nao_lidas'}
						onclick={() => trocarFiltro('nao_lidas')}
					>
						Não lidas ({naoLidas})
					</button>
				</div>

				<div class="acoes-topo">
					{#if naoLidas > 0}
						<Botao variante="secundario" onclick={marcarTodasComoLidas} carregando={marcandoTodas}>
							Marcar todas como lidas
						</Botao>
					{/if}
					{#if podeGerarLembretes}
						<Botao
							variante="secundario"
							onclick={gerarLembretesAgora}
							carregando={gerandoLembretes}
							desabilitado={!notificacoesAtivasNoSistema}
						>
							Gerar lembretes agora
						</Botao>
					{/if}
				</div>
			</div>

			{#if notificacoes.length === 0}
				<div class="vazio">
					<Marca tamanho={40} />
					<h2>
						{filtro === 'nao_lidas' ? 'Nenhuma notificação pendente' : 'Nenhuma notificação ainda'}
					</h2>
					<p>
						{filtro === 'nao_lidas'
							? 'Você já leu tudo por aqui.'
							: 'Quando houver lembretes de encontros, escalas, contribuições ou avisos, eles aparecerão aqui.'}
					</p>
				</div>
			{:else}
				<ul class="lista" aria-label="Lista de notificações">
					{#each notificacoes as item (item.id)}
						<li class="item" class:nao-lida={!item.readAt}>
							<div class="item-meta">
								<span class="chip">{ROTULO_TIPO[item.kind]}</span>
								{#if !item.readAt}
									<span class="chip chip-nova">Nova</span>
								{/if}
								<time class="data" datetime={item.createdAt}>
									{formatadorData.format(new Date(item.createdAt))}
								</time>
							</div>

							<strong class="titulo-item">{item.title}</strong>
							<p class="corpo-item">{item.body}</p>

							{#if item.href || !item.readAt}
								<div class="acoes-item">
									{#if item.href}
										<a href={item.href} class="link-acao" onclick={() => aoAbrirDestino(item)}>
											Abrir
										</a>
									{/if}
									{#if !item.readAt}
										<Botao
											variante="texto"
											onclick={() => marcarComoLida(item.id)}
											carregando={marcandoId === item.id}
										>
											Marcar como lida
										</Botao>
									{/if}
								</div>
							{/if}
						</li>
					{/each}
				</ul>
			{/if}

			<section class="bloco-push" aria-labelledby="titulo-push">
				<div class="push-cabecalho">
					<h2 id="titulo-push">Alertas neste aparelho</h2>
					<span class="chip" class:chip-ativo={pushAtivoNoServidor}>
						{pushAtivoNoServidor ? 'Ativo' : 'Opcional'}
					</span>
				</div>

				{#if !pushSuportado}
					<p class="sub">
						Este navegador não oferece suporte a alertas push. Você continua vendo todas as
						notificações aqui dentro do app.
					</p>
				{:else if pushPermissao === 'denied'}
					<p class="sub">
						As notificações do navegador estão bloqueadas para este site. Libere a permissão nas
						configurações do navegador se quiser receber alertas fora do app.
					</p>
				{:else if pushAtivoNoServidor}
					<p class="sub">
						Alertas push registrados ({pushTotalAssinaturas}
						{pushTotalAssinaturas === 1 ? 'aparelho conectado' : 'aparelhos conectados'}). Respeita
						sua janela de silêncio configurada em <a href="/comunicacao">Comunicação</a>.
					</p>
					<div class="acoes-push">
						<Botao variante="destrutivo" onclick={desativarWebPush} carregando={pushProcessando}>
							Desativar neste aparelho
						</Botao>
					</div>
				{:else}
					<p class="sub">
						Receba lembretes de encontros e escalas diretamente no navegador, respeitando sua janela
						de silêncio (22h–7h por padrão).
					</p>
					<div class="acoes-push">
						<Botao variante="secundario" onclick={ativarWebPush} carregando={pushProcessando}>
							Ativar alertas neste aparelho
						</Botao>
					</div>
				{/if}

				{#if pushInfo}
					<Aviso tom="info">{pushInfo}</Aviso>
				{/if}
			</section>
		{/if}
	</div>
</main>

<style>
	.cabecalho {
		display: flex;
		flex-wrap: wrap;
		align-items: flex-end;
		justify-content: space-between;
		gap: var(--esp-3);
	}

	.cabecalho > div {
		display: flex;
		flex-direction: column;
		gap: var(--esp-1);
	}

	.sub {
		color: var(--cor-texto-2);
		font-size: var(--texto-sm);
	}

	.link-preferencias {
		display: inline-flex;
		align-items: center;
		min-height: var(--toque-min);
		font-size: var(--texto-sm);
		font-weight: 600;
	}

	.retry-wrap {
		margin-top: var(--esp-2);
	}

	.barra-controles {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		justify-content: space-between;
		gap: var(--esp-3);
		border-bottom: 1px solid var(--cor-linha);
		padding-bottom: var(--esp-2);
	}

	.abas {
		display: flex;
		gap: var(--esp-1);
	}

	.aba {
		min-height: var(--toque-min);
		padding: 0 var(--esp-3);
		background: transparent;
		border: 0;
		border-bottom: 2px solid transparent;
		font-size: var(--texto-sm);
		font-weight: 600;
		color: var(--cor-texto-2);
		cursor: pointer;
		white-space: nowrap;
		transition:
			color var(--transicao),
			border-color var(--transicao);
	}

	.aba.ativa {
		color: var(--cor-marca);
		border-bottom-color: var(--cor-marca);
	}

	.acoes-topo {
		display: flex;
		flex-wrap: wrap;
		gap: var(--esp-2);
	}

	.lista {
		list-style: none;
		padding: 0;
		border: 1px solid var(--cor-linha);
		border-radius: var(--raio-lg);
		background: var(--cor-superficie);
		overflow: hidden;
	}

	.item {
		display: flex;
		flex-direction: column;
		gap: var(--esp-2);
		padding: var(--esp-4);
	}

	.item + .item {
		border-top: 1px solid var(--cor-linha);
	}

	.item.nao-lida {
		background: var(--cor-superficie-2);
	}

	.item-meta {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: var(--esp-2);
	}

	.chip {
		display: inline-flex;
		align-items: center;
		padding: 2px 8px;
		border-radius: var(--raio-cheio);
		background: var(--cor-superficie-3);
		color: var(--cor-texto-2);
		font-size: var(--texto-xs);
		font-weight: 700;
	}

	.chip-nova {
		background: var(--cor-marca-suave);
		color: var(--cor-marca);
	}

	.chip-ativo {
		background: var(--cor-sucesso-suave);
		color: var(--cor-sucesso);
	}

	.data {
		margin-left: auto;
		font-size: var(--texto-xs);
		color: var(--cor-texto-2);
	}

	.titulo-item {
		font-size: var(--texto-base);
		font-weight: 700;
		color: var(--cor-texto);
	}

	.corpo-item {
		font-size: var(--texto-sm);
		color: var(--cor-texto-2);
	}

	.acoes-item {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: var(--esp-2);
		margin-top: var(--esp-1);
	}

	.link-acao {
		display: inline-flex;
		align-items: center;
		min-height: var(--toque-min);
		padding: 0 var(--esp-3);
		border: 1px solid var(--cor-linha-forte);
		border-radius: var(--raio);
		background: var(--cor-superficie);
		color: var(--cor-texto);
		font-size: var(--texto-sm);
		font-weight: 600;
		text-decoration: none;
		transition:
			border-color var(--transicao),
			color var(--transicao);
	}

	@media (hover: hover) {
		.link-acao:hover {
			border-color: var(--cor-marca);
			color: var(--cor-marca);
		}
	}

	.bloco-push {
		display: flex;
		flex-direction: column;
		gap: var(--esp-3);
		padding: var(--esp-4);
		border: 1px solid var(--cor-linha);
		border-radius: var(--raio-lg);
		background: var(--cor-superficie);
	}

	.push-cabecalho {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--esp-2);
	}

	.push-cabecalho h2 {
		font-size: var(--texto-lg);
	}

	.acoes-push {
		display: flex;
		flex-wrap: wrap;
		gap: var(--esp-2);
	}

	.vazio,
	.carregando {
		display: flex;
		flex-direction: column;
		align-items: center;
		text-align: center;
		gap: var(--esp-3);
		padding: var(--esp-6) var(--esp-4);
		border: 1px solid var(--cor-linha);
		border-radius: var(--raio-lg);
		background: var(--cor-superficie);
	}

	.vazio h2 {
		font-size: var(--texto-lg);
	}

	.vazio p,
	.carregando p {
		color: var(--cor-texto-2);
		font-size: var(--texto-sm);
		max-width: 40ch;
	}
</style>

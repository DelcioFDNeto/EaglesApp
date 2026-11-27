<script lang="ts">
	import { onMount } from 'svelte';
	import Botao from '$ui/Botao.svelte';
	import Campo from '$ui/Campo.svelte';
	import Aviso from '$ui/Aviso.svelte';
	import Marca from '$ui/Marca.svelte';
	import { api } from '$lib/api';

	type Aba = 'flags' | 'rbac' | 'auditoria';

	let aba = $state<Aba>('flags');
	let carregando = $state(true);
	let erro = $state<string | undefined>(undefined);
	let mensagem = $state<string | undefined>(undefined);

	// Flags
	let flags = $state<any[]>([]);
	let salvandoFlagKey = $state<string | null>(null);

	// RBAC
	let catalogoPermissoes = $state<Array<{ key: string; descricao: string }>>([]);
	let papeis = $state<any[]>([]);
	// Líder (e Master) não saem da atribuição comum: têm mandato e limite de 2.
	const papeisAtribuiveis = $derived(papeis.filter((r) => !r.reservado));
	let atribuicoes = $state<any[]>([]);
	let pessoas = $state<any[]>([]);
	let grupos = $state<any[]>([]);

	let editandoPapelId = $state<string | null>(null);
	let permsEditando = $state<string[]>([]);
	let salvandoPapel = $state(false);

	let novoPapelKey = $state('');
	let novoPapelNome = $state('');
	let novoPapelDesc = $state('');
	let criandoPapel = $state(false);

	let atribPersonId = $state('');
	let atribRoleId = $state('');
	let atribScopeType = $state<'global' | 'group' | 'self'>('group');
	let atribScopeId = $state('');
	let salvandoAtrib = $state(false);

	// Auditoria
	let registrosAuditoria = $state<any[]>([]);
	let filtroEntidade = $state('');

	const ESCOPO_LABEL: Record<string, string> = {
		global: 'Global',
		group: 'Grupo',
		self: 'Próprio'
	};

	onMount(() => {
		carregarTudo();
	});

	async function carregarAuditoria() {
		const qs = filtroEntidade ? `?entidade=${encodeURIComponent(filtroEntidade)}` : '';
		const res = await api.get(`/api/admin/auditoria${qs}`);
		if (res.ok) {
			const d = await res.json();
			registrosAuditoria = d.registros ?? [];
		}
	}

	async function carregarTudo() {
		carregando = true;
		erro = undefined;
		try {
			const [resFlags, resPapeis, resPessoas, resGrupos] = await Promise.all([
				api.get('/api/admin/flags'),
				api.get('/api/admin/papeis'),
				api.get('/api/pessoas'),
				api.get('/api/grupos')
			]);

			if (resFlags.status === 403 && resPapeis.status === 403) {
				erro = 'Apenas administradores com permissão podem acessar esta área.';
				carregando = false;
				return;
			}

			if (resFlags.ok) {
				const d = await resFlags.json();
				flags = d.flags ?? [];
			}
			if (resPapeis.ok) {
				const d = await resPapeis.json();
				catalogoPermissoes = d.catalogoPermissoes ?? [];
				papeis = d.papeis ?? [];
				atribuicoes = d.atribuicoes ?? [];
				const primeiro = papeis.find((r) => !r.reservado);
				if (!atribRoleId && primeiro) atribRoleId = primeiro.id;
			}
			if (resPessoas.ok) {
				const d = await resPessoas.json();
				pessoas = d.pessoas ?? [];
				if (!atribPersonId && pessoas.length > 0) atribPersonId = pessoas[0].id;
			}
			if (resGrupos.ok) {
				const d = await resGrupos.json();
				grupos = d.grupos ?? [];
				if (!atribScopeId && grupos.length > 0) atribScopeId = grupos[0].id;
			}

			await carregarAuditoria();
		} catch (e: any) {
			erro =
				e.message === 'sem_conexao'
					? 'A administração exige conexão com a internet.'
					: 'Não foi possível carregar os dados de administração.';
		} finally {
			carregando = false;
		}
	}

	async function alternarFlag(flag: any) {
		salvandoFlagKey = flag.key;
		erro = undefined;
		mensagem = undefined;
		try {
			const res = await api.put('/api/admin/flags', {
				key: flag.key,
				enabled: !flag.enabled
			});
			const d = await res.json().catch(() => ({}));
			if (res.ok) {
				mensagem = d.mensagem ?? 'Configuração atualizada.';
				await carregarTudo();
			} else {
				erro = d.erro ?? 'Não foi possível alterar esta funcionalidade.';
			}
		} catch {
			erro = 'Erro ao atualizar configuração.';
		} finally {
			salvandoFlagKey = null;
		}
	}

	function abrirEdicaoPapel(papel: any) {
		if (editandoPapelId === papel.id) {
			editandoPapelId = null;
			return;
		}
		editandoPapelId = papel.id;
		permsEditando = [...(papel.permissions ?? [])];
	}

	function togglePermissao(chave: string) {
		if (permsEditando.includes(chave)) {
			permsEditando = permsEditando.filter((p) => p !== chave);
		} else {
			permsEditando = [...permsEditando, chave];
		}
	}

	async function salvarPermissoesPapel(id: string) {
		salvandoPapel = true;
		erro = undefined;
		mensagem = undefined;
		try {
			const res = await api.put(`/api/admin/papeis/${id}`, {
				permissions: permsEditando
			});
			const d = await res.json().catch(() => ({}));
			if (res.ok) {
				mensagem = 'Permissões do papel atualizadas.';
				editandoPapelId = null;
				await carregarTudo();
			} else {
				erro = d.erro ?? 'Não foi possível salvar as permissões.';
			}
		} catch {
			erro = 'Erro ao salvar permissões.';
		} finally {
			salvandoPapel = false;
		}
	}

	async function criarPapelPersonalizado() {
		if (!novoPapelKey.trim() || !novoPapelNome.trim()) return;
		criandoPapel = true;
		erro = undefined;
		mensagem = undefined;
		try {
			const res = await api.post('/api/admin/papeis', {
				key: novoPapelKey.trim().toLowerCase(),
				name: novoPapelNome.trim(),
				description: novoPapelDesc.trim() || undefined,
				permissions: ['event.view', 'person.view']
			});
			const d = await res.json().catch(() => ({}));
			if (res.ok) {
				mensagem = 'Papel personalizado criado.';
				novoPapelKey = '';
				novoPapelNome = '';
				novoPapelDesc = '';
				await carregarTudo();
			} else {
				erro = d.erro ?? 'Não foi possível criar o papel.';
			}
		} catch {
			erro = 'Erro ao criar papel.';
		} finally {
			criandoPapel = false;
		}
	}

	async function excluirPapel(id: string) {
		erro = undefined;
		mensagem = undefined;
		try {
			const res = await api.delete(`/api/admin/papeis/${id}`);
			const d = await res.json().catch(() => ({}));
			if (res.ok) {
				mensagem = 'Papel removido.';
				await carregarTudo();
			} else {
				erro = d.erro ?? 'Não foi possível excluir este papel.';
			}
		} catch {
			erro = 'Erro ao excluir papel.';
		}
	}

	async function concederAtribuicao() {
		if (!atribPersonId || !atribRoleId) return;
		salvandoAtrib = true;
		erro = undefined;
		mensagem = undefined;
		try {
			const res = await api.post('/api/admin/atribuicoes', {
				personId: atribPersonId,
				roleId: atribRoleId,
				scopeType: atribScopeType,
				scopeId: atribScopeType === 'group' ? atribScopeId || null : null
			});
			const d = await res.json().catch(() => ({}));
			if (res.ok) {
				mensagem = 'Papel atribuído com sucesso.';
				await carregarTudo();
			} else {
				erro = d.erro ?? 'Não foi possível atribuir o papel.';
			}
		} catch {
			erro = 'Erro ao atribuir papel.';
		} finally {
			salvandoAtrib = false;
		}
	}

	async function revogarAtribuicao(id: string) {
		erro = undefined;
		mensagem = undefined;
		try {
			const res = await api.delete(`/api/admin/atribuicoes/${id}`);
			const d = await res.json().catch(() => ({}));
			if (res.ok) {
				mensagem = 'Atribuição revogada.';
				await carregarTudo();
			} else {
				erro = d.erro ?? 'Não foi possível revogar.';
			}
		} catch {
			erro = 'Erro ao revogar atribuição.';
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
</script>

<svelte:head>
	<title>Administração · Eagles</title>
</svelte:head>

<main class="conteudo">
	<div class="pilha">
		<header>
			<h1>Administração</h1>
			<p class="sub">Chaves de funcionalidade, papéis com escopo e trilha de auditoria imutável.</p>
		</header>

		<div class="abas" role="tablist" aria-label="Seções de administração">
			<button
				type="button"
				role="tab"
				aria-selected={aba === 'flags'}
				class="aba"
				class:ativa={aba === 'flags'}
				onclick={() => (aba = 'flags')}
			>
				Funcionalidades ({flags.length})
			</button>
			<button
				type="button"
				role="tab"
				aria-selected={aba === 'rbac'}
				class="aba"
				class:ativa={aba === 'rbac'}
				onclick={() => (aba = 'rbac')}
			>
				Papéis e permissões ({papeis.length})
			</button>
			<button
				type="button"
				role="tab"
				aria-selected={aba === 'auditoria'}
				class="aba"
				class:ativa={aba === 'auditoria'}
				onclick={() => (aba = 'auditoria')}
			>
				Auditoria ({registrosAuditoria.length})
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
				<p>Carregando administração…</p>
			</div>
		{:else if aba === 'flags'}
			<section class="painel" aria-label="Chaves de funcionalidade">
				<p class="nota">
					Toda funcionalidade de controle nasce desligada. Ligar qualquer item abaixo é registrado
					na auditoria.
				</p>

				<ul class="lista">
					{#each flags as flag (flag.key)}
						<li class="item">
							<div class="item-topo">
								<div class="item-info">
									<span class="chip chip-neutro">{flag.modulo}</span>
									<strong>{flag.nome}</strong>
									<p class="desc">{flag.descricao}</p>
									{#if flag.updatedAt}
										<span class="meta">
											Atualizado em {formatarDataHora(flag.updatedAt)}
											{#if flag.updatedByName}
												por {flag.updatedByName}{/if}
										</span>
									{/if}
								</div>
								<button
									type="button"
									role="switch"
									aria-checked={flag.enabled}
									aria-label={`Alternar ${flag.nome}`}
									class="interruptor"
									class:ligado={flag.enabled}
									disabled={salvandoFlagKey === flag.key}
									onclick={() => alternarFlag(flag)}
								>
									<span class="bolinha"></span>
									<span class="estado-texto">{flag.enabled ? 'Ligada' : 'Desligada'}</span>
								</button>
							</div>
						</li>
					{/each}
				</ul>
			</section>
		{:else if aba === 'rbac'}
			<section class="painel" aria-label="Papéis e permissões">
				<h2>Papéis da equipe</h2>
				<ul class="lista">
					{#each papeis as papel (papel.id)}
						<li class="item">
							<div class="item-topo">
								<div class="item-info">
									<div class="badges">
										<strong>{papel.name}</strong>
										<span class="chip {papel.isSystem ? 'chip-sistema' : 'chip-neutro'}">
											{papel.reservado ? 'Liderança' : papel.isSystem ? 'Sistema' : 'Personalizado'}
										</span>
									</div>
									{#if papel.description}
										<p class="desc">{papel.description}</p>
									{/if}
									<span class="meta">
										{papel.permissions.length}
										{papel.permissions.length === 1 ? 'permissão' : 'permissões'}
									</span>
								</div>
								<div class="acoes-linha">
									{#if papel.reservado}
										<!-- Líder e Master têm regra própria: mandato de 2 anos, máximo 2. -->
										<Botao variante="texto" href="/lideranca">Ver liderança</Botao>
									{:else}
										<Botao variante="texto" onclick={() => abrirEdicaoPapel(papel)}>
											{editandoPapelId === papel.id ? 'Fechar' : 'Permissões'}
										</Botao>
									{/if}
									{#if !papel.isSystem}
										<Botao variante="destrutivo" onclick={() => excluirPapel(papel.id)}>
											Excluir
										</Botao>
									{/if}
								</div>
							</div>

							{#if editandoPapelId === papel.id}
								<div class="editor-perms">
									<div class="grade-perms">
										{#each catalogoPermissoes as perm (perm.key)}
											<label class="perm-check">
												<input
													type="checkbox"
													checked={permsEditando.includes(perm.key)}
													onchange={() => togglePermissao(perm.key)}
													disabled={perm.key === 'rbac.manage'}
													title={perm.key === 'rbac.manage' ? 'Exclusivo dos líderes' : undefined}
												/>
												<span>
													<strong>{perm.key}</strong>
													<small>{perm.descricao}</small>
												</span>
											</label>
										{/each}
									</div>
									<Botao carregando={salvandoPapel} onclick={() => salvarPermissoesPapel(papel.id)}>
										Salvar permissões
									</Botao>
								</div>
							{/if}
						</li>
					{/each}
				</ul>

				<section class="subsecao">
					<h2>Atribuições ativas</h2>
					{#if atribuicoes.length === 0}
						<p class="desc">Nenhuma atribuição registrada.</p>
					{:else}
						<ul class="lista">
							{#each atribuicoes as a (a.id)}
								<li class="item">
									<div class="item-topo">
										<div class="item-info">
											<strong>{a.personName}</strong>
											<span class="meta">
												{a.roleName} · Escopo: {ESCOPO_LABEL[a.scopeType] ?? a.scopeType}
												{#if a.groupName}
													({a.groupName}){/if}
											</span>
										</div>
										{#if a.roleKey === 'lider'}
											<Botao variante="texto" href="/lideranca">Mandato</Botao>
										{:else}
											<Botao variante="destrutivo" onclick={() => revogarAtribuicao(a.id)}>
												Revogar
											</Botao>
										{/if}
									</div>
								</li>
							{/each}
						</ul>
					{/if}

					{#if pessoas.length > 0 && papeisAtribuiveis.length > 0}
						<form
							class="form-bloco"
							onsubmit={(e) => {
								e.preventDefault();
								concederAtribuicao();
							}}
						>
							<h3>Atribuir papel a uma pessoa</h3>
							<div class="grade-2">
								<div class="campo-select">
									<label for="atrib-pessoa">Pessoa</label>
									<select id="atrib-pessoa" bind:value={atribPersonId}>
										{#each pessoas as p (p.id)}
											<option value={p.id}>{p.nome}</option>
										{/each}
									</select>
								</div>
								<div class="campo-select">
									<label for="atrib-papel">Papel</label>
									<select id="atrib-papel" bind:value={atribRoleId}>
										{#each papeisAtribuiveis as r (r.id)}
											<option value={r.id}>{r.name}</option>
										{/each}
									</select>
								</div>
							</div>
							<div class="grade-2">
								<div class="campo-select">
									<label for="atrib-escopo">Escopo</label>
									<select id="atrib-escopo" bind:value={atribScopeType}>
										<option value="global">Global (toda a equipe)</option>
										{#if grupos.length > 0}
											<option value="group">Grupo específico (PG)</option>
										{/if}
										<option value="self">Próprio (self)</option>
									</select>
								</div>
								{#if atribScopeType === 'group' && grupos.length > 0}
									<div class="campo-select">
										<label for="atrib-grupo">Grupo</label>
										<select id="atrib-grupo" bind:value={atribScopeId}>
											{#each grupos as g (g.id)}
												<option value={g.id}>{g.name}</option>
											{/each}
										</select>
									</div>
								{/if}
							</div>
							<Botao tipo="submit" largura="cheia" carregando={salvandoAtrib}>Atribuir papel</Botao>
						</form>
					{/if}
				</section>

				<section class="subsecao">
					<h2>Novo papel personalizado</h2>
					<form
						class="form-bloco"
						onsubmit={(e) => {
							e.preventDefault();
							criarPapelPersonalizado();
						}}
					>
						<div class="grade-2">
							<Campo id="papel-nome" rotulo="Nome" bind:valor={novoPapelNome} obrigatorio />
							<Campo
								id="papel-key"
								rotulo="Chave (ex.: tesoureiro)"
								bind:valor={novoPapelKey}
								obrigatorio
							/>
						</div>
						<Campo id="papel-desc" rotulo="Descrição (opcional)" bind:valor={novoPapelDesc} />
						<Botao tipo="submit" largura="cheia" carregando={criandoPapel}>Criar papel</Botao>
					</form>
				</section>
			</section>
		{:else}
			<section class="painel" aria-label="Auditoria imutável">
				<div class="campo-select">
					<label for="filtro-entidade">Filtrar por entidade</label>
					<select id="filtro-entidade" bind:value={filtroEntidade} onchange={carregarAuditoria}>
						<option value="">Todas as entidades</option>
						<option value="feature_flag">Funcionalidades</option>
						<option value="role">Papéis</option>
						<option value="person_role">Atribuições de papel</option>
						<option value="finance_transaction">Financeiro</option>
						<option value="announcement">Avisos</option>
						<option value="escala">Escalas</option>
						<option value="ai_suggestion">Assistente de IA</option>
					</select>
				</div>

				{#if registrosAuditoria.length === 0}
					<div class="vazio">
						<h2>Nenhum registro encontrado</h2>
						<p>
							Alterações em finanças, papéis, permissões e chaves aparecem aqui em ordem
							cronológica.
						</p>
					</div>
				{:else}
					<ul class="lista">
						{#each registrosAuditoria as r (r.id)}
							<li class="item">
								<div class="badges">
									<span class="chip chip-sistema">{r.action}</span>
									<span class="chip chip-neutro">{r.entity}</span>
								</div>
								<span class="meta">
									{formatarDataHora(r.at)} · {r.actorName ?? 'Sistema'}
								</span>
								{#if r.after}
									<pre class="detalhe-json">{JSON.stringify(r.after)}</pre>
								{/if}
							</li>
						{/each}
					</ul>
				{/if}
			</section>
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
	.nota,
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
	.form-bloco,
	.editor-perms {
		display: flex;
		flex-direction: column;
		gap: var(--esp-3);
	}

	.painel h2,
	.subsecao h2 {
		font-size: var(--texto-lg);
	}

	.subsecao h3 {
		font-size: var(--texto-base);
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
		min-width: 180px;
	}

	.badges {
		display: flex;
		align-items: center;
		flex-wrap: wrap;
		gap: var(--esp-2);
	}

	.chip {
		align-self: flex-start;
		font-size: var(--texto-xs);
		font-weight: 700;
		padding: 2px 8px;
		border-radius: var(--raio-cheio);
	}

	.chip-sistema {
		background: var(--cor-marca-suave);
		color: var(--cor-marca);
	}

	.chip-neutro {
		background: var(--cor-superficie-2);
		color: var(--cor-texto-2);
	}

	.meta {
		font-size: var(--texto-xs);
		color: var(--cor-texto-3);
	}

	.interruptor {
		flex: none;
		display: inline-flex;
		align-items: center;
		gap: var(--esp-2);
		min-height: var(--toque-min);
		padding: 0 var(--esp-3);
		border-radius: var(--raio-cheio);
		border: 1px solid var(--cor-linha-forte);
		background: var(--cor-superficie-2);
		color: var(--cor-texto);
		font-size: var(--texto-xs);
		font-weight: 700;
		cursor: pointer;
	}

	.interruptor.ligado {
		background: var(--cor-sucesso-suave);
		color: var(--cor-sucesso);
		border-color: var(--cor-sucesso);
	}

	.bolinha {
		width: 10px;
		height: 10px;
		border-radius: 50%;
		background: currentColor;
	}

	.editor-perms {
		padding-top: var(--esp-3);
		border-top: 1px solid var(--cor-linha);
	}

	.grade-perms {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
		gap: var(--esp-2);
	}

	.perm-check {
		display: flex;
		align-items: flex-start;
		gap: var(--esp-2);
		padding: var(--esp-2);
		border: 1px solid var(--cor-linha);
		border-radius: var(--raio-sm);
		cursor: pointer;
	}

	.perm-check span {
		display: flex;
		flex-direction: column;
		gap: 2px;
	}

	.perm-check strong {
		font-family: var(--fonte-mono);
		font-size: var(--texto-xs);
	}

	.perm-check small {
		font-size: var(--texto-xs);
		color: var(--cor-texto-2);
	}

	.subsecao {
		padding-top: var(--esp-4);
		border-top: 1px solid var(--cor-linha);
		display: flex;
		flex-direction: column;
		gap: var(--esp-3);
	}

	.campo-select {
		display: flex;
		flex-direction: column;
		gap: var(--esp-2);
	}

	.campo-select label {
		font-size: var(--texto-sm);
		font-weight: 600;
		color: var(--cor-texto-2);
	}

	.campo-select select {
		min-height: var(--toque-min);
		padding: 0 var(--esp-3);
		background: var(--cor-superficie);
		color: var(--cor-texto);
		border: 1px solid var(--cor-linha-forte);
		border-radius: var(--raio);
		font-size: 16px;
	}

	.grade-2 {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
		gap: var(--esp-3);
	}

	.acoes-linha {
		display: flex;
		gap: var(--esp-2);
		flex-wrap: wrap;
	}

	.detalhe-json {
		font-family: var(--fonte-mono);
		font-size: var(--texto-xs);
		background: var(--cor-superficie-2);
		padding: var(--esp-2) var(--esp-3);
		border-radius: var(--raio-sm);
		white-space: pre-wrap;
		overflow-wrap: anywhere;
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

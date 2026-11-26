<script lang="ts">
	import { onMount, tick } from 'svelte';
	import Botao from '$ui/Botao.svelte';
	import Campo from '$ui/Campo.svelte';
	import Aviso from '$ui/Aviso.svelte';
	import Marca from '$ui/Marca.svelte';
	import { api } from '$lib/api';

	type Acesso = 'ativo' | 'convidado' | 'sem_acesso';
	type Pessoa = {
		id: string;
		nome: string;
		grupo: string | null;
		status: string;
		acesso: Acesso;
		temContato: boolean;
		podeConvidar: boolean;
	};
	type ConvitePronto = {
		personId: string;
		nome: string;
		url: string;
		whatsapp: string;
		expiraEm: string;
		login: { tipo: 'telefone' | 'email'; valor: string };
	};

	const ROTULO_ACESSO: Record<Acesso, string> = {
		ativo: 'Com acesso',
		convidado: 'Convite enviado',
		sem_acesso: 'Sem acesso'
	};

	type Estagio = 'visitante' | 'recorrente' | 'membro';

	const ROTULO_ESTAGIO: Record<string, string> = {
		visitante: 'Visitante',
		recorrente: 'Recorrente',
		membro: 'Membro Eagles',
		conselheiro: 'Membro Eagles',
		lider: 'Membro Eagles'
	};

	const DESCRICAO_ESTAGIO: Record<Estagio, string> = {
		visitante: 'Primeiro contato. Só vê os eventos.',
		recorrente: 'Já participa do PG. Por enquanto, o mesmo acesso de visitante.',
		membro: 'Entrada nos Eagles. Vê o grupo, as escalas e o próprio financeiro.'
	};

	const SEM_CONEXAO = 'Você está offline. Tente de novo quando houver conexão.';

	let pessoas = $state<Pessoa[]>([]);
	let grupos = $state<Array<{ id: string; nome: string }>>([]);
	let podeCadastrar = $state(false);
	let carregando = $state(true);
	let erro = $state<string | undefined>();
	let busca = $state('');

	// Convite
	let convidandoId = $state<string | null>(null);
	let pedindoContatoId = $state<string | null>(null);
	let telefoneConvite = $state('');
	let erroConvite = $state<string | undefined>();
	let convitePronto = $state<ConvitePronto | null>(null);
	let copiado = $state(false);

	// Cadastro
	let nome = $state('');
	let telefone = $state('');
	let email = $state('');
	let grupoId = $state('');
	let estagio = $state<Estagio>('visitante');
	let estagiosParaCadastro = $state<Estagio[]>(['visitante']);
	let convidarEmSeguida = $state(true);
	let cadastrando = $state(false);
	let errosCadastro = $state<Record<string, string>>({});
	let erroCadastro = $state<string | undefined>();
	let sucessoCadastro = $state<string | undefined>();

	const filtradas = $derived.by(() => {
		const termo = busca
			.trim()
			.toLocaleLowerCase('pt-BR')
			.normalize('NFD')
			.replace(/\p{Diacritic}/gu, '');
		if (!termo) return pessoas;
		return pessoas.filter((p) =>
			p.nome
				.toLocaleLowerCase('pt-BR')
				.normalize('NFD')
				.replace(/\p{Diacritic}/gu, '')
				.includes(termo)
		);
	});

	const semAcesso = $derived(pessoas.filter((p) => p.acesso !== 'ativo').length);

	onMount(carregar);

	async function carregar() {
		carregando = true;
		erro = undefined;
		try {
			const res = await api.get('/api/pessoas');
			const data = await res.json().catch(() => ({}));
			if (!res.ok) {
				erro = data.erro ?? 'Não foi possível carregar as pessoas.';
				return;
			}
			pessoas = data.pessoas ?? [];
			grupos = data.gruposParaCadastro ?? [];
			podeCadastrar = Boolean(data.podeCadastrar);
			estagiosParaCadastro = data.estagiosParaCadastro ?? ['visitante'];
			if (!estagiosParaCadastro.includes(estagio)) estagio = 'visitante';
			if (!grupoId && grupos.length === 1) grupoId = grupos[0]!.id;
		} catch {
			erro = SEM_CONEXAO;
		} finally {
			carregando = false;
		}
	}

	async function convidar(pessoa: Pick<Pessoa, 'id' | 'nome'>, contato?: { telefone: string }) {
		convidandoId = pessoa.id;
		erroConvite = undefined;
		copiado = false;
		try {
			const res = await api.post(`/api/pessoas/${pessoa.id}/convite`, contato ?? {});
			const data = await res.json().catch(() => ({}));

			if (res.ok) {
				convitePronto = { personId: pessoa.id, nome: pessoa.nome, ...data };
				pedindoContatoId = null;
				telefoneConvite = '';
				pessoas = pessoas.map((p) =>
					p.id === pessoa.id ? { ...p, acesso: 'convidado', temContato: true } : p
				);
				await tick();
				document.getElementById('convite-pronto')?.focus();
				return;
			}

			if (data.codigo === 'sem_contato') {
				pedindoContatoId = pessoa.id;
				await tick();
				document.getElementById(`telefone-${pessoa.id}`)?.focus();
				return;
			}
			erroConvite = data.erro ?? 'Não foi possível gerar o convite.';
			if (pedindoContatoId !== pessoa.id) pedindoContatoId = null;
		} catch {
			erroConvite = SEM_CONEXAO;
		} finally {
			convidandoId = null;
		}
	}

	async function copiarLink() {
		if (!convitePronto) return;
		try {
			await navigator.clipboard.writeText(convitePronto.url);
			copiado = true;
		} catch {
			// Sem permissão de área de transferência: o link fica selecionável abaixo.
			(document.getElementById('link-convite') as HTMLInputElement | null)?.select();
		}
	}

	async function cadastrar(e: SubmitEvent) {
		e.preventDefault();
		cadastrando = true;
		errosCadastro = {};
		erroCadastro = undefined;
		sucessoCadastro = undefined;

		try {
			const res = await api.post('/api/pessoas', {
				nome: nome.trim(),
				telefone: telefone.trim() || undefined,
				email: email.trim() || undefined,
				grupoId: grupoId || undefined,
				estagio
			});
			const data = await res.json().catch(() => ({}));

			if (!res.ok) {
				if (data.campo) errosCadastro = { [data.campo]: data.erro };
				else erroCadastro = data.erro ?? 'Não foi possível cadastrar.';
				return;
			}

			const criada = { id: data.pessoa.id as string, nome: data.pessoa.nome as string };
			const tinhaContato = Boolean(telefone.trim() || email.trim());
			sucessoCadastro = `${criada.nome} foi cadastrado(a).`;
			nome = telefone = email = '';
			await carregar();

			if (convidarEmSeguida && tinhaContato) await convidar(criada);
		} catch {
			erroCadastro = SEM_CONEXAO;
		} finally {
			cadastrando = false;
		}
	}

	function dataCurta(iso: string) {
		return new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: 'long' });
	}
</script>

<svelte:head>
	<title>Pessoas · Eagles</title>
</svelte:head>

<main class="conteudo">
	<div class="pilha">
		<a href="/inicio" class="voltar">← Início</a>

		<header>
			<h1>Pessoas</h1>
			<p class="sub">
				Cadastre quem chega e mande o convite pelo WhatsApp. A pessoa cria a própria senha pelo
				link.
			</p>
		</header>

		{#if erro}
			<Aviso tom="erro">{erro}</Aviso>
		{/if}

		{#if convitePronto}
			<section
				id="convite-pronto"
				class="convite-pronto"
				tabindex="-1"
				aria-labelledby="titulo-convite"
			>
				<h2 id="titulo-convite">Convite pronto para {convitePronto.nome.split(' ')[0]}</h2>
				<p>
					Vale até {dataCurta(convitePronto.expiraEm)} e funciona uma vez só. Depois de criar a senha,
					{convitePronto.nome.split(' ')[0]} entra com o
					{convitePronto.login.tipo === 'telefone' ? 'telefone' : 'e-mail'}
					<strong>{convitePronto.login.valor}</strong>.
				</p>
				<div class="acoes-convite">
					<Botao href={convitePronto.whatsapp} target="_blank" rel="noopener" largura="cheia">
						Enviar pelo WhatsApp
					</Botao>
					<Botao variante="secundario" largura="cheia" onclick={copiarLink}>
						{copiado ? 'Link copiado' : 'Copiar link'}
					</Botao>
				</div>
				<label class="link-rotulo" for="link-convite">Link do convite</label>
				<input
					id="link-convite"
					class="link-convite"
					readonly
					value={convitePronto.url}
					onfocus={(e) => e.currentTarget.select()}
				/>
				<Botao variante="texto" onclick={() => (convitePronto = null)}>Fechar</Botao>
			</section>
		{/if}

		{#if erroConvite}
			<Aviso tom="erro">{erroConvite}</Aviso>
		{/if}

		{#if carregando}
			<div class="estado">
				<Marca tamanho={44} />
				<p>Carregando pessoas…</p>
			</div>
		{:else if !erro}
			{#if pessoas.length > 0}
				<div class="barra-lista">
					<Campo id="busca" rotulo="Buscar por nome" bind:valor={busca} autocomplete="off" />
					<p class="resumo">
						{pessoas.length}
						{pessoas.length === 1 ? 'pessoa' : 'pessoas'}{#if semAcesso > 0}, {semAcesso} ainda sem acesso{/if}
					</p>
				</div>

				{#if filtradas.length === 0}
					<p class="sem-resultado">Ninguém com “{busca.trim()}” no nome.</p>
				{:else}
					<ul class="lista">
						{#each filtradas as p (p.id)}
							<li class="pessoa">
								<div class="linha">
									<div class="info">
										<a class="nome" href={`/pessoas/${p.id}`}>{p.nome}</a>
										<span class="detalhe">
											{ROTULO_ESTAGIO[p.status] ?? p.status} · {p.grupo ?? 'Sem grupo'}
										</span>
									</div>
									<span class="chip chip-{p.acesso}">{ROTULO_ACESSO[p.acesso]}</span>
								</div>

								{#if p.podeConvidar && pedindoContatoId !== p.id}
									<Botao
										variante={p.acesso === 'convidado' ? 'secundario' : 'primario'}
										carregando={convidandoId === p.id}
										onclick={() => convidar(p)}
										aria-label={`${p.acesso === 'convidado' ? 'Reenviar convite para' : 'Convidar'} ${p.nome}`}
									>
										{p.acesso === 'convidado' ? 'Reenviar convite' : 'Convidar'}
									</Botao>
								{/if}

								{#if pedindoContatoId === p.id}
									<form
										class="pedir-contato"
										onsubmit={(e) => {
											e.preventDefault();
											convidar(p, { telefone: telefoneConvite });
										}}
									>
										<Campo
											id={`telefone-${p.id}`}
											rotulo={`Telefone de ${p.nome.split(' ')[0]}`}
											tipo="tel"
											inputmode="tel"
											autocomplete="off"
											ajuda="É com ele que a pessoa vai entrar no app."
											bind:valor={telefoneConvite}
											obrigatorio
										/>
										<div class="acoes-linha">
											<Botao tipo="submit" carregando={convidandoId === p.id}>Gerar convite</Botao>
											<Botao
												variante="texto"
												onclick={() => {
													pedindoContatoId = null;
													telefoneConvite = '';
												}}
											>
												Cancelar
											</Botao>
										</div>
									</form>
								{/if}
							</li>
						{/each}
					</ul>
				{/if}
			{:else}
				<div class="estado">
					<Marca tamanho={44} />
					<h2>Ninguém cadastrado ainda</h2>
					<p>
						{podeCadastrar
							? 'Cadastre a primeira pessoa abaixo e mande o convite.'
							: 'Quando a liderança cadastrar pessoas no seu grupo, elas aparecem aqui.'}
					</p>
				</div>
			{/if}

			{#if podeCadastrar}
				<section class="cadastro" aria-labelledby="titulo-cadastro">
					<h2 id="titulo-cadastro">Cadastrar pessoa</h2>
					<p class="sub">Só o nome é obrigatório. O resto pode ser completado depois.</p>

					{#if sucessoCadastro}
						<Aviso tom="sucesso">{sucessoCadastro}</Aviso>
					{/if}
					{#if erroCadastro}
						<Aviso tom="erro">{erroCadastro}</Aviso>
					{/if}

					<form onsubmit={cadastrar}>
						<Campo
							id="nome"
							rotulo="Nome completo"
							bind:valor={nome}
							erro={errosCadastro.nome}
							autocomplete="off"
							obrigatorio
						/>
						<Campo
							id="telefone"
							rotulo="Telefone (WhatsApp)"
							tipo="tel"
							inputmode="tel"
							autocomplete="off"
							ajuda="Com DDD. Vira o login da pessoa e o destino do convite."
							bind:valor={telefone}
							erro={errosCadastro.telefone}
						/>
						<Campo
							id="email"
							rotulo="E-mail"
							tipo="email"
							inputmode="email"
							autocomplete="off"
							bind:valor={email}
							erro={errosCadastro.email}
						/>

						{#if grupos.length > 0}
							<div class="campo-select">
								<label for="grupo">Grupo (PG)</label>
								<select
									id="grupo"
									bind:value={grupoId}
									aria-invalid={errosCadastro.grupoId ? 'true' : undefined}
									aria-describedby={errosCadastro.grupoId ? 'grupo-erro' : undefined}
								>
									<option value="">Sem grupo por enquanto</option>
									{#each grupos as g (g.id)}
										<option value={g.id}>{g.nome}</option>
									{/each}
								</select>
								{#if errosCadastro.grupoId}
									<p id="grupo-erro" class="erro-campo" role="alert">{errosCadastro.grupoId}</p>
								{/if}
							</div>
						{/if}

						{#if estagiosParaCadastro.length > 1}
							<fieldset class="papel">
								<legend>Em que ponto da caminhada a pessoa está</legend>
								{#each estagiosParaCadastro as e (e)}
									<label>
										<input type="radio" name="estagio" value={e} bind:group={estagio} />
										<span>
											<strong>{ROTULO_ESTAGIO[e]}</strong>
											<small>{DESCRICAO_ESTAGIO[e]}</small>
										</span>
									</label>
								{/each}
							</fieldset>
						{/if}

						<label class="marcar">
							<input type="checkbox" bind:checked={convidarEmSeguida} />
							<span>Gerar o convite logo depois (precisa de telefone ou e-mail)</span>
						</label>

						<Botao tipo="submit" largura="cheia" carregando={cadastrando}>Cadastrar</Botao>
					</form>
				</section>
			{/if}
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
		margin: 0;
		text-wrap: pretty;
	}

	h2 {
		font-size: var(--texto-lg);
	}

	/* --- Convite pronto ---------------------------------------------------- */

	.convite-pronto {
		display: flex;
		flex-direction: column;
		gap: var(--esp-3);
		padding: var(--esp-4);
		background: var(--cor-sucesso-suave);
		border: 1px solid var(--cor-sucesso);
		border-radius: var(--raio-lg);
	}

	.convite-pronto:focus-visible {
		outline: 3px solid var(--cor-foco);
		outline-offset: 2px;
	}

	.convite-pronto p {
		font-size: var(--texto-sm);
		margin: 0;
		text-wrap: pretty;
	}

	.acoes-convite {
		display: grid;
		gap: var(--esp-2);
	}

	@media (min-width: 30rem) {
		.acoes-convite {
			grid-template-columns: 1fr 1fr;
		}
	}

	.link-rotulo {
		font-size: var(--texto-xs);
		font-weight: 600;
		color: var(--cor-texto-2);
		margin-bottom: calc(var(--esp-2) * -1);
	}

	.link-convite {
		min-height: var(--toque-min);
		padding: 0 var(--esp-3);
		font-size: var(--texto-sm);
		font-family: inherit;
		color: var(--cor-texto);
		background: var(--cor-superficie);
		border: 1px solid var(--cor-linha-forte);
		border-radius: var(--raio);
		text-overflow: ellipsis;
	}

	/* --- Lista ------------------------------------------------------------- */

	.barra-lista {
		display: flex;
		flex-direction: column;
		gap: var(--esp-2);
	}

	.resumo,
	.sem-resultado {
		font-size: var(--texto-sm);
		color: var(--cor-texto-3);
		margin: 0;
	}

	.lista {
		list-style: none;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: var(--esp-2);
	}

	.pessoa {
		display: flex;
		flex-direction: column;
		gap: var(--esp-3);
		padding: var(--esp-3) var(--esp-4);
		background: var(--cor-superficie);
		border: 1px solid var(--cor-linha);
		border-radius: var(--raio);
	}

	.linha {
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		gap: var(--esp-3);
	}

	.info {
		display: flex;
		flex-direction: column;
		gap: 2px;
		min-width: 0;
	}

	.info .nome {
		font-weight: 700;
		color: var(--cor-texto);
		text-decoration: underline;
		text-decoration-color: var(--cor-linha-forte);
		text-underline-offset: 3px;
		overflow-wrap: anywhere;
		/* Alvo de toque confortável sem inflar a linha (RNF de toque). */
		padding-block: 4px;
	}

	@media (hover: hover) {
		.info .nome:hover {
			text-decoration-color: var(--cor-marca);
		}
	}

	.detalhe {
		font-size: var(--texto-xs);
		color: var(--cor-texto-3);
		font-weight: 600;
	}

	.chip {
		flex: none;
		padding: 2px 8px;
		border-radius: var(--raio-cheio);
		font-size: var(--texto-xs);
		font-weight: 700;
		white-space: nowrap;
	}

	.chip-ativo {
		background: var(--cor-sucesso-suave);
		color: var(--cor-sucesso);
		border: 1px solid var(--cor-sucesso);
	}

	.chip-convidado {
		background: var(--cor-aviso-suave);
		color: var(--cor-aviso);
		border: 1px solid var(--cor-aviso);
	}

	.chip-sem_acesso {
		background: var(--cor-superficie-2);
		color: var(--cor-texto-2);
		border: 1px solid var(--cor-linha);
	}

	.pedir-contato {
		display: flex;
		flex-direction: column;
		gap: var(--esp-3);
	}

	.acoes-linha {
		display: flex;
		flex-wrap: wrap;
		gap: var(--esp-2);
	}

	/* --- Cadastro ---------------------------------------------------------- */

	.cadastro {
		margin-top: var(--esp-3);
		padding-top: var(--esp-4);
		border-top: 1px solid var(--cor-linha);
		display: flex;
		flex-direction: column;
		gap: var(--esp-3);
	}

	form {
		display: flex;
		flex-direction: column;
		gap: var(--esp-4);
	}

	.campo-select {
		display: flex;
		flex-direction: column;
		gap: var(--esp-2);
	}

	.campo-select label,
	.papel legend {
		font-size: var(--texto-sm);
		font-weight: 600;
		color: var(--cor-texto-2);
	}

	select {
		min-height: var(--toque-min);
		padding: 0 var(--esp-3);
		background: var(--cor-superficie);
		color: var(--cor-texto);
		border: 1px solid var(--cor-linha-forte);
		border-radius: var(--raio);
		/* 16px evita o zoom automático do Safari no iPhone. */
		font-size: 16px;
		font-family: inherit;
	}

	select:focus-visible {
		border-color: var(--cor-foco);
		box-shadow: 0 0 0 3px color-mix(in srgb, var(--cor-foco) 24%, transparent);
		outline: none;
	}

	select[aria-invalid='true'] {
		border-color: var(--cor-erro);
	}

	.erro-campo {
		font-size: var(--texto-sm);
		color: var(--cor-erro);
		font-weight: 600;
	}

	.papel {
		border: 0;
		padding: 0;
		margin: 0;
		display: flex;
		flex-direction: column;
		gap: var(--esp-2);
	}

	.papel legend {
		margin-bottom: var(--esp-2);
	}

	.papel label,
	.marcar {
		display: flex;
		align-items: flex-start;
		gap: var(--esp-3);
		min-height: var(--toque-min);
		cursor: pointer;
	}

	.papel label {
		padding: var(--esp-3);
		border: 1px solid var(--cor-linha);
		border-radius: var(--raio);
	}

	.papel label:has(input:checked) {
		border-color: var(--cor-marca);
		background: var(--cor-marca-suave);
	}

	.papel span {
		display: flex;
		flex-direction: column;
		gap: 2px;
	}

	.papel small {
		font-size: var(--texto-xs);
		color: var(--cor-texto-2);
	}

	.marcar span {
		font-size: var(--texto-sm);
	}

	input[type='radio'],
	input[type='checkbox'] {
		width: 20px;
		height: 20px;
		margin-top: 1px;
		flex: none;
		accent-color: var(--cor-marca);
	}

	/* --- Estados ----------------------------------------------------------- */

	.estado {
		display: flex;
		flex-direction: column;
		align-items: center;
		text-align: center;
		gap: var(--esp-3);
		padding: var(--esp-6) var(--esp-4);
	}

	.estado p {
		color: var(--cor-texto-2);
		font-size: var(--texto-sm);
		max-width: 36ch;
	}
</style>

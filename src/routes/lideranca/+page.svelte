<script lang="ts">
	import { onMount } from 'svelte';
	import Botao from '$ui/Botao.svelte';
	import Aviso from '$ui/Aviso.svelte';
	import Campo from '$ui/Campo.svelte';
	import Marca from '$ui/Marca.svelte';
	import { api } from '$lib/api';

	type Situacao = 'em_dia' | 'renovacao_aberta' | 'vencido';
	type Mandato = {
		id: string;
		personId: string;
		nome: string;
		inicio: string;
		fim: string;
		situacao: Situacao;
		diasParaFim: number;
		podeRenovar: boolean;
		podeEncerrar: boolean;
	};
	type Historico = {
		id: string;
		nome: string;
		inicio: string;
		fim: string;
		encerradoEm: string;
		motivo: 'renovado' | 'substituido' | 'renuncia' | 'encerrado';
	};
	type Pessoa = { id: string; nome: string; acesso: 'ativo' | 'convidado' | 'sem_acesso' };

	const ROTULO_SITUACAO: Record<Situacao, string> = {
		em_dia: 'Em dia',
		renovacao_aberta: 'Renovação aberta',
		vencido: 'Vencido'
	};
	const ROTULO_MOTIVO: Record<Historico['motivo'], string> = {
		renovado: 'Renovado',
		substituido: 'Substituído',
		renuncia: 'Passou a liderança',
		encerrado: 'Encerrado'
	};
	const SEM_CONEXAO = 'Você está offline. Tente de novo quando houver conexão.';

	let mandatos = $state<Mandato[]>([]);
	let historico = $state<Historico[]>([]);
	let pessoas = $state<Pessoa[]>([]);
	let vagas = $state(0);
	let podeNomear = $state(false);
	let carregando = $state(true);
	let erro = $state<string | undefined>();
	let mensagem = $state<string | undefined>();

	let agindo = $state<string | null>(null);
	let nomeando = $state('');
	let trocandoId = $state<string | null>(null);
	let sucessor = $state('');

	// Data de início do mandato: define o ciclo de 2 anos (o acesso começa na
	// nomeação). Limites vêm do servidor, no fuso da equipe.
	let datas = $state({ hoje: '', inicioMin: '', inicioMax: '' });
	let inicioNomear = $state('');
	let inicioSucessor = $state('');

	/** Mesma regra do servidor: 2 anos, 29/02 vira 28/02. */
	function somarDoisAnos(data: string) {
		const [a, m, d] = data.split('-').map(Number) as [number, number, number];
		const ultimo = new Date(Date.UTC(a + 2, m, 0)).getUTCDate();
		return `${a + 2}-${String(m).padStart(2, '0')}-${String(Math.min(d, ultimo)).padStart(2, '0')}`;
	}

	const dataValida = (v: string) =>
		/^\d{4}-\d{2}-\d{2}$/.test(v) && v >= datas.inicioMin && v <= datas.inicioMax;

	/**
	 * Sugestão para quem assume: se o mandato que sai já está no fim (ou
	 * vencido), o novo emenda onde ele termina — o ciclo se mantém. Senão, hoje.
	 */
	function inicioSugerido(m: Mandato) {
		return m.situacao !== 'em_dia' && m.fim >= datas.inicioMin ? m.fim : datas.hoje;
	}

	const idsLideres = $derived(new Set(mandatos.map((m) => m.personId)));
	const candidatos = $derived(pessoas.filter((p) => !idsLideres.has(p.id)));

	onMount(carregar);

	async function carregar() {
		carregando = true;
		erro = undefined;
		try {
			const [resLideranca, resPessoas] = await Promise.all([
				api.get('/api/lideranca'),
				api.get('/api/pessoas')
			]);
			const dados = await resLideranca.json().catch(() => ({}));
			if (!resLideranca.ok) {
				erro = dados.erro ?? 'Não foi possível carregar a liderança.';
				return;
			}
			mandatos = dados.mandatos ?? [];
			historico = dados.historico ?? [];
			vagas = dados.vagas ?? 0;
			podeNomear = Boolean(dados.podeNomear);
			if (dados.datas) {
				datas = dados.datas;
				if (!inicioNomear) inicioNomear = datas.hoje;
			}
			if (resPessoas.ok) pessoas = (await resPessoas.json()).pessoas ?? [];
		} catch {
			erro = SEM_CONEXAO;
		} finally {
			carregando = false;
		}
	}

	async function executar(chave: string, caminho: string, corpo: unknown, sucesso: string) {
		agindo = chave;
		erro = undefined;
		mensagem = undefined;
		try {
			const res = await api.post(caminho, corpo);
			const dados = await res.json().catch(() => ({}));
			if (!res.ok) {
				erro = dados.erro ?? 'Não foi possível concluir.';
				return;
			}
			mensagem = sucesso;
			nomeando = '';
			trocandoId = null;
			sucessor = '';
			inicioNomear = '';
			await carregar();
		} catch {
			erro = SEM_CONEXAO;
		} finally {
			agindo = null;
		}
	}

	function nomear() {
		const pessoa = pessoas.find((p) => p.id === nomeando);
		if (!pessoa) return;
		executar(
			'nomear',
			'/api/lideranca',
			{ personId: pessoa.id, inicio: inicioNomear },
			`${pessoa.nome} agora é líder, com mandato até ${data(somarDoisAnos(inicioNomear))}.`
		);
	}

	function renovar(m: Mandato) {
		executar(
			`renovar-${m.id}`,
			`/api/lideranca/${m.id}/renovar`,
			{},
			`Mandato de ${primeiroNome(m.nome)} renovado por mais 2 anos.`
		);
	}

	function encerrar(m: Mandato) {
		const novo = pessoas.find((p) => p.id === sucessor);
		executar(
			`encerrar-${m.id}`,
			`/api/lideranca/${m.id}/encerrar`,
			{ sucessorId: novo?.id ?? null, inicio: novo ? inicioSucessor : null },
			novo
				? `${novo.nome} assumiu a liderança no lugar de ${primeiroNome(m.nome)}.`
				: `O mandato de ${primeiroNome(m.nome)} foi encerrado.`
		);
	}

	function primeiroNome(nome: string) {
		return nome.split(' ')[0];
	}

	function data(iso: string) {
		const [a, m, d] = iso.slice(0, 10).split('-').map(Number) as [number, number, number];
		return new Date(a, m - 1, d).toLocaleDateString('pt-BR', {
			day: '2-digit',
			month: 'short',
			year: 'numeric'
		});
	}

	function prazo(m: Mandato) {
		if (m.situacao === 'vencido') {
			const dias = Math.abs(m.diasParaFim);
			return dias === 0
				? 'Venceu hoje. Continua valendo até alguém renovar ou indicar quem assume.'
				: `Venceu há ${dias} ${dias === 1 ? 'dia' : 'dias'}. Continua valendo até alguém renovar ou indicar quem assume.`;
		}
		const d = m.diasParaFim;
		return `Termina em ${d} ${d === 1 ? 'dia' : 'dias'}.`;
	}

	function rotuloPessoa(p: Pessoa) {
		return p.acesso === 'ativo' ? p.nome : `${p.nome} (ainda sem acesso)`;
	}
</script>

<svelte:head>
	<title>Liderança · Eagles</title>
</svelte:head>

<main class="conteudo">
	<div class="pilha">
		<a href="/inicio" class="voltar">← Início</a>

		<header>
			<h1>Liderança</h1>
			<p class="sub">
				Os Eagles têm até 2 líderes, cada um com mandato de 2 anos. A renovação abre 90 dias antes
				do fim; quem sai indica quem assume.
			</p>
		</header>

		{#if erro}
			<Aviso tom="erro">{erro}</Aviso>
		{/if}
		{#if mensagem}
			<Aviso tom="sucesso">{mensagem}</Aviso>
		{/if}

		{#if carregando}
			<div class="estado">
				<Marca tamanho={44} />
				<p>Carregando a liderança…</p>
			</div>
		{:else if mandatos.length > 0 || vagas > 0}
			<ul class="vagas" aria-label="Líderes">
				{#each mandatos as m (m.id)}
					<li class="cartao situacao-{m.situacao}">
						<div class="topo">
							<strong class="nome">{m.nome}</strong>
							<span class="chip chip-{m.situacao}">{ROTULO_SITUACAO[m.situacao]}</span>
						</div>
						<div>
							<p class="periodo">{data(m.inicio)} → {data(m.fim)}</p>
							<p class="prazo">{prazo(m)}</p>
						</div>

						{#if m.podeRenovar || m.podeEncerrar}
							<div class="acoes">
								{#if m.podeRenovar}
									<Botao
										carregando={agindo === `renovar-${m.id}`}
										onclick={() => renovar(m)}
										aria-label={`Renovar o mandato de ${m.nome} por mais 2 anos`}
									>
										Renovar por mais 2 anos
									</Botao>
								{/if}
								{#if m.podeEncerrar && trocandoId !== m.id}
									<Botao
										variante="secundario"
										onclick={() => {
											trocandoId = m.id;
											sucessor = '';
											inicioSucessor = inicioSugerido(m);
										}}
										aria-label={`Indicar quem assume no lugar de ${m.nome}`}
									>
										Indicar quem assume
									</Botao>
								{/if}
							</div>
						{/if}

						{#if trocandoId === m.id}
							<form
								class="troca"
								onsubmit={(e) => {
									e.preventDefault();
									encerrar(m);
								}}
							>
								<div class="campo-select">
									<label for={`sucessor-${m.id}`}
										>Quem assume no lugar de {primeiroNome(m.nome)}</label
									>
									<select id={`sucessor-${m.id}`} bind:value={sucessor}>
										<option value="">Ninguém por enquanto (só encerrar)</option>
										{#each candidatos as p (p.id)}
											<option value={p.id}>{rotuloPessoa(p)}</option>
										{/each}
									</select>
								</div>
								{#if sucessor}
									<Campo
										id={`inicio-sucessor-${m.id}`}
										rotulo="Início do novo mandato"
										tipo="date"
										bind:valor={inicioSucessor}
										min={datas.inicioMin}
										max={datas.inicioMax}
										erro={inicioSucessor && !dataValida(inicioSucessor)
											? 'Escolha uma data entre os limites permitidos.'
											: undefined}
										ajuda={dataValida(inicioSucessor)
											? `Mandato até ${data(somarDoisAnos(inicioSucessor))}.`
											: undefined}
										obrigatorio
									/>
								{/if}
								<p class="aviso-troca">
									{primeiroNome(m.nome)} deixa de ser líder agora e volta a ter acesso de membro.
									{#if sucessor}Quem assume já entra como líder; a data só define o ciclo de 2 anos.{/if}
								</p>
								<div class="acoes">
									<Botao
										tipo="submit"
										variante="destrutivo"
										carregando={agindo === `encerrar-${m.id}`}
										desabilitado={Boolean(sucessor) && !dataValida(inicioSucessor)}
									>
										{sucessor ? 'Confirmar troca' : 'Encerrar mandato'}
									</Botao>
									<Botao variante="texto" onclick={() => (trocandoId = null)}>Cancelar</Botao>
								</div>
							</form>
						{/if}
					</li>
				{/each}

				{#each Array(vagas) as _, i (i)}
					<li class="cartao vaga">
						<strong class="nome">Vaga aberta</strong>
						<!-- Um formulário só: a segunda vaga é preenchida depois da primeira. -->
						{#if podeNomear && i === 0}
							<form
								class="troca"
								onsubmit={(e) => {
									e.preventDefault();
									nomear();
								}}
							>
								<div class="campo-select">
									<label for={`nomear-${i}`}>Quem assume</label>
									<select id={`nomear-${i}`} bind:value={nomeando} required>
										<option value="" disabled>Escolha a pessoa</option>
										{#each candidatos as p (p.id)}
											<option value={p.id}>{rotuloPessoa(p)}</option>
										{/each}
									</select>
								</div>
								<Campo
									id="inicio-nomear"
									rotulo="Início do mandato"
									tipo="date"
									bind:valor={inicioNomear}
									min={datas.inicioMin}
									max={datas.inicioMax}
									erro={inicioNomear && !dataValida(inicioNomear)
										? 'Escolha uma data entre os limites permitidos.'
										: undefined}
									ajuda={dataValida(inicioNomear)
										? `Mandato até ${data(somarDoisAnos(inicioNomear))}.`
										: undefined}
									obrigatorio
								/>
								<p class="aviso-troca">
									A pessoa já entra como líder ao ser nomeada; a data só define o ciclo de 2 anos
									(pode ser no passado, para um mandato que já corre, ou até 90 dias à frente). Quem
									ainda não tem acesso recebe o convite em <a href="/pessoas">Pessoas</a>.
								</p>
								<Botao
									tipo="submit"
									carregando={agindo === 'nomear'}
									desabilitado={!nomeando || !dataValida(inicioNomear)}
								>
									Nomear líder
								</Botao>
							</form>
						{:else}
							<p class="prazo">
								{podeNomear ? 'Preencha a vaga acima primeiro.' : 'Aguardando nomeação.'}
							</p>
						{/if}
					</li>
				{/each}
			</ul>

			{#if historico.length > 0}
				<section class="historico" aria-labelledby="titulo-historico">
					<h2 id="titulo-historico">Mandatos anteriores</h2>
					<ul>
						{#each historico as h (h.id)}
							<li>
								<span class="nome-hist">{h.nome}</span>
								<span class="meta">
									{data(h.inicio)} → {data(h.fim)} · {ROTULO_MOTIVO[h.motivo]} em {data(
										h.encerradoEm
									)}
								</span>
							</li>
						{/each}
					</ul>
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

	.vagas {
		list-style: none;
		padding: 0;
		display: grid;
		gap: var(--esp-3);
	}

	@media (min-width: 40rem) {
		.vagas {
			grid-template-columns: 1fr 1fr;
			align-items: start;
		}
	}

	.cartao {
		display: flex;
		flex-direction: column;
		gap: var(--esp-3);
		padding: var(--esp-4);
		background: var(--cor-superficie);
		border: 1px solid var(--cor-linha);
		border-radius: var(--raio-lg);
	}

	/* A borda reforça a situação; o texto do chip é que a comunica (RNF-12). */
	.situacao-renovacao_aberta {
		border-color: var(--cor-aviso);
	}

	.situacao-vencido {
		border-color: var(--cor-erro);
	}

	.vaga {
		border-style: dashed;
		border-color: var(--cor-linha-forte);
		background: var(--cor-superficie-2);
	}

	.topo {
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		gap: var(--esp-3);
	}

	.nome {
		font-size: var(--texto-lg);
		font-weight: 700;
		overflow-wrap: anywhere;
	}

	.periodo,
	.prazo,
	.aviso-troca {
		font-size: var(--texto-sm);
		color: var(--cor-texto-2);
		margin: 0;
		text-wrap: pretty;
	}

	.periodo {
		margin-top: 2px;
		font-variant-numeric: tabular-nums;
	}

	.chip {
		flex: none;
		padding: 2px 8px;
		border-radius: var(--raio-cheio);
		font-size: var(--texto-xs);
		font-weight: 700;
		white-space: nowrap;
	}

	.chip-em_dia {
		background: var(--cor-sucesso-suave);
		color: var(--cor-sucesso);
		border: 1px solid var(--cor-sucesso);
	}

	.chip-renovacao_aberta {
		background: var(--cor-aviso-suave);
		color: var(--cor-aviso);
		border: 1px solid var(--cor-aviso);
	}

	.chip-vencido {
		background: var(--cor-erro-suave);
		color: var(--cor-erro);
		border: 1px solid var(--cor-erro);
	}

	.acoes {
		display: flex;
		flex-wrap: wrap;
		gap: var(--esp-2);
	}

	.troca {
		display: flex;
		flex-direction: column;
		gap: var(--esp-3);
		padding-top: var(--esp-3);
		border-top: 1px solid var(--cor-linha);
	}

	.vaga .troca {
		border-top: 0;
		padding-top: 0;
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

	.historico {
		margin-top: var(--esp-3);
		padding-top: var(--esp-4);
		border-top: 1px solid var(--cor-linha);
		display: flex;
		flex-direction: column;
		gap: var(--esp-3);
	}

	.historico h2 {
		font-size: var(--texto-lg);
	}

	.historico ul {
		list-style: none;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: var(--esp-3);
	}

	.historico li {
		display: flex;
		flex-direction: column;
		gap: 2px;
	}

	.nome-hist {
		font-weight: 600;
	}

	.meta {
		font-size: var(--texto-xs);
		color: var(--cor-texto-3);
		font-variant-numeric: tabular-nums;
	}

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
	}
</style>

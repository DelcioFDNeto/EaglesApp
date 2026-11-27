<script lang="ts">
	import { goto } from '$app/navigation';
	import { onMount } from 'svelte';
	import Botao from '$ui/Botao.svelte';
	import Campo from '$ui/Campo.svelte';
	import Aviso from '$ui/Aviso.svelte';
	import Marca from '$ui/Marca.svelte';
	import ResumoAtributos from '$lib/pessoas/ResumoAtributos.svelte';
	import EditorAtributos from '$lib/pessoas/EditorAtributos.svelte';
	import {
		ATRIBUTOS_VAZIOS,
		LATERALIDADES,
		ROTULO_LATERALIDADE,
		TAMANHOS_CAMISETA,
		formatarAltura,
		parsePesoTexto,
		type AtributosPessoa,
		type Lateralidade,
		type TamanhoCamiseta
	} from '$shared/atributos';
	import { api, apiCache, type Perfil } from '$lib/api';

	let perfil = $state<Perfil | null>(null);
	let carregando = $state(true);
	let editando = $state(false);
	let editandoAtributos = $state(false);
	let mensagem = $state<string | undefined>(undefined);
	let erro = $state<string | undefined>(undefined);
	let salvando = $state(false);

	let formNome = $state('');
	let formTelefone = $state('');
	let formWhatsapp = $state('');
	let formEmail = $state('');
	let formDataNascimento = $state('');
	let formFotoUrl = $state('');
	let formRelacionamento = $state('');
	let formIrmaos = $state('');
	let formVinculosFamiliares = $state('');
	let formStatus = $state<'visitante' | 'recorrente' | 'membro' | 'conselheiro' | 'lider'>(
		'visitante'
	);
	let formObservacoes = $state('');
	let formAltura = $state('');
	let formPeso = $state('');
	let formLateralidade = $state<Lateralidade | ''>('');
	let formCamiseta = $state<TamanhoCamiseta | ''>('');
	let formPontosFortes = $state('');

	const previewAltura = $derived.by(() => {
		const n = Number(formAltura.trim());
		if (!formAltura.trim() || !Number.isInteger(n) || n < 100 || n > 250) return null;
		return formatarAltura(n);
	});

	const STATUS_ROTULO: Record<string, string> = {
		visitante: 'Visitante',
		recorrente: 'Participante recorrente',
		membro: 'Membro',
		conselheiro: 'Conselheiro',
		lider: 'Líder'
	};

	onMount(() => {
		carregarPerfil();
	});

	async function carregarPerfil(forcar = false) {
		carregando = true;
		erro = undefined;
		try {
			const dados = await apiCache.perfil(forcar ? 0 : undefined);
			perfil = dados;
			formNome = dados.nome ?? '';
			formTelefone = dados.perfil?.telefone ?? '';
			formWhatsapp = dados.perfil?.whatsapp ?? '';
			formEmail = dados.perfil?.email ?? '';
			formDataNascimento = dados.perfil?.dataNascimento ?? '';
			formFotoUrl = dados.perfil?.fotoUrl ?? '';
			formRelacionamento = dados.perfil?.relacionamento ?? '';
			formIrmaos = dados.perfil?.irmaos ?? '';
			formVinculosFamiliares = dados.perfil?.vinculosFamiliares ?? '';
			formStatus = (dados.perfil?.status as any) ?? 'visitante';
			formObservacoes = dados.perfil?.observacoes ?? '';
			formAltura = dados.atributos?.alturaCm != null ? String(dados.atributos.alturaCm) : '';
			formPeso =
				dados.atributos?.pesoKg != null
					? dados.atributos.pesoKg.toLocaleString('pt-BR', { maximumFractionDigits: 1 })
					: '';
			formLateralidade = dados.atributos?.lateralidade ?? '';
			formCamiseta = dados.atributos?.tamanhoCamiseta ?? '';
			formPontosFortes = dados.atributos?.pontosFortes ?? '';
		} catch (e: any) {
			erro =
				e.message === 'sem_conexao'
					? 'Você está offline. Os dados do perfil podem estar desatualizados.'
					: 'Não foi possível carregar o perfil. Tente novamente.';
		} finally {
			carregando = false;
		}
	}

	async function salvarPerfil() {
		erro = undefined;
		mensagem = undefined;

		let alturaCm: number | null = null;
		if (formAltura.trim()) {
			const n = Number(formAltura.trim());
			if (!Number.isInteger(n) || n < 100 || n > 250) {
				erro = 'Informe a altura em centímetros inteiros entre 100 e 250 (ex.: 178).';
				return;
			}
			alturaCm = n;
		}

		let pesoKg: number | null = null;
		if (formPeso.trim()) {
			const p = parsePesoTexto(formPeso);
			if (p === null || Number.isNaN(p) || p < 30 || p > 250) {
				erro = 'Informe um peso válido entre 30 e 250 kg (ex.: 72,5).';
				return;
			}
			pesoKg = p;
		}

		salvando = true;

		const corpo: Record<string, unknown> = {
			nome: formNome.trim() || undefined,
			telefone: formTelefone.trim() || null,
			whatsapp: formWhatsapp.trim() || null,
			email: formEmail.trim() || null,
			dataNascimento: formDataNascimento.trim() || null,
			fotoUrl: formFotoUrl.trim() || null,
			relacionamento: formRelacionamento.trim() || null,
			irmaos: formIrmaos.trim() || null,
			vinculosFamiliares: formVinculosFamiliares.trim() || null,
			observacoes: formObservacoes.trim() || null,
			alturaCm,
			pesoKg,
			lateralidade: formLateralidade || null,
			tamanhoCamiseta: formCamiseta || null,
			pontosFortes: formPontosFortes.trim() || null
		};

		if (perfil?.podeAlterarStatus) {
			corpo.status = formStatus;
		}

		try {
			const res = await api.put('/api/pessoas/me', corpo);
			const dados = await res.json().catch(() => ({}));
			if (res.ok) {
				mensagem = 'Perfil atualizado com sucesso.';
				editando = false;
				await carregarPerfil(true);
			} else {
				erro = dados.erro ?? 'Não foi possível atualizar o perfil.';
			}
		} catch (e: any) {
			erro =
				e.message === 'sem_conexao'
					? 'Você está offline. Tente novamente quando a conexão voltar.'
					: 'Erro ao salvar o perfil.';
		} finally {
			salvando = false;
		}
	}

	function rotuloStatus(s: string | null | undefined) {
		return STATUS_ROTULO[s ?? 'visitante'] ?? s ?? 'Visitante';
	}
</script>

<svelte:head>
	<title>Meu perfil · Eagles</title>
</svelte:head>

<main class="conteudo">
	<div class="pilha">
		<header>
			<h1>{editando ? 'Editar perfil' : 'Meu perfil'}</h1>
			<p class="sub">Preencha apenas o que fizer sentido agora. Seu cadastro evolui aos poucos.</p>
		</header>

		{#if erro}
			<Aviso tom="erro">{erro}</Aviso>
		{/if}
		{#if mensagem}
			<Aviso tom="sucesso">{mensagem}</Aviso>
		{/if}

		{#if carregando && !perfil}
			<div class="carregando">
				<Marca tamanho={44} />
				<p>Carregando perfil…</p>
			</div>
		{:else if perfil}
			{#if editando}
				<form
					onsubmit={(e) => {
						e.preventDefault();
						salvarPerfil();
					}}
				>
					<Campo id="nome" rotulo="Nome completo" bind:valor={formNome} obrigatorio />
					<Campo id="telefone" rotulo="Telefone" tipo="tel" bind:valor={formTelefone} />
					<Campo id="whatsapp" rotulo="WhatsApp" tipo="tel" bind:valor={formWhatsapp} />
					<Campo id="email" rotulo="E-mail" tipo="email" bind:valor={formEmail} />
					<Campo
						id="dataNascimento"
						rotulo="Data de nascimento"
						tipo="date"
						bind:valor={formDataNascimento}
					/>
					<Campo id="fotoUrl" rotulo="URL da foto" tipo="text" bind:valor={formFotoUrl} />
					<Campo
						id="relacionamento"
						rotulo="Estado civil / relacionamento"
						bind:valor={formRelacionamento}
					/>
					<Campo id="irmaos" rotulo="Irmãos na comunidade" bind:valor={formIrmaos} />
					<Campo
						id="vinculosFamiliares"
						rotulo="Vínculos familiares"
						bind:valor={formVinculosFamiliares}
					/>

					{#if perfil.podeAlterarStatus}
						<div class="campo-select">
							<label for="status">Status na comunidade</label>
							<select id="status" bind:value={formStatus}>
								<option value="visitante">Visitante</option>
								<option value="recorrente">Participante recorrente</option>
								<option value="membro">Membro</option>
								<option value="conselheiro">Conselheiro</option>
								<option value="lider">Líder</option>
							</select>
						</div>
					{/if}

					<Campo id="observacoes" rotulo="Observações" bind:valor={formObservacoes} />

					<fieldset class="bloco-draft-form">
						<legend>Dados para o Draft (opcionais)</legend>
						<p class="sub">
							As notas de Físico, Bíblico, Mental e Coordenação Motora são avaliadas pela liderança
							e conselheiros.
						</p>
						<div class="par">
							<Campo
								id="altura"
								rotulo="Altura (cm)"
								inputmode="numeric"
								placeholder="Ex.: 178"
								ajuda={previewAltura ? `Equivale a ${previewAltura}.` : 'Entre 100 e 250 cm.'}
								bind:valor={formAltura}
							/>
							<Campo
								id="peso"
								rotulo="Peso (kg)"
								placeholder="Ex.: 72,5"
								ajuda="Entre 30 e 250 kg."
								bind:valor={formPeso}
							/>
						</div>
						<div class="par">
							<div class="campo-select">
								<label for="lateralidade">Mão / pé dominante</label>
								<select id="lateralidade" bind:value={formLateralidade}>
									<option value="">Não informado</option>
									{#each LATERALIDADES as l (l)}
										<option value={l}>{ROTULO_LATERALIDADE[l]}</option>
									{/each}
								</select>
							</div>
							<div class="campo-select">
								<label for="camiseta">Tamanho de camiseta</label>
								<select id="camiseta" bind:value={formCamiseta}>
									<option value="">Não informado</option>
									{#each TAMANHOS_CAMISETA as t (t)}
										<option value={t}>{t}</option>
									{/each}
								</select>
							</div>
						</div>
						<Campo
							id="pontosFortes"
							rotulo="Pontos fortes e especialidades"
							maxlength="280"
							placeholder="Ex.: corrida, memória bíblica, estratégia"
							bind:valor={formPontosFortes}
						/>
					</fieldset>

					<div class="acoes">
						<Botao tipo="submit" largura="cheia" carregando={salvando}>Salvar alterações</Botao>
						<Botao variante="texto" largura="cheia" onclick={() => (editando = false)}>
							Cancelar
						</Botao>
					</div>
				</form>
			{:else}
				<section class="perfil-visual">
					<div class="cabecalho-perfil">
						{#if perfil.perfil?.fotoUrl}
							<img src={perfil.perfil.fotoUrl} alt={`Foto de ${perfil.nome}`} class="foto-perfil" />
						{:else}
							<div class="foto-perfil placeholder" aria-hidden="true">
								<Marca tamanho={48} />
							</div>
						{/if}

						<div class="identidade">
							<h2>{perfil.nome}</h2>
							<span class={`chip chip-${perfil.perfil?.status ?? 'visitante'}`}>
								{rotuloStatus(perfil.perfil?.status)}
							</span>
						</div>
					</div>

					<dl class="dados">
						{#if perfil.perfil?.telefone}
							<div>
								<dt>Telefone</dt>
								<dd>{perfil.perfil.telefone}</dd>
							</div>
						{/if}
						{#if perfil.perfil?.whatsapp}
							<div>
								<dt>WhatsApp</dt>
								<dd>{perfil.perfil.whatsapp}</dd>
							</div>
						{/if}
						{#if perfil.perfil?.email}
							<div>
								<dt>E-mail</dt>
								<dd>{perfil.perfil.email}</dd>
							</div>
						{/if}
						{#if perfil.perfil?.dataNascimento}
							<div>
								<dt>Nascimento</dt>
								<dd>
									{new Date(`${perfil.perfil.dataNascimento}T12:00:00`).toLocaleDateString('pt-BR')}
								</dd>
							</div>
						{/if}
						{#if perfil.perfil?.relacionamento}
							<div>
								<dt>Relacionamento</dt>
								<dd>{perfil.perfil.relacionamento}</dd>
							</div>
						{/if}
						{#if perfil.perfil?.irmaos}
							<div>
								<dt>Irmãos na comunidade</dt>
								<dd>{perfil.perfil.irmaos}</dd>
							</div>
						{/if}
						{#if perfil.perfil?.vinculosFamiliares}
							<div>
								<dt>Vínculos familiares</dt>
								<dd>{perfil.perfil.vinculosFamiliares}</dd>
							</div>
						{/if}
						{#if perfil.perfil?.observacoes}
							<div>
								<dt>Observações</dt>
								<dd>{perfil.perfil.observacoes}</dd>
							</div>
						{/if}
					</dl>

					<div class="acoes">
						<Botao onclick={() => (editando = true)} largura="cheia">Editar perfil</Botao>
					</div>

					<section class="bloco-atributos" aria-labelledby="titulo-meus-atributos">
						<div class="cabecalho-bloco">
							<h3 id="titulo-meus-atributos">Perfil de atributos (Draft)</h3>
							<div class="acoes-bloco">
								<a href="/draft" class="link-draft">Ver Draft</a>
								{#if perfil.podeAvaliarAtributos && !editandoAtributos}
									<Botao variante="texto" onclick={() => (editandoAtributos = true)}>Avaliar</Botao>
								{/if}
							</div>
						</div>

						{#if editandoAtributos}
							<EditorAtributos
								pessoaId={perfil.id}
								pessoaNome={perfil.nome}
								inicial={(perfil.atributos ?? ATRIBUTOS_VAZIOS) as AtributosPessoa}
								onSalvo={(atributosAtualizados, msg) => {
									if (perfil) perfil = { ...perfil, atributos: atributosAtualizados };
									mensagem = msg;
									editandoAtributos = false;
									carregarPerfil(true);
								}}
								onCancelar={() => (editandoAtributos = false)}
							/>
						{:else}
							<ResumoAtributos
								nome={perfil.nome}
								atributos={(perfil.atributos ?? ATRIBUTOS_VAZIOS) as AtributosPessoa}
							/>
						{/if}
					</section>

					{#if perfil.historico && perfil.historico.length > 0}
						<section class="historico">
							<h3>Histórico na comunidade</h3>
							<ul>
								{#each perfil.historico as h (h.id)}
									<li>
										<strong>{rotuloStatus(h.paraStatus)}</strong>
										{#if h.deStatus}
											<span class="detalhe">de {rotuloStatus(h.deStatus)}</span>
										{/if}
										{#if h.motivo}
											<span class="detalhe">· {h.motivo}</span>
										{/if}
										<span class="data">{new Date(h.ocorridoEm).toLocaleDateString('pt-BR')}</span>
									</li>
								{/each}
							</ul>
						</section>
					{/if}
				</section>
			{/if}
		{:else}
			<Botao variante="secundario" onclick={() => goto('/inicio')}>Voltar ao início</Botao>
		{/if}
	</div>
</main>

<style>
	header {
		display: flex;
		flex-direction: column;
		gap: var(--esp-1);
	}

	.sub {
		color: var(--cor-texto-2);
		font-size: var(--texto-sm);
		margin: 0;
	}

	form {
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

	.acoes {
		display: flex;
		flex-direction: column;
		gap: var(--esp-2);
		margin-top: var(--esp-2);
	}

	.perfil-visual {
		display: flex;
		flex-direction: column;
		gap: var(--esp-4);
	}

	.cabecalho-perfil {
		display: flex;
		align-items: center;
		gap: var(--esp-4);
		padding: var(--esp-4);
		background: var(--cor-superficie);
		border: 1px solid var(--cor-linha);
		border-radius: var(--raio-lg);
	}

	.foto-perfil {
		width: 72px;
		height: 72px;
		flex: none;
		border-radius: var(--raio-cheio);
		background: var(--cor-superficie-2);
		border: 1px solid var(--cor-linha);
		object-fit: cover;
		display: flex;
		align-items: center;
		justify-content: center;
	}

	.foto-perfil.placeholder {
		color: var(--cor-marca);
	}

	.identidade {
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		gap: var(--esp-1);
		min-width: 0;
	}

	.identidade h2 {
		font-size: var(--texto-xl);
		margin: 0;
	}

	.chip {
		display: inline-flex;
		align-items: center;
		padding: 2px 8px;
		border-radius: var(--raio-cheio);
		font-size: var(--texto-xs);
		font-weight: 700;
	}

	.chip-visitante {
		background: var(--cor-superficie-2);
		color: var(--cor-texto-2);
		border: 1px solid var(--cor-linha);
	}

	.chip-recorrente {
		background: var(--cor-marca-suave);
		color: var(--cor-marca);
		border: 1px solid var(--cor-marca);
	}

	.chip-membro {
		background: var(--cor-sucesso-suave);
		color: var(--cor-sucesso);
		border: 1px solid var(--cor-sucesso);
	}

	.chip-conselheiro,
	.chip-lider {
		background: var(--cor-marca);
		color: var(--cor-sobre-marca);
	}

	.dados {
		display: flex;
		flex-direction: column;
		gap: var(--esp-2);
		padding: var(--esp-4);
		background: var(--cor-superficie);
		border: 1px solid var(--cor-linha);
		border-radius: var(--raio);
	}

	.dados div {
		display: flex;
		flex-direction: column;
		gap: 2px;
		padding-bottom: var(--esp-2);
		border-bottom: 1px solid var(--cor-linha);
	}

	.dados div:last-child {
		padding-bottom: 0;
		border-bottom: none;
	}

	.dados dt {
		font-size: var(--texto-xs);
		font-weight: 600;
		color: var(--cor-texto-3);
	}

	.dados dd {
		font-size: var(--texto-sm);
		color: var(--cor-texto);
		overflow-wrap: anywhere;
	}

	.historico {
		padding-top: var(--esp-3);
		border-top: 1px solid var(--cor-linha);
		display: flex;
		flex-direction: column;
		gap: var(--esp-2);
	}

	.historico h3 {
		font-size: var(--texto-base);
	}

	.historico ul {
		list-style: none;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: var(--esp-2);
	}

	.historico li {
		display: flex;
		flex-wrap: wrap;
		align-items: baseline;
		gap: var(--esp-2);
		padding: var(--esp-3);
		background: var(--cor-superficie);
		border: 1px solid var(--cor-linha);
		border-radius: var(--raio);
		font-size: var(--texto-sm);
	}

	.detalhe {
		color: var(--cor-texto-2);
	}

	.data {
		margin-left: auto;
		font-size: var(--texto-xs);
		color: var(--cor-texto-3);
	}

	.carregando {
		display: flex;
		flex-direction: column;
		align-items: center;
		text-align: center;
		gap: var(--esp-3);
		padding: var(--esp-6) var(--esp-4);
	}

	.carregando p {
		color: var(--cor-texto-2);
		font-size: var(--texto-sm);
	}

	.bloco-draft-form {
		border: 0;
		border-top: 1px solid var(--cor-linha);
		padding: var(--esp-4) 0 0;
		margin: var(--esp-2) 0 0;
		display: flex;
		flex-direction: column;
		gap: var(--esp-3);
	}

	.bloco-draft-form legend {
		font-family: var(--fonte-titulo);
		font-size: var(--texto-base);
		font-weight: 700;
		color: var(--cor-texto);
		padding: 0;
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

	.bloco-atributos {
		padding-top: var(--esp-4);
		border-top: 1px solid var(--cor-linha);
		display: flex;
		flex-direction: column;
		gap: var(--esp-3);
	}

	.cabecalho-bloco {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--esp-2);
	}

	.cabecalho-bloco h3 {
		font-size: var(--texto-base);
		margin: 0;
	}

	.acoes-bloco {
		display: inline-flex;
		align-items: center;
		gap: var(--esp-3);
	}

	.link-draft {
		font-size: var(--texto-sm);
		font-weight: 600;
		color: var(--cor-marca);
		min-height: var(--toque-min);
		display: inline-flex;
		align-items: center;
	}
</style>

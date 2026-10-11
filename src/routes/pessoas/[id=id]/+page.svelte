<script lang="ts">
	import { FUSO_PADRAO } from '$shared/fuso';
	import { enhance } from '$app/forms';
	import BarraDeTopo from '$ui/BarraDeTopo.svelte';
	import Botao from '$ui/Botao.svelte';
	import Etiqueta from '$ui/Etiqueta.svelte';
	import Aviso from '$ui/Aviso.svelte';
	import Seletor from '$ui/Seletor.svelte';
	import Campo from '$ui/Campo.svelte';
	import { formatarTelefone, SITUACOES_DE_RELACIONAMENTO } from '$shared/pessoa';
	import type { ActionData, PageData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	const p = $derived(data.pessoa);

	const dataLonga = new Intl.DateTimeFormat('pt-BR', {
		timeZone: FUSO_PADRAO,
		dateStyle: 'long'
	});
	const dataCurta = new Intl.DateTimeFormat('pt-BR', {
		timeZone: FUSO_PADRAO,
		dateStyle: 'short'
	});

	function formatarData(iso: string | null): string {
		if (!iso) return '—';
		const d = new Date(iso.length === 10 ? `${iso}T12:00:00` : iso);
		return Number.isNaN(d.getTime()) ? '—' : dataLonga.format(d);
	}

	const rotuloRelacionamento = $derived(
		SITUACOES_DE_RELACIONAMENTO.find((s) => s.valor === p.sensiveis?.relationshipStatus)?.rotulo ??
			null
	);

	let trocandoEstagio = $state(false);
	let trocandoGrupo = $state(false);
</script>

<svelte:head>
	<title>{p.fullName} · Eagles</title>
</svelte:head>

<!--
	A barra NÃO repete o nome: ele já é o título da página, logo abaixo. Dois
	elementos com o mesmo texto viram dois `h1` — confunde leitor de tela e
	duplica a informação em telas estreitas, onde espaço é o que falta.
-->
<BarraDeTopo voltar="/pessoas">
	{#snippet acoes()}
		{#if data.podeEditar}
			<Botao href="/pessoas/{p.id}/editar" variante="secundario">Editar</Botao>
		{/if}
	{/snippet}
</BarraDeTopo>

<main class="conteudo">
	{#if data.acabouDeCriar}
		<Aviso tom="sucesso" titulo="Pessoa cadastrada">
			{p.fullName} está no sistema. Você pode completar o cadastro quando souber mais.
		</Aviso>
	{/if}

	{#if form?.erro}
		<Aviso tom="erro">{form.erro}</Aviso>
	{/if}
	{#if form?.sucesso}
		<Aviso tom="sucesso">{form.sucesso}</Aviso>
	{/if}

	{#if p.regime.restrito}
		<!--
			Regime restrito não é erro: é a proteção funcionando. O tom é
			informativo, e o texto explica o porquê em vez de só bloquear.
		-->
		<Aviso tom="info" titulo="Cadastro em regime restrito">{p.regime.motivo}</Aviso>
	{/if}

	<section class="cartao identidade" aria-label="Identificação">
		<h1>{p.fullName}</h1>
		<div class="chips">
			{#if p.statusNome}
				<Etiqueta cor={p.statusCor}>{p.statusNome}</Etiqueta>
			{/if}
			{#if p.idadeAnos !== null}
				<span class="idade">{p.idadeAnos} anos</span>
			{/if}
		</div>
	</section>

	{#if p.sensiveis}
		<section class="cartao" aria-label="Contato">
			<h3>Contato</h3>
			<dl>
				<dt>Telefone</dt>
				<dd>{formatarTelefone(p.sensiveis.phone) || '—'}</dd>
				<dt>WhatsApp</dt>
				<dd>{formatarTelefone(p.sensiveis.whatsapp) || '—'}</dd>
				<dt>E-mail</dt>
				<dd>{p.sensiveis.email ?? '—'}</dd>
				<dt>Relacionamento</dt>
				<dd>{rotuloRelacionamento ?? '—'}</dd>
				<dt>Nascimento</dt>
				<dd>{formatarData(p.birthDate)}</dd>
				<dt>Participa desde</dt>
				<dd>{formatarData(p.joinedAt)}</dd>
			</dl>

			{#if p.sensiveis.notes}
				<div class="observacoes">
					<h4>Observações</h4>
					<p>{p.sensiveis.notes}</p>
				</div>
			{/if}
		</section>
	{:else}
		<section class="cartao" aria-label="Contato">
			<h3>Contato</h3>
			<p class="legenda">
				As informações de contato desta pessoa são visíveis apenas para quem tem permissão para ver
				dados sensíveis.
			</p>
		</section>
	{/if}

	<section class="cartao" aria-label="Grupo">
		<h3>Grupo</h3>
		{#if data.grupo}
			<p class="grupo-atual">
				<a href="/grupos/{data.grupo.id}"
					><Etiqueta cor={data.grupo.cor}>{data.grupo.nome}</Etiqueta></a
				>
				<span class="legenda">desde {formatarData(data.grupo.desde)}</span>
			</p>
		{:else}
			<p class="legenda">Ainda não está em nenhum grupo.</p>
		{/if}

		{#if data.destinosDeGrupo.length > 0}
			<form
				method="POST"
				action="?/mudarGrupo"
				use:enhance={() => {
					trocandoGrupo = true;
					return async ({ update }) => {
						await update();
						trocandoGrupo = false;
					};
				}}
			>
				<Seletor
					id="grupoId"
					rotulo={data.grupo ? 'Mudar para' : 'Colocar no grupo'}
					opcoes={data.destinosDeGrupo}
					vazio="Escolha o grupo"
				/>
				{#if data.grupo}
					<Campo
						id="motivoGrupo"
						rotulo="Motivo da mudança de grupo (opcional)"
						ajuda="Fica na linha do tempo da pessoa."
					/>
				{/if}
				<Botao tipo="submit" variante="secundario" carregando={trocandoGrupo}>
					{data.grupo ? 'Mudar de grupo' : 'Colocar no grupo'}
				</Botao>
			</form>
		{/if}
	</section>

	{#if data.frequencia}
		<section class="cartao" aria-label="Frequência">
			<h3>Frequência</h3>
			{#if data.frequencia.percentual === null}
				<p class="legenda">
					Nenhum encontro com lista feita nas últimas 8 semanas em que a pessoa era esperada.
				</p>
			{:else}
				<p class="frequencia">
					<strong>{data.frequencia.percentual}%</strong>
					<span class="legenda">
						esteve em {data.frequencia.presentes} de {data.frequencia.esperados} encontros nas últimas
						8 semanas
					</span>
				</p>
			{/if}
			{#if data.frequencia.encontros.length > 0}
				<ul class="encontros">
					{#each data.frequencia.encontros as e (e.id)}
						<li>
							<span class="situacao {e.situacao}">
								{e.situacao === 'veio' ? 'Veio' : e.situacao === 'visitou' ? 'Visitou' : 'Não veio'}
							</span>
							<a href="/agenda/{e.id}">{e.titulo}</a>
							<span class="legenda">{e.data}</span>
						</li>
					{/each}
				</ul>
			{/if}
		</section>
	{/if}

	<section class="cartao" aria-label="Acesso ao app">
		<h3>Acesso ao app</h3>
		{#if data.papeis.length > 0}
			<p class="papeis">{data.papeis.join(' · ')}</p>
		{:else}
			<p class="legenda">Sem papel no app.</p>
		{/if}
		{#if data.podeGerenciarAcesso}
			<Botao href="/pessoas/{p.id}/acesso" variante="secundario">Gerenciar acesso</Botao>
		{/if}
	</section>

	{#if data.vinculos.length > 0}
		<section class="cartao">
			<h3>Vínculos</h3>
			<ul class="vinculos">
				{#each data.vinculos as v (v.id)}
					<li>
						<a href="/pessoas/{v.outraPessoaId}">{v.outraPessoaNome}</a>
						<span class="tipo">
							{#if v.tipo === 'responsavel_legal'}
								{v.souOResponsavel ? 'é responsável por esta pessoa' : 'responsável legal'}
							{:else if v.tipo === 'irmao'}
								irmão(ã)
							{:else if v.tipo === 'conjuge'}
								cônjuge
							{:else}
								namorado(a)
							{/if}
						</span>
					</li>
				{/each}
			</ul>
		</section>
	{/if}

	{#if data.podeEditar}
		<section class="cartao">
			<h3>Mudar de estágio</h3>
			<p class="legenda">
				A mudança fica registrada com seu nome e a data. Nada promove ninguém automaticamente.
			</p>

			<form
				method="POST"
				action="?/mudarEstagio"
				use:enhance={() => {
					trocandoEstagio = true;
					return async ({ update }) => {
						await update();
						trocandoEstagio = false;
					};
				}}
			>
				<Seletor
					id="estagioId"
					rotulo="Novo estágio"
					opcoes={data.estagios}
					vazio="Escolha o estágio"
				/>
				<Campo id="motivo" rotulo="Motivo (opcional)" ajuda="Ajuda quem ler o histórico depois." />
				<Botao tipo="submit" variante="secundario" carregando={trocandoEstagio}>
					Registrar mudança
				</Botao>
			</form>
		</section>
	{/if}

	<section class="cartao" aria-label="Linha do tempo">
		<h3>Linha do tempo</h3>
		{#if data.linhaDoTempo.length === 0}
			<p class="legenda">Nada registrado ainda.</p>
		{:else}
			<ol class="tempo">
				{#each data.linhaDoTempo as item (item.id)}
					<li>
						<time datetime={item.quando}>{dataCurta.format(new Date(item.quando))}</time>
						<div>
							<strong>
								{#if item.tipo === 'grupo'}
									{#if item.de && item.para}{item.de} → {item.para}{:else if item.para}Entrou no
										{item.para}{:else}Saiu do {item.de}{/if}
								{:else if item.de}{item.de} → {item.para}{:else}Entrou como {item.para}{/if}
							</strong>
							{#if item.motivo}<span class="motivo">{item.motivo}</span>{/if}
						</div>
					</li>
				{/each}
			</ol>
		{/if}
	</section>

	{#if data.consentimentos.length > 0}
		<section class="cartao">
			<h3>Consentimentos</h3>
			<ul class="consentimentos">
				{#each data.consentimentos as c (c.id)}
					<li>
						<span class:concedido={c.granted}>{c.granted ? 'Concedido' : 'Revogado'}</span>
						<code>{c.kind}</code>
						<time datetime={c.at}>{dataCurta.format(new Date(c.at))}</time>
					</li>
				{/each}
			</ul>
		</section>
	{/if}
</main>

<style>
	.conteudo {
		max-width: 560px;
		margin-inline: auto;
		padding: var(--esp-4) var(--esp-3) var(--esp-6);
		display: flex;
		flex-direction: column;
		gap: var(--esp-4);
	}

	.cartao {
		background: var(--cor-superficie);
		border: 1px solid var(--cor-linha);
		border-radius: var(--raio-lg);
		padding: var(--esp-4);
		display: flex;
		flex-direction: column;
		gap: var(--esp-3);
	}

	.identidade h1 {
		font-size: var(--texto-2xl);
		font-weight: 800;
		letter-spacing: -0.03em;
		text-wrap: balance;
	}

	.chips {
		display: flex;
		align-items: center;
		flex-wrap: wrap;
		gap: var(--esp-2);
	}

	.idade {
		font-size: var(--texto-sm);
		color: var(--cor-texto-3);
	}

	h3 {
		font-size: var(--texto-lg);
		font-weight: 700;
		letter-spacing: -0.02em;
	}

	h4 {
		font-size: var(--texto-sm);
		font-weight: 700;
		color: var(--cor-texto-2);
	}

	.papeis {
		font-weight: 600;
	}

	.legenda {
		font-size: var(--texto-sm);
		color: var(--cor-texto-3);
		text-wrap: pretty;
	}

	dl {
		display: grid;
		grid-template-columns: auto 1fr;
		gap: var(--esp-2) var(--esp-4);
		font-size: var(--texto-sm);
	}

	dt {
		color: var(--cor-texto-3);
	}

	dd {
		margin: 0;
		font-weight: 500;
		font-variant-numeric: tabular-nums;
	}

	.observacoes p {
		font-size: var(--texto-sm);
		color: var(--cor-texto-2);
		text-wrap: pretty;
	}

	form {
		display: flex;
		flex-direction: column;
		gap: var(--esp-3);
	}

	.grupo-atual {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: var(--esp-2);
		margin: 0 0 var(--esp-3);
	}

	.grupo-atual a {
		text-decoration: none;
	}

	.vinculos,
	.consentimentos {
		list-style: none;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: var(--esp-2);
		font-size: var(--texto-sm);
	}

	.vinculos li {
		display: flex;
		flex-wrap: wrap;
		gap: var(--esp-2);
		align-items: baseline;
	}

	.vinculos a {
		color: var(--cor-marca);
		font-weight: 600;
	}

	.tipo {
		color: var(--cor-texto-3);
	}

	.tempo {
		list-style: none;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: var(--esp-3);
		font-size: var(--texto-sm);
	}

	.tempo li {
		display: grid;
		grid-template-columns: 5.5rem 1fr;
		gap: var(--esp-3);
	}

	.tempo time {
		color: var(--cor-texto-3);
		font-variant-numeric: tabular-nums;
	}

	.motivo {
		display: block;
		color: var(--cor-texto-3);
	}

	.consentimentos li {
		display: flex;
		gap: var(--esp-2);
		align-items: baseline;
	}

	.consentimentos span {
		font-weight: 700;
		color: var(--cor-texto-3);
	}

	.consentimentos span.concedido {
		color: var(--cor-sucesso);
	}

	@media (max-width: 380px) {
		.tempo li {
			grid-template-columns: 1fr;
			gap: var(--esp-1);
		}
	}

	.frequencia {
		display: flex;
		align-items: baseline;
		flex-wrap: wrap;
		gap: var(--esp-2);
	}

	.frequencia strong {
		font-size: var(--texto-2xl);
	}

	.encontros {
		list-style: none;
		padding: 0;
		margin: 0;
		display: flex;
		flex-direction: column;
		gap: var(--esp-2);
	}

	.encontros li {
		display: flex;
		flex-wrap: wrap;
		align-items: baseline;
		gap: 2px var(--esp-2);
		font-size: var(--texto-sm);
	}

	.situacao {
		font-size: var(--texto-xs);
		font-weight: 700;
		padding: 0 var(--esp-2);
		border-radius: 999px;
		background: var(--cor-superficie-3);
		color: var(--cor-texto-3);
	}

	.situacao.veio,
	.situacao.visitou {
		background: var(--cor-sucesso-suave);
		color: var(--cor-sucesso);
	}
</style>

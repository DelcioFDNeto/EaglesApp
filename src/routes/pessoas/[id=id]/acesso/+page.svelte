<script lang="ts">
	import { FUSO_PADRAO } from '$shared/fuso';
	import { enhance } from '$app/forms';
	import BarraDeTopo from '$ui/BarraDeTopo.svelte';
	import Botao from '$ui/Botao.svelte';
	import Seletor from '$ui/Seletor.svelte';
	import Aviso from '$ui/Aviso.svelte';
	import PedidoDeReautenticacao from '$ui/PedidoDeReautenticacao.svelte';
	import type { ActionData, PageData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	const p = $derived(data.pessoa);
	const dataCurta = new Intl.DateTimeFormat('pt-BR', {
		timeZone: FUSO_PADRAO,
		dateStyle: 'short'
	});
	const dataHora = new Intl.DateTimeFormat('pt-BR', {
		timeZone: FUSO_PADRAO,
		dateStyle: 'short',
		timeStyle: 'short'
	});

	const ALCANCE = {
		global: 'toda a equipe',
		group: 'um grupo',
		self: 'os próprios dados'
	} as const;

	const ACAO: Record<string, string> = {
		'rbac.papel_atribuido': 'recebeu o papel',
		'rbac.papel_removido': 'perdeu o papel',
		'invite.emitido': 'recebeu um convite',
		'invite.aceito': 'criou o acesso',
		'auth.acesso_recuperado': 'recuperou o acesso'
	};

	const semPapel = $derived(data.atribuicoes.length === 0);
	const situacao = $derived.by(() => {
		if (!data.conta || !data.conta.temSenha) return 'Ainda não tem acesso ao app.';
		if (data.conta.desativada) return 'Acesso desativado.';
		if (!data.conta.temIdentificador)
			return 'Tem senha, mas a conta não tem e-mail nem telefone para entrar. Envie um novo convite para corrigir.';
		return data.conta.ultimoAcesso
			? `Entrou pela última vez em ${dataHora.format(new Date(data.conta.ultimoAcesso))}.`
			: 'Tem acesso, mas ainda não entrou.';
	});

	let copiado = $state(false);
	async function copiar(texto: string) {
		try {
			await navigator.clipboard.writeText(texto);
			copiado = true;
			setTimeout(() => (copiado = false), 2500);
		} catch {
			// Sem permissão de área de transferência: o link continua visível e
			// selecionável no campo logo acima.
		}
	}
</script>

<svelte:head>
	<title>Acesso de {p.fullName} · Eagles</title>
</svelte:head>

<BarraDeTopo voltar="/pessoas/{p.id}" titulo="Acesso ao app" />

<main class="conteudo">
	<section class="cartao" aria-label="Situação">
		<h1>{p.fullName}</h1>
		<p class="situacao">{situacao}</p>
	</section>

	{#if form?.erro}
		<Aviso tom="erro" titulo="Não deu certo">{form.erro}</Aviso>
	{/if}
	{#if form?.sucesso}
		<Aviso tom="sucesso">{form.sucesso}</Aviso>
	{/if}

	{#if form?.convite}
		<section class="cartao convite" aria-label="Convite gerado">
			<h2>{form.convite.recuperacao ? 'Link de recuperação' : 'Convite pronto'}</h2>
			<p class="legenda">
				Este link aparece só agora — o sistema não guarda uma cópia que possa ser lida. Vale até
				{dataCurta.format(new Date(form.convite.expiraEm))}.
				{#if form.convite.recuperacao}
					Ao usá-lo, a pessoa define uma senha nova e todos os aparelhos conectados saem da conta.
				{/if}
			</p>
			<label class="link">
				<span>Link</span>
				<input type="text" readonly value={form.convite.url} />
			</label>
			<div class="botoes">
				<Botao href={form.convite.whatsapp} target="_blank" rel="noopener noreferrer">
					Enviar pelo WhatsApp
				</Botao>
				<Botao variante="secundario" onclick={() => copiar(form!.convite!.texto)}>
					{copiado ? 'Copiado!' : 'Copiar mensagem'}
				</Botao>
			</div>
		</section>
	{/if}

	<section class="cartao" aria-label="Papéis">
		<h2>Papéis</h2>
		{#if semPapel}
			<p class="legenda">
				Nenhum papel. Sem papel, a pessoa entra no app mas não consegue fazer nada.
			</p>
		{:else}
			<ul class="papeis">
				{#each data.atribuicoes as a (a.id)}
					<li>
						<div class="papel">
							<strong>{a.papel}</strong>
							<span class="detalhe">
								sobre {ALCANCE[a.scopeType]} · desde {dataCurta.format(
									new Date(a.desde)
								)}{#if a.concedidoPor}
									· por {a.concedidoPor}{/if}
							</span>
						</div>
						{#if data.podeAdministrar && data.reautenticado && !data.ehVoce}
							<form method="POST" action="?/remover" use:enhance>
								<input type="hidden" name="atribuicaoId" value={a.id} />
								<Botao tipo="submit" variante="destrutivo" aria-label="Retirar o papel {a.papel}">
									Retirar
								</Botao>
							</form>
						{/if}
					</li>
				{/each}
			</ul>
		{/if}

		{#if data.podeAdministrar}
			{#if data.ehVoce}
				<p class="legenda">
					Ninguém altera o próprio acesso. Para mudar os seus papéis, peça a outra pessoa da
					liderança.
				</p>
			{:else if !data.reautenticado}
				<PedidoDeReautenticacao acao="alterar os papéis desta pessoa" />
			{:else if data.papeisAtribuiveis.length > 0}
				<form method="POST" action="?/atribuir" use:enhance class="atribuir">
					<Seletor
						id="roleId"
						rotulo="Dar um papel"
						opcoes={data.papeisAtribuiveis}
						vazio="Escolha o papel"
					/>
					<Botao tipo="submit" variante="secundario">Atribuir</Botao>
				</form>
			{/if}
			{#if data.papeisDeGrupo.length > 0 && !data.ehVoce}
				<p class="legenda">
					{data.papeisDeGrupo.join(', ')}: vale para um grupo específico e é atribuído pela tela do
					grupo.
				</p>
			{/if}
		{/if}
	</section>

	{#if data.podeConvidar}
		<section class="cartao" aria-label="Convite">
			<h2>{data.conta?.temSenha ? 'Recuperar acesso' : 'Convidar para o app'}</h2>
			{#if semPapel}
				<p class="legenda">Atribua um papel antes de convidar.</p>
			{:else if p.restrito}
				<p class="legenda">{p.motivoRestrito}</p>
			{:else if data.conta?.temSenha && !data.reautenticado}
				<PedidoDeReautenticacao acao="gerar um link de recuperação" />
			{:else}
				<p class="legenda">
					{#if data.conta?.temSenha}
						Para quem esqueceu a senha. O link gera uma senha nova e desconecta todos os aparelhos.
					{:else}
						O link vai pelo WhatsApp. A pessoa escolhe com qual e-mail ou telefone vai entrar e
						define a própria senha.
					{/if}
				</p>
				<form method="POST" action="?/convidar" use:enhance>
					<Botao tipo="submit">
						{data.conta?.temSenha ? 'Gerar link de recuperação' : 'Gerar convite'}
					</Botao>
				</form>
			{/if}
		</section>
	{/if}

	{#if data.historico.length > 0}
		<section class="cartao" aria-label="Histórico de acesso">
			<h2>Histórico</h2>
			<ol class="historico">
				{#each data.historico as h (h.id)}
					<li>
						<time datetime={h.quando}>{dataHora.format(new Date(h.quando))}</time>
						<span>
							{ACAO[h.acao]}{#if h.papel}
								“{h.papel}”{/if}{#if h.quem && h.acao !== 'invite.aceito' && h.acao !== 'auth.acesso_recuperado'}
								— por {h.quem}{/if}
						</span>
					</li>
				{/each}
			</ol>
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

	h1 {
		font-size: var(--texto-2xl);
		font-weight: 800;
		letter-spacing: -0.03em;
		text-wrap: balance;
	}

	h2 {
		font-size: var(--texto-lg);
		font-weight: 700;
		letter-spacing: -0.02em;
	}

	.situacao,
	.legenda {
		font-size: var(--texto-sm);
		color: var(--cor-texto-2);
		text-wrap: pretty;
	}

	.papeis {
		list-style: none;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: var(--esp-3);
	}

	.papeis li {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--esp-3);
	}

	.papel {
		display: flex;
		flex-direction: column;
		gap: 2px;
	}

	.detalhe {
		font-size: var(--texto-xs);
		color: var(--cor-texto-3);
	}

	.atribuir {
		display: flex;
		flex-direction: column;
		gap: var(--esp-3);
	}

	.convite {
		border-color: var(--cor-marca);
	}

	.link {
		display: flex;
		flex-direction: column;
		gap: var(--esp-1);
		font-size: var(--texto-sm);
		font-weight: 600;
		color: var(--cor-texto-2);
	}

	.link input {
		min-height: var(--toque-min);
		padding: 0 var(--esp-3);
		border: 1px solid var(--cor-linha-forte);
		border-radius: var(--raio);
		background: var(--cor-superficie-2);
		font-family: var(--fonte-mono);
		font-size: var(--texto-xs);
	}

	.botoes {
		display: flex;
		flex-wrap: wrap;
		gap: var(--esp-2);
	}

	.historico {
		list-style: none;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: var(--esp-2);
		font-size: var(--texto-sm);
	}

	.historico li {
		display: grid;
		grid-template-columns: 7.5rem 1fr;
		gap: var(--esp-3);
	}

	.historico time {
		color: var(--cor-texto-3);
		font-variant-numeric: tabular-nums;
	}

	@media (max-width: 380px) {
		.historico li {
			grid-template-columns: 1fr;
			gap: 0;
		}
	}
</style>

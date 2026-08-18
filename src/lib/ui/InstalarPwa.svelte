<script lang="ts">
	import { onMount } from 'svelte';
	import Botao from './Botao.svelte';

	/**
	 * Convite para instalar o app na tela de início.
	 *
	 * Por que isto merece um componente próprio: no iPhone, a notificação push
	 * SÓ funciona se o PWA estiver instalado na tela de início (iOS 16.4+) —
	 * é o risco R-03 do documento de arquitetura. No Android o navegador
	 * oferece a instalação sozinho; no iPhone, não. Então aqui há dois
	 * caminhos: o prompt nativo onde ele existe, e a instrução passo a passo
	 * onde não existe.
	 */

	type Prompt = Event & { prompt: () => Promise<void>; userChoice: Promise<unknown> };

	let promptAdiado = $state<Prompt | null>(null);
	let instalado = $state(true); // presume instalado até provar o contrário
	let ehIos = $state(false);
	let dispensado = $state(false);

	onMount(() => {
		instalado =
			window.matchMedia('(display-mode: standalone)').matches ||
			(navigator as { standalone?: boolean }).standalone === true;

		ehIos = /iphone|ipad|ipod/i.test(navigator.userAgent);
		dispensado = localStorage.getItem('eagles:instalar-dispensado') === '1';

		const aoPoderInstalar = (e: Event) => {
			e.preventDefault();
			promptAdiado = e as Prompt;
		};

		window.addEventListener('beforeinstallprompt', aoPoderInstalar);
		return () => window.removeEventListener('beforeinstallprompt', aoPoderInstalar);
	});

	async function instalar() {
		if (!promptAdiado) return;
		await promptAdiado.prompt();
		promptAdiado = null;
	}

	function dispensar() {
		dispensado = true;
		localStorage.setItem('eagles:instalar-dispensado', '1');
	}

	const mostrar = $derived(!instalado && !dispensado && (promptAdiado !== null || ehIos));
</script>

{#if mostrar}
	<aside>
		<div class="texto">
			<strong>Deixe o Eagles na tela de início</strong>
			{#if ehIos && !promptAdiado}
				<p>
					Toque em <b>Compartilhar</b> na barra do Safari e escolha
					<b>Adicionar à Tela de Início</b>. No iPhone, os lembretes só chegam depois disso.
				</p>
			{:else}
				<p>Abre mais rápido, sem barra de navegador, e você recebe os lembretes.</p>
			{/if}
		</div>

		<div class="acoes">
			{#if promptAdiado}
				<Botao onclick={instalar}>Instalar</Botao>
			{/if}
			<Botao variante="texto" onclick={dispensar}>Agora não</Botao>
		</div>
	</aside>
{/if}

<style>
	aside {
		display: flex;
		flex-direction: column;
		gap: var(--esp-3);
		padding: var(--esp-4);
		background: var(--cor-marca-suave);
		border: 1px solid var(--cor-marca);
		border-radius: var(--raio-lg);
	}

	.texto {
		display: flex;
		flex-direction: column;
		gap: var(--esp-1);
	}

	strong {
		font-size: var(--texto-base);
		font-weight: 700;
		color: var(--cor-marca);
	}

	p {
		font-size: var(--texto-sm);
		color: var(--cor-texto-2);
		text-wrap: pretty;
	}

	b {
		font-weight: 700;
		color: var(--cor-texto);
	}

	.acoes {
		display: flex;
		gap: var(--esp-2);
		flex-wrap: wrap;
	}
</style>

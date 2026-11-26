<script lang="ts">
	import { onMount } from 'svelte';
	import { aoMudarConexao, estaOnline, sincronizarEspecialidades } from '$lib/cache/sync';

	let online = $state(estaOnline());
	let sincronizando = $state(false);

	onMount(() => {
		const remover = aoMudarConexao((ehOnline) => {
			online = ehOnline;
		});

		const aoVoltarOnline = async () => {
			sincronizando = true;
			try {
				await sincronizarEspecialidades();
			} finally {
				sincronizando = false;
			}
		};

		window.addEventListener('online', aoVoltarOnline);
		return () => {
			remover();
			window.removeEventListener('online', aoVoltarOnline);
		};
	});
</script>

{#if !online}
	<div class="conexao offline" role="status" aria-live="polite">
		<span class="bolinha" aria-hidden="true"></span>
		<span>Você está offline. Dados salvos localmente estão disponíveis.</span>
	</div>
{:else if sincronizando}
	<div class="conexao sincronizando" role="status" aria-live="polite">
		<span class="bolinha" aria-hidden="true"></span>
		<span>Atualizando dados em segundo plano…</span>
	</div>
{/if}

<style>
	.conexao {
		display: flex;
		align-items: center;
		justify-content: center;
		gap: var(--esp-2);
		padding: var(--esp-2) var(--esp-3);
		font-size: var(--texto-sm);
		font-weight: 600;
		text-align: center;
		width: 100%;
	}

	.offline {
		background: var(--cor-aviso-suave);
		color: var(--cor-aviso);
		border-bottom: 1px solid var(--cor-aviso);
	}

	.sincronizando {
		background: var(--cor-marca-suave);
		color: var(--cor-marca);
		border-bottom: 1px solid var(--cor-marca);
	}

	.bolinha {
		width: 8px;
		height: 8px;
		flex: none;
		border-radius: 50%;
		background: currentColor;
		animation: pulsar 2s infinite;
	}

	@keyframes pulsar {
		0%,
		100% {
			opacity: 1;
			transform: scale(1);
		}
		50% {
			opacity: 0.5;
			transform: scale(1.2);
		}
	}
</style>

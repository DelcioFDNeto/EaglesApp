/**
 * Recusas das operações de grupo, com a explicação para a tela.
 *
 * Mesmo formato do `AcessoRecusado` do M03: motivo legível por máquina,
 * mensagem legível por gente. "Não foi possível" sozinho não ajuda quem está
 * tentando organizar os PGs.
 */

export type MotivoDeRecusaDeGrupo =
	| 'nao_encontrado'
	| 'nome_em_uso'
	| 'arquivado'
	| 'tem_membros'
	| 'tem_responsaveis'
	| 'sem_mudanca'
	| 'desatualizado';

export class GrupoRecusado extends Error {
	readonly motivo: MotivoDeRecusaDeGrupo;
	constructor(motivo: MotivoDeRecusaDeGrupo, mensagem: string) {
		super(mensagem);
		this.name = 'GrupoRecusado';
		this.motivo = motivo;
	}
}

export function statusDaRecusaDeGrupo(motivo: MotivoDeRecusaDeGrupo): 400 | 404 | 409 {
	switch (motivo) {
		case 'nao_encontrado':
			return 404;
		case 'nome_em_uso':
		case 'tem_membros':
		case 'tem_responsaveis':
		case 'desatualizado':
			return 409;
		default:
			return 400;
	}
}

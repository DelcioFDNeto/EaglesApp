/**
 * Navegação do app: o que aparece no menu de cada pessoa.
 *
 * A tela só ESCONDE o que o servidor já nega: um item fora do menu continua
 * barrado na API. Aqui as regras são as mesmas que a tela inicial já usava
 * para os atalhos, num lugar só, para o menu lateral (desktop), a barra
 * inferior (celular) e a tela "Mais" não divergirem.
 */

export type NomeIcone =
	| 'inicio'
	| 'eventos'
	| 'grupos'
	| 'escalas'
	| 'frequencia'
	| 'draft'
	| 'comunicacao'
	| 'pessoas'
	| 'financeiro'
	| 'assistente'
	| 'lideranca'
	| 'admin'
	| 'perfil'
	| 'sessoes'
	| 'mais'
	| 'sair';

export type Secao = 'dia_a_dia' | 'cuidar' | 'administrar' | 'conta';

export type ItemNav = {
	href: string;
	rotulo: string;
	/** Rótulo que cabe na barra inferior do celular. */
	rotuloCurto: string;
	icone: NomeIcone;
	secao: Secao;
};

export const TITULO_SECAO: Record<Secao, string | null> = {
	dia_a_dia: null,
	cuidar: 'Cuidar',
	administrar: 'Administrar',
	conta: 'Sua conta'
};

const tem = (permissoes: readonly string[], ...chaves: string[]) =>
	chaves.some((c) => permissoes.includes(c));

export function itensNavegacao(permissoes: readonly string[]): ItemNav[] {
	const itens: Array<ItemNav | false> = [
		{
			href: '/inicio',
			rotulo: 'Início',
			rotuloCurto: 'Início',
			icone: 'inicio',
			secao: 'dia_a_dia'
		},
		tem(permissoes, 'event.view') && {
			href: '/eventos',
			rotulo: 'Eventos',
			rotuloCurto: 'Eventos',
			icone: 'eventos',
			secao: 'dia_a_dia'
		},
		tem(permissoes, 'group.view') && {
			href: '/grupos',
			rotulo: 'Subgrupos',
			rotuloCurto: 'Subgrupos',
			icone: 'grupos',
			secao: 'dia_a_dia'
		},
		tem(permissoes, 'responsibility.view') && {
			href: '/responsabilidades',
			rotulo: 'Escalas',
			rotuloCurto: 'Escalas',
			icone: 'escalas',
			secao: 'dia_a_dia'
		},
		{
			href: '/comunicacao',
			rotulo: 'Avisos',
			rotuloCurto: 'Avisos',
			icone: 'comunicacao',
			secao: 'dia_a_dia'
		},
		tem(permissoes, 'person.view') && {
			href: '/draft',
			rotulo: 'Draft',
			rotuloCurto: 'Draft',
			icone: 'draft',
			secao: 'dia_a_dia'
		},
		tem(permissoes, 'person.create', 'person.invite') && {
			href: '/pessoas',
			rotulo: 'Pessoas',
			rotuloCurto: 'Pessoas',
			icone: 'pessoas',
			secao: 'cuidar'
		},
		tem(permissoes, 'attendance.report') && {
			href: '/frequencia',
			rotulo: 'Frequência',
			rotuloCurto: 'Frequência',
			icone: 'frequencia',
			secao: 'cuidar'
		},
		tem(permissoes, 'finance.view_all', 'finance.view_group', 'finance.view_own') && {
			href: '/financeiro',
			rotulo: 'Financeiro',
			rotuloCurto: 'Financeiro',
			icone: 'financeiro',
			secao: 'cuidar'
		},
		tem(permissoes, 'ai.use_basic', 'ai.use_analytics', 'ai.use_finance') && {
			href: '/assistente',
			rotulo: 'Assistente',
			rotuloCurto: 'Assistente',
			icone: 'assistente',
			secao: 'cuidar'
		},
		tem(permissoes, 'rbac.manage') && {
			href: '/lideranca',
			rotulo: 'Liderança',
			rotuloCurto: 'Liderança',
			icone: 'lideranca',
			secao: 'administrar'
		},
		tem(permissoes, 'settings.manage', 'rbac.manage', 'audit.view') && {
			href: '/admin',
			rotulo: 'Administração',
			rotuloCurto: 'Admin',
			icone: 'admin',
			secao: 'administrar'
		},
		{
			href: '/perfil',
			rotulo: 'Meu perfil',
			rotuloCurto: 'Perfil',
			icone: 'perfil',
			secao: 'conta'
		},
		{
			href: '/conta/sessoes',
			rotulo: 'Aparelhos conectados',
			rotuloCurto: 'Aparelhos',
			icone: 'sessoes',
			secao: 'conta'
		}
	];
	return itens.filter((i): i is ItemNav => i !== false);
}

/** Quantos atalhos cabem na barra inferior antes do "Mais". */
export const ATALHOS_NA_BARRA = 4;

/**
 * Barra inferior do celular: os primeiros itens do dia a dia, e "Mais" com o
 * resto. Quem tem só 4 itens do dia a dia ou menos vê todos eles e o "Mais"
 * (que sempre leva ao perfil e à saída).
 */
export function itensBarraInferior(itens: ItemNav[]): ItemNav[] {
	return itens.filter((i) => i.secao === 'dia_a_dia').slice(0, ATALHOS_NA_BARRA);
}

/** O item está ativo na rota atual? Início só na própria rota; os demais incluem as subpáginas. */
export function estaAtivo(pathname: string, href: string): boolean {
	if (href === '/inicio') return pathname === '/inicio';
	return pathname === href || pathname.startsWith(`${href}/`);
}

/**
 * Rotas que não usam a moldura do app (sem menu): entrada, convite, senha e
 * a raiz, que só redireciona. Todo o resto exige sessão.
 */
const ROTAS_SEM_MOLDURA = [
	'/entrar',
	'/convite',
	'/esqueci-senha',
	'/resetar-senha',
	'/solicitar-cadastro'
];

export function usaMoldura(pathname: string): boolean {
	if (pathname === '/') return false;
	return !ROTAS_SEM_MOLDURA.some((r) => pathname === r || pathname.startsWith(`${r}/`));
}

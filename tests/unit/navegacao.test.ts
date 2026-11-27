import { describe, expect, it } from 'vitest';
import { estaAtivo, itensBarraInferior, itensNavegacao, usaMoldura } from '../../src/lib/navegacao';
import { ROLE_SEEDS } from '../../src/lib/server/policy/roles';

const permissoesDe = (papel: string) => ROLE_SEEDS.find((r) => r.key === papel)!.permissions;
const hrefs = (papel: string) => itensNavegacao(permissoesDe(papel)).map((i) => i.href);

describe('navegação', () => {
	it('visitante vê só o essencial: início, eventos, avisos e a própria conta', () => {
		expect(hrefs('visitante')).toEqual([
			'/inicio',
			'/eventos',
			'/comunicacao',
			'/perfil',
			'/conta/sessoes'
		]);
	});

	it('membro ganha Subgrupos e escalas, mas nada de cuidar de outros nem administrar', () => {
		const itens = itensNavegacao(permissoesDe('membro'));
		const h = itens.map((i) => i.href);
		expect(h).toEqual(expect.arrayContaining(['/grupos', '/responsabilidades', '/financeiro']));
		expect(itens.find((i) => i.href === '/grupos')).toMatchObject({
			rotulo: 'Subgrupos',
			rotuloCurto: 'Subgrupos'
		});
		expect(h).not.toContain('/pessoas');
		expect(h).not.toContain('/admin');
		expect(h).not.toContain('/lideranca');
	});

	it('conselheiro cuida de pessoas; só líder vê liderança e administração', () => {
		expect(hrefs('conselheiro')).toContain('/pessoas');
		expect(hrefs('conselheiro')).toContain('/frequencia');
		expect(hrefs('membro')).not.toContain('/frequencia');
		expect(hrefs('conselheiro')).not.toContain('/lideranca');
		expect(hrefs('lider')).toEqual(expect.arrayContaining(['/lideranca', '/admin', '/pessoas']));
	});

	it('a barra do celular leva no máximo 4 atalhos do dia a dia', () => {
		const lider = itensBarraInferior(itensNavegacao(permissoesDe('lider')));
		expect(lider.map((i) => i.href)).toEqual([
			'/inicio',
			'/eventos',
			'/grupos',
			'/responsabilidades'
		]);
		const visitante = itensBarraInferior(itensNavegacao(permissoesDe('visitante')));
		expect(visitante.map((i) => i.href)).toEqual(['/inicio', '/eventos', '/comunicacao']);
	});

	it('item ativo: início só na própria rota; os outros também nas subpáginas', () => {
		expect(estaAtivo('/inicio', '/inicio')).toBe(true);
		expect(estaAtivo('/eventos/123/editar', '/eventos')).toBe(true);
		expect(estaAtivo('/eventosx', '/eventos')).toBe(false);
		expect(estaAtivo('/eventos', '/inicio')).toBe(false);
	});

	it('entrada, convite e senha ficam sem menu; o resto usa a moldura', () => {
		for (const r of ['/', '/entrar', '/convite/abc', '/esqueci-senha', '/resetar-senha']) {
			expect(usaMoldura(r)).toBe(false);
		}
		for (const r of ['/inicio', '/eventos/1', '/conta/sessoes', '/menu']) {
			expect(usaMoldura(r)).toBe(true);
		}
	});
});

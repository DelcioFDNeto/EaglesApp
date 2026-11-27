import { describe, expect, it } from 'vitest';
import { sugerirDivisaoGrupos } from '../../src/lib/server/ia/motor';
import {
	classificarRsvpParaEscala,
	gerarPropostaDeEscala,
	sugerirSubstitutos
} from '../../src/lib/server/responsabilidades/gerador';
import { chavesQueConfirmam } from '../../src/lib/shared/rsvp';

describe('§6 — Divisão de subgrupos com vínculos familiares, faixa etária e LGPD', () => {
	const ref = new Date('2026-11-27T12:00:00Z');
	const grupos = [
		{ id: 'g1', name: 'PG Azul' },
		{ id: 'g2', name: 'PG Verde' }
	];

	it('mantém casal e irmãos mencionados em siblings/familyTies juntos no mesmo subgrupo', () => {
		const res = sugerirDivisaoGrupos({
			grupos,
			referencia: ref,
			pessoas: [
				{
					id: 'p1',
					nome: 'Ana Paula Costa',
					birthDate: '1997-04-10',
					frequencia: 10,
					grupoAtualId: 'g1',
					relationshipStatus: 'casado',
					familyTies: 'Casada com Bruno Costa'
				},
				{
					id: 'p2',
					nome: 'Bruno Henrique Costa',
					birthDate: '1996-06-20',
					frequencia: 9,
					grupoAtualId: 'g2',
					relationshipStatus: 'casado',
					familyTies: 'Casado com Ana Costa'
				},
				{
					id: 'p3',
					nome: 'Carla Lima',
					birthDate: '2001-01-15',
					frequencia: 8,
					grupoAtualId: 'g1',
					siblings: 'Diego Lima'
				},
				{
					id: 'p4',
					nome: 'Diego Lima',
					birthDate: '2003-08-12',
					frequencia: 7,
					grupoAtualId: 'g2',
					siblings: 'Carla Lima'
				},
				{ id: 'p5', nome: 'Eva Nunes', birthDate: '1999-02-01', frequencia: 6, grupoAtualId: null },
				{
					id: 'p6',
					nome: 'Felipe Dias',
					birthDate: '2000-09-09',
					frequencia: 5,
					grupoAtualId: null
				}
			]
		});

		const gAna = res.alocacoes.find((a) => a.personId === 'p1')!;
		const gBruno = res.alocacoes.find((a) => a.personId === 'p2')!;
		const gCarla = res.alocacoes.find((a) => a.personId === 'p3')!;
		const gDiego = res.alocacoes.find((a) => a.personId === 'p4')!;

		expect(gAna.grupoSugeridoId).toBe(gBruno.grupoSugeridoId);
		expect(gCarla.grupoSugeridoId).toBe(gDiego.grupoSugeridoId);
		expect(gAna.justificativa.toLowerCase()).toContain('vínculo familiar');
		expect(gCarla.justificativa.toLowerCase()).toContain('vínculo familiar');
		expect(res.resumo.toLowerCase()).toContain('vínculos familiares');

		const qtdG1 = res.alocacoes.filter((a) => a.grupoSugeridoId === 'g1').length;
		const qtdG2 = res.alocacoes.filter((a) => a.grupoSugeridoId === 'g2').length;
		expect(qtdG1).toBe(3);
		expect(qtdG2).toBe(3);
	});

	it('agrupa pessoas com a mesma tag normalizada de familyTies (len >= 4) e ignora tags genéricas', () => {
		const res = sugerirDivisaoGrupos({
			grupos,
			referencia: ref,
			pessoas: [
				{
					id: 'p1',
					nome: 'Lucas Ferreira',
					birthDate: '1998-01-01',
					frequencia: 10,
					grupoAtualId: null,
					familyTies: 'Família Ferreira'
				},
				{
					id: 'p2',
					nome: 'Mariana Souza',
					birthDate: '1999-01-01',
					frequencia: 9,
					grupoAtualId: null,
					familyTies: 'familia ferreira'
				},
				{
					id: 'p3',
					nome: 'Rafael Alves',
					birthDate: '1998-01-01',
					frequencia: 10,
					grupoAtualId: null,
					familyTies: 'Nenhum'
				},
				{
					id: 'p4',
					nome: 'Sofia Mendes',
					birthDate: '1998-01-01',
					frequencia: 10,
					grupoAtualId: null,
					familyTies: 'nenhum'
				}
			]
		});

		const gLucas = res.alocacoes.find((a) => a.personId === 'p1')!;
		const gMariana = res.alocacoes.find((a) => a.personId === 'p2')!;
		expect(gLucas.grupoSugeridoId).toBe(gMariana.grupoSugeridoId);
		expect(gLucas.justificativa.toLowerCase()).toContain('vínculo familiar');

		// Rafael e Sofia têm tag genérica "nenhum" e não devem ser tratados como família
		const gRafael = res.alocacoes.find((a) => a.personId === 'p3')!;
		expect(gRafael.justificativa.toLowerCase()).not.toContain('vínculo familiar');
	});

	it('equilibra faixa etária entre os subgrupos quando equilibrarFaixaEtaria está ativo', () => {
		const pessoas = [
			{ id: 'p1', nome: 'A1', birthDate: '1990-01-01', frequencia: 5, grupoAtualId: null }, // 36 anos
			{ id: 'p2', nome: 'A2', birthDate: '1991-01-01', frequencia: 5, grupoAtualId: null }, // 35 anos
			{ id: 'p3', nome: 'A3', birthDate: '2010-01-01', frequencia: 5, grupoAtualId: null }, // 16 anos
			{ id: 'p4', nome: 'A4', birthDate: '2011-01-01', frequencia: 5, grupoAtualId: null } // 15 anos
		];

		const res = sugerirDivisaoGrupos({
			grupos,
			pessoas,
			referencia: ref,
			criterios: {
				agruparVinculosFamiliares: true,
				equilibrarFaixaEtaria: true,
				equilibrarFrequencia: true
			}
		});

		const idadesPorGrupo = new Map<string, number[]>();
		const mapaIdade: Record<string, number> = { p1: 36, p2: 35, p3: 16, p4: 15 };
		for (const al of res.alocacoes) {
			const arr = idadesPorGrupo.get(al.grupoSugeridoId) ?? [];
			arr.push(mapaIdade[al.personId]!);
			idadesPorGrupo.set(al.grupoSugeridoId, arr);
		}

		const mediaG1 =
			idadesPorGrupo.get('g1')!.reduce((a, b) => a + b, 0) / idadesPorGrupo.get('g1')!.length;
		const mediaG2 =
			idadesPorGrupo.get('g2')!.reduce((a, b) => a + b, 0) / idadesPorGrupo.get('g2')!.length;

		// Em vez de separar [36, 35] vs [16, 15] (diff 20), equilibra para ~25.5 em cada grupo
		expect(Math.abs(mediaG1 - mediaG2)).toBeLessThanOrEqual(1);
		expect(res.resumo.toLowerCase()).toContain('faixa etária');
	});

	it('permite desligar agrupamento familiar via criterios.agruparVinculosFamiliares = false', () => {
		const res = sugerirDivisaoGrupos({
			grupos,
			referencia: ref,
			criterios: {
				agruparVinculosFamiliares: false,
				equilibrarFaixaEtaria: false,
				equilibrarFrequencia: true
			},
			pessoas: [
				{
					id: 'p1',
					nome: 'Ana Silva',
					birthDate: '1998-01-01',
					frequencia: 10,
					grupoAtualId: null,
					familyTies: 'Família Silva'
				},
				{
					id: 'p2',
					nome: 'Bruno Silva',
					birthDate: '1998-01-01',
					frequencia: 9,
					grupoAtualId: null,
					familyTies: 'Família Silva'
				},
				{ id: 'p3', nome: 'Carla', birthDate: '1998-01-01', frequencia: 2, grupoAtualId: null },
				{ id: 'p4', nome: 'Davi', birthDate: '1998-01-01', frequencia: 1, grupoAtualId: null }
			]
		});

		const gAna = res.alocacoes.find((a) => a.personId === 'p1')!;
		const gBruno = res.alocacoes.find((a) => a.personId === 'p2')!;
		// Sem agrupamento familiar, os 2 mais frequentes vão para grupos opostos
		expect(gAna.grupoSugeridoId).not.toBe(gBruno.grupoSugeridoId);
		expect(gAna.justificativa.toLowerCase()).not.toContain('vínculo familiar');
	});

	it('pseudonimiza menores de idade mesmo quando pertencem a um cluster familiar (ADR 0003)', () => {
		const res = sugerirDivisaoGrupos({
			grupos,
			referencia: ref,
			pessoas: [
				{
					id: 'p-adulto',
					nome: 'João Pereira',
					birthDate: '1998-05-01',
					frequencia: 8,
					grupoAtualId: 'g1',
					siblings: 'Pedro Pereira Secreto'
				},
				{
					id: 'p-menor',
					nome: 'Pedro Pereira Secreto',
					birthDate: '2012-03-15', // 14 anos
					frequencia: 7,
					grupoAtualId: 'g2',
					siblings: 'João Pereira'
				},
				{ id: 'p3', nome: 'Clara', birthDate: '1999-01-01', frequencia: 6, grupoAtualId: null },
				{ id: 'p4', nome: 'Vitor', birthDate: '2000-01-01', frequencia: 5, grupoAtualId: null }
			]
		});

		const alocAdulto = res.alocacoes.find((a) => a.personId === 'p-adulto')!;
		const alocMenor = res.alocacoes.find((a) => a.personId === 'p-menor')!;

		// Irmãos ficam juntos, mas o nome do menor nunca vaza
		expect(alocAdulto.grupoSugeridoId).toBe(alocMenor.grupoSugeridoId);
		expect(alocMenor.menor).toBe(true);
		expect(alocMenor.rotulo).toMatch(/^Participante P\d+$/);
		expect(alocMenor.rotulo).not.toContain('Pedro');
		expect(alocMenor.rotulo).not.toContain('Secreto');
		expect(alocMenor.justificativa).not.toContain('Pedro');
		expect(alocAdulto.justificativa).not.toContain('Pedro');
		expect(res.resumo).not.toContain('Pedro');
	});
});

describe('§7 — Escala com RSVP, frequência 90d e sugestão de substitutos', () => {
	const dataEvento = new Date('2026-11-27T20:00:00Z');
	const respMensagem = { id: 'r1', nome: 'Mensagem', intervaloMinimoDias: 14, ordem: 1 };
	const respMusica = { id: 'r2', nome: 'Música', intervaloMinimoDias: 14, ordem: 2 };

	it('exclui candidatos com rsvp = nao_vou enquanto houver outro disponível', () => {
		const itens = gerarPropostaDeEscala({
			dataEvento,
			responsabilidades: [respMensagem],
			candidatos: [
				{ personId: 'p1', nome: 'Ana', rsvp: 'nao_vou', frequencia90d: 12 },
				{ personId: 'p2', nome: 'Bruno', rsvp: 'talvez', frequencia90d: 1 }
			],
			historico: []
		});

		expect(itens).toHaveLength(1);
		expect(itens[0]?.personId).toBe('p2');
	});

	it('usa fallback explícito quando TODOS marcaram nao_vou e sinaliza na justificativa', () => {
		const itens = gerarPropostaDeEscala({
			dataEvento,
			responsabilidades: [respMensagem],
			candidatos: [
				{ personId: 'p1', nome: 'Ana', rsvp: 'nao_vou', frequencia90d: 3 },
				{ personId: 'p2', nome: 'Bruno', rsvp: 'nao_vou', frequencia90d: 8 }
			],
			historico: []
		});

		expect(itens).toHaveLength(1);
		expect(itens[0]?.personId).toBe('p2');
		expect(itens[0]?.justificativa.toLowerCase()).toContain('ausência');
	});

	it('prioriza RSVP na ordem confirmado > null > talvez', () => {
		const itens = gerarPropostaDeEscala({
			dataEvento,
			responsabilidades: [respMensagem, respMusica],
			candidatos: [
				{ personId: 'p-talvez', nome: 'Alice', rsvp: 'talvez', frequencia90d: 10 },
				{ personId: 'p-sem', nome: 'Breno', rsvp: null, frequencia90d: 10 },
				{ personId: 'p-conf', nome: 'Zeca', rsvp: 'confirmado', frequencia90d: 1 }
			],
			historico: []
		});

		expect(itens).toHaveLength(2);
		expect(itens[0]?.personId).toBe('p-conf');
		expect(itens[0]?.justificativa.toLowerCase()).toContain('presença confirmada');
		expect(itens[1]?.personId).toBe('p-sem');
	});

	it('desempata carga igual priorizando maior frequencia90d', () => {
		const itens = gerarPropostaDeEscala({
			dataEvento,
			responsabilidades: [respMensagem],
			candidatos: [
				{ personId: 'p1', nome: 'Ana', rsvp: 'confirmado', frequencia90d: 2 },
				{ personId: 'p2', nome: 'Zuleica', rsvp: 'confirmado', frequencia90d: 9 },
				{ personId: 'p3', nome: 'Bruno', rsvp: 'confirmado', frequencia90d: 5 }
			],
			historico: []
		});

		expect(itens).toHaveLength(1);
		expect(itens[0]?.personId).toBe('p2');
		expect(itens[0]?.justificativa).toContain('9 presenças');
	});

	it('sugerirSubstitutos retorna top 3 ranqueados excluindo pessoaAtualId e nao_vou', () => {
		const subs = sugerirSubstitutos({
			dataEvento,
			responsabilidade: respMensagem,
			pessoaAtualId: 'p-atual',
			jaEscaladosNoEvento: new Set(['p-ocupado']),
			candidatos: [
				{ personId: 'p-atual', nome: 'Atual', rsvp: 'confirmado', frequencia90d: 10 },
				{ personId: 'p-ausente', nome: 'Ausente', rsvp: 'nao_vou', frequencia90d: 10 },
				{ personId: 'p-ocupado', nome: 'Ocupado', rsvp: 'confirmado', frequencia90d: 10 },
				{ personId: 'p-recente', nome: 'Recente', rsvp: 'confirmado', frequencia90d: 10 },
				{ personId: 'p-conf-baixo', nome: 'Conf Baixo', rsvp: 'confirmado', frequencia90d: 2 },
				{ personId: 'p-conf-alto', nome: 'Conf Alto', rsvp: 'confirmado', frequencia90d: 7 },
				{ personId: 'p-sem-rsvp', nome: 'Sem RSVP', rsvp: null, frequencia90d: 5 }
			],
			historico: [
				{
					personId: 'p-recente',
					responsabilidadeId: 'r1',
					eventoInicio: new Date('2026-11-22T20:00:00Z') // 5 dias atrás (< 14)
				}
			]
		});

		expect(subs).toHaveLength(3);
		expect(subs.map((s) => s.personId)).toEqual(['p-conf-alto', 'p-conf-baixo', 'p-sem-rsvp']);
		expect(subs.some((s) => s.personId === 'p-atual' || s.personId === 'p-ausente')).toBe(false);
		expect(subs[0]).toMatchObject({
			personId: 'p-conf-alto',
			nome: 'Conf Alto',
			respeitaIntervalo: true,
			rsvp: 'confirmado',
			carga90Dias: 0,
			frequencia90d: 7
		});
		expect(subs[0]!.justificativa.toLowerCase()).toContain('presença confirmada');
	});

	it('classifica opções de RSVP padrão e customizadas usando chavesQueConfirmam', () => {
		const chaves = chavesQueConfirmam([
			{ key: 'confirmado', label: 'Confirmado' },
			{ key: 'vou_de_carona', label: 'Vou de carona', confirma: true },
			{ key: 'talvez', label: 'Talvez' },
			{ key: 'viagem', label: 'Viajando', confirma: false },
			{ key: 'nao_vou', label: 'Não vou' }
		]);

		expect(classificarRsvpParaEscala('confirmado', chaves)).toBe('confirmado');
		expect(classificarRsvpParaEscala('vou_de_carona', chaves)).toBe('confirmado');
		expect(classificarRsvpParaEscala('talvez', chaves)).toBe('talvez');
		expect(classificarRsvpParaEscala('viagem', chaves)).toBe('nao_vou');
		expect(classificarRsvpParaEscala('nao_vou', chaves)).toBe('nao_vou');
		expect(classificarRsvpParaEscala(null, chaves)).toBeNull();
	});
});

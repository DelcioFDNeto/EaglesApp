import { describe, expect, it } from 'vitest';
import {
	autocadastroSchema,
	criarPessoaSchema,
	ehMenorDeIdade,
	idadeEm
} from '../../src/lib/server/modules/pessoas/validacao';
import { formatarTelefone, normalizarTexto, somenteDigitos } from '../../src/lib/shared/pessoa';

describe('cadastro progressivo (RN-05)', () => {
	it('aceita uma pessoa só com o nome', () => {
		const r = criarPessoaSchema.safeParse({ fullName: 'Ana Clara Souza' });
		expect(r.success).toBe(true);
	});

	it('recusa nome vazio', () => {
		expect(criarPessoaSchema.safeParse({ fullName: '   ' }).success).toBe(false);
	});

	it('campo em branco vira null, nunca string vazia', () => {
		// `''` no banco é um valor que finge estar preenchido e quebra toda
		// consulta por "quem ainda não tem telefone".
		const r = criarPessoaSchema.parse({ fullName: 'João Silva', phone: '', email: '   ' });
		expect(r.phone).toBeNull();
		expect(r.email).toBeNull();
	});

	it('colapsa espaços internos do nome', () => {
		// Precisa casar com a coluna gerada no banco, que não colapsa espaços.
		const r = criarPessoaSchema.parse({ fullName: '  Ana   Clara  Souza ' });
		expect(r.fullName).toBe('Ana Clara Souza');
	});

	it('recusa e-mail malformado, mas aceita ausência', () => {
		expect(criarPessoaSchema.safeParse({ fullName: 'Ana', email: 'nao-e-email' }).success).toBe(
			false
		);
		expect(criarPessoaSchema.safeParse({ fullName: 'Ana' }).success).toBe(true);
	});

	it('recusa telefone curto demais para ser telefone', () => {
		expect(criarPessoaSchema.safeParse({ fullName: 'Ana', phone: '123' }).success).toBe(false);
	});

	it('aceita telefone com máscara — quem digita não formata para o banco', () => {
		expect(criarPessoaSchema.safeParse({ fullName: 'Ana', phone: '(11) 98765-4321' }).success).toBe(
			true
		);
	});

	it('recusa data de nascimento no futuro', () => {
		const ano = new Date().getFullYear() + 1;
		expect(
			criarPessoaSchema.safeParse({ fullName: 'Ana', birthDate: `${ano}-01-01` }).success
		).toBe(false);
	});

	it('recusa situação de relacionamento fora da lista', () => {
		expect(
			criarPessoaSchema.safeParse({ fullName: 'Ana', relationshipStatus: 'complicado' }).success
		).toBe(false);
	});
});

describe('autocadastro', () => {
	it('exige apenas o nome', () => {
		expect(autocadastroSchema.safeParse({ fullName: 'Thiago Barbosa' }).success).toBe(true);
	});

	it('aceita os campos do responsável', () => {
		const r = autocadastroSchema.parse({
			fullName: 'Pedro Alves',
			birthDate: '2010-05-01',
			nomeDoResponsavel: 'Marta Alves',
			telefoneDoResponsavel: '11987654321'
		});
		expect(r.nomeDoResponsavel).toBe('Marta Alves');
	});
});

describe('idade', () => {
	it('conta anos completos, não a diferença de ano', () => {
		// Aniversário ainda não chegou na data de referência.
		expect(idadeEm('2000-12-31', new Date('2020-06-15T00:00:00Z'))).toBe(19);
		expect(idadeEm('2000-01-01', new Date('2020-06-15T00:00:00Z'))).toBe(20);
	});

	it('no dia do aniversário a idade já virou', () => {
		expect(idadeEm('2000-06-15', new Date('2020-06-15T00:00:00Z'))).toBe(20);
	});

	it('sem data de nascimento devolve null — e null NÃO é "maior de idade"', () => {
		expect(ehMenorDeIdade(null)).toBeNull();
	});
});

describe('normalização', () => {
	it('remove acento e caixa, e colapsa espaços', () => {
		expect(normalizarTexto('  Ana  Clara  SOUZA ')).toBe('ana clara souza');
		expect(normalizarTexto('João Gonçalves')).toBe('joao goncalves');
		expect(normalizarTexto('Ângela Muñoz')).toBe('angela munoz');
	});

	it('produz o mesmo resultado do translate() da migração 0002', () => {
		// Se divergirem, a busca não encontra o que está gravado.
		const acentuadas = 'áàâãäéèêëíìîïóòôõöúùûüçñ';
		const esperado = 'aaaaaeeeeiiiiooooouuuucn';
		expect(normalizarTexto(acentuadas)).toBe(esperado);
	});

	it('extrai só os dígitos do telefone', () => {
		expect(somenteDigitos('(11) 98765-4321')).toBe('11987654321');
	});

	it('formata celular e fixo, e devolve o original quando não reconhece', () => {
		expect(formatarTelefone('11987654321')).toBe('(11) 98765-4321');
		expect(formatarTelefone('1133334444')).toBe('(11) 3333-4444');
		expect(formatarTelefone('+44 20 7946 0958')).toBe('+44 20 7946 0958');
		expect(formatarTelefone(null)).toBe('');
	});
});

"""Testes do importador de prioridades do PCP (scripts/importar_prioridades_pcp.py).

Entrada: tabela TSV colada do e-mail do PCP (stdin ou --input).
Regras:
  * 'Ordem' é o numero_op; 'Prioridade' é traduzida para o nome do sistema;
  * cada setor mencionado no e-mail é zerado (prioridade e peso = NULL);
  * só as OPs existentes no banco recebem a nova prioridade/peso;
  * OPs do e-mail ausentes no banco entram no relatório.
"""

import io
import json
import os
import sys

import pytest

import importar_prioridades_pcp as pcp


# ---------------------------------------------------------------------------
# Cliente Supabase falso (mesmo encadeamento do supabase-py)
# ---------------------------------------------------------------------------

class ClienteFalso:
    """Imita table().select()/update().in_()/eq().execute() e registra escritas."""

    def __init__(self, registros=None):
        self.registros = list(registros or [])
        self.tabela = None
        self.operacao = None
        self.payload = None
        self.filtros = []
        self.escritas = []
        self.consultas = []

    def table(self, nome):
        self.tabela = nome
        self.operacao = None
        self.payload = None
        self.filtros = []
        return self

    def select(self, campos):
        self.operacao = 'select'
        self.campos = campos
        return self

    def update(self, dados):
        self.operacao = 'update'
        self.payload = dict(dados)
        return self

    def in_(self, coluna, valores):
        self.filtros.append((coluna, list(valores)))
        return self

    def eq(self, coluna, valor):
        self.filtros.append((coluna, valor))
        return self

    def execute(self):
        if self.operacao == 'select':
            numeros = None
            for coluna, valores in self.filtros:
                if coluna == 'numero_op':
                    numeros = set(valores)
            dados = [r for r in self.registros if numeros is None or r['numero_op'] in numeros]
            self.consultas.append((self.tabela, self.filtros))
            return type('Resposta', (), {'data': dados})()

        self.escritas.append((self.tabela, self.payload, list(self.filtros)))
        return type('Resposta', (), {'data': []})()


def banco(*pares):
    """Registros mínimos: (numero_op, setor)."""
    return [
        {'id': indice, 'numero_op': numero, 'setor': setor,
         'prioridade': 'MRP', 'peso_prioridade': 8}
        for indice, (numero, setor) in enumerate(pares, start=1)
    ]


TSV_SETOR_OP_PRIORIDADE = '\n'.join([
    'Setor\tOrdem\tPrioridade',
    'Montagem\t104528\t02 - Exportação',
    'Montagem\t104529\t04 - KS',
    'Subconjunto\t104530\t06 - Pendência Comercial',
])


# ---------------------------------------------------------------------------
# Tradução das prioridades
# ---------------------------------------------------------------------------

@pytest.mark.parametrize('entrada,esperado', [
    ('02 - Exportação', ('Exportacao', 2)),
    ('02-Exportacao', ('Exportacao', 2)),
    ('02 Exportação', ('Exportacao', 2)),
    ('Exportacao', ('Exportacao', 2)),
    ('03 - MWM', ('MWM', 3)),
    ('04 - KS', ('KS', 4)),
    ('05 - Marelli', ('Marelli', 5)),
    ('06 - Pendência Comercial', ('Pendencia Comercial', 6)),
    ('Pendencia Comercial', ('Pendencia Comercial', 6)),
    ('06 - Pend. Comercial', ('Pendencia Comercial', 6)),
    ('06 - PEND. COMERCIAL', ('Pendencia Comercial', 6)),
    ('06 - Pend.Comercial', ('Pendencia Comercial', 6)),
    ('06 - PEND. COMERC.', ('Pendencia Comercial', 6)),
    ('06 - Pend Comerc', ('Pendencia Comercial', 6)),
    ('07 - LINHA PESADA', ('Linha Pesada', 7)),
    ('08 - MRP', ('MRP', 8)),
    ('09 - Tryout', ('Tryout', 9)),
])
def test_mapeia_prioridade_do_email_para_o_nome_do_sistema(entrada, esperado):
    assert pcp.mapear_prioridade(entrada) == esperado


@pytest.mark.parametrize('entrada', ['', '   ', '-', 'Sem prioridade', 'Nenhuma'])
def test_prioridade_limpa_mapeia_para_nulo(entrada):
    assert pcp.mapear_prioridade(entrada) == (None, None)


@pytest.mark.parametrize('entrada', [None, 'Urgente!!', '02 - Inexistente'])
def test_prioridade_desconhecida_e_sinalizada(entrada):
    assert pcp.mapear_prioridade(entrada) is None


# ---------------------------------------------------------------------------
# Parsing da tabela TSV
# ---------------------------------------------------------------------------

def test_parse_tsv_com_coluna_de_setor():
    setores, linhas, avisos = pcp.parse_tsv(TSV_SETOR_OP_PRIORIDADE)

    assert setores == ['Montagem', 'Subconjunto']
    assert [linha['numero_op'] for linha in linhas] == ['104528', '104529', '104530']
    assert linhas[0] == {
        'numero_op': '104528',
        'setor': 'Montagem',
        'prioridade': 'Exportacao',
        'peso_prioridade': 2,
        'linha': 2,
        'origem': 'coluna',
    }
    assert avisos == []


def test_parse_tsv_com_blocos_de_setor_sem_coluna():
    texto = '\n'.join([
        'Prezados, seguem as prioridades da semana.',
        '',
        'MONTAGEM',
        'Ordem\tPrioridade',
        '104528\t02 - Exportação',
        '',
        'CÉLULA',
        'Ordem\tPrioridade',
        '104541\t09 - Tryout',
    ])

    setores, linhas, avisos = pcp.parse_tsv(texto)

    assert setores == ['Montagem', 'Celula']
    assert [(l['numero_op'], l['setor']) for l in linhas] == [
        ('104528', 'Montagem'),
        ('104541', 'Celula'),
    ]
    assert avisos == []


def test_parse_tsv_ignora_linhas_sem_tab_e_cabecalhos_repetidos():
    texto = '\n'.join([
        'Bom dia,',
        'Segue a lista:',
        'Setor\tOrdem\tPrioridade',
        'Montagem\t104528\t02 - Exportação',
        'Setor\tOrdem\tPrioridade',
        'Montagem\t104529\t04 - KS',
        'Atenciosamente,',
        'PCP',
    ])

    _, linhas, avisos = pcp.parse_tsv(texto)

    assert [l['numero_op'] for l in linhas] == ['104528', '104529']
    assert avisos == []


def test_parse_tsv_reporta_prioridade_invalida_sem_derrubar_o_resto():
    texto = '\n'.join([
        'Setor\tOrdem\tPrioridade',
        'Montagem\t104528\t02 - Exportação',
        'Montagem\t104529\tUrgente!!',
    ])

    _, linhas, avisos = pcp.parse_tsv(texto)

    assert [l['numero_op'] for l in linhas] == ['104528']
    assert len(avisos) == 1
    assert '104529' in avisos[0]


def test_parse_tsv_reporta_ordem_vazia_ou_invalida():
    texto = '\n'.join([
        'Setor\tOrdem\tPrioridade',
        'Montagem\t\t02 - Exportação',
        'Montagem\tABC\t04 - KS',
    ])

    _, linhas, avisos = pcp.parse_tsv(texto)

    assert linhas == []
    assert len(avisos) == 2
    assert 'ABC' in avisos[1]


def test_parse_tsv_ignora_texto_sem_dados_validos_em_vez_de_falhar():
    setores, linhas, avisos = pcp.parse_tsv('texto qualquer sem tabela\noutra linha do e-mail')

    assert setores == []
    assert linhas == []
    assert avisos == []


def test_parse_op_com_pontos_de_milhar():
    setores, linhas, avisos = pcp.parse_tsv('1.132.972 02 - Exportação 300')

    assert [l['numero_op'] for l in linhas] == ['1132972']
    assert linhas[0]['prioridade'] == 'Exportacao'
    assert avisos == []


def test_parse_op_com_espacos_no_numero():
    setores, linhas, avisos = pcp.parse_tsv('1 132 972 02 - Exportação 300')

    assert [l['numero_op'] for l in linhas] == ['1132972']
    assert avisos == []


def test_parse_op_e_prioridade_em_linhas_separadas():
    texto = '1132972\n02 - Exportação'
    setores, linhas, avisos = pcp.parse_tsv(texto)

    assert [(l['numero_op'], l['prioridade']) for l in linhas] == [('1132972', 'Exportacao')]
    assert avisos == []


def test_parse_prioridade_quebrada_entre_linhas():
    texto = '1132972 02 -\nExportação'
    setores, linhas, avisos = pcp.parse_tsv(texto)

    assert [(l['numero_op'], l['prioridade']) for l in linhas] == [('1132972', 'Exportacao')]
    assert avisos == []


def test_parse_prioridade_colada_sem_espaco():
    setores, linhas, avisos = pcp.parse_tsv('1132972 06-PEND.COMERCIAL 370')

    assert linhas[0]['prioridade'] == 'Pendencia Comercial'
    assert linhas[0]['peso_prioridade'] == 6
    assert avisos == []


def test_parse_nao_pareia_prosa_com_linha_de_op():
    texto = 'Segue lista de Exportação\n1132972'
    setores, linhas, avisos = pcp.parse_tsv(texto)

    assert linhas == []
    assert avisos == []


def test_parse_tsv_aceita_ordem_com_pontos_na_coluna():
    texto = 'Setor\tOrdem\tPrioridade\nMontagem\t1.132.972\t02 - Exportação'

    setores, linhas, avisos = pcp.parse_tsv(texto)

    assert [l['numero_op'] for l in linhas] == ['1132972']
    assert avisos == []


def test_prioridade_sticky_vale_para_ops_dispersas_abaixo():
    texto = '\n'.join([
        '02 - Exportação',
        '1132972',
        'linha de ruido',
        '1132975',
        '',
        'outra linha',
        '1132980',
    ])

    setores, linhas, avisos = pcp.parse_tsv(texto)

    assert [l['numero_op'] for l in linhas] == ['1132972', '1132975', '1132980']
    assert [l['prioridade'] for l in linhas] == ['Exportacao'] * 3
    assert avisos == []


def test_prioridade_sticky_atravessa_grande_espaco_vertical():
    ruido = '\n'.join('ruido %d' % i for i in range(20))
    texto = '\n'.join(['02 - Exportação', '1132972', ruido, '1132975'])

    setores, linhas, avisos = pcp.parse_tsv(texto)

    assert [l['numero_op'] for l in linhas] == ['1132972', '1132975']
    assert all(l['prioridade'] == 'Exportacao' for l in linhas)


def test_prioridade_sticky_e_substituida_por_uma_nova_prioridade():
    texto = '\n'.join([
        '02 - Exportação',
        '1132972',
        '06 - Pend. Comercial',
        '1132975',
    ])

    setores, linhas, avisos = pcp.parse_tsv(texto)

    assert [(l['numero_op'], l['prioridade']) for l in linhas] == [
        ('1132972', 'Exportacao'),
        ('1132975', 'Pendencia Comercial'),
    ]


def test_par_na_mesma_linha_nao_altera_prioridade_sticky():
    texto = '\n'.join([
        '02 - Exportação',
        '1132972',
        '1132975 06 - Pend. Comercial',
        '1132980',
    ])

    setores, linhas, avisos = pcp.parse_tsv(texto)

    assert [(l['numero_op'], l['prioridade']) for l in linhas] == [
        ('1132972', 'Exportacao'),
        ('1132975', 'Pendencia Comercial'),
        ('1132980', 'Exportacao'),
    ]


def test_op_de_sete_digitos_tem_preferencia_sobre_o_lote_de_seis():
    setores, linhas, avisos = pcp.parse_tsv('02 - Exportação 311646 1132972')

    assert [l['numero_op'] for l in linhas] == ['1132972']


def test_op_ignora_material_de_oito_digitos():
    setores, linhas, avisos = pcp.parse_tsv('02 - Exportação 90000040 104528')

    assert [l['numero_op'] for l in linhas] == ['104528']


def test_parse_tsv_sem_cabecalho_usa_regex_nas_linhas_coladas():
    texto = '1132972\t02 - Exportação\t300\n1132980\t07 - LINHA PESADA\t90'

    setores, linhas, avisos = pcp.parse_tsv(texto)

    assert [l['numero_op'] for l in linhas] == ['1132972', '1132980']
    assert [l['prioridade'] for l in linhas] == ['Exportacao', 'Linha Pesada']
    assert avisos == []


def test_parse_linha_colada_com_op_e_prioridade():
    texto = '\n'.join([
        'Bom dia, prioridades abaixo:',
        '1132972 02 - Exportação 300 300',
        '1132912 06 - Pend. Comercial 370',
    ])

    setores, linhas, avisos = pcp.parse_tsv(texto)

    assert setores == []
    assert [(l['numero_op'], l['prioridade'], l['peso_prioridade']) for l in linhas] == [
        ('1132972', 'Exportacao', 2),
        ('1132912', 'Pendencia Comercial', 6),
    ]
    assert avisos == []


def test_parse_linha_colada_aceita_op_de_seis_digitos():
    setores, linhas, avisos = pcp.parse_tsv('104528 - 04 - KS - Montagem')

    assert [l['numero_op'] for l in linhas] == ['104528']
    assert linhas[0]['prioridade'] == 'KS'
    assert avisos == []


def test_parse_linha_colada_ignora_texto_sem_op_ou_sem_prioridade():
    texto = '\n'.join([
        'Segue a lista de prioridades de Exportação.',
        '1132972 300 300',
        'números soltos 123456 654321',
    ])

    setores, linhas, avisos = pcp.parse_tsv(texto)

    assert linhas == []
    assert avisos == []


def test_parse_email_bcm_com_mistura_de_setores():
    """E-mail de BCM: uma lista única, sem coluna Setor, com OPs de BCM e Importada."""
    texto = '\n'.join([
        'BOM DIA,',
        'PRIORIDADES BCM / IMPORTADA',
        '1132972 02 - Exportação 300',
        '1132975 04 - KS 150',
        '1132980 07 - LINHA PESADA 90',
    ])

    setores, linhas, avisos = pcp.parse_tsv(texto)

    assert setores == []
    assert [l['numero_op'] for l in linhas] == ['1132972', '1132975', '1132980']
    assert avisos == []


def test_bcm_nao_e_criado_como_prioridade():
    assert 'BCM' not in pcp.PRIORIDADES
    assert 'IMPORTADA' not in pcp.PRIORIDADES
    assert all(nome != 'BCM' for nome, _ in pcp.PRIORIDADES.values())


def test_parse_tsv_sem_setor_nao_avisa_e_mantem_linhas():
    """E-mail real do PCP não traz setor: o banco resolve depois."""
    texto = '\n'.join([
        'Prioridade\tAntigo\tMaterial\tOrdem\tLote\tD/A\tPaga no dia\tD/P\tQtde da Ordem\tFalta Montar',
        '02 - Exportação\t10.104\t90000040\t1132972\t311646\t0\t-\t\t300\t300',
        '06 - Pend. Comercial\t10.269\t90002159\t1132912\t311522\t1\t-\t\t370\t370',
    ])

    setores, linhas, avisos = pcp.parse_tsv(texto)

    assert setores == []
    assert [l['numero_op'] for l in linhas] == ['1132972', '1132912']
    assert linhas[0]['setor'] is None
    assert linhas[1]['prioridade'] == 'Pendencia Comercial'
    assert linhas[1]['peso_prioridade'] == 6
    assert avisos == []


def test_parse_tsv_arquivo_pcp_exemplo_sem_avisos():
    caminho = pcp.RAIZ / 'scripts' / 'pcp_exemplo.tsv'
    if not caminho.exists():
        pytest.skip('pcp_exemplo.tsv não encontrado')

    setores, linhas, avisos = pcp.parse_tsv(caminho.read_text(encoding='utf-8'))

    assert avisos == []
    assert len(linhas) == 4
    assert setores == []
    assert all(linha['setor'] is None for linha in linhas)
    assert [linha['prioridade'] for linha in linhas] == [
        'Exportacao', 'Exportacao', 'Pendencia Comercial', 'Linha Pesada',
    ]


def test_parse_tsv_ignora_setor_desconhecido_mas_avisa():
    texto = '\n'.join([
        'Setor\tOrdem\tPrioridade',
        'Pintura\t104528\t02 - Exportação',
    ])

    setores, linhas, avisos = pcp.parse_tsv(texto)

    assert setores == []
    assert linhas == []
    assert any('Pintura' in aviso for aviso in avisos)


def test_parse_tsv_ultima_prioridade_vence_quando_a_op_repete():
    texto = '\n'.join([
        'Setor\tOrdem\tPrioridade',
        'Montagem\t104528\t02 - Exportação',
        'Montagem\t104528\t04 - KS',
    ])

    _, linhas, _ = pcp.parse_tsv(texto)

    assert len(linhas) == 1
    assert linhas[0]['prioridade'] == 'KS'
    assert linhas[0]['peso_prioridade'] == 4


# ---------------------------------------------------------------------------
# Aplicação no banco (dry-run x --apply)
# ---------------------------------------------------------------------------

def test_dry_run_nao_escreve_no_banco():
    cliente = ClienteFalso(banco(('104528', 'Montagem')))
    setores, linhas, _ = pcp.parse_tsv(TSV_SETOR_OP_PRIORIDADE)

    resultado = pcp.aplicar(cliente, setores, linhas, aplicar=False)

    assert cliente.escritas == []
    assert resultado['aplicado'] is False
    assert [o['numero_op'] for o in resultado['atualizadas']] == ['104528']
    assert [o['numero_op'] for o in resultado['ausentes']] == ['104529', '104530']


def test_apply_zera_prioridade_e_peso_de_cada_setor_mencionado():
    cliente = ClienteFalso(banco(('104528', 'Montagem')))
    setores, linhas, _ = pcp.parse_tsv(TSV_SETOR_OP_PRIORIDADE)

    pcp.aplicar(cliente, setores, linhas, aplicar=True)

    limpezas = [e for e in cliente.escritas if e[1] == {'prioridade': None, 'peso_prioridade': None}]
    assert len(limpezas) == 2
    setores_limpos = [dict(e[2])['setor'][0] for e in limpezas]
    assert setores_limpos == ['Montagem', 'Subconjunto']


def test_apply_atualiza_apenas_as_ops_existentes_no_banco():
    cliente = ClienteFalso(banco(('104528', 'Montagem'), ('104530', 'Subconjunto')))
    setores, linhas, _ = pcp.parse_tsv(TSV_SETOR_OP_PRIORIDADE)

    resultado = pcp.aplicar(cliente, setores, linhas, aplicar=True)

    atualizacoes = {
        dict(e[2])['numero_op']: e[1]
        for e in cliente.escritas
        if dict(e[2]).get('numero_op') is not None and 'prioridade' in e[1]
    }
    assert set(atualizacoes) == {'104528', '104530'}
    assert atualizacoes['104528'] == {'prioridade': 'Exportacao', 'peso_prioridade': 2}
    assert atualizacoes['104530'] == {'prioridade': 'Pendencia Comercial', 'peso_prioridade': 6}

    assert [o['numero_op'] for o in resultado['atualizadas']] == ['104528', '104530']
    assert [o['numero_op'] for o in resultado['ausentes']] == ['104529']


def test_apply_nao_limpa_setores_fora_do_email():
    cliente = ClienteFalso(banco(('104528', 'Montagem'), ('104999', 'Usinagem')))
    setores, linhas, _ = pcp.parse_tsv(TSV_SETOR_OP_PRIORIDADE)

    pcp.aplicar(cliente, setores, linhas, aplicar=True)

    setores_limpos = [dict(e[2])['setor'] for e in cliente.escritas
                      if e[1] == {'prioridade': None, 'peso_prioridade': None}]
    assert 'Usinagem' not in setores_limpos


def test_apply_infere_o_setor_pelo_banco_quando_o_email_nao_traz():
    texto = '\n'.join([
        'Prioridade\tOrdem',
        '02 - Exportação\t1132972',
        '09 - Tryout\t1132912',
    ])
    cliente = ClienteFalso(banco(('1132972', 'Montagem'), ('1132912', 'Celula')))
    setores, linhas, avisos = pcp.parse_tsv(texto)
    assert setores == []
    assert avisos == []

    resultado = pcp.aplicar(cliente, setores, linhas, aplicar=True)

    assert resultado['setores'] == ['Montagem', 'Celula']
    setores_limpos = [dict(e[2])['setor'][0] for e in cliente.escritas
                      if e[1] == {'prioridade': None, 'peso_prioridade': None}]
    assert setores_limpos == ['Montagem', 'Celula']
    assert [o['setor_banco'] for o in resultado['atualizadas']] == ['Montagem', 'Celula']
    assert resultado['ausentes'] == []


def test_apply_email_bcm_limpa_bcm_e_importada_antes_de_atualizar():
    texto = '\n'.join([
        'BOM DIA,',
        'PRIORIDADES BCM / IMPORTADA',
        '1132972 02 - Exportação 300',
        '1132975 04 - KS 150',
        '1132980 07 - LINHA PESADA 90',
    ])
    cliente = ClienteFalso(banco(
        ('1132972', 'BCM'),
        ('1132975', 'Importada'),
        ('1132980', 'BCM'),
    ))
    setores, linhas, avisos = pcp.parse_tsv(texto)
    assert setores == []
    assert avisos == []

    resultado = pcp.aplicar(cliente, setores, linhas, aplicar=True)

    assert resultado['setores'] == ['BCM', 'Importada']
    assert resultado['ausentes'] == []
    assert [o['setor_banco'] for o in resultado['atualizadas']] == ['BCM', 'Importada', 'BCM']

    limpezas = [e for e in cliente.escritas
                if e[1] == {'prioridade': None, 'peso_prioridade': None}]
    assert [dict(filtros)['setor'][0] for _, _, filtros in limpezas] == ['BCM', 'Importada']
    # Nada de prioridade "BCM": as limpezas vêm antes das atualizações.
    assert [e[1]['prioridade'] for e in cliente.escritas if e[1]['prioridade']] == [
        'Exportacao', 'KS', 'Linha Pesada',
    ]


def test_apply_lote_de_seis_digitos_nao_conta_como_op_ausente():
    texto = '\n'.join([
        '02 - Exportação',
        '1.132.972',
        '311646',
        '1.132.973',
        '311647',
    ])
    cliente = ClienteFalso(banco(('1132972', 'Montagem'), ('1132973', 'Montagem')))
    setores, linhas, avisos = pcp.parse_tsv(texto)
    assert len(linhas) == 4

    resultado = pcp.aplicar(cliente, setores, linhas, aplicar=False)
    relatorio = pcp.formatar_relatorio(resultado, avisos)

    assert [o['numero_op'] for o in resultado['atualizadas']] == ['1132972', '1132973']
    assert resultado['ausentes'] == []
    assert [o['numero_op'] for o in resultado['ignorados']] == ['311646', '311647']
    assert 'Lotes ignorados' in relatorio
    assert '311646' in relatorio
    assert 'ausentes no banco: 0' in relatorio.lower()


def test_apply_op_de_seis_digitos_existente_no_banco_e_atualizada():
    texto = '\n'.join(['02 - Exportação', '1132972', '104528'])
    cliente = ClienteFalso(banco(('1132972', 'Montagem'), ('104528', 'Montagem')))
    setores, linhas, avisos = pcp.parse_tsv(texto)

    resultado = pcp.aplicar(cliente, setores, linhas, aplicar=True)

    assert [o['numero_op'] for o in resultado['atualizadas']] == ['1132972', '104528']
    assert resultado['ignorados'] == []


def test_apply_op_de_seis_digitos_ausente_vira_lote_ignorado():
    texto = '104529 02 - Exportação'
    cliente = ClienteFalso([])
    setores, linhas, avisos = pcp.parse_tsv(texto)

    resultado = pcp.aplicar(cliente, setores, linhas, aplicar=False)

    assert resultado['ausentes'] == []
    assert [o['numero_op'] for o in resultado['ignorados']] == ['104529']


def test_parse_registra_a_origem_da_op():
    _, linhas, _ = pcp.parse_tsv('1132972 02 - Exportação\n104528 02 - KS')

    origens = {l['numero_op']: l['origem'] for l in linhas}
    assert origens == {'1132972': 'texto_7', '104528': 'texto_6'}

    _, coluna, _ = pcp.parse_tsv('Setor\tOrdem\tPrioridade\nMontagem\t104528\t02 - Exportação')
    assert coluna[0]['origem'] == 'coluna'


def test_pcp_exemplo_aplicado_sem_avisos_de_setor_ou_prioridade():
    caminho = pcp.RAIZ / 'scripts' / 'pcp_exemplo.tsv'
    if not caminho.exists():
        pytest.skip('pcp_exemplo.tsv não encontrado')

    cliente = ClienteFalso(banco(
        ('1132972', 'Montagem'),
        ('1132973', 'Montagem'),
        ('1132912', 'Celula'),
        ('1132985', 'Usinagem'),
    ))
    setores, linhas, avisos = pcp.parse_tsv(caminho.read_text(encoding='utf-8'))

    resultado = pcp.aplicar(cliente, setores, linhas, aplicar=False)
    relatorio = pcp.formatar_relatorio(resultado, avisos)

    assert 'setor não identificado' not in relatorio.lower()
    assert 'prioridade desconhecida' not in relatorio.lower()
    assert 'ausentes no banco: 0' in relatorio.lower()
    assert resultado['setores'] == ['Montagem', 'Celula', 'Usinagem']


def test_pcp_exemplo_com_quebras_estranhas_e_pontos_no_numero():
    caminho = pcp.RAIZ / 'scripts' / 'pcp_exemplo.tsv'
    if not caminho.exists():
        pytest.skip('pcp_exemplo.tsv não encontrado')

    cabecalho, *dados = caminho.read_text(encoding='utf-8').splitlines()
    assert 'Ordem' in cabecalho

    colados = ['Bom dia, seguem as prioridades:']
    esperados = []
    for linha in dados:
        celulas = linha.split('\t')
        ordem = celulas[3]
        esperados.append(ordem)
        # Prioridade quebrada em uma linha e OP com pontos de milhar na outra.
        colados.append(celulas[0])
        colados.append('{:,}'.format(int(ordem)).replace(',', '.'))

    setores, linhas, avisos = pcp.parse_tsv('\n'.join(colados))

    assert [l['numero_op'] for l in linhas] == esperados
    assert avisos == []


def test_relatorio_traz_ops_ausentes_e_avisos_de_parse():
    cliente = ClienteFalso(banco(('104528', 'Montagem')))
    texto = '\n'.join([
        'Setor\tOrdem\tPrioridade',
        'Montagem\t104528\t02 - Exportação',
        'Montagem\t104529\tUrgente!!',
    ])
    setores, linhas, avisos = pcp.parse_tsv(texto)

    resultado = pcp.aplicar(cliente, setores, linhas, aplicar=False)
    relatorio = pcp.formatar_relatorio(resultado, avisos)

    assert '104528' in relatorio
    assert 'nenhuma op ausente' in relatorio.lower() or 'ausentes: 0' in relatorio.lower()
    assert '104529' in relatorio
    assert 'Urgente' in relatorio


# ---------------------------------------------------------------------------
# Carregamento do .env e dependências
# ---------------------------------------------------------------------------

def test_carregar_env_funciona_sem_python_dotenv(monkeypatch, tmp_path):
    monkeypatch.setattr(pcp, 'RAIZ', tmp_path)
    (tmp_path / '.env').write_text(
        '# comentario\n'
        'SUPABASE_URL_ORDENS="https://exemplo.supabase.co"\n'
        "SUPABASE_SERVICE_ROLE_KEY_ORDENS='chave-teste'\n",
        encoding='utf-8',
    )
    monkeypatch.setitem(sys.modules, 'dotenv', None)
    monkeypatch.delenv('SUPABASE_URL_ORDENS', raising=False)
    monkeypatch.delenv('SUPABASE_SERVICE_ROLE_KEY_ORDENS', raising=False)

    pcp.carregar_env()

    assert os.environ['SUPABASE_URL_ORDENS'] == 'https://exemplo.supabase.co'
    assert os.environ['SUPABASE_SERVICE_ROLE_KEY_ORDENS'] == 'chave-teste'


def test_carregar_env_simples_nao_sobrescreve_variavel_do_ambiente(monkeypatch, tmp_path):
    monkeypatch.setattr(pcp, 'RAIZ', tmp_path)
    (tmp_path / '.env').write_text('SUPABASE_URL_ORDENS=https://arquivo\n', encoding='utf-8')
    monkeypatch.setitem(sys.modules, 'dotenv', None)
    monkeypatch.setenv('SUPABASE_URL_ORDENS', 'https://ambiente')

    pcp.carregar_env()

    assert os.environ['SUPABASE_URL_ORDENS'] == 'https://ambiente'


def test_criar_cliente_explica_quando_supabase_nao_instalado(monkeypatch):
    monkeypatch.setitem(sys.modules, 'supabase', None)
    monkeypatch.setenv('SUPABASE_URL_ORDENS', 'https://exemplo.supabase.co')
    monkeypatch.setenv('SUPABASE_SERVICE_ROLE_KEY_ORDENS', 'chave')

    with pytest.raises(RuntimeError) as erro:
        pcp.criar_cliente()

    mensagem = str(erro.value)
    assert 'supabase' in mensagem.lower()
    assert 'pip install' in mensagem


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

def test_main_le_tsv_do_stdin_em_dry_run(capsys):
    cliente = ClienteFalso(banco(('104528', 'Montagem'), ('104529', 'Montagem')))

    codigo = pcp.main([], cliente=cliente, stdin=io.StringIO(TSV_SETOR_OP_PRIORIDADE))

    saida = capsys.readouterr().out
    assert codigo == 0
    assert 'DRY-RUN' in saida.upper()
    assert '104530' in saida
    assert cliente.escritas == []


def test_main_aplica_com_a_flag_apply(capsys):
    cliente = ClienteFalso(banco(('104528', 'Montagem')))

    codigo = pcp.main(['--apply'], cliente=cliente, stdin=io.StringIO(TSV_SETOR_OP_PRIORIDADE))

    saida = capsys.readouterr().out
    assert codigo == 0
    assert cliente.escritas
    assert 'aplicado' in saida.lower()


def test_main_aceita_arquivo_de_entrada(tmp_path, capsys):
    entrada = tmp_path / 'pcp.tsv'
    entrada.write_text(TSV_SETOR_OP_PRIORIDADE, encoding='utf-8')
    cliente = ClienteFalso(banco(('104528', 'Montagem')))

    codigo = pcp.main(['--input', str(entrada)], cliente=cliente)

    assert codigo == 0
    assert '104528' in capsys.readouterr().out


def test_main_falha_com_entrada_sem_tabela(capsys):
    cliente = ClienteFalso([])

    codigo = pcp.main([], cliente=cliente, stdin=io.StringIO('nada aqui'))

    assert codigo != 0
    assert capsys.readouterr().err.strip() != ''


def test_main_mostra_diagnostico_quando_nao_acha_op(capsys):
    cliente = ClienteFalso([])

    codigo = pcp.main([], cliente=cliente,
                      stdin=io.StringIO('Linha com 1132972 mas sem prioridade'))

    erro = capsys.readouterr().err
    assert codigo != 0
    assert 'Diagnostico' in erro
    assert '1132972' in erro
    assert '--debug' in erro


def test_main_debug_mostra_cada_linha_candidata(capsys):
    cliente = ClienteFalso(banco(('104528', 'Montagem')))

    codigo = pcp.main(['--debug'], cliente=cliente,
                      stdin=io.StringIO('104528 02 - Exportação'))

    capturado = capsys.readouterr()
    assert codigo == 0
    assert '[debug]' in capturado.err
    assert '104528' in capturado.err
    assert 'Exportacao' in capturado.err


def test_main_grava_relatorio_em_arquivo(tmp_path, capsys):
    cliente = ClienteFalso(banco(('104528', 'Montagem')))
    destino = tmp_path / 'relatorio.txt'

    codigo = pcp.main(['--report', str(destino)], cliente=cliente,
                      stdin=io.StringIO(TSV_SETOR_OP_PRIORIDADE))

    assert codigo == 0
    assert 'Setores' in destino.read_text(encoding='utf-8')


def test_main_falha_quando_o_banco_retorna_erro(capsys):
    class ClienteComErro(ClienteFalso):
        def execute(self):
            if self.operacao == 'select':
                raise RuntimeError('conexao caiu')
            return super().execute()

    codigo = pcp.main([], cliente=ClienteComErro([]), stdin=io.StringIO(TSV_SETOR_OP_PRIORIDADE))

    assert codigo != 0
    assert 'conexao caiu' in capsys.readouterr().err

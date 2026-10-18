"""Testes do gerador de planilhas scripts/export_excel.py.

Contrato com o server.js:
  python scripts/export_excel.py --ids "1,2,3"
  -> a ULTIMA linha do stdout deve ser o caminho de um .xlsx existente.
"""

import os
from datetime import date

import openpyxl
import pytest

import export_excel as ex

COLUNAS_ESPERADAS = [
    'OP',
    'Peças',
    'Data Abertura',
    'Material',
    'Situação',
    'Observação',
    'Setor',
    'Prioridade',
    'Dia Análise',
    'Turno',
]


def registro(id=5, **overrides):
    """Registro no formato devolvido pelo supabase-py (datas como texto ISO)."""
    base = {
        'id': id,
        'numero_op': '1132688',
        'setor': 'Montagem',
        'total_pecas': 400,
        'material': '90000291',
        'data_abertura': '2026-10-16',
        'dia_analise': None,
        'situacao': 'Falta Pagar',
        'prioridade': 'Pendencia Comercial',
        'observacao': None,
    }
    base.update(overrides)
    return base


class ClienteFalso:
    """Imita o encadeamento usado do supabase-py: table().select().in_().execute()."""

    def __init__(self, registros):
        self._registros = registros
        self.ids_pedidos = None
        self.tabela = None

    def table(self, nome):
        self.tabela = nome
        return self

    def select(self, campos):
        self.campos = campos
        return self

    def in_(self, coluna, valores):
        self.coluna_filtro = coluna
        self.ids_pedidos = list(valores)
        return self

    def execute(self):
        return type('Resposta', (), {'data': list(self._registros)})()


# ---------------------------------------------------------------------------
# --ids / parse_ids
# ---------------------------------------------------------------------------

def test_parse_ids_le_lista_separada_por_virgula():
    assert ex.parse_ids('1,2,3') == [1, 2, 3]


def test_parse_ids_ignora_espacos():
    assert ex.parse_ids(' 5 , 6 ') == [5, 6]


def test_parse_ids_remove_repetidos_preservando_a_primeira_ocorrencia():
    assert ex.parse_ids('3,3,1') == [3, 1]


@pytest.mark.parametrize('entrada', ['', '   ', '1,abc', '1;-2', '-2', '1,', 'a'])
def test_parse_ids_rejeita_entrada_invalida(entrada):
    with pytest.raises(ValueError):
        ex.parse_ids(entrada)


# ---------------------------------------------------------------------------
# buscar_ordens
# ---------------------------------------------------------------------------

def test_buscar_ordens_consulta_tabela_com_filtro_de_ids():
    cliente = ClienteFalso([registro(5), registro(6)])

    registros = ex.buscar_ordens(cliente, [5, 6])

    assert [r['id'] for r in registros] == [5, 6]
    assert cliente.tabela == 'ordens_producao'
    assert cliente.ids_pedidos == [5, 6]


def test_buscar_ordens_sem_ids_nao_consulta_o_banco():
    cliente = ClienteFalso([])

    assert ex.buscar_ordens(cliente, []) == []
    assert cliente.ids_pedidos is None


# ---------------------------------------------------------------------------
# montar_dataframe
# ---------------------------------------------------------------------------

def test_dataframe_usa_os_cabecalhos_na_ordem_definida():
    df, _ = ex.montar_dataframe([registro()], [5])

    assert list(df.columns) == COLUNAS_ESPERADAS


def test_dataframe_respeita_a_ordem_dos_ids_recebidos():
    registros = [registro(9, numero_op='1132682'), registro(5, numero_op='1132688')]

    df, _ = ex.montar_dataframe(registros, [5, 9])

    assert list(df['OP']) == ['1132688', '1132682']


def test_dataframe_formata_datas_como_dd_mm_aaaa():
    df, _ = ex.montar_dataframe([registro(data_abertura='2026-10-16',
                                          dia_analise='2026-01-02')], [5])

    assert df.loc[0, 'Data Abertura'] == '16/10/2026'
    assert df.loc[0, 'Dia Análise'] == '02/01/2026'


def test_dataframe_aceita_datas_como_objeto_date():
    df, _ = ex.montar_dataframe([registro(data_abertura=date(2026, 10, 16))], [5])

    assert df.loc[0, 'Data Abertura'] == '16/10/2026'


def test_dataframe_deixa_campos_nulos_como_celula_vazia():
    df, _ = ex.montar_dataframe([registro(observacao=None, dia_analise=None)], [5])

    assert df.loc[0, 'Observação'] == ''
    assert df.loc[0, 'Dia Análise'] == ''


def test_dataframe_mantem_total_de_pecas_como_numero():
    df, _ = ex.montar_dataframe([registro(total_pecas=1250)], [5])

    assert df.loc[0, 'Peças'] == 1250


def test_dataframe_reporta_ids_que_nao_existem_no_banco():
    df, faltantes = ex.montar_dataframe([registro(5)], [5, 99, 123])

    assert faltantes == [99, 123]
    assert len(df) == 1


def test_dataframe_com_nenhum_registro_retorna_planilha_so_com_cabecalho():
    df, faltantes = ex.montar_dataframe([], [7, 8])

    assert list(df.columns) == COLUNAS_ESPERADAS
    assert len(df) == 0
    assert faltantes == [7, 8]


# ---------------------------------------------------------------------------
# Turno (derivado de dia_analise, avaliado no fuso America/Sao_Paulo)
#   T1: 05:20 - 13:39 | T2: 13:40 - 21:59 | T3: 22:00 - 05:19
# ---------------------------------------------------------------------------

@pytest.mark.parametrize('hora,esperado', [
    ('05:19', 'T3'),
    ('05:20', 'T1'),
    ('13:39', 'T1'),
    ('13:40', 'T2'),
    ('21:59', 'T2'),
    ('22:00', 'T3'),
    ('23:59', 'T3'),
    ('00:00', 'T3'),
])
def test_classificar_turno_respeita_as_fronteiras(hora, esperado):
    instante = '2026-10-16T%s:00-03:00' % hora

    assert ex.classificar_turno(instante) == esperado


def test_classificar_turno_avalia_no_fuso_da_fabrica():
    # 01:30 UTC = 22:30 do dia anterior em Sao Paulo -> T3
    assert ex.classificar_turno('2026-10-17T01:30:00+00:00') == 'T3'
    # 08:30 UTC = 05:30 em Sao Paulo -> T1
    assert ex.classificar_turno('2026-10-17T08:30:00+00:00') == 'T1'


def test_classificar_turno_de_data_pura_e_a_meia_noite_da_fabrica():
    # Ordem paga antes da mudanca para timestamptz ficou gravada a meia-noite: T3, igual a tela.
    assert ex.classificar_turno('2026-10-16') == 'T3'


@pytest.mark.parametrize('valor', [None, '', '   ', 'nao-e-data'])
def test_classificar_turno_sem_data_valida_e_nulo(valor):
    assert ex.classificar_turno(valor) is None


def test_dataframe_inclui_a_coluna_turno_depois_do_dia_analise():
    df, _ = ex.montar_dataframe([registro(dia_analise='2026-10-16T14:00:00-03:00')], [5])

    assert list(df.columns)[-1] == 'Turno'
    assert df.loc[0, 'Turno'] == 'T2'


def test_dataframe_deixa_turno_vazio_quando_a_ordem_nao_foi_paga():
    df, _ = ex.montar_dataframe([registro(dia_analise=None)], [5])

    assert df.loc[0, 'Turno'] == ''


def test_dia_analise_usa_a_data_da_fabrica_e_nao_a_data_utc():
    # 2026-10-17T01:30Z = 16/10 22:30 em Sao Paulo
    df, _ = ex.montar_dataframe([registro(dia_analise='2026-10-17T01:30:00+00:00')], [5])

    assert df.loc[0, 'Dia Análise'] == '16/10/2026'
    assert df.loc[0, 'Turno'] == 'T3'


# ---------------------------------------------------------------------------
# escrever_planilha
# ---------------------------------------------------------------------------

def planilha_de_teste(destino, registros=None, ids=None):
    df, faltantes = ex.montar_dataframe(registros or [registro()], ids or [5])
    ex.escrever_planilha(df, destino)
    return destino, faltantes


def test_escrever_planilha_retorna_o_caminho_do_arquivo(tmp_path):
    destino = str(tmp_path / 'saida.xlsx')

    caminho = planilha_de_teste(destino)[0]

    assert caminho == destino
    assert os.path.exists(caminho)


def test_header_azul_escuro_texto_branco_negrito_centralizado(tmp_path):
    caminho = planilha_de_teste(str(tmp_path / 'saida.xlsx'))[0]

    ws = openpyxl.load_workbook(caminho).active
    for celula in ws[1]:
        assert celula.fill.fill_type == 'solid'
        assert celula.fill.fgColor.rgb == 'FF1F3864'
        assert celula.font.color.rgb == 'FFFFFFFF'
        assert celula.font.bold is True
        assert celula.alignment.horizontal == 'center'


def test_autofilter_cobre_todas_as_colunas(tmp_path):
    registros = [registro(5), registro(6), registro(7)]
    caminho = planilha_de_teste(str(tmp_path / 'saida.xlsx'), registros, [5, 6, 7])[0]

    ws = openpyxl.load_workbook(caminho).active

    assert ws.auto_filter.ref == 'A1:J4'


def test_primeira_linha_congelada(tmp_path):
    caminho = planilha_de_teste(str(tmp_path / 'saida.xlsx'))[0]

    ws = openpyxl.load_workbook(caminho).active

    assert ws.freeze_panes == 'A2'


def test_borda_fina_em_todas_as_celulas_preenchidas(tmp_path):
    registros = [registro(5), registro(6)]
    caminho = planilha_de_teste(str(tmp_path / 'saida.xlsx'), registros, [5, 6])[0]

    ws = openpyxl.load_workbook(caminho).active

    for linha in ws.iter_rows(min_row=1, max_row=ws.max_row, max_col=len(COLUNAS_ESPERADAS)):
        for celula in linha:
            assert celula.border.left.style == 'thin'
            assert celula.border.right.style == 'thin'
            assert celula.border.top.style == 'thin'
            assert celula.border.bottom.style == 'thin'


def test_largura_das_colunas_acompanha_o_conteudo(tmp_path):
    registros = [registro(5, setor='Subconjunto')]
    caminho = planilha_de_teste(str(tmp_path / 'saida.xlsx'), registros, [5])[0]

    ws = openpyxl.load_workbook(caminho).active

    # 'Subconjunto' (11) + padding de 2 = 13; cabecalho 'Setor' nao passa disso.
    assert ws.column_dimensions['G'].width == 13


def test_largura_da_coluna_observacao_respeita_o_teto(tmp_path):
    texto_longo = 'sem saldo, aguardando devolutiva comercial sobre a producao ' * 3
    registros = [registro(5, observacao=texto_longo)]
    caminho = planilha_de_teste(str(tmp_path / 'saida.xlsx'), registros, [5])[0]

    ws = openpyxl.load_workbook(caminho).active

    assert ws.column_dimensions['F'].width == ex.LARGURA_MAXIMA_COLUNA
    assert ex.LARGURA_MAXIMA_COLUNA < len(texto_longo)


def test_largura_da_coluna_turno_acompanha_o_cabecalho(tmp_path):
    caminho = planilha_de_teste(str(tmp_path / 'saida.xlsx'))[0]

    ws = openpyxl.load_workbook(caminho).active

    # 'Turno' (5) + padding de 2 = 7; os valores 'T1'/'T2'/'T3' sao mais curtos.
    assert ws.column_dimensions['J'].width == 7


def test_planilha_com_cabecalho_somente_tem_bordas_na_linha_1(tmp_path):
    caminho = ex.escrever_planilha(ex.montar_dataframe([], [7])[0], str(tmp_path / 'vazio.xlsx'))

    ws = openpyxl.load_workbook(caminho).active

    assert ws.max_row == 1
    assert len(ws[1]) == len(COLUNAS_ESPERADAS)


# ---------------------------------------------------------------------------
# main: contrato de stdout
# ---------------------------------------------------------------------------

def test_main_imprime_o_caminho_na_ultima_linha_do_stdout(tmp_path, capsys):
    cliente = ClienteFalso([registro(5), registro(6)])

    codigo = ex.main(['--ids', '5,6'], cliente=cliente, diretorio=str(tmp_path))

    saida = capsys.readouterr().out.strip().splitlines()
    assert codigo == 0
    assert saida[-1].endswith('.xlsx')
    assert os.path.exists(saida[-1])
    assert openpyxl.load_workbook(saida[-1]).active.max_row == 3


def test_main_avisa_no_stderr_quando_algum_id_nao_existe(tmp_path, capsys):
    cliente = ClienteFalso([registro(5)])

    codigo = ex.main(['--ids', '5,99'], cliente=cliente, diretorio=str(tmp_path))

    capturado = capsys.readouterr()
    assert codigo == 0
    assert '99' in capturado.err
    # A ultima linha do stdout continua sendo o caminho do arquivo.
    assert capturado.out.strip().splitlines()[-1].endswith('.xlsx')


def test_main_falha_com_ids_invalidos(tmp_path, capsys):
    codigo = ex.main(['--ids', '5,abc'], cliente=ClienteFalso([]), diretorio=str(tmp_path))

    assert codigo != 0
    assert 'abc' in capsys.readouterr().err


def test_main_exige_o_argumento_ids(tmp_path, capsys):
    codigo = ex.main([], cliente=ClienteFalso([]), diretorio=str(tmp_path))

    assert codigo != 0
    assert capsys.readouterr().err.strip() != ''


def test_main_carrega_o_env_antes_de_criar_o_cliente(tmp_path, monkeypatch, capsys):
    ordem_das_chamadas = []
    monkeypatch.setattr(ex, 'carregar_env', lambda: ordem_das_chamadas.append('env'))
    monkeypatch.setattr(
        ex, 'criar_cliente',
        lambda: ordem_das_chamadas.append('cliente') or ClienteFalso([registro(5)]),
    )

    codigo = ex.main(['--ids', '5'], diretorio=str(tmp_path))

    assert codigo == 0
    assert ordem_das_chamadas == ['env', 'cliente']


# ---------------------------------------------------------------------------
# Integracao real (so roda com as credenciais do .env carregadas)
# ---------------------------------------------------------------------------

def test_integracao_gera_planilha_a_partir_do_banco(tmp_path, capsys):
    ex.carregar_env()
    if not (os.getenv('SUPABASE_URL_ORDENS') or os.getenv('SUPABASE_URL')):
        pytest.skip('sem credenciais do Supabase no ambiente')
    if not (os.getenv('SUPABASE_SERVICE_ROLE_KEY_ORDENS') or os.getenv('SUPABASE_SERVICE_ROLE_KEY')):
        pytest.skip('sem service role key do Supabase no ambiente')

    ids = ex.ids_disponiveis(ex.criar_cliente(), limite=2)
    if not ids:
        pytest.skip('tabela ordens_producao vazia')

    codigo = ex.main(['--ids', ','.join(str(i) for i in ids)], diretorio=str(tmp_path))

    assert codigo == 0
    caminho = capsys.readouterr().out.strip().splitlines()[-1]
    ws = openpyxl.load_workbook(caminho).active
    assert ws.max_row == len(ids) + 1

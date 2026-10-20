"""Testes do gerador da Folha de Sequenciamento de Ordens (PDF A4).

Contrato:
    python scripts/gerar_sequenciamento_pdf.py                    # JSON no stdin
    python scripts/gerar_sequenciamento_pdf.py --input ordens.json
    python scripts/gerar_sequenciamento_pdf.py --output saida.pdf

A ULTIMA linha do stdout é o caminho do PDF gerado. Avisos/erros vão ao stderr.

Regras de negócio cobertas:
  * fluxo contínuo por setor (sem quebra de página forçada);
  * ordem estrita: Lista Vermelha > Amarela > Branca, FIFO por data de abertura;
  * Importada/Usinagem imprimem a observação do banco; demais setores, pauta.
"""

import io
import json
import os
import re
from datetime import date, datetime
from zoneinfo import ZoneInfo

import pypdf
import pytest

import gerar_sequenciamento_pdf as seq


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def ordem(**overrides):
    base = {
        'id': 1,
        'numero_op': '104528',
        'material': '70.123-A',
        'total_pecas': 1500,
        'data_abertura': '2026-10-10',
        'situacao': 'Pendente',
        'setor': 'Montagem',
        'prioridade': 'Exportacao',
        'observacao': 'Componente X',
    }
    base.update(overrides)
    return base


def payload(ordens, setores=None):
    dados = {'ordens': ordens}
    if setores is not None:
        dados['setores_selecionados'] = setores
    return json.dumps(dados)


def texto_do_pdf(caminho):
    leitor = pypdf.PdfReader(caminho)
    return '\n'.join(pagina.extract_text() or '' for pagina in leitor.pages)


# ---------------------------------------------------------------------------
# Prioridade
# ---------------------------------------------------------------------------

@pytest.mark.parametrize('valor', ['Exportacao', 'Exportação', 'KS', 'Marelli', 'MWM'])
def test_prioridade_vermelha_para_as_listas_criticas(valor):
    assert seq.classificar_prioridade(valor) == 'VERMELHA'


def test_prioridade_amarela_para_pendencia_comercial():
    assert seq.classificar_prioridade('Pendencia Comercial') == 'AMARELA'
    assert seq.classificar_prioridade('Pendência Comercial') == 'AMARELA'


@pytest.mark.parametrize('valor', ['Linha Pesada', 'MRP', 'Tryout', 'Outra', None, ''])
def test_prioridade_branca_para_o_resto(valor):
    assert seq.classificar_prioridade(valor) == 'BRANCA'


@pytest.mark.parametrize('valor,esperado', [
    ('Exportacao', '[VERMELHA] Exportacao'),
    ('Pendencia Comercial', '[AMARELA] Pendencia Comercial'),
    ('Linha Pesada', '[BRANCA] Linha Pesada'),
    ('MRP', '[BRANCA] MRP'),
    ('Tryout', '[BRANCA] Tryout'),
])
def test_rotulo_de_prioridade_mostra_classificacao_e_nome_real(valor, esperado):
    assert seq.rotulo_prioridade(valor) == esperado


def test_rotulo_de_prioridade_sem_valor_mostra_traco():
    assert seq.rotulo_prioridade(None) == '[BRANCA] —'


def test_barra_de_setor_usa_grafite_com_acento_laranja():
    assert seq.COR_BARRA_SETOR == '#1E293B'
    assert seq.COR_ACENTO_SETOR == '#D97706'


def test_cabecalho_da_tabela_e_claro_com_texto_escuro():
    """Cabeçalho escuro com Paragraph preto ficava ilegível na impressão."""
    assert seq.COR_CABECALHO_TABELA == '#E2E8F0'
    assert seq.COR_TEXTO_CABECALHO == '#0F172A'

    assert str(seq._estilos()['header'].textColor).upper() == seq.COR_TEXTO_CABECALHO


@pytest.mark.parametrize('valor,esperado', [
    (1500, '1.500'),
    (0, '0'),
    (1234567, '1.234.567'),
    (None, '0'),
])
def test_formatar_milhar(valor, esperado):
    assert seq.formatar_milhar(valor) == esperado


# ---------------------------------------------------------------------------
# Entrada
# ---------------------------------------------------------------------------

def test_ler_entrada_aceita_ordens_e_setores():
    selecionados, ordens = seq.ler_entrada(payload([ordem()], ['Montagem']))

    assert selecionados == ['Montagem']
    assert ordens[0]['numero_op'] == '104528'


def test_ler_entrada_sem_setores_selecionados_devolve_none():
    selecionados, _ = seq.ler_entrada(payload([ordem()]))

    assert selecionados is None


@pytest.mark.parametrize('entrada', [
    '',
    '   ',
    'nao-e-json',
    '[]',
    '{"ordens": "x"}',
    '{"ordens": []}',
])
def test_ler_entrada_rejeita_payload_invalido(entrada):
    with pytest.raises(ValueError):
        seq.ler_entrada(entrada)


# ---------------------------------------------------------------------------
# Agrupamento e ordenação
# ---------------------------------------------------------------------------

def test_setores_seguem_a_ordem_fixa_da_fabrica():
    ordens = [ordem(setor='Usinagem'), ordem(setor='Montagem'), ordem(setor='BCM')]

    grupos = seq.agrupar_ordens(ordens)

    assert [nome for nome, _ in grupos] == ['Montagem', 'BCM', 'Usinagem']


def test_filtra_apenas_os_setores_selecionados():
    ordens = [ordem(setor='Montagem'), ordem(setor='Usinagem')]

    grupos = seq.agrupar_ordens(ordens, ['Usinagem'])

    assert [nome for nome, _ in grupos] == ['Usinagem']


def test_setor_desconhecido_vai_para_o_final_sem_perder_ordens():
    ordens = [ordem(setor='Pintura'), ordem(setor='Montagem'), ordem(setor='Pintura')]

    grupos = seq.agrupar_ordens(ordens)

    assert [nome for nome, _ in grupos] == ['Montagem', 'Pintura']
    assert len(grupos[1][1]) == 2


def test_ordem_estrita_vermelha_amarela_branca():
    ordens = [
        ordem(numero_op='BRANCA', prioridade='MRP', data_abertura='2026-01-01'),
        ordem(numero_op='AMARELA', prioridade='Pendencia Comercial', data_abertura='2026-01-02'),
        ordem(numero_op='VERMELHA', prioridade='KS', data_abertura='2026-05-05'),
    ]

    grupos = seq.agrupar_ordens(ordens)

    assert [o['numero_op'] for o in grupos[0][1]] == ['VERMELHA', 'AMARELA', 'BRANCA']


def test_dentro_da_prioridade_ordena_por_data_mais_antiga():
    ordens = [
        ordem(numero_op='NOVA', prioridade='MWM', data_abertura='2026-10-15'),
        ordem(numero_op='VELHA', prioridade='Exportacao', data_abertura='2026-01-02'),
        ordem(numero_op='MEIO', prioridade='Marelli', data_abertura='2026-06-01'),
    ]

    grupos = seq.agrupar_ordens(ordens)

    assert [o['numero_op'] for o in grupos[0][1]] == ['VELHA', 'MEIO', 'NOVA']


def test_data_nula_fica_no_final_do_mesmo_bloco_de_prioridade():
    ordens = [
        ordem(numero_op='SEM_DATA', prioridade='Exportacao', data_abertura=None),
        ordem(numero_op='DEPOIS', prioridade='Exportacao', data_abertura='2026-10-01'),
        ordem(numero_op='ANTES', prioridade='Exportacao', data_abertura='2026-01-01'),
        ordem(numero_op='BRANCA', prioridade='Tryout', data_abertura='2025-01-01'),
    ]

    grupos = seq.agrupar_ordens(ordens)

    assert [o['numero_op'] for o in grupos[0][1]] == ['ANTES', 'DEPOIS', 'SEM_DATA', 'BRANCA']


def test_data_em_objeto_date_e_aceita_na_ordenacao():
    ordens = [
        ordem(numero_op='B', data_abertura=date(2026, 2, 1)),
        ordem(numero_op='A', data_abertura=date(2026, 1, 1)),
    ]

    grupos = seq.agrupar_ordens(ordens)

    assert [o['numero_op'] for o in grupos[0][1]] == ['A', 'B']


def test_empate_de_data_preserva_a_ordem_de_entrada():
    ordens = [
        ordem(numero_op='PRIMEIRA'),
        ordem(numero_op='SEGUNDA'),
    ]

    grupos = seq.agrupar_ordens(ordens)

    assert [o['numero_op'] for o in grupos[0][1]] == ['PRIMEIRA', 'SEGUNDA']


def test_agrupar_ignora_registros_invalidos():
    grupos = seq.agrupar_ordens([ordem(), 'lixo', None])

    assert len(grupos) == 1
    assert len(grupos[0][1]) == 1


def test_cabecalho_do_setor_traz_contagem_e_total():
    ordens = [
        ordem(setor='Montagem', total_pecas=1500),
        ordem(setor='Montagem', total_pecas=3300),
    ]

    grupos = seq.agrupar_ordens(ordens)

    assert seq.cabecalho_setor(*grupos[0]) == 'MONTAGEM — 2 OPs | Total: 4.800 peças'


def test_cabecalho_do_setor_usa_singular_para_uma_op():
    grupos = seq.agrupar_ordens([ordem(setor='Montagem', total_pecas=1500)])

    assert seq.cabecalho_setor(*grupos[0]) == 'MONTAGEM — 1 OP | Total: 1.500 peças'


# ---------------------------------------------------------------------------
# PDF: layout e conteúdo
# ---------------------------------------------------------------------------

def gerar(tmp_path, ordens, setores=None, nome='saida.pdf'):
    destino = str(tmp_path / nome)
    seq.gerar_pdf(ordens, destino, setores_selecionados=setores)
    return destino


def test_pdf_em_a4_retrato(tmp_path, monkeypatch):
    monkeypatch.setattr(seq, 'agora_fabrica', lambda: datetime(2026, 10, 16, 14, 30,
                                                               tzinfo=ZoneInfo('America/Sao_Paulo')))

    caminho = gerar(tmp_path, [ordem()])
    pagina = pypdf.PdfReader(caminho).pages[0]

    assert round(float(pagina.mediabox.width)) == 595
    assert round(float(pagina.mediabox.height)) == 842


def test_cabecalho_geral_traz_titulo_e_data_de_emissao(tmp_path, monkeypatch):
    monkeypatch.setattr(seq, 'agora_fabrica', lambda: datetime(2026, 10, 16, 14, 30,
                                                               tzinfo=ZoneInfo('America/Sao_Paulo')))

    texto = texto_do_pdf(gerar(tmp_path, [ordem()]))

    assert 'SCHADEK' in texto
    assert 'SEQUENCIAMENTO DE ORDENS' in texto
    assert 'PRODUÇÃO' not in texto
    assert '16/10/2026 14:30' in texto


def test_setores_aparecem_em_fluxo_continuo_na_mesma_pagina(tmp_path):
    ordens = [ordem(setor='Montagem', numero_op='1000%d' % i) for i in range(5)]
    ordens += [ordem(setor='Subconjunto', numero_op='2000%d' % i) for i in range(5)]

    caminho = gerar(tmp_path, ordens)

    assert len(pypdf.PdfReader(caminho).pages) == 1
    texto = texto_do_pdf(caminho)
    assert texto.find('MONTAGEM') < texto.find('SUBCONJUNTO')


def test_prioridade_vermelha_aparece_antes_da_branca_no_pdf(tmp_path):
    ordens = [
        ordem(numero_op='BRANCA1', prioridade='MRP', data_abertura='2026-01-01'),
        ordem(numero_op='VERMELHA1', prioridade='MWM', data_abertura='2026-09-01'),
    ]

    texto = texto_do_pdf(gerar(tmp_path, ordens))

    assert texto.find('VERMELHA1') < texto.find('BRANCA1')


def test_importada_e_usinagem_imprimem_a_observacao_do_banco(tmp_path):
    ordens = [
        ordem(setor='Importada', numero_op='IMP1', observacao='COMP-9988'),
        ordem(setor='Usinagem', numero_op='USI1', observacao='EIXO 32MM'),
        ordem(setor='Montagem', numero_op='MON1', observacao='TEXTO-QUE-NAO-DEVE-APARECER'),
    ]

    texto = texto_do_pdf(gerar(tmp_path, ordens))

    assert 'COMP-9988' in texto
    assert 'EIXO 32MM' in texto
    assert 'TEXTO-QUE-NAO-DEVE-APARECER' not in texto


def test_coluna_obs_nao_usa_pautado_fixo(tmp_path):
    ordens = [
        ordem(setor='Montagem', numero_op='MON1', observacao='TEXTO-DE-MONTAGEM'),
        ordem(setor='Importada', numero_op='IMP1', observacao='COMP-9'),
    ]

    texto = texto_do_pdf(gerar(tmp_path, ordens))

    # Sem caixa de visto e sem pauta fixa em nenhum setor.
    assert not re.findall(r'\[\s*\]', texto)
    assert '____' not in texto
    # Só Importada/Usinagem imprimem a observação do componente.
    assert 'COMP-9' in texto
    assert 'TEXTO-DE-MONTAGEM' not in texto


def test_fontes_das_celulas_sao_maiores_e_legiveis():
    estilos = seq._estilos()

    assert estilos['base'].fontSize >= 9
    assert estilos['op'].fontSize >= 11
    assert estilos['material'].fontSize >= 9
    assert estilos['qtd'].fontSize >= 10
    assert estilos['prioridade'].fontSize >= 8
    assert estilos['obs'].fontSize >= 8


def test_op_material_e_qtd_centralizados():
    from reportlab.lib.enums import TA_CENTER

    estilos = seq._estilos()

    assert estilos['op'].alignment == TA_CENTER
    assert estilos['material'].alignment == TA_CENTER
    assert estilos['qtd'].alignment == TA_CENTER


def test_coluna_prioridade_comporta_o_rotulo_mais_longo():
    from reportlab.pdfbase.pdfmetrics import stringWidth

    estilo = seq._estilos()['prioridade']
    largura_util = seq.LARGURAS_COLUNAS[4] - 8  # padding de 4pt de cada lado

    for valor in ['Pendencia Comercial', 'Exportacao', 'Linha Pesada', 'Tryout']:
        rotulo = seq.rotulo_prioridade(valor)
        assert stringWidth(rotulo, estilo.fontName, estilo.fontSize) <= largura_util


def test_coluna_seq_centralizada():
    from reportlab.lib.enums import TA_CENTER

    assert seq._estilos()['base'].alignment == TA_CENTER


def test_faixa_de_setor_e_prioridade_seguem_a_esquerda():
    from reportlab.lib.enums import TA_LEFT

    estilos = seq._estilos()

    assert estilos['setor'].alignment == TA_LEFT
    assert estilos['prioridade'].alignment == TA_LEFT
    assert estilos['obs'].alignment == TA_LEFT


def test_titulo_e_branco_sobre_a_faixa_de_topo():
    assert seq.COR_FAIXA_TOPO == seq.COR_BARRA_SETOR == '#1E293B'
    assert str(seq._estilos()['titulo'].textColor).upper() == '#FFFFFF'
    assert seq.ALTURA_FAIXA_TOPO >= seq.LARGURA_LOGO


def test_faixa_de_topo_cobre_a_largura_total_da_folha(tmp_path):
    from reportlab.lib.pagesizes import A4

    pagina = pypdf.PdfReader(gerar(tmp_path, [ordem()])).pages[0]
    conteudo = pagina.get_contents().get_data().decode('latin-1')

    # Retângulo preenchido em grafite (0.1176 0.1608 0.2314 = #1E293B).
    desenhado = re.search(r'0 ([\d.]+) ([\d.]+) ([\d.]+) re', conteudo)
    assert desenhado, 'faixa de topo não desenhada'

    inicio_y, largura, altura = (float(grupo) for grupo in desenhado.groups())
    assert abs(largura - A4[0]) < 0.1
    assert abs(altura - seq.ALTURA_FAIXA_TOPO) < 0.1
    assert abs(inicio_y - (A4[1] - seq.ALTURA_FAIXA_TOPO)) < 0.1
    assert '.117647 .160784 .231373 rg' in conteudo


def test_celula_nao_exibe_prioridade_nem_rotulo(tmp_path):
    ordens = [
        ordem(setor='Celula', numero_op='CEL1', prioridade='KS'),
        ordem(setor='Montagem', numero_op='MON1', prioridade='KS'),
    ]

    texto = texto_do_pdf(gerar(tmp_path, ordens))

    # Só a OP de Montagem recebe o rótulo; a de Célula fica com travessão.
    assert texto.count('[VERMELHA] KS') == 1
    assert '—' in texto


def test_celula_nao_usa_cor_de_destaque(tmp_path):
    assert seq.cor_fundo_prioridade('Celula', 'Exportacao') == seq.COR_FUNDO_BRANCA
    assert seq.cor_fundo_prioridade('Célula', 'KS') == seq.COR_FUNDO_BRANCA
    assert seq.cor_fundo_prioridade('Montagem', 'Exportacao') == seq.COR_FUNDO_VERMELHA
    assert seq.cor_fundo_prioridade('Montagem', 'Pendencia Comercial') == seq.COR_FUNDO_AMARELA


def test_celula_ainda_respeita_a_ordem_fifo_por_data(tmp_path):
    ordens = [
        ordem(setor='Celula', numero_op='NOVA', prioridade='MRP', data_abertura='2026-10-10'),
        ordem(setor='Celula', numero_op='VELHA', prioridade='KS', data_abertura='2026-01-01'),
    ]

    texto = texto_do_pdf(gerar(tmp_path, ordens))

    # A classificação continua valendo na ordenação, só não é exibida.
    assert texto.find('VELHA') < texto.find('NOVA')


def test_pdf_inclui_o_logo_da_schadek(tmp_path):
    assert os.path.exists(seq.LOGO_PADRAO)
    assert seq.LARGURA_LOGO == 100

    pagina = pypdf.PdfReader(gerar(tmp_path, [ordem()])).pages[0]

    assert '/XObject' in pagina['/Resources']


def test_pdf_sem_arquivo_de_logo_ainda_e_gerado(tmp_path, monkeypatch):
    monkeypatch.setattr(seq, 'LOGO_PADRAO', str(tmp_path / 'nao-existe.png'))

    caminho = gerar(tmp_path, [ordem()])

    assert 'SCHADEK' in texto_do_pdf(caminho)


def test_pdf_respeita_setores_selecionados(tmp_path):
    caminho = gerar(
        tmp_path,
        [ordem(setor='Montagem', numero_op='MON1'), ordem(setor='Usinagem', numero_op='USI1')],
        setores=['Usinagem'],
    )

    texto = texto_do_pdf(caminho)
    assert 'USI1' in texto
    assert 'MON1' not in texto


def test_pdf_quebra_de_pagina_apenas_quando_enche(tmp_path):
    ordens = [ordem(setor='Montagem', numero_op=str(100000 + i)) for i in range(120)]

    caminho = gerar(tmp_path, ordens, nome='longo.pdf')

    paginas = pypdf.PdfReader(caminho).pages
    assert len(paginas) > 1
    texto = '\n'.join(p.extract_text() or '' for p in paginas)
    assert '100000' in texto
    assert '100119' in texto


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

def test_main_le_json_do_stdin_e_imprime_o_caminho(tmp_path, capsys):
    codigo = seq.main([], stdin=io.StringIO(payload([ordem()])), diretorio=str(tmp_path))

    saida = capsys.readouterr().out.strip().splitlines()
    assert codigo == 0
    assert saida[-1].endswith('.pdf')
    assert os.path.exists(saida[-1])


def test_main_aceita_input_e_output_por_argumento(tmp_path, capsys):
    entrada = tmp_path / 'ordens.json'
    entrada.write_text(payload([ordem()]), encoding='utf-8')
    saida = str(tmp_path / 'sequenciamento.pdf')

    codigo = seq.main(['--input', str(entrada), '--output', saida], diretorio=str(tmp_path))

    assert codigo == 0
    assert capsys.readouterr().out.strip().splitlines()[-1] == saida
    assert os.path.exists(saida)


def test_main_sem_output_gera_arquivo_no_diretorio(tmp_path, capsys):
    codigo = seq.main([], stdin=io.StringIO(payload([ordem()])), diretorio=str(tmp_path))

    caminho = capsys.readouterr().out.strip().splitlines()[-1]
    assert codigo == 0
    assert os.path.dirname(caminho) == str(tmp_path)
    assert os.path.basename(caminho).startswith('sequenciamento_')


def test_main_falha_com_json_invalido(tmp_path, capsys):
    codigo = seq.main([], stdin=io.StringIO('nao-e-json'), diretorio=str(tmp_path))

    capturado = capsys.readouterr()
    assert codigo != 0
    assert capturado.err.strip() != ''
    assert capturado.out.strip() == ''


def test_main_falha_com_lista_de_ordens_vazia(tmp_path, capsys):
    codigo = seq.main([], stdin=io.StringIO(payload([])), diretorio=str(tmp_path))

    capturado = capsys.readouterr()
    assert codigo != 0
    assert 'nenhuma ordem' in capturado.err.lower()


def test_main_falha_quando_input_nao_existe(tmp_path, capsys):
    codigo = seq.main(['--input', str(tmp_path / 'nao-existe.json')], diretorio=str(tmp_path))

    assert codigo != 0
    assert capsys.readouterr().err.strip() != ''

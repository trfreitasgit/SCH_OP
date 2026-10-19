#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""Gera a Folha de Sequenciamento de Produção em PDF A4 (fluxo contínuo).

Entradas aceitas:

    python scripts/gerar_sequenciamento_pdf.py                     # JSON no stdin
    python scripts/gerar_sequenciamento_pdf.py --input ordens.json
    python scripts/gerar_sequenciamento_pdf.py --output saida.pdf

Contrato com o server.js: a ÚLTIMA linha do stdout é o caminho do PDF gerado.
Avisos e erros vão para o stderr (o servidor lê apenas a última linha do stdout).

Regras:
  * agrupa por setor na ordem de fábrica, em fluxo contínuo (sem quebra forçada);
  * dentro do setor: Vermelha > Amarela > Branca, FIFO por data de abertura;
  * Importada/Usinagem imprimem a observação do banco na coluna de visto.
"""

import argparse
import json
import os
import sys
import tempfile
import unicodedata
import uuid
from datetime import date, datetime, timezone
from pathlib import Path
from xml.sax.saxutils import escape
from zoneinfo import ZoneInfo

FUSO_FABRICA = 'America/Sao_Paulo'

# Ordem de impressão dos setores no chão de fábrica.
SETORES_ORDEM = ['Montagem', 'Subconjunto', 'BCM', 'Celula', 'Importada', 'Usinagem']

# Setores cujo detalhe técnico (observação) vai impresso na folha.
SETORES_COM_OBSERVACAO = ('Importada', 'Usinagem')

PRIORIDADES_VERMELHAS = ('EXPORTACAO', 'KS', 'MARELLI', 'MWM')
PRIORIDADES_AMARELAS = ('PENDENCIA COMERCIAL',)

RANK_PRIORIDADE = {'VERMELHA': 0, 'AMARELA': 1, 'BRANCA': 2}

PREENCHIMENTO_VISTO_OUTROS_SETORES = '[  ] ____________________'

# Cores do documento (mesma família visual da planilha executiva).
COR_BARRA_SETOR = '#1F3864'
COR_TEXTO_SETOR = '#FFFFFF'
COR_GRADE = '#B0B7C3'
COR_FUNDO_VERMELHA = '#FFE2E2'
COR_FUNDO_AMARELA = '#FFF3BF'
COR_FUNDO_BRANCA = '#FFFFFF'
COR_TEXTO_VERMELHA = '#B42318'

TITULO = 'SCHADEK — SEQUENCIAMENTO DE PRODUÇÃO'

# A4 retrato, margens de 30pt (~1,06 cm).
MARGEM_LATERAL = 30
MARGEM_SUPERIOR = 28
MARGEM_INFERIOR = 30

CABECALHOS_TABELA = [
    'Seq',
    'Nº OP',
    'Material',
    'Qtd Peças',
    'Prioridade',
    'Obs / Visto do Operador',
]

# Larguras somam a área útil do A4 (595,28 - 2 * 30 = 535,28pt).
LARGURAS_COLUNAS = [26.0, 66.0, 72.0, 55.0, 110.0, 206.28]

RAIZ = Path(__file__).resolve().parents[1]


# ---------------------------------------------------------------------------
# Normalização e prioridade
# ---------------------------------------------------------------------------

def normalizar_texto(valor):
    """Chave de comparação: sem acentos, sem espaços extras, caixa alta."""
    if valor is None:
        return ''
    texto = unicodedata.normalize('NFKD', str(valor))
    texto = ''.join(caractere for caractere in texto if not unicodedata.combining(caractere))
    return texto.strip().upper()


def classificar_prioridade(valor):
    """Classifica a prioridade na lista Vermelha, Amarela ou Branca."""
    chave = normalizar_texto(valor)
    if chave in PRIORIDADES_VERMELHAS:
        return 'VERMELHA'
    if chave in PRIORIDADES_AMARELAS:
        return 'AMARELA'
    return 'BRANCA'


def rotulo_prioridade(valor):
    """Rótulo exibido na coluna Prioridade."""
    lista = classificar_prioridade(valor)
    if lista == 'VERMELHA':
        return '[VERMELHA - %s]' % str(valor).strip()
    return '[%s]' % lista


def formatar_milhar(valor):
    """Inteiro com separador de milhar brasileiro ('4.800')."""
    try:
        numero = int(valor)
    except (TypeError, ValueError):
        numero = 0
    return '{:,}'.format(numero).replace(',', '.')


# ---------------------------------------------------------------------------
# Entrada
# ---------------------------------------------------------------------------

def ler_entrada(texto):
    """Valida o payload JSON e devolve (setores_selecionados, ordens).

    `setores_selecionados` é None quando o campo não foi informado (todos).
    """
    if texto is None or str(texto).strip() == '':
        raise ValueError('nenhuma ordem recebida no stdin')

    try:
        payload = json.loads(texto)
    except (TypeError, ValueError) as erro:
        raise ValueError('payload não é um JSON válido: %s' % erro) from erro

    if not isinstance(payload, dict):
        raise ValueError('o payload deve ser um objeto JSON')

    ordens = payload.get('ordens')
    if not isinstance(ordens, list):
        raise ValueError('o payload precisa trazer a lista "ordens"')

    ordens = [registro for registro in ordens if isinstance(registro, dict)]
    if not ordens:
        raise ValueError('nenhuma ordem para imprimir')

    setores = payload.get('setores_selecionados')
    if setores is None:
        return None, ordens
    if not isinstance(setores, list):
        raise ValueError('"setores_selecionados" precisa ser uma lista')

    selecionados = [str(setor).strip() for setor in setores if str(setor).strip()]
    return (selecionados or None), ordens


# ---------------------------------------------------------------------------
# Agrupamento e ordenação
# ---------------------------------------------------------------------------

def _data_abertura(valor):
    """Converte a data de abertura em date; None quando ausente/inválida."""
    if valor is None or valor == '':
        return None
    if isinstance(valor, datetime):
        return valor.date()
    if isinstance(valor, date):
        return valor

    texto = str(valor).strip()
    if texto == '':
        return None

    try:
        return date.fromisoformat(texto[:10])
    except ValueError:
        pass

    for formato in ('%d/%m/%Y', '%d-%m-%Y'):
        try:
            return datetime.strptime(texto, formato).date()
        except ValueError:
            continue

    try:
        return datetime.fromisoformat(texto.replace('Z', '+00:00')).date()
    except ValueError:
        return None


def _chave_ordenacao(registro):
    """Vermelha > Amarela > Branca; depois FIFO; data nula no fim do bloco."""
    data_abertura = _data_abertura(registro.get('data_abertura'))
    return (
        RANK_PRIORIDADE[classificar_prioridade(registro.get('prioridade'))],
        1 if data_abertura is None else 0,
        data_abertura or date.min,
    )


def agrupar_ordens(ordens, setores_selecionados=None):
    """Agrupa e ordena as ordens por setor.

    Retorna [('Montagem', [ordem, ...]), ...] na ordem de SETORES_ORDEM.
    Setores desconhecidos vão ao final, na ordem em que apareceram.
    """
    selecionados = {normalizar_texto(setor) for setor in (setores_selecionados or [])}

    grupos = {}
    for registro in ordens:
        if not isinstance(registro, dict):
            continue
        setor = str(registro.get('setor') or '').strip()
        if setor == '':
            continue
        if selecionados and normalizar_texto(setor) not in selecionados:
            continue
        grupos.setdefault(setor, []).append(registro)

    def posicao(nome):
        chave = normalizar_texto(nome)
        for indice, conhecido in enumerate(SETORES_ORDEM):
            if normalizar_texto(conhecido) == chave:
                return indice
        return len(SETORES_ORDEM)

    nomes = sorted(grupos, key=posicao)  # sort estável: desconhecidos mantêm a aparição
    return [(nome, sorted(grupos[nome], key=_chave_ordenacao)) for nome in nomes]


def cabecalho_setor(setor, ordens):
    """Faixa do setor: 'MONTAGEM — 6 OPs | Total: 4.800 peças'."""
    quantidade = len(ordens)
    total = sum(int(registro.get('total_pecas') or 0) for registro in ordens)
    return '%s — %d %s | Total: %s peças' % (
        str(setor).upper(),
        quantidade,
        'OP' if quantidade == 1 else 'OPs',
        formatar_milhar(total),
    )


# ---------------------------------------------------------------------------
# PDF
# ---------------------------------------------------------------------------

def agora_fabrica():
    """Data/hora da emissão no fuso da fábrica."""
    return datetime.now(ZoneInfo(FUSO_FABRICA))


def _texto_observacao(registro):
    """Coluna de visto: observação do banco (Importada/Usinagem) ou pauta."""
    setor = normalizar_texto(registro.get('setor'))
    if setor in {normalizar_texto(nome) for nome in SETORES_COM_OBSERVACAO}:
        detalhe = str(registro.get('observacao') or '').strip()
        return ('%s [  ]' % escape(detalhe)).strip() if detalhe else '[  ]'
    return PREENCHIMENTO_VISTO_OUTROS_SETORES


def _estilos():
    """Estilos de parágrafo usados nas células e nos cabeçalhos."""
    from reportlab.lib.styles import ParagraphStyle
    from reportlab.lib.enums import TA_LEFT, TA_RIGHT, TA_CENTER

    base = ParagraphStyle('base', fontName='Helvetica', fontSize=8, leading=10)
    return {
        'base': base,
        'titulo': ParagraphStyle('titulo', parent=base, fontName='Helvetica-Bold',
                                 fontSize=15, leading=18, alignment=TA_CENTER),
        'emissao': ParagraphStyle('emissao', parent=base, fontSize=8, leading=10,
                                  alignment=TA_CENTER, textColor='#4B5563'),
        'setor': ParagraphStyle('setor', parent=base, fontName='Helvetica-Bold',
                                fontSize=10, leading=12, textColor=COR_TEXTO_SETOR),
        'header': ParagraphStyle('header', parent=base, fontName='Helvetica-Bold',
                                 fontSize=8, leading=10, alignment=TA_CENTER),
        'op': ParagraphStyle('op', parent=base, fontName='Helvetica-Bold',
                             fontSize=10, leading=12),
        'qtd': ParagraphStyle('qtd', parent=base, fontSize=9, leading=11,
                              alignment=TA_RIGHT),
        'prioridade': ParagraphStyle('prioridade', parent=base, fontSize=7.5, leading=9),
        'obs': ParagraphStyle('obs', parent=base, fontSize=7, leading=9, alignment=TA_LEFT),
    }


def _linha_tabela(indice, registro, estilos):
    """Células (flowables/texto) de uma linha da tabela."""
    from reportlab.platypus import Paragraph

    prioridade = registro.get('prioridade')
    lista = classificar_prioridade(prioridade)
    cor_prioridade = {'VERMELHA': COR_TEXTO_VERMELHA}.get(lista, '#111827')

    return [
        Paragraph('%dº' % indice, estilos['base']),
        Paragraph(escape(str(registro.get('numero_op') or '')), estilos['op']),
        Paragraph(escape(str(registro.get('material') or '').strip()), estilos['base']),
        Paragraph(escape(formatar_milhar(registro.get('total_pecas'))), estilos['qtd']),
        Paragraph(
            '<font color="%s">%s</font>' % (cor_prioridade, escape(rotulo_prioridade(prioridade))),
            estilos['prioridade'],
        ),
        Paragraph(_texto_observacao(registro), estilos['obs']),
    ]


def _estilo_tabela(quantidade_linhas):
    """Grade fina, cabeçalho azul e faixas de fundo por prioridade."""
    from reportlab.lib import colors
    from reportlab.platypus import TableStyle

    regras = [
        ('BACKGROUND', (0, 0), (-1, 0), colors.HexColor(COR_BARRA_SETOR)),
        ('TEXTCOLOR', (0, 0), (-1, 0), colors.white),
        ('GRID', (0, 0), (-1, -1), 0.4, colors.HexColor(COR_GRADE)),
        ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'),
        ('TOPPADDING', (0, 0), (-1, -1), 3),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 3),
        ('LEFTPADDING', (0, 0), (-1, -1), 4),
        ('RIGHTPADDING', (0, 0), (-1, -1), 4),
    ]
    return TableStyle(regras)


def _cor_fundo(lista_prioridade):
    return {
        'VERMELHA': COR_FUNDO_VERMELHA,
        'AMARELA': COR_FUNDO_AMARELA,
        'BRANCA': COR_FUNDO_BRANCA,
    }[lista_prioridade]


def _tabela_setor(ordens, estilos):
    """Tabela de um setor; pode quebrar entre páginas naturalmente."""
    from reportlab.lib import colors
    from reportlab.platypus import LongTable, Paragraph

    cabecalho = [Paragraph(texto, estilos['header']) for texto in CABECALHOS_TABELA]
    linhas = [cabecalho]
    for indice, registro in enumerate(ordens, start=1):
        linhas.append(_linha_tabela(indice, registro, estilos))

    tabela = LongTable(linhas, colWidths=LARGURAS_COLUNAS, repeatRows=1, splitByRow=1)
    estilo = _estilo_tabela(len(linhas))
    for indice, registro in enumerate(ordens, start=1):
        estilo.add('BACKGROUND', (0, indice), (-1, indice),
                   colors.HexColor(_cor_fundo(classificar_prioridade(registro.get('prioridade')))))
    tabela.setStyle(estilo)
    return tabela


def _barra_setor(texto, estilos, largura_total):
    """Faixa destacada que abre o setor."""
    from reportlab.lib import colors
    from reportlab.platypus import Paragraph, Table, TableStyle

    barra = Table([[Paragraph(escape(texto), estilos['setor'])]], colWidths=[largura_total])
    barra.setStyle(TableStyle([
        ('BACKGROUND', (0, 0), (-1, -1), colors.HexColor(COR_BARRA_SETOR)),
        ('LEFTPADDING', (0, 0), (-1, -1), 6),
        ('TOPPADDING', (0, 0), (-1, -1), 5),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 5),
    ]))
    return barra


def _rodape(canvas, documento):
    """Rodapé discreto com numeração de páginas."""
    from reportlab.lib.pagesizes import A4

    canvas.saveState()
    canvas.setFont('Helvetica', 7)
    canvas.setFillColorRGB(0.42, 0.45, 0.50)
    canvas.drawString(MARGEM_LATERAL, 15, 'Schadek — Sequenciamento de Produção')
    canvas.drawRightString(A4[0] - MARGEM_LATERAL, 15, 'Página %d' % documento.page)
    canvas.restoreState()


def gerar_pdf(ordens, destino, setores_selecionados=None):
    """Gera o PDF em `destino` e retorna o caminho."""
    from reportlab.lib import colors
    from reportlab.lib.pagesizes import A4
    from reportlab.platypus import Paragraph, SimpleDocTemplate, Spacer

    grupos = agrupar_ordens(ordens, setores_selecionados)
    if not grupos:
        raise ValueError('nenhuma ordem para imprimir')

    estilos = _estilos()
    emitido_em = agora_fabrica().strftime('%d/%m/%Y %H:%M')

    historia = [
        Paragraph(TITULO, estilos['titulo']),
        Paragraph('Emitido em %s · %s' % (emitido_em, FUSO_FABRICA), estilos['emissao']),
        Spacer(1, 10),
    ]

    largura_total = A4[0] - 2 * MARGEM_LATERAL
    for setor, ordens_setor in grupos:
        historia.append(_barra_setor(cabecalho_setor(setor, ordens_setor), estilos, largura_total))
        historia.append(_tabela_setor(ordens_setor, estilos))
        historia.append(Spacer(1, 10))

    documento = SimpleDocTemplate(
        destino,
        pagesize=A4,
        leftMargin=MARGEM_LATERAL,
        rightMargin=MARGEM_LATERAL,
        topMargin=MARGEM_SUPERIOR,
        bottomMargin=MARGEM_INFERIOR,
        title='Sequenciamento de Produção',
        author='Schadek',
    )
    documento.build(historia, onFirstPage=_rodape, onLaterPages=_rodape)
    return destino


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

def _ler_stdin(stdin):
    if stdin is None:
        stdin = sys.stdin
    if stdin is None:
        return ''
    if hasattr(stdin, 'read'):
        return stdin.read()
    return str(stdin)


def main(argv=None, diretorio=None, stdin=None):
    parser = argparse.ArgumentParser(
        description='Gera a Folha de Sequenciamento de Produção em PDF A4.'
    )
    parser.add_argument('--input', help='arquivo JSON de entrada (sem ele, lê o stdin)')
    parser.add_argument('--output', help='caminho do PDF gerado (padrão: temporário)')

    try:
        argumentos = parser.parse_args(argv)
    except SystemExit as saida:  # argparse já escreveu o uso no stderr
        return int(saida.code or 2)

    try:
        if argumentos.input:
            texto = Path(argumentos.input).read_text(encoding='utf-8')
        else:
            texto = _ler_stdin(stdin)

        setores, ordens = ler_entrada(texto)

        destino = argumentos.output or os.path.join(
            diretorio or tempfile.gettempdir(),
            'sequenciamento_%s.pdf' % uuid.uuid4().hex[:12],
        )
        gerar_pdf(ordens, destino, setores_selecionados=setores)
    except Exception as erro:  # noqa: BLE001 - qualquer falha vira erro de geração
        print('Erro ao gerar o sequenciamento: %s' % erro, file=sys.stderr)
        return 1

    print(destino)
    return 0


if __name__ == '__main__':
    # O server.js lê o stdout como UTF-8; garante o mesmo encoding no Windows.
    for fluxo in (sys.stdout, sys.stderr, sys.stdin):
        try:
            fluxo.reconfigure(encoding='utf-8')
        except (AttributeError, ValueError):
            pass
    sys.exit(main())

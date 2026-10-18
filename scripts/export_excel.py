#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""Gera a planilha executiva (.xlsx) das ordens de produção selecionadas.

Chamado pelo server.js (POST /ordens/export) assim:

    python scripts/export_excel.py --ids "1,2,3"

Contrato: a ULTIMA linha do stdout precisa ser o caminho do arquivo .xlsx
gerado. Tudo que for aviso/erro vai para o stderr, porque o servidor lê apenas
a última linha do stdout para achar o arquivo e depois o remove.
"""

import argparse
import os
import re
import sys
import tempfile
import uuid
from datetime import date, datetime
from functools import lru_cache
from pathlib import Path
from zoneinfo import ZoneInfo

import pandas as pd
from dotenv import load_dotenv
from openpyxl import Workbook
from openpyxl.styles import Alignment, Border, Font, PatternFill, Side
from openpyxl.utils import get_column_letter

TABELA = 'ordens_producao'

# Ordem das colunas na planilha: (campo no banco, rótulo exibido).
# 'turno' não existe no banco: é derivado de dia_analise (ver classificar_turno).
COLUNAS = [
    ('numero_op', 'OP'),
    ('total_pecas', 'Peças'),
    ('data_abertura', 'Data Abertura'),
    ('material', 'Material'),
    ('situacao', 'Situação'),
    ('observacao', 'Observação'),
    ('setor', 'Setor'),
    ('prioridade', 'Prioridade'),
    ('dia_analise', 'Dia Análise'),
    ('turno', 'Turno'),
]

CAMPOS_DATA = ('data_abertura', 'dia_analise')
CAMPOS_NUMERICOS = ('total_pecas',)

# Turnos do pagamento, fonte da verdade no server.js (classificarTurno):
#   T1: 05:20 - 13:39 | T2: 13:40 - 21:59 | T3: 22:00 - 05:19 (cruza a meia-noite)
FUSO_FABRICA = 'America/Sao_Paulo'
TURNO_T1_INICIO = 5 * 60 + 20   # 05:20
TURNO_T2_INICIO = 13 * 60 + 40  # 13:40
TURNO_T3_INICIO = 22 * 60       # 22:00

FORMATO_DATA_EXIBICAO = '%d/%m/%Y'

LARGURA_MAXIMA_COLUNA = 60
PADDING_LARGURA = 2

COR_HEADER = 'FF1F3864'  # azul escuro (ARGB, igual ao usado no dashboard)
COR_TEXTO_HEADER = 'FFFFFFFF'
BORDA_FINA = Side(style='thin', color='FFB0B7C3')

RAIZ = Path(__file__).resolve().parents[1]


# ---------------------------------------------------------------------------
# Entrada / conexão
# ---------------------------------------------------------------------------

def carregar_env():
    """Carrega o .env da raiz do projeto (mesmo arquivo usado pelo server.js)."""
    load_dotenv(RAIZ / '.env', override=False)


def parse_ids(texto):
    """Converte "1,2,3" em [1, 2, 3] (sem repetidos, na ordem de entrada)."""
    if texto is None:
        raise ValueError('o argumento --ids é obrigatório')

    ids = []
    for parte in str(texto).split(','):
        bruto = parte.strip()
        if bruto == '':
            raise ValueError('a lista de IDs contém um valor vazio')
        if not bruto.isdigit() or int(bruto) <= 0:
            raise ValueError('ID inválido: "%s" (só inteiros positivos)' % bruto)
        numero = int(bruto)
        if numero not in ids:
            ids.append(numero)

    if not ids:
        raise ValueError('nenhum ID informado em --ids')

    return ids


def criar_cliente():
    """Cria o cliente Supabase a partir das variáveis de ambiente."""
    from supabase import create_client

    url = os.getenv('SUPABASE_URL_ORDENS') or os.getenv('SUPABASE_URL')
    chave = os.getenv('SUPABASE_SERVICE_ROLE_KEY_ORDENS') or os.getenv('SUPABASE_SERVICE_ROLE_KEY')

    if not url or not chave:
        raise RuntimeError(
            'SUPABASE_URL_ORDENS e SUPABASE_SERVICE_ROLE_KEY_ORDENS precisam estar definidas.'
        )

    return create_client(url, chave)


def buscar_ordens(cliente, ids):
    """Busca os registros completos dos IDs informados."""
    if not ids:
        return []

    resposta = cliente.table(TABELA).select('*').in_('id', list(ids)).execute()
    return list(resposta.data or [])


def ids_disponiveis(cliente, limite=1):
    """Alguns IDs existentes na tabela (usado pelos testes de integração)."""
    resposta = cliente.table(TABELA).select('id').order('id').limit(limite).execute()
    return [int(linha['id']) for linha in (resposta.data or [])]


# ---------------------------------------------------------------------------
# Transformação dos dados
# ---------------------------------------------------------------------------

@lru_cache(maxsize=1)
def _fuso_fabrica():
    """Fuso da fábrica (America/Sao_Paulo)."""
    try:
        return ZoneInfo(FUSO_FABRICA)
    except Exception as erro:  # noqa: BLE001 - sem base tz o script não tem como classificar turno
        raise RuntimeError(
            'Não foi possível carregar o fuso %s (instale o pacote "tzdata").' % FUSO_FABRICA
        ) from erro


def _parse_data_texto(texto):
    """Converte o texto vindo do PostgREST em datetime (ingênuo quando não houver fuso)."""
    if re.fullmatch(r'\d{4}-\d{2}-\d{2}', texto):
        # Data pura: vale como meia-noite no fuso da fábrica, sem conversão.
        return datetime.strptime(texto, '%Y-%m-%d')

    try:
        return datetime.fromisoformat(texto.replace('Z', '+00:00'))
    except ValueError:
        pass

    for formato in ('%d-%m-%Y', '%d/%m/%Y'):
        try:
            return datetime.strptime(texto, formato)
        except ValueError:
            continue

    raise ValueError('não é uma data válida: "%s"' % texto)


def instante_fabrica(valor):
    """Instante de `valor` no fuso da fábrica.

    Datas/horas sem fuso são tratadas como horário local da fábrica. Levanta
    ValueError quando o valor não for uma data/hora reconhecível.
    """
    if valor is None:
        raise ValueError('sem data')
    if isinstance(valor, datetime):
        instante = valor
    elif isinstance(valor, date):
        instante = datetime(valor.year, valor.month, valor.day)
    else:
        texto = str(valor).strip()
        if texto == '':
            raise ValueError('data vazia')
        instante = _parse_data_texto(texto)

    if instante.tzinfo is None:
        instante = instante.replace(tzinfo=_fuso_fabrica())

    return instante.astimezone(_fuso_fabrica())


def classificar_turno(valor):
    """Turno do pagamento derivado do instante: 'T1', 'T2', 'T3' ou None."""
    try:
        instante = instante_fabrica(valor)
    except ValueError:
        return None

    minutos = instante.hour * 60 + instante.minute
    if TURNO_T1_INICIO <= minutos < TURNO_T2_INICIO:
        return 'T1'
    if TURNO_T2_INICIO <= minutos < TURNO_T3_INICIO:
        return 'T2'
    return 'T3'  # 22:00 - 05:19, incluindo a virada do dia


def formatar_data(valor):
    """Data no formato 'dd/mm/aaaa', sempre no dia da fábrica. Vazio se não houver data."""
    try:
        return instante_fabrica(valor).strftime(FORMATO_DATA_EXIBICAO)
    except ValueError:
        # Valor estranho no banco: mostra cru em vez de apagar a informação.
        return '' if valor is None else str(valor).strip()


def formatar_valor(campo, valor):
    """Normaliza um campo do banco para o valor que vai para a célula."""
    if campo in CAMPOS_DATA:
        return formatar_data(valor)
    if valor is None:
        return ''
    if campo in CAMPOS_NUMERICOS:
        return int(valor)
    return str(valor).strip()


def valor_coluna(campo, registro):
    """Valor de uma coluna da planilha para um registro do banco."""
    if campo == 'turno':
        # Coluna derivada: não vem do banco, é calculada a partir de dia_analise.
        return classificar_turno(registro.get('dia_analise')) or ''
    return formatar_valor(campo, registro.get(campo))


def montar_dataframe(registros, ids):
    """Monta o DataFrame na ordem dos IDs recebidos.

    Retorna (dataframe, ids_que_nao_existem_no_banco).
    """
    por_id = {}
    for linha in registros:
        try:
            por_id[int(linha['id'])] = linha
        except (KeyError, TypeError, ValueError):
            continue

    linhas = []
    faltantes = []
    for identificador in ids:
        registro = por_id.get(identificador)
        if registro is None:
            faltantes.append(identificador)
            continue
        linhas.append({
            rotulo: valor_coluna(campo, registro)
            for campo, rotulo in COLUNAS
        })

    return pd.DataFrame(linhas, columns=[rotulo for _, rotulo in COLUNAS]), faltantes


# ---------------------------------------------------------------------------
# Estilização e gravação
# ---------------------------------------------------------------------------

def escrever_planilha(dataframe, destino):
    """Grava o .xlsx estilizado em `destino` e retorna o caminho."""
    planilha = Workbook()
    aba = planilha.active
    aba.title = 'Ordens'

    aba.append([rotulo for _, rotulo in COLUNAS])
    for _, linha in dataframe.iterrows():
        aba.append([
            linha[rotulo] if linha[rotulo] != '' else None
            for _, rotulo in COLUNAS
        ])

    ultima_linha = max(aba.max_row, 1)
    ultima_coluna = get_column_letter(len(COLUNAS))

    _estilizar_header(aba)
    aba.auto_filter.ref = 'A1:%s%d' % (ultima_coluna, ultima_linha)
    aba.freeze_panes = 'A2'
    _aplicar_bordas(aba, ultima_linha)
    _ajustar_larguras(aba, dataframe)

    planilha.save(destino)
    return destino


def _estilizar_header(aba):
    """Fundo azul escuro, texto branco, negrito e centralizado na linha 1."""
    for celula in aba[1]:
        celula.fill = PatternFill(fill_type='solid', fgColor=COR_HEADER)
        celula.font = Font(bold=True, color=COR_TEXTO_HEADER)
        celula.alignment = Alignment(horizontal='center', vertical='center')
    aba.row_dimensions[1].height = 22


def _aplicar_bordas(aba, ultima_linha):
    """Borda fina em todas as células preenchidas (header + dados)."""
    borda = Border(left=BORDA_FINA, right=BORDA_FINA, top=BORDA_FINA, bottom=BORDA_FINA)
    for linha in aba.iter_rows(min_row=1, max_row=ultima_linha, max_col=len(COLUNAS)):
        for celula in linha:
            celula.border = borda


def _ajustar_larguras(aba, dataframe):
    """Auto-fit: largura pelo maior conteúdo da coluna, com um teto."""
    for indice, (_, rotulo) in enumerate(COLUNAS, start=1):
        valores = [rotulo]
        if rotulo in dataframe.columns:
            valores += [str(valor).strip() for valor in dataframe[rotulo].tolist() if valor != '']
        maior = max(len(valor) for valor in valores)
        aba.column_dimensions[get_column_letter(indice)].width = min(
            LARGURA_MAXIMA_COLUNA, maior + PADDING_LARGURA
        )


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

def main(argv=None, cliente=None, diretorio=None):
    parser = argparse.ArgumentParser(
        description='Gera a planilha executiva (.xlsx) das ordens de produção.'
    )
    parser.add_argument('--ids', required=True, help='IDs separados por vírgula. Ex.: "1,2,3"')

    try:
        argumentos = parser.parse_args(argv)
    except SystemExit as saida:  # argparse já escreveu o uso no stderr
        return int(saida.code or 2)

    try:
        ids = parse_ids(argumentos.ids)
    except ValueError as erro:
        print('Erro: %s' % erro, file=sys.stderr)
        return 1

    try:
        carregar_env()
        cliente = cliente or criar_cliente()
        registros = buscar_ordens(cliente, ids)
        dataframe, faltantes = montar_dataframe(registros, ids)

        if faltantes:
            print(
                'Aviso: %d ID(s) não encontrado(s) e ignorado(s): %s'
                % (len(faltantes), ', '.join(str(i) for i in faltantes)),
                file=sys.stderr,
            )

        destino = os.path.join(
            diretorio or tempfile.gettempdir(),
            'ordens_export_%s.xlsx' % uuid.uuid4().hex[:12],
        )
        escrever_planilha(dataframe, destino)
    except Exception as erro:  # noqa: BLE001 - qualquer falha vira erro de exportação
        print('Erro na exportação da planilha: %s' % erro, file=sys.stderr)
        return 1

    print(destino)
    return 0


if __name__ == '__main__':
    # O server.js lê o stdout como UTF-8; garante o mesmo encoding no Windows.
    try:
        sys.stdout.reconfigure(encoding='utf-8')
        sys.stderr.reconfigure(encoding='utf-8')
    except (AttributeError, ValueError):
        pass
    sys.exit(main())

#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""Importa as prioridades do PCP (e-mail em TSV) para a tabela ordens_producao.

Uso:

    python scripts/importar_prioridades_pcp.py                     # TSV no stdin (dry-run)
    python scripts/importar_prioridades_pcp.py --input pcp.tsv      # arquivo (dry-run)
    python scripts/importar_prioridades_pcp.py --apply              # grava no Supabase
    python scripts/importar_prioridades_pcp.py --debug              # mostra cada linha no stderr

Regras:
  * 'Ordem' vira numero_op e 'Prioridade' é traduzida para o nome do sistema
    ('02 - Exportação' -> 'Exportacao', '06 - Pend. Comercial' ->
    'Pendencia Comercial') junto do peso usado pelo server.js;
  * o setor pode vir no e-mail (coluna Setor ou título de bloco); quando não
    vem — o caso do TSV real do PCP — é inferido no banco pela numero_op,
    inclusive quando o e-mail mistura OPs de BCM e Importada;
  * o texto pode vir tabulado (TSV) ou colado como texto puro: localizamos a
    OP (6-7 dígitos, com preferência para 7 — 6 pode ser Lote; material de 8
    dígitos é ignorado) e uma prioridade conhecida na própria linha;
  * prioridade sozinha na linha vira a prioridade ativa ("sticky") de todas as
    OPs abaixo, até surgir outra prioridade (colagem vertical do Excel);
  * linhas sem dados válidos são ignoradas;
  * números soltos de 6 dígitos que não existem no banco são tratados como
    Lote do material acabado e listados como "lotes ignorados" (não entram
    como OP ausente); se existirem no banco, continuam sendo OPs;
  * cada setor detectado (no e-mail ou no banco) é zerado antes da carga
    (prioridade e peso_prioridade = NULL);
  * só as OPs existentes no banco recebem a nova prioridade; as demais entram
    no relatório como ausentes (não inserimos OP sem os dados obrigatórios);
  * o modo padrão é dry-run. Só grava com --apply.

O relatório é impresso no stdout e, opcionalmente, salvo com --report <arquivo>.
"""

import argparse
import os
import re
import sys
import unicodedata
from pathlib import Path

TABELA = 'ordens_producao'
LOTE_CONSULTA = 100
RAIZ = Path(__file__).resolve().parents[1]

SETORES_VALIDOS = ['Montagem', 'Subconjunto', 'Celula', 'BCM', 'Importada', 'Usinagem']

# Mesmos pesos do server.js (fonte da verdade da interface).
PESOS = {
    'Exportacao': 2,
    'MWM': 3,
    'KS': 4,
    'Marelli': 5,
    'Pendencia Comercial': 6,
    'Linha Pesada': 7,
    'MRP': 8,
    'Tryout': 9,
}

# Chave normalizada (sem acento, caixa alta) -> (nome no banco, peso).
PRIORIDADES = {
    'EXPORTACAO': ('Exportacao', 2),
    'MWM': ('MWM', 3),
    'KS': ('KS', 4),
    'MARELLI': ('Marelli', 5),
    'PENDENCIA COMERCIAL': ('Pendencia Comercial', 6),
    'PENDENCIA COMER.': ('Pendencia Comercial', 6),
    'PENDENCIA COMERC': ('Pendencia Comercial', 6),
    'PEND. COMERCIAL': ('Pendencia Comercial', 6),
    'PEND.COMERCIAL': ('Pendencia Comercial', 6),
    'PEND COMERCIAL': ('Pendencia Comercial', 6),
    'PEND. COMERC.': ('Pendencia Comercial', 6),
    'PEND COMERC': ('Pendencia Comercial', 6),
    'PEND. COMER.': ('Pendencia Comercial', 6),
    'LINHA PESADA': ('Linha Pesada', 7),
    'MRP': ('MRP', 8),
    'TRYOUT': ('Tryout', 9),
}

ROTULOS_SEM_PRIORIDADE = {'', '-', '--', 'SEM PRIORIDADE', 'NENHUMA', 'NADA', '0'}

COLUNAS_CONHECIDAS = {
    'SETOR': 'setor',
    'ORDEM': 'numero_op',
    'OP': 'numero_op',
    'NO OP': 'numero_op',
    'N OP': 'numero_op',
    'PRIORIDADE': 'prioridade',
}

PREFIXO_NUMERICO = re.compile(r'^\s*\d+\s*[-–—.)]*\s*')

# OP: 6-7 dígitos, aceitando separador de milhar (1.132.972) e espaços
# (1 132 972) típicos de colagem do Excel/e-mail.
OP_CONTIGUO = re.compile(r'(?<!\d)(\d{6,7})(?!\d)')
OP_COM_SEPARADOR = re.compile(r'(?<![\d.])(\d{1,3}(?:[.\-/]\d{3})+)(?![\d.])')
OP_COM_ESPACO = re.compile(r'(?<!\d)(\d{1,2}[ \u00a0]\d{3}[ \u00a0]\d{3})(?!\d)')


def _compilar_prioridades():
    """Regex de prioridade tolerante a pontuação/espaços entre as palavras.

    'PEND. COMERCIAL', 'PEND - COMERCIAL' e 'PEND.COMERCIAL' caem no mesmo
    padrão; 'TKS' não casa com 'KS' por causa das fronteiras.
    """
    padroes = {}
    for chave, (nome, peso) in PRIORIDADES.items():
        partes = [re.escape(parte) for parte in re.findall(r'[A-Z0-9]+', chave)]
        if not partes:
            continue
        regex = r'(?<![A-Z0-9])' + r'[^A-Z0-9]{0,4}'.join(partes) + r'(?![A-Z0-9])'
        padroes.setdefault(regex, (nome, peso))
    return [(re.compile(regex), nome, peso) for regex, (nome, peso) in padroes.items()]


_PADROES_PRIORIDADE = _compilar_prioridades()


def _achar_prioridade(texto):
    """Acha a prioridade no texto normalizado.

    Retorna (nome, peso, inicio, fim) ou None. Se aparecer mais de uma, vence
    a que começa antes (empate: a maior).
    """
    melhor = None
    for padrao, nome, peso in _PADROES_PRIORIDADE:
        achado = padrao.search(texto)
        if achado is None:
            continue
        chave = (achado.start(), -len(achado.group()))
        if melhor is None or chave < melhor[0]:
            melhor = (chave, nome, peso, achado)
    if melhor is None:
        return None
    _, nome, peso, achado = melhor
    return nome, peso, achado.start(), achado.end()


def _candidato_op(texto):
    """Primeiro número de 6-7 dígitos, tolerando '.', '-' e espaços."""
    candidatos = []
    for padrao in (OP_CONTIGUO, OP_COM_SEPARADOR, OP_COM_ESPACO):
        for achado in padrao.finditer(texto):
            digitos = re.sub(r'\D', '', achado.group(1))
            if re.fullmatch(r'\d{6,7}', digitos):
                candidatos.append((achado.start(), -len(achado.group()), digitos,
                                   achado.start(), achado.end()))
    if not candidatos:
        return None
    # 7 dígitos têm preferência (6 pode ser Lote); empate pela posição.
    candidatos.sort(key=lambda item: (len(item[2]) != 7, item[0]))
    _, _, digitos, inicio, fim = candidatos[0]
    return digitos, inicio, fim


def _origem_op(digitos):
    """Como a OP foi achada: 7 dígitos são fortes; 6 podem ser Lote."""
    return 'texto_7' if len(digitos) == 7 else 'texto_6'


def _op_da_celula(valor):
    """numero_op de uma célula: '1.132.972' -> '1132972'; inválido -> None."""
    digitos = re.sub(r'\D', '', str(valor or ''))
    if re.fullmatch(r'\d{6,7}', digitos):
        return digitos
    return None


def normalizar(valor):
    """Chave de comparação: sem acentos, sem espaços extras, caixa alta."""
    if valor is None:
        return ''
    texto = str(valor)
    # Espaços especiais e caracteres invisíveis comuns em e-mail/Excel.
    for invisivel in ('\u00a0', '\u200b', '\u200c', '\u200d', '\ufeff'):
        texto = texto.replace(invisivel, ' ')
    texto = unicodedata.normalize('NFKD', texto)
    texto = ''.join(caractere for caractere in texto if not unicodedata.combining(caractere))
    return ' '.join(texto.split()).upper()


def canonicalizar_setor(valor):
    """Nome do setor como está no banco ('CÉLULA' -> 'Celula'), ou None."""
    chave = normalizar(valor)
    for nome in SETORES_VALIDOS:
        if normalizar(nome) == chave:
            return nome
    return None


def mapear_prioridade(valor):
    """Traduz a prioridade do e-mail em (nome_no_banco, peso).

    Retorna (None, None) para prioridade vazia/'sem prioridade' e None quando o
    valor é desconhecido (linha vai para o relatório).
    """
    if valor is None:
        return None

    texto = str(valor).strip()
    if normalizar(texto) in ROTULOS_SEM_PRIORIDADE:
        return None, None

    sem_prefixo = PREFIXO_NUMERICO.sub('', texto).strip()
    chave = normalizar(sem_prefixo)
    conhecida = PRIORIDADES.get(chave)
    if conhecida is not None:
        return conhecida

    # Tolera pontuação/espaços entre as palavras ('PEND - COMERCIAL').
    achada = _achar_prioridade(normalizar(texto))
    if achada is not None:
        return achada[0], achada[1]
    return None


def _mapear_colunas(celulas):
    """Mapeia cabeçalho -> colunas; None quando não é uma tabela reconhecida."""
    colunas = {}
    for indice, celula in enumerate(celulas):
        campo = COLUNAS_CONHECIDAS.get(normalizar(celula))
        if campo and campo not in colunas:
            colunas[campo] = indice

    if 'numero_op' not in colunas or 'prioridade' not in colunas:
        return None
    return colunas


LIMITE_PAREAMENTO = 15  # distância (em linhas) para juntar OP e prioridade quebradas


def _resto_sem_letras(texto, inicio, fim):
    """True quando o resto da linha (fora do match) não tem palavras."""
    resto = texto[:inicio] + ' ' + texto[fim:]
    resto = re.sub(r'\b(OP|ORDEM|NR|NO|N)\b', ' ', resto)
    return re.search(r'[A-Z]', resto) is None


def parse_tsv(texto, debug=False):
    """Lê a tabela do e-mail, tolerando colagem como texto ou TSV.

    Retorna (setores, linhas, avisos). `linhas` é uma lista de dicts
    {numero_op, setor, prioridade, peso_prioridade, linha}; quando a OP repete,
    a última ocorrência vence. Linhas sem dados válidos são ignoradas.

    Com `debug=True`, imprime no stderr cada linha e o que foi reconhecido.
    """
    if texto is None or str(texto).strip() == '':
        raise ValueError('nenhuma tabela recebida no stdin')

    setores = []
    linhas = {}
    avisos = []
    colunas = None
    setor_atual = None
    pendente_op = None
    pendente_prioridade = None
    prioridade_ativa = None  # "sticky": vale para as OPs abaixo até mudar

    def registrar(numero_op, prioridade, peso, setor, numero_linha, origem='texto'):
        if setor is not None and setor not in setores:
            setores.append(setor)
        linhas[numero_op] = {
            'numero_op': numero_op,
            'setor': setor,
            'prioridade': prioridade,
            'peso_prioridade': peso,
            'linha': numero_linha,
            'origem': origem,
        }

    def juntar_pendente(numero_linha, setor):
        """Junta OP e prioridade que caíram em linhas diferentes."""
        nonlocal pendente_op, pendente_prioridade
        if (pendente_op is not None and pendente_prioridade is not None
                and abs(pendente_op['linha'] - pendente_prioridade['linha']) <= LIMITE_PAREAMENTO):
            registrar(pendente_op['numero_op'], pendente_prioridade['prioridade'],
                      pendente_prioridade['peso'], setor, numero_linha,
                      pendente_op.get('origem', 'texto'))
            pendente_op = None
            pendente_prioridade = None
            return True
        return False

    for numero_linha, bruta in enumerate(str(texto).splitlines(), start=1):
        linha = bruta.rstrip('\r')
        if linha.strip() == '':
            continue

        normalizada = normalizar(linha)
        prioridade = _achar_prioridade(normalizada)
        op = _candidato_op(normalizada)

        if debug:
            print(
                '[debug] linha %d: %r -> op=%s origem=%s prioridade=%s'
                % (numero_linha, linha.strip(),
                   op[0] if op else '-',
                   _origem_op(op[0]) if op else '-',
                   prioridade[0] if prioridade else '-'),
                file=sys.stderr,
            )

        if '\t' not in linha:
            # Título de bloco ("MONTAGEM") ou linha colada como texto.
            setor = canonicalizar_setor(linha)
            if setor is not None:
                setor_atual = setor
                pendente_op = pendente_prioridade = None
                if setor not in setores:
                    setores.append(setor)
                continue

            if op is not None and prioridade is not None:
                registrar(op[0], prioridade[0], prioridade[1], setor_atual, numero_linha,
                          _origem_op(op[0]))
                pendente_op = pendente_prioridade = None
                continue

            if op is not None and _resto_sem_letras(normalizada, op[1], op[2]):
                if (pendente_prioridade is not None
                        and numero_linha - pendente_prioridade['linha'] <= LIMITE_PAREAMENTO):
                    registrar(op[0], pendente_prioridade['prioridade'],
                              pendente_prioridade['peso'], setor_atual, numero_linha,
                              _origem_op(op[0]))
                    pendente_op = pendente_prioridade = None
                elif prioridade_ativa is not None:
                    # Colagem vertical do Excel: a prioridade do topo vale
                    # para todas as OPs abaixo até aparecer outra prioridade.
                    registrar(op[0], prioridade_ativa['prioridade'],
                              prioridade_ativa['peso'], setor_atual, numero_linha,
                              _origem_op(op[0]))
                else:
                    pendente_op = {'numero_op': op[0], 'linha': numero_linha,
                                   'origem': _origem_op(op[0])}
                continue

            if prioridade is not None and _resto_sem_letras(normalizada, prioridade[2], prioridade[3]):
                prioridade_ativa = {'prioridade': prioridade[0], 'peso': prioridade[1]}
                pendente_prioridade = {
                    'prioridade': prioridade[0],
                    'peso': prioridade[1],
                    'linha': numero_linha,
                }
                juntar_pendente(numero_linha, setor_atual)
                continue

            # Linha de ruído (saudação, cabeçalho de e-mail...): ignora.
            continue

        celulas = [celula.strip() for celula in linha.split('\t')]

        cabecalho = _mapear_colunas(celulas)
        if cabecalho is not None:
            colunas = cabecalho
            pendente_op = pendente_prioridade = None
            continue

        if colunas is None:
            # TSV sem cabeçalho reconhecível: ainda pode ser uma linha válida.
            if op is not None and prioridade is not None:
                registrar(op[0], prioridade[0], prioridade[1], setor_atual, numero_linha,
                          _origem_op(op[0]))
            else:
                avisos.append('linha %d: tabela sem cabeçalho reconhecível (Ordem/Prioridade)' % numero_linha)
            continue

        def celula(campo):
            indice = colunas.get(campo)
            if indice is None or indice >= len(celulas):
                return ''
            return celulas[indice]

        ordem_bruta = celula('numero_op').strip()
        ordem = _op_da_celula(ordem_bruta)
        if ordem is None:
            avisos.append('linha %d: ordem inválida "%s"' % (numero_linha, ordem_bruta))
            continue

        prioridade_bruta = celula('prioridade')
        mapeada = mapear_prioridade(prioridade_bruta)
        if mapeada is None:
            avisos.append(
                'linha %d: prioridade desconhecida "%s" (OP %s)'
                % (numero_linha, prioridade_bruta, ordem)
            )
            continue

        prioridade, peso = mapeada
        setor_celula = celula('setor').strip() if 'setor' in colunas else ''
        setor = canonicalizar_setor(setor_celula) if setor_celula else None
        if setor is None and setor_celula:
            avisos.append(
                'linha %d: setor desconhecido "%s" (OP %s)'
                % (numero_linha, setor_celula, ordem)
            )
            continue
        if setor is None:
            # Sem setor no e-mail: o banco informa o setor da OP na aplicação.
            setor = setor_atual

        registrar(ordem, prioridade, peso, setor, numero_linha, 'coluna')
        pendente_op = pendente_prioridade = None

    if not linhas:
        # Nada válido no texto: o main decide se é erro (entrada sem OPs).
        return setores, [], avisos

    return setores, list(linhas.values()), avisos


def _carregar_env_simples(caminho):
    """Fallback sem python-dotenv: lê KEY=VALUE do .env da raiz."""
    try:
        conteudo = caminho.read_text(encoding='utf-8')
    except OSError:
        return

    for bruta in conteudo.splitlines():
        linha = bruta.strip()
        if not linha or linha.startswith('#'):
            continue
        if linha.startswith('export '):
            linha = linha[len('export '):].strip()
        if '=' not in linha:
            continue
        chave, valor = linha.split('=', 1)
        chave = chave.strip()
        valor = valor.strip()
        if len(valor) >= 2 and valor[0] == valor[-1] and valor[0] in '"\'':
            valor = valor[1:-1]
        if chave and chave not in os.environ:
            os.environ[chave] = valor


def carregar_env():
    """Carrega o .env da raiz do projeto (mesmo arquivo usado pelo server.js).

    python-dotenv é opcional: se não estiver instalado no interpretador que o
    Node está usando, o .env é lido direto (sem dependência externa).
    """
    caminho = RAIZ / '.env'
    try:
        from dotenv import load_dotenv
    except ImportError:
        _carregar_env_simples(caminho)
        return

    load_dotenv(caminho, override=False)


def criar_cliente():
    """Cria o cliente Supabase a partir das variáveis de ambiente."""
    try:
        from supabase import create_client
    except ImportError as erro:
        raise RuntimeError(
            'Biblioteca supabase não instalada no Python em uso (%s). '
            'Instale com: "%s" -m pip install -r requirements.txt'
            % (sys.executable, sys.executable)
        ) from erro

    url = os.getenv('SUPABASE_URL_ORDENS') or os.getenv('SUPABASE_URL')
    chave = os.getenv('SUPABASE_SERVICE_ROLE_KEY_ORDENS') or os.getenv('SUPABASE_SERVICE_ROLE_KEY')

    if not url or not chave:
        raise RuntimeError(
            'SUPABASE_URL_ORDENS e SUPABASE_SERVICE_ROLE_KEY_ORDENS precisam estar definidas '
            '(Python em uso: %s). Confira o .env da raiz do projeto.' % sys.executable
        )

    return create_client(url, chave)


def _em_lotes(valores, tamanho=LOTE_CONSULTA):
    for inicio in range(0, len(valores), tamanho):
        yield valores[inicio:inicio + tamanho]


def buscar_ordens(cliente, numeros):
    """Busca no banco as OPs informadas (em lotes, para não estourar a URL)."""
    encontrados = []
    for lote in _em_lotes(list(numeros)):
        resposta = (
            cliente.table(TABELA)
            .select('id, numero_op, setor, prioridade, peso_prioridade')
            .in_('numero_op', lote)
            .execute()
        )
        encontrados.extend(resposta.data or [])
    return encontrados


def aplicar(cliente, setores, linhas, aplicar=False):
    """Zera os setores mencionados e grava as prioridades das OPs existentes.

    Sem `aplicar=True`, apenas simula (nenhuma escrita no banco).
    """
    registros = buscar_ordens(cliente, [linha['numero_op'] for linha in linhas])
    por_numero = {}
    for registro in registros:
        por_numero.setdefault(str(registro.get('numero_op')), registro)

    atualizadas = []
    ausentes = []
    ignorados = []
    divergencias = []

    for linha in linhas:
        registro = por_numero.get(linha['numero_op'])
        if registro is None:
            # Número solto de 6 dígitos que não existe no banco é Lote do
            # material acabado (as OPs do sistema têm 7 dígitos).
            if linha.get('origem') == 'texto_6':
                ignorados.append(linha)
            else:
                ausentes.append(linha)
            continue

        setor_banco = canonicalizar_setor(registro.get('setor'))
        atualizadas.append({
            'numero_op': linha['numero_op'],
            'prioridade': linha['prioridade'],
            'peso_prioridade': linha['peso_prioridade'],
            'setor_email': linha['setor'],
            'setor_banco': setor_banco,
        })
        if linha['setor'] is not None and normalizar(linha['setor']) != normalizar(setor_banco):
            divergencias.append(linha['numero_op'])

    # Limpa os setores ditos no e-mail e também os setores reais das OPs
    # encontradas (o PCP costuma mandar a tabela sem a coluna Setor).
    setores_limpar = list(setores)
    for op in atualizadas:
        if op['setor_banco'] and op['setor_banco'] not in setores_limpar:
            setores_limpar.append(op['setor_banco'])

    if aplicar:
        for setor in setores_limpar:
            (
                cliente.table(TABELA)
                .update({'prioridade': None, 'peso_prioridade': None})
                .in_('setor', [setor])
                .execute()
            )

        for linha in atualizadas:
            (
                cliente.table(TABELA)
                .update({
                    'prioridade': linha['prioridade'],
                    'peso_prioridade': linha['peso_prioridade'],
                })
                .eq('numero_op', linha['numero_op'])
                .execute()
            )

    return {
        'aplicado': bool(aplicar),
        'setores': setores_limpar,
        'atualizadas': atualizadas,
        'ausentes': ausentes,
        'ignorados': ignorados,
        'divergencias': divergencias,
        'consultadas': len(linhas),
    }


def formatar_relatorio(resultado, avisos):
    """Relatório em texto plano, legível no terminal e em arquivo."""
    linhas = []
    linhas.append('Setores a limpar (e-mail + banco): %s' % (
        ', '.join(resultado['setores']) if resultado['setores'] else '(nenhum)'
    ))
    linhas.append(
        'Modo: %s' % ('APLICADO (banco atualizado)' if resultado['aplicado']
                      else 'DRY-RUN (use --apply para gravar)')
    )
    linhas.append(
        'OPs atualizadas: %d' % len(resultado['atualizadas'])
        if resultado['aplicado']
        else 'OPs a atualizar: %d' % len(resultado['atualizadas'])
    )
    for op in resultado['atualizadas']:
        nome = op['prioridade'] if op['prioridade'] is not None else 'sem prioridade'
        peso = op['peso_prioridade'] if op['peso_prioridade'] is not None else '-'
        setor = op['setor_banco'] or op['setor_email'] or '-'
        linhas.append('  - %s: %s (peso %s) [setor %s]' % (
            op['numero_op'], nome, peso, setor))

    total_ausentes = len(resultado['ausentes'])
    if total_ausentes:
        linhas.append('OPs ausentes no banco: %d' % total_ausentes)
        for op in resultado['ausentes']:
            linhas.append('  - %s (setor %s, linha %d)' % (
                op['numero_op'], op['setor'] or '?', op['linha']))
    else:
        linhas.append('OPs ausentes no banco: 0 (nenhuma OP ausente)')

    if resultado.get('ignorados'):
        linhas.append(
            'Lotes ignorados (6 dígitos, não são OP): %d' % len(resultado['ignorados'])
        )
        for op in resultado['ignorados']:
            linhas.append('  - %s (linha %d)' % (op['numero_op'], op['linha']))

    if resultado['divergencias']:
        linhas.append('Aviso: setor do e-mail difere do banco em: %s'
                      % ', '.join(resultado['divergencias']))

    if avisos:
        linhas.append('Avisos de leitura: %d' % len(avisos))
        linhas.extend('  - %s' % aviso for aviso in avisos)

    return '\n'.join(linhas)


def _diagnostico(texto, limite=15):
    """Linhas candidatas (números/prioridades) para depurar colagens atípicas."""
    candidatas = []
    for numero_linha, bruta in enumerate(str(texto).splitlines(), start=1):
        linha = bruta.rstrip('\r')
        if linha.strip() == '':
            continue
        normalizada = normalizar(linha)
        if re.search(r'\d{5,}', normalizada) or _achar_prioridade(normalizada) is not None:
            candidatas.append('  linha %d: %s' % (numero_linha, bruta.strip()[:160]))
        if len(candidatas) >= limite:
            candidatas.append('  ... (demais linhas omitidas)')
            break
    if not candidatas:
        return []
    return ['Diagnostico da colagem (linhas com numeros/prioridade):'] + candidatas


def _ler_stdin(stdin):
    if stdin is None:
        stdin = sys.stdin
    if stdin is None:
        return ''
    if hasattr(stdin, 'read'):
        return stdin.read()
    return str(stdin)


def main(argv=None, cliente=None, stdin=None):
    parser = argparse.ArgumentParser(
        description='Importa as prioridades do PCP (TSV) para o Supabase.'
    )
    parser.add_argument('--input', help='arquivo TSV (sem ele, lê o stdin)')
    parser.add_argument('--apply', action='store_true',
                        help='grava no banco (sem a flag, apenas simula)')
    parser.add_argument('--report', help='salva o relatório em um arquivo de texto')
    parser.add_argument('--debug', action='store_true',
                        help='mostra no stderr cada linha e o que foi reconhecido')

    try:
        argumentos = parser.parse_args(argv)
    except SystemExit as saida:  # argparse já escreveu o uso no stderr
        return int(saida.code or 2)

    try:
        if argumentos.input:
            texto = Path(argumentos.input).read_text(encoding='utf-8')
        else:
            texto = _ler_stdin(stdin)

        setores, linhas, avisos = parse_tsv(texto, debug=argumentos.debug)
        if not linhas:
            for detalhe in _diagnostico(texto):
                print(detalhe, file=sys.stderr)
            raise ValueError(
                'nenhuma OP válida encontrada no texto. '
                'Formato esperado: OP de 6-7 dígitos (aceita 1.132.972) '
                'e uma prioridade (ex.: 02 - Exportação). '
                'Rode com --debug para ver linha a linha.'
            )
        if cliente is None:
            carregar_env()
            cliente = criar_cliente()

        resultado = aplicar(cliente, setores, linhas, aplicar=argumentos.apply)
        relatorio = formatar_relatorio(resultado, avisos)
    except Exception as erro:  # noqa: BLE001 - qualquer falha vira erro de importação
        print('Erro ao importar prioridades: %s' % erro, file=sys.stderr)
        return 1

    print(relatorio)
    if argumentos.report:
        try:
            Path(argumentos.report).write_text(relatorio + '\n', encoding='utf-8')
        except OSError as erro:
            print('Erro ao salvar o relatório: %s' % erro, file=sys.stderr)
            return 1

    return 0


if __name__ == '__main__':
    for fluxo in (sys.stdout, sys.stderr, sys.stdin):
        try:
            fluxo.reconfigure(encoding='utf-8')
        except (AttributeError, ValueError):
            pass
    sys.exit(main())

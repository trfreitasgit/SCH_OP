var ordensCarregadas = [];
var previaOrdens = [];
var listaFiltrada = [];
var listaAtual = [];
var campoOrdenado = null;
var ordemCrescente = true;
var celulaEmEdicao = null;
// Texto do filtro rapido (campo #table-search). Faz parte do pipeline de filtros:
// e aplicado SOBRE o resultado dos filtros avancados, nunca sobre o DOM.
var termoBuscaRapida = '';

// ==========================================================================
// SUPABASE AUTH (client-side) - token gerenciado pelo SDK, nao mais no localStorage
// Cliente criado sob demanda via window.getSbClient() (supabase-config.js).
// NAO guardamos o cliente numa constante global: o SDK da CDN pode ainda nao
// estar disponivel quando ordens.js e avaliado.
// ==========================================================================
function getClient() {
    return window.getSbClient ? window.getSbClient() : null;
}

// Retorna a sessao atual do Supabase (renova o JWT automaticamente se expirado)
async function getSession() {
    const sbClient = getClient();
    if (!sbClient) return null;
    try {
        const { data, error } = await sbClient.auth.getSession();
        if (error) {
            console.warn('[AUTH] getSession error:', error.message);
            return null;
        }
        return data.session || null;
    } catch (e) {
        console.warn('[AUTH] getSession exception:', e.message);
        return null;
    }
}

// Token JWT do Supabase (sempre lido da sessao atual)
async function getAccessToken() {
    const session = await getSession();
    return session ? session.access_token : null;
}

// Authenticated fetch wrapper: injeta o JWT do Supabase em toda requisicao ao backend
async function authFetch(url, options = {}) {
    const token = await getAccessToken();

    if (!token) {
        console.warn('[AUTH] Sem sessao ativa - redirecionando para /login');
        window.location.href = '/login';
        throw new Error('Sessão expirada');
    }

    const headers = {
        'Content-Type': 'application/json',
        ...options.headers,
        'Authorization': `Bearer ${token}`
    };

    const response = await fetch(url, {
        ...options,
        headers,
        credentials: 'include'
    });

    if (response.status === 401) {
        console.warn('[AUTH] 401 - encerrando sessao Supabase');
        window.sbClearAuthCookie();
        try { await getClient()?.auth.signOut(); } catch (e) { /* ignore */ }
        window.location.href = '/login';
        throw new Error('Não autenticado');
    }

    return response;
}

// Mantem o cookie de sessao (usado pelo servidor na navegacao de pagina) alinhado
// com a sessao do Supabase: renovacao de token atualiza o cookie; logout limpa.
// Registro tolerante a lazy init: se o SDK ainda nao estiver disponivel, tenta de
// novo no DOMContentLoaded (a flag evita registrar o listener duas vezes).
var _authListenerRegistrado = false;
function registrarAuthListener() {
    const client = getClient();
    if (!client || _authListenerRegistrado) return;
    _authListenerRegistrado = true;
    client.auth.onAuthStateChange(function (evento, session) {
        if (evento === 'TOKEN_REFRESHED' || evento === 'SIGNED_IN' || evento === 'INITIAL_SESSION') {
            window.sbSyncAuthCookie(session);
        } else if (evento === 'SIGNED_OUT') {
            window.sbClearAuthCookie();
        }
    });
}
registrarAuthListener();

// Dashboard carregou => o loop de redirect terminou; zera o contador anti-loop e
// garante o cookie fresco para as proximas navegacoes de pagina.
document.addEventListener('DOMContentLoaded', async function () {
    sessionStorage.removeItem('sb_redirect_bounces');
    registrarAuthListener();
    const session = await getSession();
    if (session) window.sbSyncAuthCookie(session);
});

// O SAP exporta quantidades no formato pt-BR, usando o ponto como separador de
// milhar ("1.000"). Como parseInt("1.000", 10) === 1 (a conversao para no primeiro
// caractere nao-digito), removemos os pontos antes de converter. A parte decimal
// (apos a virgula) e descartada, pois total_pecas e um contador inteiro.
function parseQuantidade(valor) {
    if (valor === null || valor === undefined) return NaN;
    if (typeof valor === 'number') return Math.trunc(valor);
    var texto = String(valor).trim();
    if (texto === '') return NaN;
    return parseInt(texto.replace(/\./g, '').split(',')[0], 10);
}

// Estado dos filtros avançados
var filtrosAvancados = {
    prioridades: {
        'Exportacao': true, 'KS': true, 'Marelli': true, 'MWM': true,
        'Pendencia Comercial': true,
        'Linha Pesada': true, 'MRP': true, 'Tryout': true,
        '__NULL__': true
    },
    status: { 'Falta Pagar': true, 'Pago': true, 'Encerrado': true },
    setores: { 'Montagem': true, 'Subconjunto': true, 'Celula': true, 'BCM': true, 'Importada': true, 'Usinagem': true },
    dataInicio: null,
    dataFim: null
};

// Estado da paginação
var paginacao = {
    paginaAtual: 1,
    itensPorPagina: 10,
    totalItens: 0,
    totalPaginas: 0
};

function formatarData(dataISO) {
    if (!dataISO) return '-';
    var partes = dataISO.substring(0, 10).split('-');
    if (partes.length < 3) return dataISO;
    var ano = partes[0];
    var mes = partes[1];
    var dia = partes[2].substring(0, 2);
    return dia + '/' + mes + '/' + ano;
}

// ==========================================================================
// FUSO DA FABRICA - America/Sao_Paulo
// dia_analise passou a ser timestamptz (instante exato do pagamento), entao a
// data e o horario precisam ser lidos no fuso da fabrica e nao no fuso do
// navegador: um pagamento as 22h de 16/10 chega do banco como 01h UTC de 17/10
// e apareceria como 17/10 para quem estivesse em UTC. Mesma regra do backend.
// ==========================================================================
var TZ_FABRICA = 'America/Sao_Paulo';
var _fmtHoraFabrica = null;
var _fmtDataFabrica = null;

// { hora: 0-23, minuto: 0-59 } de um timestamp no fuso da fabrica.
// Data pura (AAAA-MM-DD) vale como meia-noite, igual ao normalizarDiaAnalise do backend.
function obterHoraMinutoFabrica(dataISO) {
    if (!dataISO) return null;
    var texto = String(dataISO).trim();
    if (!texto) return null;
    if (texto.indexOf('T') === -1) {
        // Data pura (AAAA-MM-DD) vale como meia-noite da fabrica; qualquer outro texto e invalido.
        return /^\d{4}-\d{2}-\d{2}$/.test(texto) ? { hora: 0, minuto: 0 } : null;
    }
    var data = new Date(texto);
    if (isNaN(data.getTime())) return null;
    if (!_fmtHoraFabrica) {
        _fmtHoraFabrica = new Intl.DateTimeFormat('en-GB', {
            timeZone: TZ_FABRICA, hour: '2-digit', minute: '2-digit', hour12: false
        });
    }
    var partes = _fmtHoraFabrica.formatToParts(data);
    var hora = 0;
    var minuto = 0;
    for (var i = 0; i < partes.length; i++) {
        if (partes[i].type === 'hour') hora = parseInt(partes[i].value, 10) % 24; // '24' do en-GB vira 0
        if (partes[i].type === 'minute') minuto = parseInt(partes[i].value, 10);
    }
    return { hora: hora, minuto: minuto };
}

// { ano, mes, dia } no fuso da fabrica (data pura e mantida literal, sem conversao).
function obterDataFabrica(dataISO) {
    if (!dataISO) return null;
    var texto = String(dataISO).trim();
    if (!texto) return null;
    if (texto.indexOf('T') === -1) {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(texto)) return null;
        var cru = texto.split('-');
        return { ano: cru[0], mes: cru[1], dia: cru[2] };
    }
    var data = new Date(texto);
    if (isNaN(data.getTime())) return null;
    if (!_fmtDataFabrica) {
        _fmtDataFabrica = new Intl.DateTimeFormat('en-CA', {
            timeZone: TZ_FABRICA, year: 'numeric', month: '2-digit', day: '2-digit'
        });
    }
    var partes = _fmtDataFabrica.formatToParts(data);
    var campos = {};
    for (var i = 0; i < partes.length; i++) campos[partes[i].type] = partes[i].value;
    return { ano: campos.year, mes: campos.month, dia: campos.day };
}

// Coluna DATA DE ANALISE: sempre DD/MM/AAAA, na data local da fabrica.
function formatarDiaAnalise(data) {
    var d = obterDataFabrica(data);
    if (!d) return '-';
    return d.dia + '/' + d.mes + '/' + d.ano;
}

// ==========================================================================
// TURNO DO PAGAMENTO (coluna TURNO)
//   T1 (verde): 05:20 as 13:39
//   T2 (azul):  13:40 as 21:59
//   T3 (roxo):  22:00 as 05:19 (cruza a meia-noite)
// ==========================================================================
var TURNO_T1_INICIO = 5 * 60 + 20;   // 05:20
var TURNO_T2_INICIO = 13 * 60 + 40;  // 13:40
var TURNO_T3_INICIO = 22 * 60;       // 22:00

function obterTurno(diaAnalise) {
    var hm = obterHoraMinutoFabrica(diaAnalise);
    if (!hm) return null;
    var minutos = hm.hora * 60 + hm.minuto;
    if (minutos >= TURNO_T1_INICIO && minutos < TURNO_T2_INICIO) return 'T1';
    if (minutos >= TURNO_T2_INICIO && minutos < TURNO_T3_INICIO) return 'T2';
    return 'T3';
}

// Hora inicial de cada turno. Ao trocar o turno de uma ordem, e essa hora que
// vai para dia_analise (a data do pagamento e preservada).
var INICIO_TURNO = {
    T1: { hora: 5, minuto: 20 },
    T2: { hora: 13, minuto: 40 },
    T3: { hora: 22, minuto: 0 }
};

// Devolve o ISO de dia_analise com a data da fabrica preservada e a hora trocada
// para o inicio do turno escolhido. null quando nao ha data ou o turno e invalido.
// O deslocamento -03:00 e explicito para o resultado nao depender do fuso de quem roda.
function diaAnaliseComTurno(diaAnalise, turno) {
    var data = obterDataFabrica(diaAnalise);
    if (!data) return null;
    var inicio = INICIO_TURNO[turno];
    if (!inicio) return null;
    return data.ano + '-' + data.mes + '-' + data.dia +
        'T' + String(inicio.hora).padStart(2, '0') + ':' + String(inicio.minuto).padStart(2, '0') + ':00-03:00';
}

// Troca so a DATA de dia_analise, preservando a hora do pagamento. Sem isso, o
// input type="date" (que so carrega AAAA-MM-DD) mandaria meia-noite e o turno
// do pagamento viraria T3 sempre que alguem corrigisse a data.
function diaAnaliseComData(diaAnalise, novaData) {
    var data = obterDataFabrica(novaData);
    if (!data) return null;
    var hm = obterHoraMinutoFabrica(diaAnalise) || { hora: 0, minuto: 0 };
    return data.ano + '-' + data.mes + '-' + data.dia +
        'T' + String(hm.hora).padStart(2, '0') + ':' + String(hm.minuto).padStart(2, '0') + ':00-03:00';
}

// Compara dois dia_analise pelo INSTANTE, nao so pela data. O comparador antigo
// usava substring(0,10), entao trocar apenas o turno (mesma data, hora diferente)
// era tratado como "nada mudou" e a edicao era descartada em silencio.
function mesmaDataAnalise(a, b) {
    var textoA = a === null || a === undefined ? '' : String(a).trim();
    var textoB = b === null || b === undefined ? '' : String(b).trim();
    if (!textoA && !textoB) return true;
    if (!textoA || !textoB) return false;

    var msA = new Date(textoA).getTime();
    var msB = new Date(textoB).getTime();
    if (!isNaN(msA) && !isNaN(msB)) return msA === msB;

    // Entradas que o Date nao entende: compara o texto normalizado.
    return textoA === textoB;
}

function getTurnoBadge(turno) {
    if (!turno) {
        return '<span class="turno-sem" title="Sem pagamento registrado">-</span>';
    }
    var nomes = {
        T1: 'Turno 1 - 05:20 as 13:39',
        T2: 'Turno 2 - 13:40 as 21:59',
        T3: 'Turno 3 - 22:00 as 05:19'
    };
    return '<span class="turno-badge turno-' + turno.toLowerCase() + '" title="' + nomes[turno] + '" aria-label="' + nomes[turno] + '">' + turno + '</span>';
}

// A coluna Turno e derivada de dia_analise: a celula carrega data-coluna="turno"
// para o duplo clique abrir o seletor de turno (ver iniciarEdicaoCelula).
function celulaTurno(diaAnalise) {
    var turno = obterTurno(diaAnalise);
    var dica = diaAnalise ? 'Duplo clique para editar o turno' : 'Sem pagamento registrado';
    return '<td class="td-turno" data-coluna="turno" title="' + dica + '">' + getTurnoBadge(turno) + '</td>';
}

function calcularDiferencaDias(dataAberturaISO, diaAnaliseISO) {
    var parteA = obterDataFabrica(dataAberturaISO);
    var parteB = obterDataFabrica(diaAnaliseISO);
    if (!parteA || !parteB) return null;

    var dtA = new Date(parseInt(parteA.ano, 10), parseInt(parteA.mes, 10) - 1, parseInt(parteA.dia, 10));
    var dtB = new Date(parseInt(parteB.ano, 10), parseInt(parteB.mes, 10) - 1, parseInt(parteB.dia, 10));

    var diffMs = dtB - dtA;
    return Math.floor(diffMs / (1000 * 60 * 60 * 24));
}

// "12.480 peças" / "1 peça" / "0 peças" - separador de milhar pt-BR.
function formatarPecas(quantidade) {
    var numero = Number(quantidade) || 0;
    return numero.toLocaleString('pt-BR') + (numero === 1 ? ' peça' : ' peças');
}

// Percentual de pagamentos dentro do prazo. A base sao as ordens que tem data
// para classificar (prazo + atraso): ordem paga sem data nao pode ser julgada.
// Sem nenhuma ordem classificavel nao ha percentual ("—").
function formatarPontualidade(kpis) {
    var classificaveis = kpis.pagasNoPrazo + kpis.pagasApos48h;
    if (!classificaveis) return '—';
    return Math.round((kpis.pagasNoPrazo / classificaveis) * 100) + '%';
}

// Contagem de ordens e soma de peças de cada card. Recebe a lista ja filtrada:
// tanto as ordens quanto as pecas seguem os filtros da tela.
function calcularKpis(lista) {
    var kpis = {
        total: lista.length, pecasTotal: 0,
        faltaPagar: 0, pecasFaltaPagar: 0,
        // Total pago independe do prazo: inclui ordem Pago sem dia_analise ou
        // sem data_abertura (essas ficam em pagasSemData, fora do split de 48h).
        pagas: 0, pecasPagas: 0, pagasSemData: 0, pecasSemData: 0,
        pagasApos48h: 0, pecasApos48h: 0, // pagas depois de 48 horas (> 2 dias)
        pagasNoPrazo: 0, pecasNoPrazo: 0  // pagas dentro do prazo (<= 48 horas / <= 2 dias)
    };

    lista.forEach(function(ordem) {
        // total_pecas pode vir do SAP como "1.000": parseQuantidade remove o ponto
        // de milhar. Valor ausente ou invalido nao soma nada.
        var pecas = parseQuantidade(ordem.total_pecas);
        if (isNaN(pecas)) pecas = 0;
        kpis.pecasTotal += pecas;

        if (ordem.situacao === 'Falta Pagar') {
            kpis.faltaPagar++;
            kpis.pecasFaltaPagar += pecas;
        } else if (ordem.situacao === 'Pago' || ordem.dia_analise) {
            kpis.pagas++;
            kpis.pecasPagas += pecas;

            var diffDias = calcularDiferencaDias(ordem.data_abertura, ordem.dia_analise);
            if (diffDias !== null) {
                if (diffDias <= 2) {
                    kpis.pagasNoPrazo++;
                    kpis.pecasNoPrazo += pecas;
                } else {
                    kpis.pagasApos48h++;
                    kpis.pecasApos48h += pecas;
                }
            } else {
                kpis.pagasSemData++;
                kpis.pecasSemData += pecas;
            }
        }
    });

    return kpis;
}

function escreverKpi(idNumero, idPecas, numero, pecas) {
    var elNumero = document.getElementById(idNumero);
    var elPecas = document.getElementById(idPecas);
    if (elNumero) elNumero.innerText = numero;
    if (elPecas) elPecas.innerText = formatarPecas(pecas);
}

function atualizarKPIs(lista) {
    var kpis = calcularKpis(lista);
    escreverKpi('kpi-total-ops', 'kpi-total-ops-pecas', kpis.total, kpis.pecasTotal);
    escreverKpi('kpi-falta-pagar', 'kpi-falta-pagar-pecas', kpis.faltaPagar, kpis.pecasFaltaPagar);
    escreverKpi('kpi-critico', 'kpi-critico-pecas', kpis.pagasApos48h, kpis.pecasApos48h);
    escreverKpi('kpi-prazo', 'kpi-prazo-pecas', kpis.pagasNoPrazo, kpis.pecasNoPrazo);
    atualizarResumoPagamento(kpis);
}

// Faixa fina abaixo dos cards: total pago (soma dos dois cards de prazo e das
// pagas sem data) e a pontualidade. Nao e um card: e uma linha de leitura rapida.
function atualizarResumoPagamento(kpis) {
    var elPagas = document.getElementById('resumo-pagas');
    var elPecas = document.getElementById('resumo-pecas-pagas');
    var elPontualidade = document.getElementById('resumo-pontualidade');
    var elSplit = document.getElementById('resumo-split-prazo');

    if (elPagas) elPagas.innerText = kpis.pagas;
    if (elPecas) elPecas.innerText = formatarPecas(kpis.pecasPagas);
    if (elPontualidade) elPontualidade.innerText = formatarPontualidade(kpis);

    if (elSplit) {
        var texto = kpis.pagasNoPrazo + ' no prazo · ' + kpis.pagasApos48h + ' fora do prazo';
        // Só aparece quando existe ordem paga sem data para classificar: sem
        // isso a soma de "no prazo + fora" nao fecharia com o total pago.
        if (kpis.pagasSemData > 0) texto += ' · ' + kpis.pagasSemData + ' sem data';
        elSplit.innerText = texto;
    }
}

function getStatusBadge(situacao) {
    if (!situacao) return '-';
    var classe = '';
    var label = situacao;
    switch (situacao) {
        case 'Falta Pagar':
            classe = 'status-falta-pagar';
            break;
        case 'Pago':
            classe = 'status-pago';
            break;
        case 'Encerrado':
            classe = 'status-encerrado';
            break;
        default:
            return label;
    }
    return '<span class="status-badge ' + classe + '">' + label + '</span>';
}

// Escapa texto para insercao segura em HTML (evita que &, <, > quebrem o layout)
function escaparHtml(valor) {
    if (valor === null || valor === undefined) return '';
    return String(valor)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}

// Escapa texto para uso dentro de atributo (title="..."): precisa tratar aspas
function escaparAtributo(valor) {
    return escaparHtml(valor)
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

// TEXTO LONGO NA COLUNA OBSERVACAO -> truncado por CSS (ellipsis) e o texto
// completo vai para data-tooltip-texto, consumido pelo tooltip premium (abaixo).
// O atributo title nao e usado aqui: ele abriria o balao nativo junto do nosso.
// As celulas vazias mantem o title com a dica de edicao (nao ha texto a exibir).
function celulaObservacao(observacao) {
    var texto = (observacao === null || observacao === undefined) ? '' : String(observacao).trim();
    if (!texto) {
        return '<td data-coluna="observacao" title="Duplo clique para editar"></td>';
    }
    return '<td data-coluna="observacao" tabindex="0" data-tooltip-texto="' + escaparAtributo(texto) + '">'
        + escaparHtml(texto) + '</td>';
}

// ==========================================================================
// TOOLTIP PREMIUM DA COLUNA OBSERVACAO (Level 3 do assets/DESIGN.md)
// Opcao DISCRETA: so aparece quando o texto esta de fato truncado
// (scrollWidth > clientWidth) - celulas curtas nao disparam nada.
// Singleton apensado ao <body> (position: fixed): o td tem overflow: hidden e a
// tabela overflow-x: auto, entao qualquer pseudo-elemento dentro da celula
// seria recortado. Eventos delegados: a tabela e reconstruida por innerHTML a
// cada ordenacao, filtro ou troca de pagina.
// ==========================================================================
var tooltipObsEl = null;
var tooltipObsTimer = null;
var SELETOR_TOOLTIP_OBS = '#tabelaOrdens tbody td[data-coluna="observacao"][data-tooltip-texto]';

function garantirTooltipObs() {
    if (tooltipObsEl && document.body.contains(tooltipObsEl)) return tooltipObsEl;
    tooltipObsEl = document.createElement('div');
    tooltipObsEl.className = 'ui-tooltip';
    tooltipObsEl.id = 'tooltip-observacao';
    tooltipObsEl.setAttribute('role', 'tooltip');
    document.body.appendChild(tooltipObsEl);
    return tooltipObsEl;
}

function textoEstaTruncado(td) {
    return td.scrollWidth > td.clientWidth + 1;
}

function posicionarTooltipObs(td) {
    var el = garantirTooltipObs();
    var alvo = td.getBoundingClientRect();
    var caixa = el.getBoundingClientRect();
    var margem = 8;

    // Abaixo por padrao; vira para cima se nao houver espaco.
    var cabeAbaixo = (window.innerHeight - alvo.bottom) >= (caixa.height + margem);
    var acima = !cabeAbaixo && alvo.top > (caixa.height + margem);
    var top = acima ? (alvo.top - caixa.height - margem) : (alvo.bottom + margem);

    // Limita ao viewport na horizontal.
    var left = alvo.left + (alvo.width / 2) - (caixa.width / 2);
    var maxLeft = window.innerWidth - caixa.width - margem;
    if (left < margem) left = margem;
    if (left > maxLeft) left = maxLeft;

    el.style.top = Math.round(top) + 'px';
    el.style.left = Math.round(left) + 'px';
    el.classList.toggle('is-above', acima);
    el.classList.toggle('is-below', !acima);

    // Seta apontando para o centro da celula.
    var setaX = (alvo.left + (alvo.width / 2)) - left;
    if (setaX < 12) setaX = 12;
    if (setaX > caixa.width - 12) setaX = caixa.width - 12;
    el.style.setProperty('--arrow-x', Math.round(setaX) + 'px');
}

function mostrarTooltipObs(td) {
    if (!td || !textoEstaTruncado(td)) return;
    var texto = td.getAttribute('data-tooltip-texto');
    if (!texto) return;

    var el = garantirTooltipObs();
    el.textContent = texto; // textContent: sem HTML, logo sem XSS e sem precisar de escape
    posicionarTooltipObs(td);
    el.classList.add('is-visible');
    td.setAttribute('aria-describedby', el.id);
}

function esconderTooltipObs() {
    if (tooltipObsTimer) {
        clearTimeout(tooltipObsTimer);
        tooltipObsTimer = null;
    }
    if (tooltipObsEl) tooltipObsEl.classList.remove('is-visible');
}

var seletorTooltipObs = SELETOR_TOOLTIP_OBS;

function celulaObservacaoDoAlvo(alvo) {
    if (!alvo || !alvo.closest) return null;
    return alvo.closest(seletorTooltipObs);
}

// Ponteiro: abre apos 150ms de hover; fecha ao sair da celula ou ao entrar em outra
document.addEventListener('mouseover', function (e) {
    var td = celulaObservacaoDoAlvo(e.target);
    if (!td) {
        if (tooltipObsEl && tooltipObsEl.classList.contains('is-visible')) esconderTooltipObs();
        return;
    }
    if (tooltipObsTimer) clearTimeout(tooltipObsTimer);
    tooltipObsTimer = setTimeout(function() { mostrarTooltipObs(td); }, 150);
}, true);

document.addEventListener('mouseout', function (e) {
    var td = celulaObservacaoDoAlvo(e.target);
    if (!td) return;
    var destino = celulaObservacaoDoAlvo(e.relatedTarget);
    if (destino !== td) esconderTooltipObs();
}, true);

// Teclado: a celula recebe tabindex quando tem texto
document.addEventListener('focusin', function (e) {
    var td = celulaObservacaoDoAlvo(e.target);
    if (td) mostrarTooltipObs(td);
}, true);

document.addEventListener('focusout', function (e) {
    if (celulaObservacaoDoAlvo(e.target)) esconderTooltipObs();
}, true);

// Nunca deixar o balao "fantasma" na tela (o scroll do container nao borbulha,
// por isso a captura). Escape e clique tambem fecham.
window.addEventListener('scroll', esconderTooltipObs, true);
window.addEventListener('resize', esconderTooltipObs);
document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') esconderTooltipObs();
});

function getPriorityBadge(prioridade) {
    if (!prioridade) return '-';
    var classe = '';
    var label = prioridade;
    // Lista Vermelha (Crítica)
    if (['Exportacao', 'KS', 'Marelli', 'MWM'].includes(prioridade)) {
        classe = 'priority-vermelha';
    }
    // Lista Amarela (Comercial)
    else if (prioridade === 'Pendencia Comercial') {
        classe = 'priority-amarela';
    }
    // Lista Branca (Padrão)
    else if (['Linha Pesada', 'MRP', 'Tryout'].includes(prioridade)) {
        classe = 'priority-branca';
    }
    else {
        return label;
    }
    return '<span class="priority-badge ' + classe + '">' + label + '</span>';
}

function renderizarTabela(lista) {
    atualizarKPIs(listaFiltrada);
    var tabela = document.getElementById('tabelaOrdens');
    var corpoTabela = tabela.querySelector('tbody');
    var html = '';

    lista.forEach(function(ordem) {
        html += '<tr data-id="' + ordem.id + '" data-op="' + (ordem.numero_op || '') + '">'
            + '<td class="td-check"><input type="checkbox" class="check-ordem" value="' + ordem.id + '"></td>'
            + '<td data-coluna="numero_op" title="Duplo clique para editar">' + (ordem.numero_op || '') + '</td>'
            + '<td data-coluna="total_pecas" style="text-align: right;" title="Duplo clique para editar">' + (ordem.total_pecas || 0) + '</td>'
            + '<td data-coluna="data_abertura" title="Duplo clique para editar">' + formatarData(ordem.data_abertura) + '</td>'
            + '<td data-coluna="material" title="Duplo clique para editar (máx 8 dígitos)">' + (ordem.material || '') + '</td>'
            + '<td data-coluna="situacao" title="Duplo clique para editar">' + getStatusBadge(ordem.situacao) + '</td>'
            + celulaObservacao(ordem.observacao)
            + '<td data-coluna="setor" title="Duplo clique para editar">' + (ordem.setor || '') + '</td>'
            + '<td data-coluna="prioridade" title="Duplo clique para editar">' + getPriorityBadge(ordem.prioridade) + '</td>'
            + '<td data-coluna="dia_analise" title="Duplo clique para editar a data (a hora do pagamento e mantida)">' + formatarDiaAnalise(ordem.dia_analise) + '</td>'
            + celulaTurno(ordem.dia_analise)
            + '<td class="td-acoes">'
            + '  <button type="button" class="btn-excluir-linha" data-id="' + ordem.id + '" data-op="' + (ordem.numero_op || '') + '" title="Excluir ordem">'
            + '    <span class="material-symbols-outlined" style="font-size: 16px;">delete</span>'
            + '  </button>'
            + '</td>'
            + '</tr>';
    });

    corpoTabela.innerHTML = html;
    atualizarEstadoSelecao();
}

// ==========================================================================
// ORDENACAO CLIENT-SIDE (em memoria)
// --------------------------------------------------------------------------
// Antes, cada clique em cabecalho chamava carregarOrdensPendentes(sort, order),
// que refazia GET /ordens/pendentes + consulta ao Supabase so para reordenar
// dados que o navegador ja tinha em ordensCarregadas. Agora a ordenacao ocorre
// sobre esse array e o pipeline (filtros -> paginacao) redesenha a tabela na
// hora, sem nenhuma requisicao.
// ==========================================================================

// Campos com comparacao aritmetica.
var CAMPOS_ORDENACAO_NUMERICA = ['id', 'total_pecas', 'peso_prioridade'];

// Campos com comparacao por instante.
var CAMPOS_ORDENACAO_DATA = ['data_abertura', 'dia_analise'];

// Texto comparavel: sem acento, minusculo e sem espacos nas pontas, para
// "Célula"/"Celula" e "Pendência"/"Pendencia" caírem na mesma posicao.
function normalizarParaOrdenacao(valor) {
    return String(valor)
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .trim();
}

function ehVazioParaOrdenacao(valor) {
    return valor === null || valor === undefined || String(valor).trim() === '';
}

// Instante (ms) de uma data. AAAA-MM-DD vale como meia-noite da fabrica, igual
// ao normalizarDiaAnalise do backend: sem isso a mesma data gravada nos dois
// formatos (date pura e timestamptz) ordenaria com 3h de diferenca.
function instanteParaOrdenacao(valor) {
    var texto = String(valor).trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(texto)) return new Date(texto + 'T00:00:00-03:00').getTime();
    var ms = new Date(texto).getTime();
    return isNaN(ms) ? null : ms;
}

function compararValoresOrdenacao(a, b, campo) {
    if (CAMPOS_ORDENACAO_NUMERICA.indexOf(campo) !== -1) {
        var na = Number(a);
        var nb = Number(b);
        if (na < nb) return -1;
        if (na > nb) return 1;
        return 0;
    }

    if (CAMPOS_ORDENACAO_DATA.indexOf(campo) !== -1) {
        var ma = instanteParaOrdenacao(a);
        var mb = instanteParaOrdenacao(b);
        if (ma === null && mb === null) return 0;
        if (ma === null) return 1;
        if (mb === null) return -1;
        return ma < mb ? -1 : (ma > mb ? 1 : 0);
    }

    return normalizarParaOrdenacao(a).localeCompare(normalizarParaOrdenacao(b), 'pt-BR');
}

// Ordena a lista no lugar e devolve a propria referencia.
// Nulos/vazios vao SEMPRE para o fim (equivalente ao nullsLast do banco), tanto
// crescente quanto decrescente. Empates - inclusive entre vazios - saem por id
// desc, que era o desempate de /ordens/pendentes: sem esse desempate a ordem
// dentro do grupo vazio herdava a ordenacao anterior e mudava de tela para tela.
function ordenarListaPorCampo(lista, campo, crescente) {
    var fator = crescente ? 1 : -1;

    lista.sort(function (a, b) {
        var vazioA = ehVazioParaOrdenacao(a[campo]);
        var vazioB = ehVazioParaOrdenacao(b[campo]);

        // Um lado vazio: vazio sempre no fim.
        if (vazioA !== vazioB) return vazioA ? 1 : -1;

        if (!vazioA) {
            var resultado = compararValoresOrdenacao(a[campo], b[campo], campo);
            if (resultado !== 0) return resultado * fator;
        }

        return (Number(b.id) || 0) - (Number(a.id) || 0);
    });

    return lista;
}

function ordenarPor(campo) {
    if (!campo) return;

    if (campo === campoOrdenado) {
        ordemCrescente = !ordemCrescente;
    } else {
        campoOrdenado = campo;
        ordemCrescente = true;
    }

    // Reordena a lista que ja esta em memoria e manda o pipeline redesenhar.
    // Nenhum fetch aqui: a API devolve todas as ordens de uma vez.
    ordenarListaPorCampo(ordensCarregadas, campoOrdenado, ordemCrescente);

    paginacao.paginaAtual = 1;
    aplicarFiltros();
}

// Carga das ordens pendentes (abertura da pagina e mutacoes reais: cadastro em
// lote, edicao, exclusao). A ordenacao por coluna NAO passa mais por aqui: ver
// ordenarPor(), que ordena em memoria sem tocar na API.
async function carregarOrdensPendentes() {
    try {
        const resposta = await authFetch('/ordens/pendentes');
        const dados = await resposta.json();
        ordensCarregadas = dados;

        // Preserva a ordenacao escolhida pelo usuario entre recargas: sem isso,
        // um cadastro em lote devolveria a lista na ordem padrao do banco.
        if (campoOrdenado) {
            ordenarListaPorCampo(ordensCarregadas, campoOrdenado, ordemCrescente);
        }

        paginacao.paginaAtual = 1;
        paginacao.itensPorPagina = 10;
        // Reaplica o pipeline (filtros avancados + filtro rapido) em vez de renderizar
        // a lista crua: sem isso, recarregar descartava os filtros ativos.
        aplicarFiltros();
    } catch (erro) {
        console.error('Erro ao carregar ordens:', erro);
    }
}

// COPIAR ORDENS PARA O SAP: copia exatamente as ordens que estão aparecendo na tela (filtradas)
document.getElementById('btnCopiar').addEventListener('click', function() {
    var linhas = document.querySelectorAll('#tabelaOrdens tbody tr');
    var ops = [];

    linhas.forEach(function(tr) {
        if (tr.style.display !== 'none') {
            var tdOp = tr.querySelector('[data-coluna="numero_op"]');
            if (tdOp) {
                var valor = tdOp.innerText.trim();
                if (valor) {
                    ops.push(valor);
                }
            }
        }
    });

    if (ops.length === 0) {
        alert('Nenhuma ordem visível para copiar.');
        return;
    }

    var texto = ops.join('\n');
    navigator.clipboard.writeText(texto).then(function() {
        mostrarToast('OPs Copiadas para o SAP!', ops.length + ' ordens visíveis copiadas.');
        // Show SAP buffer indicator
        var sapBadge = document.getElementById('sap-buffer-indicator');
        var sapCount = document.getElementById('sap-buffer-count');
        if (sapBadge && sapCount) {
            sapCount.innerText = ops.length;
            sapBadge.style.display = 'flex';
            sapBadge.classList.add('active');
            setTimeout(function() {
                sapBadge.style.display = 'none';
                sapBadge.classList.remove('active');
            }, 5000);
        }
    }).catch(function() {
        // Fallback para ambientes restritos
        var area = document.createElement('textarea');
        area.value = texto;
        document.body.appendChild(area);
        area.select();
        document.execCommand('copy');
        document.body.removeChild(area);
        mostrarToast('OPs Copiadas para o SAP!', ops.length + ' ordens visíveis copiadas.');
        var sapBadge = document.getElementById('sap-buffer-indicator');
        var sapCount = document.getElementById('sap-buffer-count');
        if (sapBadge && sapCount) {
            sapCount.innerText = ops.length;
            sapBadge.style.display = 'flex';
            sapBadge.classList.add('active');
            setTimeout(function() {
                sapBadge.style.display = 'none';
                sapBadge.classList.remove('active');
            }, 5000);
        }
    });
});

// ==========================================================================
// EXPORTAR PARA EXCEL: envia TODOS os IDs da lista filtrada (ignora a paginacao)
// O backend dispara o script Python e devolve o .xlsx como download.
// ==========================================================================
var btnExportarExcel = document.getElementById('btnExportarExcel');

if (btnExportarExcel) {
    btnExportarExcel.addEventListener('click', async function () {
        var ids = listaFiltrada
            .map(function (ordem) { return ordem.id; })
            .filter(function (id) { return id !== undefined && id !== null; });

        if (ids.length === 0) {
            alert('Nenhuma ordem filtrada para exportar.');
            return;
        }

        var label = document.getElementById('btnExportarExcelLabel');
        var textoOriginal = label ? label.textContent : null;

        btnExportarExcel.disabled = true;
        btnExportarExcel.classList.add('opacity-75', 'cursor-wait');
        if (label) label.textContent = 'Carregando...';

        try {
            var resposta = await authFetch('/ordens/export', {
                method: 'POST',
                body: JSON.stringify({ ids: ids })
            });

            if (!resposta.ok) {
                var detalhe = '';
                try { detalhe = (await resposta.json()).erro || ''; } catch (e) { /* resposta sem JSON */ }
                throw new Error(detalhe || ('Falha na exportação (HTTP ' + resposta.status + ').'));
            }

            // Nome do arquivo vem do Content-Disposition do servidor.
            var disposicao = resposta.headers.get('Content-Disposition') || '';
            var casamento = disposicao.match(/filename="?([^";]+)"?/i);

            var blob = await resposta.blob();
            var url = URL.createObjectURL(blob);
            var link = document.createElement('a');
            link.href = url;
            link.download = casamento ? casamento[1] : 'ordens_export.xlsx';
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            URL.revokeObjectURL(url);

            mostrarToast('Exportação concluída', ids.length + ' ordens exportadas para Excel.');
        } catch (erro) {
            console.error('Erro ao exportar para Excel:', erro);
            alert('Erro ao exportar para Excel: ' + erro.message);
        } finally {
            btnExportarExcel.disabled = false;
            btnExportarExcel.classList.remove('opacity-75', 'cursor-wait');
            if (label && textoOriginal !== null) label.textContent = textoOriginal;
        }
    });
}

// GERAÇÃO DE PRÉVIA EM MASSA
document.getElementById('btnGerarPrevia').addEventListener('click', function() {
    var ops = document.getElementById('listaOPs').value.split('\n').filter(function(linha) {
        return linha.trim() !== '';
    });
    var pecas = document.getElementById('listaPecas').value.split('\n').filter(function (linha) {
        return linha.trim() !== '';
    });
    var materiais = document.getElementById('listaMateriais').value.split('\n').filter(function (linha) {
        return linha.trim() !== '';
    });

    // Validação da regra dos materiais: até 8 dígitos numéricos
    for (var i = 0; i < materiais.length; i++) {
        var matLimpo = materiais[i].trim();
        if (matLimpo.length > 8 || !/^\d+$/.test(matLimpo)) {
            alert('Erro no Material na linha ' + (i + 1) + ' ("' + matLimpo + '"):\nO material deve respeitar a regra de ser numérico com no máximo 8 dígitos.');
            return;
        }
    }

    var tabelaprevia = document.getElementById('tabelaPrevia');
    var corpoTabelaPrevia = tabelaprevia.querySelector('tbody');
    var html = '';
    previaOrdens = [];

    var prioridadeEscolhida = document.getElementById('prioridadeLote').value;
    if (prioridadeEscolhida === '') {
        prioridadeEscolhida = null;
    }

    ops.forEach(function(op, indice) {
        var numOp = op.trim();
        var qtdPecas = pecas[indice] ? pecas[indice].trim() : '0';
        var mat = materiais[indice] ? materiais[indice].trim() : '';

        html += '<tr><td>' + numOp + '</td><td>' + qtdPecas + '</td><td>' + mat + '</td></tr>';

        previaOrdens.push({
            numero_op: numOp,
            total_pecas: parseQuantidade(qtdPecas) || 0,
            material: mat,
            setor: document.getElementById('setorLote').value,
            situacao: document.getElementById('situacaoLote').value,
            prioridade: prioridadeEscolhida,
            data_abertura: document.getElementById('dataAberturaLote').value || null,
            // No cadastro em lote a ordem e nova: a data informada vira a meia-noite
            // da fabrica (o backend faz o mesmo com AAAA-MM-DD).
            dia_analise: document.getElementById('diaAnaliseLote').value || null
        });
    });

    corpoTabelaPrevia.innerHTML = html;
});

// CONFIRMAÇÃO DO LOTE
document.getElementById('btnConfirmarLote').addEventListener('click', async function() {
    if (previaOrdens.length === 0) {
        alert('Gere a prévia antes de confirmar.');
        return;
    }

    var btn = document.getElementById('btnConfirmarLote');
    btn.disabled = true;

    try {
        var promessas = previaOrdens.map(function (ordem) {
            return authFetch('/ordens', {
                method: 'POST',
                body: JSON.stringify(ordem)
            }).then(function(res) {
                return res.json().then(function(dados) {
                    return { ok: res.ok, dados: dados };
                });
            });
        });

        var resultados = await Promise.all(promessas);
        var erros = resultados.filter(function(r) { return !r.ok; });

        if (erros.length > 0) {
            var msgs = erros.map(function(e) { return e.dados.erro; }).join('\n');
            alert('Algumas ordens falharam ao cadastrar:\n' + msgs);
        } else {
            alert('Todas as ' + previaOrdens.length + ' ordens foram cadastradas com sucesso!');
            previaOrdens = [];
            document.querySelector('#tabelaPrevia tbody').innerHTML = '';
            document.getElementById('listaOPs').value = '';
            document.getElementById('listaPecas').value = '';
            document.getElementById('listaMateriais').value = '';
        }

        carregarOrdensPendentes();
    } catch (e) {
        alert('Erro ao conectar ao servidor: ' + e.message);
    } finally {
        btn.disabled = false;
}
});

// Logout function - encerra a sessao no Supabase (nao existe mais rota local /auth/logout)
async function logout() {
    try {
        window.sbClearAuthCookie();
        await getClient()?.auth.signOut();
    } catch (e) {
        console.warn('[AUTH] signOut error:', e.message);
    }
    window.location.href = '/login';
}

document.getElementById('btn-logout')?.addEventListener('click', logout);

// Load user info on page load - usuario vem do JWT do Supabase (nao existe mais /auth/me)
async function loadUserInfo() {
    try {
        const sbClient = getClient();
        if (!sbClient) return;

        const { data, error } = await sbClient.auth.getUser();

        if (error || !data || !data.user) {
            // Sessao invalida/ausente => limpa tudo e volta para o login.
            // Erro de rede/timeout => NAO redireciona (evita loop de redirect).
            const status = error && error.status;
            const semSessao = !error || status === 401 || status === 403 ||
                (error.name || '').indexOf('Session') !== -1;
            console.warn('[AUTH] getUser falhou:', error && (error.name + ': ' + error.message));
            if (semSessao) {
                window.sbClearAuthCookie();
                try { await sbClient.auth.signOut(); } catch (e) { /* ignore */ }
                window.location.href = '/login';
            }
            return;
        }

        const user = data.user;
        const meta = user.user_metadata || {};
        const nomeExibicao = meta.name || meta.full_name || user.email || 'Usuário';
        const papel = meta.role || 'operator';

        const elNome = document.getElementById('user-name');
        const elRole = document.getElementById('user-role');
        const avatar = document.getElementById('user-avatar');

        if (elNome) elNome.textContent = nomeExibicao;
        if (elRole) elRole.textContent = papel;
        if (avatar) {
            avatar.textContent = nomeExibicao
                .split(' ')
                .filter(Boolean)
                .map(n => n[0])
                .join('')
                .toUpperCase()
                .slice(0, 2);
        }
    } catch (e) {
        console.error('Failed to load user info:', e);
    }
}

document.addEventListener('DOMContentLoaded', loadUserInfo);

// FILTROS POR SETOR (integração com filtros avançados)
document.querySelectorAll('.btnSetor').forEach(function(botao) {
    botao.addEventListener('click', function () {
        var setorEscolhido = botao.dataset.setor;

        // Reset all sectors, then enable only selected
        Object.keys(filtrosAvancados.setores).forEach(function(key) {
            filtrosAvancados.setores[key] = false;
        });
        filtrosAvancados.setores[setorEscolhido] = true;

        // Update checkboxes in filter drawer
        document.querySelectorAll('.filter-sector .filter-checkbox').forEach(function(cb) {
            cb.checked = (cb.value === setorEscolhido);
        });

        // Update sector tab UI
        document.querySelectorAll('.btnSetor').forEach(function(b) {
            b.classList.remove('active');
        });
        this.classList.add('active');
        var btnTodosEl = document.getElementById('btnTodos');
        if (btnTodosEl) {
            btnTodosEl.style.background = 'var(--bg-container-low)';
            btnTodosEl.style.color = 'var(--text-muted)';
        }

        aplicarFiltrosAvancados();
    });
});

document.getElementById('btnTodos').addEventListener('click', function () {
    // Enable all sectors
    Object.keys(filtrosAvancados.setores).forEach(function(key) {
        filtrosAvancados.setores[key] = true;
    });

    // Update checkboxes
    document.querySelectorAll('.filter-sector .filter-checkbox').forEach(function(cb) {
        cb.checked = true;
    });

    // Update sector tab UI
    document.querySelectorAll('.btnSetor').forEach(function(b) {
        b.classList.remove('active');
    });
    this.style.background = 'var(--primary)';
    this.style.color = '#fff';

    aplicarFiltrosAvancados();
});

// ==========================================================================
// SEQUENCIAMENTO DE ORDENS EM PDF (modal em 2 etapas)
// --------------------------------------------------------------------------
// Etapa 1: escolha dos setores. Etapa 2: ordens pendentes desses setores - todas
// marcadas - onde o usuario desmarca o que NAO deve entrar no PDF.
// Endpoint: POST /ordens/sequenciamento/pdf -> Blob application/pdf (inline)
// Body: { setores_selecionados: [...], ordens_selecionadas: [ids...] }
// Os valores de setor seguem o vocabulario do banco e das abas - 'Celula' sem
// acento (o rotulo na tela e "Célula").
// ==========================================================================
var SETORES_SEQUENCIAMENTO = ['Montagem', 'Subconjunto', 'BCM', 'Celula', 'Importada', 'Usinagem'];
var SETORES_PADRAO_SEQUENCIAMENTO = ['Montagem', 'Subconjunto', 'BCM', 'Celula'];

// Ordens que nao entram na folha: mesma regra de lib/sequenciamento-ordens.js.
// A lista de /ordens/pendentes ja exclui 'Encerrado'; 'Pago' sai aqui porque
// aquela rota tambem lista ordens pagas.
var SITUACOES_FORA_SEQUENCIAMENTO = ['Pago', 'Encerrado'];

var etapaSequenciamento = 'setores';   // 'setores' | 'ordens'
var ordensSequenciamento = [];         // ordens da etapa 2 (todas marcadas ao abrir)

function obterModalSequenciamento() {
    return document.getElementById('modal-sequenciamento');
}

// Aba de setor ativa na tela; null quando o usuario esta em "Todos".
function obterSetorAtivoDaTela() {
    var aba = document.querySelector('.btnSetor.active');
    return aba ? aba.dataset.setor : null;
}

function obterCheckboxesSequenciamento() {
    return document.querySelectorAll('.seq-setor-checkbox');
}

function marcarSetoresSequenciamento(marcados) {
    obterCheckboxesSequenciamento().forEach(function (checkbox) {
        checkbox.checked = marcados.indexOf(checkbox.value) !== -1;
    });
}

function obterSetoresMarcadosSequenciamento() {
    var marcados = [];
    obterCheckboxesSequenciamento().forEach(function (checkbox) {
        if (checkbox.checked) marcados.push(checkbox.value);
    });
    return marcados;
}

function mostrarAvisoSequenciamento(mensagem) {
    var aviso = document.getElementById('seq-aviso');
    var texto = document.getElementById('seq-aviso-texto');
    if (texto) texto.textContent = mensagem;
    if (aviso) aviso.classList.remove('hidden');
}

function esconderAvisoSequenciamento() {
    var aviso = document.getElementById('seq-aviso');
    if (aviso) aviso.classList.add('hidden');
}

// --------------------------------------------------------------------------
// ETAPA 2: lista de ordens
// --------------------------------------------------------------------------
function obterCheckboxesOrdensSequenciamento() {
    return document.querySelectorAll('#corpo-seq-ordens .seq-ordem-checkbox');
}

// Troca o conteudo do modal entre "setores" e "ordens" (chip, subtitulo, botoes,
// largura do card e foco). Nao busca nada nem fecha: so a apresentacao do passo.
function definirEtapaSequenciamento(etapa) {
    var nova = etapa === 'ordens' ? 'ordens' : 'setores';
    etapaSequenciamento = nova;

    var passoSetores = document.getElementById('seq-etapa-setores');
    var passoOrdens = document.getElementById('seq-etapa-ordens');
    if (passoSetores) passoSetores.classList.toggle('hidden', nova !== 'setores');
    if (passoOrdens) passoOrdens.classList.toggle('hidden', nova !== 'ordens');

    // A tabela de ordens precisa de mais largura que a grade de setores.
    var card = document.getElementById('card-sequenciamento');
    if (card) card.classList.toggle('seq-card-ordens', nova === 'ordens');

    var chip = document.getElementById('seq-etapa-chip');
    var subtitulo = document.getElementById('subtitulo-sequenciamento');
    var rotulo = document.getElementById('btn-confirmar-sequenciamento-label');
    var icone = document.getElementById('btn-confirmar-sequenciamento-icone');
    var botao = document.getElementById('btn-confirmar-sequenciamento');
    var cancelar = document.getElementById('btn-cancelar-sequenciamento');
    var voltar = document.getElementById('btn-voltar-sequenciamento');

    if (chip) chip.textContent = nova === 'ordens' ? 'Etapa 2 de 2' : 'Etapa 1 de 2';
    if (subtitulo) {
        subtitulo.textContent = nova === 'ordens'
            ? 'Desmarque as ordens que não devem entrar no PDF:'
            : 'Selecione os setores que deseja incluir no documento:';
    }
    if (rotulo) rotulo.textContent = nova === 'ordens' ? 'Gerar PDF' : 'Buscar Ordens';
    if (icone) icone.textContent = nova === 'ordens' ? 'print' : 'search';
    if (botao) botao.disabled = false;
    if (cancelar) cancelar.classList.toggle('hidden', nova === 'ordens');
    if (voltar) voltar.classList.toggle('hidden', nova !== 'ordens');

    // Mantem o fluxo por teclado: o foco entra no primeiro item da etapa.
    var alvo = nova === 'ordens'
        ? document.querySelector('#corpo-seq-ordens .seq-ordem-checkbox')
        : document.querySelector('.seq-setor-checkbox');
    if (alvo) alvo.focus();
}

// Linha desmarcada fica riscada/opaca: o usuario ve o que sai do documento.
function atualizarLinhaOrdemSequenciamento(caixa) {
    var linha = caixa.closest('tr');
    if (linha) linha.classList.toggle('seq-ordem-fora', !caixa.checked);
}

function atualizarContadorOrdensSequenciamento() {
    var caixas = obterCheckboxesOrdensSequenciamento();
    var marcadas = 0;
    caixas.forEach(function (caixa) {
        if (caixa.checked) marcadas++;
    });

    var contador = document.getElementById('seq-contador-ordens');
    if (contador) {
        var fora = caixas.length - marcadas;
        contador.innerHTML = '<strong>' + marcadas + '</strong> de ' + caixas.length + ' ordens selecionadas'
            + (fora ? ' <span class="seq-contador-corta">(' + fora + ' fora)</span>' : '');
    }

    // Checkbox do cabecalho: marcado quando todas entram, "meio marcado" no resto.
    var todas = document.getElementById('chk-todas-ordens');
    if (todas) {
        todas.checked = caixas.length > 0 && marcadas === caixas.length;
        todas.indeterminate = marcadas > 0 && marcadas < caixas.length;
    }
}

function renderizarOrdensSequenciamento() {
    var corpo = document.getElementById('corpo-seq-ordens');
    if (!corpo) return;

    var html = '';
    ordensSequenciamento.forEach(function (ordem) {
        var observacao = ordem.observacao === null || ordem.observacao === undefined
            ? ''
            : String(ordem.observacao).trim();

        html += '<tr data-id="' + escaparAtributo(ordem.id) + '">'
            + '<td class="seq-ordem-check">'
            + '  <input type="checkbox" class="seq-ordem-checkbox" value="' + escaparAtributo(ordem.id) + '" checked'
            + '         aria-label="Incluir a ordem ' + escaparAtributo(ordem.numero_op || ordem.id) + ' no PDF">'
            + '</td>'
            + '<td class="seq-op">' + escaparHtml(ordem.numero_op || '-') + '</td>'
            + '<td class="seq-material">' + escaparHtml(ordem.material || '-') + '</td>'
            + '<td class="seq-setor">' + escaparHtml(ordem.setor || '-') + '</td>'
            + '<td class="seq-obs' + (observacao ? '' : ' seq-obs-vazia') + '" title="' + escaparAtributo(observacao) + '">'
            + (observacao ? escaparHtml(observacao) : '—')
            + '</td>'
            + '</tr>';
    });

    corpo.innerHTML = html;

    var vazio = document.getElementById('seq-ordens-vazio');
    if (vazio) vazio.classList.toggle('hidden', ordensSequenciamento.length > 0);
    var tabela = document.getElementById('tabela-seq-ordens');
    if (tabela) tabela.classList.toggle('hidden', ordensSequenciamento.length === 0);

    atualizarContadorOrdensSequenciamento();
}

function marcarOrdensSequenciamento(marcar) {
    obterCheckboxesOrdensSequenciamento().forEach(function (caixa) {
        caixa.checked = !!marcar;
        atualizarLinhaOrdemSequenciamento(caixa);
    });
    atualizarContadorOrdensSequenciamento();
}

// IDs (numericos) das ordens que vao no PDF - e o campo ordens_selecionadas.
function obterIdsOrdensSequenciamento() {
    var ids = [];
    obterCheckboxesOrdensSequenciamento().forEach(function (caixa) {
        if (!caixa.checked) return;
        var id = Number(caixa.value);
        if (!isNaN(id)) ids.push(id);
    });
    return ids;
}

// Busca as ordens pendentes e passa para a etapa 2. Filtra no cliente porque
// /ordens/pendentes nao aceita recorte por setor; o universo e o mesmo do PDF
// (setores escolhidos, sem 'Pago' e sem 'Encerrado').
async function buscarOrdensSequenciamento() {
    var setores = obterSetoresMarcadosSequenciamento();
    if (!setores.length) {
        mostrarAvisoSequenciamento('Selecione pelo menos um setor para listar as ordens.');
        return;
    }

    var botao = document.getElementById('btn-confirmar-sequenciamento');
    var rotulo = document.getElementById('btn-confirmar-sequenciamento-label');
    if (!botao) return;
    var rotuloOriginal = rotulo ? rotulo.textContent : 'Buscar Ordens';

    esconderAvisoSequenciamento();
    botao.disabled = true;
    if (rotulo) rotulo.textContent = 'Buscando ordens...';

    try {
        var resposta = await authFetch('/ordens/pendentes');
        if (!resposta.ok) throw new Error('status ' + resposta.status);

        var dados = await resposta.json();
        var lista = Array.isArray(dados) ? dados : [];

        ordensSequenciamento = lista.filter(function (ordem) {
            if (setores.indexOf(ordem.setor) === -1) return false;
            return SITUACOES_FORA_SEQUENCIAMENTO.indexOf(ordem.situacao) === -1;
        });

        if (!ordensSequenciamento.length) {
            mostrarAvisoSequenciamento('Nenhuma ordem pendente nos setores selecionados.');
            return;
        }

        renderizarOrdensSequenciamento();
        definirEtapaSequenciamento('ordens');
    } catch (erro) {
        console.error('Erro ao buscar as ordens do sequenciamento:', erro);
        mostrarAvisoSequenciamento('Falha ao buscar as ordens pendentes. Tente novamente.');
    } finally {
        botao.disabled = false;
        // Se a busca deu certo, a etapa ja e a 2 e o rotulo e "Gerar PDF": nao mexer.
        if (etapaSequenciamento === 'setores' && rotulo) rotulo.textContent = rotuloOriginal;
    }
}

function abrirModalSequenciamento() {
    var modal = obterModalSequenciamento();
    if (!modal) return;

    // Pre-selecao: aba de setor ativa -> so ela; em "Todos" -> os quatro principais.
    var setorAtivo = obterSetorAtivoDaTela();
    marcarSetoresSequenciamento(setorAtivo ? [setorAtivo] : SETORES_PADRAO_SEQUENCIAMENTO);

    // Sempre abre na etapa 1, sem a lista da vez anterior.
    ordensSequenciamento = [];
    renderizarOrdensSequenciamento();
    esconderAvisoSequenciamento();

    modal.classList.remove('hidden');
    // Depois de visivel: elemento oculto nao recebe foco.
    definirEtapaSequenciamento('setores');
}

function fecharModalSequenciamento() {
    var modal = obterModalSequenciamento();
    if (!modal) return;
    modal.classList.add('hidden');

    // Devolve o foco ao botao que abriu (navegacao por teclado).
    var botaoAbrir = document.getElementById('btn-imprimir-sequenciamento');
    if (botaoAbrir) botaoAbrir.focus();
}

// Le a mensagem amigavel do backend ({ erro, detalhe }), sem estourar quando a
// resposta nao e JSON (ex.: proxy devolvendo HTML).
async function lerErroSequenciamento(resposta) {
    try {
        var dados = await resposta.json();
        if (dados && dados.erro) return dados.erro;
    } catch (erroLeitura) { /* resposta sem JSON */ }
    return 'O servidor respondeu com status ' + resposta.status + '.';
}

// ETAPA 2 -> PDF: manda os setores e APENAS os IDs das ordens marcadas.
async function gerarPdfSequenciamento() {
    var setores = obterSetoresMarcadosSequenciamento();
    var ids = obterIdsOrdensSequenciamento();

    if (!ids.length) {
        mostrarAvisoSequenciamento('Selecione pelo menos uma ordem para gerar o PDF.');
        return;
    }

    var botao = document.getElementById('btn-confirmar-sequenciamento');
    var rotulo = document.getElementById('btn-confirmar-sequenciamento-label');
    if (!botao) return;
    var rotuloOriginal = rotulo ? rotulo.textContent : 'Gerar PDF';

    esconderAvisoSequenciamento();
    botao.disabled = true;
    if (rotulo) rotulo.textContent = 'Gerando PDF...';

    // Abre a aba ANTES do await: window.open depois de uma espera assincrona e
    // tratado como pop-up e bloqueado. A URL do blob entra quando o PDF chega.
    var janelaPdf = window.open('', '_blank');

    try {
        var resposta = await authFetch('/ordens/sequenciamento/pdf', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                setores_selecionados: setores,
                ordens_selecionadas: ids
            })
        });

        if (!resposta.ok) {
            var mensagem = await lerErroSequenciamento(resposta);
            if (janelaPdf) janelaPdf.close();
            // Mantem o modal aberto para o usuario ajustar a selecao.
            mostrarAvisoSequenciamento(mensagem);
            return;
        }

        var blob = await resposta.blob();
        var url = URL.createObjectURL(blob);

        if (janelaPdf) {
            janelaPdf.location.href = url;
        } else {
            // Pop-up bloqueado: abre pela ancora (mesma experiencia de 1 clique).
            var link = document.createElement('a');
            link.href = url;
            link.target = '_blank';
            link.rel = 'noopener';
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
        }

        // A aba ja carregou o PDF; libera a memoria depois da impressao.
        setTimeout(function () { URL.revokeObjectURL(url); }, 60000);

        fecharModalSequenciamento();
        mostrarToast('Sequenciamento de Ordens',
            ids.length + ' de ' + ordensSequenciamento.length + ' ordem(ns) incluída(s) no PDF.');
    } catch (erro) {
        if (janelaPdf) janelaPdf.close();
        console.error('Erro ao gerar o sequenciamento:', erro);
        mostrarAvisoSequenciamento('Falha de conexão ao gerar o sequenciamento. Tente novamente.');
    } finally {
        botao.disabled = false;
        if (rotulo) rotulo.textContent = rotuloOriginal;
    }
}

// O botao primario muda de papel conforme a etapa.
function confirmarSequenciamento() {
    if (etapaSequenciamento === 'ordens') {
        gerarPdfSequenciamento();
    } else {
        buscarOrdensSequenciamento();
    }
}

(function configurarModalSequenciamento() {
    var botaoAbrir = document.getElementById('btn-imprimir-sequenciamento');
    var modal = obterModalSequenciamento();
    if (!botaoAbrir || !modal) return;

    botaoAbrir.addEventListener('click', abrirModalSequenciamento);
    document.getElementById('btn-confirmar-sequenciamento').addEventListener('click', confirmarSequenciamento);
    document.getElementById('btn-cancelar-sequenciamento').addEventListener('click', fecharModalSequenciamento);
    document.getElementById('btn-fechar-sequenciamento').addEventListener('click', fecharModalSequenciamento);

    document.getElementById('btn-marcar-todos-sequenciamento').addEventListener('click', function () {
        marcarSetoresSequenciamento(SETORES_SEQUENCIAMENTO);
    });

    document.getElementById('btn-desmarcar-todos-sequenciamento').addEventListener('click', function () {
        marcarSetoresSequenciamento([]);
    });

    // Etapa 2: voltar para os setores sem perder a escolha feita.
    document.getElementById('btn-voltar-sequenciamento').addEventListener('click', function () {
        definirEtapaSequenciamento('setores');
    });

    document.getElementById('btn-marcar-todas-ordens').addEventListener('click', function () {
        marcarOrdensSequenciamento(true);
    });

    document.getElementById('btn-desmarcar-todas-ordens').addEventListener('click', function () {
        marcarOrdensSequenciamento(false);
    });

    document.getElementById('chk-todas-ordens').addEventListener('change', function (evento) {
        marcarOrdensSequenciamento(evento.target.checked);
    });

    // Delegacao: as linhas sao recriadas a cada busca, o listener fica no tbody.
    document.getElementById('corpo-seq-ordens').addEventListener('change', function (evento) {
        var caixa = evento.target;
        if (!caixa || !caixa.classList.contains('seq-ordem-checkbox')) return;
        atualizarLinhaOrdemSequenciamento(caixa);
        atualizarContadorOrdensSequenciamento();
    });

    // Clique no fundo escuro fecha; clique dentro do card nao.
    modal.addEventListener('click', function (evento) {
        if (evento.target === modal) fecharModalSequenciamento();
    });

    // Esc: na etapa 2 volta para os setores (nao perde a lista por engano);
    // na etapa 1 fecha, como no editor inline da tabela.
    document.addEventListener('keydown', function (evento) {
        if (evento.key !== 'Escape') return;
        if (modal.classList.contains('hidden')) return;
        if (etapaSequenciamento === 'ordens') {
            definirEtapaSequenciamento('setores');
            return;
        }
        fecharModalSequenciamento();
    });
})();

// ORDENAÇÃO POR CABEÇALHO
document.querySelectorAll('[data-campo]').forEach(function (cabecalho) {
    cabecalho.addEventListener('click', function () {
        var campo = cabecalho.dataset.campo;
        ordenarPor(campo);
    });
});

// ==========================================================================
// TAREFA 1: EDIÇÃO ESTILO PLANILHA (INLINE)
// ==========================================================================
// Prioridades que o editor inline oferece (mesmas do modal de cadastro).
var PRIORIDADES_EDITAVEIS = ['Exportacao', 'MWM', 'KS', 'Marelli', 'Pendencia Comercial', 'Linha Pesada', 'MRP', 'Tryout'];

// Prioridade vazia significa "sem prioridade" no banco (NULL), nao string vazia.
// Usada no PUT e na comparacao de igualdade: null e '' precisam contar como o
// mesmo valor, senao limpar uma prioridade que ja esta vazia geraria requisicao.
function normalizarPrioridadeEditada(valor) {
    if (valor === null || valor === undefined) return null;
    var texto = String(valor).trim();
    return texto === '' ? null : texto;
}

function iniciarEdicaoCelula(td) {
    esconderTooltipObs(); // o balao nao pode ficar aberto sobre o editor inline

    if (celulaEmEdicao && celulaEmEdicao !== td) {
        cancelarEdicao(celulaEmEdicao);
    }

    var tr = td.closest('tr');
    if (!tr) return;
    var id = tr.dataset.id;
    var coluna = td.dataset.coluna;
    if (!coluna) return;

    var ordem = ordensCarregadas.find(function(o) { return String(o.id) === String(id); });
    if (!ordem) return;

    // O turno e derivado de dia_analise: sem pagamento registrado nao ha turno
    // para editar, e criar um timestamp aqui faria a ordem contar como paga nos KPIs.
    if (coluna === 'turno' && !ordem.dia_analise) {
        mostrarToast('Marque a ordem como Paga para registrar o turno.');
        return;
    }

    celulaEmEdicao = td;
    td.dataset.originalHtml = td.innerHTML;

    // A coluna Turno nao existe no registro: o valor de origem e dia_analise,
    // que e o que o seletor precisa para marcar o turno atual e para calcular
    // a nova hora ao salvar.
    var valorAtual = coluna === 'turno' ? ordem.dia_analise : ordem[coluna];
    if (valorAtual === null || valorAtual === undefined) valorAtual = '';

    var editor;
    if (coluna === 'turno') {
        editor = document.createElement('select');
        editor.className = 'cell-editor-select';
        ['T1', 'T2', 'T3'].forEach(function(val) {
            var opt = document.createElement('option');
            opt.value = val;
            opt.textContent = val + ' (' + String(INICIO_TURNO[val].hora).padStart(2, '0') + ':' + String(INICIO_TURNO[val].minuto).padStart(2, '0') + ')';
            if (val === obterTurno(valorAtual)) opt.selected = true;
            editor.appendChild(opt);
        });
    } else if (coluna === 'situacao') {
        editor = document.createElement('select');
        editor.className = 'cell-editor-select';
        ['Falta Pagar', 'Pago', 'Encerrado'].forEach(function(val) {
            var opt = document.createElement('option');
            opt.value = val;
            opt.textContent = val;
            if (val === valorAtual) opt.selected = true;
            editor.appendChild(opt);
        });
    } else if (coluna === 'setor') {
        editor = document.createElement('select');
        editor.className = 'cell-editor-select';
        ['Montagem', 'Subconjunto', 'Celula', 'BCM', 'Importada', 'Usinagem'].forEach(function(val) {
            var opt = document.createElement('option');
            opt.value = val;
            opt.textContent = val;
            if (val === valorAtual) opt.selected = true;
            editor.appendChild(opt);
        });
    } else if (coluna === 'prioridade') {
        editor = document.createElement('select');
        editor.className = 'cell-editor-select';
        // A primeira opcao limpa a prioridade (vira NULL no banco). Se a ordem
        // tiver um valor fora da lista, ele entra no fim para nao desaparecer
        // da tela so porque o seletor foi aberto.
        var opcoesPrioridade = [''].concat(PRIORIDADES_EDITAVEIS);
        if (valorAtual && opcoesPrioridade.indexOf(valorAtual) === -1) {
            opcoesPrioridade.push(valorAtual);
        }
        opcoesPrioridade.forEach(function(val) {
            var opt = document.createElement('option');
            opt.value = val;
            opt.textContent = val === '' ? '- Limpar prioridade' : val;
            if (val === valorAtual) opt.selected = true;
            editor.appendChild(opt);
        });
    } else if (coluna === 'data_abertura' || coluna === 'dia_analise') {
        editor = document.createElement('input');
        editor.type = 'date';
        editor.className = 'cell-editor-input';
        editor.value = valorAtual ? String(valorAtual).substring(0, 10) : '';
    } else if (coluna === 'total_pecas') {
        editor = document.createElement('input');
        editor.type = 'number';
        editor.min = '1';
        editor.step = '1';
        editor.className = 'cell-editor-input';
        editor.value = valorAtual;
    } else if (coluna === 'material') {
        editor = document.createElement('input');
        editor.type = 'text';
        editor.maxLength = 8;
        editor.className = 'cell-editor-input';
        editor.value = valorAtual;
        editor.placeholder = 'Máx 8 dígitos';
    } else {
        editor = document.createElement('input');
        editor.type = 'text';
        editor.className = 'cell-editor-input';
        editor.value = valorAtual;
    }

    td.innerHTML = '';
    td.appendChild(editor);
    td.classList.add('cell-editing');

    editor.focus();
    if (editor.select) editor.select();

    editor.addEventListener('click', function(e) { e.stopPropagation(); });
    editor.addEventListener('dblclick', function(e) { e.stopPropagation(); });

    editor.addEventListener('keydown', function(e) {
        if (e.key === 'Enter') {
            e.preventDefault();
            salvarEdicao(td, editor, id, coluna, valorAtual);
        } else if (e.key === 'Escape') {
            e.preventDefault();
            cancelarEdicao(td);
        }
    });
}

function cancelarEdicao(td) {
    if (!td) return;
    td.innerHTML = td.dataset.originalHtml || '';
    td.classList.remove('cell-editing');
    if (celulaEmEdicao === td) celulaEmEdicao = null;
}

async function salvarEdicao(td, editor, id, coluna, valorOriginal) {
    var novoValor = editor.value;

    // Prioridade vazia = sem prioridade: o banco guarda NULL, nao string vazia.
    if (coluna === 'prioridade') {
        novoValor = normalizarPrioridadeEditada(novoValor);
    }

    if (coluna === 'turno') {
        // Mantem a data do pagamento e troca a hora para o inicio do turno escolhido.
        var turnoEscolhido = String(novoValor || '').trim();
        if (turnoEscolhido === obterTurno(valorOriginal)) {
            cancelarEdicao(td);
            return;
        }
        var comTurno = diaAnaliseComTurno(valorOriginal, turnoEscolhido);
        if (!comTurno) {
            alert('Erro: não foi possível aplicar o turno.');
            cancelarEdicao(td);
            return;
        }
        await salvarColuna(td, editor, id, 'dia_analise', comTurno);
        return;
    }

    if (coluna === 'dia_analise') {
        // O editor e type="date" e so carrega AAAA-MM-DD: preserva a hora do
        // pagamento para o turno nao virar T3 a cada correcao de data.
        var soData = novoValor ? String(novoValor).trim() : null;
        novoValor = soData ? (diaAnaliseComData(valorOriginal, soData) || soData) : null;
        if (mesmaDataAnalise(valorOriginal, novoValor)) {
            cancelarEdicao(td);
            return;
        }
    }

    if (coluna === 'total_pecas') {
        var num = parseQuantidade(novoValor);
        if (isNaN(num) || num <= 0) {
            alert('Erro: O total de peças deve ser um número maior que zero.');
            editor.focus();
            return;
        }
        novoValor = num;
    }

    if (coluna === 'numero_op') {
        novoValor = String(novoValor).trim();
        if (!novoValor) {
            alert('Erro: O número da OP não pode ficar em branco.');
            editor.focus();
            return;
        }
    }

    if (coluna === 'material') {
        novoValor = String(novoValor).trim();
        if (novoValor && (novoValor.length > 8 || !/^\d+$/.test(novoValor))) {
            alert('Erro: O material deve respeitar a regra de ser numérico com no máximo 8 dígitos.');
            editor.focus();
            return;
        }
    }

    if (coluna === 'dia_analise' || coluna === 'data_abertura') {
        novoValor = novoValor ? novoValor.trim() : null;
    }

    // Se o valor for idêntico ao original, apenas cancela edição.
    // dia_analise compara o INSTANTE (ver mesmaDataAnalise): comparar so os 10
    // primeiros caracteres descartava em silencio a troca de turno no mesmo dia.
    // prioridade compara normalizada: null e '' sao o mesmo "sem prioridade".
    var igual = coluna === 'dia_analise'
        ? mesmaDataAnalise(valorOriginal, novoValor)
        : coluna === 'prioridade'
            ? normalizarPrioridadeEditada(valorOriginal) === normalizarPrioridadeEditada(novoValor)
            : (valorOriginal ? String(valorOriginal).substring(0, 10) : '') === (novoValor ? String(novoValor).substring(0, 10) : '');
    if (igual) {
        cancelarEdicao(td);
        return;
    }

    await salvarColuna(td, editor, id, coluna, novoValor);
}

// Envia o PUT e sincroniza as tres listas em memoria. Extraido para o turno
// poder salvar a coluna dia_analise reaproveitando o mesmo caminho.
async function salvarColuna(td, editor, id, coluna, novoValor) {
    editor.disabled = true;

    try {
        var resposta = await authFetch('/ordens/' + id, {
            method: 'PUT',
            body: JSON.stringify({ [coluna]: novoValor })
        });

        var dados = await resposta.json();

        if (!resposta.ok) {
            alert('Erro ao salvar: ' + (dados.erro || 'Falha ao atualizar ordem.'));
            editor.disabled = false;
            editor.focus();
            return;
        }

        var ordemAtualizada = dados.ordem;
        var idx = ordensCarregadas.findIndex(function(o) { return String(o.id) === String(id); });
        if (idx !== -1) {
            if (ordemAtualizada) {
                ordensCarregadas[idx] = ordemAtualizada;
            } else {
                ordensCarregadas[idx][coluna] = novoValor;
            }
        }

        var idxAtual = listaAtual.findIndex(function(o) { return String(o.id) === String(id); });
        if (idxAtual !== -1) {
            if (ordemAtualizada) {
                listaAtual[idxAtual] = ordemAtualizada;
            } else {
                listaAtual[idxAtual][coluna] = novoValor;
            }
        }

        celulaEmEdicao = null;
        // Atualizar listaFiltrada se o item estiver nela (filtros ativos)
        var idxFiltrada = listaFiltrada.findIndex(function(o) { return String(o.id) === String(id); });
        if (idxFiltrada !== -1) {
            if (ordemAtualizada) {
                listaFiltrada[idxFiltrada] = ordemAtualizada;
            } else {
                listaFiltrada[idxFiltrada][coluna] = novoValor;
            }
        }
        renderizarTabelaComPaginacao(listaFiltrada);
        mostrarToast('Ordem atualizada com sucesso!');
    } catch (err) {
        alert('Erro de conexão ao salvar: ' + err.message);
        editor.disabled = false;
        editor.focus();
    }
}

// ==========================================================================
// TAREFA 2: EDIÇÃO EM MASSA & REMOÇÃO
// ==========================================================================
function atualizarEstadoSelecao() {
    var checkboxes = document.querySelectorAll('.check-ordem');
    var marcadas = Array.from(checkboxes).filter(function(c) { return c.checked; });
    var total = checkboxes.length;
    var checkTodas = document.getElementById('checkTodas');
    var barra = document.getElementById('barraEdicaoMassa');
    var labelQtd = document.getElementById('bulk-selected-count');

    if (checkTodas) {
        if (total > 0 && marcadas.length === total) {
            checkTodas.checked = true;
            checkTodas.indeterminate = false;
        } else if (marcadas.length > 0) {
            checkTodas.checked = false;
            checkTodas.indeterminate = true;
        } else {
            checkTodas.checked = false;
            checkTodas.indeterminate = false;
        }
    }

    if (barra) {
        if (marcadas.length > 0) {
            barra.style.display = 'flex';
            if (labelQtd) {
                labelQtd.innerText = marcadas.length + (marcadas.length === 1 ? ' ordem selecionada' : ' ordens selecionadas');
            }
        } else {
            barra.style.display = 'none';
        }
    }
}

function obterIdsSelecionados() {
    var marcadas = document.querySelectorAll('.check-ordem:checked');
    return Array.from(marcadas).map(function(c) { return parseInt(c.value, 10); });
}

function renderizarCampoValorMassa() {
    var campoSelect = document.getElementById('campoMassa');
    var container = document.getElementById('containerValorMassa');
    if (!campoSelect || !container) return;

    var campo = campoSelect.value;
    container.innerHTML = '';

    if (campo === 'situacao') {
        var select = document.createElement('select');
        select.id = 'valorMassa';
        select.className = 'bulk-input';
        ['Falta Pagar', 'Pago', 'Encerrado'].forEach(function(val) {
            var opt = document.createElement('option');
            opt.value = val;
            opt.textContent = val;
            select.appendChild(opt);
        });
        container.appendChild(select);
    } else if (campo === 'setor') {
        var select = document.createElement('select');
        select.id = 'valorMassa';
        select.className = 'bulk-input';
        ['Montagem', 'Subconjunto', 'Celula', 'BCM', 'Importada', 'Usinagem'].forEach(function(val) {
            var opt = document.createElement('option');
            opt.value = val;
            opt.textContent = val;
            select.appendChild(opt);
        });
        container.appendChild(select);
    } else if (campo === 'prioridade') {
        var select = document.createElement('select');
        select.id = 'valorMassa';
        select.className = 'bulk-input';
        ['Exportacao', 'MWM', 'KS', 'Marelli', 'Pendencia Comercial', 'Linha Pesada', 'MRP', 'Tryout'].forEach(function(val) {
            var opt = document.createElement('option');
            opt.value = val;
            opt.textContent = val;
            select.appendChild(opt);
        });
        container.appendChild(select);
    } else if (campo === 'data_abertura' || campo === 'dia_analise') {
        var input = document.createElement('input');
        input.type = 'date';
        input.id = 'valorMassa';
        input.className = 'bulk-input';
        container.appendChild(input);
        if (campo === 'dia_analise') {
            // O valor digitado aqui e so a data: a hora do pagamento e preservada
            // por ordem em aplicarEdicaoEmMassa (ver diaAnaliseComData).
            input.title = 'A hora do pagamento de cada ordem e preservada';
        }
    } else if (campo === 'total_pecas') {
        var input = document.createElement('input');
        input.type = 'number';
        input.min = '1';
        input.step = '1';
        input.id = 'valorMassa';
        input.className = 'bulk-input';
        input.placeholder = 'Ex: 100';
        container.appendChild(input);
    } else if (campo === 'material') {
        var input = document.createElement('input');
        input.type = 'text';
        input.maxLength = 8;
        input.id = 'valorMassa';
        input.className = 'bulk-input';
        input.placeholder = 'Máx 8 dígitos (ex: 40005698)';
        container.appendChild(input);
    } else {
        var input = document.createElement('input');
        input.type = 'text';
        input.id = 'valorMassa';
        input.className = 'bulk-input';
        input.placeholder = 'Digite o novo valor...';
        container.appendChild(input);
    }
}

async function aplicarEdicaoEmMassa() {
    var ids = obterIdsSelecionados();
    if (ids.length === 0) {
        alert('Selecione ao menos uma ordem.');
        return;
    }

    var campo = document.getElementById('campoMassa').value;
    var valorEl = document.getElementById('valorMassa');
    var valor = valorEl ? valorEl.value : '';

    if (campo === 'total_pecas') {
        var n = parseQuantidade(valor);
        if (isNaN(n) || n <= 0) {
            alert('Erro: O total de peças deve ser um número maior que zero.');
            return;
        }
        valor = n;
    }

    if (campo === 'material') {
        valor = String(valor).trim();
        if (valor && (valor.length > 8 || !/^\d+$/.test(valor))) {
            alert('Erro: O material deve respeitar a regra de ser numérico com no máximo 8 dígitos.');
            return;
        }
    }

    var btn = document.getElementById('btnAplicarMassa');
    if (btn) btn.disabled = true;

    // dia_analise: o input e type="date" (so AAAA-MM-DD). Monta o valor por ordem
    // preservando a hora do pagamento de cada uma, senao todas virariam T3.
    var porOrdem = null;
    if (campo === 'dia_analise' && valor) {
        porOrdem = {};
        ids.forEach(function(id) {
            var ordem = ordensCarregadas.find(function(o) { return String(o.id) === String(id); });
            porOrdem[id] = diaAnaliseComData(ordem ? ordem.dia_analise : null, valor);
        });
    }

    try {
        var promessas = ids.map(function(id) {
            var valorEnviado = porOrdem ? porOrdem[id] : valor;
            if (porOrdem && !valorEnviado) return Promise.resolve({ ok: true, status: 200, id: id, dados: {} });
            return authFetch('/ordens/' + id, {
                method: 'PUT',
                body: JSON.stringify({ [campo]: valorEnviado })
            }).then(function(res) {
                return res.json().then(function(dados) {
                    return { ok: res.ok, status: res.status, id: id, dados: dados };
                });
            });
        });

        var resultados = await Promise.all(promessas);
        var erros = resultados.filter(function(r) { return !r.ok; });
        var sucessos = resultados.filter(function(r) { return r.ok; });

        sucessos.forEach(function(r) {
            var updated = r.dados.ordem;
            var idx = ordensCarregadas.findIndex(function(o) { return o.id === r.id; });
            if (idx !== -1) {
                if (updated) {
                    ordensCarregadas[idx] = updated;
                } else {
                    ordensCarregadas[idx][campo] = valor;
                }
            }
            var idxAtual = listaAtual.findIndex(function(o) { return o.id === r.id; });
            if (idxAtual !== -1) {
                if (updated) {
                    listaAtual[idxAtual] = updated;
                } else {
                    listaAtual[idxAtual][campo] = valor;
                }
            }
            // Atualizar listaFiltrada também
            var idxFiltrada = listaFiltrada.findIndex(function(o) { return o.id === r.id; });
            if (idxFiltrada !== -1) {
                if (updated) {
                    listaFiltrada[idxFiltrada] = updated;
                } else {
                    listaFiltrada[idxFiltrada][campo] = valor;
                }
            }
        });

        renderizarTabelaComPaginacao(listaFiltrada);

        if (erros.length > 0) {
            var msgs = erros.map(function(e) { return 'ID ' + e.id + ': ' + (e.dados.erro || 'Erro'); }).join('\n');
            alert('Algumas ordens falharam ao atualizar:\n' + msgs);
        } else {
            mostrarToast(sucessos.length + ' ordens atualizadas com sucesso!');
        }
    } catch (err) {
        alert('Erro de conexão: ' + err.message);
    } finally {
        if (btn) btn.disabled = false;
    }
}

// REMOÇÃO INDIVIDUAL
async function removerOrdemIndividual(id, op) {
    if (!confirm('Deseja realmente remover a ordem OP ' + (op || id) + '?')) {
        return;
    }

    try {
        var res = await authFetch('/ordens/' + id, {
            method: 'DELETE'
        });
        var dados = await res.json();

        if (!res.ok) {
            alert('Erro ao excluir: ' + (dados.erro || 'Falha ao remover'));
            return;
        }

        ordensCarregadas = ordensCarregadas.filter(function(o) { return o.id !== id; });
        listaFiltrada = listaFiltrada.filter(function(o) { return o.id !== id; });
        listaAtual = listaAtual.filter(function(o) { return o.id !== id; });
        renderizarTabelaComPaginacao(listaFiltrada);
        mostrarToast('Ordem OP ' + (op || id) + ' removida com sucesso!');
    } catch (err) {
        alert('Erro de conexão ao remover ordem: ' + err.message);
    }
}

// REMOÇÃO EM MASSA
async function removerOrdensEmMassa() {
    var ids = obterIdsSelecionados();
    if (ids.length === 0) {
        alert('Selecione ao menos uma ordem para remover.');
        return;
    }

    if (!confirm('Atenção: Deseja realmente remover permanentemente as ' + ids.length + ' ordens selecionadas?')) {
        return;
    }

    var btn = document.getElementById('btnExcluirMassa');
    if (btn) btn.disabled = true;

    try {
        var res = await authFetch('/ordens', {
            method: 'DELETE',
            body: JSON.stringify({ ids: ids })
        });
        var dados = await res.json();

        if (!res.ok) {
            alert('Erro ao excluir em massa: ' + (dados.erro || 'Falha ao remover ordens.'));
            return;
        }

        ordensCarregadas = ordensCarregadas.filter(function(o) { return !ids.includes(o.id); });
        listaFiltrada = listaFiltrada.filter(function(o) { return !ids.includes(o.id); });
        listaAtual = listaAtual.filter(function(o) { return !ids.includes(o.id); });
        renderizarTabelaComPaginacao(listaFiltrada);
        mostrarToast(ids.length + ' ordens removidas com sucesso!');
    } catch (err) {
        alert('Erro de conexão ao excluir em massa: ' + err.message);
    } finally {
        if (btn) btn.disabled = false;
    }
}

function mostrarToast(titulo, desc) {
    var toast = document.getElementById('toast-sap');
    if (!toast) return;
    var tTitle = document.getElementById('toast-title');
    var tDesc = document.getElementById('toast-desc');
    if (tTitle && titulo) tTitle.innerText = titulo;
    if (tDesc) tDesc.innerText = desc || '';
    toast.classList.add('show');
    setTimeout(function() {
        toast.classList.remove('show');
    }, 3500);
}

// ===== FUNÇÕES DE FILTROS AVANÇADOS =====
// Fonte de dados unica do pipeline: ordensCarregadas (lista completa da API).
// Cada etapa apenas REDUZ essa base, entao os filtros sao cumulativos:
// avançados (setor/prioridade/status/data) + filtro rapido de texto.
function passaFiltrosAvancados(ordem) {
    var prio = ordem.prioridade;
    var stat = ordem.situacao;
    var sect = ordem.setor;

    // Prioridade: se tem prioridade, verifica se está na lista permitida
    // se NÃO tem prioridade (null/undefined), verifica se __NULL__ está permitido
    if (prio !== null && prio !== undefined) {
        if (!filtrosAvancados.prioridades[prio]) return false;
    } else {
        if (!filtrosAvancados.prioridades['__NULL__']) return false;
    }

    // Status: passa se NULL/undefined OU se está na lista
    if (stat !== null && stat !== undefined && !filtrosAvancados.status[stat]) return false;
    // Setor: passa se NULL/undefined OU se está na lista
    if (sect !== null && sect !== undefined && !filtrosAvancados.setores[sect]) return false;

    // Filtro por data de abertura
    if (filtrosAvancados.dataInicio || filtrosAvancados.dataFim) {
        var dataAbertura = ordem.data_abertura ? ordem.data_abertura.substring(0, 10) : null;
        if (!dataAbertura) return false;
        if (filtrosAvancados.dataInicio && dataAbertura < filtrosAvancados.dataInicio) return false;
        if (filtrosAvancados.dataFim && dataAbertura > filtrosAvancados.dataFim) return false;
    }
    return true;
}

// Filtro rapido (#table-search): procura o termo em TODOS os campos exibidos na
// linha. Antes isso era feito escondendo <tr> via DOM, o que alcancava somente a
// pagina atual e era descartado em todo re-render (setor, ordenacao, paginacao).
function passaBuscaRapida(ordem) {
    if (!termoBuscaRapida) return true;

    var partes = [
        ordem.numero_op,
        ordem.total_pecas,
        formatarData(ordem.data_abertura),
        ordem.data_abertura,
        ordem.material,
        ordem.situacao,
        ordem.observacao,
        ordem.setor,
        ordem.prioridade,
        formatarDiaAnalise(ordem.dia_analise),
        ordem.dia_analise,
        // A coluna TURNO e visivel na tabela, entao tambem entra na busca rapida:
        // digitar "T3" lista o turno da noite, "T1" o da manha.
        obterTurno(ordem.dia_analise)
    ];

    for (var i = 0; i < partes.length; i++) {
        var valor = partes[i];
        if (valor === null || valor === undefined) continue;
        if (String(valor).toLowerCase().indexOf(termoBuscaRapida) !== -1) return true;
    }
    return false;
}

// Pipeline unico: ordensCarregadas -> filtros avancados -> filtro rapido -> paginacao
function aplicarFiltros() {
    var filtradas = ordensCarregadas.filter(function(ordem) {
        return passaFiltrosAvancados(ordem) && passaBuscaRapida(ordem);
    });

    paginacao.paginaAtual = 1;
    // Definir totalItens ANTES de renderizar evita o fallback de lista fatiada
    // (a heuristica de protecao dentro de renderizarTabelaComPaginacao).
    paginacao.totalItens = filtradas.length;
    paginacao.totalPaginas = Math.ceil(paginacao.totalItens / paginacao.itensPorPagina) || 1;

    renderizarTabelaComPaginacao(filtradas);
    atualizarContadoresFiltros();
}

// Mantido por compatibilidade com os pontos que ja chamavam os filtros avancados:
// agora todos passam pelo pipeline completo, entao o filtro rapido nunca e perdido.
function aplicarFiltrosAvancados() {
    aplicarFiltros();
}

// Filtro rapido de texto da tabela (#table-search)
var inputBuscaRapida = document.getElementById('table-search');
if (inputBuscaRapida) {
    inputBuscaRapida.addEventListener('input', function (e) {
        termoBuscaRapida = e.target.value.toLowerCase().trim();
        aplicarFiltros();
    });
}

function resetarFiltrosAvancados() {
    filtrosAvancados.prioridades = {
        'Exportacao': true, 'KS': true, 'Marelli': true, 'MWM': true,
        'Pendencia Comercial': true,
        'Linha Pesada': true, 'MRP': true, 'Tryout': true,
        '__NULL__': true
    };
    filtrosAvancados.status = { 'Falta Pagar': true, 'Pago': true, 'Encerrado': true };
    filtrosAvancados.setores = { 'Montagem': true, 'Subconjunto': true, 'Celula': true, 'BCM': true, 'Importada': true, 'Usinagem': true };
    filtrosAvancados.dataInicio = null;
    filtrosAvancados.dataFim = null;

    // Reset ALL priority checkboxes (across all tabs)
    document.querySelectorAll('.filter-group .filter-checkbox, .filter-priority-list .filter-checkbox').forEach(function(cb) {
        cb.checked = true;
    });
    document.querySelectorAll('.filter-status .filter-checkbox').forEach(function(cb) {
        cb.checked = true;
    });
    document.querySelectorAll('.filter-sector .filter-checkbox').forEach(function(cb) {
        cb.checked = true;
    });

    // Reset date inputs
    var filterDateStart = document.getElementById('filter-date-start');
    var filterDateEnd = document.getElementById('filter-date-end');
    if (filterDateStart) filterDateStart.value = '';
    if (filterDateEnd) filterDateEnd.value = '';

    // Resetar os filtros avancados devolve a base completa, mas o filtro rapido
    // do campo #table-search continua valendo: os filtros sao cumulativos.
    aplicarFiltros();
}

function atualizarContadoresFiltros() {
    // Atualiza contadores nas labels dos filtros - usa listaFiltrada (filtrada visível)
    var counts = { prioridades: {}, status: {}, setores: {} };
    var sourceList = (typeof listaFiltrada !== 'undefined' && listaFiltrada) ? listaFiltrada : ordensCarregadas;

    sourceList.forEach(function(ordem) {
        var prioKey = ordem.prioridade || '__NULL__';
        if (counts.prioridades[prioKey] === undefined) counts.prioridades[prioKey] = 0;
        counts.prioridades[prioKey]++;

        if (counts.status[ordem.situacao] === undefined) counts.status[ordem.situacao] = 0;
        counts.status[ordem.situacao]++;

        if (counts.setores[ordem.setor] === undefined) counts.setores[ordem.setor] = 0;
        counts.setores[ordem.setor]++;
    });

    // Atualiza elementos DOM - grupos de prioridade
    var grupoRedCount = 0;
    var grupoAmberCount = 0;
    var grupoSlateCount = 0;
    var grupoNullCount = counts.prioridades['__NULL__'] || 0;
    var grupoRedKeys = ['Exportacao', 'KS', 'Marelli', 'MWM'];
    var grupoAmberKeys = ['Pendencia Comercial'];
    var grupoSlateKeys = ['Linha Pesada', 'MRP', 'Tryout'];

    Object.keys(counts.prioridades).forEach(function(key) {
        var count = counts.prioridades[key];
        
        if (grupoRedKeys.includes(key)) grupoRedCount += count;
        else if (grupoAmberKeys.includes(key)) grupoAmberCount += count;
        else if (grupoSlateKeys.includes(key)) grupoSlateCount += count;
    });

    var elRed = document.getElementById('count-red');
    if (elRed) elRed.innerText = grupoRedCount;
    
    var elAmber = document.getElementById('count-amber');
    if (elAmber) elAmber.innerText = grupoAmberCount;
    
    var elSlate = document.getElementById('count-slate');
    if (elSlate) elSlate.innerText = grupoSlateCount;

    var elNull = document.getElementById('count-null');
    if (elNull) elNull.innerText = grupoNullCount;

    // Status counts (filtered visible)
    Object.keys(counts.status).forEach(function(key) {
        var el = document.getElementById('count-status-' + key.toLowerCase().replace(' ', '-'));
        if (el) el.innerText = counts.status[key];
    });

    // Sector counts (filtered visible) - optional
    Object.keys(counts.setores).forEach(function(key) {
        // Contadores de setor podem ser adicionados se necessário
    });
}

// ===== FUNÇÕES DE PAGINAÇÃO =====
function renderizarTabelaComPaginacao(lista) {
    // Proteção: detectar se está recebendo lista fatiada (page slice) em vez da lista completa
    // Se totalItens já foi definido e a nova lista tem menos itens que o esperado, logar aviso
    if (paginacao.totalItens > 0 && lista.length < paginacao.totalItens && lista.length <= paginacao.itensPorPagina) {
        console.warn('[renderizarTabelaComPaginacao] ALERTA: Recebida lista com', lista.length, 'itens, mas totalItens era', paginacao.totalItens, '. Provável uso indevido de listaAtual em vez de listaFiltrada.');
        // Fallback seguro: usar listaFiltrada existente se disponível
        if (listaFiltrada && listaFiltrada.length >= paginacao.totalItens) {
            console.log('[renderizarTabelaComPaginacao] Usando listaFiltrada existente como fallback.');
            lista = listaFiltrada;
        }
    }

    listaFiltrada = lista;
    paginacao.totalItens = lista.length;
    paginacao.totalPaginas = Math.ceil(paginacao.totalItens / paginacao.itensPorPagina) || 1;

    if (paginacao.paginaAtual > paginacao.totalPaginas) {
        paginacao.paginaAtual = paginacao.totalPaginas;
    }

    var inicio = (paginacao.paginaAtual - 1) * paginacao.itensPorPagina;
    var fim = Math.min(inicio + paginacao.itensPorPagina, paginacao.totalItens);
    var paginaItens = lista.slice(inicio, fim);

    listaAtual = paginaItens;
    renderizarTabela(paginaItens);
    atualizarControlesPaginacao();
}

function atualizarControlesPaginacao() {
    var startEl = document.getElementById('pagination-start');
    var endEl = document.getElementById('pagination-end');
    var totalEl = document.getElementById('pagination-total');
    var pagesEl = document.getElementById('pagination-pages');
    var prevBtn = document.getElementById('pagination-prev');
    var nextBtn = document.getElementById('pagination-next');
    var firstBtn = document.getElementById('pagination-first');
    var lastBtn = document.getElementById('pagination-last');

    var inicio = paginacao.totalItens === 0 ? 0 : (paginacao.paginaAtual - 1) * paginacao.itensPorPagina + 1;
    var fim = Math.min(paginacao.paginaAtual * paginacao.itensPorPagina, paginacao.totalItens);

    if (startEl) startEl.innerText = inicio;
    if (endEl) endEl.innerText = fim;
    if (totalEl) totalEl.innerText = paginacao.totalItens;

    // Botões de navegação
    if (prevBtn) prevBtn.disabled = paginacao.paginaAtual <= 1;
    if (nextBtn) nextBtn.disabled = paginacao.paginaAtual >= paginacao.totalPaginas;
    if (firstBtn) firstBtn.disabled = paginacao.paginaAtual <= 1;
    if (lastBtn) lastBtn.disabled = paginacao.paginaAtual >= paginacao.totalPaginas;

    // Páginas numeradas
    if (pagesEl) {
        var html = '';
        var maxPages = 5;
        var startPage = Math.max(1, paginacao.paginaAtual - Math.floor(maxPages / 2));
        var endPage = Math.min(paginacao.totalPaginas, startPage + maxPages - 1);

        if (startPage > 1) {
            html += '<button class="pagination-page" data-page="1">1</button>';
            if (startPage > 2) html += '<span class="pagination-ellipsis">...</span>';
        }

        for (var p = startPage; p <= endPage; p++) {
            html += '<button class="pagination-page' + (p === paginacao.paginaAtual ? ' active' : '') + '" data-page="' + p + '">' + p + '</button>';
        }

        if (endPage < paginacao.totalPaginas) {
            if (endPage < paginacao.totalPaginas - 1) html += '<span class="pagination-ellipsis">...</span>';
            html += '<button class="pagination-page" data-page="' + paginacao.totalPaginas + '">' + paginacao.totalPaginas + '</button>';
        }

        pagesEl.innerHTML = html;

        // Event listeners para páginas
        pagesEl.querySelectorAll('.pagination-page').forEach(function(btn) {
            btn.addEventListener('click', function() {
                var page = parseInt(this.dataset.page, 10);
                if (page !== paginacao.paginaAtual) {
                    paginacao.paginaAtual = page;
                    renderizarTabelaComPaginacao(listaFiltrada);
                }
            });
        });
    }
}

// Inicialização dos listeners de edição e seleção
document.addEventListener('DOMContentLoaded', function() {
    var tabela = document.getElementById('tabelaOrdens');
    if (tabela) {
        var tbody = tabela.querySelector('tbody');
        if (tbody) {
            tbody.addEventListener('dblclick', function(e) {
                var td = e.target.closest('td');
                if (!td) return;
                if (td.classList.contains('td-check') || td.classList.contains('td-acoes')) return;
                iniciarEdicaoCelula(td);
            });

            tbody.addEventListener('change', function(e) {
                if (e.target && e.target.classList.contains('check-ordem')) {
                    atualizarEstadoSelecao();
                }
            });

            tbody.addEventListener('click', function(e) {
                var btnDel = e.target.closest('.btn-excluir-linha');
                if (btnDel) {
                    var id = parseInt(btnDel.dataset.id, 10);
                    var op = btnDel.dataset.op;
                    removerOrdemIndividual(id, op);
                }
            });
        }
    }

    var checkTodas = document.getElementById('checkTodas');
    if (checkTodas) {
        checkTodas.addEventListener('change', function() {
            var checkboxes = document.querySelectorAll('.check-ordem');
            checkboxes.forEach(function(cb) {
                cb.checked = checkTodas.checked;
            });
            atualizarEstadoSelecao();
        });
    }

    var campoMassa = document.getElementById('campoMassa');
    if (campoMassa) {
        campoMassa.addEventListener('change', renderizarCampoValorMassa);
        renderizarCampoValorMassa();
    }

    var btnAplicarMassa = document.getElementById('btnAplicarMassa');
    if (btnAplicarMassa) {
        btnAplicarMassa.addEventListener('click', aplicarEdicaoEmMassa);
    }

    var btnExcluirMassa = document.getElementById('btnExcluirMassa');
    if (btnExcluirMassa) {
        btnExcluirMassa.addEventListener('click', removerOrdensEmMassa);
    }

    var btnDesmarcar = document.getElementById('btnDesmarcarTodas');
    if (btnDesmarcar) {
        btnDesmarcar.addEventListener('click', function() {
            var checkboxes = document.querySelectorAll('.check-ordem');
            checkboxes.forEach(function(cb) { cb.checked = false; });
            atualizarEstadoSelecao();
        });
    }

    // ===== FILTER DRAWER =====
    var filterDrawer = document.getElementById('filter-drawer');
    var btnToggleFilters = document.getElementById('btn-toggle-filters');
    var btnMinimizeDrawer = document.getElementById('btn-minimize-drawer');
    var btnApplyFilters = document.getElementById('btn-apply-filters');
    var btnResetFilters = document.getElementById('btn-reset-filters');

    function toggleFilterDrawer() {
        if (filterDrawer) {
            filterDrawer.classList.toggle('hidden');
        }
    }

    if (btnToggleFilters) {
        btnToggleFilters.addEventListener('click', toggleFilterDrawer);
    }
    if (btnMinimizeDrawer) {
        btnMinimizeDrawer.addEventListener('click', toggleFilterDrawer);
    }

    // ===== TAB SWITCHING =====
    var filterTabs = document.querySelectorAll('.filter-tab');
    var filterTabPanels = document.querySelectorAll('.filter-tab-panel');

    filterTabs.forEach(function(tab) {
        tab.addEventListener('click', function() {
            var targetTab = this.dataset.tab;
            
            // Update tab buttons
            filterTabs.forEach(function(t) {
                t.classList.remove('active');
                t.setAttribute('aria-selected', 'false');
            });
            this.classList.add('active');
            this.setAttribute('aria-selected', 'true');
            
            // Update tab panels
            filterTabPanels.forEach(function(panel) {
                panel.classList.remove('active');
                panel.classList.add('hidden');
            });
            var targetPanel = document.getElementById('tabpanel-' + targetTab);
            if (targetPanel) {
                targetPanel.classList.add('active');
                targetPanel.classList.remove('hidden');
            }
        });
    });

    // ===== PRIORITY CHECKBOXES (All tabs) =====
    var allPriorityCheckboxes = document.querySelectorAll('.filter-group .filter-checkbox, .filter-priority-list .filter-checkbox');
    allPriorityCheckboxes.forEach(function(cb) {
        cb.addEventListener('change', function() {
            var value = this.value;
            var checked = this.checked;
            filtrosAvancados.prioridades[value] = checked;
            
            // Sync checkboxes across tabs (same value)
            document.querySelectorAll('.filter-checkbox[value="' + value + '"]').forEach(function(otherCb) {
                if (otherCb !== this) otherCb.checked = checked;
            }.bind(this));
            
            aplicarFiltrosAvancados();
        });
    });

    // ===== PRIORITY PRESET BUTTONS =====
    var filterPresetBtns = document.querySelectorAll('.filter-preset-btn[data-preset]');
    filterPresetBtns.forEach(function(btn) {
        btn.addEventListener('click', function() {
            var preset = this.dataset.preset;
            var newPrioridades = {};
            
            // Default all to false
            ['Exportacao', 'KS', 'Marelli', 'MWM', 'Pendencia Comercial', 'Linha Pesada', 'MRP', 'Tryout', '__NULL__'].forEach(function(p) {
                newPrioridades[p] = false;
            });
            
            // Apply preset
            if (preset === 'criticas') {
                newPrioridades['Exportacao'] = true;
                newPrioridades['KS'] = true;
                newPrioridades['Marelli'] = true;
                newPrioridades['MWM'] = true;
            } else if (preset === 'comerciais') {
                newPrioridades['Pendencia Comercial'] = true;
            } else if (preset === 'padrao') {
                newPrioridades['Linha Pesada'] = true;
                newPrioridades['MRP'] = true;
                newPrioridades['Tryout'] = true;
            } else if (preset === 'all') {
                ['Exportacao', 'KS', 'Marelli', 'MWM', 'Pendencia Comercial', 'Linha Pesada', 'MRP', 'Tryout', '__NULL__'].forEach(function(p) {
                    newPrioridades[p] = true;
                });
            }
            
            filtrosAvancados.prioridades = newPrioridades;
            
            // Update all checkboxes
            allPriorityCheckboxes.forEach(function(cb) {
                cb.checked = newPrioridades[cb.value] === true;
            });
            
            aplicarFiltrosAvancados();
        });
    });

    // Status checkboxes
    document.querySelectorAll('.filter-status .filter-checkbox').forEach(function(cb) {
        cb.addEventListener('change', function() {
            filtrosAvancados.status[this.value] = this.checked;
            aplicarFiltrosAvancados();
        });
    });

    // Sector checkboxes
    document.querySelectorAll('.filter-sector .filter-checkbox').forEach(function(cb) {
        cb.addEventListener('change', function() {
            filtrosAvancados.setores[this.value] = this.checked;
            aplicarFiltrosAvancados();
        });
    });

    // ===== DATE PRESET QUICK BUTTONS =====
    var filterDatePresetBtns = document.querySelectorAll('.filter-preset-quick-btn[data-preset-date]');
    filterDatePresetBtns.forEach(function(btn) {
        btn.addEventListener('click', function() {
            var preset = this.dataset.presetDate;
            var hoje = new Date();
            var inicio = new Date();
            var fim = new Date();
            
            if (preset === 'month') {
                // Este Mês
                inicio = new Date(hoje.getFullYear(), hoje.getMonth(), 1);
                fim = new Date(hoje.getFullYear(), hoje.getMonth() + 1, 0);
            } else if (preset === 'prev-month') {
                // Mês Anterior
                inicio = new Date(hoje.getFullYear(), hoje.getMonth() - 1, 1);
                fim = new Date(hoje.getFullYear(), hoje.getMonth(), 0);
            } else if (preset === 'today') {
                // Hoje
                inicio = new Date(hoje.getFullYear(), hoje.getMonth(), hoje.getDate());
                fim = new Date(hoje.getFullYear(), hoje.getMonth(), hoje.getDate());
            } else if (preset === '7days') {
                // Últimos 7 dias
                inicio = new Date(hoje.getFullYear(), hoje.getMonth(), hoje.getDate() - 6);
                fim = hoje;
            }
            
            var fmt = function(d) {
                return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
            };
            
            filtrosAvancados.dataInicio = fmt(inicio);
            filtrosAvancados.dataFim = fmt(fim);
            
            var filterDateStart = document.getElementById('filter-date-start');
            var filterDateEnd = document.getElementById('filter-date-end');
            if (filterDateStart) filterDateStart.value = fmt(inicio);
            if (filterDateEnd) filterDateEnd.value = fmt(fim);
            
            aplicarFiltrosAvancados();
        });
    });

    // Date range inputs
    var filterDateStart = document.getElementById('filter-date-start');
    var filterDateEnd = document.getElementById('filter-date-end');
    if (filterDateStart) {
        filterDateStart.addEventListener('change', function() {
            filtrosAvancados.dataInicio = this.value || null;
        });
    }
    if (filterDateEnd) {
        filterDateEnd.addEventListener('change', function() {
            filtrosAvancados.dataFim = this.value || null;
        });
    }

    // Apply filters
    if (btnApplyFilters) {
        btnApplyFilters.addEventListener('click', function() {
            aplicarFiltrosAvancados();
            toggleFilterDrawer();
        });
    }

    // Reset filters
    if (btnResetFilters) {
        btnResetFilters.addEventListener('click', function() {
            resetarFiltrosAvancados();
        });
    }

    // ===== PAGINATION =====
    var paginationSize = document.getElementById('pagination-size');
    var paginationFirst = document.getElementById('pagination-first');
    var paginationPrev = document.getElementById('pagination-prev');
    var paginationNext = document.getElementById('pagination-next');
    var paginationLast = document.getElementById('pagination-last');

    if (paginationSize) {
        paginationSize.addEventListener('change', function() {
            paginacao.itensPorPagina = parseInt(this.value, 10);
            paginacao.paginaAtual = 1;
            renderizarTabelaComPaginacao(listaFiltrada);
        });
    }

    if (paginationFirst) {
        paginationFirst.addEventListener('click', function() {
            if (!this.disabled) {
                paginacao.paginaAtual = 1;
                renderizarTabelaComPaginacao(listaFiltrada);
            }
        });
    }

    if (paginationPrev) {
        paginationPrev.addEventListener('click', function() {
            if (!this.disabled && paginacao.paginaAtual > 1) {
                paginacao.paginaAtual--;
                renderizarTabelaComPaginacao(listaFiltrada);
            }
        });
    }

    if (paginationNext) {
        paginationNext.addEventListener('click', function() {
            if (!this.disabled && paginacao.paginaAtual < paginacao.totalPaginas) {
                paginacao.paginaAtual++;
                renderizarTabelaComPaginacao(listaFiltrada);
            }
        });
    }

    if (paginationLast) {
        paginationLast.addEventListener('click', function() {
            if (!this.disabled) {
                paginacao.paginaAtual = paginacao.totalPaginas;
                renderizarTabelaComPaginacao(listaFiltrada);
            }
        });
    }

    // ===== BATCH VALIDATION UI =====
    var txtOps = document.getElementById('listaOPs');
    var txtQtd = document.getElementById('listaPecas');
    var txtMat = document.getElementById('listaMateriais');
    var countOps = document.getElementById('count-ops');
    var countQtd = document.getElementById('count-qtd');
    var countMat = document.getElementById('count-mat');
    var previewTag = document.getElementById('preview-tag');

    function updateBatchCounters() {
        if (txtOps && countOps) {
            var linesOps = txtOps.value.split('\n').filter(function(l) { return l.trim().length > 0; }).length;
            countOps.innerText = linesOps + ' linhas';
        }
        if (txtQtd && countQtd) {
            var linesQtd = txtQtd.value.split('\n').filter(function(l) { return l.trim().length > 0; }).length;
            countQtd.innerText = linesQtd + ' linhas';
        }
        if (txtMat && countMat) {
            var linesMat = txtMat.value.split('\n').filter(function(l) { return l.trim().length > 0; }).length;
            countMat.innerText = linesMat + ' linhas';
        }
        // Preview tag validation
        if (previewTag && txtOps && txtQtd && txtMat) {
            var linesOps = txtOps.value.split('\n').filter(function(l) { return l.trim().length > 0; }).length;
            var linesQtd = txtQtd.value.split('\n').filter(function(l) { return l.trim().length > 0; }).length;
            var linesMat = txtMat.value.split('\n').filter(function(l) { return l.trim().length > 0; }).length;
            var valid = linesOps > 0 && linesOps === linesQtd && linesOps === linesMat;
            if (valid) {
                previewTag.classList.add('visible');
            } else {
                previewTag.classList.remove('visible');
            }
        }
    }

    if (txtOps) txtOps.addEventListener('input', updateBatchCounters);
    if (txtQtd) txtQtd.addEventListener('input', updateBatchCounters);
    if (txtMat) txtMat.addEventListener('input', updateBatchCounters);

    // ===== SAP BUFFER INDICATOR =====
    // Update SAP buffer badge when orders are copied
    var originalCopiar = document.getElementById('btnCopiar');
    if (originalCopiar) {
        originalCopiar.addEventListener('click', function() {
            var sapBadge = document.getElementById('badge-sap');
            if (sapBadge) {
                sapBadge.style.display = 'flex';
                setTimeout(function() {
                    sapBadge.style.display = 'none';
                }, 5000);
            }
        });
    }
});
// Inicializa��o dedicada das ordens - garante DOM pronto
document.addEventListener('DOMContentLoaded', function() {
    console.log('[DEBUG] DOMContentLoaded - inicializando ordens');
    carregarOrdensPendentes();
});

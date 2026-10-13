var ordensCarregadas = [];
var previaOrdens = [];
var listaFiltrada = [];
var listaAtual = [];
var campoOrdenado = null;
var ordemCrescente = true;
var celulaEmEdicao = null;

// Auth token management
function getAccessToken() {
    return localStorage.getItem('access_token') || sessionStorage.getItem('access_token');
}

function setAccessToken(token) {
    localStorage.setItem('access_token', token);
}

function clearAccessToken() {
    localStorage.removeItem('access_token');
    sessionStorage.removeItem('access_token');
}

// Authenticated fetch wrapper
async function authFetch(url, options = {}) {
    const token = getAccessToken();
    const headers = {
        'Content-Type': 'application/json',
        ...options.headers
    };
    
    if (token) {
        headers['Authorization'] = `Bearer ${token}`;
    }
    
    const response = await fetch(url, {
        ...options,
        headers,
        credentials: 'include'
    });
    
    if (response.status === 401) {
        clearAccessToken();
        window.location.href = '/login';
        throw new Error('Não autenticado');
    }
    
    return response;
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

function formatarDiaAnalise(data) {
    if (data) {
        return formatarData(data);
    } else {
        return '-';
    }
}

function calcularDiferencaDias(dataAberturaISO, diaAnaliseISO) {
    if (!dataAberturaISO || !diaAnaliseISO) return null;
    var parteA = String(dataAberturaISO).substring(0, 10).split('-');
    var parteB = String(diaAnaliseISO).substring(0, 10).split('-');
    if (parteA.length < 3 || parteB.length < 3) return null;

    var anoA = parseInt(parteA[0], 10);
    var mesA = parseInt(parteA[1], 10) - 1;
    var diaA = parseInt(parteA[2], 10);

    var anoB = parseInt(parteB[0], 10);
    var mesB = parseInt(parteB[1], 10) - 1;
    var diaB = parseInt(parteB[2], 10);

    var dtA = new Date(anoA, mesA, diaA);
    var dtB = new Date(anoB, mesB, diaB);

    var diffMs = dtB - dtA;
    return Math.floor(diffMs / (1000 * 60 * 60 * 24));
}

function atualizarKPIs(lista) {
    var total = lista.length;
    var faltaPagar = 0;
    var pagasApos48h = 0; // ordens que foram pagas depois de 48 horas (> 2 dias)
    var pagasNoPrazo = 0; // ordens pagas dentro do prazo (<= 48 horas / <= 2 dias)

    lista.forEach(function(ordem) {
        if (ordem.situacao === 'Falta Pagar') {
            faltaPagar++;
        } else if (ordem.situacao === 'Pago' || ordem.dia_analise) {
            var diffDias = calcularDiferencaDias(ordem.data_abertura, ordem.dia_analise);
            if (diffDias !== null) {
                if (diffDias <= 2) {
                    pagasNoPrazo++;
                } else {
                    pagasApos48h++;
                }
            }
        }
    });

    var elTotal = document.getElementById('kpi-total-ops');
    var elFaltaPagar = document.getElementById('kpi-falta-pagar');
    var elCritico = document.getElementById('kpi-critico');
    var elPrazo = document.getElementById('kpi-prazo');

    if (elTotal) elTotal.innerText = total;
    if (elFaltaPagar) elFaltaPagar.innerText = faltaPagar;
    if (elCritico) elCritico.innerText = pagasApos48h;
    if (elPrazo) elPrazo.innerText = pagasNoPrazo;
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
            + '<td data-coluna="situacao" title="Duplo clique para editar">' + (ordem.situacao || '') + '</td>'
            + '<td data-coluna="observacao" title="Duplo clique para editar">' + (ordem.observacao || '') + '</td>'
            + '<td data-coluna="setor" title="Duplo clique para editar">' + (ordem.setor || '') + '</td>'
            + '<td data-coluna="prioridade" title="Duplo clique para editar">' + (ordem.prioridade || '') + '</td>'
            + '<td data-coluna="dia_analise" title="Duplo clique para editar data de análise">' + formatarDiaAnalise(ordem.dia_analise) + '</td>'
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

function ordenarPor(campo) {
    if (campo === campoOrdenado) {
        ordemCrescente = !ordemCrescente;
    } else {
        campoOrdenado = campo;
        ordemCrescente = true;
    }

    var ordenadas = listaAtual.slice().sort(function (a, b) {
        var valA = a[campo];
        var valB = b[campo];
        if (campo === 'total_pecas') {
            valA = Number(valA) || 0;
            valB = Number(valB) || 0;
        }
        if (valA > valB) return ordemCrescente ? 1 : -1;
        if (valA < valB) return ordemCrescente ? -1 : 1;
        return 0;
    });
    listaAtual = ordenadas;
    paginacao.paginaAtual = 1;
    renderizarTabelaComPaginacao(ordenadas);
}

// Carga inicial das ordens pendentes
async function carregarOrdensPendentes() {
    try {
        const resposta = await authFetch('http://localhost:3000/ordens/pendentes');
        const dados = await resposta.json();
        ordensCarregadas = dados;
        paginacao.paginaAtual = 1;
        paginacao.itensPorPagina = 10;
        paginacao.totalItens = dados.length;
        paginacao.totalPaginas = Math.ceil(paginacao.totalItens / paginacao.itensPorPagina) || 1;
        renderizarTabelaComPaginacao(dados);
        atualizarContadoresFiltros();
    } catch (erro) {
        console.error('Erro ao carregar ordens:', erro);
    }
}
carregarOrdensPendentes();

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
            total_pecas: parseInt(qtdPecas, 10) || 0,
            material: mat,
            setor: document.getElementById('setorLote').value,
            situacao: document.getElementById('situacaoLote').value,
            prioridade: prioridadeEscolhida,
            data_abertura: document.getElementById('dataAberturaLote').value || null,
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
            return authFetch('http://localhost:3000/ordens', {
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

// Logout function
async function logout() {
    try {
        await authFetch('http://localhost:3000/auth/logout', { method: 'POST' });
    } catch (e) {
        // Ignore errors on logout
    }
    clearAccessToken();
    window.location.href = '/login';
}

document.getElementById('btn-logout')?.addEventListener('click', logout);

// Load user info on page load
async function loadUserInfo() {
    try {
        const response = await authFetch('http://localhost:3000/auth/me');
        const user = await response.json();
        document.getElementById('user-name').textContent = user.name || user.email;
        document.getElementById('user-role').textContent = user.role || 'operator';
        const avatar = document.getElementById('user-avatar');
        if (avatar && user.name) {
            avatar.textContent = user.name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2);
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
function iniciarEdicaoCelula(td) {
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

    celulaEmEdicao = td;
    td.dataset.originalHtml = td.innerHTML;

    var valorAtual = ordem[coluna];
    if (valorAtual === null || valorAtual === undefined) valorAtual = '';

    var editor;
    if (coluna === 'situacao') {
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
        ['Exportacao', 'MWM', 'KS', 'Marelli', 'Pendencia Comercial', 'Linha Pesada', 'MRP', 'Tryout'].forEach(function(val) {
            var opt = document.createElement('option');
            opt.value = val;
            opt.textContent = val;
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

    if (coluna === 'total_pecas') {
        var num = parseInt(novoValor, 10);
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

    // Se o valor for idêntico ao original, apenas cancela edição
    var valCompOriginal = valorOriginal ? String(valorOriginal).substring(0, 10) : '';
    var valCompNovo = novoValor ? String(novoValor).substring(0, 10) : '';
    if (valCompOriginal === valCompNovo) {
        cancelarEdicao(td);
        return;
    }

    editor.disabled = true;

    try {
        var resposta = await authFetch('http://localhost:3000/ordens/' + id, {
            method: 'PUT',
            body: JSON.stringify({ [coluna]: novoValor })
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
        renderizarTabela(listaAtual);
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
        var n = parseInt(valor, 10);
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

    try {
        var promessas = ids.map(function(id) {
            return authFetch('http://localhost:3000/ordens/' + id, {
                method: 'PUT',
                body: JSON.stringify({ [campo]: valor })
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
        });

        renderizarTabela(listaAtual);

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
        var res = await authFetch('http://localhost:3000/ordens/' + id, {
            method: 'DELETE'
        });
        var dados = await res.json();

        if (!res.ok) {
            alert('Erro ao excluir: ' + (dados.erro || 'Falha ao remover'));
            return;
        }

        ordensCarregadas = ordensCarregadas.filter(function(o) { return o.id !== id; });
        listaAtual = listaAtual.filter(function(o) { return o.id !== id; });
        renderizarTabela(listaAtual);
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
        var res = await authFetch('http://localhost:3000/ordens', {
            method: 'DELETE',
            body: JSON.stringify({ ids: ids })
        });
        var dados = await res.json();

        if (!res.ok) {
            alert('Erro ao excluir em massa: ' + (dados.erro || 'Falha ao remover ordens.'));
            return;
        }

        ordensCarregadas = ordensCarregadas.filter(function(o) { return !ids.includes(o.id); });
        listaAtual = listaAtual.filter(function(o) { return !ids.includes(o.id); });
        renderizarTabela(listaAtual);
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
function aplicarFiltrosAvancados() {
    var filtradas = ordensCarregadas.filter(function(ordem) {
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
    });

    paginacao.paginaAtual = 1;
    paginacao.totalItens = filtradas.length;
    paginacao.totalPaginas = Math.ceil(paginacao.totalItens / paginacao.itensPorPagina) || 1;
    renderizarTabelaComPaginacao(filtradas);
    atualizarContadoresFiltros();
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

    paginacao.paginaAtual = 1;
    paginacao.totalItens = ordensCarregadas.length;
    paginacao.totalPaginas = Math.ceil(paginacao.totalItens / paginacao.itensPorPagina) || 1;
    renderizarTabelaComPaginacao(ordensCarregadas);
    atualizarContadoresFiltros();
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
                    renderizarTabelaComPaginacao(listaAtual);
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

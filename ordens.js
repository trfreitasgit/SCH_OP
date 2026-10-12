var ordensCarregadas = [];
var previaOrdens = [];
var listaAtual = [];
var campoOrdenado = null;
var ordemCrescente = true;
var celulaEmEdicao = null;

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
    atualizarKPIs(lista);
    listaAtual = lista;
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
        ordemCrescente = !ordemCrescente; // inverte a direção
    } else {
        campoOrdenado = campo;
        ordemCrescente = true; // novo campo, começa com crescente
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
    renderizarTabela(ordenadas);
}

// Carga inicial das ordens pendentes
function carregarOrdensPendentes() {
    fetch('http://localhost:3000/ordens/pendentes')
        .then(function(resposta) {
            return resposta.json();
        })
        .then(function(dados) {
            ordensCarregadas = dados;
            renderizarTabela(dados);
        })
        .catch(function(erro) {
            console.error('Erro ao carregar ordens:', erro);
        });
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
    }).catch(function() {
        // Fallback para ambientes restritos
        var area = document.createElement('textarea');
        area.value = texto;
        document.body.appendChild(area);
        area.select();
        document.execCommand('copy');
        document.body.removeChild(area);
        mostrarToast('OPs Copiadas para o SAP!', ops.length + ' ordens visíveis copiadas.');
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
            return fetch('http://localhost:3000/ordens', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
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

// FILTROS POR SETOR
document.querySelectorAll('.btnSetor').forEach(function(botao) {
    botao.addEventListener('click', function () {
        var setorEscolhido = botao.dataset.setor;
        var filtradas = ordensCarregadas.filter(function (ordem) {
            return ordem.setor === setorEscolhido;
        });
        renderizarTabela(filtradas);
    });
});

document.getElementById('btnTodos').addEventListener('click', function () {
    renderizarTabela(ordensCarregadas);
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
        var resposta = await fetch('http://localhost:3000/ordens/' + id, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
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
            return fetch('http://localhost:3000/ordens/' + id, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
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
        var res = await fetch('http://localhost:3000/ordens/' + id, {
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
        var res = await fetch('http://localhost:3000/ordens', {
            method: 'DELETE',
            headers: { 'Content-Type': 'application/json' },
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
});
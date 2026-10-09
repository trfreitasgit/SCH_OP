var ordensCarregadas = [];
var previaOrdens = [];
var listaAtual = [];
var campoOrdenado = null;
var ordemCrescente = true;

function formatarData(dataISO) {
    var partes = dataISO.split('-');
    var ano = partes [0];
    var mes = partes [1];
    var dia = partes [2].substring(0, 2);
        return dia + '/' + mes + '/' + ano;
};

function formatarDiaAnalise (data) {
    if (data) {
        return formatarData(data);
    } else {
        return  '-';
    }
}

function renderizarTabela (lista) {
    atualizarKPIs(lista);
    listaAtual = lista
    var tabela = document.getElementById('tabelaOrdens');
    var corpoTabela = tabela.querySelector('tbody');
    var html = '';
    lista.forEach(function(ordem) {
        html += '<tr><td>' + ordem.numero_op + '</td><td>' + ordem.total_pecas + '</td><td>' + formatarData(ordem.data_abertura) + '</td><td>' + ordem.material + '</td><td>' + ordem.situacao + '</td><td>' + (ordem.observacao || '') + '</td><td>' + ordem.setor + '</td><td>' + ordem.prioridade + '</td><td>' + formatarDiaAnalise(ordem.dia_analise) + '</td></tr>';
    });
    corpoTabela.innerHTML = html;
}

function ordenarPor (campo) {
    if(campo === campoOrdenado) {
        ordemCrescente = !ordemCrescente //inverte a direção
    } else {
        campoOrdenado = campo;
        ordemCrescente = true; // novo campo, começa com crescente
    }

    var ordenadas = listaAtual.sort(function (a, b) {
        if (a[campo] > b[campo]) return ordemCrescente ? 1 : -1; //se ordemcrescente for true = 1, se false = (-1)
        if (a[campo] < b[campo]) return ordemCrescente ? -1 : 1;; //a vem antes de b
        return 0;
    });
    renderizarTabela(ordenadas);
}

function atualizarKPIs (lista) {
    var total = lista.length;
    var faltaPagar = lista.filter(function(ordem) {
        return ordem.situacao === 'Falta Pagar';
    }).length;

    document.getElementById('kpi-total-ops').innerText = total;
    document.getElementById('kpi-falta-pagar').innerText = faltaPagar;
}

    fetch('http://localhost:3000/ordens/pendentes') //pega a url bruta, sem os dados json
    .then(function(resposta) {
        return resposta.json(); // trata para resposta json
})
    .then(function(dados) {
    ordensCarregadas = dados; // guarda aqui os dados
    renderizarTabela(dados);
});

document.getElementById('btnCopiar').addEventListener('click', function(){
    var texto = '';
    ordensCarregadas.forEach(function(ordem) {
        texto += ordem.numero_op + '\n';
    });
    navigator.clipboard.writeText(texto);
});

document.getElementById('btnGerarPrevia').addEventListener('click', function() {
    var ops = document.getElementById('listaOPs').value.split('\n').filter(function(linha) {
        return linha.trim() !== '';
    });
    var pecas = document.getElementById('listaPecas').value.split('\n').filter(function (linha) {
        return linha.trim() !== '';
    })
    var materiais = document.getElementById('listaMateriais').value.split('\n').filter(function (linha) {
        return linha.trim() !== '';
    });

    var tabelaprevia = document.getElementById('tabelaPrevia');
    var corpoTabelaPrevia = tabelaprevia.querySelector('tbody');

    var html = '';

    var prioridadeEscolhida = document.getElementById('prioridadeLote').value;
    if (prioridadeEscolhida === '') {
        prioridadeEscolhida = null; // faz o tratamento para deixar a prioridade como null caso não tenha ainda
    }

    ops.forEach(function(op, indice) {
        html += '<tr><td>' + op + '</td><td>' + pecas[indice] + '</td><td>' + materiais[indice] + '</td></tr>';

        previaOrdens.push({ //levando para o array vazio antes, as ordens que estão na prévia
            numero_op: op,
            total_pecas: pecas[indice],
            material: materiais[indice],
            setor: document.getElementById('setorLote').value,
            situacao: document.getElementById('situacaoLote').value,
            prioridade: prioridadeEscolhida,
            data_abertura: document.getElementById('dataAberturaLote').value,
            dia_analise: document.getElementById('diaAnaliseLote').value
        });
    });

    corpoTabelaPrevia.innerHTML = html;
});

document.getElementById('btnConfirmarLote').addEventListener('click', function() {
    previaOrdens.forEach(function (ordem) {
        fetch('http://localhost:3000/ordens', {
            method: 'POST', //method to banco de dados para postar novas ordens
            headers: { 'Content-Type': 'application/json' }, //estamos definindo para transformar em json
            body: JSON.stringify(ordem) //os dados, convertidos para texto com essa função  
        })
        .then(function(resposta) {
            return resposta.json();
        })
        .then(function(dados) {
            console.log(dados);
        });
    });

    alert('Ordens cadastradas!');
});

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

document.querySelectorAll('[data-campo]').forEach(function (cabecalho) {
    cabecalho.addEventListener('click', function () {
        var campo = cabecalho.dataset.campo;
        ordenarPor(campo);
    });
});
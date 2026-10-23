// Testes do filtro de Periodo de Analise (dia_analise) e do filtro de Turno.
//
// Os blocos sao extraidos do proprio ordens.js (sem copia): o teste quebra se
// alguem mudar a regra no arquivo real. A extracao cobre
//   - o bloco de fuso/turno (TZ_FABRICA ate as constantes de inicio de turno);
//   - a funcao passaFiltrosAvancados.
// Nada aqui toca em document, entao roda em node puro.
//
// Rodar: node --test tests/*.test.js

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

function carregarModulo() {
    const src = fs.readFileSync(path.join(__dirname, '..', 'ordens.js'), 'utf8');

    const iniFuso = src.indexOf('var TZ_FABRICA');
    if (iniFuso === -1) throw new Error('nao achei TZ_FABRICA em ordens.js');

    const fimFuso = src.indexOf('// Hora inicial de cada turno');
    if (fimFuso === -1) throw new Error('nao achei o bloco de turno em ordens.js');

    const iniPassa = src.indexOf('function passaFiltrosAvancados');
    if (iniPassa === -1) throw new Error('nao achei passaFiltrosAvancados em ordens.js');

    const fimPassa = src.indexOf('function passaBuscaRapida');
    if (fimPassa === -1) throw new Error('nao achei passaBuscaRapida em ordens.js');

    return new Function(
        src.slice(iniFuso, fimFuso) +
        '\nvar filtrosAvancados = null;\n' +
        src.slice(iniPassa, fimPassa) +
        '\nreturn {' +
        '\n  obterTurno: obterTurno,' +
        '\n  dataAnaliseFabrica: dataAnaliseFabrica,' +
        '\n  hojeFabrica: hojeFabrica,' +
        '\n  calcularPeriodoAnalise: calcularPeriodoAnalise,' +
        '\n  passaFiltrosAvancados: passaFiltrosAvancados,' +
        '\n  definirFiltros: function (f) { filtrosAvancados = f; }' +
        '\n};'
    )();
}

const mod = carregarModulo();

// Estado com tudo liberado (mesmo formato de filtrosAvancados em ordens.js).
function estadoBase() {
    return {
        prioridades: {
            'Exportacao': true, 'KS': true, 'Marelli': true, 'MWM': true,
            'Pendencia Comercial': true,
            'Linha Pesada': true, 'MRP': true, 'Tryout': true,
            '__NULL__': true
        },
        status: { 'Falta Pagar': true, 'Pago': true, 'Encerrado': true },
        setores: { 'Montagem': true, 'Subconjunto': true, 'Celula': true, 'BCM': true, 'Importada': true, 'Usinagem': true },
        dataInicio: null,
        dataFim: null,
        analiseInicio: null,
        analiseFim: null,
        turnos: { T1: true, T2: true, T3: true, SEM: true }
    };
}

function comFiltros(over) {
    const estado = Object.assign(estadoBase(), over || {});
    mod.definirFiltros(estado);
    return estado;
}

function ordem(extra) {
    return Object.assign({
        prioridade: null,
        situacao: 'Pago',
        setor: 'Montagem',
        data_abertura: '2026-10-01',
        dia_analise: null
    }, extra || {});
}

// ---------------------------------------------------------------------------
// dataAnaliseFabrica
// ---------------------------------------------------------------------------
test('data pura AAAA-MM-DD e mantida literal', () => {
    assert.strictEqual(mod.dataAnaliseFabrica('2026-10-16'), '2026-10-16');
});

test('timestamptz usa o dia da fabrica (SP)', () => {
    assert.strictEqual(mod.dataAnaliseFabrica('2026-10-16T09:15:00-03:00'), '2026-10-16');
    assert.strictEqual(mod.dataAnaliseFabrica('2026-10-16T23:59:00-03:00'), '2026-10-16');
});

test('UTC vira o dia anterior em SP: 01:30Z de 16/10 = 22:30 de 15/10', () => {
    assert.strictEqual(mod.dataAnaliseFabrica('2026-10-16T01:30:00Z'), '2026-10-15');
    assert.strictEqual(mod.obterTurno('2026-10-16T01:30:00Z'), 'T3');
});

test('sem data ou data invalida devolve null', () => {
    assert.strictEqual(mod.dataAnaliseFabrica(null), null);
    assert.strictEqual(mod.dataAnaliseFabrica(undefined), null);
    assert.strictEqual(mod.dataAnaliseFabrica(''), null);
    assert.strictEqual(mod.dataAnaliseFabrica('   '), null);
    assert.strictEqual(mod.dataAnaliseFabrica('16/10/2026'), null);
    assert.strictEqual(mod.dataAnaliseFabrica('2026-13-01'), null);
});

// ---------------------------------------------------------------------------
// Bordas de turno
// ---------------------------------------------------------------------------
test('bordas de turno: 05:19 T3, 05:20 T1, 13:39 T1, 13:40 T2, 21:59 T2, 22:00 T3', () => {
    assert.strictEqual(mod.obterTurno('2026-10-16T05:19:00-03:00'), 'T3');
    assert.strictEqual(mod.obterTurno('2026-10-16T05:20:00-03:00'), 'T1');
    assert.strictEqual(mod.obterTurno('2026-10-16T13:39:00-03:00'), 'T1');
    assert.strictEqual(mod.obterTurno('2026-10-16T13:40:00-03:00'), 'T2');
    assert.strictEqual(mod.obterTurno('2026-10-16T21:59:00-03:00'), 'T2');
    assert.strictEqual(mod.obterTurno('2026-10-16T22:00:00-03:00'), 'T3');
});

test('turno de meia-noite e de data pura e T3', () => {
    assert.strictEqual(mod.obterTurno('2026-10-16T00:00:00-03:00'), 'T3');
    assert.strictEqual(mod.obterTurno('2026-10-16'), 'T3');
    assert.strictEqual(mod.obterTurno(null), null);
});

// ---------------------------------------------------------------------------
// hojeFabrica
// ---------------------------------------------------------------------------
test('hojeFabrica devolve o dia de SP, nao o do navegador', () => {
    const esperado = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit'
    }).format(new Date());
    assert.strictEqual(mod.hojeFabrica(), esperado);
    assert.match(mod.hojeFabrica(), /^\d{4}-\d{2}-\d{2}$/);
});

// ---------------------------------------------------------------------------
// calcularPeriodoAnalise
// ---------------------------------------------------------------------------
test('preset Hoje: inicio = fim = hoje', () => {
    assert.deepStrictEqual(mod.calcularPeriodoAnalise('today', '2026-10-21'), {
        inicio: '2026-10-21', fim: '2026-10-21'
    });
});

test('preset 7 dias: hoje-6 ate hoje', () => {
    assert.deepStrictEqual(mod.calcularPeriodoAnalise('7days', '2026-10-21'), {
        inicio: '2026-10-15', fim: '2026-10-21'
    });
});

test('preset 7 dias cruzando mes e fevereiro bissexto', () => {
    assert.deepStrictEqual(mod.calcularPeriodoAnalise('7days', '2026-03-03'), {
        inicio: '2026-02-25', fim: '2026-03-03'
    });
    assert.deepStrictEqual(mod.calcularPeriodoAnalise('7days', '2028-03-01'), {
        inicio: '2028-02-24', fim: '2028-03-01'
    });
});

test('preset Este Mes: dia 1 ate hoje (nao vai para o futuro)', () => {
    assert.deepStrictEqual(mod.calcularPeriodoAnalise('month', '2026-10-21'), {
        inicio: '2026-10-01', fim: '2026-10-21'
    });
    // Primeiro dia do mes: inicio = fim = hoje
    assert.deepStrictEqual(mod.calcularPeriodoAnalise('month', '2026-01-01'), {
        inicio: '2026-01-01', fim: '2026-01-01'
    });
});

test('preset desconhecido devolve null', () => {
    assert.strictEqual(mod.calcularPeriodoAnalise('ontem', '2026-10-21'), null);
    assert.strictEqual(mod.calcularPeriodoAnalise('', '2026-10-21'), null);
});

// ---------------------------------------------------------------------------
// passaFiltrosAvancados - turno
// ---------------------------------------------------------------------------
test('sem filtro de turno, ordens com e sem analise passam', () => {
    comFiltros();
    assert.strictEqual(mod.passaFiltrosAvancados(ordem({ dia_analise: '2026-10-15T09:00:00-03:00' })), true);
    assert.strictEqual(mod.passaFiltrosAvancados(ordem({ dia_analise: null })), true);
});

test('T1 desmarcado remove so as ordens de T1', () => {
    comFiltros({ turnos: { T1: false, T2: true, T3: true, SEM: true } });
    assert.strictEqual(mod.passaFiltrosAvancados(ordem({ dia_analise: '2026-10-15T09:00:00-03:00' })), false);
    assert.strictEqual(mod.passaFiltrosAvancados(ordem({ dia_analise: '2026-10-15T15:00:00-03:00' })), true);
    assert.strictEqual(mod.passaFiltrosAvancados(ordem({ dia_analise: '2026-10-15T23:00:00-03:00' })), true);
});

test('Sem turno desmarcado remove as ordens sem dia_analise', () => {
    comFiltros({ turnos: { T1: true, T2: true, T3: true, SEM: false } });
    assert.strictEqual(mod.passaFiltrosAvancados(ordem({ dia_analise: null })), false);
    assert.strictEqual(mod.passaFiltrosAvancados(ordem({ dia_analise: '2026-10-15T09:00:00-03:00' })), true);
});

test('todos os turnos desmarcados: nada passa', () => {
    comFiltros({ turnos: { T1: false, T2: false, T3: false, SEM: false } });
    assert.strictEqual(mod.passaFiltrosAvancados(ordem({ dia_analise: '2026-10-15T09:00:00-03:00' })), false);
    assert.strictEqual(mod.passaFiltrosAvancados(ordem({ dia_analise: null })), false);
});

// ---------------------------------------------------------------------------
// passaFiltrosAvancados - periodo de analise
// ---------------------------------------------------------------------------
test('intervalo de um unico dia inclui as bordas e exclui os vizinhos', () => {
    comFiltros({ analiseInicio: '2026-10-15', analiseFim: '2026-10-15' });
    assert.strictEqual(mod.passaFiltrosAvancados(ordem({ dia_analise: '2026-10-15T00:00:00-03:00' })), true);
    assert.strictEqual(mod.passaFiltrosAvancados(ordem({ dia_analise: '2026-10-15T23:59:00-03:00' })), true);
    assert.strictEqual(mod.passaFiltrosAvancados(ordem({ dia_analise: '2026-10-14T23:59:00-03:00' })), false);
    assert.strictEqual(mod.passaFiltrosAvancados(ordem({ dia_analise: '2026-10-16T00:00:00-03:00' })), false);
});

test('so inicio (sem fim) e so fim (sem inicio)', () => {
    comFiltros({ analiseInicio: '2026-10-15' });
    assert.strictEqual(mod.passaFiltrosAvancados(ordem({ dia_analise: '2026-10-14T10:00:00-03:00' })), false);
    assert.strictEqual(mod.passaFiltrosAvancados(ordem({ dia_analise: '2026-10-15T10:00:00-03:00' })), true);
    assert.strictEqual(mod.passaFiltrosAvancados(ordem({ dia_analise: '2026-11-30T10:00:00-03:00' })), true);

    comFiltros({ analiseFim: '2026-10-15' });
    assert.strictEqual(mod.passaFiltrosAvancados(ordem({ dia_analise: '2026-10-14T10:00:00-03:00' })), true);
    assert.strictEqual(mod.passaFiltrosAvancados(ordem({ dia_analise: '2026-10-15T23:00:00-03:00' })), true);
    assert.strictEqual(mod.passaFiltrosAvancados(ordem({ dia_analise: '2026-10-16T00:00:00-03:00' })), false);
});

test('ordem sem analise continua visivel com intervalo ativo (pendente nao tem data)', () => {
    comFiltros({ analiseInicio: '2026-10-15', analiseFim: '2026-10-21' });
    assert.strictEqual(mod.passaFiltrosAvancados(ordem({ dia_analise: null })), true);

    // Quem quiser esconder pendente usa o checkbox "Sem turno (sem análise)".
    comFiltros({
        analiseInicio: '2026-10-15', analiseFim: '2026-10-21',
        turnos: { T1: true, T2: true, T3: true, SEM: false }
    });
    assert.strictEqual(mod.passaFiltrosAvancados(ordem({ dia_analise: null })), false);
});

test('UTC 01:30Z cai no dia 15 em SP no filtro de intervalo', () => {
    comFiltros({ analiseInicio: '2026-10-15', analiseFim: '2026-10-15' });
    assert.strictEqual(mod.passaFiltrosAvancados(ordem({ dia_analise: '2026-10-16T01:30:00Z' })), true);

    comFiltros({ analiseInicio: '2026-10-16', analiseFim: '2026-10-16' });
    assert.strictEqual(mod.passaFiltrosAvancados(ordem({ dia_analise: '2026-10-16T01:30:00Z' })), false);
});

test('intervalo e turno se somam (cumulativos)', () => {
    comFiltros({
        analiseInicio: '2026-10-15', analiseFim: '2026-10-15',
        turnos: { T1: false, T2: true, T3: true, SEM: true }
    });
    assert.strictEqual(mod.passaFiltrosAvancados(ordem({ dia_analise: '2026-10-15T09:00:00-03:00' })), false);
    assert.strictEqual(mod.passaFiltrosAvancados(ordem({ dia_analise: '2026-10-15T15:00:00-03:00' })), true);
    assert.strictEqual(mod.passaFiltrosAvancados(ordem({ dia_analise: '2026-10-14T15:00:00-03:00' })), false);
});

// ---------------------------------------------------------------------------
// passaFiltrosAvancados - pago dentro da janela de analise
//
// Rotina do PCP: "Pago" desmarcado para trabalhar. Com a janela ativa, o que
// foi pago DENTRO da janela continua aparecendo (pendente + pago de hoje).
// ---------------------------------------------------------------------------
test('com janela ativa, "Pago" desmarcado ainda mostra as pagas do periodo', () => {
    comFiltros({
        analiseInicio: '2026-10-15', analiseFim: '2026-10-15',
        status: { 'Falta Pagar': true, 'Pago': false, 'Encerrado': true }
    });
    // paga no dia da janela -> aparece mesmo com "Pago" desmarcado
    assert.strictEqual(
        mod.passaFiltrosAvancados(ordem({ situacao: 'Pago', dia_analise: '2026-10-15T09:00:00-03:00' })),
        true
    );
    // paga fora da janela -> continua escondida
    assert.strictEqual(
        mod.passaFiltrosAvancados(ordem({ situacao: 'Pago', dia_analise: '2026-10-14T09:00:00-03:00' })),
        false
    );
    // pendente (sem data) -> aparece
    assert.strictEqual(
        mod.passaFiltrosAvancados(ordem({ situacao: 'Falta Pagar', dia_analise: null })),
        true
    );
});

test('sem janela, "Pago" desmarcado esconde todas as pagas', () => {
    comFiltros({ status: { 'Falta Pagar': true, 'Pago': false, 'Encerrado': true } });
    assert.strictEqual(mod.passaFiltrosAvancados(ordem({ situacao: 'Pago', dia_analise: '2026-10-15T09:00:00-03:00' })), false);
    assert.strictEqual(mod.passaFiltrosAvancados(ordem({ situacao: 'Pago', dia_analise: null })), false);
});

test('janela so com inicio: paga depois do inicio aparece com "Pago" desmarcado', () => {
    comFiltros({
        analiseInicio: '2026-10-15',
        status: { 'Falta Pagar': true, 'Pago': false, 'Encerrado': true }
    });
    assert.strictEqual(mod.passaFiltrosAvancados(ordem({ situacao: 'Pago', dia_analise: '2026-11-02T09:00:00-03:00' })), true);
    assert.strictEqual(mod.passaFiltrosAvancados(ordem({ situacao: 'Pago', dia_analise: '2026-10-14T23:59:00-03:00' })), false);
});

test('a excecao da janela vale so para Pago, nao para Encerrado', () => {
    comFiltros({
        analiseInicio: '2026-10-15', analiseFim: '2026-10-15',
        status: { 'Falta Pagar': true, 'Pago': true, 'Encerrado': false }
    });
    assert.strictEqual(
        mod.passaFiltrosAvancados(ordem({ situacao: 'Encerrado', dia_analise: '2026-10-15T09:00:00-03:00' })),
        false
    );
});

test('paga na janela com "Pago" desmarcado ainda obedece ao filtro de turno', () => {
    comFiltros({
        analiseInicio: '2026-10-15', analiseFim: '2026-10-15',
        status: { 'Falta Pagar': true, 'Pago': false, 'Encerrado': true },
        turnos: { T1: false, T2: true, T3: true, SEM: true }
    });
    assert.strictEqual(mod.passaFiltrosAvancados(ordem({ situacao: 'Pago', dia_analise: '2026-10-15T09:00:00-03:00' })), false);
    assert.strictEqual(mod.passaFiltrosAvancados(ordem({ situacao: 'Pago', dia_analise: '2026-10-15T15:00:00-03:00' })), true);
});

// ---------------------------------------------------------------------------
// Regressao: os filtros que ja existiam continuam valendo
// ---------------------------------------------------------------------------
test('prioridade, situacao, setor e periodo de abertura seguem funcionando', () => {
    comFiltros();

    // prioridade fora da lista permitida
    mod.definirFiltros(Object.assign(estadoBase(), {
        prioridades: { 'Exportacao': false, 'KS': true, 'Marelli': true, 'MWM': true, 'Pendencia Comercial': true, 'Linha Pesada': true, 'MRP': true, 'Tryout': true, '__NULL__': true }
    }));
    assert.strictEqual(mod.passaFiltrosAvancados(ordem({ prioridade: 'Exportacao' })), false);
    assert.strictEqual(mod.passaFiltrosAvancados(ordem({ prioridade: 'KS' })), true);

    // sem prioridade depende de __NULL__
    mod.definirFiltros(Object.assign(estadoBase(), {
        prioridades: { '__NULL__': false }
    }));
    assert.strictEqual(mod.passaFiltrosAvancados(ordem({ prioridade: null })), false);

    // situacao
    comFiltros({ status: { 'Falta Pagar': true, 'Pago': false, 'Encerrado': true } });
    assert.strictEqual(mod.passaFiltrosAvancados(ordem({ situacao: 'Pago' })), false);
    assert.strictEqual(mod.passaFiltrosAvancados(ordem({ situacao: 'Falta Pagar' })), true);

    // setor
    comFiltros({ setores: { 'Montagem': false } });
    assert.strictEqual(mod.passaFiltrosAvancados(ordem({ setor: 'Montagem' })), false);

    // periodo de abertura
    comFiltros({ dataInicio: '2026-10-10', dataFim: '2026-10-20' });
    assert.strictEqual(mod.passaFiltrosAvancados(ordem({ data_abertura: '2026-10-09' })), false);
    assert.strictEqual(mod.passaFiltrosAvancados(ordem({ data_abertura: '2026-10-15' })), true);
    assert.strictEqual(mod.passaFiltrosAvancados(ordem({ data_abertura: '2026-10-21' })), false);
    assert.strictEqual(mod.passaFiltrosAvancados(ordem({ data_abertura: null })), false);
});

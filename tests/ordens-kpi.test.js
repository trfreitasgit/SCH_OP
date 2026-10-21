// Testes dos KPIs do dashboard (ordens.js).
//
// O bloco e extraido do proprio ordens.js (nao ha copia aqui): o teste quebra
// se alguem mudar a regra no arquivo real. A extracao vai de parseQuantidade
// ate a funcao atualizarKPIs (que e so a escrita no DOM) e nao toca em document.
//
// Rodar: node --test tests/*.test.js

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

function carregarKpis() {
    const src = fs.readFileSync(path.join(__dirname, '..', 'ordens.js'), 'utf8');

    const ini = src.indexOf('function parseQuantidade');
    if (ini === -1) throw new Error('nao achei parseQuantidade em ordens.js');

    const fim = src.indexOf('function atualizarKPIs');
    if (fim === -1) throw new Error('nao achei atualizarKPIs em ordens.js');

    const bloco = src.slice(ini, fim);

    return new Function(
        bloco + '\nreturn { calcularKpis, formatarPecas, formatarPontualidade };'
    )();
}

const kpis = carregarKpis();

// ---------------------------------------------------------------------------
// formatarPecas
// ---------------------------------------------------------------------------
test('formata quantidade de pecas com separador de milhar pt-BR', () => {
    assert.strictEqual(kpis.formatarPecas(12480), '12.480 peças');
    assert.strictEqual(kpis.formatarPecas(0), '0 peças');
    assert.strictEqual(kpis.formatarPecas(null), '0 peças');
});

test('singular so quando for exatamente 1 peca', () => {
    assert.strictEqual(kpis.formatarPecas(1), '1 peça');
    assert.strictEqual(kpis.formatarPecas(2), '2 peças');
});

// ---------------------------------------------------------------------------
// calcularKpis - contagem + soma de pecas
// ---------------------------------------------------------------------------
test('lista vazia zera ordens e pecas', () => {
    assert.deepStrictEqual(kpis.calcularKpis([]), {
        total: 0, pecasTotal: 0,
        faltaPagar: 0, pecasFaltaPagar: 0,
        pagas: 0, pecasPagas: 0, pagasSemData: 0, pecasSemData: 0,
        pagasApos48h: 0, pecasApos48h: 0,
        pagasNoPrazo: 0, pecasNoPrazo: 0
    });
});

test('soma as pecas das ordens em falta de pagar', () => {
    const lista = [
        { situacao: 'Falta Pagar', total_pecas: 53, data_abertura: '2026-10-10' },
        { situacao: 'Falta Pagar', total_pecas: 1000, data_abertura: '2026-10-10' },
        { situacao: 'Falta Pagar', total_pecas: null, data_abertura: '2026-10-10' }
    ];
    const r = kpis.calcularKpis(lista);
    assert.strictEqual(r.total, 3);
    assert.strictEqual(r.faltaPagar, 3);
    assert.strictEqual(r.pecasFaltaPagar, 1053);
    assert.strictEqual(r.pecasTotal, 1053);
});

test('total_pecas em texto pt-BR ("1.000") nao vira 1', () => {
    const lista = [
        { situacao: 'Falta Pagar', total_pecas: '1.000' },
        { situacao: 'Falta Pagar', total_pecas: '2.500' },
        { situacao: 'Falta Pagar', total_pecas: '300' }
    ];
    assert.strictEqual(kpis.calcularKpis(lista).pecasFaltaPagar, 3800);
});

test('pecas de ordens pagas nao entram no card de falta pagar', () => {
    const lista = [
        { situacao: 'Falta Pagar', total_pecas: 10, data_abertura: '2026-10-10' },
        { situacao: 'Pago', total_pecas: 90, data_abertura: '2026-10-10', dia_analise: '2026-10-11T10:00:00-03:00' }
    ];
    const r = kpis.calcularKpis(lista);
    assert.strictEqual(r.faltaPagar, 1);
    assert.strictEqual(r.pecasFaltaPagar, 10);
    assert.strictEqual(r.pecasTotal, 100);
});

test('soma pecas das pagas no prazo e das pagas apos 48h', () => {
    const lista = [
        { situacao: 'Pago', total_pecas: 100, data_abertura: '2026-10-10', dia_analise: '2026-10-12T09:00:00-03:00' },
        { situacao: 'Pago', total_pecas: 200, data_abertura: '2026-10-10', dia_analise: '2026-10-14T09:00:00-03:00' },
        { situacao: 'Falta Pagar', total_pecas: 50, data_abertura: '2026-10-10' }
    ];
    const r = kpis.calcularKpis(lista);
    assert.strictEqual(r.pagasNoPrazo, 1);
    assert.strictEqual(r.pecasNoPrazo, 100);
    assert.strictEqual(r.pagasApos48h, 1);
    assert.strictEqual(r.pecasApos48h, 200);
    assert.strictEqual(r.pecasTotal, 350);
});

test('ordem paga sem dia_analise nao entra em nenhum card de prazo', () => {
    const lista = [{ situacao: 'Pago', total_pecas: 70, data_abertura: '2026-10-10' }];
    const r = kpis.calcularKpis(lista);
    assert.strictEqual(r.pagasNoPrazo, 0);
    assert.strictEqual(r.pagasApos48h, 0);
    assert.strictEqual(r.pecasTotal, 70);
});

// ---------------------------------------------------------------------------
// Total pago - independe de ter ficado dentro ou fora do prazo de 48h
// ---------------------------------------------------------------------------
test('total pago soma os dois cards de prazo', () => {
    const lista = [
        { situacao: 'Pago', total_pecas: 100, data_abertura: '2026-10-10', dia_analise: '2026-10-12T09:00:00-03:00' },
        { situacao: 'Pago', total_pecas: 200, data_abertura: '2026-10-10', dia_analise: '2026-10-14T09:00:00-03:00' }
    ];
    const r = kpis.calcularKpis(lista);
    assert.strictEqual(r.pagas, 2);
    assert.strictEqual(r.pecasPagas, 300);
    assert.strictEqual(r.pagasSemData, 0);
});

test('total pago inclui ordem Pago sem data de pagamento', () => {
    const lista = [
        { situacao: 'Pago', total_pecas: 70, data_abertura: '2026-10-10' },
        { situacao: 'Pago', total_pecas: 30, data_abertura: '2026-10-10', dia_analise: '2026-10-11T09:00:00-03:00' }
    ];
    const r = kpis.calcularKpis(lista);
    assert.strictEqual(r.pagas, 2);
    assert.strictEqual(r.pecasPagas, 100);
    assert.strictEqual(r.pagasSemData, 1); // nao da para classificar o prazo
});

test('total pago inclui ordem paga sem data de abertura', () => {
    const lista = [{ situacao: 'Pago', total_pecas: 40, dia_analise: '2026-10-11T09:00:00-03:00' }];
    const r = kpis.calcularKpis(lista);
    assert.strictEqual(r.pagas, 1);
    assert.strictEqual(r.pecasPagas, 40);
    assert.strictEqual(r.pagasSemData, 1);
});

test('ordem com dia_analise conta como paga mesmo com situacao nula', () => {
    const lista = [{ situacao: null, total_pecas: 25, data_abertura: '2026-10-10', dia_analise: '2026-10-10T09:00:00-03:00' }];
    const r = kpis.calcularKpis(lista);
    assert.strictEqual(r.pagas, 1);
    assert.strictEqual(r.pagasNoPrazo, 1);
    assert.strictEqual(r.pagasSemData, 0);
});

test('falta pagar nao entra no total pago', () => {
    const lista = [{ situacao: 'Falta Pagar', total_pecas: 500, data_abertura: '2026-10-10' }];
    const r = kpis.calcularKpis(lista);
    assert.strictEqual(r.pagas, 0);
    assert.strictEqual(r.pecasPagas, 0);
});

test('invariante: pagas = no prazo + apos 48h + sem data', () => {
    const lista = [
        { situacao: 'Pago', total_pecas: 100, data_abertura: '2026-10-10', dia_analise: '2026-10-11T09:00:00-03:00' },
        { situacao: 'Pago', total_pecas: 200, data_abertura: '2026-10-10', dia_analise: '2026-10-15T09:00:00-03:00' },
        { situacao: 'Pago', total_pecas: 300, data_abertura: '2026-10-10' },
        { situacao: 'Pago', total_pecas: 400, dia_analise: '2026-10-11T09:00:00-03:00' },
        { situacao: 'Falta Pagar', total_pecas: 999, data_abertura: '2026-10-10' }
    ];
    const r = kpis.calcularKpis(lista);
    assert.strictEqual(r.pagas, 4);
    assert.strictEqual(r.pagas, r.pagasNoPrazo + r.pagasApos48h + r.pagasSemData);
    assert.strictEqual(r.pecasPagas, 1000);
    assert.strictEqual(r.pecasPagas, r.pecasNoPrazo + r.pecasApos48h + r.pecasSemData);
    assert.strictEqual(r.pecasSemData, 700);
});

// ---------------------------------------------------------------------------
// Texto da faixa de resumo
// ---------------------------------------------------------------------------
test('pontualidade usa so as ordens com data para classificar', () => {
    const lista = [
        { situacao: 'Pago', total_pecas: 10, data_abertura: '2026-10-10', dia_analise: '2026-10-11T09:00:00-03:00' },
        { situacao: 'Pago', total_pecas: 10, data_abertura: '2026-10-10', dia_analise: '2026-10-11T09:00:00-03:00' },
        { situacao: 'Pago', total_pecas: 10, data_abertura: '2026-10-10', dia_analise: '2026-10-10T09:00:00-03:00' },
        { situacao: 'Pago', total_pecas: 10, data_abertura: '2026-10-10', dia_analise: '2026-10-15T09:00:00-03:00' },
        { situacao: 'Pago', total_pecas: 10, data_abertura: '2026-10-10' }
    ];
    assert.strictEqual(kpis.formatarPontualidade(kpis.calcularKpis(lista)), '75%');
    assert.strictEqual(kpis.formatarPontualidade({ pagasNoPrazo: 0, pagasApos48h: 0 }), '—');
});

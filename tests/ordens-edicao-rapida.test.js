// Testes das gravacoes concorrentes do editor inline (ordens.js).
//
// As funcoes sao extraidas do proprio ordens.js: o teste quebra se alguem mudar
// a regra no arquivo real.
//
// Rodar: node --test tests/*.test.js

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

function carregar() {
    const src = fs.readFileSync(path.join(__dirname, '..', 'ordens.js'), 'utf8');

    const ini = src.indexOf('function deveAplicarResposta');
    if (ini === -1) throw new Error('nao achei deveAplicarResposta em ordens.js');

    const fim = src.indexOf('// Envia o PUT', ini);
    if (fim === -1) throw new Error('nao achei o fim do bloco de merge em ordens.js');

    const bloco = src.slice(ini, fim);

    return new Function(
        'ordensCarregadas',
        'listaAtual',
        'listaFiltrada',
        'ultimaGravacaoPorId',
        bloco + '\nreturn { aplicarOrdemAtualizada, deveAplicarResposta };'
    );
}

function montar() {
    const ordensCarregadas = [
        { id: 1, numero_op: 'A1', total_pecas: 100, material: '1111', observacao: 'manter' },
        { id: 2, numero_op: 'A2', total_pecas: 200, material: '2222' }
    ];
    const listaFiltrada = [ordensCarregadas[0], ordensCarregadas[1]];
    const listaAtual = [ordensCarregadas[0]];
    const ultimaGravacaoPorId = {};

    const api = carregar()(ordensCarregadas, listaAtual, listaFiltrada, ultimaGravacaoPorId);
    return { ordensCarregadas, listaFiltrada, listaAtual, ultimaGravacaoPorId, ...api };
}

test('snapshot do servidor nao apaga campo que ele nao devolveu', () => {
    const ctx = montar();

    // Resposta parcial: so id e a coluna editada. O campo "observacao" que ja
    // estava na tela precisa continuar la.
    ctx.aplicarOrdemAtualizada(1, 'material', '9999', { id: 1, material: '9999' });

    const ordem = ctx.ordensCarregadas.find((o) => o.id === 1);
    assert.strictEqual(ordem.material, '9999');
    assert.strictEqual(ordem.observacao, 'manter');
    assert.strictEqual(ordem.total_pecas, 100);
});

test('coluna editada sempre fica com o valor enviado', () => {
    const ctx = montar();

    // Servidor devolveu o valor antigo (ex.: resposta de outra gravacao);
    // o valor que o usuario salvou tem prioridade local.
    ctx.aplicarOrdemAtualizada(1, 'total_pecas', 500, { id: 1, total_pecas: 100 });

    assert.strictEqual(ctx.ordensCarregadas.find((o) => o.id === 1).total_pecas, 500);
});

test('merge atualiza as tres listas, sem trocar a referencia antiga por engano de indice', () => {
    const ctx = montar();

    ctx.aplicarOrdemAtualizada(1, 'material', '7777', { id: 1, material: '7777' });

    assert.strictEqual(ctx.ordensCarregadas[0].material, '7777');
    assert.strictEqual(ctx.listaFiltrada[0].material, '7777');
    assert.strictEqual(ctx.listaAtual[0].material, '7777');
    // A ordem 2 nao pode ser tocada.
    assert.strictEqual(ctx.ordensCarregadas[1].material, '2222');
});

test('resposta da gravacao mais recente e aplicada', () => {
    const ctx = montar();
    ctx.ultimaGravacaoPorId['1'] = 2;

    assert.strictEqual(ctx.deveAplicarResposta('1', 2), true);
});

test('resposta de gravacao antiga e descartada (nao reverte a tela)', () => {
    const ctx = montar();
    ctx.ultimaGravacaoPorId['1'] = 2;

    assert.strictEqual(ctx.deveAplicarResposta('1', 1), false);
});

test('sequencia e por ordem: gravacao de outra ordem nao interfere', () => {
    const ctx = montar();
    ctx.ultimaGravacaoPorId['1'] = 5;
    ctx.ultimaGravacaoPorId['2'] = 1;

    assert.strictEqual(ctx.deveAplicarResposta('2', 1), true);
    assert.strictEqual(ctx.deveAplicarResposta('1', 1), false);
});

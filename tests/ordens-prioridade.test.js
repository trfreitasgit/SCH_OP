// Testes da limpeza de prioridade no editor inline (ordens.js).
//
// A funcao e extraida do proprio ordens.js (nao ha copia aqui): o teste quebra
// se alguem mudar a regra no arquivo real.
//
// Rodar: node --test tests/*.test.js

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

function carregarNormalizador() {
    const src = fs.readFileSync(path.join(__dirname, '..', 'ordens.js'), 'utf8');

    const ini = src.indexOf('function normalizarPrioridadeEditada');
    if (ini === -1) throw new Error('nao achei normalizarPrioridadeEditada em ordens.js');

    const fim = src.indexOf('\nfunction ', ini + 10);
    const bloco = src.slice(ini, fim === -1 ? src.length : fim);

    return new Function(bloco + '\nreturn normalizarPrioridadeEditada;')();
}

const normalizar = carregarNormalizador();

test('prioridade vazia vira null (sem prioridade no banco)', () => {
    assert.strictEqual(normalizar(''), null);
    assert.strictEqual(normalizar('   '), null);
});

test('prioridade nula continua nula', () => {
    assert.strictEqual(normalizar(null), null);
    assert.strictEqual(normalizar(undefined), null);
});

test('prioridade preenchida e preservada sem espacos nas pontas', () => {
    assert.strictEqual(normalizar('MWM'), 'MWM');
    assert.strictEqual(normalizar('  Linha Pesada  '), 'Linha Pesada');
});

test('comparacao de igualdade funciona com null dos dois lados', () => {
    // O editor entrega '' quando a celula esta vazia e o registro guarda null:
    // sem normalizar os dois lados, limpar uma prioridade ja vazia geraria PUT.
    assert.strictEqual(normalizar(null), normalizar(''));
    assert.strictEqual(normalizar(undefined), normalizar('   '));
});

test('limpar muda o valor de quem tinha prioridade', () => {
    assert.notStrictEqual(normalizar('MWM'), normalizar(''));
});

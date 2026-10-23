// Testes da preferencia de "Exibir N ordens" (10/25/50/100).
//
// O bloco e extraido do proprio ordens.js (sem copia): o teste quebra se
// alguem mudar a regra no arquivo real. Cobre a whitelist e a leitura/gravacao
// no storage, que e onde o valor corrompido (ou storage bloqueado) entra.
//
// Nada aqui toca em document, entao roda em node puro.
//
// Rodar: node --test tests/*.test.js

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

function carregarModulo() {
    const src = fs.readFileSync(path.join(__dirname, '..', 'ordens.js'), 'utf8');

    const ini = src.indexOf('var ITENS_POR_PAGINA_PERMITIDOS');
    if (ini === -1) throw new Error('nao achei ITENS_POR_PAGINA_PERMITIDOS em ordens.js');

    const fim = src.indexOf('function inicializarItensPorPagina');
    if (fim === -1) throw new Error('nao achei inicializarItensPorPagina em ordens.js');

    return new Function(
        src.slice(ini, fim) +
        '\nreturn {' +
        '\n  normalizarItensPorPagina: normalizarItensPorPagina,' +
        '\n  lerItensPorPagina: lerItensPorPagina,' +
        '\n  salvarItensPorPagina: salvarItensPorPagina,' +
        '\n  CHAVE: CHAVE_ITENS_POR_PAGINA' +
        '\n};'
    )();
}

const mod = carregarModulo();

function storageFake(inicial) {
    const dados = Object.assign({}, inicial || {});
    return {
        getItem: (k) => (k in dados ? dados[k] : null),
        setItem: (k, v) => { dados[k] = String(v); },
        _dados: dados
    };
}

// ---------------------------------------------------------------------------
// normalizarItensPorPagina - whitelist
// ---------------------------------------------------------------------------
test('valores permitidos passam inteiros', () => {
    [10, 25, 50, 100].forEach((n) => {
        assert.strictEqual(mod.normalizarItensPorPagina(n), n);
    });
});

test('string numerica vira inteiro', () => {
    assert.strictEqual(mod.normalizarItensPorPagina('25'), 25);
    assert.strictEqual(mod.normalizarItensPorPagina('100'), 100);
});

test('valor fora da whitelist cai em 10', () => {
    [0, 1, 12, 999, '12', 'abc', '', null, undefined, NaN, '10x'].forEach((v) => {
        assert.strictEqual(mod.normalizarItensPorPagina(v), 10, 'valor: ' + String(v));
    });
});

// ---------------------------------------------------------------------------
// lerItensPorPagina
// ---------------------------------------------------------------------------
test('sem storage devolve 10 (navegador bloqueando localStorage)', () => {
    assert.strictEqual(mod.lerItensPorPagina(null), 10);
});

test('chave ausente devolve 10', () => {
    assert.strictEqual(mod.lerItensPorPagina(storageFake()), 10);
});

test('le o valor gravado', () => {
    assert.strictEqual(mod.lerItensPorPagina(storageFake({ 'ordens.itensPorPagina': '50' })), 50);
});

test('valor corrompido no storage cai em 10', () => {
    assert.strictEqual(mod.lerItensPorPagina(storageFake({ 'ordens.itensPorPagina': '999' })), 10);
});

test('getItem que estoura devolve 10', () => {
    const storage = { getItem: () => { throw new Error('SecurityError'); } };
    assert.strictEqual(mod.lerItensPorPagina(storage), 10);
});

// ---------------------------------------------------------------------------
// salvarItensPorPagina
// ---------------------------------------------------------------------------
test('grava o valor normalizado na chave', () => {
    const s = storageFake();
    mod.salvarItensPorPagina('25', s);
    assert.strictEqual(s.getItem(mod.CHAVE), '25');
});

test('grava 10 quando o valor e invalido', () => {
    const s = storageFake();
    mod.salvarItensPorPagina('999', s);
    assert.strictEqual(s.getItem(mod.CHAVE), '10');
});

test('setItem que estoura nao propaga', () => {
    const storage = { setItem: () => { throw new Error('QuotaExceededError'); } };
    assert.doesNotThrow(() => mod.salvarItensPorPagina(25, storage));
});

test('sem storage nao propaga', () => {
    assert.doesNotThrow(() => mod.salvarItensPorPagina(25, null));
});

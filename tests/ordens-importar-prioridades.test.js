// Testes da leitura do relatorio do importador de prioridades (ordens.js).
//
// A funcao e extraida do proprio ordens.js: o teste quebra se a regra mudar.
//
// Rodar: node --test tests/*.test.js

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

function carregarInterpretador() {
    const src = fs.readFileSync(path.join(__dirname, '..', 'ordens.js'), 'utf8');

    const ini = src.indexOf('function interpretarRelatorioPcp');
    if (ini === -1) throw new Error('nao achei interpretarRelatorioPcp em ordens.js');

    const fim = src.indexOf('\nfunction renderizarPreviaPcp', ini + 10);
    const bloco = src.slice(ini, fim === -1 ? src.length : fim);

    return new Function(bloco + '\nreturn interpretarRelatorioPcp;')();
}

const interpretar = carregarInterpretador();

test('lotes ignorados nao entram na lista de OPs ausentes', () => {
    const relatorio = [
        'Setores a limpar (e-mail + banco): Montagem',
        'Modo: DRY-RUN (use --apply para gravar)',
        'OPs a atualizar: 2',
        '  - 1132972: Exportacao (peso 2) [setor Montagem]',
        '  - 1132973: Exportacao (peso 2) [setor Montagem]',
        'OPs ausentes no banco: 1',
        '  - 1132799 (setor ?, linha 9)',
        'Lotes ignorados (6 dígitos, não são OP): 2',
        '  - 311646 (linha 3)',
        '  - 311647 (linha 5)'
    ].join('\n');

    const dados = interpretar(relatorio);

    assert.strictEqual(dados.atualizadas, 2);
    assert.deepStrictEqual(dados.ausentes.map(function (op) { return op.numero_op; }),
        ['1132799']);
});

test('sem OPs ausentes, lotes ignorados nao viram ausentes', () => {
    const relatorio = [
        'OPs a atualizar: 1',
        '  - 1132972: Exportacao (peso 2) [setor Montagem]',
        'OPs ausentes no banco: 0 (nenhuma OP ausente)',
        'Lotes ignorados (6 dígitos, não são OP): 1',
        '  - 311646 (linha 3)'
    ].join('\n');

    const dados = interpretar(relatorio);

    assert.deepStrictEqual(dados.ausentes, []);
});

test('avisos de leitura continuam encerrando o bloco de ausentes', () => {
    const relatorio = [
        'OPs ausentes no banco: 1',
        '  - 104529 (setor ?, linha 2)',
        'Avisos de leitura: 1',
        '  - linha 4: prioridade desconhecida "Urgente" (OP 104531)'
    ].join('\n');

    const dados = interpretar(relatorio);

    assert.deepStrictEqual(dados.ausentes.map(function (op) { return op.numero_op; }),
        ['104529']);
    assert.strictEqual(dados.avisos, 1);
});

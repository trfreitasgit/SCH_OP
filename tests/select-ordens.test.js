// Guarda a projecao de colunas das rotas de listagem.
//
// O server.js sobe o express ao ser carregado, entao nao da para importar aqui.
// Este teste le o arquivo e verifica a intencao estrutural: nenhuma rota pode
// voltar a usar .select('*') e a lista de colunas tem que ser a que o frontend
// consome. O comportamento real (chaves devolvidas pela API) e coberto por
// tests/e2e-auth-cache.js.
//
// Rodar: node --test tests/*.test.js

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const fonte = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');

// Colunas que o frontend consome hoje (as 13 da tabela ordens_producao).
const COLUNAS_ESPERADAS = [
    'id', 'numero_op', 'setor', 'total_pecas', 'material',
    'data_abertura', 'dia_analise', 'situacao', 'prioridade',
    'observacao', 'peso_prioridade', 'created_at', 'updated_at'
];

function colunasDeclaradas() {
    const bloco = fonte.match(/var CAMPOS_ORDENACAO_VALIDOS = \[([\s\S]*?)\];/);
    assert.ok(bloco, 'CAMPOS_ORDENACAO_VALIDOS nao encontrado em server.js');
    return bloco[1]
        .split(',')
        .map((c) => c.trim().replace(/^'|'$/g, ''))
        .filter(Boolean);
}

test('nenhuma rota usa .select(*) no server.js', () => {
    assert.ok(!/\.select\(\s*['"]\*['"]\s*\)/.test(fonte), 'select(*) ainda presente em server.js');
});

test('as rotas de listagem usam a projecao CAMPOS_ORDEM', () => {
    const usos = fonte.match(/\.select\(CAMPOS_ORDEM\)/g) || [];
    assert.strictEqual(usos.length, 2, 'esperado .select(CAMPOS_ORDEM) em /ordens e /ordens/pendentes');
});

test('CAMPOS_ORDEM e derivado de CAMPOS_ORDENACAO_VALIDOS', () => {
    assert.match(
        fonte,
        /var CAMPOS_ORDEM = CAMPOS_ORDENACAO_VALIDOS\.join\(', '\);/,
        'CAMPOS_ORDEM deve ser a lista unica de colunas, join com virgula'
    );
});

test('a lista de colunas bate com o que o frontend consome', () => {
    assert.deepStrictEqual(colunasDeclaradas(), COLUNAS_ESPERADAS);
});

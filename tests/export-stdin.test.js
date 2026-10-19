// Teste de integracao do contrato stdin com o script Python de verdade.
//
// Prova o que a mudanca de performance promete:
//   1. o script funciona SEM as credenciais do Supabase no ambiente (nao importa supabase-py);
//   2. listas grandes funcionam (antes esbarravam no limite de linha de comando do Windows
//      e no tamanho da query string do PostgREST);
//   3. a ultima linha do stdout e um .xlsx existente (contrato com o server.js).
//
// Rodar: node --test tests/

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const SCRIPT = path.join(__dirname, '..', 'scripts', 'export_excel.py');
const PYTHON = process.env.PYTHON_BIN || 'python';

function registro(id) {
    return {
        id,
        numero_op: '113268' + id,
        setor: 'Montagem',
        total_pecas: 100 + id,
        material: '90000291',
        data_abertura: '2026-10-16',
        dia_analise: id % 2 === 0 ? '2026-10-16T14:00:00-03:00' : null,
        situacao: id % 2 === 0 ? 'Pago' : 'Falta Pagar',
        prioridade: 'MWM',
        observacao: null
    };
}

function rodar(ids) {
    const registros = ids.map(registro);
    // Ambiente sem credenciais: o caminho stdin nao pode precisar do Supabase.
    const ambiente = Object.assign({}, process.env);
    delete ambiente.SUPABASE_URL_ORDENS;
    delete ambiente.SUPABASE_SERVICE_ROLE_KEY_ORDENS;
    delete ambiente.SUPABASE_URL;
    delete ambiente.SUPABASE_SERVICE_ROLE_KEY;

    const resultado = spawnSync(PYTHON, [SCRIPT], {
        input: JSON.stringify({ ids, ordens: registros }),
        encoding: 'utf8',
        env: ambiente,
        timeout: 120000,
        maxBuffer: 32 * 1024 * 1024
    });

    const linhas = String(resultado.stdout || '')
        .split(/\r?\n/)
        .map((linha) => linha.trim())
        .filter((linha) => linha !== '');

    return { resultado, linhas, caminho: linhas.length ? linhas[linhas.length - 1] : null };
}

function limpar(caminho) {
    if (caminho) {
        try { fs.unlinkSync(caminho); } catch (e) { /* ignora */ }
    }
}

test('gera a planilha a partir do stdin sem as credenciais do Supabase', () => {
    const { resultado, linhas, caminho } = rodar([5, 6, 7]);

    try {
        assert.strictEqual(resultado.status, 0, 'stderr: ' + resultado.stderr);
        assert.strictEqual(linhas.length, 1, 'stdout deveria ter so o caminho');
        assert.ok(caminho.endsWith('.xlsx'), 'ultima linha deveria ser o .xlsx');
        assert.ok(fs.existsSync(caminho), 'o arquivo .xlsx deveria existir');
        assert.ok(fs.statSync(caminho).size > 1000, 'o .xlsx deveria ter conteudo');
        assert.strictEqual(path.dirname(caminho), os.tmpdir());
    } finally {
        limpar(caminho);
    }
});

test('ordem sem dia_analise nao quebra e o script sai com 0', () => {
    const { resultado, caminho } = rodar([7, 8]);

    try {
        assert.strictEqual(resultado.status, 0, 'stderr: ' + resultado.stderr);
        assert.ok(caminho);
    } finally {
        limpar(caminho);
    }
});

test('listas grandes passam pelo stdin (antes estouravam a linha de comando)', () => {
    const ids = Array.from({ length: 2500 }, (_, i) => i + 1);
    const { resultado, caminho } = rodar(ids);

    try {
        assert.strictEqual(resultado.status, 0, 'stderr: ' + resultado.stderr);
        assert.ok(fs.existsSync(caminho));
        // 2500 ids tem ~19 mil caracteres: nao caberia em --ids no Windows.
        assert.ok(JSON.stringify(ids).length > 8191);
    } finally {
        limpar(caminho);
    }
});

test('payload invalido no stdin falha com erro no stderr e nada no stdout', () => {
    const resultado = spawnSync(PYTHON, [SCRIPT], {
        input: 'isso nao e json',
        encoding: 'utf8',
        timeout: 60000
    });

    assert.notStrictEqual(resultado.status, 0);
    assert.strictEqual(String(resultado.stdout || '').trim(), '');
    assert.match(resultado.stderr, /JSON/i);
});

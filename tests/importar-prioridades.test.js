// Testes da importacao de prioridades do PCP (lib/importar-prioridades.js).
//
// A rota POST /ordens/importar-prioridades e so cola: valida o corpo, roda o
// script Python e devolve { relatorio, erro }. A regra fica aqui porque o
// server.js sobe o express ao ser carregado e nao da para importar ele num teste.
//
// Rodar: npm test

const { test } = require('node:test');
const assert = require('node:assert');
const { EventEmitter } = require('node:events');
const fs = require('node:fs');
const path = require('node:path');

const imp = require('../lib/importar-prioridades');

const TSV = 'Prioridade\tOrdem\n02 - Exportação\t1132972\n06 - Pend. Comercial\t1132912\n';

// ---------------------------------------------------------------------------
// validarEntrada
// ---------------------------------------------------------------------------
test('validarEntrada aceita conteudo e apply', () => {
    assert.deepStrictEqual(
        imp.validarEntrada({ conteudo: TSV, apply: true }),
        { conteudo: TSV, apply: true }
    );
    assert.deepStrictEqual(
        imp.validarEntrada({ conteudo: TSV, apply: false }),
        { conteudo: TSV, apply: false }
    );
});

test('validarEntrada trata apply ausente como dry-run', () => {
    assert.deepStrictEqual(imp.validarEntrada({ conteudo: TSV }), { conteudo: TSV, apply: false });
});

test('validarEntrada rejeita corpo sem conteudo valido', () => {
    [null, undefined, {}, [], 'texto', { conteudo: 123 }, { conteudo: null },
        { conteudo: '' }, { conteudo: '   \n\t ' }].forEach((corpo) => {
        assert.strictEqual(imp.validarEntrada(corpo), null, 'deveria rejeitar: ' + JSON.stringify(corpo));
    });
});

test('validarEntrada rejeita apply que nao seja booleano', () => {
    ['true', 1, 0, 'false', {}].forEach((apply) => {
        assert.strictEqual(imp.validarEntrada({ conteudo: TSV, apply }), null,
            'deveria rejeitar apply=' + JSON.stringify(apply));
    });
});

// ---------------------------------------------------------------------------
// executarImportacao - processo filho falso
// ---------------------------------------------------------------------------
function spawnFalso(resultado) {
    const chamadas = [];
    const fn = (comando, args, opcoes) => {
        const chamada = { comando, args, opcoes, stdin: null, morto: false, eventos: [] };
        chamadas.push(chamada);

        const crianca = new EventEmitter();
        crianca.stdout = new EventEmitter();
        crianca.stderr = new EventEmitter();
        crianca.stdout.setEncoding = function (codificacao) { chamada.codificacao = codificacao; };
        crianca.stderr.setEncoding = function () { };
        crianca.stdin = {
            end(conteudo) { chamada.stdin = conteudo; },
            on(evento) { chamada.eventos.push(evento); }
        };
        crianca.kill = function () { chamada.morto = true; };

        const cfg = resultado || {};
        if (cfg.erro) {
            process.nextTick(() => crianca.emit('error', cfg.erro));
        } else if (!cfg.nuncaFecha) {
            process.nextTick(() => {
                (cfg.stdout || []).forEach((pedaco) => crianca.stdout.emit('data', Buffer.from(pedaco)));
                (cfg.stderr || []).forEach((pedaco) => crianca.stderr.emit('data', Buffer.from(pedaco)));
                crianca.emit('close', cfg.codigo === undefined ? 0 : cfg.codigo);
            });
        }
        return crianca;
    };
    fn.chamadas = chamadas;
    return fn;
}

test('executarImportacao roda o script sem shell e sem --apply no dry-run', async () => {
    const spawn = spawnFalso({ stdout: ['relatorio\n'] });

    const saida = await imp.executarImportacao({ conteudo: TSV, apply: false, spawn });

    const chamada = spawn.chamadas[0];
    assert.strictEqual(saida.codigo, 0);
    assert.strictEqual(saida.relatorio, 'relatorio\n');
    assert.strictEqual(saida.erro, '');
    assert.strictEqual(chamada.args.length, 1, 'dry-run nao deve receber flag');
    assert.strictEqual(chamada.args[0], imp.CAMINHO_SCRIPT);
    assert.ok(!chamada.args.includes('--apply'));
    assert.deepStrictEqual(chamada.opcoes.stdio, ['pipe', 'pipe', 'pipe']);
});

test('executarImportacao passa --apply quando pedido', async () => {
    const spawn = spawnFalso({ stdout: ['ok\n'] });

    await imp.executarImportacao({ conteudo: TSV, apply: true, spawn });

    assert.deepStrictEqual(spawn.chamadas[0].args, [imp.CAMINHO_SCRIPT, '--apply']);
});

test('executarImportacao envia o conteudo cru (acentos e tabs) pelo stdin', async () => {
    const spawn = spawnFalso({ stdout: ['ok\n'] });

    await imp.executarImportacao({ conteudo: TSV, spawn });

    assert.strictEqual(spawn.chamadas[0].stdin, TSV);
});

test('executarImportacao le a saida como UTF-8 (acentos partidos entre chunks)', async () => {
    const spawn = spawnFalso({ stdout: ['relatório: Exportação'], stderr: ['atenção'] });

    const saida = await imp.executarImportacao({ conteudo: TSV, spawn });

    assert.strictEqual(spawn.chamadas[0].codificacao, 'utf8');
    assert.strictEqual(saida.relatorio, 'relatório: Exportação');
    assert.strictEqual(saida.erro, 'atenção');
});

test('executarImportacao junta os pedacos de stdout e stderr', async () => {
    const spawn = spawnFalso({
        stdout: ['OPs a atualizar: 2', '\n  - 1132972: Exportacao\n'],
        stderr: ['Aviso: op ausente', '\n']
    });

    const saida = await imp.executarImportacao({ conteudo: TSV, spawn });

    assert.strictEqual(saida.relatorio, 'OPs a atualizar: 2\n  - 1132972: Exportacao\n');
    assert.strictEqual(saida.erro, 'Aviso: op ausente\n');
});

test('executarImportacao devolve o codigo de saida quando o script recusa o TSV', async () => {
    const spawn = spawnFalso({ stdout: [], stderr: ['Erro ao importar prioridades: tabela invalida\n'], codigo: 1 });

    const saida = await imp.executarImportacao({ conteudo: 'lixo', spawn });

    assert.strictEqual(saida.codigo, 1);
    assert.strictEqual(saida.relatorio, '');
    assert.match(saida.erro, /tabela invalida/);
});

test('executarImportacao rejeita quando o python nao existe (ENOENT)', async () => {
    const erro = Object.assign(new Error('spawn python ENOENT'), { code: 'ENOENT' });
    const spawn = spawnFalso({ erro });

    await assert.rejects(
        () => imp.executarImportacao({ conteudo: TSV, spawn }),
        (falha) => {
            assert.match(falha.detalhe, /python/);
            assert.match(falha.detalhe, /ENOENT/);
            return true;
        }
    );
});

test('executarImportacao mata o processo e rejeita no timeout', async () => {
    const spawn = spawnFalso({ nuncaFecha: true });

    await assert.rejects(
        () => imp.executarImportacao({ conteudo: TSV, spawn, timeoutMs: 30 }),
        /tempo limite/i
    );
    assert.strictEqual(spawn.chamadas[0].morto, true, 'deveria matar o processo');
});

test('executarImportacao trata erro de escrita no stdin sem derrubar o processo', async () => {
    const spawn = spawnFalso({ stdout: ['ok\n'] });

    await imp.executarImportacao({ conteudo: TSV, spawn });

    // Sem ouvinte de 'error' no stdin, um EPIPE derrubaria o servidor.
    assert.ok(spawn.chamadas[0].eventos.includes('error'));
});

test('executarImportacao permite trocar o python e o caminho do script', async () => {
    const spawn = spawnFalso({ stdout: ['ok\n'] });

    await imp.executarImportacao({
        conteudo: TSV,
        spawn,
        python: 'python3',
        scriptPath: '/app/scripts/importar_prioridades_pcp.py'
    });

    assert.strictEqual(spawn.chamadas[0].comando, 'python3');
    assert.strictEqual(spawn.chamadas[0].args[0], '/app/scripts/importar_prioridades_pcp.py');
});

test('executarImportacao usa spawn, nao exec (sem shell)', () => {
    const fonte = fs.readFileSync(
        path.join(__dirname, '..', 'lib', 'importar-prioridades.js'), 'utf8'
    );

    assert.ok(/require\('node:child_process'\)/.test(fonte));
    assert.ok(/\bexecFile\b|\bspawn\b/.test(fonte));
    assert.ok(!/(^|[^A-Za-z])exec\s*\(/.test(fonte), 'nao deve chamar exec (shell)');
});

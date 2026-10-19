// Testes da logica de exportacao do servidor (lib/export-ordens.js).
//
// O modulo e puro/injetavel de proposito: o server.js sobe o express ao ser
// carregado, entao a regra fica aqui para poder ser testada sem subir o app.
//
// Rodar: node --test tests/

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ex = require('../lib/export-ordens');

// ---------------------------------------------------------------------------
// validarIds
// ---------------------------------------------------------------------------
test('validarIds aceita inteiros positivos como string ou numero', () => {
    assert.deepStrictEqual(ex.validarIds([1, '2', 3]), ['1', '2', '3']);
});

test('validarIds rejeita vazio, nulo e nao-array', () => {
    assert.strictEqual(ex.validarIds([]), null);
    assert.strictEqual(ex.validarIds(null), null);
    assert.strictEqual(ex.validarIds(undefined), null);
    assert.strictEqual(ex.validarIds('1,2,3'), null);
});

test('validarIds rejeita qualquer coisa que nao seja digito', () => {
    ['abc', '1;2', '-2', '1.5', '', '0x1', null, undefined].forEach(function (bruto) {
        assert.strictEqual(ex.validarIds([bruto]), null, 'deveria rejeitar: ' + bruto);
    });
});

test('validarIds ignora espacos em volta do id (comportamento do servidor)', () => {
    assert.deepStrictEqual(ex.validarIds([' 1 ', 2]), ['1', '2']);
});

// ---------------------------------------------------------------------------
// dividirEmLotes - evita estourar o tamanho da query string do PostgREST
// ---------------------------------------------------------------------------
test('dividirEmLotes quebra em lotes do tamanho pedido', () => {
    const ids = Array.from({ length: 1200 }, (_, i) => i + 1);

    const lotes = ex.dividirEmLotes(ids, 500);

    assert.strictEqual(lotes.length, 3);
    assert.deepStrictEqual(lotes.map((lote) => lote.length), [500, 500, 200]);
    assert.strictEqual(lotes[0][0], 1);
    assert.strictEqual(lotes[2][199], 1200);
});

test('dividirEmLotes com lista vazia devolve nenhum lote', () => {
    assert.deepStrictEqual(ex.dividirEmLotes([], 500), []);
});

test('dividirEmLotes com lista menor que o lote devolve um lote so', () => {
    assert.deepStrictEqual(ex.dividirEmLotes([1, 2, 3], 500), [[1, 2, 3]]);
});

// ---------------------------------------------------------------------------
// lerCaminhoDaSaida - contrato com o script Python
// ---------------------------------------------------------------------------
test('lerCaminhoDaSaida pega a ultima linha nao vazia do stdout', () => {
    assert.strictEqual(ex.lerCaminhoDaSaida('\n/tmp/a.xlsx\n'), '/tmp/a.xlsx');
    assert.strictEqual(ex.lerCaminhoDaSaida('aviso\n/tmp/a.xlsx\n\n'), '/tmp/a.xlsx');
    assert.strictEqual(ex.lerCaminhoDaSaida('  /tmp/a.xlsx  '), '/tmp/a.xlsx');
});

test('lerCaminhoDaSaida sem saida devolve null', () => {
    assert.strictEqual(ex.lerCaminhoDaSaida(''), null);
    assert.strictEqual(ex.lerCaminhoDaSaida('   \n  \n'), null);
    assert.strictEqual(ex.lerCaminhoDaSaida(undefined), null);
});

// ---------------------------------------------------------------------------
// buscarRegistros - consulta o banco em lotes
// ---------------------------------------------------------------------------
function clienteFalso(registros) {
    const chamadas = [];
    return {
        chamadas,
        from(nome) {
            chamadas.push({ nome });
            return this;
        },
        select(campos) {
            this.campos = campos;
            return this;
        },
        in(coluna, valores) {
            const ultima = chamadas[chamadas.length - 1];
            ultima.coluna = coluna;
            ultima.ids = valores;
            // espelha o builder do supabase-js: devolve um "thenable", sem .execute()
            const pedidos = new Set(valores.map(Number));
            return {
                then(resolve) {
                    resolve({ data: registros.filter((r) => pedidos.has(Number(r.id))), error: null });
                }
            };
        }
    };
}

test('buscarRegistros consulta a tabela certa', async () => {
    const cliente = clienteFalso([{ id: 1 }, { id: 2 }]);

    const registros = await ex.buscarRegistros(cliente, ['1', '2'], 500);

    assert.strictEqual(cliente.chamadas[0].nome, 'ordens_producao');
    assert.strictEqual(cliente.chamadas[0].coluna, 'id');
    assert.deepStrictEqual(registros.map((r) => r.id), [1, 2]);
});

test('buscarRegistros divide a consulta em lotes de 500 ids', async () => {
    const registros = Array.from({ length: 1100 }, (_, i) => ({ id: i + 1 }));
    const cliente = clienteFalso(registros);
    const ids = registros.map((r) => String(r.id));

    const encontrados = await ex.buscarRegistros(cliente, ids, 500);

    assert.strictEqual(cliente.chamadas.length, 3);
    assert.deepStrictEqual(cliente.chamadas.map((c) => c.ids.length), [500, 500, 100]);
    assert.strictEqual(encontrados.length, 1100);
});

test('buscarRegistros com lista vazia nao consulta o banco', async () => {
    const cliente = clienteFalso([]);

    assert.deepStrictEqual(await ex.buscarRegistros(cliente, [], 500), []);
    assert.strictEqual(cliente.chamadas.length, 0);
});

test('buscarRegistros propaga o erro do banco', async () => {
    const cliente = {
        from() { return this; },
        select() { return this; },
        in() {
            return Promise.resolve({ data: null, error: { message: 'sem permissao' } });
        }
    };

    await assert.rejects(() => ex.buscarRegistros(cliente, ['1'], 500), /sem permissao/);
});

// ---------------------------------------------------------------------------
// gerarPlanilha - manda as linhas por stdin (sem --ids, sem shell)
// ---------------------------------------------------------------------------
function execFileFalso(resultado) {
    const chamadas = [];
    const fn = (comando, args, opcoes, callback) => {
        chamadas.push({ comando, args, opcoes, stdin: null, eventos: [] });
        const alvo = chamadas[chamadas.length - 1];
        // O modulo escreve no stdin antes de fechar; guardamos o conteudo.
        const stream = {
            end(conteudo) { alvo.stdin = conteudo; },
            on(evento) { alvo.eventos.push(evento); },
            write() { }
        };
        const retorno = resultado instanceof Error
            ? { erro: resultado, stdout: '', stderr: 'boom no python' }
            : { erro: null, stdout: resultado.stdout, stderr: resultado.stderr || '' };
        process.nextTick(() => callback(retorno.erro, retorno.stdout, retorno.stderr));
        return { stdin: stream };
    };
    fn.chamadas = chamadas;
    return fn;
}

test('gerarPlanilha passa as ordens por stdin em JSON e nao usa --ids', async () => {
    const destino = path.join(os.tmpdir(), 'teste_export_' + Date.now() + '.xlsx');
    fs.writeFileSync(destino, 'conteudo');
    const execFile = execFileFalso({ stdout: 'aviso\n' + destino + '\n' });
    const ids = ['5', '6'];
    const registros = [{ id: 5, numero_op: 'A' }, { id: 6, numero_op: 'B' }];

    try {
        const resultado = await ex.gerarPlanilha({
            scriptPath: '/app/scripts/export_excel.py',
            ids,
            registros,
            execFile
        });

        const chamada = execFile.chamadas[0];
        assert.strictEqual(resultado.caminho, destino);
        assert.ok(!chamada.args.includes('--ids'), 'nao deve passar --ids');
        assert.strictEqual(chamada.args[0], '/app/scripts/export_excel.py');
        assert.deepStrictEqual(JSON.parse(chamada.stdin), { ids: [5, 6], ordens: registros });
        // Sem ouvinte de 'error' no stdin, um EPIPE (script fecha antes) viraria
        // excecao nao tratada e derrubaria o servidor.
        assert.ok(chamada.eventos.includes('error'), 'deve tratar erro do stdin');
    } finally {
        fs.unlinkSync(destino);
    }
});

test('gerarPlanilha nao usa shell (execFile, nao exec)', () => {
    const fonte = require('node:fs').readFileSync(
        require('node:path').join(__dirname, '..', 'lib', 'export-ordens.js'), 'utf8'
    );

    assert.ok(!/\bexec\s*\(/.test(fonte), 'nao deve chamar exec (shell)');
    assert.ok(!/--ids/.test(fonte), 'nao deve montar linha de comando com --ids');
});

test('buscarRegistros usa a API do supabase-js (.from/.in), nao a do Python (.table/.in_)', () => {
    const fonte = require('node:fs').readFileSync(
        require('node:path').join(__dirname, '..', 'lib', 'export-ordens.js'), 'utf8'
    );

    assert.ok(/\.from\(/.test(fonte), 'supabase-js expoe .from(tabela)');
    assert.ok(/\.in\(/.test(fonte), 'supabase-js expoe .in(coluna, valores)');
    assert.ok(!/\.table\(/.test(fonte), 'supabase-js NAO tem .table() (isso e do supabase-py)');
    assert.ok(!/\.in_\(/.test(fonte), 'supabase-js NAO tem .in_() (isso e do supabase-py)');
    assert.ok(!/\.execute\(/.test(fonte), 'supabase-js NAO tem .execute() (isso e do supabase-py)');
});

test('gerarPlanilha rejeita quando o script falha, com o stderr no detalhe', async () => {
    const execFile = execFileFalso(new Error('exit 1'));

    await assert.rejects(
        () => ex.gerarPlanilha({ scriptPath: 'x.py', ids: ['1'], registros: [{ id: 1 }], execFile }),
        (erro) => {
            assert.match(erro.detalhe, /boom no python/);
            return true;
        }
    );
});

test('gerarPlanilha rejeita quando o stdout nao traz caminho', async () => {
    const execFile = execFileFalso({ stdout: 'so um aviso\n' });

    await assert.rejects(
        () => ex.gerarPlanilha({ scriptPath: 'x.py', ids: ['1'], registros: [{ id: 1 }], execFile }),
        /nao retornou um arquivo valido|não retornou um arquivo válido/
    );
});

// Testes da logica de sequenciamento do servidor (lib/sequenciamento-ordens.js).
//
// Mesma decisao de lib/export-ordens.js: a regra fica fora do server.js (que sobe
// o express ao ser carregado) para poder ser testada sem subir o app.
//
// Rodar: node --test tests/*.test.js

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const seq = require('../lib/sequenciamento-ordens');

// ---------------------------------------------------------------------------
// Contrato com o script Python
// ---------------------------------------------------------------------------
test('CAMINHO_SCRIPT aponta para scripts/gerar_sequenciamento_pdf.py', () => {
    assert.strictEqual(
        path.basename(seq.CAMINHO_SCRIPT),
        'gerar_sequenciamento_pdf.py'
    );
    assert.strictEqual(path.basename(path.dirname(seq.CAMINHO_SCRIPT)), 'scripts');
});

test('lerCaminhoDaSaida pega a ultima linha nao vazia do stdout', () => {
    assert.strictEqual(seq.lerCaminhoDaSaida('\n/tmp/a.pdf\n'), '/tmp/a.pdf');
    assert.strictEqual(seq.lerCaminhoDaSaida('aviso\n/tmp/a.pdf\n\n'), '/tmp/a.pdf');
    assert.strictEqual(seq.lerCaminhoDaSaida('  /tmp/a.pdf  '), '/tmp/a.pdf');
});

test('lerCaminhoDaSaida sem saida devolve null', () => {
    assert.strictEqual(seq.lerCaminhoDaSaida(''), null);
    assert.strictEqual(seq.lerCaminhoDaSaida('   \n  \n'), null);
    assert.strictEqual(seq.lerCaminhoDaSaida(undefined), null);
});

test('nomeArquivoPdf usa o nome definido no contrato do endpoint', () => {
    assert.strictEqual(seq.nomeArquivoPdf(), 'sequenciamento_schadek.pdf');
});

// ---------------------------------------------------------------------------
// normalizarSetores - entrada da query string/body
// ---------------------------------------------------------------------------
test('normalizarSetores sem filtro devolve null (todos os setores)', () => {
    assert.strictEqual(seq.normalizarSetores(undefined), null);
    assert.strictEqual(seq.normalizarSetores(null), null);
    assert.strictEqual(seq.normalizarSetores([]), null);
});

test('normalizarSetores limpa espacos e descarta vazios', () => {
    assert.deepStrictEqual(
        seq.normalizarSetores([' Montagem ', 'Subconjunto', '', '   ', null]),
        ['Montagem', 'Subconjunto']
    );
});

test('normalizarSetores remove repetidos preservando a ordem', () => {
    assert.deepStrictEqual(
        seq.normalizarSetores(['Montagem', 'Montagem', 'Usinagem']),
        ['Montagem', 'Usinagem']
    );
});

test('normalizarSetores rejeita o que nao e lista', () => {
    assert.strictEqual(seq.normalizarSetores('Montagem'), undefined);
    assert.strictEqual(seq.normalizarSetores(42), undefined);
    assert.strictEqual(seq.normalizarSetores({ setor: 'Montagem' }), undefined);
});

test('normalizarSetores com lista so de vazios vira null (todos)', () => {
    assert.strictEqual(seq.normalizarSetores(['', '  ']), null);
});

// ---------------------------------------------------------------------------
// normalizarIds - selecao de ordens vinda do modal (etapa 2)
// ---------------------------------------------------------------------------
test('normalizarIds sem filtro devolve null (todas as ordens do setor)', () => {
    assert.strictEqual(seq.normalizarIds(undefined), null);
    assert.strictEqual(seq.normalizarIds(null), null);
});

test('normalizarIds aceita numero e string numerica', () => {
    assert.deepStrictEqual(seq.normalizarIds([68, '69']), [68, 69]);
    assert.deepStrictEqual(seq.normalizarIds([' 68 ']), [68]);
});

test('normalizarIds remove repetidos preservando a ordem', () => {
    assert.deepStrictEqual(seq.normalizarIds([5, '5', 3, 5]), [5, 3]);
});

test('normalizarIds rejeita lista vazia (selecao vazia nao significa "todas")', () => {
    assert.strictEqual(seq.normalizarIds([]), undefined);
});

test('normalizarIds rejeita o que nao e lista', () => {
    assert.strictEqual(seq.normalizarIds(68), undefined);
    assert.strictEqual(seq.normalizarIds('68'), undefined);
    assert.strictEqual(seq.normalizarIds({ id: 68 }), undefined);
});

test('normalizarIds rejeita zero, negativo, decimal, lixo e boolean', () => {
    [0, -1, 1.5, '', '   ', 'abc', '1.5', true, null, undefined, {}, NaN].forEach(function (valor) {
        assert.strictEqual(
            seq.normalizarIds([valor]),
            undefined,
            'deveria rejeitar: ' + String(valor)
        );
    });
});

// ---------------------------------------------------------------------------
// buscarOrdensPendentes
// ---------------------------------------------------------------------------
function clienteFalso(registros, erro) {
    const consultas = [];
    const construtor = {
        from(tabela) {
            this._q = { tabela };
            consultas.push(this._q);
            return this;
        },
        select(campos) { this._q.campos = campos; return this; },
        neq(coluna, valor) {
            if (!this._q.neqs) this._q.neqs = [];
            this._q.neqs.push([coluna, valor]);
            return this;
        },
        in(coluna, valores) {
            if (!this._q.ins) this._q.ins = [];
            this._q.ins.push([coluna, valores]);
            return this;
        },
        then(resolve) {
            resolve(erro ? { data: null, error: erro } : { data: registros, error: null });
        }
    };
    return { construtor, consultas };
}

test('buscarOrdensPendentes consulta a tabela certa e exclui pagas e encerradas', async () => {
    const { construtor, consultas } = clienteFalso([{ id: 1 }]);

    const ordens = await seq.buscarOrdensPendentes(construtor, null);

    assert.strictEqual(consultas[0].tabela, 'ordens_producao');
    assert.deepStrictEqual(consultas[0].neqs, [
        ['situacao', 'Pago'],
        ['situacao', 'Encerrado']
    ]);
    assert.deepStrictEqual(ordens, [{ id: 1 }]);
});

test('a lista de exclusao nao bloqueia situacoes pendentes (Falta Pagar)', () => {
    assert.deepStrictEqual(seq.SITUACOES_EXCLUIDAS, ['Pago', 'Encerrado']);
    assert.ok(!seq.SITUACOES_EXCLUIDAS.includes('Falta Pagar'));
});

test('buscarOrdensPendentes pede exatamente os campos do sequenciamento', async () => {
    const { construtor, consultas } = clienteFalso([]);

    await seq.buscarOrdensPendentes(construtor, null);

    const campos = consultas[0].campos.split(',').map((c) => c.trim()).sort();
    assert.deepStrictEqual(campos, [
        'data_abertura',
        'id',
        'material',
        'numero_op',
        'observacao',
        'prioridade',
        'setor',
        'situacao',
        'total_pecas'
    ]);
});

test('buscarOrdensPendentes filtra por setor quando recebe a lista', async () => {
    const { construtor, consultas } = clienteFalso([]);

    await seq.buscarOrdensPendentes(construtor, ['Montagem', 'Usinagem']);

    assert.deepStrictEqual(consultas[0].ins, [['setor', ['Montagem', 'Usinagem']]]);
});

test('buscarOrdensPendentes nao filtra por setor quando a lista e null', async () => {
    const { construtor, consultas } = clienteFalso([]);

    await seq.buscarOrdensPendentes(construtor, null);

    assert.strictEqual(consultas[0].ins, undefined);
});

test('buscarOrdensPendentes filtra por id quando recebe a selecao', async () => {
    const { construtor, consultas } = clienteFalso([]);

    await seq.buscarOrdensPendentes(construtor, null, [68, 69]);

    assert.deepStrictEqual(consultas[0].ins, [['id', [68, 69]]]);
});

test('buscarOrdensPendentes combina setor e ids', async () => {
    const { construtor, consultas } = clienteFalso([]);

    await seq.buscarOrdensPendentes(construtor, ['Subconjunto'], [68]);

    assert.deepStrictEqual(consultas[0].ins, [
        ['setor', ['Subconjunto']],
        ['id', [68]]
    ]);
});

test('buscarOrdensPendentes sem ids nao filtra por id', async () => {
    const { construtor, consultas } = clienteFalso([]);

    await seq.buscarOrdensPendentes(construtor, ['Subconjunto'], null);

    assert.deepStrictEqual(consultas[0].ins, [['setor', ['Subconjunto']]]);
});

test('buscarOrdensPendentes propaga o erro do banco', async () => {
    const { construtor } = clienteFalso(null, { message: 'sem permissao' });

    await assert.rejects(
        () => seq.buscarOrdensPendentes(construtor, null),
        /sem permissao/
    );
});

test('buscarOrdensPendentes devolve lista vazia quando o banco nao traz nada', async () => {
    const { construtor } = clienteFalso(null);

    assert.deepStrictEqual(await seq.buscarOrdensPendentes(construtor, null), []);
});

// ---------------------------------------------------------------------------
// gerarPdf
// ---------------------------------------------------------------------------
function execFileFalso(resultado) {
    const chamadas = [];
    const fn = (comando, args, opcoes, callback) => {
        chamadas.push({ comando, args, opcoes, stdin: null, eventos: [] });
        const alvo = chamadas[chamadas.length - 1];
        const fluxo = {
            end(conteudo) { alvo.stdin = conteudo; },
            on(evento) { alvo.eventos.push(evento); },
            write() { }
        };
        const retorno = resultado instanceof Error
            ? { erro: resultado, stdout: '', stderr: 'falha no reportlab' }
            : { erro: null, stdout: resultado.stdout, stderr: resultado.stderr || '' };
        process.nextTick(() => callback(retorno.erro, retorno.stdout, retorno.stderr));
        return { stdin: fluxo };
    };
    fn.chamadas = chamadas;
    return fn;
}

test('gerarPdf manda setores e ordens por stdin em JSON', async () => {
    const destino = path.join(os.tmpdir(), 'teste_seq_' + Date.now() + '.pdf');
    fs.writeFileSync(destino, '%PDF-1.4');
    const execFile = execFileFalso({ stdout: 'aviso\n' + destino + '\n' });
    const ordens = [{ id: 1, setor: 'Montagem' }, { id: 2, setor: 'Usinagem' }];

    try {
        const resultado = await seq.gerarPdf({
            ordens,
            setores: ['Montagem'],
            scriptPath: '/app/scripts/gerar_sequenciamento_pdf.py',
            execFile
        });

        const chamada = execFile.chamadas[0];
        assert.strictEqual(resultado.caminho, destino);
        assert.strictEqual(chamada.args[0], '/app/scripts/gerar_sequenciamento_pdf.py');
        assert.deepStrictEqual(JSON.parse(chamada.stdin), {
            setores_selecionados: ['Montagem'],
            ordens
        });
    } finally {
        fs.unlinkSync(destino);
    }
});

test('gerarPdf envia setores_selecionados null quando nao ha filtro', async () => {
    const destino = path.join(os.tmpdir(), 'teste_seq_' + Date.now() + '_b.pdf');
    fs.writeFileSync(destino, '%PDF-1.4');
    const execFile = execFileFalso({ stdout: destino });

    try {
        await seq.gerarPdf({ ordens: [{ id: 1 }], setores: null, execFile });
        assert.strictEqual(JSON.parse(execFile.chamadas[0].stdin).setores_selecionados, null);
    } finally {
        fs.unlinkSync(destino);
    }
});

test('gerarPdf usa timeout e trata erro do stdin (EPIPE nao derruba o servidor)', async () => {
    const destino = path.join(os.tmpdir(), 'teste_seq_' + Date.now() + '_c.pdf');
    fs.writeFileSync(destino, '%PDF-1.4');
    const execFile = execFileFalso({ stdout: destino });

    try {
        await seq.gerarPdf({ ordens: [{ id: 1 }], setores: null, execFile });

        const chamada = execFile.chamadas[0];
        assert.ok(chamada.opcoes.timeout > 0, 'deve definir timeout');
        assert.ok(chamada.opcoes.maxBuffer >= 1024 * 1024, 'deve definir maxBuffer');
        assert.ok(chamada.eventos.includes('error'), 'deve tratar erro do stdin');
    } finally {
        fs.unlinkSync(destino);
    }
});

test('gerarPdf rejeita quando o script falha, com o stderr no detalhe', async () => {
    const execFile = execFileFalso(new Error('exit 1'));

    await assert.rejects(
        () => seq.gerarPdf({ ordens: [{ id: 1 }], setores: null, execFile }),
        (erro) => {
            assert.match(erro.detalhe, /falha no reportlab/);
            return true;
        }
    );
});

test('gerarPdf rejeita quando o caminho devolvido nao existe', async () => {
    const execFile = execFileFalso({ stdout: '/caminho/que/nao/existe.pdf' });

    await assert.rejects(
        () => seq.gerarPdf({ ordens: [{ id: 1 }], setores: null, execFile }),
        /não retornou um arquivo válido/
    );
});

test('gerarPdf rejeita quando o script nao imprime caminho nenhum', async () => {
    const execFile = execFileFalso({ stdout: '' });

    await assert.rejects(
        () => seq.gerarPdf({ ordens: [{ id: 1 }], setores: null, execFile }),
        /não retornou um arquivo válido/
    );
});

// ---------------------------------------------------------------------------
// Seguranca / convencao do projeto
// ---------------------------------------------------------------------------
test('o modulo usa execFile (sem shell) e nunca exec()', () => {
    const fonte = fs.readFileSync(
        path.join(__dirname, '..', 'lib', 'sequenciamento-ordens.js'),
        'utf8'
    );

    assert.ok(/execFile/.test(fonte), 'deve usar execFile');
    assert.ok(!/\bexec\s*\(/.test(fonte), 'nao deve chamar exec (shell)');
    assert.ok(!/--ids|--input/.test(fonte), 'nao deve montar linha de comando com argumentos');
});

test('o modulo usa a API do supabase-js (.from/.neq), nao a do Python', () => {
    const fonte = fs.readFileSync(
        path.join(__dirname, '..', 'lib', 'sequenciamento-ordens.js'),
        'utf8'
    );

    assert.ok(/\.from\(/.test(fonte), 'supabase-js expoe .from(tabela)');
    assert.ok(/\.neq\(/.test(fonte), 'supabase-js expoe .neq(coluna, valor)');
    assert.ok(!/\.table\(/.test(fonte), 'supabase-js NAO tem .table()');
    assert.ok(!/\.in_\(/.test(fonte), 'supabase-js NAO tem .in_()');
    assert.ok(!/\.execute\(/.test(fonte), 'supabase-js NAO tem .execute()');
});

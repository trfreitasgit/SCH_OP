// Testes de integracao da importacao de prioridades do PCP.
//
// Duas coisas que os testes unitarios nao provam:
//   1. o script Python de verdade le o TSV do stdin e separa relatorio/erro;
//   2. a rota existe no express atras do requireAuth (sem token -> 401, e nao
//      404 como aconteceria se a rota nao estivesse registrada).
//
// Rodar: npm test

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');

const imp = require('../lib/importar-prioridades');

const RAIZ = path.join(__dirname, '..');
const TEM_ENV = fs.existsSync(path.join(RAIZ, '.env'));

const TSV_INVALIDO = 'isso nao e uma tabela\nnem tem colunas\n';

function lerExemplo() {
    return fs.readFileSync(path.join(RAIZ, 'scripts', 'pcp_exemplo.tsv'), 'utf8');
}

// ---------------------------------------------------------------------------
// Script Python de verdade
// ---------------------------------------------------------------------------
test('TSV sem tabela reconhecivel falha no stderr e nao grava nada', async () => {
    const saida = await imp.executarImportacao({
        conteudo: TSV_INVALIDO,
        apply: false,
        timeoutMs: 60000
    });

    assert.notStrictEqual(saida.codigo, 0);
    assert.strictEqual(saida.relatorio, '', 'nada deve ir para o stdout');
    // A mensagem e do parse: prova que o TSV chegou pelo stdin e foi lido.
    assert.match(saida.erro, /nenhuma OP v[aá]lida encontrada/);
});

test('dry-run de verdade: relatorio no stdout e nenhum erro', { skip: !TEM_ENV }, async () => {
    const saida = await imp.executarImportacao({
        conteudo: lerExemplo(),
        apply: false,
        timeoutMs: 60000
    });

    assert.strictEqual(saida.codigo, 0, 'stderr: ' + saida.erro);
    assert.match(saida.relatorio, /DRY-RUN/);
    assert.match(saida.relatorio, /OPs a atualizar:/);
    assert.strictEqual(saida.erro, '');
});

test('a flag --apply nao e aceita por engano: dry-run continua dry-run', { skip: !TEM_ENV }, async () => {
    const saida = await imp.executarImportacao({
        conteudo: lerExemplo(),
        apply: false,
        timeoutMs: 60000
    });

    assert.doesNotMatch(saida.relatorio, /APLICADO/);
    assert.match(saida.relatorio, /use --apply para gravar/);
});

// ---------------------------------------------------------------------------
// Rota no express: existe e exige autenticacao
// ---------------------------------------------------------------------------
function esperar(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

async function subirServidor() {
    const porta = 20000 + Math.floor(Math.random() * 20000);
    const processo = spawn(process.execPath, [path.join(RAIZ, 'server.js')], {
        cwd: RAIZ,
        env: Object.assign({}, process.env, { PORT: String(porta) }),
        stdio: ['ignore', 'pipe', 'pipe']
    });

    let saida = '';
    processo.stdout.on('data', (pedaco) => { saida += pedaco.toString(); });
    processo.stderr.on('data', (pedaco) => { saida += pedaco.toString(); });

    const limite = Date.now() + 20000;
    while (Date.now() < limite) {
        try {
            const resposta = await fetch('http://127.0.0.1:' + porta + '/ping');
            if (resposta.ok) return { processo, porta };
        } catch (erro) {
            // ainda subindo
        }
        await esperar(200);
    }

    processo.kill();
    throw new Error('o servidor nao subiu a tempo: ' + saida);
}

test('POST /ordens/importar-prioridades existe e exige token', { skip: !TEM_ENV, timeout: 60000 }, async () => {
    let servidor;
    try {
        servidor = await subirServidor();
        const base = 'http://127.0.0.1:' + servidor.porta;

        const semToken = await fetch(base + '/ordens/importar-prioridades', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ conteudo: lerExemplo() })
        });

        // 401 e nao 404: a rota esta registrada e o requireAuth barrou antes do corpo.
        assert.strictEqual(semToken.status, 401);

        const inexistente = await fetch(base + '/rota-que-nao-existe', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: '{}'
        });
        assert.strictEqual(inexistente.status, 404, 'contraprova: rota nao registrada da 404');
    } finally {
        if (servidor) servidor.processo.kill();
    }
});

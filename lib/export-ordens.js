// Logica de exportacao XLSX do servidor.
//
// Fica fora do server.js de proposito: o server.js sobe o express ao ser
// carregado, entao a regra aqui pode ser testada sem subir o app.
//
// Decisao de performance: o servidor ja tem o cliente Supabase, entao ele
// consulta as ordens e manda as linhas prontas para o script Python pelo stdin.
// Antes o Python importava o supabase-py e repetia a consulta (~3,6 s a mais por
// exportacao) e o comando era montado numa string passada ao shell, o que
// esbarrava no limite de 8191 caracteres do Windows por volta de 1700 IDs.

const path = require('node:path');
const fs = require('node:fs');
const { execFile } = require('node:child_process');

// O PostgREST recebe os IDs na query string; lotes evitam estourar o tamanho dela.
const TAMANHO_LOTE_IDS = 500;
const TIMEOUT_EXPORT_MS = 60000;
const MAX_BUFFER_EXPORT = 16 * 1024 * 1024;

const CAMINHO_SCRIPT = path.join(__dirname, '..', 'scripts', 'export_excel.py');

function validarIds(ids) {
    if (!Array.isArray(ids) || ids.length === 0) return null;

    const limpos = [];
    for (let i = 0; i < ids.length; i++) {
        const bruto = String(ids[i] === undefined || ids[i] === null ? '' : ids[i]).trim();
        // Somente inteiros positivos.
        if (!/^\d+$/.test(bruto)) return null;
        limpos.push(bruto);
    }
    return limpos;
}

function dividirEmLotes(lista, tamanho) {
    const lotes = [];
    const passo = tamanho > 0 ? tamanho : TAMANHO_LOTE_IDS;
    for (let i = 0; i < lista.length; i += passo) {
        lotes.push(lista.slice(i, i + passo));
    }
    return lotes;
}

function lerCaminhoDaSaida(stdout) {
    const linhas = String(stdout === undefined || stdout === null ? '' : stdout)
        .split(/\r?\n/)
        .map(function (linha) { return linha.trim(); })
        .filter(function (linha) { return linha !== ''; });
    return linhas.length ? linhas[linhas.length - 1] : null;
}

async function buscarRegistros(cliente, ids, tamanhoLote) {
    if (!ids || ids.length === 0) return [];

    const registros = [];
    const lotes = dividirEmLotes(ids, tamanhoLote || TAMANHO_LOTE_IDS);

    for (let i = 0; i < lotes.length; i++) {
        // supabase-js v2: o builder e "thenable"; nao existe metodo execute()
        // (isso e do supabase-py). Entao a lib so espera (await) o resultado daqui.
        const { data, error } = await cliente
            .from('ordens_producao')
            .select('*')
            .in('id', lotes[i].map(Number).map(String));

        if (error) {
            throw new Error(error.message || 'falha ao consultar as ordens');
        }
        if (Array.isArray(data)) {
            registros.push(...data);
        }
    }

    return registros;
}

function gerarPlanilha(opcoes) {
    const scriptPath = opcoes.scriptPath || CAMINHO_SCRIPT;
    const rodar = opcoes.execFile || execFile;
    const python = opcoes.python || process.env.PYTHON_BIN || 'python';
    const payload = JSON.stringify({ ids: (opcoes.ids || []).map(Number), ordens: opcoes.registros || [] });

    return new Promise(function (resolve, reject) {
        // execFile (array de argumentos) em vez de exec: sem shell, sem limite de
        // tamanho de linha de comando e sem risco de injecao.
        const processo = rodar(
            python,
            [scriptPath],
            { timeout: opcoes.timeoutMs || TIMEOUT_EXPORT_MS, maxBuffer: MAX_BUFFER_EXPORT },
            function (erro, stdout, stderr) {
                const detalhe = String(stderr === undefined || stderr === null ? '' : stderr).trim();

                if (erro) {
                    const falha = new Error('Falha ao executar o script de exportação.');
                    falha.detalhe = detalhe || erro.message || String(erro);
                    return reject(falha);
                }

                const caminho = lerCaminhoDaSaida(stdout);
                if (!caminho || !fs.existsSync(caminho)) {
                    const falha = new Error('O script de exportação não retornou um arquivo válido.');
                    falha.detalhe = caminho || 'stdout vazio';
                    return reject(falha);
                }

                resolve({ caminho: caminho, stderr: detalhe });
            }
        );

        if (processo.stdin) {
            // Se o script fechar o stdin antes (ou o processo morrer), o pipe
            // emite 'error'; sem ouvinte isso viraria excecao nao tratada e
            // derrubaria o servidor. O erro real chega no callback.
            processo.stdin.on('error', function () { /* tratado no callback */ });
            processo.stdin.end(payload);
        }
    });
}

function nomeArquivoExport(data) {
    return 'ordens_' + new Date(data || Date.now()).toISOString().slice(0, 19).replace(/[:T]/g, '-') + '.xlsx';
}

module.exports = {
    CAMINHO_SCRIPT,
    TAMANHO_LOTE_IDS,
    TIMEOUT_EXPORT_MS,
    validarIds,
    dividirEmLotes,
    lerCaminhoDaSaida,
    buscarRegistros,
    gerarPlanilha,
    nomeArquivoExport
};

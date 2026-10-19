// Logica do PDF de Sequenciamento de Producao.
//
// Mesma arquitetura de lib/export-ordens.js: o server.js sobe o express ao ser
// carregado, entao a regra fica aqui para poder ser testada sem subir o app.
//
// O servidor consulta as ordens no Supabase (o cliente ja existe) e manda as
// linhas prontas para o script Python pelo stdin. Vantagens:
//   - o Python nao repete a consulta (economiza alguns segundos por impressao);
//   - execFile com array de argumentos: sem shell, sem limite de linha de
//     comando do Windows (8191 chars) e sem risco de injecao.
//
// Convencao: o script imprime na ULTIMA linha do stdout o caminho do PDF gerado;
// o servidor envia esse arquivo e o remove depois.

const path = require('node:path');
const fs = require('node:fs');
const { execFile } = require('node:child_process');

const CAMINHO_SCRIPT = path.join(__dirname, '..', 'scripts', 'gerar_sequenciamento_pdf.py');

// Ordens que NAO entram na folha de sequenciamento.
//   'Pago'      -> producao ja liberada
//   'Encerrado' -> ordem concluida/arquivada, nao deve ser impressa de novo
// A lista e de exclusao (e nao de inclusao) de proposito: se o sistema ganhar
// uma nova situacao pendente, ela entra na folha sem precisar mexer aqui.
const SITUACOES_EXCLUIDAS = ['Pago', 'Encerrado'];

// Somente os campos que a folha imprime (o script nao usa o resto).
const CAMPOS_ORDENS = [
    'id',
    'numero_op',
    'material',
    'total_pecas',
    'data_abertura',
    'situacao',
    'setor',
    'prioridade',
    'observacao'
].join(', ');

const NOME_ARQUIVO = 'sequenciamento_schadek.pdf';
const TIMEOUT_SEQUENCIAMENTO_MS = 60000;
const MAX_BUFFER_SEQUENCIAMENTO = 16 * 1024 * 1024;

// Normaliza o filtro de setores vindo do body.
//   undefined/null/[] -> null  (todos os setores)
//   lista            -> array limpo, sem vazios e sem repetidos
//   nao-lista        -> undefined (entrada invalida; o chamador responde 400)
function normalizarSetores(setores) {
    if (setores === undefined || setores === null) return null;
    if (!Array.isArray(setores)) return undefined;

    const limpos = [];
    for (let i = 0; i < setores.length; i++) {
        const bruto = setores[i];
        if (bruto === undefined || bruto === null) continue;
        const texto = String(bruto).trim();
        if (texto === '') continue;
        if (limpos.indexOf(texto) === -1) limpos.push(texto);
    }

    return limpos.length ? limpos : null;
}

function lerCaminhoDaSaida(stdout) {
    const linhas = String(stdout === undefined || stdout === null ? '' : stdout)
        .split(/\r?\n/)
        .map(function (linha) { return linha.trim(); })
        .filter(function (linha) { return linha !== ''; });
    return linhas.length ? linhas[linhas.length - 1] : null;
}

// Busca as ordens que ainda vao para a producao (exclui pagas e encerradas).
// Quando `setores` vem preenchido, filtra no banco para que o endpoint consiga
// responder 400 quando nada sobrar.
async function buscarOrdensPendentes(cliente, setores) {
    let consulta = cliente
        .from('ordens_producao')
        .select(CAMPOS_ORDENS);

    // Um neq por situacao: o PostgREST combina os filtros da mesma coluna com AND.
    for (let i = 0; i < SITUACOES_EXCLUIDAS.length; i++) {
        consulta = consulta.neq('situacao', SITUACOES_EXCLUIDAS[i]);
    }

    if (Array.isArray(setores) && setores.length) {
        consulta = consulta.in('setor', setores);
    }

    // supabase-js v2: o builder e "thenable"; nao existe execute() (isso e do
    // supabase-py). Entao a lib so espera (await) o resultado daqui.
    const { data, error } = await consulta;

    if (error) {
        throw new Error(error.message || 'falha ao consultar as ordens pendentes');
    }
    return Array.isArray(data) ? data : [];
}

function gerarPdf(opcoes) {
    const scriptPath = opcoes.scriptPath || CAMINHO_SCRIPT;
    const rodar = opcoes.execFile || execFile;
    const python = opcoes.python || process.env.PYTHON_BIN || 'python';
    const setores = Array.isArray(opcoes.setores) && opcoes.setores.length ? opcoes.setores : null;
    const payload = JSON.stringify({
        setores_selecionados: setores,
        ordens: opcoes.ordens || []
    });

    return new Promise(function (resolve, reject) {
        const processo = rodar(
            python,
            [scriptPath],
            {
                timeout: opcoes.timeoutMs || TIMEOUT_SEQUENCIAMENTO_MS,
                maxBuffer: MAX_BUFFER_SEQUENCIAMENTO
            },
            function (erro, stdout, stderr) {
                const detalhe = String(stderr === undefined || stderr === null ? '' : stderr).trim();

                if (erro) {
                    const falha = new Error('Falha ao executar o script de sequenciamento.');
                    falha.detalhe = detalhe || erro.message || String(erro);
                    return reject(falha);
                }

                const caminho = lerCaminhoDaSaida(stdout);
                if (!caminho || !fs.existsSync(caminho)) {
                    const falha = new Error('O script de sequenciamento não retornou um arquivo válido.');
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

function nomeArquivoPdf() {
    return NOME_ARQUIVO;
}

module.exports = {
    CAMINHO_SCRIPT,
    SITUACOES_EXCLUIDAS,
    CAMPOS_ORDENS,
    NOME_ARQUIVO,
    TIMEOUT_SEQUENCIAMENTO_MS,
    normalizarSetores,
    lerCaminhoDaSaida,
    buscarOrdensPendentes,
    gerarPdf,
    nomeArquivoPdf
};

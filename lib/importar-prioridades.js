// Importacao das prioridades do PCP (POST /ordens/importar-prioridades).
//
// Fica fora do server.js de proposito: o server.js sobe o express ao ser
// carregado, entao a regra aqui pode ser testada sem subir o app.
//
// Contrato do script Python (scripts/importar_prioridades_pcp.py):
//   * recebe o TSV do e-mail pelo stdin (ou --input <arquivo>);
//   * sem --apply apenas simula (dry-run), com --apply grava no Supabase;
//   * imprime o relatorio no stdout e os erros no stderr;
//   * sai com 0 em sucesso, 1 em falha de importacao e 2 em uso incorreto.

const path = require('node:path');
const { spawn } = require('node:child_process');

const CAMINHO_SCRIPT = path.join(__dirname, '..', 'scripts', 'importar_prioridades_pcp.py');

// --apply pode atualizar centenas de OPs uma a uma no Supabase; 2 min e folga.
const TIMEOUT_IMPORTACAO_MS = 120000;

function validarEntrada(corpo) {
    if (!corpo || typeof corpo !== 'object' || Array.isArray(corpo)) return null;

    if (typeof corpo.conteudo !== 'string' || corpo.conteudo.trim() === '') return null;
    if (corpo.apply !== undefined && typeof corpo.apply !== 'boolean') return null;

    return { conteudo: corpo.conteudo, apply: corpo.apply === true };
}

function falhaComDetalhe(mensagem, erro) {
    const detalhe = erro
        ? [erro.message, erro.code].filter(Boolean).join(' ').trim()
        : '';
    const falha = new Error(mensagem);
    falha.detalhe = detalhe || mensagem;
    return falha;
}

function executarImportacao(opcoes) {
    const scriptPath = opcoes.scriptPath || CAMINHO_SCRIPT;
    const python = opcoes.python || process.env.PYTHON_BIN || 'python';
    const args = [scriptPath].concat(opcoes.apply === true ? ['--apply'] : []);
    const rodar = opcoes.spawn || spawn;
    const timeoutMs = opcoes.timeoutMs || TIMEOUT_IMPORTACAO_MS;

    return new Promise(function (resolve, reject) {
        let finalizado = false;
        let relatorio = '';
        let erro = '';

        let crianca;
        try {
            // spawn com stdio em pipe: o TSV vai pelo stdin, sem arquivo
            // temporario e sem shell (sem limite de linha de comando).
            crianca = rodar(python, args, { stdio: ['pipe', 'pipe', 'pipe'] });
        } catch (falhaAoIniciar) {
            return reject(falhaComDetalhe('Falha ao executar o script de importação.', falhaAoIniciar));
        }

        function terminar() {
            finalizado = true;
            clearTimeout(limite);
        }

        const limite = setTimeout(function () {
            if (finalizado) return;
            terminar();
            try { crianca.kill(); } catch (erroAoMatar) { /* ja morreu */ }
            reject(falhaComDetalhe(
                'O script de importação excedeu o tempo limite de ' + timeoutMs + ' ms.'
            ));
        }, timeoutMs);

        // UTF-8 explicito: o relatorio tem acentos e um corte no meio de um
        // caractere entre dois chunks corromperia a saida.
        if (typeof crianca.stdout.setEncoding === 'function') crianca.stdout.setEncoding('utf8');
        if (typeof crianca.stderr.setEncoding === 'function') crianca.stderr.setEncoding('utf8');

        crianca.stdout.on('data', function (pedaco) { relatorio += pedaco; });
        crianca.stderr.on('data', function (pedaco) { erro += pedaco; });

        crianca.on('error', function (falha) {
            if (finalizado) return;
            terminar();
            // ENOENT (python fora do PATH), EACCES, etc.
            reject(falhaComDetalhe('Falha ao executar o script de importação.', falha));
        });

        // Se o script morrer antes de ler o stdin, o pipe emite 'error'; sem
        // ouvinte isso viraria excecao nao tratada e derrubaria o servidor.
        crianca.stdin.on('error', function () { /* o erro real chega no 'close' */ });
        crianca.stdin.end(opcoes.conteudo);

        // 'close' (e nao 'exit') garante que stdout/stderr ja foram lidos.
        crianca.on('close', function (codigo) {
            if (finalizado) return;
            terminar();
            resolve({
                relatorio: relatorio,
                erro: erro,
                codigo: codigo === null || codigo === undefined ? -1 : codigo
            });
        });
    });
}

module.exports = {
    CAMINHO_SCRIPT,
    TIMEOUT_IMPORTACAO_MS,
    validarEntrada,
    executarImportacao
};

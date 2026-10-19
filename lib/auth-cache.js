// Cache em memoria dos tokens ja validados pelo Supabase.
//
// Motivacao: cada requisicao autenticada chamava supabase.auth.getUser(token),
// o que gera uma chamada HTTP + evento de log no Supabase por request. Com o
// cache, o mesmo token so vai ao Supabase uma vez a cada TTL.
//
// Fica fora do server.js para poder ser testado sem subir o express, seguindo o
// mesmo padrao de lib/export-ordens.js e lib/sequenciamento-ordens.js.
//
// Seguranca:
//   - a chave do Map e o SHA-256 do token, entao o mapa nao guarda credencial
//     em claro (o token ja circula no header de qualquer forma);
//   - o vencimento nunca passa do `exp` do proprio JWT, ou seja, o cache nao
//     estende a vida de um token;
//   - apenas validacoes bem-sucedidas entram no cache;
//   - um token revogado no Supabase continua aceito ate o TTL (150 s). E o
//     preco do cache e esta documentado de proposito.

const crypto = require('node:crypto');

// 2,5 min: reduz muito o volume de chamadas e mantem a janela de revogacao curta.
const TTL_PADRAO_MS = 150000;
const MAX_ENTRADAS = 1000;

// Chave do mapa: SHA-256 em hexadecimal. Exportada para teste.
function chaveDoToken(token) {
    return crypto.createHash('sha256').update(String(token)).digest('hex');
}

// Le o `exp` (segundos) do JWT sem validar a assinatura: a validacao ja foi
// feita pelo Supabase antes de guardar. Serve so para nao cachear alem do
// vencimento. Devolve null quando o token nao e um JWT legivel.
function expiracaoDoToken(token) {
    try {
        const partes = String(token).split('.');
        if (partes.length !== 3) return null;

        const carga = JSON.parse(Buffer.from(partes[1], 'base64url').toString('utf8'));
        return typeof carga.exp === 'number' ? carga.exp * 1000 : null;
    } catch (erro) {
        return null;
    }
}

function criarCacheDeAutenticacao(opcoes) {
    const config = opcoes || {};
    const ttlMs = config.ttlMs === undefined ? TTL_PADRAO_MS : config.ttlMs;
    const maximo = config.maximo === undefined ? MAX_ENTRADAS : config.maximo;
    const agora = config.agora || Date.now;

    const entradas = new Map();
    let acertos = 0;
    let erros = 0;

    // Remove vencidos e depois corta os mais antigos ate caber no limite.
    // Chamada na gravacao: sem timer, sem handle pendente no processo.
    function limparExpirados() {
        const instante = agora();
        for (const [chave, entrada] of entradas) {
            if (instante >= entrada.expiresAt) entradas.delete(chave);
        }

        while (entradas.size > maximo) {
            entradas.delete(entradas.keys().next().value);
        }
    }

    // Devolve o usuario ou undefined quando o token nao esta (mais) no cache.
    function obter(token) {
        const chave = chaveDoToken(token);
        const entrada = entradas.get(chave);

        if (!entrada || agora() >= entrada.expiresAt) {
            if (entrada) entradas.delete(chave);
            erros++;
            return undefined;
        }

        // LRU: reinserir move a entrada para o fim do Map (a mais recente).
        entradas.delete(chave);
        entradas.set(chave, entrada);
        acertos++;
        return entrada.user;
    }

    // Guarda apenas validacoes bem-sucedidas e nunca alem do `exp` do token.
    function guardar(token, user) {
        if (!user) return;

        const instante = agora();
        let expiresAt = instante + ttlMs;
        const expDoToken = expiracaoDoToken(token);
        if (expDoToken !== null) expiresAt = Math.min(expiresAt, expDoToken);

        // Token que ja venceu (ou ttl zero) nao entra: seria erro no proximo uso.
        if (expiresAt <= instante) return;

        const chave = chaveDoToken(token);
        entradas.delete(chave);
        entradas.set(chave, { user: user, expiresAt: expiresAt });
        limparExpirados();
    }

    function remover(token) {
        entradas.delete(chaveDoToken(token));
    }

    function limpar() {
        entradas.clear();
    }

    function estatisticas() {
        return { acertos: acertos, erros: erros, tamanho: entradas.size };
    }

    return {
        obter: obter,
        guardar: guardar,
        remover: remover,
        limpar: limpar,
        limparExpirados: limparExpirados,
        estatisticas: estatisticas
    };
}

module.exports = {
    TTL_PADRAO_MS,
    MAX_ENTRADAS,
    chaveDoToken,
    expiracaoDoToken,
    criarCacheDeAutenticacao
};

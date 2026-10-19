// Testes do cache de tokens validados (lib/auth-cache.js).
//
// O cache fica fora do server.js de proposito: o server.js sobe o express ao ser
// carregado, entao a regra fica aqui para poder ser testada sem subir o app.
//
// Rodar: node --test tests/*.test.js

const { test } = require('node:test');
const assert = require('node:assert');

const authCache = require('../lib/auth-cache');

// Relogio controlado: os testes nao dependem do tempo real.
function relogio(inicio) {
    let agora = inicio === undefined ? 1700000000000 : inicio;
    return {
        agora: function () { return agora; },
        avancar: function (ms) { agora += ms; }
    };
}

function tokenFalso(expSegundos) {
    const cabecalho = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
    const carga = { sub: 'usuario-1' };
    if (expSegundos !== undefined) carga.exp = expSegundos;
    const corpo = Buffer.from(JSON.stringify(carga)).toString('base64url');
    return cabecalho + '.' + corpo + '.assinatura';
}

test('cache vazio devolve undefined e conta erro', () => {
    const cache = authCache.criarCacheDeAutenticacao({ agora: relogio().agora });
    const usuario = { id: 'u1' };

    assert.strictEqual(cache.obter('token'), undefined);
    assert.deepStrictEqual(cache.estatisticas(), { acertos: 0, erros: 1, tamanho: 0 });
    assert.strictEqual(usuario.id, 'u1');
});

test('guardar e obter devolve o mesmo usuario sem ir ao Supabase', () => {
    const cache = authCache.criarCacheDeAutenticacao({ agora: relogio().agora });
    const usuario = { id: 'u1', email: 'a@b.c' };

    cache.guardar('token-valido', usuario);

    assert.strictEqual(cache.obter('token-valido'), usuario);
    assert.deepStrictEqual(cache.estatisticas(), { acertos: 1, erros: 0, tamanho: 1 });
});

test('entrada expira depois do ttl', () => {
    const r = relogio();
    const cache = authCache.criarCacheDeAutenticacao({ ttlMs: 150000, agora: r.agora });

    cache.guardar('token', { id: 'u1' });
    r.avancar(149999);
    assert.ok(cache.obter('token'), 'ainda vale antes do ttl');

    r.avancar(1);
    assert.strictEqual(cache.obter('token'), undefined, 'expira exatamente no ttl');
    assert.strictEqual(cache.estatisticas().tamanho, 0, 'entrada expirada sai do mapa');
});

test('ttl nunca ultrapassa o exp do jwt', () => {
    const r = relogio();
    const cache = authCache.criarCacheDeAutenticacao({ ttlMs: 150000, agora: r.agora });
    const token = tokenFalso(Math.floor(r.agora() / 1000) + 30);

    cache.guardar(token, { id: 'u1' });

    r.avancar(29999);
    assert.ok(cache.obter(token), 'vale antes do exp do token');

    r.avancar(1);
    assert.strictEqual(cache.obter(token), undefined, 'nao sobrevive ao exp do token');
});

test('token sem exp usa o ttl configurado', () => {
    const r = relogio();
    const cache = authCache.criarCacheDeAutenticacao({ ttlMs: 60000, agora: r.agora });
    const token = tokenFalso();

    cache.guardar(token, { id: 'u1' });
    r.avancar(59999);
    assert.ok(cache.obter(token));

    r.avancar(1);
    assert.strictEqual(cache.obter(token), undefined);
});

test('token malformado nao quebra e cai no ttl', () => {
    const r = relogio();
    const cache = authCache.criarCacheDeAutenticacao({ ttlMs: 60000, agora: r.agora });

    cache.guardar('nao-e-um-jwt', { id: 'u1' });
    r.avancar(30000);

    assert.deepStrictEqual(cache.obter('nao-e-um-jwt'), { id: 'u1' });
});

test('token ja vencido nao entra no cache', () => {
    const r = relogio();
    const cache = authCache.criarCacheDeAutenticacao({ ttlMs: 150000, agora: r.agora });
    const token = tokenFalso(Math.floor(r.agora() / 1000) - 1);

    cache.guardar(token, { id: 'u1' });

    assert.strictEqual(cache.estatisticas().tamanho, 0);
    assert.strictEqual(cache.obter(token), undefined);
});

test('nao guarda usuario ausente', () => {
    const cache = authCache.criarCacheDeAutenticacao({ agora: relogio().agora });

    cache.guardar('token', null);
    cache.guardar('token', undefined);

    assert.strictEqual(cache.estatisticas().tamanho, 0);
});

test('remover apaga somente o token indicado', () => {
    const cache = authCache.criarCacheDeAutenticacao({ agora: relogio().agora });

    cache.guardar('a', { id: 'a' });
    cache.guardar('b', { id: 'b' });
    cache.remover('a');

    assert.strictEqual(cache.obter('a'), undefined);
    assert.deepStrictEqual(cache.obter('b'), { id: 'b' });
});

test('limpar esvazia o cache', () => {
    const cache = authCache.criarCacheDeAutenticacao({ agora: relogio().agora });

    cache.guardar('a', { id: 'a' });
    cache.guardar('b', { id: 'b' });
    cache.limpar();

    assert.strictEqual(cache.estatisticas().tamanho, 0);
});

test('limite de entradas descarta a mais antiga', () => {
    const cache = authCache.criarCacheDeAutenticacao({ maximo: 2, agora: relogio().agora });

    cache.guardar('a', { id: 'a' });
    cache.guardar('b', { id: 'b' });
    cache.guardar('c', { id: 'c' });

    assert.strictEqual(cache.estatisticas().tamanho, 2);
    assert.strictEqual(cache.obter('a'), undefined, 'a mais antiga saiu');
    assert.ok(cache.obter('b') && cache.obter('c'));
});

test('obter renova a posicao da entrada no lru', () => {
    const cache = authCache.criarCacheDeAutenticacao({ maximo: 2, agora: relogio().agora });

    cache.guardar('a', { id: 'a' });
    cache.guardar('b', { id: 'b' });
    cache.obter('a'); // 'a' passa a ser a mais recente
    cache.guardar('c', { id: 'c' });

    assert.strictEqual(cache.obter('b'), undefined, 'b era a mais antiga');
    assert.deepStrictEqual(cache.obter('a'), { id: 'a' });
    assert.deepStrictEqual(cache.obter('c'), { id: 'c' });
});

test('chaveDoToken nao guarda o token em claro', () => {
    const token = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ1MSJ9.assinatura';

    assert.notStrictEqual(authCache.chaveDoToken(token), token);
    assert.strictEqual(authCache.chaveDoToken(token), authCache.chaveDoToken(token));
    assert.notStrictEqual(
        authCache.chaveDoToken('token-a'),
        authCache.chaveDoToken('token-b')
    );
    assert.match(authCache.chaveDoToken(token), /^[0-9a-f]{64}$/);
});

test('estatisticas separam acertos de erros', () => {
    const cache = authCache.criarCacheDeAutenticacao({ agora: relogio().agora });

    cache.guardar('a', { id: 'a' });
    cache.obter('a');
    cache.obter('a');
    cache.obter('inexistente');

    assert.deepStrictEqual(cache.estatisticas(), { acertos: 2, erros: 1, tamanho: 1 });
});

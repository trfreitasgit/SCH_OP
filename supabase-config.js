/* ==========================================================================
   SUPABASE CLIENT CONFIG (FRONTEND)
   --------------------------------------------------------------------------
   Valores publicos (seguros para expor no navegador: a anon key so permite o
   que as policies de RLS autorizam).

   IMPORTANTE: o projeto abaixo deve ser o MESMO que o backend (server.js)
   usa para validar o JWT (`supabase.auth.getUser(token)`), caso contrario
   todas as chamadas a /ordens retornam 401.
   ========================================================================== */
window.SUPABASE_URL = window.SUPABASE_URL || 'https://ggjbvrrkirssdhpslyzh.supabase.co';
window.SUPABASE_ANON_KEY = window.SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImdnamJ2cnJraXJzc2RocHNseXpoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTE5OTk0MzcsImV4cCI6MjEwNzU3NTQzN30.7rtd8uhybZMh1nDMesjOn9nKcyQV3VgxfVFgUPDEJY8';

/* Cliente Supabase unico, compartilhado por login.js e ordens.js.
   Lazy initialization: o SDK da CDN pode nao estar disponivel no instante em
   que este arquivo e avaliado. Por isso o cliente NAO e criado aqui: ele so e
   instanciado na primeira chamada de window.getSbClient(), quando o SDK ja
   existe. A instancia fica memoizada em window.sbClient (uma unica conexao). */
window.getSbClient = function () {
    if (window.sbClient) return window.sbClient;
    if (!window.supabase || !window.SUPABASE_URL || !window.SUPABASE_ANON_KEY) {
        console.error('[SUPABASE] SDK ou credenciais ausentes - verifique supabase-config.js');
        return null;
    }
    window.sbClient = window.supabase.createClient(window.SUPABASE_URL, window.SUPABASE_ANON_KEY, {
        auth: {
            persistSession: true,
            autoRefreshToken: true,
            detectSessionInUrl: true
        }
    });
    return window.sbClient;
};

/* ==========================================================================
   COOKIE DE SESSAO PARA NAVEGACAO SERVER-SIDE
   --------------------------------------------------------------------------
   O server.js (middleware requireAuth) aceita o JWT por DUAS vias:
     1. header `Authorization: Bearer <jwt>`  -> usado pelos fetch() da API
     2. cookie  `access_token`                -> unica via possivel numa
        navegacao de pagina do browser (HTML), onde nenhum header e enviado
   Como o SDK do Supabase guarda a sessao em localStorage (invisivel ao
   servidor), sem este cookie o GET / responde 302 /login e o login.js
   redireciona de volta para / -> LOOP INFINITO de redirecionamento.
   Estas funcoes mantem o cookie sincronizado com a sessao do Supabase.
   ========================================================================== */
window.sbSetAuthCookie = function (token, expiresInSeconds) {
    if (!token) return false;
    try {
        const maxAge = Math.max(60, parseInt(expiresInSeconds, 10) || 3600);
        const secure = window.location.protocol === 'https:' ? '; Secure' : '';
        document.cookie = 'access_token=' + encodeURIComponent(token) +
            '; path=/; max-age=' + maxAge + '; SameSite=Lax' + secure;
        return document.cookie.indexOf('access_token=') !== -1;
    } catch (e) {
        console.warn('[AUTH] falha ao gravar o cookie de sessao:', e.message);
        return false;
    }
};

window.sbClearAuthCookie = function () {
    try {
        document.cookie = 'access_token=; path=/; max-age=0; SameSite=Lax';
    } catch (e) { /* ignore */ }
};

/* Sincroniza o cookie com uma sessao do Supabase. Retorna true se o cookie
   ficou gravado (ou seja: o servidor vai aceitar a navegacao para /). */
window.sbSyncAuthCookie = function (session) {
    if (!session || !session.access_token) {
        window.sbClearAuthCookie();
        return false;
    }
    const agora = Math.floor(Date.now() / 1000);
    const expiresIn = session.expires_at ? (session.expires_at - agora) : 3600;
    return window.sbSetAuthCookie(session.access_token, expiresIn);
};


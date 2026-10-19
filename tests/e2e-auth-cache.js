// E2E do cache de autenticacao e da projecao de colunas.
//
// Sobe o servidor real numa porta separada (3100) com o preload que conta as
// chamadas a supabase.auth.getUser, entao mede o efeito de verdade em vez de
// confiar no codigo.
//
// Rodar: node tests/e2e-auth-cache.js
// Requer: porta 3100 livre e acesso ao Supabase.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

const BASE = 'http://127.0.0.1:3100';
const TTL_MS = 3000;
const ARQUIVO_CONTAGEM = path.join(os.tmpdir(), 'e2e_auth_count_' + process.pid + '.log');

const cfg = {};
for (const line of fs.readFileSync(`${__dirname}/../.env`, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^([A-Z_]+)=(.*)$/);
    if (m) cfg[m[1]] = m[2].trim();
}
const ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImdnamJ2cnJraXJzc2RocHNseXpoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTE5OTk0MzcsImV4cCI6MjEwNzU3NTQzN30.7rtd8uhybZMh1nDMesjOn9nKcyQV3VgxfVFgUPDEJY8';

const COLUNAS = [
    'created_at', 'data_abertura', 'dia_analise', 'id', 'material', 'numero_op',
    'observacao', 'peso_prioridade', 'prioridade', 'setor', 'situacao',
    'total_pecas', 'updated_at'
];

let ok = 0;
let fail = 0;
const check = (nome, cond, extra) => {
    if (cond) { ok++; console.log('  PASS', nome, extra || ''); }
    else { fail++; console.log('  FAIL', nome, extra || ''); }
};

const chamadasGetUser = () => (fs.existsSync(ARQUIVO_CONTAGEM)
    ? fs.readFileSync(ARQUIVO_CONTAGEM, 'utf8').split('\n').filter(Boolean).length
    : 0);

const dormir = (ms) => new Promise((r) => setTimeout(r, ms));

async function esperarServidor(limiteMs) {
    const inicio = Date.now();
    while (Date.now() - inicio < limiteMs) {
        try {
            const r = await fetch(`${BASE}/login`);
            if (r.status === 200) return true;
        } catch (e) { /* ainda subindo */ }
        await dormir(250);
    }
    return false;
}

(async () => {
    fs.writeFileSync(ARQUIVO_CONTAGEM, '');
    const servidor = spawn('node', ['-r', './tests/preload-contador-auth.js', 'server.js'], {
        cwd: path.join(__dirname, '..'),
        env: Object.assign({}, process.env, {
            PORT: '3100',
            AUTH_COUNT_FILE: ARQUIVO_CONTAGEM,
            AUTH_CACHE_TTL_MS: String(TTL_MS)
        }),
        stdio: ['ignore', 'pipe', 'pipe']
    });

    let saida = '';
    servidor.stdout.on('data', (d) => { saida += d.toString(); });
    servidor.stderr.on('data', (d) => { saida += d.toString(); });

    const encerrar = () => {
        try { servidor.kill('SIGKILL'); } catch (e) { /* ja morreu */ }
    };

    try {
        const subiu = await esperarServidor(20000);
        if (!subiu) {
            console.error('SERVIDOR NAO SUBIU (porta 3100 ocupada?)\n' + saida);
            process.exit(1);
        }

        const lr = await fetch(`${cfg.SUPABASE_URL_ORDENS}/auth/v1/token?grant_type=password`, {
            method: 'POST',
            headers: { apikey: ANON, 'Content-Type': 'application/json' },
            body: JSON.stringify({ email: 'admin@schadek.com.br', password: 'schadek123' })
        });
        const token = (await lr.json()).access_token;
        if (!token) { console.error('LOGIN FALHOU'); process.exit(1); }
        const H = { Accept: '*/*', Authorization: 'Bearer ' + token };
        console.log('Login OK | ttl do cache =', TTL_MS, 'ms | chamadas iniciais:', chamadasGetUser(), '\n');

        console.log('== primeira requisicao valida o token uma vez ==');
        const primeira = await fetch(`${BASE}/ordens`, { headers: H });
        const ordens = await primeira.json();
        check('GET /ordens -> 200', primeira.status === 200, 'status=' + primeira.status);
        check('primeira requisicao chamou getUser 1x', chamadasGetUser() === 1, 'chamadas=' + chamadasGetUser());
        check('payload com ordens', Array.isArray(ordens) && ordens.length > 0, ordens.length + ' ordens');

        console.log('\n== requisicoes seguintes usam o cache ==');
        for (let i = 0; i < 3; i++) {
            const r = await fetch(`${BASE}/ordens`, { headers: H });
            check(`GET /ordens #${i + 2} -> 200`, r.status === 200, 'status=' + r.status);
        }
        check('4 requisicoes validas = 1 chamada ao Supabase', chamadasGetUser() === 1, 'chamadas=' + chamadasGetUser());

        console.log('\n== /ordens/pendentes tambem reaproveita o token ==');
        const pendentes = await fetch(`${BASE}/ordens/pendentes`, { headers: H });
        const listaPendentes = await pendentes.json();
        check('GET /ordens/pendentes -> 200', pendentes.status === 200, 'status=' + pendentes.status);
        check('nao chamou o Supabase de novo', chamadasGetUser() === 1, 'chamadas=' + chamadasGetUser());

        console.log('\n== projecao de colunas ==');
        const chaves = Object.keys(ordens[0]).sort();
        check('GET /ordens devolve exatamente as 13 colunas do frontend', JSON.stringify(chaves) === JSON.stringify(COLUNAS), chaves.join(','));
        const chavesPendentes = Object.keys(listaPendentes[0]).sort();
        check('GET /ordens/pendentes devolve as mesmas colunas', JSON.stringify(chavesPendentes) === JSON.stringify(COLUNAS), chavesPendentes.join(','));
        check('nenhuma coluna extra (select * teria o mesmo efeito hoje)', chaves.length === 13, chaves.length + ' colunas');

        console.log('\n== token invalido nunca entra no cache ==');
        const antesInvalidos = chamadasGetUser();
        const invalido1 = await fetch(`${BASE}/ordens`, { headers: { Accept: '*/*', Authorization: 'Bearer token-invalido' } });
        const invalido2 = await fetch(`${BASE}/ordens`, { headers: { Accept: '*/*', Authorization: 'Bearer token-invalido' } });
        check('token invalido -> 401', invalido1.status === 401 && invalido2.status === 401, `status=${invalido1.status}/${invalido2.status}`);
        check('cada tentativa invalida vai ao Supabase', chamadasGetUser() === antesInvalidos + 2, 'chamadas=' + chamadasGetUser());

        console.log('\n== apos o ttl o token e revalidado ==');
        await dormir(TTL_MS + 400);
        const depoisTtl = await fetch(`${BASE}/ordens`, { headers: H });
        check('GET /ordens apos o ttl -> 200', depoisTtl.status === 200, 'status=' + depoisTtl.status);
        check('revalidou no Supabase (1 chamada nova)', chamadasGetUser() === antesInvalidos + 3, 'chamadas=' + chamadasGetUser());

        const emCacheNovamente = await fetch(`${BASE}/ordens`, { headers: H });
        check('volta a usar o cache', emCacheNovamente.status === 200 && chamadasGetUser() === antesInvalidos + 3, 'chamadas=' + chamadasGetUser());

        console.log(`\nTOTAL de chamadas a getUser para 9 requisicoes validas: ${antesInvalidos + 2}`);
        console.log(`RESULTADO: ${ok} PASS / ${fail} FAIL`);
        process.exitCode = fail ? 1 : 0;
    } catch (erro) {
        console.error('ERRO:', erro.message);
        console.error(saida);
        process.exitCode = 1;
    } finally {
        encerrar();
        if (fs.existsSync(ARQUIVO_CONTAGEM)) fs.unlinkSync(ARQUIVO_CONTAGEM);
    }
})();

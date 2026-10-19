// E2E do endpoint POST /ordens/sequenciamento/pdf.
//
// Precisa do servidor rodando em http://127.0.0.1:3000 e do Python com reportlab.
// Rodar: node tests/e2e-sequenciamento.js

const fs = require('node:fs');
const os = require('node:os');

const BASE = 'http://127.0.0.1:3000';
const cfg = {};
for (const line of fs.readFileSync(`${__dirname}/../.env`, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^([A-Z_]+)=(.*)$/);
    if (m) cfg[m[1]] = m[2].trim();
}
const ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImdnamJ2cnJraXJzc2RocHNseXpoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTE5OTk0MzcsImV4cCI6MjEwNzU3NTQzN30.7rtd8uhybZMh1nDMesjOn9nKcyQV3VgxfVFgUPDEJY8';

let ok = 0;
let fail = 0;
const check = (nome, cond, extra) => {
    if (cond) { ok++; console.log('  PASS', nome, extra || ''); }
    else { fail++; console.log('  FAIL', nome, extra || ''); }
};
const pdfsNoTemp = () => fs.readdirSync(os.tmpdir()).filter((f) => /^sequenciamento_.*\.pdf$/i.test(f));

(async () => {
    const lr = await fetch(`${cfg.SUPABASE_URL_ORDENS}/auth/v1/token?grant_type=password`, {
        method: 'POST',
        headers: { apikey: ANON, 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'admin@schadek.com.br', password: 'schadek123' })
    });
    const token = (await lr.json()).access_token;
    if (!token) { console.error('LOGIN FALHOU'); process.exit(1); }
    const H = { 'Content-Type': 'application/json', Accept: '*/*', Authorization: 'Bearer ' + token };
    console.log('Login OK\n');

    // Quantas ordens pendentes existem hoje (situacao != 'Pago')
    const todas = await (await fetch(`${BASE}/ordens`, { headers: H })).json();
    const pendentes = todas.filter((o) => o.situacao !== 'Pago');
    console.log('ordens no banco:', todas.length, '| pendentes (situacao != Pago):', pendentes.length);
    const setores = Array.from(new Set(pendentes.map((o) => o.setor))).filter(Boolean);
    console.log('setores com pendencia:', JSON.stringify(setores), '\n');

    const antes = pdfsNoTemp();
    console.log('pdfs sequenciamento_*.pdf no temp antes:', antes.length);

    console.log('\n== autenticacao e validacao ==');
    const semAuth = await fetch(`${BASE}/ordens/sequenciamento/pdf`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}'
    });
    check('sem token -> 401', semAuth.status === 401, 'status=' + semAuth.status);

    const tipoErrado = await fetch(`${BASE}/ordens/sequenciamento/pdf`, {
        method: 'POST', headers: H, body: JSON.stringify({ setores_selecionados: 'Montagem' })
    });
    const corpoTipo = await tipoErrado.json().catch(() => ({}));
    check('setores_selecionados string -> 400', tipoErrado.status === 400, 'status=' + tipoErrado.status);
    check('mensagem de erro em JSON', typeof corpoTipo.erro === 'string', corpoTipo.erro || '');

    const setorFantasma = await fetch(`${BASE}/ordens/sequenciamento/pdf`, {
        method: 'POST', headers: H,
        body: JSON.stringify({ setores_selecionados: ['SetorQueNaoExiste'] })
    });
    const corpoFantasma = await setorFantasma.json().catch(() => ({}));
    check('setor sem pendencia -> 400', setorFantasma.status === 400, 'status=' + setorFantasma.status);
    check(
        'mensagem amigavel de "nenhuma ordem"',
        corpoFantasma.erro === 'Nenhuma ordem pendente encontrada para os setores selecionados',
        corpoFantasma.erro || ''
    );

    console.log('\n== PDF com todas as ordens pendentes ==');
    const resp = await fetch(`${BASE}/ordens/sequenciamento/pdf`, {
        method: 'POST', headers: H, body: JSON.stringify({})
    });
    check('status 200', resp.status === 200, 'status=' + resp.status);

    const ct = resp.headers.get('content-type') || '';
    check('content-type application/pdf', ct.includes('application/pdf'), ct);
    const cd = resp.headers.get('content-disposition') || '';
    check('content-disposition inline + nome do contrato', /inline/i.test(cd) && /sequenciamento_schadek\.pdf/.test(cd), cd);

    const buf = Buffer.from(await resp.arrayBuffer());
    check('corpo nao vazio', buf.length > 1000, buf.length + ' bytes');
    check('assinatura %PDF', buf.slice(0, 5).toString() === '%PDF-', buf.slice(0, 8).toString());
    check('termina com EOF do PDF', buf.slice(-1024).toString('latin1').includes('%%EOF'));

    console.log('\n== PDF filtrado por setor ==');
    if (setores.length) {
        const alvo = setores[0];
        const filtrado = await fetch(`${BASE}/ordens/sequenciamento/pdf`, {
            method: 'POST', headers: H, body: JSON.stringify({ setores_selecionados: [alvo] })
        });
        check('setor "' + alvo + '" -> 200', filtrado.status === 200, 'status=' + filtrado.status);
        const bufFiltrado = Buffer.from(await filtrado.arrayBuffer());
        check('PDF filtrado e valido', bufFiltrado.slice(0, 5).toString() === '%PDF-', bufFiltrado.length + ' bytes');
        check('PDF filtrado e menor que o completo', bufFiltrado.length <= buf.length, bufFiltrado.length + ' <= ' + buf.length);
    } else {
        console.log('  (sem setores com pendencia para filtrar)');
    }

    console.log('\n== cleanup do temporario ==');
    await new Promise((r) => setTimeout(r, 1500));
    const depois = pdfsNoTemp();
    check(
        'nenhum sequenciamento_*.pdf novo no temp',
        depois.length === antes.length,
        'antes=' + antes.length + ' depois=' + depois.length
    );

    console.log(`\nRESULTADO: ${ok} PASS / ${fail} FAIL`);
    process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('ERRO:', e); process.exit(1); });

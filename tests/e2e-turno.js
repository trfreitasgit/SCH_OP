// E2E de UI: coluna Turno editavel + bugs de hora preservada.
// Sobe premissas: servidor em http://127.0.0.1:3000 e Chrome via puppeteer.
//
// Rodar: node tests/e2e-turno.js

const puppeteer = require('puppeteer');
const fs = require('node:fs');

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

(async () => {
    // ---- setup via API: cria uma ordem Paga com hora conhecida ----
    const lr = await fetch(`${cfg.SUPABASE_URL_ORDENS}/auth/v1/token?grant_type=password`, {
        method: 'POST',
        headers: { apikey: ANON, 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'admin@schadek.com.br', password: 'schadek123' })
    });
    const token = (await lr.json()).access_token;
    const H = { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token };

    const tag = 'T' + String(Date.now() % 100000);
    const criada = await (await fetch(`${BASE}/ordens`, {
        method: 'POST', headers: H,
        body: JSON.stringify({
            numero_op: tag, total_pecas: 10, setor: 'Montagem',
            data_abertura: '2026-10-10', situacao: 'Pago',
            dia_analise: '2026-10-16T09:15:00-03:00'
        })
    })).json();
    const id = criada.id;
    if (!id) { console.error('nao criou a ordem:', criada); process.exit(1); }
    console.log('ordem de teste id=' + id + ' (Pago, 16/10 09:15 = T1)\n');

    const lerOrdem = async () => {
        const lista = await (await fetch(`${BASE}/ordens`, { headers: H })).json();
        return lista.find((o) => o.id === id);
    };

    const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox'], protocolTimeout: 180000 });
    const page = await browser.newPage();

    // Um alert() bloqueia o CDP inteiro; registra e fecha para nao travar o teste.
    const dialogos = [];
    page.on('dialog', async (d) => {
        dialogos.push(d.type() + ': ' + d.message());
        console.log('  [dialogo]', d.type(), '-', d.message());
        await d.dismiss();
    });
    page.on('pageerror', (e) => console.log('  [pageerror]', e.message));

    try {
        // ---- login no navegador ----
        await page.goto(`${BASE}/login`, { waitUntil: 'networkidle2' });
        await page.type('#userIdentifier', 'admin@schadek.com.br');
        await page.type('#userPassword', 'schadek123');
        await Promise.all([
            page.waitForNavigation({ waitUntil: 'networkidle2' }),
            page.click('#submitLoginBtn')
        ]);

        await page.goto(`${BASE}/ordens.html`, { waitUntil: 'networkidle2' });
        await page.waitForFunction(
            () => document.querySelectorAll('#tabelaOrdens tbody tr').length > 0,
            { timeout: 20000 }
        );

        // filtra pela OP criada para isolar a linha
        await page.evaluate(() => {
            const busca = document.getElementById('table-search');
            if (busca) { busca.value = ''; busca.dispatchEvent(new Event('input', { bubbles: true })); }
        });

        const acharLinha = async () => page.evaluate((op) => {
            const trs = Array.from(document.querySelectorAll('#tabelaOrdens tbody tr'));
            const tr = trs.find((t) => t.textContent.includes(op));
            if (!tr) return null;
            const tdTurno = tr.querySelector('td[data-coluna="turno"]');
            const tdData = tr.querySelector('td[data-coluna="dia_analise"]');
            return {
                id: tr.dataset.id,
                turno: tdTurno ? tdTurno.textContent.trim() : null,
                data: tdData ? tdData.textContent.trim() : null,
                temDataColuna: !!tdTurno
            };
        }, tag);

        console.log('== estado inicial ==');
        // a tabela pagina: garante que a linha esta visivel buscando pela OP
        await page.evaluate((op) => {
            const busca = document.getElementById('table-search');
            if (busca) { busca.value = op; busca.dispatchEvent(new Event('input', { bubbles: true })); }
        }, tag);
        await new Promise((r) => setTimeout(r, 1200));

        let linha = await acharLinha();
        check('linha da OP visivel', !!linha, linha ? 'id=' + linha.id : '');
        check('celula Turno tem data-coluna (editavel)', !!linha && linha.temDataColuna);
        check('turno inicial T1 (09:15)', !!linha && linha.turno === 'T1', linha ? linha.turno : '');
        check('data inicial 16/10/2026', !!linha && linha.data === '16/10/2026', linha ? linha.data : '');

        // ---- duplo clique na celula Turno abre o select ----
        console.log('\n== trocar T1 -> T2 pelo duplo clique ==');
        await page.evaluate((op) => {
            const tr = Array.from(document.querySelectorAll('#tabelaOrdens tbody tr'))
                .find((t) => t.textContent.includes(op));
            const td = tr.querySelector('td[data-coluna="turno"]');
            td.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
        }, tag);
        await new Promise((r) => setTimeout(r, 400));

        const temSelect = await page.evaluate((op) => {
            const tr = Array.from(document.querySelectorAll('#tabelaOrdens tbody tr'))
                .find((t) => t.textContent.includes(op));
            const sel = tr.querySelector('td[data-coluna="turno"] select');
            return sel ? { opcoes: Array.from(sel.options).map((o) => o.value), atual: sel.value } : null;
        }, tag);
        check('duplo clique abre select de turno', !!temSelect, temSelect ? JSON.stringify(temSelect) : '');
        check('opcoes T1/T2/T3', !!temSelect && temSelect.opcoes.join(',') === 'T1,T2,T3');
        check('select comeca no turno atual', !!temSelect && temSelect.atual === 'T1');

        await page.evaluate((op) => {
            const tr = Array.from(document.querySelectorAll('#tabelaOrdens tbody tr'))
                .find((t) => t.textContent.includes(op));
            const sel = tr.querySelector('td[data-coluna="turno"] select');
            sel.value = 'T2';
            sel.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
        }, tag);
        await new Promise((r) => setTimeout(r, 2500));

        linha = await acharLinha();
        check('badge virou T2', !!linha && linha.turno === 'T2', linha ? linha.turno : '');
        check('data preservada em 16/10/2026', !!linha && linha.data === '16/10/2026', linha ? linha.data : '');

        const noBanco = await lerOrdem();
        const horaSP = new Date(noBanco.dia_analise).toLocaleTimeString('pt-BR', {
            timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit', hour12: false
        });
        check('banco gravou 13:40 (inicio do T2)', horaSP === '13:40', horaSP);

        // ---- BUG 1: editar a DATA nao pode apagar a hora ----
        console.log('\n== editar a data de analise (deve manter 13:40) ==');
        await page.evaluate((op) => {
            const tr = Array.from(document.querySelectorAll('#tabelaOrdens tbody tr'))
                .find((t) => t.textContent.includes(op));
            const td = tr.querySelector('td[data-coluna="dia_analise"]');
            td.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
        }, tag);
        await new Promise((r) => setTimeout(r, 400));

        await page.evaluate((op) => {
            const tr = Array.from(document.querySelectorAll('#tabelaOrdens tbody tr'))
                .find((t) => t.textContent.includes(op));
            const inp = tr.querySelector('td[data-coluna="dia_analise"] input');
            inp.value = '2026-10-20';
            inp.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
        }, tag);
        await new Promise((r) => setTimeout(r, 2500));

        const depoisData = await lerOrdem();
        const horaDepois = new Date(depoisData.dia_analise).toLocaleTimeString('pt-BR', {
            timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit', hour12: false
        });
        const dataDepois = new Date(depoisData.dia_analise).toLocaleDateString('en-CA', {
            timeZone: 'America/Sao_Paulo'
        });
        check('data mudou para 2026-10-20', dataDepois === '2026-10-20', dataDepois);
        check('hora 13:40 preservada (nao virou 00:00/T3)', horaDepois === '13:40', horaDepois);

        linha = await acharLinha();
        check('badge continua T2 apos editar a data', !!linha && linha.turno === 'T2', linha ? linha.turno : '');

        // ---- ordem sem pagamento: nao abre editor de turno ----
        console.log('\n== ordem Falta Pagar: turno nao editavel ==');
        const semPagar = await (await fetch(`${BASE}/ordens`, {
            method: 'POST', headers: H,
            body: JSON.stringify({
                numero_op: tag + 'X', total_pecas: 5, setor: 'Montagem',
                data_abertura: '2026-10-10', situacao: 'Falta Pagar'
            })
        })).json();

        await page.reload({ waitUntil: 'networkidle2' });
        await page.waitForFunction(
            () => document.querySelectorAll('#tabelaOrdens tbody tr').length > 0,
            { timeout: 20000 }
        );
        await page.evaluate((op) => {
            const busca = document.getElementById('table-search');
            if (busca) { busca.value = op; busca.dispatchEvent(new Event('input', { bubbles: true })); }
        }, tag + 'X');
        await new Promise((r) => setTimeout(r, 1200));

        const semTurno = await page.evaluate((op) => {
            const tr = Array.from(document.querySelectorAll('#tabelaOrdens tbody tr'))
                .find((t) => t.textContent.includes(op));
            if (!tr) return 'linha ausente';
            const td = tr.querySelector('td[data-coluna="turno"]');
            td.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
            return td.querySelector('select') ? 'abriu select' : 'nao abriu';
        }, tag + 'X');
        check('nao abre editor de turno sem pagamento', semTurno === 'nao abriu', semTurno);

        const semPagarDepois = await (await fetch(`${BASE}/ordens`, { headers: H })).json()
            .then((l) => l.find((o) => o.id === semPagar.id));
        check('dia_analise continua nulo', semPagarDepois.dia_analise === null, String(semPagarDepois.dia_analise));

        // ---- cleanup ----
        await fetch(`${BASE}/ordens/${semPagar.id}`, { method: 'DELETE', headers: H });
        console.log('\ncleanup: ordem ' + semPagar.id + ' removida');
    } finally {
        await browser.close();
        await fetch(`${BASE}/ordens/${id}`, { method: 'DELETE', headers: H });
        console.log('cleanup: ordem ' + id + ' removida');
    }

    console.log(`\nRESULTADO: ${ok} PASS / ${fail} FAIL`);
    process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('ERRO:', e); process.exit(1); });

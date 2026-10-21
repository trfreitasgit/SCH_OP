// E2E de UI: limpar a prioridade pelo editor inline da tabela.
//
// Premissas: servidor em http://127.0.0.1:3000 e Chrome via puppeteer.
// Rodar: node tests/e2e-prioridade.js

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

const esperar = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
    const lr = await fetch(`${cfg.SUPABASE_URL_ORDENS}/auth/v1/token?grant_type=password`, {
        method: 'POST',
        headers: { apikey: ANON, 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'admin@schadek.com.br', password: 'schadek123' })
    });
    const token = (await lr.json()).access_token;
    const H = { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token };

    const tag = 'P' + String(Date.now() % 100000);
    const criada = await (await fetch(`${BASE}/ordens`, {
        method: 'POST', headers: H,
        body: JSON.stringify({
            numero_op: tag, total_pecas: 10, setor: 'Montagem',
            data_abertura: '2026-10-10', situacao: 'Falta Pagar',
            prioridade: 'MWM'
        })
    })).json();
    const id = criada.id;
    if (!id) { console.error('nao criou a ordem:', criada); process.exit(1); }
    console.log('ordem de teste id=' + id + ' (prioridade MWM)\n');

    const lerOrdem = async () => {
        const lista = await (await fetch(`${BASE}/ordens`, { headers: H })).json();
        return lista.find((o) => o.id === id);
    };

    const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox'], protocolTimeout: 180000 });
    const page = await browser.newPage();

    const dialogos = [];
    page.on('dialog', async (d) => {
        dialogos.push(d.type() + ': ' + d.message());
        console.log('  [dialogo]', d.type(), '-', d.message());
        await d.dismiss();
    });
    page.on('pageerror', (e) => console.log('  [pageerror]', e.message));

    // Conta PUTs para provar que nao ha requisicao quando nada muda.
    const puts = [];
    page.on('request', (r) => {
        if (r.method() === 'PUT' && r.url().includes('/ordens/' + id)) puts.push(r.postData());
    });

    try {
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

        await page.evaluate((op) => {
            const busca = document.getElementById('table-search');
            if (busca) { busca.value = op; busca.dispatchEvent(new Event('input', { bubbles: true })); }
        }, tag);
        await esperar(1200);

        console.log('== estado inicial ==');
        const inicial = await page.evaluate((op) => {
            const tr = Array.from(document.querySelectorAll('#tabelaOrdens tbody tr'))
                .find((t) => t.textContent.includes(op));
            const td = tr && tr.querySelector('td[data-coluna="prioridade"]');
            return td ? td.textContent.trim() : null;
        }, tag);
        check('linha da OP visivel', !!inicial, inicial ? 'texto=' + JSON.stringify(inicial) : '');

        // A badge mostra o nome real da prioridade.
        check('celula mostra MWM antes de limpar', /MWM/.test(String(inicial)), String(inicial));

        console.log('\n== dropdown de prioridade ==');
        await page.evaluate((op) => {
            const tr = Array.from(document.querySelectorAll('#tabelaOrdens tbody tr'))
                .find((t) => t.textContent.includes(op));
            const td = tr.querySelector('td[data-coluna="prioridade"]');
            td.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
        }, tag);
        await esperar(400);

        const select = await page.evaluate((op) => {
            const tr = Array.from(document.querySelectorAll('#tabelaOrdens tbody tr'))
                .find((t) => t.textContent.includes(op));
            const sel = tr.querySelector('td[data-coluna="prioridade"] select');
            if (!sel) return null;
            return {
                valores: Array.from(sel.options).map((o) => o.value),
                rotulos: Array.from(sel.options).map((o) => o.textContent),
                atual: sel.value
            };
        }, tag);

        check('duplo clique abre select de prioridade', !!select);
        check(
            'existe a opcao "- Limpar prioridade" com value vazio',
            !!select && select.valores[0] === '' && /Limpar prioridade/.test(select.rotulos[0]),
            select ? JSON.stringify({ valor: select.valores[0], rotulo: select.rotulos[0] }) : ''
        );
        check('select comeca na prioridade atual (MWM)', !!select && select.atual === 'MWM', select ? select.atual : '');

        console.log('\n== limpar a prioridade ==');
        await page.evaluate((op, indice) => {
            const tr = Array.from(document.querySelectorAll('#tabelaOrdens tbody tr'))
                .find((t) => t.textContent.includes(op));
            const sel = tr.querySelector('td[data-coluna="prioridade"] select');
            sel.selectedIndex = indice;
            sel.dispatchEvent(new Event('change', { bubbles: true }));
            sel.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
        }, tag, 0);
        await esperar(1500);

        const depois = await page.evaluate((op) => {
            const tr = Array.from(document.querySelectorAll('#tabelaOrdens tbody tr'))
                .find((t) => t.textContent.includes(op));
            const td = tr && tr.querySelector('td[data-coluna="prioridade"]');
            return td ? td.textContent.trim() : null;
        }, tag);
        check('celula fica sem prioridade ("-")', depois === '-', JSON.stringify(depois));

        const noBanco = await lerOrdem();
        check('banco recebeu null (nao string vazia)', noBanco && noBanco.prioridade === null, noBanco ? JSON.stringify(noBanco.prioridade) : '');

        const putLimpar = puts.filter((p) => p && p.includes('"prioridade":null'));
        check('PUT enviou prioridade:null', putLimpar.length === 1, JSON.stringify(puts));
        check('nenhum dialogo de erro', dialogos.length === 0, dialogos.join(' | '));

        console.log('\n== reabrir sem mudar nao dispara PUT ==');
        const putsAntes = puts.length;
        await page.evaluate((op) => {
            const tr = Array.from(document.querySelectorAll('#tabelaOrdens tbody tr'))
                .find((t) => t.textContent.includes(op));
            const td = tr.querySelector('td[data-coluna="prioridade"]');
            td.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
        }, tag);
        await esperar(400);

        const reaberto = await page.evaluate((op) => {
            const tr = Array.from(document.querySelectorAll('#tabelaOrdens tbody tr'))
                .find((t) => t.textContent.includes(op));
            const sel = tr.querySelector('td[data-coluna="prioridade"] select');
            return sel ? sel.value : null;
        }, tag);
        check('select reabre na opcao vazia (null)', reaberto === '', JSON.stringify(reaberto));

        await page.evaluate((op) => {
            const tr = Array.from(document.querySelectorAll('#tabelaOrdens tbody tr'))
                .find((t) => t.textContent.includes(op));
            const sel = tr.querySelector('td[data-coluna="prioridade"] select');
            sel.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
        }, tag);
        await esperar(1000);
        check('null comparado com vazio nao gera PUT', puts.length === putsAntes, puts.length + ' PUTs (antes ' + putsAntes + ')');

        console.log('\n== voltar a prioridade pelo mesmo dropdown ==');
        await page.evaluate((op) => {
            const tr = Array.from(document.querySelectorAll('#tabelaOrdens tbody tr'))
                .find((t) => t.textContent.includes(op));
            const td = tr.querySelector('td[data-coluna="prioridade"]');
            td.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
        }, tag);
        await esperar(400);
        await page.evaluate((op) => {
            const tr = Array.from(document.querySelectorAll('#tabelaOrdens tbody tr'))
                .find((t) => t.textContent.includes(op));
            const sel = tr.querySelector('td[data-coluna="prioridade"] select');
            sel.value = 'MWM';
            sel.dispatchEvent(new Event('change', { bubbles: true }));
            sel.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
        }, tag);
        await esperar(1500);

        const restaurada = await lerOrdem();
        check('prioridade volta a ser MWM', restaurada && restaurada.prioridade === 'MWM', restaurada ? JSON.stringify(restaurada.prioridade) : '');

        console.log(`\nRESULTADO: ${ok} PASS / ${fail} FAIL`);
    } catch (erro) {
        console.error('ERRO:', erro);
        fail++;
    } finally {
        await browser.close();
        const del = await fetch(`${BASE}/ordens/${id}`, { method: 'DELETE', headers: H });
        console.log('cleanup: ordem ' + id + ' removida (status ' + del.status + ')');
        process.exitCode = fail ? 1 : 0;
    }
})();

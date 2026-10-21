// E2E de UI: selecao estilo planilha (Ctrl+clique / Shift+clique) + copiar para o SAP.
//
// Premissas: servidor em http://127.0.0.1:3000 e Chrome via puppeteer.
// Rodar: node tests/e2e-selecao-ctrl.js

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

    // Tres ordens com um prefixo comum (o filtro de busca isola as tres).
    // numero_op e varchar(7): prefixo de 5 + "-N" cabe exatamente.
    const tag = 'S' + String(Date.now() % 10000).padStart(4, '0');
    const criadas = [];
    for (let i = 0; i < 3; i++) {
        const r = await (await fetch(`${BASE}/ordens`, {
            method: 'POST', headers: H,
            body: JSON.stringify({
                numero_op: tag + '-' + (i + 1), total_pecas: 100 * (i + 1), setor: 'Montagem',
                data_abertura: '2026-10-10', situacao: 'Falta Pagar', prioridade: 'MWM'
            })
        })).json();
        if (!r.id) { console.error('nao criou a ordem:', r); process.exit(1); }
        criadas.push(r);
    }
    console.log('ordens de teste: ' + criadas.map((o, i) => tag + '-' + (i + 1)).join(', ') + '\n');

    const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox'], protocolTimeout: 180000 });
    const page = await browser.newPage();

    // Clipboard stub: guarda o texto copiado em window.__copiado.
    await page.evaluateOnNewDocument(() => {
        window.__copiado = null;
        Object.defineProperty(navigator, 'clipboard', {
            configurable: true,
            value: { writeText: (texto) => { window.__copiado = texto; return Promise.resolve(); } }
        });
    });

    const dialogos = [];
    page.on('dialog', async (d) => {
        dialogos.push(d.type() + ': ' + d.message());
        console.log('  [dialogo]', d.type(), '-', d.message());
        await d.dismiss();
    });
    page.on('pageerror', (e) => console.log('  [pageerror]', e.message));

    const filtrar = async (termo) => {
        await page.evaluate((t) => {
            const busca = document.getElementById('table-search');
            busca.value = t;
            busca.dispatchEvent(new Event('input', { bubbles: true }));
        }, termo);
        await esperar(900);
    };

    const estado = () => page.evaluate(() => ({
        ops: Array.from(document.querySelectorAll('#tabelaOrdens tbody tr')).map((tr) => ({
            op: tr.dataset.op,
            selecionada: tr.classList.contains('tr-selecionada'),
            check: tr.querySelector('.check-ordem').checked
        })),
        contador: (document.getElementById('bulk-selected-count') || {}).textContent,
        barraVisivel: (document.getElementById('barraEdicaoMassa') || {}).style.display === 'flex',
        copiado: window.__copiado
    }));

    const clicarLinha = async (indice, modificador) => {
        const seletor = `#tabelaOrdens tbody tr:nth-child(${indice + 1}) td[data-coluna="numero_op"]`;
        if (modificador) await page.keyboard.down(modificador);
        await page.click(seletor);
        if (modificador) await page.keyboard.up(modificador);
        await esperar(250);
    };

    // O botao fica no topo: sem voltar ao inicio o puppeteer rola a pagina e o
    // clique cai atras do header fixo (artefato do teste, nao do app).
    const copiarPeloBotao = async () => {
        await page.evaluate(() => window.scrollTo(0, 0));
        await esperar(150);
        await page.click('#btnCopiar');
        await esperar(300);
    };

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
        await filtrar(tag);

        let e = await estado();
        check('filtro mostra as 3 ordens de teste', e.ops.length === 3, e.ops.map((o) => o.op).join(','));
        check('nada selecionado no inicio', e.ops.every((o) => !o.selecionada) && e.barraVisivel === false, JSON.stringify(e.contador));
        check('barra de selecao escondida', e.barraVisivel === false, '');

        const [op1, op2, op3] = e.ops.map((o) => o.op);

        console.log('\n== clique simples nao mexe na selecao ==');
        await clicarLinha(1);
        e = await estado();
        check('clique simples nao seleciona nada', e.ops.every((o) => !o.selecionada), '');

        console.log('\n== Ctrl+clique seleciona e alterna ==');
        await clicarLinha(0, 'Control');
        await clicarLinha(2, 'Control');
        e = await estado();
        check('linha 1 selecionada', e.ops[0].selecionada && e.ops[0].check, JSON.stringify(e.ops[0]));
        check('linha 2 fora', !e.ops[1].selecionada && !e.ops[1].check, JSON.stringify(e.ops[1]));
        check('linha 3 selecionada', e.ops[2].selecionada && e.ops[2].check, JSON.stringify(e.ops[2]));
        check('contador mostra 2', /^2 ordens selecionadas$/.test(e.contador || ''), JSON.stringify(e.contador));
        check('barra de selecao visivel', e.barraVisivel === true, '');

        console.log('\n== copiar usa a selecao ==');
        await copiarPeloBotao();
        e = await estado();
        check('copia exatamente as 2 OPs marcadas', e.copiado === op1 + '\n' + op3, JSON.stringify(e.copiado));
        check('nao copia a OP do meio', !String(e.copiado).includes(op2), '');

        console.log('\n== Ctrl+clique de novo desmarca ==');
        await clicarLinha(2, 'Control');
        e = await estado();
        check('sobrou 1 selecionada', e.contador === '1 ordem selecionada', JSON.stringify(e.contador));
        await copiarPeloBotao();
        e = await estado();
        check('copia so a que sobrou', e.copiado === op1, JSON.stringify(e.copiado));

        console.log('\n== Shift+clique marca o intervalo ==');
        await page.click('#btnDesmarcarTodas');
        await esperar(200);
        await clicarLinha(0, 'Control');   // ancora
        await clicarLinha(2, 'Shift');     // intervalo 1..3
        e = await estado();
        check('intervalo seleciona as 3', e.ops.every((o) => o.selecionada), JSON.stringify(e.ops.map((o) => o.selecionada)));
        check('contador 3', /^3 ordens selecionadas$/.test(e.contador || ''), JSON.stringify(e.contador));

        console.log('\n== selecao sobrevive a re-render (limpar filtro) ==');
        await clicarLinha(2, 'Control');   // tira a ultima: fica 2
        await filtrar('');
        e = await estado();
        check('contador continua 2 depois de limpar o filtro', /^2 ordens selecionadas$/.test(e.contador || ''), JSON.stringify(e.contador));

        await filtrar(tag);
        e = await estado();
        check(
            'volta com as mesmas 2 linhas marcadas',
            e.ops.filter((o) => o.selecionada).length === 2 && e.ops[2].selecionada === false,
            JSON.stringify(e.ops.map((o) => o.selecionada))
        );

        console.log('\n== Desmarcar volta ao copiar tudo ==');
        await page.click('#btnDesmarcarTodas');
        await esperar(200);
        await copiarPeloBotao();
        e = await estado();
        check('sem selecao copia as 3 visiveis', e.copiado === [op1, op2, op3].join('\n'), JSON.stringify(e.copiado));

        console.log('\n== checkTodas marca todas as filtradas ==');
        await page.click('#checkTodas');
        await esperar(300);
        e = await estado();
        check('cabecalho marca as 3', e.ops.every((o) => o.selecionada), JSON.stringify(e.ops.map((o) => o.selecionada)));

        console.log('\n== botao Copiar OPs da barra de selecao ==');
        await page.click('#btnCopiarSelecionadas');
        await esperar(300);
        e = await estado();
        check('botao da barra copia as marcadas', e.copiado === [op1, op2, op3].join('\n'), JSON.stringify(e.copiado));

        console.log('\n== checkTodas pega todas as filtradas, nao so a pagina ==');
        await page.click('#btnDesmarcarTodas');
        await esperar(200);
        await filtrar('');
        await esperar(500);
        const totalFiltrado = await page.evaluate(() => Number(document.getElementById('pagination-total').textContent) || 0);
        await page.click('#checkTodas');
        await esperar(400);
        e = await estado();
        check(
            'contador = todas as ordens filtradas',
            e.contador === totalFiltrado + ' ordens selecionadas',
            `tela=${JSON.stringify(e.contador)} total=${totalFiltrado}`
        );
        check('cabecalho continua marcado', await page.evaluate(() => document.getElementById('checkTodas').checked === true), '');
        check(
            'as 10 da pagina aparecem destacadas',
            e.ops.length === 10 && e.ops.every((o) => o.selecionada),
            JSON.stringify(e.ops.map((o) => o.selecionada))
        );

        check('nenhum dialogo de erro', dialogos.length === 0, dialogos.join(' | '));

        console.log(`\nRESULTADO: ${ok} PASS / ${fail} FAIL`);
    } catch (erro) {
        console.error('ERRO:', erro);
        fail++;
    } finally {
        await browser.close();
        for (const o of criadas) {
            await fetch(`${BASE}/ordens/${o.id}`, { method: 'DELETE', headers: H });
        }
        console.log('cleanup: ' + criadas.length + ' ordens removidas');
        process.exitCode = fail ? 1 : 0;
    }
})();

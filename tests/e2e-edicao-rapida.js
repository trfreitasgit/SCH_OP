// E2E de UI: edicao rapida no editor inline (ordens.js).
//
// Cobre os 4 ajustes:
//  1. salvar reavalia os filtros (linha que deixa de casar sai da tabela);
//  2. editor aberto durante um save em voo sobrevive ao re-render;
//  3. gravacoes concorrentes nao se sobrescrevem (ver teste unitario do merge);
//  4. select salva ao trocar a opcao, sem precisar de Enter.
//   + a pagina atual e preservada depois do save.
//
// Premissas: servidor em http://127.0.0.1:3000 e Chrome via puppeteer.
// Rodar: node tests/e2e-edicao-rapida.js

const puppeteer = require('puppeteer');
const fs = require('node:fs');

const BASE = 'http://127.0.0.1:3000';
const cfg = {};
for (const line of fs.readFileSync(`${__dirname}/../.env`, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^([A-Z_]+)=(.*)$/);
    if (m) cfg[m[1]] = m[2].trim();
}
const ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImdnamJ2cnJraXJzc2RocHNseXpoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTE5OTk0MzcsImV4cCI6MjEwNzU3NTQzN30.7rtd8uhybZMh1nDMesjOn9nKcyQV3VgxfVFgUPDEJY8';

const TOTAL_ORDENS = 12; // duas paginas de 10: a ultima pagina tem 2

let ok = 0;
let fail = 0;
const check = (nome, cond, extra) => {
    if (cond) { ok++; console.log('  PASS', nome, extra === undefined ? '' : extra); }
    else { fail++; console.log('  FAIL', nome, extra === undefined ? '' : extra); }
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

    // numero_op e varchar(7): tag de 5 + uma letra (A..L) = 6 caracteres.
    const tag = 'R' + String(Date.now() % 10000).padStart(4, '0');
    const criadas = [];
    for (let i = 0; i < TOTAL_ORDENS; i++) {
        const op = tag + String.fromCharCode(65 + i);
        const r = await (await fetch(`${BASE}/ordens`, {
            method: 'POST', headers: H,
            body: JSON.stringify({
                numero_op: op, total_pecas: 100 + i, setor: 'Montagem',
                data_abertura: '2026-10-10', situacao: 'Falta Pagar', prioridade: 'MWM'
            })
        })).json();
        if (!r.id) { console.error('nao criou a ordem', op, r); process.exit(1); }
        criadas.push({ id: r.id, numero_op: op });
    }
    console.log(`${TOTAL_ORDENS} ordens de teste criadas (${tag}A..${tag}L)\n`);

    const lerOrdem = async (id) => {
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

    // Atraso opcional no PROXIMO PUT: simula a resposta demorando para chegar.
    let atrasoProximoPut = 0;
    const puts = [];
    await page.setRequestInterception(true);
    page.on('request', (req) => {
        const url = new URL(req.url());
        const ehPutOrdem = req.method() === 'PUT' && /^\/ordens\/\d+$/.test(url.pathname);
        if (ehPutOrdem) puts.push({ path: url.pathname, body: req.postData() });
        if (ehPutOrdem && atrasoProximoPut > 0) {
            const d = atrasoProximoPut;
            atrasoProximoPut = 0;
            setTimeout(() => req.continue().catch(() => {}), d);
            return;
        }
        req.continue().catch(() => {});
    });

    const linha = (n) => `#tabelaOrdens tbody tr:nth-child(${n})`;
    const seletorCelula = (n, coluna) => `${linha(n)} td[data-coluna="${coluna}"]`;

    // Duplo clique real na celula (mesmo caminho do listener do tbody).
    const abrirEditor = async (n, coluna) => {
        await page.evaluate((sel) => {
            const td = document.querySelector(sel);
            if (!td) throw new Error('celula nao encontrada: ' + sel);
            td.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
        }, seletorCelula(n, coluna));
        await esperar(150);
    };

    const focarEditor = async (n, coluna) => {
        await page.evaluate((sel) => {
            const ed = document.querySelector(sel + ' input, ' + sel + ' select');
            if (!ed) throw new Error('editor nao encontrado em ' + sel);
            ed.focus();
            if (ed.select) ed.select();
        }, seletorCelula(n, coluna));
    };

    const lerEditor = (n, coluna) => page.evaluate((sel) => {
        const td = document.querySelector(sel);
        const ed = td ? td.querySelector('input, select') : null;
        return { aberto: !!ed, valor: ed ? ed.value : null, editando: td ? td.classList.contains('cell-editing') : false };
    }, seletorCelula(n, coluna));

    const filtrar = async (termo) => {
        await page.evaluate((t) => {
            const busca = document.getElementById('table-search');
            busca.value = t;
            busca.dispatchEvent(new Event('input', { bubbles: true }));
        }, termo);
        await esperar(700);
    };

    const textoPagina = () => page.evaluate(() => ({
        inicio: document.getElementById('pagination-start').innerText,
        total: document.getElementById('pagination-total').innerText,
        ativa: (document.querySelector('#pagination-pages .pagination-page.active') || {}).innerText || null,
        ids: Array.from(document.querySelectorAll('#tabelaOrdens tbody tr')).map((tr) => Number(tr.dataset.id))
    }));

    // Espera a resposta do PUT daquela ordem (evita depender de sleep fixo).
    const esperarPut = (id) => page.waitForResponse(
        (r) => r.request().method() === 'PUT' && new URL(r.url()).pathname === '/ordens/' + id,
        { timeout: 20000 }
    );

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
        await esperar(300);

        let estado = await textoPagina();
        check('filtro mostra as 12 ordens de teste', estado.total === String(TOTAL_ORDENS), estado.total);
        check('duas paginas', estado.ativa === '1' && estado.ids.length === 10, JSON.stringify(estado.ids.length));

        // ---------------------------------------------------------------
        console.log('\n== select salva ao trocar a opcao (sem Enter) ==');
        const ordemRow1 = estado.ids[0];
        await abrirEditor(1, 'situacao');
        await Promise.all([
            esperarPut(ordemRow1),
            page.select(seletorCelula(1, 'situacao') + ' select', 'Pago')
        ]);
        await page.waitForFunction(() => {
            const td = document.querySelector('#tabelaOrdens tbody tr:nth-child(1) td[data-coluna="situacao"]');
            return td && td.innerText.trim() === 'Pago';
        }, { timeout: 15000 });
        await esperar(200);

        let ordem = await lerOrdem(ordemRow1);
        check('situacao Pago gravada no banco', ordem && ordem.situacao === 'Pago', ordem && ordem.situacao);
        check('dia_analise preenchido pelo backend', !!(ordem && ordem.dia_analise), ordem && ordem.dia_analise);
        const putsDaOrdem = puts.filter((p) => p.path === '/ordens/' + ordemRow1);
        check('um unico PUT (sem duplicar com Enter)', putsDaOrdem.length === 1, putsDaOrdem.length);
        check(
            'celula ja mostra Pago apos o save',
            (await page.evaluate((n) => document.querySelector(n + ' td[data-coluna="situacao"]').innerText.trim(), linha(1))) === 'Pago',
            ''
        );

        // ---------------------------------------------------------------
        console.log('\n== salvar reavalia o filtro (linha sai da tabela) ==');
        await page.evaluate(() => document.getElementById('btn-toggle-filters').click());
        await page.evaluate(() => {
            document.querySelectorAll('#filter-drawer .filter-status input[type="checkbox"]').forEach((cb) => {
                cb.checked = cb.value === 'Falta Pagar';
                cb.dispatchEvent(new Event('change', { bubbles: true }));
            });
        });
        await esperar(600);

        estado = await textoPagina();
        check('filtro Falta Pagar mostra 11', estado.total === '11', estado.total);

        const idFiltrado = estado.ids[0];
        await abrirEditor(1, 'situacao');
        await Promise.all([
            esperarPut(idFiltrado),
            page.select(seletorCelula(1, 'situacao') + ' select', 'Pago')
        ]);
        await page.waitForFunction(
            () => Number(document.getElementById('pagination-total').innerText) === 10,
            { timeout: 15000 }
        );

        estado = await textoPagina();
        check('ordem que virou Pago saiu da lista filtrada', !estado.ids.includes(idFiltrado), idFiltrado);
        check('total do filtro caiu para 10', estado.total === '10', estado.total);
        check(
            'KPI "falta pagar" acompanhou o filtro',
            (await page.evaluate(() => Number(document.getElementById('kpi-falta-pagar').innerText))) === 10,
            await page.evaluate(() => document.getElementById('kpi-falta-pagar').innerText)
        );
        check('busca rapida continua aplicada', await page.evaluate(() => document.getElementById('table-search').value) === tag, '');

        // Restaura os filtros para os proximos cenarios.
        await page.evaluate(() => document.getElementById('btn-reset-filters').click());
        await esperar(600);

        // ---------------------------------------------------------------
        console.log('\n== editor aberto sobrevive ao save em voo ==');
        await filtrar(tag);
        await esperar(300);
        estado = await textoPagina();
        const idMaterial = estado.ids[0];
        const idPecas = estado.ids[1];

        await abrirEditor(1, 'material');
        await focarEditor(1, 'material');
        await page.keyboard.type('1234');
        const esperaMaterial = esperarPut(idMaterial);
        atrasoProximoPut = 1200;
        await page.keyboard.press('Enter');
        await esperar(150);

        await abrirEditor(2, 'total_pecas');
        await focarEditor(2, 'total_pecas');
        await page.keyboard.type('777');
        await esperar(250);

        let editor = await lerEditor(2, 'total_pecas');
        check('editor de pecas segue aberto com o texto digitado', editor.aberto && editor.valor === '777', JSON.stringify(editor));

        await esperaMaterial;
        // O re-render da outra celula ja aconteceu quando a linha 1 mostra 1234.
        await page.waitForFunction(() => {
            const td = document.querySelector('#tabelaOrdens tbody tr:nth-child(1) td[data-coluna="material"]');
            return td && td.innerText.trim() === '1234';
        }, { timeout: 15000 });
        editor = await lerEditor(2, 'total_pecas');
        check('editor sobreviveu ao re-render da outra celula', editor.aberto && editor.valor === '777', JSON.stringify(editor));

        await Promise.all([esperarPut(idPecas), page.keyboard.press('Enter')]);
        await page.waitForFunction(
            () => Number(document.querySelector('#tabelaOrdens tbody tr:nth-child(2) td[data-coluna="total_pecas"]').innerText.trim()) === 777,
            { timeout: 15000 }
        );

        const ordemMaterial = await lerOrdem(idMaterial);
        const ordemPecas = await lerOrdem(idPecas);
        check('material salvo', ordemMaterial && ordemMaterial.material === '1234', ordemMaterial && ordemMaterial.material);
        check('pecas salvas depois do re-render', ordemPecas && ordemPecas.total_pecas === 777, ordemPecas && ordemPecas.total_pecas);
        check(
            'linha mostra as pecas novas',
            (await page.evaluate((n) => document.querySelector(n + ' td[data-coluna="total_pecas"]').innerText.trim(), linha(2))) === '777',
            ''
        );

        // ---------------------------------------------------------------
        console.log('\n== pagina atual preservada depois do save ==');
        await page.evaluate(() => document.querySelector('#pagination-pages .pagination-page[data-page="2"]').click());
        await esperar(400);

        estado = await textoPagina();
        check('esta na pagina 2', estado.inicio === '11' && estado.ativa === '2', JSON.stringify(estado.inicio));
        const idPagina2 = estado.ids[0];

        await abrirEditor(1, 'total_pecas');
        await focarEditor(1, 'total_pecas');
        await page.keyboard.type('555');
        await Promise.all([esperarPut(idPagina2), page.keyboard.press('Enter')]);
        await page.waitForFunction(
            () => Number(document.querySelector('#tabelaOrdens tbody tr:nth-child(1) td[data-coluna="total_pecas"]').innerText.trim()) === 555,
            { timeout: 15000 }
        );

        const depois = await textoPagina();
        check('continuou na pagina 2', depois.inicio === '11' && depois.ativa === '2', JSON.stringify(depois.inicio) + '/' + depois.ativa);
        check('linha continua na pagina', depois.ids.includes(idPagina2), idPagina2);
        const ordemPagina2 = await lerOrdem(idPagina2);
        check('valor salvo na ordem da pagina 2', ordemPagina2 && ordemPagina2.total_pecas === 555, ordemPagina2 && ordemPagina2.total_pecas);

        check('nenhum dialogo de erro', dialogos.length === 0, dialogos.join(' | '));

        console.log(`\nRESULTADO: ${ok} PASS / ${fail} FAIL`);
    } catch (erro) {
        console.error('ERRO:', erro);
        fail++;
    } finally {
        await browser.close();
        let removidas = 0;
        for (const o of criadas) {
            const r = await fetch(`${BASE}/ordens/${o.id}`, { method: 'DELETE', headers: H });
            if (r.ok) removidas++;
        }
        console.log(`cleanup: ${removidas}/${criadas.length} ordens removidas`);
        process.exitCode = fail ? 1 : 0;
    }
})();

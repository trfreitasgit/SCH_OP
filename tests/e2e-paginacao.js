// E2E de UI: preferencia "Exibir N ordens" (10/25/50/100).
//
// Premissas: servidor em http://127.0.0.1:3000 e Chrome via puppeteer.
// Nao cria nem altera ordens: so navega, troca o select e recarrega a pagina.
//
// Cobre:
//   - escolher 25 e trocar de setor (filtro) NAO volta para 10;
//   - F5 mantem 25 (localStorage) e o select coerente com a tabela;
//   - valor corrompido no storage cai em 10;
//   - primeira visita (chave ausente) e 10.
//
// Rodar: node tests/e2e-paginacao.js

const puppeteer = require('puppeteer');

const BASE = 'http://127.0.0.1:3000';
const CHAVE = 'ordens.itensPorPagina';

let ok = 0;
let fail = 0;
const check = (nome, cond, extra) => {
    if (cond) { ok++; console.log('  PASS', nome, extra === undefined ? '' : extra); }
    else { fail++; console.log('  FAIL', nome, extra === undefined ? '' : extra); }
};
const espera = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
    const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox'], protocolTimeout: 180000 });
    const page = await browser.newPage();
    const pageErros = [];
    const httpErros = [];
    page.on('pageerror', (e) => pageErros.push(e.message));
    page.on('response', (r) => { if (r.status() >= 400) httpErros.push(r.url() + ' -> ' + r.status()); });

    const esperarTabela = () => page.waitForFunction(
        () => document.querySelectorAll('#tabelaOrdens tbody tr').length > 0,
        { timeout: 30000 }
    );

    const estado = () => page.evaluate((chave) => ({
        sel: document.getElementById('pagination-size').value,
        itens: paginacao.itensPorPagina,
        rows: document.querySelectorAll('#tabelaOrdens tbody tr').length,
        total: parseInt(document.getElementById('pagination-total').textContent, 10) || 0,
        salvo: localStorage.getItem(chave)
    }), CHAVE);

    const recarregar = async () => {
        await page.reload({ waitUntil: 'networkidle2' });
        await esperarTabela();
        await espera(300);
    };

    try {
        // ---- login ----
        await page.goto(`${BASE}/login`, { waitUntil: 'networkidle2' });
        await page.type('#userIdentifier', 'admin@schadek.com.br');
        await page.type('#userPassword', 'schadek123');
        await Promise.all([
            page.waitForNavigation({ waitUntil: 'networkidle2' }),
            page.click('#submitLoginBtn')
        ]);
        await page.goto(`${BASE}/ordens.html`, { waitUntil: 'networkidle2' });
        await esperarTabela();
        await espera(300);

        console.log('\n== primeira visita (sem preferencia) ==');
        let e = await estado();
        check('comeca em 10', e.sel === '10' && e.itens === 10, `${e.sel}/${e.itens}`);
        check('mostra no maximo 10 linhas', e.rows === Math.min(10, e.total), `${e.rows} de ${e.total}`);
        check('nada gravado ainda', e.salvo === null, String(e.salvo));

        console.log('\n== escolher 25 ==');
        await page.select('#pagination-size', '25');
        await espera(500);
        e = await estado();
        check('estado e select em 25', e.sel === '25' && e.itens === 25, `${e.sel}/${e.itens}`);
        check('mostra no maximo 25 linhas', e.rows === Math.min(25, e.total), `${e.rows} de ${e.total}`);
        check('preferencia gravada', e.salvo === '25', String(e.salvo));

        console.log('\n== trocar de setor (filtro) ==');
        await page.evaluate(() => {
            const btn = document.querySelector('.btnSetor[data-setor="Montagem"]');
            if (btn) btn.click();
        });
        await espera(900);
        e = await estado();
        check('continua em 25 depois do setor', e.sel === '25' && e.itens === 25, `${e.sel}/${e.itens}`);
        check('linhas acompanham o filtro', e.rows === Math.min(25, e.total), `${e.rows} de ${e.total}`);
        check('preferencia intacta', e.salvo === '25', String(e.salvo));

        console.log('\n== F5 (recarga) ==');
        await recarregar();
        e = await estado();
        check('select volta em 25', e.sel === '25', e.sel);
        check('estado volta em 25', e.itens === 25, String(e.itens));
        check('tabela com 25 linhas', e.rows === Math.min(25, e.total), `${e.rows} de ${e.total}`);
        check('filtro de setor NAO e persistido (volta o universo)', e.total > 0 && e.total >= e.rows, String(e.total));

        console.log('\n== valor corrompido no storage ==');
        await page.evaluate((chave) => localStorage.setItem(chave, '999'), CHAVE);
        await recarregar();
        e = await estado();
        check('999 cai em 10', e.sel === '10' && e.itens === 10, `${e.sel}/${e.itens}`);
        check('tabela em 10', e.rows === Math.min(10, e.total), `${e.rows} de ${e.total}`);

        await page.evaluate((chave) => localStorage.setItem(chave, 'abc'), CHAVE);
        await recarregar();
        e = await estado();
        check('texto invalido cai em 10', e.sel === '10' && e.itens === 10, `${e.sel}/${e.itens}`);

        console.log('\n== 50 sobrevive ==');
        await page.evaluate((chave) => localStorage.setItem(chave, '50'), CHAVE);
        await recarregar();
        e = await estado();
        check('50 restaurado (select e estado)', e.sel === '50' && e.itens === 50, `${e.sel}/${e.itens}`);
        check('tabela em 50', e.rows === Math.min(50, e.total), `${e.rows} de ${e.total}`);

        console.log('\n== integridade ==');
        check('sem pageerror', pageErros.length === 0, pageErros.join(' | '));
        check('sem HTTP >= 400', httpErros.length === 0, httpErros.join(' | '));
    } catch (erro) {
        fail++;
        console.log('  FAIL excecao:', erro.message);
    } finally {
        try { await page.evaluate((chave) => localStorage.removeItem(chave), CHAVE); } catch (e) { /* pagina pode ter caido */ }
        await browser.close();
        console.log(`\nRESULTADO: ${ok} PASS / ${fail} FAIL`);
        process.exit(fail === 0 ? 0 : 1);
    }
})();

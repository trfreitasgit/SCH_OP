// E2E de UI: botao Reset dos filtros laterais preserva o SETOR.
//
// Regra: Reset limpa prioridade, status, datas, analise e turno, mas mantem a
// selecao de setor (aba do topo ou checkboxes do drawer). Para limpar setor o
// usuario clica em "Todos".
//
// Premissas: servidor em http://127.0.0.1:3000 e Chrome via puppeteer.
// Nao cria nem altera ordens: so navega e clica nos filtros.
//
// Rodar: node tests/e2e-reset-filtros.js

const puppeteer = require('puppeteer');

const BASE = 'http://127.0.0.1:3000';

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

    const estado = () => page.evaluate(() => ({
        abaAtiva: (document.querySelector('.btnSetor.active') || {}).dataset
            ? document.querySelector('.btnSetor.active').dataset.setor : null,
        setores: Array.from(document.querySelectorAll('.filter-sector input'))
            .filter((cb) => cb.checked).map((cb) => cb.value),
        status: Array.from(document.querySelectorAll('.filter-status input'))
            .filter((cb) => cb.checked).length,
        turnos: Array.from(document.querySelectorAll('.filter-turno input'))
            .filter((cb) => cb.checked).length,
        analiseInicio: document.getElementById('filter-analise-start').value,
        analiseFim: document.getElementById('filter-analise-end').value,
        dataInicio: document.getElementById('filter-date-start').value,
        total: parseInt(document.getElementById('pagination-total').textContent, 10) || 0
    }));

    const clicarSetor = async (setor) => {
        await page.evaluate((s) => {
            const btn = document.querySelector(`.btnSetor[data-setor="${s}"]`);
            if (btn) btn.click();
        }, setor);
        await espera(800);
    };

    const clicarReset = async () => {
        await page.evaluate(() => {
            const drawer = document.getElementById('filter-drawer');
            if (drawer && drawer.classList.contains('hidden')) document.getElementById('btn-toggle-filters').click();
        });
        await espera(300);
        await page.evaluate(() => document.getElementById('btn-reset-filters').click());
        await espera(800);
    };

    const alternarStatus = async (valor) => {
        await page.evaluate((v) => {
            const drawer = document.getElementById('filter-drawer');
            if (drawer && drawer.classList.contains('hidden')) document.getElementById('btn-toggle-filters').click();
            const cb = document.querySelector(`.filter-status input[value="${v}"]`);
            if (cb) cb.click();
        }, valor);
        await espera(800);
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

        let e = await estado();
        const universo = e.total;
        check('universo carregado (todos os setores)', universo > 0 && e.setores.length === 6, `${universo} / ${e.setores.length}`);

        console.log('\n== setor Montagem + filtro de status + Reset ==');
        await clicarSetor('Montagem');
        const totalMontagem = (await estado()).total;
        check('aba Montagem ativa', (await estado()).abaAtiva === 'Montagem');
        check('so Montagem marcado', JSON.stringify((await estado()).setores) === '["Montagem"]', (await estado()).setores.join(','));
        check('total caiu para o setor', totalMontagem > 0 && totalMontagem < universo, `${totalMontagem} de ${universo}`);

        await alternarStatus('Pago');
        e = await estado();
        check('filtro de status alterou o total', e.total < totalMontagem && e.status === 2, `${e.total} / status=${e.status}`);

        await clicarReset();
        e = await estado();
        check('aba continua Montagem', e.abaAtiva === 'Montagem', String(e.abaAtiva));
        check('setor preservado (so Montagem)', JSON.stringify(e.setores) === '["Montagem"]', e.setores.join(','));
        check('status zerado (3 marcados)', e.status === 3, String(e.status));
        check('turnos zerados (4 marcados)', e.turnos === 4, String(e.turnos));
        check('datas e analise limpas', !e.analiseInicio && !e.analiseFim && !e.dataInicio);
        check('total voltou ao total do setor (nao ao universo)', e.total === totalMontagem, `${e.total} vs ${totalMontagem}`);

        console.log('\n== Reset de novo (idempotente) ==');
        await clicarReset();
        e = await estado();
        check('continua Montagem', e.abaAtiva === 'Montagem' && JSON.stringify(e.setores) === '["Montagem"]', e.setores.join(','));
        check('mesmo total', e.total === totalMontagem, String(e.total));

        console.log('\n== "Todos" volta ao universo ==');
        await page.evaluate(() => document.getElementById('btnTodos').click());
        await espera(800);
        e = await estado();
        check('6 setores marcados', e.setores.length === 6, e.setores.join(','));
        check('universo de volta', e.total === universo, `${e.total} de ${universo}`);
        check('nenhuma aba ativa', e.abaAtiva === null, String(e.abaAtiva));

        console.log('\n== reset com "Todos" nao muda o total ==');
        await alternarStatus('Pago');
        await clicarReset();
        e = await estado();
        check('setor "todos" preservado', e.setores.length === 6, e.setores.join(','));
        check('universo de volta apos reset', e.total === universo, `${e.total} de ${universo}`);

        console.log('\n== setor escolhido so pelo drawer tambem fica ==');
        await page.evaluate(() => {
            document.querySelectorAll('.filter-sector input').forEach((cb) => {
                if (cb.checked && cb.value !== 'BCM') cb.click();
            });
        });
        await espera(800);
        const totalBcm = (await estado()).total;
        check('so BCM marcado', JSON.stringify((await estado()).setores) === '["BCM"]', (await estado()).setores.join(','));
        check('total do BCM', totalBcm > 0 && totalBcm < universo, `${totalBcm} de ${universo}`);

        await clicarReset();
        e = await estado();
        check('reset preserva BCM do drawer', JSON.stringify(e.setores) === '["BCM"]', e.setores.join(','));
        check('total do BCM apos reset', e.total === totalBcm, `${e.total} vs ${totalBcm}`);

        console.log('\n== integridade ==');
        check('sem pageerror', pageErros.length === 0, pageErros.join(' | '));
        check('sem HTTP >= 400', httpErros.length === 0, httpErros.join(' | '));
    } catch (erro) {
        fail++;
        console.log('  FAIL excecao:', erro.message);
    } finally {
        await browser.close();
        console.log(`\nRESULTADO: ${ok} PASS / ${fail} FAIL`);
        process.exit(fail === 0 ? 0 : 1);
    }
})();

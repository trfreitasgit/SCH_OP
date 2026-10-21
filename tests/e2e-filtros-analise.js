// E2E de UI: filtros de Periodo de Analise (dia_analise) e de Turno no drawer.
//
// Premissas: servidor em http://127.0.0.1:3000 e Chrome via puppeteer.
// Cria 4 ordens marcadas com um prefixo unico (numero_op varchar(7)):
//   -1 -> Pago, HOJE 09:15 (T1)
//   -2 -> Pago, HOJE 15:00 (T2)
//   -3 -> Pago, ONTEM 23:30 (T3)
//   -4 -> Falta Pagar, sem dia_analise (SEM)
// e remove tudo no finally.
//
// Rodar: node tests/e2e-filtros-analise.js

const puppeteer = require('puppeteer');
const fs = require('node:fs');

const BASE = 'http://127.0.0.1:3000';
const PAUSA = 450;

const cfg = {};
for (const line of fs.readFileSync(`${__dirname}/../.env`, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^([A-Z_]+)=(.*)$/);
    if (m) cfg[m[1]] = m[2].trim();
}
const ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImdnamJ2cnJraXJzc2RocHNseXpoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTE5OTk0MzcsImV4cCI6MjEwNzU3NTQzN30.7rtd8uhybZMh1nDMesjOn9nKcyQV3VgxfVFgUPDEJY8';

let ok = 0;
let fail = 0;
const check = (nome, cond, extra) => {
    if (cond) { ok++; console.log('  PASS', nome, extra === undefined ? '' : extra); }
    else { fail++; console.log('  FAIL', nome, extra === undefined ? '' : extra); }
};
const espera = (ms) => new Promise((r) => setTimeout(r, ms));

// DIA de hoje e de ontem no fuso da fabrica (independente do fuso da maquina).
function diaFabrica(offsetDias) {
    const hoje = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit'
    }).format(new Date());
    const [ano, mes, dia] = hoje.split('-').map(Number);
    const d = new Date(Date.UTC(ano, mes - 1, dia + offsetDias));
    return d.toISOString().slice(0, 10);
}

(async () => {
    const hoje = diaFabrica(0);
    const ontem = diaFabrica(-1);

    // ---- setup via API ----
    const lr = await fetch(`${cfg.SUPABASE_URL_ORDENS}/auth/v1/token?grant_type=password`, {
        method: 'POST',
        headers: { apikey: ANON, 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'admin@schadek.com.br', password: 'schadek123' })
    });
    const token = (await lr.json()).access_token;
    const H = { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token };

    const tag = 'F' + String(Date.now() % 10000).padStart(4, '0');

    const criar = async (sufixo, dados) => {
        const r = await (await fetch(`${BASE}/ordens`, {
            method: 'POST', headers: H,
            body: JSON.stringify(Object.assign({
                numero_op: `${tag}-${sufixo}`,
                total_pecas: 7,
                setor: 'Montagem',
                data_abertura: '2026-10-10'
            }, dados))
        })).json();
        if (!r.id) throw new Error('nao criou a ordem ' + sufixo + ': ' + JSON.stringify(r));
        return r.id;
    };

    const criadas = [];
    const ACT1 = `${tag}-1`;
    const ACT2 = `${tag}-2`;
    const ACT3 = `${tag}-3`;
    const ACT4 = `${tag}-4`;

    const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox'], protocolTimeout: 180000 });
    const page = await browser.newPage();
    const pageErros = [];
    const httpErros = [];
    page.on('pageerror', (e) => pageErros.push(e.message));
    page.on('response', (r) => { if (r.status() >= 400) httpErros.push(r.url() + ' -> ' + r.status()); });

    try {
        criadas.push(await criar('1', { situacao: 'Pago', dia_analise: `${hoje}T09:15:00-03:00` }));
        criadas.push(await criar('2', { situacao: 'Pago', dia_analise: `${hoje}T15:00:00-03:00` }));
        criadas.push(await criar('3', { situacao: 'Pago', dia_analise: `${ontem}T23:30:00-03:00` }));
        criadas.push(await criar('4', { situacao: 'Falta Pagar', dia_analise: null }));
        console.log(`ordens de teste ${tag}: T1=${criadas[0]} T2=${criadas[1]} T3=${criadas[2]} SEM=${criadas[3]}\n`);

        // Confere o universo pela API que o front usa (/ordens/pendentes, nao /ordens).
        const pendentes = await (await fetch(`${BASE}/ordens/pendentes`, { headers: H })).json();
        const doTeste = pendentes.filter((o) => String(o.numero_op || '').indexOf(tag) === 0);
        check('4 ordens do teste em /ordens/pendentes', doTeste.length === 4, doTeste.length);
        check('turnos calculados pela API batem com o esperado',
            doTeste.map((o) => o.numero_op).sort().join(',') === [ACT1, ACT2, ACT3, ACT4].join(',') &&
            doTeste.find((o) => o.numero_op === ACT2).dia_analise !== null,
            doTeste.map((o) => o.numero_op).join(' '));

        // ---- login ----
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
            { timeout: 30000 }
        );
        await espera(2200);

        // Isola as 4 ordens do teste com o filtro rapido.
        await page.evaluate((termo) => {
            const busca = document.getElementById('table-search');
            busca.value = termo;
            busca.dispatchEvent(new Event('input', { bubbles: true }));
        }, tag);
        await espera(900);

        const clicar = async (seletor) => {
            const achou = await page.evaluate((sel) => {
                const el = document.querySelector(sel);
                if (!el) return false;
                el.click();
                return true;
            }, seletor);
            if (!achou) throw new Error('elemento nao encontrado: ' + seletor);
            await espera(PAUSA);
        };

        const abrirDrawer = async () => {
            const oculto = await page.evaluate(() => document.getElementById('filter-drawer').classList.contains('hidden'));
            if (oculto) await clicar('#btn-toggle-filters');
        };

        const linhas = () => page.evaluate(() =>
            Array.from(document.querySelectorAll('#tabelaOrdens tbody tr')).map((tr) => tr.getAttribute('data-op'))
        );

        const estadoFiltros = () => page.evaluate(() => ({
            turnos: Array.from(document.querySelectorAll('.filter-turno .filter-checkbox'))
                .map((c) => c.value + ':' + c.checked),
            contadores: ['t1', 't2', 't3', 'sem']
                .map((k) => (document.getElementById('count-turno-' + k) || {}).textContent),
            analiseInicio: document.getElementById('filter-analise-start').value,
            analiseFim: document.getElementById('filter-analise-end').value,
            kpiTotal: (document.getElementById('kpi-total-ops') || {}).textContent,
            kpiFalta: (document.getElementById('kpi-falta-pagar') || {}).textContent,
            filtradas: typeof listaFiltrada !== 'undefined' ? listaFiltrada.length : -1
        }));

        console.log('== estado inicial ==');
        let e = await estadoFiltros();
        check('4 ordens do teste visiveis', (await linhas()).length === 4, (await linhas()).join(' '));
        check('4 checkboxes de turno marcados', e.turnos.every((t) => t.endsWith(':true')), e.turnos.join(' '));
        check('inputs de analise vazios', e.analiseInicio === '' && e.analiseFim === '');
        check('contadores 1/1/1/1', e.contadores.join(',') === '1,1,1,1', e.contadores.join(','));
        check('KPI total = 4', e.kpiTotal === '4', e.kpiTotal);
        check('KPI falta pagar = 1', e.kpiFalta === '1', e.kpiFalta);

        await abrirDrawer();
        check('drawer aberto', await page.evaluate(() => !document.getElementById('filter-drawer').classList.contains('hidden')));

        console.log('\n== turno: desmarcar T1 e T2 ==');
        await clicar('.filter-turno input[value="T1"]');
        await clicar('.filter-turno input[value="T2"]');
        let visiveis = await linhas();
        e = await estadoFiltros();
        check('T1 e T2 saem da tabela', visiveis.indexOf(ACT1) === -1 && visiveis.indexOf(ACT2) === -1, visiveis.join(' '));
        check('T3 continua', visiveis.indexOf(ACT3) !== -1);
        check('SEM continua (checkbox ainda marcado)', visiveis.indexOf(ACT4) !== -1);
        check('sobram T3 + SEM', visiveis.length === 2, visiveis.join(' '));
        check('contadores refletem o filtro', e.contadores.join(',') === '0,0,1,1', e.contadores.join(','));
        check('aplicou na hora (drawer continua aberto)',
            await page.evaluate(() => !document.getElementById('filter-drawer').classList.contains('hidden')));
        check('KPI total acompanha (2)', e.kpiTotal === '2', e.kpiTotal);
        check('KPI falta pagar acompanha (1)', e.kpiFalta === '1', e.kpiFalta);

        console.log('\n== turno: desmarcar "Sem turno" ==');
        await clicar('.filter-turno input[value="SEM"]');
        visiveis = await linhas();
        check('Falta Pagar sem analise sai', visiveis.indexOf(ACT4) === -1, visiveis.join(' '));
        check('so a ordem T3 fica', visiveis.length === 1 && visiveis[0] === ACT3, visiveis.join(' '));
        e = await estadoFiltros();
        check('KPI total = 1', e.kpiTotal === '1', e.kpiTotal);
        check('KPI falta pagar = 0', e.kpiFalta === '0', e.kpiFalta);

        console.log('\n== turno: remarcar tudo ==');
        await clicar('.filter-turno input[value="SEM"]');
        await clicar('.filter-turno input[value="T1"]');
        await clicar('.filter-turno input[value="T2"]');
        visiveis = await linhas();
        e = await estadoFiltros();
        check('4 ordens de volta', visiveis.length === 4, visiveis.join(' '));
        check('contadores 1/1/1/1 de novo', e.contadores.join(',') === '1,1,1,1', e.contadores.join(','));

        console.log('\n== preset Hoje ==');
        await clicar('[data-preset-analise="today"]');
        visiveis = await linhas();
        e = await estadoFiltros();
        check('inputs preenchidos com hoje (SP)', e.analiseInicio === hoje && e.analiseFim === hoje, e.analiseInicio + '..' + e.analiseFim);
        check('so as ordens de hoje (T1 e T2)', visiveis.length === 2 && visiveis.indexOf(ACT1) !== -1 && visiveis.indexOf(ACT2) !== -1, visiveis.join(' '));
        check('ordem de ontem (T3) sai', visiveis.indexOf(ACT3) === -1);
        check('ordem sem analise sai', visiveis.indexOf(ACT4) === -1);
        check('contadores do dia: 1/1/0/0', e.contadores.join(',') === '1,1,0,0', e.contadores.join(','));

        console.log('\n== intervalo manual (ontem) + Aplicar ==');
        await page.evaluate((dia) => {
            const inicio = document.getElementById('filter-analise-start');
            const fim = document.getElementById('filter-analise-end');
            inicio.value = dia;
            inicio.dispatchEvent(new Event('change', { bubbles: true }));
            fim.value = dia;
            fim.dispatchEvent(new Event('change', { bubbles: true }));
        }, ontem);
        await page.evaluate(() => document.getElementById('btn-apply-filters').click());
        await espera(900);
        visiveis = await linhas();
        e = await estadoFiltros();
        check('drawer fechou no Aplicar', await page.evaluate(() => document.getElementById('filter-drawer').classList.contains('hidden')));
        check('so a ordem de ontem', visiveis.length === 1 && visiveis[0] === ACT3, visiveis.join(' '));
        check('sem analise continua fora com intervalo ativo', visiveis.indexOf(ACT4) === -1);
        check('KPI total = 1', e.kpiTotal === '1', e.kpiTotal);

        console.log('\n== Reset ==');
        await abrirDrawer();
        await clicar('#btn-reset-filters');
        visiveis = await linhas();
        e = await estadoFiltros();
        check('4 ordens de volta apos Reset', visiveis.length === 4, visiveis.join(' '));
        check('inputs de analise limpos', e.analiseInicio === '' && e.analiseFim === '');
        check('4 checkboxes de turno remarcados', e.turnos.every((t) => t.endsWith(':true')), e.turnos.join(' '));
        check('contadores 1/1/1/1', e.contadores.join(',') === '1,1,1,1', e.contadores.join(','));
        check('KPI total = 4', e.kpiTotal === '4', e.kpiTotal);
        check('listaFiltrada = 4', e.filtradas === 4, e.filtradas);

        console.log('\n== filtros que ja existiam ==');
        await abrirDrawer();
        await clicar('.filter-sector input[value="Montagem"]');
        visiveis = await linhas();
        check('desmarcar o setor Montagem esvazia a tabela', visiveis.length === 0, visiveis.length);
        await clicar('.filter-sector input[value="Montagem"]');
        check('remarcar devolve as 4', (await linhas()).length === 4);
        await page.evaluate(() => document.getElementById('btn-reset-filters').click());
        await espera(PAUSA);

        console.log('\n== integridade ==');
        check('sem pageerror', pageErros.length === 0, JSON.stringify(pageErros.slice(0, 3)));
        check('sem HTTP >= 400', httpErros.length === 0, JSON.stringify(httpErros.slice(0, 3)));
    } finally {
        await browser.close();
        for (const id of criadas) {
            await fetch(`${BASE}/ordens/${id}`, { method: 'DELETE', headers: H });
        }
        console.log('\ncleanup: ' + criadas.length + ' ordens removidas');
    }

    console.log(`\nRESULTADO: ${ok} PASS / ${fail} FAIL`);
    process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('ERRO:', e); process.exit(1); });

// E2E de UI: quantidade de pecas nos cards de KPI.
//
// Premissas: servidor em http://127.0.0.1:3000 e Chrome via puppeteer.
// Rodar: node tests/e2e-kpi-pecas.js
//
// O teste compara o que esta na tela com a mesma conta feita sobre a resposta
// da API: se a tela somar errado (ou ignorar um filtro) o numero nao bate.

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

// Mesma regra do frontend, escrita de forma independente de proposito.
const parseQuantidade = (valor) => {
    if (valor === null || valor === undefined) return NaN;
    if (typeof valor === 'number') return Math.trunc(valor);
    const texto = String(valor).trim();
    if (texto === '') return NaN;
    return parseInt(texto.replace(/\./g, '').split(',')[0], 10);
};
const formatarPecas = (n) => (Number(n) || 0).toLocaleString('pt-BR') + (Number(n) === 1 ? ' peça' : ' peças');

const diffDias = (abertura, analise) => {
    if (!abertura || !analise) return null;
    const a = new Date(String(abertura).substring(0, 10) + 'T00:00:00-03:00');
    const b = new Date(String(analise).substring(0, 10) + 'T00:00:00-03:00');
    if (isNaN(a.getTime()) || isNaN(b.getTime())) return null;
    return Math.floor((b - a) / (24 * 60 * 60 * 1000));
};

const contar = (lista) => {
    const r = { total: lista.length, pecasTotal: 0, faltaPagar: 0, pecasFaltaPagar: 0, prazo: 0, pecasPrazo: 0, critico: 0, pecasCritico: 0, pagas: 0, pecasPagas: 0, semData: 0 };
    lista.forEach((o) => {
        const p = parseQuantidade(o.total_pecas);
        const pecas = isNaN(p) ? 0 : p;
        r.pecasTotal += pecas;
        if (o.situacao === 'Falta Pagar') {
            r.faltaPagar++; r.pecasFaltaPagar += pecas;
        } else if (o.situacao === 'Pago' || o.dia_analise) {
            r.pagas++; r.pecasPagas += pecas;
            const d = diffDias(o.data_abertura, o.dia_analise);
            if (d !== null) {
                if (d <= 2) { r.prazo++; r.pecasPrazo += pecas; }
                else { r.critico++; r.pecasCritico += pecas; }
            } else {
                r.semData++;
            }
        }
    });
    return r;
};

const lerCards = () => {
    const ler = (id) => {
        const el = document.getElementById(id);
        return el ? el.textContent.trim() : null;
    };
    return {
        total: ler('kpi-total-ops'),
        totalPecas: ler('kpi-total-ops-pecas'),
        faltaPagar: ler('kpi-falta-pagar'),
        faltaPagarPecas: ler('kpi-falta-pagar-pecas'),
        critico: ler('kpi-critico'),
        criticoPecas: ler('kpi-critico-pecas'),
        prazo: ler('kpi-prazo'),
        prazoPecas: ler('kpi-prazo-pecas'),
        resumoPagas: ler('resumo-pagas'),
        resumoPecasPagas: ler('resumo-pecas-pagas'),
        resumoPontualidade: ler('resumo-pontualidade'),
        resumoSplit: ler('resumo-split-prazo')
    };
};

(async () => {
    const lr = await fetch(`${cfg.SUPABASE_URL_ORDENS}/auth/v1/token?grant_type=password`, {
        method: 'POST',
        headers: { apikey: ANON, 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'admin@schadek.com.br', password: 'schadek123' })
    });
    const token = (await lr.json()).access_token;
    const H = { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token };

    const tag = 'K' + String(Date.now() % 100000);
    const criada = await (await fetch(`${BASE}/ordens`, {
        method: 'POST', headers: H,
        body: JSON.stringify({
            numero_op: tag, total_pecas: 4321, setor: 'Montagem',
            data_abertura: '2026-10-10', situacao: 'Falta Pagar', prioridade: 'MWM'
        })
    })).json();
    const id = criada.id;
    if (!id) { console.error('nao criou a ordem:', criada); process.exit(1); }

    // Segunda ordem: Paga. A rota preenche dia_analise com agora() quando a
    // situacao e 'Pago', entao esta cai em "fora do prazo" (abertura 10/10).
    // Ordem paga SEM data so existe como legado, por isso esse caso fica nos
    // testes unitarios.
    const tagPaga = 'G' + String(Date.now() % 100000);
    const criadaPaga = await (await fetch(`${BASE}/ordens`, {
        method: 'POST', headers: H,
        body: JSON.stringify({
            numero_op: tagPaga, total_pecas: 7, setor: 'Montagem',
            data_abertura: '2026-10-10', situacao: 'Pago'
        })
    })).json();
    const idPaga = criadaPaga.id;
    if (!idPaga) { console.error('nao criou a ordem paga:', criadaPaga); process.exit(1); }

    console.log('ordem de teste id=' + id + ' (' + tag + ', 4321 pecas, falta pagar)');
    console.log('ordem de teste id=' + idPaga + ' (' + tagPaga + ', 7 pecas, paga)\n');

    const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox'], protocolTimeout: 180000 });
    const page = await browser.newPage();
    const dialogos = [];
    page.on('dialog', async (d) => {
        dialogos.push(d.type() + ': ' + d.message());
        console.log('  [dialogo]', d.type(), '-', d.message());
        await d.dismiss();
    });
    page.on('pageerror', (e) => console.log('  [pageerror]', e.message));

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
        await esperar(1000);

        console.log('== cards x lista completa da API ==');
        // A tela carrega /ordens/pendentes (o backend ja exclui 'Encerrado'),
        // entao a expectativa tem que sair da mesma rota.
        const lista = await (await fetch(`${BASE}/ordens/pendentes`, { headers: H })).json();
        const esperado = contar(lista);
        const cards = await page.evaluate(lerCards);

        check('card Total em Fila: numero de ordens', cards.total === String(esperado.total), `tela=${cards.total} api=${esperado.total}`);
        check('card Total em Fila: pecas somadas', cards.totalPecas === formatarPecas(esperado.pecasTotal), `tela=${cards.totalPecas} api=${formatarPecas(esperado.pecasTotal)}`);
        check('card Falta Pagar: numero de ordens', cards.faltaPagar === String(esperado.faltaPagar), `tela=${cards.faltaPagar} api=${esperado.faltaPagar}`);
        check('card Falta Pagar: pecas somadas', cards.faltaPagarPecas === formatarPecas(esperado.pecasFaltaPagar), `tela=${cards.faltaPagarPecas} api=${formatarPecas(esperado.pecasFaltaPagar)}`);
        check('card Pagas no Prazo: pecas somadas', cards.prazoPecas === formatarPecas(esperado.pecasPrazo), `tela=${cards.prazoPecas} api=${formatarPecas(esperado.pecasPrazo)}`);
        check('card Pagas apos 48h: pecas somadas', cards.criticoPecas === formatarPecas(esperado.pecasCritico), `tela=${cards.criticoPecas} api=${formatarPecas(esperado.pecasCritico)}`);
        check('pecas seguem o separador pt-BR', /^\d{1,3}(\.\d{3})* (peça|peças)$/.test(cards.faltaPagarPecas || ''), cards.faltaPagarPecas);

        console.log('\n== faixa de resumo: total pago ==');
        check('faixa: total pago = todas as pagas', cards.resumoPagas === String(esperado.pagas), `tela=${cards.resumoPagas} api=${esperado.pagas}`);
        check('faixa: pecas pagas somadas', cards.resumoPecasPagas === formatarPecas(esperado.pecasPagas), `tela=${cards.resumoPecasPagas} api=${formatarPecas(esperado.pecasPagas)}`);
        check(
            'faixa: total pago = no prazo + fora + sem data',
            esperado.pagas === esperado.prazo + esperado.critico + esperado.semData,
            `${esperado.pagas} = ${esperado.prazo} + ${esperado.critico} + ${esperado.semData}`
        );

        const pontualidadeEsperada = (esperado.prazo + esperado.critico)
            ? Math.round((esperado.prazo / (esperado.prazo + esperado.critico)) * 100) + '%'
            : '—';
        check('faixa: pontualidade', cards.resumoPontualidade === pontualidadeEsperada, `tela=${cards.resumoPontualidade} api=${pontualidadeEsperada}`);

        const splitEsperado = esperado.prazo + ' no prazo · ' + esperado.critico + ' fora do prazo' +
            (esperado.semData > 0 ? ' · ' + esperado.semData + ' sem data' : '');
        check('faixa: split de prazo', cards.resumoSplit === splitEsperado, `tela="${cards.resumoSplit}" api="${splitEsperado}"`);

        console.log('\n== pecas acompanham o filtro de busca ==');
        await page.evaluate((op) => {
            const busca = document.getElementById('table-search');
            busca.value = op;
            busca.dispatchEvent(new Event('input', { bubbles: true }));
        }, tag);
        await esperar(1200);

        const filtrado = await page.evaluate(lerCards);
        check('busca por 1 OP: card Falta Pagar = 1', filtrado.faltaPagar === '1', filtrado.faltaPagar);
        check('busca por 1 OP: pecas = 4.321', filtrado.faltaPagarPecas === '4.321 peças', filtrado.faltaPagarPecas);
        check('busca por 1 OP: total tambem filtra', filtrado.total === '1' && filtrado.totalPecas === '4.321 peças', filtrado.total + ' / ' + filtrado.totalPecas);
        check('busca por 1 OP em aberto: faixa zera o pago', filtrado.resumoPagas === '0' && filtrado.resumoPecasPagas === '0 peças' && filtrado.resumoPontualidade === '—', JSON.stringify({ p: filtrado.resumoPagas, q: filtrado.resumoPecasPagas, pct: filtrado.resumoPontualidade }));

        console.log('\n== pecas acompanham o filtro de setor ==');
        await page.evaluate(() => {
            const busca = document.getElementById('table-search');
            busca.value = '';
            busca.dispatchEvent(new Event('input', { bubbles: true }));
        });
        await esperar(800);

        const antesSetor = await page.evaluate(lerCards);
        await page.evaluate(() => {
            // desmarca todos os setores: sobra uma tela vazia e cards zerados
            document.querySelectorAll('.filter-sector-card input[type="checkbox"]').forEach((c) => {
                if (c.checked) { c.checked = false; c.dispatchEvent(new Event('change', { bubbles: true })); }
            });
        });
        await esperar(1000);

        const semSetor = await page.evaluate(lerCards);
        check('sem setor selecionado: zero ordens e "0 peças"', semSetor.total === '0' && semSetor.totalPecas === '0 peças' && semSetor.faltaPagarPecas === '0 peças', JSON.stringify(semSetor));
        check('sem setor selecionado: faixa de pago zera', semSetor.resumoPagas === '0' && semSetor.resumoPecasPagas === '0 peças' && semSetor.resumoPontualidade === '—', JSON.stringify({ p: semSetor.resumoPagas, q: semSetor.resumoPecasPagas, pct: semSetor.resumoPontualidade }));
        check('cards voltam ao normal ao reativar os setores', antesSetor.total !== '0', 'antes=' + antesSetor.total);
        check('nenhum dialogo de erro', dialogos.length === 0, dialogos.join(' | '));

        console.log(`\nRESULTADO: ${ok} PASS / ${fail} FAIL`);
    } catch (erro) {
        console.error('ERRO:', erro);
        fail++;
    } finally {
        await browser.close();
        const del = await fetch(`${BASE}/ordens/${id}`, { method: 'DELETE', headers: H });
        const delPaga = await fetch(`${BASE}/ordens/${idPaga}`, { method: 'DELETE', headers: H });
        console.log('cleanup: ordens ' + id + ' e ' + idPaga + ' removidas (status ' + del.status + '/' + delPaga.status + ')');
        process.exitCode = fail ? 1 : 0;
    }
})();

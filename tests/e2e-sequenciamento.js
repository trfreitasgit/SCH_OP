// E2E do endpoint POST /ordens/sequenciamento/pdf.
//
// Precisa do servidor rodando em http://127.0.0.1:3000 e do Python com reportlab.
// Rodar: node tests/e2e-sequenciamento.js

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

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

// Extrai o texto do PDF com pypdf (ja usado no projeto). Serve para provar o
// conteudo, nao so o status: tamanho e assinatura nao dizem quais OPs sairam.
function textoDoPdf(buf) {
    const arquivo = path.join(os.tmpdir(), 'e2e_seq_conteudo_' + process.pid + '.pdf');
    fs.writeFileSync(arquivo, buf);
    try {
        const script =
            'import sys\n' +
            'from pypdf import PdfReader\n' +
            'print("\\n".join((p.extract_text() or "") for p in PdfReader(sys.argv[1]).pages))\n';
        return execFileSync('python', ['-c', script, arquivo], {
            encoding: 'utf8',
            env: Object.assign({}, process.env, { PYTHONIOENCODING: 'utf-8' })
        });
    } finally {
        if (fs.existsSync(arquivo)) fs.unlinkSync(arquivo);
    }
}

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

    // Ordens que NAO entram na folha (mesma lista de lib/sequenciamento-ordens.js)
    const todas = await (await fetch(`${BASE}/ordens`, { headers: H })).json();
    const EXCLUIDAS = ['Pago', 'Encerrado'];
    const pendentes = todas.filter((o) => !EXCLUIDAS.includes(o.situacao));
    const foraDaFolha = todas.filter((o) => EXCLUIDAS.includes(o.situacao));
    console.log('ordens no banco:', todas.length, '| na folha:', pendentes.length, '| fora (Pago/Encerrado):', foraDaFolha.length);
    console.log('encerradas no banco:', foraDaFolha.filter((o) => o.situacao === 'Encerrado').map((o) => o.numero_op).join(', ') || 'nenhuma');
    const setores = Array.from(new Set(pendentes.map((o) => o.setor))).filter(Boolean);
    console.log('setores com pendencia:', JSON.stringify(setores), '\n');

    // Setor que so tem ordem fora da folha: nao pode gerar PDF.
    const setoresDaFolha = new Set(pendentes.map((o) => o.setor));
    const setorSoExcluido = Array.from(new Set(foraDaFolha.map((o) => o.setor)))
        .find((s) => s && !setoresDaFolha.has(s));

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

    if (setorSoExcluido) {
        const soExcluido = await fetch(`${BASE}/ordens/sequenciamento/pdf`, {
            method: 'POST', headers: H,
            body: JSON.stringify({ setores_selecionados: [setorSoExcluido] })
        });
        check(
            'setor "' + setorSoExcluido + '" so com ordem Pago/Encerrado -> 400',
            soExcluido.status === 400,
            'status=' + soExcluido.status
        );
    } else {
        console.log('  (nenhum setor so com ordens Pago/Encerrado hoje)');
    }

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

    // Prova de conteudo: OP encerrada nao pode aparecer na folha.
    const encerradas = foraDaFolha.filter((o) => o.situacao === 'Encerrado').map((o) => o.numero_op);
    if (encerradas.length) {
        try {
            const texto = textoDoPdf(buf);
            const vazadas = encerradas.filter((op) => texto.includes(String(op)));
            check(
                'nenhuma OP Encerrado no PDF (' + encerradas.length + ' no banco)',
                vazadas.length === 0,
                vazadas.length ? 'vazou: ' + vazadas.join(', ') : 'ok'
            );
        } catch (e) {
            console.log('  SKIP checagem de texto (pypdf indisponivel):', e.message.split('\n')[0]);
        }
    }

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

    console.log('\n== PDF apenas com as ordens escolhidas (etapa 2) ==');
    const tipoErradoIds = await fetch(`${BASE}/ordens/sequenciamento/pdf`, {
        method: 'POST', headers: H, body: JSON.stringify({ ordens_selecionadas: 'nao-e-lista' })
    });
    const corpoIds = await tipoErradoIds.json().catch(() => ({}));
    check('ordens_selecionadas nao-lista -> 400', tipoErradoIds.status === 400, 'status=' + tipoErradoIds.status);
    check(
        'mensagem cita o campo ordens_selecionadas',
        /ordens_selecionadas/.test(corpoIds.erro || ''),
        corpoIds.erro || ''
    );

    const idsVazios = await fetch(`${BASE}/ordens/sequenciamento/pdf`, {
        method: 'POST', headers: H, body: JSON.stringify({ ordens_selecionadas: [] })
    });
    check('ordens_selecionadas vazia -> 400 (nao vira "todas")', idsVazios.status === 400, 'status=' + idsVazios.status);

    const idsComLixo = await fetch(`${BASE}/ordens/sequenciamento/pdf`, {
        method: 'POST', headers: H, body: JSON.stringify({ ordens_selecionadas: [0, -1] })
    });
    check('ids zero/negativos -> 400', idsComLixo.status === 400, 'status=' + idsComLixo.status);

    if (pendentes.length >= 2) {
        const escolhidas = [pendentes[0], pendentes[pendentes.length - 1]];
        const idsEscolhidos = escolhidas.map((o) => Number(o.id));

        const respSelecao = await fetch(`${BASE}/ordens/sequenciamento/pdf`, {
            method: 'POST', headers: H, body: JSON.stringify({ ordens_selecionadas: idsEscolhidos })
        });
        check('2 ordens escolhidas -> 200', respSelecao.status === 200, 'status=' + respSelecao.status);

        const bufSelecao = Buffer.from(await respSelecao.arrayBuffer());
        check('PDF da selecao e valido', bufSelecao.slice(0, 5).toString() === '%PDF-', bufSelecao.length + ' bytes');
        check('PDF da selecao nao e maior que o completo', bufSelecao.length <= buf.length, bufSelecao.length + ' <= ' + buf.length);

        try {
            const texto = textoDoPdf(bufSelecao);
            const faltando = escolhidas.filter((o) => !texto.includes(String(o.numero_op)));
            check(
                'PDF traz as OPs escolhidas (' + escolhidas.map((o) => o.numero_op).join(', ') + ')',
                faltando.length === 0,
                faltando.length ? 'faltou: ' + faltando.map((o) => o.numero_op).join(', ') : 'ok'
            );

            const naoEscolhidas = pendentes.filter((o) => !idsEscolhidos.includes(Number(o.id)));
            const vazaram = naoEscolhidas.filter((o) => texto.includes(String(o.numero_op)));
            check(
                'ordens nao escolhidas ficaram fora (' + naoEscolhidas.length + ' no banco)',
                vazaram.length === 0,
                vazaram.length ? 'vazou: ' + vazaram.map((o) => o.numero_op).join(', ') : 'ok'
            );
        } catch (e) {
            console.log('  SKIP checagem de texto (pypdf indisponivel):', e.message.split('\n')[0]);
        }
    } else {
        console.log('  (menos de 2 ordens pendentes para testar a selecao)');
    }

    if (foraDaFolha.length) {
        const fora = foraDaFolha[0];
        const soFora = await fetch(`${BASE}/ordens/sequenciamento/pdf`, {
            method: 'POST', headers: H, body: JSON.stringify({ ordens_selecionadas: [Number(fora.id)] })
        });
        check(
            'id de ordem Pago/Encerrado -> 400 (filtro de situacao prevalece)',
            soFora.status === 400,
            'status=' + soFora.status
        );
    }

    if (pendentes.length && setores.length > 1) {
        const alvo = pendentes[0];
        const outroSetor = setores.find((s) => s !== alvo.setor);
        const cruzado = await fetch(`${BASE}/ordens/sequenciamento/pdf`, {
            method: 'POST', headers: H,
            body: JSON.stringify({ setores_selecionados: [outroSetor], ordens_selecionadas: [Number(alvo.id)] })
        });
        check(
            'setor + id de outro setor -> 400 (filtros se somam)',
            cruzado.status === 400,
            'status=' + cruzado.status
        );
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

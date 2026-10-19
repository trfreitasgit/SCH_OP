// Testes das regras de data/turno do frontend (ordens.js).
//
// O bloco e extraido do proprio ordens.js (nao ha copia aqui): assim o teste
// quebra se alguem mudar a regra no arquivo real.
//
// Rodar: node --test tests/

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

// ---------------------------------------------------------------------------
// Extracao do bloco real de ordens.js
// ---------------------------------------------------------------------------
function carregarRegras() {
    const arquivo = path.join(__dirname, '..', 'ordens.js');
    const src = fs.readFileSync(arquivo, 'utf8');

    const ini = src.indexOf("var TZ_FABRICA = 'America/Sao_Paulo';");
    if (ini === -1) throw new Error('nao achei o bloco de fuso/turno em ordens.js');

    const fimTurno = src.indexOf('// TURNO DO PAGAMENTO', ini);
    if (fimTurno === -1) throw new Error('nao achei o inicio do bloco de turno');

    // Do bloco de turno ate a proxima funcao de topo depois dele (calcularDiferencaDias).
    const fim = src.indexOf('function calcularDiferencaDias', fimTurno);
    if (fim === -1) throw new Error('nao achei o fim do bloco de turno');

    const bloco = src.slice(ini, fim);

    return new Function(
        bloco +
        '\nreturn { obterHoraMinutoFabrica, obterDataFabrica, obterTurno, INICIO_TURNO, diaAnaliseComTurno, diaAnaliseComData, mesmaDataAnalise };'
    )();
}

const regras = carregarRegras();

// ---------------------------------------------------------------------------
// obterHoraMinutoFabrica - le sempre no fuso da fabrica
// ---------------------------------------------------------------------------
test('le a hora no fuso da fabrica, nao no fuso do navegador', () => {
    // 22:00 em Sao Paulo = 01:00 UTC do dia seguinte.
    assert.deepStrictEqual(
        regras.obterHoraMinutoFabrica('2026-10-17T01:00:00.000Z'),
        { hora: 22, minuto: 0 }
    );
});

test('data pura AAAA-MM-DD vale como meia-noite da fabrica', () => {
    assert.deepStrictEqual(
        regras.obterHoraMinutoFabrica('2026-10-17'),
        { hora: 0, minuto: 0 }
    );
});

test('entrada vazia ou invalida devolve null', () => {
    assert.strictEqual(regras.obterHoraMinutoFabrica(''), null);
    assert.strictEqual(regras.obterHoraMinutoFabrica(null), null);
    assert.strictEqual(regras.obterHoraMinutoFabrica('nao-e-data'), null);
});

// ---------------------------------------------------------------------------
// obterDataFabrica - le sempre no fuso da fabrica
// ---------------------------------------------------------------------------
test('le a data no fuso da fabrica (22h de 16/10 nao vira 17/10)', () => {
    assert.deepStrictEqual(
        regras.obterDataFabrica('2026-10-17T01:00:00.000Z'),
        { ano: '2026', mes: '10', dia: '16' }
    );
});

// ---------------------------------------------------------------------------
// obterTurno - limites T1/T2/T3
// ---------------------------------------------------------------------------
test('classifica os limites dos turnos', () => {
    const emSP = (h, m) => `2026-10-17T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00-03:00`;
    assert.strictEqual(regras.obterTurno(emSP(5, 19)), 'T3');
    assert.strictEqual(regras.obterTurno(emSP(5, 20)), 'T1');
    assert.strictEqual(regras.obterTurno(emSP(13, 39)), 'T1');
    assert.strictEqual(regras.obterTurno(emSP(13, 40)), 'T2');
    assert.strictEqual(regras.obterTurno(emSP(21, 59)), 'T2');
    assert.strictEqual(regras.obterTurno(emSP(22, 0)), 'T3');
    assert.strictEqual(regras.obterTurno(emSP(0, 0)), 'T3');
});

test('sem dia_analise nao ha turno', () => {
    assert.strictEqual(regras.obterTurno(null), null);
    assert.strictEqual(regras.obterTurno(''), null);
});

// ---------------------------------------------------------------------------
// NOVO: dia_analise a partir de turno escolhido (mantem a data, troca a hora)
// ---------------------------------------------------------------------------
test('INICIO_TURNO traz a hora inicial de cada turno', () => {
    assert.deepStrictEqual(regras.INICIO_TURNO, {
        T1: { hora: 5, minuto: 20 },
        T2: { hora: 13, minuto: 40 },
        T3: { hora: 22, minuto: 0 }
    });
});

test('aplica turno mantendo a data da fabrica e trocando so a hora', () => {
    // Pagamento em 17/10 as 09:00 SP; usuario troca para T2.
    const novo = regras.diaAnaliseComTurno('2026-10-17T09:00:00-03:00', 'T2');
    assert.deepStrictEqual(
        regras.obterHoraMinutoFabrica(novo),
        { hora: 13, minuto: 40 }
    );
    assert.deepStrictEqual(
        regras.obterDataFabrica(novo),
        { ano: '2026', mes: '10', dia: '17' }
    );
});

test('aplica T3 mantendo a data do dia do pagamento (nao pula para o dia seguinte)', () => {
    const novo = regras.diaAnaliseComTurno('2026-10-17T09:00:00-03:00', 'T3');
    assert.deepStrictEqual(regras.obterHoraMinutoFabrica(novo), { hora: 22, minuto: 0 });
    assert.deepStrictEqual(regras.obterDataFabrica(novo), { ano: '2026', mes: '10', dia: '17' });
});

test('aplica turno a partir de data pura (meia-noite) sem perder o dia', () => {
    const novo = regras.diaAnaliseComTurno('2026-10-17', 'T1');
    assert.deepStrictEqual(regras.obterHoraMinutoFabrica(novo), { hora: 5, minuto: 20 });
    assert.deepStrictEqual(regras.obterDataFabrica(novo), { ano: '2026', mes: '10', dia: '17' });
});

test('aplica turno em data perto da virada do dia em UTC', () => {
    // 22:00 SP de 16/10 chega do banco como 01:00Z de 17/10.
    const novo = regras.diaAnaliseComTurno('2026-10-17T01:00:00.000Z', 'T1');
    assert.deepStrictEqual(regras.obterHoraMinutoFabrica(novo), { hora: 5, minuto: 20 });
    assert.deepStrictEqual(regras.obterDataFabrica(novo), { ano: '2026', mes: '10', dia: '16' });
});

test('turno invalido ou dia_analise ausente devolve null', () => {
    assert.strictEqual(regras.diaAnaliseComTurno(null, 'T1'), null);
    assert.strictEqual(regras.diaAnaliseComTurno('2026-10-17T09:00:00-03:00', 'T9'), null);
    assert.strictEqual(regras.diaAnaliseComTurno('lixo', 'T1'), null);
});

// ---------------------------------------------------------------------------
// BUG 1/2: editar so a DATA nao pode apagar a hora do pagamento.
// Antes da correcao, salvar "2026-10-17" virava 00:00 e o turno caia para T3.
// ---------------------------------------------------------------------------
test('trocar a data preserva a hora original do pagamento', () => {
    // Pagamento em 16/10 as 09:15 SP; usuario corrige a data para 17/10.
    const novo = regras.diaAnaliseComData('2026-10-16T09:15:00-03:00', '2026-10-17');
    assert.deepStrictEqual(regras.obterDataFabrica(novo), { ano: '2026', mes: '10', dia: '17' });
    assert.deepStrictEqual(regras.obterHoraMinutoFabrica(novo), { hora: 9, minuto: 15 });
});

test('trocar a data de um pagamento as 22h preserva a hora e o turno T3', () => {
    // 22:00 SP de 16/10 chega do banco como 01:00Z de 17/10.
    const novo = regras.diaAnaliseComData('2026-10-17T01:00:00.000Z', '2026-10-20');
    assert.deepStrictEqual(regras.obterDataFabrica(novo), { ano: '2026', mes: '10', dia: '20' });
    assert.strictEqual(regras.obterTurno(novo), 'T3');
});

test('quando nao ha hora registrada, trocar a data usa meia-noite', () => {
    const novo = regras.diaAnaliseComData('2026-10-17', '2026-10-18');
    assert.deepStrictEqual(regras.obterDataFabrica(novo), { ano: '2026', mes: '10', dia: '18' });
    assert.deepStrictEqual(regras.obterHoraMinutoFabrica(novo), { hora: 0, minuto: 0 });
});

test('data invalida devolve null', () => {
    assert.strictEqual(regras.diaAnaliseComData('2026-10-17T09:15:00-03:00', 'lixo'), null);
    assert.strictEqual(regras.diaAnaliseComData('2026-10-17T09:15:00-03:00', ''), null);
});

// ---------------------------------------------------------------------------
// BUG 3: o comparador de "valor identico" precisa ver a HORA, nao so a data.
// Sem isso, trocar apenas o turno era descartado em silencio.
// ---------------------------------------------------------------------------
test('dois horarios do mesmo dia NAO sao considerados iguais', () => {
    assert.strictEqual(
        regras.mesmaDataAnalise('2026-10-17T09:15:00-03:00', '2026-10-17T13:40:00-03:00'),
        false
    );
});

test('mesmo instante escrito de formas diferentes e considerado igual', () => {
    assert.strictEqual(
        regras.mesmaDataAnalise('2026-10-17T09:15:00-03:00', '2026-10-17T12:15:00.000Z'),
        true
    );
    assert.strictEqual(regras.mesmaDataAnalise('2026-10-17', '2026-10-17'), true);
});

test('null e string vazia sao equivalentes (campo limpo)', () => {
    assert.strictEqual(regras.mesmaDataAnalise(null, ''), true);
    assert.strictEqual(regras.mesmaDataAnalise(null, '2026-10-17T09:15:00-03:00'), false);
});


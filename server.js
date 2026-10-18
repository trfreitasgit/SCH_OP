require('dotenv').config();
var express = require('express');
var app = express();
var { createClient } = require('@supabase/supabase-js');
var cors = require('cors');
var cookieParser = require('cookie-parser');
const path = require('path');
var fs = require('fs');
var { exec } = require('child_process');


app.use(express.json());
app.use(cors({
    origin: process.env.FRONTEND_URL || 'http://localhost:3000',
    credentials: true
}));
app.use(cookieParser());

// Supabase client
var supabase = createClient(
    process.env.SUPABASE_URL_ORDENS || process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY_ORDENS || process.env.SUPABASE_SERVICE_ROLE_KEY
);

function isApiRequest(req) {
    return req.headers.accept?.includes('application/json') ||
           req.headers['x-requested-with'] === 'XMLHttpRequest' ||
           req.path.startsWith('/api/') ||
           req.path.startsWith('/ordens');
}

async function requireAuth(req, res, next) {
    const authHeader = req.headers.authorization;
    const cookieToken = req.cookies?.access_token;
    const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : cookieToken;

    if (!token) {
        if (isApiRequest(req)) {
            return res.status(401).json({ error: 'Token de acesso não fornecido' });
        }
        return res.redirect(302, '/login');
    }

    try {
        const { data: { user }, error } = await supabase.auth.getUser(token);
        
        if (error || !user) {
            if (isApiRequest(req)) {
                return res.status(401).json({ error: 'Token inválido ou expirado' });
            }
            return res.redirect(302, '/login');
        }
        
        req.user = user;
        next();
    } catch (err) {
        if (isApiRequest(req)) {
            return res.status(401).json({ error: 'Erro ao validar token' });
        }
        return res.redirect(302, '/login');
    }
}

app.get('/login', function(req, res) {
    res.sendFile(path.join(__dirname, 'login.html'));
});

app.get('/', requireAuth, function(req, res) {
    res.sendFile(path.join(__dirname, 'ordens.html'));
});

var pesos = {
    'Exportacao': 2,
    'MWM': 3,
    'KS': 4,
    'Marelli': 5,
    'Pendencia Comercial': 6,
    'Linha Pesada': 7,
    'MRP': 8,
    'Tryout': 9
};

var PRIORIDADES_VALIDAS = Object.keys(pesos);
var SITUACOES_VALIDAS = ['Falta Pagar', 'Pago', 'Encerrado'];
var SETORES_VALIDOS = ['Montagem', 'Subconjunto', 'Celula', 'BCM', 'Importada', 'Usinagem'];

var CAMPOS_ORDENACAO_VALIDOS = [
    'id', 'numero_op', 'setor', 'total_pecas', 'material',
    'data_abertura', 'dia_analise', 'situacao', 'prioridade',
    'observacao', 'peso_prioridade', 'created_at', 'updated_at'
];

function buildOrderQuery(query, sort, order, defaultOrders) {
    var campo = sort && CAMPOS_ORDENACAO_VALIDOS.includes(sort) ? sort : null;
    var direcao = order === 'desc' ? false : true;
    
    if (campo) {
        return query.order(campo, { ascending: direcao });
    }
    
    return defaultOrders.reduce(function(q, o) {
        return q.order(o.campo, { ascending: o.ascending, nullsLast: o.nullsLast });
    }, query);
}

// O SAP exporta quantidades no formato pt-BR, usando o ponto como separador de
// milhar ("1.000"). Como parseInt("1.000", 10) === 1 (a conversao para no primeiro
// caractere nao-digito), removemos os pontos antes de converter. A parte decimal
// (apos a virgula) e descartada, pois total_pecas e um contador inteiro.
function parseQuantidade(valor) {
    if (valor === null || valor === undefined) return NaN;
    if (typeof valor === 'number') return Math.trunc(valor);
    var texto = String(valor).trim();
    if (texto === '') return NaN;
    return parseInt(texto.replace(/\./g, '').split(',')[0], 10);
}

// Converte o valor recebido para timestamptz ISO. Uma data "pura" (YYYY-MM-DD) e
// ancorada na meia-noite de Sao Paulo (-03:00), preservando a semantica de "dia
// local" que existia antes da migracao da coluna para timestamptz. Retorna null
// para entrada vazia e undefined para entrada invalida (o chamador responde 400).
function normalizarDiaAnalise(valor) {
    if (valor === undefined || valor === null) return null;
    var texto = String(valor).trim();
    if (texto === '') return null;
    if (/^\d{4}-\d{2}-\d{2}$/.test(texto)) return texto + 'T00:00:00-03:00';
    if (isNaN(new Date(texto).getTime())) return undefined;
    return texto;
}

// Timestamp atual em ISO (UTC) - instante absoluto gravado na coluna timestamptz.
function agoraISO() {
    return new Date().toISOString();
}

// ---------------------------------------------------------------------------
// TURNOS - fonte da verdade no backend (horario avaliado em America/Sao_Paulo)
//   T1: 05:20 as 13:39
//   T2: 13:40 as 21:59
//   T3: 22:00 as 05:19 (cruza a meia-noite)
// ---------------------------------------------------------------------------
var TZ_TURNO = 'America/Sao_Paulo';

function minutosEmSaoPaulo(data) {
    var partes = new Intl.DateTimeFormat('en-GB', {
        timeZone: TZ_TURNO,
        hour: '2-digit',
        minute: '2-digit',
        hour12: false
    }).formatToParts(data);
    var h = 0;
    var m = 0;
    for (var i = 0; i < partes.length; i++) {
        if (partes[i].type === 'hour') h = parseInt(partes[i].value, 10) % 24;
        if (partes[i].type === 'minute') m = parseInt(partes[i].value, 10);
    }
    return h * 60 + m;
}

function classificarTurno(data) {
    var d = data instanceof Date ? data : new Date(data);
    if (isNaN(d.getTime())) return null;

    var min = minutosEmSaoPaulo(d);
    if (min >= 5 * 60 + 20 && min <= 13 * 60 + 39) return 'T1'; // 05:20 - 13:39
    if (min >= 13 * 60 + 40 && min <= 21 * 60 + 59) return 'T2'; // 13:40 - 21:59
    return 'T3'; // 22:00 - 05:19 (inclui a virada do dia)
}

app.get('/ordens', requireAuth, async function (req, res) {
    var sort = req.query.sort;
    var order = req.query.order;
    
    var query = supabase
        .from('ordens_producao')
        .select('*');
    
    query = buildOrderQuery(query, sort, order, [
        { campo: 'id', ascending: false }
    ]);
    
    var { data, error } = await query;
    
    if (error) {
        return res.status(500).json({ erro: error.message });
    }
    res.json(data);
});

app.get('/ordens/pendentes', requireAuth, async function (req, res) {
    var sort = req.query.sort;
    var order = req.query.order;
    
    var query = supabase
        .from('ordens_producao')
        .select('*')
        .neq('situacao', 'Encerrado');
    
    query = buildOrderQuery(query, sort, order, [
        { campo: 'peso_prioridade', ascending: true, nullsLast: true },
        { campo: 'id', ascending: false }
    ]);
    
    var { data, error } = await query;
    
    if (error) {
        return res.status(500).json({ erro: error.message });
    }
    res.json(data);
});

app.post('/ordens', requireAuth, async function (req, res) {
    var numero_op = req.body.numero_op ? String(req.body.numero_op).trim() : null;
    var setor = req.body.setor ? String(req.body.setor).trim() : null;
    var total_pecas = parseQuantidade(req.body.total_pecas);
    var material = req.body.material !== undefined && req.body.material !== null ? String(req.body.material).trim() : null;
    var data_abertura = req.body.data_abertura ? String(req.body.data_abertura).trim() : null;
    var dia_analise = normalizarDiaAnalise(req.body.dia_analise);
    if (dia_analise === undefined) {
        return res.status(400).json({ erro: 'Dia de análise inválido.' });
    }
    var situacao = req.body.situacao ? String(req.body.situacao).trim() : 'Falta Pagar';
    var prioridade = req.body.prioridade ? String(req.body.prioridade).trim() : null;
    var observacao = req.body.observacao ? String(req.body.observacao).trim() : null;

    if (!numero_op) {
        return res.status(400).json({ erro: 'O número da OP é obrigatório.' });
    }

    if (isNaN(total_pecas) || total_pecas <= 0) {
        return res.status(400).json({ erro: 'O total de peças deve ser um número maior que zero.' });
    }

    if (material) {
        if (material.length > 8 || !/^\d+$/.test(material)) {
            return res.status(400).json({ erro: 'O material deve respeitar a regra de ser numérico com no máximo 8 dígitos.' });
        }
    }

    if (setor && !SETORES_VALIDOS.includes(setor)) {
        return res.status(400).json({ erro: 'Setor inválido. Opções válidas: ' + SETORES_VALIDOS.join(', ') });
    }

    if (prioridade && !PRIORIDADES_VALIDAS.includes(prioridade)) {
        return res.status(400).json({ erro: 'Prioridade inválida. Opções: ' + PRIORIDADES_VALIDAS.join(', ') });
    }

    var peso_prioridade = prioridade && pesos[prioridade] ? pesos[prioridade] : null;

    if (situacao === 'Pago' && !dia_analise) {
        dia_analise = agoraISO();
    }

    var { data, error } = await supabase
        .from('ordens_producao')
        .insert([{
            numero_op: numero_op,
            setor: setor,
            total_pecas: total_pecas,
            material: material,
            data_abertura: data_abertura,
            dia_analise: dia_analise,
            situacao: situacao,
            prioridade: prioridade,
            observacao: observacao,
            peso_prioridade: peso_prioridade
        }])
        .select()
        .single();
    
    if (error) {
        if (error.code === '23505') {
            return res.status(400).json({ erro: 'Número de OP já cadastrado. Deve ser único.' });
        }
        if (error.code === '23514') {
            return res.status(400).json({ erro: 'Dados inválidos para as regras da ordem.' });
        }
        return res.status(500).json({ erro: error.message });
    }
    res.json({ mensagem: 'Ordem adicionada com sucesso', id: data.id });
});

app.put('/ordens/:id', requireAuth, async function (req, res) {
    var id = parseInt(req.params.id, 10);
    if (!id || isNaN(id)) {
        return res.status(400).json({ erro: 'ID inválido.' });
    }

    var updateData = {};

    if (req.body.numero_op !== undefined) {
        var op = String(req.body.numero_op).trim();
        if (!op) {
            return res.status(400).json({ erro: 'O número da OP não pode ficar em branco.' });
        }
        updateData.numero_op = op;
    }

    if (req.body.total_pecas !== undefined) {
        var total = parseQuantidade(req.body.total_pecas);
        if (isNaN(total) || total <= 0) {
            return res.status(400).json({ erro: 'O total de peças deve ser um número maior que zero.' });
        }
        updateData.total_pecas = total;
    }

    if (req.body.data_abertura !== undefined) {
        var dataAber = req.body.data_abertura ? String(req.body.data_abertura).trim() : null;
        if (dataAber && isNaN(new Date(dataAber).getTime())) {
            return res.status(400).json({ erro: 'Data de abertura inválida.' });
        }
        updateData.data_abertura = dataAber;
    }

    if (req.body.material !== undefined) {
        var mat = req.body.material !== null ? String(req.body.material).trim() : null;
        if (mat) {
            if (mat.length > 8 || !/^\d+$/.test(mat)) {
                return res.status(400).json({ erro: 'O material deve respeitar a regra de ser numérico com no máximo 8 dígitos.' });
            }
        }
        updateData.material = mat;
    }

    if (req.body.setor !== undefined) {
        var setor = req.body.setor !== null ? String(req.body.setor).trim() : null;
        if (setor && !SETORES_VALIDOS.includes(setor)) {
            return res.status(400).json({ erro: 'Setor inválido. Opções válidas: ' + SETORES_VALIDOS.join(', ') });
        }
        updateData.setor = setor;
    }

    if (req.body.observacao !== undefined) {
        var obs = req.body.observacao !== null ? String(req.body.observacao).trim() : null;
        updateData.observacao = obs;
    }

    var diaAnaliseDefinido = false;
    if (req.body.prioridade !== undefined) {
        var prio = req.body.prioridade !== null ? String(req.body.prioridade).trim() : null;
        if (prio && !PRIORIDADES_VALIDAS.includes(prio)) {
            return res.status(400).json({ erro: 'Prioridade inválida. Opções: ' + PRIORIDADES_VALIDAS.join(', ') });
        }
        updateData.prioridade = prio || null;

        var peso = (prio && pesos[prio]) ? pesos[prio] : null;
        updateData.peso_prioridade = peso;
    }

    if (req.body.dia_analise !== undefined) {
        var dataAna = normalizarDiaAnalise(req.body.dia_analise);
        if (dataAna === undefined) {
            return res.status(400).json({ erro: 'Dia de análise inválido.' });
        }
        updateData.dia_analise = dataAna;
        diaAnaliseDefinido = true;
    }

    if (req.body.situacao !== undefined) {
        var sit = String(req.body.situacao).trim();
        if (!SITUACOES_VALIDAS.includes(sit)) {
            return res.status(400).json({ erro: 'Situação inválida. Opções: ' + SITUACOES_VALIDAS.join(', ') });
        }
        updateData.situacao = sit;

        if (!diaAnaliseDefinido) {
            if (sit === 'Pago') {
                updateData.dia_analise = agoraISO();
            } else {
                updateData.dia_analise = null;
            }
        }
    }

    if (Object.keys(updateData).length === 0) {
        return res.status(400).json({ erro: 'Nenhum campo permitido enviado para atualização.' });
    }

    var { data, error } = await supabase
        .from('ordens_producao')
        .update(updateData)
        .eq('id', id)
        .select()
        .single();

    if (error) {
        if (error.code === '23505') {
            return res.status(400).json({ erro: 'Número de OP já cadastrado em outra ordem (deve ser único).' });
        }
        if (error.code === '23514') {
            return res.status(400).json({ erro: 'Violação de regra no banco de dados (ex: total de peças > 0 ou prioridade válida).' });
        }
        res.status(500).json({ erro: error.message });
    } else if (!data) {
        return res.status(404).json({ erro: 'Ordem não encontrada com ID ' + id });
    } else {
        res.json({ mensagem: 'Ordem atualizada com sucesso!', ordem: data });
    }
});

app.delete('/ordens/:id', requireAuth, async function (req, res) {
    var id = parseInt(req.params.id, 10);
    if (!id || isNaN(id)) {
        return res.status(400).json({ erro: 'ID inválido.' });
    }

    var { data, error } = await supabase
        .from('ordens_producao')
        .delete()
        .eq('id', id)
        .select()
        .single();

    if (error) {
        return res.status(500).json({ erro: error.message });
    }
    if (!data) {
        return res.status(404).json({ erro: 'Ordem não encontrada com ID ' + id });
    }
    res.json({ mensagem: 'Ordem removida com sucesso', id: id });
});

app.delete('/ordens', requireAuth, async function (req, res) {
    var ids = req.body.ids;
    if (!Array.isArray(ids) || ids.length === 0) {
        return res.status(400).json({ erro: 'Lista de IDs para remoção inválida ou vazia.' });
    }

    var { data, error } = await supabase
        .from('ordens_producao')
        .delete()
        .in('id', ids)
        .select();

    if (error) {
        return res.status(500).json({ erro: error.message });
    }
    res.json({ mensagem: 'Ordens removidas com sucesso', removidas: data.length });
});

// ==========================================================================
// EXPORTACAO XLSX
// --------------------------------------------------------------------------
// Dispara: python scripts/export_excel.py --ids "1,2,3"
// Convencao: o script deve imprimir na ULTIMA linha do stdout o caminho do
// arquivo .xlsx gerado; o servidor baixa esse arquivo como anexo e o remove.
// ==========================================================================
var SCRIPT_EXPORT = path.join(__dirname, 'scripts', 'export_excel.py');

function validarIdsExport(ids) {
    if (!Array.isArray(ids) || ids.length === 0) return null;
    var limpos = [];
    for (var i = 0; i < ids.length; i++) {
        var bruto = String(ids[i] === undefined || ids[i] === null ? '' : ids[i]).trim();
        // Somente inteiros positivos: elimina qualquer possibilidade de injecao
        // de comandos no shell (o valor vai para uma chamada exec).
        if (!/^\d+$/.test(bruto)) return null;
        limpos.push(bruto);
    }
    return limpos;
}

app.post('/ordens/export', requireAuth, function (req, res) {
    var ids = validarIdsExport(req.body && req.body.ids);

    if (!ids) {
        return res.status(400).json({ erro: 'Lista de IDs inválida. Envie "ids" como array de inteiros positivos.' });
    }

    if (!fs.existsSync(SCRIPT_EXPORT)) {
        return res.status(500).json({ erro: 'Script de exportação não encontrado (scripts/export_excel.py).' });
    }

    var comando = 'python "' + SCRIPT_EXPORT + '" --ids "' + ids.join(',') + '"';

    exec(comando, { timeout: 60000, maxBuffer: 10 * 1024 * 1024 }, function (erro, stdout, stderr) {
        if (erro) {
            console.error('Erro no script de exportação:', (stderr || erro.message || '').toString().trim());
            return res.status(500).json({
                erro: 'Falha ao executar o script de exportação.',
                detalhe: (stderr || erro.message || '').toString().trim()
            });
        }

        var linhas = String(stdout || '').split(/\r?\n/)
            .map(function (l) { return l.trim(); })
            .filter(function (l) { return l !== ''; });
        var caminho = linhas.length ? linhas[linhas.length - 1] : null;

        if (!caminho || !fs.existsSync(caminho)) {
            return res.status(500).json({
                erro: 'O script de exportação não retornou um arquivo válido.',
                detalhe: caminho || 'stdout vazio'
            });
        }

        var nomeArquivo = 'ordens_' + new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-') + '.xlsx';

        res.download(caminho, nomeArquivo, function (err) {
            // Remove o arquivo temporario gerado pelo script (sucesso ou nao).
            fs.unlink(caminho, function () { /* ignora erro de limpeza */ });
            if (err && !res.headersSent) {
                console.error('Erro ao enviar o arquivo de exportação:', err.message);
            }
        });
    });
});

app.use(express.static(__dirname));

var porta = process.env.PORT || 3000;
app.listen(porta, function () {
    console.log('Servidor no ar na porta ' + porta + '!');

    // Log de acesso: no Render a variavel RENDER_EXTERNAL_URL traz a URL publica
    // real (ex.: https://schadek-op.onrender.com). Em dev, cai no localhost.
    var baseUrl = process.env.RENDER_EXTERNAL_URL ||
        process.env.FRONTEND_URL ||
        ('http://localhost:' + porta);

    console.log('Login: ' + baseUrl.replace(/\/+$/, '') + '/login');
});

app.get('/ping', (req, res) => {
    res.status(200).send('pong');
});
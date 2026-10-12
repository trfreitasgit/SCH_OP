require('dotenv').config();
var express = require('express');
var app = express();
var { Pool } = require('pg');
var cors = require('cors');

app.use(express.json());
app.use(cors());

var pool = new Pool({
    user: process.env.DB_USER || 'postgres',
    host: process.env.DB_HOST || 'localhost',
    database: process.env.DB_DATABASE || 'postgres',
    password: process.env.DB_PASSWORD,
    port: process.env.DB_PORT ? parseInt(process.env.DB_PORT, 10) : 5432,
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

app.get('/ordens', function (req, res) {
    pool.query('SELECT * FROM ordens_producao ORDER BY id DESC', function (erro, resultado) {
        if (erro) {
            return res.status(500).json({ erro: erro.message });
        }
        res.json(resultado.rows);
    });
});

app.get('/ordens/pendentes', function (req, res) {
    pool.query("SELECT * FROM ordens_producao WHERE situacao != 'Encerrado' ORDER BY coalesce(peso_prioridade, 99), id DESC", function (erro, resultado) {
        if (erro) {
            return res.status(500).json({ erro: erro.message });
        }
        res.json(resultado.rows);
    });
});

app.post('/ordens', function (req, res) {
    var numero_op = req.body.numero_op ? String(req.body.numero_op).trim() : null;
    var setor = req.body.setor ? String(req.body.setor).trim() : null;
    var total_pecas = parseInt(req.body.total_pecas, 10);
    var material = req.body.material !== undefined && req.body.material !== null ? String(req.body.material).trim() : null;
    var data_abertura = req.body.data_abertura ? String(req.body.data_abertura).trim() : null;
    var dia_analise = req.body.dia_analise ? String(req.body.dia_analise).trim() : null;
    var situacao = req.body.situacao ? String(req.body.situacao).trim() : 'Falta Pagar';
    var prioridade = req.body.prioridade ? String(req.body.prioridade).trim() : null;
    var observacao = req.body.observacao ? String(req.body.observacao).trim() : null;

    if (!numero_op) {
        return res.status(400).json({ erro: 'O número da OP é obrigatório.' });
    }

    if (isNaN(total_pecas) || total_pecas <= 0) {
        return res.status(400).json({ erro: 'O total de peças deve ser um número maior que zero.' });
    }

    // Regra dos materiais: máximo de 8 dígitos numéricos
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

    // Automação do dia_analise ao marcar Pago, caso não tenha sido preenchido manualmente
    if (situacao === 'Pago' && !dia_analise) {
        dia_analise = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });
    }

    pool.query(
        'INSERT INTO ordens_producao (numero_op, setor, total_pecas, material, data_abertura, dia_analise, situacao, prioridade, observacao, peso_prioridade) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING *',
        [numero_op, setor, total_pecas, material, data_abertura, dia_analise, situacao, prioridade, observacao, peso_prioridade],
        function (erro, resultado) {
            if (erro) {
                if (erro.code === '23505') {
                    return res.status(400).json({ erro: 'Número de OP já cadastrado. Deve ser único.' });
                }
                if (erro.code === '23514') {
                    return res.status(400).json({ erro: 'Dados inválidos para as regras da ordem.' });
                }
                return res.status(500).json({ erro: erro.message });
            }
            res.json({ mensagem: 'Ordem adicionada com sucesso', id: resultado.rows[0] });
        }
    );
});

// PUT /ordens/:id - Edição segura com whitelist de colunas e parametrização
app.put('/ordens/:id', async function (req, res) {
    var id = parseInt(req.params.id, 10);
    if (!id || isNaN(id)) {
        return res.status(400).json({ erro: 'ID inválido.' });
    }

    var updates = [];
    var values = [];
    var paramIndex = 1;

    // 1. Validação e inclusão de campos permitidos (Whitelist fixa)
    if (req.body.numero_op !== undefined) {
        var op = String(req.body.numero_op).trim();
        if (!op) {
            return res.status(400).json({ erro: 'O número da OP não pode ficar em branco.' });
        }
        updates.push(`numero_op = $${paramIndex++}`);
        values.push(op);
    }

    if (req.body.total_pecas !== undefined) {
        var total = parseInt(req.body.total_pecas, 10);
        if (isNaN(total) || total <= 0) {
            return res.status(400).json({ erro: 'O total de peças deve ser um número maior que zero.' });
        }
        updates.push(`total_pecas = $${paramIndex++}`);
        values.push(total);
    }

    if (req.body.data_abertura !== undefined) {
        var dataAber = req.body.data_abertura ? String(req.body.data_abertura).trim() : null;
        if (dataAber && isNaN(new Date(dataAber).getTime())) {
            return res.status(400).json({ erro: 'Data de abertura inválida.' });
        }
        updates.push(`data_abertura = $${paramIndex++}`);
        values.push(dataAber);
    }

    // Regra do material: máximo de 8 dígitos e numérico
    if (req.body.material !== undefined) {
        var mat = req.body.material !== null ? String(req.body.material).trim() : null;
        if (mat) {
            if (mat.length > 8 || !/^\d+$/.test(mat)) {
                return res.status(400).json({ erro: 'O material deve respeitar a regra de ser numérico com no máximo 8 dígitos.' });
            }
        }
        updates.push(`material = $${paramIndex++}`);
        values.push(mat);
    }

    if (req.body.setor !== undefined) {
        var setor = req.body.setor !== null ? String(req.body.setor).trim() : null;
        if (setor && !SETORES_VALIDOS.includes(setor)) {
            return res.status(400).json({ erro: 'Setor inválido. Opções válidas: ' + SETORES_VALIDOS.join(', ') });
        }
        updates.push(`setor = $${paramIndex++}`);
        values.push(setor);
    }

    if (req.body.observacao !== undefined) {
        var obs = req.body.observacao !== null ? String(req.body.observacao).trim() : null;
        updates.push(`observacao = $${paramIndex++}`);
        values.push(obs);
    }

    if (req.body.prioridade !== undefined) {
        var prio = req.body.prioridade !== null ? String(req.body.prioridade).trim() : null;
        if (prio && !PRIORIDADES_VALIDAS.includes(prio)) {
            return res.status(400).json({ erro: 'Prioridade inválida. Opções: ' + PRIORIDADES_VALIDAS.join(', ') });
        }
        updates.push(`prioridade = $${paramIndex++}`);
        values.push(prio || null);

        // Recalcula peso_prioridade quando a prioridade muda
        var peso = (prio && pesos[prio]) ? pesos[prio] : null;
        updates.push(`peso_prioridade = $${paramIndex++}`);
        values.push(peso);
    }

    // Ajuste permitido de dia_analise (manual ou automático)
    var diaAnaliseDefinido = false;
    if (req.body.dia_analise !== undefined) {
        var dataAna = req.body.dia_analise ? String(req.body.dia_analise).trim() : null;
        if (dataAna && isNaN(new Date(dataAna).getTime())) {
            return res.status(400).json({ erro: 'Dia de análise inválido.' });
        }
        updates.push(`dia_analise = $${paramIndex++}`);
        values.push(dataAna);
        diaAnaliseDefinido = true;
    }

    if (req.body.situacao !== undefined) {
        var sit = String(req.body.situacao).trim();
        if (!SITUACOES_VALIDAS.includes(sit)) {
            return res.status(400).json({ erro: 'Situação inválida. Opções: ' + SITUACOES_VALIDAS.join(', ') });
        }
        updates.push(`situacao = $${paramIndex++}`);
        values.push(sit);

        // Se o dia_analise não foi passado explicitamente nesta requisição, mantém a automação:
        // preenchido automaticamente com a data de hoje (America/Sao_Paulo) quando vira 'Pago', ou null caso contrário
        if (!diaAnaliseDefinido) {
            if (sit === 'Pago') {
                var hojeSP = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });
                updates.push(`dia_analise = $${paramIndex++}`);
                values.push(hojeSP);
            } else {
                updates.push(`dia_analise = $${paramIndex++}`);
                values.push(null);
            }
        }
    }

    if (updates.length === 0) {
        return res.status(400).json({ erro: 'Nenhum campo permitido enviado para atualização.' });
    }

    values.push(id);
    var queryText = `UPDATE ordens_producao SET ${updates.join(', ')} WHERE id = $${paramIndex} RETURNING *`;

    try {
        var resultado = await pool.query(queryText, values);
        if (resultado.rowCount === 0) {
            return res.status(404).json({ erro: 'Ordem não encontrada com ID ' + id });
        }
        res.json({ mensagem: 'Ordem atualizada com sucesso!', ordem: resultado.rows[0] });
    } catch (erro) {
        if (erro.code === '23505') {
            return res.status(400).json({ erro: 'Número de OP já cadastrado em outra ordem (deve ser único).' });
        }
        if (erro.code === '23514') {
            return res.status(400).json({ erro: 'Violação de regra no banco de dados (ex: total de peças > 0 ou prioridade válida).' });
        }
        res.status(500).json({ erro: erro.message });
    }
});

// DELETE /ordens/:id - Remoção individual
app.delete('/ordens/:id', function (req, res) {
    var id = parseInt(req.params.id, 10);
    if (!id || isNaN(id)) {
        return res.status(400).json({ erro: 'ID inválido.' });
    }

    pool.query('DELETE FROM ordens_producao WHERE id = $1 RETURNING id', [id], function (erro, resultado) {
        if (erro) {
            return res.status(500).json({ erro: erro.message });
        }
        if (resultado.rowCount === 0) {
            return res.status(404).json({ erro: 'Ordem não encontrada com ID ' + id });
        }
        res.json({ mensagem: 'Ordem removida com sucesso', id: id });
    });
});

// DELETE /ordens - Remoção em massa via lista de IDs
app.delete('/ordens', function (req, res) {
    var ids = req.body.ids;
    if (!Array.isArray(ids) || ids.length === 0) {
        return res.status(400).json({ erro: 'Lista de IDs para remoção inválida ou vazia.' });
    }

    pool.query('DELETE FROM ordens_producao WHERE id = ANY($1::int[]) RETURNING id', [ids], function (erro, resultado) {
        if (erro) {
            return res.status(500).json({ erro: erro.message });
        }
        res.json({ mensagem: 'Ordens removidas com sucesso', removidas: resultado.rowCount });
    });
});

var porta = process.env.PORT || 3000;
app.listen(porta, function () {
    console.log('Servidor no ar na porta ' + porta + '!');
});
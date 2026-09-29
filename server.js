var express = require ('express');
var app = express();
var { Pool } = require ('pg');
app.use(express.json());
var cors = require ('cors');
app.use(cors());

var pool = new Pool ({
    user: 'postgres',
    host: 'localhost',
    database: 'postgres',
    password: '13579200Tiago$$',
    port: 5432,
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

app.get('/ordens', function(req, res) {
    pool.query('SELECT * FROM ordens_producao', function (erro, resultado) {
        if (erro) {
            return res.status(500).json({ erro: erro.message});
        }
        res.json(resultado.rows);
    });
});

app.post('/ordens', function(req, res) {
    var numero_op = req.body.numero_op;
    var setor = req.body.setor;
    var total_pecas = req.body.total_pecas;
    var material = req.body.material;
    var data_abertura = req.body.data_abertura;
    var dia_analise = req.body.dia_analise;
    var situacao = req.body.situacao;
    var prioridade = req.body.prioridade;
    var observacao = req.body.observacao;
    var peso_prioridade = pesos[prioridade];

    pool.query('INSERT INTO ordens_producao (numero_op, setor, total_pecas, material, data_abertura, dia_analise, situacao, prioridade, observacao, peso_prioridade) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING *',
         [numero_op, setor, total_pecas, material, data_abertura, dia_analise, situacao, prioridade, observacao, peso_prioridade], function (erro, resultado) {
        if (erro) {
            return res.status(500).json({erro: erro.message});
        }
        res.json({ mensagem: 'Ordem adicionada com sucesso', id: resultado.rows[0] });
    });
});

app.put('/ordens/:id', function (req, res) { // por enquanto só altera a situação
    var id = req.params.id; // pega o número da url
    var situacao = req.body.situacao;
    var prioridade = req.body.prioridade
    var peso_prioridade = pesos[prioridade];

    pool.query('UPDATE ordens_producao SET situacao = $1, prioridade = $2, peso_prioridade = $3 WHERE id = $4', [situacao, prioridade, peso_prioridade, id], function (erro, resultado) {
        if (erro) {
            return res.status(500).json({erro: erro.message});
        }
        res.json({ mensagem: 'Ordem atualizada com sucesso!' });
    });
});

app.delete('/ordens/:id', function (req, res) {
    var id = req.params.id

    pool.query('DELETE FROM ordens_producao WHERE id = $1', [id], function (erro, resultado) {
        if (erro) {
            return res.status(500).json({ erro: erro.message });
        }
        res.json ({ mensagem: 'Ordem removida com sucesso'});
    });
});

app.get('/ordens/pendentes', function (req, res) {
    pool.query("SELECT * FROM ordens_producao WHERE situacao = 'Falta Pagar' ORDER BY peso_prioridade", function (erro, resultado) {
        if (erro) {
            return res.status(500).json({ erro: erro.message });
        }
        res.json(resultado.rows);
    });
});

app.listen(3000, function() {
    console.log('Servidor no ar!');
});
// Preload de teste: conta quantas vezes o servidor chama supabase.auth.getUser.
//
// Uso:  node -r ./tests/preload-contador-auth.js server.js
// Env:  AUTH_COUNT_FILE=<arquivo onde cada chamada vira uma linha>
//
// O gancho fica aqui (e nao no server.js) de proposito: o codigo de producao
// nao precisa de rota nem de flag de depuracao so para ser medido.

const fs = require('node:fs');
const supabaseJs = require('@supabase/supabase-js');

const arquivo = process.env.AUTH_COUNT_FILE;

if (arquivo) {
    const criarCliente = supabaseJs.createClient;

    supabaseJs.createClient = function () {
        const cliente = criarCliente.apply(this, arguments);
        const getUserOriginal = cliente.auth.getUser.bind(cliente.auth);

        cliente.auth.getUser = function () {
            fs.appendFileSync(arquivo, 'getUser\n');
            return getUserOriginal.apply(null, arguments);
        };

        return cliente;
    };
}

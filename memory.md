# ?? Memória de Projeto: Migração Supabase Auth

## ?? Objetivo Atual
Migrar a autenticação de um servidor customizado (uth-server.js) para o **Supabase Auth Nativo**, eliminando a complexidade de gestão de tokens manuais e aumentando a segurança.

## ??? Progresso da Migração

### ? Backend (Forge) - CONCLUÍDO
- [x] **Exclusão**: uth-server.js removido permanentemente.
- [x] **Refatoração server.js**:
    - Lógica de proxy /auth removida.
    - Middleware equireAuth atualizado para usar supabase.auth.getUser(token).
- [x] **Dependências**: jsonwebtoken e cryptjs removidos do package.json.
- [x] **Banco de Dados**: RLS (Row Level Security) verificado e ativo na tabela ordens_producao para a role uthenticated.

### ?? Frontend (Prism) - EM ANDAMENTO
- [x] **login.js**: Migrado com sucesso para supabase.auth.signInWithPassword.
- [ ] **ordens.js**: Pendente a remoção total da gestão de tokens via localStorage. 
    - *Tarefa:* Substituir getAccessToken() por supabase.auth.getSession().
    - *Tarefa:* Atualizar logout() para supabase.auth.signOut().

### ?? QA (Argos) - PENDENTE
- [ ] Testar fluxo completo: Login $\rightarrow$ Redirecionamento $\rightarrow$ Carga de Ordens.
- [ ] Validar expiração de sessão e redirecionamento para /login.

## ?? Detalhes Técnicos Importantes
- **Branch de Trabalho**: migration-supabase-auth
- **CORS/Render**: Implementados caminhos relativos no frontend para evitar erros de loopback/localhost em produção.
- **Auth Flow**: O frontend agora obtém o JWT via SDK do Supabase e o envia no header Authorization: Bearer <token> para o Gateway Node.js.

## ?? Próximos Passos (Amanhã)
1. Finalizar a refatoração do ordens.js (Prism).
2. Executar bateria de testes E2E (Argos).
3. Merge da branch de migração para a master após validação.


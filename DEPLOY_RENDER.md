# ?? Guia de Deploy - Schadek OP Dashboard (Render)

## ??? Configuração do Serviço no Render
Crie um novo **Web Service** conectado ao seu repositório Git.

### 1. Configurações Básicas
- **Runtime**: Node
- **Build Command**: 
pm install
- **Start Command**: 
pm run dev (ou 
ode server.js se combinarmos os processos)

> **Atenção:** Como o projeto usa dois servidores (Main e Auth), o comando 
pm run dev usa o concurrently para subir ambos. Certifique-se de que o concurrently está nas dependências de produção ou use um processo único.

### 2. Variáveis de Ambiente (Environment Variables)
Adicione as seguintes chaves no painel do Render:

| Variável | Descrição | Exemplo |
|----------|-----------|-----------|
| PORT | Porta exposta pelo Render | (Atribuída automaticamente) |
| SUPABASE_URL_ORDENS | URL do projeto de Ordens | https://xyz.supabase.co |
| SUPABASE_SERVICE_ROLE_KEY_ORDENS | Key de serviço do projeto de Ordens | eyJhb... |
| SUPABASE_URL_AUTH | URL do projeto de Auth | https://abc.supabase.co |
| SUPABASE_SERVICE_ROLE_KEY_AUTH | Key de serviço do projeto de Auth | sb_secret... |
| JWT_SECRET | Chave secreta para os tokens JWT | 64-chars-random-string |
| AUTH_PORT | Porta interna do Auth Server | 3001 |
| FRONTEND_URL | URL final do seu app no Render | https://schadek-op.onrender.com |
| AUTH_API_URL | URL interna do Auth Server | http://localhost:3001 |

### 3. Considerações Importantes
- **Portas**: O Render expõe apenas a porta definida em PORT. O server.js atua como proxy para o uth-server.js na porta 3001 interna, por isso a AUTH_API_URL deve apontar para localhost:3001.
- **Cookies**: Como o Render usa HTTPS, os cookies são definidos como secure: true automaticamente via process.env.NODE_ENV === 'production'.
- **Caminhos**: Todos os caminhos de arquivos foram convertidos para relativos (path.join(__dirname, ...)), garantindo compatibilidade com o Linux do Render.

---
*Gerado pelo Orquestrador para deploy simplificado.*

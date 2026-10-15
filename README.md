# ??? Industrial Production Dashboard
## High-Density Operations Control for PCP

![Version](https://img.shields.io/badge/version-4.9.0--PROD-orange) ![Status](https://img.shields.io/badge/status-Stable-green) ![Architecture](https://img.shields.io/badge/arch-Fullstack-blue)

Este sistema é uma solução de engenharia de software focada no controle de **Ordens de Produção (OPs)**. Ele foi projetado para ambientes industriais onde a precisão, a densidade de informação e a confiabilidade são inegociáveis. O objetivo é transformar dados brutos de produção em decisões operacionais rápidas.

---

## ?? A Filosofia: O 'Porquê' do Design

Diferente de dashboards corporativos genéricos, este sistema segue a escola do **Industrial High-Density Modernism**. Cada decisão de design tem um motivo técnico:

### ?? Dark Mode Operacional
**Por que?** Operadores e supervisores passam turnos inteiros olhando para telas. O fundo *Obsidian Dark* reduz drasticamente a fadiga ocular e aumenta o contraste de cores críticas.

### ?? Densidade de Dados Máxima
**Por que?** Em um ambiente de PCP, rolar a página excessivamente é perda de tempo. O layout é compactado para que o máximo de ordens seja visível em uma única tela, permitindo a visão sistêmica do fluxo fabril.

### ?? Semântica de Cores Instantânea
**Por que?** O cérebro humano processa cores antes de ler textos. 
- **Vermelho (Falta Pagar):** Alerta imediato de bloqueio financeiro.
- **Verde (Pago):** Fluxo liberado para produção.
- **Âmbar (Encerrado):** Processo finalizado.
A inclusão de 'bolinhas' (dots) ao lado das labels serve como guia visual rápido para escaneamento vertical.

### ?? Tipografia Técnica
**Por que?** Utilizamos fontes monoespaçadas (JetBrains Mono) para números de OP e códigos de material. Isso garante que cada dígito ocupe o mesmo espaço, evitando erros de leitura em listas extensas.

---

## ?? Como Funciona (A Arquitetura)

O sistema opera sob uma arquitetura de micro-serviços simplificada para garantir segurança e performance:

### 1. Camada de Interface (Frontend)
Desenvolvida em **Vanilla JS**, evitando a sobrecarga de frameworks pesados para garantir que o dashboard carregue instantaneamente, mesmo em redes industriais instáveis.

### 2. Orquestração de Backend (API Gateway)
Um servidor **Node.js/Express** atua como ponte entre a interface e o banco de dados, aplicando regras de negócio (como o cálculo automático de peso_prioridade e dia_analise).

### 3. Segurança de Identidade (Auth Server)
Um servidor de autenticação isolado gerencia:
- **JWT (JSON Web Tokens):** Tokens de acesso curtos para sessões seguras.
- **Refresh Tokens:** Armazenados em cookies HttpOnly para manter o usuário conectado sem comprometer a segurança.

### 4. Persistência de Dados (Supabase/PostgreSQL)
Utiliza a potência do **PostgreSQL** com políticas de **RLS (Row Level Security)**, garantindo que os dados sejam acessados apenas por roles autorizadas.

---

## ?? Funcionalidades Chave

- **Importação em Massa:** Validação rigorosa de dígitos para evitar erros de entrada de dados vindo de ERPs ou planilhas.
- **Priorização Inteligente:** Organização automática de ordens baseada em listas de urgência (Crítica, Comercial, Padrão).
- **Edição em Tempo Real:** Alterações inline que atualizam o banco de dados e a interface instantaneamente.
- **Filtros Segmentados:** Divisão por setores produtivos para foco total em cada etapa da linha.

---

## ??? Stack Técnica

| Componente | Tecnologia |
|------------|------------|
| **Frontend** | HTML5, CSS3 (TailLwind), Vanilla JS |
| **Backend** | Node.js, Express |
| **Banco de Dados** | PostgreSQL via Supabase |
| **Auth** | JWT & Bcryptjs |
| **Infra** | Render (Cloud Hosting) |

---

## ?? Instalação Rápida

1. **Clone e Instale:**
   `ash
   git clone https://github.com/seu-usuario/industrial-production-dashboard.git
   npm install
   `

2. **Configure o .env:**
   Utilize o .env.example para configurar as chaves do Supabase e o segredo do JWT.

3. **Execute:**
   `ash
   npm run dev
   `

---

## ?? Deploy

Para instruções de subida para o ambiente de produção, consulte o arquivo DEPLOY_RENDER.md.

**Industrial Dashboard** $\mid$ *Efficiency through precision.*

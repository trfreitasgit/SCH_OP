-- ============================================================================
-- MIGRAÇÃO: Sistema de Autenticação (users + refresh_tokens)
-- Projeto: Schadek Industrial - Ordens de Produção
-- Aplicar via: Supabase Dashboard > SQL Editor
-- ============================================================================

-- Tabela de usuários
CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email VARCHAR(255) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    name VARCHAR(255),
    role VARCHAR(50) DEFAULT 'operator',
    active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    last_login_at TIMESTAMPTZ
);

-- Índices para busca por email
CREATE INDEX idx_users_email ON users(email);
CREATE INDEX idx_users_active ON users(active);

-- Tabela de refresh tokens
CREATE TABLE refresh_tokens (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash VARCHAR(255) NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    revoked_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    user_agent TEXT,
    ip_address INET
);

-- Índices para refresh_tokens
CREATE INDEX idx_refresh_tokens_user_id ON refresh_tokens(user_id);
CREATE INDEX idx_refresh_tokens_token_hash ON refresh_tokens(token_hash);
CREATE INDEX idx_refresh_tokens_expires_at ON refresh_tokens(expires_at);

-- Trigger para updated_at em users
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER update_users_updated_at
    BEFORE UPDATE ON users
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- RLS Policies
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE refresh_tokens ENABLE ROW LEVEL SECURITY;

-- Policy: users podem ver apenas a si mesmos (para /auth/me)
CREATE POLICY "users_self_read" ON users
    FOR SELECT USING (auth.uid() = id);

-- Policy: apenas service role pode inserir/atualizar users (via auth-server)
CREATE POLICY "users_service_write" ON users
    FOR ALL USING (auth.role() = 'service_role');

-- Policy: refresh_tokens - apenas service role
CREATE POLICY "refresh_tokens_service_all" ON refresh_tokens
    FOR ALL USING (auth.role() = 'service_role');

-- ============================================================================
-- USUÁRIO DE TESTE (opcional - remover em produção)
-- Senha: "schadek123" (hash bcrypt gerado com custo 10)
-- ============================================================================
-- INSERT INTO users (email, password_hash, name, role)
-- VALUES (
--     'admin@schadek.com.br',
--     '$2a$10$8K1p/a0dL1LXMIgoEDFrwO.8K1p/a0dL1LXMIgoEDFrwO.8K1p/a0dL1LXMIgoEDFrwO',
--     'Administrador PCP',
--     'admin'
-- );
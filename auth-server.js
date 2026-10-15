require('dotenv').config();
const express = require('express');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { createClient } = require('@supabase/supabase-js');

const app = express();
const PORT = process.env.AUTH_PORT || 3001;

const supabaseUrl = process.env.SUPABASE_URL_AUTH || process.env.SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY_AUTH || process.env.SUPABASE_SERVICE_ROLE_KEY;
const jwtSecret = process.env.JWT_SECRET;
const jwtExpiresIn = '15m';
const refreshTokenDays = 7;

if (!supabaseUrl || !supabaseServiceKey || !jwtSecret) {
    console.error('❌ Variáveis de ambiente obrigatórias faltando:');
    console.error('   SUPABASE_URL_AUTH, SUPABASE_SERVICE_ROLE_KEY_AUTH, JWT_SECRET');
    process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseServiceKey, {
    auth: { persistSession: false }
});

app.use(cors({
    origin: process.env.FRONTEND_URL || 'http://localhost:3000',
    credentials: true
}));
app.use(express.json());
app.use(cookieParser());

function generateAccessToken(user) {
    return jwt.sign(
        { sub: user.id, email: user.email, role: user.role, name: user.name },
        jwtSecret,
        { expiresIn: jwtExpiresIn }
    );
}

function generateRefreshToken() {
    return require('crypto').randomBytes(64).toString('hex');
}

async function hashToken(token) {
    return bcrypt.hash(token, 10);
}

async function verifyTokenHash(token, hash) {
    return bcrypt.compare(token, hash);
}

function setRefreshTokenCookie(res, token) {
    res.cookie('refresh_token', token, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        maxAge: refreshTokenDays * 24 * 60 * 60 * 1000,
        path: '/'
    });
}

function setAccessTokenCookie(res, token) {
    res.cookie('access_token', token, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        maxAge: 15 * 60 * 1000,
        path: '/'
    });
}

function clearAccessTokenCookie(res) {
    res.clearCookie('access_token', {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        path: '/'
    });
}

function clearRefreshTokenCookie(res) {
    res.clearCookie('refresh_token', {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        path: '/'
    });
}

async function storeRefreshToken(userId, token, req) {
    const tokenHash = await hashToken(token);
    const expiresAt = new Date(Date.now() + refreshTokenDays * 24 * 60 * 60 * 1000);
    const { error } = await supabase
        .from('refresh_tokens')
        .insert({
            user_id: userId,
            token_hash: tokenHash,
            expires_at: expiresAt.toISOString(),
            user_agent: req.headers['user-agent'] || null,
            ip_address: req.ip || req.connection?.remoteAddress || null
        });
    if (error) throw error;
}

async function revokeRefreshToken(token) {
    const tokenHash = await hashToken(token);
    const { error } = await supabase
        .from('refresh_tokens')
        .update({ revoked_at: new Date().toISOString() })
        .eq('token_hash', tokenHash);
    if (error) throw error;
}

async function revokeAllUserTokens(userId) {
    const { error } = await supabase
        .from('refresh_tokens')
        .update({ revoked_at: new Date().toISOString() })
        .eq('user_id', userId)
        .is('revoked_at', null);
    if (error) throw error;
}

async function validateRefreshToken(token) {
    const tokenHash = await hashToken(token);
    const { data, error } = await supabase
        .from('refresh_tokens')
        .select('id, user_id, expires_at, revoked_at')
        .eq('token_hash', tokenHash)
        .is('revoked_at', null)
        .single();
    if (error || !data) return null;
    if (new Date(data.expires_at) < new Date()) return null;
    return data;
}

async function getUserById(userId) {
    const { data, error } = await supabase
        .from('users')
        .select('id, email, name, role, active')
        .eq('id', userId)
        .eq('active', true)
        .single();
    if (error || !data) return null;
    return data;
}

async function getUserByEmail(email) {
    const { data, error } = await supabase
        .from('users')
        .select('id, email, password_hash, name, role, active')
        .eq('email', email)
        .eq('active', true)
        .single();
    if (error || !data) return null;
    return data;
}

async function updateLastLogin(userId) {
    await supabase
        .from('users')
        .update({ last_login_at: new Date().toISOString() })
        .eq('id', userId);
}

function verifyAccessToken(token) {
    try {
        return jwt.verify(token, jwtSecret);
    } catch {
        return null;
    }
}

function authMiddleware(req, res, next) {
    const authHeader = req.headers.authorization;
    const cookieToken = req.cookies?.access_token;
    const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : cookieToken;

    if (!token) {
        return res.status(401).json({ error: 'Token de acesso não fornecido' });
    }

    const decoded = verifyAccessToken(token);
    if (!decoded) {
        return res.status(401).json({ error: 'Token inválido ou expirado' });
    }

    req.user = decoded;
    next();
}

app.post('/auth/login', async (req, res) => {
    try {
        const { email, password } = req.body;

        if (!email || !password) {
            return res.status(400).json({ error: 'Email e senha são obrigatórios' });
        }

        const user = await getUserByEmail(email);
        if (!user) {
            return res.status(401).json({ error: 'Credenciais inválidas' });
        }

        const validPassword = await bcrypt.compare(password, user.password_hash);
        if (!validPassword) {
            return res.status(401).json({ error: 'Credenciais inválidas' });
        }

        const accessToken = generateAccessToken(user);
        const refreshToken = generateRefreshToken();

        await storeRefreshToken(user.id, refreshToken, req);
        await updateLastLogin(user.id);

        setRefreshTokenCookie(res, refreshToken);

        res.cookie('access_token', accessToken, {
            httpOnly: true,
            secure: process.env.NODE_ENV === 'production',
            sameSite: 'lax',
            maxAge: 15 * 60 * 1000,
            path: '/'
        });

        res.json({
            access_token: accessToken,
            token_type: 'Bearer',
            expires_in: 15 * 60,
            user: {
                id: user.id,
                email: user.email,
                name: user.name,
                role: user.role
            }
        });
    } catch (error) {
        console.error('Login error:', error);
        res.status(500).json({ error: 'Erro interno do servidor' });
    }
});

app.post('/auth/refresh', async (req, res) => {
    try {
        const refreshToken = req.cookies?.refresh_token;
        if (!refreshToken) {
            return res.status(401).json({ error: 'Refresh token não fornecido' });
        }

        const tokenData = await validateRefreshToken(refreshToken);
        if (!tokenData) {
            clearRefreshTokenCookie(res);
            return res.status(401).json({ error: 'Refresh token inválido ou expirado' });
        }

        const user = await getUserById(tokenData.user_id);
        if (!user) {
            clearRefreshTokenCookie(res);
            return res.status(401).json({ error: 'Usuário não encontrado' });
        }

        await revokeRefreshToken(refreshToken);

        const newAccessToken = generateAccessToken(user);
        const newRefreshToken = generateRefreshToken();

        await storeRefreshToken(user.id, newRefreshToken, req);
        setRefreshTokenCookie(res, newRefreshToken);
        setAccessTokenCookie(res, newAccessToken);

        res.json({
            access_token: newAccessToken,
            token_type: 'Bearer',
            expires_in: 15 * 60,
            user: {
                id: user.id,
                email: user.email,
                name: user.name,
                role: user.role
            }
        });
    } catch (error) {
        console.error('Refresh error:', error);
        res.status(500).json({ error: 'Erro interno do servidor' });
    }
});

app.post('/auth/logout', async (req, res) => {
    try {
        const refreshToken = req.cookies?.refresh_token;
        if (refreshToken) {
            await revokeRefreshToken(refreshToken);
        }
        clearRefreshTokenCookie(res);
        clearAccessTokenCookie(res);
        res.json({ message: 'Logout realizado com sucesso' });
    } catch (error) {
        console.error('Logout error:', error);
        res.status(500).json({ error: 'Erro interno do servidor' });
    }
});

app.get('/auth/me', authMiddleware, async (req, res) => {
    try {
        const user = await getUserById(req.user.sub);
        if (!user) {
            return res.status(404).json({ error: 'Usuário não encontrado' });
        }
        res.json({
            id: user.id,
            email: user.email,
            name: user.name,
            role: user.role
        });
    } catch (error) {
        console.error('Me error:', error);
        res.status(500).json({ error: 'Erro interno do servidor' });
    }
});

app.post('/auth/revoke-all', authMiddleware, async (req, res) => {
    try {
        await revokeAllUserTokens(req.user.sub);
        clearRefreshTokenCookie(res);
        res.json({ message: 'Todas as sessões revogadas' });
    } catch (error) {
        console.error('Revoke-all error:', error);
        res.status(500).json({ error: 'Erro interno do servidor' });
    }
});

app.get('/health', (req, res) => {
    res.json({ status: 'ok', service: 'auth-server', timestamp: new Date().toISOString() });
});

app.listen(PORT, () => {
    console.log(`🔐 Auth Server rodando na porta ${PORT}`);
    console.log(`   Health: http://localhost:${PORT}/health`);
    console.log(`   Login:  POST http://localhost:${PORT}/auth/login`);
    console.log(`   Me:     GET  http://localhost:${PORT}/auth/me`);
});
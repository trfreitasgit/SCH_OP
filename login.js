const AUTH_API_URL = '';

// Auth token management
function getAccessToken() {
    return localStorage.getItem('access_token') || sessionStorage.getItem('access_token');
}

function setAccessToken(token) {
    localStorage.setItem('access_token', token);
}

function clearAccessToken() {
    localStorage.removeItem('access_token');
    sessionStorage.removeItem('access_token');
}

function initTheme() {
    const savedTheme = localStorage.getItem('theme');
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    const isDark = savedTheme ? savedTheme === 'dark' : prefersDark;
    document.documentElement.classList.toggle('dark', isDark);
    updateThemeUI(isDark);
}

function updateThemeUI(isDark) {
    const sunIcon = document.getElementById('sunIcon');
    const moonIcon = document.getElementById('moonIcon');
    const themeToggleText = document.getElementById('themeToggleText');
    if (isDark) {
        sunIcon?.classList.remove('hidden');
        moonIcon?.classList.add('hidden');
        if (themeToggleText) themeToggleText.textContent = 'Modo Escuro';
    } else {
        sunIcon?.classList.add('hidden');
        moonIcon?.classList.remove('hidden');
        if (themeToggleText) themeToggleText.textContent = 'Modo Claro';
    }
}

function showFeedback(message, type) {
    const loginFeedback = document.getElementById('loginFeedback');
    if (!loginFeedback) return;
    loginFeedback.classList.remove('hidden', 'bg-red-950/60', 'text-red-300', 'border-red-600/40', 'bg-emerald-950/60', 'text-emerald-300', 'border-emerald-600/40', 'bg-sky-950/60', 'text-sky-300', 'border-sky-600/40');
    loginFeedback.classList.add('border');

    if (type === 'error') {
        loginFeedback.classList.add('bg-red-950/60', 'text-red-300', 'border-red-600/40');
    } else if (type === 'success') {
        loginFeedback.classList.add('bg-emerald-950/60', 'text-emerald-300', 'border-emerald-600/40');
    } else {
        loginFeedback.classList.add('bg-sky-950/60', 'text-sky-300', 'border-sky-600/40');
    }

    loginFeedback.textContent = message;
}

function setLoadingState(loading) {
    const submitBtn = document.getElementById('submitLoginBtn');
    if (!submitBtn) return;
    if (loading) {
        submitBtn.disabled = true;
        submitBtn.classList.add('opacity-75', 'cursor-wait');
        submitBtn.innerHTML = `
            <svg class="animate-spin -ml-1 mr-2 h-4 w-4 text-white" fill="none" viewBox="0 0 24 24">
                <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
                <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
            </svg>
            Validando credenciais...
        `;
    } else {
        submitBtn.disabled = false;
        submitBtn.classList.remove('opacity-75', 'cursor-wait');
        submitBtn.innerHTML = `
            <span class="tracking-wide">Entrar no Sistema</span>
            <svg class="w-4 h-4 transform group-hover:translate-x-1 transition-transform" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M14 5l7 7m0 0l-7 7m7-7H3"></path>
            </svg>
        `;
    }
}

async function handleLogin(event) {
    console.log('[DEBUG] handleLogin called');
    event.preventDefault();

    const userIdentifier = document.getElementById('userIdentifier');
    const userPassword = document.getElementById('userPassword');
    const identifier = userIdentifier?.value?.trim();
    const password = userPassword?.value;

    console.log('[DEBUG] identifier:', identifier, 'password length:', password?.length);

    if (!identifier || !password) {
        showFeedback('Por favor, informe o e-mail e a senha.', 'error');
        return;
    }

    setLoadingState(true);
    showFeedback('', 'info');
    const loginFeedback = document.getElementById('loginFeedback');
    if (loginFeedback) loginFeedback.classList.add('hidden');

    try {
        console.log('[DEBUG] Sending login request...');
        const response = await fetch('/auth/login', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            credentials: 'include',
            body: JSON.stringify({ email: identifier, password })
        });

        console.log('[DEBUG] Response status:', response.status);
        const data = await response.json();
        console.log('[DEBUG] Response data:', data);

        if (!response.ok) {
            throw new Error(data.error || 'Erro na autenticação');
        }

        setAccessToken(data.access_token);

        showFeedback('Autenticado com sucesso! Redirecionando...', 'success');

        const rememberTerminal = document.getElementById('rememberTerminal');
        if (rememberTerminal?.checked) {
            localStorage.setItem('remember_session', 'true');
        } else {
            localStorage.removeItem('remember_session');
        }

        console.log('[DEBUG] Redirecting to /');
        window.location.href = '/';

    } catch (error) {
        console.error('Login error:', error);
        showFeedback(error.message || 'Falha na autenticação. Tente novamente.', 'error');
    } finally {
        setLoadingState(false);
    }
}

document.addEventListener('DOMContentLoaded', () => {
    console.log('[DEBUG] DOMContentLoaded - initializing login page');

    // Elements
    const togglePasswordBtn = document.getElementById('togglePasswordBtn');
    const togglePasswordLabel = document.getElementById('togglePasswordLabel');
    const userPasswordInput = document.getElementById('userPassword');
    const themeToggleBtn = document.getElementById('themeToggleBtn');
    const themeToggleText = document.getElementById('themeToggleText');
    const sunIcon = document.getElementById('sunIcon');
    const moonIcon = document.getElementById('moonIcon');
    const forgotPassword = document.getElementById('forgotPassword');
    const loginForm = document.getElementById('industrialLoginForm');

    console.log('[DEBUG] Elements found:', {
        togglePasswordBtn: !!togglePasswordBtn,
        userPasswordInput: !!userPasswordInput,
        themeToggleBtn: !!themeToggleBtn,
        forgotPassword: !!forgotPassword,
        loginForm: !!loginForm
    });

    // Theme toggle
    if (themeToggleBtn) {
        themeToggleBtn.addEventListener('click', () => {
            const isDark = document.documentElement.classList.toggle('dark');
            localStorage.setItem('theme', isDark ? 'dark' : 'light');
            updateThemeUI(isDark);
        });
    }

    // Password toggle
    if (togglePasswordBtn && userPasswordInput && togglePasswordLabel) {
        togglePasswordBtn.addEventListener('click', () => {
            const isPassword = userPasswordInput.getAttribute('type') === 'password';
            userPasswordInput.setAttribute('type', isPassword ? 'text' : 'password');
            togglePasswordLabel.textContent = isPassword ? 'Ocultar' : 'Mostrar';
        });
    }

    // Forgot password
    if (forgotPassword) {
        forgotPassword.addEventListener('click', (e) => {
            e.preventDefault();
            showFeedback('Para redefinir sua credencial, contate a Central de TI (ramal 3000) ou abra chamado no ServiceDesk interno.', 'info');
        });
    }

    // Login form submit
    if (loginForm) {
        loginForm.addEventListener('submit', (e) => {
            console.log('[DEBUG] Form submit event fired');
            handleLogin(e);
        });
        console.log('[DEBUG] Login form submit listener attached');
    } else {
        console.error('[ERROR] loginForm not found!');
    }

    // Init theme
    initTheme();
    console.log('[DEBUG] Login page initialized');
});
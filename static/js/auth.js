/**
 * Auth — login com usuário/senha do administrador.
 * O token de sessão fica em localStorage e é enviado via `Authorization: Bearer`.
 */
const AUTH = (() => {
    const TOKEN_KEY = 'panel_token';

    function getToken() { return localStorage.getItem(TOKEN_KEY) || ''; }
    function setToken(t) { localStorage.setItem(TOKEN_KEY, t); }
    function clearToken() { localStorage.removeItem(TOKEN_KEY); }

    async function fetchStatus() {
        try {
            const res = await fetch('/api/auth/status');
            return res.ok ? await res.json() : null;
        } catch (e) {
            return null;
        }
    }

    async function login(username, password) {
        const res = await fetch('/api/auth/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, password }),
        });
        if (res.status === 409) {
            const err = new Error('admin_nao_configurado');
            err.code = 'admin_nao_configurado';
            throw err;
        }
        if (!res.ok) throw new Error('Usuário ou senha inválidos');
        const data = await res.json();
        setToken(data.token);
        hideLogin();
        window.dispatchEvent(new CustomEvent('auth:logged-in', { detail: { username: data.username } }));
        return data;
    }

    function logout() {
        clearToken();
        showLogin();
        window.dispatchEvent(new CustomEvent('auth:logged-out'));
    }

    function isLoggedIn() { return !!getToken(); }

    function showLogin() {
        const overlay = document.getElementById('auth-overlay');
        if (overlay) overlay.classList.remove('hidden');
        refreshSetupHint();
    }

    function hideLogin() {
        const overlay = document.getElementById('auth-overlay');
        if (overlay) overlay.classList.add('hidden');
    }

    function requireLogin() {
        if (!isLoggedIn()) showLogin();
    }

    async function refreshSetupHint() {
        const hint = document.getElementById('auth-setup-hint');
        if (!hint) return;
        const st = await fetchStatus();
        const missing = st && !st.admin_configured;
        hint.classList.toggle('hidden', !missing);
    }

    function init() {
        const form = document.getElementById('auth-form');
        if (form) {
            form.addEventListener('submit', async (e) => {
                e.preventDefault();
                const user = document.getElementById('auth-username-input');
                const pass = document.getElementById('auth-password-input');
                const status = document.getElementById('auth-status');
                try {
                    await login(user.value.trim(), pass.value);
                    if (status) status.textContent = '';
                } catch (err) {
                    if (status) status.textContent =
                        err.code === 'admin_nao_configurado'
                            ? 'Administrador não configurado — crie em Configurações → Segurança.'
                            : (err.message || 'Falha no login');
                }
            });
        }
        const logoutBtn = document.getElementById('auth-logout');
        if (logoutBtn) logoutBtn.addEventListener('click', logout);

        // Sessão legada (token antigo) sem admin configurado continua valendo;
        // com admin configurado, exige login.
        fetchStatus().then((st) => {
            if (st && st.admin_configured && !isLoggedIn()) showLogin();
            else if (!isLoggedIn()) showLogin();
        });
    }

    return { getToken, setToken, login, logout, isLoggedIn, showLogin, hideLogin, requireLogin, fetchStatus, init };
})();

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

    async function login(username, password, token) {
        const body = token ? { token } : { username, password };
        const res = await fetch('/api/auth/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
        });
        if (res.status === 409) {
            const err = new Error('admin_nao_configurado');
            err.code = 'admin_nao_configurado';
            throw err;
        }
        if (res.status === 429) {
            let msg = 'Muitas tentativas — aguarde alguns minutos';
            try {
                const data = await res.json();
                if (data && data.detail) msg = data.detail;
            } catch (e) {}
            throw new Error(msg);
        }
        if (!res.ok) {
            let msg = 'Credenciais inválidas';
            try {
                const data = await res.json();
                if (data && data.detail) msg = data.detail;
            } catch (e) {}
            throw new Error(msg);
        }
        const data = await res.json();
        setToken(data.token);
        hideLogin();
        window.dispatchEvent(new CustomEvent('auth:logged-in', { detail: { username: data.username } }));
        return data;
    }

    async function logout() {
        const t = getToken();
        if (t) {
            try {
                await fetch('/api/auth/logout', {
                    method: 'POST',
                    headers: { 'Authorization': 'Bearer ' + t }
                });
            } catch (e) {}
        }
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
        const modeLink = document.getElementById('auth-mode-toggle');
        if (!hint) return;
        const st = await fetchStatus();
        const missing = st && !st.admin_configured;
        hint.classList.toggle('hidden', !missing);
        if (modeLink) {
            modeLink.classList.toggle('hidden', !missing);
            modeLink.textContent = mode === 'token' ? 'usar usuário e senha' : 'usar token de acesso';
        }
        if (!missing && mode === 'token') setMode('admin');
    }

    let mode = 'admin'; // 'admin' | 'token'

    function setMode(m) {
        mode = m;
        const user = document.getElementById('auth-username-input');
        const pass = document.getElementById('auth-password-input');
        const tok = document.getElementById('auth-token-input');
        const link = document.getElementById('auth-mode-toggle');
        const isToken = m === 'token';
        if (user) user.classList.toggle('hidden', isToken);
        if (pass) pass.classList.toggle('hidden', isToken);
        if (user) user.required = !isToken;
        if (pass) pass.required = !isToken;
        if (tok) tok.classList.toggle('hidden', !isToken);
        if (tok) tok.required = isToken;
        if (link) link.textContent = isToken ? 'usar usuário e senha' : 'usar token de acesso';
    }

    function init() {
        const form = document.getElementById('auth-form');
        if (form) {
            form.addEventListener('submit', async (e) => {
                e.preventDefault();
                const user = document.getElementById('auth-username-input');
                const pass = document.getElementById('auth-password-input');
                const tok = document.getElementById('auth-token-input');
                const status = document.getElementById('auth-status');
                try {
                    if (mode === 'token') {
                        await login(null, null, tok.value.trim());
                    } else {
                        await login(user.value.trim(), pass.value);
                    }
                    if (status) status.textContent = '';
                } catch (err) {
                    if (status) status.textContent =
                        err.code === 'admin_nao_configurado'
                            ? 'Sem administrador configurado — use o token de acesso abaixo.'
                            : (err.message || 'Falha no login');
                }
            });
            const modeLink = document.getElementById('auth-mode-toggle');
            if (modeLink) {
                modeLink.addEventListener('click', (e) => {
                    e.preventDefault();
                    setMode(mode === 'token' ? 'admin' : 'token');
                    const status = document.getElementById('auth-status');
                    if (status) status.textContent = '';
                });
            }
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

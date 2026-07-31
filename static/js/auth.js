/**
 * Auth — login por token compartilhado do painel.
 * Token fica em localStorage e é enviado via header `Authorization: Bearer`.
 */
const AUTH = (() => {
    const TOKEN_KEY = 'panel_token';

    function getToken() { return localStorage.getItem(TOKEN_KEY) || ''; }
    function setToken(t) { localStorage.setItem(TOKEN_KEY, t); }
    function clearToken() { localStorage.removeItem(TOKEN_KEY); }

    async function login(token) {
        const res = await fetch('/api/auth/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ token }),
        });
        if (!res.ok) throw new Error('Token inválido');
        setToken(token);
        hideLogin();
        window.dispatchEvent(new CustomEvent('auth:logged-in'));
        return true;
    }

    function logout() {
        clearToken();
        showLogin();
        window.dispatchEvent(new CustomEvent('auth:logged-out'));
    }

    function isLoggedIn() {
        return !!getToken();
    }

    function showLogin() {
        const overlay = document.getElementById('auth-overlay');
        if (overlay) overlay.classList.remove('hidden');
    }

    function hideLogin() {
        const overlay = document.getElementById('auth-overlay');
        if (overlay) overlay.classList.add('hidden');
    }

    function requireLogin() {
        if (!isLoggedIn()) showLogin();
    }

    function init() {
        const form = document.getElementById('auth-form');
        if (form) {
            form.addEventListener('submit', async (e) => {
                e.preventDefault();
                const input = document.getElementById('auth-token-input');
                const status = document.getElementById('auth-status');
                try {
                    await login(input.value.trim());
                    if (status) status.textContent = '';
                } catch (err) {
                    if (status) status.textContent = err.message || 'Falha no login';
                }
            });
        }
        const logoutBtn = document.getElementById('auth-logout');
        if (logoutBtn) logoutBtn.addEventListener('click', logout);

        if (!isLoggedIn()) showLogin();
    }

    return { getToken, setToken, login, logout, isLoggedIn, showLogin, hideLogin, requireLogin, init };
})();

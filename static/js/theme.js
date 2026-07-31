/**
 * Theme — tema claro/escuro/sistema com persistência e sync entre abas.
 * Lê localStorage['panel_theme'] (dark|light|system) ou prefers-color-scheme.
 */
const THEME = (() => {
    const KEY = 'panel_theme';

    function resolve(choice) {
        if (choice === 'dark' || choice === 'light') return choice;
        // 'system' ou ausente → segue o SO
        return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
    }

    function getStored() {
        return localStorage.getItem(KEY) || 'system';
    }

    function apply(choice) {
        const theme = resolve(choice);
        document.documentElement.setAttribute('data-theme', theme);
        updateButtonIcon(theme);
        // Dispara para quem quiser reagir (ex.: sparklines)
        document.dispatchEvent(new CustomEvent('theme:change', { detail: { theme, choice } }));
    }

    function toggle() {
        const next = resolve(getStored()) === 'dark' ? 'light' : 'dark';
        localStorage.setItem(KEY, next);
        apply(next);
    }

    function cycle() {
        // dark → light → system (usado pelo Settings)
        const order = ['dark', 'light', 'system'];
        const cur = getStored();
        const next = order[(order.indexOf(cur) + 1) % order.length];
        localStorage.setItem(KEY, next);
        apply(next);
        return next;
    }

    function updateButtonIcon(theme) {
        const btn = document.getElementById('theme-toggle');
        if (!btn) return;
        const icon = theme === 'dark' ? 'sun' : 'moon';
        const svg = (typeof UI !== 'undefined' && UI.icon) ? UI.icon(icon) : '';
        btn.innerHTML = svg || (theme === 'dark' ? '☀' : '☾');
        btn.setAttribute('aria-label', theme === 'dark' ? 'Ativar tema claro' : 'Ativar tema escuro');
        btn.title = theme === 'dark' ? 'Tema claro' : 'Tema escuro';
    }

    function init() {
        // Aplica o tema salvo (o anti-flash do <head> já aplicou um provisório)
        apply(getStored());

        const btn = document.getElementById('theme-toggle');
        if (btn) btn.addEventListener('click', toggle);

        // Sync entre abas
        window.addEventListener('storage', (e) => {
            if (e.key === KEY) apply(e.newValue || 'system');
        });
        // Segue mudanças do SO quando em "system"
        window.matchMedia('(prefers-color-scheme: light)').addEventListener('change', () => {
            if (getStored() === 'system') apply('system');
        });
    }

    return { init, toggle, cycle, apply, getStored, resolve };
})();

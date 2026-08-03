/**
 * App Router — navegação hash-based + sidebar + wizard check.
 */
const APP = (() => {
    let activeView = null;
    let initialized = false;

    const routes = {
        '/': DASHBOARD,
        '/wizard': { render: WIZARD.render },
        '/devices': { render: DEVICES.render },
        '/device': null, // dinâmico: /device/{id}
        '/groups': { render: GROUPS.render },
        '/mediamtx': { render: MEDIAMTX.render },
        '/logs': { render: LOGS.render },
        '/scrcpy': { render: SCRCPY.render },
        '/shell': { render: SHELL_PAGE.render },
        '/backup': { render: BACKUP.render },
        '/settings': { render: SETTINGS.render },
    };

    function init() {
        // Sidebar toggle
        const toggleBtn = document.getElementById('sidebar-toggle');
        const sidebar = document.getElementById('sidebar');
        if (toggleBtn && sidebar) {
            toggleBtn.addEventListener('click', () => {
                sidebar.classList.toggle('collapsed');
            });
        }

        // Navegação hash
        window.addEventListener('hashchange', navigate);

        // Boot: check wizard first, then navigate
        checkWizard().then(navigate);
    }

    async function checkWizard() {
        try {
            const { completed, devices_count } = await API.get('/system/wizard-status');
            const hash = window.location.hash.replace('#', '') || '/';

            // Se wizard não completo e não está no wizard → redireciona
            if (!completed && hash !== '/wizard') {
                window.location.hash = '#/wizard';
                return false;
            }
            // Wizard pode ser re-executado a qualquer momento (não redireciona)
            return completed;
        } catch (e) {
            console.error('Wizard check failed:', e);
            if (e.status === 401 && typeof AUTH !== 'undefined') {
                AUTH.requireLogin();
            }
            return true;
        }
    }

    function navigate() {
        const hash = window.location.hash.replace('#', '') || '/';
        const container = document.getElementById('view-container');
        if (!container) return;

        if (activeView && typeof activeView.destroy === 'function') {
            activeView.destroy();
        }

        // Match rotas exatas
        let handler = routes[hash];

        // Match /device/{id}
        if (!handler && hash.startsWith('/device/')) {
            const deviceId = hash.replace('/device/', '');
            handler = {
                render: (el) => {
                    // Chama render da device page com o ID
                    if (DEVICE_PAGE && DEVICE_PAGE.render) {
                        DEVICE_PAGE.render(el, deviceId);
                    } else {
                        el.innerHTML = `<div class="loading">Carregando device ${escapeHtml(deviceId)}...</div>`;
                    }
                },
                destroy: () => { if (DEVICE_PAGE && DEVICE_PAGE.destroy) DEVICE_PAGE.destroy(); }
            };
        }

        // Match /group/{id}
        if (!handler && hash.startsWith('/group/')) {
            const groupId = hash.replace('/group/', '');
            handler = {
                render: (el) => {
                    if (GROUP_PAGE && GROUP_PAGE.render) {
                        GROUP_PAGE.render(el, groupId);
                    } else {
                        el.innerHTML = `<div class="loading">Grupo ${escapeHtml(groupId)}...</div>`;
                    }
                },
                destroy: () => { if (GROUP_PAGE && GROUP_PAGE.destroy) GROUP_PAGE.destroy(); }
            };
        }

        if (handler && handler.render) {
            // View transition apenas em trocas de rota (não no mount inicial)
            if (initialized) {
                MOTION.withTransition(() => handler.render(container));
            } else {
                handler.render(container);
                initialized = true;
            }
            activeView = handler;
        } else {
            container.innerHTML = `
                <div class="empty-state">
                    <h2>404</h2>
                    <p>Página não encontrada: ${escapeHtml(hash)}</p>
                    <a href="#/">Voltar ao Dashboard</a>
                </div>
            `;
        }

        updateNavHighlight();
    }

    function updateNavHighlight() {
        const hash = window.location.hash.replace('#', '') || '/';
        document.querySelectorAll('.nav-item').forEach(item => {
            const route = item.getAttribute('data-route') || '';
            const active = hash === route || (route !== '/' && route !== '/wizard' && hash.startsWith(route));
            item.classList.toggle('active', active);
            if (active) {
                item.setAttribute('aria-current', 'page');
            } else {
                item.removeAttribute('aria-current');
            }
        });
    }

    function escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    // ── Header status vivo (A2) ──────────────────

    function initHeaderStatus() {
        const el = document.getElementById('header-status');
        const text = document.getElementById('header-status-text');
        const dot = el ? el.querySelector('.dot') : null;
        let wsOk = false;
        let serverOk = false;

        function render() {
            if (!el) return;
            const cls = (wsOk && serverOk) ? 'online' : (serverOk ? 'degraded' : 'offline');
            if (dot) dot.className = `dot ${cls}`;
            if (text) text.textContent = `${serverOk ? 'Servidor OK' : 'Servidor offline'} · WS ${wsOk ? 'conectado' : 'offline'}`;
        }

        WS.on('connected', () => { wsOk = true; render(); });
        WS.on('disconnected', () => { wsOk = false; render(); });

        async function check() {
            try {
                const h = await API.get('/system/health');
                serverOk = !!(h && h.status === 'ok');
            } catch (e) {
                serverOk = false;
            }
            render();
        }
        check();
        setInterval(check, 30000);
    }

    return { init, navigate, checkWizard, initHeaderStatus };
})();

// Boot
document.addEventListener('DOMContentLoaded', () => {
    if (typeof THEME !== 'undefined') THEME.init();
    if (typeof AUTH !== 'undefined') AUTH.init();
    APP.init();
    APP.initHeaderStatus();
});

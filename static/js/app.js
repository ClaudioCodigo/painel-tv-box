/**
 * App Router — navegação hash-based + sidebar + wizard check.
 */
const APP = (() => {
    let activeView = null;

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
                        el.innerHTML = `<div class="loading">Carregando device ${deviceId}...</div>`;
                    }
                }
            };
        }

        // Match /group/{id}
        if (!handler && hash.startsWith('/group/')) {
            const groupId = hash.replace('/group/', '');
            handler = {
                render: (el) => {
                    el.innerHTML = `<div class="loading">Grupo ${groupId} (em breve)</div>`;
                    UI.setPageTitle('Grupo');
                }
            };
        }

        if (handler && handler.render) {
            handler.render(container);
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
            item.classList.remove('active');
            if (hash === route || (route !== '/' && route !== '/wizard' && hash.startsWith(route))) {
                item.classList.add('active');
            }
        });
    }

    function escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    return { init, navigate, checkWizard };
})();

// Boot
document.addEventListener('DOMContentLoaded', () => {
    APP.init();
});

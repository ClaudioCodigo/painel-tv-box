/**
 * Groups Page — Áreas & Grupos (Design System v2 NOC-Style):
 *   Cards compactos em grid responsivo, toolbar canônico, mini-grid 2x2 de thumbnails,
 *   tabela interna expansível com status individual e menu de ações em massa do grupo.
 */
const GROUPS = (() => {
    let refreshTimer = null;
    let screenshotTimer = null;
    let boundDocClickHandler = null;

    // ── Estado ──
    let groupsCache = [];
    let devicesCache = [];              // Todos os devices para cruzamento de dados/thumbs
    const expandedGroups = new Set();   // IDs dos grupos com tabela de dispositivos aberta
    const filters = { q: '' };
    const blobUrls = new Map();         // deviceId -> blobUrl

    async function render(el) {
        UI.setPageTitle('Áreas & Grupos');

        el.innerHTML = `
            <div class="groups-page">
                <div id="groups-toolbar-mount"></div>
                <div id="groups-list" class="groups-grid">
                    ${UI.skeletons('card', 3)}
                </div>
            </div>
        `;

        setupGlobalListeners();
        await loadGroups();

        if (refreshTimer) clearInterval(refreshTimer);
        refreshTimer = setInterval(loadGroupsSilent, 15000);

        if (screenshotTimer) clearInterval(screenshotTimer);
        screenshotTimer = setInterval(refreshScreenshots, 7000);
    }

    function setupGlobalListeners() {
        if (!boundDocClickHandler) {
            boundDocClickHandler = (e) => {
                if (!e.target.closest('.dropdown-wrap')) {
                    document.querySelectorAll('.groups-page .dropdown-menu.open').forEach(m => m.classList.remove('open'));
                }
            };
            document.addEventListener('click', boundDocClickHandler);
        }
    }

    // ── Carga de Dados ──
    async function loadGroups() {
        const listEl = document.getElementById('groups-list');
        try {
            const [groups, devices] = await Promise.all([
                API.get('/groups'),
                API.get('/devices').catch(() => [])
            ]);

            groupsCache = Array.isArray(groups) ? groups : [];
            devicesCache = Array.isArray(devices) ? devices : [];

            renderToolbar();
            renderGroups();
            refreshScreenshots();
        } catch (e) {
            if (listEl) {
                listEl.innerHTML = UI.stateView('error', e.message, { retry: true, title: 'Erro ao carregar grupos' });
                UI.bindStateRetry(listEl, loadGroups);
            }
        }
    }

    async function loadGroupsSilent() {
        try {
            const [groups, devices] = await Promise.all([
                API.get('/groups'),
                API.get('/devices').catch(() => [])
            ]);
            groupsCache = Array.isArray(groups) ? groups : [];
            devicesCache = Array.isArray(devices) ? devices : [];

            renderToolbar();
            renderGroups();
            refreshScreenshots();
        } catch (e) {
            // Silencioso em polling em background
        }
    }

    // ── Toolbar ──
    function renderToolbar() {
        const mount = document.getElementById('groups-toolbar-mount');
        if (!mount) return;

        const toolbarHtml = UI.pageToolbar({
            title: 'Áreas & Grupos',
            count: groupsCache.length,
            search: {
                id: 'groups-search',
                placeholder: 'Buscar grupos ou TV Boxes... [/]',
                value: filters.q
            },
            actions: [
                { label: 'Novo Grupo', icon: 'plus', primary: true, onclick: 'GROUPS.createForm()' }
            ]
        });

        DOM.patch(mount, toolbarHtml);

        const searchInput = mount.querySelector('#groups-search');
        if (searchInput) {
            searchInput.addEventListener('input', () => {
                filters.q = searchInput.value;
                renderGroups();
            });
        }
    }

    // ── Filtragem ──
    function applyFilters() {
        const q = (filters.q || '').trim().toLowerCase();
        if (!q) return groupsCache;

        return groupsCache.filter(g => {
            const name = (g.name || '').toLowerCase();
            const desc = (g.description || '').toLowerCase();
            const id = (g.id || '').toLowerCase();
            if (name.includes(q) || desc.includes(q) || id.includes(q)) return true;

            // Busca por dispositivos internos do grupo
            const devMatches = (g.devices || []).some(d => {
                const dn = (d.name || '').toLowerCase();
                const dip = (d.ip || '').toLowerCase();
                const did = (d.id || '').toLowerCase();
                return dn.includes(q) || dip.includes(q) || did.includes(q);
            });
            return devMatches;
        });
    }

    // ── Indicador de Saúde Agregada ──
    function groupHealthBadge(devices) {
        const total = devices.length;
        if (total === 0) {
            return `<span class="state unknown"><span class="shape" aria-hidden="true">○</span><span class="label">SEM TVS</span></span>`;
        }

        const online = devices.filter(d => (d.status || d.state?.status) === 'online').length;

        if (online === total) {
            return `<span class="state ok"><span class="shape" aria-hidden="true">●</span><span class="label">${online}/${total} ONLINE</span></span>`;
        }
        if (online === 0) {
            return `<span class="state bad"><span class="shape" aria-hidden="true">✕</span><span class="label">0/${total} ONLINE</span></span>`;
        }
        return `<span class="state warn"><span class="shape" aria-hidden="true">▲</span><span class="label">${online}/${total} ONLINE</span></span>`;
    }

    // ── Renderização dos Cards de Grupos ──
    function renderGroups() {
        const listEl = document.getElementById('groups-list');
        if (!listEl) return;

        if (groupsCache.length === 0) {
            listEl.innerHTML = UI.stateView('empty', 'Nenhum grupo cadastrado. Clique em "+ Novo Grupo" para começar.', {
                icon: 'users',
                title: 'Nenhum grupo'
            });
            return;
        }

        const filtered = applyFilters();
        if (filtered.length === 0) {
            listEl.innerHTML = UI.stateView('empty', 'Nenhum grupo corresponde à busca aplicada.', {
                icon: 'search',
                title: 'Sem resultados'
            });
            return;
        }

        const cardsHtml = filtered.map(g => buildGroupCardHtml(g)).join('');
        DOM.patch(listEl, cardsHtml);
    }

    function buildGroupCardHtml(g) {
        const devices = g.devices || [];
        const hasDevices = devices.length > 0;
        const total = devices.length;
        const isExpanded = expandedGroups.has(g.id);

        return `
            <div class="group-card stagger-item" data-group-id="${UI.escAttr(g.id)}">
                <!-- Cabeçalho do Card -->
                <div class="group-card-header">
                    <div class="group-header-left">
                        <div class="group-title-row">
                            <a href="#/group/${encodeURIComponent(g.id)}" class="group-name" title="Ver detalhes do grupo">${UI.escapeHtml(g.name || g.id)}</a>
                            <span class="group-count-badge">${total} ${total === 1 ? 'TV' : 'TVs'}</span>
                        </div>
                        ${g.description ? `<div class="group-desc" title="${UI.escAttr(g.description)}">${UI.escapeHtml(g.description)}</div>` : ''}
                    </div>
                    <div class="group-header-right">
                        ${groupHealthBadge(devices)}
                    </div>
                </div>

                <!-- Preview: Mini-Grid 2x2 -->
                <div class="group-preview-box">
                    ${buildPreviewGrid(g, devices)}
                </div>

                <!-- Lista/Tabela Expansível de Dispositivos -->
                <div class="group-devices-collapsible">
                    <button type="button" class="group-devices-toggle-btn ${isExpanded ? 'open' : ''}" onclick="GROUPS.toggleDevices('${UI.escAttr(g.id)}')" aria-expanded="${isExpanded ? 'true' : 'false'}">
                        <span>Dispositivos (${total})</span>
                        <span class="toggle-icon">${UI.icon('chevron-down', 14)}</span>
                    </button>
                    <div class="group-devices-table ${isExpanded ? 'open' : ''}" id="gdev-table-${UI.escAttr(g.id)}">
                        ${hasDevices ? buildDevicesTableHtml(devices) : '<div class="text-muted text-sm" style="padding:10px 16px">Nenhum TV Box associado a este grupo.</div>'}
                    </div>
                </div>

                <!-- Footer / Ações em Massa -->
                <div class="group-card-footer">
                    <button type="button" class="btn btn-sm btn-primary" onclick="GROUPS.action('${UI.escAttr(g.id)}', 'start-stream')" ${!hasDevices ? 'disabled' : ''} title="Abrir aplicação em todos os TV Boxes do grupo">
                        ${UI.icon('play', 14)} Iniciar Todos
                    </button>
                    <button type="button" class="btn btn-sm btn-secondary" onclick="GROUPS.action('${UI.escAttr(g.id)}', 'stop-stream')" ${!hasDevices ? 'disabled' : ''} title="Parar stream em todos os TV Boxes">
                        ${UI.icon('stop', 14)} Parar
                    </button>
                    <button type="button" class="btn btn-sm btn-warning" onclick="GROUPS.action('${UI.escAttr(g.id)}', 'reboot')" ${!hasDevices ? 'disabled' : ''} title="Reiniciar todos os TV Boxes do grupo">
                        ${UI.icon('reboot', 14)} Reboot
                    </button>
                    <div class="dropdown-wrap">
                        <button type="button" class="btn btn-sm btn-icon" onclick="GROUPS.toggleGroupMenu(event, '${UI.escAttr(g.id)}')" title="Mais opções" aria-label="Mais opções">
                            ${UI.icon('more-vertical', 14)}
                        </button>
                        <div class="dropdown-menu" id="grp-menu-${UI.escAttr(g.id)}">
                            <button type="button" class="dropdown-item" onclick="GROUPS.editForm('${UI.escAttr(g.id)}', '${UI.escAttr(g.name)}', '${UI.escAttr(g.description || '')}')">
                                ${UI.icon('edit', 14)} Editar Grupo
                            </button>
                            <a href="#/group/${encodeURIComponent(g.id)}" class="dropdown-item" style="text-decoration:none">
                                ${UI.icon('arrow-right', 14)} Página de Detalhe
                            </a>
                            <div class="dropdown-divider"></div>
                            <button type="button" class="dropdown-item danger" onclick="GROUPS.deleteGroup('${UI.escAttr(g.id)}')">
                                ${UI.icon('trash', 14)} Excluir Grupo
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        `;
    }

    // ── Montagem da Mini-Grade 2x2 de Previews ──
    function buildPreviewGrid(group, devices) {
        const total = devices.length;

        if (total === 0) {
            return `
                <div class="group-thumb-grid empty">
                    ${UI.icon('tv', 24)}
                    <span>Nenhum TV Box vinculado</span>
                </div>
            `;
        }

        let gridClass = 'grid-2x2';
        if (total === 1) gridClass = 'single';
        else if (total === 2) gridClass = 'double';

        const displayItems = devices.slice(0, 4);

        const cellsHtml = displayItems.map((d, index) => {
            const isLastOfFour = index === 3 && total > 4;
            const status = (d.status || 'unknown').toLowerCase();

            return `
                <div class="group-thumb-cell" onclick="GROUPS.openScrcpy('${UI.escAttr(d.id)}')" title="Acesso Remoto: ${UI.escAttr(d.name || d.id)}">
                    <img data-group-thumb="${UI.escAttr(d.id)}" alt="Tela ${UI.escapeHtml(d.name || d.id)}" style="display:none" onload="this.style.display='block'; if(this.nextElementSibling) this.nextElementSibling.style.display='none'" onerror="this.style.display='none'; if(this.nextElementSibling) this.nextElementSibling.style.display='flex'">
                    <div class="thumb-fallback" aria-hidden="true">${UI.icon('tv', 16)}</div>
                    <span class="thumb-status-dot ${status}"></span>
                    <span class="thumb-name-overlay">${UI.escapeHtml(d.name || d.id)}</span>
                    ${isLastOfFour ? `<div class="thumb-more-overlay">+${total - 3}</div>` : ''}
                </div>
            `;
        }).join('');

        return `<div class="group-thumb-grid ${gridClass}">${cellsHtml}</div>`;
    }

    // ── Tabela Interna de Dispositivos ──
    function buildDevicesTableHtml(devices) {
        return devices.map(d => {
            const status = d.status || 'unknown';
            return `
                <div class="gdev-row" data-id="${UI.escAttr(d.id)}">
                    <div class="gdev-info">
                        ${UI.stateBadge(status)}
                        <a href="#/device/${encodeURIComponent(d.id)}" class="gdev-name">${UI.escapeHtml(d.name || d.id)}</a>
                        <span class="gdev-ip">${UI.escapeHtml(d.ip || '--')}</span>
                    </div>
                    <div class="gdev-actions">
                        <button type="button" class="btn-icon-sm" onclick="GROUPS.openScrcpy('${UI.escAttr(d.id)}')" title="Abrir Scrcpy" aria-label="Abrir Scrcpy">
                            ${UI.icon('monitor', 13)}
                        </button>
                        <a href="#/device/${encodeURIComponent(d.id)}" class="btn-icon-sm" title="Ver TV Box" aria-label="Ver TV Box">
                            ${UI.icon('arrow-right', 13)}
                        </a>
                    </div>
                </div>
            `;
        }).join('');
    }

    // ── Alternância de Expansão de Dispositivos ──
    function toggleDevices(groupId) {
        const table = document.getElementById(`gdev-table-${groupId}`);
        const card = document.querySelector(`.group-card[data-group-id="${window.CSS && CSS.escape ? CSS.escape(groupId) : groupId}"]`);
        const btn = card ? card.querySelector('.group-devices-toggle-btn') : null;

        if (expandedGroups.has(groupId)) {
            expandedGroups.delete(groupId);
            if (table) table.classList.remove('open');
            if (btn) {
                btn.classList.remove('open');
                btn.setAttribute('aria-expanded', 'false');
            }
        } else {
            expandedGroups.add(groupId);
            if (table) table.classList.add('open');
            if (btn) {
                btn.classList.add('open');
                btn.setAttribute('aria-expanded', 'true');
            }
        }
    }

    function toggleGroupMenu(event, groupId) {
        event.stopPropagation();
        const menu = document.getElementById(`grp-menu-${groupId}`);
        if (!menu) return;
        const isOpen = menu.classList.contains('open');
        document.querySelectorAll('.groups-page .dropdown-menu.open').forEach(m => m.classList.remove('open'));
        if (!isOpen) menu.classList.add('open');
    }

    // ── Atualização Suave de Screenshots ──
    async function refreshScreenshots() {
        const listEl = document.getElementById('groups-list');
        if (!listEl) return;

        const imgs = listEl.querySelectorAll('img[data-group-thumb]');
        const now = Date.now();

        imgs.forEach(async (img) => {
            const id = img.dataset.groupThumb;
            if (!id) return;
            const dev = devicesCache.find(d => d.id === id);
            const status = (dev?.state?.status || 'unknown').toLowerCase();
            if (status === 'offline') return;

            try {
                const blobUrl = await API.fetchBlobUrl(`/devices/${encodeURIComponent(id)}/screenshot?_t=${now}`);
                const oldUrl = blobUrls.get(id);
                if (oldUrl) URL.revokeObjectURL(oldUrl);
                blobUrls.set(id, blobUrl);

                if (typeof DOM !== 'undefined' && typeof DOM.crossFadeImage === 'function') {
                    DOM.crossFadeImage(img, blobUrl);
                } else {
                    img.src = blobUrl;
                }
                img.style.display = 'block';
                if (img.nextElementSibling) img.nextElementSibling.style.display = 'none';
            } catch (e) {
                // Silencioso se sem screenshot
            }
        });
    }

    function openScrcpy(deviceId) {
        const dev = devicesCache.find(d => d.id === deviceId);
        if (dev) {
            UI.launchScrcpy(dev);
        } else {
            UI.launchScrcpy({ id: deviceId, ip: deviceId });
        }
    }

    // ── CRUD de Grupos ──
    function createForm() {
        UI.showModal(
            'Novo Grupo',
            `
                <div class="form-group">
                    <label class="form-label">Nome *</label>
                    <input type="text" id="g-name" class="form-input" placeholder="Ex: Entrada Principal">
                </div>
                <div class="form-group">
                    <label class="form-label">Descrição</label>
                    <input type="text" id="g-desc" class="form-input" placeholder="Ex: TV Boxes do hall de entrada">
                </div>
            `,
            async () => {
                const name = (document.getElementById('g-name')?.value || '').trim();
                const description = (document.getElementById('g-desc')?.value || '').trim();
                if (!name) { UI.createToast('Nome é obrigatório', 'error'); return; }
                try {
                    await API.post('/groups', { name, description });
                    UI.createToast(`Grupo "${name}" criado com sucesso`, 'success');
                    await loadGroups();
                } catch (e) {
                    UI.createToast(`Erro: ${e.message}`, 'error');
                }
            }
        );
    }

    function editForm(groupId, currentName, currentDesc) {
        UI.showModal(
            `Editar Grupo`,
            `
                <div class="form-group">
                    <label class="form-label">Nome *</label>
                    <input type="text" id="g-edit-name" class="form-input" value="${UI.escapeHtml(currentName)}">
                </div>
                <div class="form-group">
                    <label class="form-label">Descrição</label>
                    <input type="text" id="g-edit-desc" class="form-input" value="${UI.escapeHtml(currentDesc || '')}">
                </div>
            `,
            async () => {
                const name = (document.getElementById('g-edit-name')?.value || '').trim();
                const description = (document.getElementById('g-edit-desc')?.value || '').trim();
                if (!name) { UI.createToast('Nome é obrigatório', 'error'); return; }
                try {
                    await API.put(`/groups/${encodeURIComponent(groupId)}`, { name, description });
                    UI.createToast(`Grupo atualizado com sucesso`, 'success');
                    await loadGroups();
                } catch (e) {
                    UI.createToast(`Erro: ${e.message}`, 'error');
                }
            }
        );
    }

    async function action(groupId, actionName) {
        const actionLabels = {
            'start-stream': 'Iniciar stream',
            'stop-stream': 'Parar stream',
            'reboot': 'Reinicialização'
        };
        const label = actionLabels[actionName] || actionName;

        UI.createToast(`Executando ${label} no grupo...`, 'info', 2000);
        try {
            const res = await API.post(`/groups/${encodeURIComponent(groupId)}/${actionName}`);
            const total = res.total ?? 0;
            const ok = res.success_count ?? 0;
            UI.createToast(`${label} enviado: ${ok}/${total} sucesso(s)`, ok > 0 ? 'success' : 'warning');
            setTimeout(loadGroupsSilent, 1500);
        } catch (e) {
            UI.createToast(`Erro ao executar ${label}: ${e.message}`, 'error');
        }
    }

    async function deleteGroup(groupId) {
        UI.showModal(
            `Remover Grupo`,
            `<p>Tem certeza de que deseja remover este grupo? <strong>Os TV Boxes não serão excluídos</strong>, apenas desvinculados do grupo.</p>`,
            async () => {
                try {
                    await API.del(`/groups/${encodeURIComponent(groupId)}`);
                    expandedGroups.delete(groupId);
                    UI.createToast('Grupo removido com sucesso', 'success');
                    await loadGroups();
                } catch (e) {
                    UI.createToast(`Erro: ${e.message}`, 'error');
                }
            }
        );
    }

    function destroy() {
        if (refreshTimer) { clearInterval(refreshTimer); refreshTimer = null; }
        if (screenshotTimer) { clearInterval(screenshotTimer); screenshotTimer = null; }
        if (boundDocClickHandler) {
            document.removeEventListener('click', boundDocClickHandler);
            boundDocClickHandler = null;
        }
        blobUrls.forEach((url) => URL.revokeObjectURL(url));
        blobUrls.clear();
        expandedGroups.clear();
    }

    return {
        render,
        destroy,
        createForm,
        editForm,
        action,
        deleteGroup,
        toggleDevices,
        toggleGroupMenu,
        openScrcpy
    };
})();

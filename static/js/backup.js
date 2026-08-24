/**
 * Backup Page — export, import, list, restore.
 */
const BACKUP = (() => {

    async function render(el) {
        UI.setPageTitle('Backup');

        el.innerHTML = `
            <div class="backup-page">
                <div class="section-title">${UI.icon('download')} Exportar</div>
                <div class="backup-card">
                    <p class="text-muted text-sm">Baixa toda a configuração (config/, devices/, groups/) como ZIP.</p>
                    <button class="btn btn-primary" onclick="BACKUP.doExport()">${UI.icon('download')} Exportar Backup</button>
                </div>

                <div class="section-title mt-md">${UI.icon('upload')} Importar</div>
                <div class="backup-card">
                    <p class="text-muted text-sm">Restaura configuração a partir de um arquivo ZIP.</p>
                    <p class="text-muted text-sm" style="color:var(--text-secondary)">⚠️ Um backup automático será criado antes da importação.</p>
                    <input type="file" id="backup-import-file" accept=".zip" style="display:none" onchange="BACKUP.doImport(this.files[0])">
                    <button class="btn btn-warning" onclick="document.getElementById('backup-import-file').click()">${UI.icon('upload')} Importar ZIP</button>
                    <span class="text-muted text-sm" id="backup-import-status" style="margin-left:8px"></span>
                </div>

                <div class="section-title mt-md">${UI.icon('archive')} Backups Anteriores</div>
                <div id="backup-list">
                    <div class="loading">Carregando...</div>
                </div>
            </div>
        `;

        await loadList();
    }

    async function loadList() {
        const el = document.getElementById('backup-list');
        if (!el) return;

        try {
            const res = await API.get('/backup/list');
            const backups = res.backups || [];

            if (backups.length === 0) {
                el.innerHTML = UI.stateView('empty', 'Exporte um backup para começar.', { icon: 'archive', title: 'Nenhum backup' });
                return;
            }

            let html = '<div class="backup-items">';
            for (const b of backups) {
                const size = formatBytes(b.size_bytes || 0);
                // created vem ISO; mostra relativo com absoluto no title
                const createdIso = b.created ? b.created.replace('T', ' ') : '';
                html += `
                    <div class="backup-item">
                        <div class="backup-info">
                            <div class="backup-name">${UI.escapeHtml(b.name)}</div>
                            <div class="backup-meta" title="${UI.escapeHtml(createdIso)}">${size} — ${b.created ? UI.timeAgo(b.created) : '--'}</div>
                        </div>
                        <div class="backup-actions">
                            <button class="btn btn-sm btn-secondary" onclick="BACKUP.doDownload('${UI.escAttr(b.name)}')">${UI.icon('download')}</button>
                            <button class="btn btn-sm btn-danger" onclick="BACKUP.doRestore('${UI.escAttr(b.name)}')">${UI.icon('refresh')} Restaurar</button>
                        </div>
                    </div>
                `;
            }
            html += '</div>';
            el.innerHTML = html;
        } catch (e) {
            el.innerHTML = UI.stateView('error', e.message, { retry: true });
            UI.bindStateRetry(el, loadList);
        }
    }

    function formatBytes(num) {
        if (!num || num === 0) return '0 B';
        const units = ['B', 'KB', 'MB', 'GB'];
        let i = 0;
        while (num >= 1024 && i < units.length - 1) { num /= 1024; i++; }
        return num.toFixed(1) + ' ' + units[i];
    }

    async function doExport() {
        try {
            // Endpoint é POST — precisa de fetch, não window.open
            const token = (typeof AUTH !== 'undefined') ? AUTH.getToken() : '';
            const headers = {};
            if (token) headers['Authorization'] = 'Bearer ' + token;
            const res = await fetch('/api/backup/export', { method: 'POST', headers });
            if (!res.ok) {
                if (res.status === 401 && typeof AUTH !== 'undefined') {
                    AUTH.requireLogin();
                }
                throw new Error(`HTTP ${res.status}`);
            }

            const cd = res.headers.get('Content-Disposition') || '';
            const m = cd.match(/filename="?([^";]+)"?/);
            const filename = m ? m[1] : `backup-${Date.now()}.zip`;

            const blob = await res.blob();
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = filename;
            document.body.appendChild(a);
            a.click();
            a.remove();
            URL.revokeObjectURL(url);
            UI.createToast('✅ Backup exportado', 'success');
            await loadList();
        } catch (e) {
            UI.createToast(`❌ ${e.message}`, 'error');
        }
    }

    async function doImport(file) {
        if (!file) return;
        const status = document.getElementById('backup-import-status');
        if (status) status.textContent = 'Importando...';

        try {
            const res = await API.upload('/backup/import', file, 'file');
            if (res.success) {
                UI.createToast(`✅ ${res.count} arquivos restaurados!`, 'success');
                if (status) status.textContent = `✅ ${res.count} arquivos`;
            } else {
                UI.createToast(`❌ ${res.errors?.join(', ') || 'erro'}`, 'error');
                if (status) status.textContent = '❌ Falha';
            }
            await loadList();
        } catch (e) {
            UI.createToast(`❌ ${e.message}`, 'error');
            if (status) status.textContent = `❌ ${e.message}`;
        }
    }

    async function doRestore(name) {
        UI.showModal(
            `Restaurar ${name}`,
            `<p>Tem certeza? A configuração atual será substituída.<br>` +
            `Um <strong>backup automático</strong> será criado antes da restauração.<br>` +
            `<span class="text-muted text-sm">Restaura: config/, devices/ e groups/.</span></p>`,
            async () => {
                try {
                    const res = await API.post(`/backup/restore/${encodeURIComponent(name)}`);
                    if (res.success) {
                        UI.createToast(`${res.count} arquivos restaurados de ${name}`, 'success');
                        await loadList();
                    } else {
                        UI.createToast(`${res.error || 'erro'}`, 'error');
                    }
                } catch (e) {
                    UI.createToast(`❌ ${e.message}`, 'error');
                }
            }
        );
    }

    function doDownload(name) {
        // GET no endpoint dedicado de download (o antigo apontava para o
        // restore, que é POST e destrutivo). Token via query (window.open
        // não envia headers).
        window.open(API.authUrl(`/api/backup/download/${encodeURIComponent(name)}`), '_blank');
    }

    return { render, doExport, doImport, doRestore, doDownload };
})();

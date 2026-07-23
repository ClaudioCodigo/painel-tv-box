/**
 * Backup Page — export, import, list, restore.
 */
const BACKUP = (() => {

    async function render(el) {
        UI.setPageTitle('Backup');

        el.innerHTML = `
            <div class="backup-page">
                <div class="section-title">💾 Exportar</div>
                <div class="backup-card">
                    <p class="text-muted text-sm">Baixa toda a configuração (config/, devices/, groups/) como ZIP.</p>
                    <button class="btn btn-primary" onclick="BACKUP.doExport()">⬇ Exportar Backup</button>
                </div>

                <div class="section-title mt-md">📤 Importar</div>
                <div class="backup-card">
                    <p class="text-muted text-sm">Restaura configuração a partir de um arquivo ZIP.</p>
                    <p class="text-muted text-sm" style="color:var(--warning)">⚠️ Um backup automático será criado antes da importação.</p>
                    <input type="file" id="backup-import-file" accept=".zip" style="display:none" onchange="BACKUP.doImport(this.files[0])">
                    <button class="btn btn-warning" onclick="document.getElementById('backup-import-file').click()">📤 Importar ZIP</button>
                    <span class="text-muted text-sm" id="backup-import-status" style="margin-left:8px"></span>
                </div>

                <div class="section-title mt-md">📂 Backups Anteriores</div>
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
                el.innerHTML = '<div class="empty-state">Nenhum backup encontrado.</div>';
                return;
            }

            let html = '<div class="backup-items">';
            for (const b of backups) {
                const size = (b.size_bytes / 1024).toFixed(1);
                html += `
                    <div class="backup-item">
                        <div class="backup-info">
                            <div class="backup-name">${b.name}</div>
                            <div class="backup-meta">${size} KB — ${b.created || '--'}</div>
                        </div>
                        <div class="backup-actions">
                            <button class="btn btn-sm btn-secondary" onclick="BACKUP.doDownload('${b.name}')">⬇</button>
                            <button class="btn btn-sm btn-danger" onclick="BACKUP.doRestore('${b.name}')">🔄 Restaurar</button>
                        </div>
                    </div>
                `;
            }
            html += '</div>';
            el.innerHTML = html;
        } catch (e) {
            el.innerHTML = `<div class="error-state">Erro: ${e.message}</div>`;
        }
    }

    async function doExport() {
        window.open('/api/backup/export', '_blank');
        UI.createToast('Download iniciado...', 'info');
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
            `<p>Tem certeza? A configuração atual será substituída.<br>Um backup automático será criado antes.</p>`,
            async () => {
                try {
                    const res = await API.post(`/backup/restore/${encodeURIComponent(name)}`);
                    if (res.success) {
                        UI.createToast(`✅ ${res.count} arquivos restaurados de ${name}`, 'success');
                        await loadList();
                    } else {
                        UI.createToast(`❌ ${res.error || 'erro'}`, 'error');
                    }
                } catch (e) {
                    UI.createToast(`❌ ${e.message}`, 'error');
                }
            }
        );
    }

    function doDownload(name) {
        window.open(`/api/backup/restore/${encodeURIComponent(name)}`, '_blank');
    }

    return { render, doExport, doImport, doRestore, doDownload };
})();

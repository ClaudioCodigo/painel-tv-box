/**
 * Backup Page — exportação, importação, listagem em tabela densa e restauração segura.
 */
const BACKUP = (() => {

    async function render(el) {
        UI.setPageTitle('Backup');

        el.innerHTML = `
            <div class="backup-page">
                <div class="backup-overview-grid">
                    <div class="backup-card">
                        <div class="section-title" style="margin-bottom:8px">${UI.icon('download')} Exportar Configuração</div>
                        <p class="text-muted text-sm">Empacota toda a configuração do sistema (<code>config/</code>, <code>devices/</code>, <code>groups/</code>) em um arquivo compactado ZIP para custódia externa.</p>
                        <div class="backup-actions" style="margin-top:14px">
                            <button class="btn btn-primary btn-sm" id="btn-export-backup" onclick="BACKUP.doExport()">
                                ${UI.icon('download')} <span id="export-btn-label">Exportar Novo Backup</span>
                            </button>
                        </div>
                    </div>

                    <div class="backup-card">
                        <div class="section-title" style="margin-bottom:8px">${UI.icon('upload')} Importar Configuração</div>
                        <p class="text-muted text-sm">Restaura configurações a partir de um arquivo ZIP. Um backup de segurança automático é gerado antes de qualquer alteração ser aplicada.</p>
                        <div class="backup-actions" style="margin-top:14px">
                            <input type="file" id="backup-import-file" accept=".zip" style="display:none" onchange="BACKUP.doImport(this.files[0])">
                            <button class="btn btn-secondary btn-sm" id="btn-import-backup" onclick="document.getElementById('backup-import-file').click()">
                                ${UI.icon('upload')} <span id="import-btn-label">Importar Arquivo ZIP</span>
                            </button>
                            <span class="text-muted text-xs" id="backup-import-status"></span>
                        </div>
                    </div>
                </div>

                <div class="section-title mt-md" style="display:flex;justify-content:space-between;align-items:center">
                    <span>${UI.icon('archive')} Pontos de Restauração Salvos</span>
                    <button class="btn btn-secondary btn-sm" onclick="BACKUP.loadList()" title="Atualizar listagem">${UI.icon('refresh')} Atualizar</button>
                </div>

                <div id="backup-table-container">
                    ${UI.skeletons('row', 3)}
                </div>
            </div>
        `;

        await loadList();
    }

    async function loadList() {
        const el = document.getElementById('backup-table-container');
        if (!el) return;

        try {
            const res = await API.get('/backup/list');
            const backups = res.backups || [];

            if (backups.length === 0) {
                el.innerHTML = UI.stateView(
                    'empty',
                    'Nenhum backup registrado no servidor. Clique em "Exportar Novo Backup" para criar um ponto de restauração.',
                    { icon: 'archive', title: 'Nenhum backup encontrado' }
                );
                return;
            }

            const rows = backups.map(b => {
                const dateObj = b.created ? new Date(b.created) : null;
                const formattedDate = (dateObj && !isNaN(dateObj.getTime()))
                    ? dateObj.toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'medium' })
                    : (b.created ? b.created.replace('T', ' ').substring(0, 19) : '—');

                return {
                    id: b.name,
                    rawCreated: b.created || '',
                    formattedDate,
                    name: b.name,
                    sizeBytes: b.size_bytes || 0,
                    sizeFormatted: formatBytes(b.size_bytes || 0)
                };
            });

            const columns = [
                {
                    key: 'formattedDate',
                    label: 'Data / Hora',
                    sortable: true,
                    render: (val, row) => `
                        <div class="backup-col-date">
                            <span class="date-text">${UI.escapeHtml(val)}</span>
                            <span class="text-muted text-xs">${row.rawCreated ? UI.timeAgo(row.rawCreated) : ''}</span>
                        </div>
                    `
                },
                {
                    key: 'name',
                    label: 'Arquivo ZIP',
                    sortable: true,
                    render: (val) => `
                        <div class="backup-col-name">
                            <span class="backup-file-icon" aria-hidden="true">${UI.icon('archive', 14)}</span>
                            <code class="backup-filename mono">${UI.escapeHtml(val)}</code>
                        </div>
                    `
                },
                {
                    key: 'sizeBytes',
                    label: 'Tamanho',
                    align: 'right',
                    sortable: true,
                    render: (val, row) => `<span class="badge font-mono">${UI.escapeHtml(row.sizeFormatted)}</span>`
                },
                {
                    key: 'actions',
                    label: 'Ações',
                    align: 'right',
                    render: (val, row) => `
                        <div class="table-actions">
                            <button class="btn btn-sm btn-secondary" title="Baixar arquivo ZIP" aria-label="Baixar backup ${UI.escAttr(row.name)}" onclick="BACKUP.doDownload('${UI.escAttr(row.name)}')">
                                ${UI.icon('download')} Baixar
                            </button>
                            <button class="btn btn-sm btn-warning" title="Restaurar este backup" aria-label="Restaurar backup ${UI.escAttr(row.name)}" onclick="BACKUP.doRestore('${UI.escAttr(row.name)}')">
                                ${UI.icon('refresh')} Restaurar
                            </button>
                            <button class="btn btn-sm btn-danger" title="Excluir este backup permanentemente" aria-label="Excluir backup ${UI.escAttr(row.name)}" onclick="BACKUP.doDelete('${UI.escAttr(row.name)}')">
                                ${UI.icon('trash')}
                            </button>
                        </div>
                    `
                }
            ];

            el.innerHTML = UI.dataTable({
                id: 'backup-data-table',
                columns,
                rows,
                emptyMessage: 'Nenhum backup encontrado'
            });

        } catch (e) {
            el.innerHTML = UI.stateView('error', `Falha ao carregar lista de backups: ${e.message}`, { retry: true });
            UI.bindStateRetry(el, loadList);
        }
    }

    function formatBytes(num) {
        if (!num || num === 0) return '0 B';
        const units = ['B', 'KB', 'MB', 'GB'];
        let i = 0;
        let n = num;
        while (n >= 1024 && i < units.length - 1) {
            n /= 1024;
            i++;
        }
        return n.toFixed(1) + ' ' + units[i];
    }

    async function doExport() {
        const btn = document.getElementById('btn-export-backup');
        const label = document.getElementById('export-btn-label');
        const originalText = label ? label.textContent : 'Exportar Novo Backup';

        if (btn) btn.disabled = true;
        if (label) label.textContent = 'Gerando arquivo ZIP...';
        UI.createToast('Iniciando exportação das configurações...', 'info');

        try {
            const filename = `backup-paineltvbox-${new Date().toISOString().replace(/[:.]/g, '-')}.zip`;
            await API.download('/backup/export', filename, 'POST');
            UI.createToast('Backup exportado e baixado com sucesso!', 'success');
            await loadList();
        } catch (e) {
            UI.createToast(`Erro ao exportar backup: ${e.message}`, 'error');
        } finally {
            if (btn) btn.disabled = false;
            if (label) label.textContent = originalText;
        }
    }

    async function doImport(file) {
        if (!file) return;

        const btn = document.getElementById('btn-import-backup');
        const label = document.getElementById('import-btn-label');
        const status = document.getElementById('backup-import-status');
        const originalText = label ? label.textContent : 'Importar Arquivo ZIP';

        if (btn) btn.disabled = true;
        if (label) label.textContent = 'Validando e importando...';
        if (status) status.innerHTML = `<span class="spinner-sm"></span> Processando...`;
        UI.createToast(`Enviando ${file.name}...`, 'info');

        try {
            const res = await API.upload('/backup/import', file, 'file');
            if (res.success) {
                const count = res.count || res.files_restored?.length || 0;
                const msg = `Configuração importada com sucesso (${count} arquivos restaurados).`;
                UI.createToast(msg, 'success');
                if (status) status.innerHTML = `<span class="text-success">${UI.icon('check')} ${count} arquivos</span>`;
            } else {
                const err = res.errors?.join(', ') || res.error || 'Falha na importação';
                UI.createToast(`Erro na importação: ${err}`, 'error');
                if (status) status.innerHTML = `<span class="text-danger">${UI.icon('x')} Falha</span>`;
            }
            await loadList();
        } catch (e) {
            UI.createToast(`Falha no upload do backup: ${e.message}`, 'error');
            if (status) status.innerHTML = `<span class="text-danger">${UI.icon('x')} ${UI.escapeHtml(e.message)}</span>`;
        } finally {
            if (btn) btn.disabled = false;
            if (label) label.textContent = originalText;
            const fileInput = document.getElementById('backup-import-file');
            if (fileInput) fileInput.value = '';
        }
    }

    async function doRestore(name) {
        UI.showModal(
            '⚠️ Confirmar Restauração de Backup',
            `<div class="modal-body-content">
                <p>Você solicitou a restauração a partir do arquivo:</p>
                <p style="margin:8px 0"><code class="mono" style="font-size:1.05em;padding:4px 8px;background:var(--bg-inset);border-radius:var(--radius-sm)">${UI.escapeHtml(name)}</code></p>
                <div class="modal-alert-box" style="margin:12px 0;padding:10px 14px;background:var(--bg-inset);border-left:3px solid var(--text-primary);border-radius:var(--radius-sm);font-size:0.85em;line-height:1.6">
                    <strong>Atenção:</strong> Todas as configurações atuais de <code>config/</code>, <code>devices/</code> e <code>groups/</code> serão substituídas pelos dados contidos neste backup.<br>
                    Um <strong>backup de segurança automático</strong> será gerado imediatamente antes da aplicação.
                </div>
                <p style="font-weight:600">Deseja realmente prosseguir com a restauração?</p>
            </div>`,
            async () => {
                UI.createToast(`Restaurando backup ${name}...`, 'info');
                try {
                    const res = await API.post(`/backup/restore/${encodeURIComponent(name)}`);
                    if (res.success) {
                        const count = res.count || res.files_restored?.length || 0;
                        UI.createToast(`Backup restaurado com sucesso! (${count} arquivos)`, 'success');
                        await loadList();
                    } else {
                        UI.createToast(`Erro na restauração: ${res.error || 'Falha desconhecida'}`, 'error');
                    }
                } catch (e) {
                    UI.createToast(`Falha na restauração: ${e.message}`, 'error');
                }
            }
        );
    }

    async function doDelete(name) {
        UI.showModal(
            'Excluir Ponto de Restauração',
            `<p>Tem certeza de que deseja excluir permanentemente o arquivo de backup <strong>${UI.escapeHtml(name)}</strong>?</p>
             <p class="text-muted text-xs">Esta operação não pode ser desfeita.</p>`,
            async () => {
                try {
                    await API.del(`/backup/${encodeURIComponent(name)}`);
                    UI.createToast(`Backup ${name} excluído com sucesso.`, 'success');
                    await loadList();
                } catch (e) {
                    UI.createToast(`Erro ao excluir backup: ${e.message}`, 'error');
                }
            }
        );
    }

    async function doDownload(name) {
        try {
            UI.createToast(`Preparando download de ${name}...`, 'info');
            await API.download(`/backup/download/${encodeURIComponent(name)}`, name);
            UI.createToast('Download concluído com sucesso!', 'success');
        } catch (e) {
            UI.createToast(`Erro ao baixar arquivo: ${e.message}`, 'error');
        }
    }

    return { render, loadList, doExport, doImport, doRestore, doDelete, doDownload };
})();

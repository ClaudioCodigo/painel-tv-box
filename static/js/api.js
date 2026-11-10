/**
 * REST API helper — fetch wrapper com autenticação e tratamento de erros.
 */
const API = (() => {
    const BASE = '/api';

    function authHeaders(extra = {}) {
        const h = { ...extra };
        const t = (typeof AUTH !== 'undefined' && typeof AUTH.getToken === 'function') ? AUTH.getToken() : '';
        if (t) h['Authorization'] = 'Bearer ' + t;
        return h;
    }

    const getAuthHeaders = authHeaders;

    function normalizePath(path) {
        let p = path || '';
        if (p.startsWith('http://') || p.startsWith('https://')) return p;
        p = p.replace(/^(\/?api)+/i, '');
        if (!p.startsWith('/')) p = '/' + p;
        return `${BASE}${p}`;
    }

    /**
     * URL com token na query — para uso direto no browser
     * (img src, etc.), onde headers não podem ser enviados.
     * Garante o prefixo /api para rotas da API.
     */
    function authUrl(path) {
        const t = (typeof AUTH !== 'undefined' && typeof AUTH.getToken === 'function') ? AUTH.getToken() : '';
        const fullPath = normalizePath(path);
        const sep = fullPath.includes('?') ? '&' : '?';
        return `${fullPath}${sep}token=${encodeURIComponent(t)}`;
    }

    function handleUnauthorized(res) {
        if (res && res.status === 401) {
            const hadSession = typeof AUTH !== 'undefined' && typeof AUTH.isLoggedIn === 'function' && AUTH.isLoggedIn();
            if (typeof AUTH !== 'undefined' && typeof AUTH.clearToken === 'function') {
                AUTH.clearToken();
            }
            window.dispatchEvent(new CustomEvent('auth:logged-out'));
            if (hadSession && typeof UI !== 'undefined' && typeof UI.createToast === 'function') {
                UI.createToast('Sessão expirada — faça login novamente', 'warning');
            }
            if (typeof AUTH !== 'undefined' && typeof AUTH.showLogin === 'function') {
                AUTH.showLogin();
            }
        }
    }

    async function request(method, path, body) {
        const url = normalizePath(path);
        const opts = {
            method,
            headers: authHeaders({ 'Content-Type': 'application/json' }),
        };
        if (body && method !== 'GET') {
            opts.body = JSON.stringify(body);
        }

        let res;
        try {
            res = await fetch(url, opts);
        } catch (err) {
            throw new Error(`Network error: ${err.message}`);
        }

        if (!res.ok) {
            handleUnauthorized(res);
            let detail = res.statusText;
            try {
                const errData = await res.json();
                detail = errData.detail || errData.title || detail;
            } catch {}
            const err = new Error(detail);
            err.status = res.status;
            throw err;
        }

        const ct = res.headers.get('content-type') || '';
        if (ct.includes('application/json')) {
            return res.json();
        }
        return res.text();
    }

    function get(path) { return request('GET', path); }
    function post(path, body) { return request('POST', path, body); }
    function put(path, body) { return request('PUT', path, body); }
    function del(path) { return request('DELETE', path); }

    async function upload(path, file, fieldName = 'file') {
        const form = new FormData();
        form.append(fieldName, file);
        const url = normalizePath(path);
        const res = await fetch(url, { method: 'POST', headers: authHeaders(), body: form });
        if (!res.ok) {
            handleUnauthorized(res);
            let detail = res.statusText;
            try { const d = await res.json(); detail = d.detail || detail; } catch {}
            const err = new Error(detail);
            err.status = res.status;
            throw err;
        }
        return res.json();
    }

    async function download(path, defaultFilename = 'download.zip', options = {}) {
        let method = 'GET';
        let body = null;
        let headers = {};

        if (typeof options === 'string') {
            method = options.toUpperCase();
            if (arguments.length > 3) {
                body = arguments[3];
            }
        } else if (options && typeof options === 'object') {
            if (options.method) method = options.method.toUpperCase();
            if (options.body !== undefined) body = options.body;
            if (options.headers) headers = options.headers;
        }

        const fullUrl = normalizePath(path);
        const fetchOpts = {
            method,
            headers: getAuthHeaders(headers),
        };
        if (body && method !== 'GET') {
            if (typeof body === 'object' && !(body instanceof FormData)) {
                fetchOpts.headers['Content-Type'] = 'application/json';
                fetchOpts.body = JSON.stringify(body);
            } else {
                fetchOpts.body = body;
            }
        }

        let res;
        try {
            res = await fetch(fullUrl, fetchOpts);
        } catch (err) {
            if (typeof UI !== 'undefined' && typeof UI.createToast === 'function') {
                UI.createToast(`Erro de rede no download: ${err.message}`, 'error');
            }
            throw new Error(`Network error: ${err.message}`);
        }

        if (!res.ok) {
            handleUnauthorized(res);
            let detail = res.statusText;
            try {
                const d = await res.json();
                detail = d.detail || d.title || detail;
            } catch {}
            if (typeof UI !== 'undefined' && typeof UI.createToast === 'function') {
                UI.createToast(`Falha no download: ${detail}`, 'error');
            }
            const err = new Error(detail);
            err.status = res.status;
            throw err;
        }

        const cd = res.headers.get('Content-Disposition') || '';
        const m = cd.match(/filename="?([^";]+)"?/);
        const filename = m ? m[1] : defaultFilename;

        const blob = await res.blob();
        const blobUrl = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.style.display = 'none';
        a.href = blobUrl;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(blobUrl), 1000);
        return { success: true, filename };
    }

    async function fetchBlobUrl(path) {
        const fullUrl = normalizePath(path);
        const res = await fetch(fullUrl, { headers: authHeaders() });
        if (!res.ok) {
            handleUnauthorized(res);
            let detail = res.statusText;
            try { const d = await res.json(); detail = d.detail || detail; } catch {}
            const err = new Error(detail);
            err.status = res.status;
            throw err;
        }
        const blob = await res.blob();
        return URL.createObjectURL(blob);
    }

    return {
        get,
        post,
        put,
        del,
        upload,
        download,
        authUrl,
        authHeaders,
        getAuthHeaders,
        fetchBlobUrl,
        normalizePath,
    };
})();

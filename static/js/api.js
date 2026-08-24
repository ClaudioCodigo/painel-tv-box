/**
 * REST API helper — fetch wrapper com autenticação e tratamento de erros.
 */
const API = (() => {
    const BASE = '/api';

    function authHeaders(extra = {}) {
        const h = { ...extra };
        const t = (typeof AUTH !== 'undefined') ? AUTH.getToken() : '';
        if (t) h['Authorization'] = 'Bearer ' + t;
        return h;
    }

    /**
     * URL com token na query — para uso direto no browser
     * (img src, window.open), onde headers não podem ser enviados.
     */
    function authUrl(path) {
        const t = (typeof AUTH !== 'undefined') ? AUTH.getToken() : '';
        const sep = path.includes('?') ? '&' : '?';
        return `${path}${sep}token=${encodeURIComponent(t)}`;
    }

    function handleUnauthorized(res) {
        if (res.status === 401 && typeof AUTH !== 'undefined') {
            if (AUTH.isLoggedIn() && typeof UI !== 'undefined' && UI.createToast) {
                UI.createToast('Sessão expirada — faça login novamente', 'warning');
            }
            AUTH.requireLogin();
        }
    }

    async function request(method, path, body) {
        const url = `${BASE}${path}`;
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
        const url = `${BASE}${path}`;
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

    return { get, post, put, del, upload, authUrl };
})();

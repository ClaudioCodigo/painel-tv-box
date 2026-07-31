/**
 * WebSocket client com auto-reconnect.
 * Conecta ao ws://host/ws e expõe eventos globais.
 */
const WS = (() => {
    let ws = null;
    let reconnectTimer = null;
    let reconnectDelay = 1000;
    const maxReconnectDelay = 30000;
    const listeners = {};
    let connected = false;

    function getUrl() {
        const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
        const token = (typeof AUTH !== 'undefined') ? AUTH.getToken() : '';
        const q = token ? `?token=${encodeURIComponent(token)}` : '';
        return `${proto}//${location.host}/ws${q}`;
    }

    function connect() {
        if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) {
            return;
        }
        // Não conecta sem token (backend exige autenticação)
        if (typeof AUTH !== 'undefined' && !AUTH.getToken()) {
            return;
        }

        ws = new WebSocket(getUrl());

        ws.onopen = () => {
            console.log('[WS] Conectado');
            connected = true;
            reconnectDelay = 1000;
            emit('connected');
        };

        ws.onmessage = (event) => {
            try {
                const data = JSON.parse(event.data);
                emit(data.type || 'message', data);
            } catch (e) {
                console.warn('[WS] Mensagem não-JSON:', event.data);
            }
        };

        ws.onclose = (event) => {
            console.log(`[WS] Desconectado (${event.code})`);
            connected = false;
            ws = null;
            emit('disconnected');
            scheduleReconnect();
        };

        ws.onerror = (err) => {
            console.error('[WS] Erro:', err);
        };
    }

    function scheduleReconnect() {
        if (reconnectTimer) return;
        console.log(`[WS] Reconectando em ${reconnectDelay}ms...`);
        reconnectTimer = setTimeout(() => {
            reconnectTimer = null;
            connect();
            reconnectDelay = Math.min(reconnectDelay * 2, maxReconnectDelay);
        }, reconnectDelay);
    }

    function emit(type, data) {
        const handlers = listeners[type] || [];
        handlers.forEach(fn => fn(data));
        // also emit to 'all'
        const all = listeners['all'] || [];
        all.forEach(fn => fn({ type, data }));
    }

    function on(type, fn) {
        if (!listeners[type]) listeners[type] = [];
        listeners[type].push(fn);
    }

    function off(type, fn) {
        if (!listeners[type]) return;
        listeners[type] = listeners[type].filter(f => f !== fn);
    }

    function send(data) {
        if (ws && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify(data));
        }
    }

    function isConnected() {
        return connected;
    }

    // Auto-connect: só após login (token presente)
    document.addEventListener('DOMContentLoaded', connect);
    window.addEventListener('auth:logged-in', connect);
    window.addEventListener('auth:logged-out', () => {
        if (ws) { try { ws.close(); } catch (e) {} ws = null; }
    });

    return { connect, on, off, send, isConnected };
})();

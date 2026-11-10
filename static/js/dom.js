/**
 * Painel TV Box — Utilitários de DOM & Reconciliação (Fase 1 UX Overhaul)
 *   DOM.patch(container, newHtml) — Reconciliação com preservação de foco e scroll
 *   DOM.crossFadeImage(imgEl, newSrc) — Transição suave de imagens sem flicker
 */
const DOM = (() => {

    /**
     * Reconcilia o conteúdo de um container com novo HTML, preservando:
     * - Elemento atualmente focado (activeElement) e cursor/seleção
     * - Posição de scroll (scrollTop e scrollLeft)
     * - Instâncias de nós que possuem ID no DOM (diff mínimo)
     */
    function patch(container, newHtml) {
        if (!container) return;

        // Se o HTML for rigorosamente idêntico, evita qualquer mutação
        if (container.innerHTML === newHtml) return;

        // 1. Salvar estado de foco (apenas se o elemento focado estiver no container)
        let activeId = null;
        let activeElSelector = null;
        let selectionStart = null;
        let selectionEnd = null;

        const activeEl = document.activeElement;
        if (activeEl && activeEl !== document.body && container.contains(activeEl)) {
            if (activeEl.id) {
                activeId = activeEl.id;
            } else if (activeEl.name) {
                activeElSelector = `[name="${CSS.escape(activeEl.name)}"]`;
            } else if (activeEl.dataset && Object.keys(activeEl.dataset).length > 0) {
                const firstKey = Object.keys(activeEl.dataset)[0];
                activeElSelector = `[data-${firstKey}="${CSS.escape(activeEl.dataset[firstKey])}"]`;
            }

            if (activeEl.tagName === 'INPUT' || activeEl.tagName === 'TEXTAREA') {
                try {
                    selectionStart = activeEl.selectionStart;
                    selectionEnd = activeEl.selectionEnd;
                } catch (e) {}
            }
        }

        // 2. Salvar posição de scroll
        const scrollTop = container.scrollTop;
        const scrollLeft = container.scrollLeft;

        // 3. Parse do novo HTML
        const tmp = document.createElement('div');
        tmp.innerHTML = newHtml;
        const newChildren = Array.from(tmp.children);

        // Se o container atual estava vazio, injeta direto
        if (container.children.length === 0) {
            container.innerHTML = newHtml;
        } else {
            // Mapear nós filhos atuais que possuem ID
            const oldById = {};
            Array.from(container.children).forEach(el => {
                if (el.id) oldById[el.id] = el;
            });

            // Reconstruir preservando nós com ID
            const frag = document.createDocumentFragment();
            newChildren.forEach(newEl => {
                if (newEl.id && oldById[newEl.id]) {
                    const old = oldById[newEl.id];
                    // Se o outerHTML for diferente, atualiza atributos e innerHTML
                    if (old.outerHTML !== newEl.outerHTML) {
                        if (old.innerHTML !== newEl.innerHTML) {
                            old.innerHTML = newEl.innerHTML;
                        }
                        // Copiar/atualizar atributos
                        Array.from(newEl.attributes).forEach(attr => {
                            if (old.getAttribute(attr.name) !== attr.value) {
                                old.setAttribute(attr.name, attr.value);
                            }
                        });
                        // Remover atributos excluídos no novo nó
                        Array.from(old.attributes).forEach(attr => {
                            if (!newEl.hasAttribute(attr.name)) {
                                old.removeAttribute(attr.name);
                            }
                        });
                    }
                    frag.appendChild(old);
                    delete oldById[newEl.id];
                } else {
                    frag.appendChild(newEl.cloneNode(true));
                }
            });

            container.innerHTML = '';
            container.appendChild(frag);
        }

        // 4. Restaurar scroll
        container.scrollTop = scrollTop;
        container.scrollLeft = scrollLeft;

        // 5. Restaurar foco
        if (activeId || activeElSelector) {
            try {
                let el = null;
                if (activeId) el = document.getElementById(activeId);
                if (!el && activeElSelector) el = container.querySelector(activeElSelector);
                if (el && typeof el.focus === 'function') {
                    el.focus({ preventScroll: true });
                    if (selectionStart !== null && typeof el.setSelectionRange === 'function') {
                        el.setSelectionRange(selectionStart, selectionEnd);
                    }
                }
            } catch (e) {}
        }
    }

    /**
     * Atualiza o src de uma imagem com cross-fade suave, eliminando flicker.
     * Pré-carrega em memória antes de trocar o src real.
     */
    function crossFadeImage(imgEl, newSrc) {
        if (!imgEl || !newSrc) return;
        if (imgEl.src === newSrc || imgEl.dataset.loadingSrc === newSrc) return;

        // Se o usuário prefere movimento reduzido, troca sem transição
        if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
            imgEl.src = newSrc;
            return;
        }

        imgEl.dataset.loadingSrc = newSrc;
        const preload = new Image();
        preload.onload = () => {
            if (imgEl.dataset.loadingSrc !== newSrc) return; // cancelado por chamada posterior
            imgEl.style.transition = 'opacity 200ms ease';
            imgEl.style.opacity = '0';
            setTimeout(() => {
                if (imgEl.dataset.loadingSrc !== newSrc) return;
                imgEl.src = newSrc;
                requestAnimationFrame(() => {
                    imgEl.style.opacity = '1';
                    delete imgEl.dataset.loadingSrc;
                });
            }, 80);
        };
        preload.onerror = () => {
            delete imgEl.dataset.loadingSrc;
        };
        preload.src = newSrc;
    }

    /**
     * Adiciona a classe .stagger-item aos nós filhos de um container para animar a primeira entrada.
     * Atribui delays progressivos via CSS custom property (--i) para até 15 itens.
     * @param {string|HTMLElement} containerSelector - Seletor CSS ou elemento do container
     * @param {string} [itemSelector] - Seletor opcional para filtrar os itens filhos
     * @returns {Array<HTMLElement>} Lista dos elementos configurados
     */
    function stagger(containerSelector, itemSelector) {
        const container = (typeof containerSelector === 'string')
            ? document.querySelector(containerSelector)
            : containerSelector;
        if (!container) return [];

        const items = itemSelector
            ? Array.from(container.querySelectorAll(itemSelector))
            : Array.from(container.children);

        items.forEach((el, index) => {
            el.classList.add('stagger-item');
            const delayIndex = Math.min(index + 1, 15);
            el.style.setProperty('--i', String(delayIndex));
        });

        return items;
    }

    return {
        patch,
        crossFadeImage,
        stagger
    };
})();


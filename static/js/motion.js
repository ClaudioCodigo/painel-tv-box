/**
 * MOTION — helpers de animação (View Transitions API com fallback).
 * Spec §5.1: limita a transição a trocas de rota (não no mount inicial).
 */
const MOTION = (() => {
    function withTransition(render) {
        if (document.startViewTransition) {
            document.startViewTransition(render);
        } else {
            render();
        }
    }
    return { withTransition };
})();

const CFO_SERVICES_CONTEXT_KEY = 'cfo_services_context';
export function loadCFOServicesContext() {
    try {
        const raw = localStorage.getItem('finreport_cfo_context') || localStorage.getItem(CFO_SERVICES_CONTEXT_KEY);
        return raw ? JSON.parse(raw) : null;
    }
    catch {
        return null;
    }
}
export function saveCFOServicesContext(ctx) {
    localStorage.setItem(CFO_SERVICES_CONTEXT_KEY, JSON.stringify(ctx));
}

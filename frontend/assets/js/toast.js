/**
 * Accessible toast notification system.
 * Usage: Toast.success('Message') | Toast.error('Message') | Toast.info('Message') | Toast.warning('Message')
 */
const Toast = (() => {
    let container = null;

    const configurations = {
        success: { bg: '#dcfce7', border: '#16a34a', icon: 'fa-circle-check', text: '#15803d', title: 'Success' },
        error: { bg: '#fef2f2', border: '#dc2626', icon: 'fa-circle-xmark', text: '#b91c1c', title: 'Error' },
        warning: { bg: '#fffbeb', border: '#d97706', icon: 'fa-triangle-exclamation', text: '#b45309', title: 'Warning' },
        info: { bg: '#eff6ff', border: '#2563eb', icon: 'fa-circle-info', text: '#1d4ed8', title: 'Information' }
    };

    function ensureStyles() {
        if (document.getElementById('toast-styles')) return;
        const style = document.createElement('style');
        style.id = 'toast-styles';
        style.textContent = `
            @keyframes toastIn { from{opacity:0;transform:translateX(100%) scale(.96)} to{opacity:1;transform:translateX(0) scale(1)} }
            @keyframes toastOut { from{opacity:1;transform:translateX(0)} to{opacity:0;transform:translateX(110%)} }
            @keyframes toastProgress { from{width:100%} to{width:0} }
            @media (prefers-reduced-motion: reduce) {
                #toast-container * { animation-duration: .01ms !important; animation-iteration-count: 1 !important; }
            }
        `;
        document.head.appendChild(style);
    }

    function getContainer() {
        if (container?.isConnected) return container;
        container = document.createElement('div');
        container.id = 'toast-container';
        container.setAttribute('aria-live', 'polite');
        container.setAttribute('aria-atomic', 'false');
        container.style.cssText = `
            position:fixed;top:20px;right:20px;z-index:99999;
            display:flex;flex-direction:column;gap:10px;
            pointer-events:none;max-width:min(360px,calc(100vw - 32px));
        `;
        document.body.appendChild(container);
        return container;
    }

    function removeToast(toast) {
        if (!toast?.isConnected || toast.dataset.removing === 'true') return;
        toast.dataset.removing = 'true';
        toast.style.animation = 'toastOut .3s ease forwards';
        window.setTimeout(() => toast.remove(), 300);
    }

    function show(message, type = 'info', duration = 4000) {
        ensureStyles();
        const cfg = configurations[type] || configurations.info;
        const toast = document.createElement('div');
        toast.setAttribute('role', type === 'error' ? 'alert' : 'status');
        toast.style.cssText = `
            background:${cfg.bg};border:1.5px solid ${cfg.border};
            border-radius:12px;padding:14px 16px;display:flex;
            align-items:flex-start;gap:12px;box-shadow:0 8px 24px rgba(0,0,0,.12);
            pointer-events:auto;animation:toastIn .35s cubic-bezier(.34,1.56,.64,1) both;
            width:100%;min-width:min(280px,calc(100vw - 32px));
            font-family:'Manrope','Segoe UI',sans-serif;position:relative;overflow:hidden;
        `;

        const iconWrap = document.createElement('span');
        iconWrap.style.cssText = `font-size:18px;flex-shrink:0;margin-top:1px;color:${cfg.text}`;
        iconWrap.setAttribute('aria-hidden', 'true');
        const icon = document.createElement('i');
        icon.className = `fas ${cfg.icon}`;
        iconWrap.appendChild(icon);

        const content = document.createElement('div');
        content.style.flex = '1';
        const title = document.createElement('div');
        title.style.cssText = `font-size:13px;font-weight:700;color:${cfg.text};margin-bottom:2px`;
        title.textContent = cfg.title;
        const body = document.createElement('div');
        body.style.cssText = 'font-size:12px;color:#374151;line-height:1.5;overflow-wrap:anywhere';
        body.textContent = String(message ?? '');
        content.append(title, body);

        const closeButton = document.createElement('button');
        closeButton.type = 'button';
        closeButton.setAttribute('aria-label', 'Dismiss notification');
        closeButton.style.cssText = 'background:none;border:none;cursor:pointer;color:#6b7280;font-size:16px;padding:2px;flex-shrink:0;line-height:1';
        const closeIcon = document.createElement('i');
        closeIcon.className = 'fas fa-xmark';
        closeIcon.setAttribute('aria-hidden', 'true');
        closeButton.appendChild(closeIcon);
        closeButton.addEventListener('click', () => removeToast(toast));

        const progress = document.createElement('div');
        progress.setAttribute('aria-hidden', 'true');
        progress.style.cssText = `
            position:absolute;bottom:0;left:0;height:3px;background:${cfg.border};
            border-radius:0 0 12px 12px;animation:toastProgress ${Math.max(Number(duration) || 0, 0)}ms linear forwards;
        `;

        toast.append(iconWrap, content, closeButton, progress);
        getContainer().appendChild(toast);

        if (duration > 0) window.setTimeout(() => removeToast(toast), duration);
        return toast;
    }

    return {
        success: (message, duration) => show(message, 'success', duration ?? 4000),
        error: (message, duration) => show(message, 'error', duration ?? 5000),
        warning: (message, duration) => show(message, 'warning', duration ?? 4000),
        info: (message, duration) => show(message, 'info', duration ?? 4000)
    };
})();

window.Toast = Toast;

// Load the small page-specific final workflow layer only where it is needed.
// This keeps the existing stable HTML pages untouched while centralizing final fixes.
(() => {
    const page = String(window.location.pathname || '').split('/').pop().toLowerCase();
    if (!['payments.html', 'ticket-details.html', 'issue-ticket.html'].includes(page)) return;
    // api.js defines API with a global lexical binding; expose it to the enhancement module intentionally.
    if (typeof API !== 'undefined' && !window.API) window.API = API;
    const script = document.createElement('script');
    script.src = `../assets/js/workflow-enhancements.js?v=20260831b`;
    script.defer = true;
    document.body.appendChild(script);
})();

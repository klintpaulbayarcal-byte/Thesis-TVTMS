/**
 * Premium Toast Notification System
 * Municipal Traffic Violation Ticketing and Management System
 * Usage: Toast.success('Message') | Toast.error('Message') | Toast.info('Message') | Toast.warning('Message')
 */
const Toast = (() => {
    let container = null;

    function getContainer() {
        if (!container) {
            container = document.createElement('div');
            container.id = 'toast-container';
            container.style.cssText = `
                position: fixed; top: 20px; right: 20px; z-index: 99999;
                display: flex; flex-direction: column; gap: 10px;
                pointer-events: none; max-width: 360px;
            `;
            document.body.appendChild(container);
        }
        return container;
    }

    function show(message, type = 'info', duration = 4000) {
        const c = getContainer();
        const colors = {
            success: { bg: '#dcfce7', border: '#16a34a', icon: '<i class="fas fa-circle-check" aria-hidden="true"></i>', text: '#15803d', title: 'Success' },
            error:   { bg: '#fef2f2', border: '#dc2626', icon: '<i class="fas fa-circle-xmark" aria-hidden="true"></i>', text: '#b91c1c', title: 'Error' },
            warning: { bg: '#fffbeb', border: '#d97706', icon: '<i class="fas fa-triangle-exclamation" aria-hidden="true"></i>', text: '#b45309', title: 'Warning' },
            info:    { bg: '#eff6ff', border: '#2563eb', icon: 'ℹ️', text: '#1d4ed8', title: 'Info' },
        };
        const cfg = colors[type] || colors.info;

        const toast = document.createElement('div');
        toast.style.cssText = `
            background: ${cfg.bg}; border: 1.5px solid ${cfg.border};
            border-radius: 12px; padding: 14px 16px;
            display: flex; align-items: flex-start; gap: 12px;
            box-shadow: 0 8px 24px rgba(0,0,0,0.12);
            pointer-events: all; cursor: pointer;
            animation: toastIn 0.35s cubic-bezier(0.34,1.56,0.64,1) both;
            max-width: 360px; min-width: 280px;
            font-family: 'Manrope', 'Segoe UI', sans-serif;
            position: relative; overflow: hidden;
        `;

        toast.innerHTML = `
            <span style="font-size:18px;flex-shrink:0;margin-top:1px">${cfg.icon}</span>
            <div style="flex:1">
                <div style="font-size:13px;font-weight:700;color:${cfg.text};margin-bottom:2px">${cfg.title}</div>
                <div style="font-size:12px;color:#374151;line-height:1.5">${message}</div>
            </div>
            <button onclick="this.parentElement.remove()" style="background:none;border:none;cursor:pointer;color:#9ca3af;font-size:16px;padding:0;flex-shrink:0;line-height:1"><i class="fas fa-xmark" aria-hidden="true"></i></button>
            <div style="position:absolute;bottom:0;left:0;height:3px;background:${cfg.border};border-radius:0 0 12px 12px;
                animation:toastProgress ${duration}ms linear forwards"></div>
        `;

        // Inject keyframes once
        if (!document.getElementById('toast-styles')) {
            const style = document.createElement('style');
            style.id = 'toast-styles';
            style.textContent = `
                @keyframes toastIn { from{opacity:0;transform:translateX(100%) scale(0.9)} to{opacity:1;transform:translateX(0) scale(1)} }
                @keyframes toastOut { from{opacity:1;transform:translateX(0)} to{opacity:0;transform:translateX(110%)} }
                @keyframes toastProgress { from{width:100%} to{width:0%} }
            `;
            document.head.appendChild(style);
        }

        toast.onclick = () => removeToast(toast);
        c.appendChild(toast);

        setTimeout(() => removeToast(toast), duration);
        return toast;
    }

    function removeToast(toast) {
        if (!toast.parentElement) return;
        toast.style.animation = 'toastOut 0.3s ease forwards';
        setTimeout(() => toast.remove(), 300);
    }

    return {
        success: (msg, dur) => show(msg, 'success', dur),
        error:   (msg, dur) => show(msg, 'error',   dur || 5000),
        warning: (msg, dur) => show(msg, 'warning', dur),
        info:    (msg, dur) => show(msg, 'info',    dur),
    };
})();

// Override window.alert globally with toast
window._originalAlert = window.alert;
window.alert = (msg) => Toast.info(String(msg));

        const PASSWORD_RESET_API_ORIGIN = (window.APP_CONFIG && window.APP_CONFIG.API_ORIGIN) || location.origin;

        function openForgotModal() {
            const m = document.getElementById('forgotModal');
            if (m) { m.style.display = 'flex'; }
            setTimeout(() => document.getElementById('forgotEmailInput')?.focus(), 100);
        }
        function closeForgotModal() {
            const m = document.getElementById('forgotModal');
            if (m) m.style.display = 'none';
            const msg = document.getElementById('forgotMsg');
            if (msg) msg.style.display = 'none';
            const inp = document.getElementById('forgotEmailInput');
            if (inp) inp.value = '';
        }
        async function submitForgotPassword() {
            const email = document.getElementById('forgotEmailInput')?.value.trim();
            const msg = document.getElementById('forgotMsg');
            const btn = document.getElementById('forgotSubmitBtn');

            if (!email) {
                if (msg) {
                    msg.style.display = 'block'; msg.style.background = '#fef2f2';
                    msg.style.color = '#b91c1c'; msg.textContent = 'Please enter your email address.';
                }
                return;
            }

            btn.disabled = true; btn.textContent = 'Sending...';
            try {
                const res = await fetch(`${PASSWORD_RESET_API_ORIGIN}/api/auth/request-password-reset`, {
                    method: 'POST', headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ email })
                });
                const data = await res.json();
                if (msg) {
                    msg.style.display = 'block';
                    if (data.success || res.ok) {
                        msg.style.background = '#dcfce7'; msg.style.color = '#15803d';
                        msg.textContent = 'Reset link sent. Check your email inbox.';
                        btn.textContent = 'Sent!';
                    } else {
                        msg.style.background = '#fef2f2'; msg.style.color = '#b91c1c';
                        msg.textContent = data.message || 'Email not found in the system.';
                        btn.disabled = false; btn.textContent = 'Send Reset Link';
                    }
                }
            } catch (e) {
                if (msg) {
                    msg.style.display = 'block'; msg.style.background = '#fef2f2';
                    msg.style.color = '#b91c1c'; msg.textContent = 'Cannot connect to server.';
                }
                btn.disabled = false; btn.textContent = 'Send Reset Link';
            }
        }
        // Close modal on backdrop click
        document.getElementById('forgotModal')?.addEventListener('click', function (e) {
            if (e.target === this) closeForgotModal();
        });

// Bind page events without CSP-blocked inline attributes.
document.querySelector('[data-page-event-1]').addEventListener('click', function (event) { closeForgotModal() });
document.querySelector('[data-page-event-2]').addEventListener('focus', function (event) { this.style.borderColor='#2563eb' });
document.querySelector('[data-page-event-3]').addEventListener('blur', function (event) { this.style.borderColor='#e2e8f0' });
document.querySelector('[data-page-event-4]').addEventListener('keydown', function (event) { if(event.key==='Enter')submitForgotPassword() });
document.querySelector('[data-page-event-5]').addEventListener('click', function (event) { submitForgotPassword() });
document.querySelectorAll('img').forEach(image => { if (image.complete && image.naturalWidth === 0) image.dispatchEvent(new Event('error')); });

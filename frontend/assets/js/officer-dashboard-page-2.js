    // ── Populate Officer Welcome Card ──
    (function() {
        const user = JSON.parse(localStorage.getItem('user') || '{}');
        const nameEl = document.getElementById('welcomeOfficerName');
        const dateEl = document.getElementById('welcomeDate');

        if (nameEl && user.name) {
            const firstName = user.name.split(' ')[0];
            nameEl.textContent = 'Welcome back, Officer ' + firstName + '!';
        }

        if (dateEl) {
            const now = new Date();
            const opts = { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' };
            dateEl.textContent = now.toLocaleDateString('en-PH', opts) +
                ' · ' + now.toLocaleTimeString('en-PH', { hour: '2-digit', minute: '2-digit' });
        }
    })();

// Bind page events without CSP-blocked inline attributes.
document.querySelector('[data-page-event-1]').addEventListener('error', function (event) { this.style.display='none';this.nextElementSibling.style.display='flex' });
document.querySelector('[data-page-event-2]').addEventListener('click', function (event) { logout() });
document.querySelector('[data-page-event-3]').addEventListener('mouseover', function (event) { this.style.transform='translateY(-2px)' });
document.querySelector('[data-page-event-4]').addEventListener('mouseout', function (event) { this.style.transform='translateY(0)' });
document.querySelector('[data-page-event-5]').addEventListener('mouseover', function (event) { this.style.background='rgba(255,255,255,0.25)' });
document.querySelector('[data-page-event-6]').addEventListener('mouseout', function (event) { this.style.background='rgba(255,255,255,0.15)' });

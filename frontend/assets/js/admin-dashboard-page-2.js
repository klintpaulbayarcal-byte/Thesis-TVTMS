    // ── Admin Welcome Card ──
    (function() {
        const user = JSON.parse(localStorage.getItem('user') || '{}');
        const nameEl = document.getElementById('welcomeAdminName');
        const dateEl = document.getElementById('adminWelcomeDate');
        if (nameEl && user.name) nameEl.textContent = 'Welcome, ' + user.name + '!';
        if (dateEl) {
            const opts = { weekday:'long', year:'numeric', month:'long', day:'numeric' };
            dateEl.textContent = new Date().toLocaleDateString('en-PH', opts);
        }
    })();

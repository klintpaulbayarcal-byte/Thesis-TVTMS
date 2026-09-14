        // Auth state debugging

        // Check authentication
        if (!isAuthenticated()) {
            window.location.href = 'login.html';
        }

        // Search functionality from topbar
        document.getElementById('topSearchInput')?.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                const query = e.target.value.trim();
                if (query) {
                    window.location.href = `view-tickets.html?search=${encodeURIComponent(query)}`;
                }
            }
        });

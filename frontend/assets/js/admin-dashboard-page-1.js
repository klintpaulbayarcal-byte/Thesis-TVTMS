        // Auth state debugging

        // Check authentication
        if (!isAuthenticated()) {
            window.location.href = 'login.html';
        }

        if (!isAdmin()) {
            window.location.href = 'officer-dashboard.html';
        }

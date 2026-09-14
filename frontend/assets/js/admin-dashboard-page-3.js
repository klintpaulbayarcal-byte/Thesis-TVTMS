    // ── Feature 7: Admin Executive Summary (real data only, computed from existing endpoints) ──
    (function() {
        const listEl = document.getElementById('execSummaryList');
        if (!listEl) return;

        const summaryTile = (icon, label, value, sub) => `
            <div class="stat-card" style="height:100%;">
                <div class="stat-header">
                    <div class="stat-icon"><i class="fas ${icon}"></i></div>
                </div>
                <div class="stat-label">${escapeHtmlText(label)}</div>
                <h2 class="stat-value" style="font-size:22px;">${escapeHtmlText(value)}</h2>
                ${sub ? `<div class="stat-footer">${escapeHtmlText(sub)}</div>` : ''}
            </div>
        `;

        Promise.allSettled([
            API.getUsers(),
            API.getDisputes({ status: 'submitted' }),
            API.getDisputes({ status: 'under_review' }),
            API.getTickets({ scope: 'all', pageSize: 500 })
        ]).then(([usersRes, submittedRes, reviewRes, ticketsRes]) => {
            const users = usersRes.status === 'fulfilled'
                ? (usersRes.value?.users || usersRes.value?.data || []) : [];
            const activeOfficers = users.filter(u => u.role === 'apprehending_officer' && u.status === 'active').length;

            const submitted = submittedRes.status === 'fulfilled'
                ? (submittedRes.value?.disputes || submittedRes.value?.data || []) : [];
            const underReview = reviewRes.status === 'fulfilled'
                ? (reviewRes.value?.disputes || reviewRes.value?.data || []) : [];
            const pendingDisputes = submitted.length + underReview.length;

            const tickets = ticketsRes.status === 'fulfilled'
                ? (ticketsRes.value?.tickets || ticketsRes.value?.data || []) : [];

            // Most common violation (from real ticket data already available).
            let mostCommonViolation = 'N/A';
            if (tickets.length > 0) {
                const violationCounts = tickets.reduce((acc, t) => {
                    const name = t.violation_name || 'Unspecified';
                    acc[name] = (acc[name] || 0) + 1;
                    return acc;
                }, {});
                const top = Object.entries(violationCounts).sort((a, b) => b[1] - a[1])[0];
                if (top) mostCommonViolation = `${top[0]} (${top[1]})`;
            }

            // Most active barangay (from real ticket location data already available).
            let mostActiveBarangay = 'N/A';
            if (tickets.length > 0) {
                const barangayCounts = tickets.reduce((acc, t) => {
                    const name = extractBarangayName(t.location);
                    acc[name] = (acc[name] || 0) + 1;
                    return acc;
                }, {});
                const top = Object.entries(barangayCounts).sort((a, b) => b[1] - a[1])[0];
                if (top) mostActiveBarangay = `${top[0]} (${top[1]})`;
            }

            listEl.innerHTML =
                summaryTile('fa-user-shield', 'Active Officers', activeOfficers, 'Currently enabled to issue tickets') +
                summaryTile('fa-gavel', 'Pending Disputes', pendingDisputes, 'Submitted + Under Review') +
                summaryTile('fa-exclamation-triangle', 'Most Common Violation', mostCommonViolation, 'All-time, by ticket count') +
                summaryTile('fa-map-marker-alt', 'Most Active Barangay', mostActiveBarangay, 'All-time, by ticket count');
        }).catch((err) => {
            console.error('Executive Summary failed to load:', err);
            listEl.innerHTML = '<p class="text-center" style="grid-column:1/-1;">Unable to load summary right now.</p>';
        });
    })();

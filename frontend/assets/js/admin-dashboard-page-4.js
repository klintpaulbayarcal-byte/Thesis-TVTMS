    // ── Feature 6: Admin Action Center (real data only, clean empty state) ──
    (function() {
        const listEl = document.getElementById('actionCenterList');
        if (!listEl) return;

        const actionItemHtml = (icon, colorClass, count, label, href, emptyLabel) => {
            const isEmpty = !count || count === 0;
            return `
                <a href="${href}" style="text-decoration:none; color:inherit;">
                    <div class="stat-card ${isEmpty ? '' : colorClass}" style="cursor:pointer; height:100%;">
                        <div class="stat-header">
                            <div class="stat-icon"><i class="fas ${icon}"></i></div>
                        </div>
                        <div class="stat-label">${escapeHtmlText(label)}</div>
                        <h2 class="stat-value">${count}</h2>
                        <div class="stat-footer">
                            <i class="fas ${isEmpty ? 'fa-check' : 'fa-arrow-right'}"></i>
                            ${isEmpty ? emptyLabel : 'Review now'}
                        </div>
                    </div>
                </a>
            `;
        };

        Promise.allSettled([
            API.getDisputes({ status: 'submitted' }),
            API.getDisputes({ status: 'under_review' }),
            API.getTickets({ scope: 'all', pageSize: 200 })
        ]).then(([submittedRes, reviewRes, ticketsRes]) => {
            const submitted = submittedRes.status === 'fulfilled'
                ? (submittedRes.value?.disputes || submittedRes.value?.data || []) : [];
            const underReview = reviewRes.status === 'fulfilled'
                ? (reviewRes.value?.disputes || reviewRes.value?.data || []) : [];
            const pendingDisputeCount = submitted.length + underReview.length;

            const allTickets = ticketsRes.status === 'fulfilled'
                ? (ticketsRes.value?.tickets || ticketsRes.value?.data || []) : [];

            const overdueCount = allTickets.filter(t => t.status === 'unpaid').length;

            // Recent cancellations = tickets cancelled within the last 7 days
            const sevenDaysAgo = new Date();
            sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
            const recentCancellations = allTickets.filter(t => {
                if (t.status !== 'cancelled') return false;
                const updated = new Date(t.updated_at || t.date_issued);
                return updated >= sevenDaysAgo;
            }).length;

            listEl.innerHTML =
                actionItemHtml('fa-gavel', 'danger', pendingDisputeCount, 'Pending Disputes', 'disputes.html', 'No disputes waiting') +
                actionItemHtml('fa-hourglass-half', 'warning', overdueCount, 'Unpaid Tickets', 'view-tickets.html?status=unpaid', 'All tickets settled') +
                actionItemHtml('fa-ban', 'danger', recentCancellations, 'Recent Cancellations (7 days)', 'view-tickets.html?status=cancelled', 'None this week');
        }).catch((err) => {
            console.error('Action Center failed to load:', err);
            listEl.innerHTML = '<p class="text-center" style="grid-column:1/-1;">Unable to load action items right now.</p>';
        });
    })();

// Bind page events without CSP-blocked inline attributes.
document.querySelector('[data-page-event-1]').addEventListener('error', function (event) { this.style.display='none';this.nextElementSibling.style.display='flex' });
document.querySelector('[data-page-event-2]').addEventListener('click', function (event) { logout() });
document.querySelector('[data-page-event-3]').addEventListener('mouseover', function (event) { this.style.background='rgba(255,255,255,0.2)' });
document.querySelector('[data-page-event-4]').addEventListener('mouseout', function (event) { this.style.background='rgba(255,255,255,0.12)' });
document.querySelector('[data-page-event-5]').addEventListener('mouseover', function (event) { this.style.background='rgba(255,255,255,0.2)' });
document.querySelector('[data-page-event-6]').addEventListener('mouseout', function (event) { this.style.background='rgba(255,255,255,0.12)' });
document.querySelector('[data-page-event-7]').addEventListener('mouseover', function (event) { this.style.transform='translateY(-1px)' });
document.querySelector('[data-page-event-8]').addEventListener('mouseout', function (event) { this.style.transform='translateY(0)' });

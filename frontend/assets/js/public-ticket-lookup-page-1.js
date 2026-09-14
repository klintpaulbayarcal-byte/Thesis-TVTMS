        const API_ORIGIN = (window.APP_CONFIG && window.APP_CONFIG.API_ORIGIN) || location.origin;
        const API = `${API_ORIGIN}/api/public`;
        let currentLookupTickets = [];

        document.querySelectorAll('[data-tab]').forEach((button) => {
            button.addEventListener('click', () => switchTab(button.dataset.tab));
        });
        ['plateInput', 'ticketInput'].forEach((id) => {
            const input = document.getElementById(id);
            input.addEventListener('input', () => {
                input.value = input.value.toUpperCase();
            });
            input.addEventListener('keydown', (event) => {
                if (event.key !== 'Enter') return;
                event.preventDefault();
                if (id === 'plateInput') searchByPlate();
                else searchByTicket();
            });
        });
        document.getElementById('searchByPlateButton').addEventListener('click', searchByPlate);
        document.getElementById('searchByTicketButton').addEventListener('click', searchByTicket);
        document.getElementById('resultsSection').addEventListener('click', (event) => {
            const button = event.target.closest('[data-dispute-ticket]');
            if (button) openDispute(button.dataset.disputeTicket);
        });

        function switchTab(tab) {
            document.querySelectorAll('.tab-btn').forEach((button) => {
                const active = button.dataset.tab === tab;
                button.classList.toggle('active', active);
                button.setAttribute('aria-selected', String(active));
            });
            document.getElementById('panel-plate').classList.toggle('active', tab === 'plate');
            document.getElementById('panel-ticket').classList.toggle('active', tab === 'ticket');
        }

        function showLookupError(message, inputId) {
            const section = document.getElementById('resultsSection');
            section.style.display = 'block';
            section.innerHTML = `<div class="error-msg"><i class="fas fa-exclamation-circle" aria-hidden="true"></i> ${escapeHtml(message)}</div>`;
            document.getElementById(inputId)?.focus();
        }

        async function searchByPlate() {
            const plate = document.getElementById('plateInput').value.trim();
            if (!plate) {
                showLookupError('Please enter a plate number.', 'plateInput');
                return;
            }
            await doSearch({ plate });
        }

        async function searchByTicket() {
            const ticket = document.getElementById('ticketInput').value.trim();
            if (!ticket) {
                showLookupError('Please enter a ticket number.', 'ticketInput');
                return;
            }
            await doSearch({ ticket });
        }

        async function doSearch(params) {
            const section = document.getElementById('resultsSection');
            currentLookupTickets = [];
            resetDisputeSelection();
            section.style.display = 'block';
            section.innerHTML = '<div class="loading"><i class="fas fa-spinner fa-spin"></i> Searching...</div>';

            try {
                const qs = new URLSearchParams(params).toString();
                const res = await fetch(`${API}/ticket-lookup?${qs}`);
                const data = await res.json();

                if (!res.ok) {
                    section.innerHTML = `<div class="error-msg"><i class="fas fa-exclamation-circle"></i> ${escapeHtml(data.message || 'An error occurred.')}</div>`;
                    return;
                }

                if (!data.tickets || data.tickets.length === 0) {
                    section.innerHTML = `
                        <div class="no-results">
                            <i class="fas fa-ticket-alt"></i>
                            <p><strong>No tickets found</strong></p>
                            <p style="font-size:0.85rem;margin-top:0.35rem;color:#6b7280;font-weight:650">Double-check the plate or ticket number and try again.</p>
                        </div>`;
                    return;
                }

                currentLookupTickets = data.tickets;
                renderResults(data.tickets);
            } catch (e) {
                section.innerHTML = `<div class="error-msg"><i class="fas fa-wifi"></i> Cannot connect to server. Make sure the system is running.</div>`;
            }
        }

        function renderResults(tickets) {
            const section = document.getElementById('resultsSection');
            const statusLabel = { unpaid: 'Unpaid', paid: 'Paid', cancelled: 'Cancelled' };

            let html = `<div class="result-count">${tickets.length} ticket${tickets.length !== 1 ? 's' : ''} found</div>`;

            for (const t of tickets) {
                const isPaid = t.status === 'paid';
                const dateStr = t.date_issued
                    ? new Date(t.date_issued).toLocaleDateString('en-PH', { year: 'numeric', month: 'long', day: 'numeric' })
                    : '—';

                const penalty = Number(t.remaining_balance ?? t.penalty_amount ?? 0);
                const demerits = Number(t.demerit_points || 0);

                const vehicleType = capitalize(t.vehicle_type || '');
                const rawTicketNo = String(t.ticket_number || '');
                const ticketNo = escapeHtml(rawTicketNo || '—');
                const encodedTicketNo = encodeURIComponent(rawTicketNo).replace(/'/g, '%27');
                const safeStatus = ['unpaid', 'paid', 'cancelled'].includes(t.status) ? t.status : 'unpaid';
                const disputeEligible = t.dispute_eligible === true;
                const disputeMessage = t.dispute_message || 'Dispute filing is not available for this ticket.';

                html += `
                <div class="ticket-card status-${safeStatus}">
                    <div class="ticket-header">
                        <div>
                            <div class="ticket-number">${ticketNo}</div>
                            <div class="ticket-plate"><i class="fas fa-car"></i> ${escapeHtml(t.plate_number || '—')} &bull; ${escapeHtml(vehicleType || '—')}</div>
                        </div>
                        <span class="status-badge ${safeStatus}">${escapeHtml(statusLabel[safeStatus] || safeStatus)}</span>
                    </div>

                    <div class="ticket-detail-grid">
                        <div class="ticket-detail full">
                            <div class="label">Violation</div>
                            <div class="value">${escapeHtml(t.violation_name || '—')} <span style="color:#6b7280;font-weight:700">(${escapeHtml(t.violation_code || '—')})</span></div>
                        </div>

                        <div class="ticket-detail">
                            <div class="label">Date Issued</div>
                            <div class="value">${escapeHtml(dateStr)}</div>
                        </div>

                        <div class="ticket-detail">
                            <div class="label">Amount Due</div>
                            <div class="${isPaid ? 'penalty-paid' : 'penalty-amount'} value">
                                ${isPaid
                        ? 'PAID'
                        : '₱' + penalty.toLocaleString('en-PH', { minimumFractionDigits: 2 })}
                            </div>
                        </div>

                        ${t.location ? `
                        <div class="ticket-detail full">
                            <div class="label">Location</div>
                            <div class="value">${escapeHtml(t.location)}</div>
                        </div>` : ''}

                        ${demerits > 0 ? `
                        <div class="ticket-detail">
                            <div class="label">Demerit Points</div>
                            <div class="value">${demerits} pts</div>
                        </div>` : ''}

                        ${isPaid && t.payment_date ? `
                        <div class="ticket-detail">
                            <div class="label">Paid On</div>
                            <div class="value">${escapeHtml(new Date(t.payment_date).toLocaleDateString('en-PH'))}</div>
                        </div>` : ''}

                        ${disputeEligible ? `
                        <div class="ticket-detail full" style="margin-top:4px;">
                            <button type="button" class="btn-search" style="padding:0.85rem 1rem;border-radius:14px;box-shadow:none;display:flex;gap:10px;justify-content:center;align-items:center;background:linear-gradient(135deg,#ef4444,#dc2626)" data-dispute-ticket="${encodedTicketNo}">
                                <i class="fa-solid fa-scale-balanced"></i> Select for Dispute
                            </button>
                        </div>` : `
                        <div class="ticket-detail full dispute-ineligible">
                            <i class="fa-solid fa-circle-info" aria-hidden="true"></i>
                            <span>${escapeHtml(disputeMessage)}</span>
                        </div>`}
                    </div>
                </div>`;
            }

            section.innerHTML = html;
        }

        function openDispute(ticketNumberEncoded) {
            const ticketNumber = decodeURIComponent(ticketNumberEncoded);
            const ticket = currentLookupTickets.find(item => String(item.ticket_number) === ticketNumber);
            if (!ticket || ticket.dispute_eligible !== true) return;

            document.getElementById('disputeTicketNum').value = ticketNumber;
            const issuedDate = ticket.date_issued
                ? new Date(ticket.date_issued).toLocaleDateString('en-PH', { year: 'numeric', month: 'short', day: 'numeric' })
                : '—';
            document.getElementById('selectedDisputeTicket').innerHTML = `
                <div class="summary-item">
                    <div class="summary-label">Selected Ticket</div>
                    <div class="summary-value">${escapeHtml(ticketNumber)}</div>
                </div>
                <div class="summary-item">
                    <div class="summary-label">Plate Number</div>
                    <div class="summary-value">${escapeHtml(ticket.plate_number || '—')}</div>
                </div>
                <div class="summary-item">
                    <div class="summary-label">Date Issued</div>
                    <div class="summary-value">${escapeHtml(issuedDate)}</div>
                </div>
                <div class="summary-item">
                    <div class="summary-label">Status</div>
                    <div class="summary-value">Unpaid</div>
                </div>
                <div class="summary-item full">
                    <div class="summary-label">Violation</div>
                    <div class="summary-value">${escapeHtml(ticket.violation_name || '—')}</div>
                </div>`;
            document.getElementById('disputeSuccess').style.display = 'none';
            document.getElementById('disputeError').style.display = 'none';
            document.getElementById('disputeSection').style.display = 'block';
            document.getElementById('disputeReason').focus();
            // keep user context by scrolling nicely
            document.getElementById('disputeSection').scrollIntoView({ behavior: 'smooth', block: 'start' });
        }

        function resetDisputeSelection() {
            document.getElementById('publicDisputeForm').reset();
            document.getElementById('selectedDisputeTicket').innerHTML = '';
            document.getElementById('disputeSuccess').style.display = 'none';
            document.getElementById('disputeError').style.display = 'none';
            document.getElementById('disputeSection').style.display = 'none';
        }

        function capitalize(str) {
            return str ? str.charAt(0).toUpperCase() + str.slice(1) : '';
        }

        function escapeHtml(str) {
            return String(str ?? '').replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
        }

        // Pre-fill from URL params (QR code support)
        window.addEventListener('DOMContentLoaded', () => {
            const params = new URLSearchParams(window.location.search);
            const plate = params.get('plate');
            const ticket = params.get('ticket');

            if (ticket) {
                switchTab('ticket');
                document.getElementById('ticketInput').value = ticket.toUpperCase();
                doSearch({ ticket });
            } else if (plate) {
                document.getElementById('plateInput').value = plate.toUpperCase();
                doSearch({ plate });
            }
        });

        // Dispute submit (no login required)
        document.getElementById('publicDisputeForm').addEventListener('submit', async function (e) {
            e.preventDefault();
            const btn = document.getElementById('submitDisputeBtn');
            if (btn.dataset.submitting === 'true') return;

            const ticketNumber = document.getElementById('disputeTicketNum').value;
            const reason = document.getElementById('disputeReason').value.trim();
            const error = document.getElementById('disputeError');
            if (!ticketNumber || reason.length < 10 || reason.length > 4000) {
                error.textContent = 'Select an eligible ticket and enter a reason of 10–4000 characters.';
                error.style.display = 'block';
                return;
            }

            btn.dataset.submitting = 'true';
            btn.disabled = true;
            btn.setAttribute('aria-busy', 'true');
            btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Submitting...';

            const success = document.getElementById('disputeSuccess');
            success.style.display = 'none';
            error.style.display = 'none';

            try {
                const res = await fetch(`${API}/dispute`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        ticket_number: ticketNumber,
                        reason
                    })
                });

                const data = await res.json();

                if (data.success) {
                    success.style.display = 'block';
                    error.style.display = 'none';
                    document.getElementById('disputeReason').value = '';
                    document.getElementById('disputeTicketNum').value = '';
                    const submittedTicket = currentLookupTickets.find(item => String(item.ticket_number) === ticketNumber);
                    if (submittedTicket) {
                        submittedTicket.dispute_eligible = false;
                        submittedTicket.dispute_message = 'A dispute is already open for this ticket.';
                        renderResults(currentLookupTickets);
                    }
                } else {
                    error.textContent = data.message || 'Failed to submit dispute.';
                    error.style.display = 'block';
                }
            } catch (err) {
                error.textContent = 'Connection error. Please try again.';
                error.style.display = 'block';
            } finally {
                btn.dataset.submitting = 'false';
                btn.disabled = false;
                btn.removeAttribute('aria-busy');
                btn.innerHTML = '<i class="fa-solid fa-paper-plane"></i> Submit Dispute';
            }
        });

// Bind page events without CSP-blocked inline attributes.
document.querySelector('[data-page-event-1]').addEventListener('error', function (event) { this.style.display='none' });
document.querySelectorAll('img').forEach(image => { if (image.complete && image.naturalWidth === 0) image.dispatchEvent(new Event('error')); });

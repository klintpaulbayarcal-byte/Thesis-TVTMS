/**
 * Final workflow enhancements for the thesis production build.
 * Keeps stable pages intact while improving payment selection, ticket GPS fallback,
 * and consistent optional driver's-license validation.
 */
(() => {
    'use strict';

    const page = String(window.location.pathname || '').split('/').pop().toLowerCase();

    const escapeText = (value) => typeof window.escapeHtmlText === 'function'
        ? window.escapeHtmlText(value)
        : String(value ?? '').replace(/[&<>"']/g, char => ({
            '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;'
        }[char]));

    const money = (value) => typeof window.formatCurrency === 'function'
        ? window.formatCurrency(Number(value || 0))
        : `₱${Number(value || 0).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

    function initIssueTicketEnhancements() {
        const locationInput = document.getElementById('location');
        const gpsButton = document.getElementById('gpsBtn');
        const gpsStatus = document.getElementById('gpsStatus');
        const licenseInput = document.getElementById('driverLicenseNumber');
        const form = document.getElementById('issueTicketForm');
        if (!form) return;

        // Match Search Violator's minimum driver's-license rule when a license is supplied.
        if (licenseInput) {
            licenseInput.minLength = 5;
            licenseInput.maxLength = 30;
            licenseInput.addEventListener('input', () => {
                licenseInput.value = licenseInput.value.toUpperCase();
                const value = licenseInput.value.trim();
                licenseInput.setCustomValidity(value && value.length < 5
                    ? 'Driver license number must contain at least 5 characters.'
                    : '');
            });
        }

        // Capture submission before the existing issue handler so inconsistent short values never reach the API.
        form.addEventListener('submit', (event) => {
            const value = String(licenseInput?.value || '').trim();
            if (value && value.length < 5) {
                event.preventDefault();
                event.stopImmediatePropagation();
                if (typeof window.showAlert === 'function') {
                    window.showAlert('Driver license number must contain at least 5 characters, or leave it blank when unavailable.', 'warning');
                }
                licenseInput?.focus();
            }
        }, true);

        const resetGpsButton = () => {
            if (!gpsButton) return;
            gpsButton.disabled = false;
            gpsButton.innerHTML = '<i class="fas fa-map-marker-alt"></i> GPS';
        };

        const showGpsUnavailable = (message) => {
            gpsStatus.textContent = message;
            resetGpsButton();
            locationInput.focus();
        };

        // Override the older GPS helper with permission-aware diagnostics and a manual fallback.
        window.fillGPS = async function fillGPS() {
            if (!gpsButton || !gpsStatus || !locationInput) return;
            if (!window.isSecureContext) {
                showGpsUnavailable('GPS requires a secure HTTPS connection. Enter the location manually.');
                return;
            }
            if (!navigator.geolocation) {
                showGpsUnavailable('This browser cannot provide GPS. Open the site in Chrome, Edge, or a mobile browser, or enter the location manually.');
                return;
            }

            if (navigator.permissions?.query) {
                try {
                    const permission = await navigator.permissions.query({ name: 'geolocation' });
                    if (permission.state === 'denied') {
                        showGpsUnavailable('Location permission is blocked. Allow Location in this site\'s browser settings, then tap GPS again.');
                        return;
                    }
                    if (permission.state === 'prompt') {
                        gpsStatus.textContent = 'Allow Location when your browser asks, or enter the location manually.';
                    }
                } catch (_) {
                    // Some browsers support geolocation without exposing the Permissions API.
                }
            }

            gpsButton.disabled = true;
            gpsButton.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Getting...';
            if (!gpsStatus.textContent) gpsStatus.textContent = 'Getting your location...';

            navigator.geolocation.getCurrentPosition(
                ({ coords }) => {
                    locationInput.value = `${coords.latitude.toFixed(6)}, ${coords.longitude.toFixed(6)}`;
                    gpsStatus.innerHTML = '<span style="color:#2e7d32"><i class="fas fa-location-crosshairs" aria-hidden="true"></i> GPS location added. You can edit it manually if needed.</span>';
                    resetGpsButton();
                },
                (error) => {
                    const messages = {
                        1: 'Location permission was denied. Allow Location in this site\'s browser settings, then tap GPS again.',
                        2: 'Device location is unavailable. Turn on Location Services or GPS, then tap GPS again.',
                        3: 'GPS could not get a location within 15 seconds. Move near a window, turn on Location Services, retry, or enter the location manually.'
                    };
                    showGpsUnavailable(messages[error.code] || 'GPS is currently unavailable. Retry or enter the location manually.');
                },
                { timeout: 15000, maximumAge: 300000, enableHighAccuracy: false }
            );
        };

        locationInput?.addEventListener('input', () => {
            if (locationInput.value.trim()) gpsStatus.textContent = 'Manual location entered.';
        });
    }

    function initTicketDetailsEnhancements() {
        // Keep one authoritative payment workflow instead of collecting OR/amount in two different UIs.
        window.recordPayment = function recordPayment() {
            const params = new URLSearchParams(window.location.search);
            const ticketId = Number(params.get('id'));
            if (!Number.isInteger(ticketId) || ticketId <= 0) {
                if (typeof window.showAlert === 'function') window.showAlert('Unable to open payment workflow: invalid ticket.', 'warning');
                return;
            }
            window.location.href = `payments.html?ticket=${encodeURIComponent(ticketId)}`;
        };
    }

    function initPaymentsEnhancements() {
        const dashboard = document.querySelector('.dashboard-content');
        if (!dashboard || typeof window.API === 'undefined') return;

        dashboard.innerHTML = `
            <div class="card">
                <div class="card-header"><h3 class="card-title">Find Ticket to Pay</h3></div>
                <div class="card-body">
                    <div class="row">
                        <div class="col-9 form-group">
                            <label for="paymentTicketSearch">Ticket Number or Plate Number</label>
                            <input type="text" id="paymentTicketSearch" placeholder="e.g., TVT-2026-000001 or ABC1234" autocomplete="off">
                            <small class="field-hint">Search using the ticket number or plate number. Internal database IDs are handled automatically.</small>
                        </div>
                        <div class="col-3 form-group" style="display:flex;align-items:flex-end;">
                            <button type="button" id="paymentTicketSearchButton" class="btn btn-primary" style="width:100%;">
                                <i class="fas fa-search" aria-hidden="true"></i> Search
                            </button>
                        </div>
                    </div>
                    <div id="paymentTicketResults" aria-live="polite"></div>
                </div>
            </div>

            <div class="card" id="selectedPaymentCard" style="display:none;">
                <div class="card-header"><h3 class="card-title">Record Payment</h3></div>
                <div class="card-body">
                    <div id="selectedPaymentTicketSummary" style="padding:14px 16px;margin-bottom:18px;border:1px solid #d9e0ea;border-radius:12px;background:#f8fafc;"></div>
                    <form id="enhancedPaymentForm" class="row">
                        <input type="hidden" id="enhancedPaymentTicketId">
                        <div class="col-4 form-group">
                            <label for="enhancedOrNumber" class="required">Official Receipt (OR) Number</label>
                            <input type="text" id="enhancedOrNumber" required maxlength="50" placeholder="e.g., OR-2026-00125">
                            <small class="field-hint">Enter the actual receipt number issued by the authorized municipal cashier. Do not invent an OR number.</small>
                        </div>
                        <div class="col-4 form-group">
                            <label for="enhancedAmountPaid" class="required">Amount Paid</label>
                            <input type="number" id="enhancedAmountPaid" required min="0.01" step="0.01">
                            <small class="field-hint" id="enhancedBalanceHint">Select a ticket to load the balance.</small>
                        </div>
                        <div class="col-4 form-group">
                            <label for="enhancedPaymentMethod">Payment Method</label>
                            <select id="enhancedPaymentMethod">
                                <option value="cash">Cash</option>
                                <option value="gcash">GCash</option>
                                <option value="maya">Maya</option>
                                <option value="bank_transfer">Bank Transfer</option>
                                <option value="other">Other</option>
                            </select>
                        </div>
                        <div class="col-12 form-group">
                            <label for="enhancedPaymentNotes">Notes</label>
                            <textarea id="enhancedPaymentNotes" rows="2" placeholder="Optional notes"></textarea>
                        </div>
                        <div class="col-12 form-group">
                            <button type="submit" id="enhancedRecordPaymentButton" class="btn btn-success" disabled>
                                <i class="fas fa-receipt" aria-hidden="true"></i> Record Payment
                            </button>
                        </div>
                    </form>
                </div>
            </div>

            <div class="card">
                <div class="card-header"><h3 class="card-title">Payment History</h3></div>
                <div class="card-body table-container">
                    <table>
                        <thead><tr><th>Payment ID</th><th>Official Receipt</th><th>Amount</th><th>Status</th><th>Date</th><th>Method</th></tr></thead>
                        <tbody id="enhancedPaymentsTableBody"><tr><td colspan="6" class="text-center">Search and select a ticket to view payment history.</td></tr></tbody>
                    </table>
                </div>
            </div>`;

        const searchInput = document.getElementById('paymentTicketSearch');
        const searchButton = document.getElementById('paymentTicketSearchButton');
        const results = document.getElementById('paymentTicketResults');
        const paymentCard = document.getElementById('selectedPaymentCard');
        const paymentForm = document.getElementById('enhancedPaymentForm');
        const historyBody = document.getElementById('enhancedPaymentsTableBody');
        const recordButton = document.getElementById('enhancedRecordPaymentButton');
        let selectedTicket = null;
        let selectedBalance = 0;

        const ticketPayload = response => response?.ticket || response?.data || null;
        const paymentPayload = response => response?.payments || response?.data || [];

        async function loadHistory() {
            const ticketId = Number(document.getElementById('enhancedPaymentTicketId').value);
            if (!ticketId || !selectedTicket) return;
            if (typeof window.showLoading === 'function') window.showLoading(historyBody);
            try {
                const response = await window.API.getTicketPayments(ticketId);
                const payments = paymentPayload(response);
                const active = Array.isArray(payments)
                    ? payments.filter(item => String(item.payment_status || '').toLowerCase() !== 'voided')
                    : [];
                const totalPaid = active.reduce((sum, item) => sum + Number(item.amount_paid || 0), 0);
                const penalty = Number(selectedTicket.penalty_amount || 0);
                selectedBalance = Math.max(0, penalty - totalPaid);

                document.getElementById('selectedPaymentTicketSummary').innerHTML = `
                    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px 18px;">
                        <div><small>Ticket Number</small><br><strong>${escapeText(selectedTicket.ticket_number || 'N/A')}</strong></div>
                        <div><small>Plate Number</small><br><strong>${escapeText(selectedTicket.plate_number || 'N/A')}</strong></div>
                        <div><small>Violation</small><br><strong>${escapeText(selectedTicket.violation_name || 'N/A')}</strong></div>
                        <div><small>Penalty</small><br><strong>${money(penalty)}</strong></div>
                        <div><small>Total Paid</small><br><strong>${money(totalPaid)}</strong></div>
                        <div><small>Remaining Balance</small><br><strong style="color:${selectedBalance > 0 ? '#b42318' : '#027a48'}">${money(selectedBalance)}</strong></div>
                    </div>`;

                const amountInput = document.getElementById('enhancedAmountPaid');
                amountInput.max = selectedBalance.toFixed(2);
                amountInput.value = selectedBalance > 0 ? selectedBalance.toFixed(2) : '';
                document.getElementById('enhancedBalanceHint').textContent = selectedBalance > 0
                    ? `Remaining balance: ${money(selectedBalance)}. Partial payments are allowed.`
                    : 'This ticket is fully paid.';
                recordButton.disabled = selectedBalance <= 0;

                if (!Array.isArray(payments) || payments.length === 0) {
                    historyBody.innerHTML = '<tr><td colspan="6" class="text-center">No payment history found.</td></tr>';
                } else {
                    historyBody.innerHTML = payments.map(item => `
                        <tr>
                            <td>${Number(item.id) || 0}</td>
                            <td>${escapeText(item.or_number || 'N/A')}</td>
                            <td>${money(item.amount_paid)}</td>
                            <td>${typeof window.getStatusBadge === 'function' ? window.getStatusBadge(item.payment_status) : escapeText(item.payment_status || 'N/A')}</td>
                            <td>${escapeText(typeof window.formatDate === 'function' ? window.formatDate(item.payment_date) : item.payment_date || 'N/A')}</td>
                            <td>${escapeText(item.payment_method || 'N/A')}</td>
                        </tr>`).join('');
                }
            } catch (error) {
                historyBody.innerHTML = '<tr><td colspan="6" class="text-center text-danger">Failed to load payments.</td></tr>';
                recordButton.disabled = true;
                throw error;
            }
        }

        async function selectTicket(ticketId) {
            const id = Number(ticketId);
            if (!Number.isInteger(id) || id <= 0) return;
            try {
                const response = await window.API.getTicketById(id);
                const ticket = ticketPayload(response);
                if (!response.success || !ticket) throw new Error(response.message || 'Ticket details could not be loaded.');
                if (String(ticket.status || '').toLowerCase() !== 'unpaid') throw new Error('Only unpaid tickets can receive a new payment.');
                selectedTicket = ticket;
                document.getElementById('enhancedPaymentTicketId').value = String(ticket.id || id);
                paymentCard.style.display = 'block';
                results.innerHTML = '';
                await loadHistory();
                paymentCard.scrollIntoView({ behavior: 'smooth', block: 'start' });
            } catch (error) {
                if (typeof window.showAlert === 'function') window.showAlert(error.message || 'Unable to select this ticket.', 'danger');
            }
        }
        window.selectTicketForPayment = selectTicket;

        async function search() {
            const query = searchInput.value.trim();
            if (query.length < 2) {
                if (typeof window.showAlert === 'function') window.showAlert('Enter a ticket number or plate number to search.', 'warning');
                searchInput.focus();
                return;
            }
            results.innerHTML = '<div class="text-center" style="padding:12px;"><i class="fas fa-spinner fa-spin"></i> Searching tickets...</div>';
            try {
                const response = await window.API.searchTickets(query);
                const tickets = response.tickets || response.data || [];
                if (!Array.isArray(tickets) || tickets.length === 0) {
                    results.innerHTML = '<div class="text-center" style="padding:12px;">No matching tickets found.</div>';
                    return;
                }
                results.innerHTML = tickets.map(ticket => {
                    const id = Number(ticket.id || ticket.ticket_id);
                    const status = String(ticket.status || '').toLowerCase();
                    const payable = id > 0 && status === 'unpaid';
                    return `
                        <div style="display:flex;justify-content:space-between;gap:14px;align-items:center;padding:12px 14px;margin-top:8px;border:1px solid #d9e0ea;border-radius:12px;background:#fff;">
                            <div style="min-width:0;">
                                <strong>${escapeText(ticket.ticket_number || 'Unknown ticket')}</strong>
                                <div style="font-size:0.84rem;color:#667085;margin-top:3px;">${escapeText(ticket.plate_number || 'No plate')} • ${escapeText(ticket.violation_name || 'Violation')} • ${money(ticket.penalty_amount || 0)} • ${escapeText(status || 'unknown')}</div>
                            </div>
                            <button type="button" class="btn btn-sm ${payable ? 'btn-primary' : 'btn-secondary'}" ${payable ? '' : 'disabled'} data-payment-ticket-id="${id}">${payable ? 'Select' : 'Not Payable'}</button>
                        </div>`;
                }).join('');
            } catch (error) {
                results.innerHTML = '<div class="text-center text-danger" style="padding:12px;">Unable to search tickets.</div>';
                if (typeof window.showAlert === 'function') window.showAlert(error.message || 'Unable to search tickets.', 'danger');
            }
        }

        results.addEventListener('click', event => {
            const button = event.target.closest('[data-payment-ticket-id]');
            if (button) selectTicket(button.dataset.paymentTicketId);
        });
        searchButton.addEventListener('click', search);
        searchInput.addEventListener('keydown', event => {
            if (event.key === 'Enter') {
                event.preventDefault();
                search();
            }
        });

        paymentForm.addEventListener('submit', async event => {
            event.preventDefault();
            if (!selectedTicket) {
                if (typeof window.showAlert === 'function') window.showAlert('Search and select a ticket first.', 'warning');
                return;
            }
            const ticketId = Number(document.getElementById('enhancedPaymentTicketId').value);
            const orNumber = document.getElementById('enhancedOrNumber').value.trim();
            const amountPaid = Number(document.getElementById('enhancedAmountPaid').value);
            const paymentMethod = document.getElementById('enhancedPaymentMethod').value;
            const notes = document.getElementById('enhancedPaymentNotes').value.trim();

            if (!orNumber) {
                if (typeof window.showAlert === 'function') window.showAlert('Enter the official receipt number issued by the municipal cashier.', 'warning');
                document.getElementById('enhancedOrNumber').focus();
                return;
            }
            if (!ticketId || !Number.isFinite(amountPaid) || amountPaid <= 0 || amountPaid > selectedBalance + 0.001) {
                if (typeof window.showAlert === 'function') window.showAlert('Enter a valid amount that does not exceed the remaining balance.', 'warning');
                return;
            }

            const original = recordButton.innerHTML;
            recordButton.disabled = true;
            recordButton.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Recording...';
            try {
                const response = await window.API.recordPayment({
                    ticket_id: ticketId,
                    or_number: orNumber,
                    amount_paid: amountPaid,
                    payment_method: paymentMethod,
                    notes
                });
                if (!response.success) throw new Error(response.message || 'Failed to record payment.');
                const paymentId = Number(response.paymentId || response.data?.paymentId || 0);
                const reference = paymentId > 0 ? `PAY-${String(paymentId).padStart(6, '0')}` : '';
                if (typeof window.showAlert === 'function') {
                    window.showAlert(reference ? `Payment recorded successfully. System reference: ${reference}` : 'Payment recorded successfully.', 'success');
                }
                document.getElementById('enhancedOrNumber').value = '';
                document.getElementById('enhancedPaymentNotes').value = '';
                const refreshed = await window.API.getTicketById(ticketId);
                selectedTicket = ticketPayload(refreshed) || selectedTicket;
                await loadHistory();
            } catch (error) {
                if (typeof window.showAlert === 'function') window.showAlert(error.message || 'Failed to record payment.', 'danger');
            } finally {
                recordButton.innerHTML = original;
                recordButton.disabled = selectedBalance <= 0;
            }
        });

        const ticketFromUrl = Number(new URLSearchParams(window.location.search).get('ticket'));
        if (Number.isInteger(ticketFromUrl) && ticketFromUrl > 0) selectTicket(ticketFromUrl);
    }

    if (page === 'issue-ticket.html') initIssueTicketEnhancements();
    if (page === 'ticket-details.html') initTicketDetailsEnhancements();
    if (page === 'payments.html') initPaymentsEnhancements();
})();

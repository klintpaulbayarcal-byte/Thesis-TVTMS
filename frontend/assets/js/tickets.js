// ==============================================
// Ticket Management Functions
// ==============================================

// Load violations for dropdown
const loadViolations = async () => {
    try {
        const data = await API.getActiveViolations();

        if (data.success && data.violations) {
            const select = document.getElementById('violationId');
            if (!select) return;

            select.innerHTML = '<option value="">-- Select Violation --</option>' +
                data.violations.map(v =>
                    `<option value="${Number(v.id)}" data-penalty="${Number(v.penalty_amount || 0)}">
                        ${escapeHtmlText(v.violation_name)} - ${formatCurrency(v.penalty_amount)}
                    </option>`
                ).join('');
        }
    } catch (error) {
        console.error('Error loading violations:', error);
        showAlert('Failed to load violations', 'danger');
    }
};

// Auto-fill penalty amount when violation is selected
const updatePenaltyAmount = async () => {
    const select = document.getElementById('violationId');
    const penaltyDisplay = document.getElementById('penaltyDisplay');
    const plateInput = document.getElementById('plateNumber');

    if (!select || !penaltyDisplay) return;

    const selectedOption = select.options[select.selectedIndex];
    const basePenalty = Number(selectedOption?.getAttribute('data-penalty') || 0);
    const violationId = Number(select.value);
    const plateNumber = String(plateInput?.value || '').trim().toUpperCase().replace(/[\s-]+/g, '');

    penaltyDisplay.textContent = formatCurrency(basePenalty);
    penaltyDisplay.dataset.amount = String(basePenalty);
    if (typeof window.updateOffenseLevel === 'function') window.updateOffenseLevel(0);

    if (!violationId || !plateNumber) return;

    try {
        const data = await API.getPenaltyPreview(violationId, plateNumber);
        const preview = data.penalty || data.data?.penalty;
        if (!data.success || !preview) return;
        const effectivePenalty = Number(preview.effectivePenalty || basePenalty);
        penaltyDisplay.textContent = formatCurrency(effectivePenalty);
        penaltyDisplay.dataset.amount = String(effectivePenalty);
        if (typeof window.updateOffenseLevel === 'function') {
            window.updateOffenseLevel(Number(preview.priorOffenseCount || 0));
        }
    } catch (error) {
        console.warn('Penalty preview unavailable; base penalty remains displayed.', error.message);
    }
};

// ── Feature 3: Review citation before final submission ──
// Shows a summary modal (Edit / Cancel / Confirm & Issue) so an officer
// can't accidentally issue a ticket with the wrong details.
const showTicketReviewModal = (formData, violationLabel, penaltyAmount) => {
    return new Promise((resolve) => {
        const existing = document.getElementById('ticketReviewModal');
        if (existing) existing.remove();

        const overlay = document.createElement('div');
        overlay.id = 'ticketReviewModal';
        overlay.style.cssText = `
            position: fixed; inset: 0; background: rgba(11,37,69,0.55);
            display: flex; align-items: center; justify-content: center;
            z-index: 9999; padding: 20px;
        `;

        overlay.innerHTML = `
            <div style="background:#fff; border-radius:14px; max-width:480px; width:100%;
                        box-shadow:0 20px 60px rgba(0,0,0,0.3); overflow:hidden;">
                <div style="background:#0b2545; color:#fff; padding:18px 24px;">
                    <h3 style="margin:0; font-size:18px;"><i class="fas fa-clipboard-check"></i> Review Citation</h3>
                    <p style="margin:4px 0 0; font-size:12px; opacity:0.75;">Please confirm the details below before issuing.</p>
                </div>
                <div style="padding:20px 24px;">
                    <div style="display:grid; grid-template-columns: 1fr 1fr; gap:12px 20px; font-size:14px;">
                        <div><strong>Vehicle Plate</strong><br>${escapeHtmlText(formData.plate_number || '-') }</div>
                        <div><strong>Owner</strong><br>${escapeHtmlText(formData.owner_name || '-') }</div>
                        <div style="grid-column: 1 / -1;"><strong>Violation</strong><br>${escapeHtmlText(violationLabel || '-') }</div>
                        <div><strong>Penalty</strong><br><span style="color:#c0392b; font-weight:700;">${formatCurrency(penaltyAmount)}</span></div>
                        <div><strong>Location</strong><br>${escapeHtmlText(formData.location || '-') }</div>
                    </div>
                    <p style="margin-top:16px; font-size:12px; color:#6b7280;">
                        <i class="fas fa-info-circle"></i> Evidence photos can be attached after the ticket is issued, from the ticket details page.
                    </p>
                </div>
                <div style="display:flex; gap:10px; padding:16px 24px; background:#f8f9fb; border-top:1px solid #eee;">
                    <button type="button" id="reviewEditBtn" class="btn btn-secondary" style="flex:1;">
                        <i class="fas fa-pen"></i> Edit
                    </button>
                    <button type="button" id="reviewCancelBtn" class="btn btn-secondary" style="flex:1;">
                        Cancel
                    </button>
                    <button type="button" id="reviewConfirmBtn" class="btn btn-primary" style="flex:1.4;">
                        <i class="fas fa-check"></i> Confirm &amp; Issue
                    </button>
                </div>
            </div>
        `;

        document.body.appendChild(overlay);

        const cleanup = (result) => {
            overlay.remove();
            resolve(result);
        };

        document.getElementById('reviewEditBtn').addEventListener('click', () => cleanup(false));
        document.getElementById('reviewCancelBtn').addEventListener('click', () => cleanup(false));
        document.getElementById('reviewConfirmBtn').addEventListener('click', () => cleanup(true));
    });
};

// Issue new ticket
const issueTicket = async (formData) => {
    try {
        const data = await API.createTicket(formData);

        if (data.success) {
            showAlert('Ticket issued successfully!', 'success');
            return data.ticket;
        } else {
            throw new Error(data.message || 'Failed to issue ticket');
        }
    } catch (error) {
        console.error('Error issuing ticket:', error);
        throw error;
    }
};

const loadFilterOptions = async () => {
    const violationSelect = document.getElementById('filterViolation');
    const officerSelect = document.getElementById('filterOfficer');

    try {
        if (violationSelect) {
            const violationData = await API.getViolations();
            if (violationData.success && Array.isArray(violationData.violations)) {
                const options = violationData.violations.map((violation) =>
                    `<option value="${escapeHtmlText(violation.violation_name)}">${escapeHtmlText(violation.violation_name)}</option>`
                ).join('');
                violationSelect.innerHTML = '<option value="">All Violations</option>' + options;
            }
        }

        if (officerSelect) {
            const currentUser = getUser();
            if (!currentUser || currentUser.role !== 'admin') {
                officerSelect.closest('.form-group')?.setAttribute('style', 'display:none;');
                return;
            }

            const usersData = await API.getUsers();
            if (usersData.success && Array.isArray(usersData.users)) {
                const officers = usersData.users.filter((user) => user.role === 'apprehending_officer');
                const options = officers.map((officer) =>
                    `<option value="${Number(officer.id)}">${escapeHtmlText(officer.name)}</option>`
                ).join('');
                officerSelect.innerHTML = '<option value="">All Apprehending Officers</option>' + options;
            }
        }
    } catch (error) {
        console.error('Failed to load filter options:', error);
    }
};

// Load all tickets with filters
const loadAllTickets = async (filters = {}) => {
    const tbody = document.getElementById('ticketsTableBody');
    if (!tbody) return;

    showLoading(tbody);

    try {
        const data = await API.getTickets(filters);

        if (data.success && data.tickets) {
            if (data.tickets.length === 0) {
                tbody.innerHTML = `
                    <tr>
                        <td colspan="8" class="text-center">
                            <div class="empty-state">
                                <i class="fas fa-magnifying-glass" aria-hidden="true"></i>
                                <h3>No tickets found</h3>
                                <p>Try adjusting your filters or issue new tickets</p>
                            </div>
                        </td>
                    </tr>
                `;
                return;
            }

            tbody.innerHTML = data.tickets.map(ticket => {
                const ticketId = ticket.id || ticket.ticket_id;
                const ticketStatus = String(ticket.status || '').toLowerCase();
                return `
                <tr>
                    <td><strong>${escapeHtmlText(ticket.ticket_number)}</strong></td>
                    <td>${formatDate(ticket.date_issued)}<br><small>${formatTime(ticket.time_issued)}</small></td>
                    <td>${escapeHtmlText(ticket.plate_number)}<br><small>${escapeHtmlText(ticket.vehicle_type || 'N/A')}</small></td>
                    <td>${escapeHtmlText(ticket.owner_name || 'N/A')}</td>
                    <td>${escapeHtmlText(ticket.violation_name)}</td>
                    <td><strong>${formatCurrency(ticket.penalty_amount)}</strong></td>
                    <td>${getStatusBadge(ticket.status)}</td>
                    <td>
                        <button type="button" class="btn btn-sm btn-primary" onclick="viewTicketDetails(${ticketId})" ${ticketId ? '' : 'disabled'}>
                            View
                        </button>
                        ${ticketId && isAdmin() && ticketStatus === 'unpaid' ? `
                        <button type="button" class="btn btn-sm btn-warning" onclick="editTicket(${ticketId})">
                            Edit
                        </button>` : ''}
                        ${ticketId && isAdmin() && ticketStatus === 'unpaid' ? `
                        <button type="button" class="btn btn-sm btn-danger" onclick="deleteTicketRecord(${ticketId})">
                            Cancel
                        </button>` : ''}
                        ${ticketId && isAdmin() && ticketStatus === 'cancelled' ? `
                        <button type="button" class="btn btn-sm btn-danger" onclick="permanentlyDeleteTicketRecord(${ticketId})" title="Permanently delete this cancelled ticket">
                            <i class="fas fa-trash" aria-hidden="true"></i> Delete
                        </button>` : ''}
                        ${ticket.status === 'unpaid' && isAdmin() && ticketId ?
                        `<button type="button" class="btn btn-sm btn-success" onclick="viewTicketDetails(${ticketId})" title="Open ticket to record an official payment">
                                Payment
                            </button>` : ''
                    }
                    </td>
                </tr>
            `;
            }).join('');
        }
    } catch (error) {
        console.error('Error loading tickets:', error);
        tbody.innerHTML = `
            <tr>
                <td colspan="8" class="text-center text-danger">
                    Failed to load tickets. Please try again.
                </td>
            </tr>
        `;
    }
};

// Edit the limited ticket fields supported by the backend.
const editTicket = async (ticketId) => {
    if (!ticketId) {
        showAlert('Unable to edit ticket: missing ticket ID.', 'warning');
        return;
    }

    try {
        const response = await API.getTicketById(ticketId);
        const ticket = response.ticket || response.data;
        if (!response.success || !ticket) {
            throw new Error(response.message || 'Ticket details could not be loaded.');
        }
        if (['paid', 'cancelled'].includes(String(ticket.status || '').toLowerCase())) {
            showAlert('Paid or cancelled tickets cannot be edited.', 'warning');
            return;
        }

        const location = await requestTextConfirmation(
            'Update the enforcement location for this ticket.',
            {
                label: 'Location',
                placeholder: 'e.g., Poblacion, Calape',
                value: String(ticket.location || ''),
                minLength: 1,
                maxLength: 200,
                errorMessage: 'Enter a location between 1 and 200 characters.'
            },
            { title: 'Edit Ticket', confirmLabel: 'Next' }
        );
        if (location === null) return;

        const remarks = await requestTextConfirmation(
            'Update the optional remarks. Leave this blank when no remarks are needed.',
            {
                label: 'Remarks',
                placeholder: 'Optional remarks',
                value: String(ticket.remarks || ''),
                minLength: 0,
                maxLength: 4000
            },
            { title: 'Edit Ticket', confirmLabel: 'Save Changes' }
        );
        if (remarks === null) return;

        const update = await API.updateTicketDetails(ticketId, {
            location: location.trim(),
            remarks: remarks.trim()
        });
        if (!update.success) {
            throw new Error(update.message || 'Ticket update failed.');
        }

        showAlert('Ticket details updated successfully.', 'success');
        await loadAllTickets();
    } catch (error) {
        console.error('Error editing ticket:', error);
        showAlert(error.message || 'Failed to update ticket details.', 'danger');
    }
};
window.editTicket = editTicket;

// Open the official payment workflow. Ticket status is never changed directly.
const markAsPaid = (ticketId) => {
    if (!ticketId) return;
    window.location.href = `ticket-details.html?id=${encodeURIComponent(ticketId)}`;
};

// Cancel ticket while retaining the record
const deleteTicketRecord = async (ticketId) => {
    const normalizedReason = await requestTextConfirmation(
        'Cancel this ticket while retaining it in the audit trail?',
        {
            label: 'Cancellation Reason',
            placeholder: 'Explain why this ticket is being cancelled (5–500 characters).',
            minLength: 5,
            maxLength: 500,
            errorMessage: 'Enter a cancellation reason between 5 and 500 characters.'
        },
        {
            title: 'Cancel Ticket',
            confirmLabel: 'Cancel Ticket',
            destructive: true
        }
    );
    if (normalizedReason === null) return;

    try {
        const response = await API.deleteTicket(ticketId, normalizedReason);
        if (response.success) {
            showAlert('Ticket cancelled successfully.', 'success');
            loadAllTickets();
        }
    } catch (error) {
        console.error('Error cancelling ticket:', error);
        showAlert(error.message || 'Failed to cancel ticket.', 'danger');
    }
};

// Permanently remove only a cancelled ticket without linked official records.
const permanentlyDeleteTicketRecord = async (ticketId) => {
    const reason = await requestTextConfirmation(
        'This permanently deletes the cancelled ticket. This cannot be undone.',
        {
            label: 'Deletion Reason',
            placeholder: 'Explain why this cancelled ticket should be permanently deleted.',
            minLength: 5,
            maxLength: 500,
            errorMessage: 'Enter a deletion reason between 5 and 500 characters.'
        },
        {
            title: 'Delete Cancelled Ticket',
            confirmLabel: 'Delete Permanently',
            destructive: true
        }
    );
    if (reason === null) return;

    try {
        const response = await API.permanentlyDeleteTicket(ticketId, reason);
        if (response.success) {
            showAlert('Cancelled ticket deleted successfully.', 'success');
            await loadAllTickets();
        }
    } catch (error) {
        console.error('Error deleting cancelled ticket:', error);
        showAlert(error.message || 'Failed to delete cancelled ticket.', 'danger');
    }
};
window.permanentlyDeleteTicketRecord = permanentlyDeleteTicketRecord;

// Navigate to ticket details page
const viewTicketDetails = (ticketId) => {
    if (!ticketId) {
        showAlert('Unable to open ticket details: missing ticket ID.', 'warning');
        return;
    }

    window.location.href = `ticket-details.html?id=${encodeURIComponent(ticketId)}`;
};

// Print ticket
const printTicketById = (ticketId) => {
    if (!ticketId) {
        showAlert('Unable to print ticket: missing ticket ID.', 'warning');
        return;
    }

    const encodedId = encodeURIComponent(ticketId);
    window.open(`ticket-details.html?id=${encodedId}&print=1`, '_blank');
};

// Initialize ticket form
document.addEventListener('DOMContentLoaded', () => {
    // Load violations if on issue ticket page
    const violationSelect = document.getElementById('violationId');
    if (violationSelect) {
        loadViolations();
        violationSelect.addEventListener('change', updatePenaltyAmount);
        document.getElementById('plateNumber')?.addEventListener('blur', updatePenaltyAmount);
    }

    // Handle ticket form submission
    const issueTicketForm = document.getElementById('issueTicketForm');
    if (issueTicketForm) {
        document.getElementById('resetTicketButton')?.addEventListener('click', async () => {
            if (!await confirmAction('Clear every field in this ticket form? Unsaved information will be lost.', {
                title: 'Reset Ticket Form',
                confirmLabel: 'Reset Form',
                destructive: true
            })) return;
            issueTicketForm.reset();
            updatePenaltyAmount();
            issueTicketForm.querySelector('input, select, textarea')?.focus();
        });

        issueTicketForm.addEventListener('submit', async (e) => {
            e.preventDefault();

            if (!validateForm('issueTicketForm')) {
                showAlert('Please fill in all required fields', 'warning');
                return;
            }

            const formData = {
                    plate_number: document.getElementById('plateNumber').value.trim().toUpperCase(),
                    vehicle_type: document.getElementById('vehicleType').value,
                    owner_name: document.getElementById('ownerName').value.trim(),
                    driver_license_number: (document.getElementById('driverLicenseNumber')?.value || '').trim().toUpperCase() || null,
                    owner_email: document.getElementById('ownerEmail').value.trim(),
                    owner_address: document.getElementById('ownerAddress').value.trim(),
                    violation_id: document.getElementById('violationId').value,
                    location: document.getElementById('location').value.trim(),
                    remarks: document.getElementById('remarks').value.trim()
            };

            // Feature 3: Review step before final submission
            const violationSelect = document.getElementById('violationId');
            const selectedOption = violationSelect.options[violationSelect.selectedIndex];
            const violationLabel = selectedOption ? selectedOption.textContent.trim() : '';
            const penaltyAmount = document.getElementById('penaltyDisplay')?.dataset.amount || (selectedOption ? selectedOption.getAttribute('data-penalty') : 0);

            const confirmed = await showTicketReviewModal(formData, violationLabel, penaltyAmount);
            if (!confirmed) {
                return; // Officer chose Edit or Cancel - stay on the form, nothing submitted.
            }

            const submitBtn = e.target.querySelector('button[type="submit"]');
            submitBtn.disabled = true;
            submitBtn.textContent = 'Issuing Ticket...';

            try {
                const ticket = await issueTicket(formData);

                if (ticket) {
                    // Ask if user wants to print
                    if (await confirmAction('The ticket was issued successfully. Would you like to open the printable ticket now?', {
                        title: 'Ticket Issued',
                        confirmLabel: 'Open Printable Ticket'
                    })) {
                        printTicketById(ticket.id);
                    }

                    // Reset form
                    issueTicketForm.reset();
                    updatePenaltyAmount();

                    // Redirect to tickets page
                    setTimeout(() => {
                        window.location.href = 'view-tickets.html';
                    }, 2000);
                }
            } catch (error) {
                showAlert(error.message || 'Failed to issue ticket', 'danger');
            } finally {
                submitBtn.disabled = false;
                submitBtn.textContent = 'Issue Ticket';
            }
        });
    }

    // Load tickets if on view tickets page
    if (document.getElementById('ticketsTableBody')) {
        loadAllTickets();
    }

    // Search functionality
    const searchInput = document.getElementById('searchTickets');
    if (searchInput) {
        searchInput.addEventListener('input', (e) => {
            searchTickets(e.target.value);
        });
    }

    // Filter functionality
    const filterForm = document.getElementById('filterForm');
    if (filterForm) {
        filterForm.addEventListener('submit', (e) => {
            e.preventDefault();
            const filters = {
                status: document.getElementById('filterStatus')?.value,
                dateFrom: document.getElementById('filterDateFrom')?.value,
                dateTo: document.getElementById('filterDateTo')?.value,
                enforcerId: document.getElementById('filterOfficer')?.value,
                violation: document.getElementById('filterViolation')?.value,
                location: document.getElementById('filterLocation')?.value?.trim()
            };
            loadAllTickets(filters);
        });
    }

    if (document.getElementById('filterForm')) {
        loadFilterOptions();
    }
});

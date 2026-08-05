const settingEnabled = (value) => ['1', 'true', 'on', 'yes'].includes(String(value ?? '').toLowerCase());

const setToggleStatus = (checkbox, statusElement) => {
    if (!checkbox || !statusElement) return;
    statusElement.textContent = checkbox.checked ? 'Enabled' : 'Disabled';
    statusElement.style.color = checkbox.checked ? 'var(--success-color)' : 'var(--text-secondary)';
};

const withSubmitState = async (form, task) => {
    const button = form?.querySelector('button[type="submit"]');
    const original = button?.innerHTML;
    if (button) {
        button.disabled = true;
        button.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Saving...';
    }
    try {
        await task();
    } finally {
        if (button) {
            button.disabled = false;
            button.innerHTML = original;
        }
    }
};

document.addEventListener('DOMContentLoaded', async () => {
    if (!requireAuth()) return;
    if (!isAdmin()) {
        window.location.href = 'officer-dashboard.html';
        return;
    }

    populateUserInfo();

    const lguForm = document.getElementById('lguForm');
    const deadlineForm = document.getElementById('deadlineForm');
    const notificationForm = document.getElementById('notificationForm');
    const violationCheckbox = document.getElementById('notifyViolation');
    const confirmCheckbox = document.getElementById('notifyPaymentConfirm');
    const violationStatus = document.getElementById('violationStatus');
    const confirmStatus = document.getElementById('confirmStatus');

    const updateToggleLabels = () => {
        setToggleStatus(violationCheckbox, violationStatus);
        setToggleStatus(confirmCheckbox, confirmStatus);
    };

    violationCheckbox?.addEventListener('change', updateToggleLabels);
    confirmCheckbox?.addEventListener('change', updateToggleLabels);

    try {
        const response = await API.getSystemSettings();
        const map = Object.fromEntries((response.settings || []).map(item => [item.setting_key, item.setting_value]));
        document.getElementById('lguNameInput').value = map.lgu_name || '';
        document.getElementById('systemTitleInput').value = map.system_title || '';
        document.getElementById('lguContactInput').value = map.lgu_contact || '';
        document.getElementById('lguAddressInput').value = map.lgu_address || '';
        document.getElementById('disputeDeadlineInput').value = map.dispute_deadline_days || '15';
        document.getElementById('paymentDeadlineInput').value = map.payment_deadline_days || '30';
        violationCheckbox.checked = settingEnabled(map.send_violation_notice);
        confirmCheckbox.checked = settingEnabled(map.send_payment_confirmation);
        updateToggleLabels();
    } catch (error) {
        console.error('Failed to load settings:', error);
        showAlert(error.message || 'Unable to load system settings.', 'danger');
    }

    lguForm?.addEventListener('submit', async event => {
        event.preventDefault();
        const settings = {
            lgu_name: document.getElementById('lguNameInput').value.trim(),
            system_title: document.getElementById('systemTitleInput').value.trim(),
            lgu_contact: document.getElementById('lguContactInput').value.trim(),
            lgu_address: document.getElementById('lguAddressInput').value.trim()
        };
        if (Object.values(settings).some(value => !value)) {
            showAlert('Complete all LGU information fields.', 'warning');
            return;
        }
        await withSubmitState(lguForm, async () => {
            try {
                await API.updateSystemSettings(settings);
                showAlert('LGU information saved successfully.', 'success');
            } catch (error) {
                showAlert(error.message || 'Failed to save LGU information.', 'danger');
            }
        });
    });

    deadlineForm?.addEventListener('submit', async event => {
        event.preventDefault();
        const disputeDays = Number(document.getElementById('disputeDeadlineInput').value);
        const paymentDays = Number(document.getElementById('paymentDeadlineInput').value);
        if (![disputeDays, paymentDays].every(value => Number.isInteger(value) && value >= 1 && value <= 365)) {
            showAlert('Deadlines must be whole numbers from 1 to 365 days.', 'warning');
            return;
        }
        await withSubmitState(deadlineForm, async () => {
            try {
                await API.updateSystemSettings({
                    dispute_deadline_days: String(disputeDays),
                    payment_deadline_days: String(paymentDays)
                });
                showAlert('Deadline settings saved successfully.', 'success');
            } catch (error) {
                showAlert(error.message || 'Failed to save deadline settings.', 'danger');
            }
        });
    });

    notificationForm?.addEventListener('submit', async event => {
        event.preventDefault();
        await withSubmitState(notificationForm, async () => {
            try {
                await API.updateSystemSettings({
                    send_violation_notice: violationCheckbox.checked,
                    send_payment_confirmation: confirmCheckbox.checked
                });
                showAlert('Email preferences saved successfully.', 'success');
            } catch (error) {
                showAlert(error.message || 'Failed to save email preferences.', 'danger');
            }
        });
    });
});

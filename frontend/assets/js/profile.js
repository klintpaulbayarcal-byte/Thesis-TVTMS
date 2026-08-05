document.addEventListener('DOMContentLoaded', async () => {
    if (!requireAuth()) return;

    const user = getUser();
    if (!user) {
        window.location.href = 'login.html';
        return;
    }

    // Show role-specific dashboard links.
    const adminLink = document.querySelector('.role-admin-link');
    const officerLink = document.querySelector('.role-officer-link');

    if (user.role === 'admin') {
        officerLink?.remove();
    } else if (user.role === 'apprehending_officer') {
        adminLink?.remove();
    } else {
        adminLink?.remove();
        officerLink?.remove();
    }

    populateUserInfo();

    const profileName = document.getElementById('profileName');
    const profileEmail = document.getElementById('profileEmail');
    const profileContact = document.getElementById('profileContact');

    const profileForm = document.getElementById('profileForm');
    const passwordForm = document.getElementById('passwordForm');

    try {
        const profileData = await API.getProfile();
        if (profileData.success && profileData.user) {
            profileName.value = profileData.user.name || '';
            profileEmail.value = profileData.user.email || '';
            profileContact.value = profileData.user.contact_number || '';
        }
    } catch (error) {
        console.error('Failed to load profile:', error);
        showAlert('Failed to load profile details.', 'danger');
    }

    profileForm?.addEventListener('submit', async (event) => {
        event.preventDefault();

        const payload = {
            name: profileName.value.trim(),
            email: profileEmail.value.trim(),
            contact_number: profileContact.value.trim()
        };

        if (!payload.name || !payload.email) {
            showAlert('Name and email are required.', 'warning');
            return;
        }

        try {
            const response = await API.updateMyProfile(payload);
            if (response.success && response.user) {
                saveAuth(getToken(), {
                    ...getUser(),
                    ...response.user
                });
                populateUserInfo();
                showAlert('Profile updated successfully.', 'success');
            }
        } catch (error) {
            console.error('Profile update failed:', error);
            showAlert(error.message || 'Failed to update profile.', 'danger');
        }
    });

    passwordForm?.addEventListener('submit', async (event) => {
        event.preventDefault();

        const currentPassword = document.getElementById('currentPassword').value;
        const newPassword = document.getElementById('newPassword').value;
        const confirmPassword = document.getElementById('confirmPassword').value;

        const strongPassword = newPassword.length >= 12 && /[a-z]/.test(newPassword) && /[A-Z]/.test(newPassword) && /\d/.test(newPassword) && /[^A-Za-z0-9]/.test(newPassword);
        if (!strongPassword) {
            showAlert('New password must be at least 12 characters and include uppercase, lowercase, a number, and a symbol.', 'warning');
            return;
        }

        if (newPassword !== confirmPassword) {
            showAlert('New password and confirmation do not match.', 'warning');
            return;
        }

        try {
            const response = await API.changePassword({ currentPassword, newPassword });
            if (response.success) {
                passwordForm.reset();
                showAlert('Password changed successfully.', 'success');
            }
        } catch (error) {
            console.error('Password update failed:', error);
            showAlert(error.message || 'Failed to change password.', 'danger');
        }
    });
});
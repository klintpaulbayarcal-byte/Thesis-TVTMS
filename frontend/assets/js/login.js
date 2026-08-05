// ==============================================
// Login Page Logic
// Municipal Traffic Violation Ticketing and Management System
// ==============================================

document.addEventListener('DOMContentLoaded', () => {
    const loginForm = document.getElementById('loginForm');
    const emailInput = document.getElementById('email');
    const passwordInput = document.getElementById('password');
    const loginBtn = document.getElementById('loginBtn');
    const togglePasswordBtn = document.getElementById('togglePassword');
    const forgotPasswordLink = document.getElementById('forgotPasswordLink');
    const rememberMe = document.getElementById('rememberMe');
    const formMessage = document.getElementById('formMessage');
    const emailError = document.getElementById('emailError');
    const passwordError = document.getElementById('passwordError');
    const passwordField = document.querySelector('.password-field');
    const savedEmail = localStorage.getItem('login_remember_email');

    if (typeof isAuthenticated === 'function' && isAuthenticated()) {
        redirectToDashboard();
        return;
    }

    if (savedEmail) {
        emailInput.value = savedEmail;
        rememberMe.checked = true;
    }

    const clearFieldErrors = () => {
        emailError.textContent = '';
        passwordError.textContent = '';
        emailInput.classList.remove('input-error');
        passwordInput.classList.remove('input-error');
    };

    const setFormMessage = (message, type = '') => {
        formMessage.className = 'form-message';
        formMessage.textContent = message;

        if (type) {
            formMessage.classList.add(`is-${type}`);
        }
    };

    const clearFormMessage = () => {
        formMessage.className = 'form-message';
        formMessage.textContent = '';
    };

    const pendingAuthNotice = sessionStorage.getItem('auth_notice');
    if (pendingAuthNotice) {
        sessionStorage.removeItem('auth_notice');
        setFormMessage(pendingAuthNotice, 'warning');
        if (typeof showAlert === 'function') {
            showAlert(pendingAuthNotice, 'warning', 1800);
        }
    }

    const validateEmail = (value) => {
        const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        return emailPattern.test(value);
    };

    const validateLoginForm = () => {
        const email = emailInput.value.trim();
        const password = passwordInput.value.trim();
        let valid = true;

        clearFieldErrors();
        clearFormMessage();

        if (!email) {
            emailError.textContent = 'Email address is required.';
            emailInput.classList.add('input-error');
            valid = false;
        } else if (!validateEmail(email)) {
            emailError.textContent = 'Enter a valid email address.';
            emailInput.classList.add('input-error');
            valid = false;
        }

        if (!password) {
            passwordError.textContent = 'Password is required.';
            passwordInput.classList.add('input-error');
            valid = false;
        }

        return valid;
    };

    const setLoading = (isLoading) => {
        loginBtn.disabled = isLoading;
        loginBtn.textContent = isLoading ? 'Signing in...' : 'Sign In';
    };

    const togglePasswordVisibility = () => {
        const isHidden = passwordInput.type === 'password';
        passwordInput.type = isHidden ? 'text' : 'password';
        passwordField.classList.toggle('is-visible', isHidden);
        togglePasswordBtn.setAttribute('aria-label', isHidden ? 'Hide password' : 'Show password');
        togglePasswordBtn.setAttribute('aria-pressed', String(isHidden));
    };

    const handleForgotPassword = async () => {
        const email = emailInput.value.trim();

        if (!email) {
            emailError.textContent = 'Enter your email address first.';
            emailInput.classList.add('input-error');
            emailInput.focus();
            return;
        }

        if (!validateEmail(email)) {
            emailError.textContent = 'Enter a valid email address.';
            emailInput.classList.add('input-error');
            emailInput.focus();
            return;
        }

        try {
            setFormMessage('Sending password reset link...', 'warning');
            await API.requestPasswordReset(email);
            setFormMessage('Password reset instructions were sent to your email.', 'success');
            if (typeof showAlert === 'function') {
                showAlert('Password reset instructions were sent to your email.', 'success');
            }
        } catch (error) {
            const message = error.message || 'Unable to send password reset email.';
            setFormMessage(message, 'error');
            if (typeof showAlert === 'function') {
                showAlert(message, 'danger');
            }
        }
    };

    togglePasswordBtn.addEventListener('click', togglePasswordVisibility);
    forgotPasswordLink.addEventListener('click', handleForgotPassword);

    emailInput.addEventListener('input', () => {
        if (emailError.textContent) {
            emailError.textContent = '';
            emailInput.classList.remove('input-error');
        }
    });

    passwordInput.addEventListener('input', () => {
        if (passwordError.textContent) {
            passwordError.textContent = '';
            passwordInput.classList.remove('input-error');
        }
    });

    loginForm.addEventListener('submit', async (event) => {
        event.preventDefault();

        if (!validateLoginForm()) {
            if (typeof showAlert === 'function') {
                showAlert('Please fix the highlighted fields.', 'danger');
            }
            return;
        }

        const email = emailInput.value.trim();
        const password = passwordInput.value;

        setLoading(true);
        setFormMessage('Verifying your credentials...', 'warning');

        try {
            const response = await API.login({ email, password });

            if (!response || !response.success) {
                const message = response?.message || 'Login failed. Please try again.';
                setFormMessage(message, 'error');
                if (typeof showAlert === 'function') {
                    showAlert(message, 'danger');
                }
                return;
            }

            saveAuth(response.token, response.user);

            if (rememberMe.checked) {
                localStorage.setItem('login_remember_email', email);
            } else {
                localStorage.removeItem('login_remember_email');
            }

            setFormMessage('Login successful. Redirecting...', 'success');
            if (typeof showAlert === 'function') {
                showAlert('Login successful! Redirecting...', 'success', 1200);
            }

            window.setTimeout(() => {
                redirectToDashboard();
            }, 900);
        } catch (error) {
            const message = error.message || 'Login failed. Please try again.';
            setFormMessage(message, 'error');
            if (typeof showAlert === 'function') {
                showAlert(message, 'danger');
            }
        } finally {
            setLoading(false);
        }
    });

    loginForm.addEventListener('reset', () => {
        window.setTimeout(() => {
            clearFieldErrors();
            clearFormMessage();
        }, 0);
    });

    emailInput.focus();
});

    (function () {
      // ── FAQ ACCORDION ──
      document.querySelectorAll('.faq-item .faq-q').forEach(btn => {
        btn.addEventListener('click', () => {
          const item = btn.closest('.faq-item');
          const wasOpen = item.classList.contains('open');
          document.querySelectorAll('.faq-item.open').forEach(i => {
            i.classList.remove('open');
            i.querySelector('.faq-icon').textContent = '+';
            i.querySelector('.faq-q').setAttribute('aria-expanded', 'false');
          });
          if (!wasOpen) {
            item.classList.add('open');
            item.querySelector('.faq-icon').textContent = '−';
            btn.setAttribute('aria-expanded', 'true');
          }
        });
      });

      // ── VIOLATION TYPES & PENALTIES ──
      let VIOLATIONS = [];
      const escapeViolationText = value => String(value ?? '').replace(/[&<>"']/g, ch => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
      }[ch]));
      const peso = value => `₱${Number(value || 0).toLocaleString('en-PH', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
      })}`;

      function renderViolations(list, message = '') {
        const body = document.getElementById('violTableBody');
        if (!body) return;
        if (!list.length) {
          body.innerHTML = `<tr><td colspan="5"><div class="empty-state">
            <div class="empty-state-icon"><i data-lucide="${message ? 'circle-alert' : 'search-x'}"></i></div>
            <div class="empty-state-title">${escapeViolationText(message || 'No matching violations found')}</div>
            <div class="empty-state-sub">${message ? 'Please try again later or contact the municipal office.' : 'Try a different keyword.'}</div>
          </div></td></tr>`;
          if (window.lucide) lucide.createIcons();
          return;
        }
        body.innerHTML = list.map(v => `
          <tr>
            <td class="ticket-id">${escapeViolationText(v.code)}</td>
            <td><span class="viol-name">${escapeViolationText(v.name)}</span></td>
            <td><span class="viol-desc" style="display:block">${escapeViolationText(v.desc || '—')}</span></td>
            <td class="fine">${peso(v.penalty)}</td>
            <td>${Number(v.points || 0)}</td>
          </tr>`).join('');
      }

      function filterViolations() {
        const q = (document.getElementById('violSearchInput')?.value || '').trim().toLowerCase();
        const filtered = VIOLATIONS.filter(v => !q || [v.code, v.name, v.desc]
          .some(value => String(value || '').toLowerCase().includes(q)));
        renderViolations(filtered);
      }

      async function loadPublicViolations() {
        if (!document.getElementById('violTableBody')) return;
        renderViolations([], 'Loading current violation references…');
        try {
          const response = await fetch(`${API}/public/violations`, { headers: { Accept: 'application/json' } });
          const data = await response.json().catch(() => ({}));
          if (!response.ok || data.success !== true || !Array.isArray(data.violations)) {
            throw new Error(data.message || 'Violation references are unavailable.');
          }
          VIOLATIONS = data.violations.map(v => ({
            code: v.violation_code,
            name: v.violation_name,
            desc: v.description,
            penalty: Number(v.penalty_amount || 0),
            points: Number(v.demerit_points || 0)
          }));
          renderViolations(VIOLATIONS);
        } catch (error) {
          console.error('Unable to load public violations:', error);
          renderViolations([], 'Violation references are temporarily unavailable');
        }
      }

      if (document.getElementById('violTableBody')) {
        document.getElementById('violSearchInput')?.addEventListener('input', filterViolations);
        loadPublicViolations();
      }

      // ── CONTACT FORM ──
      // Submit to the system Administrator inbox. SMTP is an optional server-side copy.
      const contactForm = document.getElementById('contactForm');
      let contactIsSubmitting = false;
      const CONTACT_REQUEST_TIMEOUT_MS = 12000;
      if (contactForm) {
        contactForm.addEventListener('submit', async (e) => {
          e.preventDefault();
          if (contactIsSubmitting) return;

          const btn = document.getElementById('cfSubmit');
          const note = document.getElementById('cfNote');
          const nameInput = document.getElementById('cfName');
          const emailInput = document.getElementById('cfEmail');
          const subjectInput = document.getElementById('cfSubject');
          const messageInput = document.getElementById('cfMessage');
          const payload = {
            full_name: nameInput.value.trim(),
            email: emailInput.value.trim(),
            subject: subjectInput.value.trim(),
            message: messageInput.value.trim(),
          };

          note.textContent = '';
          note.classList.remove('success', 'error');

          let validationMessage = '';
          let invalidInput = null;
          if (!payload.full_name) {
            validationMessage = 'Please enter your full name.';
            invalidInput = nameInput;
          } else if (!payload.email || emailInput.validity.typeMismatch) {
            validationMessage = 'Please enter a valid email address.';
            invalidInput = emailInput;
          } else if (!payload.subject) {
            validationMessage = 'Please enter a subject.';
            invalidInput = subjectInput;
          } else if (payload.message.length < 10 || payload.message.length > 3000) {
            validationMessage = 'Message must contain 10–3000 characters.';
            invalidInput = messageInput;
          }

          if (validationMessage) {
            note.textContent = validationMessage;
            note.classList.add('error');
            invalidInput?.focus();
            return;
          }

          contactIsSubmitting = true;
          btn.disabled = true;
          btn.setAttribute('aria-busy', 'true');
          btn.innerHTML = '<i data-lucide="loader-circle" class="motion-spin"></i> Sending...';
          if (window.lucide) lucide.createIcons();

          const controller = new AbortController();
          const timeoutId = window.setTimeout(() => controller.abort(), CONTACT_REQUEST_TIMEOUT_MS);
          try {
            const res = await fetch(`${API}/public/contact`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(payload),
              signal: controller.signal
            });
            const data = await res.json().catch(() => ({}));
            if (res.ok && data.success !== false) {
              note.textContent = data.message || 'Message submitted to the system Administrator.';
              note.classList.add('success');
              contactForm.reset();
            } else {
              throw new Error(data.message || 'Unable to send your message right now.');
            }
          } catch (err) {
            note.textContent = err?.name === 'AbortError'
              ? 'The request timed out. Please try again or use the published hotline.'
              : (err.message || 'Could not reach the server. Please try again or use the published hotline.');
            note.classList.add('error');
          } finally {
            window.clearTimeout(timeoutId);
            contactIsSubmitting = false;
            btn.disabled = false;
            btn.removeAttribute('aria-busy');
            btn.innerHTML = '<i data-lucide="send"></i> Send Message';
            if (window.lucide) lucide.createIcons();
          }
        });
      }
      // ── SCROLLSPY: highlight current section in nav ──
      const navPills = Array.from(document.querySelectorAll('.nav-pill[href^="#"]'));
      const spySections = navPills
        .map(a => document.querySelector(a.getAttribute('href')))
        .filter(Boolean);
      if (spySections.length && 'IntersectionObserver' in window) {
        const spy = new IntersectionObserver((entries) => {
          entries.forEach(entry => {
            if (!entry.isIntersecting) return;
            const id = '#' + entry.target.id;
            navPills.forEach(a => a.classList.toggle('active', a.getAttribute('href') === id));
          });
        }, { rootMargin: '-45% 0px -50% 0px', threshold: 0 });
        spySections.forEach(s => spy.observe(s));
      }
    })();

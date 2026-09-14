    // ── CANVAS BACKGROUND ──
    const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const canvas = document.getElementById('bg'), ctx = canvas.getContext('2d');
    let W, H, dots = [];
    function resize() { W = canvas.width = window.innerWidth; H = canvas.height = window.innerHeight; initDots() }
    function initDots() {
      dots = [];
      if (prefersReducedMotion) return;
      const count = Math.floor((W * H) / 14000);
      for (let i = 0; i < count; i++) {
        dots.push({
          x: Math.random() * W, y: Math.random() * H,
          vx: (Math.random() - .5) * 0.25, vy: (Math.random() - .5) * 0.25,
          r: Math.random() * 1.2 + 0.3,
          a: Math.random() * 0.5 + 0.1
        });
      }
    }
    function drawBg() {
      ctx.clearRect(0, 0, W, H);
      // connections
      for (let i = 0; i < dots.length; i++) {
        for (let j = i + 1; j < dots.length; j++) {
          const dx = dots[i].x - dots[j].x, dy = dots[i].y - dots[j].y;
          const dist = Math.sqrt(dx * dx + dy * dy);
          if (dist < 120) {
            ctx.beginPath();
            ctx.moveTo(dots[i].x, dots[i].y);
            ctx.lineTo(dots[j].x, dots[j].y);
            ctx.strokeStyle = `rgba(37,99,235,${0.08 * (1 - dist / 120)})`;
            ctx.lineWidth = 0.5;
            ctx.stroke();
          }
        }
      }
      // dots
      dots.forEach(d => {
        ctx.beginPath();
        ctx.arc(d.x, d.y, d.r, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(96,165,250,${d.a})`;
        ctx.fill();
        d.x += d.vx; d.y += d.vy;
        if (d.x < 0 || d.x > W) d.vx *= -1;
        if (d.y < 0 || d.y > H) d.vy *= -1;
      });
      requestAnimationFrame(drawBg);
    }
    resize();
    window.addEventListener('resize', resize);
    if (!prefersReducedMotion) drawBg();

    // ── COUNTER ANIMATION ──
    function animCounter(el) {
      const target = parseInt(el.dataset.count);
      const suffix = el.textContent.includes('+') ? '+' : el.textContent.includes('%') ? '%' : '';
      let start = null;
      const dur = 1200;
      function step(ts) {
        if (!start) start = ts;
        const p = Math.min((ts - start) / dur, 1);
        const ease = 1 - Math.pow(1 - p, 3);
        el.textContent = Math.floor(ease * target) + (suffix);
        if (p < 1) requestAnimationFrame(step);
      }
      requestAnimationFrame(step);
    }

    // ── SCROLL REVEAL ──
    const obs = new IntersectionObserver((entries) => {
      entries.forEach(e => {
        if (e.isIntersecting) {
          e.target.classList.add('visible');
          // trigger counters
          e.target.querySelectorAll('[data-count]').forEach(animCounter);
          obs.unobserve(e.target);
        }
      });
    }, { threshold: 0.12 });

    document.querySelectorAll('.reveal,.step-card,.role-card,.feat-card').forEach((el, i) => {
      el.style.transitionDelay = (i % 4) * 0.08 + 's';
      obs.observe(el);
    });

    // ── HERO COUNTERS ──
    setTimeout(() => {
      document.querySelectorAll('.hero-left [data-count]').forEach(animCounter);
    }, 600);

    // ── NAV SCROLL ──
    window.addEventListener('scroll', () => {
      document.getElementById('nav').style.background =
        window.scrollY > 60 ? 'rgba(4,8,15,0.92)' : 'rgba(4,8,15,0.7)';
    });

    // ── MODALS FUNCTIONALITY ──
    function openModal(modalId) {
      document.getElementById(modalId).classList.add('active');
    }

    function closeModal(modalId) {
      document.getElementById(modalId).classList.remove('active');
    }

    document.querySelectorAll('[data-close-modal]').forEach((button) => {
      button.addEventListener('click', () => closeModal(button.dataset.closeModal));
    });

    // Open modals on stat click
    document.getElementById('rolesStatBtn').addEventListener('click', () => openModal('rolesModal'));
    document.getElementById('modulesStatBtn').addEventListener('click', () => openModal('modulesModal'));
    document.getElementById('auditActionsStatBtn').addEventListener('click', () => openModal('auditActionsModal'));

    // Close modal on outside click
    ['rolesModal', 'modulesModal', 'auditActionsModal'].forEach(modalId => {
      document.getElementById(modalId).addEventListener('click', (e) => {
        if (e.target.id === modalId) {
          closeModal(modalId);
        }
      });
    });

    // Close modal on ESC key
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        ['rolesModal', 'modulesModal', 'auditActionsModal'].forEach(modalId => {
          if (document.getElementById(modalId).classList.contains('active')) {
            closeModal(modalId);
          }
        });
      }
    });

    // ── SEARCH ──
    const API_ORIGIN = (window.APP_CONFIG && window.APP_CONFIG.API_ORIGIN) || location.origin;
    const API = `${API_ORIGIN}/api`;
    let tab = 'plate';
    function switchTab(t) {
      tab = t;
      ['plate', 'ticket'].forEach(k => {
        const tabButton = document.getElementById('tab-' + k);
        tabButton.classList.toggle('active', k === t);
        tabButton.setAttribute('aria-selected', String(k === t));
      });
      const input = document.getElementById('searchInput');
      input.value = '';
      input.placeholder = t === 'plate' ? 'e.g., ABC 1234' : 'e.g., TVT-2026-0001';
      const lookupButton = document.getElementById('quickLookupButton');
      lookupButton.innerHTML = t === 'plate'
        ? '<i data-lucide="search"></i> Search Plate'
        : '<i data-lucide="search"></i> Search Ticket';
      if (window.lucide) lucide.createIcons();
      document.getElementById('scResult').classList.remove('show');
      document.getElementById('scErr').classList.remove('show');
    }

    document.querySelectorAll('[data-lookup-tab]').forEach((button) => {
      button.addEventListener('click', () => switchTab(button.dataset.lookupTab));
    });
    const quickLookupInput = document.getElementById('searchInput');
    quickLookupInput.addEventListener('input', () => {
      quickLookupInput.value = quickLookupInput.value.toUpperCase();
    });
    quickLookupInput.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        doSearch();
      }
    });
    document.getElementById('quickLookupButton').addEventListener('click', doSearch);

    function showErr(msg) {
      document.getElementById('scErrText').textContent = msg;
      document.getElementById('scErr').classList.add('show');
      document.getElementById('scResult').classList.remove('show');
    }

    function escapePublicText(value) {
      return String(value ?? '').replace(/[&<>"']/g, ch => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
      })[ch]);
    }

    async function doSearch() {
      const rawValue = document.getElementById('searchInput').value.trim();
      const val = rawValue.toUpperCase();
      if (!val) { showErr('Please enter a value to search.'); return; }

      const btn = document.getElementById('quickLookupButton');
      btn.innerHTML = '<i data-lucide="loader-circle" class="motion-spin"></i> Searching...';
      btn.disabled = true;
      if (window.lucide) lucide.createIcons();
      document.getElementById('scErr').classList.remove('show');

      try {
        if (tab === 'plate') {
          const normalizedPlate = val.replace(/[\s-]/g, '');
          const r = await fetch(`${API}/public/vehicle-lookup?plate_number=${encodeURIComponent(normalizedPlate)}`);
          const d = await r.json();
          if (!r.ok || !d.success || !d.vehicle) {
            showErr(d.message || ('No records found for: ' + val));
            return;
          }

          const v = d.vehicle;
          const viols = Array.isArray(d.violations) ? d.violations : [];
          document.getElementById('scResultTitle').textContent = `Plate ${v.plate_number || val}`;
          document.getElementById('scResultSub').textContent = `${viols.length} traffic citation record(s) found`;
          document.getElementById('scResultList').innerHTML = viols.length === 0
            ? '<div style="padding:18px;text-align:center;color:#475569;font-size:12px"><i data-lucide="circle-check"></i> No citations on file for this plate.</div>'
            : viols.map(t => {
                const ticketNumber = escapePublicText(t.ticket_number || '—');
                const violationName = escapePublicText(t.violation_name || t.violation_type || 'Traffic violation');
                const status = escapePublicText(String(t.status || 'unpaid').toUpperCase());
                const statusClass = t.status === 'paid' ? 'sc-badge-paid' : 'sc-badge-unpaid';
                const issued = t.date_issued
                  ? new Date(t.date_issued).toLocaleDateString('en-PH', { year: 'numeric', month: 'short', day: 'numeric' })
                  : 'Date unavailable';
                const penalty = Number(t.remaining_balance ?? t.penalty_amount ?? 0).toLocaleString('en-PH', { minimumFractionDigits: 2 });
                const ticketUrl = `public-ticket-lookup.html?ticket=${encodeURIComponent(t.ticket_number || '')}`;
                return `<a class="sc-result-item" href="${ticketUrl}" style="text-decoration:none;color:inherit">
                  <div><div class="sc-ri-plate">${ticketNumber} · ${violationName}</div>
                  <div class="sc-ri-name">${escapePublicText(issued)} · ₱${penalty}</div></div>
                  <span class="sc-badge ${statusClass}">${status}</span>
                </a>`;
              }).join('');
          document.getElementById('scResult').classList.add('show');
        } else {
          const r = await fetch(`${API}/public/ticket-lookup?ticket=${encodeURIComponent(val)}`);
          const d = await r.json();
          const tickets = Array.isArray(d.tickets) ? d.tickets : [];
          if (!r.ok || !d.success || tickets.length === 0) {
            showErr(d.message || ('No ticket found: ' + val));
            return;
          }

          const t = tickets[0];
          document.getElementById('scResultTitle').textContent = `Ticket: ${t.ticket_number}`;
          document.getElementById('scResultSub').textContent = `${t.violation_name || t.violation_type || 'Traffic violation'} · Plate ${t.plate_number || '—'}`;
          const ticketNumber = escapePublicText(t.ticket_number || '—');
          const violationName = escapePublicText(t.violation_name || t.violation_type || 'Traffic violation');
          const plateNumber = escapePublicText(t.plate_number || '—');
          const status = escapePublicText(String(t.status || 'unpaid').toUpperCase());
          const statusClass = t.status === 'paid' ? 'sc-badge-paid' : 'sc-badge-unpaid';
          const penalty = Number(t.remaining_balance ?? t.penalty_amount ?? 0).toLocaleString('en-PH', { minimumFractionDigits: 2 });
          const ticketUrl = `public-ticket-lookup.html?ticket=${encodeURIComponent(t.ticket_number || '')}`;
          document.getElementById('scResultList').innerHTML = `<a class="sc-result-item" href="${ticketUrl}" style="text-decoration:none;color:inherit">
            <div><div class="sc-ri-plate">${ticketNumber} · ${violationName}</div>
            <div class="sc-ri-name">Plate: ${plateNumber} · ₱${penalty}</div></div>
            <span class="sc-badge ${statusClass}">${status}</span>
          </a>`;
          document.getElementById('scResult').classList.add('show');
        }
        if (window.lucide) lucide.createIcons();
      } catch (error) {
        console.error('Public lookup failed:', error);
        showErr('Connection error. Please try again shortly.');
      } finally {
        btn.innerHTML = tab === 'plate'
          ? '<i data-lucide="search"></i> Search Plate'
          : '<i data-lucide="search"></i> Search Ticket';
        if (window.lucide) lucide.createIcons();
        btn.disabled = false;
      }
    }

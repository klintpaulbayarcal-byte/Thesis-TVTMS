    // ── LOAD LIVE STATS FROM DATABASE ──────────────
    (async function loadLiveStats() {
      try {
        const res = await fetch(`${API}/public/stats`);
        const data = await res.json();
        if (!data.success) return;
        const s = data.stats;

        function animCount(el, target) {
          if (!el) return;
          let start = 0;
          const dur = 1400;
          const t0 = performance.now();
          function step(now) {
            const p = Math.min((now - t0) / dur, 1);
            const ease = 1 - Math.pow(1 - p, 3);
            el.textContent = Math.floor(ease * target).toLocaleString();
            if (p < 1) requestAnimationFrame(step);
          }
          requestAnimationFrame(step);
        }

        animCount(document.getElementById('ls-total'), s.total_tickets);
        animCount(document.getElementById('ls-paid'), s.total_paid);
        animCount(document.getElementById('ls-unpaid'), s.total_unpaid);
        animCount(document.getElementById('ls-today'), s.today_tickets);
        animCount(document.getElementById('ls-vehicles'), s.total_vehicles);
        // populate new government dashboard numbers (presentation section)
        animCount(document.getElementById('gov-total'), s.total_tickets);
        animCount(document.getElementById('gov-paid'), s.total_paid);
        animCount(document.getElementById('gov-unpaid'), s.total_unpaid);
      } catch (e) {
        // System offline - show dashes (already there)
        console.log('Live stats unavailable (system offline)');
      }
    })();

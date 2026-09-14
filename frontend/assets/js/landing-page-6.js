    // ── PROFESSIONAL MOTION SYSTEM (2026-08-04) ──
    (() => {
      const initProfessionalMotion = () => {
        const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        const finePointer = window.matchMedia('(hover: hover) and (pointer: fine)').matches;

        // Give existing reveal targets varied but restrained directions.
        const revealTargets = Array.from(
          document.querySelectorAll('.reveal, .step-card, .role-card, .feat-card')
        );

        revealTargets.forEach((el, index) => {
          if (el.classList.contains('faq-side')) {
            el.classList.add('motion-from-left');
          } else if (el.classList.contains('faq-list')) {
            el.classList.add('motion-from-right');
          } else if (el.classList.contains('about-grid') || el.classList.contains('contact-grid') || el.classList.contains('cta-box')) {
            el.classList.add('motion-scale-in');
          } else if (el.classList.contains('role-card')) {
            el.classList.add(index % 2 === 0 ? 'motion-from-left' : 'motion-from-right');
          } else if (el.classList.contains('feat-card')) {
            el.classList.add(index % 3 === 0 ? 'motion-soft-rotate' : 'motion-scale-in');
          } else {
            const variants = ['motion-from-left', 'motion-scale-in', 'motion-from-right'];
            el.classList.add(variants[index % variants.length]);
          }
        });

        // Add staggered reveals to useful supporting content that previously appeared instantly.
        const additionalItems = Array.from(document.querySelectorAll(
          '.benefit-card, .contact-info-row, .about-pill, #liveStatsBar > div:not(:first-child)'
        ));

        additionalItems.forEach((el, index) => {
          el.classList.add('motion-item');
          el.style.setProperty('--motion-delay', `${(index % 5) * 65}ms`);
          const variant = index % 3 === 0
            ? 'motion-from-left'
            : index % 3 === 1
              ? 'motion-scale-in'
              : 'motion-from-right';
          el.classList.add(variant);
        });

        if (reduceMotion || !('IntersectionObserver' in window)) {
          additionalItems.forEach(el => el.classList.add('motion-in'));
        } else {
          const itemObserver = new IntersectionObserver((entries, observer) => {
            entries.forEach(entry => {
              if (!entry.isIntersecting) return;
              entry.target.classList.add('motion-in');
              observer.unobserve(entry.target);
            });
          }, { threshold: 0.14, rootMargin: '0px 0px -7% 0px' });

          additionalItems.forEach(el => itemObserver.observe(el));
        }

        // Subtle perspective motion for the hero lookup card only.
        const searchCard = document.querySelector('.search-card');
        if (searchCard && finePointer && !reduceMotion) {
          searchCard.classList.add('motion-tilt');
          let frame = null;

          const updateTilt = (event) => {
            const rect = searchCard.getBoundingClientRect();
            const px = (event.clientX - rect.left) / rect.width;
            const py = (event.clientY - rect.top) / rect.height;
            const rotateY = (px - 0.5) * 3.2;
            const rotateX = (0.5 - py) * 2.4;

            if (frame) cancelAnimationFrame(frame);
            frame = requestAnimationFrame(() => {
              searchCard.style.setProperty('--tilt-x', `${rotateX.toFixed(2)}deg`);
              searchCard.style.setProperty('--tilt-y', `${rotateY.toFixed(2)}deg`);
            });
          };

          const resetTilt = () => {
            if (frame) cancelAnimationFrame(frame);
            searchCard.style.setProperty('--tilt-x', '0deg');
            searchCard.style.setProperty('--tilt-y', '0deg');
          };

          searchCard.addEventListener('pointermove', updateTilt, { passive: true });
          searchCard.addEventListener('pointerleave', resetTilt, { passive: true });
          searchCard.addEventListener('blur', resetTilt, true);
        }
      };

      if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initProfessionalMotion, { once: true });
      } else {
        initProfessionalMotion();
      }
    })();

// Bind page events without CSP-blocked inline attributes.
document.querySelector('[data-page-event-1]').addEventListener('error', function (event) { this.style.display='none';this.nextElementSibling.style.display='flex' });
document.querySelector('[data-page-event-2]').addEventListener('error', function (event) { this.style.display='none' });
document.querySelector('[data-page-event-3]').addEventListener('error', function (event) { this.style.display='none' });
document.querySelector('[data-page-event-4]').addEventListener('error', function (event) { this.style.display='none';this.nextElementSibling.style.display='flex' });
document.querySelectorAll('img').forEach(image => { if (image.complete && image.naturalWidth === 0) image.dispatchEvent(new Event('error')); });

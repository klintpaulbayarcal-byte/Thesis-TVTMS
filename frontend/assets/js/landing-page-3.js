    (function(){
      const loader = document.getElementById('pageLoader');
      const navToggle = document.querySelector('.nav-toggle');
      const mobileMenu = document.getElementById('navMobileMenu');

      function hideLoader(){ if(!loader) return; loader.classList.add('hidden'); }

      function preloadImage(src){
        return new Promise(res=>{
          try{
            const img = new Image();
            img.src = src;
            if(img.complete) return res(true);
            img.onload = ()=>res(true);
            img.onerror = ()=>res(true);
          }catch(e){ res(true); }
        });
      }

      const heroImgPath = 'images/background.webp';

      const windowLoaded = new Promise(res=>{
        if(document.readyState === 'complete') return res();
        window.addEventListener('load', ()=>res());
      });

      const heroLoaded = preloadImage(heroImgPath);

      // Wait for both window load and hero image, then hide loader.
      Promise.all([windowLoaded, heroLoaded]).then(()=>{
        // small buffer so canvas/animations can kick in
        setTimeout(hideLoader, 300);
      }).catch(()=> setTimeout(hideLoader, 600));

      // mobile nav wiring (ready on DOMContentLoaded)
      const hero = document.querySelector('.hero');
      let heroTicking = false;

      function updateHeroScroll(){
        if(!hero || prefersReducedMotion) return;
        const rect = hero.getBoundingClientRect();
        const offset = Math.max(Math.min(-rect.top * 0.18, 90), -90);
        hero.style.setProperty('--hero-scroll', `${offset}px`);
        heroTicking = false;
      }

      window.addEventListener('scroll', ()=>{
        if(heroTicking) return;
        heroTicking = true;
        requestAnimationFrame(updateHeroScroll);
      });

      updateHeroScroll();

      document.addEventListener('DOMContentLoaded', ()=>{
        if(navToggle && mobileMenu){
          navToggle.addEventListener('click', ()=>{
            const isOpen = mobileMenu.classList.toggle('open');
            navToggle.setAttribute('aria-expanded', String(!!isOpen));
            mobileMenu.setAttribute('aria-hidden', String(!isOpen));
          });

          mobileMenu.querySelectorAll('a').forEach(a=> a.addEventListener('click', ()=>{
            mobileMenu.classList.remove('open');
            navToggle.setAttribute('aria-expanded','false');
            mobileMenu.setAttribute('aria-hidden','true');
          }));

          document.addEventListener('click', (ev)=>{
            if(!mobileMenu.classList.contains('open')) return;
            if(ev.target.closest('#nav') || ev.target.closest('#navMobileMenu')) return;
            mobileMenu.classList.remove('open');
            navToggle.setAttribute('aria-expanded','false');
            mobileMenu.setAttribute('aria-hidden','true');
          });
        }
      });
    })();

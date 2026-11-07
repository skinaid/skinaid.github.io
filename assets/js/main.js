/* ==========================================================================
   SKIN AID — main.js
   Header, mobile nav, reveal animations, counters, treatment filter,
   horizontal scroller, FAQ accordion, booking form (Firestore + fallback),
   settings/catalog from Firebase (assets/js/backend.js, optional).
   ========================================================================== */
(function () {
  'use strict';

  const $ = (s, c = document) => c.querySelector(s);
  const $$ = (s, c = document) => Array.from(c.querySelectorAll(s));
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const smooth = reduceMotion ? 'auto' : 'smooth';
  const esc = (s) => String(s).replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));

  /* ---------- Header: scrolled state + active link ---------- */
  const header = $('.header');
  const totop = $('.totop');
  const onScroll = () => {
    const y = window.scrollY || document.documentElement.scrollTop;
    header.classList.toggle('is-scrolled', y > 24);
    if (totop) totop.classList.toggle('is-visible', y > 600);
  };
  window.addEventListener('scroll', onScroll, { passive: true });
  onScroll();
  if (totop) totop.addEventListener('click', () => window.scrollTo({ top: 0, behavior: smooth }));

  // Active section highlighting
  const navLinks = $$('.nav a[href^="#"]');
  const sections = navLinks.map(a => $(a.getAttribute('href'))).filter(Boolean);
  if ('IntersectionObserver' in window && sections.length) {
    const spy = new IntersectionObserver((entries) => {
      entries.forEach(e => {
        if (e.isIntersecting) {
          navLinks.forEach(a => a.classList.toggle('is-active', a.getAttribute('href') === '#' + e.target.id));
        }
      });
    }, { rootMargin: '-40% 0px -55% 0px' });
    sections.forEach(s => spy.observe(s));
  }

  /* ---------- Mobile drawer ---------- */
  const burger = $('.burger');
  const drawer = $('.drawer');
  if (burger && drawer) {
    const close = () => { burger.setAttribute('aria-expanded', 'false'); drawer.classList.remove('is-open'); document.body.style.overflow = ''; };
    burger.addEventListener('click', () => {
      const open = burger.getAttribute('aria-expanded') === 'true';
      if (open) return close();
      burger.setAttribute('aria-expanded', 'true');
      drawer.classList.add('is-open');
      document.body.style.overflow = 'hidden';
    });
    $$('a', drawer).forEach(a => a.addEventListener('click', close));
    window.addEventListener('resize', () => { if (window.innerWidth > 960) close(); });
  }

  /* ---------- Reveal on scroll ---------- */
  const reveals = $$('.reveal');
  // Above-the-fold elements: show immediately (no flash of hidden content)
  reveals.forEach(el => {
    const r = el.getBoundingClientRect();
    if (r.top < window.innerHeight * 0.95) { el.style.transition = 'none'; el.classList.add('is-in'); }
  });
  // Fallback: also check on scroll/resize (covers browsers that throttle observers)
  let revealTick = 0;
  const revealInView = () => {
    const now = Date.now(); if (now - revealTick < 120) return; revealTick = now;
    const h = window.innerHeight;
    reveals.forEach(el => {
      if (el.classList.contains('is-in')) return;
      const r = el.getBoundingClientRect();
      if (r.top < h - 40 && r.bottom > 0) el.classList.add('is-in');
    });
  };
  window.addEventListener('scroll', revealInView, { passive: true });
  window.addEventListener('resize', revealInView);
  if ('IntersectionObserver' in window) {
    const io = new IntersectionObserver((entries) => {
      entries.forEach(e => { if (e.isIntersecting) { e.target.classList.add('is-in'); io.unobserve(e.target); } });
    }, { threshold: 0.12, rootMargin: '0px 0px -40px 0px' });
    reveals.forEach(el => io.observe(el));
  } else {
    reveals.forEach(el => el.classList.add('is-in'));
  }

  /* ---------- Count-up numbers ---------- */
  const counters = $$('[data-count]');
  const runCounter = (el) => {
    const target = parseFloat(el.dataset.count);
    const suffix = el.dataset.suffix || '';
    const dur = 1400; const start = performance.now();
    const step = (t) => {
      const p = Math.min(1, (t - start) / dur);
      const eased = 1 - Math.pow(1 - p, 3);
      el.textContent = Math.round(target * eased).toLocaleString('en-US') + suffix;
      if (p < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  };
  if ('IntersectionObserver' in window) {
    const co = new IntersectionObserver((entries) => {
      entries.forEach(e => { if (e.isIntersecting) { runCounter(e.target); co.unobserve(e.target); } });
    }, { threshold: 0.6 });
    counters.forEach(c => co.observe(c));
  } else {
    counters.forEach(c => c.textContent = c.dataset.count + (c.dataset.suffix || ''));
  }

  /* ---------- Marquee pause ---------- */
  const mq = $('.marquee'); const mqBtn = $('.marquee__pause');
  if (mq && mqBtn) mqBtn.addEventListener('click', () => {
    const paused = mq.classList.toggle('is-paused');
    mqBtn.setAttribute('aria-pressed', String(paused));
    mqBtn.setAttribute('aria-label', paused ? 'Гүйлгээг үргэлжлүүлэх' : 'Гүйлгээг зогсоох');
  });

  /* ---------- Horizontal scroller buttons ---------- */
  $$('[data-scroller]').forEach(wrap => {
    const track = $('.scroller', wrap);
    if (!track) return;
    const amount = () => Math.min(track.clientWidth * 0.8, 660);
    $$('[data-dir]', wrap).forEach(btn => {
      btn.addEventListener('click', () => {
        track.scrollBy({ left: btn.dataset.dir === 'next' ? amount() : -amount(), behavior: smooth });
      });
    });
  });

  /* ---------- Treatment list with category filter ---------- */
  const BOOK = '#contact';
  // Анхны утга: assets/js/catalog-defaults.js (сайт + admin хоёулаа ашиглана).
  // Firestore `settings/catalog` байвал applyCatalog() доор TREATMENTS-ийг сольж дахин render хийнэ.
  const DEFAULTS = window.SKINAID_DEFAULTS || { cats: {}, treatments: [], packages: [] };
  const CATS = DEFAULTS.cats || {};
  let TREATMENTS = (DEFAULTS.treatments || []).slice();
  let renderTreatments = () => {};

  const listEl = $('#treatList');
  const chipsEl = $('#treatChips');
  const moreBtn = $('#treatMore');
  if (listEl && chipsEl) {
    let active = 'all';
    let expanded = false;
    const LIMIT = 12;

    const render = () => {
      const items = TREATMENTS.filter(t => active === 'all' || t.c === active);
      const shown = (expanded || active !== 'all') ? items : items.slice(0, LIMIT);
      listEl.innerHTML = shown.map((t, i) => `
        <a class="row" href="${BOOK}" style="animation-delay:${Math.min(i, 12) * 30}ms">
          <span class="row__dot" aria-hidden="true"></span>
          <span>
            <span class="row__cat">${CATS[t.c]}</span>
            <h3>${esc(t.n)}</h3>
            <p>${esc(t.d)}</p>
            <span class="row__meta">${t.t ? '<span>⏱ ' + esc(t.t) + '</span>' : ''}${t.p ? '<span>' + esc(t.p) + '</span>' : ''}<span>Цаг захиалах →</span></span>
          </span>
        </a>`).join('') || '<p class="list-empty">Энэ ангилалд үйлчилгээ олдсонгүй.</p>';
      const st = $('#treatStatus'); if (st) st.textContent = shown.length + ' үйлчилгээ харуулж байна';
      if (moreBtn) {
        const hidden = active === 'all' && !expanded && items.length > LIMIT;
        moreBtn.style.display = hidden ? '' : 'none';
        moreBtn.textContent = 'Бүх үйлчилгээг харах';
      }
    };

    chipsEl.innerHTML = `<button class="chip is-active" data-cat="all" aria-pressed="true">Бүгд</button>` +
      Object.entries(CATS).map(([k, v]) => `<button class="chip" data-cat="${k}" aria-pressed="false">${v}</button>`).join('');
    chipsEl.addEventListener('click', (e) => {
      const b = e.target.closest('.chip'); if (!b) return;
      active = b.dataset.cat;
      $$('.chip', chipsEl).forEach(c => { const on = c === b; c.classList.toggle('is-active', on); c.setAttribute('aria-pressed', String(on)); });
      render();
    });
    if (moreBtn) moreBtn.addEventListener('click', () => { expanded = true; render(); const first = listEl.children[LIMIT]; if (first) first.focus(); });
    render();
    renderTreatments = render;
  }

  /* Service cards -> preselect matching filter chip */
  $$('.svc[data-cat]').forEach(card => {
    card.addEventListener('click', (e) => {
      const chip = chipsEl && $(`[data-cat="${card.dataset.cat}"]`, chipsEl);
      if (!chip) return;
      e.preventDefault();
      chip.click();
      chipsEl.scrollIntoView({ behavior: smooth, block: 'start' });
    });
  });

  /* ---------- FAQ accordion ---------- */
  $$('.faq__item').forEach(item => {
    const q = $('.faq__q', item);
    q.addEventListener('click', () => {
      const open = item.classList.contains('is-open');
      $$('.faq__item.is-open').forEach(i => { i.classList.remove('is-open'); $('.faq__q', i).setAttribute('aria-expanded', 'false'); });
      if (!open) { item.classList.add('is-open'); q.setAttribute('aria-expanded', 'true'); }
    });
  });

  /* ---------- Site settings (Firestore settings/site, optional) ---------- */
  // Анхдагч утга HTML-тэй ижил; settings/site баримт байвал applySite() шинэчилнэ.
  const SITE = { phone: '7600-0505', email: 'info@skinaid.mn', messenger: 'https://m.me/Skinaid.mn', bookingEnabled: true };
  const telHref = (phone) => {
    const d = String(phone || '').replace(/[^0-9+]/g, '');
    if (d.startsWith('+')) return 'tel:' + d;
    if (d.startsWith('976') && d.length === 11) return 'tel:+' + d;   // «976 7600 0505» — улсын код аль хэдийн бий
    return 'tel:+976' + d;
  };
  let manualMode = () => {};   // маягтын хэсэгт тодорхойлогдоно: Firestore-гүй «өөрөө дамжуулах» горим
  const hideEl = (el) => { el.style.display = 'none'; };
  const applySite = (site) => {
    if (!site || typeof site !== 'object') return;
    if (typeof site.bookingEnabled === 'boolean') SITE.bookingEnabled = site.bookingEnabled;
    if (SITE.bookingEnabled === false) manualMode();
    const hours = typeof site.hours === 'string' ? site.hours.trim() : '';
    if (hours) $$('[data-site~="hours"]').forEach(el => { el.textContent = hours; });
    const phone = typeof site.phone === 'string' ? site.phone.trim() : '';
    if (phone) {
      SITE.phone = phone;
      $$('[data-site~="phone"]').forEach(el => { el.textContent = phone; });
      $$('[data-site~="tel"]').forEach(el => { el.href = telHref(phone); });
    }
    const email = typeof site.email === 'string' ? site.email.trim() : '';
    if (email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      SITE.email = email;
      $$('[data-site~="email"]').forEach(el => { el.textContent = email; });
      $$('[data-site~="mailto"]').forEach(el => { el.href = 'mailto:' + email; });
    }
    if (site.promoEnabled === false) {
      const promo = $('#promo'); if (promo) hideEl(promo);
      $$('a[href="#promo"]').forEach(a => hideEl(a.closest('li') || a));
    }
  };
  const applyCatalog = (cat) => {
    if (!cat || typeof cat !== 'object') return;
    if (Array.isArray(cat.services)) {   // хадгалсан массив байвал тэр нь эцсийн: хоосон бол сайт ч хоосон харуулна
      const list = cat.services
        .filter(sv => sv && typeof sv === 'object' && !sv.hidden && typeof sv.n === 'string' && sv.n.trim())
        .map(sv => ({
          id: String(sv.id || ''),
          c: Object.prototype.hasOwnProperty.call(CATS, sv.c) ? sv.c : 'minor',
          n: sv.n.trim(), d: typeof sv.d === 'string' ? sv.d : '',
          t: typeof sv.t === 'string' ? sv.t : '', p: typeof sv.p === 'string' ? sv.p : '',
        }));
      TREATMENTS = list; renderTreatments();
    }
    if (Array.isArray(cat.packages)) {
      cat.packages.forEach(pk => {
        if (!pk || typeof pk !== 'object' || typeof pk.id !== 'string') return;
        const card = $(`[data-pack="${CSS.escape(pk.id)}"]`);
        if (!card) return;
        if (pk.hidden) { hideEl(card); return; }
        const price = $('.pack__price strong', card);
        if (price && typeof pk.price === 'string' && pk.price.trim()) price.textContent = pk.price.trim();
        const title = $('h3', card);
        if (title && typeof pk.name === 'string' && pk.name.trim()) {
          const [first, ...rest] = pk.name.trim().split(' ');
          title.textContent = first + (rest.length ? ' ' : '');
          if (rest.length) { const em = document.createElement('em'); em.textContent = rest.join(' '); title.appendChild(em); }
        }
      });
      const visible = $$('[data-pack]').filter(c => c.style.display !== 'none').length;
      const cnt = $('[data-pack-count]'); if (cnt) cnt.textContent = visible + ' онцгой багц';
      if (visible === 0) { const promo = $('#promo'); if (promo) hideEl(promo); $$('a[href="#promo"]').forEach(a => hideEl(a.closest('li') || a)); }
    }
  };
  const applySettings = (s) => { if (!s) return; applySite(s.site); applyCatalog(s.catalog); };
  document.addEventListener('skinaid:settings', (e) => applySettings(e.detail));
  if (window.SkinAidBackend && window.SkinAidBackend.settings) applySettings(window.SkinAidBackend.settings);

  /* ---------- Booking form: Firestore-д бичнэ, бүтэлгүйтвэл сувгуудын panel ---------- */
  const form = $('#bookForm');
  if (form) {
    const ok = $('.form__ok', form);
    const submitBtn = $('button[type="submit"]', form);
    const bookStatus = $('#bookStatus');
    const nameEl = $('#f-name', form), phoneEl = $('#f-phone', form);
    let submitLabel = submitBtn ? submitBtn.textContent : '';
    let busy = false;

    const setBusy = (on) => {
      busy = on;
      if (bookStatus) bookStatus.textContent = on ? 'Хүсэлт илгээж байна…' : '';
      if (!submitBtn) return;
      submitBtn.disabled = on;
      submitBtn.setAttribute('aria-busy', String(on));
      submitBtn.textContent = on ? 'Илгээж байна…' : submitLabel;
    };
    // Firestore ашиглахгүй горим (admin унтраасан эсвэл backend.js ачаалагдаагүй): маягтын текст өмнөх «өөрөө дамжуулах» хэлбэрт
    manualMode = () => {
      const p = $('p', form); if (p) p.textContent = 'Маягтаа бөглөөд Messenger, и-мэйл эсвэл утсаар бидэнд дамжуулна уу. Зөвлөх тантай холбогдож цагийг баталгаажуулна.';
      submitLabel = 'Үргэлжлүүлэх';
      if (submitBtn && !busy) submitBtn.textContent = submitLabel;
    };
    document.addEventListener('skinaid:backend-failed', manualMode);
    [nameEl, phoneEl].forEach(el => { if (el) el.addEventListener('input', () => el.setCustomValidity('')); });
    const withTimeout = (p, ms) => new Promise((res, rej) => {
      const t = setTimeout(() => rej(new Error('timeout')), ms);
      Promise.resolve(p).then(v => { clearTimeout(t); res(v); }, err => { clearTimeout(t); rej(err); });
    });
    const buildText = (d) => [
      'Цаг захиалах хүсэлт — SkinAid',
      'Нэр: ' + (d.name || '-'),
      'Утас: ' + (d.phone || '-'),
      'Үйлчилгээ: ' + (d.service || '-'),
      'Хүссэн огноо: ' + (d.date || 'тохиролцоно'),
      d.message ? 'Нэмэлт: ' + d.message : '',
    ].filter(Boolean).join('\n');
    const finish = () => {
      form.classList.add('is-sent');
      ok.tabIndex = -1;
      ok.focus({ preventScroll: true });
      form.closest('.form').scrollIntoView({ behavior: smooth, block: 'center' });
    };
    const wireEdit = () => {
      const b = $('[data-edit]', ok);
      if (b) b.addEventListener('click', () => {
        form.classList.remove('is-sent'); ok.classList.remove('form__ok--warn');
        if (nameEl) nameEl.focus({ preventScroll: true });   // фокус панелтай хамт алга болохгүй
      });
    };

    // Амжилттай: хүсэлт Firestore-д бүртгэгдсэн
    const showSuccess = (d) => {
      ok.classList.remove('form__ok--warn');
      ok.innerHTML = `<strong>Баярлалаа, ${esc(d.name || 'эрхэм үйлчлүүлэгч')}!</strong><br>
        Хүсэлт тань бүртгэгдлээ. Зөвлөх <strong>${esc(d.phone || '')}</strong> дугаараар тантай холбогдож цагийг баталгаажуулна.
        Яаралтай бол <a href="${telHref(SITE.phone)}" style="color:var(--purple);font-weight:700">${esc(SITE.phone)}</a> дугаарт залгаарай.
        <div class="form__channels">
          <a class="btn btn--outline btn--sm" href="${esc(SITE.messenger)}" target="_blank" rel="noopener">Messenger-ээр мөн бичих</a>
          <button class="btn btn--ghost btn--sm" type="button" data-edit>Шинэ хүсэлт</button>
        </div>`;
      wireEdit();
      const b = $('[data-edit]', ok); if (b) b.addEventListener('click', () => form.reset());
    };

    // Бүтэлгүйтсэн / унтраалттай: хүсэлтийг бэлтгэж, үйлчлүүлэгч өөрөө сувгаар дамжуулна (өмнөх ажиллагаа)
    const showFallback = (d, text, reason) => {
      const enc = encodeURIComponent(text);
      const sms = telHref(SITE.phone).replace('tel:', 'sms:');
      ok.classList.toggle('form__ok--warn', Boolean(reason));
      ok.innerHTML = `<strong>Баярлалаа, ${esc(d.name || 'эрхэм үйлчлүүлэгч')}!</strong><br>
        ${reason ? esc(reason) + ' ' : ''}Хүсэлт тань бэлэн боллоо — доорх сувгуудын аль нэгээр бидэнд дамжуулна уу, зөвлөх тантай холбогдож цагийг баталгаажуулна. Messenger-ээр илгээхдээ текстийг хуулж буулгана уу.
        <div class="form__msg">${esc(text)}</div>
        <div class="form__channels">
          <a class="btn btn--primary btn--sm" href="${esc(SITE.messenger)}" target="_blank" rel="noopener">Messenger-ээр илгээх</a>
          <a class="btn btn--outline btn--sm" href="mailto:${esc(SITE.email)}?subject=${encodeURIComponent('Цаг захиалах хүсэлт')}&body=${enc}">И-мэйлээр илгээх</a>
          <a class="btn btn--outline btn--sm" href="${sms}?&body=${enc}">SMS-ээр илгээх</a>
          <button class="btn btn--ghost btn--sm" type="button" data-copy>Текст хуулах</button>
          <a class="btn btn--ghost btn--sm" href="${telHref(SITE.phone)}">${esc(SITE.phone)} залгах</a>
          <button class="btn btn--ghost btn--sm" type="button" data-edit>← Засварлах</button>
        </div>`;
      $('[data-copy]', ok).addEventListener('click', async (ev) => {
        try { await navigator.clipboard.writeText(text); ev.currentTarget.textContent = 'Хуулагдлаа ✓'; }
        catch (_) { ev.currentTarget.textContent = 'Хуулж чадсангүй'; }
      });
      wireEdit();
    };

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (busy) return;
      const d = Object.fromEntries(new FormData(form).entries());
      // Backend-тэй ижил хэвшүүлсэн утгаар шалгана (зөвхөн зай, 1 үсэг гэх мэт) — fallback биш талбарын алдаа харуулна
      const nameN = String(d.name || '').replace(/\s+/g, ' ').trim();
      const phoneDigits = String(d.phone || '').replace(/[^0-9]/g, '');
      if (nameEl) nameEl.setCustomValidity(nameN.length < 2 ? 'Нэрээ дор хаяж 2 тэмдэгтээр бичнэ үү' : '');
      if (phoneEl) phoneEl.setCustomValidity(phoneDigits.length < 8 ? 'Утасны дугаар дор хаяж 8 оронтой байна' : '');
      if (!form.reportValidity()) return;
      const text = buildText(d);

      // Honeypot: далд талбарыг зөвхөн бот бөглөнө — юу ч бичилгүй "амжилттай" гэж харуулна
      if (d.website) { showSuccess(d); finish(); return; }

      const backend = window.SkinAidBackend;
      if (SITE.bookingEnabled === false || !backend || typeof backend.submitBooking !== 'function') {
        showFallback(d, text, ''); finish(); return;
      }
      setBusy(true);
      const pending = backend.submitBooking({ name: d.name, phone: d.phone, service: d.service, date: d.date, message: d.message });
      try {
        await withTimeout(pending, 12000);
        showSuccess(d);
      } catch (err) {
        showFallback(d, text, 'Автомат бүртгэл түр амжилтгүй боллоо.');
        // Удаан сүлжээнд бичилт 12с-ийн дараа амжилттай болбол fallback-ийг амжилттай панелаар солино (давхар захиалга гарахгүй)
        pending.then(() => {
          if (form.classList.contains('is-sent') && ok.classList.contains('form__ok--warn')) { showSuccess(d); ok.focus({ preventScroll: true }); }
        }, () => {});
      } finally {
        setBusy(false);
      }
      finish();
    });
    // Minimum date = today (local time, not UTC)
    const date = $('input[type="date"]', form);
    if (date) { const n = new Date(); date.min = new Date(n.getTime() - n.getTimezoneOffset() * 60000).toISOString().slice(0, 10); }
  }

  /* ---------- Footer year ---------- */
  const y = $('#year'); if (y) y.textContent = new Date().getFullYear();
})();

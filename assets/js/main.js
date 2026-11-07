/* ==========================================================================
   SKIN AID — main.js
   Header, mobile nav, reveal animations, counters, treatment filter,
   horizontal scroller, FAQ accordion, booking form.
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
  const TREATMENTS = [
    // Үзлэг
    { c: 'exam', n: 'Арьсны үзлэг, оношлогоо', d: 'Батганы үрэвсэл, үрчлээ, арьсны өвчин, нүхжилтийн цогц оношлогоо, эмчилгээний төлөвлөгөө.', t: '1 цаг', p: '₮50,000' },
    { c: 'exam', n: 'Онлайн оношлогоо', d: 'Арьс, харшил, гоо заслын бүх төрлийн зөвлөгөөг мэргэжлийн эмч онлайнаар өгнө.' },
    { c: 'exam', n: 'Давтан үзлэг', d: 'Эмчилгээний явц, үр дүнг хянах давтан үзлэг.' },
    // Батга
    { c: 'acne', n: 'Үрэвсэлт батганы эмчилгээ', d: 'Нэг удаагийн мэргэжлийн цэвэрлэгээ, үрэвсэл намдаах эмчилгээ.' },
    { c: 'acne', n: 'Батганы багц эмчилгээ', d: 'Арьсны онцлогт тохирсон 1/1–2/5 хүртэлх хэмнэлттэй, үр дүнтэй багц.' },
    { c: 'acne', n: 'Цээж, нурууны батганы эмчилгээ', d: 'Цээж, нурууны хэсгийн батгыг цэвэрлэж, эрүүл арьсыг сэргээнэ. Карбоксийн хамт хийх боломжтой.' },
    { c: 'acne', n: 'IPL батганы багцын урамшуулал', d: 'Гэрлэн эмчилгээг батганы багцтай хослуулсан урамшуулалтай үйлчилгээ.' },
    { c: 'acne', n: 'Карбокси эмчилгээ', d: 'Арьсанд хүчилтөрөгч бэлэглэж, үрэвсэл, нөсөө багасгах нэг удаагийн эмчилгээ.' },
    // Сорви, нүхжилт
    { c: 'scar', n: 'CO₂ Fractional лазер', d: 'Лазерын микро цацрагаар коллаген нийлэгжилтийг өдөөж, сорви, нүхжилтийг тэгшлэнэ.' },
    { c: 'scar', n: 'VIVACE Needle RF', d: 'Бичил зүү + радио давтамжийн хосолсон эмчилгээ: нүхжилт, сорви, арьсны бүтэц.' },
    { c: 'scar', n: 'MTS Microneedling', d: 'Бичил зүүн эмчилгээгээр арьсны нөхөн төлжилтийг идэвхжүүлнэ.' },
    { c: 'scar', n: 'Сорви салгах эмчилгээ', d: 'Сорвийг бүдгэрүүлж, арьсны гадаргууг жигд болгоно.' },
    { c: 'scar', n: 'Келоид шимэгдүүлэх тарилга', d: 'Келоид сорвийг багасгаж, зөөлрүүлэх тарилга эмчилгээ.' },
    // Тарилга (PREMIUM)
    { c: 'inject', n: 'REJURAN 2ml / 4ml', d: '"Тарилгын хатан хаан" — PDRN-д суурилсан арьс нөхөн төлжүүлэх тарилга.' },
    { c: 'inject', n: 'Juvelook тарилга', d: 'Арьс залуужуулах, чангалах коллаген өдөөгч тарилга.' },
    { c: 'inject', n: 'Lapuroon Aurora-S / Aurora-V', d: 'PDRN, гиалурон, пептид, амин хүчлийн комплекс skin booster.' },
    { c: 'inject', n: 'Cellbooster Glow', d: 'Швейцарын SUISSELLE-ийн патентлагдсан гэрэлтүүлэх тарилга.' },
    { c: 'inject', n: 'Exo one эхэс тарилга', d: 'Эксосом технологиор арьсыг эсийн түвшинд сэргээнэ.' },
    { c: 'inject', n: 'Загасан тарилга (PDRN)', d: 'Арьсыг нөхөн сэргээх PDRN тарилга.' },
    { c: 'inject', n: 'Япон гиалуроны тарилга', d: 'Японы технологиор гүн чийгшил, залуу төрхийг сэргээнэ.' },
    { c: 'inject', n: 'ASCE plus SRLV', d: 'Үүдэл эсийн дэвшилтэт технологийн эсийн нөхөн төлжилт.' },
    { c: 'inject', n: 'Cellbooster Hair — үсний мезо', d: 'Үсний үндсийг бэхжүүлэх мезотерапи.' },
    // Хөгшрөлтийн эсрэг, хэлбэр
    { c: 'anti', n: 'Ботокс (1 тун)', d: 'Үрчлээ арилгах, тэнийлгэх. V-Line, хуян, суганы хөлрөлтийн ботокс.' },
    { c: 'anti', n: 'Дүүргэгч филлер', d: 'Нүүрний хэлбэр засах, уруулын филлер (1 мл), эзлэхүүн сэргээх.' },
    { c: 'anti', n: 'Facetem CaHA тарилга', d: 'Коллаген өдөөх дэвшилтэт тарилга: тал / 2 бүтэн / филлертэй.' },
    { c: 'anti', n: 'Плазма эмчилгээ', d: 'Нүдний цацраг үрчлээ, чихний урд хэсгийн үрчлээнд.' },
    { c: 'anti', n: 'Филлер хайлуулагч тарилга', d: 'Өмнөх филлерийг аюулгүй хайлуулж, төрөлх төрхийг сэргээнэ.' },
    // Залуужуулах, гэрэлтүүлэх
    { c: 'glow', n: 'Glass skin therapy', d: 'Гүний бохирдлын цэвэрлэгээ, чийгшил, тайвшрал — массажтай/массажгүй.' },
    { c: 'glow', n: 'AHA 70% химийн гуужуулалт', d: 'Арьсыг гүн гуужуулж, толигор гэрэлтсэн төрхийг цогцлооно.' },
    { c: 'glow', n: 'Хүчилээр арчих / TCA', d: 'Мэргэжлийн химийн пийл, арьсны нөхөн сэргээлт.' },
    { c: 'glow', n: 'Карбокси + Карбон пийл', d: 'Хүчилтөрөгч + нүүрстөрөгчийн хосолсон гэрэлтүүлэх эмчилгээ.' },
    { c: 'glow', n: 'Хацрын улайлтын IPL', d: 'Улайлтгүй, жигд өнгөтэй толигор арьсны нууц.' },
    // Чангалах
    { c: 'lift', n: 'Ультраформер III (HIFU)', d: 'Мэсгүй, өвдөлтгүй арьс чангалж өргөх, өөх хайлуулах дэвшилтэт технологи.', t: '1ц 30м', p: '₮300,000-с' },
    { c: 'lift', n: 'Моно Thread утсан эмчилгээ', d: 'Мэс заслын бус аргаар арьсыг өргөж, чангаруулж, залуужуулна.' },
    { c: 'lift', n: 'Cellbooster Shape өөх хайлуулах', d: 'Илүүдэл өөхийг багасгаж, нүүр, биеийн хэлбэрийг сайжруулна.' },
    // Лазер
    { c: 'laser', n: 'Diode лазер үс арилгах', d: 'Нүүр, сахал, суга, бикини, гар, хөл, бүтэн бие — урт хугацааны толигор арьс.' },
    { c: 'laser', n: 'IPL үсний ургалт зогсоох', d: 'Суга, гар, хөл, бикини, шилбэ.' },
    { c: 'laser', n: 'IPL гэрлэн эмчилгээ', d: 'Арьсны өнгө жигдрүүлэх, батга, улайлтад.' },
    { c: 'laser', n: 'Нөсөө лазер (Pigmentation)', d: 'Цэвэрхэн, эрүүл, жигд өнгөтэй арьсны төлөө.' },
    // Дусал
    { c: 'iv', n: 'Glutathione 1200', d: 'Антиоксидант, гэрэлтүүлэх, хоргүйжүүлэх премиум дусал.' },
    { c: 'iv', n: 'Эссенциале дусал', d: 'Элэгний эрүүл мэнд, эрч хүчийг дэмжинэ.' },
    { c: 'iv', n: 'L-Carnitine тураах дусал', d: 'Бодисын солилцоог идэвхжүүлж, жин хасахад тусална.' },
    { c: 'iv', n: 'Дархлааны дусал', d: 'Plevita, амин хүчил, сармис, BFLUID, Рингер, Синделла, харшлын эсрэг дусал.' },
    // Массаж
    { c: 'massage', n: 'RF нүүр, хүзүүний массаж', d: 'Радио давтамжаар арьсыг чангалж, өнгө зүсийг сэргээнэ.' },
    { c: 'massage', n: 'RF хүйтэн массаж', d: 'Тайвшруулах, хавдар намдаах хүйтэн RF массаж.' },
    { c: 'massage', n: 'Карбокситой нүүрний массаж', d: 'Арьсанд хүчилтөрөгч бэлэглэж, залуу төрхийг хадгална.' },
    { c: 'massage', n: 'Хүзүү, цээж, нуруу, гарын массаж', d: 'Дээд биеийн алжаал тайлах, хөнгөвчлөх массаж.' },
    // Жижиг ажилбар
    { c: 'minor', n: 'Үү авах', d: 'Энгийн үү, улны үү, хавтгай үүний эмчилгээ.' },
    { c: 'minor', n: 'Ургацаг авах', d: 'Эрүүл, булбарай арьсны төлөө мэргэжлийн ажилбар.' },
    { c: 'minor', n: 'Суганы хөлрөлт арилгах ботокс', d: 'Хэт хөлрөлтийг удаан хугацаанд багасгана.' },
  ];
  const CATS = {
    exam: 'Үзлэг', acne: 'Батга', scar: 'Сорви, нүхжилт', inject: 'Тарилга', anti: 'Хөгшрөлтийн эсрэг',
    glow: 'Залуужуулах', lift: 'Чангалах', laser: 'Лазер', iv: 'Дусал', massage: 'Массаж', minor: 'Жижиг ажилбар'
  };

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
    if (moreBtn) moreBtn.addEventListener('click', () => { expanded = true; render(); });
    render();
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

  /* ---------- Booking form (front-end only) ---------- */
  const form = $('#bookForm');
  if (form) {
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      if (!form.reportValidity()) return;
      const d = Object.fromEntries(new FormData(form).entries());
      // Статик хостинг (GitHub Pages) тул маягт серверт илгээгдэхгүй: хүсэлтийг бэлтгэж, үйлчлүүлэгч
      // өөрийн сонгосон сувгаар дамжуулна. Автомат илгээлт хэрэгтэй бол Formspree/Getform зэрэг
      // үйлчилгээний endpoint-ийг энд fetch POST-оор холбоно (README-г үзнэ үү).
      const text = [
        'Цаг захиалах хүсэлт — SkinAid',
        'Нэр: ' + (d.name || '-'),
        'Утас: ' + (d.phone || '-'),
        'Үйлчилгээ: ' + (d.service || '-'),
        'Хүссэн огноо: ' + (d.date || 'тохиролцоно'),
        d.message ? 'Нэмэлт: ' + d.message : '',
      ].filter(Boolean).join('\n');
      const enc = encodeURIComponent(text);
      const ok = $('.form__ok', form);
      ok.innerHTML = `<strong>Баярлалаа, ${esc(d.name || 'эрхэм үйлчлүүлэгч')}!</strong><br>
        Хүсэлт тань бэлэн боллоо. Энэ сайт хүсэлтийг автоматаар илгээдэггүй тул доорх сувгуудын аль нэгээр бидэнд дамжуулна уу — зөвлөх тантай холбогдож цагийг баталгаажуулна. Messenger-ээр илгээхдээ текстийг хуулж буулгана уу.
        <div class="form__msg">${esc(text)}</div>
        <div class="form__channels">
          <a class="btn btn--primary btn--sm" href="https://m.me/Skinaid.mn" target="_blank" rel="noopener">Messenger-ээр илгээх</a>
          <a class="btn btn--outline btn--sm" href="mailto:info@skinaid.mn?subject=${encodeURIComponent('Цаг захиалах хүсэлт')}&body=${enc}">И-мэйлээр илгээх</a>
          <a class="btn btn--outline btn--sm" href="sms:+97676000505?&body=${enc}">SMS-ээр илгээх</a>
          <button class="btn btn--ghost btn--sm" type="button" data-copy>Текст хуулах</button>
          <a class="btn btn--ghost btn--sm" href="tel:+97676000505">7600-0505 залгах</a>
          <button class="btn btn--ghost btn--sm" type="button" data-edit>← Засварлах</button>
        </div>`;
      $('[data-copy]', ok).addEventListener('click', async (ev) => {
        try { await navigator.clipboard.writeText(text); ev.currentTarget.textContent = 'Хуулагдлаа ✓'; }
        catch (_) { ev.currentTarget.textContent = 'Хуулж чадсангүй'; }
      });
      $('[data-edit]', ok).addEventListener('click', () => { form.classList.remove('is-sent'); });
      form.classList.add('is-sent');
      ok.tabIndex = -1;
      ok.focus({ preventScroll: true });
      form.closest('.form').scrollIntoView({ behavior: smooth, block: 'center' });
    });
    // Minimum date = today (local time, not UTC)
    const date = $('input[type="date"]', form);
    if (date) { const n = new Date(); date.min = new Date(n.getTime() - n.getTimezoneOffset() * 60000).toISOString().slice(0, 10); }
  }

  /* ---------- Footer year ---------- */
  const y = $('#year'); if (y) y.textContent = new Date().getFullYear();
})();

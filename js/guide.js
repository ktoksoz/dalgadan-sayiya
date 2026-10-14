/* Deney rehberi:
   1) Hayalet el: slayta ilk girişte deneyin ilk hamlesini gerçek kontrollerle bir kez oynar.
      Kullanıcı herhangi bir yere dokunur ya da tuşa basarsa hemen durur.
   2) Hedef nabzı: denenecek kontrolün etrafında genişleyen altın halkalar.
   3) "Dene" kutusu: üzerine gelince hedefi gösterir, tıklayınca gösterimi yeniden oynatır.
   G tuşu rehberi açıp kapatır. */
(function () {
  // Senaryolar. Bulucular: "=Metin" tam eşleşen düğme, "Metin" ile başlayan düğme,
  // "label:x" aria-label'lı kaydırıcı, "aria:x" aria-label'lı öğe, "css:x" seçici.
  // Senaryolar js/guide-scenarios.js'te tanımlanır (window.GUIDE_SCENARIOS)
  const S = window.GUIDE_SCENARIOS || {};

  let enabled = true;
  try { enabled = localStorage.getItem("rehber.kapali") !== "1"; } catch (e) {}
  const seen = new Set();

  // sentetik pointer olaylarında setPointerCapture hata vermesin
  const origCap = Element.prototype.setPointerCapture;
  Element.prototype.setPointerCapture = function (id) { try { return origCap.call(this, id); } catch (e) {} };

  const activeSlide = () => document.querySelector(".slide.active");
  const narrow = () => window.matchMedia("(max-width: 860px)").matches;
  function find(slide, q) {
    if (!slide || !q) return null;
    if (q.startsWith("css:")) return slide.querySelector(q.slice(4));
    if (q.startsWith("label:")) return slide.querySelector(`input[aria-label="${q.slice(6)}"]`);
    if (q.startsWith("aria:")) return slide.querySelector(`[aria-label="${q.slice(5)}"]`);
    const exact = q.startsWith("="), t = exact ? q.slice(1) : q;
    return [...slide.querySelectorAll(".stage button, .stage [role=button]")].find((b) => {
      const s = b.textContent.trim();
      return b.offsetParent !== null && (exact ? s === t : s.startsWith(t));
    }) || null;
  }
  // nabız halkasının gösterileceği öğe ilk adımdan farklıysa
  const TARGET = window.GUIDE_TARGETS || {};
  const targetOf = (slide) => {
    if (TARGET[slide.id]) { const el = find(slide, TARGET[slide.id]); if (el) return el; }
    const steps = S[slide.id] || [];
    for (const st of steps) { const el = find(slide, st.click || st.slide || st.tap || st.draw || st.drag || st.move); if (el) return el; }
    return null;
  };

  /* --- hayalet el --- */
  const hand = document.createElement("div");
  hand.id = "ghost-hand";
  hand.setAttribute("aria-hidden", "true");
  hand.innerHTML = '<svg viewBox="0 0 32 32"><path d="M11 3.5c1.1 0 2 .9 2 2v9.2l1-.2V12c0-1.1.9-2 2-2s2 .9 2 2v2.6l.8-.1v-1.2c0-1.1.9-2 2-2s2 .9 2 2v1.6l.4-.1c1.1 0 2 .9 2 2V21c0 4.4-3.6 8-8 8h-1.6c-2.6 0-5-1.3-6.5-3.4l-4.3-6.2c-.6-.9-.4-2.1.5-2.8.9-.6 2.1-.5 2.8.3L9 18.8V5.5c0-1.1.9-2 2-2z" fill="#fff8e6" stroke="#1d1300" stroke-width="1.4" stroke-linejoin="round"/></svg>';
  document.body.append(hand);
  const ring = document.createElement("div");
  ring.id = "guide-ring";
  ring.setAttribute("aria-hidden", "true");
  document.body.append(ring);

  let run = 0; // her oynatma bir numara alır; numara değişirse eski oynatma durur
  let hx = innerWidth * 0.75, hy = innerHeight * 0.8;
  const sleep = (ms, id) => new Promise((res, rej) => setTimeout(() => (id === run ? res() : rej("iptal")), ms));
  function place(x, y) { hx = x; hy = y; hand.style.transform = `translate(${x - 11}px, ${y - 4}px)`; }
  function moveTo(x, y, ms, id) {
    const x0 = hx, y0 = hy, t0 = performance.now();
    return new Promise((res, rej) => {
      (function tick(t) {
        if (id !== run) return rej("iptal");
        const k = Math.min(1, (t - t0) / ms), e = k < 0.5 ? 2 * k * k : 1 - (-2 * k + 2) ** 2 / 2;
        place(x0 + (x - x0) * e, y0 + (y - y0) * e);
        k < 1 ? requestAnimationFrame(tick) : res();
      })(t0);
    });
  }
  function ripple(x, y) {
    const r = document.createElement("i");
    r.className = "ghost-ripple"; r.style.left = x + "px"; r.style.top = y + "px";
    document.body.append(r);
    setTimeout(() => r.remove(), 700);
  }
  const center = (el) => { const r = el.getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; };
  function ptr(el, type, x, y, down) {
    el.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, pointerId: 1, pointerType: "mouse", isPrimary: true, buttons: down ? 1 : 0 }));
  }
  async function press(id, x, y) {
    hand.classList.add("down"); ripple(x, y);
    await sleep(160, id);
    hand.classList.remove("down");
  }

  async function step(slide, st, id) {
    if (st.wait) return sleep(st.wait, id);
    const el = find(slide, st.click || st.slide || st.tap || st.draw || st.drag || st.move);
    if (!el) return;
    if (st.click || st.move) {
      const [x, y] = center(el);
      await moveTo(x, y, 650, id);
      if (st.move) return press(id, x, y);
      await press(id, x, y);
      el.click();
      return sleep(500, id);
    }
    if (st.tap) {
      const r = el.getBoundingClientRect();
      const x = r.left + r.width * st.at[0], y = r.top + r.height * st.at[1];
      await moveTo(x, y, 700, id);
      await press(id, x, y);
      ptr(el, "pointermove", x, y, false); ptr(el, "pointerdown", x, y, true); ptr(el, "pointerup", x, y, false);
      el.dispatchEvent(new MouseEvent("click", { bubbles: true, clientX: x, clientY: y }));
      return sleep(500, id);
    }
    if (st.slide) {
      const r = el.getBoundingClientRect();
      const min = +el.min, max = +el.max;
      const xOf = (v) => r.left + 8 + ((v - min) / (max - min)) * (r.width - 16);
      const from = +el.value, cy = r.top + r.height / 2;
      await moveTo(xOf(from), cy, 600, id);
      hand.classList.add("down");
      const steps = 28;
      for (let i = 1; i <= steps; i++) {
        const v = from + ((st.to - from) * i) / steps;
        el.value = v;
        el.dispatchEvent(new Event("input", { bubbles: true }));
        place(xOf(+el.value), cy);
        await sleep(32, id);
      }
      hand.classList.remove("down");
      return sleep(300, id);
    }
    if (st.draw || st.drag) {
      // draw: tuvalin ortasındaki kareye göre; drag: öğenin tüm dikdörtgenine göre
      const r = el.getBoundingClientRect(), s = Math.min(r.width, r.height);
      const P = st.drag
        ? st.path.map(([fx, fy]) => [r.left + fx * r.width, r.top + fy * r.height])
        : st.path.map(([fx, fy]) => [r.left + (r.width - s) / 2 + fx * s, r.top + (r.height - s) / 2 + fy * s]);
      await moveTo(P[0][0], P[0][1], 650, id);
      hand.classList.add("down");
      ptr(el, "pointerdown", P[0][0], P[0][1], true);
      for (let k = 1; k < P.length; k++) {
        const [ax, ay] = P[k - 1], [bx, by] = P[k];
        const n = Math.ceil(Math.hypot(bx - ax, by - ay) / (st.drag ? 4 : 6));
        for (let i = 1; i <= n; i++) {
          const x = ax + ((bx - ax) * i) / n, y = ay + ((by - ay) * i) / n;
          place(x, y); ptr(el, "pointermove", x, y, true);
          await sleep(14, id);
        }
      }
      ptr(el, "pointerup", hx, hy, false);
      hand.classList.remove("down");
      return sleep(400, id);
    }
  }

  async function play(slide, quick) {
    const steps = S[slide.id];
    if (!steps) return;
    const id = ++run;
    const t = targetOf(slide);
    try {
      await sleep(quick ? 150 : 900, id);
      if (t && slide.id !== "kapak") pulse(t); // kapakta tüm ekranı çevreleyen halka gereksiz
      const [sx, sy] = t ? center(t) : [innerWidth / 2, innerHeight / 2];
      place(sx + 140, sy + 120);
      hand.classList.add("on");
      await sleep(250, id);
      for (const st of steps) await step(slide, st, id);
      await sleep(500, id);
    } catch (e) { /* iptal */ }
    if (id === run) stop(false);
  }
  function stop(keepRing) {
    run++;
    hand.classList.remove("on", "down");
    if (!keepRing) unpulse();
  }

  /* --- hedef nabzı --- */
  let ringEl = null, ringRaf = 0;
  function follow() {
    if (!ringEl) return;
    const r = ringEl.getBoundingClientRect();
    if (!r.width) { unpulse(); return; }
    Object.assign(ring.style, { left: r.left - 6 + "px", top: r.top - 6 + "px", width: r.width + 12 + "px", height: r.height + 12 + "px" });
    ringRaf = requestAnimationFrame(follow);
  }
  function pulse(el, still) {
    cancelAnimationFrame(ringRaf);
    ringEl = el;
    ring.className = still ? "still" : "";
    void ring.offsetWidth;
    ring.classList.add("on");
    const r = getComputedStyle(el).borderRadius;
    ring.style.borderRadius = el.tagName === "CANVAS" ? "14px" : r && r !== "0px" ? `calc(${r} + 6px)` : "10px";
    follow();
  }
  function unpulse() { cancelAnimationFrame(ringRaf); ringEl = null; ring.className = ""; }

  /* --- "Dene" kutuları --- */
  document.querySelectorAll(".slide .try").forEach((box) => {
    const slide = box.closest(".slide");
    if (!S[slide.id]) return;
    box.classList.add("try-live");
    box.setAttribute("role", "button");
    box.tabIndex = 0;
    box.title = "Göstermek için tıklayın";
    box.insertAdjacentHTML("beforeend", '<span class="try-cta">Göster</span>');
    box.addEventListener("mouseenter", () => { if (!hand.classList.contains("on")) { const t = targetOf(slide); t && pulse(t, true); } });
    box.addEventListener("mouseleave", () => { if (!hand.classList.contains("on")) unpulse(); });
    const go = (e) => {
      e.preventDefault(); e.stopPropagation(); stop();
      if (narrow()) {
        // önce demoyu görünür yap, kaydırma bitince oynat
        slide.querySelector(".stage").scrollIntoView({ behavior: "smooth", block: "start" });
        setTimeout(() => play(slide, true), 650);
      } else play(slide);
    };
    box.addEventListener("click", go);
    box.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") go(e); });
  });

  // gerçek kullanıcı etkileşimi gösterimi durdurur
  ["pointerdown", "wheel"].forEach((t) => window.addEventListener(t, (e) => {
    if (e.isTrusted && hand.classList.contains("on") && !e.target.closest(".try-live")) stop();
  }, { capture: true, passive: true }));
  window.addEventListener("keydown", (e) => {
    if (!e.isTrusted) return;
    if ((e.key === "g" || e.key === "G") && !e.metaKey && !e.ctrlKey && !(e.target.matches && e.target.matches("input[type=text], textarea"))) {
      enabled = !enabled;
      try { localStorage.setItem("rehber.kapali", enabled ? "0" : "1"); } catch (er) {}
      toast(enabled ? "Deney gösterimleri açık" : "Deney gösterimleri kapalı (G ile açılır)");
      if (!enabled) stop();
      return;
    }
    if (hand.classList.contains("on")) stop();
  }, true);

  const toastEl = document.createElement("div");
  toastEl.id = "guide-toast";
  document.body.append(toastEl);
  let toastT = 0;
  function toast(msg) { toastEl.textContent = msg; toastEl.classList.add("on"); clearTimeout(toastT); toastT = setTimeout(() => toastEl.classList.remove("on"), 2200); }

  // slayt değişimi: ilk ziyarette gösterimi başlat
  let last = null;
  function onSlide() {
    const s = activeSlide();
    if (!s || s === last) return;
    last = s;
    stop();
    if (!enabled || seen.has(s.id) || !S[s.id]) return;
    seen.add(s.id);
    // tek sütun düzende (telefon, dikey tablet) demo ekranın altında kalır; otomatik oynatma
    // yerine "Göster" düğmesi kullanılır
    if (narrow()) return;
    play(s);
  }
  new MutationObserver(onSlide).observe(document.getElementById("deck"), { subtree: true, attributes: true, attributeFilter: ["class"] });
  setTimeout(onSlide, 300);
  window.__rehber = { S, find };
})();

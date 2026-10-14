/* Ortak yardımcılar: renk dili, tuval kurulumu, döngüler, DOM, kontroller */
(function () {
  // Sitenin renk dili: css/style.css'teki değişkenlerle aynı
  const C = {
    bg: "#0e1a1f", stage: "#13242a", panel: "#1a2f36", line: "#26404a",
    ink: "#efe9dc", ink2: "#a7b3b0", muted: "#6f8384",
    I: "#4dbbff",      // gerçek bileşen: gök mavisi
    Q: "#ffb23f",      // sanal bileşen: kehribar
    amp: "#efe9dc",    // genlik: fildişi
    phase: "#8ce0b0",  // faz: nane
    noise: "#7f8c96",  // gürültü: kırçıl gri
    needle: "#ff4a3d", // ayar ibresi
  };
  const FONT = {
    display: '"Big Shoulders Display", "Arial Narrow", sans-serif',
    body: '"Atkinson Hyperlegible Next", "Atkinson Hyperlegible", system-ui, sans-serif',
    num: '"Atkinson Hyperlegible Next", system-ui, sans-serif',
  };

  function hexToRgb(h) { const n = parseInt(h.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; }
  function rgba(hex, a) { const [r, g, b] = hexToRgb(hex); return `rgba(${r},${g},${b},${a})`; }
  function mix(h1, h2, t) { const a = hexToRgb(h1), b = hexToRgb(h2); return `rgb(${a.map((v, i) => Math.round(v + (b[i] - v) * t)).join(",")})`; }

  /* "Radyum" renk haritası: spektrum ve şelalede güç seviyesini gösterir.
     I/Q renklerinin hiçbirini içermez; sitenin her yerinde aynısı kullanılır. */
  const CMAP_STOPS = [
    [0.0, "#0e1a1f"], [0.18, "#1c1838"], [0.36, "#3d1a5e"], [0.54, "#7a1f7a"],
    [0.72, "#d9418a"], [0.87, "#ff9e9e"], [1.0, "#fff3ea"],
  ];
  const LUT = new Uint8Array(256 * 3);
  (function () {
    for (let i = 0; i < 256; i++) {
      const t = i / 255;
      let k = 0;
      while (k < CMAP_STOPS.length - 2 && t > CMAP_STOPS[k + 1][0]) k++;
      const [t0, c0] = CMAP_STOPS[k], [t1, c1] = CMAP_STOPS[k + 1];
      const u = Math.min(1, Math.max(0, (t - t0) / (t1 - t0)));
      const a = hexToRgb(c0), b = hexToRgb(c1);
      for (let j = 0; j < 3; j++) LUT[3 * i + j] = Math.round(a[j] + (b[j] - a[j]) * u);
    }
  })();
  function cmap(t) { const i = 3 * Math.round(Math.min(1, Math.max(0, t)) * 255); return `rgb(${LUT[i]},${LUT[i + 1]},${LUT[i + 2]})`; }

  /* Yüksek çözünürlüklü, kendini yeniden boyutlandıran tuval */
  function canvas(el, onResize) {
    const ctx = el.getContext("2d");
    const state = { ctx, w: 0, h: 0, dpr: 1 };
    function fit() {
      const r = el.getBoundingClientRect();
      if (!r.width || !r.height) return;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      if (r.width === state.w && r.height === state.h && dpr === state.dpr) return;
      state.w = r.width; state.h = r.height; state.dpr = dpr;
      el.width = Math.round(r.width * dpr);
      el.height = Math.round(r.height * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ready && onResize && onResize(state);
    }
    // ilk geri çağrı ertelenir: çağıran kod dönüş değerini değişkene atamış olsun
    let ready = false;
    fit();
    ready = true;
    new ResizeObserver(fit).observe(el);
    queueMicrotask(() => { if (state.w && onResize) onResize(state); });
    state.fit = fit;
    return state;
  }

  /* requestAnimationFrame döngüsü: slayt görünürken çalışır */
  function loop(fn) {
    let id = 0, last = 0, running = false;
    function tick(t) {
      if (!running) return;
      const dt = last ? Math.min(0.05, (t - last) / 1000) : 0.016;
      last = t;
      fn(dt, t / 1000);
      id = requestAnimationFrame(tick);
    }
    return {
      start() { if (!running) { running = true; last = 0; id = requestAnimationFrame(tick); } },
      stop() { running = false; cancelAnimationFrame(id); },
      get running() { return running; },
    };
  }

  /* Küçük DOM yardımcısı: h("div.cls#id", {attrs}, ...children) */
  function h(spec, attrs, ...kids) {
    const m = spec.match(/^([a-z0-9]+)?((?:[.#][\w-]+)*)$/i);
    const el = document.createElement(m[1] || "div");
    (m[2].match(/[.#][\w-]+/g) || []).forEach((p) => {
      if (p[0] === ".") el.classList.add(p.slice(1)); else el.id = p.slice(1);
    });
    if (attrs && (typeof attrs !== "object" || attrs instanceof Node || Array.isArray(attrs))) { kids.unshift(attrs); attrs = null; }
    if (attrs) for (const [k, v] of Object.entries(attrs)) {
      if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
      else if (k === "html") el.innerHTML = v;
      else if (k === "style" && typeof v === "object") for (const [sk, sv] of Object.entries(v)) { if (sk.startsWith("--")) el.style.setProperty(sk, sv); else el.style[sk] = sv; }
      else if (v !== false && v != null) el.setAttribute(k, v === true ? "" : v);
    }
    kids.flat().forEach((k) => k != null && el.append(k.nodeType ? k : document.createTextNode(k)));
    return el;
  }

  /* Kaydırıcı: etiket + input + değer. log=true ise değer üstel ölçekte değişir. */
  function slider({ label, min, max, step = 0.01, value, fmt = (v) => v.toFixed(2), oninput, width, cls, log }) {
    const toPos = (v) => (log ? Math.log(v) : v), fromPos = (p) => (log ? Math.exp(p) : p);
    const val = h("output.val", fmt(value));
    const input = h("input", { type: "range", min: toPos(min), max: toPos(max), step: log ? "any" : step, value: toPos(value), "aria-label": label });
    if (cls) input.classList.add(cls);
    if (width) input.style.width = width;
    input.addEventListener("input", () => { const v = fromPos(+input.value); val.textContent = fmt(v); oninput(v); });
    const wrap = h("label.sl", h("span.lab", label), input, val);
    wrap.set = (v) => { input.value = toPos(v); val.textContent = fmt(v); };
    wrap.get = () => fromPos(+input.value);
    wrap.input = input;
    return wrap;
  }

  /* Segmentli seçim düğmeleri */
  function seg(options, value, onchange, label) {
    const wrap = h("div.seg", { role: "group", "aria-label": label || null });
    const btns = options.map(([k, lab]) => {
      const b = h("button", { type: "button" }, lab);
      b.addEventListener("click", () => { set(k); onchange(k); });
      wrap.append(b); return [k, b];
    });
    function set(k) { btns.forEach(([kk, b]) => { b.classList.toggle("on", kk === k); b.setAttribute("aria-pressed", String(kk === k)); }); }
    set(value);
    wrap.set = set;
    return wrap;
  }

  /* Aç/kapa düğmesi */
  function toggle(label, value, onchange, cls) {
    const b = h("button.tog" + (cls ? "." + cls : ""), { type: "button", "aria-pressed": String(!!value) }, label);
    b.addEventListener("click", () => { value = !value; b.setAttribute("aria-pressed", String(value)); onchange(value); });
    b.set = (v) => { value = !!v; b.setAttribute("aria-pressed", String(value)); };
    return b;
  }

  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const lerp = (a, b, t) => a + (b - a) * t;
  const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

  /* Türkçe sayı biçimi: 1.234,5 */
  const nf = {};
  function num(v, d = 0) {
    const k = d;
    nf[k] = nf[k] || new Intl.NumberFormat("tr-TR", { minimumFractionDigits: d, maximumFractionDigits: d });
    return nf[k].format(v).replace("-", "−");
  }
  // Frekansı uygun birimle yaz: 1,5 kHz, 100,0 MHz
  function hz(v, d) {
    const a = Math.abs(v);
    if (a >= 1e9) return num(v / 1e9, d ?? 2) + " GHz";
    if (a >= 1e6) return num(v / 1e6, d ?? (a >= 1e8 ? 1 : 2)) + " MHz";
    if (a >= 1e3) return num(v / 1e3, d ?? (a >= 1e5 ? 0 : 1)) + " kHz";
    return num(v, d ?? 0) + " Hz";
  }
  // Bayt boyutu
  function bytes(v) {
    const u = ["B", "kB", "MB", "GB", "TB"];
    let i = 0; while (v >= 1000 && i < u.length - 1) { v /= 1000; i++; }
    return num(v, v < 10 && i ? 1 : 0) + " " + u[i];
  }
  // Uzunluk (metre)
  function meters(v) {
    if (v >= 1000) return num(v / 1000, v >= 1e4 ? 0 : 1) + " km";
    if (v >= 1) return num(v, v >= 10 ? 1 : 2) + " m";
    if (v >= 0.01) return num(v * 100, v >= 0.1 ? 0 : 1) + " cm";
    if (v >= 1e-3) return num(v * 1000, 1) + " mm";
    if (v >= 1e-6) return num(v * 1e6, 1) + " µm";
    if (v >= 1e-9) return num(v * 1e9, 0) + " nm";
    return num(v * 1e12, 0) + " pm";
  }

  /* Harici script'i bir kere yükle (file:// ile de çalışır) */
  const loaded = {};
  function loadScript(src) {
    if (!loaded[src]) loaded[src] = new Promise((res, rej) => {
      const s = document.createElement("script");
      s.src = src; s.onload = res; s.onerror = () => rej(new Error(src + " yüklenemedi"));
      document.head.append(s);
    });
    return loaded[src];
  }

  /* İşaretçi konumu (tuvale göre) ve sürükleme */
  function pointer(el, { down, move, up, hover } = {}) {
    let drag = false;
    const pos = (e) => { const r = el.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
    el.style.touchAction = "none";
    el.addEventListener("pointerdown", (e) => { drag = true; try { el.setPointerCapture(e.pointerId); } catch (er) {} down && down(...pos(e), e); });
    el.addEventListener("pointermove", (e) => { if (drag) move && move(...pos(e), e); else hover && hover(...pos(e), e); });
    const end = (e) => { if (!drag) return; drag = false; up && up(...pos(e), e); };
    el.addEventListener("pointerup", end);
    el.addEventListener("pointercancel", end);
    el.addEventListener("pointerleave", (e) => { if (!drag && hover) hover(-1, -1, e); });
    return { get dragging() { return drag; } };
  }

  window.L = {
    C, FONT, rgba, mix, hexToRgb, LUT, cmap, CMAP_STOPS, canvas, loop, h, slider, seg, toggle,
    clamp, lerp, ease, num, hz, bytes, meters, loadScript, pointer,
    rng: DSP.rng, gauss: DSP.gaussian,
  };
  window.Demos = window.Demos || {};
})();

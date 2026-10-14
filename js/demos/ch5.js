/* Bölüm 5: Alıcının içi.
   blok-diyagram (rxChain), karistirma (mixTune), filtre (filterDecim), bant-geciren (bandWindow),
   kusurlar (rxFlaws), donanim (hwCompare).
   Ortak yardımcılar: IQ halka tamponu, besleme (görsel ya da ses saati sürer), ayar düğmesi,
   azaltmalı FIR, basit demodülatörler, spektrum paneli. */
(function () {
  const { C, FONT, rgba, h, canvas, loop, clamp, slider, seg, num } = L;
  // L.toggle başlangıç değeri true iken aria-pressed="" yazıyor; burada düzeltilir
  const toggle = (label, value, fn, cls) => { const b = L.toggle(label, value, fn, cls); b.set(!!value); return b; };
  const BRASS = "#efe9dc";          // filtre yanıtı ve pencere: fildişi (yanıt bir kazanç, yani genlik eğrisidir)
  const FS = 240000, NFFT = 1024;
  const TAU = Math.PI * 2;

  // ---------- küçük biçim yardımcıları ----------
  const khz = (v, d = 1) => { if (Math.abs(v) < 0.5 * 10 ** (3 - d)) v = 0; return (v > 0 ? "+" : "") + num(v / 1000, d) + " kHz"; };
  const khzU = (v, d = 1) => num(v / 1000, d) + " kHz";
  const mega = (v) => (v >= 1e9 ? num(v / 1e9, 1) + " milyar" : v >= 1e6 ? num(v / 1e6, v >= 1e8 ? 0 : 1) + " milyon" : num(v / 1e3, 0) + " bin");
  const dbs = (v, d = 0) => num(v, d) + " dB";

  // ---------- IQ halka tamponu ----------
  class Ring {
    constructor(n = 16384) { this.n = n; this.b = new Float32Array(2 * n); this.w = 0; }
    push(x) {
      const m = x.length >> 1, n = this.n, b = this.b;
      let w = this.w;
      for (let i = 0; i < m; i++) { b[2 * w] = x[2 * i]; b[2 * w + 1] = x[2 * i + 1]; if (++w === n) w = 0; }
      this.w = w;
    }
    latest(m, out = new Float32Array(2 * m)) {
      const n = this.n, b = this.b;
      let r = (this.w - m + n * 4) % n;
      for (let i = 0; i < m; i++) { out[2 * i] = b[2 * r]; out[2 * i + 1] = b[2 * r + 1]; if (++r === n) r = 0; }
      return out;
    }
  }

  /* Besleme: bant örneklerini ya ses akışı (dinlerken) ya da görsel döngü üretir.
     Ses kilitliyse ya da dinlenmiyorsa görsel döngü üretmeye devam eder; zaman hiç durmaz. */
  function makeFeed(band, onBlock) {
    let last = -1e9;
    return {
      pull(n) { const iq = band.next(n); onBlock(iq, true); last = performance.now(); return iq; },
      tick(dt) {
        if (performance.now() - last < 220) return;
        const n = clamp(Math.round(band.rate * dt), 256, 8000);
        onBlock(band.next(n), false);
      },
    };
  }

  // ---------- azaltmalı FIR (gerçek katsayı, karmaşık giriş) ----------
  class DecFIR {
    constructor(hh, M) { this.set(hh, M); }
    set(hh, M) {
      if (!this.h || this.h.length !== hh.length) this.hist = new Float32Array(2 * (hh.length - 1));
      this.h = hh; this.M = M; this.ph = this.ph % M || 0;
    }
    process(x) {
      const hh = this.h, T = hh.length, M = this.M, n = x.length >> 1, H = this.hist;
      const buf = new Float32Array(H.length + x.length);
      buf.set(H); buf.set(x, H.length);
      const outN = Math.max(0, Math.ceil((n - this.ph) / M)), out = new Float32Array(2 * outN);
      let k = 0;
      for (let i = this.ph; i < n; i += M) {
        let a = 0, b = 0;
        const base = 2 * (T - 1 + i);
        for (let t = 0; t < T; t++) { const j = base - 2 * t; a += hh[t] * buf[j]; b += hh[t] * buf[j + 1]; }
        out[2 * k] = a; out[2 * k + 1] = b; k++;
      }
      this.ph = this.ph + outN * M - n;
      this.hist = buf.slice(buf.length - H.length);
      return out;
    }
  }

  // AM zarf dedektörü + yavaş DC giderme + otomatik kazanç (Signals.Receiver ile aynı mantık)
  class AMDet {
    constructor() { this.dc = 0; this.agc = 0.05; }
    process(iq, rate) {
      const n = iq.length >> 1, out = new Float32Array(n), a = 1 - Math.exp(-1 / (rate * 0.15));
      const up = 1 - Math.exp(-1 / (rate * 0.004)), dn = 1 - Math.exp(-1 / (rate * 0.6));
      for (let i = 0; i < n; i++) {
        const e = Math.hypot(iq[2 * i], iq[2 * i + 1]);
        this.dc += (e - this.dc) * a;
        let v = e - this.dc;
        const av = Math.abs(v);
        this.agc += (av > this.agc ? up : dn) * (av - this.agc);
        out[i] = clamp(v * 0.3 / Math.max(this.agc, 1e-5), -1, 1);
      }
      return out;
    }
  }
  // Ses hızına doğrusal aradeğerleme (önce iki kutuplu basit alçak geçiren)
  class Resamp {
    constructor(out = 48000) { this.out = out; this.p = 0; this.prev = 0; this.l1 = 0; this.l2 = 0; }
    process(x, rin) {
      const step = rin / this.out, res = [];
      const k = rin > this.out ? 1 - Math.exp(-TAU * 9000 / rin) : 1;
      let p = this.p, prev = this.prev;
      for (let i = 0; i < x.length; i++) {
        this.l1 += k * (x[i] - this.l1); this.l2 += k * (this.l1 - this.l2);
        const cur = this.l2;
        while (p < 1) { res.push(prev + (cur - prev) * p); p += step; }
        p -= 1; prev = cur;
      }
      this.p = p; this.prev = prev;
      return Float32Array.from(res);
    }
  }

  // ---------- Mors için: alıcının IQ çıkışından 700 Hz'lik ton ----------
  function cwAudio(st, iq) {
    const n = iq.length >> 1, out = new Float32Array(n);
    st.cwAgc = st.cwAgc || 1e-3;
    for (let i = 0; i < n; i++) {
      const v = iq[2 * i], av = Math.abs(v);
      st.cwAgc += (av > st.cwAgc ? 0.01 : 0.00004) * (av - st.cwAgc);
      out[i] = clamp(v * 0.35 / Math.max(st.cwAgc, 2e-4), -1, 1);
    }
    return out;
  }

  // ---------- spektrum çizim yardımcıları ----------
  function panelBg(ctx, x, y, w, hh) {
    ctx.fillStyle = rgba(C.bg, 0.6); ctx.fillRect(x, y, w, hh);
  }
  function fAxis(ctx, x, y, w, f0, f1, { count = 8, unit = "kHz", div = 1000, size = 12, up = false, dec = 0, sign = true } = {}) {
    const t = V.ticks(f0 / div, f1 / div, count);
    V.scale(ctx, { x, y, w, from: f0 / div, to: f1 / div, major: t.major, minor: t.minor, fmt: (v) => (Math.abs(v) < 1e-9 ? "0" : (sign && v > 0 ? "+" : "") + num(v, dec)), size, up, color: C.ink2 });
    V.text(ctx, unit, x + w - 4, up ? y - 26 : y + 36, { align: "right", size: 10.5, color: C.muted });
  }
  function title(ctx, s, x, y, color = C.ink2, size = 12.5) { V.text(ctx, s, x, y, { color, size, weight: 700 }); }
  // dB eğrisi (filtre yanıtı): arr indeksleri f0..f1'i doğrusal kaplar
  function respCurve(ctx, x, y, w, hh, arr, min, max, color = BRASS, fillA = 0.1) {
    const n = arr.length, Y = (v) => y + hh * (1 - clamp((v - min) / (max - min), 0, 1));
    ctx.save();
    ctx.beginPath(); ctx.rect(x, y, w, hh); ctx.clip();
    ctx.beginPath();
    for (let i = 0; i < n; i++) { const px = x + (i / (n - 1)) * w; i ? ctx.lineTo(px, Y(arr[i])) : ctx.moveTo(px, Y(arr[i])); }
    if (fillA) {
      ctx.save(); ctx.lineTo(x + w, y + hh); ctx.lineTo(x, y + hh); ctx.closePath();
      ctx.fillStyle = rgba(color, fillA); ctx.fill(); ctx.restore();
    }
    ctx.strokeStyle = color; ctx.lineWidth = 2; ctx.lineJoin = "round"; ctx.setLineDash([]);
    ctx.stroke();
    ctx.restore();
  }
  // Karmaşık katsayılı filtrenin yanıtı (dB), −0,5 … +0,5 aralığında n noktada.
  // DSP.freqResponseC ile aynı tanım; sürüklerken akıcı kalsın diye sıfır dolgulu FFT ile hesaplanır.
  function respFFT(hre, him, n = 2048) {
    const re = new Float64Array(n), im = new Float64Array(n);
    for (let i = 0; i < hre.length; i++) { re[i] = hre[i]; im[i] = him ? him[i] : 0; }
    DSP.fft(re, im);
    const out = new Float32Array(n);
    for (let i = 0; i < n; i++) { const j = (i + n / 2) % n; out[i] = 10 * Math.log10(re[j] * re[j] + im[j] * im[j] + 1e-24); }
    return out; // indeks i ↔ f = (i − n/2)/n
  }

  /* ---------- Büyük ayar düğmesi (döner kadran) ----------
     Sürükleyerek çevrilir (açıya göre), fare tekerleği ve ok tuşlarıyla da çalışır. */
  function makeKnob({ label, min, max, value, perTurn, step = 100, onchange, onrelease, fmt }) {
    const cv = h("canvas.c5-knob", { "aria-label": label, role: "slider", tabindex: 0, "aria-valuemin": min, "aria-valuemax": max });
    const valEl = h("div.c5-knobval", fmt(value));
    const wrap = h("div.c5-knobwrap", h("div.c5-knobsq", cv), h("div.c5-knoblab", label), valEl);
    let v = value, a0 = null, glow = 0;
    const st = canvas(cv, () => draw());
    const geo = () => { const { w, h: H } = st; return { cx: w / 2, cy: H / 2, r: Math.min(w, H) / 2 / 1.22 }; };
    function draw() {
      const { ctx, w, h: H } = st;
      if (!w) return;
      ctx.clearRect(0, 0, w, H);
      const { cx, cy, r } = geo();
      const th = (v / perTurn) * TAU;
      // sabit dış skala halkası
      ctx.save();
      for (let k = 0; k < 72; k++) {
        const a = (k / 72) * TAU - Math.PI / 2, big = k % 6 === 0;
        const r1 = r * 1.06, r2 = r * (big ? 1.17 : 1.11);
        ctx.strokeStyle = rgba(C.ink, big ? 0.6 : 0.25); ctx.lineWidth = big ? 1.6 : 1;
        ctx.beginPath(); ctx.moveTo(cx + Math.cos(a) * r1, cy + Math.sin(a) * r1); ctx.lineTo(cx + Math.cos(a) * r2, cy + Math.sin(a) * r2); ctx.stroke();
      }
      ctx.restore();
      // gövde: gölge + bakalit degrade
      ctx.save();
      ctx.shadowColor = "rgba(0,0,0,0.55)"; ctx.shadowBlur = 22; ctx.shadowOffsetY = 8;
      const g = ctx.createRadialGradient(cx - r * 0.35, cy - r * 0.45, r * 0.1, cx, cy, r);
      g.addColorStop(0, "#3a525a"); g.addColorStop(0.55, "#1d3036"); g.addColorStop(1, "#0b161a");
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(cx, cy, r, 0, TAU); ctx.fill();
      ctx.restore();
      // tırtıllı kenar (dönerken akar)
      ctx.save();
      for (let k = 0; k < 48; k++) {
        const a = th + (k / 48) * TAU;
        ctx.strokeStyle = k % 2 ? "rgba(0,0,0,0.45)" : "rgba(255,255,255,0.07)"; ctx.lineWidth = 3;
        ctx.beginPath(); ctx.moveTo(cx + Math.cos(a) * r * 0.86, cy + Math.sin(a) * r * 0.86); ctx.lineTo(cx + Math.cos(a) * r * 0.985, cy + Math.sin(a) * r * 0.985); ctx.stroke();
      }
      // iç kapak
      const g2 = ctx.createRadialGradient(cx + r * 0.2, cy + r * 0.25, r * 0.05, cx, cy, r * 0.8);
      g2.addColorStop(0, "#2c434b"); g2.addColorStop(1, "#16272d");
      ctx.fillStyle = g2; ctx.beginPath(); ctx.arc(cx, cy, r * 0.8, 0, TAU); ctx.fill();
      ctx.strokeStyle = "rgba(255,255,255,0.08)"; ctx.lineWidth = 1; ctx.stroke();
      // kırmızı işaret çizgisi
      const a = th - Math.PI / 2;
      ctx.shadowColor = C.needle; ctx.shadowBlur = 8 + glow * 10;
      ctx.strokeStyle = C.needle; ctx.lineWidth = 4; ctx.lineCap = "round";
      ctx.beginPath(); ctx.moveTo(cx + Math.cos(a) * r * 0.32, cy + Math.sin(a) * r * 0.32); ctx.lineTo(cx + Math.cos(a) * r * 0.76, cy + Math.sin(a) * r * 0.76); ctx.stroke();
      ctx.shadowBlur = 0;
      // parmak çukuru
      const px = cx + Math.cos(a) * r * 0.55, py = cy + Math.sin(a) * r * 0.55;
      ctx.restore();
      ctx.save();
      ctx.fillStyle = "rgba(0,0,0,0.25)"; ctx.beginPath(); ctx.arc(cx + Math.cos(a + 2.4) * r * 0.5, cy + Math.sin(a + 2.4) * r * 0.5, r * 0.11, 0, TAU); ctx.fill();
      ctx.restore();
      void px; void py;
      // değer
      if (glow > 0) glow = Math.max(0, glow - 0.05);
    }
    function set(nv, user) {
      nv = clamp(Math.round(nv / step) * step, min, max);
      if (nv === v) return;
      v = nv; cv.setAttribute("aria-valuenow", v); cv.setAttribute("aria-valuetext", fmt(v)); valEl.textContent = fmt(v);
      draw();
      user && onchange && onchange(v);
    }
    let acc = 0;
    L.pointer(cv, {
      down(x, y) { const { cx, cy } = geo(); a0 = Math.atan2(y - cy, x - cx); acc = v; glow = 1; },
      move(x, y) {
        if (a0 == null) return;
        const { cx, cy } = geo();
        const a = Math.atan2(y - cy, x - cx);
        let d = a - a0; if (d > Math.PI) d -= TAU; if (d < -Math.PI) d += TAU;
        a0 = a; acc = clamp(acc + (d / TAU) * perTurn, min, max);
        set(acc, true);
      },
      up() { a0 = null; onrelease && onrelease(v); },
    });
    cv.addEventListener("wheel", (e) => { e.preventDefault(); set(v + Math.sign(e.deltaY || e.deltaX) * -step * 5, true); }, { passive: false });
    cv.addEventListener("keydown", (e) => {
      const k = e.key, big = e.shiftKey ? 10 : 1;
      if (k === "ArrowRight" || k === "ArrowUp") { set(v + step * 5 * big, true); e.preventDefault(); }
      else if (k === "ArrowLeft" || k === "ArrowDown") { set(v - step * 5 * big, true); e.preventDefault(); }
      else return;
    });
    cv.setAttribute("aria-valuenow", v);
    return { el: wrap, canvas: cv, set: (nv) => set(nv, false), get: () => v, draw, get dragging() { return a0 != null; } };
  }

  /* ======================================================================
     1. Alıcının içi: blok diyagram
     ====================================================================== */
  // Model RF ortamı: FM yayın bandı ve havacılık bandının başı. Güçler antendeki toplam güç (dBm).
  const RF = (() => {
    const r = DSP.rng(77), out = [];
    let f = 87.8;
    while (f < 107.9) {
      out.push({ f: Math.round(f * 10) / 10, p: -52 - r() * 40, w: 0.18, fm: true });
      f += 0.4 + r() * 1.6;
    }
    out.push({ f: 118.1, p: -78, w: 0.008 }, { f: 119.35, p: -84, w: 0.008 }, { f: 121.5, p: -95, w: 0.008 }, { f: 82.4, p: -88, w: 0.012 });
    return out;
  })();
  const ANT_N = -128;      // antendeki gürültü yoğunluğu, dBm / 10 kHz (çevre gürültüsü dahil, model)
  const LNA_G = 20, LNA_NF = 3, FC = 1.0, ADC_FS = 2.4, BITS = 8, DBFS_OFF = 12;
  // ideal ADC: SNR = 6,02·N + 1,76 dB (tam ölçekli sinüs), tüm Nyquist bandına yayılır → 10 kHz başına
  const QN = -(6.02 * BITS + 1.76) - 10 * Math.log10((ADC_FS * 1e6) / 1e4);
  const lin = (d) => 10 ** (d / 10), dB = (p) => 10 * Math.log10(p + 1e-30);
  const H_LP = (fo) => -10 * Math.log10(1 + (fo / FC) ** 10); // 5. dereceden Butterworth benzeri (model)

  const BLOCKS = [
    { id: "ant", name: "Anten", sub: "dalga → gerilim", icon: "ant" },
    { id: "lna", name: "LNA", sub: "yükselteç", icon: "amp" },
    { id: "mix", name: "Karıştırıcı", sub: "× LO", icon: "mix" },
    { id: "flt", name: "Filtre", sub: "alçak geçiren", icon: "lp" },
    { id: "adc", name: "ADC", sub: "8 bit · 2,4 MS/sn", icon: "adc" },
    { id: "pc", name: "Bilgisayar", sub: "IQ sayıları", icon: "pc" },
  ];
  const LOB = { id: "lo", name: "LO", sub: "yerel osilatör", icon: "lo" };
  const INFO = {
    ant: ["Anten: dalgayı gerilime çevirir", "Anten havadaki bütün dalgaları birden toplar: FM yayınları, havacılık telsizleri, gürültü. Güçler çok küçüktür: buradaki en güçlü istasyon bile bir vatın yaklaşık yüz milyonda biri kadardır (−50 dBm). Kırmızı ibre, alıcının ayarlandığı yerdir."],
    lna: ["LNA: düşük gürültülü yükselteç", "Zayıf sinyali, üzerine çok az gürültü ekleyerek yükseltir. Zincirin ilk yükselteci olduğu için toplam gürültüyü o belirler. Bu modelde kazanç +20 dB, gürültü katsayısı 3 dB: tepeler ve gürültü tabanı birlikte yükselir."],
    lo: ["LO: yerel osilatör", "Alıcının içinde, ayarladığınız frekansta salınan saf bir dalga. Doğrudan dönüşümde iki kopyası vardır: biri 0°, diğeri çeyrek tur (90°) kaymış. Ayar düğmesi aslında bu osilatörün frekansını değiştirir."],
    mix: ["Karıştırıcı: spektrumu kaydırır", "Gelen sinyal LO ile çarpılır. Sonuç: bütün spektrum LO kadar aşağı kayar; ayarladığınız istasyon 0 Hz'e oturur. 0° kolundan I (mavi), 90° kolundan Q (kehribar) çıkar. Ölçek artık mutlak frekans değil, merkeze göre uzaklık."],
    flt: ["Filtre: yalnızca merkezi bırakır", "Alçak geçiren filtre 0 Hz çevresini geçirir, uzaktakileri bastırır (kesik çizgi: filtrenin yanıtı). Bu, ADC'nin örnekleme hızının yarısından uzaktaki sinyallerin örtüşüp içeri katlanmasını önler."],
    adc: ["ADC: gerilimi sayıya çevirir", "I ve Q ayrı ayrı saniyede 2,4 milyon kez ölçülür. 8 bitlik ölçüm yaklaşık 50 dB'lik dinamik aralık verir: zayıf istasyonlar nicemleme gürültüsünün altında kalabilir. Merkezdeki sivri, doğrudan dönüşümün imzası: DC sivrisi."],
    pc: ["Bilgisayar: artık her şey yazılım", "USB'den saniyede 2,4 milyon I,Q sayı çifti akar. Spektrum, şelale, ince ayar, süzme ve demodülasyonun hepsi bu sayılar üzerinde yazılımla yapılır. Sonraki slaytlar bu adımları tek tek oynatıyor."],
  };

  Demos.rxChain = function (stage, slide) {
    const cv = h("canvas", { "aria-label": "Alıcının blok diyagramı ve seçilen noktadaki spektrum" });
    const layer = h("div.c5-blocks");
    const fill = h("div.fill.c5-chain", cv, layer);
    const infoT = h("b"), infoP = h("span");
    const info = h("div.c5-info", { "aria-live": "polite" }, infoT, infoP);
    const ctrl = h("div.controls");
    stage.append(fill, info, ctrl);

    let sel = "ant", LO = 100.0, t = 0;
    const btns = {};
    [...BLOCKS, LOB].forEach((b) => {
      const el = h("button.c5-blk", { type: "button", "aria-label": `${b.name}: bu noktadaki spektrumu göster` }, h("span", b.name), h("small", " " + b.sub));
      el.addEventListener("click", () => select(b.id));
      layer.append(el); btns[b.id] = el;
    });
    const loSl = slider({ label: "LO frekansı", min: 88, max: 108, step: 0.05, value: LO, fmt: (v) => num(v, 2) + " MHz", cls: "cr", oninput: (v) => { LO = v; } });
    const ro = h("div.readouts");
    ctrl.append(loSl, h("span.spacer"), ro);
    function select(id) {
      sel = id;
      Object.entries(btns).forEach(([k, b]) => b.setAttribute("aria-pressed", k === id));
      infoT.textContent = INFO[id][0] + ". ";
      infoP.textContent = INFO[id][1];
      draw();
    }

    // geometri
    let G = null;
    function layout() {
      const { w, h: H } = st;
      const narrow = w < 620;
      const dh = narrow ? Math.min(250, H * 0.48) : Math.min(205, H * 0.42);
      const rects = {};
      let wires = [];
      if (!narrow) {
        const m = 16, n = 6;
        const bw = Math.min(132, (w - 2 * m) / (n + (n - 1) * 0.42)), gap = (w - 2 * m - n * bw) / (n - 1), bh = 62;
        const y = dh * 0.36 - bh / 2;
        BLOCKS.forEach((b, i) => (rects[b.id] = { x: m + i * (bw + gap), y, w: bw, h: bh }));
        const mx = rects.mix;
        rects.lo = { x: mx.x + mx.w * 0.14, y: y + bh + 34, w: mx.w * 0.72, h: 40 };
        for (let i = 0; i < 5; i++) {
          const a = rects[BLOCKS[i].id], b = rects[BLOCKS[i + 1].id];
          wires.push({ pts: [[a.x + a.w, a.y + a.h / 2], [b.x, b.y + b.h / 2]], kind: i < 2 ? "rf" : "iq" });
        }
        wires.push({ pts: [[rects.lo.x + rects.lo.w / 2, rects.lo.y], [mx.x + mx.w / 2, mx.y + mx.h]], kind: "lo" });
      } else {
        const m = 12, bw = (w - 2 * m) / (3 + 2 * 0.32), gap = bw * 0.32, bh = 56;
        const y1 = dh * 0.4 - bh / 2, y2 = dh * 0.82 - bh / 2;
        const xs = [0, 1, 2].map((i) => m + i * (bw + gap));
        ["ant", "lna", "mix"].forEach((id, i) => (rects[id] = { x: xs[i], y: y1, w: bw, h: bh }));
        ["flt", "adc", "pc"].forEach((id, i) => (rects[id] = { x: xs[2 - i], y: y2, w: bw, h: bh }));
        rects.lo = { x: xs[1] + bw * 0.62, y: 6, w: bw * 0.62, h: 32 };
        const R = rects;
        wires = [
          { pts: [[R.ant.x + bw, y1 + bh / 2], [R.lna.x, y1 + bh / 2]], kind: "rf" },
          { pts: [[R.lna.x + bw, y1 + bh / 2], [R.mix.x, y1 + bh / 2]], kind: "rf" },
          { pts: [[R.mix.x + bw / 2, y1 + bh], [R.flt.x + bw / 2, y2]], kind: "iq" },
          { pts: [[R.flt.x, y2 + bh / 2], [R.adc.x + bw, y2 + bh / 2]], kind: "iq" },
          { pts: [[R.adc.x, y2 + bh / 2], [R.pc.x + bw, y2 + bh / 2]], kind: "iq" },
          { pts: [[R.lo.x + R.lo.w / 2, R.lo.y + R.lo.h], [R.mix.x + bw / 2, y1]], kind: "lo" },
        ];
      }
      G = { rects, wires, dh, narrow };
      for (const [id, r] of Object.entries(rects)) Object.assign(btns[id].style, { left: r.x + "px", top: r.y + "px", width: r.w + "px", height: r.h + "px" });
    }

    // simge çizimleri
    function icon(ctx, kind, x, y, s, col) {
      ctx.save(); ctx.strokeStyle = col; ctx.fillStyle = col; ctx.lineWidth = 1.6; ctx.lineCap = "round"; ctx.lineJoin = "round";
      ctx.beginPath();
      switch (kind) {
        case "ant": ctx.moveTo(x, y + s * 0.5); ctx.lineTo(x, y - s * 0.4); ctx.moveTo(x - s * 0.45, y - s * 0.5); ctx.lineTo(x, y - s * 0.05); ctx.lineTo(x + s * 0.45, y - s * 0.5); break;
        case "amp": ctx.moveTo(x - s * 0.4, y - s * 0.45); ctx.lineTo(x + s * 0.45, y); ctx.lineTo(x - s * 0.4, y + s * 0.45); ctx.closePath(); break;
        case "mix": ctx.arc(x, y, s * 0.45, 0, TAU); ctx.moveTo(x - s * 0.3, y - s * 0.3); ctx.lineTo(x + s * 0.3, y + s * 0.3); ctx.moveTo(x + s * 0.3, y - s * 0.3); ctx.lineTo(x - s * 0.3, y + s * 0.3); break;
        case "lp": ctx.moveTo(x - s * 0.5, y - s * 0.2); ctx.lineTo(x + s * 0.05, y - s * 0.2); ctx.quadraticCurveTo(x + s * 0.25, y - s * 0.2, x + s * 0.5, y + s * 0.4); break;
        case "adc": ctx.moveTo(x - s * 0.5, y + s * 0.4); for (let k = 0; k < 4; k++) { ctx.lineTo(x - s * 0.5 + k * s * 0.25, y + s * 0.4 - (k + 1) * s * 0.2); ctx.lineTo(x - s * 0.25 + k * s * 0.25, y + s * 0.4 - (k + 1) * s * 0.2); } break;
        case "pc": ctx.rect(x - s * 0.5, y - s * 0.38, s, s * 0.62); ctx.moveTo(x - s * 0.25, y + s * 0.45); ctx.lineTo(x + s * 0.25, y + s * 0.45); break;
        case "lo": for (let k = 0; k <= 20; k++) { const px = x - s * 0.55 + (k / 20) * s * 1.1, py = y - Math.sin((k / 20) * TAU * 1.5) * s * 0.3; k ? ctx.lineTo(px, py) : ctx.moveTo(px, py); } break;
      }
      ctx.stroke(); ctx.restore();
    }
    const KC = { rf: C.ink, lo: C.phase };
    function drawWire(ctx, wr) {
      const [[x0, y0], [x1, y1]] = wr.pts;
      const lanes = wr.kind === "iq" ? [[-4, C.I], [4, C.Q]] : [[0, KC[wr.kind]]];
      const len = Math.hypot(x1 - x0, y1 - y0) || 1, nx = -(y1 - y0) / len, ny = (x1 - x0) / len;
      for (const [o, col] of lanes) {
        const ax = x0 + nx * o, ay = y0 + ny * o, bx = x1 + nx * o, by = y1 + ny * o;
        ctx.strokeStyle = rgba(col, 0.25); ctx.lineWidth = 2; ctx.setLineDash([]);
        ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(bx, by); ctx.stroke();
        // akan sinyal: hareketli noktalar
        ctx.strokeStyle = col; ctx.lineWidth = 3; ctx.lineCap = "round"; ctx.setLineDash([0.5, 11]);
        ctx.lineDashOffset = -t * 34;
        ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(bx, by); ctx.stroke();
        ctx.setLineDash([]);
        // ok başı
        const ang = Math.atan2(by - ay, bx - ax);
        ctx.fillStyle = rgba(col, 0.8); ctx.beginPath();
        ctx.moveTo(bx, by); ctx.lineTo(bx - Math.cos(ang - 0.5) * 7, by - Math.sin(ang - 0.5) * 7); ctx.lineTo(bx - Math.cos(ang + 0.5) * 7, by - Math.sin(ang + 0.5) * 7); ctx.closePath(); ctx.fill();
      }
    }
    function drawBlock(ctx, b, r) {
      const on = sel === b.id;
      ctx.save();
      if (on) { ctx.shadowColor = rgba(C.ink, 0.35); ctx.shadowBlur = 16; }
      const g = ctx.createLinearGradient(0, r.y, 0, r.y + r.h);
      g.addColorStop(0, on ? "#2a444c" : "#1f363d"); g.addColorStop(1, on ? "#1b3036" : "#152a30");
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.roundRect(r.x, r.y, r.w, r.h, 7); ctx.fill();
      ctx.shadowBlur = 0;
      ctx.strokeStyle = on ? C.ink : "#345661"; ctx.lineWidth = on ? 1.8 : 1; ctx.stroke();
      ctx.restore();
      const small = r.h < 50;
      const col = b.id === "lo" ? C.phase : on ? C.ink : C.ink2;
      if (small) {
        icon(ctx, b.icon, r.x + 18, r.y + r.h / 2, 14, col);
        V.text(ctx, b.name, r.x + 32, r.y + r.h / 2 + 6, { size: 17, color: on ? C.ink : C.ink2, font: FONT.display, weight: 800 });
        return;
      }
      icon(ctx, b.icon, r.x + r.w / 2, r.y + 17, 15, col);
      V.text(ctx, b.name, r.x + r.w / 2, r.y + 43, { align: "center", size: r.w < 96 ? 16 : 19, color: on ? C.ink : C.ink2, font: FONT.display, weight: 800 });
      if (r.w > 92) V.text(ctx, b.sub, r.x + r.w / 2, r.y + 57, { align: "center", size: 10.5, color: C.muted });
    }

    // ---- spektrum modeli ----
    const NB = 480;
    const avg = {}; // görünüm → ortalama dizisi
    const rr = DSP.rng(3);
    function breathe(s, k) { return 1.2 * Math.sin(t * (0.7 + (k % 5) * 0.23) + k) + 0.8 * Math.sin(t * 2.1 + k * 1.7); }
    // antendeki güç yoğunluğu (mW / 10 kHz), mutlak frekans MHz
    function antP(f) {
      let p = lin(ANT_N);
      for (let k = 0; k < RF.length; k++) {
        const s = RF[k], d = Math.abs(f - s.f);
        if (d > 0.4) continue;
        const psd = s.p + breathe(s, k) - 10 * Math.log10((s.w * 1e6) / 1e4);
        const e = s.fm ? Math.exp(-((d / (s.w * 0.55)) ** 4)) : Math.exp(-((d / s.w) ** 2));
        p += lin(psd) * e;
      }
      return p;
    }
    const nLNA = lin(ANT_N) * (lin(LNA_NF) - 1);           // LNA'nın kendi eklediği gürültü (girişe yansıtılmış)
    const lnaP = (f) => (antP(f) + nLNA) * lin(LNA_G);
    const loLeak = (fo) => lin(-60) * Math.exp(-((fo / 0.004) ** 2)); // LO sızıntısı → DC sivrisi (model)
    const mixP = (fo) => lnaP(LO + fo) + loLeak(fo);
    const fltP = (fo) => mixP(fo) * lin(H_LP(fo));
    function adcDb(fo) { // dBFS / 10 kHz; ±fs/2 dışındakiler içeri katlanır
      let p = 0;
      for (let k = -3; k <= 3; k++) p += fltP(fo + k * ADC_FS);
      return dB(p * lin(DBFS_OFF) + lin(QN));
    }
    function view(id) {
      switch (id) {
        case "ant": return { f0: LO - 20, f1: LO + 20, fn: (f) => dB(antP(f)), min: -140, max: -50, unit: "dBm", abs: true, name: "Antenin çıkışı" };
        case "lna": return { f0: LO - 20, f1: LO + 20, fn: (f) => dB(lnaP(f)), min: -140, max: -50, unit: "dBm", abs: true, name: "LNA çıkışı (+20 dB)" };
        case "lo": return { f0: LO - 20, f1: LO + 20, fn: (f) => dB(lin(-140) + lin(0) * Math.exp(-(((f - LO) / 0.03) ** 2))), min: -140, max: 10, unit: "dBm", abs: true, name: "Yerel osilatör: tek bir frekans" };
        case "mix": return { f0: -20, f1: 20, fn: (f) => dB(mixP(f)), min: -140, max: -50, unit: "dBm", name: "Karıştırıcı çıkışı: LO kadar kaydı" };
        case "flt": return { f0: -20, f1: 20, fn: (f) => dB(fltP(f)), min: -140, max: -50, unit: "dBm", name: "Filtre çıkışı", resp: true };
        case "adc": return { f0: -ADC_FS / 2, f1: ADC_FS / 2, fn: adcDb, min: -90, max: 0, unit: "dBFS", name: "ADC çıkışı: ±1,2 MHz, 8 bit" };
        default: return { f0: -ADC_FS / 2, f1: ADC_FS / 2, fn: adcDb, min: -90, max: 0, unit: "dBFS", name: "Bilgisayardaki IQ akışı (FFT)", iq: true };
      }
    }
    function specRow(id) {
      const v = view(id);
      const a = avg[id] || (avg[id] = new Float32Array(NB).fill(NaN));
      for (let i = 0; i < NB; i++) {
        const f = v.f0 + ((i + 0.5) / NB) * (v.f1 - v.f0);
        // gürültü: üstel dağılımlı güç (birkaç ortalamanın tanecikliliği)
        const val = v.fn(f) + 10 * Math.log10(0.35 + 0.65 * -Math.log(1 - rr() * 0.999));
        a[i] = isNaN(a[i]) ? val : a[i] + (val - a[i]) * 0.35;
      }
      return { v, a };
    }

    // IQ görünümü için kısa örnek dizisi: bant içindeki en güçlü iki istasyon + gürültü, 8 bit nicemlenmiş
    function iqSamples(n) {
      const I = new Float32Array(n), Q = new Float32Array(n);
      const ins = RF.filter((s) => Math.abs(s.f - LO) < ADC_FS / 2).map((s) => ({ ...s, a: Math.sqrt(lin(s.p + LNA_G + DBFS_OFF)) }))
        .sort((x, y) => y.a - x.a).slice(0, 3);
      const nz = Math.sqrt(lin(ANT_N + LNA_G + DBFS_OFF + 23.8)) * 0.7;
      const r = DSP.rng(Math.floor(t * 20));
      for (let i = 0; i < n; i++) {
        let a = 0, b = 0;
        for (const s of ins) {
          const ph = TAU * ((s.f - LO) / ADC_FS) * (i + t * 2.4e6 * 1e-4) + 0.6 * Math.sin(i * 0.05 + t * 3 + s.f);
          a += s.a * Math.cos(ph); b += s.a * Math.sin(ph);
        }
        a += nz * DSP.gaussian(r); b += nz * DSP.gaussian(r);
        I[i] = Math.round(clamp(a, -1, 1) * 127) / 127; Q[i] = Math.round(clamp(b, -1, 1) * 127) / 127;
      }
      return { I, Q, peak: ins.length ? ins[0].a : 0 };
    }

    function draw() {
      const { ctx, w, h: H } = st;
      if (!w) return;
      if (!G || G.w !== w || G.h !== H) { layout(); G.w = w; G.h = H; }
      ctx.clearRect(0, 0, w, H);
      // diyagram
      G.wires.forEach((wr) => drawWire(ctx, wr));
      [...BLOCKS, LOB].forEach((b) => drawBlock(ctx, b, G.rects[b.id]));
      // LO etiketi
      const lr = G.rects.lo;
      if (!G.narrow) V.text(ctx, "0° / 90°", lr.x + lr.w + 6, lr.y + lr.h / 2 + 4, { size: 11, color: C.phase, weight: 700 });
      V.text(ctx, num(LO, 2) + " MHz", lr.x - 6, lr.y + lr.h / 2 + 4, { size: 11, color: C.needle, weight: 700, align: "right" });
      // sıfır IF etiketleri
      if (!G.narrow) {
        const a = G.rects.mix, b = G.rects.flt;
        V.text(ctx, "I", (a.x + a.w + b.x) / 2 - 4, a.y + a.h / 2 - 9, { size: 13, color: C.I, font: FONT.display, weight: 800 });
        V.text(ctx, "Q", (a.x + a.w + b.x) / 2 - 4, a.y + a.h / 2 + 22, { size: 13, color: C.Q, font: FONT.display, weight: 800 });
        V.text(ctx, "analog (sürekli)", G.rects.ant.x, G.rects.ant.y - 12, { size: 11, color: C.muted });
        const ad = G.rects.adc;
        V.text(ctx, "sayısal (örnekler)", ad.x + ad.w / 2, ad.y - 12, { size: 11, color: C.muted });
        ctx.strokeStyle = rgba(C.ink, 0.18); ctx.setLineDash([3, 4]); ctx.beginPath();
        ctx.moveTo(ad.x + ad.w / 2 + 0.5, ad.y - 6); ctx.lineTo(ad.x + ad.w / 2 + 0.5, ad.y + ad.h + 6); ctx.stroke(); ctx.setLineDash([]);
      }

      // seçilen noktanın spektrumu
      const r = G.rects[sel];
      const px = 0, py = G.dh + 6, pw = w, ph = H - py - 4;
      // bağlantı çizgisi: blok → panel
      ctx.strokeStyle = rgba(C.ink, 0.35); ctx.setLineDash([2, 4]); ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(r.x + r.w / 2, r.y + r.h + 2); ctx.lineTo(r.x + r.w / 2, py); ctx.stroke(); ctx.setLineDash([]);
      const { v, a } = specRow(sel);
      const splitIQ = v.iq && w > 520;
      const sw = splitIQ ? pw * 0.58 : pw;
      const top = py + 26, sh = ph - 26 - 40;
      panelBg(ctx, px, py, pw, ph);
      ctx.strokeStyle = rgba(C.ink, 0.12); ctx.beginPath(); ctx.moveTo(0, py + 0.5); ctx.lineTo(w, py + 0.5); ctx.stroke();
      title(ctx, v.name, px + 10, py + 18, C.ink, 13);
      V.text(ctx, v.unit, px + sw - 10, py + 18, { align: "right", size: 11, color: C.muted });
      V.dbGrid(ctx, { x: px, y: top, w: sw, h: sh, min: v.min, max: v.max, step: v.unit === "dBFS" ? 20 : 20, unit: "" });
      V.spectrum(ctx, { x: px, y: top, w: sw, h: sh, db: a, min: v.min, max: v.max });
      // eksen
      if (v.abs) fAxis(ctx, px, top + sh, sw, v.f0 * 1e6, v.f1 * 1e6, { unit: "MHz", div: 1e6, count: 8, sign: false });
      else fAxis(ctx, px, top + sh, sw, v.f0 * 1e6, v.f1 * 1e6, { unit: "MHz (merkeze göre)", div: 1e6, count: 8, dec: v.f1 < 5 ? 1 : 0 });
      const X = (f) => px + ((f - v.f0) / (v.f1 - v.f0)) * sw;
      // filtre yanıtı
      if (v.resp) {
        const arr = new Float32Array(240);
        for (let i = 0; i < 240; i++) arr[i] = v.max + H_LP(v.f0 + (i / 239) * (v.f1 - v.f0));
        ctx.save(); ctx.setLineDash([6, 4]);
        respCurve(ctx, px, top, sw, sh, arr, v.min, v.max, BRASS, 0.06);
        ctx.restore();
        V.text(ctx, "filtre yanıtı", X(FC) + 8, top + 16, { size: 11, color: BRASS, weight: 700 });
        // ADC'nin göreceği bölge
        ctx.fillStyle = rgba(C.ink, 0.05); ctx.fillRect(X(-ADC_FS / 2), top, X(ADC_FS / 2) - X(-ADC_FS / 2), sh);
      }
      // ibre: ayar noktası
      const nx = v.abs ? X(LO) : X(0);
      V.needle(ctx, nx, top - 4, sh + 4, v.abs ? "LO" : "0 Hz");
      if (sel === "ant" || sel === "lna") {
        // ADC'ye ulaşacak dilim
        ctx.fillStyle = rgba(C.needle, 0.07); ctx.fillRect(X(LO - ADC_FS / 2), top, X(LO + ADC_FS / 2) - X(LO - ADC_FS / 2), sh);
      }
      if (v.unit === "dBFS") {
        const qy = top + sh * (1 - (QN - v.min) / (v.max - v.min));
        ctx.strokeStyle = rgba(C.noise, 0.8); ctx.setLineDash([4, 4]); ctx.beginPath(); ctx.moveTo(px, qy); ctx.lineTo(px + sw, qy); ctx.stroke(); ctx.setLineDash([]);
        V.text(ctx, "8 bit nicemleme gürültüsü", px + 40, qy - 5, { size: 11, color: C.noise, weight: 700 });
      }
      if (v.iq) {
        const n = 96, { I, Q } = iqSamples(n);
        const bx = splitIQ ? px + sw + 18 : px + pw * 0.5, bw = splitIQ ? pw - sw - 30 : pw * 0.47;
        const by = splitIQ ? top : top + 6, bh = splitIQ ? sh : sh * 0.42;
        if (!splitIQ) { ctx.fillStyle = rgba(C.bg, 0.85); ctx.fillRect(bx - 6, by - 4, bw + 10, bh + 8); }
        V.frame(ctx, bx - 6, by - 4, bw + 10, bh + 8);
        const amp = Math.max(...I.map(Math.abs), ...Q.map(Math.abs), 0.05) * 1.1;
        for (const [arr, col, off] of [[I, C.I, -0.25], [Q, C.Q, 0.25]]) {
          const yc = by + bh / 2 + off * bh, hh = bh * 0.22;
          ctx.strokeStyle = rgba(col, 0.5); ctx.lineWidth = 1.2; ctx.beginPath();
          for (let i = 0; i < n; i++) {
            const x0 = bx + (i / n) * bw, x1 = bx + ((i + 1) / n) * bw, y = yc - (arr[i] / amp) * hh;
            i ? ctx.lineTo(x0, y) : ctx.moveTo(x0, y); ctx.lineTo(x1, y);
          }
          ctx.stroke();
          for (let i = 0; i < n; i += 3) V.dot(ctx, bx + (i / n) * bw, yc - (arr[i] / amp) * hh, 1.6, col);
          V.text(ctx, col === C.I ? "I" : "Q", bx + 2, yc - hh - 2, { size: 13, color: col, font: FONT.display, weight: 800 });
        }
        V.text(ctx, "8 bitlik örnekler (basamaklı)", bx + bw, by + bh - 2, { size: 10.5, color: C.muted, align: "right" });
      }
      // okumalar
      const inBand = RF.filter((s) => Math.abs(s.f - LO) < ADC_FS / 2 - 0.1);
      ro.replaceChildren(
        h("div.readout.cr", h("span.k", "ADC'ye ulaşan dilim"), h("span.v", num(LO - ADC_FS / 2, 1) + "–" + num(LO + ADC_FS / 2, 1) + " MHz")),
        h("div.readout", h("span.k", "Dilimdeki istasyon"), h("span.v", String(inBand.length))),
        h("div.readout", h("span.k", "8 bit dinamik aralık"), h("span.v", "≈ " + num(6.02 * BITS + 1.76, 1) + " dB")),
      );
    }
    const st = canvas(cv, () => { G = null; draw(); });
    select("ant");
    const lp = loop((dt) => { t += dt; draw(); });
    return { enter() { lp.start(); }, leave() { lp.stop(); } };
  };

  /* ======================================================================
     Ortak sentetik bant (karıştırma slaytı): 240 kHz, beş istasyon
     ====================================================================== */
  const MIX_STATIONS = () => [
    { f: -85000, mod: "am", power: -30, m: 0.85, audio: Music.melody({ timbre: "organ", bpm: 112, transpose: -5 }), name: "AM müzik", bw: 10000 },
    { f: -45000, mod: "nfm", power: -36, dev: 2500, audio: Music.voice({ pitch: 125, seed: 4 }), name: "Telsiz konuşması (NFM)", bw: 11000 },
    { f: 20000, mod: "nfm", power: -32, dev: 3500, audio: Music.melody({ timbre: "flute", bpm: 128 }), name: "NFM müzik", bw: 13000 },
    { f: 55000, mod: "cw", power: -40, audio: Music.morse({ text: "SDR", freq: 700 }), name: "Mors (CW)", bw: 1500 },
    { f: 90000, mod: "am", power: -38, m: 0.8, audio: Music.voice({ pitch: 180, seed: 9 }), name: "AM konuşma", bw: 10000 },
  ];
  const MODE_OF = { am: "am", nfm: "nfm", cw: "cw" };

  // Ortak "dinleyici": bant → (isteğe bağlı ön filtre) → Receiver → ses (48 kHz)
  function makeListener(rcvOpts = {}) {
    const rcv = new Signals.Receiver({ rate: FS, decim: 5, mode: "nfm", bw: 12000, dev: 3000, ...rcvOpts });
    const cwst = {};
    let mode = "nfm", tune = 0;
    return {
      rcv,
      set(f, m, bw, dev) {
        mode = m; tune = f;
        rcv.mode = m === "cw" ? "am" : m;
        if (dev) rcv.dev = dev;
        rcv.setTune(m === "cw" ? f - 700 : f);
        if (bw && Math.abs(bw - rcv.bw) > 50) rcv.setBandwidth(bw);
      },
      process(iq) {
        const r = rcv.process(iq);
        return mode === "cw" ? cwAudio(cwst, r.iq) : r.audio;
      },
      get mode() { return mode; }, get tune() { return tune; },
    };
  }

  /* ======================================================================
     2. Karıştırma: spektrumu kaydırmak
     ====================================================================== */
  Demos.mixTune = function (stage, slide) {
    const cv = h("canvas", { "aria-label": "Giriş spektrumu, karıştırılmış spektrum ve şelale" });
    const left = h("div.c5-mixmain", cv);
    let ncoF = 0; // ayarlanan frekans (Hz); NCO = −ncoF
    const knob = makeKnob({
      label: "Ayar düğmesi", min: -118000, max: 118000, value: 0, perTurn: 80000, step: 100,
      fmt: (v) => khz(v), onchange: (v) => setTune(v, true), onrelease: (v) => afc(v),
    });
    const knobBox = h("div.c5-knobbox", knob.el);
    const fill = h("div.fill.c5-mixgrid", left, knobBox);
    const ctrl = h("div.controls");
    stage.append(fill, ctrl);

    const stations = MIX_STATIONS();
    const band = new Signals.Band({ rate: FS, stations, noise: -58, seed: 21 });
    const ring = new Ring(8192);
    const lis = makeListener();
    let listening = false, stream = null, modeSel = "auto", target = null;
    const feed = makeFeed(band, (iq) => ring.push(iq));
    const fifo = new Signals.AudioFifo(() => lis.process(feed.pull(4800)));

    const sl = slider({ label: "NCO frekansı", min: -118, max: 118, step: 0.1, value: 0, fmt: (v) => khz(v * 1000), cls: "cr", oninput: (v) => { setTune(v * 1000, true); knob.set(v * 1000); } });
    const modeSeg = seg([["auto", "Oto"], ["am", "AM"], ["nfm", "FM"], ["cw", "CW"]], "auto", (k) => { modeSel = k; applyMode(); }, "Demodülasyon türü");
    const listen = toggle("Dinle", false, (on) => {
      listening = on;
      if (on) { applyMode(); stream = stream || Sound.stream(slide, (out) => fifo.fill(out), { gain: 0.9 }); }
      else if (stream) { stream.stop(); stream = null; }
    });
    const ro = h("div.readouts");
    ctrl.append(listen, modeSeg, sl, h("span.spacer"), ro);

    const near = (f) => stations.find((s) => Math.abs(f - s.f) <= Math.max(1500, s.bw * 0.5)) || null;
    function applyMode() {
      target = near(ncoF);
      const m = modeSel === "auto" ? (target ? MODE_OF[target.mod] : "nfm") : modeSel;
      lis.set(ncoF, m, m === "cw" ? 2500 : m === "am" ? 10000 : 12000, target && target.dev ? target.dev : 3000);
      modeSeg.querySelectorAll("button")[0].textContent = modeSel === "auto" ? "Oto: " + ({ am: "AM", nfm: "FM", cw: "CW" })[m] : "Oto";
    }
    function setTune(f, user) {
      ncoF = clamp(f, -118000, 118000);
      sl.set(ncoF / 1000);
      applyMode();
    }
    // bırakınca yakın bir istasyona kilitlen (otomatik frekans kontrolü, AFC)
    let afcAnim = null;
    function afc(v) {
      const s = stations.find((s) => Math.abs(v - s.f) < 2500);
      if (s && s.f !== v) afcAnim = { from: v, to: s.f, t: 0 };
    }

    // DSP durumu
    const blk = new Float32Array(2 * NFFT), mixed = new Float32Array(2 * NFFT);
    const sIn = new Float32Array(NFFT), sMx = new Float32Array(NFFT);
    const avIn = new DSP.SpectrumAverager(NFFT), avMx = new DSP.SpectrumAverager(NFFT);
    const re = new Float64Array(NFFT), im = new Float64Array(NFFT);
    const wf = new V.Waterfall(512, 200); wf.min = -102; wf.max = -42;
    let lastNco = 0, shiftAnim = 0;

    function compute() {
      ring.latest(NFFT, blk);
      DSP.spectrum(blk, NFFT, { re, im, out: sIn });
      // karıştırma: e^(−j2π·f·n/fs) ile çarp
      const w = -TAU * ncoF / FS;
      for (let i = 0; i < NFFT; i++) {
        const c = Math.cos(w * i), s = Math.sin(w * i), I = blk[2 * i], Q = blk[2 * i + 1];
        mixed[2 * i] = I * c - Q * s; mixed[2 * i + 1] = I * s + Q * c;
      }
      DSP.spectrum(mixed, NFFT, { re, im, out: sMx });
      avIn.push(sIn, 0.3);
      // ayar değişince ortalamayı sıfırla (kayma anında görünsün)
      avMx.push(sMx, ncoF !== lastNco ? 1 : 0.3);
      lastNco = ncoF;
      wf.push(sMx);
    }

    function draw() {
      const { ctx, w, h: H } = st;
      if (!w) return;
      ctx.clearRect(0, 0, w, H);
      const min = -100, max = -20;
      const p1y = 22, p1h = Math.max(60, H * 0.23);
      const ax1 = p1y + p1h;
      const p2y = ax1 + 52, p2h = Math.max(70, H * 0.27);
      const ax2 = p2y + p2h;
      const wy = ax2 + 30, wh = Math.max(20, H - wy - 2);
      const X = (f) => ((f + FS / 2) / FS) * w;
      // 1. giriş
      panelBg(ctx, 0, p1y, w, p1h);
      V.dbGrid(ctx, { x: 0, y: p1y, w, h: p1h, min, max, step: 20, unit: "dBFS" });
      V.spectrum(ctx, { x: 0, y: p1y, w, h: p1h, db: avIn.db, min, max, alpha: 0.85 });
      title(ctx, "Giriş: 240 kHz'lik bant (IQ)", 4, 15, C.ink2);
      fAxis(ctx, 0, ax1, w, -FS / 2, FS / 2, { count: 8 });
      // ayarlanan yer: kırmızı ibre
      V.needle(ctx, X(ncoF), p1y, p1h, "");
      // istasyon adları
      stations.forEach((s) => {
        const x = X(s.f), on = target === s;
        if (w < 560 && !on) return;
        V.text(ctx, s.name.replace(/ \(.*\)/, ""), clamp(x, 34, w - 34), p1y + 14, { align: "center", size: 10.5, color: on ? C.ink : C.muted, weight: on ? 700 : 400 });
      });
      // kaydırma oku
      const sx0 = X(ncoF), sx1 = X(0);
      if (Math.abs(sx1 - sx0) > 14) {
        const yy = ax1 + 38;
        ctx.strokeStyle = rgba(C.needle, 0.75); ctx.fillStyle = rgba(C.needle, 0.75); ctx.lineWidth = 1.5;
        ctx.setLineDash([4, 3]); ctx.beginPath(); ctx.moveTo(sx0, yy); ctx.lineTo(sx1, yy); ctx.stroke(); ctx.setLineDash([]);
        const d = Math.sign(sx1 - sx0);
        ctx.beginPath(); ctx.moveTo(sx1, yy); ctx.lineTo(sx1 - d * 7, yy - 4); ctx.lineTo(sx1 - d * 7, yy + 4); ctx.closePath(); ctx.fill();
        V.text(ctx, "× e^(−j2π·" + num(ncoF / 1000, 1) + " kHz·t)", (sx0 + sx1) / 2, yy - 5, { align: "center", size: 11, color: C.needle, weight: 700 });
      }
      // 2. karıştırılmış
      panelBg(ctx, 0, p2y, w, p2h);
      V.dbGrid(ctx, { x: 0, y: p2y, w, h: p2h, min, max, step: 20, unit: "dBFS" });
      // dinleme penceresi
      const bwW = target ? target.bw : 12000;
      ctx.fillStyle = rgba(C.ink, 0.06); ctx.fillRect(X(-bwW / 2), p2y, X(bwW / 2) - X(-bwW / 2), p2h);
      V.spectrum(ctx, { x: 0, y: p2y, w, h: p2h, db: avMx.db, min, max });
      title(ctx, "Karıştırıldıktan sonra: ayarlanan istasyon 0 Hz'de", 4, p2y - 7, C.ink);
      fAxis(ctx, 0, ax2, w, -FS / 2, FS / 2, { count: 8, unit: "kHz (merkeze göre)" });
      V.needle(ctx, X(0), p2y, p2h + 26 + wh, target ? target.name : "parazit");
      // 3. şelale
      wf.draw(ctx, 0, wy, w, wh);
      ctx.strokeStyle = rgba(C.line, 1); ctx.strokeRect(0.5, wy + 0.5, w - 1, wh - 1);
      V.needle(ctx, X(0), wy, wh);
      // okumalar
      const err = target ? ncoF - target.f : null;
      ro.replaceChildren(
        h("div.readout.cr", h("span.k", "NCO frekansı"), h("span.v", khz(-ncoF))),
        h("div.readout", h("span.k", "Merkezde"), h("span.v", target ? target.name : "boşluk (parazit)")),
        h("div.readout", h("span.k", "Ayar hatası"), h("span.v", err == null ? "—" : khz(err, 1))),
      );
    }
    const st = canvas(cv, () => draw());
    let roT = 0;
    const lp = loop((dt) => {
      if (afcAnim && !knob.dragging) {
        afcAnim.t = Math.min(1, afcAnim.t + dt * 4);
        const v = afcAnim.from + (afcAnim.to - afcAnim.from) * L.ease(afcAnim.t);
        knob.set(v); setTune(v);
        if (afcAnim.t >= 1) afcAnim = null;
      }
      feed.tick(dt);
      compute();
      roT += dt;
      draw();
      knob.draw();
    });
    // ilk açılışta şelale dolu olsun
    for (let i = 0; i < 200; i++) { ring.push(band.next(1200)); compute(); }
    setTune(0);
    return {
      enter() { lp.start(); },
      leave() { lp.stop(); if (stream) { stream.stop(); stream = null; } listening = false; listen.set(false); },
    };
  };

  /* ======================================================================
     3. Filtrele ve azalt
     ====================================================================== */
  Demos.filterDecim = function (stage, slide) {
    const cv = h("canvas", { "aria-label": "Giriş spektrumu, filtre yanıtı ve azaltılmış kalan bant" });
    const fill = h("div.fill.c5-tall", cv);
    const ctrl = h("div.controls");
    stage.append(fill, ctrl);

    // istasyon zaten 0 Hz'e getirilmiş: hemen yanında (14 kHz) bir komşu AM yayını var
    const stations = [
      { f: 0, mod: "am", power: -28, m: 0.9, audio: Music.melody({ timbre: "organ", bpm: 104 }), name: "Dinlenen: AM müzik" },
      { f: 14000, mod: "am", power: -31, m: 0.85, audio: Music.voice({ pitch: 150, seed: 6 }), name: "Komşu: AM konuşma" },
      { f: -32000, mod: "nfm", power: -34, dev: 3000, audio: Music.melody({ timbre: "pluck", bpm: 150, transpose: 4 }), name: "NFM" },
      { f: 58000, mod: "nfm", power: -36, dev: 2500, audio: Music.voice({ pitch: 110, seed: 2 }), name: "Telsiz" },
      { f: -78000, mod: "am", power: -33, m: 0.8, audio: Music.melody({ timbre: "flute", bpm: 90, transpose: -3 }), name: "AM" },
    ];
    const band = new Signals.Band({ rate: FS, stations, noise: -60, seed: 8 });
    let cut = 6000, taps = 63, M = 5;
    const ring = new Ring(8192), dring = new Ring(4096);
    let fir = new DecFIR(DSP.firLowpass(taps, cut / FS), M);
    const am = new AMDet(), rs = new Resamp(48000);
    let resp = null, meas = {};
    function design() {
      fir.set(DSP.firLowpass(taps, cut / FS), M);
      resp = DSP.freqResponse(fir.h, 512); // 0 … fs/2
      // ölçüm: −3 dB ve −60 dB noktaları, durdurma bandındaki en yüksek seviye
      const fOf = (k) => (0.5 * k) / 511 * FS;
      let k3 = 0; while (k3 < 511 && resp[k3] > -3) k3++;
      let k60 = k3; while (k60 < 511 && resp[k60] > -60) k60++;
      let stop = -200; for (let k = k60; k < 512; k++) stop = Math.max(stop, resp[k]);
      let kmin = k3; while (kmin < 511 && resp[kmin] > -40) kmin++;
      let peakStop = -200; for (let k = kmin; k < 512; k++) peakStop = Math.max(peakStop, resp[k]);
      // komşunun (14 kHz) uğradığı bastırma
      const kn = Math.round((14000 / FS) * 2 * 511);
      meas = { f3: fOf(k3), trans: fOf(k60) - fOf(k3), stop: peakStop, neigh: resp[kn] };
    }
    const feed = makeFeed(band, (iq) => {
      ring.push(iq);
      const d = fir.process(iq);
      dring.push(d);
      feed.last = d;
    });
    function produce(iq) {
      const d = feed.last, r = FS / M;
      return rs.process(am.process(d, r), r);
    }
    const fifo = new Signals.AudioFifo(() => produce(feed.pull(4800)));
    let stream = null;

    const sCut = slider({ label: "Kesim frekansı", min: 500, max: 60000, value: cut, log: true, fmt: (v) => "±" + khzU(v, v < 10000 ? 1 : 0), oninput: (v) => { cut = v; design(); } });
    const sTap = slider({ label: "Katsayı sayısı", min: 7, max: 151, step: 2, value: taps, fmt: (v) => String(Math.round(v)), oninput: (v) => { taps = Math.round(v) | 1; design(); } });
    const mSeg = seg([[1, "M = 1"], [2, "2"], [5, "5"], [10, "10"], [20, "20"]], M, (k) => { M = k; design(); dring.b.fill(0); }, "Azaltma oranı");
    const listen = toggle("Dinle", false, (on) => {
      if (on) stream = stream || Sound.stream(slide, (out) => fifo.fill(out), { gain: 0.9 });
      else if (stream) { stream.stop(); stream = null; }
    });
    const ro = h("div.readouts.c5-ro-wide");
    ctrl.append(listen, sCut, sTap, h("span.c5-pair", h("span.c5-lab", "Azaltma"), mSeg), h("span.spacer"), ro);

    const blk = new Float32Array(2 * NFFT), sIn = new Float32Array(NFFT), re = new Float64Array(NFFT), im = new Float64Array(NFFT);
    const avIn = new DSP.SpectrumAverager(NFFT);
    const ND = 256, dblk = new Float32Array(2 * ND), sD = new Float32Array(ND), avD = new DSP.SpectrumAverager(ND);
    const reD = new Float64Array(ND), imD = new Float64Array(ND);
    let lastM = M;
    function compute() {
      ring.latest(NFFT, blk);
      avIn.push(DSP.spectrum(blk, NFFT, { re, im, out: sIn }), 0.3);
      dring.latest(ND, dblk);
      avD.push(DSP.spectrum(dblk, ND, { re: reD, im: imD, out: sD }), lastM !== M ? 1 : 0.3);
      lastM = M;
    }

    function draw() {
      const { ctx, w, h: H } = st;
      if (!w) return;
      ctx.clearRect(0, 0, w, H);
      const min = -110, max = -20, narrow = w < 640;
      const p1y = 22, p1h = narrow ? H * 0.34 : H * 0.42, ax1 = p1y + p1h;
      const X = (f) => ((f + FS / 2) / FS) * w;
      panelBg(ctx, 0, p1y, w, p1h);
      V.dbGrid(ctx, { x: 0, y: p1y, w, h: p1h, min, max, step: 20, unit: "dBFS" });
      // azaltma sonrası sığacak bölge
      const half = FS / M / 2;
      ctx.fillStyle = rgba(C.ink, 0.05); ctx.fillRect(X(-half), p1y, X(half) - X(-half), p1h);
      V.spectrum(ctx, { x: 0, y: p1y, w, h: p1h, db: avIn.db, min, max, alpha: 0.9 });
      // filtre yanıtı (simetrik: gerçek katsayılar), 0 dB = üst kenar, alt = −90 dB
      const n = 513, arr = new Float32Array(n);
      for (let i = 0; i < n; i++) {
        const f = Math.abs(-0.5 + i / (n - 1)), k = Math.min(511, Math.round(f * 2 * 511));
        arr[i] = resp[k];
      }
      respCurve(ctx, 0, p1y, w, p1h, arr, -90, 0, BRASS, 0.08);
      title(ctx, "Giriş (istasyon 0 Hz'de) ve filtrenin yanıtı", 4, 15, C.ink);
      V.text(ctx, "filtre: 0 dB üstte", w - 4, 15, { align: "right", size: 11, color: BRASS, weight: 700 });
      fAxis(ctx, 0, ax1, w, -FS / 2, FS / 2, { count: 8 });
      V.needle(ctx, X(0), p1y, p1h);
      // istasyon etiketleri
      stations.forEach((s, i) => {
        if (narrow && i > 1) return;
        const g = resp[Math.min(511, Math.round((Math.abs(s.f) / FS) * 2 * 511))];
        const y = p1y + 30 + (i === 1 ? 16 : 0);
        V.text(ctx, s.name, clamp(X(s.f) + (i === 1 ? 6 : 0), 40, w - 40), y, { align: i === 1 ? "left" : "center", size: 10.5, color: g > -20 ? C.ink : C.muted, weight: g > -20 ? 700 : 400 });
      });
      if (half < FS / 2) {
        if (!narrow) V.text(ctx, "azaltmadan sonra kalan: ±" + khzU(half, 0), X(half) + 5, p1y + 66, { size: 10.5, color: C.ink2 });
        ctx.strokeStyle = rgba(C.ink, 0.35); ctx.setLineDash([3, 3]);
        ctx.beginPath(); ctx.moveTo(X(-half), p1y); ctx.lineTo(X(-half), p1y + p1h); ctx.moveTo(X(half), p1y); ctx.lineTo(X(half), p1y + p1h); ctx.stroke(); ctx.setLineDash([]);
      }
      // 2. kalan bant
      const p2y = ax1 + 56, p2h = H - p2y - 34;
      const dw = narrow ? w : Math.min(w, Math.max(w * 0.55, (w * 1) / M * 3));
      const dx = (w - dw) / 2;
      // giriş ekseniyle bağlantı (huni)
      ctx.fillStyle = rgba(C.ink, 0.04);
      ctx.beginPath(); ctx.moveTo(X(-half), ax1 + 26); ctx.lineTo(X(half), ax1 + 26); ctx.lineTo(dx + dw, p2y); ctx.lineTo(dx, p2y); ctx.closePath(); ctx.fill();
      panelBg(ctx, dx, p2y, dw, p2h);
      V.dbGrid(ctx, { x: dx, y: p2y, w: dw, h: p2h, min, max, step: 20, unit: "dBFS" });
      V.spectrum(ctx, { x: dx, y: p2y, w: dw, h: p2h, db: avD.db, min, max });
      V.frame(ctx, dx, p2y, dw, p2h);
      title(ctx, `Kalan bant: süzülüp her ${M} örnekten biri tutuldu (${khzU(FS / M, 0)} hız)`, dx + 4, p2y - 7, C.ink);
      fAxis(ctx, dx, p2y + p2h, dw, -half, half, { count: narrow ? 5 : 7, dec: half < 10000 ? 1 : 0 });
      V.needle(ctx, dx + dw / 2, p2y, p2h);
      const leak = meas.neigh > -25 && half > 12000;
      const alias = cut + meas.trans * 0.5 > half;
      let warn = "";
      if (alias) warn = "Uyarı: kesim, kalan bandın kenarını aşıyor: dışarıdaki istasyonlar içeri katlanır (örtüşme)";
      else if (leak) warn = "Komşu istasyon filtreden sızıyor: ıslık ve karışık konuşma";
      else if (cut < 1500) warn = "Kesim çok dar: müziğin tınısı kesiliyor, ses boğuk";
      if (warn) V.text(ctx, warn, dx + 8, p2y + 16, { size: 12, color: alias || leak ? C.needle : C.ink, weight: 700 });

      const muls = 2 * taps * (FS / M);
      ro.replaceChildren(
        h("div.readout", h("span.k", "−3 dB kesim (ölçülen)"), h("span.v", "±" + khzU(meas.f3, 1))),
        h("div.readout", h("span.k", "Geçiş bandı (−3 → −60 dB)"), h("span.v", khzU(meas.trans, 1))),
        h("div.readout", h("span.k", "Komşuya (14 kHz) bastırma"), h("span.v", dbs(meas.neigh))),
        h("div.readout", h("span.k", "Yeni örnekleme hızı"), h("span.v", khzU(FS / M, 0))),
        h("div.readout", h("span.k", "Filtre yükü"), h("span.v", mega(muls) + " çarpma/sn")),
      );
    }
    design();
    const st = canvas(cv, () => draw());
    const lp = loop((dt) => { feed.tick(dt); compute(); draw(); });
    for (let i = 0; i < 40; i++) feed.tick(1 / 60);
    return {
      enter() { lp.start(); },
      leave() { lp.stop(); if (stream) { stream.stop(); stream = null; } listen.set(false); },
    };
  };

  /* ======================================================================
     4. Bant geçiren filtre: yalnızca bir pencere
     ====================================================================== */
  Demos.bandWindow = function (stage, slide) {
    const cvIn = h("canvas.c5-drag", { "aria-label": "Giriş spektrumu: pencereyi sürükleyin" });
    const cvOut = h("canvas", { "aria-label": "Süzülmüş çıkışın spektrumu" });
    const fill = h("div.fill.c5-bw", h("div.c5-bwin", cvIn), h("div.c5-bwout", cvOut));
    const ctrl = h("div.controls");
    stage.append(fill, ctrl);

    const stations = [
      { f: -80000, mod: "am", power: -32, m: 0.85, audio: Music.melody({ timbre: "organ", bpm: 110, transpose: -2 }), name: "AM müzik", bw: 10000 },
      { f: -40000, mod: "nfm", power: -36, dev: 2500, audio: Music.voice({ pitch: 120, seed: 5 }), name: "Telsiz", bw: 11000 },
      { f: 10000, mod: "nfm", power: -34, dev: 3500, audio: Music.melody({ timbre: "flute", bpm: 124, transpose: 3 }), name: "NFM müzik", bw: 13000 },
      { f: 50000, mod: "nfm", power: -10, dev: 6000, audio: Music.melody({ timbre: "pluck", bpm: 140 }), name: "Güçlü yayın", bw: 18000 },
      { f: 72000, mod: "am", power: -64, m: 0.9, audio: Music.voice({ pitch: 170, seed: 13 }), name: "Zayıf istasyon", bw: 10000 },
    ];
    const band = new Signals.Band({ rate: FS, stations, noise: -60, seed: 31 });
    let type = "bp", coef = "real", fc = -40000, bwid = 16000, taps = 95;
    let H = null, resp = null, meas = {};
    const cf = new DSP.CFIR({ re: new Float32Array(taps), im: new Float32Array(taps) });
    function design() {
      const f0 = type === "lp" ? 0 : fc / FS, b = bwid / FS;
      let re, im;
      if (type === "lp") { re = DSP.firLowpass(taps, b / 2); im = new Float32Array(taps); }
      else if (type === "bp") {
        if (coef === "real") { re = DSP.firBandpassReal(taps, f0, b); im = new Float32Array(taps); }
        else ({ re, im } = DSP.firBandpass(taps, f0, b));
      } else {
        if (coef === "real") { re = DSP.firBandpassReal(taps, f0, b); im = new Float32Array(taps); const m = (taps - 1) / 2; for (let i = 0; i < taps; i++) re[i] = (i === m ? 1 : 0) - re[i]; }
        else ({ re, im } = DSP.firBandstop(taps, f0, b));
      }
      H = { re, im }; cf.set(H);
      resp = respFFT(re, im, 2048);
      // ölçümler (yanıt dizisinden)
      const N = resp.length, idx = (f) => clamp(Math.round((f / FS) * N + N / 2), 0, N - 1), fOf = (k) => ((k - N / 2) / N) * FS;
      const c = idx(type === "lp" ? 0 : fc);
      if (type === "bs") {
        let lo = c, hi = c; while (lo > 0 && resp[lo] < -3) lo--; while (hi < N - 1 && resp[hi] < -3) hi++;
        meas = { depth: resp[c], w3: fOf(hi) - fOf(lo), mirror: resp[idx(-fc)] };
      } else {
        let hi = c; while (hi < N - 1 && resp[hi] > -3) hi++;
        let lo = c; while (lo > 0 && resp[lo] > -3) lo--;
        let k60 = hi; while (k60 < N - 1 && resp[k60] > -60) k60++;
        let peak = -200; for (let k = 0; k < N; k++) { const f = fOf(k); const dd = Math.abs(f - (type === "lp" ? 0 : fc)); const dm = Math.abs(f + fc); if (dd > bwid / 2 + (fOf(k60) - fOf(hi)) && (type === "lp" || coef === "complex" || dm > bwid / 2 + (fOf(k60) - fOf(hi)))) peak = Math.max(peak, resp[k]); }
        meas = { w3: fOf(hi) - fOf(lo), trans: fOf(k60) - fOf(hi), stop: peak, mirror: type === "bp" ? resp[idx(-fc)] : null };
      }
      applyListen();
    }
    // dinleme: pencere merkezindeki istasyon
    const lis = makeListener();
    const ring = new Ring(8192), oring = new Ring(8192);
    let stream = null, listening = false;
    const feed = makeFeed(band, (iq, audio) => { ring.push(iq); if (audio) { const y = cf.process(iq); oring.push(y); feed.y = y; } });
    function applyListen() {
      const c = type === "lp" ? 0 : fc;
      const s = stations.find((s) => Math.abs(s.f - c) < Math.max(4000, bwid / 2));
      const f = s ? s.f : c;
      lis.set(f, s ? s.mod : "nfm", clamp(Math.min(bwid, 40000), 3000, 40000), s && s.dev ? s.dev : 3000);
      cur = s;
    }
    let cur = null;
    const fifo = new Signals.AudioFifo(() => { feed.pull(4800); return lis.process(feed.y); });

    const tSeg = seg([["lp", "Alçak geçiren"], ["bp", "Bant geçiren"], ["bs", "Bant durduran"]], type, (k) => { type = k; cSeg.classList.toggle("c5-dim", k === "lp"); design(); }, "Filtre türü");
    const cSeg = seg([["real", "Gerçek"], ["complex", "Karmaşık"]], coef, (k) => { coef = k; design(); }, "Katsayılar");
    const sTap = slider({ label: "Katsayı sayısı", min: 31, max: 191, step: 2, value: taps, fmt: (v) => String(Math.round(v)), oninput: (v) => { taps = Math.round(v) | 1; design(); } });
    const listen = toggle("Dinle", false, (on) => {
      listening = on;
      if (on) stream = stream || Sound.stream(slide, (out) => fifo.fill(out), { gain: 0.9 });
      else if (stream) { stream.stop(); stream = null; }
    });
    const ro = h("div.readouts.c5-ro-wide");
    ctrl.append(listen, tSeg, h("span.c5-pair", h("span.c5-lab", "Katsayılar"), cSeg), sTap, h("span.spacer"), ro);

    // sürükleme: merkez ya da kenar
    let drag = null;
    const fx = (x) => (x / stIn.w) * FS - FS / 2;
    const xf = (f) => ((f + FS / 2) / FS) * stIn.w;
    function hit(x) {
      const c = type === "lp" ? 0 : fc, l = xf(c - bwid / 2), r = xf(c + bwid / 2);
      if (Math.abs(x - l) < 9) return "l";
      if (Math.abs(x - r) < 9) return "r";
      if (x > l && x < r) return "c";
      return "out";
    }
    L.pointer(cvIn, {
      down(x) {
        const k = hit(x);
        drag = { k: k === "out" ? "c" : k, x0: x, fc0: k === "out" ? fx(x) : fc, bw0: bwid };
        if (k === "out" && type !== "lp") { fc = clamp(fx(x), -FS / 2 + bwid / 2, FS / 2 - bwid / 2); drag.fc0 = fc; design(); }
      },
      move(x) {
        if (!drag) return;
        const df = fx(x) - fx(drag.x0);
        if (drag.k === "c") { if (type !== "lp") fc = clamp(drag.fc0 + df, -FS / 2 + bwid / 2, FS / 2 - bwid / 2); }
        else {
          const c = type === "lp" ? 0 : fc;
          bwid = clamp(2 * Math.abs(fx(x) - c), 2000, type === "lp" ? 200000 : 120000);
        }
        design();
      },
      up() { drag = null; },
      hover(x) { cvIn.style.cursor = x < 0 ? "" : ({ l: "ew-resize", r: "ew-resize", c: "grab", out: "pointer" })[hit(x)]; },
    });

    const blk = new Float32Array(2 * NFFT), sIn = new Float32Array(NFFT), sOut = new Float32Array(NFFT);
    const re = new Float64Array(NFFT), im = new Float64Array(NFFT);
    const avIn = new DSP.SpectrumAverager(NFFT), avOut = new DSP.SpectrumAverager(NFFT);
    const wf = new V.Waterfall(512, 160);
    let topDb = -10;
    function compute() {
      ring.latest(NFFT, blk);
      avIn.push(DSP.spectrum(blk, NFFT, { re, im, out: sIn }), 0.3);
      // görsel çıkış: son bloğu durumsuz süz (dinlerken de aynı sonuç)
      const T = taps, big = new Float32Array(2 * (NFFT + T));
      ring.latest(NFFT + T, big);
      const y = new DSP.CFIR(H).process(big);
      avOut.push(DSP.spectrum(y, NFFT, { offset: T, re, im, out: sOut }), 0.3);
      let mx = -200; for (let i = 0; i < NFFT; i++) mx = Math.max(mx, avOut.db[i]);
      topDb += (Math.max(mx + 8, -70) - topDb) * 0.08; // ölçek en güçlü sinyale uyar (çoğu SDR programı gibi)
      wf.min = topDb - 85; wf.max = topDb - 10;
      wf.push(avOut.db);
    }
    function drawIn() {
      const { ctx, w, h: Hh } = stIn;
      if (!w) return;
      ctx.clearRect(0, 0, w, Hh);
      const min = -100, max = 0, y0 = 20, hh = Hh - y0 - 30;
      panelBg(ctx, 0, y0, w, hh);
      V.dbGrid(ctx, { x: 0, y: y0, w, h: hh, min, max, step: 20, unit: "dBFS" });
      V.spectrum(ctx, { x: 0, y: y0, w, h: hh, db: avIn.db, min, max, alpha: 0.85 });
      const arr = new Float32Array(512); for (let i = 0; i < 512; i++) arr[i] = resp[i * 4];
      respCurve(ctx, 0, y0, w, hh, arr, -90, 0, BRASS, 0.07);
      // pencere
      const c = type === "lp" ? 0 : fc, l = xf(c - bwid / 2), r = xf(c + bwid / 2);
      const drawWin = (L0, R0, ghost) => {
        ctx.save();
        ctx.fillStyle = rgba(BRASS, ghost ? 0.05 : type === "bs" ? 0.16 : 0.1); ctx.fillRect(L0, y0, R0 - L0, hh);
        ctx.strokeStyle = rgba(BRASS, ghost ? 0.6 : 1); ctx.lineWidth = ghost ? 1 : 2; if (ghost) ctx.setLineDash([4, 4]);
        ctx.strokeRect(L0 + 0.5, y0 + 0.5, R0 - L0 - 1, hh - 1);
        if (!ghost) { // tutamaklar
          ctx.fillStyle = BRASS;
          [L0, R0].forEach((xx) => { ctx.beginPath(); ctx.roundRect(xx - 4, y0 + hh / 2 - 14, 8, 28, 3); ctx.fill(); });
        }
        ctx.restore();
      };
      if (coef === "real" && type !== "lp") { drawWin(xf(-c - bwid / 2), xf(-c + bwid / 2), true); V.text(ctx, "ayna (−f)", xf(-c), y0 + hh - 8, { align: "center", size: 11, color: BRASS, weight: 700 }); }
      drawWin(l, r, false);
      V.text(ctx, type === "bs" ? "durdur" : "geçir", (l + r) / 2, y0 + hh - 8, { align: "center", size: 11, color: BRASS, weight: 800 });
      stations.forEach((s) => {
        const on = cur === s;
        V.text(ctx, s.name, clamp(xf(s.f), 36, w - 36), y0 + 14, { align: "center", size: 10.5, color: on ? C.ink : C.muted, weight: on ? 700 : 400 });
      });
      title(ctx, "Giriş ve filtre (pencereyi sürükleyin, kenarlardan genişletin)", 4, 14, C.ink);
      fAxis(ctx, 0, y0 + hh, w, -FS / 2, FS / 2, { count: 8 });
      V.needle(ctx, xf(type === "lp" ? 0 : fc), y0, hh);
    }
    function drawOut() {
      const { ctx, w, h: Hh } = stOut;
      if (!w) return;
      ctx.clearRect(0, 0, w, Hh);
      const max = Math.ceil(topDb / 10) * 10, min = max - 80;
      const y0 = 20, hh = Math.max(40, (Hh - y0 - 30) * 0.62), wy = y0 + hh + 28, wh = Hh - wy;
      panelBg(ctx, 0, y0, w, hh);
      V.dbGrid(ctx, { x: 0, y: y0, w, h: hh, min, max, step: 20, unit: "dBFS" });
      V.spectrum(ctx, { x: 0, y: y0, w, h: hh, db: avOut.db, min, max });
      title(ctx, "Çıkış: süzülmüş sinyal (ölçek en güçlü sinyale uyar)", 4, 14, C.ink);
      fAxis(ctx, 0, y0 + hh, w, -FS / 2, FS / 2, { count: 8 });
      if (wh > 12) { wf.draw(ctx, 0, wy, w, wh); ctx.strokeStyle = C.line; ctx.strokeRect(0.5, wy + 0.5, w - 1, wh - 1); }
      V.needle(ctx, xf(type === "lp" ? 0 : fc), y0, hh);
    }
    function readouts() {
      const items = [h("div.readout.cr", h("span.k", type === "lp" ? "Merkez" : "Pencere merkezi"), h("span.v", type === "lp" ? "0 Hz" : khz(fc)))];
      if (type === "bs") {
        items.push(
          h("div.readout", h("span.k", "Çentik genişliği (−3 dB)"), h("span.v", khzU(meas.w3, 1))),
          h("div.readout", h("span.k", "Merkezde bastırma"), h("span.v", dbs(meas.depth))));
      } else {
        items.push(
          h("div.readout", h("span.k", "Geçiş bandı (−3 dB)"), h("span.v", khzU(meas.w3, 1))),
          h("div.readout", h("span.k", "Geçiş eğimi (−3 → −60 dB)"), h("span.v", khzU(meas.trans, 1))),
          h("div.readout", h("span.k", "Durdurma bandı"), h("span.v", "≤ " + dbs(meas.stop))));
      }
      if (type === "bp") items.push(h("div.readout" + (meas.mirror > -10 ? ".cq" : ""), h("span.k", "−f'deki ayna"), h("span.v", meas.mirror > -10 ? "o da geçer" : dbs(meas.mirror))));
      if (type === "bs") items.push(h("div.readout" + (meas.mirror < -20 ? ".cq" : ""), h("span.k", "−f'deki ayna"), h("span.v", meas.mirror < -20 ? "o da durdurulur" : "etkilenmez")));
      items.push(h("div.readout", h("span.k", "Dinlenen"), h("span.v", cur ? cur.name : "boşluk")));
      ro.replaceChildren(...items);
    }
    const stIn = canvas(cvIn, () => drawIn());
    const stOut = canvas(cvOut, () => drawOut());
    design();
    let roT = 1;
    const lp = loop((dt) => {
      feed.tick(dt); compute(); drawIn(); drawOut();
      roT += dt; if (roT > 0.15) { roT = 0; readouts(); }
    });
    for (let i = 0; i < 160; i++) { ring.push(band.next(1200)); compute(); }
    readouts();
    return {
      enter() { lp.start(); },
      leave() { lp.stop(); if (stream) { stream.stop(); stream = null; } listen.set(false); },
    };
  };

  /* ======================================================================
     5. Gerçek alıcının izleri
     ====================================================================== */
  Demos.rxFlaws = function (stage, slide) {
    const cv = h("canvas", { "aria-label": "Kusurlu alıcının spektrumu, şelalesi ve IQ noktaları" });
    const fill = h("div.fill.c5-tall", cv);
    const ctrl = h("div.controls.c5-flaws");
    stage.append(fill, ctrl);

    const stations = [
      { f: 30000, mod: "nfm", power: -14, dev: 3000, audio: Music.melody({ timbre: "flute", bpm: 120 }) },
      { f: 72000, mod: "am", power: -22, m: 0.8, audio: Music.voice({ pitch: 140, seed: 3 }) },
      { f: -58000, mod: "cw", power: -40, audio: Music.morse({ text: "TA", freq: 700 }) },
    ];
    const band = new Signals.Band({ rate: FS, stations, noise: -62, seed: 17 });
    const ring = new Ring(8192);
    const feed = makeFeed(band, (iq) => ring.push(iq));
    const P = { dcOn: true, dc: 0.03, iqOn: true, gErr: 1.0, pErr: 6, ovOn: false, gain: 0, dcFix: false, iqFix: false };
    const est = { mI: 0, mQ: 0, pI: 1, pQ: 1, cIQ: 0, init: false };

    const blk = new Float32Array(2 * NFFT), y = new Float32Array(2 * NFFT), sp = new Float32Array(NFFT);
    const re = new Float64Array(NFFT), im = new Float64Array(NFFT);
    const av = new DSP.SpectrumAverager(NFFT);
    const wf = new V.Waterfall(512, 200); wf.min = -100; wf.max = -10;
    let clipFrac = 0, irrMeas = null, dcMeas = null, zoom = 1;
    const irrTheory = () => {
      const a = 10 ** (P.gErr / 20), ph = (P.pErr * Math.PI) / 180;
      const k1 = 1 + 2 * a * Math.cos(ph) + a * a, k2 = 1 - 2 * a * Math.cos(ph) + a * a;
      return k2 < 1e-12 ? Infinity : 10 * Math.log10(k1 / k2);
    };
    function process() {
      ring.latest(NFFT, blk);
      const g = 10 ** (P.gain / 20), a = 10 ** (P.gErr / 20), ph = (P.pErr * Math.PI) / 180, cs = Math.cos(ph), sn = Math.sin(ph);
      let clipped = 0;
      for (let i = 0; i < NFFT; i++) {
        let I = blk[2 * i] * g, Q = blk[2 * i + 1] * g;
        if (P.iqOn) { const q = a * (Q * cs + I * sn); Q = q; }
        if (P.dcOn) { I += P.dc; Q += P.dc * 0.6; }
        // ADC: ±1'de kırpar, 8 bit nicemler
        if (P.ovOn || g > 1) { if (Math.abs(I) > 1 || Math.abs(Q) > 1) clipped++; }
        I = Math.round(clamp(I, -1, 1) * 127) / 127; Q = Math.round(clamp(Q, -1, 1) * 127) / 127;
        y[2 * i] = I; y[2 * i + 1] = Q;
      }
      clipFrac = clipped / NFFT;
      // düzeltmeler: istatistikler bloklar boyunca yavaşça izlenir
      let mI = 0, mQ = 0; for (let i = 0; i < NFFT; i++) { mI += y[2 * i]; mQ += y[2 * i + 1]; } mI /= NFFT; mQ /= NFFT;
      const k = est.init ? 0.08 : 1;
      est.mI += (mI - est.mI) * k; est.mQ += (mQ - est.mQ) * k;
      if (P.dcFix) for (let i = 0; i < NFFT; i++) { y[2 * i] -= est.mI; y[2 * i + 1] -= est.mQ; }
      let pI = 0, pQ = 0, cIQ = 0;
      for (let i = 0; i < NFFT; i++) { const I = y[2 * i] - (P.dcFix ? 0 : est.mI), Q = y[2 * i + 1] - (P.dcFix ? 0 : est.mQ); pI += I * I; pQ += Q * Q; cIQ += I * Q; }
      est.pI += (pI / NFFT - est.pI) * k; est.pQ += (pQ / NFFT - est.pQ) * k; est.cIQ += (cIQ / NFFT - est.cIQ) * k; est.init = true;
      if (P.iqFix) {
        // Gram–Schmidt: Q'dan I ile ilişkili kısmı çıkar, sonra Q'nun gücünü I'ya eşitle
        const rho = est.cIQ / est.pI, pq1 = est.pQ - rho * rho * est.pI, sc = Math.sqrt(est.pI / Math.max(pq1, 1e-12));
        for (let i = 0; i < NFFT; i++) y[2 * i + 1] = (y[2 * i + 1] - rho * y[2 * i]) * sc;
      }
      DSP.spectrum(y, NFFT, { re, im, out: sp });
      av.push(sp, 0.35);
      wf.push(sp);
      // ölçümler: +30 kHz istasyonu ile −30 kHz aynası; merkez kutusu
      const bin = (f) => Math.round((f / FS) * NFFT + NFFT / 2);
      const pk = (f) => { let m = -200; for (let j = -6; j <= 6; j++) m = Math.max(m, av.db[bin(f) + j]); return m; };
      irrMeas = pk(30000) - pk(-30000);
      let floor = 0; for (let j = 20; j < 60; j++) floor += av.db[bin(-100000) + j]; floor /= 40;
      dcMeas = Math.max(av.db[NFFT / 2], av.db[NFFT / 2 - 1], av.db[NFFT / 2 + 1]) - floor;
    }

    function draw() {
      const { ctx, w, h: H } = st;
      if (!w) return;
      ctx.clearRect(0, 0, w, H);
      const narrow = w < 640;
      const cW = narrow ? 0 : Math.min(230, w * 0.3), sw = w - cW - (cW ? 14 : 0);
      const min = -110, max = 0;
      const y0 = 22, sh = narrow ? H * 0.36 : H * 0.48, ax = y0 + sh, wy = ax + 30, wh = H - wy - (narrow ? 150 : 2);
      const X = (f) => ((f + FS / 2) / FS) * sw;
      panelBg(ctx, 0, y0, sw, sh);
      V.dbGrid(ctx, { x: 0, y: y0, w: sw, h: sh, min, max, step: 20, unit: "dBFS" });
      V.spectrum(ctx, { x: 0, y: y0, w: sw, h: sh, db: av.db, min, max });
      fAxis(ctx, 0, ax, sw, -FS / 2, FS / 2, { count: narrow ? 6 : 8, unit: "kHz (merkeze göre)" });
      title(ctx, "Alıcının çıkışı (8 bit ADC'den sonra)", 4, 14, C.ink);
      V.needle(ctx, X(0), y0, sh);
      // işaretler
      const tag = (f, s, col, yy) => {
        const x = X(f);
        ctx.strokeStyle = col; ctx.lineWidth = 1; ctx.setLineDash([2, 3]);
        ctx.beginPath(); ctx.moveTo(x, y0 + yy + 4); ctx.lineTo(x, y0 + yy + 22); ctx.stroke(); ctx.setLineDash([]);
        V.text(ctx, s, clamp(x, 40, sw - 40), y0 + yy, { align: "center", size: 11, color: col, weight: 700 });
      };
      if (P.dcOn && !P.dcFix) tag(0, "DC sivrisi", C.needle, 36);
      if (P.iqOn && !P.iqFix && irrMeas < 45) { tag(-30000, "ayna", C.Q, 36); tag(-72000, "ayna", C.Q, 36); }
      if (clipFrac > 0.001) V.text(ctx, "kırpılma: sahte tepeler ve yükselen taban", sw - 6, y0 + sh - 10, { align: "right", size: 12, color: C.needle, weight: 700 });
      if (wh > 16) {
        wf.draw(ctx, 0, wy, sw, wh); ctx.strokeStyle = C.line; ctx.strokeRect(0.5, wy + 0.5, sw - 1, wh - 1);
      }
      // IQ noktaları
      const cx = narrow ? w / 2 : sw + 14 + cW / 2, cy = narrow ? H - 72 : y0 + Math.min(cW, sh) / 2 + 4, R = narrow ? 62 : Math.min(cW, sh) / 2 - 12;
      // büyütme: noktalar küçükse yakınlaş (ADC sınırı yine gerçek ölçekte çizilir)
      let pk = 0; for (let i = 0; i < 2 * NFFT; i++) pk = Math.max(pk, Math.abs(y[i]));
      zoom += (clamp(0.75 / Math.max(pk, 1e-3), 1, 4) - zoom) * 0.08;
      const S = R * zoom;
      ctx.save();
      ctx.fillStyle = rgba(C.bg, 0.6); ctx.fillRect(cx - R - 10, cy - R - 10, 2 * R + 20, 2 * R + 20);
      ctx.beginPath(); ctx.rect(cx - R - 10, cy - R - 10, 2 * R + 20, 2 * R + 20); ctx.clip();
      V.iqPlane(ctx, cx, cy, R, { circle: false, labels: false });
      // ADC sınırı (kare): ±1
      ctx.strokeStyle = rgba(C.needle, 0.7); ctx.setLineDash([3, 3]); ctx.strokeRect(cx - S, cy - S, 2 * S, 2 * S); ctx.setLineDash([]);
      ctx.fillStyle = rgba(C.ink, 0.55);
      for (let i = 0; i < NFFT; i += 2) ctx.fillRect(cx + y[2 * i] * S - 1, cy - y[2 * i + 1] * S - 1, 2, 2);
      ctx.restore();
      V.text(ctx, "I", cx + R + 2, cy - 4, { color: C.I, size: 14, font: FONT.display, weight: 800 });
      V.text(ctx, "Q", cx + 5, cy - R + 4, { color: C.Q, size: 14, font: FONT.display, weight: 800 });
      V.text(ctx, "IQ noktaları" + (zoom > 1.15 ? ` (×${num(zoom, 1)} büyütülmüş)` : ""), cx, cy + R + 24, { align: "center", size: 10.5, color: C.muted });
      V.text(ctx, "kesik kare: ADC sınırı", cx, cy + R + 38, { align: "center", size: 10.5, color: rgba(C.needle, 0.9) });
      // zaman izi: I ve Q, kırpılınca düzleşen tepeler
      if (!narrow) {
        const ty = cy + R + 56, th = Math.min(120, H - ty - 10), tx = sw + 14, tw = cW;
        if (th > 50) {
          V.frame(ctx, tx, ty, tw, th);
          ctx.save(); ctx.beginPath(); ctx.rect(tx, ty, tw, th); ctx.clip();
          const n = 160, sc = (th / 2 - 6) * Math.min(zoom, 1 / Math.max(pk, 0.05)) ;
          const ys = (k) => ty + th / 2 - clamp(k, -1.2, 1.2) * sc;
          ctx.strokeStyle = rgba(C.needle, 0.45); ctx.setLineDash([2, 3]);
          ctx.beginPath(); ctx.moveTo(tx, ys(1)); ctx.lineTo(tx + tw, ys(1)); ctx.moveTo(tx, ys(-1)); ctx.lineTo(tx + tw, ys(-1)); ctx.stroke(); ctx.setLineDash([]);
          for (const [o, col] of [[0, C.I], [1, C.Q]]) {
            ctx.strokeStyle = col; ctx.lineWidth = 1.3; ctx.beginPath();
            for (let i = 0; i < n; i++) { const px = tx + (i / (n - 1)) * tw, py = ys(y[2 * i + o]); i ? ctx.lineTo(px, py) : ctx.moveTo(px, py); }
            ctx.stroke();
          }
          ctx.restore();
          V.text(ctx, "zaman: I ve Q", tx + 6, ty + 14, { size: 10.5, color: C.muted });
        }
      }
    }
    const st = canvas(cv, () => draw());

    // kontroller
    const gr = (...k) => h("div.c5-grp", ...k);
    const tDC = toggle("DC kayması", P.dcOn, (v) => { P.dcOn = v; });
    const sDC = slider({ label: "DC düzeyi", min: 0, max: 0.15, step: 0.005, value: P.dc, fmt: (v) => num(v * 100, 1) + " %", oninput: (v) => { P.dc = v; } });
    const fDC = toggle("DC giderme", P.dcFix, (v) => { P.dcFix = v; });
    const tIQ = toggle("IQ dengesizliği", P.iqOn, (v) => { P.iqOn = v; }, "cq");
    const sG = slider({ label: "Kazanç hatası", min: 0, max: 3, step: 0.1, value: P.gErr, fmt: (v) => num(v, 1) + " dB", cls: "cq", oninput: (v) => { P.gErr = v; } });
    const sP = slider({ label: "Faz hatası", min: 0, max: 20, step: 0.5, value: P.pErr, fmt: (v) => num(v, 1) + "°", cls: "cph", oninput: (v) => { P.pErr = v; } });
    const fIQ = toggle("IQ dengeleme", P.iqFix, (v) => { P.iqFix = v; });
    const tOv = h("span.c5-tag.cr", "Aşırı yükleme");
    const sOv = slider({ label: "RF kazancı", min: 0, max: 30, step: 0.5, value: P.gain, fmt: (v) => "+" + num(v, 1) + " dB", cls: "cr", oninput: (v) => { P.gain = v; P.ovOn = v > 0; } });
    const fOv = h("button.btn", { type: "button" }, "Kazancı düşür");
    fOv.addEventListener("click", () => { P.gain = 0; sOv.set(0); });
    const ro = h("div.readouts");
    ctrl.append(gr(tDC, sDC, fDC), gr(tIQ, sG, sP, fIQ), gr(tOv, sOv, fOv), ro);

    let roT = 1;
    const lp = loop((dt) => {
      feed.tick(dt); process(); draw();
      roT += dt;
      if (roT > 0.2) {
        roT = 0;
        const th = P.iqOn ? irrTheory() : Infinity;
        ro.replaceChildren(
          h("div.readout.cq", h("span.k", "Görüntü bastırma (kuramsal)"), h("span.v", isFinite(th) ? dbs(th, 1) : "∞ (kusursuz)")),
          h("div.readout", h("span.k", "Ölçülen (istasyon / ayna)"), h("span.v", irrMeas > 60 ? "> 60 dB" : dbs(irrMeas, 1))),
          h("div.readout.cr", h("span.k", "DC sivrisi (tabana göre)"), h("span.v", dcMeas < 6 ? "yok" : "+" + dbs(dcMeas))),
          h("div.readout" + (clipFrac > 0.001 ? ".cr" : ""), h("span.k", "Kırpılan örnek"), h("span.v", num(clipFrac * 100, 1) + " %")),
        );
      }
    });
    for (let i = 0; i < 200; i++) { ring.push(band.next(1200)); process(); }
    return { enter() { lp.start(); }, leave() { lp.stop(); } };
  };

  /* ======================================================================
     6. Gerçek donanım
     ====================================================================== */
  // Kaynaklar sunucu notlarında. Aralıklar Hz; bw = en yüksek anlık bant genişliği (Hz).
  const HW = [
    { id: "rtl", name: "RTL-SDR (R820T2)", ranges: [[24e6, 1766e6]], bw: 2.4e6, rate: "2,4 MS/sn", bits: 8, tx: "yok", price: "≈ 30 $", col: "#efe9dc" },
    { id: "v4", name: "RTL-SDR Blog V4", ranges: [[0.5e6, 1766e6]], bw: 2.4e6, rate: "2,4 MS/sn", bits: 8, tx: "yok", price: "≈ 30–40 $", col: "#efe9dc" },
    { id: "hackrf", name: "HackRF One", ranges: [[1e6, 6000e6]], bw: 20e6, rate: "20 MS/sn", bits: 8, tx: "yarı çift yönlü", price: "≈ 300–350 $", col: "#efe9dc" },
    { id: "pluto", name: "ADALM-PLUTO", ranges: [[325e6, 3800e6]], ext: [[70e6, 6000e6]], bw: 20e6, rate: "61,44 MS/sn · 20 MHz", bits: 12, tx: "tam çift yönlü", price: "≈ 150–230 $", col: "#efe9dc" },
    { id: "b210", name: "USRP B210", ranges: [[70e6, 6000e6]], bw: 56e6, rate: "61,44 MS/sn · 56 MHz", bits: 12, tx: "tam çift yönlü, 2×2", price: "≈ 2.400 $", col: "#efe9dc" },
  ];
  const TARGETS = [
    ["hf", "Kısa dalga", 7.0e6, 7.2e6, 0.2e6, "7 MHz, 40 m amatör bandı"],
    ["fm", "FM istasyonu", 87.5e6, 108e6, 0.2e6, "tek FM istasyonu (≈ 200 kHz)"],
    ["fmall", "Tüm FM bandı", 87.5e6, 108e6, 20.5e6, "87,5–108 MHz bir arada"],
    ["adsb", "ADS-B", 1089e6, 1091e6, 2e6, "uçaklar, 1090 MHz"],
    ["gps", "GPS L1", 1574.4e6, 1576.4e6, 2.046e6, "1575,42 MHz"],
    ["wifi2", "Wi-Fi 2,4", 2.401e9, 2.423e9, 20e6, "Wi-Fi kanal 1, 20 MHz"],
    ["wifi5", "Wi-Fi 5", 5.17e9, 5.19e9, 20e6, "Wi-Fi kanal 36, 20 MHz"],
  ];
  // frekans biçimi: 500 kHz, 24 MHz, 1,766 GHz, 6 GHz
  const fF = (f) => f < 1e6 ? num(f / 1e3, 0) + " kHz" : f < 1e9 ? num(f / 1e6, 0) + " MHz" : num(f / 1e9, f % 1e9 ? 3 : 0).replace(/,?0+$/, "") + " GHz";
  Demos.hwCompare = function (stage, slide) {
    const cv = h("canvas", { "aria-label": "Cihazların frekans kapsama şeritleri, logaritmik eksen" });
    const fill = h("div.fill.c5-hwfill", cv);
    const table = h("div.c5-hwtable");
    const ctrl = h("div.controls");
    stage.append(fill, table, ctrl);
    let tgt = "fm", hover = null, anim = 0;
    const F0 = 1e5, F1 = 1e10;
    const lx = (f) => Math.log10(f / F0) / Math.log10(F1 / F0);
    function can(d, t) {
      const [, , a, b, bw] = t;
      const inR = d.ranges.some(([lo, hi]) => a >= lo && b <= hi);
      const inExt = !inR && d.ext && d.ext.some(([lo, hi]) => a >= lo && b <= hi);
      if (!inR && !inExt) return { ok: false, why: "frekans aralığı dışında" };
      if (bw > d.bw) return { ok: false, why: `bant yetmez (${num(d.bw / 1e6, 1)} MHz < ${num(bw / 1e6, 1)} MHz)` };
      return { ok: true, why: inExt ? "yazılım değişikliğiyle (resmî değil)" : "alabilir" };
    }
    // tablo
    const rows = HW.map((d) => {
      const tr = h("tr", h("th", d.name), h("td", d.ranges.map(([a, b]) => fF(a) + "–" + fF(b)).join(", "), d.ext ? h("small", " (yazılımla 70 MHz–6 GHz)") : null),
        h("td", d.rate), h("td", d.bits + " bit · ≈ " + num(6.02 * d.bits + 1.76, 0) + " dB"), h("td", d.tx), h("td", d.price));
      return tr;
    });
    table.append(h("table", h("thead", h("tr", h("th", "Cihaz"), h("th", "Frekans"), h("th", "En yüksek hız"), h("th", "ADC · dinamik aralık*"), h("th", "Gönderme"), h("th", "Fiyat"))), h("tbody", ...rows)),
      h("p.note-small", "* İdeal ADC: 6,02 × bit + 1,76 dB. Gerçek cihazlarda biraz daha az. Fiyatlar 2026 itibarıyla yaklaşık."));

    const tSeg = seg(TARGETS.map(([k, n]) => [k, n]), tgt, (k) => { tgt = k; anim = 0; update(); }, "Hedef sinyal");
    tSeg.classList.add("c5-wrap");
    ctrl.append(h("span.c5-lab.c5-q", "Ne almak istiyorsunuz?"), tSeg);
    function update() {
      const t = TARGETS.find((x) => x[0] === tgt);
      HW.forEach((d, i) => { const r = can(d, t); rows[i].classList.toggle("c5-ok", r.ok); rows[i].classList.toggle("c5-no", !r.ok); });
    }
    function draw() {
      const { ctx, w, h: H } = st;
      if (!w) return;
      ctx.clearRect(0, 0, w, H);
      const narrow = w < 640;
      const labW = narrow ? 0 : 150, x0 = labW + 10, aw = w - x0 - 14;
      const X = (f) => x0 + lx(f) * aw;
      const top = 34, rowH = narrow ? 52 : Math.min(46, (H - top - 120) / HW.length), rh = narrow ? 14 : Math.min(20, rowH * 0.5);
      // eksen
      const decs = [1e5, 1e6, 1e7, 1e8, 1e9, 1e10];
      decs.forEach((f) => {
        ctx.strokeStyle = rgba(C.line, 1); ctx.beginPath(); ctx.moveTo(X(f) + 0.5, top - 6); ctx.lineTo(X(f) + 0.5, top + HW.length * rowH); ctx.stroke();
        V.text(ctx, L.hz(f, 0), X(f), top - 12, { align: f === 1e5 ? "left" : f === 1e10 ? "right" : "center", size: 13, color: C.ink2, font: FONT.display, weight: 700 });
        for (let k = 2; k < 10 && f < 1e10; k++) { ctx.strokeStyle = rgba(C.line, 0.45); ctx.beginPath(); ctx.moveTo(X(f * k) + 0.5, top); ctx.lineTo(X(f * k) + 0.5, top + HW.length * rowH); ctx.stroke(); }
      });
      const t = TARGETS.find((x) => x[0] === tgt);
      // şeritler
      HW.forEach((d, i) => {
        const y = top + i * rowH + (rowH - rh) / 2, r = can(d, t);
        const col = r.ok ? C.ink : rgba(C.ink, 0.28);
        if (d.ext) d.ext.forEach(([a, b]) => {
          ctx.save(); ctx.strokeStyle = rgba(C.ink, r.ok ? 0.5 : 0.22); ctx.setLineDash([4, 3]); ctx.strokeRect(X(a), y + 0.5, X(b) - X(a), rh - 1); ctx.restore();
        });
        d.ranges.forEach(([a, b]) => {
          const g = ctx.createLinearGradient(0, y, 0, y + rh);
          g.addColorStop(0, r.ok ? "#f5efe2" : "rgba(239,233,220,0.3)"); g.addColorStop(1, r.ok ? "#c9c2b4" : "rgba(239,233,220,0.18)");
          ctx.fillStyle = g; ctx.beginPath(); ctx.roundRect(X(a), y, X(b) - X(a), rh, 4); ctx.fill();
        });
        // anlık bant genişliği: hedefin üzerinde küçük bir kutu
        const name = narrow ? d.name : d.name;
        if (narrow) {
          V.text(ctx, name, x0, y - 5, { size: 12, color: r.ok ? C.ink : C.muted, weight: 700 });
          V.text(ctx, r.ok ? "✓ " + r.why : "✕ " + r.why, w - 8, y + rh + 13, { size: 10.5, color: r.ok ? C.phase : C.muted, weight: 700, align: "right" });
        } else {
          V.text(ctx, name, labW, y + rh - 5, { size: 13, color: r.ok ? C.ink : C.muted, weight: 700, align: "right" });
          V.text(ctx, r.ok ? "✓ " + r.why : "✕ " + r.why, Math.min(X(t[2]) + 10, w - 8), y + rh + 13, { size: 10.5, color: r.ok ? C.phase : C.muted, weight: 700, align: X(t[2]) + 200 > w ? "right" : "left" });
        }
      });
      // hedef ibresi
      const fx = Math.sqrt(t[2] * t[3]);
      V.needle(ctx, X(fx), top - 4, HW.length * rowH + 8, "");
      V.text(ctx, t[5], X(fx) + (X(fx) > w - 200 ? -8 : 8), top + HW.length * rowH + 18, { size: 13, color: C.needle, weight: 800, align: X(fx) > w - 200 ? "right" : "left", font: FONT.display });
      // bit derinliği → dinamik aralık
      const by = top + HW.length * rowH + 36, bh = H - by - 8;
      if (bh > 50) {
        title(ctx, "Bit derinliği ve dinamik aralık (≈ 6 dB / bit)", x0, by + 4, C.ink);
        const bars = [[8, "8 bit: RTL-SDR, HackRF"], [12, "12 bit: PlutoSDR, B210"], [14, "14 bit: üst sınıf"], [16, "16 bit"]];
        const bw2 = narrow ? aw - 70 : aw * 0.62, scale = (v) => (v / 100) * bw2;
        bars.forEach(([b, lab], i) => {
          const yy = by + 14 + i * Math.min(22, (bh - 20) / 4), dr = 6.02 * b + 1.76;
          ctx.fillStyle = rgba(C.ink, 0.08); ctx.fillRect(x0, yy, bw2, 12);
          const g = ctx.createLinearGradient(x0, 0, x0 + scale(dr), 0);
          L.CMAP_STOPS.slice(2).forEach(([s, c]) => g.addColorStop((s - 0.36) / 0.64, c));
          ctx.fillStyle = g; ctx.fillRect(x0, yy, Math.min(bw2, scale(dr)), 12);
          const ex = x0 + Math.min(bw2, scale(dr));
          V.text(ctx, "≈ " + num(dr, 0) + " dB", ex + 8, yy + 10.5, { size: 12, color: C.ink, weight: 800 });
          if (!narrow) V.text(ctx, lab, ex + 70, yy + 10.5, { size: 11, color: C.ink2 });
        });

      }
    }
    const st = canvas(cv, () => draw());
    update();
    const lp = loop(() => draw());
    return { enter() { lp.start(); }, leave() { lp.stop(); } };
  };

  // ---------- hayalet el senaryoları ----------
  window.GUIDE_SCENARIOS = Object.assign(window.GUIDE_SCENARIOS || {}, {
    "blok-diyagram": [{ click: "Karıştırıcı" }, { wait: 1200 }, { click: "ADC" }, { wait: 900 }, { slide: "label:LO frekansı", to: 96 }],
    karistirma: [{ drag: "aria:Ayar düğmesi", path: [[0.5, 0.18], [0.61, 0.2], [0.71, 0.26], [0.78, 0.36], [0.82, 0.47], [0.82, 0.5]] }, { wait: 700 }, { click: "Dinle" }],
    filtre: [{ click: "Dinle" }, { slide: "label:Kesim frekansı", to: Math.log(30000) }, { wait: 1500 }, { slide: "label:Kesim frekansı", to: Math.log(4000) }],
    "bant-geciren": [{ drag: "aria:Giriş spektrumu: pencereyi sürükleyin", path: [[0.333, 0.55], [0.45, 0.55], [0.542, 0.55]] }, { wait: 600 }, { click: "=Karmaşık" }, { wait: 900 }, { click: "=Bant durduran" }],
    kusurlar: [{ slide: "label:Faz hatası", to: 16 }, { wait: 700 }, { click: "IQ dengeleme" }, { wait: 900 }, { slide: "label:RF kazancı", to: 12 }],
    donanim: [{ click: "=Tüm FM bandı" }, { wait: 1000 }, { click: "=Wi-Fi 5" }],
  });
  window.GUIDE_TARGETS = Object.assign(window.GUIDE_TARGETS || {}, {
    karistirma: "aria:Ayar düğmesi",
  });
})();

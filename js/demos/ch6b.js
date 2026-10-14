/* Bölüm 6 (devam): takımyıldız ve gürültü, dönen takımyıldız, mesaj gönderme, sembol hızı.
   Renk dili: I gök mavisi, Q kehribar, alınan nokta fildişi, faz/döngü nane, gürültü kırçıl gri,
   hatalı karar kırmızı halka. Ekrandaki her BER gerçekten sayılır (DSP.mapBits → awgn → demapSymbols). */
(function () {
  const { C, FONT, rgba, h, canvas, loop, clamp, slider, seg, toggle, num } = L;
  const TAU = Math.PI * 2;
  const SCHEMES = [["bpsk", "BPSK"], ["qpsk", "QPSK"], ["psk8", "8-PSK"], ["qam16", "16-QAM"]];
  const NAME = Object.fromEntries(SCHEMES);
  // dönme simetrisi: takımyıldız kaç farklı açıda kendisiyle çakışır
  const FOLD = { bpsk: 2, qpsk: 4, psk8: 8, qam16: 4 };

  /* ---------- küçük yardımcılar ---------- */
  const SUP = { "-": "⁻", 0: "⁰", 1: "¹", 2: "²", 3: "³", 4: "⁴", 5: "⁵", 6: "⁶", 7: "⁷", 8: "⁸", 9: "⁹" };
  const sup = (n) => String(n).split("").map((c) => SUP[c]).join("");
  // bilimsel gösterim: 2,3·10⁻⁴
  function sci(v, d = 1) {
    if (!(v > 0)) return "0";
    if (v >= 0.01) return num(v, v >= 0.1 ? 2 : 3);
    let e = Math.floor(Math.log10(v)), m = v / 10 ** e;
    if (+m.toFixed(d) >= 10) { m = 1; e++; }
    return num(m, d) + "·10" + sup(e);
  }
  const db = (v, d = 1) => num(v, d) + " dB";
  function readout(k, cls) {
    const v = h("span.v", "–");
    const el = h("div.readout" + (cls ? "." + cls : ""), h("span.k", k), v);
    return { el, v, set(s) { if (v.textContent !== s) v.textContent = s; } };
  }
  const bitsOf = (v, k) => v.toString(2).padStart(k, "0");
  function popcount(x) { let c = 0; while (x) { c += x & 1; x >>= 1; } return c; }
  // en yakın takımyıldız noktası
  function decide(pts, I, Q) {
    let b = 0, bd = Infinity;
    for (let v = 0; v < pts.length; v++) { const d = (I - pts[v][0]) ** 2 + (Q - pts[v][1]) ** 2; if (d < bd) { bd = d; b = v; } }
    return b;
  }
  const sigmaOf = (snrDb) => Math.sqrt(1 / (2 * 10 ** (snrDb / 10))); // boyut başına gürültü (Es = 1)
  const wrap = (a) => { a = (a + Math.PI) % TAU; if (a < 0) a += TAU; return a - Math.PI; };

  /* ---------- I/Q düzlemi çizimleri ---------- */
  // karar sınırları: ince çizgiler, düzlem karesine kırpılır
  function boundaries(ctx, scheme, cx, cy, R, k) {
    ctx.save();
    ctx.beginPath(); ctx.rect(cx - R, cy - R, 2 * R, 2 * R); ctx.clip();
    ctx.strokeStyle = rgba(C.ink, 0.3); ctx.lineWidth = 1; ctx.setLineDash([5, 4]);
    ctx.beginPath();
    if (scheme === "bpsk") { ctx.moveTo(cx, cy - R); ctx.lineTo(cx, cy + R); }
    else if (scheme === "qpsk") { ctx.moveTo(cx, cy - R); ctx.lineTo(cx, cy + R); ctx.moveTo(cx - R, cy); ctx.lineTo(cx + R, cy); }
    else if (scheme === "psk8") {
      for (let j = 0; j < 8; j++) { const a = ((j + 0.5) * TAU) / 8; ctx.moveTo(cx, cy); ctx.lineTo(cx + Math.cos(a) * R * 1.5, cy - Math.sin(a) * R * 1.5); }
    } else {
      for (const v of [-2, 0, 2]) { const d = (v / Math.sqrt(10)) * k; ctx.moveTo(cx + d, cy - R); ctx.lineTo(cx + d, cy + R); ctx.moveTo(cx - R, cy - d); ctx.lineTo(cx + R, cy - d); }
    }
    ctx.stroke();
    ctx.restore();
  }
  // ideal noktalar ve Gray kodlu bit etiketleri
  function idealPoints(ctx, scheme, cx, cy, k, labels = true) {
    const { pts, bits } = DSP.CONST[scheme];
    pts.forEach(([I, Q], v) => {
      const x = cx + I * k, y = cy - Q * k;
      ctx.strokeStyle = rgba(C.bg, 0.9); ctx.lineWidth = 4;
      ctx.beginPath(); ctx.arc(x, y, 5.5, 0, TAU); ctx.stroke();
      ctx.strokeStyle = C.ink; ctx.lineWidth = 1.6;
      ctx.beginPath(); ctx.arc(x, y, 5.5, 0, TAU); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(x - 2.5, y); ctx.lineTo(x + 2.5, y); ctx.moveTo(x, y - 2.5); ctx.lineTo(x, y + 2.5); ctx.stroke();
      if (!labels) return;
      const a = Math.atan2(Q, I), r = Math.hypot(I, Q) * k;
      let lx, ly;
      if (scheme === "qam16") { lx = x; ly = y + 18; }
      else { lx = cx + Math.cos(a) * (r + 22); ly = cy - Math.sin(a) * (r + 22) + 4; }
      ctx.save();
      ctx.font = `700 11px ${FONT.body}`;
      const s = bitsOf(v, bits), tw = ctx.measureText(s).width;
      ctx.fillStyle = rgba(C.bg, 0.72); ctx.fillRect(lx - tw / 2 - 3, ly - 10, tw + 6, 14);
      ctx.restore();
      V.text(ctx, s, lx, ly, { color: C.ink2, size: 11, align: "center", weight: 700 });
    });
  }
  // gürültü bulutu: her ideal noktanın çevresinde 2σ yarıçaplı kırçıl gri hale
  function noiseHalos(ctx, scheme, cx, cy, k, sigma) {
    const r = Math.max(4, 2.2 * sigma * k);
    ctx.save();
    DSP.CONST[scheme].pts.forEach(([I, Q]) => {
      const x = cx + I * k, y = cy - Q * k;
      const g = ctx.createRadialGradient(x, y, 0, x, y, r);
      g.addColorStop(0, rgba(C.noise, 0.32)); g.addColorStop(0.55, rgba(C.noise, 0.14)); g.addColorStop(1, rgba(C.noise, 0));
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.fill();
    });
    ctx.restore();
  }
  // soluklaşan nokta halkası (ring buffer)
  class Trail {
    constructor(n) { this.n = n; this.I = new Float32Array(n); this.Q = new Float32Array(n); this.t = new Float64Array(n).fill(-1e9); this.err = new Uint8Array(n); this.i = 0; }
    push(I, Q, t, err) { const j = this.i; this.I[j] = I; this.Q[j] = Q; this.t[j] = t; this.err[j] = err ? 1 : 0; this.i = (j + 1) % this.n; }
    clear() { this.t.fill(-1e9); }
    draw(ctx, cx, cy, k, now, life, R) {
      ctx.save();
      ctx.beginPath(); ctx.rect(cx - R, cy - R, 2 * R, 2 * R); ctx.clip();
      ctx.globalCompositeOperation = "lighter";
      ctx.fillStyle = C.ink;
      for (let j = 0; j < this.n; j++) {
        const age = now - this.t[j]; if (age > life) continue;
        const a = 1 - age / life;
        ctx.globalAlpha = 0.12 + 0.7 * a * a;
        const s = 1.8 + 1.6 * a;
        ctx.fillRect(cx + this.I[j] * k - s / 2, cy - this.Q[j] * k - s / 2, s, s);
      }
      ctx.globalCompositeOperation = "source-over";
      ctx.strokeStyle = C.needle; ctx.lineWidth = 1.5;
      for (let j = 0; j < this.n; j++) {
        if (!this.err[j]) continue;
        const age = now - this.t[j]; if (age > life) continue;
        ctx.globalAlpha = 0.25 + 0.75 * (1 - age / life);
        ctx.beginPath(); ctx.arc(cx + this.I[j] * k, cy - this.Q[j] * k, 5.5, 0, TAU); ctx.stroke();
      }
      ctx.restore();
    }
  }
  // düzlem yerleşimi: kare, ortada, eksen etiketlerine pay bırakır
  function planeBox(w, hh, view) {
    const S = Math.min(w, hh);
    const R = Math.max(40, S / 2 - 30);
    return { cx: w / 2, cy: hh / 2 + 4, R, k: R / view };
  }

  /* ---------- ses: takımyıldızı bir ses taşıyıcısına bindiren "modem" ---------- */
  // Yükseltilmiş kosinüs kökü darbesi (sürekli zaman, t sembol süresi cinsinden); DSP.rrc ile aynı ifade
  function rrcAt(t, b) {
    if (Math.abs(t) < 1e-9) return 1 - b + (4 * b) / Math.PI;
    if (b && Math.abs(Math.abs(4 * b * t) - 1) < 1e-6)
      return (b / Math.SQRT2) * ((1 + 2 / Math.PI) * Math.sin(Math.PI / (4 * b)) + (1 - 2 / Math.PI) * Math.cos(Math.PI / (4 * b)));
    return (Math.sin(Math.PI * t * (1 - b)) + 4 * b * t * Math.cos(Math.PI * t * (1 + b))) / (Math.PI * t * (1 - (4 * b * t) ** 2));
  }
  const SPAN = 4, TABRES = 64;
  const tabs = {};
  function rrcTable(b) {
    const key = b.toFixed(2);
    if (!tabs[key]) { const n = 2 * SPAN * TABRES + 1, t = new Float32Array(n); for (let i = 0; i < n; i++) t[i] = rrcAt(i / TABRES - SPAN, +key); tabs[key] = t; }
    return tabs[key];
  }
  /* get(): {scheme, baud, beta, fc, snr}. Gürültü sembol anlarına eklenir, böylece darbe süzgecinden geçip
     taşıyıcının çevresinde sinyalle aynı bantta duyulur (Es/N0 sesle de aynıdır). */
  function modemAudio(get) {
    const r = DSP.rng(17);
    let t = 0, nextT = 0, ph = 0;
    const syms = [];
    return function fill(out, rate) {
      const p = get(), T = 1 / p.baud, tab = rrcTable(p.beta), pts = DSP.CONST[p.scheme].pts;
      const sg = p.snr == null ? 0 : sigmaOf(p.snr);
      for (let i = 0; i < out.length; i++) {
        while (nextT < t + SPAN * T) {
          const v = pts[Math.floor(r() * pts.length)];
          syms.push({ t: nextT, T, I: v[0] + sg * DSP.gaussian(r), Q: v[1] + sg * DSP.gaussian(r) });
          nextT += T;
        }
        while (syms.length && syms[0].t < t - SPAN * syms[0].T) syms.shift();
        let I = 0, Q = 0;
        for (let j = 0; j < syms.length; j++) {
          const s = syms[j], x = (t - s.t) / s.T;
          if (x <= -SPAN || x >= SPAN) continue;
          const g = tab[Math.round((x + SPAN) * TABRES)];
          I += s.I * g; Q += s.Q * g;
        }
        ph += (TAU * p.fc) / rate; if (ph > TAU) ph -= TAU;
        const v = 0.3 * (I * Math.cos(ph) - Q * Math.sin(ph));
        out[i] = v / (1 + Math.abs(v)); // yumuşak sınırlama
        t += 1 / rate;
      }
    };
  }

  /* =====================================================================
     1) Takımyıldız ve gürültü: canlı BER ölçümü
     ===================================================================== */
  Demos.constellation = function (stage, slide) {
    let scheme = "qpsk", snr = 10;
    const VIEW = 1.6;
    const cv = h("canvas", { "aria-label": "Takımyıldız diyagramı: gürültülü semboller I/Q düzleminde birikir" });
    const cvB = h("canvas", { "aria-label": "Bit hata oranının SNR'a göre eğrisi" });
    const fill = h("div.fill", cv);
    const rMeas = readout("Ölçülen BER"), rTheo = readout("Kuramsal BER");
    const rCount = readout("Sayılan"), rEb = readout("Eb/N0 (bit başına)");
    rMeas.el.classList.add("big"); rTheo.el.classList.add("big");
    const side = h("div.c6-side",
      h("div.readouts.c6-ber", rMeas.el, rTheo.el),
      h("div.readouts", rCount.el, rEb.el),
      h("div.plot", cvB));
    const body = h("div.c6-body", fill, side);
    const segM = seg(SCHEMES, scheme, (k) => { scheme = k; trail.clear(); upd(); }, "Modülasyon");
    const slSnr = slider({ label: "SNR (Es/N0)", min: -2, max: 22, step: 0.5, value: snr, fmt: (v) => db(v), cls: "cn", oninput: (v) => { snr = v; upd(); } });
    let stream = null;
    const tgSound = toggle("Dinle", false, (on) => {
      if (on) stream = Sound.stream(slide, modemAudio(() => ({ scheme, baud: 120, beta: 0.5, fc: 1500, snr })), { gain: 0.9 });
      else if (stream) { stream.stop(); stream = null; }
    });
    stage.append(body, h("div.controls", segM, slSnr, h("span.spacer"), tgSound));

    // ölçüm kayıtları: rec[şema][snr] = {e: hata, b: bit}
    const rec = {};
    const cell = () => { const m = (rec[scheme] = rec[scheme] || {}), key = snr.toFixed(1); return (m[key] = m[key] || { e: 0, b: 0 }); };
    const r = DSP.rng(2026);
    const trail = new Trail(1200);
    const BITS_PER_FRAME = 6000, SHOW_RATE = 200, LIFE = 5;
    let showAcc = 0, now = 0, frame = 0;

    function simulate(dt) {
      const k = DSP.CONST[scheme].bits, n = Math.ceil(BITS_PER_FRAME / k);
      const bits = new Uint8Array(n * k);
      for (let i = 0; i < bits.length; i++) bits[i] = r() < 0.5 ? 1 : 0;
      const tx = DSP.mapBits(bits, scheme);
      const rx = DSP.awgn(tx, snr, r, 1); // takımyıldızların ortalama sembol enerjisi 1
      const dec = DSP.demapSymbols(rx, scheme);
      let e = 0;
      for (let i = 0; i < bits.length; i++) e += bits[i] !== dec[i];
      const c = cell();
      if (c.b < 2e9) { c.e += e; c.b += bits.length; }
      // ekranda: saniyede SHOW_RATE sembol akar
      showAcc += dt * SHOW_RATE;
      const m = Math.min(n, Math.floor(showAcc));
      showAcc -= m;
      for (let s = 0; s < m; s++) trail.push(rx[2 * s], rx[2 * s + 1], now - (dt * (m - s)) / m, tx.idx[s] !== dec.idx[s]);
    }

    function upd() {
      const c = cell(), th = DSP.berTheory(scheme, snr);
      rMeas.set(c.b ? (c.e ? sci(c.e / c.b, 2) : "< " + sci(1 / c.b, 0)) : "–");
      rTheo.set(sci(th, 2));
      rCount.set(`${num(c.e)} hata / ${num(c.b)} bit`);
      rEb.set(db(snr - 10 * Math.log10(DSP.CONST[scheme].bits)));
    }

    function draw() {
      const { ctx, w, h: H } = st;
      ctx.clearRect(0, 0, w, H);
      if (w < 60 || H < 60) return;
      const { cx, cy, R, k } = planeBox(w, H, VIEW);
      V.iqPlane(ctx, cx, cy, R, { circle: true, scale: VIEW });
      noiseHalos(ctx, scheme, cx, cy, k, sigmaOf(snr));
      boundaries(ctx, scheme, cx, cy, R, k);
      trail.draw(ctx, cx, cy, k, now, LIFE, R);
      idealPoints(ctx, scheme, cx, cy, k, R > 110);
      // açıklama
      const ly = H - 12;
      ctx.fillStyle = C.ink; ctx.fillRect(12, ly - 6, 4, 4);
      V.text(ctx, "alınan sembol", 22, ly, { size: 11, color: C.ink2 });
      ctx.strokeStyle = C.needle; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(114, ly - 4, 4.5, 0, TAU); ctx.stroke();
      V.text(ctx, "hatalı karar", 123, ly, { size: 11, color: C.ink2 });
      if (w > 330) {
        ctx.fillStyle = rgba(C.noise, 0.6); ctx.beginPath(); ctx.arc(208, ly - 4, 5, 0, TAU); ctx.fill();
        V.text(ctx, "gürültü (2σ)", 218, ly, { size: 11, color: C.ink2 });
      }
      V.text(ctx, NAME[scheme], 14, 22, { size: 18, color: C.ink, font: FONT.display, weight: 800 });
    }
    const st = canvas(cv, draw);

    // BER–SNR eğrisi (log ölçek)
    const X0 = -2, X1 = 22, Y0 = -6, Y1 = 0;
    function drawCurve() {
      const { ctx, w, h: H } = stB;
      ctx.clearRect(0, 0, w, H);
      const L0 = 40, R0 = 8, T0 = 10, B0 = 26, pw = w - L0 - R0, ph = H - T0 - B0;
      if (pw < 40 || ph < 40) return;
      const X = (v) => L0 + ((v - X0) / (X1 - X0)) * pw;
      const Y = (p) => T0 + ((Y1 - Math.log10(Math.max(p, 1e-12))) / (Y1 - Y0)) * ph;
      ctx.strokeStyle = rgba(C.line, 0.9); ctx.lineWidth = 1; ctx.beginPath();
      for (let e = Y0; e <= Y1; e++) { const y = Math.round(Y(10 ** e)) + 0.5; ctx.moveTo(L0, y); ctx.lineTo(L0 + pw, y); }
      for (let x = 0; x <= 20; x += 4) { const px = Math.round(X(x)) + 0.5; ctx.moveTo(px, T0); ctx.lineTo(px, T0 + ph); }
      ctx.stroke();
      for (let e = Y0; e <= Y1; e += 1) V.text(ctx, e ? "10" + sup(e) : "1", L0 - 5, Y(10 ** e) + 4, { size: 10.5, color: C.muted, align: "right" });
      for (let x = 0; x <= 12; x += 4) V.text(ctx, String(x), X(x), T0 + ph + 15, { size: 10.5, color: C.muted, align: "center" });
      V.text(ctx, "Es/N0 (dB)", L0 + pw, T0 + ph + 15, { size: 10.5, color: C.ink2, align: "right" });
      ctx.save(); ctx.beginPath(); ctx.rect(L0, T0, pw, ph); ctx.clip();
      // kuramsal eğriler: seçili olan parlak
      for (const [s] of SCHEMES) {
        const cur = s === scheme;
        ctx.strokeStyle = cur ? C.ink : rgba(C.ink2, 0.28); ctx.lineWidth = cur ? 1.8 : 1;
        ctx.beginPath();
        for (let px = 0; px <= pw; px += 2) { const v = X0 + (px / pw) * (X1 - X0), y = Y(DSP.berTheory(s, v)); px ? ctx.lineTo(L0 + px, y) : ctx.moveTo(L0 + px, y); }
        ctx.stroke();
      }
      ctx.restore();
      // seçili eğrinin adı (10⁻⁵ hizasında)
      {
        let a = X0, b = X1 + 10;
        for (let i = 0; i < 40; i++) { const m = (a + b) / 2; DSP.berTheory(scheme, m) > 1e-5 ? (a = m) : (b = m); }
        const lab = NAME[scheme], right = X(a) + 60 > L0 + pw;
        V.text(ctx, lab, X(a) + (right ? -6 : 6), Y(1e-5) + 4, { size: 11, color: C.ink, weight: 700, align: right ? "right" : "left" });
      }
      // ölçülen noktalar
      const m = rec[scheme] || {};
      for (const key in m) {
        const c = m[key], x = X(+key);
        if (!c.b) continue;
        if (c.e) {
          const y = Y(c.e / c.b);
          ctx.fillStyle = C.ink; ctx.strokeStyle = C.bg; ctx.lineWidth = 2;
          ctx.beginPath(); ctx.arc(x, y, c.e >= 20 ? 4 : 3, 0, TAU); ctx.stroke(); ctx.fill();
        } else {
          const y = Y(1 / c.b);
          ctx.strokeStyle = C.ink2; ctx.lineWidth = 1.3;
          ctx.beginPath(); ctx.moveTo(x - 4, y - 3); ctx.lineTo(x + 4, y - 3); ctx.lineTo(x, y + 3); ctx.closePath(); ctx.stroke();
        }
      }
      V.needle(ctx, X(snr), T0, ph);
      // açıklama
      ctx.strokeStyle = C.ink; ctx.lineWidth = 1.8; ctx.beginPath(); ctx.moveTo(L0 + pw - 118, T0 + 12); ctx.lineTo(L0 + pw - 100, T0 + 12); ctx.stroke();
      V.text(ctx, "kuram", L0 + pw - 95, T0 + 16, { size: 10.5, color: C.ink2 });
      ctx.fillStyle = C.ink; ctx.beginPath(); ctx.arc(L0 + pw - 46, T0 + 12, 3.5, 0, TAU); ctx.fill();
      V.text(ctx, "ölçülen", L0 + pw - 39, T0 + 16, { size: 10.5, color: C.ink2 });
    }
    const stB = canvas(cvB, drawCurve);

    const lp = loop((dt) => {
      now += dt; frame++;
      simulate(dt);
      draw();
      if (frame % 6 === 0) { upd(); drawCurve(); }
    });
    // açılışta düzlem boş görünmesin
    for (let i = 0; i < 120; i++) { now += 1 / 60; simulate(1 / 60); }
    upd();

    // doğrulama betikleri için
    slide.__c6 = { get scheme() { return scheme; }, get snr() { return snr; }, cell, rec };
    return {
      enter() { lp.start(); },
      leave() { lp.stop(); if (stream) { stream.stop(); stream = null; tgSound.set(false); } },
    };
  };

  /* =====================================================================
     2) Dönen takımyıldız: faz kayması, frekans hatası ve karar yönlendirmeli faz kilitli döngü
     ===================================================================== */
  Demos.rotation = function (stage, slide) {
    let scheme = "qpsk", phase0 = 0, dfHz = 0, snr = 18, lockOn = false;
    const RS = 200;            // sembol hızı (Bd): gözle izlenebilsin diye yavaş
    const BNT = 0.04, ZETA = 0.707;
    const th = BNT / (ZETA + 1 / (4 * ZETA)), dn = 1 + 2 * ZETA * th + th * th;
    const KP = (4 * ZETA * th) / dn, KI = (4 * th * th) / dn;
    const PILOT = 16;          // her 16. sembol alıcının bildiği bir öncü sembol
    const VIEW = 1.6;

    const cv = h("canvas", { "aria-label": "Dönen takımyıldız: faz ve frekans hatası" });
    const cvE = h("canvas", { "aria-label": "Faz hatası grafiği" });
    const rState = readout("Döngü"), rFreq = readout("Döngünün bulduğu frekans", "cph");
    const rErr = readout("Ortalama faz hatası", "cph"), rBer = readout("BER (son 4 sn)");
    const rAmb = readout("Öncü sembollerle düzeltilen");
    const side = h("div.c6-side",
      h("div.readouts", rState.el, rBer.el),
      h("div.readouts", rFreq.el, rErr.el),
      h("div.c6-cap", "Faz hatası (her sembolde ölçülen)"),
      h("div.plot", cvE),
      h("div.readouts", rAmb.el));
    const body = h("div.c6-body", h("div.fill", cv), side);
    const segM = seg(SCHEMES, scheme, (k) => { scheme = k; resetWin(); }, "Modülasyon");
    const slPh = slider({ label: "Faz kayması", min: -180, max: 180, step: 1, value: 0, cls: "cph", fmt: (v) => num(v) + "°", oninput: (v) => { phase0 = (v * Math.PI) / 180; } });
    const slDf = slider({ label: "Frekans hatası", min: -3, max: 3, step: 0.05, value: 0, cls: "cph", fmt: (v) => num(v, 2) + " Hz", oninput: (v) => { dfHz = v; resetWin(); } });
    const slSnr = slider({ label: "SNR (Es/N0)", min: 4, max: 30, step: 0.5, value: snr, cls: "cn", fmt: (v) => db(v), oninput: (v) => { snr = v; } });
    const tgLock = toggle("Dönmeyi düzelt", false, (on) => { lockOn = on; loopPh = 0; loopFr = 0; amb = []; resetWin(); });
    tgLock.classList.add("cph");
    let stream = null;
    const tgSound = toggle("Dinle", false, (on) => {
      if (on) stream = Sound.stream(slide, beatFill, { gain: 0.8 });
      else if (stream) { stream.stop(); stream = null; }
    });
    stage.append(body, h("div.controls", segM, slPh, slDf, slSnr, tgLock, h("span.spacer"), tgSound));

    const r = DSP.rng(77);
    const trail = new Trail(600);
    const LIFE = 2.6;
    let rot = 0, loopPh = 0, loopFr = 0, symAcc = 0, now = 0, n = 0, frame = 0;
    let amb = [], ambM = 0;
    const EW = 600, errHist = new Float32Array(EW); let ePos = 0, eCount = 0;
    const BW = 4 * RS, berErr = new Uint8Array(BW), berBits = new Uint8Array(BW); let bPos = 0, bFill = 0;
    function resetWin() { bFill = 0; bPos = 0; berErr.fill(0); berBits.fill(0); }

    function step() {
      const { pts, bits: kb } = DSP.CONST[scheme], F = FOLD[scheme], M = pts.length;
      const v = Math.floor(r() * M), [I0, Q0] = pts[v];
      rot += (TAU * dfHz) / RS;
      if (rot > 1e4) rot -= TAU * 1000;
      const a = rot + phase0, c = Math.cos(a), s = Math.sin(a), sg = sigmaOf(snr);
      const rI = I0 * c - Q0 * s + sg * DSP.gaussian(r), rQ = I0 * s + Q0 * c + sg * DSP.gaussian(r);
      // döngü: alınan noktayı kendi tahmini kadar geri çevir
      const cc = Math.cos(-loopPh), ss = Math.sin(-loopPh);
      const yI = rI * cc - rQ * ss, yQ = rI * ss + rQ * cc;
      const d = decide(pts, yI, yQ), [dI, dQ] = pts[d];
      const e = Math.atan2(yQ * dI - yI * dQ, yI * dI + yQ * dQ); // karar yönlendirmeli faz dedektörü
      if (lockOn) { loopFr += KI * e; loopPh += loopFr + KP * e; if (loopPh > 1e4) loopPh -= TAU * 1000; }
      // öncü sembol: dönme belirsizliğini (ör. QPSK'da 90°'nin katları) çöz
      if (lockOn && n % PILOT === 0) {
        const q = ((Math.round(Math.atan2(yQ * I0 - yI * Q0, yI * I0 + yQ * Q0) / (TAU / F)) % F) + F) % F;
        amb.push(q); if (amb.length > 7) amb.shift();
        const cnt = new Array(F).fill(0); amb.forEach((x) => cnt[x]++);
        ambM = cnt.indexOf(Math.max(...cnt));
      }
      if (!lockOn) ambM = 0;
      // bit kararı (belirsizlik düzeltilmiş)
      const ra = (-ambM * TAU) / F, ci = Math.cos(ra), si = Math.sin(ra);
      const fd = decide(pts, yI * ci - yQ * si, yI * si + yQ * ci);
      const be = popcount(fd ^ v);
      berErr[bPos] = be; berBits[bPos] = kb; bPos = (bPos + 1) % BW; bFill = Math.min(BW, bFill + 1);
      errHist[ePos] = e; ePos = (ePos + 1) % EW; eCount = Math.min(EW, eCount + 1);
      n++;
      return [yI, yQ, be > 0];
    }

    function upd() {
      const F = FOLD[scheme];
      let se = 0, sb = 0;
      for (let i = 0; i < bFill; i++) { se += berErr[i]; sb += berBits[i]; }
      rBer.set(sb ? (se ? sci(se / sb) : "< " + sci(1 / sb, 0)) : "–");
      let m = 0; const N = Math.min(eCount, 100);
      for (let i = 1; i <= N; i++) m += Math.abs(errHist[(ePos - i + EW) % EW]);
      m = N ? ((m / N) * 180) / Math.PI : 0;
      rErr.set("± " + num(m, 1) + "°");
      rFreq.set(lockOn ? num((loopFr * RS) / TAU, 2) + " Hz" : "–");
      const locked = lockOn && m < (0.33 * 180) / F;
      rState.set(!lockOn ? "Kapalı" : locked ? "Kilitli" : "Kilitleniyor…");
      rState.el.classList.toggle("cph", locked);
      rAmb.set(lockOn ? num((ambM * 360) / F) + "°" : "–");
    }

    function draw() {
      const { ctx, w, h: H } = st;
      ctx.clearRect(0, 0, w, H);
      if (w < 60 || H < 60) return;
      const { cx, cy, R, k } = planeBox(w, H, VIEW);
      V.iqPlane(ctx, cx, cy, R, { circle: true, scale: VIEW });
      boundaries(ctx, scheme, cx, cy, R, k);
      trail.draw(ctx, cx, cy, k, now, LIFE, R);
      idealPoints(ctx, scheme, cx, cy, k, false);
      // döngünün düzeltme açısı: nane renkli ok
      if (lockOn) {
        const a = -loopPh, rr = R * 0.92;
        ctx.save();
        ctx.strokeStyle = rgba(C.phase, 0.35); ctx.lineWidth = 6;
        ctx.beginPath(); ctx.arc(cx, cy, rr, 0, TAU); ctx.stroke();
        ctx.restore();
        V.dot(ctx, cx + Math.cos(a) * rr, cy - Math.sin(a) * rr, 6, C.phase, 12);
        V.text(ctx, "döngünün düzeltmesi", cx + R - 4, cy + R - 6, { size: 11, color: C.phase, align: "right" });
      }
      V.text(ctx, NAME[scheme] + " · " + num(RS) + " Bd", 14, 22, { size: 18, color: C.ink, font: FONT.display, weight: 800 });
    }
    const st = canvas(cv, draw);

    function drawErr() {
      const { ctx, w, h: H } = stE;
      ctx.clearRect(0, 0, w, H);
      const F = FOLD[scheme], lim = Math.PI / F, L0 = 36, pw = w - L0 - 6, ph = H - 16, y0 = 8;
      if (pw < 20 || ph < 20) return;
      const Y = (e) => y0 + ph / 2 - (e / lim) * (ph / 2);
      ctx.strokeStyle = rgba(C.line, 0.9); ctx.lineWidth = 1; ctx.beginPath();
      [-lim, 0, lim].forEach((e) => { const y = Math.round(Y(e)) + 0.5; ctx.moveTo(L0, y); ctx.lineTo(L0 + pw, y); });
      ctx.stroke();
      [[-lim, "−" + num(180 / F) + "°"], [0, "0°"], [lim, "+" + num(180 / F) + "°"]].forEach(([e, s]) => V.text(ctx, s, L0 - 5, Y(e) + 4, { size: 10.5, color: C.muted, align: "right" }));
      ctx.strokeStyle = rgba(C.ink, 0.35); ctx.beginPath(); ctx.moveTo(L0, Math.round(Y(0)) + 0.5); ctx.lineTo(L0 + pw, Math.round(Y(0)) + 0.5); ctx.stroke();
      ctx.fillStyle = C.phase;
      const N = eCount;
      for (let i = 0; i < N; i++) {
        const e = errHist[(ePos - N + i + EW) % EW], x = L0 + ((EW - N + i) / (EW - 1)) * pw;
        ctx.globalAlpha = 0.35 + 0.65 * (i / N);
        ctx.fillRect(x - 0.8, Y(e) - 0.8, 1.8, 1.8);
      }
      ctx.globalAlpha = 1;
      V.text(ctx, "şimdi", L0 + pw, H - 1, { size: 10, color: C.muted, align: "right" });
      V.text(ctx, num(EW / RS) + " sn önce", L0, H - 1, { size: 10, color: C.muted });
    }
    const stE = canvas(cvE, drawErr);

    // ses: biri sabit, biri takımyıldızla dönen iki ton. Dönme varsa vuru (vuv vuv) duyulur;
    // döngü kilitlenince vuru durur. Vuru hızı ekrandaki dönüş hızıyla aynıdır.
    let aRef = 0, aRes = 0;
    function beatFill(out, rate) {
      const target = rot + phase0 - loopPh;
      const rotHz = dfHz - (lockOn ? (loopFr * RS) / TAU : 0);
      for (let i = 0; i < out.length; i++) {
        aRef += (TAU * 330) / rate; if (aRef > TAU) aRef -= TAU;
        aRes += (TAU * rotHz) / rate;
        aRes += wrap(target - aRes) * 0.0015;
        out[i] = 0.22 * (Math.sin(aRef) + Math.sin(aRef + aRes));
      }
    }

    const lp = loop((dt) => {
      now += dt; frame++;
      symAcc += dt * RS;
      const m = Math.floor(symAcc); symAcc -= m;
      for (let i = 0; i < m; i++) { const [I, Q, er] = step(); trail.push(I, Q, now - (dt * (m - 1 - i)) / m, er); }
      draw(); drawErr();
      if (frame % 5 === 0) upd();
    });
    for (let i = 0; i < 400; i++) { const [I, Q, er] = step(); trail.push(I, Q, -2 + i / RS, er); }
    upd();
    slide.__c6 = { get state() { return rState.v.textContent; }, get ber() { return rBer.v.textContent; }, get loopHz() { return (loopFr * RS) / TAU; } };
    return {
      enter() { lp.start(); },
      leave() { lp.stop(); if (stream) { stream.stop(); stream = null; tgSound.set(false); } },
    };
  };

  /* =====================================================================
     3) Mesajını gönder: metin → bit → sembol → IQ → gürültülü kanal → karar → bit → metin
     ===================================================================== */
  Demos.message = function (stage, slide) {
    let scheme = "qpsk", snr = 7, text = "Merhaba SDR!", soundOn = false;
    const SPS = 8, MAXB = 20, VIEW = 1.6;
    const enc = new TextEncoder(), dec = new TextDecoder("utf-8", { fatal: false });

    const input = h("input.c6-msg", { type: "text", value: text, "aria-label": "Mesaj", spellcheck: "false", autocomplete: "off" });
    const btnSend = h("button.btn.primary", { type: "button" }, "Gönder");
    const note = h("span.note-small", "");
    const cv = h("canvas", { "aria-label": "Mesajın yolculuğu: bitler, semboller, gürültülü kanal, çözülen metin" });
    const rBit = readout("Bit hatası"), rChar = readout("Bozulan harf"), rBer = readout("Ölçülen BER"), rSym = readout("Semboller");
    const segM = seg(SCHEMES, scheme, (k) => { scheme = k; prepare(); send(); }, "Modülasyon");
    const slSnr = slider({ label: "SNR (Es/N0)", min: -2, max: 20, step: 0.5, value: snr, cls: "cn", fmt: (v) => db(v), oninput: (v) => { snr = v; decodeAll(); if (!anim) draw(); } });
    const tgSound = toggle("Dinle", false, (on) => { soundOn = on; if (on) send(); else stopSound(); });
    stage.append(
      h("div.controls.top", input, btnSend, note),
      h("div.fill", cv),
      h("div.c6-strip.readouts", rSym.el, rBit.el, rChar.el, rBer.el),
      h("div.controls", segM, slSnr, h("span.spacer"), tgSound));

    let M; // mesaj modeli
    let anim = null; // {t0}
    const r = DSP.rng(4242);

    // metni bayt sınırına göre kırp (bir harfi ortadan bölmeden)
    function clip(s) {
      let out = "";
      for (const ch of s) { if (enc.encode(out + ch).length > MAXB) return [out, true]; out += ch; }
      return [out, false];
    }
    function prepare() {
      const [t, cut] = clip(input.value);
      if (cut) input.value = t;
      text = t;
      note.textContent = cut ? `en fazla ${MAXB} bayt` : `${enc.encode(text).length} bayt`;
      const { bits: k } = DSP.CONST[scheme];
      const chars = [];
      let b0 = 0;
      for (const ch of text) { const n = enc.encode(ch).length; chars.push({ ch, b0, b1: b0 + n }); b0 += n; }
      const msgBits = DSP.textToBits(text), nb = msgBits.length;
      const ns = Math.ceil(nb / k), bits = new Uint8Array(ns * k); // 8-PSK'da sona dolgu biti
      bits.set(msgBits);
      const sym = DSP.mapBits(bits, scheme);
      // gürültü: birim varyanslı, örnek başına; SNR değişince yalnızca ölçeklenir
      const noise = new Float32Array(2 * ns * SPS);
      for (let i = 0; i < noise.length; i++) noise[i] = DSP.gaussian(r);
      M = { chars, nb, bits, ns, k, sym, noise, rx: new Float32Array(2 * ns), dbits: null, dtext: [] };
      decodeAll();
    }
    /* kanal + alıcı: dikdörtgen darbe (sembol başına SPS örnek), örnek başına σ·√SPS gürültü;
       alıcı her sembolün örneklerinin ortalamasını alır (uyumlu süzgeç), böylece karar anındaki gürültü σ olur */
    function decodeAll() {
      if (!M) return;
      const sg = sigmaOf(snr) * Math.sqrt(SPS);
      M.sg = sg;
      for (let s = 0; s < M.ns; s++) {
        let I = 0, Q = 0;
        for (let j = 0; j < SPS; j++) { const p = 2 * (s * SPS + j); I += M.sym[2 * s] + sg * M.noise[p]; Q += M.sym[2 * s + 1] + sg * M.noise[p + 1]; }
        M.rx[2 * s] = I / SPS; M.rx[2 * s + 1] = Q / SPS;
      }
      M.dbits = DSP.demapSymbols(M.rx, scheme);
      let be = 0;
      for (let i = 0; i < M.nb; i++) be += M.dbits[i] !== M.bits[i];
      M.berr = be;
      const bytes = enc.encode(text), got = new Uint8Array(bytes.length);
      for (let i = 0; i < bytes.length; i++) { let v = 0; for (let j = 0; j < 8; j++) v = (v << 1) | M.dbits[8 * i + j]; got[i] = v; }
      M.dtext = M.chars.map((c) => {
        const ok = bytes.slice(c.b0, c.b1).every((v, i) => v === got[c.b0 + i]);
        return { s: ok ? c.ch : dec.decode(got.slice(c.b0, c.b1)), ok };
      });
      M.full = DSP.bitsToText(M.dbits.subarray(0, M.nb));
      const bad = M.dtext.filter((d) => !d.ok).length;
      rSym.set(`${M.ns} × ${M.k} bit`);
      rBit.set(`${be} / ${M.nb}`); rBit.el.classList.toggle("cr", be > 0);
      rChar.set(`${bad} / ${M.chars.length}`); rChar.el.classList.toggle("cr", bad > 0);
      rBer.set(be ? sci(be / M.nb) : "0");
    }

    // animasyon: satırlar birbiri ardına soldan sağa dolar
    const ROWS = 6, LAG = 0.42, SWEEP = 1.9, TOTAL = SWEEP + LAG * (ROWS - 1) + 0.2;
    function rowFrac(i) { if (!anim) return 1; if (anim.typing) return i <= 1 ? 1 : 0; return clamp((anim.t - i * LAG) / SWEEP, 0, 1); }
    function send() {
      prepare();
      anim = { t: 0 };
      if (soundOn) playFSK();
      lp.start();
    }
    btnSend.addEventListener("click", send);
    input.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); send(); } });
    input.addEventListener("input", () => { prepare(); anim = { t: 0, typing: true }; draw(); });

    // ses: bitleri Bell 202 tonlarıyla çal (1 → 1.200 Hz, 0 → 2.200 Hz); bit satırı dolarken, yavaşlatılmış
    let stream = null, fsk = null, fskPos = 0;
    function playFSK() {
      stopSound();
      const rate = 48000, dur = SWEEP, nb = M.nb, per = (dur * rate) / nb, pre = Math.round(LAG * rate);
      const n = pre + Math.round(dur * rate) + 2400, buf = new Float32Array(n);
      let ph = 0; const nr = DSP.rng(9), ng = Math.min(0.5, 0.06 * M.sg);
      for (let i = pre; i < n - 2400; i++) {
        const b = M.bits[Math.min(nb - 1, Math.floor((i - pre) / per))];
        ph += (TAU * (b ? 1200 : 2200)) / rate;
        const env = Math.min(1, (i - pre) / 400, (n - 2400 - i) / 400);
        buf[i] = env * (0.28 * Math.sin(ph) + ng * DSP.gaussian(nr) * 0.3);
      }
      fsk = buf; fskPos = 0;
      stream = Sound.stream(slide, (out) => {
        for (let i = 0; i < out.length; i++) out[i] = fsk && fskPos < fsk.length ? fsk[fskPos++] : 0;
      }, { gain: 0.9 });
    }
    function stopSound() { if (stream) { stream.stop(); stream = null; } }

    function layout(w, H) {
      const narrow = w < 560;
      const S = narrow ? Math.min(w - 16, 230, H * 0.36) : clamp(Math.min(H * 0.62, w * 0.34), 150, 300);
      const x0 = 14, x1 = narrow ? w - 14 : w - S - 28;
      const rowsH = narrow ? H - S - 18 : H - 12;
      const LBL = 17, fixed = 30 + 18 + 18 + 30 + 6 * LBL + 5 * 8;
      const wv = clamp((rowsH - fixed - 10) / 2, 34, 110);
      const plane = narrow ? { cx: w / 2, cy: H - S / 2 - 6, R: Math.max(20, S / 2 - 18) } : { cx: w - S / 2 - 12, cy: H / 2, R: Math.max(20, S / 2 - 18) };
      plane.k = plane.R / VIEW;
      const used = fixed + 2 * wv;
      return { x0, x1, wv, LBL, plane, top: Math.max(8, Math.round((rowsH - used) / 2)) };
    }

    function draw() {
      const { ctx, w, h: H } = st;
      ctx.clearRect(0, 0, w, H);
      if (!M || w < 120 || H < 200) return;
      const Lo = layout(w, H), { x0, x1, wv, LBL } = Lo;
      const nbp = M.ns * M.k; // dolgu dahil bit sayısı
      const X = (b) => x0 + (b / nbp) * (x1 - x0);
      const bw = (x1 - x0) / nbp;
      let y = Lo.top;
      const rows = [];
      const label = (i, s, extra) => {
        V.text(ctx, s, x0, y + 12, { size: 11.5, color: C.ink2, weight: 700 });
        if (extra) V.text(ctx, extra, x1, y + 12, { size: 11, color: C.muted, align: "right" });
        y += LBL;
      };
      const reveal = (i) => X(rowFrac(i) * nbp);
      const clipRow = (i, yy, hh) => { ctx.save(); ctx.beginPath(); ctx.rect(x0 - 2, yy - 2, reveal(i) - x0 + 4, hh + 4); ctx.clip(); };
      const head = (i, yy, hh) => {
        const f = rowFrac(i);
        if (!anim || anim.typing || f <= 0 || f >= 1) return;
        const x = reveal(i), g = ctx.createLinearGradient(x - 40, 0, x, 0);
        g.addColorStop(0, rgba(C.ink, 0)); g.addColorStop(1, rgba(C.ink, 0.22));
        ctx.fillStyle = g; ctx.fillRect(x - 40, yy - 2, 40, hh + 4);
        ctx.fillStyle = C.ink; ctx.fillRect(x - 1, yy - 3, 2, hh + 6);
      };
      // sembol grupları: her sembolün bitleri alttaki satırlarla aynı hizada, dönüşümlü fon
      const bandTop = y + LBL + 30 + 8;

      // 1) mesaj
      label(0, "1  Mesaj", "UTF-8");
      const yT = y;
      clipRow(0, yT, 30);
      M.chars.forEach((c) => {
        const a = X(c.b0 * 8) + 1.5, b = X(c.b1 * 8) - 1.5;
        ctx.strokeStyle = rgba(C.ink, 0.35); ctx.lineWidth = 1; ctx.strokeRect(Math.round(a) + 0.5, yT + 0.5, Math.round(b - a), 29);
        V.text(ctx, c.ch === " " ? "␣" : c.ch, (a + b) / 2, yT + 21, { size: 17, color: C.ink, align: "center", weight: 700 });
      });
      ctx.restore(); head(0, yT, 30);
      y += 30 + 8;

      // fon bantları (bit satırından çözülen bitlere kadar)
      const bandBottom = bandTop + LBL + 18 + 8 + LBL + wv + 8 + LBL + wv + 8 + LBL + 18 - LBL;
      for (let s = 0; s < M.ns; s += 2) { ctx.fillStyle = rgba(C.ink, 0.035); ctx.fillRect(X(s * M.k), bandTop + LBL - 3, X((s + 1) * M.k) - X(s * M.k), bandBottom - bandTop - LBL + 6); }

      // 2) bitler
      label(1, "2  Bitler", `${M.nb} bit, ${M.k} bit = 1 sembol`);
      const yB = y;
      clipRow(1, yB, 18);
      for (let i = 0; i < nbp; i++) {
        const a = X(i) + (bw > 3 ? 0.6 : 0.2), ww = Math.max(1, bw - (bw > 3 ? 1.2 : 0.4));
        if (i >= M.nb) { ctx.fillStyle = rgba(C.muted, 0.25); ctx.fillRect(a, yB + 6, ww, 6); continue; }
        if (M.bits[i]) { ctx.fillStyle = C.ink; ctx.fillRect(a, yB, ww, 18); }
        else { ctx.fillStyle = rgba(C.ink, 0.13); ctx.fillRect(a, yB + 12, ww, 6); }
      }
      // bayt ayraçları
      ctx.fillStyle = rgba(C.bg, 1);
      for (let b = 8; b < M.nb; b += 8) ctx.fillRect(X(b) - 0.75, yB - 2, 1.5, 22);
      ctx.restore(); head(1, yB, 18);
      y += 18 + 8;

      // dalga satırları için yardımcı
      const amp = wv / 2 / 1.25;
      function waveRow(i, yy, noisy) {
        const mid = yy + wv / 2;
        ctx.strokeStyle = rgba(C.line, 1); ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(x0, Math.round(mid) + 0.5); ctx.lineTo(x1, Math.round(mid) + 0.5); ctx.stroke();
        clipRow(i, yy, wv);
        ctx.beginPath(); ctx.rect(x0, yy, x1 - x0, wv); ctx.clip();
        const sx = (x1 - x0) / (M.ns * SPS);
        [[0, C.I], [1, C.Q]].forEach(([q, col]) => {
          ctx.strokeStyle = noisy ? rgba(col, 0.55) : col; ctx.lineWidth = noisy ? 1 : 2; ctx.lineJoin = "round";
          ctx.beginPath();
          for (let s = 0; s < M.ns; s++) for (let j = 0; j < SPS; j++) {
            let v = M.sym[2 * s + q];
            if (noisy) v += M.sg * M.noise[2 * (s * SPS + j) + q];
            const xa = x0 + (s * SPS + j) * sx, yv = mid - v * amp;
            if (!noisy) { if (s === 0 && j === 0) ctx.moveTo(xa, yv); else ctx.lineTo(xa, yv); if (j === SPS - 1) ctx.lineTo(xa + sx, yv); }
            else { const xc = xa + sx / 2; (s || j) ? ctx.lineTo(xc, yv) : ctx.moveTo(xc, yv); }
          }
          ctx.stroke();
        });
        if (noisy) {
          // alıcının her sembolde aldığı ortalama: kısa fildişi çizgiler
          ctx.strokeStyle = C.ink; ctx.lineWidth = 2.4;
          ctx.beginPath();
          for (let s = 0; s < M.ns; s++) {
            const a = x0 + s * SPS * sx + 1, b = a + SPS * sx - 2;
            for (const q of [0, 1]) { const yv = mid - M.rx[2 * s + q] * amp; ctx.moveTo(a, yv); ctx.lineTo(b, yv); }
          }
          ctx.stroke();
        }
        ctx.restore();
        ctx.restore();
        head(i, yy, wv);
      }
      // 3) gönderilen IQ
      label(2, "3  Semboller → IQ sinyali", "");
      V.text(ctx, "I", x1 - 26, y - 5, { size: 12, color: C.I, weight: 700, font: FONT.display });
      V.text(ctx, "Q", x1 - 14, y - 5, { size: 12, color: C.Q, weight: 700, font: FONT.display });
      waveRow(2, y, false); y += wv + 8;
      // 4) kanal
      label(3, "4  Gürültülü kanal → alıcı ortalar", "");
      V.text(ctx, "Es/N0 " + num(snr, 1) + " dB", x1, y - 5, { size: 11, color: C.noise, align: "right", weight: 700 });
      waveRow(3, y, true); y += wv + 8;

      // 5) çözülen bitler
      label(4, "5  Çözülen bitler", "");
      const yD = y;
      clipRow(4, yD, 18);
      for (let i = 0; i < M.nb; i++) {
        const a = X(i) + (bw > 3 ? 0.6 : 0.2), ww = Math.max(1, bw - (bw > 3 ? 1.2 : 0.4));
        const wrong = M.dbits[i] !== M.bits[i], col = wrong ? C.needle : C.ink;
        if (M.dbits[i]) { ctx.fillStyle = col; ctx.fillRect(a, yD, ww, 18); }
        else { ctx.fillStyle = wrong ? col : rgba(C.ink, 0.13); ctx.fillRect(a, yD + 12, ww, 6); }
        if (wrong) { ctx.strokeStyle = C.needle; ctx.lineWidth = 1.2; ctx.strokeRect(a - 1, yD - 2, ww + 2, 22); }
      }
      ctx.fillStyle = C.bg;
      for (let b = 8; b < M.nb; b += 8) ctx.fillRect(X(b) - 0.75, yD - 2, 1.5, 22);
      ctx.restore(); head(4, yD, 18);
      y += 18 + 8;

      // 6) çözülen metin
      label(5, "6  Çözülen mesaj", "");
      const yR = y;
      clipRow(5, yR, 30);
      M.chars.forEach((c, i) => {
        const a = X(c.b0 * 8) + 1.5, b = X(c.b1 * 8) - 1.5, d = M.dtext[i];
        ctx.strokeStyle = d.ok ? rgba(C.ink, 0.35) : C.needle; ctx.lineWidth = d.ok ? 1 : 1.6;
        if (!d.ok) { ctx.fillStyle = rgba(C.needle, 0.14); ctx.fillRect(a, yR, b - a, 30); }
        ctx.strokeRect(Math.round(a) + 0.5, yR + 0.5, Math.round(b - a), 29);
        let s = d.s.replace(/[\u0000-\u001f\u007f-\u009f]/g, "·");
        if (s === " ") s = "␣";
        ctx.save(); ctx.beginPath(); ctx.rect(a, yR, b - a, 30); ctx.clip();
        V.text(ctx, s, (a + b) / 2, yR + 21, { size: 17, color: d.ok ? C.ink : C.needle, align: "center", weight: 700 });
        ctx.restore();
      });
      ctx.restore(); head(5, yR, 30);

      // alıcının gördüğü takımyıldız
      const P = Lo.plane, done = Math.floor(rowFrac(3) * M.ns + 1e-9);
      V.iqPlane(ctx, P.cx, P.cy, P.R, { circle: true, scale: VIEW });
      boundaries(ctx, scheme, P.cx, P.cy, P.R, P.k);
      idealPoints(ctx, scheme, P.cx, P.cy, P.k, false);
      ctx.save();
      ctx.beginPath(); ctx.rect(P.cx - P.R, P.cy - P.R, 2 * P.R, 2 * P.R); ctx.clip();
      for (let s = 0; s < done; s++) {
        const x = P.cx + M.rx[2 * s] * P.k, yy = P.cy - M.rx[2 * s + 1] * P.k;
        let wrong = false;
        for (let j = 0; j < M.k; j++) if (s * M.k + j < M.nb && M.dbits[s * M.k + j] !== M.bits[s * M.k + j]) wrong = true;
        V.dot(ctx, x, yy, 2.6, C.ink, s === done - 1 && anim ? 10 : 0);
        if (wrong) { ctx.strokeStyle = C.needle; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(x, yy, 6, 0, TAU); ctx.stroke(); }
      }
      ctx.restore();
      V.text(ctx, "Alıcının gördüğü", w < 560 ? 14 : P.cx - P.R, P.cy - P.R - 4, { size: 11.5, color: C.ink2, weight: 700 });
      V.text(ctx, NAME[scheme], w < 560 ? w - 14 : P.cx + P.R, P.cy - P.R - 4, { size: 14, color: C.ink, align: "right", font: FONT.display, weight: 800 });
    }
    const st = canvas(cv, draw);

    const lp = loop((dt) => {
      if (anim && !anim.typing) {
        anim.t += dt;
        if (anim.t > TOTAL) { anim = null; lp.stop(); }
      }
      draw();
    });
    prepare();
    slide.__c6 = { get M() { return M; }, get animating() { return !!anim; }, send };
    return {
      enter() { draw(); },
      leave() { lp.stop(); anim = null; stopSound(); draw(); },
    };
  };

  /* =====================================================================
     4) Sembol hızı ve bant genişliği: RRC biçimli sinyalin gerçek spektrumu
     ===================================================================== */
  Demos.symbolrate = function (stage, slide) {
    let scheme = "qpsk", rs = 250e3, beta = 0.35;
    const FMAX = 1.2e6, N = 2048, SPANS = 10;
    const cv = h("canvas", { "aria-label": "Spektrum ve darbe biçimi" });
    const rRs = readout("Sembol hızı"), rRb = readout("Bit hızı"), rBw = readout("Rs·(1+β)"), rOb = readout("Ölçülen %99 güç bandı");
    const rEff = readout("Spektral verim"), rReq = readout("BER 10⁻³ için Es/N0", "cn");
    const segM = seg(SCHEMES, scheme, (k) => { scheme = k; upd(); }, "Modülasyon");
    const fmtRs = (v) => (v >= 1e6 ? num(v / 1e6, 2) + " MBd" : num(v / 1e3) + " kBd");
    const slRs = slider({ label: "Sembol hızı", min: 100e3, max: 1000e3, step: 10e3, value: rs, fmt: fmtRs, oninput: (v) => { rs = v; rebuild(); } });
    const slB = slider({ label: "Roll-off (β)", min: 0, max: 1, step: 0.01, value: beta, fmt: (v) => num(v, 2), oninput: (v) => { beta = v; rebuild(); } });
    let stream = null;
    const tgSound = toggle("Dinle", false, (on) => {
      if (on) stream = Sound.stream(slide, modemAudio(() => ({ scheme, baud: rs / 1000, beta, fc: 1800, snr: null })), { gain: 0.9 });
      else if (stream) { stream.stop(); stream = null; }
    });
    stage.append(
      h("div.fill", cv),
      h("div.c6-strip.readouts", rRs.el, rRb.el, rBw.el, rOb.el, rEff.el, rReq.el),
      h("div.controls", segM, slRs, slB, h("span.spacer"), tgSound));

    const r = DSP.rng(31);
    let sps, fsim, fir, avg, pulse, rc, phaseCnt = 0, ref = null, occ = 0, blocks = 0;
    const buf = new Float32Array(2 * N);
    function rebuild() {
      sps = Math.max(8, Math.ceil((2 * FMAX) / rs));
      fsim = rs * sps;
      fir = new DSP.FIR(DSP.rrc(sps, SPANS, beta), true);
      avg = new DSP.SpectrumAverager(N);
      ref = null; blocks = 0;
      // darbe paneli: 16 örnek/sembol, ±6 sembol
      const p = DSP.rrc(16, 12, beta);
      let pk = 0; p.forEach((v) => (pk = Math.max(pk, Math.abs(v))));
      pulse = Array.from(p, (v) => v / pk);
      // verici + alıcı süzgeci (RRC * RRC = yükseltilmiş kosinüs)
      const q = new Float32Array(2 * p.length - 1);
      for (let i = 0; i < p.length; i++) for (let j = 0; j < p.length; j++) q[i + j] += p[i] * p[j];
      let qk = 0; q.forEach((v) => (qk = Math.max(qk, Math.abs(v))));
      rc = Array.from(q, (v) => v / qk);
      for (let i = 0; i < 6; i++) block();
      upd();
    }
    function block() {
      const pts = DSP.CONST[scheme].pts;
      buf.fill(0);
      for (let i = 0; i < N; i++) {
        if (phaseCnt === 0) { const v = pts[Math.floor(r() * pts.length)]; buf[2 * i] = v[0]; buf[2 * i + 1] = v[1]; }
        phaseCnt = (phaseCnt + 1) % sps;
      }
      const y = fir.process(buf);
      const d = DSP.spectrum(y, N, { window: "hann" });
      avg.push(d, blocks === 0 ? 1 : Math.max(0.06, 1 / (blocks + 1)));
      blocks++;
      // başvuru seviyesi: bant ortasının (|f| < Rs/4) ortalama gücü → 0 dB
      const acc = avg.acc;
      let s = 0, c = 0;
      for (let i = 0; i < N; i++) { const f = ((i - N / 2) / N) * fsim; if (Math.abs(f) < rs / 4) { s += acc[i]; c++; } }
      ref = s / c;
      // %99 güç bandı: toplam gücün %0,5'i ile %99,5'i arası
      let tot = 0; for (let i = 0; i < N; i++) tot += acc[i];
      let cum = 0, lo = 0, hi = N - 1;
      for (let i = 0; i < N; i++) { cum += acc[i]; if (cum >= 0.005 * tot) { lo = i; break; } }
      cum = 0;
      for (let i = N - 1; i >= 0; i--) { cum += acc[i]; if (cum >= 0.005 * tot) { hi = i; break; } }
      occ = ((hi - lo + 1) / N) * fsim;
    }
    const kHz = (v) => (v >= 1e6 ? num(v / 1e6, 2) + " MHz" : num(v / 1e3) + " kHz");
    function reqSnr() {
      let a = -10, b = 40;
      for (let i = 0; i < 50; i++) { const m = (a + b) / 2; DSP.berTheory(scheme, m) > 1e-3 ? (a = m) : (b = m); }
      return a;
    }
    function upd() {
      const k = DSP.CONST[scheme].bits, rb = rs * k;
      rRs.set(fmtRs(rs));
      rRb.set(rb >= 1e6 ? num(rb / 1e6, 2) + " Mbit/sn" : num(rb / 1e3) + " kbit/sn");
      rBw.set(kHz(rs * (1 + beta)));
      rOb.set(kHz(occ));
      rEff.set(num(k / (1 + beta), 2) + " bit/sn/Hz");
      rReq.set(db(reqSnr()));
    }

    function draw() {
      const { ctx, w, h: H } = st;
      ctx.clearRect(0, 0, w, H);
      if (!avg || !avg.acc) return;
      const narrow = w < 560;
      const pad = 14, sTop = 30, sH = Math.round((H - sTop) * (narrow ? 0.56 : 0.6)) - 34;
      const sx = pad, sw = w - 2 * pad;
      const X = (f) => sx + ((f + FMAX) / (2 * FMAX)) * sw;
      V.text(ctx, "Spektrum (gerçekten hesaplanan, ortalamalı FFT)", sx, 18, { size: 11.5, color: C.ink2, weight: 700 });
      // dB ızgarası ve spektrum
      const MIN = -60, MAX = 6;
      V.dbGrid(ctx, { x: sx, y: sTop, w: sw, h: sH, min: MIN, max: MAX, step: 10, unit: "dB" });
      const disp = new Float32Array(N);
      for (let i = 0; i < N; i++) disp[i] = 10 * Math.log10(avg.acc[i] / ref + 1e-12);
      const from = Math.max(0, Math.round(N / 2 - (FMAX / fsim) * N)), to = Math.min(N, Math.round(N / 2 + (FMAX / fsim) * N));
      // kaplanan bant: Rs(1+β)
      const e = (rs * (1 + beta)) / 2, nyq = rs / 2;
      ctx.fillStyle = rgba(C.ink, 0.05); ctx.fillRect(X(-e), sTop, X(e) - X(-e), sH);
      V.spectrum(ctx, { x: sx, y: sTop, w: sw, h: sH, db: disp, min: MIN, max: MAX, from, to });
      ctx.save();
      ctx.setLineDash([2, 4]); ctx.strokeStyle = rgba(C.ink2, 0.55); ctx.lineWidth = 1;
      [-nyq, nyq].forEach((f) => { const x = Math.round(X(f)) + 0.5; ctx.beginPath(); ctx.moveTo(x, sTop + 16); ctx.lineTo(x, sTop + sH); ctx.stroke(); });
      ctx.setLineDash([6, 4]); ctx.strokeStyle = rgba(C.ink, 0.85);
      [-e, e].forEach((f) => { const x = Math.round(X(f)) + 0.5; ctx.beginPath(); ctx.moveTo(x, sTop - 2); ctx.lineTo(x, sTop + sH); ctx.stroke(); });
      ctx.restore();
      // köşeli ayraç ve etiket
      const by = sTop + 8;
      ctx.strokeStyle = C.ink; ctx.lineWidth = 1.4;
      ctx.beginPath(); ctx.moveTo(X(-e), by + 5); ctx.lineTo(X(-e), by); ctx.lineTo(X(e), by); ctx.lineTo(X(e), by + 5); ctx.stroke();
      const lab = "Rs·(1+β) = " + kHz(2 * e);
      ctx.font = `700 12.5px ${FONT.body}`;
      const tw = ctx.measureText(lab).width, lx = clamp((X(-e) + X(e)) / 2, sx + tw / 2 + 4, sx + sw - tw / 2 - 4);
      ctx.fillStyle = rgba(C.stage, 0.92); ctx.fillRect(lx - tw / 2 - 6, by - 9, tw + 12, 17);
      V.text(ctx, lab, lx, by + 4, { size: 12.5, color: C.ink, align: "center", weight: 700 });
      if (X(nyq) - X(-nyq) > 70) {
        V.text(ctx, "−Rs/2", X(-nyq) + 4, sTop + 30, { size: 10.5, color: C.ink2 });
        V.text(ctx, "+Rs/2", X(nyq) - 4, sTop + 30, { size: 10.5, color: C.ink2, align: "right" });
      }
      // frekans skalası
      const tk = narrow ? [-1200, -600, 0, 600, 1200] : [-1200, -800, -400, 0, 400, 800, 1200];
      const minor = []; for (let f = -1200; f <= 1200; f += 100) minor.push(f);
      V.scale(ctx, { x: sx, y: sTop + sH, w: sw, from: -1200, to: 1200, major: tk, minor, fmt: (v) => (v < 0 ? "−" + -v : String(v)) });
      V.text(ctx, "kHz", sx + sw, sTop + sH + 34, { size: 11, color: C.muted, align: "right" });

      // darbe paneli
      const pTop = sTop + sH + 52, pH = H - pTop - 10;
      if (pH < 50) return;
      const T = 1 / rs;
      V.text(ctx, "Darbe biçimi (zaman)", sx, pTop - 6, { size: 11.5, color: C.ink2, weight: 700 });
      const tlab = "T = 1/Rs = " + num(T * 1e6, 2) + " µs";
      V.text(ctx, tlab, sx + sw, pTop - 6, { size: 11.5, color: C.ink, align: "right", weight: 700 });
      const px = (t) => sx + ((t + 6) / 12) * sw, mid = pTop + pH * 0.62, a = pH * 0.55;
      ctx.strokeStyle = rgba(C.line, 1); ctx.lineWidth = 1; ctx.beginPath();
      for (let k = -6; k <= 6; k++) { const x = Math.round(px(k)) + 0.5; ctx.moveTo(x, pTop + 4); ctx.lineTo(x, pTop + pH); }
      ctx.moveTo(sx, Math.round(mid) + 0.5); ctx.lineTo(sx + sw, Math.round(mid) + 0.5);
      ctx.stroke();
      // yükseltilmiş kosinüs (verici+alıcı): komşu sembol anlarında sıfırdan geçer
      const rcN = rc.length, rcM = (rcN - 1) / 2;
      ctx.save(); ctx.setLineDash([4, 3]); ctx.strokeStyle = rgba(C.ink2, 0.75); ctx.lineWidth = 1.3; ctx.beginPath();
      for (let i = 0; i < rcN; i++) { const t = (i - rcM) / 16; if (t < -6 || t > 6) continue; const x = px(t), y = mid - rc[i] * a; t === -6 ? ctx.moveTo(x, y) : ctx.lineTo(x, y); }
      ctx.stroke(); ctx.restore();
      const pm = (pulse.length - 1) / 2;
      ctx.strokeStyle = C.ink; ctx.lineWidth = 2; ctx.lineJoin = "round"; ctx.beginPath();
      pulse.forEach((v, i) => { const t = (i - pm) / 16, x = px(t), y = mid - v * a; i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); });
      ctx.stroke();
      for (let k = -6; k <= 6; k++) { if (!k) continue; const v = rc[rcM + 16 * k]; V.dot(ctx, px(k), mid - v * a, 2.6, C.ink2); }
      const lgx = sx + 6, lgy = pTop + 12;
      ctx.strokeStyle = C.ink; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(lgx, lgy); ctx.lineTo(lgx + 16, lgy); ctx.stroke();
      V.text(ctx, "verici darbesi (RRC)", lgx + 22, lgy + 4, { size: 11, color: C.ink2 });
      ctx.save(); ctx.setLineDash([4, 3]); ctx.strokeStyle = C.ink2; ctx.lineWidth = 1.3; ctx.beginPath(); ctx.moveTo(lgx, lgy + 16); ctx.lineTo(lgx + 16, lgy + 16); ctx.stroke(); ctx.restore();
      V.text(ctx, narrow ? "alıcıdan sonra (RC)" : "alıcı süzgecinden sonra (RC): komşu sembol anlarında sıfır", lgx + 22, lgy + 20, { size: 11, color: C.ink2 });
    }
    const st = canvas(cv, draw);

    let frame = 0;
    const lp = loop(() => {
      block(); draw();
      if (++frame % 10 === 0) upd();
    });
    rebuild();
    slide.__c6 = { get occ() { return occ; }, get rs() { return rs; }, get beta() { return beta; } };
    return {
      enter() { lp.start(); },
      leave() { lp.stop(); if (stream) { stream.stop(); stream = null; tgSound.set(false); } },
    };
  };

  /* ---------- hayalet el ---------- */
  window.GUIDE_SCENARIOS = Object.assign(window.GUIDE_SCENARIOS || {}, {
    takimyildiz: [{ slide: "label:SNR (Es/N0)", to: 4 }, { wait: 700 }, { click: "16-QAM" }],
    donme: [{ slide: "label:Frekans hatası", to: 1.5 }, { wait: 1200 }, { click: "Dönmeyi düzelt" }],
    mesaj: [{ click: "=Gönder" }, { wait: 2600 }, { slide: "label:SNR (Es/N0)", to: 2 }],
    "sembol-hizi": [{ slide: "label:Roll-off (β)", to: 0 }, { wait: 700 }, { slide: "label:Sembol hızı", to: 600e3 }],
  });
})();

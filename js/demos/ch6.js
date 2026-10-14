/* Bölüm 6 (ilk yarı): modülasyon.
   - am: Neşeye Övgü taşıyıcının genliğini değiştirir; IQ'da nefes alan ok; zarf dedektörü √(I² + Q²)
   - fm: frekans değişir; IQ'da hızlanıp yavaşlayan ok; faz farkı demodülatörü; Carson kuralı; gürültüde AM ile karşılaştırma
   - digital: ASK, FSK, BPSK, QPSK, 16-QAM; tıklanabilir bitler; dalga ve takımyıldız yan yana; modem sesi
   Ses zincirleri (CH6.AMChain, CH6.FMChain) gerçek modülasyon + demodülasyon yapar; ekrandaki ilinti değeri
   çözülen sesle kaynağın ölçülmüş benzerliğidir. */
(function () {
  const { C, FONT, rgba, h, canvas, loop, clamp, slider, seg, toggle, num } = L;
  const TAU = Math.PI * 2;
  const RATE = 48000;

  /* ---------------- ortak yardımcılar ---------------- */

  // Melodi tepe değeri 1 olacak biçimde ölçeklenir: %100 derinlik gerçekten zarfı sıfıra indirir.
  let MEL_GAIN = 0;
  function melodyGain() {
    if (MEL_GAIN) return MEL_GAIN;
    const m = Music.melody({ timbre: "flute", gain: 1 });
    const beats = Music.ODE.reduce((s, x) => s + x[1], 0), r = 16000;
    const buf = new Float32Array(Math.ceil((beats * 60 / 132) * r));
    m.next(buf, r);
    let pk = 0; for (let i = 0; i < buf.length; i++) pk = Math.max(pk, Math.abs(buf[i]));
    return (MEL_GAIN = 0.99 / pk);
  }
  const ode = () => Music.melody({ timbre: "flute", gain: melodyGain() });

  // Mutlak örnek numarasıyla okunan halka tampon
  class Ring {
    constructor(bits = 16) { this.n = 1 << bits; this.mask = this.n - 1; this.a = new Float32Array(this.n); this.w = 0; }
    push(x) { const { a, mask } = this; let w = this.w; for (let i = 0; i < x.length; i++) a[(w++) & mask] = x[i]; this.w = w; }
    at(i) { return this.a[i & this.mask]; }
  }

  // Durum tutan, azaltmalı gerçek FIR alçak geçiren (yalnızca tutulan çıkışlar hesaplanır)
  class DecimLP {
    constructor(M, taps, cutoff) {
      this.M = M; this.h = DSP.firLowpass(taps, cutoff); this.T = taps;
      this.H = new Float32Array(2 * taps); this.p = 0; this.ph = 0; this.out = new Float32Array(0);
    }
    process(x) {
      const { h, T, H, M } = this, need = Math.ceil(x.length / M) + 1;
      if (this.out.length < need) this.out = new Float32Array(need);
      let p = this.p, ph = this.ph, k = 0;
      for (let i = 0; i < x.length; i++) {
        p = (p + T - 1) % T; H[p] = H[p + T] = x[i];
        if (++ph === M) { ph = 0; let a = 0; for (let j = 0; j < T; j++) a += h[j] * H[p + j]; this.out[k++] = a; }
      }
      this.p = p; this.ph = ph;
      return this.out.subarray(0, k);
    }
  }

  // Pearson ilintisi; çözülen sinyalin gecikmesi 0…maxLag arasında aranır
  function corr(src, dem, end, len, maxLag) {
    let best = -1, bestLag = 0;
    for (let lag = 0; lag <= maxLag; lag++) {
      let sx = 0, sy = 0, sxx = 0, syy = 0, sxy = 0;
      for (let i = end - len; i < end; i++) {
        const x = src.at(i - lag), y = dem.at(i);
        sx += x; sy += y; sxx += x * x; syy += y * y; sxy += x * y;
      }
      const cv = sxy - (sx * sy) / len, vx = sxx - (sx * sx) / len, vy = syy - (sy * sy) / len;
      const r = vx > 1e-9 && vy > 1e-12 ? cv / Math.sqrt(vx * vy) : 0;
      if (r > best) { best = r; bestLag = lag; }
    }
    return { r: best, lag: bestLag };
  }

  // %99 güç bant genişliği (iki yanlı), doğrusal güç dizisinden; merkez kutu n/2
  function occupiedBW(pw, binHz, frac = 0.99) {
    const n = pw.length, c = n / 2;
    let tot = 0; for (let i = 0; i < n; i++) tot += pw[i];
    let acc = pw[c];
    for (let k = 1; k < c; k++) {
      acc += pw[c + k] + pw[c - k];
      if (acc >= frac * tot) return 2 * k * binHz;
    }
    return n * binHz;
  }

  // ses sinyali ve demodülasyon zincirlerinin "şimdi"sini gösteren osiloskop tetiklemesi
  function trigger(ring, end, win, search) {
    for (let i = end - win; i > end - win - search; i--) if (ring.at(i - 1) < 0 && ring.at(i) >= 0) return i;
    return end - win;
  }

  /* --- çizim yardımcıları --- */
  function panel(ctx, x, y, w, hh, title, right, rightColor) {
    ctx.save();
    ctx.fillStyle = rgba(C.bg, 0.42);
    ctx.strokeStyle = rgba(C.line, 1); ctx.lineWidth = 1;
    ctx.beginPath(); ctx.roundRect(Math.round(x) + 0.5, Math.round(y) + 0.5, Math.round(w) - 1, Math.round(hh) - 1, 6);
    ctx.fill(); ctx.stroke();
    ctx.restore();
    if (title) V.text(ctx, title, x + 10, y + 17, { color: C.ink2, size: 12, weight: 600 });
    if (right) {
      ctx.font = `600 12px ${FONT.body}`; const tw = title ? ctx.measureText(title).width : 0;
      ctx.font = `400 11.5px ${FONT.body}`; if (tw + ctx.measureText(right).width > w - 36) return;
    }
    if (right) V.text(ctx, right, x + w - 10, y + 17, { color: rightColor || C.muted, size: 11.5, align: "right" });
  }
  function midline(ctx, x, y, w) {
    ctx.strokeStyle = rgba(C.ink, 0.12); ctx.lineWidth = 1; ctx.setLineDash([2, 4]);
    ctx.beginPath(); ctx.moveTo(x, Math.round(y) + 0.5); ctx.lineTo(x + w, Math.round(y) + 0.5); ctx.stroke(); ctx.setLineDash([]);
  }
  // fn(u) → değer; u 0…1; piksel başına iki nokta
  function trace(ctx, x, y, w, hh, fn, A, color, width = 1.8, glow = 0) {
    ctx.save();
    ctx.beginPath(); ctx.rect(x, y - 2, w, hh + 4); ctx.clip();
    if (glow) { ctx.shadowColor = color; ctx.shadowBlur = glow; }
    ctx.strokeStyle = color; ctx.lineWidth = width; ctx.lineJoin = "round";
    ctx.beginPath();
    const N = Math.max(2, Math.round(w * 2));
    for (let i = 0; i <= N; i++) {
      const u = i / N, v = fn(u), py = y + hh / 2 - (v / A) * (hh / 2);
      i ? ctx.lineTo(x + u * w, py) : ctx.moveTo(x + u * w, py);
    }
    ctx.stroke();
    ctx.restore();
  }
  function cursorLine(ctx, x, y, hh) {
    ctx.save();
    ctx.strokeStyle = rgba(C.needle, 0.9); ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(Math.round(x) + 0.5, y); ctx.lineTo(Math.round(x) + 0.5, y + hh); ctx.stroke();
    ctx.fillStyle = C.needle; ctx.beginPath(); ctx.moveTo(x - 4.5, y); ctx.lineTo(x + 4.5, y); ctx.lineTo(x, y + 6); ctx.closePath(); ctx.fill();
    ctx.restore();
  }
  function readout(k, cls) {
    const v = h("span.v", "–");
    const el = h("span.readout" + (cls ? "." + cls : ""), h("span.k", k), v);
    el.set = (s) => { if (v.textContent !== s) v.textContent = s; };
    return el;
  }
  const pct = (v) => "%" + num(v * 100, 0);
  const f2 = (v) => num(v, 2);
  // ilintiden ölçülen çıkış SNR'si: r² / (1 − r²)
  const snrOf = (c) => { if (!c) return "–"; const r2 = c.r * c.r, v = 10 * Math.log10(r2 / Math.max(1e-9, 1 - r2)); return v > 40 ? "> 40 dB" : num(Math.max(v, -10), 0) + " dB"; };
  const khz = (v, d = 1) => num(v / 1000, d) + " kHz";

  // Spektrum ekseni: frekans (Hz) → piksel
  function freqAxis(ctx, x, y, w, from, to, fmt, count = 6) {
    const t = V.ticks(from, to, count);
    V.scale(ctx, { x, y, w, from, to, major: t.major, minor: t.minor, fmt, size: 11, color: C.ink2 });
  }

  /* ---------------- ses zincirleri (ölçüm betiği de bunları kullanır) ---------------- */

  // AM: ses → DSP.amMod → sabit faz kayması φ (alıcı vericiyle aynı fazda değil) → zarf √(I²+Q²) → DC giderme
  class AMChain {
    constructor() {
      this.mel = ode(); this.m = 0.8; this.phi = 0.62;
      this.src = new Ring(16); this.dem = new Ring(16);
      this.dc = 1 / 1.8; this.k = 1 - Math.exp((-TAU * 4) / RATE);
    }
    produce(n) {
      const a = new Float32Array(n);
      this.mel.next(a, RATE);
      this.src.push(a);
      const iq = DSP.amMod(a, this.m), c = Math.cos(this.phi), s = Math.sin(this.phi);
      const d = new Float32Array(n), g = this.m > 0.005 ? (1 + this.m) / this.m : 0;
      for (let i = 0; i < n; i++) {
        const v = iq[2 * i], I = v * c, Q = v * s;      // vericinin gönderdiği (döndürülmüş) IQ
        const env = Math.sqrt(I * I + Q * Q);            // zarf dedektörü
        this.dc += (env - this.dc) * this.k;             // taşıyıcının payı (yavaş ortalama)
        d[i] = (env - this.dc) * g;
      }
      this.dem.push(d);
      return { a, d };
    }
  }

  // FM: ses (48 kHz) → ×5 ara değerleme → DSP.fmMod (240 kHz IQ) → [+gürültü] → DSP.FMDemod → 15 kHz süzgeç → 48 kHz
  // Aynı ses ve aynı gürültüyle bir AM verici de karşılaştırma için çalışır (aynı tepe gücü).
  class FMChain {
    constructor() {
      this.FS = 240000; this.U = 5;
      this.mel = ode(); this.dev = 75000; this.cn = Infinity; this.mAM = 0.8;
      this.prev = 0; this.ph = 0;
      this.fmd = new DSP.FMDemod();
      this.lpF = new DecimLP(5, 61, 15000 / this.FS);
      this.lpA = new DecimLP(5, 61, 15000 / this.FS);
      this.dcA = 1 / 1.8; this.kA = 1 - Math.exp((-TAU * 4) / this.FS);
      this.r = DSP.rng(7);
      this.src = new Ring(16); this.dem = new Ring(16); this.demAM = new Ring(16);
      this.tail = new Float32Array(2 * 4096); this.tw = 0; // son 4096 karmaşık örnek (spektrum için)
    }
    produce(n) {
      const { U, FS } = this;
      const a = new Float32Array(n);
      this.mel.next(a, RATE);
      this.src.push(a);
      const N = n * U, up = new Float32Array(N);
      let prev = this.prev, sum = 0;
      for (let i = 0; i < n; i++) {
        for (let k = 1; k <= U; k++) { const v = prev + ((a[i] - prev) * k) / U; up[i * U + k - 1] = v; sum += v; }
        prev = a[i];
      }
      this.prev = prev;
      const dn = this.dev / FS;
      const iq = DSP.fmMod(up, dn);
      // fmMod her çağrıda fazı sıfırdan başlatır: önceki bloğun son fazıyla döndür (faz sürekli kalsın)
      const c = Math.cos(this.ph), s = Math.sin(this.ph);
      for (let i = 0; i < N; i++) { const I = iq[2 * i], Q = iq[2 * i + 1]; iq[2 * i] = I * c - Q * s; iq[2 * i + 1] = I * s + Q * c; }
      this.ph = (this.ph + TAU * dn * sum) % TAU;
      const am = DSP.amMod(up, this.mAM);
      if (isFinite(this.cn)) {
        const sig = Math.sqrt(10 ** (-this.cn / 10) / 2), r = this.r;
        for (let i = 0; i < 2 * N; i++) { const g = sig * DSP.gaussian(r); iq[i] += g; am[i] += g; }
      }
      // spektrum için kuyruk
      for (let i = 0; i < N; i++) { const j = this.tw & 4095; this.tail[2 * j] = iq[2 * i]; this.tail[2 * j + 1] = iq[2 * i + 1]; this.tw++; }
      // FM demodülasyonu: ardışık örnekler arasındaki açı
      const f = this.fmd.process(iq), g = FS / this.dev;
      for (let i = 0; i < N; i++) f[i] *= g;
      const d = this.lpF.process(f).slice();
      this.dem.push(d);
      // AM karşılaştırma: zarf dedektörü
      const e = new Float32Array(N), gA = (1 + this.mAM) / this.mAM;
      for (let i = 0; i < N; i++) {
        const env = Math.hypot(am[2 * i], am[2 * i + 1]);
        this.dcA += (env - this.dcA) * this.kA;
        e[i] = (env - this.dcA) * gA;
      }
      const dA = this.lpA.process(e).slice();
      this.demAM.push(dA);
      return { a, d, dA };
    }
    lastIQ(out) { for (let i = 0; i < 4096; i++) { const j = (this.tw + i) & 4095; out[2 * i] = this.tail[2 * j]; out[2 * i + 1] = this.tail[2 * j + 1]; } return out; }
  }
  window.CH6 = { AMChain, FMChain, Ring, corr, melodyGain };

  // Ortak "Dinle" yönetimi: akış açıkken sesi akış üretir, kapalıyken döngü (görseller için)
  function audioDriver(slide, chain, pick) {
    let stream = null, acc = 0;
    return {
      start() { if (!stream) stream = Sound.stream(slide, (out) => { const r = chain.produce(out.length); pick(r, out); }, { rate: RATE }); },
      stop() { if (stream) { stream.stop(); stream = null; } },
      tick(dt) {
        if (stream && Sound.unlocked) return;
        acc += dt * RATE;
        const n = Math.floor(acc);
        if (n > 0) { acc -= n; chain.produce(Math.min(n, 4096)); }
      },
      get on() { return !!stream; },
    };
  }

  /* ======================================================================
     1. AM
     ====================================================================== */
  Demos.am = function (stage, slide) {
    const cv = h("canvas", { "aria-label": "Genlik modülasyonu: ses dalgası, modüle taşıyıcı, IQ düzleminde nefes alan ok ve spektrum" });
    const fill = h("div.fill.ch6-fill", cv);
    const chain = new AMChain();
    let sel = "dem";
    const drv = audioDriver(slide, chain, (r, out) => {
      const x = sel === "src" ? r.a : r.d;
      for (let i = 0; i < out.length; i++) out[i] = clamp(x[i] * 0.6, -1, 1);
    });
    const depth = slider({ label: "Modülasyon derinliği", min: 0, max: 150, step: 1, value: 80, fmt: (v) => "%" + num(v, 0), oninput: (v) => { chain.m = v / 100; } });
    const which = seg([["src", "Kaynak"], ["dem", "Çözülen"]], sel, (k) => (sel = k), "Duyulan ses");
    const listen = toggle("Dinle", false, (on) => (on ? drv.start() : drv.stop()));
    const rM = readout("Derinlik"), rBW = readout("Bant genişliği (2 × ses)"), rC = readout("Çözülen ↔ kaynak ilintisi", "cph"), rO = readout("Durum", "");
    const ctrl = h("div.controls", depth, h("span.ch6-grp", h("span.lab", "Duyulan:"), which), listen, h("div.readouts.ch6-ro", rM, rO, rBW, rC));
    stage.append(fill, ctrl);

    const WIN = 960;              // 20 ms pencere
    const SWEEP = 2.6;            // imleç pencereyi bu kadar saniyede geçer
    const slowK = SWEEP / (WIN / RATE);
    const SN = 4096, spec = new DSP.SpectrumAverager(SN), aspec = new DSP.SpectrumAverager(SN);
    const sbuf = new Float32Array(2 * SN), abuf = new Float32Array(2 * SN);
    let vt = 0, frame = 0, trail = [], corrV = null, overT = 0, bw = 0, db = null;
    let st;

    function measure() {
      const src = chain.src, end = src.w, m = chain.m;
      // spektrum: son 4096 örneğin IQ'su (taşıyıcı 0 Hz'de)
      for (let i = 0; i < SN; i++) { const a = src.at(end - SN + i); sbuf[2 * i] = (1 + m * a) / (1 + m); sbuf[2 * i + 1] = 0; abuf[2 * i] = a; abuf[2 * i + 1] = 0; }
      db = spec.push(DSP.spectrum(sbuf, SN), 0.35);
      const adb = aspec.push(DSP.spectrum(abuf, SN), 0.08);
      const pw = Float64Array.from(adb, (v) => 10 ** (v / 10));
      pw[SN / 2] = 0; // ses ortalaması (DC) bant genişliğine sayılmaz
      bw = occupiedBW(pw, RATE / SN);
    }

    function layout(w, H) {
      const p = 10;
      if (w >= 560) {
        const top = Math.round(H * 0.5);
        const lh = (top - p * 3) / 2;
        const by = top, bh = H - by - p;
        const s = Math.min(bh, w * 0.42);
        return { l1: [p, p, w - 2 * p, lh], l2: [p, p * 2 + lh, w - 2 * p, lh], iq: [p, by, s, bh], sp: [2 * p + s, by, w - 3 * p - s, bh] };
      }
      const lh = H * 0.17, iqh = H * 0.36;
      return { l1: [p, p, w - 2 * p, lh], l2: [p, 2 * p + lh, w - 2 * p, lh], iq: [p, 3 * p + 2 * lh, w - 2 * p, iqh], sp: [p, 4 * p + 2 * lh + iqh, w - 2 * p, H - (5 * p + 2 * lh + iqh)] };
    }

    function draw() {
      if (!st) return;
      const { ctx, w, h: H } = st;
      ctx.clearRect(0, 0, w, H);
      const Lo = layout(w, H), m = chain.m, src = chain.src, dem = chain.dem;
      const end = src.w - 256;
      const t0 = trigger(src, end, WIN, 1400);
      const A = (u) => src.at(t0 + Math.floor(u * WIN));
      const cu = (vt % SWEEP) / SWEEP;
      const over = m > 1.0001 && overT > 0;

      // 1) ses dalgası + çözülen
      {
        const [x, y, ww, hh] = Lo.l1;
        panel(ctx, x, y, ww, hh, "Ses (Neşeye Övgü)", `${num(WIN / RATE * 1000, 0)} ms pencere`);
        const iy = y + 24, ih = hh - 30;
        midline(ctx, x + 8, iy + ih / 2, ww - 16);
        const lag = corrV ? corrV.lag : 0;
        trace(ctx, x + 8, iy, ww - 16, ih, A, 1.15, rgba(C.ink2, 0.95), 1.6);
        if (m > 0.005) {
          ctx.save(); ctx.setLineDash([5, 4]);
          trace(ctx, x + 8, iy, ww - 16, ih, (u) => clamp(dem.at(t0 + Math.floor(u * WIN) + lag), -1.6, 1.6), 1.15, rgba(C.amp, over ? 0.95 : 0.75), 1.4);
          ctx.restore();
        }
        // lejant
        const ly = y + 17;
        ctx.save(); ctx.font = `600 12px ${FONT.body}`; const tw = ctx.measureText("Ses (Neşeye Övgü)").width; ctx.restore();
        if (ww > 380) {
          const lx = x + 22 + tw;
          ctx.strokeStyle = rgba(C.ink2, 0.95); ctx.lineWidth = 1.6; ctx.beginPath(); ctx.moveTo(lx, ly - 4); ctx.lineTo(lx + 14, ly - 4); ctx.stroke();
          V.text(ctx, "kaynak", lx + 18, ly, { size: 11.5, color: C.muted });
          ctx.setLineDash([5, 4]); ctx.strokeStyle = C.amp; ctx.beginPath(); ctx.moveTo(lx + 66, ly - 4); ctx.lineTo(lx + 84, ly - 4); ctx.stroke(); ctx.setLineDash([]);
          V.text(ctx, "çözülen", lx + 88, ly, { size: 11.5, color: C.muted });
        }
        cursorLine(ctx, x + 8 + cu * (ww - 16), iy - 2, ih + 4);
      }
      // 2) modüle taşıyıcı ve zarf
      {
        const [x, y, ww, hh] = Lo.l2;
        panel(ctx, x, y, ww, hh, "Modüle edilmiş taşıyıcı", over ? "aşırı modülasyon: zarf sıfırı geçiyor" : "taşıyıcı yavaşlatılarak çizildi", over ? C.needle : null);
        const iy = y + 24, ih = hh - 30, xx = x + 8, wx = ww - 16;
        const cyc = Math.max(24, Math.round(wx / 8));
        const env = (u) => (1 + m * A(u)) / (1 + m);
        const ph0 = TAU * ((t0 * cyc) / WIN);
        midline(ctx, xx, iy + ih / 2, wx);
        trace(ctx, xx, iy, wx, ih, (u) => env(u) * Math.cos(ph0 + TAU * cyc * u), 1.05, rgba(C.I, 0.55), 1.1);
        // dedektörün gördüğü zarf: |1 + m·x|
        trace(ctx, xx, iy, wx, ih, (u) => Math.abs(env(u)), 1.05, C.amp, 1.8, 6);
        trace(ctx, xx, iy, wx, ih, (u) => -Math.abs(env(u)), 1.05, rgba(C.amp, 0.45), 1.2);
        if (m > 1) {
          // olması gereken (eksiye inen) zarf, kırmızı kesik çizgi
          ctx.save(); ctx.setLineDash([3, 3]);
          trace(ctx, xx, iy, wx, ih, (u) => { const e = env(u); return e < 0 ? e : NaN; }, 1.05, C.needle, 1.6);
          ctx.restore();
        }
        cursorLine(ctx, xx + cu * wx, iy - 2, ih + 4);
      }
      // 3) IQ düzlemi
      let I = 0, Q = 0;
      {
        const [x, y, ww, hh] = Lo.iq;
        panel(ctx, x, y, ww, hh, "IQ düzlemi");
        const cx = x + ww / 2, cy = y + hh / 2 + 10, r = Math.min(ww, hh - 50) / 2 - 16;
        V.iqPlane(ctx, cx, cy, r, { circle: false, grid: true });
        const v = (1 + m * A(cu)) / (1 + m);
        I = v * Math.cos(chain.phi); Q = v * Math.sin(chain.phi);
        const k = r * 0.92;
        // taşıyıcının tek başına boyu (ses yokken)
        ctx.save(); ctx.strokeStyle = rgba(C.ink, 0.22); ctx.setLineDash([2, 4]); ctx.beginPath(); ctx.arc(cx, cy, k / (1 + m), 0, TAU); ctx.stroke(); ctx.restore();
        // penceredeki bütün örnekler: aynı doğru üzerinde
        ctx.fillStyle = rgba(C.ink, 0.16);
        for (let i = 0; i < WIN; i += 4) {
          const vv = (1 + m * src.at(t0 + i)) / (1 + m);
          ctx.fillRect(cx + vv * Math.cos(chain.phi) * k - 1, cy - vv * Math.sin(chain.phi) * k - 1, 2, 2);
        }
        // iz
        trail.push([I, Q]); if (trail.length > 40) trail.shift();
        ctx.save(); ctx.lineCap = "round";
        for (let i = 1; i < trail.length; i++) {
          ctx.strokeStyle = rgba(C.amp, (i / trail.length) * 0.5); ctx.lineWidth = 5 * (i / trail.length);
          ctx.beginPath(); ctx.moveTo(cx + trail[i - 1][0] * k, cy - trail[i - 1][1] * k); ctx.lineTo(cx + trail[i][0] * k, cy - trail[i][1] * k); ctx.stroke();
        }
        ctx.restore();
        // izdüşümler
        const px = cx + I * k, py = cy - Q * k;
        ctx.save(); ctx.setLineDash([3, 3]); ctx.lineWidth = 1.2;
        ctx.strokeStyle = rgba(C.Q, 0.8); ctx.beginPath(); ctx.moveTo(px, py); ctx.lineTo(cx, py); ctx.stroke();
        ctx.strokeStyle = rgba(C.I, 0.8); ctx.beginPath(); ctx.moveTo(px, py); ctx.lineTo(px, cy); ctx.stroke();
        ctx.restore();
        V.dot(ctx, px, cy, 3.5, C.I); V.dot(ctx, cx, py, 3.5, C.Q);
        if (Math.abs(v) > 0.02) V.arrow(ctx, cx, cy, px, py, v < 0 ? C.needle : C.amp, 2.6, 11);
        V.dot(ctx, px, py, 4, v < 0 ? C.needle : C.amp, 12);
        V.text(ctx, `√(I² + Q²) = ${f2(Math.abs(v))}`, x + 10, y + hh - 10, { size: 12, color: C.amp, weight: 700 });
        if (v < 0) V.text(ctx, "ok ters döndü", x + ww - 10, y + hh - 10, { size: 12, color: C.needle, align: "right", weight: 700 });
      }
      // 4) spektrum
      {
        const [x, y, ww, hh] = Lo.sp;
        panel(ctx, x, y, ww, hh, "Spektrum", "taşıyıcıya göre, kHz");
        const sx = x + 8, sw = ww - 16, sy = y + 26, sh = hh - 26 - 30;
        const span = 1500, binHz = RATE / SN, nb = Math.round(span / binHz);
        V.dbGrid(ctx, { x: sx, y: sy, w: sw, h: sh, min: -90, max: 0, step: 30 });
        if (db) V.spectrum(ctx, { x: sx, y: sy, w: sw, h: sh, db, min: -90, max: 0, from: SN / 2 - nb, to: SN / 2 + nb + 1 });
        freqAxis(ctx, sx, sy + sh, sw, -span, span, (v) => (v === 0 ? "fc" : (v > 0 ? "+" : "−") + num(Math.abs(v) / 1000, 1)), 6);
        if (sw > 200) {
          V.text(ctx, "alt yan bant", sx + sw * 0.25, sy + 14, { align: "center", size: 11.5, color: C.ink2 });
          V.text(ctx, "üst yan bant", sx + sw * 0.75, sy + 14, { align: "center", size: 11.5, color: C.ink2 });
          V.text(ctx, "taşıyıcı", sx + sw / 2 + 6, sy + 14, { size: 11.5, color: C.amp, weight: 700 });
        }
      }
      // okumalar
      rM.set(pct(m));
      rO.set(over ? "aşırı modülasyon" : m < 0.005 ? "taşıyıcı yalnız" : "temiz");
      rO.className = "readout " + (over ? "cr" : "");
      rBW.set(bw ? khz(2 * bw, 1) : "–");
      rC.set(m < 0.005 ? "ses yok" : corrV ? num(corrV.r, 3) : "–");
    }
    st = canvas(cv, draw);

    let mt = 0;
    const lp = loop((dt) => {
      drv.tick(dt);
      vt += dt;
      frame++;
      if (frame % 3 === 0) measure();
      mt += dt;
      if (mt > 0.3) {
        mt = 0;
        const end = chain.src.w - 64;
        corrV = corr(chain.src, chain.dem, end, 9600, 6);
        // son 1 sn içinde 1 + m·x eksiye indi mi?
        let mn = Infinity; for (let i = end - RATE; i < end; i += 3) mn = Math.min(mn, chain.src.at(i));
        overT = 1 + chain.m * mn < 0 ? 1 : 0;
      }
      draw();
    });
    for (let i = 0; i < 20; i++) chain.produce(1024);
    measure();
    return {
      enter() { lp.start(); },
      leave() { lp.stop(); drv.stop(); listen.set(false); },
    };
  };

  /* ======================================================================
     2. FM
     ====================================================================== */
  Demos.fm = function (stage, slide) {
    const cv = h("canvas", { "aria-label": "Frekans modülasyonu: ses, modüle taşıyıcı, IQ düzleminde hızlanıp yavaşlayan ok ve spektrum" });
    const fill = h("div.fill.ch6-fill", cv);
    const chain = new FMChain();
    let sel = "fm";
    const drv = audioDriver(slide, chain, (r, out) => {
      const x = sel === "src" ? r.a : sel === "am" ? r.dA : r.d;
      for (let i = 0; i < out.length; i++) out[i] = clamp(x[i] * 0.6, -1, 1);
    });
    const devS = slider({ label: "Sapma", min: 1, max: 75, step: 1, value: 75, fmt: (v) => "±" + num(v, 0) + " kHz", oninput: (v) => { chain.dev = v * 1000; } });
    const noiseS = slider({
      label: "Gürültü", min: 0, max: 1, step: 0.01, value: 0, cls: "cn",
      fmt: (v) => (v < 0.005 ? "yok" : "C/N " + num(cnOf(v), 0) + " dB"),
      oninput: (v) => { chain.cn = v < 0.005 ? Infinity : cnOf(v); },
    });
    function cnOf(v) { return Math.round(36 - 34 * v); }
    const which = seg([["src", "Kaynak"], ["fm", "FM"], ["am", "AM"]], sel, (k) => (sel = k), "Duyulan ses");
    const listen = toggle("Dinle", false, (on) => (on ? drv.start() : drv.stop()));
    const rW = readout("Ses bant genişliği W"), rCar = readout("Carson: 2(Δf + W)"), rOcc = readout("Ölçülen (%99 güç)"),
      rFM = readout("Çıkış SNR: FM", "cph"), rAM = readout("AM (aynı gürültü)");
    const ctrl = h("div.controls", devS, noiseS, h("span.ch6-grp", h("span.lab", "Duyulan:"), which), listen, h("div.readouts.ch6-ro", rW, rCar, rOcc, rFM, rAM));
    stage.append(fill, ctrl);

    const WIN = 576;                 // 12 ms
    const SWEEP = 3.2;
    const TS = 0.11;                 // görsel örnekleme aralığı (sn)
    const F0 = 0.32;                 // ağır çekim "taşıyıcı" dönüşü (tur/sn)
    const SN = 4096, spec = new DSP.SpectrumAverager(SN), aspec = new DSP.SpectrumAverager(SN);
    const iqb = new Float32Array(2 * SN), abuf = new Float32Array(2 * SN);
    let st, db = null, W = 0, occ = 0, span = 200000, vt = 0, theta = 0, sAcc = 0, frame = 0;
    let samples = [], cF = null, cA = null;
    const vdem = new DSP.FMDemod();
    const dv = () => 0.26 * Math.sqrt(chain.dev / 75000); // görsel sapma (ölçeksiz çizim)

    function measure() {
      chain.lastIQ(iqb);
      db = spec.push(DSP.spectrum(iqb, SN), 0.3);
      const pw = Float64Array.from(db, (v) => 10 ** (v / 10));
      occ = occupiedBW(pw, chain.FS / SN);
      const src = chain.src, end = src.w;
      for (let i = 0; i < SN; i++) { abuf[2 * i] = src.at(end - SN + i); abuf[2 * i + 1] = 0; }
      const adb = aspec.push(DSP.spectrum(abuf, SN), 0.05);
      const ap = Float64Array.from(adb, (v) => 10 ** (v / 10)); ap[SN / 2] = 0;
      W = occupiedBW(ap, RATE / SN) / 2;
    }

    function layout(w, H) {
      const p = 10;
      if (w >= 560) {
        const top = Math.round(H * 0.46), lh = (top - p * 3) / 2, by = top, bh = H - by - p;
        const s = Math.min(bh, w * 0.42);
        return { l1: [p, p, w - 2 * p, lh], l2: [p, 2 * p + lh, w - 2 * p, lh], iq: [p, by, s, bh], sp: [2 * p + s, by, w - 3 * p - s, bh] };
      }
      const lh = H * 0.16, iqh = H * 0.38;
      return { l1: [p, p, w - 2 * p, lh], l2: [p, 2 * p + lh, w - 2 * p, lh], iq: [p, 3 * p + 2 * lh, w - 2 * p, iqh], sp: [p, 4 * p + 2 * lh + iqh, w - 2 * p, H - (5 * p + 2 * lh + iqh)] };
    }

    let t0 = 0;
    function draw() {
      if (!st) return;
      const { ctx, w, h: H } = st;
      ctx.clearRect(0, 0, w, H);
      const Lo = layout(w, H), src = chain.src;
      const A = (u) => src.at(t0 + Math.floor(u * WIN));
      const cu = (vt % SWEEP) / SWEEP;
      const k1 = 0.6 * Math.sqrt(chain.dev / 75000);

      // 1) ses ve çözülen örnekler
      {
        const [x, y, ww, hh] = Lo.l1;
        panel(ctx, x, y, ww, hh, "Ses", `${num(WIN / RATE * 1000, 0)} ms · imleç ${num(SWEEP / (WIN / RATE), 0)} kat ağır çekim`);
        const iy = y + 24, ih = hh - 30, xx = x + 8, wx = ww - 16;
        midline(ctx, xx, iy + ih / 2, wx);
        trace(ctx, xx, iy, wx, ih, A, 1.15, rgba(C.ink2, 0.95), 1.6);
        // faz farkından çözülen değerler (nane noktalar)
        for (const s of samples) {
          if (s.dec == null || s.t0 !== t0) continue;
          const age = clamp(1 - (vt - s.vt) / 2.4, 0, 1);
          if (!age) continue;
          V.dot(ctx, xx + s.u * wx, iy + ih / 2 - (clamp(s.dec, -1.3, 1.3) / 1.15) * (ih / 2), 3.2, rgba(C.phase, 0.25 + 0.75 * age));
        }
        cursorLine(ctx, xx + cu * wx, iy - 2, ih + 4);
      }
      // 2) modüle taşıyıcı (çizim): genlik sabit, sıklık sesle değişir
      {
        const [x, y, ww, hh] = Lo.l2;
        panel(ctx, x, y, ww, hh, "Modüle edilmiş taşıyıcı", "genlik sabit, sıklık sesle değişir");
        const iy = y + 24, ih = hh - 30, xx = x + 8, wx = ww - 16;
        const c0 = Math.max(16, Math.round(wx / 14));
        midline(ctx, xx, iy + ih / 2, wx);
        // fazı piksel piksel biriktir
        const N = Math.round(wx * 2), ph = new Float32Array(N + 1);
        let p = 0;
        for (let i = 0; i <= N; i++) { ph[i] = p; p += (TAU * c0 * (1 + k1 * A(i / N))) / N; }
        trace(ctx, xx, iy, wx, ih, (u) => Math.cos(ph[Math.round(u * N)]), 1.12, rgba(C.I, 0.75), 1.3);
        trace(ctx, xx, iy, wx, ih, () => 1, 1.12, C.amp, 1.6, 6);
        trace(ctx, xx, iy, wx, ih, () => -1, 1.12, rgba(C.amp, 0.45), 1.2);
        cursorLine(ctx, xx + cu * wx, iy - 2, ih + 4);
      }
      // 3) IQ düzlemi
      {
        const [x, y, ww, hh] = Lo.iq;
        panel(ctx, x, y, ww, hh, "IQ düzlemi", "ağır çekim");
        const cx = x + ww / 2, cy = y + hh / 2 + 6, r = Math.min(ww, hh - 54) / 2 - 16, k = r * 0.86;
        V.iqPlane(ctx, cx, cy, r, { circle: false, grid: true });
        // gerçek (240 kHz) örnekler: hepsi aynı çemberde; gürültü onları bulutlaştırır
        const noisy = isFinite(chain.cn);
        ctx.fillStyle = noisy ? rgba(C.noise, 0.5) : rgba(C.ink, 0.12);
        for (let i = 0; i < 4096; i += 6) ctx.fillRect(cx + iqb[2 * i] * k - 1, cy - iqb[2 * i + 1] * k - 1, 2, 2);
        ctx.strokeStyle = rgba(C.amp, 0.28); ctx.lineWidth = 1; ctx.beginPath(); ctx.arc(cx, cy, k, 0, TAU); ctx.stroke();
        // görsel örnekler ve faz farkı yayı
        const vis = samples.slice(-7);
        vis.forEach((s, i) => V.dot(ctx, cx + Math.cos(s.th) * k, cy - Math.sin(s.th) * k, 3.4, rgba(C.amp, 0.2 + (0.8 * (i + 1)) / vis.length)));
        if (vis.length >= 2) {
          const a0 = vis[vis.length - 2].th, a1 = vis[vis.length - 1].th, rr = k * 0.42;
          ctx.save();
          ctx.strokeStyle = rgba(C.phase, 0.5); ctx.lineWidth = 1; ctx.setLineDash([2, 3]);
          ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(cx + Math.cos(a0) * k, cy - Math.sin(a0) * k); ctx.stroke();
          ctx.setLineDash([]);
          ctx.strokeStyle = C.phase; ctx.lineWidth = 3; ctx.shadowColor = C.phase; ctx.shadowBlur = 8;
          ctx.beginPath(); ctx.arc(cx, cy, rr, -a0, -a1, a1 > a0); ctx.stroke();
          ctx.restore();
          const d = (a1 - a0) * 180 / Math.PI, dec = vis[vis.length - 1].dec;
          V.text(ctx, `Δφ ${num(d, 0)}° → ses ${dec == null ? "–" : (dec >= 0 ? "+" : "") + f2(dec)}`, x + ww - 10, y + hh - 10, { size: 12, color: C.phase, weight: 700, align: "right" });
        }
        V.arrow(ctx, cx, cy, cx + Math.cos(theta) * k, cy - Math.sin(theta) * k, C.amp, 2.6, 11);
        V.dot(ctx, cx + Math.cos(theta) * k, cy - Math.sin(theta) * k, 4, C.amp, 12);
        const spd = F0 + dv() * A(cu);
        V.text(ctx, `hız ×${num(spd / F0, 2)}`, x + 10, y + hh - 10, { size: 12, color: C.amp, weight: 700 });
      }
      // 4) spektrum
      {
        const [x, y, ww, hh] = Lo.sp;
        panel(ctx, x, y, ww, hh, "Spektrum", "kHz · saniyede 240.000 örnek");
        const sx = x + 8, sw = ww - 16, sy = y + 44, sh = hh - 44 - 30;
        const FS = chain.FS, binHz = FS / SN, half = Math.min(FS / 2, span / 2), nb = Math.round(half / binHz);
        V.dbGrid(ctx, { x: sx, y: sy, w: sw, h: sh, min: -100, max: 0, step: 25 });
        if (db) V.spectrum(ctx, { x: sx, y: sy, w: sw, h: sh, db, min: -100, max: 0, from: SN / 2 - nb, to: SN / 2 + nb + 1 });
        freqAxis(ctx, sx, sy + sh, sw, -half / 1000, half / 1000, (v) => (v > 0 ? "+" : v < 0 ? "−" : "") + num(Math.abs(v), Math.abs(v) < 10 && v % 1 ? 1 : 0), 6);
        // Carson köprüsü ve ölçülen %99 bant genişliği
        const X = (f) => sx + sw / 2 + (f / half) * (sw / 2);
        const car = 2 * (chain.dev + W);
        const bx0 = X(-car / 2), bx1 = X(car / 2), by = y + 32;
        ctx.save();
        ctx.strokeStyle = C.amp; ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.moveTo(bx0, by + 6); ctx.lineTo(bx0, by); ctx.lineTo(bx1, by); ctx.lineTo(bx1, by + 6); ctx.stroke();
        ctx.strokeStyle = rgba(C.amp, 0.25); ctx.setLineDash([2, 4]);
        ctx.beginPath(); ctx.moveTo(bx0, by + 6); ctx.lineTo(bx0, sy + sh); ctx.moveTo(bx1, by + 6); ctx.lineTo(bx1, sy + sh); ctx.stroke();
        ctx.restore();
        V.text(ctx, `Carson ${khz(car, car < 20000 ? 1 : 0)}`, (bx0 + bx1) / 2, by - 4, { align: "center", size: 11.5, color: C.amp, weight: 700 });
      }
      rW.set(W ? khz(W, 2) : "–");
      rCar.set(khz(2 * (chain.dev + W), 1));
      rOcc.set(isFinite(chain.cn) ? "gürültüde ölçülemez" : occ ? khz(occ, 1) : "–");
      rFM.set(snrOf(cF)); rAM.set(snrOf(cA));
    }
    st = canvas(cv, draw);

    let mt = 0;
    const lp = loop((dt) => {
      drv.tick(dt);
      const prevCu = (vt % SWEEP) / SWEEP;
      vt += dt; frame++;
      const cu = (vt % SWEEP) / SWEEP;
      // imleç başa dönünce yeni tetiklenmiş pencere al
      if (cu < prevCu || !t0) { t0 = trigger(chain.src, chain.src.w - 256, WIN, 1400); }
      const a = chain.src.at(t0 + Math.floor(cu * WIN));
      theta += TAU * (F0 + dv() * a) * dt;
      sAcc += dt;
      if (sAcc >= TS) {
        sAcc -= TS;
        // görsel örnek: faz farkı demodülatörüyle (DSP.FMDemod) çöz
        const o = vdem.process(Float32Array.of(Math.cos(theta), Math.sin(theta)))[0];
        const dec = (o / TS - F0) / dv();
        samples.push({ th: theta, u: cu, vt, t0, dec: samples.length ? dec : null });
        if (samples.length > 40) samples.shift();
      }
      span += (clamp(2.6 * (chain.dev + W), 8000, 240000) - span) * Math.min(1, dt * 4);
      if (frame % 3 === 0) measure();
      mt += dt;
      if (mt > 0.3) {
        mt = 0;
        const end = chain.src.w - 64;
        cF = corr(chain.src, chain.dem, end, 9600, 16);
        cA = corr(chain.src, chain.demAM, end, 9600, 16);
      }
      draw();
    });
    for (let i = 0; i < 20; i++) chain.produce(1024);
    measure();
    return {
      enter() { lp.start(); },
      leave() { lp.stop(); drv.stop(); listen.set(false); },
    };
  };

  /* ======================================================================
     3. Dijital: bitleri dalgaya yüklemek
     ====================================================================== */
  const SCHEMES = [
    ["ask", "ASK"], ["fsk", "FSK"], ["bpsk", "BPSK"], ["qpsk", "QPSK"], ["qam16", "16-QAM"],
  ];
  const BPS = { ask: 1, fsk: 1, bpsk: 1, qpsk: 2, qam16: 4 };
  const NB = 16;

  Demos.digital = function (stage, slide) {
    const cv = h("canvas", { "aria-label": "Dijital modülasyon: I ve Q dalga biçimleri, gönderilen dalga ve IQ düzleminde semboller" });
    const fill = h("div.fill.ch6-fill", cv);
    const bits = Uint8Array.from("1011001110001101".split("").map(Number));
    let scheme = "bpsk", mode = "slow";
    const SYM = 0.75, PAUSE = 0.9;
    const bitrow = h("div.ch6-bits", { role: "group", "aria-label": "Bitler (tıklayınca değişir)" });
    const pick = seg(SCHEMES, scheme, (k) => { scheme = k; rebuild(); }, "Modülasyon türü");
    const speed = seg([["slow", "Ağır çekim"], ["fast", "1200 baud"]], mode, (k) => { mode = k; }, "Ses hızı");
    const listen = toggle("Dinle", false, (on) => (on ? startAudio() : stopAudio()));
    const rK = readout("Sembol başına"), rN = readout("16 bit"), rS = readout("16 sembolde"), rCur = readout("Şu anki sembol", "camp");
    const top = h("div.controls.top", pick, bitrow);
    const ctrl = h("div.controls", h("span.ch6-grp", h("span.lab", "Ses:"), speed), listen, h("div.readouts.ch6-ro", rK, rN, rS, rCur));
    stage.append(top, fill, ctrl);

    let st, k = 1, nSym = 16, pts = null, sgn = null, groups = [];
    function rebuild() {
      k = BPS[scheme]; nSym = NB / k;
      if (scheme === "fsk") { sgn = Array.from(bits, (b) => (b ? 1 : -1)); pts = null; }
      else { const m = DSP.mapBits(bits, scheme); pts = []; for (let i = 0; i < nSym; i++) pts.push([m[2 * i], m[2 * i + 1]]); }
      bitrow.textContent = ""; groups = [];
      for (let s = 0; s < nSym; s++) {
        const g = h("span.grp", { "data-s": "S" + (s + 1) });
        for (let b = 0; b < k; b++) {
          const i = s * k + b;
          const btn = h("button.bit", { type: "button", "aria-label": "Bit " + (i + 1), "aria-pressed": !!bits[i] }, String(bits[i]));
          btn.addEventListener("click", () => { bits[i] ^= 1; rebuild(); });
          g.append(btn);
        }
        bitrow.append(g); groups.push(g);
      }
      rK.set(k + " bit");
      rN.set(nSym + " sembol");
      rS.set(NB * k + " bit");
      draw();
    }
    const cycleLen = () => nSym * SYM + PAUSE;
    // sembol konumu (0…nSym); duraklamada son sembolde kalır
    function posAt(t) { const tt = ((t % cycleLen()) + cycleLen()) % cycleLen(); return Math.min(tt / SYM, nSym - 1e-6); }
    const TR = 0.2; // geçiş payı (sembolün başı)
    const easeC = (x) => 0.5 - 0.5 * Math.cos(Math.PI * clamp(x, 0, 1));
    // x (sembol cinsinden zaman) anında temel bant I, Q
    function bb(x) {
      x = clamp(x, 0, nSym - 1e-6);
      const i = Math.floor(x), f = x - i;
      if (scheme === "fsk") {
        let p = 0; for (let j = 0; j < i; j++) p += sgn[j];
        const ph = TAU * (p + sgn[i] * f);
        return [Math.cos(ph), Math.sin(ph)];
      }
      const cur = pts[i], prev = i > 0 ? pts[i - 1] : [0, 0];
      const e = f < TR ? easeC(f / TR) : 1;
      return [prev[0] + (cur[0] - prev[0]) * e, prev[1] + (cur[1] - prev[1]) * e];
    }
    const FC = 2; // görsel taşıyıcı: sembol başına 2 devir
    const rf = (x) => { const [I, Q] = bb(x); return I * Math.cos(TAU * FC * x) - Q * Math.sin(TAU * FC * x); };
    const fmtB = (s) => { let o = ""; for (let b = 0; b < k; b++) o += bits[s * k + b]; return o; };

    let pt = 0;
    function layout(w, H) {
      const p = 10;
      if (w >= 560) {
        const topH = Math.round(H * 0.52), by = topH, bh = H - by - p, s = Math.min(bh, w * 0.46);
        return { wave: [p, p, w - 2 * p, topH - 2 * p], iq: [p, by, s, bh], bar: [2 * p + s, by, w - 3 * p - s, bh] };
      }
      const wh = H * 0.38, iqh = H * 0.34;
      return { wave: [p, p, w - 2 * p, wh], iq: [p, 2 * p + wh, w - 2 * p, iqh], bar: [p, 3 * p + wh + iqh, w - 2 * p, H - (4 * p + wh + iqh)] };
    }

    function draw() {
      if (!st || (!pts && !sgn)) return;
      const { ctx, w, h: H } = st;
      ctx.clearRect(0, 0, w, H);
      const Lo = layout(w, H);
      const pos = posAt(pt), si = Math.floor(pos);
      const AMP = 1.5;
      // 1) dalga biçimleri
      {
        const [x, y, ww, hh] = Lo.wave;
        panel(ctx, x, y, ww, hh, "Zamanda: 16 sembollük süre", `${nSym} sembol kullanıldı`);
        const xx = x + 70, wx = ww - 80, ly = y + 40, lh = (hh - 48) / 3;
        const slot = wx / NB, used = nSym * slot;
        // şu anki sembol sütunu
        ctx.fillStyle = rgba(C.ink, 0.06); ctx.fillRect(xx + si * slot, ly - 18, slot, 3 * lh + 18);
        // sembol sınırları ve bit etiketleri
        ctx.strokeStyle = rgba(C.ink, 0.1); ctx.lineWidth = 1;
        ctx.beginPath(); for (let s = 0; s <= nSym; s++) { const px = Math.round(xx + s * slot) + 0.5; ctx.moveTo(px, ly - 16); ctx.lineTo(px, ly + 3 * lh); } ctx.stroke();
        const fsz = slot > 30 ? 12 : slot > 18 ? 10.5 : 9;
        for (let s = 0; s < nSym; s++) V.text(ctx, fmtB(s), xx + (s + 0.5) * slot, ly - 4, { align: "center", size: fsz, color: s === si ? C.ink : C.muted, weight: s === si ? 700 : 400 });
        // kullanılmayan süre: taranmış alan
        if (nSym < NB) {
          ctx.save();
          ctx.beginPath(); ctx.rect(xx + used, ly - 16, wx - used, 3 * lh + 16); ctx.clip();
          ctx.strokeStyle = rgba(C.ink, 0.07); ctx.lineWidth = 1;
          ctx.beginPath(); for (let d = -hh; d < wx; d += 9) { ctx.moveTo(xx + used + d, ly + 3 * lh); ctx.lineTo(xx + used + d + 3 * lh + 16, ly - 16); } ctx.stroke();
          ctx.restore();
          const free = NB * k - NB;
          V.text(ctx, `aynı sürede +${free} bit daha sığar`, xx + used + (wx - used) / 2, ly + 1.5 * lh + 5, { align: "center", size: wx - used > 160 ? 13 : 11, color: C.ink, weight: 700 });
        }
        const lanes = [["I", C.I, (u) => bb(u)[0]], ["Q", C.Q, (u) => bb(u)[1]], ["Dalga", C.amp, rf]];
        lanes.forEach(([lab, col, fn], j) => {
          const yy = ly + j * lh;
          midline(ctx, xx, yy + lh / 2, wx);
          V.text(ctx, lab, x + 12, yy + lh / 2 + 5, { size: lab.length > 1 ? 13 : 17, color: col, font: FONT.display, weight: 800 });
          const step = j === 2 ? 6 : 3; // dalga daha sık örneklenir
          ctx.save(); ctx.beginPath(); ctx.rect(xx, yy, used, lh); ctx.clip();
          ctx.strokeStyle = j === 2 ? rgba(C.amp, 0.85) : col; ctx.lineWidth = j === 2 ? 1.3 : 2; ctx.lineJoin = "round";
          ctx.beginPath();
          const N = Math.round(used * step / 3 * (j === 2 ? 1 : 1));
          for (let i = 0; i <= N; i++) {
            const u = (i / N) * nSym, v = fn(u), px = xx + (i / N) * used, py = yy + lh / 2 - (v / AMP) * (lh / 2 - 2);
            i ? ctx.lineTo(px, py) : ctx.moveTo(px, py);
          }
          ctx.stroke(); ctx.restore();
        });
        cursorLine(ctx, xx + pos * slot, ly + 2, 3 * lh - 2);
      }
      // 2) IQ düzlemi: takımyıldız
      {
        const [x, y, ww, hh] = Lo.iq;
        panel(ctx, x, y, ww, hh, "IQ düzleminde semboller");
        const cx = x + ww / 2, cy = y + hh / 2 + 10, r = Math.min(ww, hh - 50) / 2 - 16, kk = r / AMP;
        V.iqPlane(ctx, cx, cy, r, { circle: false, grid: true });
        if (scheme === "fsk") {
          ctx.strokeStyle = rgba(C.ink, 0.3); ctx.lineWidth = 1; ctx.beginPath(); ctx.arc(cx, cy, kk, 0, TAU); ctx.stroke();
          // yön okları: 1 → saat yönünün tersine, 0 → saat yönünde
          const cur = sgn[si];
          [[1, "1: +f, sola döner"], [-1, "0: −f, sağa döner"]].forEach(([s, lab], j) => {
            const rr = kk * (j ? 0.62 : 1.18), a0 = j ? -0.3 : 0.35, a1 = a0 + s * 1.1;
            ctx.save(); ctx.strokeStyle = s === cur ? C.amp : rgba(C.ink, 0.3); ctx.lineWidth = 2;
            ctx.beginPath(); ctx.arc(cx, cy, rr, -a0, -a1, s > 0); ctx.stroke(); ctx.restore();
            const ex = cx + Math.cos(a1) * rr, ey = cy - Math.sin(a1) * rr, tg = a1 + (s * Math.PI) / 2;
            V.arrow(ctx, ex - Math.cos(tg) * 6, ey + Math.sin(tg) * 6, ex, ey, s === cur ? C.amp : rgba(C.ink, 0.3), 2, 8);
            V.text(ctx, lab, x + 10, y + hh - 10 - (1 - j) * 17, { size: 11.5, color: s === cur ? C.ink : C.muted, weight: s === cur ? 700 : 400 });
          });
        } else {
          const P = DSP.CONST[scheme].pts;
          P.forEach((p, v) => {
            const px = cx + p[0] * kk, py = cy - p[1] * kk, on = pts[si] && pts[si][0] === p[0] && pts[si][1] === p[1];
            V.dot(ctx, px, py, on ? 7 : 5, on ? C.ink : rgba(C.ink, 0.42), on ? 16 : 0);
            let lab = v.toString(2).padStart(k, "0");
            V.text(ctx, lab, px, py + (p[1] > 0.01 || scheme === "ask" || scheme === "bpsk" ? -11 : 19), { align: "center", size: k === 4 ? 10.5 : 12, color: on ? C.ink : C.muted, weight: on ? 700 : 400 });
          });
        }
        // iz: son 1,3 sembol
        const N = 50;
        ctx.save(); ctx.lineCap = "round";
        let pp = null;
        for (let i = 0; i <= N; i++) {
          const u = Math.max(0, pos - 1.3 + (1.3 * i) / N);
          const [I, Q] = bb(u), q = [cx + I * kk, cy - Q * kk];
          if (pp) { ctx.strokeStyle = rgba(C.amp, (i / N) * 0.6); ctx.lineWidth = 1 + 2.5 * (i / N); ctx.beginPath(); ctx.moveTo(pp[0], pp[1]); ctx.lineTo(q[0], q[1]); ctx.stroke(); }
          pp = q;
        }
        ctx.restore();
        const [I, Q] = bb(pos);
        if (Math.hypot(I, Q) > 0.05) V.arrow(ctx, cx, cy, cx + I * kk, cy - Q * kk, C.amp, 2.4, 10);
        V.dot(ctx, cx + I * kk, cy - Q * kk, 4, C.amp, 12);
        rCur.set(`S${si + 1}: ${fmtB(si)}`);
      }
      // 3) aynı sürede kaç bit
      {
        const [x, y, ww, hh] = Lo.bar;
        panel(ctx, x, y, ww, hh, "16 sembolde taşınan bit");
        const n = SCHEMES.length, top = y + 32, rowH = Math.min(34, (hh - 62) / n), lw = 64, bw = ww - lw - 56;
        SCHEMES.forEach(([key, lab], j) => {
          const yy = top + j * rowH, on = key === scheme, val = NB * BPS[key];
          V.text(ctx, lab, x + 12, yy + rowH / 2 + 5, { size: 14, color: on ? C.ink : C.ink2, font: FONT.display, weight: on ? 800 : 600 });
          const bwid = (val / 64) * bw;
          ctx.fillStyle = on ? C.amp : rgba(C.ink, 0.16);
          ctx.beginPath(); ctx.roundRect(x + lw, yy + rowH * 0.22, Math.max(4, bwid), rowH * 0.56, 3); ctx.fill();
          // bit kutucukları (sembol başına bit)
          V.text(ctx, String(val), x + lw + bwid + 8, yy + rowH / 2 + 5, { size: 13, color: on ? C.ink : C.muted, weight: 700 });
        });
        V.text(ctx, "bit hızı = sembol hızı × sembol başına bit", x + 12, y + hh - 10, { size: 11.5, color: C.muted });
      }
      groups.forEach((g, i) => g.classList.toggle("cur", i === si));
    }
    st = canvas(cv, draw);

    /* --- ses: ses aralığına taşınmış modem --- */
    let stream = null, aT = 0, aPh = 0, sI = 0, sQ = 0, mute = 1;
    function audioFill(out, rate) {
      const al = 1 - Math.exp(-1 / (rate * 0.0015));
      for (let i = 0; i < out.length; i++) {
        let I = 0, Q = 0, f = 1800, on = 1;
        if (mode === "fast") {
          const s = Math.floor(aT * 1200) % nSym;
          if (scheme === "fsk") { f = sgn[s] > 0 ? 1200 : 2200; I = 1; }
          else { I = pts[s][0]; Q = pts[s][1]; }
        } else {
          const tt = aT % cycleLen();
          if (tt >= nSym * SYM) on = 0;
          const s = Math.min(nSym - 1, Math.floor(tt / SYM));
          if (scheme === "fsk") { f = sgn[s] > 0 ? 1200 : 2200; I = 1; }
          else { I = pts[s][0]; Q = pts[s][1]; }
        }
        if (scheme === "ask") f = 1700;
        mute += (on - mute) * 0.002;
        sI += (I - sI) * al; sQ += (Q - sQ) * al;
        aPh += (TAU * f) / rate; if (aPh > TAU) aPh -= TAU;
        out[i] = 0.32 * mute * (sI * Math.cos(aPh) - sQ * Math.sin(aPh));
        aT += 1 / rate;
      }
    }
    function startAudio() { if (!stream) { aT = pt; stream = Sound.stream(slide, audioFill, { rate: RATE }); } }
    function stopAudio() { if (stream) { stream.stop(); stream = null; } }

    const lp = loop((dt) => {
      // ağır çekimde dinlerken imleç sesi izler
      if (stream && mode === "slow" && Sound.unlocked && Sound.ctx && stream.next > 0) pt = aT - Math.max(0, stream.next - Sound.ctx.currentTime);
      else pt += dt;
      draw();
    });
    rebuild();
    return {
      enter() { lp.start(); },
      leave() { lp.stop(); stopAudio(); listen.set(false); },
    };
  };

  /* ---------------- hayalet el senaryoları ---------------- */
  window.GUIDE_SCENARIOS = Object.assign(window.GUIDE_SCENARIOS || {}, {
    am: [{ slide: "label:Modülasyon derinliği", to: 135 }, { wait: 1400 }, { slide: "label:Modülasyon derinliği", to: 60 }],
    fm: [{ slide: "label:Sapma", to: 5 }, { wait: 1200 }, { slide: "label:Gürültü", to: 0.7 }],
    dijital: [{ click: "aria:Bit 2" }, { click: "=QPSK" }, { wait: 600 }, { click: "=16-QAM" }],
  });
})();

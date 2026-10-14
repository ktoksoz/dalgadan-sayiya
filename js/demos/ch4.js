/* Bölüm 4: Spektrum ve şelale
   fourier     : dönen okların (epicycle) toplamı kare / testere / üçgen dalga çizer; harmonik çubukları ve ses
   fft         : IQ tamponu → pencere → FFT → spektrum; kutu genişliği, sızıntı, ortalama
   desibel     : doğrusal ↔ dB ölçek geçişi; dBFS, gürültü tabanı, A/B işaretçileriyle dB farkı
   selale      : Signals.Band ile gerçek zamanlı sentetik bant → canlı spektrum + şelale; fareyle okuma, dinleme
   sinyaliBul  : mini oyun; gürültüde beliren kısa yayınları yakala */
(function () {
  const { C, FONT, rgba, h, canvas, loop, clamp, lerp, ease, slider, seg, toggle, num, hz } = L;
  const TAU = Math.PI * 2;
  const STATS = (window.__ch4 = window.__ch4 || { fps: {}, audio: {} });
  // ses düzeyi (RMS) ölçümü: otomatik test için
  function rms(id, a) { let e = 0; for (let i = 0; i < a.length; i++) e += a[i] * a[i]; STATS.audio[id] = +Math.sqrt(e / (a.length || 1)).toFixed(4); }

  /* ---------- ortak yardımcılar ---------- */
  function shell(stage, label) {
    const cv = h("canvas", { "aria-label": label, role: "img" });
    const fill = h("div.fill", cv);
    const ctrl = h("div.controls");
    stage.append(fill, ctrl);
    return { cv, fill, ctrl };
  }
  function readout(k, v = "–", cls) {
    const vv = h("span.v", v);
    const el = h("div.readout" + (cls ? "." + cls : ""), h("span.k", k), vv);
    el.set = (s) => { if (vv.textContent !== s) vv.textContent = s; };
    return el;
  }
  // kare hızı ölçer: 3 sn'lik pencerelerde ortalama fps ve kare başına iş süresi
  function fpsMeter(id, el) {
    let n = 0, t0 = 0, wsum = 0;
    return {
      tick(workMs) {
        const now = performance.now();
        if (!t0) { t0 = now; return; }
        n++; wsum += workMs || 0;
        if (now - t0 >= 3000) {
          const fps = (n * 1000) / (now - t0), work = wsum / n;
          STATS.fps[id] = { fps: +fps.toFixed(1), workMs: +work.toFixed(2) };
          if (el) el.textContent = `${num(fps, 0)} fps · kare başına ${num(work, 1)} ms`;
          n = 0; wsum = 0; t0 = now;
        }
      },
      reset() { n = 0; t0 = 0; wsum = 0; },
    };
  }
  const dbs = (v, d = 1) => num(v, d) + " dB";
  const dbfs = (v, d = 1) => num(v, d) + " dBFS";
  function ratioText(r) {
    if (r < 10) return num(r, 2);
    if (r < 1e6) return num(r, 0);
    if (r < 1e9) return num(r / 1e6, r < 1e7 ? 2 : 1) + " milyon";
    return num(r / 1e9, 1) + " milyar";
  }
  // Gauss gürültüsü tablosu (örnek başına log/sqrt hesaplamamak için)
  const GN = 1 << 16, GT = new Float32Array(GN);
  (() => { const r = DSP.rng(4242); for (let i = 0; i < GN; i++) GT[i] = DSP.gaussian(r); })();
  // kısa sesler (Sound.play)
  function beep(freqs, dur = 0.09, gain = 0.35) {
    const R = 48000, n = Math.round(dur * R * freqs.length), out = new Float32Array(n), seg = Math.round(dur * R);
    let ph = 0;
    for (let i = 0; i < n; i++) {
      const k = Math.min(freqs.length - 1, Math.floor(i / seg)), t = (i % seg) / seg;
      ph += (TAU * freqs[k]) / R;
      const env = Math.min(1, t * 30) * Math.min(1, (1 - t) * 12);
      out[i] = Math.sin(ph) * env * gain;
    }
    return out;
  }
  // radyum dolgulu spektrum yolu (özel Y eşlemesiyle: dB ↔ doğrusal geçişi için)
  function radiumFill(ctx, y, hgt) {
    const gr = ctx.createLinearGradient(0, y + hgt, 0, y);
    L.CMAP_STOPS.forEach(([t, c]) => gr.addColorStop(t, rgba(c, 0.15 + 0.55 * t)));
    return gr;
  }
  function roundRect(ctx, x, y, w, hh, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + hh, r); ctx.arcTo(x + w, y + hh, x, y + hh, r);
    ctx.arcTo(x, y + hh, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
  }
  // tuval üstüne okunaklı etiket (koyu zeminli)
  function tag(ctx, s, x, y, { color = C.ink, size = 12, align = "left", bg = "rgba(10,20,24,0.82)", weight = 700, font = FONT.body } = {}) {
    ctx.font = `${weight} ${size}px ${font}`;
    const w = ctx.measureText(s).width + 12, hh = size + 8;
    const x0 = align === "right" ? x - w : align === "center" ? x - w / 2 : x;
    ctx.fillStyle = bg; roundRect(ctx, x0, y - hh + 4, w, hh, 3); ctx.fill();
    V.text(ctx, s, x0 + 6, y - 1, { color, size, weight, font });
    return w;
  }

  /* =====================================================================
     1. Fourier: dönen okların toplamı
     ===================================================================== */
  const WAVES = {
    square: {
      terms: (n) => Array.from({ length: n }, (_, j) => { const k = 2 * j + 1; return [k, 4 / (Math.PI * k)]; }),
      ideal: (u) => ((((u % 1) + 1) % 1) < 0.5 ? 1 : -1), jump: 2,
    },
    saw: {
      terms: (n) => Array.from({ length: n }, (_, j) => { const k = j + 1; return [k, ((k % 2 ? 1 : -1) * 2) / (Math.PI * k)]; }),
      ideal: (u) => { const v = ((u % 1) + 1) % 1; return 2 * (((v + 0.5) % 1) - 0.5); }, jump: 2,
    },
    tri: {
      terms: (n) => Array.from({ length: n }, (_, j) => { const k = 2 * j + 1; return [k, ((j % 2 ? -1 : 1) * 8) / (Math.PI * Math.PI * k * k)]; }),
      ideal: (u) => { const v = ((u % 1) + 1) % 1; return 1 - 4 * Math.abs(((v + 0.25) % 1) - 0.5); }, jump: 0,
    },
  };

  Demos.fourier = function (stage, slide) {
    const { cv, fill, ctrl } = shell(stage, "Dönen okların toplamı: uç uca eklenmiş oklar bir dalga biçimi çiziyor; altta harmoniklerin genlikleri");
    let wave = "square", N = 3, f0 = 220, theta = 0, terms = WAVES.square.terms(N);
    let stats = { rms: 0, over: 0 };
    const VIS_HZ = 0.22; // okların ekrandaki dönüş hızı (tur/sn)

    function recompute() {
      terms = WAVES[wave].terms(N);
      // kısmi toplam ile ideal dalga arasındaki fark: RMS hata ve tepe aşımı (ölçülür)
      const M = 4096, W = WAVES[wave];
      let e2 = 0, p2 = 0, mx = -Infinity;
      for (let i = 0; i < M; i++) {
        const u = i / M, x = TAU * u;
        let s = 0; for (const [k, a] of terms) s += a * Math.sin(k * x);
        const id = W.ideal(u);
        e2 += (s - id) ** 2; p2 += id * id; if (s > mx) mx = s;
      }
      stats.rms = Math.sqrt(e2 / p2) * 100;
      stats.over = W.jump ? ((mx - 1) / W.jump) * 100 : null;
      const kmax = terms[terms.length - 1][0];
      roN.set(String(N));
      roK.set(`${kmax}f = ${hz(kmax * f0)}`);
      roE.set("%" + num(stats.rms, 1));
      roO.set(stats.over == null ? "yok (sıçrama yok)" : "sıçramaya göre %" + num(stats.over, 1));
      setTargets();
      draw();
    }

    function draw() {
      if (!st) return;
      const { ctx, w, h: H } = st;
      ctx.fillStyle = C.stage; ctx.fillRect(0, 0, w, H);
      const narrow = w < 560;
      const barH = clamp(H * 0.27, 96, 170), topH = H - barH;
      const R = Math.min(topH * 0.28, w * (narrow ? 0.17 : 0.12));
      const cx = Math.max(R * 1.4 + 14, w * (narrow ? 0.24 : 0.2)), cy = topH * 0.52;
      const x0 = cx + R * 1.5 + (narrow ? 14 : 34), x1 = w - 18, W2 = x1 - x0;
      const amp = R * 0.92; // dalganın ±1 karşılığı

      // dalga alanı: eksen ve ±1 çizgileri
      ctx.strokeStyle = rgba(C.line, 1); ctx.lineWidth = 1;
      ctx.beginPath();
      [-1, 1].forEach((v) => { const y = Math.round(cy - v * amp) + 0.5; ctx.moveTo(x0, y); ctx.lineTo(x1, y); });
      ctx.stroke();
      ctx.strokeStyle = rgba(C.ink, 0.22); ctx.beginPath(); ctx.moveTo(x0, Math.round(cy) + 0.5); ctx.lineTo(x1, Math.round(cy) + 0.5); ctx.stroke();
      V.text(ctx, "+1", x0 - 8, cy - amp + 4, { align: "right", size: 11, color: C.muted });
      V.text(ctx, "−1", x0 - 8, cy + amp + 4, { align: "right", size: 11, color: C.muted });
      V.text(ctx, narrow ? "zaman →" : "zaman →  (geçmiş sağa akar)", x0, 22, { size: 12, color: C.muted });

      // ideal dalga (hedef): kesikli, soluk
      const PER = 2; // ekranda gösterilen dönem sayısı
      const ideal = WAVES[wave].ideal, u0 = theta / TAU;
      ctx.save();
      ctx.setLineDash([4, 5]); ctx.strokeStyle = rgba(C.ink2, 0.45); ctx.lineWidth = 1.3;
      ctx.beginPath();
      for (let px = 0; px <= W2; px += 1) {
        const y = cy - ideal(u0 - (px / W2) * PER) * amp;
        px ? ctx.lineTo(x0 + px, y) : ctx.moveTo(x0, y);
      }
      ctx.stroke(); ctx.restore();

      // kısmi toplam: dönen okların ucunun yüksekliği
      ctx.save();
      ctx.lineJoin = "round";
      ctx.beginPath();
      for (let px = 0; px <= W2; px += 1.5) {
        const x = theta - (px / W2) * PER * TAU;
        let s = 0; for (const [k, a] of terms) s += a * Math.sin(k * x);
        const y = cy - s * amp;
        px ? ctx.lineTo(x0 + px, y) : ctx.moveTo(x0, y);
      }
      ctx.strokeStyle = rgba(C.ink, 0.12); ctx.lineWidth = 8; ctx.stroke(); // hafif ışıma
      ctx.strokeStyle = C.ink; ctx.lineWidth = 2.4; ctx.stroke();
      ctx.restore();

      // dönen oklar (epicycle)
      let px = cx, py = cy;
      terms.forEach(([k, a], j) => {
        const r = Math.abs(a) * amp, th = k * theta + (a < 0 ? Math.PI : 0);
        const nx = px + r * Math.cos(th), ny = py - r * Math.sin(th);
        if (r > 0.6) {
          ctx.strokeStyle = rgba(C.ink, j === 0 ? 0.2 : 0.11); ctx.lineWidth = 1;
          ctx.beginPath(); ctx.arc(px, py, r, 0, TAU); ctx.stroke();
        }
        const al = clamp(0.95 - j * 0.05, 0.35, 0.95);
        if (r > 2) V.arrow(ctx, px, py, nx, ny, rgba(C.ink, al), j === 0 ? 2.6 : 1.8, j === 0 ? 10 : 7);
        else { ctx.strokeStyle = rgba(C.ink, al); ctx.lineWidth = 1.2; ctx.beginPath(); ctx.moveTo(px, py); ctx.lineTo(nx, ny); ctx.stroke(); }
        px = nx; py = ny;
      });
      V.dot(ctx, cx, cy, 2.5, rgba(C.ink, 0.6));
      // uçtan dalgaya bağlantı
      ctx.save(); ctx.setLineDash([3, 4]); ctx.strokeStyle = rgba(C.ink, 0.5); ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(px, py); ctx.lineTo(x0, py); ctx.stroke(); ctx.restore();
      V.dot(ctx, px, py, 4, C.ink, 10);
      V.dot(ctx, x0, py, 4.5, C.ink, 12);
      V.text(ctx, `${N} ok`, cx, Math.min(topH - 8, cy + R * 1.45 + 18), { align: "center", size: 13, color: C.ink2, weight: 700 });

      // harmonik çubukları: spektrum önizlemesi (radyum renkleri)
      const by = topH + 8, bh = barH - 40, bx = 46, bw = w - bx - 18;
      ctx.fillStyle = rgba(C.bg, 0.55); ctx.fillRect(0, topH, w, barH);
      ctx.strokeStyle = rgba(C.line, 1); ctx.beginPath(); ctx.moveTo(0, topH + 0.5); ctx.lineTo(w, topH + 0.5); ctx.stroke();
      V.text(ctx, w < 520 ? "Harmonik genlikleri" : "Harmoniklerin genliği: dalganın spektrumu", bx, by + 14, { size: 12.5, color: C.ink2, weight: 700 });
      const all = WAVES[wave].terms(50);
      const kTop = terms[terms.length - 1][0];
      const kShow = clamp(Math.ceil(Math.max(kTop * 1.25, wave === "saw" ? 12 : 15)), 12, 100);
      const a1 = Math.abs(all[0][1]);
      const step = bw / kShow, base = by + bh + 4, top = by + 26, span = base - top;
      // eksen
      ctx.strokeStyle = rgba(C.ink, 0.35); ctx.beginPath(); ctx.moveTo(bx, base + 0.5); ctx.lineTo(bx + bw, base + 0.5); ctx.stroke();
      for (const [k, a] of all) {
        if (k > kShow) break;
        const on = k <= kTop, v = Math.abs(a) / a1;
        const x = bx + (k - 0.5) * step, bwid = Math.max(2, Math.min(18, step * 0.62));
        const hh = v * span;
        if (on) {
          ctx.fillStyle = L.cmap(0.45 + 0.55 * Math.sqrt(v)); ctx.fillRect(x - bwid / 2, base - hh, bwid, hh);
          ctx.fillStyle = C.ink; ctx.fillRect(x - bwid / 2, base - hh - 1, bwid, 2);
        } else {
          ctx.strokeStyle = rgba(C.ink, 0.22); ctx.setLineDash([2, 3]);
          ctx.strokeRect(Math.round(x - bwid / 2) + 0.5, Math.round(base - hh) + 0.5, Math.max(1, Math.round(bwid) - 1), Math.round(hh));
          ctx.setLineDash([]);
        }
      }
      // k etiketleri: aralık uygunsa her biri, değilse seçilmişler
      const lab = V.ticks(1, kShow, Math.max(3, Math.floor(bw / 60))).major.filter((k) => k >= 1);
      const labs = step > 26 ? Array.from({ length: kShow }, (_, i) => i + 1) : [1, ...lab.filter((k) => k > 1)];
      labs.forEach((k) => {
        const x = bx + (k - 0.5) * step;
        V.text(ctx, k === 1 ? "1f" : k + "f", x, base + 15, { align: "center", size: 11, color: C.muted, font: FONT.display, weight: 600 });
      });
      V.text(ctx, `f = ${hz(f0)}`, bx + bw, by + 14, { align: "right", size: 12, color: C.ink2 });
      V.text(ctx, "genlik", 8, top + 10, { size: 10.5, color: C.muted });
    }
    const st = canvas(cv, draw);

    /* ses: harmonikleri toplayan sentezleyici; terim eklenip çıkarılırken genlikler yumuşakça değişir */
    const KMAX = 100, cur = new Float32Array(KMAX + 1), tgt = new Float32Array(KMAX + 1), dg = new Float32Array(KMAX + 1);
    function setTargets() { tgt.fill(0); terms.forEach(([k, a]) => { if (k <= KMAX) tgt[k] = a; }); }
    let aph = 0, stream = null;
    function fillAudio(out, rate) {
      const n = out.length, wv = (TAU * f0) / rate;
      let kTop = 0;
      for (let k = 1; k <= KMAX; k++) {
        const t = k * f0 < rate * 0.45 ? tgt[k] : 0; // Nyquist'in altında kalan harmonikler
        dg[k] = (t - cur[k]) / n;
        if (cur[k] || t) kTop = k;
      }
      for (let i = 0; i < n; i++) {
        const c2 = 2 * Math.cos(aph);
        let s2 = 0, s1 = Math.sin(aph), sum = 0;
        for (let k = 1; k <= kTop; k++) {
          const g = cur[k] + dg[k] * i;
          if (g) sum += g * s1;
          const s0 = c2 * s1 - s2; s2 = s1; s1 = s0; // sin(kφ) yinelemesi
        }
        out[i] = sum * 0.24;
        aph += wv; if (aph > TAU) aph -= TAU;
      }
      for (let k = 1; k <= KMAX; k++) cur[k] += dg[k] * n;
      rms("fourier", out);
    }

    // kontroller
    const wSeg = seg([["square", "Kare"], ["saw", "Testere"], ["tri", "Üçgen"]], wave, (k) => { wave = k; recompute(); }, "Dalga biçimi");
    const nSl = slider({ label: "Harmonik sayısı", min: 1, max: 50, step: 1, value: N, fmt: (v) => String(Math.round(v)), oninput: (v) => { N = Math.round(v); recompute(); } });
    const fSl = slider({ label: "Temel frekans", min: 110, max: 440, value: f0, log: true, fmt: (v) => hz(v), oninput: (v) => { f0 = v; recompute(); } });
    const listen = toggle("Dinle", false, (on) => {
      if (on) { cur.fill(0); stream = Sound.stream(slide, fillAudio, { gain: 0.9 }); }
      else if (stream) { stream.stop(); stream = null; }
    });
    const roN = readout("Ok sayısı"), roK = readout("En yüksek harmonik"), roE = readout("Kalan hata (RMS)"), roO = readout("Tepe aşımı");
    ctrl.append(wSeg, nSl, listen, fSl, h("div.readouts.ch4-ro", roN, roK, roE, roO));
    recompute();

    const fps = fpsMeter("fourier");
    const lp = loop((dt) => {
      const t0 = performance.now();
      theta = (theta + TAU * VIS_HZ * dt) % (TAU * 1000);
      draw();
      fps.tick(performance.now() - t0);
    });
    return {
      enter() { fps.reset(); lp.start(); },
      leave() { lp.stop(); if (stream) { stream.stop(); stream = null; } listen.set(false); },
    };
  };

  /* =====================================================================
     2. FFT: zamandan frekansa
     ===================================================================== */
  Demos.fft = function (stage, slide) {
    const { cv, fill, ctrl } = shell(stage, "Üstte IQ tamponu ve pencere, altta FFT ile hesaplanan spektrum");
    const FS = 2.4e6, TONE_DB = -3, WEAK_F = 420e3, WEAK_DB = -70, NOISE_DB = -75, YMIN = -130, YMAX = 5;
    let N = 1024, win = "rect", coarse = 300e3, fine = 0, avgN = 4;
    const r = DSP.rng(77);
    const buf = new Float32Array(2 * 4096), raw = new Float32Array(2 * 4096);
    let re, im, out, avg, wv;
    const df = () => FS / N;
    const toneF = () => (Math.round(coarse / df()) + fine) * df();
    function alloc() {
      re = new Float64Array(N); im = new Float64Array(N); out = new Float32Array(N);
      avg = new DSP.SpectrumAverager(N); wv = DSP.window(win, N);
    }
    alloc();
    let floorMed = NaN, frame = 0, peakDb = 0, side10 = 0;

    function gen() {
      const A = 10 ** (TONE_DB / 20), Aw = 10 ** (WEAK_DB / 20), sg = 10 ** (NOISE_DB / 20) / Math.SQRT2;
      const w1 = (TAU * toneF()) / FS, w2 = (TAU * WEAK_F) / FS, p1 = r() * TAU, p2 = r() * TAU;
      let gi = (r() * GN) | 0; const gs = 1 + 2 * ((r() * 4096) | 0);
      for (let i = 0; i < N; i++) {
        const a = p1 + w1 * i, b = p2 + w2 * i;
        raw[2 * i] = A * Math.cos(a) + Aw * Math.cos(b) + sg * GT[gi]; gi = (gi + gs) & (GN - 1);
        raw[2 * i + 1] = A * Math.sin(a) + Aw * Math.sin(b) + sg * GT[gi]; gi = (gi + gs) & (GN - 1);
      }
      DSP.spectrum(raw, N, { window: win, out, re, im });
      const db = avg.push(out, 1 / avgN);
      // ölçümler: tepe (tonun ±2 kutusu), 10 kutu ötesi, tabanın medyanı
      const kc = N / 2 + toneF() / df();
      let pk = -Infinity; for (let k = Math.floor(kc) - 2; k <= Math.ceil(kc) + 2; k++) if (db[k] > pk) pk = db[k];
      peakDb = pk;
      side10 = db[clamp(Math.round(kc) + 10, 0, N - 1)] - pk;
      if (frame++ % 8 === 0) { const s = Float32Array.from(db).sort(); floorMed = s[N >> 1]; }
      return db;
    }

    // zaman alanı çizimi: N piksel genişliğini aşarsa sütun başına en küçük/en büyük
    function trace(ctx, x, y, w, hh, n, get, color, lw) {
      const Y = (v) => y + hh / 2 - v * (hh / 2) * 0.92;
      ctx.strokeStyle = color; ctx.lineWidth = lw;
      ctx.beginPath();
      if (n > w * 6) {
        const cols = Math.floor(w);
        for (let c = 0; c < cols; c++) {
          const a = Math.floor((c * n) / cols), b = Math.max(a + 1, Math.floor(((c + 1) * n) / cols));
          let mn = Infinity, mx = -Infinity;
          for (let i = a; i < b; i++) { const v = get(i); if (v < mn) mn = v; if (v > mx) mx = v; }
          ctx.moveTo(x + c + 0.5, Y(mx)); ctx.lineTo(x + c + 0.5, Y(mn) + 0.8);
        }
      } else {
        for (let i = 0; i < n; i++) { const px = x + ((i + 0.5) / n) * w; i ? ctx.lineTo(px, Y(get(i))) : ctx.moveTo(px, Y(get(i))); }
      }
      ctx.stroke();
    }

    let db = null;
    function draw() {
      if (!st || !db) return;
      const { ctx, w, h: H } = st;
      ctx.fillStyle = C.stage; ctx.fillRect(0, 0, w, H);
      const pad = 14, tY = 26, tH = clamp(H * 0.24, 70, 150);
      const sx = 40, sw = w - sx - pad, sy = tY + tH + 46, sh = H - sy - 34;

      // --- zaman alanı ---
      V.text(ctx, `Zaman alanı: ${num(N, 0)} örneklik IQ tamponu (${num((N / FS) * 1e6, N / FS < 1e-4 ? 1 : 0)} µs)`, sx, 18, { size: 12, color: C.ink2, weight: 700 });
      ctx.strokeStyle = rgba(C.line, 1); ctx.beginPath(); ctx.moveTo(sx, Math.round(tY + tH / 2) + 0.5); ctx.lineTo(sx + sw, Math.round(tY + tH / 2) + 0.5); ctx.stroke();
      const isRect = win === "rect";
      // ham sinyal soluk, pencerelenmiş sinyal parlak
      if (!isRect) {
        trace(ctx, sx, tY, sw, tH, N, (i) => raw[2 * i], rgba(C.I, 0.16), 1);
        trace(ctx, sx, tY, sw, tH, N, (i) => raw[2 * i + 1], rgba(C.Q, 0.14), 1);
      }
      trace(ctx, sx, tY, sw, tH, N, (i) => raw[2 * i + 1] * wv[i], rgba(C.Q, 0.75), 1.1);
      trace(ctx, sx, tY, sw, tH, N, (i) => raw[2 * i] * wv[i], rgba(C.I, N > sw * 2 ? 0.55 : 0.85), 1.2);
      // pencerenin şekli (zarf): ±0,71 genlikli tona göre
      const A = 10 ** (TONE_DB / 20);
      ctx.save();
      ctx.strokeStyle = C.ink; ctx.lineWidth = 1.8; ctx.setLineDash(isRect ? [6, 4] : []);
      [1, -1].forEach((sgn) => {
        ctx.beginPath();
        for (let c = 0; c <= sw; c += 2) { const i = Math.min(N - 1, Math.floor((c / sw) * N)); const y = tY + tH / 2 - sgn * wv[i] * A * (tH / 2) * 0.92; c ? ctx.lineTo(sx + c, y) : ctx.moveTo(sx, y); }
        ctx.stroke();
      });
      ctx.restore();
      const wname = { rect: "dikdörtgen", hann: "Hann", blackman: "Blackman" }[win];
      tag(ctx, `pencere: ${wname}`, sx + sw, tY + 14, { align: "right", size: 11.5 });
      V.text(ctx, "I", sx - 16, tY + 16, { color: C.I, size: 15, font: FONT.display, weight: 800 });
      V.text(ctx, "Q", sx - 17, tY + 34, { color: C.Q, size: 15, font: FONT.display, weight: 800 });

      // ok: FFT
      const ay = tY + tH + 8;
      ctx.fillStyle = rgba(C.ink, 0.5);
      ctx.beginPath(); ctx.moveTo(sx + sw / 2 - 7, ay + 8); ctx.lineTo(sx + sw / 2 + 7, ay + 8); ctx.lineTo(sx + sw / 2, ay + 18); ctx.closePath(); ctx.fill();
      V.text(ctx, `FFT · ${avgN > 1 ? avgN + " FFT'nin ortalaması" : "tek FFT"}`, sx + sw / 2 + 14, ay + 16, { size: 12, color: C.ink2, weight: 700 });

      // --- spektrum ---
      ctx.fillStyle = rgba(C.bg, 0.45); ctx.fillRect(sx, sy, sw, sh);
      V.dbGrid(ctx, { x: sx, y: sy, w: sw, h: sh, min: YMIN, max: YMAX, step: 20, unit: "dBFS" });
      const dx = N < sw ? (0.5 * sw) / N : 0; // kutu merkezlerini frekansa hizala
      V.spectrum(ctx, { x: sx - dx, y: sy, w: sw, h: sh, db, min: YMIN, max: YMAX });
      const Y = (v) => sy + sh * (1 - clamp((v - YMIN) / (YMAX - YMIN), 0, 1));
      const X = (f) => sx + (f / FS + 0.5) * sw;
      if (sw / N >= 6) for (let i = 0; i < N; i++) V.dot(ctx, sx + (i / N) * sw, Y(db[i]), 2.2, C.ink);
      // frekans skalası
      const tk = V.ticks(-1200, 1200, Math.max(4, Math.floor(sw / 90)));
      V.scale(ctx, { x: sx, y: sy + sh, w: sw, from: -1200, to: 1200, major: tk.major, minor: tk.minor, fmt: (v) => (v < 0 ? "−" + -v : String(v)) });
      V.text(ctx, "kHz", sx + sw, sy + sh + 32, { align: "right", size: 11, color: C.muted });
      // tonların işaretleri
      const tf = toneF(), tx = X(tf);
      tag(ctx, `ton ${num(tf / 1e3, 2)} kHz`, clamp(tx, sx + 60, sx + sw - 60), Y(peakDb) - 10, { align: "center", size: 11.5 });
      const wx = X(WEAK_F), wb = Math.round(N / 2 + WEAK_F / df());
      tag(ctx, `zayıf ton −70 dBFS`, clamp(wx + 8, sx, sx + sw - 120), Math.max(sy + 16, Y(Math.max(db[wb], WEAK_DB)) - 14), { size: 11, color: C.ink2 });

      // --- yakın görünüm: tonun ±12 kutusu ---
      const iw = Math.min(sw * 0.42, 300), ih = Math.min(sh * 0.56, 190), ix = sx + 10, iy = sy + 10;
      ctx.fillStyle = "rgba(10,20,24,0.88)"; roundRect(ctx, ix, iy, iw, ih, 6); ctx.fill();
      ctx.strokeStyle = C.line; ctx.lineWidth = 1; roundRect(ctx, ix + 0.5, iy + 0.5, iw - 1, ih - 1, 6); ctx.stroke();
      V.text(ctx, "Yakından: ±12 kutu", ix + 10, iy + 17, { size: 11.5, color: C.ink2, weight: 700 });
      const kc = N / 2 + tf / df(), k0 = Math.round(kc), K = 12;
      const gx = ix + 10, gw = iw - 20, gy = iy + 26, gh = ih - 48;
      const gY = (v) => gy + gh * (1 - clamp((v - YMIN) / (YMAX - YMIN), 0, 1));
      const cw = gw / (2 * K + 1);
      for (let j = -K; j <= K; j++) {
        const k = k0 + j; if (k < 0 || k >= N) continue;
        const v = db[k], x = gx + (j + K) * cw, t = clamp((v - YMIN) / (YMAX - YMIN), 0, 1);
        ctx.fillStyle = L.cmap(0.25 + 0.75 * t); ctx.fillRect(x + 1, gY(v), cw - 2, gy + gh - gY(v));
        ctx.fillStyle = C.ink; ctx.fillRect(x + 1, gY(v) - 1, cw - 2, 1.5);
      }
      // gerçek ton frekansı
      const tpx = gx + (kc - k0 + K + 0.5) * cw;
      ctx.save(); ctx.setLineDash([3, 3]); ctx.strokeStyle = rgba(C.ink, 0.8); ctx.beginPath(); ctx.moveTo(tpx, gy); ctx.lineTo(tpx, gy + gh); ctx.stroke(); ctx.restore();
      V.text(ctx, "−12", gx, gy + gh + 14, { size: 10.5, color: C.muted });
      V.text(ctx, "0", gx + (K + 0.5) * cw, gy + gh + 14, { size: 10.5, color: C.muted, align: "center" });
      V.text(ctx, "+12 kutu", gx + gw, gy + gh + 14, { size: 10.5, color: C.muted, align: "right" });
      const off = kc - k0;
      V.text(ctx, Math.abs(off) < 0.02 ? "kutu ortasında" : Math.abs(Math.abs(off) - 0.5) < 0.02 ? "iki kutunun tam arasında" : "kutudan " + num(Math.abs(off), 2) + " kaymış",
        ix + iw - 10, iy + 17, { size: 11, color: C.ink, align: "right", weight: 700 });
    }
    const st = canvas(cv, draw);

    // kontroller
    const nSl = slider({ label: "FFT boyu", min: 6, max: 12, step: 1, value: 10, fmt: (v) => num(2 ** Math.round(v), 0), oninput: (v) => { N = 2 ** Math.round(v); alloc(); } });
    const wSeg = seg([["rect", "Dikdörtgen"], ["hann", "Hann"], ["blackman", "Blackman"]], win, (k) => { win = k; alloc(); }, "Pencere fonksiyonu");
    const fineSl = slider({ label: "İnce ayar", min: -0.5, max: 0.5, step: 0.01, value: 0, fmt: (v) => (v >= 0 ? "+" : "−") + num(Math.abs(v), 2) + " kutu", oninput: (v) => { fine = v; avg.acc = null; } });
    const coarseSl = slider({ label: "Ton frekansı", min: -1000, max: 1000, step: 1, value: coarse / 1e3, fmt: (v) => num(v, 0) + " kHz", oninput: (v) => { coarse = v * 1e3; avg.acc = null; } });
    const avgSl = slider({ label: "Ortalama", min: 1, max: 64, step: 1, value: avgN, fmt: (v) => Math.round(v) + " FFT", oninput: (v) => { avgN = Math.round(v); } });
    const bCenter = h("button.btn", { type: "button", onclick: () => { fine = 0; fineSl.set(0); avg.acc = null; } }, "Kutu ortası");
    const bBetween = h("button.btn", { type: "button", onclick: () => { fine = 0.5; fineSl.set(0.5); avg.acc = null; } }, "Kutular arası");
    const roDf = readout("Kutu genişliği fs/N"), roT = readout("Ton"), roPk = readout("Tepe"), roS = readout("10 kutu ötede"), roF = readout("Tabanın medyanı", "–", "cn");
    ctrl.append(wSeg, nSl, fineSl, bCenter, bBetween, coarseSl, avgSl, h("div.readouts.ch4-ro", roDf, roT, roPk, roS, roF));
    function updateRO() {
      roDf.set(`${num(FS / 1e6, 1)} MHz / ${num(N, 0)} = ${hz(df(), df() < 1e4 ? 2 : 1)}`);
      const tf = toneF();
      roT.set(`${num(tf / 1e3, 2)} kHz · kutu ${num(tf / df(), 2)}`);
      roPk.set(dbfs(peakDb));
      roS.set(dbs(side10));
      roF.set(isNaN(floorMed) ? "–" : dbfs(floorMed, 0));
    }

    const fps = fpsMeter("fft");
    const lp = loop(() => {
      const t0 = performance.now();
      db = gen();
      draw();
      if (frame % 6 === 1) updateRO();
      fps.tick(performance.now() - t0);
    });
    db = gen();
    return { enter() { fps.reset(); lp.start(); }, leave() { lp.stop(); } };
  };

  /* =====================================================================
     3. Desibel: doğrusal ↔ logaritmik ölçek
     ===================================================================== */
  Demos.desibel = function (stage, slide) {
    const { cv, fill, ctrl } = shell(stage, "Bir güçlü ve bir zayıf istasyonun spektrumu; doğrusal ve desibel ölçek arasında geçiş");
    const RATE = 48000, N = 1024, STRONG_DB = -10, NOISE_DB = -80, YMIN = -125, YMAX = 5;
    let weakDb = -70, mode = "lin", k = 0; // k: 0 doğrusal, 1 dB (animasyonlu)
    const band = new Signals.Band({
      rate: RATE, noise: NOISE_DB, seed: 8, stations: [
        { f: -9000, mod: "am", power: STRONG_DB, m: 0.7, audio: Music.melody({ timbre: "organ", bpm: 112 }) },
        { f: 8000, mod: "nfm", power: weakDb, dev: 2200, audio: Music.voice({ pitch: 130, seed: 4 }) },
      ],
    });
    const weak = band.stations[1];
    const spec = new Float32Array(N), avg = new DSP.SpectrumAverager(N);
    const re = new Float64Array(N), im = new Float64Array(N);
    let db = null, floorMed = -110, pmax = 0.05, frame = 0;
    const marks = [{ f: -9000, name: "A" }, { f: 8000, name: "B" }];
    let drag = -1;

    const binOf = (f) => clamp(Math.round(N / 2 + (f / RATE) * N), 0, N - 1);
    // işaretçi en yakın tepeyi bulur (±4 kutu)
    function readAt(f) {
      const b = binOf(f); let best = b;
      for (let j = b - 4; j <= b + 4; j++) if (j >= 0 && j < N && db[j] > db[best]) best = j;
      return { bin: best, v: db[best] };
    }
    function gen() {
      const iq = band.next(N);
      DSP.spectrum(iq, N, { window: "hann", out: spec, re, im });
      db = avg.push(spec, 0.25);
      let mx = -Infinity; for (let i = 0; i < N; i++) if (db[i] > mx) mx = db[i];
      pmax += (10 ** (mx / 10) - pmax) * 0.1; // doğrusal ölçeğin tavanı: en güçlü tepe
      if (frame++ % 10 === 0) { const s = Float32Array.from(db).sort(); floorMed = s[N >> 1]; }
    }

    let geo = null;
    function draw() {
      if (!st || !db) return;
      const { ctx, w, h: H } = st;
      ctx.fillStyle = C.stage; ctx.fillRect(0, 0, w, H);
      const sx = 58, sy = 34, sw = w - sx - 16, sh = H - sy - 46;
      geo = { sx, sy, sw, sh };
      const ke = ease(k), top = pmax * 1.12;
      const yLin = (p) => sy + sh * (1 - clamp(p / top, 0, 1));
      const yDb = (v) => sy + sh * (1 - clamp((v - YMIN) / (YMAX - YMIN), 0, 1));
      const Y = (v) => lerp(yLin(10 ** (v / 10)), yDb(v), ke);
      const X = (f) => sx + (f / RATE + 0.5) * sw;

      ctx.fillStyle = rgba(C.bg, 0.45); ctx.fillRect(sx, sy, sw, sh);
      // dB ızgarası: çizgiler ölçekle birlikte kayar (doğrusalda hepsi dibe yığılır)
      ctx.lineWidth = 1;
      for (let v = -120; v <= 0; v += 10) {
        const y = Math.round(Y(v)) + 0.5, major = v % 20 === 0;
        ctx.strokeStyle = rgba(C.line, major ? 0.95 : 0.45); ctx.beginPath(); ctx.moveTo(sx, y); ctx.lineTo(sx + sw, y); ctx.stroke();
        if (major && ke > 0.05) V.text(ctx, (v < 0 ? "−" + -v : "0"), sx - 8, y + 4, { align: "right", size: 11, color: rgba(C.ink2, ke) });
      }
      // doğrusal ızgara: en güçlüye göre 0 … 1
      if (ke < 0.95) for (let q = 0.25; q <= 1.0001; q += 0.25) {
        const p = q * pmax, y = Math.round(lerp(yLin(p), yDb(10 * Math.log10(p)), ke)) + 0.5;
        ctx.strokeStyle = rgba(C.ink2, 0.22 * (1 - ke)); ctx.setLineDash([2, 4]);
        ctx.beginPath(); ctx.moveTo(sx, y); ctx.lineTo(sx + sw, y); ctx.stroke(); ctx.setLineDash([]);
        V.text(ctx, num(q, 2).replace(/,?0+$/, "") || "0", sx - 8, y + 4, { align: "right", size: 11, color: rgba(C.ink2, 1 - ke) });
      }
      V.text(ctx, ke > 0.5 ? "dBFS" : "güç (en güçlü = 1)", 8, sy - 14, { size: 11.5, color: C.ink2, weight: 700 });

      // spektrum yolu
      ctx.save(); ctx.beginPath(); ctx.rect(sx, sy - 2, sw, sh + 2); ctx.clip();
      ctx.beginPath();
      const cols = Math.floor(sw), step = N / cols;
      for (let c = 0; c <= cols; c++) {
        const a = Math.floor(c * step), b = Math.max(a + 1, Math.floor((c + 1) * step));
        let m = -Infinity; for (let i = a; i < Math.min(N, b); i++) if (db[i] > m) m = db[i];
        const y = Y(m); c ? ctx.lineTo(sx + c, y) : ctx.moveTo(sx, y);
      }
      ctx.lineTo(sx + sw, sy + sh); ctx.lineTo(sx, sy + sh); ctx.closePath();
      ctx.fillStyle = radiumFill(ctx, sy, sh); ctx.fill();
      ctx.strokeStyle = C.ink; ctx.lineWidth = 1.4; ctx.lineJoin = "round"; ctx.stroke();
      ctx.restore();

      // 0 dBFS ve gürültü tabanı (dB görünümünde)
      if (ke > 0.02) {
        ctx.globalAlpha = ke;
        const y0 = Y(0);
        ctx.strokeStyle = rgba(C.ink, 0.7); ctx.lineWidth = 1.2; ctx.beginPath(); ctx.moveTo(sx, y0); ctx.lineTo(sx + sw, y0); ctx.stroke();
        tag(ctx, "0 dBFS: ADC'nin tam ölçeği", sx + sw - 4, y0 + 18, { align: "right", size: 11.5 });
        const yf = Y(floorMed);
        ctx.save(); ctx.setLineDash([6, 4]); ctx.strokeStyle = C.noise; ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.moveTo(sx, yf); ctx.lineTo(sx + sw, yf); ctx.stroke(); ctx.restore();
        tag(ctx, `gürültü tabanı ≈ ${num(floorMed, 0)} dBFS (kutu başına)`, sx + 6, yf + 22, { size: 11.5, color: C.noise });
        ctx.globalAlpha = 1;
      }
      // doğrusalda kaybolan zayıf istasyon
      const wr = readAt(8000), wrel = 10 ** (wr.v / 10) / top;
      if (ke < 0.98 && wrel < 0.02) {
        ctx.globalAlpha = 1 - ke;
        const x = X(8000), y = sy + sh - 34;
        ctx.strokeStyle = rgba(C.ink, 0.6); ctx.setLineDash([3, 3]); ctx.beginPath(); ctx.moveTo(x, y + 4); ctx.lineTo(x, sy + sh - 2); ctx.stroke(); ctx.setLineDash([]);
        tag(ctx, "zayıf istasyon burada: görünmüyor", clamp(x, sx + 120, sx + sw - 120), y, { align: "center", size: 11.5 });
        ctx.globalAlpha = 1;
      }

      // A / B işaretçileri
      marks.forEach((m) => {
        const rd = readAt(m.f), x = X(m.f), y = Y(rd.v), bx = sx + ((rd.bin + 0.5) / N) * sw;
        m.read = rd;
        ctx.strokeStyle = rgba(C.ink, 0.55); ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(Math.round(x) + 0.5, sy); ctx.lineTo(Math.round(x) + 0.5, sy + sh); ctx.stroke();
        ctx.fillStyle = C.ink; roundRect(ctx, x - 11, sy - 26, 22, 20, 3); ctx.fill();
        V.text(ctx, m.name, x, sy - 11, { align: "center", size: 15, color: C.bg, font: FONT.display, weight: 800 });
        V.dot(ctx, bx, y, 5, C.ink, 10);
        const right = x < sx + sw - 130;
        tag(ctx, dbfs(rd.v), x + (right ? 10 : -10), clamp(y - 8, sy + 30, sy + sh - 6), { align: right ? "left" : "right", size: 12 });
      });
      // A–B farkı: A'nın düzeyinden B'ye inen ölçü çizgisi (B'nin yanında)
      const [A, B] = marks;
      if (A.read && B.read) {
        const xa = X(A.f), xb = X(B.f), ya = Y(A.read.v), yb = Y(B.read.v), dir = xb >= xa ? 1 : -1, xm = xb + dir * 14;
        ctx.save(); ctx.strokeStyle = rgba(C.ink, 0.4); ctx.setLineDash([2, 4]); ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(xa, ya); ctx.lineTo(xm + dir * 6, ya); ctx.stroke(); ctx.restore();
        ctx.strokeStyle = rgba(C.ink, 0.85); ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.moveTo(xm, ya); ctx.lineTo(xm, yb); ctx.moveTo(xm - 5, ya); ctx.lineTo(xm + 5, ya); ctx.moveTo(xm - 5, yb); ctx.lineTo(xm + 5, yb); ctx.stroke();
        const d = B.read.v - A.read.v;
        if (Math.abs(ya - yb) > 28) tag(ctx, `${d >= 0 ? "+" : "−"}${num(Math.abs(d), 1)} dB`, xm + dir * 8, (ya + yb) / 2 + 6, { size: 13, align: dir > 0 ? "left" : "right" });
      }
      // frekans skalası
      const tk = V.ticks(-24, 24, Math.max(4, Math.floor(sw / 80)));
      V.scale(ctx, { x: sx, y: sy + sh, w: sw, from: -24, to: 24, major: tk.major, minor: tk.minor, fmt: (v) => (v < 0 ? "−" + -v : String(v)) });
      V.text(ctx, "kHz", sx + sw, sy + sh + 34, { align: "right", size: 11, color: C.muted });
    }
    const st = canvas(cv, draw);

    // işaretçileri sürükle
    const dmove = (x) => { if (drag < 0 || !geo) return; marks[drag].f = clamp(((x - geo.sx) / geo.sw - 0.5) * RATE, -23500, 23500); };
    L.pointer(cv, {
      down(x) {
        if (!geo) return;
        const f = ((x - geo.sx) / geo.sw - 0.5) * RATE;
        drag = Math.abs(f - marks[0].f) < Math.abs(f - marks[1].f) ? 0 : 1;
        dmove(x);
      },
      move: dmove,
      up() { drag = -1; },
    });
    cv.style.cursor = "ew-resize";

    // ses: iki istasyonun içeriği, gerçek güç oranlarıyla karışık
    const sMel = Music.melody({ timbre: "organ", bpm: 112 }), sVoi = Music.voice({ pitch: 130, seed: 4 });
    let stream = null; const ta = { a: null, b: null };
    function fillAudio(out, rate) {
      if (!ta.a || ta.a.length !== out.length) { ta.a = new Float32Array(out.length); ta.b = new Float32Array(out.length); }
      sMel.next(ta.a, rate); sVoi.next(ta.b, rate);
      const gb = 10 ** ((weakDb - STRONG_DB) / 20) * 1.6;
      for (let i = 0; i < out.length; i++) out[i] = 0.55 * ta.a[i] + gb * ta.b[i];
      rms("desibel", out);
    }
    const mSeg = seg([["lin", "Doğrusal"], ["db", "Desibel"]], mode, (m) => { mode = m; }, "Dikey ölçek");
    const wSl = slider({ label: "Zayıf istasyon", min: -100, max: -10, step: 1, value: weakDb, fmt: (v) => dbfs(v, 0), oninput: (v) => { weakDb = v; weak.power = v; weak.amp = 10 ** (v / 20); } });
    const listen = toggle("Dinle", false, (on) => { if (on) stream = Sound.stream(slide, fillAudio); else if (stream) { stream.stop(); stream = null; } });
    const roA = readout("A"), roB = readout("B"), roD = readout("Fark B − A"), roR = readout("Güç oranı");
    ctrl.append(mSeg, wSl, listen, h("div.readouts.ch4-ro", roA, roB, roD, roR));
    function updateRO() {
      const [A, B] = marks; if (!A.read) return;
      roA.set(dbfs(A.read.v)); roB.set(dbfs(B.read.v));
      const d = B.read.v - A.read.v, r = 10 ** (Math.abs(d) / 10);
      roD.set((d >= 0 ? "+" : "−") + num(Math.abs(d), 1) + " dB");
      roR.set(Math.abs(d) < 0.05 ? "eşit" : `B, A'dan ${ratioText(r)} kat ${d > 0 ? "güçlü" : "zayıf"}`);
    }

    const fps = fpsMeter("desibel");
    const lp = loop((dt) => {
      const t0 = performance.now();
      gen();
      const target = mode === "db" ? 1 : 0;
      k = target > k ? Math.min(1, k + dt / 1.1) : Math.max(0, k - dt / 1.1);
      draw();
      if (frame % 6 === 0) updateRO();
      fps.tick(performance.now() - t0);
    });
    for (let i = 0; i < 20; i++) gen();
    return { enter() { fps.reset(); lp.start(); }, leave() { lp.stop(); if (stream) { stream.stop(); stream = null; } listen.set(false); } };
  };

  /* =====================================================================
     4. Şelale ekranı: Signals.Band ile gerçek zamanlı bant
     ===================================================================== */
  Demos.selale = function (stage, slide) {
    const { cv, fill, ctrl } = shell(stage, "Canlı spektrum ve şelale: sürekli istasyonlar ve ara sıra beliren kısa yayınlar");
    const fpsEl = h("div.ch4-fps", "fps ölçülüyor…");
    fill.append(fpsEl);
    const RATE = 240000, BINS = 1024, ROWS = 420, RING = 8192;
    const band = new Signals.Band({
      rate: RATE, noise: -72, seed: 4, stations: [
        { f: -82000, mod: "am", power: -32, m: 0.85, audio: Music.melody({ timbre: "organ", bpm: 108 }), name: "AM yayın (müzik)", bw: 6000 },
        { f: -38000, mod: "nfm", power: -42, dev: 3000, audio: Music.melody({ timbre: "flute", bpm: 132, transpose: 5 }), name: "NFM, sürekli yayın", bw: 8000 },
        { f: -60000, mod: "nfm", power: -52, dev: 2500, audio: Music.voice({ pitch: 170, seed: 9 }), duty: [1.6, 5], name: "Kısa telsiz konuşması", bw: 7000 },
        { f: 12000, mod: "cw", power: -46, audio: Music.morse({ text: "CQ", freq: 700 }), name: "Mors (CW)", bw: 1500 },
        { f: 47000, mod: "nfm", power: -44, dev: 2500, audio: Music.voice({ pitch: 120, seed: 5 }), duty: [2.2, 4.5], name: "Kısa telsiz konuşması", bw: 7000 },
        { f: 86000, mod: "ook", power: -54, bits: 2500, duty: [0.35, 2.2], name: "OOK paketi (uzaktan kumanda)", bw: 6000 },
        { f: 104000, mod: "ook", power: -60, bits: 1200, duty: [0.25, 3.2], name: "OOK paketi (sensör)", bw: 4000 },
      ],
    });
    let N = 2048, rps = 30, lo = -112, hi = -40;
    const ring = new Float32Array(2 * RING); let wp = 0, toNext = 0;
    const tmp = new Float32Array(2 * 4096);
    let re, im, out, avg;
    function alloc() { re = new Float64Array(N); im = new Float64Array(N); out = new Float32Array(N); avg = new DSP.SpectrumAverager(N); }
    alloc();
    const wf = new V.Waterfall(BINS, ROWS); wf.min = lo; wf.max = hi;
    const hist = new Float32Array(BINS * ROWS), rowT = new Float64Array(ROWS), rowC = new Uint8Array(ROWS); let preMode = false; let hHead = 0, hCount = 0; // satır geçmişi: renk aralığı değişince yeniden boyamak için
    const row = new Float32Array(BINS);
    const specAvg = new Float32Array(BINS).fill(-120); let rowsMade = 0;

    function makeRow() {
      // halkadaki son N örneği kopyala
      let s = (wp - N + RING) % RING;
      for (let i = 0; i < N; i++) { tmp[2 * i] = ring[2 * s]; tmp[2 * i + 1] = ring[2 * s + 1]; s = (s + 1) % RING; }
      DSP.spectrum(tmp, N, { window: "hann", out, re, im });
      // BINS sütuna indir (sütun başına en büyük)
      down(out, row);
      wf.push(row);
      hHead = (hHead + 1) % ROWS; hist.set(row, hHead * BINS); rowT[hHead] = band.t; rowC[hHead] = preMode ? 1 : 0; hCount = Math.min(ROWS, hCount + 1);
      down(avg.push(out, 0.35), specAvg);
      rowsMade++;
    }
    function down(src, dst) {
      const step = N / BINS;
      for (let c = 0; c < BINS; c++) {
        if (step >= 1) { let m = -Infinity; const a = Math.floor(c * step), b = Math.floor((c + 1) * step); for (let j = a; j < b; j++) if (src[j] > m) m = src[j]; dst[c] = m; }
        else dst[c] = src[Math.floor(c * step)];
      }
    }
    function recolor() {
      wf.min = lo; wf.max = hi; wf.clear(); wf.head = 0;
      for (let k = hCount - 1; k >= 0; k--) wf.push(hist.subarray(((hHead - k + ROWS) % ROWS) * BINS, ((hHead - k + ROWS) % ROWS) * BINS + BINS));
    }
    let recolorPending = false;

    // örnekleri halkaya yaz, her "hop" örnekte bir satır üret
    function consume(iq, hopOver) {
      const n = iq.length >> 1, hop = hopOver || Math.round(RATE / rps);
      let i = 0;
      while (i < n) {
        if (toNext <= 0) toNext = hop;
        const m = Math.min(n - i, toNext);
        for (let j = 0; j < m; j++) { ring[2 * wp] = iq[2 * (i + j)]; ring[2 * wp + 1] = iq[2 * (i + j) + 1]; wp = (wp + 1) % RING; }
        i += m; toNext -= m;
        if (toNext === 0) makeRow();
      }
    }

    // dinleme: tıklanan frekansa ayarlı alıcı; dinlerken örnekleri ses saati üretir
    let tuneF = null, tuneSt = null, rx = null, stream = null, cwAgc = 1e-3;
    const pending = [];
    function stationAt(f) { return band.stations.find((s) => Math.abs(f - s.f) < s.bw / 2 + 800) || null; }
    function setTune(f) {
      tuneF = f; tuneSt = stationAt(f);
      const s = tuneSt, mode = s ? (s.mod === "am" ? "am" : s.mod === "nfm" ? "nfm" : "ssb") : "nfm";
      const cf = s ? (mode === "ssb" ? s.f - 700 : s.f) : f;
      rx = new Signals.Receiver({ rate: RATE, decim: 5, mode: mode === "ssb" ? "am" : mode, tune: cf, bw: mode === "ssb" ? 2400 : mode === "am" ? 9000 : 12000, dev: s && s.dev ? s.dev : 2500 });
      rx.ssb = mode === "ssb";
      if (s) tuneF = s.f;
    }
    function produceAudio(nAudio) {
      const iq = band.next(nAudio * 5);
      pending.push(iq);
      if (!rx) return new Float32Array(nAudio);
      const r = rx.process(iq);
      if (rx.ssb) {
        // Mors / OOK: taşıyıcıyı 700 Hz'lik bir bip olarak duymak için IQ'nun gerçek kısmı
        const a = new Float32Array(r.iq.length >> 1);
        for (let i = 0; i < a.length; i++) {
          const v = r.iq[2 * i], av = Math.abs(v);
          cwAgc += (av > cwAgc ? 0.02 : 0.00005) * (av - cwAgc); cwAgc = Math.max(cwAgc, 4e-4);
          a[i] = clamp((v * 0.35) / cwAgc, -1, 1);
        }
        return a;
      }
      // susturucu (squelch): kanalda sinyal yoksa FM gürültüsünü kıs, yalnızca hafif hışırtı kalsın
      let pw = 0; for (let i = 0; i < r.iq.length; i++) pw += r.iq[i] * r.iq[i];
      pw /= (r.iq.length >> 1) || 1;
      const open = pw > 1e-7 ? 1 : 0, au = r.audio;
      for (let i = 0; i < au.length; i++) { sq += (open - sq) * 0.004; au[i] *= 0.07 + 0.93 * sq; }
      return au;
    }
    let sq = 0;
    const fifo = new Signals.AudioFifo(() => { const a = produceAudio(2048); rms("selale:" + (tuneSt ? tuneSt.name : "parazit"), a); return a; });
    const listening = () => stream && Sound.unlocked;

    let hover = null, geo = null;
    function draw() {
      if (!st) return;
      const { ctx, w, h: H } = st;
      ctx.fillStyle = C.bg; ctx.fillRect(0, 0, w, H);
      const scY = 30, spTop = scY + 4, spH = clamp(H * 0.26, 80, 190), wfTop = spTop + spH + 2, wfH = H - wfTop;
      geo = { scY, spTop, spH, wfTop, wfH, w };
      const X = (f) => (f / RATE + 0.5) * w;
      // şelale
      wf.draw(ctx, 0, wfTop, w, wfH);
      // spektrum
      ctx.fillStyle = C.stage; ctx.fillRect(0, spTop, w, spH);
      V.dbGrid(ctx, { x: 0, y: spTop, w, h: spH, min: lo, max: hi, step: hi - lo > 60 ? 20 : 10, unit: "dBFS" });
      V.spectrum(ctx, { x: 0, y: spTop, w, h: spH, db: specAvg, min: lo, max: hi });
      ctx.strokeStyle = rgba(C.ink, 0.25); ctx.beginPath(); ctx.moveTo(0, wfTop - 0.5); ctx.lineTo(w, wfTop - 0.5); ctx.stroke();
      // kadran skalası
      ctx.fillStyle = rgba(C.bg, 0.92); ctx.fillRect(0, 0, w, scY);
      const tk = V.ticks(-120, 120, Math.max(4, Math.floor(w / 80)));
      V.scale(ctx, { x: 0, y: scY, w, from: -120, to: 120, major: tk.major.filter((v) => (v / 240 + 0.5) * w < w - 44 && (v / 240 + 0.5) * w > 16), minor: tk.minor, fmt: (v) => (v > 0 ? "+" + v : v < 0 ? "−" + -v : "0"), up: true, size: 14, color: C.ink });
      V.text(ctx, "kHz", w - 8, scY - 12, { align: "right", size: 13, color: C.ink2, font: FONT.display, weight: 700 });
      // zaman ekseni (şelalenin sol kenarı)
      // satırların gerçek zaman damgalarından (açılıştaki sıkıştırılmış geçmişte etiket yok)
      const span = ROWS / rps, tStep = V.niceStep(span, Math.max(2, Math.floor(wfH / 70)));
      let k = 0;
      for (let t = tStep; t < span; t += tStep) {
        while (k < hCount && band.t - rowT[(hHead - k + ROWS) % ROWS] < t) k++;
        if (k >= hCount || rowC[(hHead - k + ROWS) % ROWS]) break;
        const y = wfTop + ((k + 0.5) / ROWS) * wfH;
        ctx.fillStyle = rgba(C.ink, 0.5); ctx.fillRect(0, Math.round(y), 6, 1);
        V.text(ctx, `−${num(t, t < 1 ? 1 : 0)} sn`, 9, y + 4, { size: 10.5, color: rgba(C.ink, 0.7) });
      }
      // ayar ibresi
      if (tuneF != null) {
        const x = X(tuneF);
        V.needle(ctx, x, scY, H - scY, stream ? (tuneSt ? tuneSt.name : "parazit") : "");
      }
      // fare okuması
      if (hover) {
        const { x, y } = hover, f = (x / w - 0.5) * RATE, c = clamp(Math.floor((x / w) * BINS), 0, BINS - 1);
        let pw, when = null;
        if (y >= wfTop) {
          const k = Math.floor(((y - wfTop) / wfH) * ROWS);
          if (k < hCount) { const j = (hHead - k + ROWS) % ROWS; pw = hist[j * BINS + c]; when = rowC[j] ? null : band.t - rowT[j]; }
        } else pw = specAvg[c];
        ctx.save(); ctx.strokeStyle = rgba(C.ink, 0.55); ctx.setLineDash([3, 4]); ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(Math.round(x) + 0.5, scY); ctx.lineTo(Math.round(x) + 0.5, H);
        if (y >= wfTop) { ctx.moveTo(0, Math.round(y) + 0.5); ctx.lineTo(w, Math.round(y) + 0.5); }
        ctx.stroke(); ctx.restore();
        const s = stationAt(f);
        const lines = [`${f >= 0 ? "+" : "−"}${num(Math.abs(f) / 1e3, 1)} kHz · ${pw == null ? "–" : dbfs(pw, 0)}`];
        if (when != null) lines.push(when < 0.05 ? "şimdi" : `${num(when, 1)} sn önce`);
        lines.push(s ? s.name : "gürültü");
        ctx.font = `700 12.5px ${FONT.body}`;
        const bw = Math.max(...lines.map((l) => ctx.measureText(l).width)) + 18, bh = lines.length * 17 + 10;
        let bx = x + 14, by = Math.max(scY + 6, y - bh - 10);
        if (bx + bw > w - 6) bx = x - bw - 14;
        ctx.fillStyle = "rgba(10,20,24,0.88)"; roundRect(ctx, bx, by, bw, bh, 4); ctx.fill();
        ctx.strokeStyle = C.line; ctx.stroke();
        lines.forEach((l, i) => V.text(ctx, l, bx + 9, by + 19 + i * 17, { size: 12.5, color: i === 0 ? C.ink : C.ink2, weight: i === 0 ? 700 : 400 }));
      }
    }
    const st = canvas(cv, draw);

    L.pointer(cv, {
      hover(x, y) { hover = x < 0 ? null : { x, y }; },
      move(x, y) { hover = { x, y }; },
      down(x, y) {
        hover = { x, y };
        if (!geo) return;
        setTune((x / geo.w - 0.5) * RATE);
        if (!stream) { listen.set(true); startListen(); }
      },
    });
    cv.style.cursor = "crosshair";

    function startListen() { if (tuneF == null) setTune(-82000); stream = Sound.stream(slide, (o) => fifo.fill(o)); }
    function stopListen() { if (stream) { stream.stop(); stream = null; } pending.length = 0; }

    // kontroller
    const spd = slider({ label: "Hız", min: 5, max: 60, step: 1, value: rps, fmt: (v) => Math.round(v) + " satır/sn", oninput: (v) => { rps = Math.round(v); } });
    const loSl = slider({ label: "En düşük", min: -130, max: -70, step: 1, value: lo, fmt: (v) => num(v, 0) + " dB", oninput: (v) => { lo = v; recolorPending = true; } });
    const hiSl = slider({ label: "En yüksek", min: -60, max: 0, step: 1, value: hi, fmt: (v) => num(v, 0) + " dB", oninput: (v) => { hi = v; recolorPending = true; } });
    const nSeg = seg([[256, "256"], [512, "512"], [1024, "1024"], [2048, "2048"], [4096, "4096"]], N, (k) => { N = k; alloc(); updateRO(); }, "FFT boyu");
    const listen = toggle("Dinle", false, (on) => { if (on) startListen(); else stopListen(); });
    const roDf = readout("Kutu genişliği"), roT = readout("Satır süresi"), roSpan = readout("Ekrandaki zaman");
    ctrl.append(h("span.lab", "FFT boyu"), nSeg, spd, loSl, hiSl, listen, h("div.readouts.ch4-ro", roDf, roT, roSpan));
    function updateRO() {
      roDf.set(`${hz(RATE / N, 1)} (fs/N)`);
      roT.set(`${num((N / RATE) * 1e3, 1)} ms`);
      roSpan.set(`${num(ROWS / rps, 1)} sn`);
    }
    updateRO();
    spd.input.addEventListener("input", updateRO);

    const fps = fpsMeter("selale", fpsEl);
    const lp = loop((dt) => {
      const t0 = performance.now();
      if (!listening()) consume(band.next(Math.round(dt * RATE)));
      while (pending.length) consume(pending.shift());
      if (recolorPending) { recolor(); recolorPending = false; }
      draw();
      fps.tick(performance.now() - t0);
    });
    // açılışta şelale boş görünmesin: geçmişi parça parça doldur (satır başına yalnızca N örnek,
    // yani zamanda sıkıştırılmış; bu satırlarda zaman etiketi gösterilmez). Slayta girilince durur.
    let pre = 0, preT = 0, entered = false;
    function prefill(rows) { preMode = true; for (let i = 0; i < rows && pre < ROWS; i++, pre++) consume(band.next(N), N); preMode = false; toNext = 0; }
    prefill(60);
    (function chunk() { if (entered || pre >= ROWS) return; prefill(30); preT = setTimeout(chunk, 70); })();
    return {
      enter() { if (!entered) { entered = true; clearTimeout(preT); prefill(ROWS); } fps.reset(); lp.start(); },
      leave() { lp.stop(); stopListen(); listen.set(false); hover = null; },
    };
  };

  /* =====================================================================
     5. Sinyali bul: mini oyun
     ===================================================================== */
  Demos.sinyaliBul = function (stage, slide) {
    const { cv, fill, ctrl } = shell(stage, "Oyun: gürültülü şelalede beliren kısa yayınlara tıklayın");
    const BINS = 512, ROWS = 300, ROW_HZ = 40, TOTAL = 12, FLOOR = -100, SPAN_KHZ = 200;
    const LEVELS = { kolay: [16, 6, "Kolay"], orta: [12, 2, "Orta"], zor: [8, -1, "Zor"] };
    const r = DSP.rng((Date.now() & 0xffff) + 1);
    const wf = new V.Waterfall(BINS, ROWS); wf.min = FLOOR - 12; wf.max = FLOOR + 26;
    const row = new Float32Array(BINS), spec = new Float32Array(BINS).fill(FLOOR);
    // sürekli "karıştırıcı" istasyonlar: sayılmaz
    const steady = [{ c: 96, w: 5, snr: 14 }, { c: 380, w: 9, snr: 10 }];
    let level = "kolay", state = "idle", t = 0, acc = 0, nextAt = 0, spawned = 0;
    let bursts = [], fx = [], game = null;

    function newGame() {
      game = { score: 0, hits: 0, misses: 0, missed: 0, rts: [], log: [] };
      bursts = []; fx = []; spawned = 0; t = 0; nextAt = 1.4 + r() * 1.2; state = "play";
      over.hidden = true; startBtn.textContent = "Yeniden başlat";
    }
    function snrFor(i) { const [a, b] = LEVELS[level]; return a + ((b - a) * i) / (TOTAL - 1); }
    function spawn() {
      const kinds = ["paket", "konuşma", "veri"], kind = kinds[Math.floor(r() * 3)];
      const w = kind === "paket" ? 3 + r() * 2 : kind === "konuşma" ? 10 + r() * 6 : 6 + r() * 2;
      let c;
      for (let tries = 0; tries < 30; tries++) {
        c = 16 + r() * (BINS - 32);
        if (steady.every((s) => Math.abs(s.c - c) > s.w + w + 10)) break;
      }
      const b = { c, w, kind, snr: snrFor(spawned), t0: t, dur: 1.3 + r() * 1.4, hit: false, idx: spawned, ph: r() * 10 };
      bursts.push(b); spawned++;
      nextAt = t + b.dur + 0.9 + r() * 1.6;
    }
    function burstOn(b) { return t >= b.t0 && t < b.t0 + b.dur; }

    function genRow() {
      const fl = 10 ** (FLOOR / 10);
      for (let i = 0; i < BINS; i++) {
        let p = fl * -Math.log(1 - r() * 0.9999); // üstel dağılımlı gürültü gücü
        for (const s of steady) { const d = (i - s.c) / (s.w / 2); if (Math.abs(d) < 1.6) p += fl * 10 ** (s.snr / 10) * Math.exp(-d * d * 1.5) * (0.6 + 0.8 * r()); }
        for (const b of bursts) {
          if (!burstOn(b)) continue;
          const d = (i - b.c) / (b.w / 2); if (Math.abs(d) > 1.5) continue;
          let g = Math.exp(-d * d * (b.kind === "konuşma" ? 1.2 : 2.4));
          if (b.kind === "paket") g *= Math.sin((t - b.t0) * 31 + b.ph) > -0.2 ? 1 : 0.05; // aç-kapa paketleri
          if (b.kind === "konuşma") g *= 0.55 + 0.45 * Math.abs(Math.sin((t - b.t0) * 5.3 + b.ph));
          p += fl * 10 ** (b.snr / 10) * g * (0.5 + r());
        }
        row[i] = 10 * Math.log10(p);
        spec[i] += (row[i] - spec[i]) * 0.3;
      }
      wf.push(row);
    }

    let geo = null;
    function draw() {
      if (!st) return;
      const { ctx, w, h: H } = st;
      ctx.fillStyle = C.bg; ctx.fillRect(0, 0, w, H);
      const scY = 28, spTop = scY + 4, spH = clamp(H * 0.2, 60, 130), wfTop = spTop + spH + 2, wfH = H - wfTop;
      geo = { w, scY, spTop, spH, wfTop, wfH };
      wf.draw(ctx, 0, wfTop, w, wfH);
      ctx.fillStyle = C.stage; ctx.fillRect(0, spTop, w, spH);
      V.dbGrid(ctx, { x: 0, y: spTop, w, h: spH, min: FLOOR - 8, max: FLOOR + 32, step: 10, unit: "dBFS", labels: w > 420 });
      V.spectrum(ctx, { x: 0, y: spTop, w, h: spH, db: spec, min: FLOOR - 8, max: FLOOR + 32 });
      ctx.fillStyle = rgba(C.bg, 0.92); ctx.fillRect(0, 0, w, scY);
      const tk = V.ticks(-SPAN_KHZ / 2, SPAN_KHZ / 2, Math.max(4, Math.floor(w / 80)));
      V.scale(ctx, { x: 0, y: scY, w, from: -SPAN_KHZ / 2, to: SPAN_KHZ / 2, major: tk.major.filter((v) => (v / SPAN_KHZ + 0.5) * w < w - 44 && (v / SPAN_KHZ + 0.5) * w > 16), minor: tk.minor, fmt: (v) => (v > 0 ? "+" + v : v < 0 ? "−" + -v : "0"), up: true, size: 13, color: C.ink });
      V.text(ctx, "kHz", w - 8, scY - 11, { align: "right", size: 12, color: C.ink2, font: FONT.display, weight: 700 });

      // yakalanan / kaçan yayınların çerçeveleri (şelalede aşağı akar)
      const rowH = wfH / ROWS, X = (bin) => (bin / BINS) * w;
      for (const b of bursts) {
        const ended = t >= b.t0 + b.dur + 1;
        if (!b.hit && !ended) continue;
        const yTop = wfTop + (t - (b.t0 + b.dur)) * ROW_HZ * rowH, yBot = wfTop + (t - b.t0) * ROW_HZ * rowH;
        if (yTop > H) continue;
        const x0 = X(b.c - b.w / 2 - 3), x1 = X(b.c + b.w / 2 + 3);
        ctx.save();
        ctx.strokeStyle = b.hit ? C.ink : rgba(C.needle, 0.85); ctx.lineWidth = 1.5; ctx.setLineDash(b.hit ? [] : [4, 3]);
        ctx.strokeRect(Math.round(x0) + 0.5, Math.max(wfTop, yTop) + 0.5, Math.round(x1 - x0), yBot - Math.max(wfTop, yTop));
        ctx.restore();
        if (yBot - 4 < H && yBot > wfTop + 14) V.text(ctx, (b.hit ? "" : "kaçtı · ") + num(b.snr, 1) + " dB", x1 + 5, Math.min(H - 6, yBot - 4), { size: 11, color: b.hit ? C.ink : C.needle, weight: 700 });
      }
      // tıklama efektleri
      fx = fx.filter((e) => t - e.t < 0.9);
      for (const e of fx) {
        const a = 1 - (t - e.t) / 0.9;
        ctx.strokeStyle = rgba(e.color, a); ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(e.x, e.y, 8 + (t - e.t) * 40, 0, TAU); ctx.stroke();
        V.text(ctx, e.text, e.x, e.y - 18 - (t - e.t) * 30, { align: "center", size: 16, color: rgba(e.color, a), font: FONT.display, weight: 800 });
      }
      // üst bilgi çubuğu
      if (state !== "idle" && game) {
        const items = [["Puan", num(game.score, 0)], ["İsabet", String(game.hits)], ["Iskalama", String(game.misses)], ["Kaçan", String(game.missed)], ["Yayın", `${Math.min(spawned, TOTAL)} / ${TOTAL}`]];
        if (state === "play" && spawned) items.push(["SNR", num(snrFor(spawned - 1), 1) + " dB"]);
        ctx.font = `700 13px ${FONT.body}`;
        let x = 10; const y = H - 34;
        const parts = items.map(([k, v]) => [k, v, ctx.measureText(k + " " + v).width + 22]);
        const tw = parts.reduce((s, p) => s + p[2], 0);
        ctx.fillStyle = "rgba(10,20,24,0.82)"; roundRect(ctx, 6, y - 2, Math.min(w - 12, tw + 8), 26, 4); ctx.fill();
        for (const [k, v, pw] of parts) {
          if (x + pw > w - 8) break;
          V.text(ctx, k, x + 4, y + 16, { size: 12, color: C.muted });
          ctx.font = `400 12px ${FONT.body}`; const kw = ctx.measureText(k + " ").width;
          V.text(ctx, v, x + 4 + kw, y + 16, { size: 13, color: C.ink, weight: 700 });
          x += pw;
        }
      }
    }
    const st = canvas(cv, draw);

    // tıklama: yayının frekansına isabet etti mi?
    L.pointer(cv, {
      down(x, y) {
        if (state !== "play" || !geo) return;
        const bin = (x / geo.w) * BINS;
        const cand = bursts.filter((b) => !b.hit && t >= b.t0 && t < b.t0 + b.dur + 1 && Math.abs(bin - b.c) <= b.w / 2 + 6);
        if (cand.length) {
          const b = cand[0]; b.hit = true;
          const rt = t - b.t0;
          const pts = 100 + Math.round(100 * Math.max(0, 1 - rt / 3)) + Math.max(0, Math.round((15 - b.snr) * 6));
          game.score += pts; game.hits++; game.rts.push(rt); game.log.push({ snr: b.snr, hit: true, rt, i: b.idx });
          fx.push({ x, y, t, text: "+" + pts, color: C.ink });
          Sound.play(beep([1320, 1760], 0.07, 0.3));
        } else {
          game.misses++; game.score = Math.max(0, game.score - 20);
          fx.push({ x, y, t, text: "−20", color: C.needle });
          Sound.play(beep([196], 0.12, 0.22));
        }
      },
    });
    cv.style.cursor = "crosshair";

    // kaplama: giriş ve sonuç ekranı
    const over = h("div.ch4-over");
    fill.append(over);
    function showIntro() {
      over.innerHTML = "";
      over.append(h("div.ch4-card",
        h("h3", "Sinyali bul"),
        h("p", "Gürültünün içinde 12 kısa yayın belirecek; her biri bir öncekinden biraz daha zayıf. Belirir belirmez üzerine tıklayın."),
        h("p.note-small", "Baştan beri orada olan iki istasyon sayılmaz. Boşa tıklamak 20 puan götürür."),
        h("button.btn.primary.big", { type: "button", onclick: newGame }, "Oyunu başlat")));
      over.hidden = false;
    }
    function showResult() {
      state = "done"; startBtn.textContent = "Oyunu başlat";
      const g = game, avgRt = g.rts.length ? g.rts.reduce((a, b) => a + b, 0) / g.rts.length : null;
      const caught = g.log.filter((l) => l.hit).map((l) => l.snr), weakest = caught.length ? Math.min(...caught) : null;
      const verdict = g.hits >= 11 ? "Usta dinleyici: gürültünün içindeki fısıltıyı bile yakaladınız."
        : g.hits >= 8 ? "Keskin göz: zayıf yayınlar zorladı ama çoğunu buldunuz."
        : g.hits >= 5 ? "Fena değil: zayıfladıkça iz gürültüye karıştı. Satırlar boyunca süren izlere bakın."
        : "Gürültü kazandı. Daha kolay bir seviyeyle yeniden deneyin.";
      // yayınlar SNR'ye göre: dolu nokta yakalandı, boş nokta kaçtı
      const ns = "http://www.w3.org/2000/svg", svg = document.createElementNS(ns, "svg");
      svg.setAttribute("viewBox", "0 0 300 44"); svg.setAttribute("class", "ch4-strip");
      svg.setAttribute("aria-label", "Yayınlar sırayla: dolu daire yakalandı, boş daire kaçtı");
      g.log.slice().sort((a, b) => a.i - b.i).forEach((l, i) => {
        const c = document.createElementNS(ns, "circle");
        c.setAttribute("cx", 14 + i * 24.7); c.setAttribute("cy", 16); c.setAttribute("r", 7);
        c.setAttribute("fill", l.hit ? C.ink : "none"); c.setAttribute("stroke", l.hit ? C.ink : C.needle); c.setAttribute("stroke-width", 1.6);
        svg.append(c);
        const tx = document.createElementNS(ns, "text");
        tx.setAttribute("x", 14 + i * 24.7); tx.setAttribute("y", 40); tx.setAttribute("text-anchor", "middle");
        tx.textContent = num(l.snr, 0); svg.append(tx);
      });
      over.innerHTML = "";
      over.append(h("div.ch4-card",
        h("h3", "Sonuç"),
        h("div.ch4-score", num(g.score, 0), h("small", " puan")),
        h("div.ch4-stats",
          h("div", h("span", "İsabet"), h("b", `${g.hits} / ${TOTAL}`)),
          h("div", h("span", "Ortalama tepki"), h("b", avgRt == null ? "–" : num(avgRt, 2) + " sn")),
          h("div", h("span", "Iskalama"), h("b", String(g.misses))),
          h("div", h("span", "En zayıf yakalanan"), h("b", weakest == null ? "–" : num(weakest, 1) + " dB SNR"))),
        h("p.note-small", "Yayınlar sırayla (altında SNR, dB): dolu daire yakalandı, boş daire kaçtı."),
        svg,
        h("p", verdict),
        h("button.btn.primary.big", { type: "button", onclick: newGame }, "Yeniden oyna")));
      over.hidden = false;
      STATS.game = { score: g.score, hits: g.hits, misses: g.misses, missed: g.missed, avgRt, weakest, level };
    }
    showIntro();

    const lvSeg = seg([["kolay", "Kolay"], ["orta", "Orta"], ["zor", "Zor"]], level, (k) => { level = k; }, "Zorluk");
    const startBtn = h("button.btn.primary", { type: "button", onclick: newGame }, "Oyunu başlat");
    ctrl.append(h("span.lab", "Zorluk (başlangıç SNR'si)"), lvSeg, startBtn,
      h("span.note-small.ch4-lvl", "Kolay 16 → 6 dB · Orta 12 → 2 dB · Zor 8 → −1 dB"));

    // oyun durumu dışarıdan okunabilir (otomatik test için)
    STATS.gameState = () => ({ state, t, spawned, bursts: bursts.map((b) => ({ x: (b.c / BINS), on: burstOn(b), hit: b.hit, snr: b.snr, w: b.w / BINS })), game });

    const fps = fpsMeter("sinyali-bul");
    const lp = loop((dt) => {
      const t0 = performance.now();
      if (state === "play") {
        t += dt;
        if (spawned < TOTAL && t >= nextAt) spawn();
        // süresi (ve 1 sn'lik payı) dolan, yakalanmamış yayınlar "kaçan" sayılır
        for (const b of bursts) if (!b.hit && !b.counted && t > b.t0 + b.dur + 1) { b.counted = true; game.missed++; game.log.push({ snr: b.snr, hit: false, i: b.idx }); }
        if (spawned >= TOTAL && bursts.every((b) => b.hit || b.counted)) showResult();
      } else t += dt;
      acc += dt;
      while (acc > 1 / ROW_HZ) { genRow(); acc -= 1 / ROW_HZ; }
      draw();
      fps.tick(performance.now() - t0);
    });
    for (let i = 0; i < ROWS; i++) genRow();
    return { enter() { fps.reset(); lp.start(); }, leave() { lp.stop(); } };
  };

  /* ---------- hayalet el senaryoları ---------- */
  window.GUIDE_SCENARIOS = Object.assign(window.GUIDE_SCENARIOS || {}, {
    fourier: [{ slide: "label:Harmonik sayısı", to: 15 }, { wait: 700 }, { click: "=Testere" }],
    fft: [{ slide: "label:İnce ayar", to: 0.5 }, { wait: 900 }, { click: "=Hann" }],
    desibel: [{ click: "=Desibel" }, { wait: 1400 }, { slide: "label:Zayıf istasyon", to: -45 }],
    selale: [{ tap: "css:.fill canvas", at: [0.15, 0.6] }, { wait: 900 }, { slide: "label:Hız", to: 50 }],
    "sinyali-bul": [{ click: "=Kolay" }, { click: "Oyunu başlat" }],
  });
})();

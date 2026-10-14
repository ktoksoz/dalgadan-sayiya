/* Bölüm 7: Gerçek dünyada.
   - galeri: tarayıcıda üretilen (sentetik) gerçekçi sinyaller: FM yayın, ADS-B, NOAA APT, amatör telsiz, 433 MHz kumanda.
     Her biri gerçek zamanlı IQ olarak üretilir; şelale, spektrum, çözücü (paket/görüntü/metin) ve ses aynı IQ'dan çıkar.
   - iqfile: kullanıcının kendi IQ kaydı (.cu8/.cs8/.cs16/.cf32/SigMF). Dosya File.slice ile parça parça okunur.
   - legal: "Bunu yapabilir miyim?" senaryo kartları ve frekans kadranı.
   Kapanış slaytı (son) kapak demosunu (Demos.cover, outro) kullanır. */
(function () {
  const { C, FONT, rgba, h, canvas, loop, clamp, seg, toggle, num } = L;
  const TAU = Math.PI * 2;
  const sinL = Signals.sinL, cosL = Signals.cosL;

  /* ---------------- yerel yardımcılar ---------------- */
  // Gauss gürültüsü tablosu (örnek başına log/sqrt hesaplamamak için)
  const GN = 1 << 16, GT = new Float32Array(GN);
  (() => { const r = DSP.rng(777); for (let i = 0; i < GN; i++) GT[i] = DSP.gaussian(r); })();
  function noise(out, n, sigma, r) {
    let gi = (r() * GN) | 0; const gs = 1 + 2 * ((r() * 4096) | 0);
    for (let i = 0; i < 2 * n; i++) { out[i] = sigma * GT[gi]; gi = (gi + gs) & (GN - 1); }
    return out;
  }
  // MHz biçimi: adım büyüklüğüne göre ondalık
  function mhz(f, step) {
    const d = step >= 1e6 ? 0 : step >= 1e5 ? 1 : step >= 1e4 ? 2 : step >= 1e3 ? 3 : 4;
    return num(f / 1e6, d);
  }
  function ticksHz(lo, hi, count) {
    const t = V.ticks(lo, hi, count);
    return t;
  }
  // Frekans skalası (gerçek Hz) çizer: üstte etiketler, alt kenar çizgisi y'de
  function freqScale(ctx, x, y, w, lo, hi, count) {
    const t = ticksHz(lo, hi, count);
    V.scale(ctx, { x, y, w, from: lo, to: hi, major: t.major, minor: t.minor, fmt: (v) => mhz(v, t.step), up: true, size: 13, color: C.ink });
    return t;
  }
  // Döner fazörle karıştırıcı (yüksek hızlı akışlarda cos/sin hesaplamadan)
  class Rotator {
    constructor(f = 0) { this.c = 1; this.s = 0; this.set(f); this.k = 0; }
    set(f) { this.f = f; this.wc = Math.cos(TAU * f); this.ws = Math.sin(TAU * f); }
    mix(buf, out = new Float32Array(buf.length)) {
      let c = this.c, s = this.s; const wc = this.wc, ws = this.ws, n = buf.length >> 1;
      for (let i = 0; i < n; i++) {
        const I = buf[2 * i], Q = buf[2 * i + 1];
        out[2 * i] = I * c - Q * s; out[2 * i + 1] = I * s + Q * c;
        const c2 = c * wc - s * ws; s = c * ws + s * wc; c = c2;
        if ((++this.k & 1023) === 0) { const m = 1 / Math.hypot(c, s); c *= m; s *= m; }
      }
      this.c = c; this.s = s;
      return out;
    }
  }
  // Azaltmalı FIR: yalnızca tutulacak çıkışları hesaplar; karmaşık ya da gerçek akış
  class DecFIR {
    constructor(hh, M, complex = true) { this.h = hh; this.M = M; this.cx = complex; this.ph = 0; this.dh = null; }
    process(x) {
      const hh = this.h, T = hh.length, M = this.M, st = this.cx ? 2 : 1, n = x.length / st;
      const hl = st * (T - 1);
      if (!this.dh) this.dh = new Float32Array(hl);
      const buf = new Float32Array(hl + x.length);
      buf.set(this.dh); buf.set(x, hl);
      const outN = Math.max(0, Math.ceil((n - this.ph) / M)), out = new Float32Array(st * outN);
      let k = 0;
      for (let i = this.ph; i < n; i += M) {
        const base = st * (T - 1 + i);
        if (st === 2) {
          let a = 0, b = 0;
          for (let t = 0; t < T; t++) { const j = base - 2 * t; a += hh[t] * buf[j]; b += hh[t] * buf[j + 1]; }
          out[2 * k] = a; out[2 * k + 1] = b;
        } else {
          let a = 0;
          for (let t = 0; t < T; t++) a += hh[t] * buf[base - t];
          out[k] = a;
        }
        k++;
      }
      this.ph = this.ph + outN * M - n;
      this.dh = buf.slice(buf.length - hl);
      return out;
    }
  }
  // Düşük hızlı ses kaynağını U kat yükseltir (doğrusal aradeğerleme)
  class Up {
    constructor(src, U, lowRate) { this.src = src; this.U = U; this.lr = lowRate; this.x0 = 0; this.x1 = 0; this.p = 0; this.b = new Float32Array(256); this.bi = 256; }
    fill(out, n, gain = 1) {
      const U = this.U; let { x0, x1, p } = this;
      for (let i = 0; i < n; i++) {
        out[i] = (x0 + (x1 - x0) * (p / U)) * gain;
        if (++p === U) { p = 0; x0 = x1; if (this.bi >= 256) { this.src.next(this.b, this.lr); this.bi = 0; } x1 = this.b[this.bi++]; }
      }
      this.x0 = x0; this.x1 = x1; this.p = p;
      return out;
    }
  }
  // Basit tek kutuplu alçak geçiren (karmaşık)
  const onePole = (fc, rate) => 1 - Math.exp(-TAU * fc / rate);
  // Bir dizinin yüzdelik değeri (gürültü tabanı tahmini)
  function percentile(a, q) {
    const s = Float32Array.from(a).sort();
    return s[Math.floor(clamp(q, 0, 1) * (s.length - 1))];
  }
  // Mors alfabesi (tam)
  const MORSE = {
    A: ".-", B: "-...", C: "-.-.", D: "-..", E: ".", F: "..-.", G: "--.", H: "....", I: "..", J: ".---", K: "-.-", L: ".-..",
    M: "--", N: "-.", O: "---", P: ".--.", Q: "--.-", R: ".-.", S: "...", T: "-", U: "..-", V: "...-", W: ".--", X: "-..-",
    Y: "-.--", Z: "--..", 0: "-----", 1: ".----", 2: "..---", 3: "...--", 4: "....-", 5: ".....", 6: "-....", 7: "--...",
    8: "---..", 9: "----.", "/": "-..-.", "?": "..--..",
  };
  const MORSE_INV = Object.fromEntries(Object.entries(MORSE).map(([k, v]) => [v, k]));
  // Mors anahtarlama dizisi: [açık mı, birim sayısı]
  function morseSeq(text) {
    const seq = [];
    text.split(" ").forEach((word, wi) => {
      word.split("").forEach((ch, ci) => {
        (MORSE[ch] || "").split("").forEach((s, k, arr) => { seq.push([1, s === "." ? 1 : 3]); if (k < arr.length - 1) seq.push([0, 1]); });
        if (ci < word.length - 1) seq.push([0, 3]);
      });
      seq.push([0, 7]);
    });
    seq.push([0, 14]);
    return seq;
  }

  /* ---------------- Mode S / ADS-B ---------------- */
  // CRC-24, üreteç 0x1FFF409 (ICAO Annex 10). bits: Uint8Array
  function crc24(bits, n) {
    let crc = 0;
    for (let i = 0; i < n; i++) {
      const top = ((crc >>> 23) & 1) ^ bits[i];
      crc = (crc << 1) & 0xffffff;
      if (top) crc ^= 0xfff409;
    }
    return crc;
  }
  const hexOf = (bits) => { let s = ""; for (let i = 0; i < bits.length; i += 4) s += ((bits[i] << 3) | (bits[i + 1] << 2) | (bits[i + 2] << 1) | bits[i + 3]).toString(16).toUpperCase(); return s; };
  const bitsOf = (hex) => { const b = new Uint8Array(hex.length * 4); for (let i = 0; i < hex.length; i++) { const v = parseInt(hex[i], 16); for (let k = 0; k < 4; k++) b[4 * i + k] = (v >> (3 - k)) & 1; } return b; };
  const pushBits = (arr, v, n) => { for (let k = n - 1; k >= 0; k--) arr.push((v / 2 ** k) & 1); };
  const CS = "#ABCDEFGHIJKLMNOPQRSTUVWXYZ##### ###############0123456789######";
  function modeS(df, icao, me, r) {
    const b = [];
    pushBits(b, df, 5); pushBits(b, 5, 3); pushBits(b, icao, 24);
    if (df === 17) me(b, r);
    const n = df === 17 ? 88 : 32;
    const bits = Uint8Array.from(b.concat(new Array(24).fill(0)));
    const p = crc24(bits, n);
    for (let k = 0; k < 24; k++) bits[n + k] = (p >> (23 - k)) & 1;
    return bits;
  }
  const meIdent = (cs) => (b) => { pushBits(b, 4, 5); pushBits(b, 0, 3); cs.padEnd(8).split("").forEach((c) => pushBits(b, Math.max(0, CS.indexOf(c)), 6)); };
  const meRand = (tc) => (b, r) => { pushBits(b, tc, 5); for (let i = 0; i < 51; i++) b.push(r() < 0.5 ? 1 : 0); };
  function describe(bits) {
    const df = (bits[0] << 4) | (bits[1] << 3) | (bits[2] << 2) | (bits[3] << 1) | bits[4];
    const n = df >= 16 ? 112 : 56;
    const ok = crc24(bits, n) === 0;
    let icao = 0; for (let i = 8; i < 32; i++) icao = icao * 2 + bits[i];
    let info = "";
    if (df === 17) {
      let tc = 0; for (let i = 32; i < 37; i++) tc = tc * 2 + bits[i];
      if (tc >= 1 && tc <= 4) { let s = ""; for (let c = 0; c < 8; c++) { let v = 0; for (let k = 0; k < 6; k++) v = v * 2 + bits[40 + 6 * c + k]; s += CS[v]; } info = "çağrı adı " + s.replace(/[# ]+$/g, ""); }
      else if (tc >= 9 && tc <= 18) info = "konum ve yükseklik";
      else if (tc === 19) info = "hız ve yön";
      else info = "tür " + tc;
    } else if (df === 11) info = "kısa yanıt (56 bit)";
    return { df, n, ok, icao: icao.toString(16).toUpperCase().padStart(6, "0"), info };
  }

  /* ================= 1. GALERİ ================= */
  const ROWS_PER_SEC = 30;

  // --- FM yayın (geniş FM, 19 kHz pilot, stereo alt taşıyıcı) ---
  function makeFM(opts) {
    const rate = 480000, U = 10, r = DSP.rng(41);
    const A = new Up(Music.melody({ timbre: "flute", bpm: 116 }), U, rate / U);
    const B = new Up(Music.melody({ timbre: "organ", bpm: 116, transpose: -5, gain: 0.45 }), U, rate / U);
    const N1 = new Up(Music.melody({ timbre: "pure", bpm: 96, transpose: 3 }), U, rate / U);
    const N2 = new Up(Music.voice({ pitch: 140, seed: 5 }), U, rate / U);
    let a = new Float32Array(0), b = a, c = a, d = a;
    let ph = 0, pil = 0, ph1 = 1, ph2 = 2, fp1 = 0, fp2 = 0;
    const kdev = TAU * 75000 / rate, wP = TAU * 19000 / rate, w1 = TAU * -200000 / rate, w2 = TAU * 200000 / rate;
    const amp0 = 10 ** (-14 / 20), amp1 = 10 ** (-27 / 20), amp2 = 10 ** (-31 / 20), sig = 10 ** (-40 / 20) / Math.SQRT2;
    // alıcı: kanal süzgeci (480→240 kHz), faz farkı demodülatörü, ses süzgeci (240→48 kHz), 50 µs de-emfazis
    const chan = new DecFIR(DSP.firLowpass(63, 108000 / rate), 2);
    const disc = new DSP.FMDemod();
    const aud = new DecFIR(DSP.firLowpass(61, 15000 / 240000), 5, false);
    // MPX (çözülmüş taban bant) spektrumu
    const MN = 2048, mpxBuf = new Float32Array(MN), mpxAvg = new DSP.SpectrumAverager(MN / 2);
    let mpxFill = 0, mpxDb = null;
    const re = new Float64Array(MN), im = new Float64Array(MN), win = DSP.window("hann", MN);
    return {
      id: "fm", fc: 100.0e6, rate, N: 1024, listenRate: 48000, bw: 200000,
      gen(n) {
        if (a.length < n) { a = new Float32Array(n); b = new Float32Array(n); c = new Float32Array(n); d = new Float32Array(n); }
        A.fill(a, n); B.fill(b, n); N1.fill(c, n); N2.fill(d, n, 2.2);
        const out = noise(new Float32Array(2 * n), n, sig, r), st = opts.stereo;
        for (let i = 0; i < n; i++) {
          const Lc = a[i] + 0.5 * b[i], Rc = 0.5 * a[i] + b[i];
          let mpx;
          if (st) mpx = 0.45 * (Lc + Rc) / 1.5 + 0.45 * ((Lc - Rc) / 1.5) * sinL(2 * pil) + 0.1 * sinL(pil);
          else mpx = 0.9 * (Lc + Rc) / 3;
          pil += wP;
          ph += kdev * mpx;
          out[2 * i] += amp0 * cosL(ph); out[2 * i + 1] += amp0 * sinL(ph);
          fp1 += w1 + kdev * c[i]; fp2 += w2 + kdev * Math.tanh(d[i]);
          out[2 * i] += amp1 * cosL(fp1 + ph1); out[2 * i + 1] += amp1 * sinL(fp1 + ph1);
          out[2 * i] += amp2 * cosL(fp2 + ph2); out[2 * i + 1] += amp2 * sinL(fp2 + ph2);
        }
        ph %= TAU; pil %= TAU; fp1 %= TAU; fp2 %= TAU;
        return out;
      },
      process(iq, wantAudio) {
        const ch = chan.process(iq), f = disc.process(ch);
        for (let i = 0; i < f.length; i++) f[i] *= 240000 / 75000; // ±1 = ±75 kHz sapma
        // MPX spektrumu için örnek topla
        for (let i = 0; i < f.length; i++) {
          mpxBuf[mpxFill++] = f[i];
          if (mpxFill === MN) {
            for (let k = 0; k < MN; k++) { re[k] = mpxBuf[k] * win[k]; im[k] = 0; }
            DSP.fft(re, im);
            const db = new Float32Array(MN / 2), nrm = 1 / (MN * win.gain);
            for (let k = 0; k < MN / 2; k++) db[k] = 10 * Math.log10((re[k] * re[k] + im[k] * im[k]) * nrm * nrm * 4 + 1e-20);
            mpxDb = mpxAvg.push(db, 0.25);
            mpxFill = 0;
          }
        }
        if (!wantAudio) return null;
        const au = aud.process(f);
        for (let i = 0; i < au.length; i++) au[i] = clamp(au[i] * 1.6, -1, 1);
        return au;
      },
      inset(ctx, w, H) {
        // çözülmüş taban bant (MPX): 0–60 kHz
        const x0 = 8, y0 = 26, ww = w - 16, hh = H - 50;
        V.text(ctx, "FM'i çözünce çıkan taban bant (MPX)", 10, 16, { color: C.ink2, size: 12 });
        const fmax = 60000, bins = Math.round(fmax / (240000 / MN));
        ctx.strokeStyle = rgba(C.line, 1); ctx.strokeRect(x0 + 0.5, y0 + 0.5, ww - 1, hh - 1);
        const zones = [[30, 15000, "L+R (mono)"], [19000 - 400, 19000 + 400, "pilot"], [23000, 53000, "L−R (stereo)"]];
        zones.forEach(([fa, fb, lab], zi) => {
          const xa = x0 + (fa / fmax) * ww, xb = x0 + (fb / fmax) * ww;
          ctx.fillStyle = rgba(C.ink, zi === 1 ? 0.0 : 0.04); ctx.fillRect(xa, y0, xb - xa, hh);
        });
        if (mpxDb) V.spectrum(ctx, { x: x0, y: y0, w: ww, h: hh, db: mpxDb, from: 0, to: bins, min: -95, max: -5 });
        const lab = (f, s, al = "center") => V.text(ctx, s, x0 + (f / fmax) * ww, y0 + 14, { color: C.ink, size: 11.5, align: al, weight: 700 });
        lab(7500, "L+R (mono)");
        if (opts.stereo) { lab(19000, "19 kHz pilot"); lab(38000, "L−R (stereo)"); }
        else V.text(ctx, "stereo kapalı: pilot ve L−R yok", x0 + ww - 6, y0 + 14, { color: C.muted, size: 11.5, align: "right" });
        [0, 15, 19, 38, 57].forEach((k) => {
          const x = x0 + (k * 1000 / fmax) * ww;
          V.text(ctx, k + (k === 57 ? " kHz" : ""), x, H - 8, { color: C.muted, size: 11, align: k === 0 ? "left" : k === 57 ? "center" : "center" });
        });
      },
    };
  }

  // --- ADS-B (1090 MHz, PPM, 1 Mbit/sn) ---
  function makeADSB() {
    const rate = 2.4e6, spu = rate / 1e6, r = DSP.rng(1090);
    const sigN = 10 ** (-42 / 20) / Math.SQRT2;
    const planes = [
      { icao: 0x4b1a2c, cs: "DALGA1", amp: 0.42, f: 0.004 },
      { icao: 0x4b3d07, cs: "IQ2048", amp: 0.2, f: -0.006 },
      { icao: 0x4ca9f1, cs: "SDR001", amp: 0.12, f: 0.011 },
      { icao: 0x3c6512, cs: "FFT1024", amp: 0.08, f: -0.002 },
      { icao: 0x4b8e55, cs: "NYQST", amp: 0.06, f: 0.008 },
    ];
    planes.forEach((p) => { p.next = { id: r() * 4, pos: r() * 0.5, vel: r() * 0.5, df11: r() }; });
    const PER = { id: 4.8, pos: 0.5, vel: 0.9, df11: 1.4 };
    let t = 0;
    const active = [];
    // darbe zarfı: her örnek aralığının darbelerle örtüşen kesri (8 alt örnek)
    function envelope(bits) {
      const pulses = [[0, 0.5], [1, 1.5], [3.5, 4], [4.5, 5]];
      for (let k = 0; k < bits.length; k++) { const s = 8 + k + (bits[k] ? 0 : 0.5); pulses.push([s, s + 0.5]); }
      const L = Math.ceil((8 + bits.length) * spu) + 3, e = new Float32Array(L);
      let pi = 0;
      for (let i = 0; i < L; i++) {
        let acc = 0;
        for (let q = 0; q < 8; q++) {
          const tu = (i + (q + 0.5) / 8) / spu;
          while (pi < pulses.length && pulses[pi][1] <= tu) pi++;
          if (pi < pulses.length && pulses[pi][0] <= tu) acc++;
        }
        e[i] = acc / 8;
      }
      // sınırlı bant genişliği: kenarları biraz yumuşat
      const s = Float32Array.from(e);
      for (let i = 1; i < L - 1; i++) e[i] = 0.12 * s[i - 1] + 0.76 * s[i] + 0.12 * s[i + 1];
      return e;
    }
    function launch(p, kind, startSample) {
      let bits;
      if (kind === "df11") bits = modeS(11, p.icao, null, r);
      else bits = modeS(17, p.icao, kind === "id" ? meIdent(p.cs) : meRand(kind === "pos" ? 11 : 19), r);
      active.push({ env: envelope(bits), pos: -startSample, amp: p.amp * (0.85 + 0.3 * r()), w: TAU * (p.f + (r() - 0.5) * 0.001), ph: r() * TAU });
    }
    // çözücü durumu
    let tail = new Float32Array(0);
    const msgs = [];
    let last = null, total = 0, good = 0, nf = sigN * sigN * 2;
    function decode(iq) {
      const buf = new Float32Array(tail.length + iq.length); buf.set(tail); buf.set(iq, tail.length);
      const n = buf.length >> 1, p = new Float32Array(n), P = new Float64Array(n + 1);
      let mean = 0;
      for (let i = 0; i < n; i++) { p[i] = buf[2 * i] ** 2 + buf[2 * i + 1] ** 2; P[i + 1] = P[i] + p[i]; mean += p[i]; }
      mean /= n; nf += (Math.min(mean, nf * 3) - nf) * 0.05;
      const thr = nf * 10;
      const F = (x) => { const i = Math.floor(x); if (i < 0) return 0; if (i >= n) return P[n]; return P[i] + (x - i) * p[i]; };
      const E = (tau, a, b) => F(tau + b * spu) - F(tau + a * spu);
      const need = Math.ceil(120 * spu) + 6;
      let i = 3, stopAt = n - need;
      while (i < stopAt) {
        if (p[i] < thr) { i++; continue; }
        // başlangıç darbesinin konumunu kesirli olarak ara
        let best = -Infinity, tau = i;
        for (let tt = i - 1.5; tt <= i + 1.6; tt += 0.1) {
          const on = E(tt, 0, 0.5) + E(tt, 1, 1.5) + E(tt, 3.5, 4) + E(tt, 4.5, 5);
          const off = E(tt, 0.5, 1) + E(tt, 1.5, 3.5) + E(tt, 5, 8);
          const sc = on - off * (2 / 5.5);
          if (sc > best) { best = sc; tau = tt; }
        }
        const on = (E(tau, 0, 0.5) + E(tau, 1, 1.5) + E(tau, 3.5, 4) + E(tau, 4.5, 5)) / 2;
        const off = (E(tau, 0.5, 1) + E(tau, 1.5, 3.5) + E(tau, 5, 8)) / 5.5;
        if (on < off * 4) { i++; continue; }
        const bits = new Uint8Array(112);
        for (let k = 0; k < 112; k++) bits[k] = E(tau, 8 + k, 8.5 + k) > E(tau, 8.5 + k, 9 + k) ? 1 : 0;
        const d = describe(bits);
        const used = bits.subarray(0, d.n);
        total++; if (d.ok) good++;
        const hex = hexOf(used);
        msgs.unshift({ ...d, hex }); if (msgs.length > 4) msgs.pop();
        if (d.ok || !last) {
          // ilk 32 µs'nin zarfını sakla (başlangıç + ilk 24 bit)
          const s0 = Math.floor(tau - spu), L = Math.ceil(34 * spu), env = new Float32Array(L);
          for (let k = 0; k < L; k++) env[k] = Math.sqrt(p[clamp(s0 + k, 0, n - 1)]);
          last = { env, off: tau - s0, bits: Array.from(used.subarray(0, 24)), ...d, hex };
        }
        i = Math.ceil(tau + (8 + d.n) * spu) + 2;
      }
      const keep = Math.max(0, Math.min(n, i) - 3);
      tail = buf.slice(2 * keep);
    }
    return {
      id: "adsb", fc: 1090e6, rate, N: 1024, bursty: true, listenRate: 48000, bw: 2e6,
      gen(n) {
        const out = noise(new Float32Array(2 * n), n, sigN, r), dt = 1 / rate;
        // bu blokta başlayacak mesajlar
        for (const p of planes) for (const k of Object.keys(PER)) {
          while (p.next[k] < t + n * dt) {
            launch(p, k, Math.max(0, Math.round((p.next[k] - t) * rate)));
            p.next[k] += PER[k] * (0.8 + 0.4 * r());
          }
        }
        for (let a = active.length - 1; a >= 0; a--) {
          const m = active[a];
          const i0 = Math.max(0, -m.pos), i1 = Math.min(n, m.env.length - m.pos);
          for (let i = i0; i < i1; i++) {
            const e = m.env[m.pos + i] * m.amp, ph = m.ph + m.w * (m.pos + i);
            out[2 * i] += e * Math.cos(ph); out[2 * i + 1] += e * Math.sin(ph);
          }
          m.pos += n;
          if (m.pos >= m.env.length) active.splice(a, 1);
        }
        t += n * dt;
        return out;
      },
      process(iq, wantAudio) {
        decode(iq);
        if (!wantAudio) return null;
        // genlik zarfı → 48 kHz (50 örnekte bir en büyük): darbeler tık sesi olarak duyulur
        const n = iq.length >> 1, M = 50, out = new Float32Array(Math.floor(n / M));
        for (let k = 0; k < out.length; k++) {
          let m = 0; for (let j = 0; j < M; j++) { const i = k * M + j, v = iq[2 * i] ** 2 + iq[2 * i + 1] ** 2; if (v > m) m = v; }
          out[k] = Math.sqrt(m);
        }
        let mu = 0; for (let k = 0; k < out.length; k++) mu += out[k]; mu /= out.length || 1;
        for (let k = 0; k < out.length; k++) out[k] = clamp((out[k] - mu) * 2.2, -1, 1);
        return out;
      },
      inset(ctx, w, H) {
        V.text(ctx, "Son paketin ilk 32 µs'si: başlangıç + ilk 24 bit", 10, 16, { color: C.ink2, size: 12 });
        const x0 = 10, ww = w - 20, y0 = 30, hh = Math.max(40, H * 0.36);
        if (last) {
          const pxu = ww / 33; // 1 µs kaç piksel
          // başlangıç bölgesi
          ctx.fillStyle = rgba(C.ink, 0.06); ctx.fillRect(x0 + pxu, y0, 8 * pxu, hh);
          V.text(ctx, "başlangıç (8 µs)", x0 + pxu + 4, y0 + hh - 5, { color: C.muted, size: 10.5 });
          let mx = 1e-9; for (const v of last.env) mx = Math.max(mx, v);
          ctx.beginPath();
          for (let k = 0; k < last.env.length; k++) {
            const us = (k - last.off) / spu + 1, x = x0 + us * pxu, y = y0 + hh - (last.env[k] / mx) * (hh - 14);
            k ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
          }
          ctx.lineTo(x0 + ww, y0 + hh); ctx.lineTo(x0, y0 + hh); ctx.closePath();
          ctx.fillStyle = rgba(C.ink, 0.16); ctx.fill();
          ctx.strokeStyle = C.ink; ctx.lineWidth = 1.3; ctx.stroke();
          // bit hücreleri ve değerleri
          for (let k = 0; k < 23; k++) {
            const xa = x0 + (9 + k) * pxu;
            if (xa + pxu > x0 + ww + 1) break;
            ctx.strokeStyle = rgba(C.ink, 0.13); ctx.beginPath(); ctx.moveTo(xa + 0.5, y0); ctx.lineTo(xa + 0.5, y0 + hh); ctx.stroke();
            V.text(ctx, String(last.bits[k]), xa + pxu / 2, y0 + 11, { color: k < 5 ? C.ink : C.ink2, size: 10.5, align: "center", weight: 700 });
          }
          const yy = y0 + hh + 18;
          V.text(ctx, last.hex.slice(0, 14) + (last.hex.length > 14 ? " " + last.hex.slice(14) : ""), x0, yy, { color: C.ink, size: 12.5, weight: 700 });
          V.text(ctx, `DF${last.df} · ICAO ${last.icao} · ${last.info} · CRC ${last.ok ? "✓" : "✕"}`, x0, yy + 17, { color: C.ink2, size: 11.5 });
          V.text(ctx, `Çözülen paket: ${total} · CRC geçerli: ${good}`, x0, yy + 34, { color: C.muted, size: 11 });
        } else V.text(ctx, "Paket bekleniyor…", x0, y0 + 20, { color: C.muted, size: 12 });
      },
    };
  }

  // --- NOAA APT: FM içinde 2400 Hz AM alt taşıyıcı; 4160 kelime/sn, saniyede 2 satır ---
  function hash2(i, j) {
    let x = (Math.imul(i, 374761393) + Math.imul(j, 668265263)) | 0;
    x = Math.imul(x ^ (x >>> 13), 1274126177); x ^= x >>> 16;
    return (x >>> 0) / 4294967296;
  }
  function vnoise(x, y) {
    const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
    const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
    const a = hash2(xi, yi), b = hash2(xi + 1, yi), c = hash2(xi, yi + 1), d = hash2(xi + 1, yi + 1);
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
  }
  function fbm(x, y, o) { let s = 0, a = 0.5, f = 1; for (let k = 0; k < o; k++) { s += a * vnoise(x * f, y * f); f *= 2.03; a *= 0.5; } return s / (1 - 0.5 ** o); }
  const APT_W = 2080;
  // Bir APT satırı (0…1 kelime değerleri). Düzen: senk A 39, boşluk A 47, görüntü A 909, telemetri A 45, (B aynı)
  function aptLine(L) {
    const out = new Float32Array(APT_W), v = L * 0.0089, wedge = Math.floor(L / 8) % 16;
    const tele = wedge < 8 ? (wedge + 1) / 8 : [0, 0.42, 0.44, 0.43, 0.45, 0.4, 0.31, 0.5][wedge - 8];
    const marker = L % 120 < 2;
    for (let k = 0; k < 39; k++) {
      out[k] = k >= 4 && k < 32 && (k - 4) % 4 < 2 ? 0.95 : 0.05;
      out[1040 + k] = k >= 4 && k < 39 && (k - 4) % 5 < 3 ? 0.95 : 0.05;
    }
    for (let k = 39; k < 86; k++) { out[k] = marker ? 0.95 : 0.06; out[1040 + k] = marker ? 0.06 : 0.92; }
    for (let k = 0; k < 909; k++) {
      const u = k / 909;
      const land = fbm(u * 2.4 + 7.3, v * 2.4 + 1.1, 4);
      const isLand = clamp((land - 0.5) * 14, 0, 1);
      const det = fbm(u * 9 + 3, v * 9, 3);
      const cl = fbm(u * 3.2 + 40 + v * 0.6, v * 3.2 + 9, 5);
      const cloud = clamp((cl - 0.47) * 3.4, 0, 1) ** 1.2;
      const limb = 1 - 0.28 * (2 * u - 1) ** 4;
      const a = (0.1 + 0.03 * det) * (1 - isLand) + (0.32 + 0.16 * det) * isLand;
      const b = (0.5 + 0.03 * det) * (1 - isLand) + (0.36 + 0.1 * det) * isLand;
      out[86 + k] = clamp((a + (0.93 - a) * cloud) * limb, 0, 1);
      out[1040 + 86 + k] = clamp((b + (0.97 - b) * cloud) * (0.92 + 0.08 * limb), 0, 1);
    }
    for (let k = 995; k < 1040; k++) { out[k] = tele; out[1040 + k] = tele; }
    return out;
  }
  const SYNC_A = Float32Array.from({ length: 39 }, (_, k) => (k >= 4 && k < 32 && (k - 4) % 4 < 2 ? 1 : 0) - 0.36);
  function makeAPT(opts) {
    const rate = 96000, r = DSP.rng(137), WR = 4160;
    const sigN = 10 ** (-33 / 20) / Math.SQRT2, amp = 10 ** (-12 / 20);
    const kdev = TAU * 17000 / rate, wSub = TAU * 2400 / rate;
    let t0 = 0.137, sp = 0, ph = 0, curL = -1, line = null, sub = 0;
    // çözücü: FM ayrıştırıcı → 2400 Hz AM zarfı → 4160 kelime/sn → satır
    // 2400 Hz'i 0'a indirince 4800 Hz'te bir yansıma kalır; 20 örneklik kayan ortalama (96000/4800) onu tam söndürür
    const disc = new DSP.FMDemod(), BOX = rate / 4800, bR = new Float32Array(BOX), bI = new Float32Array(BOX);
    let sR = 0, sI = 0, bi = 0, subD = 0, wacc = 0;
    const words = []; let synced = -1, lines = 0;
    const IMG_H = 220, img = document.createElement("canvas"); img.width = APT_W; img.height = IMG_H;
    const ix = img.getContext("2d"); ix.fillStyle = "#000"; ix.fillRect(0, 0, APT_W, IMG_H);
    const rowData = ix.createImageData(APT_W, 1);
    let audLP = 0;
    function emitLine(ws) {
      // kaydır ve yeni satırı en alta yaz
      if (lines >= IMG_H) ix.drawImage(img, 0, 1, APT_W, IMG_H - 1, 0, 0, APT_W, IMG_H - 1);
      const y = Math.min(lines, IMG_H - 1), d = rowData.data;
      for (let k = 0; k < APT_W; k++) { const g = Math.round(clamp(ws[k], 0, 1) * 255); d[4 * k] = d[4 * k + 1] = d[4 * k + 2] = g; d[4 * k + 3] = 255; }
      ix.putImageData(rowData, 0, y);
      lines++;
    }
    return {
      id: "apt", fc: 137.1e6, rate, N: 1024, listenRate: 48000, bw: 34000,
      get speed() { return opts.fast ? 8 : 1; },
      gen(n) {
        const out = noise(new Float32Array(2 * n), n, sigN, r), dt = 1 / rate;
        for (let i = 0; i < n; i++) {
          const tw = t0 * WR, L = Math.floor(t0 * 2);
          if (L !== curL) { curL = L; line = aptLine(L); }
          const pos = tw - L * APT_W, k = Math.min(APT_W - 1, Math.floor(pos));
          const val = 0.04 + 0.92 * line[k];
          const audio = val * Math.sin(sp);
          sp += wSub; if (sp > TAU) sp -= TAU;
          ph += kdev * audio;
          out[2 * i] += amp * cosL(ph); out[2 * i + 1] += amp * sinL(ph);
          t0 += dt;
        }
        ph %= TAU;
        return out;
      },
      process(iq, wantAudio) {
        const f = disc.process(iq), n = f.length;
        const g = rate / 17000;
        const au = wantAudio ? new Float32Array(n >> 1) : null;
        for (let i = 0; i < n; i++) {
          const x = f[i] * g; // ±1 ≈ ±17 kHz
          if (au && (i & 1)) au[i >> 1] = clamp((x + audLP) * 0.35, -1, 1);
          audLP = x;
          // 2400 Hz alt taşıyıcıyı 0'a indir ve süz → genlik = piksel
          const c = Math.cos(subD), s = Math.sin(subD);
          subD += wSub; if (subD > TAU) subD -= TAU;
          const vr = x * c, vi = -x * s;
          sR += vr - bR[bi]; sI += vi - bI[bi]; bR[bi] = vr; bI[bi] = vi; bi = (bi + 1) % BOX;
          wacc += WR / rate;
          if (wacc >= 1) { wacc -= 1; words.push((2 / BOX) * Math.hypot(sR, sI)); }
        }
        // satır eşleme: ilk iki satırda senk A desenini ilişkilendirerek bul
        if (synced < 0 && words.length >= APT_W + 60) {
          let best = -Infinity;
          for (let o = 0; o < APT_W; o++) { let s = 0; for (let k = 0; k < 39; k++) s += SYNC_A[k] * words[o + k]; if (s > best) { best = s; synced = o; } }
          words.splice(0, synced);
        }
        if (synced >= 0) while (words.length >= APT_W) {
          const ws = words.splice(0, APT_W);
          // kelime değerini 0…1'e çevir (üretimde 0,04 + 0,92·değer)
          for (let k = 0; k < APT_W; k++) ws[k] = (ws[k] - 0.04) / 0.92;
          emitLine(ws);
        }
        return au;
      },
      inset(ctx, w, H) {
        V.text(ctx, `Çözülen görüntü · ${lines} satır` + (opts.fast ? " · 8× hızlı" : ""), 10, 16, { color: C.ink2, size: 12 });
        const x0 = 8, ww = w - 16, y0 = 26, hh = H - 34;
        ctx.fillStyle = "#000"; ctx.fillRect(x0, y0, ww, hh);
        const lh = Math.max(1, ww * 0.0039), show = Math.min(lines, IMG_H, Math.floor(hh / lh));
        if (show > 0) {
          ctx.imageSmoothingEnabled = true;
          const src0 = Math.min(lines, IMG_H) - show;
          ctx.drawImage(img, 0, src0, APT_W, show, x0, y0 + hh - show * lh, ww, show * lh);
        } else V.text(ctx, "Senk A aranıyor…", x0 + ww / 2, y0 + hh / 2, { color: C.muted, size: 12, align: "center" });
        // bölüm etiketleri
        const lab = (k0, k1, s) => { const xa = x0 + (k0 / APT_W) * ww, xb = x0 + (k1 / APT_W) * ww; V.text(ctx, s, (xa + xb) / 2, y0 + 13, { color: C.ink, size: 10.5, align: "center", weight: 700 }); };
        ctx.fillStyle = rgba(C.bg, 0.6); ctx.fillRect(x0, y0, ww, 18);
        lab(0, 86, "senk A"); lab(86, 995, "görüntü A (görünür)"); lab(1040, 1126, "senk B"); lab(1126, 2035, "görüntü B (kızılötesi)");
      },
    };
  }

  // --- Amatör telsiz: dar bant FM konuşma ya da Mors (CW) ---
  function makeHam(opts) {
    if (opts.cw) return makeCW(opts);
    const rate = 48000, r = DSP.rng(145);
    const sigN = 10 ** (-42 / 20) / Math.SQRT2;
    const st = [
      { f: 0, amp: 10 ** (-18 / 20), src: Music.voice({ pitch: 118, seed: 7 }), duty: [4.5, 2.6], on: true, timer: 3.5 },
      { f: 12500, amp: 10 ** (-30 / 20), src: Music.voice({ pitch: 185, seed: 19 }), duty: [3, 5], on: false, timer: 1.2 },
      { f: -25000 + 2000, amp: 10 ** (-36 / 20), src: Music.voice({ pitch: 150, seed: 23 }), duty: [2.5, 6], on: false, timer: 4 },
    ];
    st.forEach((s) => { s.ph = r() * TAU; s.env = s.on ? 1 : 0; s.buf = new Float32Array(0); });
    const kdev = TAU * 2500 / rate;
    let tune = 0;
    const rot = new Rotator(0), fir = new DSP.FIR(DSP.firLowpass(63, 6250 / rate)), disc = new DSP.FMDemod();
    let pw = 0, sq = 0;
    const scope = new Float32Array(1440); let sp = 0;
    const chanNoise = sigN * sigN * 2 * (12500 / rate);
    return {
      id: "ham", fc: 145.5e6, rate, N: 1024, listenRate: 48000, bw: 12500, tuneable: true,
      get tune() { return tune; },
      setTune(hz) { tune = Math.round(hz / 12500) * 12500; rot.set(-tune / rate); },
      gen(n) {
        const out = noise(new Float32Array(2 * n), n, sigN, r), dt = 1 / rate;
        for (const s of st) {
          if (s.buf.length < n) s.buf = new Float32Array(n);
          s.src.next(s.buf.subarray(0, n), rate);
          const w = TAU * s.f / rate;
          for (let i = 0; i < n; i++) {
            s.timer -= dt;
            if (s.timer <= 0) { s.on = !s.on; s.timer = s.on ? s.duty[0] * (0.7 + 0.6 * r()) : s.duty[1] * (0.6 + 0.8 * r()); }
            s.env += ((s.on ? 1 : 0) - s.env) * 0.004;
            s.ph += w + kdev * Math.tanh(s.buf[i] * 5);
            if (s.env < 1e-3) continue;
            const a = s.amp * s.env;
            out[2 * i] += a * cosL(s.ph); out[2 * i + 1] += a * sinL(s.ph);
          }
          s.ph %= TAU;
        }
        return out;
      },
      process(iq, wantAudio) {
        const z = fir.process(rot.mix(iq)), f = disc.process(z), n = f.length, g = rate / 2500;
        const au = new Float32Array(n);
        for (let i = 0; i < n; i++) {
          pw += (z[2 * i] ** 2 + z[2 * i + 1] ** 2 - pw) * 0.002;
          const open = pw > chanNoise * 6;
          sq += ((open ? 1 : 0) - sq) * 0.01;
          au[i] = clamp(f[i] * g * 0.45, -1, 1) * sq;
          scope[sp] = au[i]; sp = (sp + 1) % scope.length;
        }
        this.open = sq > 0.5;
        return wantAudio ? au : null;
      },
      inset(ctx, w, H) {
        V.text(ctx, `Çözülen ses · ${mhz(145.5e6 + tune, 1e3)} MHz`, 10, 16, { color: C.ink2, size: 12 });
        V.text(ctx, this.open ? "susturucu açık: konuşma var" : "susturucu kapalı: kanal boş", w - 10, 16, { color: this.open ? C.ink : C.muted, size: 11.5, align: "right", weight: this.open ? 700 : 400 });
        const x0 = 10, ww = w - 20, y0 = 28, hh = H - 38;
        ctx.strokeStyle = rgba(C.line, 1); ctx.beginPath(); ctx.moveTo(x0, y0 + hh / 2 + 0.5); ctx.lineTo(x0 + ww, y0 + hh / 2 + 0.5); ctx.stroke();
        const ys = new Float32Array(scope.length);
        for (let k = 0; k < scope.length; k++) ys[k] = scope[(sp + k) % scope.length];
        V.wave(ctx, { x: x0, y: y0, w: ww, h: hh, ys, a: 1, color: C.amp, width: 1.4 });
      },
    };
  }
  function makeCW(opts) {
    const rate = 8000, r = DSP.rng(1440);
    const sigN = 10 ** (-30 / 20) / Math.SQRT2;
    const unitOf = (wpm) => 1.2 / wpm;
    const st = [
      { f: 600, amp: 10 ** (-14 / 20), text: "CQ CQ DE SDR SDR K", wpm: 15 },
      { f: -1700, amp: 10 ** (-26 / 20), text: "TEST DE IQ IQ", wpm: 20 },
      { f: 2300, amp: 10 ** (-31 / 20), text: "VVV VVV", wpm: 12 },
    ];
    st.forEach((s) => { s.seq = morseSeq(s.text); s.idx = 0; s.t = r() * 2; s.env = 0; s.ph = 0; s.unit = unitOf(s.wpm); });
    let tune = 600;
    const rot = new Rotator(-tune / rate), fir = new DSP.FIR(DSP.firLowpass(129, 250 / rate));
    let bfo = 0; const wB = TAU * 700 / rate;
    // Mors çözücü
    const gate = sigN * Math.SQRT2 * Math.sqrt(500 / rate) * 5;
    let pk = 1e-6, onRun = 0, offRun = 0, state = false, sym = "", text = "", unitEst = 0.08 * rate, marks = [];
    function mark(len) {
      unitEst = Math.min(unitEst * 1.02, len < unitEst * 2 ? 0.7 * unitEst + 0.3 * len : unitEst);
      sym += len < 2 * unitEst ? "." : "-";
      marks.push(len < 2 * unitEst ? 1 : 3); if (marks.length > 40) marks.shift();
    }
    function space(len) {
      if (len > 2.2 * unitEst && sym) { text += MORSE_INV[sym] || "?"; sym = ""; }
      if (len > 5 * unitEst && text && !text.endsWith(" ")) text += " ";
      if (text.length > 60) text = text.slice(-60);
    }
    return {
      id: "cw", fc: 144.05e6, rate, N: 256, listenRate: rate, bw: 500, tuneable: true,
      get tune() { return tune; },
      setTune(hz) { tune = hz; rot.set(-tune / rate); text += text && !text.endsWith(" ") ? " " : ""; },
      gen(n) {
        const out = noise(new Float32Array(2 * n), n, sigN, r), dt = 1 / rate;
        for (const s of st) {
          const w = TAU * s.f / rate;
          for (let i = 0; i < n; i++) {
            s.t -= dt;
            if (s.t <= 0) { s.idx = (s.idx + 1) % s.seq.length; s.t += s.seq[s.idx][1] * s.unit; }
            s.env += ((s.seq[s.idx][0] ? 1 : 0) - s.env) * 0.06;
            s.ph += w;
            if (s.env < 1e-3) continue;
            out[2 * i] += s.amp * s.env * cosL(s.ph); out[2 * i + 1] += s.amp * s.env * sinL(s.ph);
          }
          s.ph %= TAU;
        }
        return out;
      },
      process(iq, wantAudio) {
        const z = fir.process(rot.mix(iq)), n = z.length >> 1, au = wantAudio ? new Float32Array(n) : null;
        for (let i = 0; i < n; i++) {
          const I = z[2 * i], Q = z[2 * i + 1], e = Math.hypot(I, Q);
          pk = Math.max(e, pk * 0.99995);
          const on = pk > gate && (state ? e > pk * 0.35 : e > pk * 0.55);
          if (on !== state) { if (state) mark(onRun); else space(offRun); state = on; onRun = offRun = 0; }
          if (on) onRun++; else { offRun++; if (offRun === Math.round(5.2 * unitEst)) space(offRun); }
          if (au) { au[i] = clamp((I * Math.cos(bfo) - Q * Math.sin(bfo)) / (pk + 1e-4) * 0.5, -1, 1); bfo += wB; if (bfo > TAU) bfo -= TAU; }
        }
        return au;
      },
      inset(ctx, w, H) {
        V.text(ctx, `Çözülen Mors · ${mhz(144.05e6 + tune, 1e2)} MHz`, 10, 16, { color: C.ink2, size: 12 });
        const x0 = 10, y0 = 30;
        // son nokta/çizgiler
        let x = x0;
        for (const m of marks.slice(-30)) { ctx.fillStyle = C.ink; ctx.fillRect(x, y0, m * 4, 5); x += m * 4 + 4; if (x > w - 20) break; }
        const s = (text + (sym ? " " + sym : "")).trimStart();
        ctx.save(); ctx.beginPath(); ctx.rect(x0, y0 + 10, w - 20, H - 40); ctx.clip();
        V.text(ctx, s.slice(-Math.floor((w - 20) / 15)) + "▌", w - 10, Math.max(y0 + 44, H / 2 + 16), { color: C.ink, size: 28, align: "right", font: FONT.display, weight: 700 });
        ctx.restore();
        V.text(ctx, `Tahmini birim: ${num(unitEst / rate * 1000, 0)} ms (≈ ${num(1.2 / (unitEst / rate), 0)} kelime/dk)`, x0, H - 10, { color: C.muted, size: 11 });
      },
    };
  }

  // --- 433 MHz uzaktan kumanda: OOK, PWM kodlu 24 bit, sekiz kez tekrar ---
  function makeOOK(opts) {
    const rate = 240000, r = DSP.rng(433);
    const sigN = 10 ** (-40 / 20) / Math.SQRT2;
    const T = Math.round(350e-6 * rate);
    const devs = [
      { f: -18000, amp: 10 ** (-12 / 20), T, bits: 24, code: 0x5a3c21, reps: 8, every: 6.5, next: 0.6 },
      { f: 61000, amp: 10 ** (-27 / 20), T: Math.round(250e-6 * rate), bits: 32, code: 0x9e0c4417, reps: 3, every: 7.3, next: 3.3 },
    ];
    devs.forEach((d) => { d.q = []; d.ph = 0; d.e = 0; });
    let t = 0;
    function frame(d) {
      const runs = [[1, d.T], [0, 31 * d.T]];
      for (let k = d.bits - 1; k >= 0; k--) { const b = Math.floor(d.code / 2 ** k) & 1; runs.push(b ? [1, 3 * d.T] : [1, d.T], b ? [0, d.T] : [0, 3 * d.T]); }
      return runs;
    }
    function press(d) { for (let k = 0; k < d.reps; k++) d.q.push(...frame(d)); d.q.push([1, d.T], [0, 31 * d.T]); }
    // çözücü: kumandanın frekansına in, zarf, darbe uzunlukları
    const rot = new Rotator(18000 / rate), a1 = onePole(20000, rate);
    let clock = 0, lastAt = -1e9;
    let zr = 0, zi = 0, zr2 = 0, zi2 = 0, pk = 1e-6, hi = false, run = 0, cur = [], last = null, reps = 0, lastCode = null;
    const envHist = [];
    function endFrame() {
      if (cur.length >= 48) {
        const pairs = cur.slice(-48), bits = [];
        for (let k = 0; k < 48; k += 2) bits.push(pairs[k][1] > pairs[k + 1][1] ? 1 : 0);
        const shorts = pairs.filter((p, i) => i % 2 === 0).map((p) => p[1]).sort((x, y) => x - y);
        const code = bits.reduce((a, b) => a * 2 + b, 0);
        reps = code === lastCode && clock - lastAt < 0.5 * rate ? reps + 1 : 1; lastCode = code; lastAt = clock;
        last = { bits, code, env: envHist.slice(-Math.min(envHist.length, 48 * 4 * T / 8 + 40)), T: shorts[0] / rate * 1e6 };
      }
      cur = [];
    }
    return {
      id: "ook", fc: 433.92e6, rate, N: 1024, bursty: true, listenRate: 48000, bw: 30000, tune: -18000,
      press() { press(devs[0]); },
      gen(n) {
        const out = noise(new Float32Array(2 * n), n, sigN, r);
        for (const d of devs) {
          if (t >= d.next) { press(d); d.next = t + d.every * (0.85 + 0.3 * r()); }
          const w = TAU * d.f / rate;
          for (let i = 0; i < n; i++) {
            let on = 0;
            if (d.q.length) { on = d.q[0][0]; if (--d.q[0][1] <= 0) d.q.shift(); }
            d.e += (on - d.e) * 0.35;
            d.ph += w;
            if (d.e < 1e-3) continue;
            out[2 * i] += d.amp * d.e * cosL(d.ph); out[2 * i + 1] += d.amp * d.e * sinL(d.ph);
          }
          d.ph %= TAU;
        }
        t += n / rate;
        return out;
      },
      process(iq, wantAudio) {
        const z = rot.mix(iq), n = z.length >> 1;
        const au = wantAudio ? new Float32Array(Math.floor(n / 5)) : null;
        for (let i = 0; i < n; i++) {
          zr += a1 * (z[2 * i] - zr); zi += a1 * (z[2 * i + 1] - zi);
          zr2 += a1 * (zr - zr2); zi2 += a1 * (zi - zi2);
          const e = Math.hypot(zr2, zi2);
          pk = Math.max(e, pk * 0.999995);
          const on = e > pk * 0.5 && pk > sigN * 6;
          if (i % 8 === 0) { envHist.push(e / pk); if (envHist.length > 20000) envHist.splice(0, 10000); }
          if (on !== hi) {
            if (hi) cur.push([1, run]);
            else if (run > 8 * T) { cur.pop(); endFrame(); } // uzun boşluk: son yüksek darbe senkrondu
            else if (cur.length) cur.push([0, run]);
            hi = on; run = 0;
          }
          run++;
          if (!hi && run === 12 * T) { cur.pop(); endFrame(); }
          clock++;
          if (au && i % 5 === 0) au[i / 5] = clamp(Math.hypot(iq[2 * i], iq[2 * i + 1]) * 3 - 0.1, -1, 1);
        }
        return au;
      },
      inset(ctx, w, H) {
        V.text(ctx, "Kumandanın son çerçevesi (zarf)", 10, 16, { color: C.ink2, size: 12 });
        const x0 = 10, ww = w - 20, y0 = 30, hh = Math.max(36, H * 0.34);
        if (!last) { V.text(ctx, "Paket bekleniyor… (Kumandaya basın)", x0, y0 + 20, { color: C.muted, size: 12 }); return; }
        // zarfı çiz: son 24 bitlik bölüm (sondaki sessizlik hariç)
        const e = last.env; let end = e.length - 1; while (end > 0 && e[end] < 0.5) end--;
        const span = Math.round(24 * 4 * T / 8), start = Math.max(0, end - span + 1);
        ctx.beginPath();
        for (let k = start; k <= end; k++) { const x = x0 + ((k - start) / span) * ww, y = y0 + hh - clamp(e[k], 0, 1.1) * (hh - 14); k === start ? ctx.moveTo(x, y) : ctx.lineTo(x, y); }
        ctx.strokeStyle = C.ink; ctx.lineWidth = 1.3; ctx.stroke();
        for (let k = 0; k < 24; k++) {
          const xa = x0 + ((k + 0.5) / 24) * ww;
          V.text(ctx, String(last.bits[k]), xa, y0 + 10, { color: C.ink, size: 10.5, align: "center", weight: 700 });
        }
        const yy = y0 + hh + 18;
        V.text(ctx, `Kod: ${last.code.toString(16).toUpperCase().padStart(6, "0")} (24 bit) · aynı çerçeve ${reps} kez`, x0, yy, { color: C.ink, size: 12.5, weight: 700 });
        V.text(ctx, `Ölçülen kısa darbe: ${num(last.T, 0)} µs · uzun = 3 kısa`, x0, yy + 17, { color: C.ink2, size: 11.5 });
      },
    };
  }

  // tür bilgileri (kart)
  const INFO = {
    fm: { name: "FM yayın", freq: "87,5–108 MHz (burada 100,0 MHz)", bw: "≈ 200 kHz kanal, ±75 kHz sapma", mod: "Geniş FM", carries: "Müzik ve konuşma; 19 kHz pilot, stereo, RDS" },
    adsb: { name: "Uçak ADS-B", freq: "1090 MHz", bw: "≈ 2 MHz (0,5 µs'lik darbeler)", mod: "Darbe konum modülasyonu (PPM), 1 Mbit/sn", carries: "Kimlik, konum, yükseklik, hız; 8 µs başlangıç + 56/112 bit" },
    apt: { name: "NOAA APT hava uydusu", freq: "137,1–137,9125 MHz", bw: "≈ 34 kHz (±17 kHz sapma)", mod: "FM içinde 2400 Hz AM alt taşıyıcı", carries: "Görünür + kızılötesi görüntü; saniyede 2 satır, 4160 kelime/sn" },
    ham: { name: "Amatör telsiz (konuşma)", freq: "2 m bandı 144–146 MHz (çağrı kanalı 145,500)", bw: "12,5 kHz kanal, ±2,5 kHz sapma", mod: "Dar bant FM (NFM)", carries: "Bas-konuş (PTT) konuşmalar; susturucu boş kanalı keser" },
    cw: { name: "Amatör telsiz (Mors)", freq: "2 m bandında 144,050 MHz civarı", bw: "≈ 100–150 Hz", mod: "CW: taşıyıcıyı aç-kapa", carries: "Mors kodu; alıcı 700 Hz'lik bir bip sesine çevirir" },
    ook: { name: "433 MHz uzaktan kumanda", freq: "433,05–434,79 MHz (çoğu 433,92)", bw: "Birkaç on kHz (ucuz verici kayar)", mod: "OOK: taşıyıcıyı aç-kapa", carries: "24 bitlik kod; her basışta 8–10 kez tekrar" },
  };

  Demos.galeri = function (stage, slide) {
    stage.classList.add("g7");
    const opts = { stereo: true, fast: false, cw: false };
    const cv = h("canvas", { "aria-label": "Seçilen sinyalin spektrumu ve şelalesi" });
    const fill = h("div.fill.g7-wf", cv);
    const insetCv = h("canvas", { "aria-label": "Çözücü görünümü" });
    const card = h("div.g7-card");
    const insetBox = h("div.g7-inset", insetCv);
    const bottom = h("div.g7-bottom", card, insetBox);
    const typeSeg = seg([["fm", "FM yayın"], ["adsb", "ADS-B"], ["apt", "NOAA APT"], ["ham", "Amatör telsiz"], ["ook", "433 MHz"]], "fm", (k) => select(k), "Sinyal türü");
    const top = h("div.controls.top", typeSeg, h("span.spacer"), h("span.chip.g7-synth", { title: "Bu sinyaller tarayıcıda, gerçek biçimlerine uygun olarak üretilir" }, "sentetik"));
    const listen = toggle("Dinle", false, (on) => setListen(on));
    const optBox = h("span.g7-opts");
    const ro = h("div.readouts");
    const ctrl = h("div.controls", listen, optBox, h("span.spacer"), ro);
    stage.append(top, fill, bottom, ctrl);

    let T = null, wf = null, avg = null, peak = null, floor = null, stream = null, lastFill = 0, kind = "fm", warmLeft = 0;
    let rowBuf = null, rowFill = 0, tailBuf = null, rowLen = 0, rowsShown = 0;
    let re, im, win;

    function build() {
      const k = kind === "ham" && opts.cw ? "cw" : kind;
      T = k === "fm" ? makeFM(opts) : k === "adsb" ? makeADSB() : k === "apt" ? makeAPT(opts) : k === "ook" ? makeOOK(opts) : makeHam(opts);
      wf = new V.Waterfall(T.N, 220);
      avg = new DSP.SpectrumAverager(T.N); peak = null; floor = null;
      rowLen = Math.round(T.rate / ROWS_PER_SEC);
      rowBuf = new Float32Array(2 * Math.max(rowLen, T.N)); rowFill = 0;
      tailBuf = new Float32Array(2 * T.N);
      re = new Float64Array(T.N); im = new Float64Array(T.N); win = DSP.window("hann", T.N);
      rowsShown = 0;
      renderCard(k); renderOpts(); renderRO();
      // ilk açılışta şelale boş görünmesin: önce kısa bir geçmiş, kalanı ilk karelerde hızla doldurulur
      runFor(0.6);
      warmLeft = Math.round((220 / ROWS_PER_SEC) * (T.speed || 1) * T.rate) - Math.round(0.6 * T.rate);
    }
    // ısınma: kare başına ~10 ms'lik bütçeyle şelalenin geri kalanını doldur
    function warmStep() {
      const t0 = performance.now();
      while (warmLeft > 0 && performance.now() - t0 < 10) {
        const n = Math.min(warmLeft, 16384), iq = T.gen(n);
        if (warmLeft < T.rate * 1.2 || T.id !== "fm") T.process(iq, false);
        consume(iq); warmLeft -= n;
      }
    }
    function runFor(sec) {
      let left = Math.round(sec * T.rate);
      while (left > 0) { const n = Math.min(left, 32768); const iq = T.gen(n); T.process(iq, false); consume(iq); left -= n; }
    }
    function renderCard(k) {
      const I = INFO[k];
      card.innerHTML = "";
      card.append(...[
        h("h4", I.name),
        h("dl",
          h("dt", "Frekans"), h("dd", I.freq),
          h("dt", "Genişlik"), h("dd", I.bw),
          h("dt", "Modülasyon"), h("dd", I.mod),
          h("dt", "Taşıdığı"), h("dd", I.carries)),
        k === "apt" ? h("p.g7-note", "NOAA-15, 18 ve 19 2025'te kapatıldı; bugün 137 MHz'de Meteor-M uydularının sayısal LRPT yayını var.") : null,
        k === "adsb" ? h("p.g7-note", "Uçak kimlikleri ve çağrı adları hayalîdir; CRC gerçek algoritmayla hesaplanır.") : null,
      ].filter(Boolean));
    }
    function renderOpts() {
      optBox.innerHTML = "";
      if (kind === "fm") optBox.append(toggle("Stereo pilot", opts.stereo, (v) => { opts.stereo = v; }, "ci"));
      if (kind === "apt") {
        const fast = toggle("Hızlandır ×8", opts.fast, (v) => { opts.fast = v; if (v && stream) { listen.set(false); setListen(false); } });
        optBox.append(fast);
        optBox.fastBtn = fast;
      }
      if (kind === "ham") optBox.append(seg([["nfm", "Konuşma"], ["cw", "Mors"]], opts.cw ? "cw" : "nfm", (v) => { opts.cw = v === "cw"; select("ham", true); }, "Amatör telsiz kipi"));
      if (kind === "ook") optBox.append(h("button.btn", { type: "button", onclick: () => T.press && T.press() }, "Kumandaya bas"));
    }
    function renderRO() {
      ro.innerHTML = "";
      const item = (k, v) => h("span.readout", h("span.k", k), h("span.v", v));
      const res = T.rate / T.N;
      ro.append(item("Görünen bant", L.hz(T.rate)), item("FFT çözünürlüğü", L.hz(res, res < 100 ? 1 : res < 1000 ? 0 : 1)));
    }
    function select(k, keepListen) {
      kind = k;
      const was = !!stream;
      stopStream();
      build();
      if (was) startStream();
    }

    // IQ'yu satırlara böl; her satır için (patlamalı türlerde en enerjili) FFT çerçevelerinden bir spektrum
    function consume(iq) {
      const N = T.N, n = iq.length >> 1;
      let i = 0;
      while (i < n) {
        const take = Math.min(n - i, rowLen - rowFill);
        rowBuf.set(iq.subarray(2 * i, 2 * (i + take)), 2 * rowFill);
        rowFill += take; i += take;
        if (rowFill === rowLen) { pushRow(); rowFill = 0; }
      }
    }
    function frameDb(src, off) {
      for (let k = 0; k < T.N; k++) { re[k] = src[2 * (off + k)] * win[k]; im[k] = src[2 * (off + k) + 1] * win[k]; }
      DSP.fft(re, im);
      const out = new Float32Array(T.N), N = T.N, nrm = 1 / (N * win.gain);
      for (let k = 0; k < N; k++) { const j = (k + N / 2) % N; out[k] = 10 * Math.log10((re[j] * re[j] + im[j] * im[j]) * nrm * nrm + 1e-20); }
      return out;
    }
    function pushRow() {
      const N = T.N;
      let db;
      if (rowLen >= N) {
        const F = Math.floor(rowLen / N);
        let pick = [];
        if (T.bursty) {
          const en = [];
          for (let f = 0; f < F; f++) { let e = 0; for (let k = 0; k < N; k += 4) e += rowBuf[2 * (f * N + k)] ** 2 + rowBuf[2 * (f * N + k) + 1] ** 2; en.push([e, f]); }
          en.sort((a, b) => b[0] - a[0]);
          pick = en.slice(0, 2).map((x) => x[1]);
        } else pick = [0, Math.floor(F / 2), F - 1].filter((v, k, a) => a.indexOf(v) === k);
        let acc = null;
        for (const f of pick) {
          const d = frameDb(rowBuf, f * N);
          if (!acc) acc = d;
          else for (let k = 0; k < N; k++) acc[k] = T.bursty ? Math.max(acc[k], d[k]) : 10 * Math.log10((10 ** (acc[k] / 10) + 10 ** (d[k] / 10)) / 2);
        }
        db = acc;
        tailBuf.set(rowBuf.subarray(2 * (rowLen - N), 2 * rowLen));
      } else {
        // satır FFT'den kısaysa: son N örneği (önceki satırların kuyruğu + bu satır) kullan
        tailBuf.copyWithin(0, 2 * rowLen);
        tailBuf.set(rowBuf.subarray(0, 2 * rowLen), 2 * (N - rowLen));
        db = frameDb(tailBuf, 0);
      }
      // gürültü tabanını izle, renk aralığını ona göre ayarla
      const p = percentile(db, 0.3);
      floor = floor == null ? p : floor + (p - floor) * 0.05;
      wf.min = floor - 6; wf.max = floor + (T.id === "adsb" ? 42 : 52);
      wf.push(db);
      avg.push(db, 0.3);
      if (T.bursty) { if (!peak) peak = Float32Array.from(db); else for (let k = 0; k < N; k++) peak[k] = Math.max(db[k], peak[k] - 0.8); }
      rowsShown++;
    }

    // ses: Dinle açıkken üretimi ses saati sürer
    const fifo = new Signals.AudioFifo(() => {
      lastFill = performance.now();
      const n = Math.round(T.rate * 0.02);
      const iq = T.gen(n), au = T.process(iq, true);
      consume(iq);
      return au;
    });
    function startStream() { stream = Sound.stream(slide, (out) => fifo.fill(out), { rate: T.listenRate, gain: 0.9 }); }
    function stopStream() { if (stream) { stream.stop(); stream = null; } fifo.buf = new Float32Array(0); }
    function setListen(on) {
      if (on) {
        if (opts.fast && kind === "apt") { opts.fast = false; optBox.fastBtn && optBox.fastBtn.set(false); }
        startStream();
      } else stopStream();
    }

    // ayar: tıklanabilir türlerde (amatör telsiz) şelaleye tıkla
    let st;
    const geo = () => { const { w, h: H } = st; const sy = 30, specH = Math.max(60, Math.min(130, H * 0.26)); return { w, H, sy, specH, wfY: sy + specH + 4 }; };
    L.pointer(cv, {
      down: (x) => {
        if (!T.tuneable) return;
        const { w } = geo(), f = (x / w - 0.5) * T.rate;
        // en yakın tepeye otur (CW için)
        if (T.id === "cw") {
          const N = T.N, c = Math.round((f / T.rate + 0.5) * N); let bi = c, bv = -Infinity;
          for (let k = Math.max(0, c - 8); k < Math.min(N, c + 9); k++) if (avg.db[k] > bv) { bv = avg.db[k]; bi = k; }
          T.setTune((bi / N - 0.5) * T.rate);
        } else T.setTune(f);
      },
    });

    function draw() {
      if (!st || !st.w) return;
      const { ctx } = st, { w, H, sy, specH, wfY } = geo();
      ctx.fillStyle = C.bg; ctx.fillRect(0, 0, w, H);
      const lo = T.fc - T.rate / 2, hi = T.fc + T.rate / 2;
      wf.draw(ctx, 0, wfY, w, H - wfY);
      const db = T.bursty && peak ? peak : avg.db;
      if (avg.acc) V.spectrum(ctx, { x: 0, y: sy + 4, w, h: specH - 4, db, min: wf.min, max: wf.max });
      ctx.fillStyle = rgba(C.bg, 0.88); ctx.fillRect(0, 0, w, sy);
      freqScale(ctx, 0, sy, w, lo, hi, Math.max(3, Math.floor(w / 110)));
      V.text(ctx, "MHz", w - 8, sy + 17, { align: "right", size: 13, color: C.ink2, font: FONT.display, weight: 700 });
      ctx.strokeStyle = rgba(C.ink, 0.25); ctx.beginPath(); ctx.moveTo(0, sy + 0.5); ctx.lineTo(w, sy + 0.5); ctx.moveTo(0, wfY - 1.5); ctx.lineTo(w, wfY - 1.5); ctx.stroke();
      // zaman ekseni (sağda): satır başına süre × hız
      const spr = 1 / ROWS_PER_SEC * (T.speed || 1), rows = 220, wfH = H - wfY;
      const tot = rows * spr, step = tot > 30 ? 10 : tot > 12 ? 4 : 2;
      for (let s = step; s < tot; s += step) {
        const y = wfY + (s / tot) * wfH;
        ctx.fillStyle = rgba(C.ink, 0.45); ctx.fillRect(w - 6, Math.round(y), 6, 1);
        V.text(ctx, "−" + num(s, 0) + " sn", w - 9, y + 4, { align: "right", size: 10.5, color: rgba(C.ink, 0.7) });
      }
      // ayar ibresi ve kanal genişliği
      const tune = T.tune || 0, xN = (tune / T.rate + 0.5) * w, bwPx = (T.bw / T.rate) * w;
      if (bwPx < w * 0.95) {
        ctx.fillStyle = rgba(C.ink, 0.06); ctx.fillRect(xN - bwPx / 2, sy, bwPx, H - sy);
        ctx.strokeStyle = rgba(C.ink, 0.28); ctx.setLineDash([3, 4]);
        ctx.strokeRect(Math.round(xN - bwPx / 2) + 0.5, sy + 0.5, Math.max(2, Math.round(bwPx)), H - sy - 1); ctx.setLineDash([]);
      }
      V.needle(ctx, xN, sy, H - sy);
      if (T.tuneable) V.text(ctx, "Şelaleye tıklayıp başka istasyona geçin", 10, H - 10, { size: 12, color: C.ink, weight: 700 });
    }
    st = canvas(cv, draw);
    let ist;
    function drawInset() {
      if (!ist || !ist.w) return;
      const { ctx, w, h: H } = ist;
      ctx.fillStyle = C.bg; ctx.fillRect(0, 0, w, H);
      T.inset(ctx, w, H);
    }
    ist = canvas(insetCv, drawInset);

    const lp = loop((dt) => {
      const audioDriving = stream && performance.now() - lastFill < 200;
      if (warmLeft > 0) warmStep();
      else if (!audioDriving) {
        let left = Math.round(dt * T.rate * (T.speed || 1));
        while (left > 0) { const n = Math.min(left, 65536); const iq = T.gen(n); T.process(iq, false); consume(iq); left -= n; }
      }
      draw(); drawInset();
    });
    build();

    return {
      enter() { lp.start(); },
      leave() { lp.stop(); stopStream(); listen.set(false); },
    };
  };

  /* ================= 2. KENDİ KAYDIN ================= */
  const BPS = { cu8: 2, cs8: 2, cs16: 4, cs16be: 4, cf32: 8, cf32be: 8 };
  const FMT_LABEL = { cu8: "cu8 (RTL-SDR)", cs8: "cs8 (HackRF)", cs16: "cs16", cf32: "cf32" };
  // dosya adından ipuçları: gqrx "gqrx_YYYYMMDD_HHMMSS_<frekans>_<hız>_fc.raw", SDR++/genel "_<n>Hz"
  function hintsFromName(name) {
    const out = {};
    const g = name.match(/gqrx_\d{8}_\d{6}_(\d+)_(\d+)_fc\.raw$/i);
    if (g) { out.fc = +g[1]; out.rate = +g[2]; out.format = "cf32"; return out; }
    const f = name.match(/(\d{5,11})\s*hz/i); if (f) out.fc = +f[1];
    const fm = name.match(/(\d+(?:[.,]\d+)?)\s*mhz/i); if (fm) out.fc = parseFloat(fm[1].replace(",", ".")) * 1e6;
    const s = name.match(/(\d+(?:[.,]\d+)?)\s*(m|k)?s(?:ps|ps)/i) || name.match(/(\d+(?:[.,]\d+)?)\s*(m|k)sps/i);
    if (s) out.rate = parseFloat(s[1].replace(",", ".")) * (s[2] ? (s[2].toLowerCase() === "m" ? 1e6 : 1e3) : 1);
    return out;
  }
  const parseNum = (s) => { const v = parseFloat(String(s).trim().replace(/\s/g, "").replace(",", ".")); return isFinite(v) ? v : NaN; };

  // Örnek kayıt üretimi (tarayıcıda): 100 MHz civarı, 1,024 MS/sn, 4 sn, .cu8
  async function makeSample(progress) {
    const rate = 1024000, secs = 4, n = rate * secs;
    const band = new Signals.Band({
      rate, noise: -31, seed: 4,
      stations: [
        { f: -300000, mod: "wfm", power: -14, dev: 75000, audio: Music.melody({ timbre: "flute", bpm: 120 }) },
        { f: 300000, mod: "wfm", power: -21, dev: 75000, audio: Music.voice({ pitch: 130, seed: 12, gain: 0.9 }) },
        { f: -120000, mod: "am", power: -22, m: 0.85, audio: Music.melody({ timbre: "organ", bpm: 96, transpose: -7 }) },
        { f: 140000, mod: "nfm", power: -24, dev: 2500, duty: [1.6, 0.9], audio: Music.voice({ pitch: 115, seed: 3, gain: 1.4 }) },
      ],
    });
    const out = new Uint8Array(2 * n), CH = 65536;
    for (let i = 0; i < n; i += CH) {
      const m = Math.min(CH, n - i), iq = band.next(m);
      for (let k = 0; k < 2 * m; k++) {
        const v = iq[k] + (k & 1 ? -0.006 : 0.008); // RTL-SDR'lardaki küçük DC kayması
        out[2 * i + k] = clamp(Math.round(127.5 + 127.5 * v), 0, 255);
      }
      progress && progress((i + m) / n);
      await new Promise((r) => setTimeout(r, 0));
    }
    return new File([out], "ornek_100MHz_1024ksps.cu8", { type: "application/octet-stream" });
  }

  Demos.iqfile = function (stage, slide) {
    stage.classList.add("k7");
    const fileIn = h("input", { type: "file", multiple: true, hidden: true, "aria-label": "IQ dosyası seç" });
    const chipName = h("span.k7-name", "Dosya yok");
    let fmt = "cu8";
    const fmtSeg = seg(Object.entries(FMT_LABEL).map(([k, v]) => [k, v.split(" ")[0]]), "cu8", (k) => { fmt = k; reopen(); }, "Örnek biçimi");
    const rateIn = h("input.k7-in", { type: "text", inputmode: "decimal", value: "2,048", "aria-label": "Örnekleme hızı (MS/sn)", size: 6 });
    const fcIn = h("input.k7-in", { type: "text", inputmode: "decimal", value: "100,0", "aria-label": "Merkez frekans (MHz)", size: 8 });
    [rateIn, fcIn].forEach((el) => el.addEventListener("change", () => reopen()));
    const changeBtn = h("button.btn.k7-other.k7-small", { type: "button", onclick: () => fileIn.click(), title: "Başka bir dosya seç" }, "Değiştir");
    const top = h("div.controls.top.k7-top",
      h("span.k7-file", chipName, changeBtn),
      fmtSeg,
      h("label.k7-f", h("span.k7-lab", "Hız"), rateIn, h("span.k7-u", "MS/sn")),
      h("label.k7-f", h("span.k7-lab", "Merkez"), fcIn, h("span.k7-u", "MHz")));

    const cv = h("canvas", { "aria-label": "Kaydın şelalesi: tıklayınca o frekansa ve ana ayarlanır" });
    const pickBtn = h("button.btn.primary", { type: "button", onclick: () => fileIn.click() }, "Dosya seç");
    const genBtn = h("button.btn", { type: "button", onclick: () => genSample() }, "Örnek kayıt üret");
    const dropMsg = h("p.k7-dmsg", "IQ kaydınızı buraya bırakın");
    const dropSub = h("p.k7-dsub", ".cu8 (RTL-SDR) · .cs8 (HackRF) · .cs16 · .cf32 · SigMF (.sigmf-meta + .sigmf-data birlikte)");
    const privacy = h("p.k7-priv", "Dosyanız yalnızca bu tarayıcıda işlenir, hiçbir yere yüklenmez.");
    const prog = h("div.k7-prog", h("i"));
    const drop = h("div.k7-drop", { role: "region", "aria-label": "Dosya bırakma alanı" },
      h("div.k7-dbox", h("div.k7-icon", { html: '<svg viewBox="0 0 48 48" aria-hidden="true"><path d="M24 30V8M15 17l9-9 9 9" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/><path d="M8 30v8h32v-8" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"/></svg>' }),
        dropMsg, dropSub, h("div.k7-dbtns", pickBtn, genBtn), prog, privacy));
    const status = h("div.float.bl.k7-status");
    const fill = h("div.fill.k7-fill", cv, status, drop);

    const listen = toggle("Dinle", false, (on) => (on ? play() : stop()));
    let mode = "wfm";
    const modeSeg = seg([["am", "AM"], ["nfm", "NFM"], ["wfm", "WFM"]], mode, (k) => { mode = k; if (player) { stop(); play(); } draw(); }, "Demodülasyon");
    const ro = h("div.readouts");
    const dl = h("a.btn.k7-dl", { href: "#", download: "ornek_100MHz_1024ksps.cu8", hidden: true, title: "Üretilen örnek kaydı indir" }, "İndir (.cu8)");
    const ctrl = h("div.controls", modeSeg, listen, ro, h("span.spacer"), dl);
    stage.append(top, fill, ctrl, fileIn);

    // durum
    let file = null, meta = null, total = 0, rate = 2.048e6, fc = 100e6, fcKnown = true;
    let rows = 0, N = 1024, dbRows = null, wfImg = null, wfCx = null, building = 0, floor = -80, top_ = -20;
    let selT = 0, tune = 0, spec = null, playPos = -1, player = null, sampleURL = null, srcNote = "";
    let st;

    let stT = 0;
    function setStatus(s, hold) {
      status.innerHTML = s; status.hidden = !s; status.classList.remove("fade");
      clearTimeout(stT); if (s && !hold) stT = setTimeout(() => status.classList.add("fade"), 9000);
    }
    setStatus("");

    fileIn.addEventListener("change", () => { if (fileIn.files.length) openFiles([...fileIn.files]); fileIn.value = ""; });
    ["dragenter", "dragover"].forEach((t) => stage.addEventListener(t, (e) => { e.preventDefault(); stage.classList.add("drag"); }));
    ["dragleave", "drop"].forEach((t) => stage.addEventListener(t, (e) => { e.preventDefault(); if (t === "dragleave" && stage.contains(e.relatedTarget)) return; stage.classList.remove("drag"); }));
    stage.addEventListener("drop", (e) => { const fs = [...(e.dataTransfer?.files || [])]; if (fs.length) openFiles(fs); });

    async function openFiles(fs) {
      const metaF = fs.find((f) => /\.sigmf-meta$/i.test(f.name));
      const dataF = fs.find((f) => /\.sigmf-data$/i.test(f.name)) || fs.find((f) => f !== metaF);
      meta = null;
      if (metaF) {
        try { meta = DSP.parseSigMF(JSON.parse(await metaF.text())); }
        catch (er) { return fail("SigMF meta dosyası okunamadı: " + er.message); }
        if (!meta.format) return fail(`Bu SigMF veri türü desteklenmiyor: ${meta.datatype || "?"} (desteklenen: cu8, ci8, ci16_le/be, cf32_le/be)`);
        if (!dataF) return fail("Meta dosyası geldi; şimdi aynı adlı .sigmf-data dosyasını da birlikte bırakın.");
      }
      if (!dataF) return;
      file = dataF;
      const hint = hintsFromName(file.name);
      fmt = meta ? meta.format : DSP.formatFromName(file.name) || hint.format || (/\.wav$/i.test(file.name) ? null : "cu8");
      if (!fmt) return fail("WAV dosyaları burada desteklenmiyor; ham IQ (.cu8/.cs8/.cs16/.cf32) ya da SigMF kullanın.");
      if (meta && meta.sampleRate) rate = meta.sampleRate;
      else if (hint.rate) rate = hint.rate;
      else rate = fmt === "cs8" ? 10e6 : fmt === "cf32" ? 2.4e6 : 2.048e6;
      const f0 = meta && meta.centerFreq != null ? meta.centerFreq : hint.fc;
      fcKnown = f0 != null; fc = f0 ?? 0;
      rateIn.value = num(rate / 1e6, rate % 1e3 ? 6 : 3).replace(/0+$/, "").replace(/,$/, "");
      fcIn.value = fcKnown ? num(fc / 1e6, 6).replace(/0+$/, "").replace(/,$/, ",0") : "";
      chipName.textContent = file.name;
      chipName.title = file.name;
      fmtSeg.set(fmt.replace("be", ""));
      srcNote = meta ? `SigMF: ${escapeHtml(meta.datatype)}, hız ve merkez meta veriden` : `biçim${hint.rate ? ", hız" : ""}${f0 != null ? ", merkez" : ""} dosya adından tahmin edildi`;
      if (/\.sigmf-data$/i.test(file.name) && !meta) srcNote = "SigMF meta dosyası gelmedi: biçimi, hızı ve merkezi elle girin";
      return build();
    }
    function escapeHtml(s) { return s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]); }
    function fail(msg) { setStatus("<b>Olmadı:</b> " + escapeHtml(msg)); stage.classList.toggle("empty", !file); return null; }
    function reopen() {
      if (!file) return;
      const r = parseNum(rateIn.value) * 1e6, f = parseNum(fcIn.value) * 1e6;
      if (!(r > 0)) return fail("Örnekleme hızını MS/sn olarak girin (ör. 2,4).");
      srcNote = "hız ve merkez elle girildi";
      rate = r; fcKnown = isFinite(f); fc = fcKnown ? f : 0;
      if (meta && fmt !== meta.format) meta = null;
      build();
    }

    async function build() {
      stop();
      const id = ++building;
      stage.classList.remove("empty");
      const bps = BPS[fmt];
      total = Math.floor(file.size / bps);
      if (total < 2048) return fail("Dosya çok kısa (en az 2048 örnek gerekir).");
      N = rate >= 4e6 ? 2048 : 1024;
      rows = Math.max(16, Math.min(600, Math.floor(total / N)));
      dbRows = new Float32Array(rows * N).fill(NaN);
      wfImg = document.createElement("canvas"); wfImg.width = N; wfImg.height = rows;
      wfCx = wfImg.getContext("2d"); wfCx.fillStyle = C.bg; wfCx.fillRect(0, 0, N, rows);
      selT = 0; spec = null; playPos = -1; tune = 0;
      renderRO();
      const per = Math.floor(total / rows), K = Math.max(1, Math.min(16, Math.floor(per / N)));
      const re = new Float64Array(N), im = new Float64Array(N), win = DSP.window("hann", N), nrm = 1 / (N * win.gain);
      let levelSet = false;
      const t0 = performance.now();
      for (let r = 0; r < rows; r++) {
        if (id !== building) return;
        const s0 = r * per, len = Math.min(K * N, total - s0);
        const iq = await readSamples(s0, len);
        if (id !== building) return;
        const acc = new Float64Array(N), F = Math.max(1, Math.floor((iq.length >> 1) / N));
        for (let f = 0; f < F; f++) {
          for (let k = 0; k < N; k++) { re[k] = (iq[2 * (f * N + k)] || 0) * win[k]; im[k] = (iq[2 * (f * N + k) + 1] || 0) * win[k]; }
          DSP.fft(re, im);
          for (let k = 0; k < N; k++) { const j = (k + N / 2) % N; acc[k] += (re[j] * re[j] + im[j] * im[j]) * nrm * nrm; }
        }
        for (let k = 0; k < N; k++) dbRows[r * N + k] = 10 * Math.log10(acc[k] / F + 1e-20);
        if (!levelSet && (r >= 24 || r === rows - 1)) { setLevels(r + 1); levelSet = true; paintRows(0, r + 1); }
        else if (levelSet) paintRows(r, r + 1);
        if (r === 0 || r % 8 === 0) { setStatus(`Şelale hesaplanıyor… %${Math.round(((r + 1) / rows) * 100)}`, true); draw(); }
      }
      setLevels(rows); paintRows(0, rows);
      const ms = performance.now() - t0;
      setStatus(`<b>${escapeHtml(file.name)}</b> · ${srcNote ? srcNote + " · " : ""}${rows} satır × ${N} nokta FFT, ${num(ms / 1000, 1)} sn'de hesaplandı`);
      await selectAt(0.5, null);
      draw();
    }
    // [s0, s0+n) karmaşık örnekleri oku (yalnızca o dilim belleğe alınır)
    async function readSamples(s0, n) {
      const bps = BPS[fmt], ab = await file.slice(s0 * bps, (s0 + n) * bps).arrayBuffer();
      return DSP.readIQ(ab, fmt);
    }
    function setLevels(nr) {
      const sample = [];
      for (let r = 0; r < nr; r += Math.max(1, Math.floor(nr / 40))) for (let k = 0; k < N; k += 7) { const v = dbRows[r * N + k]; if (isFinite(v)) sample.push(v); }
      sample.sort((a, b) => a - b);
      floor = sample[Math.floor(sample.length * 0.3)] ?? -80;
      const p999 = sample[Math.floor(sample.length * 0.999)] ?? floor + 50;
      top_ = Math.max(floor + 30, Math.min(floor + 70, p999 + 3));
    }
    function paintRows(a, b) {
      const img = wfCx.createImageData(N, 1), d = img.data, k = 255 / (top_ - (floor - 6));
      for (let r = a; r < b; r++) {
        for (let i = 0; i < N; i++) {
          const v = dbRows[r * N + i];
          const t = isFinite(v) ? clamp(Math.round((v - (floor - 6)) * k), 0, 255) * 3 : 0;
          d[4 * i] = L.LUT[t]; d[4 * i + 1] = L.LUT[t + 1]; d[4 * i + 2] = L.LUT[t + 2]; d[4 * i + 3] = 255;
        }
        wfCx.putImageData(img, 0, r);
      }
    }
    function renderRO() {
      ro.innerHTML = "";
      const item = (k, v) => h("span.readout", h("span.k", k), h("span.v", v));
      const dur = total / rate;
      ro.append(item("Süre", dur < 1 ? num(dur * 1000, 0) + " ms" : num(dur, dur < 10 ? 2 : 1) + " sn"),
        item("Örnek", num(total, 0)), item("Boyut", L.bytes(file.size)), item("Çözünürlük", L.hz(rate / N, rate / N < 1000 ? 0 : 1)));
    }
    // seçilen andaki spektrum (16 çerçeve ortalaması)
    async function selectAt(fy, fx) {
      selT = clamp(fy, 0, 1);
      const s0 = Math.min(total - N, Math.floor(selT * total)), len = Math.min(16 * N, total - s0);
      const iq = await readSamples(s0, len);
      const F = Math.max(1, Math.floor((iq.length >> 1) / N)), acc = new Float64Array(N);
      for (let f = 0; f < F; f++) { const d = DSP.spectrum(iq, N, { offset: f * N }); for (let k = 0; k < N; k++) acc[k] += 10 ** (d[k] / 10); }
      spec = Float32Array.from(acc, (v) => 10 * Math.log10(v / F + 1e-20));
      if (fx != null) {
        // tıklanan yerin çevresinde (kanal genişliğinin yarısı) gürültünün üstündeki gücün ağırlık merkezine otur
        const bw = BW[mode], f = (fx - 0.5) * rate, half = Math.max(2, Math.round((bw / 2 / rate) * N));
        const c = Math.round(fx * N); let sw = 0, sf = 0;
        for (let k = Math.max(0, c - half); k < Math.min(N, c + half); k++) {
          const p = 10 ** ((spec[k] - floor - 6) / 10); if (p > 1) { sw += p; sf += p * k; }
        }
        tune = sw > 0 ? ((sf / sw) / N - 0.5) * rate : f;
        if (mode === "am" && sw > 0) {
          // dar kiplerde en yüksek tepeye otur
          let bi = c, bv = -Infinity; for (let k = Math.max(0, c - half); k < Math.min(N, c + half); k++) if (spec[k] > bv) { bv = spec[k]; bi = k; }
          tune = (bi / N - 0.5) * rate; // AM: taşıyıcının tepesine
        }
      }
      draw();
    }
    const BW = { am: 10000, nfm: 12500, wfm: 200000 };

    // ---- dinleme: dosyadan akış, ayar → azaltma → demodülasyon ----
    function makeChain() {
      // azaltmayı en fazla 8'lik basamaklara böl (20 MS/sn'lik dosyada bile hafif kalsın)
      const stages = []; let r1 = rate;
      while (r1 / 2 >= 240000) {
        let m = 8; while (m > 2 && r1 / m < 240000) m--;
        stages.push(new DecFIR(DSP.firLowpass(8 * m + 1, (0.5 / m) * 0.85), m)); r1 /= m;
      }
      const rot = new Rotator(-tune / rate);
      const dec1 = stages.length ? { process: (x) => stages.reduce((a, s) => s.process(a), x) } : null;
      const d2 = Math.max(1, Math.round(r1 / 48000));
      const rx = new Signals.Receiver({ rate: r1, decim: d2, mode, bw: Math.min(BW[mode], r1 * 0.9), dev: mode === "wfm" ? 75000 : 2500, tune: 0 });
      return { outRate: r1 / d2, run(iq) { const m = rot.mix(iq); return rx.process(dec1 ? dec1.process(m) : m).audio; } };
    }
    function play() {
      if (!file || !rows) { listen.set(false); return; }
      stop(true);
      const ch = makeChain(), id = {};
      player = id;
      let pos = Math.floor(selT * total), q = [], qLen = 0, reading = false;
      const CH = Math.max(4096, Math.round(rate * 0.05));
      const maxQ = ch.outRate * 0.6;
      async function pump() {
        if (reading || player !== id) return;
        reading = true;
        while (player === id && qLen < maxQ) {
          if (pos >= total) pos = 0;
          const n = Math.min(CH, total - pos);
          const iq = await readSamples(pos, n);
          if (player !== id) break;
          const au = ch.run(iq);
          q.push({ au, at: pos, n }); qLen += au.length; pos += n;
          // anlık spektrum (canlı)
          if (n >= N) { const d = DSP.spectrum(iq, N); if (spec) for (let k = 0; k < N; k++) spec[k] += (d[k] - spec[k]) * 0.35; }
        }
        reading = false;
      }
      id.timer = setInterval(pump, 30); pump();
      let gain = 0;
      id.stream = Sound.stream(slide, (out) => {
        let o = 0;
        while (o < out.length && q.length) {
          const b = q[0], take = Math.min(out.length - o, b.au.length - (b.off || 0));
          for (let i = 0; i < take; i++) { gain = Math.min(1, gain + 0.002); out[o + i] = b.au[(b.off || 0) + i] * gain; }
          b.off = (b.off || 0) + take; o += take; qLen -= take;
          playPos = (b.at + (b.off / b.au.length) * b.n) / total;
          if (b.off >= b.au.length) q.shift();
        }
        out.fill(0, o);
      }, { rate: ch.outRate, gain: 0.9 });
    }
    function stop(keepToggle) {
      if (player) { clearInterval(player.timer); player.stream && player.stream.stop(); player = null; }
      playPos = -1;
      if (!keepToggle) listen.set(false);
    }

    // ---- örnek kayıt ----
    async function genSample() {
      genBtn.disabled = true; prog.classList.add("on");
      const t0 = performance.now();
      const f = await makeSample((p) => { prog.firstChild.style.width = (p * 100).toFixed(1) + "%"; });
      prog.classList.remove("on"); genBtn.disabled = false;
      if (sampleURL) URL.revokeObjectURL(sampleURL);
      sampleURL = URL.createObjectURL(f);
      dl.href = sampleURL; dl.hidden = false;
      await openFiles([f]);
      setStatus(`<b>Örnek kayıt</b> (sentetik, ${num((performance.now() - t0) / 1000, 1)} sn'de üretildi): iki FM yayını, bir AM, bir dar bant FM telsiz; ortadaki çizgi RTL-SDR'lara özgü DC sivrisi`);
    }

    // ---- çizim ----
    const geo = () => {
      const { w, h: H } = st, sy = 30, specH = Math.max(60, Math.min(140, H * 0.26)), lx = 46;
      return { w, H, sy, specH, wfY: sy + specH + 6, lx };
    };
    function draw() {
      if (!st || !st.w) return;
      const { ctx } = st, { w, H, sy, specH, wfY, lx } = geo();
      ctx.fillStyle = C.bg; ctx.fillRect(0, 0, w, H);
      if (!file || !rows) { drawGhost(ctx, w, H); return; }
      const lo = fc - rate / 2, hi = fc + rate / 2, ww = w - lx;
      ctx.imageSmoothingEnabled = true;
      ctx.drawImage(wfImg, lx, wfY, ww, H - wfY);
      if (spec) V.spectrum(ctx, { x: lx, y: sy + 4, w: ww, h: specH - 4, db: spec, min: floor - 6, max: top_ });
      V.dbGrid(ctx, { x: lx, y: sy + 4, w: ww, h: specH - 4, min: floor - 6, max: top_, step: 20, labels: false });
      ctx.fillStyle = rgba(C.bg, 0.9); ctx.fillRect(0, 0, w, sy);
      if (fcKnown) freqScale(ctx, lx, sy, ww, lo, hi, Math.max(3, Math.floor(ww / 110)));
      else {
        const t = V.ticks(-rate / 2, rate / 2, Math.max(3, Math.floor(ww / 110)));
        V.scale(ctx, { x: lx, y: sy, w: ww, from: -rate / 2, to: rate / 2, major: t.major, minor: t.minor, fmt: (v) => (v > 0 ? "+" : "") + num(v / 1e3, 0), up: true, size: 13, color: C.ink });
      }
      V.text(ctx, fcKnown ? "MHz" : "kHz (merkeze göre)", 6, sy - 13, { size: 12.5, color: C.ink2, font: FONT.display, weight: 700 });
      // zaman ekseni (sol)
      const dur = total / rate, tt = V.ticks(0, dur, Math.max(3, Math.floor((H - wfY) / 70)));
      ctx.fillStyle = C.bg; ctx.fillRect(0, wfY, lx, H - wfY);
      tt.major.forEach((s) => {
        const y = wfY + (s / dur) * (H - wfY);
        if (y > H - 4) return;
        ctx.fillStyle = rgba(C.ink, 0.5); ctx.fillRect(lx - 5, Math.round(y), 5, 1);
        V.text(ctx, num(s, tt.step < 0.01 ? 3 : tt.step < 0.1 ? 2 : tt.step < 1 ? 1 : 0), lx - 8, y + (s === 0 ? 10 : 4), { size: 10.5, color: C.ink2, align: "right" });
      });
      V.text(ctx, "sn", lx - 8, H - 6, { size: 10.5, color: C.muted, align: "right" });
      // seçilen an ve oynatma konumu
      const ySel = wfY + selT * (H - wfY);
      ctx.strokeStyle = rgba(C.ink, 0.7); ctx.setLineDash([5, 4]); ctx.beginPath(); ctx.moveTo(lx, Math.round(ySel) + 0.5); ctx.lineTo(w, Math.round(ySel) + 0.5); ctx.stroke(); ctx.setLineDash([]);
      if (playPos >= 0) {
        const yp = wfY + playPos * (H - wfY);
        ctx.fillStyle = rgba(C.ink, 0.9); ctx.fillRect(lx, Math.round(yp), ww, 1.5);
      }
      // ayar ibresi + kanal
      const xN = lx + (tune / rate + 0.5) * ww, bwPx = (BW[mode] / rate) * ww;
      ctx.fillStyle = rgba(C.ink, 0.07); ctx.fillRect(xN - bwPx / 2, sy, bwPx, H - sy);
      ctx.strokeStyle = rgba(C.ink, 0.35); ctx.setLineDash([3, 4]); ctx.strokeRect(Math.round(xN - bwPx / 2) + 0.5, sy + 0.5, Math.max(2, Math.round(bwPx)), H - sy - 1); ctx.setLineDash([]);
      V.needle(ctx, xN, sy, H - sy);
      const lab = (fcKnown ? mhz(fc + tune, 1e3) + " MHz" : (tune >= 0 ? "+" : "") + num(tune / 1e3, 1) + " kHz") + " · " + mode.toUpperCase();
      const right = xN > w - 180;
      V.text(ctx, lab, xN + (right ? -10 : 10), sy + 18, { color: C.ink, size: 13, weight: 700, align: right ? "right" : "left" });
    }
    // dosya yokken arkada soluk, hayalî bir şelale (süs)
    let ghost = null;
    function drawGhost(ctx, w, H) {
      if (!ghost) {
        ghost = document.createElement("canvas"); ghost.width = 320; ghost.height = 160;
        const g = ghost.getContext("2d"), img = g.createImageData(320, 160), d = img.data, r = DSP.rng(31);
        const lines = [[0.2, 6, 0.55], [0.36, 2, 0.4], [0.62, 7, 0.65], [0.81, 1.5, 0.35]];
        for (let y = 0; y < 160; y++) for (let x = 0; x < 320; x++) {
          let v = 0.16 + 0.1 * r();
          for (const [c, wd, a] of lines) { const dd = Math.abs(x / 320 - c) * 320 / wd; if (dd < 1.4) v = Math.max(v, a * (1 - dd / 1.4) + 0.2 * r()); }
          if ((y + 7) % 41 < 4 && Math.abs(x / 320 - 0.47) < 0.012) v = 0.5;
          const t = Math.round(clamp(v, 0, 1) * 255) * 3, i = 4 * (y * 320 + x);
          d[i] = L.LUT[t]; d[i + 1] = L.LUT[t + 1]; d[i + 2] = L.LUT[t + 2]; d[i + 3] = 255;
        }
        g.putImageData(img, 0, 0);
      }
      ctx.save(); ctx.globalAlpha = 0.5; ctx.imageSmoothingEnabled = true; ctx.drawImage(ghost, 0, 30, w, H - 30); ctx.restore();
      freqScale(ctx, 0, 30, w, 99.5e6, 100.5e6, Math.max(3, Math.floor(w / 110)));
    }
    st = canvas(cv, draw);
    L.pointer(cv, {
      down: (x, y) => {
        if (!file || !rows) return;
        const { w, H, wfY, lx } = geo();
        if (x < lx) return;
        const fx = (x - lx) / (w - lx), fy = y < wfY ? selT : (y - wfY) / (H - wfY);
        selectAt(fy, fx).then(() => { if (player) play(); });
      },
    });
    function renderEmpty() { stage.classList.add("empty"); }
    renderEmpty();
    const lp = loop(() => { if (player) draw(); });
    return {
      enter() { lp.start(); draw(); },
      leave() { lp.stop(); stop(); },
    };
  };

  /* ================= 3. YASAL ================= */
  // durum: ok = genelde serbest, warn = koşullu / dikkat, no = yapmayın ya da lisans/izin gerekir
  const SCEN = [
    { k: "FM radyo dinlemek", f: 100e6, s: "ok", a: "Serbest. Yayın herkese yöneliktir; bir alıcıyla ya da SDR ile dinlemek için izin gerekmez." },
    { k: "Uçakları ADS-B ile izlemek", f: 1090e6, s: "ok", a: "Genelde serbest. ADS-B şifresiz, herkesin alabileceği bir yayındır; dünyada pek çok kişi alıcı kurup paylaşım ağlarına veri besliyor. Yine de verileri kötüye kullanmayın." },
    { k: "Hava uydusu görüntüsü almak", f: 137.9e6, s: "ok", a: "Serbest. Meteoroloji uydularının 137 MHz yayınları kamuya açıktır. Eski NOAA uyduları 2025'te kapandı; bugün Rus Meteor-M uydularının sayısal görüntü yayını alınabiliyor." },
    { k: "Amatör telsizcileri dinlemek", f: 145.5e6, s: "ok", a: "Serbest. Amatör yayınlar şifresizdir ve açık konuşulur; dinleyerek öğrenmek sınava hazırlanmanın en iyi yoludur." },
    { k: "Polis ya da acil telsizini dinleyip paylaşmak", f: 390e6, s: "no", a: "Yapmayın. Size yönelik olmayan bir haberleşmeyi dinlemek, kaydetmek ya da içeriğini yaymak haberleşmenin gizliliğini ihlal sayılabilir ve suç olabilir. Birçok ülkede bu telsizler zaten şifreli sayısal sistemlere (TETRA, kriptolu DMR) geçti." },
    { k: "PMR446 telsizle konuşmak", f: 446.1e6, s: "ok", a: "Serbest. Kurallara uygun, belgeli PMR446 el telsizleri (446,0–446,2 MHz) izin ya da ruhsat almadan kullanılabilir; güç 0,5 W ERP ile sınırlıdır ve yalnızca cihazın kendi tümleşik anteni kullanılır." },
    { k: "433 MHz'de kumanda kullanmak", f: 433.92e6, s: "warn", a: "Uygun cihazla serbest. 433,05–434,79 MHz kısa menzilli cihazların ortak bandıdır; belgeli cihaz ve çok düşük güç (en fazla 10 mW ERP) gerekir. SDR ile kendi yaptığınız yayın bu kapsama girmez." },
    { k: "Başkasının kumanda kodunu kaydedip tekrar göndermek", f: 433.92e6, s: "no", a: "Yapmayın. Başkasının kapısını ya da aracını açmaya yarayan kodu yakalayıp kullanmak, ağır cezası olan suçlara girebilir. Kendi cihazlarınızla deneyin." },
    { k: "SDR ile FM bandında yayın yapmak", f: 98e6, s: "no", a: "Lisans gerekir. Yayın bandında izinsiz yayın korsan yayındır; düşük güçte bile başka yayınları ve havacılık telsizlerini bozabilir. Deneylerinizi kablo ve zayıflatıcıyla, ya da yalnızca alarak yapın." },
    { k: "Amatör bantlarda yayın yapmak", f: 144.8e6, s: "warn", a: "Belgeyle serbest. Kıyı Emniyeti Genel Müdürlüğü'nün sınavını geçip amatör telsizcilik belgesi ve çağrı işareti aldıktan sonra, sınıfınızın (A, B ya da C) izin verdiği bant ve güçte yayın yapabilirsiniz." },
  ];
  const SYM = {
    ok: { t: "Serbest", svg: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" fill="none" stroke="currentColor" stroke-width="2"/><path d="M7.5 12.5l3 3 6-7" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>' },
    warn: { t: "Koşullu", svg: '<svg viewBox="0 0 24 24"><path d="M12 2.8l10 17.6H2z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/><path d="M12 9v5.5" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/><circle cx="12" cy="17.6" r="1.4" fill="currentColor"/></svg>' },
    no: { t: "Yapmayın / izin gerekir", svg: '<svg viewBox="0 0 24 24"><rect x="2.5" y="2.5" width="19" height="19" rx="3" fill="currentColor"/><path d="M8 8l8 8M16 8l-8 8" stroke="#0e1a1f" stroke-width="2.6" stroke-linecap="round"/></svg>' },
  };
  Demos.yasal = function (stage, slide) {
    stage.classList.add("y7");
    const cv = h("canvas", { "aria-label": "Frekans kadranı: seçilen senaryonun bandı" });
    const dial = h("div.y7-dial", cv);
    const grid = h("div.y7-grid", { role: "group", "aria-label": "Senaryolar" });
    const ans = h("div.y7-ans", { "aria-live": "polite" });
    stage.append(dial, grid, ans);
    let sel = -1, needleF = 600e6, needleTo = 600e6;
    const btns = SCEN.map((s, i) => {
      const b = h("button.y7-card", { type: "button", "aria-pressed": "false", onclick: () => pick(i) },
        h("span.y7-q", s.k), h("span.y7-f", L.hz(s.f, s.f >= 1e9 ? 2 : s.f % 1e6 ? 2 : 0)));
      grid.append(b); return b;
    });
    function pick(i) {
      sel = i; needleTo = SCEN[i].f;
      btns.forEach((b, k) => { b.classList.toggle("on", k === i); b.setAttribute("aria-pressed", k === i); });
      btns[i].classList.add("seen");
      const s = SCEN[i], y = SYM[s.s];
      ans.innerHTML = "";
      ans.append(h("div.y7-sym.y7-" + s.s, { html: y.svg }), h("div", h("p.y7-verdict", y.t), h("p.y7-q2", s.k), h("p.y7-a", s.a)));
      ans.classList.remove("pop"); void ans.offsetWidth; ans.classList.add("pop");
      if (window.matchMedia("(max-width: 860px)").matches) ans.scrollIntoView({ block: "nearest", behavior: "smooth" });
      // kadran tıkırtısı
      try { if (Sound.unlocked) { const n = 900, b = new Float32Array(n); for (let k = 0; k < n; k++) b[k] = Math.sin(TAU * (s.s === "no" ? 330 : s.s === "warn" ? 520 : 780) * k / 48000) * Math.exp(-k / 160) * 0.35; Sound.play(b, 48000, 0.6); } } catch (e) {}
      lp.start();
    }
    // başlangıçta: sembollerin anlamı
    ans.append(h("div.y7-start",
      h("p.y7-hint", "Bir senaryo seçin; cevabı burada, frekansı yukarıdaki kadranda görünür."),
      h("p.y7-legend", ...["ok", "warn", "no"].map((k) => h("span", h("i", { html: SYM[k].svg }), SYM[k].t)))));
    const F0 = Math.log10(50e6), F1 = Math.log10(1.5e9);
    // [başlangıç, bitiş, etiket, etiket satırı]
    const BANDS = [[87.5e6, 108e6, "FM", 0], [137e6, 138e6, "uydu", 1], [144e6, 146e6, "2 m", 0], [380e6, 400e6, "TETRA", 1], [430e6, 440e6, "70 cm", 0], [446e6, 446.2e6, "PMR", 1], [1089e6, 1091e6, "ADS-B", 0]];
    let st;
    function draw() {
      if (!st || !st.w) return;
      const { ctx, w, h: H } = st;
      ctx.fillStyle = C.bg; ctx.fillRect(0, 0, w, H);
      const x0 = 18, ww = w - 36, X = (f) => x0 + ((Math.log10(f) - F0) / (F1 - F0)) * ww, y = H - 22;
      // bantlar
      const lastX = [-1e9, -1e9];
      BANDS.forEach(([a, b, lab, row]) => {
        const xa = X(a), xb = Math.max(X(b), xa + 2);
        ctx.font = `700 12px ${FONT.display}`;
        const tw = ctx.measureText(lab).width, lx0 = (xa + xb) / 2;
        if (lx0 < lastX[row] + 6) { ctx.fillStyle = rgba(C.ink, 0.13); ctx.fillRect(xa, 40, xb - xa, y - 40); return; }
        lastX[row] = lx0 + 4 + tw;
        ctx.fillStyle = rgba(C.ink, 0.13); ctx.fillRect(xa, 40, xb - xa, y - 40);
        ctx.fillStyle = rgba(C.ink, 0.35); ctx.fillRect((xa + xb) / 2 - 0.5, row ? 27 : 17, 1, row ? 13 : 23);
        V.text(ctx, lab, (xa + xb) / 2 + 4, row ? 36 : 25, { color: C.ink2, size: 12, align: "left", font: FONT.display, weight: 700 });
      });
      const maj = [50e6, 100e6, 200e6, 500e6, 1e9], min = [];
      for (const d of [1e7, 1e8, 1e9]) for (let k = 1; k < 10; k++) { const f = k * d; if (f >= 50e6 && f <= 1.5e9) min.push(f); }
      ctx.strokeStyle = rgba(C.ink, 0.35); ctx.beginPath(); min.forEach((f) => { const px = Math.round(X(f)) + 0.5; ctx.moveTo(px, y); ctx.lineTo(px, y - 5); }); ctx.stroke();
      ctx.strokeStyle = rgba(C.ink, 0.75); ctx.beginPath(); maj.forEach((f) => { const px = Math.round(X(f)) + 0.5; ctx.moveTo(px, y); ctx.lineTo(px, y - 10); }); ctx.stroke();
      maj.forEach((f) => V.text(ctx, f >= 1e9 ? num(f / 1e9, 0) + " GHz" : num(f / 1e6, 0) + " MHz", X(f), y + 16, { color: C.ink, size: 12.5, align: "center", font: FONT.display, weight: 700 }));
      ctx.strokeStyle = rgba(C.ink, 0.3); ctx.beginPath(); ctx.moveTo(x0, y + 0.5); ctx.lineTo(x0 + ww, y + 0.5); ctx.stroke();
      if (sel >= 0) V.needle(ctx, X(needleF), 40, y - 40);
    }
    st = canvas(cv, draw);
    const lp = loop((dt) => {
      const a = Math.log10(needleF), b = Math.log10(needleTo), na = a + (b - a) * Math.min(1, dt * 7);
      needleF = 10 ** na; draw();
      if (Math.abs(na - b) < 1e-4) { needleF = needleTo; draw(); lp.stop(); }
    });
    return { enter() { draw(); }, leave() { lp.stop(); } };
  };

  // sınama için (node ile birim denemesi)
  Demos.galeri._test = { makeFM, makeADSB, makeAPT, makeHam, makeCW, makeOOK, crc24, bitsOf, describe, makeSample, aptLine };

  /* ---------------- hayalet el senaryoları ---------------- */
  window.GUIDE_SCENARIOS = Object.assign(window.GUIDE_SCENARIOS || {}, {
    galeri: [{ click: "ADS-B" }, { wait: 1600 }, { click: "NOAA APT" }, { wait: 900 }, { click: "Dinle" }],
    "kendi-kaydin": [{ click: "Örnek kayıt üret" }, { wait: 3800 }, { tap: "css:.k7-fill canvas", at: [0.25, 0.6] }, { wait: 700 }, { click: "Dinle" }],
    yasal: [{ click: "FM radyo dinlemek" }, { wait: 1500 }, { click: "Polis ya da acil" }],
  });
  window.GUIDE_TARGETS = Object.assign(window.GUIDE_TARGETS || {}, { galeri: "css:.g7 .seg", "kendi-kaydin": "Örnek kayıt üret" });
})();

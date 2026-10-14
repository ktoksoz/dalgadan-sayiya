/* Ortak sinyal işleme (DSP) modülü.
   Karmaşık sinyaller her yerde "iç içe" Float32Array olarak tutulur: [I0, Q0, I1, Q1, ...]
   (cf32 dosyalarının bellekteki düzeni). Frekanslar örnekleme hızına göre normalize:
   f = Hz / örnekleme hızı, yani -0.5 … +0.5 aralığı.
   Tarayıcıda window.DSP, Node'da require("./dsp.js") olarak kullanılır. */
(function (root) {
  const TAU = Math.PI * 2;

  /* ---------- karmaşık sayı yardımcıları ---------- */
  const cx = {
    mul: (a, b, c, d) => [a * c - b * d, a * d + b * c],
    conjMul: (a, b, c, d) => [a * c + b * d, b * c - a * d], // (a+jb)·(c−jd)
    abs: (a, b) => Math.hypot(a, b),
    arg: (a, b) => Math.atan2(b, a),
    exp: (ph) => [Math.cos(ph), Math.sin(ph)],
  };

  /* ---------- tekrarlanabilir rastgele sayılar ---------- */
  function rng(seed = 1) {
    let s = seed >>> 0;
    return () => {
      s = (s + 0x6d2b79f5) >>> 0;
      let t = s;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function gaussian(r) {
    let u = 0;
    while (!u) u = r();
    const v = r();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(TAU * v);
  }

  /* ---------- osilatör ve NCO ---------- */
  // Sayısal kontrollü osilatör: faz biriktirir, frekansı her an değiştirilebilir
  class NCO {
    constructor(freq = 0, phase = 0) { this.freq = freq; this.phase = phase; }
    // n örneklik karmaşık ton üret (genlik a)
    tone(n, a = 1, out = new Float32Array(2 * n)) {
      let p = this.phase;
      const w = TAU * this.freq;
      for (let i = 0; i < n; i++) { out[2 * i] = a * Math.cos(p); out[2 * i + 1] = a * Math.sin(p); p += w; }
      this.phase = p % TAU;
      return out;
    }
    // girişi e^(j·2π·f·n) ile çarp (frekansı f kadar kaydırır); yerinde ya da out'a yazar
    mix(buf, out = buf) {
      let p = this.phase;
      const w = TAU * this.freq, n = buf.length >> 1;
      for (let i = 0; i < n; i++) {
        const c = Math.cos(p), s = Math.sin(p), I = buf[2 * i], Q = buf[2 * i + 1];
        out[2 * i] = I * c - Q * s; out[2 * i + 1] = I * s + Q * c;
        p += w;
      }
      this.phase = p % TAU;
      return out;
    }
  }
  function tone(n, freq, a = 1, phase = 0) { return new NCO(freq, phase).tone(n, a); }
  // tek seferlik karıştırıcı: sinyali f kadar kaydır (f < 0 aşağı kaydırır)
  function mix(buf, freq, phase = 0) { return new NCO(freq, phase).mix(buf, new Float32Array(buf.length)); }

  /* ---------- pencereler ---------- */
  const WINDOWS = {
    rect: () => 1,
    hann: (i, n) => 0.5 - 0.5 * Math.cos((TAU * i) / (n - 1)),
    hamming: (i, n) => 0.54 - 0.46 * Math.cos((TAU * i) / (n - 1)),
    blackman: (i, n) => 0.42 - 0.5 * Math.cos((TAU * i) / (n - 1)) + 0.08 * Math.cos((2 * TAU * i) / (n - 1)),
  };
  const winCache = {};
  function window_(name, n) {
    const key = name + n;
    if (!winCache[key]) {
      const w = new Float32Array(n);
      let sum = 0;
      for (let i = 0; i < n; i++) { w[i] = WINDOWS[name](i, n); sum += w[i]; }
      w.gain = sum / n; // tutarlı kazanç: tonun tepe değerini düzeltmek için
      winCache[key] = w;
    }
    return winCache[key];
  }

  /* ---------- FFT (radix-2, yerinde) ---------- */
  const fftPlans = {};
  function plan(n) {
    if (fftPlans[n]) return fftPlans[n];
    if (n & (n - 1)) throw new Error("FFT boyu 2'nin kuvveti olmalı: " + n);
    const bits = Math.log2(n);
    const rev = new Uint32Array(n);
    for (let i = 0; i < n; i++) {
      let r = 0;
      for (let b = 0; b < bits; b++) r |= ((i >> b) & 1) << (bits - 1 - b);
      rev[i] = r;
    }
    const cos = new Float64Array(n / 2), sin = new Float64Array(n / 2);
    for (let i = 0; i < n / 2; i++) { cos[i] = Math.cos((TAU * i) / n); sin[i] = -Math.sin((TAU * i) / n); }
    return (fftPlans[n] = { rev, cos, sin });
  }
  // re, im: aynı boyda diziler (Float64Array önerilir). inverse=true ise ters dönüşüm (1/n ölçekli)
  function fft(re, im, inverse = false) {
    const n = re.length, { rev, cos, sin } = plan(n);
    for (let i = 0; i < n; i++) {
      const j = rev[i];
      if (j > i) { let t = re[i]; re[i] = re[j]; re[j] = t; t = im[i]; im[i] = im[j]; im[j] = t; }
    }
    const sg = inverse ? -1 : 1;
    for (let size = 2; size <= n; size <<= 1) {
      const half = size >> 1, step = n / size;
      for (let start = 0; start < n; start += size) {
        for (let k = 0; k < half; k++) {
          const wr = cos[k * step], wi = sg * sin[k * step];
          const a = start + k, b = a + half;
          const tr = re[b] * wr - im[b] * wi, ti = re[b] * wi + im[b] * wr;
          re[b] = re[a] - tr; im[b] = im[a] - ti;
          re[a] += tr; im[a] += ti;
        }
      }
    }
    if (inverse) for (let i = 0; i < n; i++) { re[i] /= n; im[i] /= n; }
  }

  /* Güç spektrumu (dBFS). Çıkış merkezlenmiş: indeks 0 = −fs/2, n/2 = 0 Hz.
     Tam ölçekli (genlik 1) karmaşık bir ton, pencereden bağımsız olarak 0 dB verir. */
  function spectrum(buf, n, { window: win = "hann", offset = 0, out = new Float32Array(n), re, im } = {}) {
    const w = window_(win, n);
    re = re || new Float64Array(n); im = im || new Float64Array(n);
    for (let i = 0; i < n; i++) {
      const k = 2 * (offset + i);
      re[i] = (buf[k] || 0) * w[i]; im[i] = (buf[k + 1] || 0) * w[i];
    }
    fft(re, im);
    const norm = 1 / (n * w.gain);
    for (let i = 0; i < n; i++) {
      const j = (i + n / 2) % n; // fftshift
      const p = (re[j] * re[j] + im[j] * im[j]) * norm * norm;
      out[i] = 10 * Math.log10(p + 1e-20);
    }
    return out;
  }
  // FFT kutusunun merkez frekansı (normalize), merkezlenmiş indeks için
  const binFreq = (i, n) => (i - n / 2) / n;

  /* Ortalama alan spektrum ölçer (üstel ortalama, doğrusal güçte) */
  class SpectrumAverager {
    constructor(n) { this.n = n; this.acc = null; this.db = new Float32Array(n); }
    push(db, alpha) {
      if (!this.acc || alpha >= 1) { this.acc = Float64Array.from(db, (v) => 10 ** (v / 10)); }
      else for (let i = 0; i < this.n; i++) this.acc[i] += alpha * (10 ** (db[i] / 10) - this.acc[i]);
      for (let i = 0; i < this.n; i++) this.db[i] = 10 * Math.log10(this.acc[i] + 1e-20);
      return this.db;
    }
  }

  /* ---------- FIR filtre ---------- */
  // Pencereli sinc alçak geçiren filtre. cutoff: normalize kesim frekansı (0 … 0.5)
  function firLowpass(taps, cutoff, win = "blackman") {
    const h = new Float32Array(taps), m = (taps - 1) / 2;
    let sum = 0;
    for (let i = 0; i < taps; i++) {
      const x = i - m;
      const s = x === 0 ? 2 * cutoff : Math.sin(TAU * cutoff * x) / (Math.PI * x);
      h[i] = s * WINDOWS[win](i, taps);
      sum += h[i];
    }
    for (let i = 0; i < taps; i++) h[i] /= sum; // 0 Hz'de kazanç 1
    return h;
  }
  // Yükseltilmiş kosinüs kökü (RRC) darbe biçimlendirme filtresi; sps: sembol başına örnek
  function rrc(sps, span, beta) {
    const n = span * sps + 1, h = new Float32Array(n), m = (n - 1) / 2;
    let e = 0;
    for (let i = 0; i < n; i++) {
      const t = (i - m) / sps;
      let v;
      if (t === 0) v = 1 - beta + (4 * beta) / Math.PI;
      else if (beta && Math.abs(Math.abs(4 * beta * t) - 1) < 1e-9)
        v = (beta / Math.SQRT2) * ((1 + 2 / Math.PI) * Math.sin(Math.PI / (4 * beta)) + (1 - 2 / Math.PI) * Math.cos(Math.PI / (4 * beta)));
      else v = (Math.sin(Math.PI * t * (1 - beta)) + 4 * beta * t * Math.cos(Math.PI * t * (1 + beta))) / (Math.PI * t * (1 - (4 * beta * t) ** 2));
      h[i] = v; e += v * v;
    }
    const g = 1 / Math.sqrt(e);
    for (let i = 0; i < n; i++) h[i] *= g; // birim enerji
    return h;
  }
  // Filtrenin frekans yanıtı (dB), 0 … 0.5 arasında points noktada
  function freqResponse(h, points = 256) {
    const out = new Float32Array(points);
    for (let k = 0; k < points; k++) {
      const f = (0.5 * k) / (points - 1);
      let re = 0, im = 0;
      for (let i = 0; i < h.length; i++) { re += h[i] * Math.cos(TAU * f * i); im -= h[i] * Math.sin(TAU * f * i); }
      out[k] = 20 * Math.log10(Math.hypot(re, im) + 1e-12);
    }
    return out;
  }
  // Durum tutan, gerçek katsayılı FIR: karmaşık (iç içe) ya da gerçek akışlara uygulanır
  class FIR {
    constructor(h, complex = true) {
      this.h = h; this.complex = complex;
      const n = h.length;
      this.hist = new Float32Array((complex ? 2 : 1) * n * 2); // çift tampon: kaydırmasız okuma
      this.pos = 0;
    }
    process(input, out = new Float32Array(input.length)) {
      const { h } = this, n = h.length;
      if (this.complex) {
        const H = this.hist, len = input.length >> 1;
        for (let i = 0; i < len; i++) {
          this.pos = (this.pos + n - 1) % n;
          const p = this.pos;
          H[2 * p] = H[2 * (p + n)] = input[2 * i];
          H[2 * p + 1] = H[2 * (p + n) + 1] = input[2 * i + 1];
          let a = 0, b = 0;
          for (let k = 0; k < n; k++) { a += h[k] * H[2 * (p + k)]; b += h[k] * H[2 * (p + k) + 1]; }
          out[2 * i] = a; out[2 * i + 1] = b;
        }
      } else {
        const H = this.hist;
        for (let i = 0; i < input.length; i++) {
          this.pos = (this.pos + n - 1) % n;
          const p = this.pos;
          H[p] = H[p + n] = input[i];
          let a = 0;
          for (let k = 0; k < n; k++) a += h[k] * H[p + k];
          out[i] = a;
        }
      }
      return out;
    }
  }
  /* Bant geçiren / bant durduran filtreler.
     Karmaşık katsayılı bant geçiren = alçak geçireni f0'a kaydırmak: h[n]·e^(j2πf0n).
     Yalnızca +f0 çevresini geçirir (IQ'da −f0 ayrı bir yerdir).
     Gerçek katsayılı bant geçiren = 2·h[n]·cos(2πf0n): hem +f0 hem −f0'da geçiş bandı açar. */
  function firBandpass(taps, f0, bw, win = "blackman") {
    const lp = firLowpass(taps, bw / 2, win), m = (taps - 1) / 2;
    const re = new Float32Array(taps), im = new Float32Array(taps);
    for (let i = 0; i < taps; i++) { const p = TAU * f0 * (i - m); re[i] = lp[i] * Math.cos(p); im[i] = lp[i] * Math.sin(p); }
    return { re, im };
  }
  function firBandpassReal(taps, f0, bw, win = "blackman") {
    const lp = firLowpass(taps, bw / 2, win), m = (taps - 1) / 2, h = new Float32Array(taps);
    for (let i = 0; i < taps; i++) h[i] = 2 * lp[i] * Math.cos(TAU * f0 * (i - m));
    return h;
  }
  // Bant durduran (çentik): birim dürtüden karmaşık bant geçireni çıkar
  function firBandstop(taps, f0, bw, win = "blackman") {
    const bp = firBandpass(taps, f0, bw, win), m = (taps - 1) / 2;
    for (let i = 0; i < taps; i++) { bp.re[i] = (i === m ? 1 : 0) - bp.re[i]; bp.im[i] = -bp.im[i]; }
    return bp;
  }
  // Karmaşık katsayılı FIR ({re, im}) iç içe IQ akışına; durum tutar
  class CFIR {
    constructor(h) { this.set(h); }
    set(h) {
      const n = h.re.length;
      if (!this.hist || this.n !== n) { this.hist = new Float32Array(4 * n); this.pos = 0; this.n = n; }
      this.hr = h.re; this.hi = h.im;
    }
    process(input, out = new Float32Array(input.length)) {
      const { hr, hi, n } = this, H = this.hist, len = input.length >> 1;
      for (let i = 0; i < len; i++) {
        this.pos = (this.pos + n - 1) % n;
        const p = this.pos;
        H[2 * p] = H[2 * (p + n)] = input[2 * i];
        H[2 * p + 1] = H[2 * (p + n) + 1] = input[2 * i + 1];
        let a = 0, b = 0;
        for (let k = 0; k < n; k++) {
          const xr = H[2 * (p + k)], xi = H[2 * (p + k) + 1];
          a += hr[k] * xr - hi[k] * xi; b += hr[k] * xi + hi[k] * xr;
        }
        out[2 * i] = a; out[2 * i + 1] = b;
      }
      return out;
    }
  }
  // Karmaşık katsayılı filtrenin yanıtı (dB), −0.5 … +0.5 arasında points noktada
  function freqResponseC(h, points = 512) {
    const out = new Float32Array(points), re0 = h.re || h, im0 = h.im || new Float32Array(re0.length);
    for (let k = 0; k < points; k++) {
      const f = -0.5 + k / (points - 1);
      let re = 0, im = 0;
      for (let i = 0; i < re0.length; i++) {
        const c = Math.cos(TAU * f * i), s = -Math.sin(TAU * f * i);
        re += re0[i] * c - im0[i] * s; im += re0[i] * s + im0[i] * c;
      }
      out[k] = 20 * Math.log10(Math.hypot(re, im) + 1e-12);
    }
    return out;
  }
  // Durumsuz kısa yol: tüm tamponu süz
  function filter(buf, h, complex = true) { return new FIR(h, complex).process(buf); }

  /* ---------- azaltma (decimation) ---------- */
  // Önce alçak geçiren filtre, sonra her M örnekten birini al
  class Decimator {
    constructor(M, taps = 8 * M + 1, complex = true) {
      this.M = M; this.complex = complex;
      this.fir = new FIR(firLowpass(taps, 0.5 / M * 0.8), complex);
      this.phase = 0;
    }
    process(input) {
      const f = this.fir.process(input), step = this.complex ? 2 : 1;
      const len = f.length / step, out = [];
      for (let i = 0; i < len; i++) {
        if (this.phase === 0) { out.push(f[step * i]); if (this.complex) out.push(f[step * i + 1]); }
        this.phase = (this.phase + 1) % this.M;
      }
      return Float32Array.from(out);
    }
  }
  function decimate(buf, M, complex = true) { return new Decimator(M, undefined, complex).process(buf); }

  /* ---------- demodülasyon ---------- */
  // AM: zarf (genlik) − ortalama
  function amDemod(buf) {
    const n = buf.length >> 1, out = new Float32Array(n);
    let mean = 0;
    for (let i = 0; i < n; i++) { out[i] = Math.hypot(buf[2 * i], buf[2 * i + 1]); mean += out[i]; }
    mean /= n || 1;
    for (let i = 0; i < n; i++) out[i] -= mean;
    return out;
  }
  // FM: ardışık örnekler arasındaki faz farkı. Çıkış normalize anlık frekans (devir/örnek).
  class FMDemod {
    constructor() { this.pI = 1; this.pQ = 0; }
    process(buf, out = new Float32Array(buf.length >> 1)) {
      const n = buf.length >> 1;
      for (let i = 0; i < n; i++) {
        const I = buf[2 * i], Q = buf[2 * i + 1];
        const re = I * this.pI + Q * this.pQ, im = Q * this.pI - I * this.pQ;
        out[i] = Math.atan2(im, re) / TAU;
        this.pI = I; this.pQ = Q;
      }
      return out;
    }
  }
  function fmDemod(buf) { return new FMDemod().process(buf); }

  /* ---------- modülatörler ---------- */
  // AM: (1 + m·ses) taşıyıcı; taşıyıcı 0 Hz'de (temel bant)
  function amMod(audio, m = 0.8) {
    const out = new Float32Array(2 * audio.length);
    for (let i = 0; i < audio.length; i++) out[2 * i] = (1 + m * audio[i]) / (1 + m);
    return out;
  }
  // FM: faz = 2π·sapma·∑ses; dev: normalize tepe frekans sapması
  // state verilirse ({ p }) faz bloklar arasında sürer: akışta faz sıçraması olmaz
  function fmMod(audio, dev, state) {
    const out = new Float32Array(2 * audio.length);
    let p = state ? state.p || 0 : 0;
    for (let i = 0; i < audio.length; i++) {
      p += TAU * dev * audio[i];
      out[2 * i] = Math.cos(p); out[2 * i + 1] = Math.sin(p);
    }
    if (state) state.p = p % TAU;
    return out;
  }

  /* ---------- dijital modülasyon ---------- */
  // Takımyıldızlar: ortalama sembol enerjisi 1, Gray kodlu
  const CONST = (() => {
    const s2 = Math.SQRT1_2;
    // 16-QAM: her eksende Gray sırası 00→−3, 01→−1, 11→+1, 10→+3; üst iki bit I, alt iki bit Q
    const qam16 = [], g = [-3, -1, 1, 3], gray2 = { "-3": 0, "-1": 1, 1: 3, 3: 2 };
    for (const i of g) for (const q of g) qam16[(gray2[i] << 2) | gray2[q]] = [i / Math.sqrt(10), q / Math.sqrt(10)];
    const psk8 = [];
    const gray3 = [0, 1, 3, 2, 6, 7, 5, 4];
    for (let k = 0; k < 8; k++) psk8[gray3[k]] = [Math.cos((TAU * k) / 8), Math.sin((TAU * k) / 8)];
    return {
      ask: { bits: 1, pts: [[0, 0], [Math.SQRT2, 0]] },
      bpsk: { bits: 1, pts: [[-1, 0], [1, 0]] },
      qpsk: { bits: 2, pts: [[s2, s2], [-s2, s2], [s2, -s2], [-s2, -s2]] }, // ilk bit Q işareti, ikinci bit I işareti
      psk8: { bits: 3, pts: psk8 },
      qam16: { bits: 4, pts: qam16 },
    };
  })();
  // bit dizisini sembollere (IQ) çevir
  function mapBits(bits, scheme) {
    const C = CONST[scheme], k = C.bits, n = Math.floor(bits.length / k);
    const out = new Float32Array(2 * n), idx = new Uint8Array(n);
    for (let s = 0; s < n; s++) {
      let v = 0;
      for (let b = 0; b < k; b++) v = (v << 1) | bits[s * k + b];
      idx[s] = v;
      out[2 * s] = C.pts[v][0]; out[2 * s + 1] = C.pts[v][1];
    }
    out.idx = idx;
    return out;
  }
  // en yakın takımyıldız noktasına karar ver, bitleri döndür
  function demapSymbols(sym, scheme) {
    const C = CONST[scheme], k = C.bits, n = sym.length >> 1;
    const bits = new Uint8Array(n * k), idx = new Uint8Array(n);
    for (let s = 0; s < n; s++) {
      const I = sym[2 * s], Q = sym[2 * s + 1];
      let best = 0, bd = Infinity;
      for (let v = 0; v < C.pts.length; v++) {
        const d = (I - C.pts[v][0]) ** 2 + (Q - C.pts[v][1]) ** 2;
        if (d < bd) { bd = d; best = v; }
      }
      idx[s] = best;
      for (let b = 0; b < k; b++) bits[s * k + b] = (best >> (k - 1 - b)) & 1;
    }
    bits.idx = idx;
    return bits;
  }
  // AWGN: snrDb = Es/N0 (sembol başına enerji / gürültü yoğunluğu). Sinyal gücü ölçülür.
  function awgn(buf, snrDb, r = Math.random, sigPower) {
    const n = buf.length >> 1;
    if (sigPower == null) { sigPower = 0; for (let i = 0; i < buf.length; i++) sigPower += buf[i] * buf[i]; sigPower /= n || 1; }
    const sigma = Math.sqrt(sigPower / 10 ** (snrDb / 10) / 2);
    const out = new Float32Array(buf.length);
    for (let i = 0; i < buf.length; i++) out[i] = buf[i] + sigma * gaussian(r);
    return out;
  }
  // Tamamlayıcı hata fonksiyonu (Abramowitz–Stegun 7.1.26, hata < 1.5e-7)
  function erfc(x) {
    const z = Math.abs(x), t = 1 / (1 + 0.3275911 * z);
    const y = t * (0.254829592 + t * (-0.284496736 + t * (1.421413741 + t * (-1.453152027 + t * 1.061405429)))) * Math.exp(-z * z);
    return x >= 0 ? y : 2 - y;
  }
  const Qf = (x) => 0.5 * erfc(x / Math.SQRT2);
  // Kuramsal bit hata oranı, Es/N0 (dB) cinsinden; Gray kodlu yaklaşık ifadeler
  function berTheory(scheme, esn0Db) {
    const es = 10 ** (esn0Db / 10);
    switch (scheme) {
      case "bpsk": return Qf(Math.sqrt(2 * es));
      case "qpsk": return Qf(Math.sqrt(es)); // Eb = Es/2
      case "ask": return Qf(Math.sqrt(es)); // açma-kapama, eşik ortada; Es ortalama enerji
      case "psk8": return (2 / 3) * Qf(Math.sqrt(2 * es) * Math.sin(Math.PI / 8));
      case "qam16": return (3 / 4) * Qf(Math.sqrt(es / 5)); // (4/k)(1−1/√M)·Q(√(3Es/(M−1)))
      default: return NaN;
    }
  }

  // Metni bitlere (UTF-8) ve geri çevir
  function textToBits(str) {
    const bytes = new TextEncoder().encode(str), bits = new Uint8Array(bytes.length * 8);
    bytes.forEach((b, i) => { for (let k = 0; k < 8; k++) bits[8 * i + k] = (b >> (7 - k)) & 1; });
    return bits;
  }
  function bitsToText(bits) {
    const n = Math.floor(bits.length / 8), bytes = new Uint8Array(n);
    for (let i = 0; i < n; i++) { let v = 0; for (let k = 0; k < 8; k++) v = (v << 1) | bits[8 * i + k]; bytes[i] = v; }
    return new TextDecoder("utf-8", { fatal: false }).decode(bytes);
  }

  /* ---------- IQ dosya okuyucular ---------- */
  // Her biri ArrayBuffer alır, iç içe Float32Array (−1 … 1) döndürür
  const readers = {
    cu8(ab) { const u = new Uint8Array(ab), o = new Float32Array(u.length & ~1); for (let i = 0; i < o.length; i++) o[i] = (u[i] - 127.5) / 127.5; return o; },
    cs8(ab) { const s = new Int8Array(ab), o = new Float32Array(s.length & ~1); for (let i = 0; i < o.length; i++) o[i] = s[i] / 128; return o; },
    cs16(ab, be = false) {
      const dv = new DataView(ab), n = (ab.byteLength >> 2) * 2, o = new Float32Array(n);
      for (let i = 0; i < n; i++) o[i] = dv.getInt16(2 * i, !be) / 32768;
      return o;
    },
    cf32(ab, be = false) {
      if (!be && ab.byteLength % 8 === 0) return new Float32Array(ab.slice(0));
      const dv = new DataView(ab), n = (ab.byteLength >> 3) * 2, o = new Float32Array(n);
      for (let i = 0; i < n; i++) o[i] = dv.getFloat32(4 * i, !be);
      return o;
    },
  };
  // Dosya adından biçim tahmini
  function formatFromName(name) {
    const n = name.toLowerCase();
    if (/\.(cu8|u8)$/.test(n)) return "cu8";
    if (/\.(cs8|s8)$/.test(n)) return "cs8";
    if (/\.(cs16|s16|sc16)$/.test(n)) return "cs16";
    if (/\.(cf32|fc32|raw|iq|bin)$/.test(n)) return "cf32";
    return null;
  }
  // SigMF meta verisinden biçim, örnekleme hızı ve merkez frekans
  function parseSigMF(meta) {
    const g = meta.global || {}, dt = (g["core:datatype"] || "").toLowerCase();
    const map = { cu8: "cu8", ci8: "cs8", ci16_le: "cs16", ci16_be: "cs16be", cf32_le: "cf32", cf32_be: "cf32be" };
    const cap = (meta.captures || [])[0] || {};
    return {
      format: map[dt] || null, datatype: dt,
      sampleRate: g["core:sample_rate"] || null,
      centerFreq: cap["core:frequency"] ?? null,
      description: g["core:description"] || "",
    };
  }
  function readIQ(ab, format) {
    if (format === "cs16be") return readers.cs16(ab, true);
    if (format === "cf32be") return readers.cf32(ab, true);
    return readers[format](ab);
  }

  const DSP = {
    TAU, cx, rng, gaussian, NCO, tone, mix, WINDOWS, window: window_, fft, spectrum, binFreq, SpectrumAverager,
    firLowpass, rrc, freqResponse, FIR, filter, Decimator, decimate,
    firBandpass, firBandpassReal, firBandstop, CFIR, freqResponseC,
    amDemod, FMDemod, fmDemod, amMod, fmMod,
    CONST, mapBits, demapSymbols, awgn, erfc, Qf, berTheory, textToBits, bitsToText,
    readers, readIQ, formatFromName, parseSigMF,
  };
  if (typeof module !== "undefined" && module.exports) module.exports = DSP;
  else root.DSP = DSP;
})(typeof self !== "undefined" ? self : this);

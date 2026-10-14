/* Sentetik radyo bandı ve basit alıcı.
   Band: birkaç istasyonu (AM, dar bant FM, geniş FM, Mors, OOK paketleri, kısa telsiz yayınları)
   temel bantta (IQ) üretir. Her istasyonun içeriği Music kaynaklarından gelir.
   Receiver: istasyonu NCO ile 0 Hz'e kaydırır, süzer, azaltır, demodüle eder → ses.
   AudioFifo: blok blok üretilen sesi Sound.stream'in istediği uzunlukta dağıtır. */
(function (root) {
  const TAU = Math.PI * 2;
  const D = root.DSP;
  // Gauss gürültüsü tablosu: örnek başına log/sqrt/cos hesaplamamak için
  const GN = 1 << 16, GT = new Float32Array(GN);
  (() => { const r = D.rng(12345); for (let i = 0; i < GN; i++) GT[i] = D.gaussian(r); })();
  // Sinüs tablosu (16384 nokta, doğrusal aradeğerleme): örnek başına Math.cos/sin yerine
  const SN = 16384, SIN = new Float32Array(SN + 1), K = SN / TAU;
  for (let i = 0; i <= SN; i++) SIN[i] = Math.sin((i / SN) * TAU);
  function sinL(ph) {
    let x = ph * K; x -= Math.floor(x / SN) * SN;
    const i = x | 0, f = x - i;
    return SIN[i] + (SIN[i + 1] - SIN[i]) * f;
  }
  const cosL = (ph) => sinL(ph + Math.PI / 2);

  /* İstasyon tanımı:
     { f: Hz (merkeze göre), mod: "am"|"nfm"|"wfm"|"cw"|"ook"|"carrier", power: dBFS,
       audio: Music kaynağı (am/nfm/wfm için), dev: Hz (FM sapması), m: AM derinliği,
       duty: [açık sn, kapalı sn] (aralıklı yayın), bits: OOK bit hızı (bit/sn) } */
  class Band {
    constructor({ rate = 240000, stations = [], noise = -70, seed = 1 } = {}) {
      this.rate = rate; this.noise = noise; this.r = D.rng(seed);
      this.t = 0;
      this.stations = stations.map((s, k) => this.prep(s, k));
    }
    prep(s, k) {
      const st = { m: 0.8, dev: 5000, duty: null, ...s };
      st.ph = this.r() * TAU; st.fph = 0; st.amp = 10 ** (st.power / 20);
      st.ab = new Float32Array(0);
      st.on = true; st.timer = st.duty ? this.r() * st.duty[1] : 0;
      st.env = st.duty ? 0 : 1;
      if (st.mod === "ook") { st.bitT = 0; st.bit = 1; st.word = []; }
      return st;
    }
    add(s) { const st = this.prep(s, this.stations.length); this.stations.push(st); return st; }
    // sesi ~48 kHz'de üretip bant hızına doğrusal aradeğerlemeyle çıkar (U kat daha ucuz)
    audioAt(s, a, n) {
      const U = Math.max(1, Math.round(this.rate / 48000)), ar = this.rate / U;
      if (U === 1) { s.audio.next(a.subarray(0, n), ar); return; }
      if (!s.au) s.au = { x0: 0, x1: 0, p: 0, buf: new Float32Array(256), bi: 256 };
      const A = s.au;
      const nextLow = () => { if (A.bi >= A.buf.length) { s.audio.next(A.buf, ar); A.bi = 0; } return A.buf[A.bi++]; };
      let { x0, x1, p } = A;
      for (let i = 0; i < n; i++) {
        a[i] = x0 + (x1 - x0) * (p / U);
        if (++p === U) { p = 0; x0 = x1; x1 = nextLow(); }
      }
      A.x0 = x0; A.x1 = x1; A.p = p;
    }
    // n karmaşık örnek üret (iç içe Float32Array)
    next(n, out = new Float32Array(2 * n)) {
      const { rate, r } = this;
      const sig = 10 ** (this.noise / 20) / Math.SQRT2;
      // tablodan rastgele başlangıç ve adımla oku (tekrar örüntüsü göze/kulağa çarpmaz)
      let gi = (r() * GN) | 0; const gs = 1 + 2 * ((r() * 4096) | 0);
      for (let i = 0; i < 2 * n; i++) { out[i] = sig * GT[gi]; gi = (gi + gs) & (GN - 1); }
      const dt = 1 / rate;
      for (const s of this.stations) {
        if (s.enabled === false) continue;
        if (s.ab.length < n) s.ab = new Float32Array(n);
        const a = s.ab;
        if (s.audio && (s.mod === "am" || s.mod === "nfm" || s.mod === "wfm")) this.audioAt(s, a, n);
        const w = TAU * s.f / rate;
        for (let i = 0; i < n; i++) {
          // aralıklı yayın: açılıp kapanan zarf
          if (s.duty) {
            s.timer -= dt;
            if (s.timer <= 0) { s.on = !s.on; s.timer = s.on ? s.duty[0] * (0.6 + 0.8 * r()) : s.duty[1] * (0.5 + r()); }
            s.env += ((s.on ? 1 : 0) - s.env) * 0.002;
            if (s.env < 1e-4 && !s.on) { s.ph += w; continue; }
          }
          let I = 0, Q = 0, amp = s.amp * s.env;
          switch (s.mod) {
            case "am": { const e = (1 + s.m * a[i]) / (1 + s.m); I = e * cosL(s.ph); Q = e * sinL(s.ph); break; }
            case "nfm": case "wfm": { s.fph += TAU * s.dev * a[i] / rate; I = cosL(s.ph + s.fph); Q = sinL(s.ph + s.fph); break; }
            case "cw": {
              // Mors: kaynağın on/off durumuna göre taşıyıcı
              // Mors zamanlamasını 64 örnekte bir ilerlet (ses üretmeye gerek yok, yalnızca açık/kapalı)
              if (i % 64 === 0) { s.cwBuf = s.cwBuf || new Float32Array(1); s.audio.next(s.cwBuf, rate / 64); }
              const on = s.audio.on ? 1 : 0; s.cwEnv = (s.cwEnv || 0) + (on - (s.cwEnv || 0)) * 0.01;
              I = s.cwEnv * cosL(s.ph); Q = s.cwEnv * sinL(s.ph); break;
            }
            case "ook": {
              // uzaktan kumanda: kısa paketler hâlinde açma-kapama bitleri
              s.bitT -= dt;
              if (s.bitT <= 0) {
                if (!s.word.length) s.word = Array.from({ length: 24 }, () => (r() < 0.5 ? 1 : 0)).flatMap((b) => (b ? [1, 1, 1, 0] : [1, 0, 0, 0]));
                s.bit = s.word.shift(); s.bitT = 1 / (s.bits || 2000);
              }
              // keskin açılıp kapanma spektrumda geniş saçılma yapar; kısa bir zarfla yumuşat
              s.okEnv = (s.okEnv || 0) + (s.bit - (s.okEnv || 0)) * 0.08;
              I = s.okEnv * cosL(s.ph); Q = s.okEnv * sinL(s.ph); break;
            }
            default: I = cosL(s.ph); Q = sinL(s.ph); // "carrier": saf taşıyıcı
          }
          out[2 * i] += amp * I; out[2 * i + 1] += amp * Q;
          s.ph += w;
        }
        s.ph %= TAU; s.fph %= TAU;
      }
      this.t += n / rate;
      return out;
    }
  }

  /* Alıcı: ayar (NCO) → alçak geçiren + azaltma → demodülatör → DC giderme, de-emfazis, otomatik kazanç */
  class Receiver {
    constructor({ rate = 240000, decim = 5, mode = "nfm", tune = 0, bw = 12000, dev = 5000 } = {}) {
      this.rate = rate; this.decim = decim; this.mode = mode; this.dev = dev;
      this.nco = new D.NCO(0);
      this.setTune(tune);
      this.setBandwidth(bw);
      this.fm = new D.FMDemod();
      this.dc = 0; this.agc = 0.3; this.de = 0;
    }
    setTune(hz) { this.tune = hz; this.nco.freq = -hz / this.rate; }
    setBandwidth(bw) {
      this.bw = bw;
      const taps = 6 * this.decim * 2 + 1;
      const h = D.firLowpass(taps, Math.min(0.49, (bw / 2) / this.rate));
      if (!this.fir || this.fir.h.length !== taps) this.fir = new D.FIR(h); else this.fir.h = h;
      this.ph = 0;
    }
    // azaltmalı süzgeç: geçmişi tut, yalnızca her M. çıkışı hesapla
    decFilter(x) {
      const h = this.fir.h, T = h.length, M = this.decim, n = x.length >> 1;
      if (!this.dh || this.dh.length !== 2 * (T - 1)) this.dh = new Float32Array(2 * (T - 1));
      const buf = new Float32Array(this.dh.length + x.length);
      buf.set(this.dh); buf.set(x, this.dh.length);
      const outN = Math.max(0, Math.ceil((n - this.ph) / M)), out = new Float32Array(2 * outN);
      let k = 0;
      for (let i = this.ph; i < n; i += M) {
        // çıkış i: buf'ta (T-1+i) konumundaki örnek ve geriye doğru T-1 örnek
        let a = 0, b = 0;
        const base = 2 * (T - 1 + i);
        for (let t = 0; t < T; t++) { const j = base - 2 * t; a += h[t] * buf[j]; b += h[t] * buf[j + 1]; }
        out[2 * k] = a; out[2 * k + 1] = b; k++;
      }
      this.ph = this.ph + outN * M - n;
      this.dh = buf.slice(buf.length - 2 * (T - 1));
      return out;
    }
    // giriş IQ → { iq: süzülmüş/azaltılmış IQ, audio: ses (rate/decim) }
    process(iq) {
      const mixed = this.nco.mix(iq, new Float32Array(iq.length));
      const M = this.decim, n = mixed.length >> 1, ar = this.rate / M;
      // geniş FM her örneği ister; diğerlerinde yalnızca tutulacak örnekler süzülür
      const f = this.mode === "wfm" ? this.fir.process(mixed) : this.decFilter(mixed);
      let dec, k, audio;
      if (this.mode === "wfm") {
        // geniş FM azaltılmış hıza sığmaz: önce tam hızda demodüle et, sonra sesi süz ve azalt
        const fm = this.fm.process(f), g = this.rate / this.dev;
        if (!this.afir) this.afir = new D.FIR(D.firLowpass(8 * M + 1, 15000 / this.rate), false);
        const a = this.afir.process(fm);
        const outN = Math.ceil((n - this.ph) / M);
        dec = new Float32Array(2 * Math.max(0, outN)); audio = new Float32Array(Math.max(0, outN)); k = 0;
        const de = Math.exp(-1 / (ar * 50e-6));
        for (let i = this.ph; i < n; i += M) {
          dec[2 * k] = f[2 * i]; dec[2 * k + 1] = f[2 * i + 1];
          this.de = de * this.de + (1 - de) * a[i] * g; audio[k] = this.de * 1.5; k++;
        }
        this.ph = (this.ph + outN * M) - n;
      } else {
        dec = f; k = f.length >> 1;
        audio = new Float32Array(k);
        if (this.mode === "am") {
          for (let i = 0; i < k; i++) {
            const e = Math.hypot(dec[2 * i], dec[2 * i + 1]);
            this.dc += (e - this.dc) * 0.0015;
            audio[i] = e - this.dc;
          }
        } else {
          const fm = this.fm.process(dec.subarray(0, 2 * k)), g = ar / this.dev;
          for (let i = 0; i < k; i++) audio[i] = fm[i] * g;
        }
      }
      // yavaş otomatik kazanç: seviye ~0.3 civarında kalsın
      if (this.mode === "am") {
        for (let i = 0; i < k; i++) {
          const v = Math.abs(audio[i]);
          this.agc += ((v > this.agc ? 0.01 : 0.0003)) * (v - this.agc);
          audio[i] = Math.max(-1, Math.min(1, audio[i] * 0.3 / Math.max(this.agc, 1e-4)));
        }
      } else for (let i = 0; i < k; i++) audio[i] = Math.max(-1, Math.min(1, audio[i] * 0.6));
      return { iq: dec.subarray(0, 2 * k), audio, rate: ar };
    }
  }

  /* Ses kuyruğu: producer() her çağrıda bir Float32Array ses döndürür */
  class AudioFifo {
    constructor(producer) { this.producer = producer; this.buf = new Float32Array(0); }
    fill(out) {
      while (this.buf.length < out.length) {
        const more = this.producer();
        if (!more || !more.length) break;
        const nb = new Float32Array(this.buf.length + more.length);
        nb.set(this.buf); nb.set(more, this.buf.length); this.buf = nb;
      }
      const n = Math.min(out.length, this.buf.length);
      out.set(this.buf.subarray(0, n)); out.fill(0, n);
      this.buf = this.buf.slice(n);
      return out;
    }
  }

  root.Signals = { Band, Receiver, AudioFifo, sinL, cosL };
})(typeof self !== "undefined" ? self : this);

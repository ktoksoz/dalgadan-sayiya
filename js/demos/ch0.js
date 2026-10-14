/* Kapak: canlı şelale. Bir FM bandı (87,5–108 MHz) boyunca hayalî istasyonlar.
   Fare bir istasyonun üzerine gelince istasyon belirginleşir ve sesi duyulur;
   istasyonlar arasında parazit (hışırtı) duyulur. Kapanış slaytı da aynı demoyu kullanır. */
(function () {
  const { C, FONT, rgba, h, canvas, loop, clamp, hz } = L;

  // [MHz, içerik, tını/ayar] — istasyonlar hayalîdir
  const STATIONS = [
    { f: 89.3, kind: "müzik", src: () => Music.melody({ timbre: "flute", bpm: 126 }), w: 0.2, p: -38 },
    { f: 91.7, kind: "konuşma", src: () => Music.voice({ pitch: 115, seed: 3 }), w: 0.18, p: -46 },
    { f: 94.1, kind: "müzik", src: () => Music.melody({ timbre: "organ", bpm: 100, transpose: -5 }), w: 0.2, p: -33 },
    { f: 96.6, kind: "Mors işareti", src: () => Music.morse({ text: "SDR", freq: 650 }), w: 0.03, p: -50, cw: true },
    { f: 99.2, kind: "müzik", src: () => Music.melody({ timbre: "pluck", bpm: 150, transpose: 2 }), w: 0.2, p: -30 },
    { f: 101.8, kind: "konuşma", src: () => Music.voice({ pitch: 190, seed: 11 }), w: 0.18, p: -52 },
    { f: 104.5, kind: "müzik", src: () => Music.melody({ timbre: "pure", bpm: 112, transpose: 7 }), w: 0.2, p: -42 },
    { f: 106.9, kind: "müzik", src: () => Music.melody({ timbre: "organ", bpm: 138, transpose: -2 }), w: 0.2, p: -36 },
  ];
  const F0 = 87.5, F1 = 108;

  Demos.cover = function (stage, slide) {
    const outro = slide.dataset.variant === "outro";
    const cv = h("canvas", { "aria-label": "Canlı şelale ekranı: fareyle bir istasyonun üzerine gelin" });
    stage.append(cv);
    const BINS = 640;
    const r = DSP.rng(outro ? 21 : 5);
    const wf = new V.Waterfall(BINS, 300);
    wf.min = -100; wf.max = -20;
    const row = new Float32Array(BINS), avg = new Float32Array(BINS).fill(-95);
    const srcs = STATIONS.map((s) => ({ ...s, gen: s.src(), level: 0, buf: new Float32Array(256) }));
    const hissGen = Music.hiss({ seed: 9 });
    let hover = -1, hoverF = null, tuneGain = 0, bursts = [];
    let st, top = 0;

    // her istasyonun anlık ses seviyesi (spektrumdaki "nefes alma" için) küçük bloklarla izlenir
    function stationShape(s, f, lvl) {
      const d = Math.abs(f - s.f) / (s.w / 2);
      if (s.cw) return d < 1 ? s.p + 6 - d * 30 : -200;
      if (d > 1.6) return -200;
      // FM yayın: düz tepeli, kenarları ses seviyesine göre genişleyip daralan çan
      const edge = 0.75 + 0.35 * lvl;
      const v = d < edge ? 0 : -6 * ((d - edge) / 0.18) ** 2;
      return s.p + v + lvl * 3;
    }
    function genRow() {
      for (let i = 0; i < BINS; i++) {
        const f = F0 + ((i + 0.5) / BINS) * (F1 - F0);
        // gürültü tabanı: üstel dağılımlı güç (Rayleigh genlik) → dB
        let p = 10 ** (-9.3) * -Math.log(1 - r() * 0.999);
        for (const s of srcs) {
          if (s.cw && !s.gen.on) continue;
          const db = stationShape(s, f, s.level);
          if (db > -150) p += 10 ** (db / 10) * (0.7 + 0.6 * r());
        }
        for (const b of bursts) if (Math.abs(f - b.f) < b.w) p += 10 ** (b.p / 10) * (0.6 + 0.8 * r());
        row[i] = 10 * Math.log10(p);
        avg[i] += (row[i] - avg[i]) * 0.25;
      }
      wf.push(row);
    }

    function draw() {
      const { ctx, w, h: H } = st;
      ctx.fillStyle = C.bg; ctx.fillRect(0, 0, w, H);
      top = Math.max(70, H * 0.2);
      const scaleY = 34;
      // şelale
      wf.draw(ctx, 0, top, w, H - top);
      // spektrum izi (üst şerit)
      V.spectrum(ctx, { x: 0, y: scaleY + 6, w, h: top - scaleY - 6, db: avg, min: -100, max: -20, alpha: 0.9 });
      // kadran skalası
      const maj = [], min = [];
      const stepM = w < 600 ? 4 : 2; for (let f = 88; f <= 106; f += stepM) maj.push(f);
      for (let f = 87.5; f <= 108; f += w < 600 ? 1 : 0.5) min.push(f);
      ctx.fillStyle = rgba(C.bg, 0.85); ctx.fillRect(0, 0, w, scaleY);
      V.scale(ctx, { x: 0, y: scaleY, w, from: F0, to: F1, major: maj, minor: min, fmt: (v) => String(v), up: true, size: 15, color: C.ink });
      V.text(ctx, "MHz", w - 10, scaleY - 12, { align: "right", size: 15, color: C.ink2, font: FONT.display, weight: 700 });
      ctx.strokeStyle = rgba(C.ink, 0.25); ctx.beginPath(); ctx.moveTo(0, scaleY + 0.5); ctx.lineTo(w, scaleY + 0.5); ctx.stroke();
      // fareyle ayar: kırmızı ibre ve istasyon vurgusu
      if (hoverF != null) {
        const x = ((hoverF - F0) / (F1 - F0)) * w;
        if (hover >= 0) {
          const s = srcs[hover], x0 = ((s.f - s.w / 2 - F0) / (F1 - F0)) * w, x1 = ((s.f + s.w / 2 - F0) / (F1 - F0)) * w;
          ctx.fillStyle = rgba(C.ink, 0.07); ctx.fillRect(x0, scaleY, Math.max(3, x1 - x0), H);
          ctx.strokeStyle = rgba(C.ink, 0.45); ctx.lineWidth = 1;
          ctx.strokeRect(Math.round(x0) + 0.5, scaleY + 0.5, Math.max(3, x1 - x0), H);
        }
        V.needle(ctx, x, scaleY, H - scaleY);
        const label = hover >= 0 ? `${L.num(srcs[hover].f, 1)} MHz · ${srcs[hover].kind}` : `${L.num(hoverF, 2)} MHz · parazit`;
        const lx = x > w - 220 ? x - 12 : x + 12;
        V.text(ctx, label, lx, scaleY + 26, { color: C.ink, size: 14, align: x > w - 220 ? "right" : "left", weight: 700 });
      }
    }
    st = canvas(cv, () => draw());

    // ses: istasyon ile parazit arasında ayara göre geçiş
    const mixBuf = { a: null, n: null };
    let stream = null;
    function fill(out, rate) {
      if (!mixBuf.a || mixBuf.a.length !== out.length) { mixBuf.a = new Float32Array(out.length); mixBuf.n = new Float32Array(out.length); }
      hissGen.next(mixBuf.n, rate);
      const s = hover >= 0 ? srcs[hover] : null;
      if (s) s.gen.next(mixBuf.a, rate); else mixBuf.a.fill(0);
      const target = s ? 1 : 0;
      for (let i = 0; i < out.length; i++) {
        tuneGain += (target - tuneGain) * 0.002;
        out[i] = mixBuf.a[i] * tuneGain + mixBuf.n[i] * (1 - tuneGain * 0.92) * (hoverF != null ? 1 : 0);
      }
    }
    function ensureStream() { if (!stream) stream = Sound.stream(slide, fill, { gain: 0.8 }); }

    L.pointer(cv, {
      hover: (x) => setHover(x),
      down: (x) => setHover(x),
      move: (x) => setHover(x),
    });
    function setHover(x) {
      if (x < 0) { hoverF = null; hover = -1; return; }
      hoverF = F0 + (x / st.w) * (F1 - F0);
      hover = srcs.findIndex((s) => Math.abs(hoverF - s.f) < Math.max(0.12, s.w / 2 + 0.03));
      ensureStream();
    }

    // istasyon "ses seviyeleri": ses kaynağını sessizce örnekleyip zarfını izle
    function updateLevels(dt) {
      for (const s of srcs) {
        if (s.cw) { s.gen.next(s.buf.subarray(0, Math.round(dt * 4000)), 4000); continue; }
        s.lt = (s.lt || 0) + dt;
        s.level += ((0.5 + 0.5 * Math.sin(s.lt * (1.3 + s.f % 1.7)) * Math.sin(s.lt * 0.37 + s.f)) - s.level) * 0.1;
      }
      // kısa yayınlar: telsiz anonsları, paket sinyalleri
      if (r() < dt * 0.9) bursts.push({ f: F0 + 0.4 + r() * (F1 - F0 - 0.8), w: 0.02 + r() * 0.05, p: -55 + r() * 12, t: 0.3 + r() * 1.5 });
      bursts.forEach((b) => (b.t -= dt));
      bursts = bursts.filter((b) => b.t > 0);
    }

    let acc = 0;
    const lp = loop((dt) => {
      updateLevels(dt);
      acc += dt;
      while (acc > 1 / 45) { genRow(); acc -= 1 / 45; }
      draw();
    });
    // ilk açılışta şelale boş görünmesin
    for (let i = 0; i < 240; i++) { updateLevels(1 / 45); genRow(); }

    return {
      enter() { lp.start(); },
      leave() { lp.stop(); if (stream) { stream.stop(); stream = null; } hoverF = null; hover = -1; },
    };
  };
})();

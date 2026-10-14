/* Bölüm 2: Örnekleme
   - adc: örnekleme hızı ve bit derinliği; nicemleme seviyeleri, hata, ölçülen SQNR, ses
   - nyquist: sınırın ötesinde örtüşme; katlanma diyagramı; süpürülen ton
   - wagonWheel: vagon tekerleği etkisi; gerçek ve "filme alınmış" tekerlek
   - hundredMHz: 100 MHz'i doğrudan örneklemenin bedeli; sonraki bölüme köprü */
(function () {
  const { C, FONT, rgba, h, canvas, loop, clamp, num } = L;
  const TAU = Math.PI * 2;
  const ALIAS = "#c7a6ff"; // sahte (örtüşmüş) dalga: lila; I/Q, genlik, faz ve ibre renklerinden ayrı
  const trim = (s) => (s.includes(",") ? s.replace(/0+$/, "").replace(/,$/, "") : s);
  const hz = (v, sig = 3) => {
    const a = Math.abs(v);
    const [m, u] = a >= 1e9 ? [1e9, "GHz"] : a >= 1e6 ? [1e6, "MHz"] : a >= 1e3 ? [1e3, "kHz"] : [1, "Hz"];
    const x = v / m, d = a / m >= 100 ? 0 : Math.max(0, sig - 1 - Math.floor(Math.log10(Math.max(1e-9, Math.abs(x))) + 1e-9));
    return trim(num(x, Math.min(d, 3))) + " " + u;
  };
  const rate = (v) => {
    const [m, u] = v >= 1e9 ? [1e9, "GS/sn"] : v >= 1e6 ? [1e6, "MS/sn"] : v >= 1e3 ? [1e3, "kS/sn"] : [1, "S/sn"];
    const x = v / m; return trim(num(x, x >= 100 ? 0 : x >= 10 ? 1 : 2)) + " " + u;
  };
  const bytesPS = (v) => {
    const U = [[1e9, "GB/sn"], [1e6, "MB/sn"], [1e3, "kB/sn"], [1, "B/sn"]];
    for (const [m, u] of U) if (v >= m) { const x = v / m; return trim(num(x, x >= 100 ? 0 : x >= 10 ? 1 : 2)) + " " + u; }
    return num(v, 0) + " B/sn";
  };
  const bytes = (v) => {
    const U = [[1e12, "TB"], [1e9, "GB"], [1e6, "MB"], [1e3, "kB"], [1, "B"]];
    for (const [m, u] of U) if (v >= m) { const x = v / m; return trim(num(x, x >= 100 ? 0 : x >= 10 ? 1 : 2)) + " " + u; }
    return num(v, 0) + " B";
  };
  function readout(k, cls) { const v = h("span.v"); const el = h("div.readout" + (cls ? "." + cls : ""), h("span.k", k), v); el.v = v; return el; }

  /* ================= 4. ADC ================= */
  // orta-yükselen (mid-rise) düzgün nicemleyici: −1…1 aralığı 2^N seviyeye bölünür
  function quant(x, N) {
    const Lv = 2 ** N, d = 2 / Lv;
    const c = clamp(Math.floor((x + 1) / d), 0, Lv - 1);
    return -1 + (c + 0.5) * d;
  }
  // tam ölçek sinüs için SQNR'yi ölç: 65.536 örnek, frekans/örnekleme oranı irrasyonel
  function measureSQNR(N) {
    let ps = 0, pe = 0;
    const r = 0.0123456789 * Math.SQRT2, A = 1 - 1e-9;
    for (let i = 0; i < 65536; i++) {
      const x = A * Math.sin(TAU * r * i + 0.3), e = quant(x, N) - x;
      ps += x * x; pe += e * e;
    }
    return 10 * Math.log10(ps / pe);
  }

  Demos.adc = function (stage, slide) {
    const cv = h("canvas", { "aria-label": "Sinüsün örneklenmesi ve nicemlenmesi; altta nicemleme hatası" });
    const fill = h("div.fill", cv);
    const rL = readout("Seviye sayısı"), rD = readout("Adım (tam ölçeğin)"), rM = readout("Ölçülen SQNR", "cr"), rT = readout("6,02·N + 1,76");
    const reads = h("div.readouts", rL, rD, rM, rT);
    const ctrl = h("div.controls");
    stage.append(h("div.controls.top", reads), fill, ctrl);

    let fs = 8000, N = 3, src = "tone", stream = null;
    const F = 440, WIN = 2 / F; // ekranda iki periyot
    const sFs = L.slider({ label: "Örnekleme hızı", min: 1500, max: 48000, value: fs, log: true, fmt: (v) => trim(num(v / 1000, v < 1e4 ? 1 : 0)) + " kHz", oninput: (v) => { fs = v; }, width: "min(170px, 34vw)" });
    const sN = L.slider({ label: "Bit derinliği", min: 1, max: 16, step: 1, value: N, fmt: (v) => Math.round(v) + " bit", oninput: (v) => { N = Math.round(v); upd(); }, cls: "cr", width: "min(170px, 34vw)" });
    const sSrc = L.seg([["tone", "Ton"], ["melody", "Melodi"]], src, (k) => { src = k; }, "Ses kaynağı");
    const listen = L.toggle("Dinle", false, (on) => {
      if (on) stream = Sound.stream(slide, fillAudio, { gain: 0.55 });
      else if (stream) { stream.stop(); stream = null; }
    });
    ctrl.append(sFs, sN, sSrc, listen);

    const sq = {};
    function upd() {
      const Lv = 2 ** N;
      rL.v.textContent = num(Lv);
      rD.v.textContent = N <= 9 ? "1/" + num(Lv) : "1/" + num(Lv);
      sq[N] = sq[N] ?? measureSQNR(N);
      rM.v.textContent = num(sq[N], 1) + " dB";
      rT.v.textContent = num(6.02 * N + 1.76, 1) + " dB";
    }

    // ses: kaynak → tut-bekle (fs) → nicemle (N bit)
    const mel = Music.melody({ timbre: "flute", bpm: 120, gain: 0.95 });
    let ph = 0, acc = 1, held = 0, buf = null;
    function fillAudio(out, ar) {
      if (src === "melody") { if (!buf || buf.length !== out.length) buf = new Float32Array(out.length); mel.next(buf, ar); }
      for (let i = 0; i < out.length; i++) {
        let x;
        if (src === "melody") x = clamp(buf[i] * 1.5, -1, 1);
        else { ph += TAU * F / ar; if (ph > TAU) ph -= TAU; x = 0.95 * Math.sin(ph); }
        acc += fs / ar;
        if (acc >= 1) { acc -= Math.floor(acc); held = quant(x, N); }
        out[i] = held * 0.6;
      }
    }

    let t0 = 0;
    function draw() {
      const { ctx, w, h: H } = st;
      if (!w) return;
      ctx.fillStyle = C.stage; ctx.fillRect(0, 0, w, H);
      const padL = 46, padR = 16, x0 = padL, pw = w - padL - padR;
      const topY = 22, topH = Math.round((H - 40) * 0.66), errY = topY + topH + 34, errH = H - errY - 14;
      const Y = (v) => topY + topH / 2 - (v * topH) / 2 * 0.92;
      const Lv = 2 ** N, d = 2 / Lv;
      // nicemleme seviyeleri
      if (Lv <= 64) {
        for (let c = 0; c < Lv; c++) {
          const v = -1 + (c + 0.5) * d, y = Math.round(Y(v)) + 0.5;
          ctx.strokeStyle = rgba(C.ink, Lv <= 16 ? 0.13 : 0.07); ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(x0, y); ctx.lineTo(x0 + pw, y); ctx.stroke();
          if (Lv <= 8) V.text(ctx, c.toString(2).padStart(N, "0"), x0 - 6, y + 4, { color: C.muted, size: 11, align: "right", weight: 700 });
        }
      } else {
        ctx.fillStyle = rgba(C.ink, 0.04); ctx.fillRect(x0, Y(1), pw, Y(-1) - Y(1));
        V.text(ctx, num(Lv) + " seviye: çizgiler artık seçilemeyecek kadar sık", x0 + 8, Y(1) + 16, { color: C.muted, size: 11 });
      }
      ctx.strokeStyle = rgba(C.ink, 0.35); ctx.beginPath(); ctx.moveTo(x0, Math.round(Y(1)) + 0.5); ctx.lineTo(x0 + pw, Math.round(Y(1)) + 0.5); ctx.moveTo(x0, Math.round(Y(-1)) + 0.5); ctx.lineTo(x0 + pw, Math.round(Y(-1)) + 0.5); ctx.stroke();
      V.text(ctx, "+1", x0 + pw, Y(1) - 5, { color: C.muted, size: 10.5, align: "right" });
      V.text(ctx, "−1", x0 + pw, Y(-1) + 13, { color: C.muted, size: 10.5, align: "right" });
      // gerçek dalga
      const sig = (t) => 0.95 * Math.sin(TAU * F * t + t0);
      const X = (t) => x0 + (t / WIN) * pw;
      ctx.strokeStyle = rgba(C.ink, 0.38); ctx.lineWidth = 1.4; ctx.beginPath();
      for (let px = 0; px <= pw; px += 1.5) { const t = (px / pw) * WIN, y = Y(sig(t)); px ? ctx.lineTo(x0 + px, y) : ctx.moveTo(x0, y); }
      ctx.stroke();
      // örnekler: tut-bekle merdiveni + noktalar + hata
      const n = Math.floor(WIN * fs) + 1, Ts = 1 / fs;
      ctx.strokeStyle = C.ink; ctx.lineWidth = 2; ctx.lineJoin = "miter"; ctx.beginPath();
      for (let k = 0; k < n; k++) {
        const t = k * Ts, q = quant(sig(t), N), xa = X(t), xb = X(Math.min(WIN, t + Ts));
        k ? ctx.lineTo(xa, Y(q)) : ctx.moveTo(xa, Y(q)); ctx.lineTo(xb, Y(q));
      }
      ctx.stroke();
      const dotR = clamp(pw / n / 5, 1.6, 4.5);
      for (let k = 0; k < n; k++) {
        const t = k * Ts, x = sig(t), q = quant(x, N), px = X(t);
        ctx.strokeStyle = rgba(C.noise, 0.95); ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(px, Y(x)); ctx.lineTo(px, Y(q)); ctx.stroke();
        V.dot(ctx, px, Y(q), dotR, C.ink);
        if (dotR > 2.5) { ctx.strokeStyle = rgba(C.ink, 0.6); ctx.lineWidth = 1; ctx.beginPath(); ctx.arc(px, Y(x), dotR * 0.7, 0, TAU); ctx.stroke(); }
      }
      V.text(ctx, `${num(F)} Hz ton · ${num(n)} örnek / ${num(WIN * 1000, 1)} ms`, x0, 14, { color: C.ink2, size: 12 });
      // hata grafiği
      ctx.fillStyle = rgba(C.bg, 0.4); ctx.fillRect(x0, errY, pw, errH);
      const EY = (e) => errY + errH / 2 - (e / d) * errH * 0.85;
      ctx.strokeStyle = rgba(C.noise, 0.7); ctx.setLineDash([4, 4]); ctx.lineWidth = 1; ctx.beginPath();
      [0.5, -0.5].forEach((k) => { const y = Math.round(EY(k * d)) + 0.5; ctx.moveTo(x0, y); ctx.lineTo(x0 + pw, y); });
      ctx.stroke(); ctx.setLineDash([]);
      V.text(ctx, "+Δ/2", x0 - 6, EY(0.5 * d) + 4, { color: C.noise, size: 10.5, align: "right" });
      V.text(ctx, "−Δ/2", x0 - 6, EY(-0.5 * d) + 4, { color: C.noise, size: 10.5, align: "right" });
      const bw = Math.max(1.5, Math.min(10, pw / n * 0.5));
      for (let k = 0; k < n; k++) {
        const t = k * Ts, x = sig(t), e = quant(x, N) - x, px = X(t);
        ctx.fillStyle = C.noise; const ya = EY(0), yb = EY(e);
        ctx.fillRect(px - bw / 2, Math.min(ya, yb), bw, Math.max(1, Math.abs(yb - ya)));
      }
      V.text(ctx, "nicemleme hatası (ölçülen − gerçek), adım Δ'ya göre", x0, errY - 9, { color: C.ink2, size: 12 });
    }
    const st = canvas(cv, () => draw());
    const lp = loop((dt) => { t0 += dt * 0.6; draw(); });
    upd();
    return { enter() { lp.start(); }, leave() { lp.stop(); if (stream) { stream.stop(); stream = null; listen.set(false); } } };
  };

  /* ================= 5. Nyquist ================= */
  const aliasOf = (f, fs) => f - fs * Math.round(f / fs); // işaretli: −fs/2…fs/2

  Demos.nyquist = function (stage, slide) {
    const cv = h("canvas", { "aria-label": "Örnekleme ve örtüşme: gerçek dalga, örnekler ve örneklerin çizdiği sahte dalga; altta katlanma diyagramı" });
    const fill = h("div.fill", cv);
    const rF = readout("Sinyal"), rN = readout("Nyquist sınırı (fs/2)"), rA = readout("Görünen frekans"), rS = h("span.chip.ny-state");
    const reads = h("div.readouts", rF, rN, rA, rS);
    const ctrl = h("div.controls");
    stage.append(h("div.controls.top", reads), fill, ctrl);

    let fs = 8000, f = 1000, stream = null, sweep = null, aph = 0, tau = 0;
    const sF = L.slider({ label: "Sinyal frekansı", min: 50, max: 20000, step: 10, value: f, fmt: (v) => hz(v, 3), oninput: (v) => { f = v; sweep = null; upd(); }, cls: "cr", width: "min(220px, 40vw)" });
    const sS = L.slider({ label: "Örnekleme hızı", min: 2000, max: 16000, step: 100, value: fs, fmt: (v) => trim(num(v / 1000, 1)) + " kHz", oninput: (v) => { fs = v; upd(); }, width: "min(150px, 32vw)" });
    const listen = L.toggle("Dinle", false, (on) => {
      if (on) stream = Sound.stream(slide, fillAudio, { gain: 0.5 });
      else if (stream) { stream.stop(); stream = null; }
    });
    const sweepB = h("button.btn", { type: "button", onclick: () => { sweep = { t: 0, from: 200, to: Math.min(20000, 2.2 * fs) }; } }, "Süpür");
    ctrl.append(sF, sS, listen, sweepB);

    function upd() {
      const a = aliasOf(f, fs);
      rF.v.textContent = hz(f, 3);
      rN.v.textContent = hz(fs / 2, 3);
      rA.v.textContent = hz(Math.abs(a), 3);
      const over = f > fs / 2;
      rA.classList.toggle("ny-alias", over);
      rS.textContent = over ? "örtüşme: noktalar sahte dalga çiziyor" : "sınırın altında: noktalar doğru dalgayı çizer";
      rS.classList.toggle("on", over);
    }
    // ideal DAC çıkışı: örneklerden geri kurulan sinyal, görünen frekanstaki saf ton
    function fillAudio(out, ar) {
      const fa = Math.abs(aliasOf(f, fs));
      for (let i = 0; i < out.length; i++) { aph += TAU * fa / ar; if (aph > TAU) aph -= TAU; out[i] = 0.35 * Math.sin(aph); }
    }

    function draw() {
      const { ctx, w, h: H } = st;
      if (!w) return;
      ctx.fillStyle = C.stage; ctx.fillRect(0, 0, w, H);
      const pad = 16, x0 = pad, pw = w - 2 * pad;
      const topY = 26, topH = Math.round((H - 30) * 0.56), dY = topY + topH + 46, dH = H - dY - 30;
      const Y = (v) => topY + topH / 2 - v * topH * 0.42;
      const NS = w < 520 ? 14 : 22, Tw = NS / fs, a = aliasOf(f, fs);
      const X = (t) => x0 + ((t - tau) / Tw) * pw;
      ctx.strokeStyle = rgba(C.ink, 0.12); ctx.beginPath(); ctx.moveTo(x0, Math.round(Y(0)) + 0.5); ctx.lineTo(x0 + pw, Math.round(Y(0)) + 0.5); ctx.stroke();
      // gerçek dalga
      ctx.strokeStyle = rgba(C.ink, 0.45); ctx.lineWidth = 1.3; ctx.beginPath();
      const step = Math.max(0.5, Math.min(2, pw / (f * Tw) / 12));
      for (let px = 0; px <= pw; px += step) { const t = tau + (px / pw) * Tw, y = Y(Math.cos(TAU * f * t)); px ? ctx.lineTo(x0 + px, y) : ctx.moveTo(x0, y); }
      ctx.stroke();
      // örneklerin çizdiği dalga (görünen frekans)
      ctx.strokeStyle = ALIAS; ctx.lineWidth = 2.6; ctx.beginPath();
      for (let px = 0; px <= pw; px += 2) { const t = tau + (px / pw) * Tw, y = Y(Math.cos(TAU * a * t)); px ? ctx.lineTo(x0 + px, y) : ctx.moveTo(x0, y); }
      ctx.stroke();
      // örnekler
      const k0 = Math.ceil(tau * fs), k1 = Math.floor((tau + Tw) * fs);
      for (let k = k0; k <= k1; k++) {
        const t = k / fs, px = X(t), y = Y(Math.cos(TAU * f * t));
        ctx.strokeStyle = rgba(C.ink, 0.25); ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(px, Y(0)); ctx.lineTo(px, y); ctx.stroke();
        V.dot(ctx, px, y, 4.5, C.ink, 6);
      }
      // gösterge
      const lg = [[rgba(C.ink, 0.6), "gerçek dalga " + hz(f, 3)], [ALIAS, "örneklerin çizdiği dalga " + hz(Math.abs(a), 3)]];
      let lx = x0;
      lg.forEach(([c, s]) => { ctx.fillStyle = c; ctx.fillRect(lx, 11, 16, 3); V.text(ctx, s, lx + 22, 16, { color: C.ink2, size: 12 }); ctx.font = `400 12px ${FONT.body}`; lx += 22 + ctx.measureText(s).width + 18; });
      // katlanma diyagramı: görünen frekans ↔ gerçek frekans
      const fMax = Math.max(20000, fs * 1.6), DX = (v) => x0 + (v / fMax) * pw, DY = (v) => dY + dH - (v / (fs / 2)) * dH;
      V.text(ctx, "katlanma: gerçek frekans (yatay) → görünen frekans (dikey)", x0, dY - 26, { color: C.ink2, size: 12 });
      ctx.fillStyle = rgba(C.bg, 0.35); ctx.fillRect(x0, dY, pw, dH);
      for (let k = 1; k * fs / 2 <= fMax; k++) {
        const x = Math.round(DX((k * fs) / 2)) + 0.5;
        ctx.strokeStyle = rgba(C.ink, k === 1 ? 0.5 : 0.15); ctx.setLineDash(k === 1 ? [] : [3, 4]); ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(x, dY); ctx.lineTo(x, dY + dH); ctx.stroke(); ctx.setLineDash([]);
        const lab = k === 1 ? "fs/2" : k % 2 === 0 ? (k === 2 ? "fs" : k / 2 + "fs") : k + "fs/2";
        if (DX(fs / 2) - DX(0) > 34 || k <= 2) V.text(ctx, lab, x, dY - 6, { color: k === 1 ? C.ink : C.muted, size: 11, align: "center", weight: 700 });
      }
      ctx.fillStyle = rgba(C.ink, 0.05); ctx.fillRect(x0, dY, DX(fs / 2) - x0, dH);
      ctx.strokeStyle = C.ink; ctx.lineWidth = 2; ctx.beginPath();
      for (let px = 0; px <= pw; px += 1) { const v = (px / pw) * fMax, y = DY(Math.abs(aliasOf(v, fs))); px ? ctx.lineTo(x0 + px, y) : ctx.moveTo(x0, y); }
      ctx.stroke();
      // eksen yazıları
      const tk = V.ticks(0, fMax, Math.max(3, Math.round(pw / 120)));
      tk.major.forEach((v) => { if (v > 0 && v < fMax * 0.98) V.text(ctx, trim(num(v / 1000, 1)) + " kHz", DX(v), dY + dH + 16, { color: C.muted, size: 10.5, align: "center" }); });
      // geçerli nokta
      const px = DX(f), py = DY(Math.abs(a));
      ctx.strokeStyle = rgba(ALIAS, 0.9); ctx.setLineDash([3, 3]); ctx.lineWidth = 1.3; ctx.beginPath(); ctx.moveTo(px, py); ctx.lineTo(x0, py); ctx.stroke(); ctx.setLineDash([]);
      V.needle(ctx, px, dY, dH);
      V.dot(ctx, px, py, 5.5, ALIAS, 8);
      V.dot(ctx, x0 + 3, py, 4, ALIAS);
    }
    const st = canvas(cv, () => draw());
    const lp = loop((dt) => {
      tau += dt * (1.4 / fs);
      if (sweep) {
        sweep.t += dt;
        const u = Math.min(1, sweep.t / 7);
        f = Math.round(sweep.from * (sweep.to / sweep.from) ** u);
        sF.set(f); upd();
        if (u >= 1) sweep = null;
      }
      draw();
    });
    upd();
    return { enter() { lp.start(); }, leave() { lp.stop(); sweep = null; if (stream) { stream.stop(); stream = null; listen.set(false); } } };
  };

  /* ================= 6. Vagon tekerleği ================= */
  function drawWheel(ctx, cx, cy, R, ang, K, blur, mark = false) {
    // blur: bir ekran karesi süresince taranan açı (radyan); çok hızlıysa kollar yelpaze olur
    ctx.save();
    ctx.strokeStyle = rgba(C.ink, 0.9); ctx.lineWidth = Math.max(3, R * 0.07);
    ctx.beginPath(); ctx.arc(cx, cy, R, 0, TAU); ctx.stroke();
    ctx.lineWidth = Math.max(1, R * 0.02); ctx.strokeStyle = rgba(C.ink, 0.35);
    ctx.beginPath(); ctx.arc(cx, cy, R * 0.9, 0, TAU); ctx.stroke();
    const copies = blur > 0.05 ? Math.min(14, Math.ceil(blur / 0.05)) : 1;
    for (let c = 0; c < copies; c++) {
      const a0 = ang - (blur * c) / copies;
      const alpha = copies > 1 ? 1.6 / copies : 1;
      for (let k = 0; k < K; k++) {
        const a = a0 + (k * TAU) / K;
        ctx.strokeStyle = rgba(k === 0 && mark ? C.needle : C.ink, Math.min(1, alpha)); ctx.lineWidth = Math.max(2, R * 0.05); ctx.lineCap = "round";
        ctx.beginPath(); ctx.moveTo(cx + Math.cos(a) * R * 0.14, cy + Math.sin(a) * R * 0.14); ctx.lineTo(cx + Math.cos(a) * R * 0.88, cy + Math.sin(a) * R * 0.88); ctx.stroke();
      }
    }
    ctx.fillStyle = C.ink; ctx.beginPath(); ctx.arc(cx, cy, R * 0.14, 0, TAU); ctx.fill();
    ctx.fillStyle = C.stage; ctx.beginPath(); ctx.arc(cx, cy, R * 0.05, 0, TAU); ctx.fill();
    ctx.restore();
  }

  Demos.wagonWheel = function (stage, slide) {
    const cv = h("canvas", { "aria-label": "Solda gözle görülen tekerlek, sağda kameranın kaydettiği tekerlek; altta film şeridi ve görünen hız grafiği" });
    const fill = h("div.fill", cv);
    const rP = readout("Kare başına dönüş"), rA = readout("Görünen hız", "cr"), rState = h("span.chip.ww-state");
    const ctrl = h("div.controls");
    stage.append(h("div.controls.top", h("div.readouts", rP, rA, rState)), fill, ctrl);

    let rps = 0.5, fps = 24, K = 6, stream = null;
    let ang = 0, camAng = 0, frameAcc = 0;
    const frames = [];
    const sR = L.slider({ label: "Tekerlek hızı", min: 0, max: 10, step: 0.01, value: rps, fmt: (v) => trim(num(v, 2)) + " tur/sn", oninput: (v) => { rps = v; upd(); }, cls: "cr", width: "min(200px, 40vw)" });
    const sC = L.slider({ label: "Kare hızı", min: 5, max: 60, step: 1, value: fps, fmt: (v) => Math.round(v) + " kare/sn", oninput: (v) => { fps = Math.round(v); upd(); }, width: "min(150px, 34vw)" });
    const sK = L.seg([[1, "1 kol"], [4, "4 kol"], [6, "6 kol"]], K, (k) => { K = k; upd(); }, "Kol sayısı");
    const listen = L.toggle("Dinle", false, (on) => {
      if (on) stream = Sound.stream(slide, fillAudio, { gain: 0.6 });
      else if (stream) { stream.stop(); stream = null; }
    });
    ctrl.append(sR, sC, sK, listen);

    // görünen hız: kare başına adım, kol simetrisine (360°/K) göre en yakın değere katlanır
    function apparent(r) {
      const P = 1 / K, step = r / fps; // tur cinsinden
      const s = step - P * Math.round(step / P);
      return s * fps;
    }
    function upd() {
      const step = (360 * rps) / fps, a = apparent(rps);
      rP.v.textContent = trim(num(step, 1)) + "°";
      rA.v.textContent = (Math.abs(a) < 0.005 ? "0" : (a < 0 ? "−" : "") + trim(num(Math.abs(a), 2))) + " tur/sn";
      let s, cls = "";
      if (rps < 0.005) s = "tekerlek duruyor";
      else if (Math.abs(a) < 0.02) { s = "duruyor gibi görünüyor"; cls = "on"; }
      else if (a < 0) { s = "geri dönüyor gibi görünüyor"; cls = "on"; }
      else if (Math.abs(a - rps) > 0.01) { s = "olduğundan yavaş görünüyor"; cls = "on"; }
      else s = "kamera doğru görüyor";
      rState.textContent = s; rState.className = "chip ww-state " + cls;
    }

    // ses: kollar tepeden geçerken tıklama (gerçek), kamera her karede deklanşör sesi
    let spPh = 0, frPh = 0, clickE = 0, tickE = 0, cph = 0, tph = 0;
    function fillAudio(out, ar) {
      for (let i = 0; i < out.length; i++) {
        spPh += (rps * K) / ar; if (spPh >= 1) { spPh -= 1; clickE = 1; }
        frPh += fps / ar; if (frPh >= 1) { frPh -= 1; tickE = 1; }
        cph += TAU * 2200 / ar; tph += TAU * 520 / ar;
        out[i] = 0.5 * clickE * Math.sin(cph) + 0.35 * tickE * Math.sin(tph);
        clickE *= 0.993; tickE *= 0.985;
      }
    }

    function layout(w, H) {
      const wide = w > 560;
      const R = Math.min(wide ? w * 0.15 : w * 0.19, H * (wide ? 0.19 : 0.15)), cy = 20 + R * 1.25;
      return { wide, cy, R, xa: w * 0.27, xb: w * 0.73 };
    }
    function draw(dt) {
      const { ctx, w, h: H } = st;
      if (!w) return;
      ctx.fillStyle = C.stage; ctx.fillRect(0, 0, w, H);
      const { cy, R, xa, xb } = layout(w, H);
      // gözle görülen: ekran karesi boyunca taranan açıyı bulanık çiz
      drawWheel(ctx, xa, cy, R, ang, K, TAU * rps * Math.max(dt, 1 / 60));
      V.text(ctx, "gözünüzle", xa, cy + R * 1.25 + 20, { color: C.ink2, size: 13, align: "center", weight: 700 });
      // kamerada: yalnızca son karenin anı
      ctx.save();
      ctx.strokeStyle = rgba(C.ink, 0.25); ctx.setLineDash([5, 5]); ctx.strokeRect(xb - R * 1.25, cy - R * 1.25, R * 2.5, R * 2.5); ctx.setLineDash([]);
      [[-1, -1], [1, -1], [-1, 1], [1, 1]].forEach(([sx, sy]) => {
        ctx.strokeStyle = C.ink; ctx.lineWidth = 2; ctx.beginPath();
        const x = xb + sx * R * 1.25, y = cy + sy * R * 1.25;
        ctx.moveTo(x - sx * 14, y); ctx.lineTo(x, y); ctx.lineTo(x, y - sy * 14); ctx.stroke();
      });
      ctx.restore();
      drawWheel(ctx, xb, cy, R, camAng, K, 0);
      V.text(ctx, `kamerada (${fps} kare/sn)`, xb, cy + R * 1.25 + 20, { color: C.ink2, size: 13, align: "center", weight: 700 });
      const recOn = (performance.now() / 500) % 2 < 1;
      if (recOn) V.dot(ctx, xb + R * 1.25 - 12, cy - R * 1.25 + 12, 4.5, C.needle, 8);
      // film şeridi
      const fy = cy + R * 1.25 + 52, fh = Math.min(70, H * 0.13), n = Math.max(4, Math.min(8, Math.floor(w / (fh * 1.3))));
      const fw = (w - 32) / n;
      ctx.fillStyle = "#0a1215"; ctx.fillRect(16, fy, w - 32, fh + 16);
      for (let i = 0; i < n; i++) {
        const fx = 16 + i * fw;
        ctx.fillStyle = rgba(C.ink, 0.25);
        for (let k = 0; k < 4; k++) { ctx.fillRect(fx + (k + 0.3) * fw / 4, fy + 2, fw / 8, 4); ctx.fillRect(fx + (k + 0.3) * fw / 4, fy + fh + 10, fw / 8, 4); }
        const fr = frames[frames.length - n + i];
        ctx.strokeStyle = rgba(C.ink, 0.15); ctx.strokeRect(fx + 3.5, fy + 8.5, fw - 7, fh - 1);
        if (fr != null) drawWheel(ctx, fx + fw / 2, fy + 8 + fh / 2, fh * 0.4, fr, K, 0);
      }
      V.text(ctx, "film şeridi: kameranın kaydettiği son kareler", 16, fy - 7, { color: C.muted, size: 11.5 });
      // görünen hız grafiği (testere dişi)
      const gy = fy + fh + 40, gh = H - gy - 26;
      if (gh > 50) {
        const gx = 46, gw = w - gx - 16, rMax = 10, aMax = fps / (2 * K);
        const GX = (r) => gx + (r / rMax) * gw, GY = (a) => gy + gh / 2 - (a / Math.max(aMax, 0.5)) * (gh / 2) * 0.9;
        ctx.fillStyle = rgba(C.bg, 0.35); ctx.fillRect(gx, gy, gw, gh);
        ctx.strokeStyle = rgba(C.ink, 0.2); ctx.beginPath(); ctx.moveTo(gx, Math.round(GY(0)) + 0.5); ctx.lineTo(gx + gw, Math.round(GY(0)) + 0.5); ctx.stroke();
        ctx.strokeStyle = rgba(C.ink, 0.25); ctx.setLineDash([3, 4]); ctx.beginPath(); ctx.moveTo(gx, GY(0)); ctx.lineTo(GX(Math.min(rMax, aMax)), GY(Math.min(rMax, aMax))); ctx.stroke(); ctx.setLineDash([]);
        ctx.strokeStyle = C.ink; ctx.lineWidth = 2; ctx.beginPath();
        let prev = null;
        for (let px = 0; px <= gw; px += 1) {
          const r = (px / gw) * rMax, a = apparent(r), y = GY(a);
          if (prev != null && Math.abs(y - prev) > gh * 0.5) ctx.moveTo(gx + px, y); else px ? ctx.lineTo(gx + px, y) : ctx.moveTo(gx, y);
          prev = y;
        }
        ctx.stroke();
        if (gh > 90) V.text(ctx, "görünen", gx - 6, gy + 12, { color: C.muted, size: 10.5, align: "right" });
        V.text(ctx, "ileri", gx - 6, GY(aMax * 0.6) + 4, { color: C.muted, size: 10.5, align: "right" });
        V.text(ctx, "geri", gx - 6, GY(-aMax * 0.6) + 4, { color: C.muted, size: 10.5, align: "right" });
        for (let r = 0; r < rMax; r += 2) V.text(ctx, r + "", GX(r), gy + gh + 14, { color: C.muted, size: 10.5, align: "center" });
        V.text(ctx, "tur/sn", gx + gw, gy + gh + 14, { color: C.muted, size: 10.5, align: "right" });
        V.needle(ctx, GX(rps), gy, gh);
        V.dot(ctx, GX(rps), GY(apparent(rps)), 5, C.needle, 8);
      }
    }
    const st = canvas(cv, () => draw(1 / 60));
    const lp = loop((dt) => {
      ang += TAU * rps * dt;
      frameAcc += dt * fps;
      while (frameAcc >= 1) {
        frameAcc -= 1;
        camAng += TAU * apparentStepTrue();
        frames.push(camAng); if (frames.length > 12) frames.shift();
      }
      draw(dt);
    });
    // kamera gerçek açıyı örnekler; çizim K kollu olduğundan göze görünen hareket kendiliğinden katlanır
    function apparentStepTrue() { return rps / fps; }
    upd();
    for (let i = 0; i < 8; i++) { camAng += TAU * rps / fps; frames.push(camAng); }
    return { enter() { lp.start(); }, leave() { lp.stop(); if (stream) { stream.stop(); stream = null; listen.set(false); } } };
  };

  /* ================= 7. 100 MHz ================= */
  Demos.hundredMHz = function (stage, slide) {
    const cv = h("canvas", { "aria-label": "100 MHz dalga ve seyrek örnekler, veri hızı göstergesi ve dar bandı aşağı kaydırma ipucu" });
    const fill = h("div.fill", cv);
    const rS = readout("Örnekleme hızı"), rN = readout("Görülebilen en yüksek frekans"), rD = readout("Veri hızı", "cr"), rM = readout("1 dakikalık kayıt");
    const ctrl = h("div.controls");
    stage.append(h("div.controls.top", h("div.readouts", rS, rN, rD, rM)), fill, ctrl);

    const F = 100e6;
    let fs = 250e6, bits = 8, stream = null, shift = 0, shiftTo = 0, aph = 0, tick = 0;
    const sS = L.slider({ label: "Örnekleme hızı", min: 1e6, max: 1e9, value: fs, log: true, fmt: rate, oninput: (v) => { fs = v; upd(); }, cls: "cr", width: "min(220px, 40vw)" });
    const sB = L.slider({ label: "Bit derinliği", min: 8, max: 16, step: 1, value: bits, fmt: (v) => Math.round(v) + " bit", oninput: (v) => { bits = Math.round(v); upd(); }, width: "min(120px, 30vw)" });
    const rtlB = h("button.btn", { type: "button", onclick: () => { fs = 2.4e6; sS.set(fs); upd(); } }, "RTL-SDR hızı");
    const hintB = L.toggle("İpucu: aşağı kaydır", false, (on) => { shiftTo = on ? 1 : 0; });
    const listen = L.toggle("Dinle", false, (on) => {
      if (on) stream = Sound.stream(slide, fillAudio, { gain: 0.5 });
      else if (stream) { stream.stop(); stream = null; }
    });
    ctrl.append(sS, sB, rtlB, hintB, listen);

    const alias = () => F - fs * Math.round(F / fs);
    function upd() {
      rS.v.textContent = rate(fs);
      rN.v.textContent = hz(fs / 2, 3);
      rN.classList.toggle("bad", fs / 2 < F);
      const Bps = (fs * bits) / 8;
      rD.v.textContent = bytesPS(Bps);
      rM.v.textContent = bytes(Bps * 60);
    }
    // ses: örneklerin çizdiği dalga, 100.000 kat yavaşlatılmış (100 MHz → 1000 Hz)
    function fillAudio(out, ar) {
      const fa = Math.abs(alias()) / 1e5;
      const g = fa < 20 ? 0 : 0.3;
      for (let i = 0; i < out.length; i++) { aph += TAU * fa / ar; if (aph > TAU) aph -= TAU; out[i] = g * Math.sin(aph); }
    }

    // log ölçekli yarım daire gösterge (B/sn)
    const G0 = 5, G1 = 10.5; // 100 kB/sn … 30 GB/sn
    function gauge(ctx, cx, cy, R, val) {
      const A = (v) => Math.PI + ((Math.log10(v) - G0) / (G1 - G0)) * Math.PI;
      ctx.save();
      ctx.fillStyle = rgba(C.bg, 0.5); ctx.beginPath(); ctx.arc(cx, cy, R + 14, Math.PI, 0); ctx.closePath(); ctx.fill();
      // sınır bölgeleri
      const zone = (a, b, c) => { ctx.strokeStyle = c; ctx.lineWidth = 7; ctx.beginPath(); ctx.arc(cx, cy, R - 4, A(a), A(b)); ctx.stroke(); };
      zone(1e5, 60e6, rgba(C.ink, 0.18));
      zone(60e6, 625e6, rgba(C.ink, 0.08));
      ctx.strokeStyle = rgba(C.ink, 0.7); ctx.lineWidth = 1;
      for (let e = G0; e <= G1 + 1e-9; e += 0.5) {
        const a = Math.PI + ((e - G0) / (G1 - G0)) * Math.PI, maj = Math.abs(e - Math.round(e)) < 1e-6;
        ctx.beginPath(); ctx.moveTo(cx + Math.cos(a) * R, cy + Math.sin(a) * R); ctx.lineTo(cx + Math.cos(a) * (R - (maj ? 12 : 6)), cy + Math.sin(a) * (R - (maj ? 12 : 6))); ctx.stroke();
        if (maj && e % 1 === 0 && (e - 5) % 1 === 0) {
          const lab = bytesPS(10 ** e).replace("/sn", "");
          V.text(ctx, lab, cx + Math.cos(a) * (R + 8), cy + Math.sin(a) * (R + 8) + 4, { color: C.ink2, size: 11, align: a < Math.PI * 1.45 ? "right" : a > Math.PI * 1.55 ? "left" : "center", font: FONT.display, weight: 600 });
        }
      }
      // işaretler
      [[4.8e6, "RTL-SDR"], [60e6, "USB 2.0"], [625e6, "USB 3.0"]].forEach(([v, n]) => {
        const a = A(v);
        ctx.strokeStyle = rgba(C.ink, 0.9); ctx.lineWidth = 2; ctx.beginPath();
        ctx.moveTo(cx + Math.cos(a) * (R - 18), cy + Math.sin(a) * (R - 18)); ctx.lineTo(cx + Math.cos(a) * (R - 26), cy + Math.sin(a) * (R - 26)); ctx.stroke();
        V.text(ctx, n, cx + Math.cos(a) * (R - 40), cy + Math.sin(a) * (R - 40) + 4, { color: C.ink, size: 11, align: "center", weight: 700 });
      });
      // ibre
      const a = A(clamp(val, 10 ** G0, 10 ** G1));
      ctx.strokeStyle = rgba(C.bg, 0.8); ctx.lineWidth = 5; ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(cx + Math.cos(a) * (R - 6), cy + Math.sin(a) * (R - 6)); ctx.stroke();
      ctx.strokeStyle = C.needle; ctx.lineWidth = 2.2; ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(cx + Math.cos(a) * (R - 6), cy + Math.sin(a) * (R - 6)); ctx.stroke();
      V.dot(ctx, cx, cy, 6, C.needle, 10);
      V.text(ctx, bytesPS(val), cx, cy + 26, { color: C.needle, size: 20, align: "center", font: FONT.display, weight: 800 });
      ctx.restore();
    }

    let shownGv = 0;
    function draw() {
      const { ctx, w, h: H } = st;
      if (!w) return;
      ctx.fillStyle = C.stage; ctx.fillRect(0, 0, w, H);
      const narrow = w < 560;
      const pad = 16, x0 = pad, pw = w - 2 * pad;
      const wY = 30, wH = Math.round(H * (narrow ? 0.3 : 0.4));
      // zaman penceresi: en az 6 periyot ya da 14 örnek
      const Tw = Math.max(6 / F, 14 / fs), Y = (v) => wY + wH / 2 - v * wH * 0.4;
      const cycles = Tw * F;
      ctx.fillStyle = rgba(C.bg, 0.3); ctx.fillRect(x0, wY, pw, wH);
      if (cycles > pw / 3) {
        // salınım piksel başına birden çok: dolu bant olarak çiz
        ctx.fillStyle = rgba(C.ink, 0.22); ctx.fillRect(x0, Y(1), pw, Y(-1) - Y(1));
        ctx.strokeStyle = rgba(C.ink, 0.4); ctx.beginPath(); ctx.moveTo(x0, Y(1)); ctx.lineTo(x0 + pw, Y(1)); ctx.moveTo(x0, Y(-1)); ctx.lineTo(x0 + pw, Y(-1)); ctx.stroke();
      } else {
        ctx.strokeStyle = rgba(C.ink, 0.55); ctx.lineWidth = 1.3; ctx.beginPath();
        for (let px = 0; px <= pw; px += 0.5) { const y = Y(Math.cos(TAU * F * (px / pw) * Tw + tick)); px ? ctx.lineTo(x0 + px, y) : ctx.moveTo(x0, y); }
        ctx.stroke();
      }
      const a = alias(), over = fs / 2 < F;
      if (over) {
        ctx.strokeStyle = ALIAS; ctx.lineWidth = 2.4; ctx.beginPath();
        for (let px = 0; px <= pw; px += 2) { const y = Y(Math.cos(TAU * a * (px / pw) * Tw + tick)); px ? ctx.lineTo(x0 + px, y) : ctx.moveTo(x0, y); }
        ctx.stroke();
      }
      const ns = Math.floor(Tw * fs);
      for (let k = 0; k <= ns; k++) {
        const t = k / fs, px = x0 + (t / Tw) * pw, y = Y(Math.cos(TAU * F * t + tick));
        V.dot(ctx, px, y, 4.5, C.ink, 6);
      }
      const tw = Tw >= 1e-6 ? trim(num(Tw * 1e6, 2)) + " µs" : trim(num(Tw * 1e9, 0)) + " ns";
      V.text(ctx, `100 MHz dalga · ${tw} içinde ${num(Math.round(cycles))} salınım, ${num(ns + 1)} örnek`, x0, 18, { color: C.ink2, size: 12 });
      if (over) V.text(ctx, `örnekler ${hz(Math.abs(a), 3)}'lik sahte dalga çiziyor`, x0 + pw, 18, { color: ALIAS, size: 12, align: "right", weight: 700 });
      // gösterge
      const gTop = wY + wH + (narrow ? 22 : 30);
      const gw = narrow ? pw : pw * 0.42, gR = Math.min(gw * 0.42, (H - gTop) * (narrow ? 0.36 : 0.62) - 22);
      const gcx = x0 + gw / 2, gcy = gTop + gR + 34;
      const tgt = (fs * bits) / 8;
      shownGv = shownGv ? Math.exp(Math.log(shownGv) + (Math.log(tgt) - Math.log(shownGv)) * 0.15) : tgt;
      gauge(ctx, gcx, gcy, gR, shownGv);
      V.text(ctx, "veri hızı (gerçek örnekler, sıkıştırmasız)", gcx, gTop + 2, { color: C.ink2, size: 12, align: "center" });
      // ipucu: dar bandı 0 Hz'e kaydır
      const sx = narrow ? x0 : x0 + gw + 24, sw = narrow ? pw : pw - gw - 24;
      const sy = narrow ? gcy + 52 : gTop + 14, sh = narrow ? H - sy - 30 : H - sy - 34;
      if (sh > 60) {
        V.text(ctx, "ilgilendiğimiz istasyon: 200 kHz genişliğinde dar bir şerit", sx, sy - 4, { color: C.ink2, size: 12 });
        const by = sy + 8, bh = sh - 26;
        ctx.fillStyle = rgba(C.bg, 0.35); ctx.fillRect(sx, by, sw, bh);
        const fMax = 110e6, u = L.ease(shift);
        const SX = (f) => sx + (f / fMax) * sw;
        // spektrum: gürültü tabanı + istasyon (kaydırılınca 0 Hz'e yanaşır)
        const n = 400, db = new Float32Array(n), off = u * F, rr = DSP.rng(7);
        for (let i = 0; i < n; i++) {
          const f = (i / n) * fMax;
          let p = 10 ** (-9) * (0.6 + rr() * 0.8);
          [[F, 1e-4, 0.12e6], [F - 3.1e6, 2e-5, 0.1e6], [F + 4.4e6, 4e-5, 0.1e6], [94.6e6, 3e-5, 0.1e6]].forEach(([c, A, s]) => {
            const fc = c - off;
            if (Math.abs(f - fc) < 1.4e6) p += A * Math.exp(-(((f - fc) / Math.max(s, fMax / n * 1.2)) ** 2));
          });
          db[i] = 10 * Math.log10(p);
        }
        V.spectrum(ctx, { x: sx, y: by, w: sw, h: bh, db, min: -95, max: -30 });
        const tk = V.ticks(0, fMax, Math.max(3, Math.round(sw / 90)));
        tk.major.forEach((v) => V.text(ctx, trim(num(v / 1e6, 0)), SX(v), by + bh + 14, { color: C.muted, size: 10.5, align: "center" }));
        V.text(ctx, "MHz", sx + sw, by + bh + 14, { color: C.muted, size: 10.5, align: "right" });
        V.needle(ctx, SX(F - off), by, bh, u < 0.05 ? "100 MHz" : u > 0.95 ? "0 Hz" : "");
        if (u > 0.6) {
          const half = 1.2e6, xa = SX(0), xb = Math.max(SX(half), xa + 10);
          ctx.globalAlpha = (u - 0.6) / 0.4;
          ctx.fillStyle = rgba(C.ink, 0.12); ctx.fillRect(xa, by, xb - xa, bh);
          ctx.strokeStyle = C.ink; ctx.lineWidth = 1; ctx.strokeRect(Math.round(xa) + 0.5, by + 0.5, Math.round(xb - xa), bh - 1);
          const tx = xb + 10;
          V.text(ctx, "±1,2 MHz pencere: 2,4 MS/sn yeter", tx, by + 22, { color: C.ink, size: 13, weight: 700 });
          ctx.font = `700 13px ${FONT.body}`;
          const p1 = "ama her örnekte iki sayı: ";
          V.text(ctx, p1, tx, by + 42, { color: C.ink2, size: 13 });
          const w1 = ctx.measureText(p1).width;
          ctx.font = `400 13px ${FONT.body}`;
          const w1b = ctx.measureText(p1).width;
          V.text(ctx, "I", tx + w1b, by + 42, { color: C.I, size: 15, font: FONT.display, weight: 800 });
          V.text(ctx, "ve", tx + w1b + 10, by + 42, { color: C.ink2, size: 13 });
          V.text(ctx, "Q", tx + w1b + 30, by + 42, { color: C.Q, size: 15, font: FONT.display, weight: 800 });
          V.text(ctx, "2,4 MS/sn × 2 × 8 bit = 4,8 MB/sn", tx, by + 62, { color: C.ink2, size: 12 });
          ctx.globalAlpha = 1;
          void w1;
        }
      }
    }
    const st = canvas(cv, () => draw());
    const lp = loop((dt) => {
      tick += dt * 0.7;
      shift += clamp(shiftTo - shift, -dt * 0.6, dt * 0.6);
      draw();
    });
    upd();
    return { enter() { lp.start(); }, leave() { lp.stop(); if (stream) { stream.stop(); stream = null; listen.set(false); } } };
  };

  window.GUIDE_SCENARIOS = Object.assign(window.GUIDE_SCENARIOS || {}, {
    adc: [{ slide: "label:Bit derinliği", to: 1 }, { wait: 700 }, { slide: "label:Bit derinliği", to: 8 }],
    nyquist: [{ click: "Dinle" }, { click: "Süpür" }, { wait: 2600 }],
    "vagon-tekerlegi": [{ slide: "label:Tekerlek hızı", to: 4 }, { wait: 900 }, { slide: "label:Tekerlek hızı", to: 3.8 }],
    "100mhz": [{ click: "RTL-SDR hızı" }, { wait: 900 }, { click: "İpucu" }],
  });
})();

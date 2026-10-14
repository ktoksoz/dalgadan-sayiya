/* Sentezlenmiş ses kaynakları: demolarda modüle edilip yeniden çözülen "yayın içerikleri".
   Hepsi tarayıcıda üretilir; kayıt ya da telifli içerik yok.
   - melody: Beethoven, 9. Senfoni "Neşeye Övgü" teması (kamu malı), basit toplamsal sentez
   - voice: konuşmaya benzeyen hece zarflı, formantlı vızıltı (telsiz konuşması yerine)
   - morse: Mors işaret vericisi (bip)
   Her kaynak akış nesnesidir: next(out, rate) çağrıldıkça kesintisiz devam eder. */
(function () {
  const TAU = Math.PI * 2;
  // [nota, vuruş] — C majör, 0 = do (C4), yarım ses adımlı
  const N = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11, g: -5 };
  const ODE = [
    ["E", 1], ["E", 1], ["F", 1], ["G", 1], ["G", 1], ["F", 1], ["E", 1], ["D", 1],
    ["C", 1], ["C", 1], ["D", 1], ["E", 1], ["E", 1.5], ["D", 0.5], ["D", 2],
    ["E", 1], ["E", 1], ["F", 1], ["G", 1], ["G", 1], ["F", 1], ["E", 1], ["D", 1],
    ["C", 1], ["C", 1], ["D", 1], ["E", 1], ["D", 1.5], ["C", 0.5], ["C", 2],
    ["D", 1], ["D", 1], ["E", 1], ["C", 1], ["D", 1], ["E", 0.5], ["F", 0.5], ["E", 1], ["C", 1],
    ["D", 1], ["E", 0.5], ["F", 0.5], ["E", 1], ["D", 1], ["C", 1], ["D", 1], ["g", 2],
    ["E", 1], ["E", 1], ["F", 1], ["G", 1], ["G", 1], ["F", 1], ["E", 1], ["D", 1],
    ["C", 1], ["C", 1], ["D", 1], ["E", 1], ["D", 1.5], ["C", 0.5], ["C", 2], [null, 2],
  ];
  const TIMBRES = {
    // [harmonik genlikleri], atak, sönüm
    flute: { h: [1, 0.25, 0.08, 0.03], a: 0.03, d: 0.25 },
    organ: { h: [1, 0.6, 0.4, 0.25, 0.15, 0.1], a: 0.01, d: 0.1 },
    pluck: { h: [1, 0.5, 0.33, 0.25, 0.2], a: 0.004, d: 2.4, pluck: true },
    pure: { h: [1], a: 0.02, d: 0.2 },
  };

  function melody({ bpm = 132, timbre = "flute", transpose = 0, base = 261.63, gain = 0.6 } = {}) {
    const T = TIMBRES[timbre];
    let idx = 0, t = 0, phase = 0;
    return {
      next(out, rate) {
        const beat = 60 / bpm;
        for (let i = 0; i < out.length; i++) {
          const [n, len] = ODE[idx], dur = len * beat;
          let v = 0;
          if (n != null) {
            const f = base * 2 ** ((N[n] + transpose) / 12);
            phase += TAU * f / rate;
            if (phase > TAU * 64) phase -= TAU * 64;
            let s = 0;
            for (let k = 0; k < T.h.length; k++) s += T.h[k] * Math.sin((k + 1) * phase);
            // zarf: atak, gövde, notanın sonunda kısa bırakma
            const rel = Math.min(1, (dur - t) / 0.05);
            let env = Math.min(1, t / T.a) * Math.max(0, rel);
            if (T.pluck) env *= Math.exp(-t * T.d);
            else env *= 0.85 + 0.15 * Math.exp(-t / T.d);
            v = s * env / (T.h.reduce((a, b) => a + b, 0) * 0.8);
          }
          out[i] = v * gain;
          t += 1 / rate;
          if (t >= dur) { t = 0; idx = (idx + 1) % ODE.length; }
        }
        return out;
      },
      reset() { idx = 0; t = 0; phase = 0; },
    };
  }

  // Konuşmaya benzeyen ses: 3–6 Hz hece zarfı, kayan perde, iki formant (basit rezonatörler)
  function voice({ pitch = 120, seed = 7, gain = 0.55 } = {}) {
    const r = DSP.rng(seed);
    let ph = 0, t = 0, syl = 0, sylLen = 0.2, pause = false, f1 = 600, f2 = 1400, pf = pitch;
    const res = [[0, 0], [0, 0]];
    function newSyl() {
      pause = r() < 0.18;
      sylLen = pause ? 0.15 + r() * 0.35 : 0.12 + r() * 0.2;
      f1 = 300 + r() * 500; f2 = 900 + r() * 1400; pf = pitch * (0.85 + r() * 0.35);
      t = 0;
    }
    newSyl();
    return {
      next(out, rate) {
        for (let i = 0; i < out.length; i++) {
          ph += TAU * pf / rate; if (ph > TAU) ph -= TAU;
          // testere dişi kaynak
          const src = ph / Math.PI - 1;
          // iki rezonatör (durum değişkenli, Q ~ 6)
          let y = 0;
          [f1, f2].forEach((fc, k) => {
            const w = 2 * Math.sin(Math.PI * fc / rate), q = 1 / 6, s = res[k];
            s[0] += w * s[1];                       // alçak
            const hp = src - s[0] - q * s[1];
            s[1] += w * hp;                         // bant
            y += s[1] * (k ? 0.6 : 1);
          });
          const e = pause ? 0 : Math.sin(Math.PI * Math.min(1, t / sylLen)) ** 0.7;
          out[i] = y * e * gain * 0.35;
          t += 1 / rate;
          if (t >= sylLen) newSyl();
        }
        return out;
      },
    };
  }

  // Mors kodu: "CQ" benzeri tekrarlayan işaret; birim süre 60 ms
  const MORSE = { S: "...", D: "-..", R: ".-.", T: "-", A: ".-", Y: "-.--", I: "..", N: "-.", C: "-.-.", Q: "--.-" };
  function morse({ text = "SDR", freq = 700, unit = 0.07, gain = 0.5 } = {}) {
    const seq = [];
    text.split("").forEach((ch, ci) => {
      (MORSE[ch] || "").split("").forEach((s, k) => { seq.push([1, s === "." ? 1 : 3]); seq.push([0, 1]); });
      seq.push([0, 2]);
    });
    seq.push([0, 7]);
    let idx = 0, t = 0, ph = 0, amp = 0;
    return {
      next(out, rate) {
        for (let i = 0; i < out.length; i++) {
          const [on, len] = seq[idx];
          amp += ((on ? 1 : 0) - amp) * Math.min(1, 400 / rate); // yumuşak açılıp kapanma
          ph += TAU * freq / rate;
          out[i] = Math.sin(ph) * amp * gain;
          t += 1 / rate;
          if (t >= len * unit) { t = 0; idx = (idx + 1) % seq.length; }
        }
        return out;
      },
      // şu an taşıyıcı açık mı (görsel için)
      get on() { return seq[idx][0] === 1; },
    };
  }

  // Beyaz gürültü (parazit sesi)
  function hiss({ seed = 3, gain = 0.25 } = {}) {
    const r = DSP.rng(seed);
    let lp = 0;
    return { next(out) { for (let i = 0; i < out.length; i++) { lp += 0.6 * ((r() * 2 - 1) - lp); out[i] = lp * gain; } return out; } };
  }

  // Tek seferlik tampon üret (ör. modülasyon demosu için birkaç saniye)
  function render(src, seconds, rate) { return src.next(new Float32Array(Math.round(seconds * rate)), rate); }

  window.Music = { melody, voice, morse, hiss, render, ODE };
})();

/* DSP birim testleri. Çalıştırma: node tests/dsp.test.js */
const assert = require("node:assert/strict");
const D = require("../js/dsp.js");

let pass = 0, fail = 0;
function test(name, fn) {
  try { fn(); pass++; console.log("  ✓ " + name); }
  catch (e) { fail++; console.log("  ✗ " + name + "\n    " + e.message); }
}
const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg || ""} beklenen ${b} ± ${tol}, bulunan ${a}`);
const argmax = (a) => a.reduce((bi, v, i) => (v > a[bi] ? i : bi), 0);
// gerçek sinyali karmaşık (Q = 0) iç içe biçime çevir
const realToIQ = (x) => { const o = new Float32Array(2 * x.length); x.forEach((v, i) => (o[2 * i] = v)); return o; };
// gerçek sinyalin belirli frekanstaki genliği (tek kutu DFT)
function toneAmp(x, f) { let re = 0, im = 0; for (let i = 0; i < x.length; i++) { re += x[i] * Math.cos(D.TAU * f * i); im -= x[i] * Math.sin(D.TAU * f * i); } return (2 * Math.hypot(re, im)) / x.length; }

console.log("FFT");
test("bilinen ton doğru kutuya düşer (+ ve − frekans)", () => {
  const n = 1024;
  for (const k of [37, -200, 0, 511]) {
    const s = D.spectrum(D.tone(n, k / n), n, { window: "rect" });
    assert.equal(argmax(s), k + n / 2, `ton ${k}`);
  }
});
test("tam ölçekli ton her pencerede 0 dBFS verir", () => {
  const n = 2048, f = 300 / n;
  for (const w of ["rect", "hann", "hamming", "blackman"]) near(D.spectrum(D.tone(n, f), n, { window: w })[300 + n / 2], 0, 0.01, w);
});
test("ileri + ters FFT girdiyi geri verir", () => {
  const n = 256, r = D.rng(3), re = new Float64Array(n), im = new Float64Array(n);
  for (let i = 0; i < n; i++) { re[i] = r() - 0.5; im[i] = r() - 0.5; }
  const re0 = re.slice(), im0 = im.slice();
  D.fft(re, im); D.fft(re, im, true);
  for (let i = 0; i < n; i++) { near(re[i], re0[i], 1e-12); near(im[i], im0[i], 1e-12); }
});
test("Parseval: zaman ve frekans enerjisi eşit", () => {
  const n = 512, r = D.rng(9), re = new Float64Array(n), im = new Float64Array(n);
  for (let i = 0; i < n; i++) { re[i] = r() - 0.5; im[i] = r() - 0.5; }
  let et = 0; for (let i = 0; i < n; i++) et += re[i] ** 2 + im[i] ** 2;
  D.fft(re, im);
  let ef = 0; for (let i = 0; i < n; i++) ef += re[i] ** 2 + im[i] ** 2;
  near(ef / n, et, 1e-9);
});
test("kutular arası tonda Hann sızıntısı dikdörtgenden çok daha az", () => {
  const n = 1024, x = D.tone(n, 100.5 / n);
  const far = (s) => s[n / 2 + 300];
  const rect = far(D.spectrum(x, n, { window: "rect" })), hann = far(D.spectrum(x, n, { window: "hann" }));
  assert.ok(rect > -60 && hann < -100, `dikdörtgen ${rect.toFixed(1)} dB, Hann ${hann.toFixed(1)} dB`);
});
test("yalnızca I (Q = 0): spektrumda ±f ayna görüntüsü eşit", () => {
  const n = 1024, x = D.tone(n, 64 / n);
  for (let i = 0; i < n; i++) x[2 * i + 1] = 0;
  const s = D.spectrum(x, n, { window: "rect" });
  near(s[n / 2 + 64], s[n / 2 - 64], 1e-6);
  near(s[n / 2 + 64], -6.02, 0.01); // genliğin yarısı ±f'ye bölünür
});

console.log("NCO ve karıştırıcı");
test("karıştırıcı spektrumu kaydırır", () => {
  const n = 1024, x = D.tone(n, 150 / n), y = D.mix(x, -150 / n);
  assert.equal(argmax(D.spectrum(y, n, { window: "rect" })), n / 2);
});
test("NCO parçalar halinde üretince faz sürekli", () => {
  const nco = new D.NCO(0.0123), a = nco.tone(100), b = nco.tone(100), whole = D.tone(200, 0.0123);
  for (let i = 0; i < 200; i++) near(i < 100 ? a[i * 2] : b[(i - 100) * 2], whole[i * 2], 1e-5);
});

console.log("FIR filtre");
test("alçak geçiren filtre: geçiş bandı 0 dB, kesimde −6 dB, durdurma bandı < −70 dB", () => {
  const h = D.firLowpass(129, 0.1);
  const H = D.freqResponse(h, 1001); // k ↔ f = 0.5k/1000
  near(H[0], 0, 0.01, "0 Hz");
  near(H[160], 0, 0.1, "f = 0.08");
  near(H[200], -6.02, 0.3, "f = 0.1 (kesim)");
  assert.ok(Math.max(...H.slice(260)) < -70, "durdurma bandı");
});
test("filtre uygulaması tonları ayırır", () => {
  const n = 4096, a = D.tone(n, 0.02), b = D.tone(n, 0.3), x = a.map((v, i) => v + b[i]);
  const y = D.filter(x, D.firLowpass(101, 0.1));
  const tail = y.slice(2 * 200); // geçici rejimi at
  const s = D.spectrum(tail, 2048, { window: "hann" });
  near(s[1024 + Math.round(0.02 * 2048)], 0, 0.2, "geçen ton");
  assert.ok(s[1024 + Math.round(0.3 * 2048)] < -70, "bastırılan ton");
});
test("parçalı FIR, tek seferlik FIR ile aynı", () => {
  const h = D.firLowpass(31, 0.2), x = D.tone(300, 0.07), whole = D.filter(x, h);
  const f = new D.FIR(h), p = [f.process(x.slice(0, 2 * 77)), f.process(x.slice(2 * 77))];
  const joined = new Float32Array(600); joined.set(p[0]); joined.set(p[1], 154);
  for (let i = 0; i < 600; i++) near(joined[i], whole[i], 1e-5);
});
test("RRC filtresi birim enerjili ve simetrik", () => {
  const h = D.rrc(8, 8, 0.35);
  near(h.reduce((s, v) => s + v * v, 0), 1, 1e-6);
  for (let i = 0; i < h.length; i++) near(h[i], h[h.length - 1 - i], 1e-6);
});

console.log("Bant geçiren / durduran");
test("karmaşık bant geçiren: yalnızca +f0 geçer, −f0 bastırılır", () => {
  const h = D.firBandpass(129, 0.2, 0.06), H = D.freqResponseC(h, 1001); // k ↔ f = −0.5 + k/1000
  const at = (f) => H[Math.round((f + 0.5) * 1000)];
  near(at(0.2), 0, 0.05, "+f0"); near(at(0.19), 0, 0.1, "geçiş bandı, kenardan 0,02 içeride");
  near(at(0.23), -6.02, 0.4, "kesim (f0 + bw/2)");
  assert.ok(at(-0.2) < -70, "−f0 " + at(-0.2)); assert.ok(at(0) < -70, "0 Hz");
});
test("gerçek bant geçiren: hem +f0 hem −f0 geçer (ayna)", () => {
  const H = D.freqResponseC(D.firBandpassReal(129, 0.2, 0.06), 1001), at = (f) => H[Math.round((f + 0.5) * 1000)];
  near(at(0.2), 0, 0.05, "+f0"); near(at(-0.2), 0, 0.05, "−f0"); assert.ok(at(0) < -70);
});
test("bant durduran: f0'ı bastırır, gerisini geçirir", () => {
  const H = D.freqResponseC(D.firBandstop(129, -0.1, 0.05), 1001), at = (f) => H[Math.round((f + 0.5) * 1000)];
  assert.ok(at(-0.1) < -60, "çentik " + at(-0.1)); near(at(0.2), 0, 0.05); near(at(-0.3), 0, 0.05);
});
test("karmaşık FIR uygulaması istasyon seçer", () => {
  const n = 8192, a = D.tone(n, 0.2), b = D.tone(n, -0.2), c = D.tone(n, 0.05), x = a.map((v, i) => v + b[i] + c[i]);
  const f = new D.CFIR(D.firBandpass(129, 0.2, 0.06)), y = f.process(x.slice(0, 4000));
  const y2 = f.process(x.slice(4000)), all = new Float32Array(x.length); all.set(y); all.set(y2, 4000);
  const s = D.spectrum(all.slice(2 * 500, 2 * (500 + 4096)), 4096, { window: "blackman" });
  near(s[2048 + Math.round(0.2 * 4096)], 0, 0.2, "+0,2");
  assert.ok(s[2048 - Math.round(0.2 * 4096)] < -60 && s[2048 + Math.round(0.05 * 4096)] < -60, "diğerleri");
});

console.log("Azaltma");
test("azaltma sonrası ton yeni hızda doğru frekansta", () => {
  const n = 8192, M = 4, x = D.tone(n, 0.03), y = D.decimate(x, M);
  assert.equal(y.length, 2 * (n / M));
  const s = D.spectrum(y.slice(2 * 100, 2 * (100 + 1024)), 1024, { window: "hann" });
  assert.equal(argmax(s), 512 + Math.round(0.03 * M * 1024));
});
test("azaltma, bant dışındaki tonun geri katlanmasını engeller", () => {
  const n = 8192, M = 4, x = D.tone(n, 0.3), y = D.decimate(x, M); // 0.3 → katlansa 0.2 olurdu
  let p = 0; const t = y.slice(400); for (let i = 0; i < t.length; i++) p += t[i] ** 2;
  assert.ok(10 * Math.log10(p / (t.length / 2)) < -50);
});

console.log("Demodülasyon");
test("FM demodülatör bilinen tonu geri çıkarır", () => {
  const fs = 48000, n = 48000, f = 1000, dev = 5000 / fs;
  const audio = new Float32Array(n).map((_, i) => Math.sin((D.TAU * f * i) / fs));
  const out = D.fmDemod(D.fmMod(audio, dev));
  near(toneAmp(out.slice(1), f / fs), dev, dev * 0.01, "çıkan tonun genliği = sapma");
  let err = 0; for (let i = 1; i < n; i++) err = Math.max(err, Math.abs(out[i] / dev - audio[i]));
  assert.ok(err < 1e-3, "dalga biçimi hatası " + err);
});
test("AM demodülatör bilinen tonu geri çıkarır", () => {
  const fs = 48000, n = 4800, f = 500, m = 0.6;
  const audio = new Float32Array(n).map((_, i) => Math.cos((D.TAU * f * i) / fs));
  const iq = D.mix(D.amMod(audio, m), 0.1); // taşıyıcı 0 Hz'de olmasın: zarf yine aynı
  const out = D.amDemod(iq);
  near(toneAmp(out, f / fs), m / (1 + m), 0.002);
});

console.log("Dijital modülasyon");
test("takımyıldızların ortalama enerjisi 1", () => {
  for (const [k, c] of Object.entries(D.CONST)) near(c.pts.reduce((s, [i, q]) => s + i * i + q * q, 0) / c.pts.length, 1, 1e-9, k);
});
test("Gray kodlama: komşu noktalar tek bit farklı (16-QAM, 8-PSK)", () => {
  const pop = (x) => x.toString(2).split("1").length - 1;
  for (const k of ["qam16", "psk8", "qpsk"]) {
    const P = D.CONST[k].pts;
    const dmin = Math.min(...P.flatMap((a, i) => P.map((b, j) => (i === j ? Infinity : Math.hypot(a[0] - b[0], a[1] - b[1])))));
    P.forEach((a, i) => P.forEach((b, j) => {
      if (i !== j && Math.abs(Math.hypot(a[0] - b[0], a[1] - b[1]) - dmin) < 1e-9) assert.equal(pop(i ^ j), 1, `${k} ${i}-${j}`);
    }));
  }
});
test("gürültüsüz kanalda metin bit bit geri gelir", () => {
  const msg = "Merhaba, ğüşıöç! 73";
  for (const k of ["bpsk", "qpsk", "psk8", "qam16", "ask"]) {
    let bits = D.textToBits(msg);
    const pad = (D.CONST[k].bits - (bits.length % D.CONST[k].bits)) % D.CONST[k].bits;
    bits = Uint8Array.from([...bits, ...new Array(pad).fill(0)]);
    assert.equal(D.bitsToText(D.demapSymbols(D.mapBits(bits, k), k).slice(0, bits.length - pad)), msg, k);
  }
});
test("AWGN gücü istenen SNR'ı verir", () => {
  const n = 200000, x = D.tone(n, 0.01), y = D.awgn(x, 10, D.rng(5));
  let pn = 0; for (let i = 0; i < y.length; i++) pn += (y[i] - x[i]) ** 2;
  near(10 * Math.log10(1 / (pn / n)), 10, 0.1);
});
test("ölçülen BER kuramsal eğriyle uyuşur", () => {
  const r = D.rng(11);
  for (const [k, snr] of [["bpsk", 4], ["qpsk", 7], ["qam16", 14], ["psk8", 12], ["ask", 7]]) {
    const nb = D.CONST[k].bits * 100000, bits = new Uint8Array(nb).map(() => (r() < 0.5 ? 1 : 0));
    const rx = D.demapSymbols(D.awgn(D.mapBits(bits, k), snr, r, 1), k);
    let e = 0; for (let i = 0; i < nb; i++) e += rx[i] !== bits[i];
    const ber = e / nb, th = D.berTheory(k, snr);
    assert.ok(Math.abs(Math.log10(ber) - Math.log10(th)) < 0.12, `${k} @ ${snr} dB: ölçülen ${ber.toExponential(2)}, kuram ${th.toExponential(2)}`);
  }
});
test("erfc bilinen değerler", () => {
  near(D.erfc(0), 1, 1e-6); near(D.erfc(1), 0.157299, 1e-6); near(D.erfc(2), 0.004678, 1e-6); near(D.erfc(-1), 1.842701, 1e-6);
});

console.log("Dosya okuyucular");
test("cu8: 127,5 merkezli baytlar −1 … 1'e çözülür", () => {
  const ab = Uint8Array.from([255, 0, 127, 128]).buffer, x = D.readers.cu8(ab);
  near(x[0], 1, 1e-6); near(x[1], -1, 1e-6); near(x[2], -0.5 / 127.5, 1e-6); near(x[3], 0.5 / 127.5, 1e-6);
});
test("cs8, cs16 ve cf32 okuyucular", () => {
  assert.deepEqual([...D.readers.cs8(Int8Array.from([-128, 64]).buffer)], [-1, 0.5]);
  assert.deepEqual([...D.readers.cs16(Int16Array.from([-32768, 16384]).buffer)], [-1, 0.5]);
  assert.deepEqual([...D.readers.cf32(Float32Array.from([0.25, -0.75]).buffer)], [0.25, -0.75]);
});
test("cu8 dosyası üret, oku: ton aynı frekansta", () => {
  const n = 1024, x = D.tone(n, 100 / n, 0.9), u = new Uint8Array(2 * n);
  for (let i = 0; i < 2 * n; i++) u[i] = Math.max(0, Math.min(255, Math.round(x[i] * 127.5 + 127.5)));
  const y = D.readIQ(u.buffer, "cu8");
  assert.equal(argmax(D.spectrum(y, n, { window: "hann" })), 100 + n / 2);
});
test("SigMF meta verisi okunur", () => {
  const m = D.parseSigMF({ global: { "core:datatype": "ci16_le", "core:sample_rate": 2048000 }, captures: [{ "core:sample_start": 0, "core:frequency": 100.1e6 }] });
  assert.equal(m.format, "cs16"); assert.equal(m.sampleRate, 2048000); assert.equal(m.centerFreq, 100.1e6);
});
test("dosya adından biçim", () => {
  assert.equal(D.formatFromName("kayit.cu8"), "cu8"); assert.equal(D.formatFromName("a.CS8"), "cs8");
  assert.equal(D.formatFromName("x.cf32"), "cf32"); assert.equal(D.formatFromName("x.wav"), null);
});

console.log(`\n${pass} geçti, ${fail} kaldı`);
process.exit(fail ? 1 : 0);

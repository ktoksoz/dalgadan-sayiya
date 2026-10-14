/* Sentetik bant + alıcı testleri. Çalıştırma: node tests/signals.test.js */
const assert = require("node:assert/strict");
const fs = require("fs"), path = require("path"), vm = require("vm");
const ctx = { Math, Float32Array, Float64Array, Uint8Array, Array, Object, console };
ctx.self = ctx; ctx.window = ctx;
vm.createContext(ctx);
for (const f of ["dsp.js", "music.js", "signals.js"]) vm.runInContext(fs.readFileSync(path.join(__dirname, "../js", f), "utf8").replace("module.exports", "module_exports_disabled"), ctx);
const { DSP: D, Music, Signals } = ctx;
let pass = 0, fail = 0;
function test(name, fn) { try { fn(); pass++; console.log("  ✓ " + name); } catch (e) { fail++; console.log("  ✗ " + name + "\n    " + e.message); } }
const corr = (a, b) => { let ab = 0, aa = 0, bb = 0; for (let i = 0; i < a.length; i++) { ab += a[i] * b[i]; aa += a[i] ** 2; bb += b[i] ** 2; } return ab / Math.sqrt(aa * bb); };
function toneAmp(x, f) { let re = 0, im = 0; for (let i = 0; i < x.length; i++) { re += x[i] * Math.cos(2 * Math.PI * f * i); im -= x[i] * Math.sin(2 * Math.PI * f * i); } return (2 * Math.hypot(re, im)) / x.length; }
const toneSrc = (f) => { let p = 0; return { next(out, rate) { for (let i = 0; i < out.length; i++) { out[i] = Math.sin(p); p += 2 * Math.PI * f / rate; } return out; } }; };

console.log("Sentetik bant");
test("istasyonlar spektrumda doğru frekansta ve güçte", () => {
  const b = new Signals.Band({ rate: 240000, noise: -80, stations: [{ f: 40000, mod: "carrier", power: -20 }, { f: -60000, mod: "carrier", power: -30 }] });
  const x = b.next(4096), s = D.spectrum(x, 4096, { window: "blackman" });
  const bin = (f) => 2048 + Math.round(f / 240000 * 4096);
  assert.ok(Math.abs(s[bin(40000)] + 20) < 1.5, "40 kHz " + s[bin(40000)]);
  assert.ok(Math.abs(s[bin(-60000)] + 30) < 1.5, "−60 kHz " + s[bin(-60000)]);
});
console.log("Alıcı");
for (const mode of ["nfm", "am", "wfm"]) test(`${mode}: komşu istasyon varken 1 kHz tonu geri çıkarır`, () => {
  const rate = 240000, f = 1000;
  const st = [{ f: 30000, mod: mode, power: -10, audio: toneSrc(f), dev: mode === "wfm" ? 50000 : 5000, m: 0.6 },
              { f: -40000, mod: "nfm", power: -10, audio: toneSrc(2700), dev: 5000 }];
  if (mode === "wfm") st[1].f = -100000;
  const b = new Signals.Band({ rate, noise: -60, stations: st });
  const rx = new Signals.Receiver({ rate, decim: 5, mode, tune: 30000, bw: mode === "wfm" ? 180000 : 14000, dev: st[0].dev });
  let audio = [];
  for (let k = 0; k < 20; k++) audio.push(...rx.process(b.next(4800)).audio);
  const a = Float32Array.from(audio.slice(9600)), ar = rate / 5;
  const want = toneAmp(a, f / ar), other = toneAmp(a, 2700 / ar);
  assert.ok(want > 0.1, "ton genliği " + want);
  assert.ok(other < want * 0.03, `komşu sızıntı ${other} / ${want}`);
});
test("AudioFifo farklı blok boylarını kesintisiz birleştirir", () => {
  let k = 0; const fifo = new Signals.AudioFifo(() => Float32Array.from({ length: 700 }, () => k++));
  const o1 = fifo.fill(new Float32Array(1000)), o2 = fifo.fill(new Float32Array(1000));
  assert.equal(o1[999], 999); assert.equal(o2[0], 1000); assert.equal(o2[999], 1999);
});
console.log(`\n${pass} geçti, ${fail} kaldı`);
process.exit(fail ? 1 : 0);

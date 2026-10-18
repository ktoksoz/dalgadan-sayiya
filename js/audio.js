/* Deney sesleri (Web Audio API).
   - Ses bağlamı ancak kullanıcı dokununca/tuşa basınca açılır (tarayıcı kuralı).
   - Demolar Sound.stream(slide, fill) ile kesintisiz ses akışı açar: fill(out) her blokta
     Float32Array'i doldurur. Bloklar küçük AudioBuffer'lar olarak ileriye planlanır; Worklet
     kullanılmaz, böylece file:// ile açınca da çalışır.
   - Anlatım çalarken demo sesleri kısılır. Alt çubukta sessize alma ve ses düzeyi vardır. */
(function () {
  const { h } = L;
  const RATE = 48000, BLOCK = 2048, AHEAD = 0.18;
  let ctx = null, master = null, duckGain = null;
  const streams = new Set();
  const store = {
    get(k, d) { try { const v = localStorage.getItem("sdr.ses." + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem("sdr.ses." + k, JSON.stringify(v)); } catch (e) {} },
  };
  let volume = store.get("duzey", 0.7), muted = store.get("sessiz", false), ducked = false;

  function ensure() {
    if (!ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      ctx = new AC();
      duckGain = ctx.createGain();
      master = ctx.createGain();
      // yumuşak sınırlayıcı: üst üste binen seslerde cızırtı olmasın
      const comp = ctx.createDynamicsCompressor();
      comp.threshold.value = -6; comp.ratio.value = 8; comp.attack.value = 0.003; comp.release.value = 0.15;
      duckGain.connect(master); master.connect(comp); comp.connect(ctx.destination);
      applyGain(true);
    }
    return ctx;
  }
  function applyGain(now) {
    if (!ctx) return;
    const t = ctx.currentTime;
    master.gain.setTargetAtTime(muted ? 0 : volume * volume, t, now ? 0.001 : 0.05);
    duckGain.gain.setTargetAtTime(ducked ? 0.12 : 1, t, 0.12);
  }
  const unlocked = () => ctx && ctx.state === "running";
  function unlock() {
    if (!ensure()) return;
    if (ctx.state !== "running") ctx.resume().then(updateHint, () => {});
    updateHint();
  }
  // gerçek kullanıcı hareketi ses bağlamını açar
  ["pointerdown", "keydown", "touchend"].forEach((t) => window.addEventListener(t, (e) => { if (e.isTrusted) unlock(); }, true));

  /* --- kesintisiz akış --- */
  class Stream {
    constructor(slide, fill, { rate = RATE, gain = 1 } = {}) {
      this.slide = slide; this.fill = fill; this.rate = rate; this.gain = gain;
      this.next = 0; this.timer = 0; this.nodes = [];
      this.out = null;
    }
    start() {
      streams.add(this);
      updateHint();
      if (!ensure()) return this;
      this.out = ctx.createGain(); this.out.gain.value = this.gain; this.out.connect(duckGain);
      this.timer = setInterval(() => this.pump(), 40);
      this.pump();
      return this;
    }
    pump() {
      if (!ctx || ctx.state !== "running") { this.next = 0; return; }
      if (this.next < ctx.currentTime) this.next = ctx.currentTime + 0.03;
      while (this.next < ctx.currentTime + AHEAD) {
        const buf = ctx.createBuffer(1, BLOCK, this.rate), data = buf.getChannelData(0);
        this.fill(data, this.rate);
        const src = ctx.createBufferSource();
        src.buffer = buf; src.connect(this.out); src.start(this.next);
        this.next += BLOCK / this.rate;
        this.nodes.push(src);
        src.onended = () => { const i = this.nodes.indexOf(src); if (i >= 0) this.nodes.splice(i, 1); };
      }
    }
    setGain(g) { this.gain = g; if (this.out && ctx) this.out.gain.setTargetAtTime(g, ctx.currentTime, 0.03); }
    stop() {
      clearInterval(this.timer);
      streams.delete(this);
      if (this.out && ctx) {
        const o = this.out, nodes = this.nodes.slice();
        o.gain.setTargetAtTime(0, ctx.currentTime, 0.02);
        setTimeout(() => { nodes.forEach((n) => { try { n.stop(); } catch (e) {} }); o.disconnect(); }, 120);
      }
      this.nodes = [];
      updateHint();
    }
  }

  /* Tek seferlik kısa ses (ör. "bip"): Float32Array örnekler */
  function play(samples, rate = RATE, gain = 1) {
    if (!ensure() || ctx.state !== "running") { flashHint(); return; }
    const buf = ctx.createBuffer(1, samples.length, rate);
    buf.getChannelData(0).set(samples);
    const src = ctx.createBufferSource(), g = ctx.createGain();
    g.gain.value = gain; src.buffer = buf; src.connect(g); g.connect(duckGain); src.start();
  }

  /* --- "Sesi açmak için dokunun" uyarısı --- */
  const hint = h("button#sound-hint", { type: "button", onclick: (e) => { e.stopPropagation(); unlock(); } },
    h("span", { html: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 10v4h4l5 4V6L8 10z" fill="currentColor"/><path d="M16.5 8.5a5 5 0 0 1 0 7" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>' }),
    "Sesi açmak için dokunun");
  document.body.append(hint);
  const activeStreams = () => [...streams].filter((s) => s.slide.classList.contains("active"));
  function updateHint() {
    const want = activeStreams().length > 0 && !unlocked();
    hint.classList.toggle("on", want);
  }
  let flashT = 0;
  function flashHint() {
    if (unlocked()) return;
    hint.classList.add("on");
    clearTimeout(flashT);
    flashT = setTimeout(updateHint, 3000);
  }

  // slayt değişince başka slayta ait akışları durdur
  window.addEventListener("slidechange", () => {
    [...streams].forEach((s) => { if (!s.slide.classList.contains("active")) s.stop(); });
    updateHint();
  });

  /* --- alt çubuktaki ses denetimi --- */
  const icon = (m) => m
    ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 10v4h4l5 4V6L8 10z"/><path d="M17 9l5 6M22 9l-5 6"/></svg>'
    : '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 10v4h4l5 4V6L8 10z"/><path d="M16.5 8.5a5 5 0 0 1 0 7M19 6a8.5 8.5 0 0 1 0 12"/></svg>';
  const muteBtn = h("button.iconbtn#btn-mute", { type: "button", title: "Sesi kapat / aç (M)", "aria-label": "Sesi kapat" });
  const vol = h("input#vol", { type: "range", min: 0, max: 1, step: 0.01, value: volume, "aria-label": "Ses düzeyi", title: "Ses düzeyi" });
  function renderMute() {
    muteBtn.innerHTML = icon(muted || volume === 0);
    muteBtn.setAttribute("aria-label", muted ? "Sesi aç" : "Sesi kapat");
    muteBtn.classList.toggle("on", muted);
    window.dispatchEvent(new CustomEvent("soundlevel", { detail: { volume, muted } }));
  }
  function setMuted(m) { muted = m; store.set("sessiz", m); applyGain(); renderMute(); }
  muteBtn.addEventListener("click", () => setMuted(!muted));
  vol.addEventListener("input", () => { volume = +vol.value; store.set("duzey", volume); if (muted && volume > 0) muted = false; applyGain(); renderMute(); });
  document.addEventListener("keydown", (e) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.target.matches && e.target.matches("input[type=text], textarea")) return;
    if (e.key === "m" || e.key === "M") setMuted(!muted);
  });
  const mount = () => {
    const slot = document.getElementById("sound-slot");
    if (slot) slot.append(muteBtn, vol);
    renderMute();
  };
  document.readyState === "loading" ? document.addEventListener("DOMContentLoaded", mount) : mount();

  window.Sound = {
    RATE,
    stream: (slide, fill, opts) => new Stream(slide, fill, opts).start(),
    play,
    unlock,
    duck(on) { ducked = on; applyGain(); },
    get unlocked() { return unlocked(); },
    get ctx() { return ctx; },
    get volume() { return muted ? 0 : volume; },
    flashHint,
  };
})();

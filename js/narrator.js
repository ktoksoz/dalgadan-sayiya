/* Sesli anlatım: her slaytın audio/<slayt-id>.mp3 dosyasını çalar.
   Anlatım açıkken slayt değişince yeni slaytın sesi başlar; "otomatik ilerle"
   açıksa ses bitince sonraki slayta geçilir. */
(function () {
  const { h } = L;
  const btn = document.getElementById("btn-voice");
  const audio = new Audio();
  audio.preload = "auto";
  let on = false, auto = true, advanceT = 0;
  // etkin slaytı doğrudan sayfadan oku (app.js sürümünden bağımsız)
  const slides = () => [...document.querySelectorAll(".slide")];
  const curIndex = () => slides().findIndex((s) => s.classList.contains("active"));
  const curId = () => (slides()[curIndex()] || {}).id;

  const store = {
    get(k, d) { try { const v = localStorage.getItem("anlatim." + k); return v == null ? d : v === "1"; } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem("anlatim." + k, v ? "1" : "0"); } catch (e) {} },
  };
  auto = store.get("auto", true);

  // oynatıcı çubuğu: alt çubuğun hemen üstünde
  const playBtn = h("button.np-play", { type: "button", "aria-label": "Duraklat", onclick: () => (audio.paused ? play() : pause()) });
  const fill = h("i");
  const track = h("div.np-track", { role: "slider", "aria-label": "Anlatım konumu", tabindex: 0 }, fill);
  const time = h("span.np-time", "0:00");
  const autoBox = h("input", { type: "checkbox" });
  autoBox.checked = auto;
  autoBox.addEventListener("change", () => { auto = autoBox.checked; store.set("auto", auto); });
  const status = h("span.np-status");
  const closeBtn = h("button.np-close", { type: "button", "aria-label": "Anlatımı kapat", onclick: () => toggle(false) }, "×");
  const bar = h("div#narrator", { role: "region", "aria-label": "Sesli anlatım" },
    playBtn, track, time, h("label.np-auto", autoBox, "Bitince sonraki slayta geç"), status, closeBtn);
  document.body.append(bar);

  const fmt = (s) => (isFinite(s) ? `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}` : "0:00");
  function icon() {
    const paused = audio.paused;
    playBtn.innerHTML = paused
      ? '<svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z" fill="currentColor"/></svg>'
      : '<svg viewBox="0 0 24 24"><path d="M7 5h4v14H7zM13 5h4v14h-4z" fill="currentColor"/></svg>';
    playBtn.setAttribute("aria-label", paused ? "Oynat" : "Duraklat");
  }
  // sesi belleğe alıp blob'dan çal: Range desteklemeyen basit sunucularda da ileri sarılabilsin
  const blobs = {};
  let loading = null;
  function load(id) {
    clearTimeout(advanceT);
    status.textContent = "";
    fill.style.width = "0%"; time.textContent = "0:00";
    const url = "audio/" + id + ".mp3";
    if (blobs[id]) { audio.src = blobs[id]; loading = null; return; }
    audio.removeAttribute("src");
    loading = fetch(url).then((r) => { if (!r.ok) throw 0; return r.blob(); })
      .then((b) => (blobs[id] = URL.createObjectURL(b)))
      .catch(() => url) // file:// gibi fetch'in çalışmadığı durumlarda doğrudan dosya
      .then((src) => { if (curId() === id) audio.src = src; });
  }
  function play() {
    clearTimeout(advanceT); status.textContent = "";
    if (loading) { const l = loading; l.then(() => { if (loading === l) { loading = null; play(); } }); return; }
    const p = audio.play();
    if (p && p.catch) p.catch(() => { status.textContent = "Oynatmak için ▶ düğmesine basın"; icon(); });
  }
  function pause() { audio.pause(); clearTimeout(advanceT); }

  function toggle(force) {
    on = force ?? !on;
    btn.classList.toggle("on", on);
    bar.classList.toggle("open", on);
    document.body.classList.toggle("narrating", on);
    if (on) { lastId = curId(); load(lastId); play(); }
    else { pause(); }
  }

  // anlatım çalarken deney sesleri kısılır; ses düzeyi ve sessize alma alt çubuktan gelir
  const duck = (v) => window.Sound && Sound.duck(v);
  audio.addEventListener("play", () => { icon(); duck(true); });
  audio.addEventListener("pause", () => { icon(); duck(false); });
  audio.addEventListener("ended", () => duck(false));
  window.addEventListener("soundlevel", (e) => { audio.volume = Math.min(1, e.detail.volume * 1.2); audio.muted = e.detail.muted; });
  audio.addEventListener("timeupdate", () => {
    fill.style.width = (audio.duration ? (audio.currentTime / audio.duration) * 100 : 0) + "%";
    time.textContent = `${fmt(audio.currentTime)} / ${fmt(audio.duration)}`;
  });
  audio.addEventListener("ended", () => {
    icon();
    if (!on || !auto) return;
    if (curIndex() >= slides().length - 1) { status.textContent = "Anlatım bitti"; return; }
    status.textContent = "Sonraki slayta geçiliyor…";
    advanceT = setTimeout(() => (window.Deck ? Deck.next() : document.getElementById("btn-next").click()), 1600);
  });
  audio.addEventListener("error", () => { status.textContent = "Bu slayt için ses dosyası bulunamadı"; icon(); });

  // konuma tıklayarak sarma
  function seek(e) {
    const r = track.getBoundingClientRect();
    if (audio.duration) audio.currentTime = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)) * audio.duration;
  }
  track.addEventListener("click", seek);
  track.addEventListener("keydown", (e) => {
    if (e.key === "ArrowRight") { audio.currentTime += 5; e.preventDefault(); e.stopPropagation(); }
    if (e.key === "ArrowLeft") { audio.currentTime -= 5; e.preventDefault(); e.stopPropagation(); }
  });

  // slayt değişimini izle (olay + yedek olarak sınıf değişimi)
  let lastId = curId();
  function onSlide() {
    const id = curId();
    if (id === lastId) return;
    lastId = id;
    if (!on) return;
    load(id); play();
  }
  window.addEventListener("slidechange", onSlide);
  new MutationObserver(onSlide).observe(document.getElementById("deck"), { subtree: true, attributes: true, attributeFilter: ["class"] });
  // kullanıcı deneyle oynamaya başlarsa otomatik geçişi kapat (bu oturum için)
  function userPlays(e) {
    if (!e.isTrusted || !on || !auto) return;
    if (!e.target.closest || !e.target.closest(".slide.active .stage")) return;
    auto = false; autoBox.checked = false;
    clearTimeout(advanceT);
    status.textContent = "Otomatik geçiş kapatıldı";
    setTimeout(() => { if (status.textContent === "Otomatik geçiş kapatıldı") status.textContent = ""; }, 3500);
  }
  window.addEventListener("pointerdown", userPlays, true);
  window.addEventListener("input", userPlays, true);
  btn.addEventListener("click", () => toggle());
  // dışarıdan başlatma (kapaktaki düğme): otomatik ilerleme açık
  window.Narrator = {
    start() { auto = true; autoBox.checked = true; store.set("auto", true); if (on) { lastId = curId(); load(lastId); play(); } else toggle(true); },
    get on() { return on; },
  };
  document.addEventListener("keydown", (e) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.target.matches && e.target.matches("input[type=text], textarea")) return;
    if (e.key === "a" || e.key === "A") toggle();
    if (on && (e.key === "p" || e.key === "P")) audio.paused ? play() : pause();
  });
  icon();
})();

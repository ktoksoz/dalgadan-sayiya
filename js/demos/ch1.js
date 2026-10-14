/* Bölüm 1: Radyo dalgası
   - emSpectrum: elektromanyetik spektrum şeridi (logaritmik, kaydırılır/yakınlaştırılır)
   - wavelength: frekans → dalga boyu ve çeyrek dalga anten, ölçek nesneleriyle
   - timeline: kıvılcımdan yazılıma zaman çizelgesi, her olayda küçük bir canlandırma */
(function () {
  const { C, FONT, rgba, h, canvas, loop, clamp, num } = L;
  const TAU = Math.PI * 2;
  const LIGHT = 299792458; // ışık hızı, m/sn

  // sondaki sıfırları at: "100,0" → "100", "2,40" → "2,4"
  const trim = (s) => (s.includes(",") ? s.replace(/0+$/, "").replace(/,$/, "") : s);
  const UNITS = [[1e21, "ZHz"], [1e18, "EHz"], [1e15, "PHz"], [1e12, "THz"], [1e9, "GHz"], [1e6, "MHz"], [1e3, "kHz"], [1, "Hz"]];
  function fHz(v, sig = 3) {
    for (const [m, u] of UNITS) if (v >= m * 0.99995) {
      const x = v / m, d = Math.max(0, sig - 1 - Math.floor(Math.log10(x) + 1e-9));
      return trim(num(x, Math.min(d, 4))) + " " + u;
    }
    return trim(num(v, 2)) + " Hz";
  }
  function fLen(m, sig = 3) {
    const U = [[1e3, "km"], [1, "m"], [1e-2, "cm"], [1e-3, "mm"], [1e-6, "µm"], [1e-9, "nm"], [1e-12, "pm"], [1e-15, "fm"]];
    for (const [k, u] of U) if (m >= k * 0.99995) {
      const x = m / k, d = Math.max(0, sig - 1 - Math.floor(Math.log10(x) + 1e-9));
      return trim(num(x, Math.min(d, 3))) + " " + u;
    }
    return trim(num(m * 1e15, 2)) + " fm";
  }
  function fTime(s) {
    const U = [[1, "sn"], [1e-3, "ms"], [1e-6, "µs"], [1e-9, "ns"], [1e-12, "ps"]];
    for (const [k, u] of U) if (s >= k * 0.99995) { const x = s / k; return trim(num(x, x >= 100 ? 0 : x >= 10 ? 1 : 2)) + " " + u; }
    return trim(num(s * 1e12, 3)) + " ps";
  }

  /* ================= 1. Elektromanyetik spektrum ================= */
  // Büyük bölgeler (sınırlar keskin değildir; Wikipedia "Electromagnetic spectrum" tablosu)
  const REGIONS = [
    { n: "Radyo", a: 1e3, b: 3e11, d: "Radyo dalgaları: kilohertzden 300 GHz'e kadar. Uzun dalga yayınlardan uydu bağlantılarına, SDR'ın dünyası burası. Dalga boyu kilometrelerden milimetreye iner." },
    { n: "Kızılötesi", a: 3e11, b: 4e14, d: "Kızılötesi (300 GHz–400 THz, 1 mm–750 nm): ısı ışınımı. Kumanda vericisi, termal kamera ve fiber optik haberleşme bu aralıktadır." },
    { n: "Görünür", a: 4e14, b: 7.9e14, d: "Görünür ışık: yaklaşık 400–790 THz (750–380 nm). Gözümüzün algıladığı küçücük pencere; radyo ile aynı olgu, yalnızca yaklaşık bir milyon kat yüksek frekansta." },
    { n: "Morötesi", a: 7.9e14, b: 3e16, d: "Morötesi (yaklaşık 790 THz–30 PHz, 380–10 nm): güneş yanığının sebebi. Foton enerjisi molekül bağlarını koparmaya yetmeye başlar." },
    { n: "X ışını", a: 3e16, b: 3e19, d: "X ışını (yaklaşık 30 PHz–30 EHz): dokudan geçer, kemikte soğurulur. Sınırları kesin değildir; gama ışınıyla örtüşür." },
    { n: "Gama", a: 3e19, b: 1e22, d: "Gama ışını (yaklaşık 30 EHz üstü): atom çekirdeğinden gelen en yüksek enerjili ışınım. X ışınından ayrımı frekansa değil kaynağa göre yapılır." },
  ];
  // ITU radyo bant adları
  const ITU = [
    { n: "VLF", a: 3e3, b: 3e4, d: "VLF (çok alçak frekans, 3–30 kHz): denizaltı haberleşmesi; dalga boyu 10–100 km." },
    { n: "LF", a: 3e4, b: 3e5, d: "LF (alçak frekans, 30–300 kHz): uzun dalga yayınları ve zaman sinyali vericileri. Dalga boyu 1–10 km." },
    { n: "MF", a: 3e5, b: 3e6, d: "MF (orta frekans, 300 kHz–3 MHz): orta dalga AM yayınları, gemi ve havacılık radyo fenerleri." },
    { n: "HF", a: 3e6, b: 3e7, d: "HF (yüksek frekans, 3–30 MHz): kısa dalga. İyonosferden yansıyıp kıtalar arası yol alabilir; amatör telsizcilerin gözdesi." },
    { n: "VHF", a: 3e7, b: 3e8, d: "VHF (çok yüksek frekans, 30–300 MHz): FM radyo, havacılık telsizi, hava uyduları, 2 m amatör bandı. Neredeyse görüş hattında yayılır." },
    { n: "UHF", a: 3e8, b: 3e9, d: "UHF (ultra yüksek frekans, 300 MHz–3 GHz): cep telefonu, GPS, Wi-Fi, ADS-B, televizyon. Ucuz SDR'ların asıl çalışma alanı." },
    { n: "SHF", a: 3e9, b: 3e10, d: "SHF (süper yüksek frekans, 3–30 GHz): uydu TV, radar, 5 GHz Wi-Fi, mikrodalga bağlantılar. Dalga boyu santimetreler mertebesinde." },
    { n: "EHF", a: 3e10, b: 3e11, d: "EHF (aşırı yüksek frekans, 30–300 GHz): milimetre dalga. Havaalanı tarayıcıları, araç radarları (77 GHz), radyo astronomi." },
  ];
  // İşaretli bantlar (frekanslar Wikipedia ve ITU Bölge 1 planından; sunucu notlarında kaynak)
  const BANDS = [
    { n: "Uzun dalga AM", a: 148.5e3, b: 283.5e3, d: "Avrupa'da uzun dalga yayın bandı. Dalga boyu 1–2 km; yer dalgası olarak yüzlerce kilometre gider." },
    { n: "Orta dalga AM", a: 531e3, b: 1602e3, d: "Avrupa'da orta dalga AM yayınları, 9 kHz kanal aralığıyla. Geceleri iyonosferden yansıyıp çok uzaklardan duyulur." },
    { n: "Kısa dalga 49 m", a: 5.9e6, b: 6.2e6, d: "Kısa dalga yayın bantlarından biri (49 metre bandı). Uluslararası yayıncılar kıtalar arası bu bantlarla ulaşır." },
    { n: "FM radyo", a: 87.5e6, b: 108e6, d: "FM yayın bandı: 87,5–108 MHz. Her istasyon yaklaşık 200 kHz yer kaplar. Bu sunumdaki istasyonların çoğu bu banttan esinlenir." },
    { n: "Havacılık", a: 108e6, b: 137e6, d: "Havacılık bandı: 108–118 MHz seyrüsefer (VOR, ILS), 118–137 MHz pilot ile kule arasındaki AM ses haberleşmesi." },
    { n: "Hava uyduları", a: 137e6, b: 138e6, d: "137 MHz: kutupsal yörüngedeki hava uydularının görüntü yayınları. NOAA-15/18/19'un analog APT yayını 2025'te sona erdi; Meteor-M uyduları sayısal LRPT ile sürüyor." },
    { n: "2 m amatör", a: 144e6, b: 146e6, d: "Amatör telsiz 2 metre bandı (Bölge 1: 144–146 MHz). Yayın yapmak için amatör telsizcilik belgesi gerekir; dinlemek serbesttir." },
    { n: "433 MHz ISM", a: 433.05e6, b: 434.79e6, d: "Lisanssız kısa menzilli cihazlar: araba ve garaj kumandaları, kablosuz termometreler, hava istasyonları. RTL-SDR ile en çok dinlenen bantlardan." },
    { n: "868 MHz SRD", a: 863e6, b: 870e6, d: "Avrupa'da kısa menzilli cihaz bandı: LoRa, akıllı sayaçlar, alarm sensörleri." },
    { n: "GSM 900", a: 880e6, b: 960e6, d: "GSM 900: telefondan baz istasyonuna 880–915 MHz, baz istasyonundan telefona 925–960 MHz." },
    { n: "ADS-B", a: 1089e6, b: 1091e6, d: "1090 MHz: uçakların konumunu, irtifasını ve hızını saniyede birkaç kez yayımladığı ADS-B mesajları. Ucuz bir SDR ile gökyüzündeki uçaklar haritaya dökülebilir." },
    { n: "Hidrojen çizgisi", a: 1420e6, b: 1420.81e6, d: "1420,405 MHz (21 cm): Samanyolu'ndaki nötr hidrojenin yaydığı çizgi. Amatörler çanak anten ve SDR ile galaksinin kollarını ölçebilir." },
    { n: "GPS L1", a: 1574.42e6, b: 1576.42e6, d: "GPS L1: 1575,42 MHz. Uydular 20.000 km yukarıdan yayın yapar; sinyal yerde gürültünün altındadır ve ancak kodla ilişkilendirerek bulunur." },
    { n: "Iridium", a: 1616e6, b: 1626.5e6, d: "Iridium uydu telefonu ve veri ağı: 1616–1626,5 MHz. Alçak yörüngedeki uyduların yayınları SDR ile alınıp çözülebilir." },
    { n: "GSM 1800", a: 1710e6, b: 1880e6, d: "GSM/DCS 1800: telefondan baz istasyonuna 1710–1785 MHz, baz istasyonundan telefona 1805–1880 MHz." },
    { n: "Wi-Fi 2,4 GHz", a: 2400e6, b: 2483.5e6, d: "2,4 GHz ISM bandı (2400–2483,5 MHz): Wi-Fi, Bluetooth ve mikrodalga fırınlar aynı bandı paylaşır." },
    { n: "5G n78", a: 3300e6, b: 3800e6, d: "5G NR n78 bandı: 3,3–3,8 GHz. Avrupa'da 5G'nin ana orta bant frekansı." },
    { n: "Wi-Fi 5 GHz", a: 5150e6, b: 5725e6, d: "5 GHz Wi-Fi: Avrupa'da 5150–5350 ve 5470–5725 MHz. Daha geniş kanallar, daha kısa menzil." },
    { n: "Uydu TV (Ku)", a: 10.7e9, b: 12.75e9, d: "Ku bandı uydu yayınları (10,7–12,75 GHz): çanak antenin ucundaki LNB bu frekansı yaklaşık 1–2 GHz'e indirip kabloya verir." },
  ];
  const RTL = { a: 24e6, b: 1766e6 };
  const FULL = [3, 21.3];

  Demos.emSpectrum = function (stage, slide) {
    const cv = h("canvas", { "aria-label": "Elektromanyetik spektrum şeridi: sürükleyerek kaydırın, tekerlekle ya da iki parmakla yakınlaştırın, bir banda dokunun" });
    const fill = h("div.fill.em-fill", cv);
    const infoT = h("b"), infoR = h("span.em-range"), infoD = h("span.em-desc");
    const info = h("div.em-info", { "aria-live": "polite" }, infoT, infoR, infoD);
    const ctrl = h("div.controls");
    stage.append(fill, info, ctrl);

    const VIEW0 = window.innerWidth < 600 ? [4.2, 11.6] : FULL; // dar ekranda radyo bölümüyle başla
    let view = VIEW0.slice(), target = VIEW0.slice();
    let hoverX = -1, sel = null, showRtl = true, dirty = true;
    const VIEWS = { all: FULL, radio: [4.2, 11.6], rtl: [7.15, 9.45], fm: [7.92, 8.06] };
    const presets = L.seg([["all", "Tümü"], ["radio", "Radyo"], ["rtl", "RTL-SDR"], ["fm", "FM"]], VIEW0 === FULL ? "all" : "radio", (k) => { target = VIEWS[k].slice(); }, "Görünüm");
    const zin = h("button.btn", { type: "button", "aria-label": "Yakınlaştır", onclick: () => zoomAt(0.5, 0.5) }, "+");
    const zout = h("button.btn", { type: "button", "aria-label": "Uzaklaştır", onclick: () => zoomAt(0.5, 2) }, "−");
    const rtlT = L.toggle("RTL-SDR kapsamı", true, (v) => { showRtl = v; dirty = true; });
    rtlT.set(true); // L.toggle başlangıçta true'yu aria-pressed="" olarak yazıyor
    ctrl.append(presets, zin, zout, rtlT);

    const X = (lf) => ((lf - view[0]) / (view[1] - view[0])) * st.w;
    const LF = (x) => view[0] + (x / st.w) * (view[1] - view[0]);
    function clampView(v) {
      let [a, b] = v, s = clamp(b - a, 0.03, FULL[1] - FULL[0]);
      const m = (a + b) / 2; a = m - s / 2; b = m + s / 2;
      if (a < FULL[0]) { b += FULL[0] - a; a = FULL[0]; }
      if (b > FULL[1]) { a -= b - FULL[1]; b = FULL[1]; }
      return [a, b];
    }
    function zoomAt(fx, k) {
      const piv = target[0] + fx * (target[1] - target[0]);
      target = clampView([piv - (piv - target[0]) * k, piv + (target[1] - piv) * k]);
      presets.set(null);
    }

    // yerleşim
    let lay = {};
    function layout() {
      const H = st.h;
      lay = { scaleY: 40, regY: 50, regH: 28, ituY: 82, ituH: 22, waveY: 128, mkY: 158, lamY: H - 34 };
      lay.mkH = lay.lamY - 14 - lay.mkY;
    }

    // ölçek çentikleri: geniş görünümde onlukların kuvvetleri, dar görünümde doğrusal 1-2-5 adımlar
    function freqTicks() {
      const span = view[1] - view[0], out = { major: [], minor: [] };
      if (span > 1.6) {
        const every = st.w / span > 70 ? 1 : st.w / span > 26 ? 3 : 6;
        for (let k = Math.ceil(view[0]); k <= view[1]; k++) {
          if (k % every === 0) out.major.push(10 ** k);
          else out.minor.push(10 ** k);
          if (st.w / span > 140) for (let m = 2; m < 10; m++) out.minor.push(m * 10 ** k);
        }
      } else {
        const t = V.ticks(10 ** view[0], 10 ** view[1], Math.max(3, Math.round(st.w / 130)));
        out.major = t.major.filter((v) => v > 0); out.minor = t.minor.filter((v) => v > 0);
      }
      return out;
    }
    function lamTicks() {
      const l0 = LIGHT / 10 ** view[1], l1 = LIGHT / 10 ** view[0];
      const span = view[1] - view[0], out = { major: [], minor: [] };
      if (span > 1.6) {
        const every = st.w / span > 70 ? 1 : st.w / span > 26 ? 3 : 6;
        for (let k = Math.floor(Math.log10(l1)); k >= Math.ceil(Math.log10(l0)); k--) (((k % every) + every) % every === 0 ? out.major : out.minor).push(10 ** k);
      } else {
        const t = V.ticks(l0, l1, Math.max(3, Math.round(st.w / 130)));
        out.major = t.major.filter((v) => v > 0); out.minor = t.minor.filter((v) => v > 0);
      }
      return out;
    }

    function logScale(ctx, vals, y, up, fmt, xOf) {
      ctx.strokeStyle = rgba(C.ink, 0.35); ctx.lineWidth = 1; ctx.beginPath();
      vals.minor.forEach((v) => { const x = Math.round(xOf(v)) + 0.5; if (x < 0 || x > st.w) return; ctx.moveTo(x, y); ctx.lineTo(x, y + (up ? -4 : 4)); });
      ctx.stroke();
      ctx.strokeStyle = rgba(C.ink, 0.75); ctx.beginPath();
      vals.major.forEach((v) => { const x = Math.round(xOf(v)) + 0.5; if (x < 0 || x > st.w) return; ctx.moveTo(x, y); ctx.lineTo(x, y + (up ? -8 : 8)); });
      ctx.stroke();
      let lastR = -1e9;
      vals.major.forEach((v) => {
        const x = xOf(v), s = fmt(v);
        ctx.font = `600 13px ${FONT.display}`;
        const tw = ctx.measureText(s).width;
        let al = "center", l = x - tw / 2;
        if (l < 2) { al = "left"; l = Math.max(2, x - 2); }
        if (x + tw / 2 > st.w - 2) { al = "right"; l = x - tw; }
        if (l < lastR + 8 || x < -2 || x > st.w + 2) return;
        lastR = l + tw;
        V.text(ctx, s, al === "left" ? Math.max(2, x - 2) : x, y + (up ? -12 : 21), { color: C.ink, size: 13, align: al, font: FONT.display, weight: 600 });
      });
    }

    // dekoratif dalga: sağa doğru sıklaşan sinüs (faz, log f'nin fonksiyonu)
    const WA = 0.75, WB = 0.07; // periyot (onluk cinsinden) = WA·10^(−WB·(lf−3))
    const wavePhase = (lf) => (10 ** (WB * (lf - 3)) / (WA * WB * Math.LN10)) * TAU;

    function hitMarkers(x, y) {
      if (!lay.markers) return null;
      let best = null, bd = 26;
      lay.markers.forEach((m) => {
        const inside = x >= m.x0 - 3 && x <= m.x1 + 3;
        const dx = inside ? 0 : Math.min(Math.abs(x - m.x0), Math.abs(x - m.x1));
        const ly = lay.mkY + 8 + m.lane * 26;
        const onLabel = x >= m.lx && x <= m.lx + m.lw && Math.abs(y - (ly + 6)) < 13;
        const d = onLabel ? -1 : dx;
        if (d < bd) { bd = d; best = m.b; }
      });
      return best;
    }
    function pick(x, y) {
      if (y >= lay.regY && y < lay.regY + lay.regH) { const f = 10 ** LF(x); sel = REGIONS.find((r) => f >= r.a && f < r.b) || null; }
      else if (y >= lay.ituY - 2 && y < lay.ituY + lay.ituH + 2) { const f = 10 ** LF(x); sel = ITU.find((r) => f >= r.a && f < r.b) || sel; }
      else if (y >= lay.mkY - 20) sel = hitMarkers(x, y) || sel;
      showInfo();
      dirty = true;
    }
    function showInfo() {
      if (!sel) {
        infoT.textContent = "Bir banda dokunun.";
        infoR.textContent = "";
        infoD.textContent = "Şeridi sürükleyin, tekerlekle ya da iki parmakla yakınlaştırın. Kesik çizgili alan, ucuz bir RTL-SDR alıcının ayarlanabildiği aralık.";
        return;
      }
      infoT.textContent = sel.n;
      const la = LIGHT / sel.b, lb = LIGHT / sel.a;
      const narrow = sel.b / sel.a < 1.01;
      infoR.textContent = narrow
        ? `${fHz((sel.a + sel.b) / 2, 6)} · dalga boyu ${fLen(LIGHT / ((sel.a + sel.b) / 2))}`
        : `${fHz(sel.a, 4)} – ${fHz(sel.b, 4)} · dalga boyu ${fLen(lb)} – ${fLen(la)}`;
      infoD.textContent = sel.d;
    }

    function draw() {
      const { ctx, w, h: H } = st;
      if (!w) return;
      layout();
      ctx.fillStyle = C.stage; ctx.fillRect(0, 0, w, H);
      const xf = (f) => X(Math.log10(f));
      // RTL-SDR kapsamı (arka planda taralı sütun)
      if (showRtl) {
        const x0 = xf(RTL.a), x1 = xf(RTL.b);
        if (x1 > 0 && x0 < w) {
          ctx.save();
          ctx.beginPath(); ctx.rect(x0, lay.regY, Math.max(2, x1 - x0), lay.lamY - lay.regY); ctx.clip();
          ctx.fillStyle = rgba(C.ink, 0.045); ctx.fillRect(x0, 0, x1 - x0, H);
          ctx.strokeStyle = rgba(C.ink, 0.08); ctx.lineWidth = 1; ctx.beginPath();
          for (let k = -H; k < x1 - x0 + H; k += 9) { ctx.moveTo(x0 + k, lay.lamY); ctx.lineTo(x0 + k + (lay.lamY - lay.regY), lay.regY); }
          ctx.stroke(); ctx.restore();
          ctx.strokeStyle = rgba(C.ink, 0.55); ctx.setLineDash([4, 4]); ctx.beginPath();
          [x0, x1].forEach((x) => { if (x > 0 && x < w) { ctx.moveTo(Math.round(x) + 0.5, lay.regY); ctx.lineTo(Math.round(x) + 0.5, lay.lamY); } });
          ctx.stroke(); ctx.setLineDash([]);
          const cx = clamp((Math.max(0, x0) + Math.min(w, x1)) / 2, 70, w - 70);
          const lab = x1 - x0 > 150 ? "RTL-SDR ≈ 24 MHz – 1,77 GHz" : "RTL-SDR";
          ctx.font = `700 12px ${FONT.body}`;
          const tw = ctx.measureText(lab).width + 14;
          ctx.fillStyle = rgba(C.bg, 0.85); ctx.fillRect(cx - tw / 2, lay.lamY - 26, tw, 18);
          ctx.strokeStyle = rgba(C.ink, 0.4); ctx.strokeRect(Math.round(cx - tw / 2) + 0.5, lay.lamY - 25.5, Math.round(tw), 17);
          V.text(ctx, lab, cx, lay.lamY - 13, { color: C.ink, size: 12, align: "center", weight: 700 });
        }
      }
      // bölgeler
      REGIONS.forEach((r, i) => {
        const x0 = Math.max(-2, xf(r.a)), x1 = Math.min(w + 2, xf(r.b));
        if (x1 <= 0 || x0 >= w) return;
        if (r.n === "Görünür") {
          const g = ctx.createLinearGradient(xf(r.a), 0, xf(r.b), 0);
          [["#ff2d2d", 0], ["#ff8c1a", 0.18], ["#ffe14d", 0.36], ["#4ddf6a", 0.52], ["#2fb5ff", 0.7], ["#4b5bff", 0.85], ["#9b3dff", 1]].forEach(([c, t]) => g.addColorStop(t, c));
          ctx.fillStyle = g; ctx.globalAlpha = 0.85;
        } else { ctx.fillStyle = rgba(C.ink, i % 2 ? 0.1 : 0.06); }
        ctx.fillRect(x0, lay.regY, x1 - x0, lay.regH); ctx.globalAlpha = 1;
        if (sel === r) { ctx.strokeStyle = C.ink; ctx.lineWidth = 1.5; ctx.strokeRect(x0 + 0.75, lay.regY + 0.75, x1 - x0 - 1.5, lay.regH - 1.5); }
        const cx = clamp((x0 + x1) / 2, x0 + 4, x1 - 4);
        ctx.font = `700 14px ${FONT.display}`;
        const tw = ctx.measureText(r.n).width;
        if (x1 - x0 > tw + 8) {
          const lx = clamp(cx, Math.max(0, x0) + tw / 2 + 6, Math.min(w, x1) - tw / 2 - 6);
          V.text(ctx, r.n, lx, lay.regY + 19, { color: r.n === "Görünür" ? "#10181b" : C.ink, size: 14, align: "center", font: FONT.display, weight: 700 });
        }
      });
      // ITU bantları + mikrodalga ayracı
      ITU.forEach((r, i) => {
        const x0 = Math.max(-2, xf(r.a)), x1 = Math.min(w + 2, xf(r.b));
        if (x1 <= 0 || x0 >= w) return;
        ctx.fillStyle = rgba(C.ink, i % 2 ? 0.08 : 0.035); ctx.fillRect(x0, lay.ituY, x1 - x0, lay.ituH);
        if (sel === r) { ctx.strokeStyle = C.ink; ctx.lineWidth = 1.5; ctx.strokeRect(x0 + 0.75, lay.ituY + 0.75, x1 - x0 - 1.5, lay.ituH - 1.5); }
        ctx.font = `700 12px ${FONT.body}`;
        const tw = ctx.measureText(r.n).width;
        if (x1 - x0 > tw + 6) {
          const lx = clamp((x0 + x1) / 2, Math.max(0, x0) + tw / 2 + 4, Math.min(w, x1) - tw / 2 - 4);
          V.text(ctx, r.n, lx, lay.ituY + 15.5, { color: C.ink2, size: 12, align: "center", weight: 700 });
        }
      });
      {
        const x0 = xf(3e8), x1 = xf(3e11), y = lay.ituY + lay.ituH + 8;
        if (x1 > 0 && x0 < w && x1 - x0 > 60) {
          ctx.strokeStyle = rgba(C.ink, 0.45); ctx.lineWidth = 1; ctx.beginPath();
          ctx.moveTo(x0 + 0.5, y - 4); ctx.lineTo(x0 + 0.5, y); ctx.lineTo(x1 - 0.5, y); ctx.lineTo(x1 - 0.5, y - 4); ctx.stroke();
          const lx = clamp((x0 + x1) / 2, Math.max(0, x0) + 50, Math.min(w, x1) - 50);
          ctx.fillStyle = C.stage; ctx.fillRect(lx - 42, y - 6, 84, 12);
          V.text(ctx, "mikrodalga", lx, y + 4, { color: C.ink2, size: 11.5, align: "center" });
        }
      }
      // dekoratif dalga
      ctx.save();
      ctx.strokeStyle = rgba(C.ink, 0.55); ctx.lineWidth = 1.3; ctx.beginPath();
      const ph0 = (performance.now() / 1000) * 2.2;
      for (let x = 0; x <= w; x += 1.5) {
        const lf = LF(x), y = lay.waveY + Math.sin(wavePhase(lf) - ph0) * 11;
        x ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
      }
      ctx.stroke(); ctx.restore();
      // işaretli bantlar: şeritlere yerleştir
      ctx.font = `700 12.5px ${FONT.body}`;
      const lanes = Math.max(1, Math.floor((lay.mkH - 8) / 26));
      const ends = new Array(lanes).fill(-1e9);
      lay.markers = [];
      BANDS.map((b) => ({ b, x0: xf(b.a), x1: xf(b.b) }))
        .filter((m) => m.x1 > -40 && m.x0 < w + 40)
        .sort((p, q) => p.x0 - q.x0)
        .forEach((m) => {
          const lw = ctx.measureText(m.b.n).width;
          const mid = (m.x0 + m.x1) / 2;
          let lx = m.x1 - m.x0 > lw + 8 ? clamp(m.x0 + 4, 2, m.x1 - lw - 4) : mid - lw / 2;
          lx = clamp(lx, 2, w - lw - 2);
          let lane = ends.findIndex((e) => Math.min(lx, m.x0) > e + 14);
          m.lane = lane; m.lx = lx; m.lw = lw;
          if (lane >= 0) ends[lane] = Math.max(lx + lw, m.x1);
          lay.markers.push(m);
        });
      lay.markers.forEach((m) => {
        const on = sel === m.b;
        const x0 = m.x0, x1 = Math.max(m.x1, m.x0 + 2);
        if (on) { ctx.fillStyle = rgba(C.ink, 0.1); ctx.fillRect(x0, lay.regY, x1 - x0, lay.lamY - lay.regY); }
        // spektruma inen çentik
        ctx.fillStyle = rgba(C.ink, on ? 1 : 0.75);
        ctx.fillRect(x0, lay.mkY - 8, x1 - x0, 4);
        if (m.lane < 0) return;
        const ly = lay.mkY + 8 + m.lane * 26;
        ctx.strokeStyle = rgba(C.ink, on ? 0.8 : 0.28); ctx.lineWidth = 1; ctx.beginPath();
        const cx = clamp((x0 + x1) / 2, m.lx, m.lx + m.lw);
        ctx.moveTo(Math.round(cx) + 0.5, lay.mkY - 4); ctx.lineTo(Math.round(cx) + 0.5, ly - 4); ctx.stroke();
      });
      lay.markers.forEach((m) => {
        if (m.lane < 0) return;
        const on = sel === m.b, ly = lay.mkY + 8 + m.lane * 26;
        ctx.fillStyle = on ? C.ink : rgba(C.stage, 0.92);
        ctx.beginPath(); ctx.roundRect(m.lx - 5, ly - 5, m.lw + 10, 21, 3); ctx.fill();
        if (!on) { ctx.strokeStyle = rgba(C.ink, 0.22); ctx.lineWidth = 1; ctx.stroke(); }
        V.text(ctx, m.b.n, m.lx, ly + 10, { color: on ? C.bg : C.ink, size: 12.5, weight: 700 });
      });
      // frekans skalası (üst) ve dalga boyu skalası (alt)
      ctx.fillStyle = rgba(C.bg, 0.6); ctx.fillRect(0, 0, w, lay.scaleY);
      logScale(ctx, freqTicks(), lay.scaleY, true, (v) => fHz(v, 3), xf);
      ctx.strokeStyle = rgba(C.ink, 0.3); ctx.beginPath(); ctx.moveTo(0, lay.scaleY + 0.5); ctx.lineTo(w, lay.scaleY + 0.5); ctx.stroke();
      ctx.fillStyle = rgba(C.bg, 0.6); ctx.fillRect(0, lay.lamY, w, H - lay.lamY);
      logScale(ctx, lamTicks(), lay.lamY, false, (v) => fLen(v, 3), (l) => xf(LIGHT / l));
      ctx.strokeStyle = rgba(C.ink, 0.3); ctx.beginPath(); ctx.moveTo(0, lay.lamY + 0.5); ctx.lineTo(w, lay.lamY + 0.5); ctx.stroke();
      V.text(ctx, "dalga boyu", w - 6, lay.lamY - 5, { color: C.muted, size: 11, align: "right" });
      // fare: kırmızı ibre
      if (hoverX >= 0) {
        const f = 10 ** LF(hoverX);
        V.needle(ctx, hoverX, lay.scaleY, lay.lamY - lay.scaleY);
        const s = `${fHz(f, 3)} · ${fLen(LIGHT / f, 3)}`;
        ctx.font = `700 13px ${FONT.body}`;
        const tw = ctx.measureText(s).width, right = hoverX > w - tw - 24;
        ctx.fillStyle = rgba(C.bg, 0.85); ctx.fillRect(right ? hoverX - tw - 16 : hoverX + 6, lay.waveY - 10, tw + 10, 20);
        V.text(ctx, s, right ? hoverX - 11 : hoverX + 11, lay.waveY + 5, { color: C.needle, size: 13, weight: 700, align: right ? "right" : "left" });
      }
    }
    const st = canvas(cv, () => { dirty = true; draw(); });

    // işaretçiler: sürükle (kaydır), iki parmak (yakınlaştır), dokun (seç)
    const pts = new Map();
    let drag = null;
    const rel = (e) => { const r = cv.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
    cv.style.touchAction = "none";
    cv.addEventListener("pointerdown", (e) => {
      try { cv.setPointerCapture(e.pointerId); } catch (er) {}
      const [x, y] = rel(e);
      pts.set(e.pointerId, x);
      if (pts.size === 1) drag = { x, y, v: target.slice(), moved: false };
      else if (pts.size === 2) { const xs = [...pts.values()]; drag = { pinch: Math.abs(xs[0] - xs[1]) || 1, mid: (xs[0] + xs[1]) / 2, v: target.slice(), moved: true }; }
    });
    cv.addEventListener("pointermove", (e) => {
      const [x, y] = rel(e);
      if (e.pointerType !== "touch") hoverX = x;
      if (!pts.has(e.pointerId) || !drag) { dirty = true; return; }
      pts.set(e.pointerId, x);
      const span = drag.v[1] - drag.v[0];
      if (drag.pinch && pts.size >= 2) {
        const xs = [...pts.values()], d = Math.abs(xs[0] - xs[1]) || 1, k = drag.pinch / d;
        const piv = drag.v[0] + (drag.mid / st.w) * span;
        target = clampView([piv - (piv - drag.v[0]) * k, piv + (drag.v[1] - piv) * k]);
        view = target.slice();
      } else if (!drag.pinch) {
        const dx = x - drag.x;
        if (Math.abs(dx) > 4 || Math.abs(y - drag.y) > 4) drag.moved = true;
        if (drag.moved) { target = clampView([drag.v[0] - (dx / st.w) * span, drag.v[1] - (dx / st.w) * span]); view = target.slice(); }
      }
      presets.set(null);
      dirty = true;
    });
    const end = (e) => {
      if (!pts.has(e.pointerId)) return;
      pts.delete(e.pointerId);
      if (drag && !drag.moved && pts.size === 0) { const [x, y] = rel(e); pick(x, y); }
      if (pts.size === 0) drag = null;
      if (e.pointerType === "touch") hoverX = -1;
    };
    cv.addEventListener("pointerup", end);
    cv.addEventListener("pointercancel", end);
    cv.addEventListener("pointerleave", () => { if (!pts.size) { hoverX = -1; dirty = true; } });
    cv.addEventListener("wheel", (e) => {
      e.preventDefault();
      const [x] = rel(e);
      const d = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? 0 : e.deltaY;
      if (Math.abs(e.deltaX) > Math.abs(e.deltaY)) {
        const span = target[1] - target[0];
        target = clampView([target[0] + (e.deltaX / st.w) * span, target[1] + (e.deltaX / st.w) * span]);
      } else zoomAt(x / st.w, Math.exp(d * 0.0016));
      presets.set(null);
    }, { passive: false });

    showInfo();
    const lp = loop((dt) => {
      const k = 1 - Math.exp(-dt * 7);
      view = [view[0] + (target[0] - view[0]) * k, view[1] + (target[1] - view[1]) * k];
      draw();
    });
    return { enter() { lp.start(); }, leave() { lp.stop(); hoverX = -1; } };
  };

  /* ================= 2. Frekans, dalga boyu, anten ================= */
  // ölçek nesneleri: boy (m), yatay mı, çizim
  const OBJECTS = [
    { n: "bozuk para", s: 0.025, kind: "coin" },
    { n: "kalem", s: 0.14, kind: "pen" },
    { n: "telefon", s: 0.15, kind: "phone" },
    { n: "insan", s: 1.75, kind: "person" },
    { n: "otobüs", s: 12, kind: "bus", horiz: true },
    { n: "futbol sahası", s: 105, kind: "field", horiz: true },
    { n: "Eyfel Kulesi", s: 330, kind: "tower" },
  ];
  function drawObject(ctx, o, x, gy, px) {
    // px: nesnenin piksel boyu (yükseklik ya da yatayda uzunluk)
    ctx.save();
    ctx.fillStyle = rgba(C.ink, 0.88); ctx.strokeStyle = rgba(C.ink, 0.88); ctx.lineWidth = 1.5;
    if (o.kind === "coin") {
      const r = px / 2; ctx.beginPath(); ctx.arc(x + r, gy - r, r, 0, TAU); ctx.fill();
      ctx.strokeStyle = C.stage; ctx.lineWidth = Math.max(1, r * 0.1); ctx.beginPath(); ctx.arc(x + r, gy - r, r * 0.75, 0, TAU); ctx.stroke();
    } else if (o.kind === "pen") {
      const wd = px * 0.075;
      ctx.fillRect(x, gy - px + px * 0.12, wd, px * 0.88);
      ctx.beginPath(); ctx.moveTo(x, gy - px + px * 0.12); ctx.lineTo(x + wd / 2, gy - px); ctx.lineTo(x + wd, gy - px + px * 0.12); ctx.fill();
      ctx.fillStyle = C.stage; ctx.fillRect(x, gy - px * 0.2, wd, px * 0.02);
    } else if (o.kind === "phone") {
      const wd = px * 0.48, r = wd * 0.15;
      ctx.beginPath(); ctx.roundRect(x, gy - px, wd, px, r); ctx.fill();
      ctx.fillStyle = C.stage; ctx.beginPath(); ctx.roundRect(x + wd * 0.07, gy - px * 0.94, wd * 0.86, px * 0.88, r * 0.5); ctx.fill();
    } else if (o.kind === "person") {
      const u = px / 7.5, cx = x + u * 1.6;
      ctx.beginPath(); ctx.arc(cx, gy - px + u * 0.55, u * 0.55, 0, TAU); ctx.fill();
      ctx.beginPath(); ctx.roundRect(cx - u * 0.8, gy - px + u * 1.25, u * 1.6, u * 2.9, u * 0.4); ctx.fill();
      ctx.fillRect(cx - u * 0.72, gy - px + u * 3.9, u * 0.62, u * 3.6);
      ctx.fillRect(cx + u * 0.1, gy - px + u * 3.9, u * 0.62, u * 3.6);
      ctx.fillRect(cx - u * 1.18, gy - px + u * 1.4, u * 0.34, u * 2.5);
      ctx.fillRect(cx + u * 0.84, gy - px + u * 1.4, u * 0.34, u * 2.5);
    } else if (o.kind === "bus") {
      const hh = px * 0.26;
      ctx.beginPath(); ctx.roundRect(x, gy - hh - px * 0.03, px, hh, hh * 0.12); ctx.fill();
      ctx.fillStyle = C.stage;
      for (let k = 0; k < 6; k++) ctx.fillRect(x + px * (0.05 + k * 0.155), gy - hh - px * 0.03 + hh * 0.15, px * 0.12, hh * 0.38);
      ctx.fillStyle = rgba(C.ink, 0.88);
      [0.18, 0.8].forEach((f) => { ctx.beginPath(); ctx.arc(x + px * f, gy - px * 0.03, hh * 0.18, 0, TAU); ctx.fill(); });
    } else if (o.kind === "field") {
      const hh = Math.max(4, px * 0.05);
      ctx.strokeRect(x, gy - hh, px, hh);
      ctx.beginPath(); ctx.moveTo(x + px / 2, gy - hh); ctx.lineTo(x + px / 2, gy); ctx.stroke();
      ctx.strokeRect(x, gy - hh * 0.7, px * 0.08, hh * 0.4); ctx.strokeRect(x + px * 0.92, gy - hh * 0.7, px * 0.08, hh * 0.4);
    } else if (o.kind === "tower") {
      const b = px * 0.38;
      ctx.beginPath();
      ctx.moveTo(x, gy); ctx.quadraticCurveTo(x + b * 0.32, gy - px * 0.3, x + b * 0.45, gy - px * 0.85); ctx.lineTo(x + b / 2, gy - px);
      ctx.lineTo(x + b * 0.55, gy - px * 0.85); ctx.quadraticCurveTo(x + b * 0.68, gy - px * 0.3, x + b, gy);
      ctx.lineTo(x + b * 0.8, gy); ctx.quadraticCurveTo(x + b / 2, gy - px * 0.17, x + b * 0.2, gy); ctx.closePath(); ctx.fill();
      ctx.fillStyle = C.stage; ctx.fillRect(x + b * 0.2, gy - px * 0.2, b * 0.6, Math.max(1, px * 0.01)); ctx.fillRect(x + b * 0.33, gy - px * 0.48, b * 0.34, Math.max(1, px * 0.008));
    }
    ctx.restore();
  }
  const objWidth = (o, px) => (o.horiz ? px : o.kind === "coin" ? px : o.kind === "pen" ? px * 0.075 : o.kind === "phone" ? px * 0.48 : o.kind === "person" ? px * 0.43 : px * 0.38);

  const W_PRESETS = [["mw", "Orta dalga", 999e3], ["fm", "FM", 100e6], ["adsb", "ADS-B", 1090e6], ["gps", "GPS", 1575.42e6], ["wifi", "Wi-Fi", 2.44e9]];
  Demos.wavelength = function (stage, slide) {
    const cv = h("canvas", { "aria-label": "Dalga boyu ve çeyrek dalga anten boyu, ölçek nesneleriyle karşılaştırmalı" });
    const fill = h("div.fill", cv);
    const ro = (k, cls) => { const v = h("span.v"); const el = h("div.readout" + (cls ? "." + cls : ""), h("span.k", k), v); el.v = v; return el; };
    const rF = ro("Frekans"), rL = ro("Dalga boyu λ"), rA = ro("Çeyrek dalga anten λ/4"), rT = ro("Bir salınım süresi");
    const reads = h("div.readouts.wl-reads", rF, rL, rA, rT);
    const ctrl = h("div.controls");
    stage.append(h("div.controls.top", reads), fill, ctrl);

    let f = 100e6, shown = f, stream = null, tonePh = 0, toneF = 0;
    const sl = L.slider({ label: "Frekans", min: 100e3, max: 6e9, value: f, log: true, fmt: (v) => fHz(v, 3), oninput: (v) => { f = v; pre.set(null); upd(); }, cls: "cr", width: "min(300px, 38vw)" });
    const pre = L.seg(W_PRESETS.map(([k, n]) => [k, n]), "fm", (k) => { f = W_PRESETS.find((p) => p[0] === k)[2]; sl.set(f); upd(); }, "Hazır frekanslar");
    const listen = L.toggle("Dinle", false, (on) => {
      if (on) stream = Sound.stream(slide, fillAudio, { gain: 0.5 });
      else if (stream) { stream.stop(); stream = null; }
      upd();
    });
    const rS = h("span.note-small.wl-sound");
    ctrl.append(sl, pre, listen, rS);

    // duyulur benzetme: 100 kHz → 110 Hz, 6 GHz → 1760 Hz (log ölçek, 4 oktav)
    const pitch = (fr) => 110 * 2 ** (4 * (Math.log10(fr) - 5) / (Math.log10(6e9) - 5));
    function fillAudio(out, rate) {
      const tgt = pitch(f);
      if (!toneF) toneF = tgt;
      for (let i = 0; i < out.length; i++) {
        toneF += (tgt - toneF) * 0.0015;
        tonePh += TAU * toneF / rate; if (tonePh > TAU) tonePh -= TAU;
        out[i] = 0.32 * (Math.sin(tonePh) + 0.25 * Math.sin(2 * tonePh) + 0.08 * Math.sin(3 * tonePh));
      }
    }
    function upd() {
      const lam = LIGHT / f;
      rF.v.textContent = fHz(f, 4);
      rL.v.textContent = fLen(lam, 3);
      rA.v.textContent = fLen(lam / 4, 3);
      rT.v.textContent = fTime(1 / f);
      if (stream) {
        const p = pitch(f);
        rS.textContent = `Duyduğunuz ton ${trim(num(p, 0))} Hz: radyo dalgasından ${num(Math.round(f / p))} kat yavaş.`;
      } else rS.textContent = "";
    }

    function niceUp(v) { const p = 10 ** Math.floor(Math.log10(v)); for (const m of [1, 2, 5, 10]) if (m * p >= v * 0.999) return m * p; return 10 * p; }
    let viewM = 0;
    function draw(t) {
      const { ctx, w, h: H } = st;
      if (!w) return;
      ctx.fillStyle = C.stage; ctx.fillRect(0, 0, w, H);
      const lam = LIGHT / shown;
      const want = niceUp(lam * (w < 520 ? 1.3 : 1.7));
      if (!viewM) viewM = want;
      viewM = Math.exp(Math.log(viewM) + (Math.log(want) - Math.log(viewM)) * 0.12);
      const pxm = w / viewM; // piksel / metre
      const gy = Math.round(H * 0.84) - 10, top = 26;
      // zemin ve cetvel
      ctx.fillStyle = rgba(C.bg, 0.55); ctx.fillRect(0, gy, w, H - gy);
      ctx.strokeStyle = rgba(C.ink, 0.6); ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(0, gy + 0.5); ctx.lineTo(w, gy + 0.5); ctx.stroke();
      const tk = V.ticks(0, viewM, Math.max(4, Math.round(w / 110)));
      ctx.save(); ctx.beginPath(); ctx.rect(0, gy, w, H - gy); ctx.clip();
      V.scale(ctx, { x: 0, y: gy, w, from: 0, to: viewM, major: tk.major.filter((v) => v < viewM * 0.97), minor: tk.minor, fmt: (v) => (v === 0 ? "0" : fLen(v, 3)), size: 13, color: C.ink });
      ctx.restore();
      // dalga
      const amp = Math.min((gy - top) * 0.3, 90), cy = top + (gy - top) * 0.42;
      const k = TAU / (lam * pxm), ph = t * 2.4;
      ctx.save();
      const grd = ctx.createLinearGradient(0, 0, w, 0);
      grd.addColorStop(0, rgba(C.ink, 0.15)); grd.addColorStop(0.08, rgba(C.ink, 0.95)); grd.addColorStop(0.92, rgba(C.ink, 0.95)); grd.addColorStop(1, rgba(C.ink, 0.15));
      ctx.strokeStyle = grd; ctx.lineWidth = 2.4; ctx.lineJoin = "round"; ctx.beginPath();
      for (let x = 0; x <= w; x += 1.5) { const y = cy - amp * Math.sin(k * x - ph); x ? ctx.lineTo(x, y) : ctx.moveTo(x, y); }
      ctx.stroke();
      ctx.strokeStyle = rgba(C.ink, 0.12); ctx.setLineDash([3, 5]); ctx.beginPath(); ctx.moveTo(0, cy); ctx.lineTo(w, cy); ctx.stroke(); ctx.setLineDash([]);
      // iki tepe arası λ ölçüsü
      const lpx = lam * pxm;
      let xc = ((ph + Math.PI / 2) / k) % lpx; if (xc < 0) xc += lpx;
      while (xc < w * 0.12) xc += lpx;
      if (xc + lpx < w - 6) {
        const yb = cy - amp - 16;
        ctx.strokeStyle = C.needle; ctx.lineWidth = 1.5; ctx.beginPath();
        ctx.moveTo(xc, cy - amp - 4); ctx.lineTo(xc, yb - 6); ctx.moveTo(xc + lpx, cy - amp - 4); ctx.lineTo(xc + lpx, yb - 6);
        ctx.moveTo(xc, yb); ctx.lineTo(xc + lpx, yb); ctx.stroke();
        [[xc, 1], [xc + lpx, -1]].forEach(([x, d]) => { ctx.fillStyle = C.needle; ctx.beginPath(); ctx.moveTo(x, yb); ctx.lineTo(x + 7 * d, yb - 4); ctx.lineTo(x + 7 * d, yb + 4); ctx.fill(); });
        const lab = "λ = " + fLen(lam, 3);
        ctx.font = `700 15px ${FONT.display}`;
        const tw = ctx.measureText(lab).width;
        ctx.fillStyle = C.stage; ctx.fillRect(xc + lpx / 2 - tw / 2 - 6, yb - 10, tw + 12, 18);
        V.text(ctx, lab, xc + lpx / 2, yb + 5, { color: C.needle, size: 15, align: "center", font: FONT.display, weight: 700 });
      } else {
        V.text(ctx, "λ = " + fLen(lam, 3), w / 2, top + 4, { color: C.needle, size: 15, align: "center", font: FONT.display, weight: 700 });
      }
      ctx.restore();
      // anten: çeyrek dalga, toprak düzlemi üzerinde, gerçek ölçekte
      const ax = w * (w < 520 ? 0.78 : 0.8), ah = (lam / 4) * pxm;
      ctx.strokeStyle = rgba(C.ink, 0.95); ctx.lineWidth = 3; ctx.lineCap = "round";
      ctx.beginPath(); ctx.moveTo(ax, gy); ctx.lineTo(ax, gy - ah); ctx.stroke();
      ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(ax - 22, gy - 1); ctx.lineTo(ax + 22, gy - 1); ctx.stroke();
      V.dot(ctx, ax, gy - ah, 3.5, C.ink);
      ctx.strokeStyle = rgba(C.needle, 0.8); ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(ax + 12, gy - ah); ctx.lineTo(ax + 18, gy - ah); ctx.moveTo(ax + 15, gy - ah); ctx.lineTo(ax + 15, gy); ctx.stroke();
      {
        const lab = "λ/4 = " + fLen(lam / 4, 3);
        ctx.font = `700 14px ${FONT.display}`;
        const tw = ctx.measureText(lab).width, left = ax + 22 + tw > w - 4;
        V.text(ctx, lab, left ? ax - 10 : ax + 22, gy - Math.max(ah / 2, 10) + 5, { color: C.ink, size: 14, font: FONT.display, weight: 700, align: left ? "right" : "left" });
      }
      V.text(ctx, "anten", ax, gy + 34, { color: C.ink2, size: 12, align: "center" });
      // ölçek nesnesi: görünüme en iyi oturanı
      const avail = gy - top - 10;
      let best = null, bs = 1e9;
      OBJECTS.forEach((o) => {
        const px = o.s * pxm, wpx = objWidth(o, px);
        if ((o.horiz ? wpx > w * 0.6 : px > avail) || px < 14 || wpx > w * 0.6) return;
        const score = Math.abs(Math.log((o.horiz ? wpx / w : px / avail) / 0.45));
        if (score < bs) { bs = score; best = o; }
      });
      if (best) {
        const px = best.s * pxm, ox = w * 0.06;
        drawObject(ctx, best, ox, gy, px);
        V.text(ctx, `${best.n} (${fLen(best.s, 3)})`, ox, gy + 34, { color: C.ink2, size: 12 });
      }
    }
    const st = canvas(cv, () => draw(performance.now() / 1000));
    const lp = loop((dt, t) => { shown = Math.exp(Math.log(shown) + (Math.log(f) - Math.log(shown)) * Math.min(1, dt * 10)); draw(t); });
    upd();
    return { enter() { lp.start(); }, leave() { lp.stop(); if (stream) { stream.stop(); stream = null; listen.set(false); upd(); } } };
  };

  /* ================= 3. Kıvılcımdan yazılıma ================= */
  const EVENTS = [
    { y: 1864, lab: "1864", t: "Maxwell: ışık bir dalgadır", d: "James Clerk Maxwell, elektrik ve manyetizmayı tek bir kuramda birleştiren makalesini Aralık 1864'te Royal Society'de okur (yayın 1865). Denklemleri, ışık hızında yayılan elektromanyetik dalgaları öngörür: ışık da bunlardan biridir.", art: "maxwell" },
    { y: 1886, lab: "1886–1888", t: "Hertz'in kıvılcımı", d: "Heinrich Hertz, Karlsruhe'deki laboratuvarında bir kıvılcım aralığıyla dalga üretir; odanın öbür ucundaki tel halkanın ucunda minik bir kıvılcım çakar. 1887–1888 makaleleriyle dalgaların gerçekten var olduğunu ve sonlu hızla yayıldığını gösterir.", art: "hertz" },
    { y: 1895, lab: "1894–1901", t: "Marconi ve Atlantik", d: "Guglielmo Marconi 1894'te telsiz telgraf denemelerine başlar, 1896'da İngiltere'de patent başvurusu yapar. 12 Aralık 1901'de Cornwall'daki Poldhu'dan gönderilen Mors \"S\" harfini (· · ·) Kanada'daki Signal Hill'de uçurtma anteniyle duyduğunu açıklar. 1909 Nobel Fizik Ödülü'nü Ferdinand Braun ile paylaşır.", art: "marconi" },
    { y: 1918, lab: "1918", t: "Süperheterodin alıcı", d: "Edwin Armstrong, gelen sinyali bir yerel osilatörle karıştırıp sabit bir ara frekansa indiren alıcıyı geliştirir (ABD patenti 1920; Lucien Lévy ve Walter Schottky de benzer fikirler üzerinde çalışır). Bugünkü SDR'ların çoğu bu fikrin yazılımdaki torunudur.", art: "superhet" },
    { y: 1933, lab: "1933", t: "Geniş bantlı FM", d: "Armstrong, Aralık 1933'te frekans modülasyonu patentlerini alır; 1935'te sistemini mühendislere tanıtır. Parazitten etkilenmeyen, yüksek kaliteli ses taşıyan FM, bugünkü 87,5–108 MHz yayınlarının atasıdır.", art: "fm" },
    { y: 1947, lab: "1947", t: "Transistör", d: "Bell Laboratuvarları'nda John Bardeen ve Walter Brattain, William Shockley'nin ekibinde ilk nokta temaslı transistörü çalıştırır (16 Aralık 1947). Üçü 1956 Nobel Fizik Ödülü'nü alır. Lambalar yerini küçük, serin, ucuz yarı iletkenlere bırakır.", art: "transistor" },
    { y: 1954, lab: "1954", t: "Cep radyosu", d: "İlk ticari transistörlü radyo Regency TR-1, Ekim 1954'te duyurulur ve Kasım'da 49,95 dolara satışa çıkar (transistörleri Texas Instruments yapar). Radyo cebe girer.", art: "pocket" },
    { y: 1990, lab: "1990–1995", t: "SpeakEasy", d: "ABD'de DARPA ve Hava Kuvvetleri'nin SpeakEasy programı (I. aşama 1990–1995), 2 MHz–2 GHz arasında farklı telsiz türlerini tek bir yeniden programlanabilir cihazla konuşturmayı hedefler: dalga biçimi artık bir yazılımdır.", art: "speakeasy" },
    { y: 1992, lab: "1991–1992", t: "\"Software radio\"", d: "Joseph Mitola III, 1991'de \"software radio\" (yazılım radyosu) terimini kullanır ve 1992'de bu konudaki ilk IEEE makalesini yayımlar. Fikir: anteni ADC'ye olabildiğince yaklaştır, gerisini yazılım yapsın. (Terim 1984'te E-Systems'te de geçmişti.)", art: "mitola" },
    { y: 2001, lab: "2001", t: "GNU Radio", d: "Eric Blossom, John Gilmore'un desteğiyle GNU Radio'yu başlatır: sinyal işleme bloklarını birbirine bağlayarak radyo kurmaya yarayan özgür yazılım çatısı.", art: "gnuradio" },
    { y: 2004, lab: "2004", t: "USRP", d: "Matt Ettus, GNU Radio için USRP'yi tasarlar ve 2004'te Ettus Research'ü kurar. Araştırmacılar ve öğrenciler ilk kez uygun fiyatlı, açık bir SDR donanımına kavuşur.", art: "usrp" },
    { y: 2012, lab: "2012", t: "RTL-SDR dönemi", d: "Eric Fry, Antti Palosaari ve Osmocom geliştiricileri (özellikle Steve Markgraf), Realtek RTL2832U çipli ucuz DVB-T TV çubuklarının ham IQ örneklerini bilgisayara aktarabildiğini gösterir. Birkaç yüz liralık bir USB çubuk, yaklaşık 24–1766 MHz'i dinleyen bir SDR olur.", art: "rtl" },
  ];

  // her olayın küçük canlandırması: (ctx, w, h, t)
  const ART = {
    maxwell(ctx, w, H, t) {
      // E (fildişi, dikey) ve B (soluk, eğik "derinlik") alanları birlikte ilerler
      const cy = H / 2, amp = H * 0.28, k = TAU / (w * 0.42), sk = 0.45;
      ctx.strokeStyle = rgba(C.ink, 0.25); ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(10, cy); ctx.lineTo(w - 10, cy); ctx.stroke();
      for (let x = 14; x < w - 14; x += 9) {
        const s = Math.sin(k * x - t * 3);
        ctx.strokeStyle = rgba(C.ink, 0.6); ctx.lineWidth = 1.2; ctx.beginPath(); ctx.moveTo(x, cy); ctx.lineTo(x, cy - amp * s); ctx.stroke();
        ctx.strokeStyle = rgba(C.ink2, 0.35); ctx.beginPath(); ctx.moveTo(x, cy); ctx.lineTo(x - amp * s * sk, cy + amp * s * sk); ctx.stroke();
      }
      ctx.lineWidth = 2.2;
      ctx.strokeStyle = C.ink; ctx.beginPath();
      for (let x = 14; x < w - 14; x += 2) { const y = cy - amp * Math.sin(k * x - t * 3); x > 14 ? ctx.lineTo(x, y) : ctx.moveTo(x, y); } ctx.stroke();
      ctx.strokeStyle = C.ink2; ctx.beginPath();
      for (let x = 14; x < w - 14; x += 2) { const s = Math.sin(k * x - t * 3); const X = x - amp * s * sk, Y = cy + amp * s * sk; x > 14 ? ctx.lineTo(X, Y) : ctx.moveTo(X, Y); } ctx.stroke();
      V.text(ctx, "E", 18, cy - amp - 6, { color: C.ink, size: 16, font: FONT.display, weight: 800 });
      V.text(ctx, "B", w - 18, cy + amp * 0.62, { color: C.ink2, size: 16, font: FONT.display, weight: 800, align: "right" });
      V.text(ctx, "→ c", w - 16, cy - 8, { color: C.ink2, size: 14, align: "right", font: FONT.display, weight: 700 });
    },
    hertz(ctx, w, H, t) {
      const cy = H * 0.55, x1 = w * 0.22, x2 = w * 0.8;
      const ph = (t * 0.8) % 1, fire = ph < 0.08;
      // verici: iki kol ve küreler
      ctx.strokeStyle = C.ink; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.moveTo(x1 - 70, cy); ctx.lineTo(x1 - 7, cy); ctx.moveTo(x1 + 7, cy); ctx.lineTo(x1 + 70, cy); ctx.stroke();
      [[x1 - 74, 12], [x1 + 74, 12], [x1 - 9, 5], [x1 + 9, 5]].forEach(([x, r]) => { ctx.fillStyle = C.ink; ctx.beginPath(); ctx.arc(x, cy, r, 0, TAU); ctx.fill(); });
      // halkalar (dalga cepheleri)
      for (let k = 0; k < 4; k++) {
        const r = ((ph + k / 4) % 1) * (x2 - x1);
        ctx.strokeStyle = rgba(C.ink, 0.5 * (1 - r / (x2 - x1))); ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.arc(x1, cy, r, -0.9, 0.9); ctx.stroke();
      }
      // alıcı halka
      ctx.strokeStyle = C.ink2; ctx.lineWidth = 2.5; ctx.beginPath(); ctx.arc(x2, cy, 26, -Math.PI / 2 + 0.18, -Math.PI / 2 - 0.18 + TAU); ctx.stroke();
      const arrive = ((ph + 0.75) % 1) < 0.08 || ((ph + 0.5) % 1) < 0.05;
      const spark = (x, y, s, on) => {
        if (!on) return;
        ctx.save(); ctx.shadowColor = "#fff"; ctx.shadowBlur = 14; ctx.strokeStyle = "#fffaf0"; ctx.lineWidth = 1.6; ctx.beginPath();
        ctx.moveTo(x - s, y); for (let i = 1; i <= 4; i++) ctx.lineTo(x - s + (2 * s * i) / 4, y + (i % 2 ? -1 : 1) * s * 0.6 * Math.random()); ctx.stroke(); ctx.restore();
      };
      spark(x1, cy, 5, fire);
      spark(x2, cy - 26, 4, arrive);
      V.text(ctx, "verici", x1, cy + 44, { color: C.ink2, size: 12, align: "center" });
      V.text(ctx, "alıcı halka", x2, cy + 48, { color: C.ink2, size: 12, align: "center" });
    },
    marconi(ctx, w, H, t) {
      const gy = H * 0.78, xa = w * 0.12, xb = w * 0.88;
      ctx.strokeStyle = rgba(C.ink, 0.35); ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(0, gy); ctx.quadraticCurveTo(w / 2, gy - H * 0.12, w, gy); ctx.stroke();
      for (let k = 0; k < 7; k++) { const x = w * 0.3 + k * w * 0.06; ctx.strokeStyle = rgba(C.ink2, 0.3); ctx.beginPath(); ctx.moveTo(x, gy - H * 0.08 + 6); ctx.lineTo(x + 10, gy - H * 0.08 + 3); ctx.lineTo(x + 20, gy - H * 0.08 + 6); ctx.stroke(); }
      ctx.strokeStyle = C.ink; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(xa, gy); ctx.lineTo(xa, gy - H * 0.5); ctx.moveTo(xa - 14, gy - H * 0.5); ctx.lineTo(xa + 14, gy - H * 0.5); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(xb, gy); ctx.lineTo(xb - 20, gy - H * 0.55); ctx.stroke();
      ctx.fillStyle = C.ink; ctx.beginPath(); ctx.moveTo(xb - 20, gy - H * 0.55); ctx.lineTo(xb - 34, gy - H * 0.62); ctx.lineTo(xb - 20, gy - H * 0.69); ctx.lineTo(xb - 6, gy - H * 0.62); ctx.closePath(); ctx.fill();
      // üç nokta: S
      const ph = (t * 0.35) % 1;
      for (let k = 0; k < 3; k++) {
        const u = ph - k * 0.05; if (u < 0 || u > 1) continue;
        const x = xa + (xb - 20 - xa) * u, y = gy - H * 0.5 - Math.sin(u * Math.PI) * H * 0.18 + (H * 0.5 - H * 0.55) * u;
        V.dot(ctx, x, y, 5, C.ink, 10);
      }
      V.text(ctx, "Poldhu", xa, gy + 20, { color: C.ink2, size: 12, align: "center" });
      V.text(ctx, "Signal Hill", xb - 10, gy + 20, { color: C.ink2, size: 12, align: "center" });
      V.text(ctx, "· · ·  (S)", w / 2, H * 0.16, { color: C.ink, size: 18, align: "center", font: FONT.display, weight: 800 });
    },
    superhet(ctx, w, H, t) {
      // spektrumda bir istasyon ara frekansa iniyor
      const by = H * 0.8, x0 = 16, x1 = w - 16;
      ctx.strokeStyle = rgba(C.ink, 0.5); ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(x0, by + 0.5); ctx.lineTo(x1, by + 0.5); ctx.stroke();
      const ifx = x0 + (x1 - x0) * 0.2, rfs = [0.55, 0.72, 0.88];
      const sel = Math.floor(t / 2.6) % 3, u = L.ease(clamp(((t % 2.6) - 0.6) / 1.2, 0, 1));
      rfs.forEach((r, i) => {
        const x = x0 + (x1 - x0) * r, a = i === sel ? 1 : 0.35;
        const xx = i === sel ? x + (ifx - x) * u : x;
        const hh = H * (i === sel ? 0.42 : 0.3);
        ctx.fillStyle = rgba(C.ink, a * 0.8); ctx.beginPath(); ctx.moveTo(xx - 10, by); ctx.quadraticCurveTo(xx, by - hh * 2, xx + 10, by); ctx.fill();
      });
      ctx.strokeStyle = rgba(C.ink2, 0.7); ctx.setLineDash([3, 3]); ctx.strokeRect(ifx - 18, H * 0.2, 36, by - H * 0.2); ctx.setLineDash([]);
      V.text(ctx, "ara frekans", ifx, H * 0.16, { color: C.ink2, size: 12, align: "center" });
      V.text(ctx, "× yerel osilatör", (x0 + x1) * 0.62, H * 0.16, { color: C.ink, size: 13, align: "center", weight: 700 });
      V.needle(ctx, x0 + (x1 - x0) * rfs[sel], H * 0.24, by - H * 0.24);
    },
    fm(ctx, w, H, t) {
      const cy = H * 0.5, amp = H * 0.3;
      ctx.strokeStyle = rgba(C.ink2, 0.5); ctx.lineWidth = 1.2; ctx.beginPath();
      for (let x = 10; x < w - 10; x += 2) { const y = H * 0.14 - 8 * Math.sin((x / w) * TAU * 2 - t * 2); x > 10 ? ctx.lineTo(x, y + 14) : ctx.moveTo(x, y + 14); } ctx.stroke();
      let ph = 0;
      ctx.strokeStyle = C.ink; ctx.lineWidth = 2; ctx.beginPath();
      for (let x = 10; x < w - 10; x += 1) {
        const m = Math.sin((x / w) * TAU * 2 - t * 2);
        ph += 0.16 + 0.11 * m;
        const y = cy + 12 - amp * Math.sin(ph); x > 10 ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
      }
      ctx.stroke();
      V.text(ctx, "ses", 12, H * 0.1, { color: C.ink2, size: 12 });
      V.text(ctx, "taşıyıcının frekansı sesle birlikte değişir", w / 2, H - 10, { color: C.ink2, size: 12, align: "center" });
    },
    transistor(ctx, w, H, t) {
      const cx = w / 2, by = H * 0.68;
      ctx.fillStyle = rgba(C.ink, 0.22); ctx.fillRect(cx - 80, by, 160, 26);
      V.text(ctx, "germanyum", cx, by + 18, { color: C.ink, size: 12, align: "center", weight: 700 });
      ctx.fillStyle = rgba(C.ink, 0.85); ctx.beginPath(); ctx.moveTo(cx - 36, by - 70); ctx.lineTo(cx + 36, by - 70); ctx.lineTo(cx, by); ctx.closePath(); ctx.fill();
      ctx.strokeStyle = C.ink; ctx.lineWidth = 2;
      [[-1, "yayıcı"], [1, "toplayıcı"]].forEach(([d, n]) => { ctx.beginPath(); ctx.moveTo(cx + d * 3, by - 1); ctx.lineTo(cx + d * 70, by - 90); ctx.stroke(); V.text(ctx, n, cx + d * 76, by - 96, { color: C.ink2, size: 12, align: d < 0 ? "right" : "left" }); });
      ctx.beginPath(); ctx.moveTo(cx, by + 26); ctx.lineTo(cx, by + 46); ctx.stroke();
      V.text(ctx, "taban", cx + 8, by + 44, { color: C.ink2, size: 12 });
      for (let k = 0; k < 5; k++) {
        const u = ((t * 0.7 + k / 5) % 1);
        V.dot(ctx, cx - 70 + u * 67, by - 90 + u * 89, 2.5, C.ink, 6);
        V.dot(ctx, cx + 3 + u * 67, by - 1 - u * 89, 3.2, C.ink, 8);
      }
    },
    pocket(ctx, w, H, t) {
      const rw = Math.min(w * 0.42, H * 0.55), rh = rw * 1.25, x = w * 0.18, y = (H - rh) / 2;
      ctx.fillStyle = rgba(C.ink, 0.9); ctx.beginPath(); ctx.roundRect(x, y, rw, rh, 12); ctx.fill();
      ctx.fillStyle = C.stage;
      for (let r = 0; r < 6; r++) for (let c = 0; c < 6; c++) { ctx.beginPath(); ctx.arc(x + rw * 0.2 + c * rw * 0.12, y + rh * 0.42 + r * rh * 0.085, 2.3, 0, TAU); ctx.fill(); }
      ctx.beginPath(); ctx.arc(x + rw * 0.72, y + rh * 0.2, rw * 0.15, 0, TAU); ctx.fill();
      ctx.strokeStyle = C.needle; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(x + rw * 0.72, y + rh * 0.2); ctx.lineTo(x + rw * 0.72 + Math.cos(t * 0.6) * rw * 0.13, y + rh * 0.2 + Math.sin(t * 0.6) * rw * 0.13); ctx.stroke();
      for (let k = 0; k < 3; k++) {
        const r = 14 + (((t * 0.9 + k / 3) % 1) * w * 0.3);
        ctx.strokeStyle = rgba(C.ink, 0.5 * (1 - (r - 14) / (w * 0.3))); ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(x + rw, y + rh * 0.62, r, -0.6, 0.6); ctx.stroke();
      }
    },
    speakeasy(ctx, w, H, t) {
      const bx = w * 0.3, by = H * 0.28, bw = w * 0.4, bh = H * 0.44;
      ctx.strokeStyle = C.ink; ctx.lineWidth = 2; ctx.strokeRect(bx, by, bw, bh);
      const k = Math.floor(t / 1.4) % 4, names = ["AM", "FM", "FSK", "PSK"];
      ctx.strokeStyle = C.ink; ctx.lineWidth = 1.8; ctx.beginPath();
      let ph = 0;
      for (let x = 0; x <= bw - 20; x += 1) {
        const u = x / (bw - 20); let y;
        if (k === 0) y = Math.sin(u * TAU * 7) * (0.5 + 0.4 * Math.sin(u * TAU * 1.2));
        else if (k === 1) { ph += 0.32 + 0.2 * Math.sin(u * TAU * 1.5); y = Math.sin(ph); }
        else if (k === 2) { ph += Math.floor(u * 6) % 2 ? 0.45 : 0.22; y = Math.sin(ph); }
        else y = Math.sin(u * TAU * 8 + (Math.floor(u * 4) % 2 ? Math.PI : 0));
        const yy = by + bh / 2 - y * bh * 0.32; x ? ctx.lineTo(bx + 10 + x, yy) : ctx.moveTo(bx + 10, yy);
      }
      ctx.stroke();
      names.forEach((n, i) => V.text(ctx, n, bx + (i + 0.5) * (bw / 4), by + bh + 22, { color: i === k ? C.ink : C.muted, size: 14, align: "center", font: FONT.display, weight: 700 }));
      V.text(ctx, "tek donanım, değişen yazılım", w / 2, by - 12, { color: C.ink2, size: 12, align: "center" });
    },
    mitola(ctx, w, H, t) {
      const cy = H * 0.5;
      ctx.strokeStyle = C.ink; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(30, cy + 30); ctx.lineTo(30, cy - 30); ctx.moveTo(18, cy - 40); ctx.lineTo(30, cy - 30); ctx.lineTo(42, cy - 40); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(30, cy); ctx.lineTo(w * 0.3, cy); ctx.stroke();
      ctx.strokeRect(w * 0.3, cy - 20, 54, 40);
      V.text(ctx, "ADC", w * 0.3 + 27, cy + 5, { color: C.ink, size: 14, align: "center", font: FONT.display, weight: 800 });
      ctx.beginPath(); ctx.moveTo(w * 0.3 + 54, cy); ctx.lineTo(w * 0.52, cy); ctx.stroke();
      const lines = ["ayarla(f)", "süz(bw)", "azalt(M)", "demodüle()", "→ ses"];
      lines.forEach((s, i) => {
        const a = clamp((t * 1.2 - i * 0.5) % 5, 0, 1);
        V.text(ctx, s, w * 0.55, cy - 44 + i * 22, { color: rgba(C.ink, 0.25 + 0.75 * a), size: 14, weight: 700 });
      });
      for (let k = 0; k < 4; k++) { const u = (t * 0.8 + k / 4) % 1; V.dot(ctx, 30 + u * (w * 0.3 - 30), cy, 2.5, C.ink, 6); }
    },
    gnuradio(ctx, w, H, t) {
      const B = [["kaynak", 0.04, 0.3], ["karıştır", 0.29, 0.3], ["süz", 0.54, 0.3], ["demodüle", 0.29, 0.68], ["ses", 0.6, 0.68]];
      const bw = w * 0.22, bh = 30;
      const pos = B.map(([n, fx, fy]) => [w * fx, H * fy, n]);
      const links = [[0, 1], [1, 2], [2, 3], [3, 4]];
      links.forEach(([a, b]) => {
        const [x0, y0] = pos[a], [x1, y1] = pos[b];
        const ax = x0 + bw, ay = y0 + bh / 2, bx = x1, byy = y1 + bh / 2;
        ctx.strokeStyle = rgba(C.ink, 0.5); ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(ax, ay); ctx.bezierCurveTo(ax + 40, ay, bx - 40, byy, bx, byy); ctx.stroke();
        const u = (t * 0.7) % 1, mx = (1 - u) ** 3 * ax + 3 * (1 - u) ** 2 * u * (ax + 40) + 3 * (1 - u) * u * u * (bx - 40) + u ** 3 * bx;
        const my = (1 - u) ** 3 * ay + 3 * (1 - u) ** 2 * u * ay + 3 * (1 - u) * u * u * byy + u ** 3 * byy;
        V.dot(ctx, mx, my, 3, C.ink, 8);
      });
      pos.forEach(([x, y, n]) => { ctx.fillStyle = C.panel; ctx.strokeStyle = C.ink2; ctx.lineWidth = 1.2; ctx.beginPath(); ctx.roundRect(x, y, bw, bh, 4); ctx.fill(); ctx.stroke(); V.text(ctx, n, x + bw / 2, y + 20, { color: C.ink, size: 13, align: "center", weight: 700 }); });
    },
    usrp(ctx, w, H, t, s) {
      const bx = w * 0.08, by = H * 0.25, bw = w * 0.38, bh = H * 0.5;
      ctx.fillStyle = rgba(C.ink, 0.12); ctx.strokeStyle = C.ink2; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.roundRect(bx, by, bw, bh, 6); ctx.fill(); ctx.stroke();
      ctx.fillStyle = rgba(C.ink, 0.7); ctx.fillRect(bx + bw * 0.35, by + bh * 0.3, bw * 0.3, bh * 0.4);
      [0.25, 0.75].forEach((f) => { ctx.fillStyle = C.ink; ctx.fillRect(bx - 10, by + bh * f - 4, 12, 8); });
      V.text(ctx, "USRP", bx + bw / 2, by + bh + 20, { color: C.ink2, size: 12, align: "center" });
      artWaterfall(ctx, s, w * 0.54, H * 0.18, w * 0.4, H * 0.64, t);
    },
    rtl(ctx, w, H, t, s) {
      const bx = w * 0.06, by = H * 0.42, bw = w * 0.3, bh = H * 0.17;
      ctx.fillStyle = rgba(C.ink, 0.9); ctx.beginPath(); ctx.roundRect(bx, by, bw, bh, 8); ctx.fill();
      ctx.fillStyle = rgba(C.ink2, 0.8); ctx.fillRect(bx + bw, by + bh * 0.22, bw * 0.22, bh * 0.56);
      ctx.fillStyle = C.stage; ctx.fillRect(bx + bw * 1.04, by + bh * 0.36, bw * 0.12, bh * 0.1); ctx.fillRect(bx + bw * 1.04, by + bh * 0.56, bw * 0.12, bh * 0.1);
      ctx.fillStyle = C.ink2; ctx.beginPath(); ctx.arc(bx - 6, by + bh / 2, 7, 0, TAU); ctx.fill();
      V.text(ctx, "RTL2832U", bx + bw / 2, by + bh / 2 + 5, { color: C.bg, size: 12, align: "center", weight: 700 });
      V.text(ctx, "DVB-T çubuğu", bx + bw / 2, by + bh + 22, { color: C.ink2, size: 12, align: "center" });
      artWaterfall(ctx, s, w * 0.48, H * 0.12, w * 0.47, H * 0.76, t);
    },
  };
  // küçük şelale (USRP ve RTL-SDR görselleri)
  function artWaterfall(ctx, s, x, y, w, h, t) {
    if (!s.wf) { s.wf = new V.Waterfall(128, 90); s.wf.min = -90; s.wf.max = -20; s.row = new Float32Array(128); s.r = DSP.rng(4); s.acc = 0; for (let i = 0; i < 90; i++) artRow(s, i * 0.05); }
    if (t - (s.last || 0) > 0.05) { artRow(s, t); s.last = t; }
    s.wf.draw(ctx, x, y, w, h);
    ctx.strokeStyle = C.line; ctx.lineWidth = 1; ctx.strokeRect(Math.round(x) + 0.5, Math.round(y) + 0.5, Math.round(w), Math.round(h));
  }
  function artRow(s, t) {
    const r = s.r, row = s.row;
    for (let i = 0; i < 128; i++) {
      let p = 10 ** -8.6 * -Math.log(1 - r() * 0.999);
      [[24, 1e-4], [61, 3e-5 * (1 + Math.sin(t * 2))], [96, 2e-4]].forEach(([c, a]) => { const d = (i - c) / 3; p += a * Math.exp(-d * d); });
      if ((t * 1.3) % 3 < 0.5) { const d = (i - 80) / 1.5; p += 5e-5 * Math.exp(-d * d); }
      row[i] = 10 * Math.log10(p);
    }
    s.wf.push(row);
  }

  Demos.timeline = function (stage, slide) {
    const dial = h("canvas.tl-dial", { "aria-label": "Zaman çizelgesi: bir olaya dokunun" });
    const art = h("canvas", { "aria-label": "Olayın canlandırması" });
    const yr = h("div.tl-year"), ttl = h("h3.tl-title"), txt = h("p.tl-text");
    const card = h("div.tl-card", h("div.tl-art", art), h("div.tl-body", yr, ttl, txt));
    const wrap = h("div.fill.tl-wrap", h("div.tl-dialwrap", dial), card);
    const ctrl = h("div.controls");
    stage.append(wrap, ctrl);
    let cur = 0, shownX = null, play = false, playT = 0;
    const artState = {};
    const prevB = h("button.btn", { type: "button", onclick: () => go(cur - 1) }, "‹ Önceki");
    const nextB = h("button.btn", { type: "button", onclick: () => go(cur + 1) }, "Sonraki ›");
    const playB = L.toggle("Kendiliğinden ilerle", false, (v) => { play = v; playT = 0; });
    const cnt = h("span.note-small.tl-count");
    ctrl.append(prevB, nextB, playB, cnt);

    const Y0 = 1855, Y1 = 2022;
    function go(i) {
      cur = (i + EVENTS.length) % EVENTS.length; playT = 0;
      const e = EVENTS[cur];
      yr.textContent = e.lab; ttl.textContent = e.t; txt.textContent = e.d;
      cnt.textContent = `${cur + 1} / ${EVENTS.length}`;
      card.classList.remove("tl-in"); void card.offsetWidth; card.classList.add("tl-in");
    }
    function drawDial() {
      const { ctx, w, h: H } = sd;
      if (!w) return;
      ctx.fillStyle = C.stage; ctx.fillRect(0, 0, w, H);
      const pad = 22, X = (y) => pad + ((y - Y0) / (Y1 - Y0)) * (w - 2 * pad);
      const ly = H - 26;
      const maj = [], min = [];
      const step = w < 600 ? 40 : 20;
      for (let y = 1860; y <= 2020; y += 10) (y % step === 0 ? maj : min).push(y);
      V.scale(ctx, { x: pad, y: ly, w: w - 2 * pad, from: Y0, to: Y1, major: maj, minor: min, fmt: String, size: 14, color: C.ink });
      ctx.strokeStyle = rgba(C.ink, 0.35); ctx.beginPath(); ctx.moveTo(pad, ly + 0.5); ctx.lineTo(w - pad, ly + 0.5); ctx.stroke();
      EVENTS.forEach((e, i) => {
        const x = X(e.y), on = i === cur;
        ctx.fillStyle = on ? C.ink : rgba(C.ink, 0.6);
        ctx.beginPath(); ctx.arc(x, ly - 16, on ? 6 : 4.5, 0, TAU); ctx.fill();
        ctx.strokeStyle = rgba(C.ink, on ? 0.7 : 0.3); ctx.beginPath(); ctx.moveTo(x, ly - 10); ctx.lineTo(x, ly); ctx.stroke();
      });
      const tx = X(EVENTS[cur].y);
      shownX = shownX == null ? tx : shownX + (tx - shownX) * 0.18;
      V.needle(ctx, shownX, 4, ly - 4);
      const lab = EVENTS[cur].lab;
      ctx.font = `800 16px ${FONT.display}`;
      const tw = ctx.measureText(lab).width, right = shownX + tw + 14 > w;
      V.text(ctx, lab, right ? shownX - 10 : shownX + 10, 20, { color: C.needle, size: 16, font: FONT.display, weight: 800, align: right ? "right" : "left" });
    }
    function nearest(x) {
      const pad = 22, w = sd.w;
      let best = 0, bd = 1e9;
      EVENTS.forEach((e, i) => { const d = Math.abs(pad + ((e.y - Y0) / (Y1 - Y0)) * (w - 2 * pad) - x); if (d < bd) { bd = d; best = i; } });
      return best;
    }
    let lastPick = -1;
    L.pointer(dial, { down: (x) => { lastPick = nearest(x); if (lastPick !== cur) go(lastPick); }, move: (x) => { const k = nearest(x); if (k !== cur) go(k); } });
    function drawArt(t) {
      const { ctx, w, h: H } = sa;
      if (!w) return;
      ctx.fillStyle = C.stage; ctx.fillRect(0, 0, w, H);
      const e = EVENTS[cur];
      ctx.save();
      ART[e.art](ctx, w, H, t, (artState[e.art] = artState[e.art] || {}));
      ctx.restore();
    }
    const sd = canvas(dial, () => drawDial());
    const sa = canvas(art, () => drawArt(performance.now() / 1000));
    go(0);
    const lp = loop((dt, t) => {
      if (play) { playT += dt; if (playT > 7) go(cur + 1); }
      drawDial(); drawArt(t);
    });
    return { enter() { lp.start(); }, leave() { lp.stop(); } };
  };

  window.GUIDE_SCENARIOS = Object.assign(window.GUIDE_SCENARIOS || {}, {
    spektrum: [{ click: "=Radyo" }, { wait: 1200 }, { click: "=FM" }, { wait: 1300 }, { tap: "css:.em-fill canvas", at: [0.45, 0.62] }],
    "dalga-boyu": [{ slide: "label:Frekans", to: Math.log(1e6) }, { wait: 500 }, { click: "=Wi-Fi" }],
    tarih: [{ click: "Sonraki" }, { wait: 1400 }, { click: "Sonraki" }],
  });
})();

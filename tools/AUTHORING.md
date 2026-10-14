# Bölüm yazım kılavuzu

"Dalgadan Sayıya" (SDR ve IQ verisi üzerine Türkçe, etkileşimli sunum) için bölüm yazanların uyacağı kurallar.
Önce `PLAN.md` dosyasını (tasarım planı ve slayt listesi) oku. Sonra şu dosyaları oku:
`js/lib.js`, `js/viz.js`, `js/dsp.js`, `js/signals.js`, `js/music.js`, `js/audio.js`, `js/demos/ch0.js` (örnek demo),
`tools/parts/ch0.html` (örnek slayt), `css/style.css`, `css/demos.css`.

## Dosya sahipliği (paralel çalışılıyor: başkasının dosyasına dokunma)

Her bölüm yalnızca kendi dosyalarını yazar:
- `tools/parts/chN.html`: slaytlar (`<section class="slide" ...>`)
- `js/demos/chN.js`: demolar + hayalet el senaryoları
- `css/demos-chN.css`: bölüme özel stiller (gerekirse)
- `tools/parts/chN.narration.json`: anlatım metni taslakları `{ "slayt-id": "metin", ... }`

**Ortak dosyaları değiştirme:** `index.html`, `js/lib.js`, `js/viz.js`, `js/dsp.js`, `js/signals.js`, `js/music.js`,
`js/audio.js`, `js/app.js`, `js/guide.js`, `js/glossary.js`, `css/style.css`, `css/demos.css`.
Bunlarda bir eksik ya da hata görürsen raporunda yaz. Gerekirse kendi dosyanda yerel bir yardımcı yaz.
`index.html`'i elle düzenleme; `python3 tools/assemble.py` ile parçalardan yeniden kurulur.

## Slayt HTML'i

```html
<section class="slide" data-chapter="3" data-demo="phasor" id="fazor">
  <div class="text">
    <h2>Dönen ok</h2>
    <p class="lead">Tek cümlelik, merak uyandıran giriş.</p>
    <p>Açıklama: önce sezgi (dönen ok, gölge, döner kapı), formül değil.</p>
    <details class="more"><summary>Daha fazla: formül</summary>
      <p>Formüller ve ayrıntılar yalnızca burada.</p>
      <span class="formula">x(t) = A·cos(2πft + φ)</span>
    </details>
    <p class="try">Kullanıcının ilk yapacağı hamle, tek cümle.</p>
  </div>
  <div class="stage"></div>
  <aside class="notes"><ul>
    <li>Sunucu notu: sunarken söylenecek ek bilgi, olası soru ve cevaplar.</li>
  </ul></aside>
</section>
```

- `data-chapter`: bölüm numarası (0–7). Bölüm etiketi otomatik eklenir, sen yazma.
- `data-demo`: `Demos.<ad>` fonksiyonunun adı. `id`: PLAN.md'deki slayt kimliği (değiştirme).
- Tüm genişliği kaplayan sahne gerekiyorsa `class="slide wide"` kullan (metin üstte, sahne altta).
- Metin sütunu kısa tutulur: bir `lead` ve 2–4 kısa paragraf ya da liste, en fazla 1–2 `details.more`, ardından bir `.try`.
  Sütun 1440×860'ta kaydırma gerektirmemeli; 1180×820'de en fazla az bir kaydırma olabilir.
- Renk dili metinde de geçerli: `<span class="ci">I</span>`, `<span class="cq">Q</span>`, `.camp` genlik, `.cph` faz,
  `.cn` gürültü, `.cr` ibre (kırmızı).
- Sözlük terimleri (`js/glossary.js`) otomatik işaretlenir. Listede olmayan önemli bir terim kullanırsan raporunda
  "sözlüğe eklenmeli: terim — tanım — Vikipedi bağlantısı" biçiminde yaz.

## Türkçe yazım

- Hedef kitle: teknik merakı olan ama sinyal işleme eğitimi almamış biri. Önce sezgi, sonra (isteğe bağlı) formül.
- Sade, etken çatılı cümleler; günlük Türkçe. Yerleşik İngilizce terim (IQ, FFT, SDR, LNA) ilk geçtiği yerde Türkçe
  açıklamasıyla gelir: "FFT (hızlı Fourier dönüşümü)".
- Ondalık ayırıcı virgül: 2,4 MS/sn; 100,1 MHz. Binlik ayırıcı nokta: 2.048.000. Birimlerle sayı arasında boşluk.
- Başlıklar cümle düzeninde (yalnızca ilk harf büyük); BÜYÜK HARFLİ etiket yok.
- Satır içi `—` ile kurulmuş "X — Y" etiket kalıbı kullanma.
- **Doğruluk zorunlu.** Tarih, frekans bandı, donanım özelliği ve yasal bilgi yazmadan önce web'de doğrula
  (WebSearch/WebFetch araçlarını ToolSearch ile yükle). Emin olmadığını yazma ya da "yaklaşık" de ve kaynağını
  sunucu notuna ekle. Raporunda kullandığın kaynakları listele.
- Ekranda gösterilen her sayı hesaplanır ya da ölçülür (FFT çözünürlüğü, BER, filtre kesimi, dosya boyutu…), tahmin edilmez.

## Demo API

```js
(function () {
  const { C, FONT, rgba, h, canvas, loop, clamp, slider, seg, toggle, num, hz } = L;
  Demos.phasor = function (stage, slide) {
    const cv = h("canvas", { "aria-label": "…" });
    const fill = h("div.fill", cv);
    const ctrl = h("div.controls");
    stage.append(fill, ctrl);
    const st = canvas(cv, draw);             // yeniden boyutlanınca draw(st) çağrılır (ilk çağrı ertelenir)
    function draw() { const { ctx, w, h } = st; /* … */ }
    const lp = loop((dt, t) => { /* güncelle */ draw(); });
    return { enter() { lp.start(); }, leave() { lp.stop(); /* sesi durdur */ } };
  };
  // hayalet el senaryoları
  window.GUIDE_SCENARIOS = Object.assign(window.GUIDE_SCENARIOS || {}, {
    fazor: [{ slide: "label:Frekans", to: 3 }, { wait: 800 }, { click: "Q'yu kapat" }],
  });
  // nabız halkası ilk adımdan farklı bir öğeye konacaksa:
  window.GUIDE_TARGETS = Object.assign(window.GUIDE_TARGETS || {}, { /* "slayt-id": "css:seçici" */ });
})();
```

- Demo, slayta ilk girişte bir kez kurulur; `enter`/`leave` görünürlükte çağrılır. Döngüler yalnızca `enter` ile
  `leave` arasında çalışır. `leave` içinde ses akışlarını durdur.
- Tuvaller `L.canvas` ile kurulur (yüksek DPI, kendini boyutlar). `canvas()`'ın ilk `onResize` çağrısı mikro göreve
  ertelenir; bunu bozacak bir şey yapma (`const st = canvas(...)` atanmadan `st`'yi kullanan kod yazma).
- Ortak çizimler: `V.spectrum`, `V.dbGrid`, `V.Waterfall` (şelale), `V.scale` (kadran skalası), `V.ticks`,
  `V.iqPlane`, `V.arrow`, `V.dot`, `V.needle` (kırmızı ibre), `V.wave`, `V.frame`, `V.text`. Spektrum ve şelalede
  **yalnızca** radyum renk haritası (`L.cmap`, `L.LUT`, `V.Waterfall`, `V.spectrum`) kullanılır.
- Kontroller: `L.slider({label, min, max, step, value, fmt, oninput, cls, log})` (aria-label = label;
  `cls: "ci"|"cq"|"cn"|"cph"|"cr"` renkli düğme), `L.seg([[key, "Etiket"], …], value, onchange)`,
  `L.toggle("Etiket", value, onchange, "ci"|"cq")`, `h("button.btn", …)`. Kontroller `div.controls` içinde
  (sahnenin altında; üstte olacaksa `div.controls.top`). Sayısal okumalar için `.readouts > .readout > .k + .v`.
- Sinyaller: `DSP.*` (FFT/spectrum, NCO, mix, FIR, firBandpass, CFIR, Decimator, amDemod, FMDemod, mapBits,
  demapSymbols, awgn, berTheory, readers…), `Signals.Band` (sentetik bant), `Signals.Receiver` (ayar + süz + azalt +
  demodüle), `Signals.AudioFifo`, `Music.melody/voice/morse/hiss`.
- Performans: 60 fps hedef. Ağır hesap (büyük FFT, uzun FIR) kare başına sınırlı tutulur. 1024 noktalı FFT ~0,12 ms;
  5 istasyonlu 240 kHz bant + alıcı gerçek zamanın ~%6'sı.

## Ses

- Ses yalnızca kullanıcı etkileşimiyle başlar. Sesli demolarda bir "Dinle" aç/kapa düğmesi olsun
  (`L.toggle("Dinle", false, on => …)`); açılınca `stream = Sound.stream(slide, fill)` ile kesintisiz akış başlat,
  kapanınca ya da `leave`'de `stream.stop()`.
  `fill(out, rate)` her çağrıda `out` (Float32Array, varsayılan 48 kHz) dizisini −1…1 aralığında doldurur.
  Hızı değiştirmek için `Sound.stream(slide, fill, { rate: 48000 })`.
- Ses bağlamı kilitliyken (kullanıcı hiç dokunmadıysa) `Sound.stream` görsel tarafı bozmaz; ekranda
  "Sesi açmak için dokunun" uyarısı çıkar. Bu yüzden hayalet el "Dinle"ye basabilir.
- Kısa sesler için `Sound.play(samples, rate)`.
- Anlatım çalarken demo sesi otomatik kısılır; sen ayrıca bir şey yapma.

## Hayalet el senaryosu

Her slaytın bir senaryosu olmalı: deneyin **ilk hamlesini** gerçek kontrollerle bir kez oynar (2–4 adım, ~3–5 sn).
Bulucular: `"=Metin"` tam eşleşen düğme, `"Metin"` ile başlayan düğme (yalnızca `.stage` içindeki
`button`/`[role=button]`), `"label:x"` aria-label'ı x olan `input`, `"aria:x"` aria-label'ı x olan öğe, `"css:x"` seçici.
Adımlar: `{click}`, `{slide, to}` (kaydırıcı), `{tap, at:[fx,fy]}` (tuvale dokunma), `{drag, path:[[fx,fy],…]}` (öğe
dikdörtgenine göre sürükleme; pointerdown/move/up olayları üretir), `{move}` (yalnızca gösterir), `{wait: ms}`.
Senaryolardaki her hedef sayfada gerçekten bulunmalı; otomatik denetlenecek.

Tuval sürükleme demoları `L.pointer(cv, {down, move, up, hover})` kullanırsa hayalet elin sentetik olaylarıyla da çalışır.

## Anlatım metni taslağı (`tools/parts/chN.narration.json`)

Her slayt için 20–40 saniyelik (≈ 55–90 kelime) Türkçe anlatım. Ekrandaki metni okumaz; aynı fikri konuşur gibi anlatır
ve deneyde neye bakılacağını söyler. Kısaltma, sayı ve birimler okunduğu gibi yazılır:

| Yazılış | Okunuş |
| --- | --- |
| SDR | es di ar |
| RTL-SDR | ar ti el es di ar |
| IQ, I, Q | ay ku, ay, ku |
| FFT | ef ef ti (ya da "hızlı Fourier dönüşümü") |
| ADC | ey di si |
| LNA, LO | el en ey, el o |
| AM, FM, NFM | ey em, ef em, dar bant ef em |
| SNR | es en ar (ya da "sinyal gürültü oranı") |
| BER | "bit hata oranı" |
| BPSK, QPSK, QAM | bi pi es key, ku pi es key, kam |
| ASK, FSK | ey es key, ef es key |
| dB, dBFS | desibel, desibel tam ölçek |
| Hz, kHz, MHz, GHz | hertz, kilohertz, megahertz, gigahertz |
| MS/sn | saniyede milyon örnek |
| 100,1 MHz | yüz virgül bir megahertz |
| 2,4 MS/sn | saniyede iki virgül dört milyon örnek |
| 1024 | bin yirmi dört |
| HackRF, USRP, PlutoSDR | hek ar ef, yu es ar pi, pluto es di ar |
| ADS-B, NOAA, APT | ey di es bi, noa, ey pi ti |
| GPS, GSM, Wi-Fi | ci pi es, ci es em, vay fay |
| BTK | be te ka |
| cu8 | si yu sekiz |
| Maxwell, Hertz, Marconi, Fourier, Nyquist, Hann | maksvel, herts, markoni, furiye, naykuist, han |

Rakam kullanma, sayıları yazıyla yaz ("yüz megahertz", "iki bin on iki").

## Doğrulama (bitirmeden önce zorunlu)

1. `node --check js/demos/chN.js`
2. `python3 tools/assemble.py`
3. Ekran görüntüleri (yalnızca kendi slaytların, üç boyut):
   `NODE_PATH=<SCRATCH>/node_modules node tools/shoot.js <SCRATCH>/shots-chN <id1,id2,…>`
   Görüntüleri Read ile aç ve incele: taşma, üst üste binme, okunmayan yazı, boş tuval, kırpılan kontrol olmasın.
   390 genişlikte sahne metnin altında, kontroller sarılarak sığmalı. Konsolda hata kalmasın (başka bölümlerin
   hataları seni ilgilendirmez, ama raporla).
4. Etkileşimi dene: kendi küçük playwright betiğinle (aynı NODE_PATH) kaydırıcıları değiştir, düğmelere bas,
   hayalet el senaryosunu `window.__rehber.find` ile denetle; sonra yeniden ekran görüntüsü al.
5. Ölçülmesi gereken sayıları (BER, kesim, çözünürlük) gerçekten ölç; raporla.

## Rapor

Bitince kısa bir rapor ver: yazdığın slaytlar ve deneyleri, doğruladığın olgular ve kaynakları, ölçtüğün değerler,
sözlüğe eklenmesi gereken terimler, ortak dosyalarda gördüğün sorunlar, test edemediklerin.

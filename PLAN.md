# Dalgadan Sayıya: plan

Yazılım tanımlı radyo (SDR) ve IQ verisi üzerine Türkçe, statik, etkileşimli sunum.
Altyapı `../yz_whatis`'ten uyarlanır (app/lib/narrator/guide/glossary, deploy/serve, .htaccess).

## Tasarım planı

**Fikir: "Skala camı".** Eski bir radyonun arkadan aydınlatılmış frekans skalası ile bir
spektrum analizörünün şelale ekranı bir arada. Derin petrol rengi bir cihaz paneli, üzerinde
fildişi rengi skala baskısı, kırmızı bir ayar ibresi. Cesaret tek bir yerde harcanır: şelale ve
kadran. Geri kalan her şey sakin ve disiplinli kalır.

### Renk (sabit renk dili)

| Rol | Ad | Hex |
| --- | --- | --- |
| Zemin | Cihaz paneli (derin petrol) | `#0e1a1f` |
| Sahne | Skala camı | `#13242a` |
| Çizgi | Panel çizgisi | `#26404a` |
| Metin | Kadran fildişisi | `#efe9dc` |
| İkincil metin | Soluk fildişi | `#a7b3b0` |
| **I** (gerçek bileşen) | Gök mavisi | `#4dbbff` |
| **Q** (sanal bileşen) | Kehribar | `#ffb23f` |
| Genlik | Fildişi (okun kendisi, zarf) | `#efe9dc` |
| Faz | Nane | `#8ce0b0` |
| Gürültü | Kırçıl gri (tanecikli) | `#7f8c96` |
| Ayar ibresi / imleç | Kadran kırmızısı | `#ff4a3d` |
| Sahte (örtüşmüş) dalga | Lila | `#c7a6ff` |
| Rehber halkası, "Dene" kutusu (yalnızca arayüz) | Pirinç | `#d9b46a` |

- Filtre yanıtı bir kazanç (genlik) eğrisi olduğu için fildişi çizilir.
- I/Q için mavi/kehribar çifti seçildi: renk körlüğünde en iyi ayrışan çift.
- **Şelale renk haritası "radyum":** zemin → mürdüm `#2b1650` → erik `#7a1f7a` → gül `#d9418a` →
  pembe `#ff9e9e` → beyaz `#fff3ea`. I/Q renklerinin hiçbirini içermez; her spektrum ve şelalede aynısı.
- Yasak klişelerden kaçış: siyah + neon yeşil yok, krem + serif + terrakota yok, kart ızgarası yok.

### Tipografi

- **Başlık ve skala yazısı:** Big Shoulders Display. Dar ve endüstriyel; eski kadranlardaki frekans
  baskısını çağrıştırır. Türkçe karakterleri tam destekler.
- **Gövde:** Atkinson Hyperlegible Next. Teknik metinde çok okunaklı ve Türkçeyi destekler.
- **Sayılar:** `font-variant-numeric: tabular-nums`. Frekanslar ve ölçümler hizalı durur.

### Düzen

```
┌──────────────────────────────────────────────────────────────────┐
│ ① Bölüm adı                │ ┌──────────── skala camı ─────────┐ │
│ Başlık                     │ │  deney (tuval)                  │ │
│ Açıklama (≤ 62ch)          │ │                                 │ │
│ + Daha fazla               │ ├─────────────────────────────────┤ │
│ [Dene: … ]  [Göster]       │ │  kontroller                     │ │
│                            │ └─────────────────────────────────┘ │
├──────────────────────────────────────────────────────────────────┤
│ ‹  88 ─┬──┬──┬─ 98 ─┬──┬──┬ 108 ▲(kırmızı ibre)  ›  12/34  🔊 ≡ │
└──────────────────────────────────────────────────────────────────┘
```

- **İlerleme çubuğu bir radyo kadranıdır.** Bölümler kadranın bant etiketleridir (ör. "Dalga",
  "Örnekleme", "IQ"…). Slaytlar skala çentikleridir. Kırmızı ibre geçerli slayta kayar.
- Metin sola hizalı. Sahne sağda, skala camı gibi hafif içten aydınlatılmış bir panel.
- Mobilde tek sütun düzen: önce metin, sonra sahne. Kadran yatay kaydırılabilir şerit olur.

### İlkeler

1. Renk bir sözlüktür: mavi her zaman I, kehribar her zaman Q, kırmızı ibre her zaman "ayarlandığın yer".
2. Önce sezgi, sonra formül. Formüller yalnızca "Daha fazla" bölümlerinde.
3. Her deney duyulabilir: mümkün olan her yerde sinyalin sesi var.
4. Ekrandaki her sayı ölçülür ya da hesaplanır, tahmin edilmez.

## Slayt listesi (35)

| # | id | Başlık | Deney |
| --- | --- | --- | --- |
| 0 | kapak | Dalgadan Sayıya | Canlı şelale; fareyle istasyona gelince belirginleşir ve sesi duyulur |
| 1 | spektrum | Görünmeyen ışık | Radyodan X ışınına kaydırılabilir şerit; FM, GSM, Wi-Fi, GPS, uydu ve havacılık bantları |
| 2 | dalga-boyu | Frekans, dalga boyu, anten | Frekans kaydırıcısı → dalga boyu ve çeyrek dalga anten boyu canlı |
| 3 | tarih | Kıvılcımdan yazılıma | Etkileşimli zaman çizelgesi: Maxwell → Hertz → Marconi → Armstrong → transistör → SDR → RTL-SDR |
| 4 | adc | Dalgayı ölçmek: ADC | Sinüsü örnekle; örnekleme hızı ve bit derinliği; nicemleme hatası grafiği ve sesi |
| 5 | nyquist | Nyquist sınırı ve örtüşme | Frekansı sınırın ötesine çek; noktalar sahte, yavaş bir dalga çizer |
| 6 | vagon-tekerlegi | Geriye dönen tekerlek | Kamera kare hızı ile tekerlek hızı; tekerlek durur ya da geri döner |
| 7 | 100mhz | 100 MHz'i nasıl örnekleriz? | 100 MHz dalga ile saniyede 2,4 milyon örnek; sonraki bölüme köprü |
| 8 | fazor | Dönen ok | Fazör; yatay gölge I (mavi), dikey gölge Q (kehribar) |
| 9 | sarmal | Zamanda bir yay | 3B sarmal, sürükleyerek döndürülür; yandan I, üstten Q |
| 10 | neden-iki | Neden iki sayı? | ±f tonları; Q'yu kapat/aç → spektrumda ayna görüntüsü belirir/kaybolur |
| 11 | genlik-faz | Genlik ve faz | I/Q düzleminde noktayı sürükle → dalga biçimi, genlik, faz |
| 12 | iq-dosyasi | IQ dosyası nedir? | .cu8 ham baytları → çözülen noktalar; örnekleme hızına göre dosya boyutu |
| 13 | fourier | Her sinyal dönen okların toplamı | Epicycle çizimi + harmonik ekleyerek kare dalga |
| 14 | fft | FFT: zamandan frekansa | IQ tamponu → spektrum; FFT boyu, pencere (dikdörtgen/Hann), ortalama; sızıntı |
| 15 | desibel | Desibel | Doğrusal ↔ dB ölçek; dBFS, gürültü tabanı; zayıf sinyal dB'de görünür olur |
| 16 | selale | Şelale ekranı | Akan spektrum; istasyonlar + ara sıra beliren kısa yayınlar |
| 17 | sinyali-bul | Sinyali bul | Mini oyun: kısa yayın belirince tıkla, puan ve tepki süresi |
| 18 | blok-diyagram | Alıcının içi | Anten → LNA → karıştırıcı (LO) → filtre → ADC → IQ; her blokta spektrum |
| 19 | karistirma | Karıştırma: spektrumu kaydırmak | Ayar düğmesi; IQ × e^(−j2πft) → istasyon 0 Hz'e kayar ve duyulur |
| 20 | filtre | Filtrele ve azalt | FIR kesimi ve tap sayısı; frekans yanıtı; azaltma; komşu istasyon sızar ya da kaybolur |
| 20b | bant-geciren | Bant geçiren filtre: yalnızca bir pencere | Spektrumda pencereyi sürükle (merkez + genişlik); alçak/bant geçiren/bant durduran; gerçek (±f ayna) ve karmaşık filtre; süzülen ses; FM bant durduran filtre örneği |
| 21 | kusurlar | Gerçek alıcının izleri | DC sivrisi, IQ dengesizliği (ayna), aşırı yükleme; kaydırıcılarla aç/kapa |
| 22 | donanim | Gerçek donanım | RTL-SDR, HackRF, PlutoSDR, USRP: kaynaklı karşılaştırma ve bant kapsama şeridi |
| 23 | am | AM: genlik modülasyonu | Melodiyi AM'le; IQ'da nefes alan nokta; zarf dedektörü; ses |
| 24 | fm | FM: frekans modülasyonu | Hızlanıp yavaşlayan dönüş; sapma kaydırıcısı; faz farkı demodülatörü; ses |
| 25 | dijital | Bitleri dalgaya yüklemek | ASK, FSK, BPSK, QPSK, 16-QAM; dalga biçimi ve takımyıldız yan yana |
| 26 | takimyildiz | Takımyıldız ve gürültü | SNR kaydırıcısı; noktalar bulutlaşır; canlı BER ve kuramsal eğri |
| 27 | donme | Dönen takımyıldız | Faz kayması ve frekans hatası; "Dönmeyi düzelt" (Costas/döngü) |
| 28 | mesaj | Mesajını gönder | Metin → bit → sembol → IQ → gürültülü kanal → çözülen metin, hatalar işaretli |
| 29 | sembol-hizi | Sembol hızı ve bant genişliği | Sembol hızı ve roll-off kaydırıcısı → spektrum genişliği |
| 30 | galeri | Havada neler var? | Sentetik örnekler: FM yayın, ADS-B, NOAA APT, telsiz (NFM), 433 MHz kumanda; spektrum, şelale, ses |
| 31 | kendi-kaydin | Kendi kaydınızı açın | Sürükle-bırak .cu8/.cs8/.cs16/.cf32/SigMF; yalnızca tarayıcıda işlenir |
| 32 | yasal | Dinlemek serbest, yayın lisanslı | Kısa ve yönlendirici; BTK, amatör telsizcilik belgesi |
| 33 | son | Radyo artık bir yazılım | Kapanış şelalesi; yz.koraytoksoz.com'a bağ ("IQ verisiyle sinyal tanıyan sinir ağları") |

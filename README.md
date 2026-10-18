# Dalgadan Sayıya

**Canlı site: https://egitim.koraytoksoz.com/sdr/** (eski adres https://sdr.koraytoksoz.com buraya yönlendirilir; bütün eğitimler: https://egitim.koraytoksoz.com)

Yazılım tanımlı radyoyu (SDR) ve IQ verisini, radyo dalgasından örneklemeye, I ve Q'dan spektruma, alıcının içinden modülasyona kadar slayt slayt anlatan, Türkçe, etkileşimli bir sunum sitesi. Her slaytta görülüp duyulabilen, oynanabilen bir deney var; bütün sinyaller tarayıcıda üretilir, SDR donanımı gerekmez.

Hazırlayan: **Koray Toksöz**

*An interactive, Turkish-language explainer on software-defined radio and IQ data, with live in-browser DSP experiments. Code: MIT · Content: CC BY 4.0.*

## İçerik

| Bölüm | Deneyler |
| --- | --- |
| 0. Giriş | Canlı FM bandı şelalesi: fareyle bir istasyona gelince sesi duyulur |
| 1. Radyo dalgası | Kaydırılabilir elektromanyetik spektrum, frekans–dalga boyu–çeyrek dalga anten, 1864–2012 zaman çizelgesi |
| 2. Örnekleme | ADC (örnekleme hızı, bit derinliği, nicemleme sesi), Nyquist ve örtüşme, vagon tekerleği etkisi, "100 MHz'i nasıl örnekleriz?" |
| 3. Karmaşık sinyal: I ve Q | Dönen ok ve gölgeleri, döndürülebilir 3B sarmal, neden iki sayı (+f / −f), genlik ve faz, `.cu8` bayt çözücü |
| 4. Spektrum ve şelale | Fourier epicycle'ları, FFT (boy, pencere, sızıntı), desibel, canlı şelale, "Sinyali bul" oyunu |
| 5. Alıcının içi | Tıklanabilir blok diyagram, ayar düğmesiyle karıştırma, filtre ve azaltma, bant geçiren / durduran filtre, alıcı kusurları, donanım karşılaştırması |
| 6. Modülasyon | AM, FM, ASK/FSK/PSK/QAM, takımyıldız ve canlı BER, dönen takımyıldız ve faz kilidi, metni gürültülü kanaldan gönderme, sembol hızı ve bant genişliği |
| 7. Gerçek dünyada | Sentetik FM, ADS-B (CRC'li), NOAA APT (görüntü çözülür), amatör telsiz, 433 MHz kumanda; kendi IQ kaydınızı açma; yasal not |

Ek olarak:
- Yaklaşık 18 dakikalık Türkçe **sesli anlatım**
- Deneyin ilk hamlesini oynayan **hayalet el**
- Terimlerin üzerine gelince açılan **tanım balonları** (yaklaşık 100 terim)
- **Sunucu notları**
- **Kendi kaydınızı açın:** `.cu8`, `.cs8`, `.cs16`, `.cf32` ve SigMF dosyaları yalnızca tarayıcıda işlenir, hiçbir yere yüklenmez

## Çalıştırma

Derleme adımı yok, bağımlılık yok. `index.html` dosyasına çift tıklamak yeterli (file:// ile de çalışır). Ya da önbelleksiz yerel sunucuyla:

```sh
python3 tools/serve.py 8000   # http://localhost:8000
```

## Kısayollar

| Tuş | İşlev |
| --- | --- |
| → / Boşluk, ← | İleri / geri |
| A | Sesli anlatımı aç/kapat (P: duraklat) |
| M | Sesi kapat/aç |
| G | Deney gösterimlerini (hayalet el) aç/kapat |
| N | Sunucu notları |
| T | Açıklama metnini gizle (sunum modu) |
| O | Tüm slaytlar |
| F | Tam ekran |

Her slaytın bağlantısı adres çubuğunda durur (ör. `#takimyildiz`).

## Yapı

- `index.html`: `tools/parts/ch*.html` parçalarından `python3 tools/assemble.py` ile kurulur. Slaytları parçalarda düzenleyin.
- `js/dsp.js`: sinyal işleme: radix-2 FFT, pencereler, NCO, karıştırıcı, FIR (alçak/bant geçiren/bant durduran, RRC), azaltma, AM/FM, PSK/QAM, AWGN, kuramsal BER, IQ dosya okuyucular (cu8, cs8, cs16, cf32, SigMF)
- `js/signals.js`: sentetik radyo bandı (AM, NFM, WFM, Mors, OOK) ve ayarlanabilir alıcı
- `js/music.js`: sentezlenmiş ses kaynakları (ezgi, konuşmaya benzeyen ses, Mors)
- `js/audio.js`: Web Audio akışları, "Sesi açmak için dokunun" uyarısı, anlatım sırasında kısma, ses düzeyi
- `js/lib.js`, `js/viz.js`: ortak yardımcılar, renk dili ve çizimler (spektrum, şelale, kadran skalası, I/Q düzlemi)
- `js/app.js`: slayt motoru (ilerleme çubuğu bir radyo kadranıdır)
- `js/narrator.js`: sesli anlatım (`audio/<slayt-id>.mp3`), `js/guide.js`: hayalet el, `js/glossary.js`: sözlük balonları
- `js/demos/ch*.js`, `css/demos-ch*.css`: bölüm bölüm deneyler
- `tests/`: DSP ve sentetik bant birim testleri
- `tools/`: yerel sunucu, yayın betiği, ekran görüntüsü ve hayalet el denetimi, anlatım metinleri (`narration.json`), yazım kuralları (`AUTHORING.md`)
- `PLAN.md`: tasarım planı (renk dili, tipografi) ve slayt listesi

## Testler

```sh
node tests/dsp.test.js        # 31 test: FFT kutusu, pencereler, filtre kesimleri, FM/AM demodülasyonu, BER, dosya okuyucular
node tests/signals.test.js    # 5 test: sentetik bant ve alıcı
```

Ekran görüntüleri ve hayalet el hedefleri (playwright-core ve Chromium gerekir):

```sh
NODE_PATH=<node_modules> node tools/shoot.js shots all
NODE_PATH=<node_modules> node tools/check-guide.js
```

## Yeniden üretme

- **Sinyaller ve sesler:** Hepsi tarayıcıda, kodla üretilir; projede kayıt dosyası yoktur. "Kendi kaydınızı açın" slaytındaki "Örnek kayıt üret" düğmesi, 4 saniyelik sentetik bir `.cu8` dosyası üretip indirmeye sunar.
- **Anlatım sesleri:** Metinler `tools/narration.json` dosyasındadır (slayt kimliği → metin). Sesler ElevenLabs ile "İrem" sesi (`eleven_multilingual_v2`, Türkçe) kullanılarak üretildi ve `audio/<slayt-id>.mp3` olarak kaydedildi. Sayılar ve kısaltmalar metinde okunduğu gibi yazılıdır ("yüz megahertz", "es di ar").

## Yayınlama

```sh
tools/deploy.sh   # varsayılan koray@koraytoksoz.com → ~/egitim.koraytoksoz.com/sdr/
```

Betik önce `index.html`'i parçalardan kurar ve CSS/JS bağlantılarındaki `?v=` sürüm etiketini yeniler, sonra `rsync` ile yalnızca değişen dosyaları gönderir. `.htaccess` HTTPS yönlendirmesi, sıkıştırma ve önbellek ayarlarını içerir.

## Kaynaklar ve ileri okuma

### Konuyu derinleştirmek için

- Marc Lichtman, **PySDR: A Guide to SDR and DSP using Python** — ücretsiz çevrimiçi kitap; IQ, örnekleme, filtreler, modülasyon. https://pysdr.org
- Travis F. Collins ve diğ., **Software-Defined Radio for Engineers** (Artech House, 2018) — Analog Devices'ın ücretsiz sunduğu, PlutoSDR'la uygulamalı ders kitabı. https://www.analog.com/sdrforengineers
- Richard G. Lyons, **Understanding Digital Signal Processing** (3. baskı, Prentice Hall, 2010) — FFT, pencereler ve karmaşık sinyallere sezgisel giriş.
- **GNU Radio**: sinyal işleme bloklarıyla SDR uygulaması kurmaya yarayan özgür yazılım; belgeler ve öğreticiler. https://www.gnuradio.org
- **RTL-SDR Blog** başlangıç rehberi. https://www.rtl-sdr.com/qsg

### Tarih

- J. C. Maxwell, "A Dynamical Theory of the Electromagnetic Field" (1865). https://en.wikipedia.org/wiki/A_Dynamical_Theory_of_the_Electromagnetic_Field
- Heinrich Hertz. https://en.wikipedia.org/wiki/Heinrich_Hertz
- Guglielmo Marconi. https://en.wikipedia.org/wiki/Guglielmo_Marconi
- Edwin Howard Armstrong ve süperheterodin alıcı. https://en.wikipedia.org/wiki/Edwin_Howard_Armstrong · https://en.wikipedia.org/wiki/Superheterodyne_receiver
- Regency TR-1. https://en.wikipedia.org/wiki/Regency_TR-1
- Yazılım tanımlı radyo (SpeakEasy, Mitola). https://en.wikipedia.org/wiki/Software-defined_radio
- Joseph Fourier. https://en.wikipedia.org/wiki/Joseph_Fourier

### Teknik

- Osmocom rtl-sdr (RTL2832U, örnekleme hızları). https://osmocom.org/projects/rtl-sdr/wiki
- RTL-SDR Blog: RTL-SDR ve V4. https://www.rtl-sdr.com/about-rtl-sdr/
- HackRF One belgeleri. https://hackrf.readthedocs.io/en/latest/hackrf_one.html
- ADALM-PLUTO. https://www.analog.com/en/resources/evaluation-hardware-and-software/evaluation-boards-kits/adalm-pluto.html
- Ettus USRP B210. https://www.ettus.com/all-products/ub210-kit/
- SigMF (Signal Metadata Format). https://sigmf.org
- Analog Devices MT-001, ADC'nin kuramsal SNR'ı (6,02·N + 1,76 dB). https://www.analog.com/media/en/training-seminars/tutorials/MT-001.pdf
- Pencere fonksiyonları. https://en.wikipedia.org/wiki/Window_function
- Gibbs olayı. https://en.wikipedia.org/wiki/Gibbs_phenomenon
- Desibel. https://en.wikipedia.org/wiki/Decibel
- IQ dengesizliği. https://en.wikipedia.org/wiki/IQ_imbalance
- Carson kuralı. https://en.wikipedia.org/wiki/Carson_bandwidth_rule
- Bell 202 modem (1200/2200 Hz). https://en.wikipedia.org/wiki/Bell_202_modem
- Costas döngüsü. https://en.wikipedia.org/wiki/Costas_loop
- Yükseltilmiş kosinüs süzgeci. https://en.wikipedia.org/wiki/Raised-cosine_filter
- ADS-B / Mode S. https://mode-s.org/1090mhz/
- NOAA APT. https://en.wikipedia.org/wiki/Automatic_picture_transmission
- NOAA POES uydularının 2025'te hizmetten çekilmesi (NESDIS). https://www.nesdis.noaa.gov/news/suspension-of-poes-data-users-after-june-16-2025-and-decommissioning
- Meteor-M N2-4 (WMO OSCAR). https://space.oscar.wmo.int/satellites/view/meteor_m_n2_4

### Türkiye'de mevzuat

- Anayasa (md. 22). https://www.mevzuat.gov.tr/mevzuatmetin/1.5.2709.pdf
- Türk Ceza Kanunu (md. 132, 133). https://www.mevzuat.gov.tr/mevzuatmetin/1.5.5237.pdf
- 5809 sayılı Elektronik Haberleşme Kanunu. https://www.mevzuat.gov.tr/mevzuatmetin/1.5.5809.pdf
- BTK, amatör telsizcilik. https://www.btk.gov.tr/amator-telsizcilik
- BTK, Sınıf 1 telsiz cihazları teknik ölçütleri (433 MHz, PMR446). https://www.btk.gov.tr/uploads/pages/sinif1-teknik-olcut.pdf
- Türkiye Radyo Amatörleri Cemiyeti (TRAC). https://www.trac.org.tr/

Sitedeki yasal bilgiler genel bilgilendirme amaçlıdır, hukuki tavsiye değildir.

## Lisans

| Ne | Lisans |
| --- | --- |
| Kaynak kod (`js/`, `css/`, `tools/`, `tests/`, `index.html` içindeki kod) | [MIT](LICENSE) |
| İçerik (slayt metinleri, sunucu notları, sözlük, anlatım metinleri ve sesleri) | [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/deed.tr) |
| Yazı tipleri (Google Fonts'tan yüklenir) | SIL Open Font License 1.1 |
| Creative Commons simgeleri, GitHub simgesi | CC marka kuralları; Octicons MIT |

Sinyallerin ve seslerin tamamı tarayıcıda üretilir; "Neşeye Övgü" (Beethoven) kamu malıdır. Ayrıntılar [LICENSE](LICENSE) dosyasında. GitHub bu çift lisansı "Other" olarak gösterir.

Önerilen atıf:

> Koray Toksöz, Dalgadan Sayıya, https://egitim.koraytoksoz.com/sdr/

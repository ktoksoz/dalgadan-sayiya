/* Sözlük: metindeki anahtar kelimelerin üzerine gelince açılan tanım balonları.
   Her terim slayt başına yalnızca ilk geçtiği yerde işaretlenir. */
(function () {
  const trw = (q) => "https://tr.wikipedia.org/w/index.php?search=" + encodeURIComponent(q);
  const enw = (t) => "https://en.wikipedia.org/wiki/" + t;

  // k: aranacak kökler (küçük harf, Türkçe ekler otomatik kapsanır), t: başlık, d: tanım, u: bağlantı
  const TERMS = [
    { k: ["yazılım tanımlı radyo", "sdr"], t: "Yazılım tanımlı radyo (SDR)", d: "Ayarlama, süzme ve demodülasyon gibi işlerin devre elemanlarıyla değil, sayısallaştırılmış sinyal üzerinde yazılımla yapıldığı radyo.", u: trw("Yazılım tanımlı radyo") },
    { k: ["iq verisi", "iq örne", "iq tampon", "iq dosya", "iq!"], t: "IQ verisi", d: "Sinyalin her an iki sayıyla kaydedilmesi: I (eş fazlı, gerçek bileşen) ve Q (dik fazlı, sanal bileşen). Birlikte genliği, fazı ve frekansın işaretini taşırlar.", u: enw("In-phase_and_quadrature_components") },
    { k: ["eş fazlı"], t: "I: eş fazlı bileşen", d: "In-phase. Sinyalin referans kosinüsle aynı fazdaki kısmı; dönen okun yatay gölgesi.", u: enw("In-phase_and_quadrature_components") },
    { k: ["dik fazlı"], t: "Q: dik fazlı bileşen", d: "Quadrature. Referanstan çeyrek tur (90°) kaymış kısmı; dönen okun dikey gölgesi.", u: enw("In-phase_and_quadrature_components") },
    { k: ["elektromanyetik dalga", "elektromanyetik spektrum", "elektromanyetik"], t: "Elektromanyetik dalga", d: "Birbirini besleyerek ışık hızında yayılan elektrik ve manyetik alan salınımı. Radyo, ışık ve X ışını aynı olgunun farklı frekanslarıdır.", u: trw("Elektromanyetik ışınım") },
    { k: ["frekans"], t: "Frekans", d: "Bir salınımın saniyedeki tekrar sayısı. Birimi hertz (Hz): 1 MHz saniyede bir milyon salınım.", u: trw("Frekans") },
    { k: ["megahertz", "kilohertz", "gigahertz"], t: "Hertz (Hz)", d: "Frekans birimi: saniyede bir salınım. kHz bin, MHz milyon, GHz milyar salınım demektir. Adını Heinrich Hertz'den alır.", u: trw("Hertz") },
    { k: ["dalga boyu"], t: "Dalga boyu", d: "Dalganın bir salınım süresince aldığı yol: ışık hızı ÷ frekans. 100 MHz için yaklaşık 3 metre.", u: trw("Dalga boyu") },
    { k: ["çeyrek dalga"], t: "Çeyrek dalga anten", d: "Boyu dalga boyunun dörtte biri olan tek kutuplu anten. Bir toprak düzlemiyle birlikte o frekansta rezonansa girer.", u: enw("Monopole_antenna") },
    { k: ["anten"], t: "Anten", d: "Elektromanyetik dalgayı devredeki elektrik akımına (ve tersine) çeviren iletken. Boyu, verimli çalıştığı dalga boyuyla ilişkilidir.", u: trw("Anten") },
    { k: ["maxwell"], t: "James Clerk Maxwell", d: "İskoç fizikçi (1831–1879). Elektrik ve manyetizmayı tek kuramda birleştirdi, ışığın elektromanyetik bir dalga olduğunu öngördü.", u: trw("James Clerk Maxwell") },
    { k: ["heinrich hertz", "hertz'in"], t: "Heinrich Hertz", d: "Alman fizikçi (1857–1894). 1886–1888 deneyleriyle radyo dalgalarını üretip algıladı ve Maxwell'i doğruladı.", u: trw("Heinrich Hertz") },
    { k: ["marconi"], t: "Guglielmo Marconi", d: "İtalyan mucit (1874–1937). Telsiz telgrafı ticari bir sisteme dönüştürdü; 1901'de Atlantik'in ötesine sinyal gönderdi. 1909 Nobel (Braun ile).", u: trw("Guglielmo Marconi") },
    { k: ["armstrong"], t: "Edwin Howard Armstrong", d: "Amerikalı mühendis (1890–1954). Süperheterodin alıcıyı (1918) ve geniş bantlı FM radyoyu (1933) geliştirdi.", u: trw("Edwin Howard Armstrong") },
    { k: ["süperheterodin"], t: "Süperheterodin alıcı", d: "Gelen sinyali yerel osilatörle karıştırıp sabit bir ara frekansa indiren alıcı. Filtreleri tek frekansa göre yapmayı mümkün kıldığı için yüz yıldır standarttır.", u: trw("Süperheterodin alıcı") },
    { k: ["rtl-sdr", "rtl2832"], t: "RTL-SDR", d: "Realtek RTL2832U çipli ucuz DVB-T TV alıcılarının ham IQ verdiğinin keşfedilmesiyle (2012) doğan düşük maliyetli SDR alıcı ailesi.", u: enw("Software-defined_radio#RTL-SDR") },
    { k: ["dvb-t"], t: "DVB-T", d: "Avrupa'nın karasal sayısal televizyon yayın standardı. RTL-SDR'lar aslında DVB-T alıcısı olarak üretilmiş USB çubuklardır.", u: trw("DVB-T") },
    { k: ["hackrf"], t: "HackRF One", d: "Great Scott Gadgets'ın açık donanımlı SDR'ı: 1 MHz–6 GHz, 20 MS/sn'ye kadar, 8 bit, yarı çift yönlü (alma veya gönderme).", u: enw("HackRF_One") },
    { k: ["adalm-pluto", "plutosdr", "pluto"], t: "ADALM-PLUTO (PlutoSDR)", d: "Analog Devices'ın eğitim amaçlı SDR'ı: AD9363 çipi, 12 bit ADC, resmî olarak 325 MHz–3,8 GHz, alma ve göndermeyi aynı anda yapabilir.", u: "https://www.analog.com/en/resources/evaluation-hardware-and-software/evaluation-boards-kits/adalm-pluto.html" },
    { k: ["usrp"], t: "USRP", d: "Ettus Research'ün (bugün NI/Emerson) araştırma ve laboratuvar sınıfı SDR ailesi. Modele göre DC–6 GHz, 12–14 bit, yüzlerce MHz bant genişliği.", u: enw("Universal_Software_Radio_Peripheral") },
    { k: ["adc", "analog-sayısal"], t: "ADC (analog-sayısal dönüştürücü)", d: "Sürekli bir gerilimi düzenli aralıklarla ölçüp sayılara çeviren devre. İki temel özelliği: örnekleme hızı ve bit derinliği.", u: trw("Analog-sayısal dönüştürücü") },
    { k: ["örnekleme hızı"], t: "Örnekleme hızı", d: "Saniyede alınan ölçüm (örnek) sayısı. MS/sn: saniyede milyon örnek. IQ'da örnekleme hızı aynı zamanda görülebilen bant genişliğidir.", u: trw("Örnekleme") },
    { k: ["bit derinliği"], t: "Bit derinliği", d: "Her örneğin kaç bitle saklandığı. 8 bit 256 farklı seviye, 12 bit 4096 seviye verir; her bit yaklaşık 6 dB dinamik aralık ekler.", u: enw("Audio_bit_depth") },
    { k: ["nicemleme"], t: "Nicemleme (kuantalama)", d: "Sürekli bir değeri sınırlı sayıda seviyeden en yakınına yuvarlamak. Yuvarlama hatası sinyale gürültü olarak eklenir.", u: enw("Quantization_(signal_processing)") },
    { k: ["sqnr"], t: "SQNR", d: "Sinyalin nicemleme gürültüsüne oranı. Tam ölçekli bir sinüs için ≈ 6,02·N + 1,76 dB (N: bit sayısı); her bit yaklaşık 6 dB ekler.", u: enw("Signal-to-quantization-noise_ratio") },
    { k: ["örtüşme önleyici"], t: "Örtüşme önleyici filtre", d: "ADC'den önce Nyquist sınırının üstündeki frekansları kesen alçak geçiren filtre. Böylece sahte (örtüşmüş) frekanslar oluşmaz.", u: enw("Anti-aliasing_filter") },
    { k: ["ara frekans"], t: "Ara frekans (IF)", d: "Süperheterodin alıcının gelen sinyali kaydırdığı sabit frekans. Klasik FM radyolarda 10,7 MHz, AM radyolarda 455 kHz civarı.", u: enw("Intermediate_frequency") },
    { k: ["vhf", "uhf"], t: "VHF / UHF (ITU bantları)", d: "ITU'nun on katlık radyo bantları: HF 3–30 MHz, VHF 30–300 MHz, UHF 300 MHz–3 GHz, SHF 3–30 GHz.", u: enw("Radio_spectrum") },
    { k: ["nyquist"], t: "Nyquist sınırı", d: "Bir sinyali örneklerden kusursuz geri kurmak için örnekleme hızı en yüksek frekansın iki katından büyük olmalı. Gerçek örneklemede görülebilen en yüksek frekans hızın yarısıdır.", u: trw("Nyquist-Shannon örnekleme teoremi") },
    { k: ["örtüşme", "aliasing"], t: "Örtüşme (aliasing)", d: "Nyquist sınırının üstündeki bir frekansın örneklenince daha düşük, sahte bir frekans gibi görünmesi.", u: trw("Örtüşme (sinyal işleme)") },
    { k: ["vagon tekerleği"], t: "Vagon tekerleği etkisi", d: "Kamera kare hızıyla dönen tekerleğin hızı uyuşunca tekerleğin duruyor ya da geri dönüyor gibi görünmesi; gözle görülen örtüşme.", u: enw("Wagon-wheel_effect") },
    { k: ["fazör", "dönen ok"], t: "Fazör", d: "Sinüs biçimli bir sinyali, sabit hızla dönen bir ok olarak gösterme yolu. Okun boyu genlik, açısı faz, dönüş hızı frekanstır.", u: trw("Fazör") },
    { k: ["karmaşık sayı", "sanal"], t: "Karmaşık sayı", d: "Gerçek ve sanal iki parçadan oluşan sayı: a + jb. Düzlemde bir nokta ya da ok olarak düşünülebilir; çarpma döndürme anlamına gelir.", u: trw("Karmaşık sayı") },
    { k: ["euler"], t: "Euler formülü", d: "e^(jθ) = cos θ + j·sin θ. Dönen bir oku tek bir karmaşık sayıyla yazmayı sağlar: kosinüs I'ya, sinüs Q'ya düşer.", u: trw("Euler formülü") },
    { k: ["atan2"], t: "atan2", d: "İki argümanlı arktanjant: (I, Q) noktasının açısını dört çeyrekte de doğru verir; IQ'dan faz böyle okunur.", u: enw("Atan2") },
    { k: ["genlik"], t: "Genlik", d: "Salınımın büyüklüğü. IQ'da okun boyu: √(I² + Q²).", u: trw("Genlik") },
    { k: ["faz!", "fazı", "fazın", "fazd", "faza", "fazlar"], t: "Faz", d: "Salınımın döngüsünün neresinde olduğu, açı olarak. IQ'da okun yönü: atan2(Q, I).", u: trw("Faz (dalgalar)") },
    { k: ["negatif frekans"], t: "Negatif frekans", d: "Saat yönünde dönen bir fazör. Yalnızca gerçek sinyalde +f ile −f ayırt edilemez; IQ'da edilir.", u: enw("Negative_frequency") },
    { k: ["cu8"], t: ".cu8 biçimi", d: "Her örnek için iki işaretsiz bayt (I, Q), 127,5 merkezli. RTL-SDR'ın rtl_sdr aracının yazdığı ham biçim.", u: "https://github.com/sigmf/SigMF/blob/main/sigmf-spec.md" },
    { k: ["cs16", "cf32", "cs8"], t: "cs8 / cs16 / cf32", d: "Ham IQ biçimleri: işaretli 8 bit tamsayı (HackRF), işaretli 16 bit tamsayı ve 32 bit kayan noktalı sayı. Her örnek önce I sonra Q.", u: "https://github.com/sigmf/SigMF/blob/main/sigmf-spec.md" },
    { k: ["sigmf"], t: "SigMF", d: "Sinyal kayıtları için açık meta veri standardı: ham IQ dosyasının yanında örnekleme hızı, merkez frekans ve veri türünü JSON ile tutar.", u: "https://sigmf.org" },
    { k: ["fourier"], t: "Fourier dönüşümü", d: "Bir sinyali farklı frekanslardaki dönen okların (sinüslerin) toplamı olarak yazma yöntemi. Adını Joseph Fourier'den alır.", u: trw("Fourier dönüşümü") },
    { k: ["harmonik"], t: "Harmonik", d: "Temel frekansın tam katı olan bileşen. Bir sesin tınısını, bir dalganın köşeliliğini harmonikler belirler.", u: trw("Harmonik") },
    { k: ["gibbs"], t: "Gibbs olayı", d: "Keskin bir sıçramayı sınırlı sayıda sinüsle kurarken kenarda sıçramanın ≈ %9'u kadar taşma; terim eklense de kaybolmaz, yalnızca daralır.", u: enw("Gibbs_phenomenon") },
    { k: ["fft", "hızlı fourier"], t: "FFT (hızlı Fourier dönüşümü)", d: "N örneklik ayrık Fourier dönüşümünü N² yerine N·log N işlemle hesaplayan algoritma (Cooley–Tukey, 1965).", u: trw("Hızlı Fourier dönüşümü") },
    { k: ["frekans kutusu", "kutu"], t: "Frekans kutusu (bin)", d: "FFT'nin her bir çıkışı. Genişliği örnekleme hızı ÷ FFT boyudur: 2,4 MS/sn ve 1024 noktada yaklaşık 2,3 kHz.", u: enw("Discrete_Fourier_transform") },
    { k: ["pencere fonksiyon", "pencereleme", "hann"], t: "Pencere fonksiyonu", d: "FFT'den önce örnekleri kenarlarda sıfıra yumuşatan çarpan. Spektral sızıntıyı azaltır, karşılığında tepeleri biraz genişletir.", u: enw("Window_function") },
    { k: ["spektral sızıntı", "sızıntı"], t: "Spektral sızıntı", d: "Tam kutuya oturmayan bir tonun enerjisinin komşu kutulara yayılması. Pencerenin kenarlardaki ani kesiminden kaynaklanır.", u: enw("Spectral_leakage") },
    { k: ["spektrum"], t: "Spektrum", d: "Sinyalin gücünün frekanslara göre dağılımı. Spektrum analizörü ekranında yatay eksen frekans, dikey eksen güçtür.", u: trw("Spektrum") },
    { k: ["şelale"], t: "Şelale (waterfall) ekranı", d: "Ardışık spektrumları renkle kodlayıp alt alta dizen gösterim: yatay eksen frekans, dikey eksen zaman, renk güç.", u: enw("Waterfall_plot") },
    { k: ["desibel", "dbfs", "db!"], t: "Desibel (dB)", d: "İki gücün oranının logaritmik ölçüsü: 10·log₁₀(P₁/P₂). +3 dB iki kat, +10 dB on kat, +20 dB yüz kat güç. dBFS: tam ölçeğe göre.", u: trw("Desibel") },
    { k: ["gürültü tabanı"], t: "Gürültü tabanı", d: "Hiç sinyal yokken spektrumda görülen seviye: alıcının kendi ısıl gürültüsü, nicemleme ve ortam gürültüsünün toplamı.", u: enw("Noise_floor") },
    { k: ["snr", "sinyal-gürültü"], t: "SNR (sinyal-gürültü oranı)", d: "Sinyal gücünün gürültü gücüne oranı, genellikle dB olarak. Yüksek SNR temiz alış demektir.", u: trw("Sinyal-gürültü oranı") },
    { k: ["susturucu", "squelch"], t: "Susturucu (squelch)", d: "Sinyal yokken alıcının sesini kısan devre; telsizlerde kanal boşken duyulan hışırtıyı keser.", u: enw("Squelch") },
    { k: ["lna"], t: "LNA (düşük gürültülü yükselteç)", d: "Antenden gelen zayıf sinyali, kendi gürültüsünü olabildiğince az ekleyerek güçlendiren ilk yükselteç.", u: enw("Low-noise_amplifier") },
    { k: ["yerel osilatör", "lo!"], t: "LO (yerel osilatör)", d: "Alıcının içinde üretilen ve gelen sinyalle karıştırılan referans dalga. Frekansı, alıcının hangi frekansa ayarlandığını belirler.", u: enw("Local_oscillator") },
    { k: ["karıştırıcı", "mikser", "karıştırma"], t: "Karıştırıcı (mixer)", d: "İki sinyali çarpan devre. Çarpma, frekansları toplar ve çıkarır; böylece bir sinyal spektrumda başka bir yere kaydırılır.", u: trw("Frekans karıştırıcı") },
    { k: ["nco"], t: "NCO (sayısal kontrollü osilatör)", d: "Faz biriktirerek yazılımda sinüs üreten osilatör. SDR'da istasyonu 0 Hz'e kaydırmak için kullanılır.", u: enw("Numerically_controlled_oscillator") },
    { k: ["doğrudan dönüşüm", "sıfır if"], t: "Doğrudan dönüşüm (sıfır IF)", d: "Sinyali tek adımda doğrudan 0 Hz'e indirip I ve Q olarak örnekleyen alıcı mimarisi. Basit ama DC sivrisi ve IQ dengesizliği yaşar.", u: enw("Direct-conversion_receiver") },
    { k: ["fir filtre", "fir!"], t: "FIR filtre", d: "Son N örneğin ağırlıklı toplamını alan sayısal filtre. Katsayılar (tap) frekans yanıtını belirler; daha çok tap, daha keskin geçiş.", u: trw("Sonlu dürtü yanıtı") },
    { k: ["alçak geçiren"], t: "Alçak geçiren filtre", d: "Belirli bir kesim frekansının altını geçiren, üstünü bastıran filtre.", u: trw("Alçak geçiren süzgeç") },
    { k: ["bant geçiren"], t: "Bant geçiren filtre", d: "Yalnızca belirli bir frekans aralığını geçirip altını ve üstünü bastıran filtre. IQ'da karmaşık katsayılıysa yalnızca tek tarafı (+f) geçirir.", u: trw("Bant geçiren filtre") },
    { k: ["bant durduran", "çentik"], t: "Bant durduran (çentik) filtre", d: "Belirli bir aralığı bastırıp gerisini geçiren filtre. SDR'cılar güçlü FM yayınlarını bastırmak için FM bant durduran filtre takar.", u: enw("Band-stop_filter") },
    { k: ["görüntü bastırma"], t: "Görüntü bastırma oranı", d: "Bir istasyon ile IQ dengesizliğinin −f'de ürettiği aynası arasındaki güç farkı (dB). Büyük olması iyidir.", u: enw("IQ_imbalance") },
    { k: ["kırpma", "kırpıl"], t: "Kırpma (clipping)", d: "Sinyalin ADC'nin ölçebildiği sınırı aşıp düzleşmesi. Spektrumda olmayan sahte frekanslar üretir.", u: enw("Clipping_(signal_processing)") },
    { k: ["afc"], t: "AFC (otomatik frekans kontrolü)", d: "Alıcının ayarını, en yakın istasyonun tam merkezine kendiliğinden kaydıran düzenek.", u: enw("Automatic_frequency_control") },
    { k: ["azaltma", "decimation"], t: "Azaltma (decimation)", d: "Önce süzüp sonra her M örnekten yalnızca birini tutarak örnekleme hızını düşürmek. Hesap yükünü M kat azaltır.", u: enw("Downsampling_(signal_processing)") },
    { k: ["dc sivrisi", "dc ofset"], t: "DC sivrisi", d: "Doğrudan dönüşümlü alıcılarda tam merkez frekansta görülen sahte tepe. LO sızıntısı ve devre kaymalarından kaynaklanır.", u: enw("Direct-conversion_receiver") },
    { k: ["iq dengesizliği"], t: "IQ dengesizliği", d: "I ve Q kollarının kazancı ya da 90° faz farkı tam eşit olmayınca sinyalin −f'de soluk bir ayna görüntüsü oluşması.", u: enw("IQ_imbalance") },
    { k: ["modülasyon"], t: "Modülasyon", d: "Bilgiyi bir taşıyıcı dalganın genliğini, frekansını ya da fazını değiştirerek ona yüklemek.", u: trw("Modülasyon") },
    { k: ["taşıyıcı"], t: "Taşıyıcı", d: "Bilgiyi taşıyan, kendisi bilgi içermeyen yüksek frekanslı sinüs dalga.", u: enw("Carrier_wave") },
    { k: ["genlik modülasyonu", "am!"], t: "AM (genlik modülasyonu)", d: "Ses sinyalinin taşıyıcının genliğini değiştirmesi. Orta dalga yayınlarda ve havacılık telsizinde kullanılır.", u: trw("Genlik modülasyonu") },
    { k: ["yan bant"], t: "Yan bant", d: "Modülasyonla taşıyıcının iki yanında oluşan, asıl bilgiyi taşıyan frekans bölgeleri. AM'de taşıyıcının altında ve üstünde birer kopya vardır.", u: enw("Sideband") },
    { k: ["carson"], t: "Carson kuralı", d: "FM sinyalinin bant genişliği yaklaşık 2·(sapma + en yüksek ses frekansı). Yayın FM: 2·(75 + 15) = 180 kHz.", u: enw("Carson_bandwidth_rule") },
    { k: ["aşırı modülasyon"], t: "Aşırı modülasyon", d: "AM'de modülasyon derinliği %100'ü geçince zarfın sıfırın altına inmek isteyip ters dönmesi; ses bozulur, yan bantlar taşar.", u: enw("Amplitude_modulation#Modulation_index") },
    { k: ["gray kod"], t: "Gray kodu", d: "Komşu değerlerin yalnızca tek bitte ayrıştığı kodlama. Takımyıldızda yanlış komşuya karar verilirse yalnızca bir bit bozulur.", u: trw("Gray kodu") },
    { k: ["baud"], t: "Baud", d: "Saniyede gönderilen sembol sayısı. Sembol başına birden çok bit taşınıyorsa bit hızı baud'dan büyüktür.", u: trw("Baud") },
    { k: ["zarf dedektörü", "zarf"], t: "Zarf dedektörü", d: "AM sinyalin genliğinin değişimini (zarfını) çıkaran devre. Kristal radyodaki diyot budur; IQ'da √(I² + Q²).", u: enw("Envelope_detector") },
    { k: ["frekans modülasyonu", "fm!"], t: "FM (frekans modülasyonu)", d: "Ses sinyalinin taşıyıcının frekansını değiştirmesi. Yayın FM'de tepe sapma ±75 kHz'dir.", u: trw("Frekans modülasyonu") },
    { k: ["sapma"], t: "Frekans sapması (deviation)", d: "FM'de taşıyıcının merkez frekansından en fazla ne kadar uzaklaştığı. Yayın FM'de 75 kHz, telsizlerde (NFM) birkaç kHz.", u: enw("Frequency_deviation") },
    { k: ["ask!"], t: "ASK (genlik kaydırmalı anahtarlama)", d: "Bitleri genlik seviyeleriyle gönderme. En basit hâli OOK: 1 için taşıyıcı açık, 0 için kapalı. Uzaktan kumandaların çoğu böyle çalışır.", u: enw("Amplitude-shift_keying") },
    { k: ["fsk"], t: "FSK (frekans kaydırmalı anahtarlama)", d: "Bitleri iki (ya da daha çok) farklı frekansla gönderme.", u: enw("Frequency-shift_keying") },
    { k: ["bpsk", "qpsk", "psk"], t: "PSK (faz kaydırmalı anahtarlama)", d: "Bitleri taşıyıcının fazıyla gönderme. BPSK iki faz (sembol başına 1 bit), QPSK dört faz (2 bit) kullanır.", u: enw("Phase-shift_keying") },
    { k: ["qam"], t: "QAM", d: "Hem genliği hem fazı değiştiren modülasyon. 16-QAM, 4×4 ızgaradaki 16 noktayla sembol başına 4 bit taşır.", u: trw("Dördün genlik modülasyonu") },
    { k: ["takımyıldız"], t: "Takımyıldız (constellation) diyagramı", d: "Sembollerin I/Q düzlemindeki yerleri. Gürültü noktaları bulutlaştırır, frekans hatası döndürür.", u: enw("Constellation_diagram") },
    { k: ["sembol hızı", "sembol"], t: "Sembol", d: "Bir modülasyonun bir anda gönderdiği birim. Sembol hızı (baud) saniyede gönderilen sembol sayısıdır; bant genişliğini belirler.", u: enw("Symbol_rate") },
    { k: ["bit hata oranı", "ber!"], t: "BER (bit hata oranı)", d: "Yanlış çözülen bitlerin oranı. SNR düştükçe yükselir; her modülasyonun kendine özgü bir BER–SNR eğrisi vardır.", u: trw("Bit hata oranı") },
    { k: ["awgn", "beyaz gürültü"], t: "AWGN", d: "Toplanır beyaz Gauss gürültüsü: bütün frekanslarda eşit güçte, rastgele. Haberleşme kuramının standart gürültü modeli.", u: enw("Additive_white_Gaussian_noise") },
    { k: ["roll-off", "rrc", "yükseltilmiş kosinüs"], t: "Yükseltilmiş kosinüs süzgeci", d: "Sembolleri birbirine karışmayacak biçimde yumuşatan darbe biçimi. Roll-off (β) fazladan kullanılan bant genişliği oranıdır.", u: enw("Raised-cosine_filter") },
    { k: ["es/n0", "eb/n0"], t: "Es/N0 ve Eb/N0", d: "Sembol (Es) ya da bit (Eb) başına düşen enerjinin gürültü yoğunluğuna (N0) oranı. Farklı modülasyonları adil karşılaştırmak için kullanılan SNR ölçüsü.", u: enw("Eb/N0") },
    { k: ["faz kilitli döngü", "pll"], t: "Faz kilitli döngü (PLL)", d: "Kendi osilatörünü gelen sinyalin fazına kilitleyen geri beslemeli devre ya da algoritma.", u: trw("Faz kilitlemeli döngü") },
    { k: ["utf-8"], t: "UTF-8", d: "Unicode karakterlerini 1–4 bayta çeviren kodlama. İngilizce harfler 1 bayt, ç, ğ, ş gibi Türkçe harfler 2 bayttır.", u: trw("UTF-8") },
    { k: ["uyumlu süzgeç", "uyumlu filtre"], t: "Uyumlu süzgeç", d: "Gürültü içindeki bilinen bir darbe biçimini en iyi ortaya çıkaran süzgeç; alıcıda vericinin darbesinin ayna görüntüsüdür.", u: enw("Matched_filter") },
    { k: ["öncü sembol", "pilot"], t: "Öncü (pilot) sembol", d: "Alıcının önceden bildiği, faz ve zaman eşlemesi için araya serpiştirilen sembol.", u: enw("Pilot_signal") },
    { k: ["hata düzeltme", "fec"], t: "Hata düzeltme kodu (FEC)", d: "Alıcının bozulan bitleri kendi başına düzeltebilmesi için verilere eklenen hesaplı fazlalık.", u: enw("Error_correction_code") },
    { k: ["spektral verim"], t: "Spektral verim", d: "1 Hz bant genişliği başına taşınan bit/sn. Daha çok noktalı takımyıldız daha verimlidir ama daha yüksek SNR ister.", u: enw("Spectral_efficiency") },
    { k: ["costas"], t: "Costas döngüsü", d: "Alınan sinyaldeki faz ve küçük frekans hatasını sürekli ölçüp düzelten geri beslemeli döngü. Takımyıldızın dönmesini durdurur.", u: enw("Costas_loop") },
    { k: ["ppm", "darbe konum"], t: "PPM (darbe konum modülasyonu)", d: "Bilginin, darbenin bit süresi içindeki konumuyla taşındığı modülasyon. ADS-B'de darbe bitin ilk yarısındaysa 1, ikinci yarısındaysa 0.", u: enw("Pulse-position_modulation") },
    { k: ["ook"], t: "OOK (aç-kapa anahtarlama)", d: "Taşıyıcıyı açıp kapayarak bit gönderme; ASK'nın en basit hâli. Uzaktan kumandalar ve kablosuz sensörler kullanır.", u: enw("On%E2%80%93off_keying") },
    { k: ["crc"], t: "CRC (döngüsel artıklık denetimi)", d: "Paketin sonuna eklenen ve yolda bozulup bozulmadığını gösteren denetim sayısı. ADS-B 24 bitlik CRC kullanır.", u: trw("Döngüsel artıklık denetimi") },
    { k: ["pmr446"], t: "PMR446", d: "Avrupa'da (Türkiye dahil) lisanssız kullanılan 446 MHz el telsizi bandı; düşük güç, sabit anten.", u: enw("PMR446") },
    { k: ["stereo pilot", "mpx"], t: "Stereo pilot ve MPX", d: "FM yayın çözülünce çıkan taban bant (MPX): 0–15 kHz mono ses, 19 kHz pilot tonu, 38 kHz çevresinde L−R stereo farkı, 57 kHz RDS.", u: enw("FM_broadcasting#Stereo_FM") },
    { k: ["ads-b"], t: "ADS-B", d: "Uçakların konum, irtifa ve hızını 1090 MHz'de saniyede birkaç kez yayımladığı sistem. Kısa darbe dizileri (PPM) olarak görünür.", u: trw("ADS-B") },
    { k: ["noaa", "apt!"], t: "NOAA APT", d: "Eski NOAA hava uydularının (137 MHz) analog görüntü yayını: 2400 Hz'lik bir alt taşıyıcıda saniyede iki satır. NOAA-15, 18 ve 19 2025'te kapatıldı.", u: enw("Automatic_picture_transmission") },
    { k: ["nfm", "dar bant fm"], t: "NFM (dar bant FM)", d: "Telsizlerde kullanılan, sapması birkaç kHz olan FM. Kanal genişliği 12,5 ya da 25 kHz.", u: enw("Frequency_modulation#Narrowband_FM") },
    { k: ["ism bandı", "433"], t: "433 MHz ISM bandı", d: "Lisanssız kısa menzilli cihazlara (kumanda, hava istasyonu, sensör) ayrılmış bant: 433,05–434,79 MHz.", u: enw("ISM_radio_band") },
    { k: ["btk"], t: "BTK", d: "Bilgi Teknolojileri ve İletişim Kurumu: Türkiye'de telsiz frekanslarını planlayan ve telsiz cihazlarının teknik kurallarını belirleyen kurum. Amatör telsizcilik sınavı ve belgesi ise Kıyı Emniyeti Genel Müdürlüğü'ndedir.", u: trw("Bilgi Teknolojileri ve İletişim Kurumu") },
    { k: ["amatör telsiz"], t: "Amatör telsizcilik", d: "Ticari olmayan, deneysel ve kişisel amaçlı telsiz haberleşmesi. Türkiye'de yayın yapmak için Kıyı Emniyeti Genel Müdürlüğü'nün sınavıyla alınan A, B ya da C sınıfı belge ve çağrı işareti gerekir.", u: trw("Amatör telsizcilik") },
    { k: ["gnu radio"], t: "GNU Radio", d: "Sinyal işleme bloklarını birbirine bağlayarak SDR uygulamaları kurmaya yarayan özgür yazılım çatısı.", u: enw("GNU_Radio") },
  ];

  // her kök için: kelime başında başlayan, ardından Türkçe ekler gelebilen düzenli ifade
  const L_ = "a-zçğıöşüâîûA-ZÇĞİÖŞÜÂÎÛ";
  // karşılaştırma için: Türkçe küçük harf + ı/i ayrımını kaldır (MYCIN → mycin, ama uzunluk değişmez)
  const lower = (s) => s.toLocaleLowerCase("tr").replace(/ı/g, "i");
  // "xx!" tam kelime demek: yalnızca kesme işaretinden sonra ek alabilir (AM'de evet, "ama" hayır)
  TERMS.forEach((term) => {
    term.re = term.k.map((k) => {
      const exact = k.endsWith("!"), body = lower(exact ? k.slice(0, -1) : k).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      return exact
        ? new RegExp(`(^|[^${L_}])(${body}(?:['’][${L_}]*)?)(?![${L_}])`)
        : new RegExp(`(^|[^${L_}])(${body}[${L_}'’]*)`);
    });
  });
  const SKIP = "h1, h2, h3, .chapter-tag, .num, summary, a, .term, .try, button, .license, .cover-meta";

  function markSlide(root) {
    const sid = root.closest(".slide").id;
    // yalnızca belirli slaytlarda anlamlı olan terimleri (ör. "sıcaklık") diğerlerinde atla
    const done = new Set(TERMS.map((t, i) => (t.only && !t.only.includes(sid) ? i : -1)).filter((i) => i >= 0));
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode: (n) => (n.parentElement.closest(SKIP) || !n.nodeValue.trim() ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT),
    });
    const nodes = [];
    while (walker.nextNode()) nodes.push(walker.currentNode);
    nodes.forEach((node) => {
      let text = node.nodeValue;
      let parts = null;
      // düğümde geçen ilk uygun terimi bul, böl, tekrarla
      for (;;) {
        let best = null;
        const low = lower(text);
        TERMS.forEach((term, ti) => {
          if (done.has(ti)) return;
          term.re.forEach((re) => {
            const m = re.exec(low);
            const i = m && m.index + m[1].length;
            // aynı yerden başlayan eşleşmelerde uzun olan kazanır ("genlik modülasyonu" > "genlik")
            if (m && (!best || i < best.i || (i === best.i && m[2].length > best.len))) best = { i, len: m[2].length, ti };
          });
        });
        if (!best) break;
        done.add(best.ti);
        parts = parts || [];
        parts.push(text.slice(0, best.i));
        const span = document.createElement("span");
        span.className = "term"; span.tabIndex = 0; span.dataset.ti = best.ti;
        span.textContent = text.slice(best.i, best.i + best.len);
        parts.push(span);
        text = text.slice(best.i + best.len);
      }
      if (parts) { parts.push(text); node.replaceWith(...parts); }
    });
  }
  document.querySelectorAll(".slide .text, .slide .cover-text").forEach(markSlide);

  /* --- balon --- */
  const pop = document.createElement("div");
  pop.id = "gloss"; pop.setAttribute("role", "tooltip");
  document.body.append(pop);
  let cur = null, hideT = 0;
  function show(el) {
    clearTimeout(hideT);
    if (cur === el && pop.classList.contains("open")) return;
    cur = el;
    const t = TERMS[+el.dataset.ti];
    pop.innerHTML = "";
    const h4 = document.createElement("h4"); h4.textContent = t.t;
    const p = document.createElement("p"); p.textContent = t.d;
    const a = document.createElement("a");
    a.href = t.u; a.target = "_blank"; a.rel = "noopener";
    a.textContent = t.u.includes("tr.wikipedia") ? "Vikipedi'de oku ↗" : "Wikipedia'da oku (İngilizce) ↗";
    pop.append(h4, p, a);
    pop.classList.add("open");
    const r = el.getBoundingClientRect();
    const pw = pop.offsetWidth, ph = pop.offsetHeight;
    let x = Math.min(Math.max(12, r.left + r.width / 2 - pw / 2), window.innerWidth - pw - 12);
    let y = r.top - ph - 10;
    pop.classList.toggle("below", y < 8);
    if (y < 8) y = r.bottom + 10;
    pop.style.left = x + "px"; pop.style.top = y + "px";
  }
  function hide(delay = 180) {
    clearTimeout(hideT);
    hideT = setTimeout(() => { pop.classList.remove("open"); cur = null; }, delay);
  }
  document.addEventListener("mouseover", (e) => {
    const el = e.target.closest && e.target.closest(".term");
    if (el) show(el);
    else if (e.target.closest && e.target.closest("#gloss")) clearTimeout(hideT);
    else if (cur) hide();
  });
  document.addEventListener("focusin", (e) => { if (e.target.classList && e.target.classList.contains("term")) show(e.target); });
  document.addEventListener("focusout", (e) => { if (e.target.classList && e.target.classList.contains("term")) hide(250); });
  // dokunmatik: dokununca aç/kapa
  document.addEventListener("click", (e) => {
    const el = e.target.closest(".term");
    if (el) { e.preventDefault(); cur === el && pop.classList.contains("open") ? hide(0) : show(el); }
    else if (!e.target.closest("#gloss")) hide(0);
  });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") hide(0); });
  document.getElementById("deck").addEventListener("scroll", () => hide(0), true);
})();

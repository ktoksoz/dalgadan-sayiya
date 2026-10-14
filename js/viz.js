/* Ortak çizimler: spektrum izi, şelale, frekans skalası, I/Q düzlemi, fazör.
   Bütün demolar aynı görsel dili buradan alır. */
(function () {
  const { C, FONT, rgba, LUT, clamp } = L;

  function text(ctx, s, x, y, { color = C.ink2, size = 12, align = "left", base = "alphabetic", font = FONT.body, weight = 400 } = {}) {
    ctx.font = `${weight} ${size}px ${font}`;
    ctx.fillStyle = color; ctx.textAlign = align; ctx.textBaseline = base;
    ctx.fillText(s, x, y);
  }

  /* Kadran skalası: büyük ve küçük çentikler, fildişi baskı.
     at: değer → x; labels: [[değer, "yazı"]]; minor: küçük çentik değerleri */
  function scale(ctx, { x, y, w, from, to, major, minor = [], fmt = String, color = C.ink2, up = false, size = 11 }) {
    const X = (v) => x + ((v - from) / (to - from)) * w;
    const d = up ? -1 : 1;
    ctx.strokeStyle = rgba(C.ink, 0.35); ctx.lineWidth = 1;
    ctx.beginPath();
    minor.forEach((v) => { const px = Math.round(X(v)) + 0.5; if (px < x - 1 || px > x + w + 1) return; ctx.moveTo(px, y); ctx.lineTo(px, y + 4 * d); });
    ctx.stroke();
    ctx.strokeStyle = rgba(C.ink, 0.7);
    ctx.beginPath();
    major.forEach((v) => { const px = Math.round(X(v)) + 0.5; if (px < x - 1 || px > x + w + 1) return; ctx.moveTo(px, y); ctx.lineTo(px, y + 8 * d); });
    ctx.stroke();
    major.forEach((v, i) => {
      const px = X(v); if (px < x - 1 || px > x + w + 1) return;
      const al = i === 0 && px - x < 20 ? "left" : i === major.length - 1 && x + w - px < 20 ? "right" : "center";
      text(ctx, fmt(v), px, y + (up ? -12 : 21), { color, size, align: al, font: FONT.display, weight: 600 });
    });
  }
  // "Güzel" çentik adımı: 1, 2, 5 × 10^n
  function niceStep(range, count) {
    const raw = range / count, p = 10 ** Math.floor(Math.log10(raw)), r = raw / p;
    return (r < 1.5 ? 1 : r < 3.5 ? 2 : r < 7.5 ? 5 : 10) * p;
  }
  function ticks(from, to, count = 6) {
    const s = niceStep(to - from, count), out = [];
    for (let v = Math.ceil(from / s) * s; v <= to + s * 1e-6; v += s) out.push(+v.toPrecision(12));
    return { major: out, step: s, minor: (() => { const m = []; const ms = s / 5; for (let v = Math.ceil(from / ms) * ms; v <= to; v += ms) m.push(v); return m; })() };
  }

  /* Spektrum izi: fildişi çizgi, altı radyum renk haritasıyla dolu */
  const fillCache = new WeakMap();
  function spectrum(ctx, { x, y, w, h, db, min = -100, max = 0, line = C.ink, fill = true, alpha = 1, from = 0, to = db.length }) {
    const n = to - from;
    const Y = (v) => y + h * (1 - clamp((v - min) / (max - min), 0, 1));
    ctx.save();
    ctx.beginPath(); ctx.rect(x, y, w, h); ctx.clip();
    ctx.beginPath();
    // geniş FFT'yi piksel başına en yüksek değere indir (tepeler kaybolmasın)
    const step = n / w;
    if (step > 1) {
      for (let px = 0; px <= w; px++) {
        const a = from + Math.floor(px * step), b = Math.min(to, from + Math.floor((px + 1) * step));
        let m = -Infinity; for (let i = a; i < Math.max(b, a + 1); i++) if (db[i] > m) m = db[i];
        px ? ctx.lineTo(x + px, Y(m)) : ctx.moveTo(x, Y(m));
      }
    } else {
      for (let i = 0; i < n; i++) { const px = x + ((i + 0.5) / n) * w; i ? ctx.lineTo(px, Y(db[from + i])) : ctx.moveTo(px, Y(db[from + i])); }
    }
    if (fill) {
      ctx.save();
      ctx.lineTo(x + w, y + h); ctx.lineTo(x, y + h); ctx.closePath();
      let g = fillCache.get(ctx);
      if (!g || g.y !== y || g.h !== h) {
        const gr = ctx.createLinearGradient(0, y + h, 0, y);
        L.CMAP_STOPS.forEach(([t, c]) => gr.addColorStop(t, rgba(c, 0.15 + 0.55 * t)));
        g = { gr, y, h }; fillCache.set(ctx, g);
      }
      ctx.globalAlpha = alpha; ctx.fillStyle = g.gr; ctx.fill();
      ctx.restore();
    }
    ctx.globalAlpha = alpha;
    ctx.strokeStyle = line; ctx.lineWidth = 1.4; ctx.lineJoin = "round"; ctx.stroke();
    ctx.restore();
  }
  // dB ekseni (sol): ince yatay ızgara çizgileri ve etiketler
  function dbGrid(ctx, { x, y, w, h, min, max, step = 20, unit = "dB", labels = true }) {
    const Y = (v) => y + h * (1 - (v - min) / (max - min));
    ctx.strokeStyle = rgba(C.line, 0.9); ctx.lineWidth = 1;
    ctx.beginPath();
    for (let v = Math.ceil(min / step) * step; v <= max; v += step) { const py = Math.round(Y(v)) + 0.5; ctx.moveTo(x, py); ctx.lineTo(x + w, py); }
    ctx.stroke();
    if (labels) for (let v = Math.ceil(min / step) * step; v <= max; v += step) {
      if (Y(v) < y + 8) continue;
      text(ctx, (v < 0 ? "−" + -v : v) + (v === max - (max % step) || v === Math.floor(max / step) * step ? " " + unit : ""), x + 4, Y(v) - 4, { size: 10, color: C.muted });
    }
  }

  /* Şelale: her push bir satır ekler, en yeni satır en üstte. Halka tampon + ImageData. */
  class Waterfall {
    constructor(bins, rows = 256) {
      this.bins = bins; this.rows = rows;
      this.cv = document.createElement("canvas");
      this.cv.width = bins; this.cv.height = rows;
      this.cx = this.cv.getContext("2d");
      this.cx.fillStyle = C.bg; this.cx.fillRect(0, 0, bins, rows);
      this.row = this.cx.createImageData(bins, 1);
      this.head = 0; // en yeni satırın konumu
      this.min = -100; this.max = 0;
    }
    push(db, from = 0, n = this.bins) {
      const d = this.row.data, { min, max } = this, k = 255 / (max - min), step = n / this.bins;
      for (let i = 0; i < this.bins; i++) {
        let v;
        if (step > 1) { v = -Infinity; const a = from + Math.floor(i * step), b = from + Math.floor((i + 1) * step); for (let j = a; j < b; j++) if (db[j] > v) v = db[j]; }
        else v = db[from + Math.floor(i * step)];
        const t = clamp(Math.round((v - min) * k), 0, 255) * 3;
        d[4 * i] = LUT[t]; d[4 * i + 1] = LUT[t + 1]; d[4 * i + 2] = LUT[t + 2]; d[4 * i + 3] = 255;
      }
      this.head = (this.head - 1 + this.rows) % this.rows;
      this.cx.putImageData(this.row, 0, this.head);
    }
    clear() { this.cx.fillStyle = C.bg; this.cx.fillRect(0, 0, this.bins, this.rows); }
    // hedef dikdörtgene çiz; en yeni satır üstte
    draw(ctx, x, y, w, h, smooth = true) {
      ctx.save();
      ctx.imageSmoothingEnabled = smooth;
      const top = this.rows - this.head; // en yeni satırdan sona kadar
      const h1 = (top / this.rows) * h;
      ctx.drawImage(this.cv, 0, this.head, this.bins, top, x, y, w, h1);
      if (this.head > 0) ctx.drawImage(this.cv, 0, 0, this.bins, this.head, x, y + h1, w, h - h1);
      ctx.restore();
    }
  }

  /* I/Q düzlemi: yatay eksen I (mavi), dikey eksen Q (kehribar), birim çember */
  function iqPlane(ctx, cx, cy, r, { circle = true, labels = true, grid = false, scale: sc = 1 } = {}) {
    ctx.save();
    if (grid) {
      ctx.strokeStyle = rgba(C.line, 0.6); ctx.lineWidth = 1; ctx.beginPath();
      for (let k = -2; k <= 2; k++) { if (!k) continue; const d = (k / 2) * r; ctx.moveTo(cx - r, cy + d); ctx.lineTo(cx + r, cy + d); ctx.moveTo(cx + d, cy - r); ctx.lineTo(cx + d, cy + r); }
      ctx.stroke();
    }
    if (circle) {
      ctx.strokeStyle = rgba(C.ink, 0.18); ctx.setLineDash([2, 4]); ctx.lineWidth = 1;
      ctx.beginPath(); ctx.arc(cx, cy, r / sc, 0, Math.PI * 2); ctx.stroke(); ctx.setLineDash([]);
    }
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = rgba(C.I, 0.7); ctx.beginPath(); ctx.moveTo(cx - r, cy); ctx.lineTo(cx + r, cy); ctx.stroke();
    ctx.strokeStyle = rgba(C.Q, 0.7); ctx.beginPath(); ctx.moveTo(cx, cy + r); ctx.lineTo(cx, cy - r); ctx.stroke();
    if (labels) {
      text(ctx, "I", cx + r + 6, cy + 5, { color: C.I, size: 15, font: FONT.display, weight: 700 });
      text(ctx, "Q", cx - 5, cy - r - 8, { color: C.Q, size: 15, font: FONT.display, weight: 700 });
    }
    ctx.restore();
  }

  // ok (fazör): uç noktaya üçgen başlık
  function arrow(ctx, x0, y0, x1, y1, color, width = 2.5, head = 9) {
    const a = Math.atan2(y1 - y0, x1 - x0), len = Math.hypot(x1 - x0, y1 - y0);
    const hh = Math.min(head, len * 0.4);
    ctx.strokeStyle = color; ctx.fillStyle = color; ctx.lineWidth = width; ctx.lineCap = "round";
    ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1 - Math.cos(a) * hh * 0.6, y1 - Math.sin(a) * hh * 0.6); ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x1 - Math.cos(a - 0.42) * hh, y1 - Math.sin(a - 0.42) * hh);
    ctx.lineTo(x1 - Math.cos(a + 0.42) * hh, y1 - Math.sin(a + 0.42) * hh);
    ctx.closePath(); ctx.fill();
  }
  // nokta
  function dot(ctx, x, y, r, color, glow = 0) {
    ctx.save();
    if (glow) { ctx.shadowColor = color; ctx.shadowBlur = glow; }
    ctx.fillStyle = color; ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  }
  // kırmızı ayar ibresi (dikey çizgi + üstte küçük üçgen)
  function needle(ctx, x, y, h, label) {
    ctx.save();
    ctx.strokeStyle = rgba(C.bg, 0.8); ctx.lineWidth = 4; ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x, y + h); ctx.stroke();
    ctx.strokeStyle = C.needle; ctx.lineWidth = 1.6; ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x, y + h); ctx.stroke();
    ctx.fillStyle = C.needle; ctx.beginPath(); ctx.moveTo(x - 6, y); ctx.lineTo(x + 6, y); ctx.lineTo(x, y + 8); ctx.closePath(); ctx.fill();
    if (label) text(ctx, label, x + 8, y + 12, { color: C.needle, size: 12, font: FONT.display, weight: 700 });
    ctx.restore();
  }
  // gerçek değerli dalga biçimi: ys dizisi, aralık [-a, a]
  function wave(ctx, { x, y, w, h, ys, a = 1, color, width = 1.8, from = 0, n = ys.length }) {
    ctx.save();
    ctx.beginPath(); ctx.rect(x - 2, y - 2, w + 4, h + 4); ctx.clip();
    ctx.strokeStyle = color; ctx.lineWidth = width; ctx.lineJoin = "round";
    ctx.beginPath();
    for (let i = 0; i < n; i++) {
      const px = x + (i / (n - 1)) * w, py = y + h / 2 - (ys[from + i] / a) * (h / 2);
      i ? ctx.lineTo(px, py) : ctx.moveTo(px, py);
    }
    ctx.stroke();
    ctx.restore();
  }
  // panelin içinde soluk çerçeve ve başlık
  function frame(ctx, x, y, w, h, title) {
    ctx.strokeStyle = rgba(C.line, 1); ctx.lineWidth = 1;
    ctx.strokeRect(Math.round(x) + 0.5, Math.round(y) + 0.5, Math.round(w) - 1, Math.round(h) - 1);
    if (title) text(ctx, title, x + 8, y + 16, { color: C.muted, size: 11.5 });
  }

  window.V = { text, scale, ticks, niceStep, spectrum, dbGrid, Waterfall, iqPlane, arrow, dot, needle, wave, frame };
})();

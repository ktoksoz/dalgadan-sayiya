/* Bölüm 3: Karmaşık sinyal, I ve Q.
   Renk dili burada öğretilir: I = gök mavisi, Q = kehribar, genlik = fildişi (okun kendisi), faz = nane.
   Slaytlar: fazor (dönen ok), sarmal (3B yay), neden-iki (±f), genlik-faz (I/Q düzlemi), iq-dosyasi (.cu8 baytları). */
(function () {
  const { C, FONT, rgba, h, canvas, loop, clamp, slider, seg, toggle, num } = L;
  const TAU = Math.PI * 2;
  const sgn = (v, d = 2) => (v >= 0 ? "+" : "") + num(v, d); // num() eksiyi "−" yazar
  const degOf = (rad) => { let d = (rad * 180) / Math.PI; if (d <= -180) d += 360; if (d > 180) d -= 360; return d; };

  // yumuşak ton akışı: frekans ve genlik örnek örnek kaydırılır, tık sesi olmaz
  function toneFill(get) {
    let p = 0, fs = 0, as = 0;
    return function (out, rate) {
      const { freq, amp } = get();
      for (let i = 0; i < out.length; i++) {
        fs += (freq - fs) * 0.0015; as += (amp - as) * 0.002;
        p += (TAU * fs) / rate; if (p > TAU) p -= TAU;
        out[i] = as * (Math.sin(p) * 0.85 + Math.sin(2 * p) * 0.1 + Math.sin(3 * p) * 0.05);
      }
    };
  }
  function listenToggle(slide, fill, opts) {
    let stream = null;
    const t = toggle("Dinle", false, (on) => {
      if (on && !stream) stream = Sound.stream(slide, fill, opts || { gain: 0.6 });
      if (!on && stream) { stream.stop(); stream = null; }
    });
    t.stop = () => { if (stream) { stream.stop(); stream = null; } t.set(false); };
    return t;
  }
  // kesik çizgi
  function dash(ctx, x0, y0, x1, y1, color, w = 1.2, pat = [4, 4]) {
    ctx.save(); ctx.strokeStyle = color; ctx.lineWidth = w; ctx.setLineDash(pat);
    ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke(); ctx.restore();
  }
  // parlayan kalın çizgi (gölge çubuğu)
  function bar(ctx, x0, y0, x1, y1, color, w = 5) {
    ctx.save(); ctx.strokeStyle = color; ctx.lineWidth = w; ctx.lineCap = "round";
    ctx.shadowColor = color; ctx.shadowBlur = 12;
    ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke(); ctx.restore();
  }
  // arka planı boyanmış yazı (çizgilerin üstünde okunur kalsın)
  function halo(ctx, s, x, y, color, size = 13, align = "left") {
    ctx.save(); ctx.font = `700 ${size}px ${FONT.body}`; ctx.textAlign = align; ctx.textBaseline = "alphabetic";
    ctx.lineWidth = 5; ctx.strokeStyle = rgba(C.stage, 0.92); ctx.lineJoin = "round"; ctx.strokeText(s, x, y);
    ctx.fillStyle = color; ctx.fillText(s, x, y); ctx.restore();
  }
  // el feneri: (x, y) ağız ortası, ang ışığın yönü
  function torch(ctx, x, y, ang, tint, s = 1) {
    ctx.save(); ctx.translate(x, y); ctx.rotate(ang); ctx.scale(s, s);
    ctx.fillStyle = "#1d343c"; ctx.strokeStyle = rgba(C.ink, 0.55); ctx.lineWidth = 1.2;
    ctx.beginPath(); ctx.moveTo(0, -11); ctx.lineTo(-14, -7); ctx.lineTo(-14, 7); ctx.lineTo(0, 11); ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.beginPath(); ctx.roundRect(-44, -6, 31, 12, 3); ctx.fill(); ctx.stroke();
    ctx.fillStyle = rgba(tint, 0.9); ctx.fillRect(-1.5, -10, 3, 20);
    ctx.fillStyle = rgba(C.ink, 0.35); ctx.fillRect(-34, -2, 8, 4);
    ctx.restore();
  }

  /* ================= 1. Dönen ok ================= */
  Demos.phasor = function (stage, slide) {
    const cv = h("canvas", { "aria-label": "Dönen ok: yere düşen gölge I, duvara düşen gölge Q" });
    const fill = h("div.fill", cv);
    const ctrl = h("div.controls");
    stage.append(fill, ctrl);

    let f = 0.35, A = 0.85, paused = false, ph = 0.5;
    const RATE = 120, N = 1500;
    const hI = new Float32Array(N), hQ = new Float32Array(N);
    let head = 0, acc = 0;
    function push() { hI[head] = A * Math.cos(ph); hQ[head] = A * Math.sin(ph); head = (head + 1) % N; }
    ph -= (TAU * f * N) / RATE;
    for (let i = 0; i < N; i++) { push(); ph += (TAU * f) / RATE; }

    const st = canvas(cv, () => draw());
    function draw() {
      const { ctx, w, h: H } = st;
      if (!w) return;
      ctx.clearRect(0, 0, w, H);
      const narrow = w < 560;
      const R = Math.max(40, Math.min(H * 0.25, w * (narrow ? 0.24 : 0.19), 160));
      const ls = narrow ? 36 : 58; // fener payı
      const tsz = narrow ? 34 : 46, cx = R + ls * 0.55 + tsz + 4, cy = R + ls * 0.55 + tsz + 6;
      const gap = 16, wallX = cx + R + gap, floorY = cy + R + gap;
      const spd = R * 1.15 / 1, dx = spd / RATE; // px/sn, örnek başına px
      const I = A * Math.cos(ph), Q = A * Math.sin(ph);
      const tx = cx + I * R, ty = cy - Q * R;

      // ışık huzmeleri
      let g = ctx.createLinearGradient(0, cy - R - ls * 0.6, 0, floorY);
      g.addColorStop(0, rgba(C.I, 0.13)); g.addColorStop(1, rgba(C.I, 0.02));
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.moveTo(cx - 10, cy - R - ls * 0.55); ctx.lineTo(cx + 10, cy - R - ls * 0.55); ctx.lineTo(cx + R + 4, floorY); ctx.lineTo(cx - R - 4, floorY); ctx.closePath(); ctx.fill();
      g = ctx.createLinearGradient(cx - R - ls * 0.6, 0, wallX, 0);
      g.addColorStop(0, rgba(C.Q, 0.13)); g.addColorStop(1, rgba(C.Q, 0.02));
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.moveTo(cx - R - ls * 0.55, cy - 10); ctx.lineTo(cx - R - ls * 0.55, cy + 10); ctx.lineTo(wallX, cy + R + 4); ctx.lineTo(wallX, cy - R - 4); ctx.closePath(); ctx.fill();
      torch(ctx, cx, cy - R - ls * 0.55, Math.PI / 2, C.I, narrow ? 0.75 : 1);
      torch(ctx, cx - R - ls * 0.55, cy, 0, C.Q, narrow ? 0.75 : 1);

      // zemin ve duvar
      ctx.strokeStyle = rgba(C.ink, 0.35); ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(cx - R - 8, floorY + 0.5); ctx.lineTo(cx + R + 8, floorY + 0.5); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(wallX + 0.5, cy - R - 8); ctx.lineTo(wallX + 0.5, cy + R + 8); ctx.stroke();
      // zemin/duvar taraması
      ctx.strokeStyle = rgba(C.ink, 0.12);
      ctx.beginPath();
      for (let x = cx - R - 4; x < cx + R + 8; x += 9) { ctx.moveTo(x, floorY + 1); ctx.lineTo(x - 5, floorY + 6); }
      ctx.stroke();

      // dalga eksenleri
      ctx.strokeStyle = rgba(C.line, 1); ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(wallX, cy + 0.5); ctx.lineTo(w - 12, cy + 0.5); ctx.moveTo(cx + 0.5, floorY); ctx.lineTo(cx + 0.5, H - 10); ctx.stroke();
      ctx.strokeStyle = rgba(C.line, 0.7); ctx.setLineDash([2, 5]);
      ctx.beginPath();
      ctx.moveTo(wallX, cy - R); ctx.lineTo(w - 12, cy - R); ctx.moveTo(wallX, cy + R); ctx.lineTo(w - 12, cy + R);
      ctx.moveTo(cx - R, floorY); ctx.lineTo(cx - R, H - 10); ctx.moveTo(cx + R, floorY); ctx.lineTo(cx + R, H - 10);
      ctx.stroke(); ctx.setLineDash([]);

      // Q dalgası: sağa akar
      ctx.save(); ctx.beginPath(); ctx.rect(wallX, 0, w - 12 - wallX, H); ctx.clip();
      ctx.strokeStyle = C.Q; ctx.lineWidth = 2.2; ctx.lineJoin = "round";
      ctx.beginPath();
      for (let k = 0; k < N; k++) {
        const x = wallX + k * dx; if (x > w - 12) break;
        const v = hQ[(head - 1 - k + N * 2) % N];
        k ? ctx.lineTo(x, cy - v * R) : ctx.moveTo(x, cy - v * R);
      }
      ctx.stroke(); ctx.restore();
      // I dalgası: aşağı akar
      ctx.save(); ctx.beginPath(); ctx.rect(0, floorY, w, H - 10 - floorY); ctx.clip();
      ctx.strokeStyle = C.I; ctx.lineWidth = 2.2; ctx.lineJoin = "round";
      ctx.beginPath();
      for (let k = 0; k < N; k++) {
        const y = floorY + k * dx; if (y > H - 10) break;
        const v = hI[(head - 1 - k + N * 2) % N];
        k ? ctx.lineTo(cx + v * R, y) : ctx.moveTo(cx + v * R, y);
      }
      ctx.stroke(); ctx.restore();
      // akış yönü etiketleri
      V.text(ctx, "zaman →", w - 14, cy + R + 22, { align: "right", size: 12, color: C.muted });
      ctx.save(); ctx.translate(cx - R - 8, H - 14); ctx.rotate(Math.PI / 2);
      V.text(ctx, "zaman →", 0, 0, { align: "right", size: 12, color: C.muted, base: "top" });
      ctx.restore();

      // çember, açı yayı, ok
      ctx.strokeStyle = rgba(C.ink, 0.14); ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(cx - R, cy + 0.5); ctx.lineTo(cx + R, cy + 0.5); ctx.moveTo(cx + 0.5, cy - R); ctx.lineTo(cx + 0.5, cy + R); ctx.stroke();
      ctx.strokeStyle = rgba(C.ink, 0.22); ctx.setLineDash([2, 4]);
      ctx.beginPath(); ctx.arc(cx, cy, R, 0, TAU); ctx.stroke(); ctx.setLineDash([]);
      ctx.strokeStyle = rgba(C.amp, 0.35); ctx.lineWidth = 1.2;
      ctx.beginPath(); ctx.arc(cx, cy, A * R, 0, TAU); ctx.stroke();
      const a = ((ph % TAU) + TAU) % TAU;
      ctx.strokeStyle = rgba(C.phase, 0.85); ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(cx, cy, Math.min(26, A * R * 0.4), 0, -a, true); ctx.stroke();
      dash(ctx, tx, ty, wallX, ty, rgba(C.Q, 0.75));
      dash(ctx, tx, ty, tx, floorY, rgba(C.I, 0.75));
      bar(ctx, cx, floorY, tx, floorY, C.I, 5);
      bar(ctx, wallX, cy, wallX, ty, C.Q, 5);
      V.dot(ctx, tx, floorY, 4, C.I, 10);
      V.dot(ctx, wallX, ty, 4, C.Q, 10);
      V.arrow(ctx, cx, cy, tx, ty, C.amp, 3.2, 14);
      V.dot(ctx, cx, cy, 3.5, C.amp);
      V.dot(ctx, tx, ty, 5, C.amp, 16);

      // etiketler
      const ts = narrow ? 12 : 13.5;
      halo(ctx, "I: yerdeki gölge", cx - R - 8, floorY - 9, C.I, ts);
      halo(ctx, "Q: duvardaki gölge", wallX + 8, cy - R - 10, C.Q, ts);

      // sağ alt köşe: okumalar
      const bx = wallX + 18, by = floorY + 14;
      if (w - bx > 150 && H - by > 110) {
        const big = Math.min(46, Math.max(26, (w - bx) / 7));
        V.text(ctx, "I", bx, by + big, { color: C.I, size: big * 0.7, font: FONT.display, weight: 800 });
        V.text(ctx, sgn(I), bx + big * 0.7, by + big, { color: C.I, size: big, font: FONT.display, weight: 800 });
        V.text(ctx, "Q", bx, by + big * 2.15, { color: C.Q, size: big * 0.7, font: FONT.display, weight: 800 });
        V.text(ctx, sgn(Q), bx + big * 0.7, by + big * 2.15, { color: C.Q, size: big, font: FONT.display, weight: 800 });
        V.text(ctx, `açı ${num(((a * 180) / Math.PI) % 360, 0)}°  ·  okun boyu ${num(A, 2)}`, bx, by + big * 2.15 + 26, { color: C.ink2, size: 13 });
        V.text(ctx, "açı", bx, by + big * 2.15 + 26, { color: C.phase, size: 13 });
        V.text(ctx, `${num(f, 2)} tur/sn: saniyede ${num(f, 2)} tam dönüş`, bx, by + big * 2.15 + 46, { color: C.muted, size: 12.5 });
      }
    }

    const fSl = slider({ label: "Frekans", min: 0.1, max: 1.2, step: 0.01, value: f, fmt: (v) => num(v, 2) + " tur/sn", oninput: (v) => (f = v) });
    const aSl = slider({ label: "Genlik", min: 0.2, max: 1, step: 0.01, value: A, fmt: (v) => num(v, 2), oninput: (v) => { A = v; if (paused) draw(); } });
    const pause = toggle("Duraklat", false, (v) => (paused = v));
    const listen = listenToggle(slide, toneFill(() => ({ freq: 160 + f * 360, amp: paused ? 0 : 0.35 * A })));
    ctrl.append(fSl, aSl, pause, listen);

    const lp = loop((dt) => {
      if (!paused) {
        acc += dt;
        while (acc > 1 / RATE) { ph += (TAU * f) / RATE; push(); acc -= 1 / RATE; }
      }
      draw();
    });
    return { enter() { lp.start(); }, leave() { lp.stop(); listen.stop(); } };
  };

  /* ================= 2. Zamanda bir yay (3B sarmal) ================= */
  Demos.helix = function (stage, slide) {
    const cv = h("canvas", { "aria-label": "Üç boyutlu sarmal: sürükleyerek döndürün" });
    cv.style.cursor = "grab";
    const cap = h("div.float.tl.ch3-cap");
    const fill = h("div.fill", cv, cap);
    const ctrl = h("div.controls");
    stage.append(fill, ctrl);

    const D2R = Math.PI / 180;
    const VIEWS = { side: [-90, 0], top: [-90, 89.5], front: [0, 0], tilt: [-58, 24] };
    let yaw = -58 * D2R, pitch = 24 * D2R, anim = null;
    let k = 0.6, tau = 0, paused = false, sc = 0;
    const Lt = 2.5, W = 1.45, A = 1;

    function basis() {
      const cp = Math.cos(pitch), sp = Math.sin(pitch), cy_ = Math.cos(yaw), sy = Math.sin(yaw);
      const f = [-cp * cy_, -cp * sy, -sp];          // kameradan hedefe
      const r = [-sy, cy_, 0];                        // sağ
      const u = [r[1] * f[2] - r[2] * f[1], r[2] * f[0] - r[0] * f[2], r[0] * f[1] - r[1] * f[0]]; // üst
      return { f, r, u, cam: [-f[0], -f[1], -f[2]] };
    }

    const st = canvas(cv, () => draw());
    function draw() {
      const { ctx, w, h: H } = st;
      if (!w) return;
      ctx.clearRect(0, 0, w, H);
      const B = basis();
      // gölge yüzeyleri her zaman sarmalın arkasında kalsın
      const wallI = B.cam[1] < 0 ? W : -W;      // arka duvar (Q gölgesi)
      const floorQ = B.cam[2] >= 0 ? -W : W;    // zemin (I gölgesi)
      const endT = B.cam[0] >= 0 ? -Lt - 0.35 : Lt + 0.35; // uç duvar (çember)
      // ölçek: sahne kutusunun izdüşümü sığsın
      let mx = 0, my = 0;
      for (const t of [-Lt - 0.35, Lt + 0.35]) for (const a of [-W, W]) for (const b of [-W, W]) {
        const x = t * B.r[0] + a * B.r[1] + b * B.r[2], y = t * B.u[0] + a * B.u[1] + b * B.u[2];
        mx = Math.max(mx, Math.abs(x)); my = Math.max(my, Math.abs(y));
      }
      const target = Math.min((w / 2 - 22) / mx, (H / 2 - 30) / my);
      sc = sc ? sc + (target - sc) * 0.18 : target;
      const ox = w / 2, oy = H / 2 + 6;
      const P = (t, i, q) => [ox + sc * (t * B.r[0] + i * B.r[1] + q * B.r[2]), oy - sc * (t * B.u[0] + i * B.u[1] + q * B.u[2]), t * B.f[0] + i * B.f[1] + q * B.f[2]];
      const line = (pts, color, lw) => { ctx.strokeStyle = color; ctx.lineWidth = lw; ctx.beginPath(); pts.forEach((p, j) => (j ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1]))); ctx.stroke(); };
      const quad = (a, b, c, d, fillc, stroke) => { ctx.beginPath(); [a, b, c, d].forEach((p, j) => (j ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1]))); ctx.closePath(); ctx.fillStyle = fillc; ctx.fill(); ctx.strokeStyle = stroke; ctx.lineWidth = 1; ctx.stroke(); };
      const t0 = -Lt, t1 = Lt;

      // yüzeyler: zemin, arka duvar, uç duvar
      quad(P(t0, -W, floorQ), P(t1, -W, floorQ), P(t1, W, floorQ), P(t0, W, floorQ), rgba(C.I, 0.035), rgba(C.I, 0.25));
      quad(P(t0, wallI, -W), P(t1, wallI, -W), P(t1, wallI, W), P(t0, wallI, W), rgba(C.Q, 0.035), rgba(C.Q, 0.25));
      quad(P(endT, -W, -W), P(endT, W, -W), P(endT, W, W), P(endT, -W, W), rgba(C.ink, 0.02), rgba(C.ink, 0.12));
      ctx.lineWidth = 1;
      ctx.strokeStyle = rgba(C.ink, 0.06); ctx.beginPath();
      for (let t = -2; t <= 2; t += 1) {
        let a = P(t, -W, floorQ), b = P(t, W, floorQ); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]);
        a = P(t, wallI, -W); b = P(t, wallI, W); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]);
      }
      for (const v of [-1, 0, 1]) {
        let a = P(t0, v, floorQ), b = P(t1, v, floorQ); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]);
        a = P(t0, wallI, v); b = P(t1, wallI, v); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]);
      }
      ctx.stroke();

      // sarmal noktaları
      const M = 420, pts = new Array(M + 1);
      for (let j = 0; j <= M; j++) {
        const t = t0 + ((t1 - t0) * j) / M, a = TAU * k * (t + tau);
        pts[j] = [t, A * Math.cos(a), A * Math.sin(a)];
      }
      // gölgeler
      ctx.save(); ctx.shadowBlur = 8;
      ctx.shadowColor = C.I; line(pts.map((p) => P(p[0], p[1], floorQ)), rgba(C.I, 0.9), 2);
      ctx.shadowColor = C.Q; line(pts.map((p) => P(p[0], wallI, p[2])), rgba(C.Q, 0.9), 2);
      ctx.restore();
      ctx.save(); ctx.beginPath(); for (let j = 0; j <= 96; j++) { const a = (TAU * j) / 96, p = P(endT, A * Math.cos(a), A * Math.sin(a)); j ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1]); }
      ctx.strokeStyle = rgba(C.amp, 0.3); ctx.lineWidth = 1.5; ctx.setLineDash([3, 4]); ctx.stroke(); ctx.restore();

      // "şimdi" anı: t = Lt'deki ok, ışınlar
      const now = pts[M], pn = P(now[0], now[1], now[2]);
      dash(ctx, pn[0], pn[1], ...P(now[0], now[1], floorQ).slice(0, 2), rgba(C.I, 0.55), 1);
      dash(ctx, pn[0], pn[1], ...P(now[0], wallI, now[2]).slice(0, 2), rgba(C.Q, 0.55), 1);
      V.dot(ctx, ...P(now[0], now[1], floorQ).slice(0, 2), 3.5, C.I, 8);
      V.dot(ctx, ...P(now[0], wallI, now[2]).slice(0, 2), 3.5, C.Q, 8);

      // derinliğe göre sıralı çizim: sarmal parçaları + zaman ekseni + "şimdi" düzlemi
      const items = [];
      const proj = pts.map((p) => P(p[0], p[1], p[2]));
      let dmin = Infinity, dmax = -Infinity;
      for (let j = 0; j < M; j++) { const d = (proj[j][2] + proj[j + 1][2]) / 2; items.push([d, 0, j]); dmin = Math.min(dmin, d); dmax = Math.max(dmax, d); }
      const AX = 24;
      for (let j = 0; j < AX; j++) {
        const ta = -Lt - 0.2 + ((2 * Lt + 0.75) * j) / AX, tb = -Lt - 0.2 + ((2 * Lt + 0.75) * (j + 1)) / AX;
        items.push([((P(ta, 0, 0)[2] + P(tb, 0, 0)[2]) / 2), 1, j, ta, tb]);
      }
      items.push([P(Lt, 0, 0)[2] - 0.01, 2]);
      items.sort((a, b) => b[0] - a[0]);
      const span = Math.max(1e-6, dmax - dmin);
      ctx.lineCap = "round";
      for (const it of items) {
        if (it[1] === 0) {
          const j = it[2], z = 1 - (it[0] - dmin) / span; // 1 = en yakın
          ctx.strokeStyle = rgba(C.amp, 0.32 + 0.68 * z); ctx.lineWidth = 1.3 + 2.1 * z;
          ctx.beginPath(); ctx.moveTo(proj[j][0], proj[j][1]); ctx.lineTo(proj[j + 1][0], proj[j + 1][1]); ctx.stroke();
        } else if (it[1] === 1) {
          const a = P(it[3], 0, 0), b = P(it[4], 0, 0);
          ctx.strokeStyle = rgba(C.ink, 0.42); ctx.lineWidth = 1.2;
          ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke();
        } else {
          // şimdiki düzlem: I ve Q eksenleri ile dönen ok
          const c0 = P(Lt, 0, 0);
          ctx.lineWidth = 1.3;
          line([P(Lt, -1.25, 0), P(Lt, 1.25, 0)], rgba(C.I, 0.65), 1.3);
          line([P(Lt, 0, -1.25), P(Lt, 0, 1.25)], rgba(C.Q, 0.65), 1.3);
          ctx.save(); ctx.beginPath(); for (let j = 0; j <= 64; j++) { const a = (TAU * j) / 64, p = P(Lt, Math.cos(a), Math.sin(a)); j ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1]); }
          ctx.strokeStyle = rgba(C.ink, 0.25); ctx.setLineDash([2, 4]); ctx.lineWidth = 1; ctx.stroke(); ctx.restore();
          const pi = P(Lt, 1.42, 0), pq = P(Lt, 0, 1.42);
          V.text(ctx, "I", pi[0], pi[1] + 5, { color: C.I, size: 16, align: "center", font: FONT.display, weight: 800 });
          V.text(ctx, "Q", pq[0], pq[1] + 5, { color: C.Q, size: 16, align: "center", font: FONT.display, weight: 800 });
          if (Math.hypot(pn[0] - c0[0], pn[1] - c0[1]) > 6) V.arrow(ctx, c0[0], c0[1], pn[0], pn[1], C.amp, 2.8, 12);
          V.dot(ctx, pn[0], pn[1], 5, C.amp, 16);
        }
      }
      // zaman ekseni etiketi
      const pe = P(Lt + 0.55, 0, 0), pb = P(Lt + 0.3, 0, 0);
      if (Math.hypot(pe[0] - pb[0], pe[1] - pb[1]) > 4) {
        V.arrow(ctx, pb[0], pb[1], pe[0], pe[1], rgba(C.ink, 0.6), 1.4, 8);
        V.text(ctx, "zaman", pe[0] + (pe[0] >= pb[0] ? 6 : -6), pe[1] + 14, { color: C.ink2, size: 12.5, align: pe[0] >= pb[0] ? "left" : "right" });
      }

      // görünüm açıklaması
      const yd = yaw / D2R, pd = pitch / D2R;
      let msg;
      if (pd > 80) msg = '<b>Üstten:</b> zemindeki mavi gölgeyle çakışır. Yalnızca <span class="ci">I</span> dalgası görünür.';
      else if (Math.abs(yd + 90) < 7 && Math.abs(pd) < 7) msg = '<b>Yandan:</b> arka duvardaki gölgeyle çakışır. Yalnızca <span class="cq">Q</span> dalgası görünür.';
      else if (Math.abs(yd) < 7 && Math.abs(pd) < 7) msg = '<b>Önden:</b> zaman ekseni boyunca bakınca sarmal bir çembere döner: dönen ok.';
      else msg = "Sürükleyerek döndürün";
      if (cap._m !== msg) { cap.innerHTML = msg; cap._m = msg; }
    }

    function goView(key) {
      const [ty, tp] = VIEWS[key];
      let y1 = ty * D2R;
      while (y1 - yaw > Math.PI) y1 -= TAU;
      while (y1 - yaw < -Math.PI) y1 += TAU;
      anim = { y0: yaw, p0: pitch, y1, p1: tp * D2R, t: 0 };
    }
    let lx = 0, ly = 0;
    L.pointer(cv, {
      down: (x, y) => { lx = x; ly = y; anim = null; cv.style.cursor = "grabbing"; views.set(null); },
      move: (x, y) => {
        yaw -= (x - lx) * 0.009; pitch = clamp(pitch + (y - ly) * 0.009, -89.5 * D2R, 89.5 * D2R);
        lx = x; ly = y;
        while (yaw > Math.PI) yaw -= TAU; while (yaw < -Math.PI) yaw += TAU;
      },
      up: () => { cv.style.cursor = "grab"; },
    });

    const views = seg([["side", "Yandan bak"], ["top", "Üstten bak"], ["front", "Önden bak"], ["tilt", "Eğik bak"]], "tilt", goView, "Görünüm");
    const kSl = slider({ label: "Frekans", min: 0.2, max: 1.2, step: 0.01, value: k, fmt: (v) => num(v, 2) + " tur/sn", oninput: (v) => (k = v) });
    const pause = toggle("Duraklat", false, (v) => (paused = v));
    ctrl.append(views, kSl, pause);

    const lp = loop((dt) => {
      if (!paused) tau += dt;
      if (anim) {
        anim.t = Math.min(1, anim.t + dt / 0.9);
        const e = L.ease(anim.t);
        yaw = anim.y0 + (anim.y1 - anim.y0) * e; pitch = anim.p0 + (anim.p1 - anim.p0) * e;
        if (anim.t >= 1) anim = null;
      }
      draw();
    });
    return { enter() { lp.start(); }, leave() { lp.stop(); } };
  };

  /* ================= 3. Neden iki sayı? ================= */
  Demos.whyTwo = function (stage, slide) {
    const cv = h("canvas", { "aria-label": "Zıt yönde dönen iki ok ve spektrum" });
    const fill = h("div.fill", cv);
    const ctrl = h("div.controls");
    stage.append(fill, ctrl);

    let f = 1, qOn = true, T = 0;
    const FS = 16, NF = 512, SPAN = 4; // spektrum: örnekleme hızı 16, gösterilen aralık ±4 tur/sn
    const buf = new Float32Array(2 * NF), rnd = DSP.rng(7);
    const re = new Float64Array(NF), im = new Float64Array(NF), spec = new Float32Array(NF);
    let peakPos = 0, peakNeg = 0;
    function compute() {
      for (let n = 0; n < NF; n++) {
        const a = (TAU * f * n) / FS + 0.3;
        buf[2 * n] = Math.cos(a) + 0.0025 * DSP.gaussian(rnd);
        buf[2 * n + 1] = qOn ? Math.sin(a) + 0.0025 * DSP.gaussian(rnd) : 0;
      }
      DSP.spectrum(buf, NF, { window: "hann", out: spec, re, im });
      // ±f çevresindeki en yüksek kutu (ölçülür)
      const at = (fr) => { const c = Math.round(NF / 2 + (fr * NF) / FS); let m = -200; for (let i = c - 2; i <= c + 2; i++) if (i >= 0 && i < NF) m = Math.max(m, spec[i]); return m; };
      peakPos = at(f); peakNeg = at(-f);
    }

    function dial(ctx, cx, cy, r, fr, title) {
      const a = TAU * fr * T + 0.3, I = Math.cos(a), Q = Math.sin(a);
      const tx = cx + I * r, ty = cy - Q * r;
      ctx.strokeStyle = rgba(C.ink, 0.12); ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(cx - r - 6, cy + 0.5); ctx.lineTo(cx + r + 6, cy + 0.5); ctx.moveTo(cx + 0.5, cy - r - 6); ctx.lineTo(cx + 0.5, cy + r + 6); ctx.stroke();
      ctx.strokeStyle = rgba(C.ink, 0.25); ctx.setLineDash([2, 4]); ctx.beginPath(); ctx.arc(cx, cy, r, 0, TAU); ctx.stroke(); ctx.setLineDash([]);
      // dönüş yönü oku (nane)
      if (Math.abs(fr) > 0.02) {
        const ccw = fr > 0, rr = r + 10, a0 = -0.35 * Math.PI, a1 = a0 + (ccw ? -1 : 1) * 0.55 * Math.PI;
        ctx.strokeStyle = qOn ? rgba(C.phase, 0.9) : rgba(C.ink, 0.18); ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(cx, cy, rr, a0, a1, ccw); ctx.stroke();
        const ex = cx + rr * Math.cos(a1), ey = cy + rr * Math.sin(a1), tang = a1 + (ccw ? -Math.PI / 2 : Math.PI / 2);
        ctx.fillStyle = ctx.strokeStyle; ctx.beginPath();
        ctx.moveTo(ex + 7 * Math.cos(tang), ey + 7 * Math.sin(tang));
        ctx.lineTo(ex + 5 * Math.cos(tang + 2.2), ey + 5 * Math.sin(tang + 2.2));
        ctx.lineTo(ex + 5 * Math.cos(tang - 2.2), ey + 5 * Math.sin(tang - 2.2)); ctx.fill();
      }
      if (qOn) {
        dash(ctx, tx, ty, tx, cy, rgba(C.I, 0.6), 1);
        dash(ctx, tx, ty, cx, ty, rgba(C.Q, 0.6), 1);
        bar(ctx, cx, cy, cx, ty, C.Q, 4);
        bar(ctx, cx, cy, tx, cy, C.I, 4);
        V.arrow(ctx, cx, cy, tx, ty, C.amp, 2.6, 11);
      } else {
        // Q yok: ok bilinmez, yalnızca yerdeki gölge var
        ctx.save(); ctx.setLineDash([3, 4]); ctx.strokeStyle = rgba(C.ink, 0.22); ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(tx, ty); ctx.moveTo(cx, cy); ctx.lineTo(tx, cy + Q * r); ctx.stroke(); ctx.restore();
        V.text(ctx, "?", tx, ty - 6, { color: C.ink2, size: 15, align: "center", weight: 700 });
        V.text(ctx, "?", tx, cy + Q * r + 16, { color: C.ink2, size: 15, align: "center", weight: 700 });
        bar(ctx, cx, cy, tx, cy, C.I, 4);
      }
      V.dot(ctx, cx, cy, 2.5, C.amp);
      return title;
    }

    function strip(ctx, x, y, w, hh, fr, label, dirTxt) {
      const span = 3; // saniye
      ctx.strokeStyle = rgba(C.line, 1); ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(x, y + hh / 2 + 0.5); ctx.lineTo(x + w, y + hh / 2 + 0.5); ctx.stroke();
      const n = Math.max(60, Math.round(w / 2)), I = new Float32Array(n), Q = new Float32Array(n);
      for (let i = 0; i < n; i++) { const t = T - (i / (n - 1)) * span, a = TAU * fr * t + 0.3; I[i] = Math.cos(a); Q[i] = Math.sin(a); }
      if (qOn) V.wave(ctx, { x, y, w, h: hh, ys: Q, a: 1.15, color: C.Q, width: 2 });
      V.wave(ctx, { x, y, w, h: hh, ys: I, a: 1.15, color: C.I, width: 2.2 });
      V.text(ctx, label, x, y - 8, { color: C.ink, size: 14, weight: 700 });
      const nar = w < 300;
      V.text(ctx, dirTxt, x + w, nar ? y + hh + 14 : y - 8, { color: qOn ? C.phase : C.muted, size: nar ? 11.5 : 12.5, align: "right" });
    }

    const st = canvas(cv, () => draw());
    function draw() {
      const { ctx, w, h: H } = st;
      if (!w) return;
      ctx.clearRect(0, 0, w, H);
      const pad = 16, specH = Math.max(150, Math.min(260, H * 0.4));
      const top = 14, rowsH = H - specH - top - 22, rowH = rowsH / 2;
      const r = Math.max(26, Math.min(rowH * 0.32, w * 0.09));
      const dirs = (fr) => (Math.abs(fr) < 0.02 ? "dönmüyor" : fr > 0 ? "saat yönünün tersine" : "saat yönünde");
      [[f, "Sinyal"], [-f, "İkizi"]].forEach(([fr, name], k) => {
        const y0 = top + k * rowH, cx = pad + r + 14, cy = y0 + rowH / 2 + 8;
        dial(ctx, cx, cy, r, fr);
        const sx = cx + r + 28, sw = w - sx - pad;
        strip(ctx, sx, cy - rowH * 0.3, sw, rowH * 0.6, fr, `${name}: ${sgn(fr, 2)} tur/sn`, qOn ? dirs(fr) : "yön bilinmiyor");
      });
      if (!qOn) {
        const y = top + rowH + 2;
        ctx.fillStyle = rgba(C.I, 0.12); ctx.strokeStyle = rgba(C.I, 0.5);
        const txt = "Yalnızca I ile iki sinyal birebir aynı", tw = Math.min(w - 40, 290);
        ctx.beginPath(); ctx.roundRect(w / 2 - tw / 2, y - 12, tw, 24, 12); ctx.fill(); ctx.stroke();
        V.text(ctx, txt, w / 2, y + 5, { color: C.ink, size: 12.5, align: "center", weight: 700 });
      }

      // spektrum
      const sx = pad, sy = H - specH - 6, sw = w - 2 * pad, sh = specH - 34;
      ctx.fillStyle = rgba(C.bg, 0.55); ctx.fillRect(sx, sy, sw, sh);
      V.dbGrid(ctx, { x: sx, y: sy, w: sw, h: sh, min: -90, max: 5, step: 20, unit: "dB" });
      const from = NF / 2 - (SPAN * NF) / FS, to = NF / 2 + (SPAN * NF) / FS;
      V.spectrum(ctx, { x: sx, y: sy, w: sw, h: sh, db: spec, min: -90, max: 5, from, to });
      V.frame(ctx, sx, sy, sw, sh);
      V.text(ctx, "Spektrum, FFT ile ölçülen", sx + sw - 8, sy + 16, { color: C.muted, size: 11.5, align: "right" });
      const X = (fr) => sx + ((fr + SPAN) / (2 * SPAN)) * sw;
      const tk = V.ticks(-SPAN, SPAN, 8);
      V.scale(ctx, { x: sx, y: sy + sh, w: sw, from: -SPAN, to: SPAN, major: tk.major, minor: tk.minor, fmt: (v) => (v > 0 ? "+" : "") + num(v, 0), size: 12 });
      V.text(ctx, "tur/sn", sx + sw, sy + sh + 32, { align: "right", size: 11, color: C.muted });
      const Y = (db) => sy + sh * (1 - (db + 90) / 95);
      const lab = (fr, txt, col, db) => { const xx = X(fr), right = fr >= 0 ? xx < sx + sw - 150 : xx < sx + 150; halo(ctx, txt, xx + (right ? 9 : -9), Math.max(sy + 34, Y(db) + 14), col, 12.5, right ? "left" : "right"); };
      // tepe etiketleri
      lab(f, `${f >= 0 ? "+f" : "f"}: ${num(peakPos, 1)} dB`, C.ink, peakPos);
      if (Math.abs(f) > 0.15) {
        if (!qOn) {
          lab(-f, `ayna görüntüsü: ${num(peakNeg, 1)} dB`, C.ink, peakNeg);
        } else {
          dash(ctx, X(-f), sy + 24, X(-f), sy + sh, rgba(C.ink, 0.25), 1, [2, 4]);
          lab(-f, `${f >= 0 ? "−f" : "ayna"}: ${num(peakNeg, 0)} dB, boş`, C.muted, -40);
        }
      }
    }

    const fSl = slider({ label: "Frekans", min: -2, max: 2, step: 0.05, value: f, fmt: (v) => sgn(v, 2) + " tur/sn", oninput: (v) => { f = v; compute(); } });
    const qT = toggle("Q bileşeni", qOn, (v) => { qOn = v; compute(); }, "cq");
    const listen = listenToggle(slide, (() => {
      let pc = 0, pa = 0, fa = 0, g = 0;
      return (out, rate) => {
        for (let i = 0; i < out.length; i++) {
          fa += (f * 140 - fa) * 0.002; g += ((qOn ? 1 : 0) - g) * 0.004;
          pc += (TAU * 600) / rate; pa += (TAU * fa) / rate;
          if (pc > TAU) pc -= TAU; if (pa > TAU) pa -= TAU; if (pa < 0) pa += TAU;
          out[i] = 0.32 * (Math.cos(pa) * Math.cos(pc) - g * Math.sin(pa) * Math.sin(pc));
        }
      };
    })());
    ctrl.append(fSl, qT, listen);
    compute();

    const lp = loop((dt) => { T += dt; draw(); });
    return { enter() { lp.start(); }, leave() { lp.stop(); listen.stop(); } };
  };

  /* ================= 4. Genlik ve faz ================= */
  Demos.ampPhase = function (stage, slide) {
    const pv = h("canvas", { "aria-label": "I/Q düzlemi: noktayı sürükleyin" });
    const wv = h("canvas", { "aria-label": "Dalga biçimleri" });
    const fill = h("div.fill", h("div.ch3-ap", pv, wv));
    const ctrl = h("div.controls");
    stage.append(fill, ctrl);

    let I = 0.6, Q = 0.45, spin = false, hover = false;
    const RMAX = 1.25;
    const ps = canvas(pv, () => drawPlane());
    const ws = canvas(wv, () => drawWaves());
    const geo = () => { const { w, h: H } = ps; const R = Math.min(w, H) / 2 - 28; return { cx: w / 2, cy: H / 2, u: R / RMAX }; };

    function drawPlane() {
      const { ctx, w, h: H } = ps;
      if (!w) return;
      ctx.clearRect(0, 0, w, H);
      const { cx, cy, u } = geo();
      // ızgara
      ctx.strokeStyle = rgba(C.line, 0.8); ctx.lineWidth = 1; ctx.beginPath();
      for (const v of [-1, -0.5, 0.5, 1]) { ctx.moveTo(cx + v * u, cy - RMAX * u); ctx.lineTo(cx + v * u, cy + RMAX * u); ctx.moveTo(cx - RMAX * u, cy - v * u); ctx.lineTo(cx + RMAX * u, cy - v * u); }
      ctx.stroke();
      V.iqPlane(ctx, cx, cy, RMAX * u, { scale: RMAX });
      for (const v of [-1, 1]) {
        V.text(ctx, sgn(v, 0), cx + v * u, cy + 15, { color: C.muted, size: 11, align: "center" });
        V.text(ctx, sgn(v, 0), cx - 6, cy - v * u + 4, { color: C.muted, size: 11, align: "right" });
      }
      const A = Math.hypot(I, Q), ph = Math.atan2(Q, I);
      const px = cx + I * u, py = cy - Q * u;
      dash(ctx, px, py, px, cy, rgba(C.I, 0.7));
      dash(ctx, px, py, cx, py, rgba(C.Q, 0.7));
      bar(ctx, cx, cy, px, cy, C.I, 5);
      bar(ctx, cx, cy, cx, py, C.Q, 5);
      // faz yayı
      if (A > 0.04) {
        const ar = Math.min(0.32 * u, A * u * 0.7);
        ctx.strokeStyle = C.phase; ctx.lineWidth = 2.4;
        ctx.beginPath(); ctx.arc(cx, cy, ar, 0, -ph, ph > 0); ctx.stroke();
        const mid = -ph / 2, lr = ar + 18;
        V.text(ctx, `${num(degOf(ph), 0)}°`, cx + lr * Math.cos(mid), cy + lr * Math.sin(mid) + 5, { color: C.phase, size: 14, align: "center", weight: 700 });
      }
      // genlik oku
      if (A > 0.02) V.arrow(ctx, cx, cy, px, py, C.amp, 3.2, 14);
      // genlik etiketi okun ortasında, oka dik kaydırılmış
      if (A > 0.15) {
        const nx = -Q / A, ny = -I / A, mx = cx + (I * u) / 2 + nx * 16, my = cy - (Q * u) / 2 + ny * 16;
        V.text(ctx, `A ${num(A, 2)}`, mx, my + 4, { color: C.amp, size: 14, align: "center", weight: 700 });
      }
      ctx.save(); ctx.shadowColor = C.amp; ctx.shadowBlur = hover ? 22 : 12;
      ctx.fillStyle = C.amp; ctx.beginPath(); ctx.arc(px, py, hover ? 9 : 7.5, 0, TAU); ctx.fill(); ctx.restore();
      ctx.strokeStyle = C.bg; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(px, py, 3, 0, TAU); ctx.stroke();
    }

    function drawWaves() {
      const { ctx, w, h: H } = ws;
      if (!w) return;
      ctx.clearRect(0, 0, w, H);
      const padL = 14, padR = 16, x = padL, ww = w - padL - padR;
      const gapY = 34, top = 24, sh = (H - top - 2 * gapY - 22) / 3;
      const n = Math.max(120, Math.round(ww)), A = Math.hypot(I, Q), ph = Math.atan2(Q, I);
      const rows = [
        { lab: "I · kosinüs", col: C.I, fn: (t) => I * Math.cos(TAU * t) },
        { lab: "−Q · sinüs", col: C.Q, fn: (t) => -Q * Math.sin(TAU * t) },
        { lab: "Toplam: havadaki gerçek sinyal", col: C.amp, fn: (t) => I * Math.cos(TAU * t) - Q * Math.sin(TAU * t) },
      ];
      rows.forEach((r, k) => {
        const y = top + k * (sh + gapY);
        const ys = new Float32Array(n);
        for (let i = 0; i < n; i++) ys[i] = r.fn((2 * i) / (n - 1));
        ctx.strokeStyle = rgba(C.line, 1); ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(x, y + sh / 2 + 0.5); ctx.lineTo(x + ww, y + sh / 2 + 0.5); ctx.stroke();
        V.text(ctx, r.lab, x, y - 6, { color: r.col, size: 13.5, weight: 700 });
        if (k === 2) {
          // referans kosinüs ve ±A zarfı
          const ref = new Float32Array(n);
          for (let i = 0; i < n; i++) ref[i] = Math.cos((TAU * 2 * i) / (n - 1));
          ctx.save(); ctx.setLineDash([3, 5]);
          V.wave(ctx, { x, y, w: ww, h: sh, ys: ref, a: RMAX, color: rgba(C.ink, 0.28), width: 1.3 });
          ctx.restore();
          const ya = y + sh / 2 - (A / RMAX) * (sh / 2), yb = y + sh / 2 + (A / RMAX) * (sh / 2);
          dash(ctx, x, ya, x + ww, ya, rgba(C.amp, 0.35), 1, [2, 4]);
          dash(ctx, x, yb, x + ww, yb, rgba(C.amp, 0.35), 1, [2, 4]);
          // faz kayması: referans tepesinden (t = 1) sinyalin tepesine
          if (A > 0.04) {
            const tp = 1 - ph / TAU, X0 = x + (1 / 2) * ww, X1 = x + (tp / 2) * ww, yy = Math.max(y + 6, y + sh / 2 - (Math.max(A, 1) / RMAX) * (sh / 2) - 8);
            if (Math.abs(X1 - X0) > 3) { ctx.save(); ctx.globalAlpha = 0.95; V.arrow(ctx, X0, yy, X1, yy, C.phase, 2, 8); ctx.restore(); }
            dash(ctx, X1, yy, X1, y + sh / 2 - (A / RMAX) * (sh / 2), rgba(C.phase, 0.6), 1, [2, 3]);
            V.text(ctx, `faz kayması ${num(degOf(ph), 0)}°`, x + ww, y - 6, { color: C.phase, size: 12.5, align: "right", weight: 700 });
          }
          V.text(ctx, "kesikli: faz 0° referansı", x + ww, y + sh + 16, { color: C.muted, size: 11, align: "right" });
        }
        V.wave(ctx, { x, y, w: ww, h: sh, ys, a: RMAX, color: r.col, width: k === 2 ? 2.8 : 2 });
      });
    }

    function setIQ(i, q) {
      const r = Math.hypot(i, q);
      if (r > RMAX) { i *= RMAX / r; q *= RMAX / r; }
      I = i; Q = q; update();
    }
    const ro = {};
    const readout = (k, cls) => { const v = h("span.v", "—"); ro[k] = v; return h("div.readout" + (cls ? "." + cls : ""), h("span.k", k), v); };
    const reads = h("div.readouts", readout("I", "ci"), readout("Q", "cq"), readout("Genlik √(I² + Q²)", "camp"), readout("Faz atan2(Q, I)", "cph"));
    function update() {
      ro["I"].textContent = sgn(I); ro["Q"].textContent = sgn(Q);
      ro["Genlik √(I² + Q²)"].textContent = num(Math.hypot(I, Q), 2);
      ro["Faz atan2(Q, I)"].textContent = num(degOf(Math.atan2(Q, I)), 0) + "°";
      drawPlane(); drawWaves();
    }
    function fromXY(x, y) { const { cx, cy, u } = geo(); setIQ((x - cx) / u, (cy - y) / u); }
    L.pointer(pv, {
      down: (x, y) => { spinT.set(false); spin = false; hover = true; fromXY(x, y); },
      move: (x, y) => fromXY(x, y),
      up: () => { hover = false; drawPlane(); },
      hover: (x, y) => {
        if (x < 0) { if (hover) { hover = false; drawPlane(); } return; }
        const { cx, cy, u } = geo(), near = Math.hypot(x - (cx + I * u), y - (cy - Q * u)) < 16;
        if (near !== hover) { hover = near; drawPlane(); }
      },
    });
    pv.style.cursor = "crosshair";

    const spinT = toggle("Döndür", false, (v) => (spin = v));
    const listen = listenToggle(slide, (() => {
      let p = 0, g = 0, phs = 0;
      return (out, rate) => {
        const A = Math.hypot(I, Q), ph = Math.atan2(Q, I);
        let d = ph - phs; while (d > Math.PI) d -= TAU; while (d < -Math.PI) d += TAU;
        for (let i = 0; i < out.length; i++) {
          g += (A - g) * 0.002; phs += d * 0.0008;
          p += (TAU * 330) / rate; if (p > TAU) p -= TAU;
          out[i] = 0.3 * g * Math.cos(p + phs);
        }
      };
    })());
    ctrl.append(reads, h("span.spacer"), spinT, listen);
    update();

    const lp = loop((dt) => {
      if (!spin) return;
      const A = Math.hypot(I, Q) || 0.8, a = Math.atan2(Q, I) + TAU * 0.2 * dt;
      I = A * Math.cos(a); Q = A * Math.sin(a); update();
    });
    return { enter() { lp.start(); update(); }, leave() { lp.stop(); listen.stop(); } };
  };

  /* ================= 5. IQ dosyası ================= */
  Demos.iqFile = function (stage, slide) {
    // gerçek bir sinyal: dönen ton + biraz gürültü, cu8 olarak nicemlenmiş
    const NS = 64, rnd = DSP.rng(42);
    const tone = DSP.tone(NS, 0.043, 0.8, 0.9);
    const bytes = new Uint8Array(2 * NS);
    for (let i = 0; i < 2 * NS; i++) bytes[i] = clamp(Math.round(127.5 + 127.5 * (tone[i] + 0.035 * DSP.gaussian(rnd))), 0, 255);
    const dec = (b) => (b - 127.5) / 127.5;
    const hex = (b) => b.toString(16).toUpperCase().padStart(2, "0");

    const hexBox = h("div.ch3-hex", { role: "group", "aria-label": "Ham baytlar (onaltılık)" });
    const pv = h("canvas", { "aria-label": "Çözülen örnekler I/Q düzleminde" });
    const decLine = h("div.ch3-dec");
    const fill = h("div.fill.ch3-iqf", h("div.ch3-hexwrap", h("div.ch3-hexhead", h("b", "kayit.cu8"), h("span", "ilk 128 bayt · onaltılık")), hexBox), h("div.ch3-plane", pv));
    const ctrl = h("div.controls");
    const ctrl2 = h("div.controls.ch3-size");
    stage.append(fill, decLine, ctrl, ctrl2);

    let done = 0, preview = -1, auto = false, acc = 0, cells = [];
    let perRow = 0;
    function build() {
      const want = hexBox.parentNode.clientWidth >= 500 ? 16 : 8;
      if (want === perRow) return;
      perRow = want; hexBox.textContent = ""; cells = [];
      for (let r = 0; r < (2 * NS) / perRow; r++) {
        const row = h("div.row", h("span.off", (r * perRow).toString(16).toUpperCase().padStart(4, "0")));
        for (let c = 0; c < perRow; c++) {
          const i = r * perRow + c;
          const cell = h("span.b" + (i % 2 ? ".bq" : ".bi"), { "data-i": i }, hex(bytes[i]));
          cell.addEventListener("pointerenter", () => { preview = i >> 1; render(); });
          cell.addEventListener("pointerleave", () => { preview = -1; render(); });
          cell.addEventListener("click", () => { done = Math.max(done, (i >> 1) + 1); blip((i >> 1)); render(); });
          cells.push(cell); row.append(cell);
        }
        hexBox.append(row);
      }
      render();
    }
    new ResizeObserver(build).observe(fill);

    function decHTML(s) {
      if (s < 0) return '<span class="muted">Henüz çözülen örnek yok. «Sonraki örneği çöz»e basın ya da bir baytın üzerine gelin.</span>';
      const bi = bytes[2 * s], bq = bytes[2 * s + 1];
      const part = (cls, nm, b) => `<span class="${cls}">${nm}</span> <code>0x${hex(b)}</code> = ${b} → (${b} − 127,5) / 127,5 = <b class="${cls}">${sgn(dec(b), 3)}</b>`;
      return `<span class="lab">Örnek ${s + 1}</span> ${part("ci", "I", bi)} <span class="sep">·</span> ${part("cq", "Q", bq)}`;
    }
    function render() {
      const cur = preview >= 0 ? preview : done - 1;
      cells.forEach((c, i) => {
        const s = i >> 1;
        c.classList.toggle("done", s < done);
        c.classList.toggle("cur", s === cur);
      });
      decLine.innerHTML = decHTML(cur);
      drawPlane();
    }
    function blip(s) {
      const a = Math.atan2(dec(bytes[2 * s + 1]), dec(bytes[2 * s]));
      const fr = 440 * 2 ** (((a + Math.PI) / TAU) * 1.0), n = 2400, out = new Float32Array(n);
      for (let i = 0; i < n; i++) out[i] = 0.25 * Math.sin((TAU * fr * i) / 48000) * Math.exp(-i / 500) * Math.min(1, i / 40);
      try { Sound.play(out, 48000); } catch (e) {}
    }

    const ps = canvas(pv, () => drawPlane());
    function drawPlane() {
      const { ctx, w, h: H } = ps;
      if (!w) return;
      ctx.clearRect(0, 0, w, H);
      const R = Math.min(w, H) / 2 - 30, cx = w / 2, cy = H / 2 - 4;
      V.iqPlane(ctx, cx, cy, R * 1.12, { scale: 1.12, grid: false });
      // bayt ölçeği
      V.text(ctx, "0", cx - R, cy + 16, { color: C.muted, size: 10.5, align: "center" });
      V.text(ctx, "255", cx + R, cy + 16, { color: C.muted, size: 10.5, align: "center" });
      V.text(ctx, "−1", cx - R, cy + 28, { color: C.muted, size: 10.5, align: "center" });
      V.text(ctx, "+1", cx + R, cy + 28, { color: C.muted, size: 10.5, align: "center" });
      const P = (s) => [cx + dec(bytes[2 * s]) * R, cy - dec(bytes[2 * s + 1]) * R];
      if (done > 1) {
        ctx.strokeStyle = rgba(C.ink, 0.18); ctx.lineWidth = 1; ctx.beginPath();
        for (let s = 0; s < done; s++) { const [x, y] = P(s); s ? ctx.lineTo(x, y) : ctx.moveTo(x, y); }
        ctx.stroke();
      }
      for (let s = 0; s < done; s++) { const [x, y] = P(s); V.dot(ctx, x, y, 3.2, rgba(C.amp, 0.4 + 0.6 * ((s + 1) / done))); }
      const cur = preview >= 0 ? preview : done - 1;
      if (cur >= 0) {
        const [x, y] = P(cur);
        dash(ctx, x, y, x, cy, rgba(C.I, 0.8));
        dash(ctx, x, y, cx, y, rgba(C.Q, 0.8));
        bar(ctx, cx, cy, x, cy, C.I, 4);
        bar(ctx, cx, cy, cx, y, C.Q, 4);
        if (cur < done) V.dot(ctx, x, y, 6, C.amp, 18);
        else { ctx.strokeStyle = C.amp; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(x, y, 7, 0, TAU); ctx.stroke(); }
      }
      V.text(ctx, `${done} / ${NS} örnek çözüldü`, 10, H - 10, { color: C.ink2, size: 12 });
    }

    const next = h("button.btn.primary", { type: "button" }, "Sonraki örneği çöz");
    next.addEventListener("click", () => { if (done < NS) { done++; blip(done - 1); } preview = -1; render(); });
    const all = h("button.btn", { type: "button" }, "Hepsini çöz");
    all.addEventListener("click", () => { auto = true; });
    const reset = h("button.btn", { type: "button" }, "Baştan");
    reset.addEventListener("click", () => { done = 0; auto = false; render(); });
    ctrl.append(next, all, reset);

    // dosya boyutu hesaplayıcısı
    let rate = 2.4e6, fmt = "cu8";
    // bayt: en fazla üç anlamlı basamak (17,3 GB)
    const sz = (v) => { const u = ["B", "kB", "MB", "GB", "TB"]; let i = 0; while (v >= 1000 && i < 4) { v /= 1000; i++; } return num(v, v >= 100 ? 0 : v >= 10 ? 1 : 2).replace(/(,\d*?)0+$/, "$1").replace(/,$/, "") + " " + u[i]; };
    const BPS = { cu8: 2, cs16: 4, cf32: 8 };
    const out = {};
    const ro = (k) => { const v = h("span.v", "—"); out[k] = v; return h("div.readout", h("span.k", k), v); };
    const rSl = slider({ label: "Örnekleme hızı", min: 0.25e6, max: 20e6, value: rate, log: true, fmt: (v) => num(v / 1e6, v < 1e6 ? 2 : 1) + " MS/sn", oninput: (v) => { rate = v; presets.set(null); size(); } });
    const presets = seg([["rtl", "RTL-SDR 2,4"], ["hackrf", "HackRF 20"]], "rtl", (k) => { rate = k === "rtl" ? 2.4e6 : 20e6; rSl.set(rate); size(); }, "Hazır değerler");
    const fmts = seg([["cu8", "cu8 · 2 bayt"], ["cs16", "cs16 · 4 bayt"], ["cf32", "cf32 · 8 bayt"]], fmt, (k) => { fmt = k; size(); }, "Biçim");
    const reads = h("div.readouts", ro("1 saniye"), ro("1 dakika"), ro("1 saat"));
    function size() {
      const bps = rate * BPS[fmt];
      out["1 saniye"].textContent = sz(bps);
      out["1 dakika"].textContent = sz(bps * 60);
      out["1 saat"].textContent = sz(bps * 3600);
    }
    ctrl2.append(rSl, presets, fmts, reads);
    size();

    const lp = loop((dt) => {
      if (!auto) return;
      acc += dt;
      while (acc > 1 / 24) { acc -= 1 / 24; if (done < NS) done++; else auto = false; }
      render();
    });
    queueMicrotask(build);
    return { enter() { lp.start(); build(); render(); }, leave() { lp.stop(); auto = false; } };
  };

  /* ---------- hayalet el senaryoları ---------- */
  window.GUIDE_SCENARIOS = Object.assign(window.GUIDE_SCENARIOS || {}, {
    fazor: [{ slide: "label:Frekans", to: 0.8 }, { wait: 900 }, { click: "Duraklat" }, { wait: 700 }, { click: "Duraklat" }],
    sarmal: [{ drag: "aria:Üç boyutlu sarmal: sürükleyerek döndürün", path: [[0.35, 0.5], [0.55, 0.42], [0.7, 0.45]] }, { wait: 500 }, { click: "=Önden bak" }, { wait: 1300 }, { click: "=Üstten bak" }],
    "neden-iki": [{ slide: "label:Frekans", to: -1 }, { wait: 600 }, { click: "Q bileşeni" }, { wait: 1200 }, { slide: "label:Frekans", to: 1 }],
    "genlik-faz": [{ drag: "aria:I/Q düzlemi: noktayı sürükleyin", path: [[0.66, 0.36], [0.78, 0.25], [0.5, 0.14], [0.26, 0.3], [0.2, 0.6]] }],
    "iq-dosyasi": [{ click: "Sonraki örneği çöz" }, { click: "Sonraki örneği çöz" }, { click: "=HackRF 20" }],
  });
})();

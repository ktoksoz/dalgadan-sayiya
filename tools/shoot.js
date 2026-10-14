/* Ekran görüntüsü ve konsol hatası denetimi (headless Chromium, file:// üzerinden).
   Kullanım: NODE_PATH=<playwright-core'un olduğu node_modules> node tools/shoot.js <çıktı klasörü> [slayt-id,...|all] [GxY,...]
   Varsayılan boyutlar: 1440x860, 1180x820, 390x844 */
const { chromium } = require("playwright-core");
const path = require("path"), fs = require("fs"), os = require("os");
const out = process.argv[2] || "shots";
const which = (process.argv[3] || "all").split(",");
const sizes = (process.argv[4] || "1440x860,1180x820,390x844").split(",").map((s) => s.split("x").map(Number));
const exe = (() => {
  const base = path.join(os.homedir(), "Library/Caches/ms-playwright");
  const d = fs.readdirSync(base).filter((n) => /^chromium-\d+$/.test(n)).sort().pop();
  return path.join(base, d, "chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing");
})();
(async () => {
  fs.mkdirSync(out, { recursive: true });
  const browser = await chromium.launch({ executablePath: exe, args: ["--autoplay-policy=no-user-gesture-required"] });
  const url = "file://" + path.resolve(__dirname, "../index.html");
  let errors = 0;
  for (const [w, hh] of sizes) {
    const page = await browser.newPage({ viewport: { width: w, height: hh }, deviceScaleFactor: 1 });
    page.on("console", (m) => { if (m.type() === "error" || m.type() === "warning") { errors += m.type() === "error"; console.log(`  [${m.type()}] ${w}x${hh}: ${m.text()}`); } });
    page.on("pageerror", (e) => { errors++; console.log(`  [pageerror] ${w}x${hh}: ${e.message}`); });
    await page.addInitScript(() => { try { localStorage.setItem("rehber.kapali", "1"); } catch (e) {} });
    await page.goto(url);
    await page.waitForTimeout(600);
    const ids = await page.evaluate(() => [...document.querySelectorAll(".slide")].map((s) => s.id));
    for (const id of ids) {
      if (which[0] !== "all" && !which.includes(id)) continue;
      await page.evaluate((id) => { location.hash = id; }, id);
      await page.waitForTimeout(1200);
      await page.screenshot({ path: path.join(out, `${id}-${w}.png`), fullPage: w < 600 });
    }
    await page.close();
  }
  await browser.close();
  console.log(errors ? `${errors} hata` : "konsolda hata yok");
})();

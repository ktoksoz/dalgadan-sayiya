/* Hayalet el senaryolarındaki her hedefin sayfada gerçekten bulunduğunu denetler.
   Kullanım: NODE_PATH=<playwright-core node_modules> node tools/check-guide.js */
const { chromium } = require("playwright-core");
const path = require("path"), fs = require("fs"), os = require("os");
const base = path.join(os.homedir(), "Library/Caches/ms-playwright");
const d = fs.readdirSync(base).filter((n) => /^chromium-\d+$/.test(n)).sort().pop();
(async () => {
  const browser = await chromium.launch({ executablePath: path.join(base, d, "chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing") });
  const page = await browser.newPage({ viewport: { width: 1440, height: 860 } });
  await page.addInitScript(() => { try { localStorage.setItem("rehber.kapali", "1"); } catch (e) {} });
  await page.goto("file://" + path.resolve(__dirname, "../index.html"));
  await page.waitForTimeout(500);
  const ids = await page.evaluate(() => [...document.querySelectorAll(".slide")].map((s) => s.id));
  let bad = 0, missing = [];
  for (const id of ids) {
    await page.evaluate((id) => { location.hash = id; }, id);
    await page.waitForTimeout(500);
    const r = await page.evaluate((id) => {
      const { S, find } = window.__rehber, slide = document.getElementById(id), steps = S[id];
      if (!steps) return { none: true };
      return { bad: steps.filter((st) => !st.wait).map((st) => st.click || st.slide || st.tap || st.draw || st.drag || st.move).filter((q) => !find(slide, q)) };
    }, id);
    if (r.none) { if (id !== "kapak" && id !== "son") missing.push(id); continue; }
    if (r.bad.length) { bad += r.bad.length; console.log(`✗ ${id}: bulunamayan hedefler: ${r.bad.join(" | ")}`); }
    else console.log(`✓ ${id}`);
  }
  if (missing.length) console.log("senaryosu olmayan slaytlar: " + missing.join(", "));
  await browser.close();
  console.log(bad || missing.length ? `${bad} eksik hedef, ${missing.length} senaryosuz slayt` : "tüm hedefler bulundu");
  process.exit(bad ? 1 : 0);
})();

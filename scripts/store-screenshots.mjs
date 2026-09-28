// Renders Chrome Web Store screenshots (1280x800) of the real popup, in EN and TR.
// The popup is opened as a page with chrome.tabs.query stubbed to return a
// sample tab, so it shows a realistic "dirty" URL.
// Usage: node scripts/store-screenshots.mjs   (PUPPETEER_MODULE may point to puppeteer)
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { readFileSync } from "node:fs";

const puppeteer = (await import(process.env.PUPPETEER_MODULE || "puppeteer")).default;
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "store-assets");

const SAMPLE = "https://www.example-shop.com/product/42?utm_source=newsletter&utm_medium=email&utm_campaign=fall_sale&fbclid=IwAR2x9Kq&gclid=Cj0KCQjw&color=green";

const COPY = {
  en: {
    title: "Tracking parameters, washed off.",
    lines: ["Removes utm_*, fbclid, gclid and 700+ other trackers", "Unwraps Google, Facebook and other redirect links", "Clean “Copy link address” on right click", "No network requests. No analytics. Open source."]
  },
  tr: {
    title: "Takip parametreleri temizlendi.",
    lines: ["utm_*, fbclid, gclid ve 700+ takipçiyi siler", "Google, Facebook ve diğer yönlendirme linklerini çözer", "Sağ tık “Bağlantı adresini kopyala” da temiz", "Ağ isteği yok. Analitik yok. Açık kaynak."]
  }
};

const browser = await puppeteer.launch({
  headless: true,
  args: [`--disable-extensions-except=${ROOT}`, `--load-extension=${ROOT}`, "--no-first-run"]
});
const swTarget = await browser.waitForTarget(t => t.type() === "service_worker" && t.url().includes("background.js"));
const extId = new URL(swTarget.url()).host;
const icon = "data:image/png;base64," + readFileSync(join(ROOT, "icons", "icon128.png")).toString("base64");

for (const [lang, copy] of Object.entries(COPY)) {
  const popup = await browser.newPage();
  await popup.setViewport({ width: 340, height: 460, deviceScaleFactor: 2 });
  await popup.evaluateOnNewDocument((sample, lang) => {
    chrome.tabs.query = async () => [{ id: 1, url: sample }];
    const get = chrome.i18n.getMessage.bind(chrome.i18n);
    // Force the locale by reading the bundled messages synchronously.
    const xhr = new XMLHttpRequest();
    xhr.open("GET", `/_locales/${lang}/messages.json`, false);
    xhr.send();
    const msgs = JSON.parse(xhr.responseText);
    chrome.i18n.getMessage = (key, subs) => {
      const m = msgs[key];
      if (!m) return get(key, subs);
      let s = m.message;
      for (const [name, ph] of Object.entries(m.placeholders || {})) {
        const idx = Number(ph.content.slice(1)) - 1;
        s = s.replace(new RegExp("\\$" + name + "\\$", "gi"), [].concat(subs || [])[idx] ?? "");
      }
      return s;
    };
  }, SAMPLE, lang);
  await popup.goto(`chrome-extension://${extId}/src/popup.html`);
  await new Promise(r => setTimeout(r, 500));
  const height = await popup.evaluate(() => document.body.scrollHeight);
  const shot = await popup.screenshot({ encoding: "base64", clip: { x: 0, y: 0, width: 340, height } });
  await popup.close();

  const card = await browser.newPage();
  await card.setViewport({ width: 1280, height: 800 });
  await card.setContent(`<!doctype html><html><body style="margin:0;width:1280px;height:800px;display:flex;align-items:center;gap:64px;padding:0 90px;box-sizing:border-box;background:linear-gradient(135deg,#0f6e56,#0b4d3d);font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#fff">
    <div style="flex:1">
      <img src="${icon}" width="72" height="72" style="border-radius:16px">
      <h1 style="font-size:46px;line-height:1.15;margin:26px 0 28px;font-weight:700">${copy.title}</h1>
      ${copy.lines.map(l => `<p style="font-size:22px;margin:0 0 14px;color:#d9f5ea">✓ ${l}</p>`).join("")}
    </div>
    <img src="data:image/png;base64,${shot}" style="width:400px;border-radius:14px;box-shadow:0 24px 60px rgba(0,0,0,.35)">
  </body></html>`);
  await card.screenshot({ path: join(OUT, `screenshot-${lang}.png`) });
  await card.close();
  console.log(`store-assets/screenshot-${lang}.png`);
}

await browser.close();

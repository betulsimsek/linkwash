// End-to-end test: loads the unpacked extension into Chrome for Testing and
// checks real navigations against a local server.
// Usage: node test/e2e.mjs   (needs puppeteer; PUPPETEER_MODULE may point to it)
import http from "node:http";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import assert from "node:assert/strict";

const puppeteer = (await import(process.env.PUPPETEER_MODULE || "puppeteer")).default;
const EXT = join(dirname(fileURLToPath(import.meta.url)), "..");

const seen = [];
const server = http.createServer((req, res) => {
  seen.push(req.url);
  res.setHeader("content-type", "text/html; charset=utf-8");
  if (req.url.startsWith("/links")) {
    const base = `http://localhost:${port}`;
    res.end(`<!doctype html><title>links</title>
      <a id="plain" href="${base}/target?utm_source=list&keep=1&fbclid=abc">plain</a>
      <a id="ctx" href="${base}/target?utm_campaign=ctx&keep=2" ping="${base}/ping">ctx</a>
      <a id="wrapped" href="https://www.google.com/url?q=${encodeURIComponent(base + "/landing?utm_medium=g&x=1")}&sa=D">wrapped</a>`);
    return;
  }
  res.end(`<!doctype html><title>ok</title><p>${req.url}</p>`);
});
await new Promise(r => server.listen(0, "127.0.0.1", r));
const port = server.address().port;
const base = `http://localhost:${port}`;

const browser = await puppeteer.launch({
  headless: true,
  // GitHub's Ubuntu runners block Chrome's sandbox (unprivileged user namespaces).
  args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`, "--no-first-run", ...(process.env.CI ? ["--no-sandbox"] : [])]
});

const results = [];
async function check(name, fn) {
  try {
    await fn();
    results.push(["ok", name]);
  } catch (e) {
    results.push(["FAIL", name, e.message]);
  }
}

const swTarget = await browser.waitForTarget(t => t.type() === "service_worker" && t.url().endsWith("src/background.js"));
const sw = await swTarget.worker();
const lastSeen = prefix => [...seen].reverse().find(u => u.startsWith(prefix));
const waitForUrl = (page, pred, ms = 5000) => page.waitForFunction(p => new RegExp(p).test(location.href), { timeout: ms }, pred);

await check("static ruleset is enabled", async () => {
  const ids = await sw.evaluate(() => chrome.declarativeNetRequest.getEnabledRulesets());
  assert.deepEqual(ids, ["clearurls"]);
});

await check("every DNR regexFilter is supported by Chrome's RE2", async () => {
  const rules = JSON.parse(readFileSync(join(EXT, "rules", "dnr_rules.json"), "utf8"));
  const regexes = rules.map(r => r.condition.regexFilter).filter(Boolean);
  const bad = await sw.evaluate(async list => {
    const out = [];
    for (const regex of list) {
      const r = await chrome.declarativeNetRequest.isRegexSupported({ regex });
      if (!r.isSupported) out.push(regex + " -> " + r.reason);
    }
    return out;
  }, regexes);
  assert.deepEqual(bad, []);
});

const page = await browser.newPage();

await check("DNR strips literal params before the request reaches the server", async () => {
  await page.goto(`${base}/target?utm_source=news&fbclid=1&keep=1&gclid=2`);
  assert.equal(lastSeen("/target"), "/target?keep=1");
  assert.equal(page.url(), `${base}/target?keep=1`);
});

await check("engine strips regex-only params on navigation", async () => {
  await page.goto(`${base}/regex?utm_weird_custom=1&keep=3`).catch(() => {});
  await waitForUrl(page, "/regex\\?keep=3$");
});

await check("Google redirect links are unwrapped and cleaned", async () => {
  const target = `${base}/landing?utm_medium=g&x=1`;
  await page.goto(`https://www.google.com/url?q=${encodeURIComponent(target)}&sa=D`).catch(() => {});
  await waitForUrl(page, `^${base.replace(/[.:/]/g, "\\$&")}/landing\\?x=1$`, 10000);
});

await check("clicking a link sends the clean URL", async () => {
  await page.goto(`${base}/links`);
  await Promise.all([page.waitForNavigation(), page.click("#plain")]);
  assert.equal(lastSeen("/target"), "/target?keep=1");
});

await check("right click cleans the link for 'Copy link address' and drops ping", async () => {
  await page.goto(`${base}/links`);
  await page.click("#ctx", { button: "right" });
  const [href, ping] = await page.$eval("#ctx", a => [a.href, a.getAttribute("ping")]);
  assert.equal(href, `${base}/target?keep=2`);
  assert.equal(ping, null);
});

await check("wrapped links are rewritten to their destination on press", async () => {
  await page.goto(`${base}/links`);
  await page.hover("#wrapped");
  await page.mouse.down({ button: "right" });
  await page.mouse.up({ button: "right" });
  const href = await page.$eval("#wrapped", a => a.href);
  assert.equal(href, `${base}/landing?x=1`);
});

await check("pausing a site leaves its links alone", async () => {
  await sw.evaluate(() => chrome.storage.local.set({ allowlist: ["localhost"] }));
  await new Promise(r => setTimeout(r, 400));
  await page.goto(`${base}/paused?utm_source=kept&keep=4`);
  assert.equal(lastSeen("/paused"), "/paused?utm_source=kept&keep=4");
  await sw.evaluate(() => chrome.storage.local.set({ allowlist: [] }));
  await new Promise(r => setTimeout(r, 400));
});

await check("turning Linkwash off disables cleaning", async () => {
  await sw.evaluate(() => chrome.storage.local.set({ enabled: false }));
  await new Promise(r => setTimeout(r, 400));
  const ids = await sw.evaluate(() => chrome.declarativeNetRequest.getEnabledRulesets());
  assert.deepEqual(ids, []);
  await page.goto(`${base}/off?utm_source=kept`);
  assert.equal(lastSeen("/off"), "/off?utm_source=kept");
  await sw.evaluate(() => chrome.storage.local.set({ enabled: true }));
  await new Promise(r => setTimeout(r, 400));
  const again = await sw.evaluate(() => chrome.declarativeNetRequest.getEnabledRulesets());
  assert.deepEqual(again, ["clearurls"]);
});

await browser.close();
server.close();

for (const r of results) console.log(r.join("  "));
const failed = results.filter(r => r[0] === "FAIL").length;
console.log(`${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);

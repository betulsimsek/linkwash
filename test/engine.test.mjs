import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import vm from "node:vm";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

// Load the generated providers and the engine exactly as the extension does:
// as classic scripts that attach to globalThis.
const ctx = vm.createContext({ URL });
vm.runInContext(readFileSync(join(ROOT, "rules", "providers.js"), "utf8"), ctx);
vm.runInContext(readFileSync(join(ROOT, "src", "engine.js"), "utf8"), ctx);
const { cleanUrl, compileProviders, isAllowlisted } = ctx.LinkwashEngine;
const providers = compileProviders(ctx.LINKWASH_PROVIDERS);
const clean = (url, opts) => cleanUrl(url, providers, opts).url;

test("compiles every provider", () => {
  assert.equal(providers.length, ctx.LINKWASH_PROVIDERS.length);
});

test("removes global utm/fbclid/gclid parameters and keeps the rest", () => {
  assert.equal(
    clean("https://example.com/page?utm_source=news&id=42&fbclid=abc&gclid=x"),
    "https://example.com/page?id=42"
  );
});

test("drops the question mark when every parameter is removed", () => {
  assert.equal(clean("https://example.com/a?utm_medium=email&utm_campaign=fall"), "https://example.com/a");
});

test("leaves clean URLs untouched", () => {
  const r = cleanUrl("https://example.com/search?q=linkwash&page=2", providers);
  assert.equal(r.changed, false);
  assert.equal(r.url, "https://example.com/search?q=linkwash&page=2");
});

test("preserves the original encoding of kept parameters", () => {
  assert.equal(
    clean("https://example.com/?q=a%20b%26c&utm_source=x&name=%C3%BC"),
    "https://example.com/?q=a%20b%26c&name=%C3%BC"
  );
});

test("unwraps Google redirect links", () => {
  assert.equal(
    clean("https://www.google.com/url?sa=t&url=https%3A%2F%2Fexample.org%2Farticle%3Futm_source%3Dgoogle%26id%3D7&usg=AOv"),
    "https://example.org/article?id=7"
  );
});

test("unwraps Facebook outbound links", () => {
  assert.equal(
    clean("https://l.facebook.com/l.php?u=https%3A%2F%2Fexample.net%2F%3Ffbclid%3Dzzz&h=AT0"),
    "https://example.net/"
  );
});

test("removes Amazon tracking fields but keeps the product path", () => {
  const out = clean("https://www.amazon.com/dp/B000000000/ref=sr_1_1?crid=ABC&keywords=kettle&qid=1700000000&sprefix=ket&sr=8-1");
  assert.ok(out.startsWith("https://www.amazon.com/dp/B000000000"), out);
  assert.ok(!/crid=|qid=|sprefix=/.test(out), out);
});

test("respects provider exceptions (Google OAuth is not touched)", () => {
  const url = "https://accounts.google.com/o/oauth2/auth?client_id=1&source=abc&ved=1";
  assert.equal(clean(url), url);
});

test("flags complete providers as blocked", () => {
  const r = cleanUrl("https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js", providers);
  assert.equal(r.blocked, true);
});

test("cleans parameter-style fragments but not hash routes", () => {
  assert.equal(clean("https://example.com/#utm_source=x&section=2"), "https://example.com/#section=2");
  assert.equal(clean("https://app.example.com/#/inbox?utm_source=x"), "https://app.example.com/#/inbox?utm_source=x");
});

test("allowlisted hosts and their subdomains are skipped", () => {
  const url = "https://shop.example.com/?utm_source=x";
  assert.equal(clean(url, { allowlist: ["example.com"] }), url);
  assert.equal(isAllowlisted("https://notexample.com/", ["example.com"]), false);
});

test("ignores non-http URLs", () => {
  assert.equal(clean("mailto:a@b.c?utm_source=x"), "mailto:a@b.c?utm_source=x");
  assert.equal(clean("javascript:void(0)"), "javascript:void(0)");
});

test("dnrResult mirrors the literal removals the static ruleset performs", () => {
  const { dnrResult } = ctx.LinkwashEngine;
  assert.equal(dnrResult("https://example.com/a?utm_source=x&keep=1&fbclid=2", providers), "https://example.com/a?keep=1");
  // Regex-only parameters are left for the engine.
  assert.equal(dnrResult("https://example.com/a?utm_weird_custom=1", providers), "https://example.com/a?utm_weird_custom=1");
});

test("Linkwash extra rules remove ad-click IDs the catalog misses", () => {
  assert.equal(clean("https://www.flypgs.com/?ds_rl=1256634&ds_rl=1263092"), "https://www.flypgs.com/");
  assert.equal(
    clean("https://shop.example.com/p/1?gbraid=a&wbraid=b&ttclid=c&li_fat_id=d&size=m"),
    "https://shop.example.com/p/1?size=m"
  );
});

// Converts the ClearURLs rule catalog into:
//   rules/providers.js    - provider list for the JS engine (content script + service worker)
//   rules/dnr_rules.json  - static declarativeNetRequest ruleset (network-level cleaning)
//   rules/build-info.json - catalog hash and stats shown in the popup
//
// Usage: node scripts/build-rules.mjs [--fetch]
//   --fetch downloads the latest catalog from rules2.clearurls.xyz first.

import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const CATALOG = join(ROOT, "rules", "clearurls-data.min.json");
const CATALOG_URL = "https://rules2.clearurls.xyz/data.minify.json";

// Keep network-level rewriting to navigations; sub-resources are left to the
// page so functional query strings on XHR/fetch calls are never touched.
const PARAM_RESOURCE_TYPES = ["main_frame", "sub_frame"];
const BLOCK_RESOURCE_TYPES = ["sub_frame", "script", "image", "xmlhttprequest", "ping", "media", "other"];

const ENCODED_Q_PREFIX = "(?:%3F)?";

// Regex rules that are too common to leave to the JS engine alone. The listed
// names are removed at network level too; each is checked against its rule.
const COMMON_EXPANSIONS = {
  "(?:%3F)?utm(?:_[a-z_]*)?": ["utm", "utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content",
    "utm_id", "utm_name", "utm_brand", "utm_social", "utm_reader", "utm_referrer", "utm_place", "utm_pubreferrer",
    "utm_swu", "utm_viz_id", "utm_cid", "utm_int", "utm_source_platform", "utm_creative_format", "utm_marketing_tactic"],
  "(?:%3F)?mtm(?:_[a-z_]*)?": ["mtm_source", "mtm_medium", "mtm_campaign", "mtm_keyword", "mtm_content",
    "mtm_cid", "mtm_group", "mtm_placement"],
  "(?:%3F)?ga_[a-z_]+": ["ga_source", "ga_medium", "ga_campaign", "ga_term", "ga_content", "ga_place"],
  "(?:%3F)?otm_[a-z_]*": ["otm_source", "otm_medium", "otm_campaign", "otm_content"]
};

// Expands a ClearURLs field rule into literal parameter names when the rule is
// a plain name or a name with non-nested (?:a|b) groups. Returns null if the
// rule needs real regex matching (the JS engine handles those).
export function expandLiteral(rule) {
  let r = rule.startsWith(ENCODED_Q_PREFIX) ? rule.slice(ENCODED_Q_PREFIX.length) : rule;
  r = r.replace(/\\\./g, ".").replace(/\\-/g, "-");
  const tokens = [];
  let i = 0;
  while (i < r.length) {
    if (r.startsWith("(?:", i)) {
      const end = r.indexOf(")", i);
      if (end === -1) return null;
      const body = r.slice(i + 3, end);
      if (!/^[\w.-]+(\|[\w.-]+)*$/.test(body)) return null;
      let alts = body.split("|");
      i = end + 1;
      if (r[i] === "?") {
        alts = alts.concat([""]);
        i++;
      }
      tokens.push(alts);
    } else {
      const m = /^[\w.-]+/.exec(r.slice(i));
      if (!m) return null;
      let lit = m[0];
      i += lit.length;
      if (r[i] === "?") {
        // "wt_?mc": the character before "?" is optional.
        const head = lit.slice(0, -1);
        const opt = lit.slice(-1);
        tokens.push([head]);
        tokens.push([opt, ""]);
        i++;
      } else {
        tokens.push([lit]);
      }
    }
  }
  let names = [""];
  for (const alts of tokens) {
    const next = [];
    for (const n of names) for (const a of alts) next.push(n + a);
    names = next;
    if (names.length > 64) return null;
  }
  return names.filter(Boolean);
}

export function buildFromCatalog(catalog) {
  const providersObj = catalog.providers;
  const providers = [];
  const dnr = [];
  const stats = { providers: 0, literalParams: 0, regexParams: 0, redirections: 0, blockedDomains: 0, exceptions: 0 };
  let id = 1;

  for (const [name, p] of Object.entries(providersObj)) {
    stats.providers++;
    providers.push({
      name,
      urlPattern: p.urlPattern,
      completeProvider: !!p.completeProvider,
      rules: p.rules || [],
      rawRules: p.rawRules || [],
      referralMarketing: p.referralMarketing || [],
      exceptions: p.exceptions || [],
      redirections: p.redirections || []
    });
    stats.redirections += (p.redirections || []).length;
    stats.exceptions += (p.exceptions || []).length;

    const isGlobal = p.urlPattern === ".*";
    const baseCondition = isGlobal ? {} : { regexFilter: p.urlPattern };

    for (const ex of p.exceptions || []) {
      dnr.push({
        id: id++,
        priority: 3,
        action: { type: "allow" },
        condition: { regexFilter: ex, resourceTypes: PARAM_RESOURCE_TYPES.concat(BLOCK_RESOURCE_TYPES.filter(t => t !== "sub_frame")) }
      });
    }

    if (p.completeProvider) {
      stats.blockedDomains++;
      dnr.push({
        id: id++,
        priority: 2,
        action: { type: "block" },
        condition: { ...baseCondition, resourceTypes: BLOCK_RESOURCE_TYPES }
      });
      continue;
    }

    const literals = new Set();
    for (const rule of (p.rules || []).concat(p.referralMarketing || [])) {
      const names = expandLiteral(rule);
      if (names) {
        names.forEach(n => literals.add(n));
        stats.literalParams++;
      } else {
        stats.regexParams++;
        const common = COMMON_EXPANSIONS[rule];
        if (common) {
          const re = new RegExp("^" + rule + "$", "i");
          for (const n of common) {
            if (!re.test(n)) throw new Error(`expansion ${n} does not match ${rule}`);
            literals.add(n);
          }
        }
      }
    }
    providers[providers.length - 1].dnrParams = [...literals].sort();
    if (literals.size > 0) {
      dnr.push({
        id: id++,
        priority: 1,
        action: {
          type: "redirect",
          redirect: { transform: { queryTransform: { removeParams: [...literals].sort() } } }
        },
        condition: { ...baseCondition, resourceTypes: PARAM_RESOURCE_TYPES }
      });
    }
  }
  return { providers, dnr, stats };
}

async function main() {
  if (process.argv.includes("--fetch")) {
    const res = await fetch(CATALOG_URL);
    if (!res.ok) throw new Error(`catalog download failed: ${res.status}`);
    writeFileSync(CATALOG, await res.text());
  }
  const raw = readFileSync(CATALOG, "utf8");
  const catalog = JSON.parse(raw);
  const { providers, dnr, stats } = buildFromCatalog(catalog);

  // Every regex must compile in JS; RE2 support is verified in Chrome by the e2e test.
  for (const p of providers) {
    for (const r of [p.urlPattern, ...p.rules, ...p.rawRules, ...p.referralMarketing, ...p.exceptions, ...p.redirections]) {
      new RegExp(r);
    }
  }

  const hash = createHash("sha256").update(raw).digest("hex");
  const header = "// Generated by scripts/build-rules.mjs from the ClearURLs rule catalog.\n" +
    "// Rules: https://github.com/ClearURLs/Rules (LGPL-3.0). Do not edit by hand.\n";
  writeFileSync(join(ROOT, "rules", "providers.js"), header + "globalThis.LINKWASH_PROVIDERS = " + JSON.stringify(providers) + ";\n");
  writeFileSync(join(ROOT, "rules", "dnr_rules.json"), JSON.stringify(dnr, null, 1) + "\n");
  writeFileSync(join(ROOT, "rules", "build-info.json"), JSON.stringify({ catalogSha256: hash, dnrRules: dnr.length, ...stats }, null, 2) + "\n");
  console.log(`providers=${stats.providers} dnrRules=${dnr.length} literal=${stats.literalParams} regex=${stats.regexParams} redirections=${stats.redirections} blocked=${stats.blockedDomains}`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch(e => {
    console.error(e);
    process.exit(1);
  });
}

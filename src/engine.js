// Linkwash URL cleaning engine.
// Applies ClearURLs-format provider rules to a URL string. Runs in the
// service worker and in content scripts, so it must stay dependency-free
// and expose itself on globalThis (no ES modules in content scripts).
(function (root) {
  "use strict";

  const MAX_REDIRECT_DEPTH = 5;

  function compileProviders(rawProviders) {
    const out = [];
    for (const p of rawProviders) {
      try {
        const fieldRules = (p.rules || []).concat(p.referralMarketing || []);
        out.push({
          name: p.name,
          urlPattern: new RegExp(p.urlPattern, "i"),
          completeProvider: !!p.completeProvider,
          exceptions: (p.exceptions || []).map(r => new RegExp(r, "i")),
          redirections: (p.redirections || []).map(r => new RegExp(r, "i")),
          rawRules: (p.rawRules || []).map(r => new RegExp(r, "gi")),
          fieldRules: fieldRules.map(r => new RegExp("^" + r + "$", "i")),
          dnrParams: new Set(p.dnrParams || [])
        });
      } catch (e) {
        // A single malformed provider must not disable the whole engine.
      }
    }
    return out;
  }

  function fullyDecode(value) {
    let prev = value;
    for (let i = 0; i < 5; i++) {
      let next;
      try {
        next = decodeURIComponent(prev);
      } catch (e) {
        return prev;
      }
      if (next === prev) return next;
      prev = next;
    }
    return prev;
  }

  function safeDecode(value) {
    try {
      return decodeURIComponent(value.replace(/\+/g, " "));
    } catch (e) {
      return value;
    }
  }

  // Removes matching fields from a "a=1&b=2" string, keeping the original
  // encoding of every surviving field. Returns [newString, removedCount].
  function stripFields(paramString, fieldRules) {
    if (!paramString) return [paramString, 0];
    const parts = paramString.split("&");
    const kept = [];
    let removed = 0;
    for (const part of parts) {
      if (part === "") continue;
      const eq = part.indexOf("=");
      const rawKey = eq === -1 ? part : part.slice(0, eq);
      const key = safeDecode(rawKey);
      if (fieldRules.some(re => re.test(key) || re.test(rawKey))) {
        removed++;
      } else {
        kept.push(part);
      }
    }
    return [kept.join("&"), removed];
  }

  // A fragment is only treated as parameters when it looks like "k=v&k2=v2";
  // hash routes such as "#/inbox" or "#!/page" are left alone.
  function looksLikeParams(fragment) {
    return /^[^/!?][^#]*=/.test(fragment) && !/^[\w-]+$/.test(fragment);
  }

  function hostOf(url) {
    try {
      return new URL(url).hostname.toLowerCase();
    } catch (e) {
      return "";
    }
  }

  function hostMatches(host, domain) {
    return host === domain || host.endsWith("." + domain);
  }

  function isAllowlisted(url, allowlist) {
    if (!allowlist || allowlist.length === 0) return false;
    const host = hostOf(url);
    return allowlist.some(d => hostMatches(host, d));
  }

  // What the static DNR ruleset will produce for a navigation: only the
  // literal parameter names are removed, from the query string only.
  function dnrResult(input, providers) {
    const qIndex = input.indexOf("?");
    if (qIndex === -1) return input;
    const hashIndex = input.indexOf("#", qIndex);
    const end = hashIndex === -1 ? input.length : hashIndex;
    const names = new Set();
    for (const p of providers) {
      if (p.completeProvider || !p.urlPattern.test(input)) continue;
      if (p.exceptions.some(re => re.test(input))) return input;
      p.dnrParams.forEach(n => names.add(n));
    }
    if (names.size === 0) return input;
    const kept = input.slice(qIndex + 1, end).split("&").filter(part => {
      if (part === "") return false;
      const eq = part.indexOf("=");
      return !names.has(safeDecode(eq === -1 ? part : part.slice(0, eq)));
    });
    return input.slice(0, qIndex) + (kept.length ? "?" + kept.join("&") : "") + input.slice(end);
  }

  // Returns { url, changed, removed, redirected, blocked }.
  function cleanUrl(input, providers, options, depth) {
    const opts = options || {};
    const level = depth || 0;
    const result = { url: input, changed: false, removed: 0, redirected: false, blocked: false };
    if (typeof input !== "string" || !/^https?:\/\//i.test(input)) return result;
    if (isAllowlisted(input, opts.allowlist)) return result;

    let url = input;

    for (const p of providers) {
      if (!p.urlPattern.test(url)) continue;
      if (p.exceptions.some(re => re.test(url))) continue;

      if (p.completeProvider) {
        result.blocked = true;
        return result;
      }

      for (const re of p.redirections) {
        const m = re.exec(url);
        if (m && m[1]) {
          const target = fullyDecode(m[1]);
          if (/^https?:\/\//i.test(target) && target !== url && level < MAX_REDIRECT_DEPTH) {
            const inner = cleanUrl(target, providers, opts, level + 1);
            return {
              url: inner.url,
              changed: true,
              removed: result.removed + inner.removed,
              redirected: true,
              blocked: inner.blocked
            };
          }
        }
      }

      for (const re of p.rawRules) {
        re.lastIndex = 0;
        const next = url.replace(re, "");
        if (next !== url) {
          url = next;
          result.removed++;
        }
      }

      if (p.fieldRules.length === 0) continue;

      const hashIndex = url.indexOf("#");
      let beforeHash = hashIndex === -1 ? url : url.slice(0, hashIndex);
      let fragment = hashIndex === -1 ? null : url.slice(hashIndex + 1);
      const qIndex = beforeHash.indexOf("?");
      if (qIndex !== -1) {
        const base = beforeHash.slice(0, qIndex);
        const [query, n] = stripFields(beforeHash.slice(qIndex + 1), p.fieldRules);
        if (n > 0) {
          result.removed += n;
          beforeHash = query ? base + "?" + query : base;
        }
      }
      if (fragment && looksLikeParams(fragment)) {
        const [frag, n] = stripFields(fragment, p.fieldRules);
        if (n > 0) {
          result.removed += n;
          fragment = frag;
        }
      }
      url = fragment ? beforeHash + "#" + fragment : beforeHash;
    }

    result.url = url;
    result.changed = url !== input;
    return result;
  }

  root.LinkwashEngine = { compileProviders, cleanUrl, dnrResult, isAllowlisted, hostOf, hostMatches };
})(typeof globalThis !== "undefined" ? globalThis : this);

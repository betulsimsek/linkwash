// Linkwash content script.
// Cleans a link the moment the user is about to use it (press, click, middle
// click, right click, keyboard activation), so "Copy link address" and
// opening in a new tab both get the clean URL. Also removes the `ping`
// attribute, which sends a tracking request on every click.
(function () {
  "use strict";
  const { cleanUrl, compileProviders } = LinkwashEngine;
  const providers = compileProviders(LINKWASH_PROVIDERS);
  let settings = { enabled: true, allowlist: [] };

  chrome.storage.local.get(settings).then(s => {
    settings = s;
  });
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local") return;
    for (const [k, { newValue }] of Object.entries(changes)) settings[k] = newValue;
  });

  function washAnchor(event) {
    if (!settings.enabled) return;
    const path = event.composedPath ? event.composedPath() : [event.target];
    const a = path.find(el => el && el.tagName === "A" && el.href);
    if (!a) return;
    if (a.hasAttribute("ping")) a.removeAttribute("ping");
    const r = cleanUrl(a.href, providers, { allowlist: settings.allowlist });
    if (!r.changed || r.blocked) return;
    a.href = r.url;
    chrome.runtime.sendMessage({ type: "linkwash:cleaned", count: Math.max(r.removed, 1) }).catch(() => {});
  }

  for (const type of ["mousedown", "touchstart", "click", "auxclick", "contextmenu", "keydown"]) {
    window.addEventListener(type, event => {
      if (type === "keydown" && event.key !== "Enter") return;
      washAnchor(event);
    }, { capture: true, passive: true });
  }

  function copyText(text) {
    if (navigator.clipboard && document.hasFocus()) {
      return navigator.clipboard.writeText(text).catch(() => legacyCopy(text));
    }
    legacyCopy(text);
    return Promise.resolve();
  }

  function legacyCopy(text) {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.setAttribute("readonly", "");
    ta.style.cssText = "position:fixed;top:-1000px;opacity:0";
    (document.body || document.documentElement).appendChild(ta);
    ta.select();
    document.execCommand("copy");
    ta.remove();
  }

  chrome.runtime.onMessage.addListener(msg => {
    if (msg && msg.type === "linkwash:copy" && msg.url) copyText(msg.url);
  });
})();

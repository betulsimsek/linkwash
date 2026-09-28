const { cleanUrl, compileProviders, hostOf } = LinkwashEngine;
const providers = compileProviders(LINKWASH_PROVIDERS);
const t = (key, subs) => chrome.i18n.getMessage(key, subs);
const $ = id => document.getElementById(id);

let settings = { enabled: true, allowlist: [] };
let tab = null;
let cleaned = null;

function siteDomain(host) {
  return host.replace(/^www\./, "");
}

function render() {
  const host = tab && /^https?:/.test(tab.url || "") ? hostOf(tab.url) : "";
  const domain = siteDomain(host);
  const paused = !!domain && settings.allowlist.some(d => host === d || host.endsWith("." + d));

  $("enabled").checked = settings.enabled;
  $("host").textContent = host || t("noSite");
  $("site-on").checked = !paused;
  $("site-on").disabled = !host || !settings.enabled;
  $("site-status").textContent = !settings.enabled ? t("statusOff") : !host ? "" : paused ? t("statusPaused") : t("statusOn");

  if (!host) {
    $("clean-url").textContent = "—";
    $("removed-info").textContent = "";
    $("copy").disabled = $("reload").disabled = true;
    return;
  }
  cleaned = cleanUrl(tab.url, providers, { allowlist: settings.allowlist });
  $("clean-url").textContent = cleaned.url;
  const info = $("removed-info");
  if (cleaned.changed) {
    info.textContent = cleaned.redirected ? t("unwrapped") : t("removedN", [String(cleaned.removed)]);
    info.className = "ok";
  } else {
    info.textContent = t("alreadyClean");
    info.className = "";
  }
  $("copy").disabled = false;
  $("reload").disabled = !cleaned.changed;
}

async function save(patch) {
  settings = { ...settings, ...patch };
  await chrome.storage.local.set(patch);
  render();
}

$("enabled").addEventListener("change", e => save({ enabled: e.target.checked }));

$("site-on").addEventListener("change", e => {
  const domain = siteDomain(hostOf(tab.url));
  const without = settings.allowlist.filter(d => d !== domain);
  save({ allowlist: e.target.checked ? without : without.concat([domain]) });
});

$("copy").addEventListener("click", async () => {
  await navigator.clipboard.writeText(cleaned.url);
  $("copy").textContent = t("copied");
  setTimeout(() => ($("copy").textContent = t("copyClean")), 1400);
});

$("reload").addEventListener("click", async () => {
  await chrome.tabs.update(tab.id, { url: cleaned.url });
  window.close();
});

(async () => {
  const [s, tabs, info] = await Promise.all([
    chrome.storage.local.get(settings),
    chrome.tabs.query({ active: true, currentWindow: true }),
    fetch("../rules/build-info.json").then(r => r.json()).catch(() => null)
  ]);
  settings = s;
  tab = tabs[0] || null;
  if (info) $("rules-line").textContent = t("rulesLine", [String(info.providers)]);
  render();
})();

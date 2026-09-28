// Linkwash service worker.
// Network-level cleaning is done by the static DNR ruleset; this worker covers
// what DNR cannot: regex-defined parameters and redirect unwrapping on
// top-level navigations, plus settings, the allowlist and the context menu.
importScripts("../rules/providers.js", "engine.js");

const { cleanUrl, compileProviders, dnrResult, hostOf } = LinkwashEngine;
const providers = compileProviders(LINKWASH_PROVIDERS);

const RULESET_ID = "clearurls";
const ALLOWLIST_RULE_ID = 1;
const DEFAULTS = { enabled: true, allowlist: [] };

let settings = { ...DEFAULTS };
const ready = chrome.storage.local.get(DEFAULTS).then(s => {
  settings = s;
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local") return;
  for (const [k, { newValue }] of Object.entries(changes)) settings[k] = newValue;
  if (changes.enabled || changes.allowlist) applySettings();
});

async function applySettings() {
  await ready;
  if (settings.enabled) {
    await chrome.declarativeNetRequest.updateEnabledRulesets({ enableRulesetIds: [RULESET_ID] });
  } else {
    await chrome.declarativeNetRequest.updateEnabledRulesets({ disableRulesetIds: [RULESET_ID] });
  }
  // One dynamic rule lets every request to allowlisted sites through untouched.
  const addRules = settings.allowlist.length
    ? [{
        id: ALLOWLIST_RULE_ID,
        priority: 100,
        action: { type: "allowAllRequests" },
        condition: { requestDomains: settings.allowlist, resourceTypes: ["main_frame", "sub_frame"] }
      }]
    : [];
  await chrome.declarativeNetRequest.updateDynamicRules({ removeRuleIds: [ALLOWLIST_RULE_ID], addRules });
}

function setupContextMenu() {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: "copy-clean-link",
      title: chrome.i18n.getMessage("menuCopyCleanLink"),
      contexts: ["link"]
    });
    chrome.contextMenus.create({
      id: "copy-clean-page",
      title: chrome.i18n.getMessage("menuCopyCleanPage"),
      contexts: ["page"]
    });
  });
}

chrome.runtime.onInstalled.addListener(() => {
  chrome.declarativeNetRequest.setExtensionActionOptions({ displayActionCountAsBadgeText: true });
  chrome.action.setBadgeBackgroundColor({ color: "#0f6e56" });
  setupContextMenu();
  applySettings();
});

chrome.runtime.onStartup.addListener(applySettings);

function clean(url) {
  return cleanUrl(url, providers, { allowlist: settings.allowlist });
}

function countOnBadge(tabId, n) {
  if (tabId < 0 || n <= 0) return;
  chrome.declarativeNetRequest.setExtensionActionOptions({ tabUpdate: { tabId, increment: n } }).catch(() => {});
}

// Top-level navigations: unwrap redirect links and strip regex-only params.
chrome.webNavigation.onBeforeNavigate.addListener(async details => {
  if (details.frameId !== 0) return;
  await ready;
  if (!settings.enabled) return;
  const r = clean(details.url);
  if (!r.changed || r.blocked) return;
  // DNR already rewrites this request; a second navigation would abort it.
  if (!r.redirected && r.url === dnrResult(details.url, providers)) return;
  countOnBadge(details.tabId, Math.max(r.removed, 1));
  chrome.tabs.update(details.tabId, { url: r.url }).catch(() => {});
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  await ready;
  const source = info.menuItemId === "copy-clean-link" ? info.linkUrl : info.pageUrl;
  if (!source || !tab) return;
  const url = clean(source).url;
  chrome.tabs.sendMessage(tab.id, { type: "linkwash:copy", url }, { frameId: info.frameId || 0 }).catch(() => {});
});

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg && msg.type === "linkwash:cleaned" && sender.tab) {
    countOnBadge(sender.tab.id, msg.count || 1);
    return;
  }
  if (msg && msg.type === "linkwash:clean") {
    ready.then(() => sendResponse(clean(msg.url)));
    return true;
  }
  if (msg && msg.type === "linkwash:site") {
    sendResponse({ host: hostOf(msg.url) });
  }
});

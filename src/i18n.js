function applyI18n(root = document) {
  root.querySelectorAll("[data-i18n]").forEach(el => {
    el.textContent = chrome.i18n.getMessage(el.dataset.i18n);
  });
  root.querySelectorAll("[data-i18n-title]").forEach(el => {
    el.title = chrome.i18n.getMessage(el.dataset.i18nTitle);
  });
}

applyI18n();

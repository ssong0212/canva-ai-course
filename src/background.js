/* background.js — seeds the default settings on install. */
const DEFAULTS = { enabled: true, pet: 'cat', size: 72, speed: 1, follow: true };

chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.sync.get(DEFAULTS, (stored) => {
    chrome.storage.sync.set(Object.assign({}, DEFAULTS, stored));
  });
});

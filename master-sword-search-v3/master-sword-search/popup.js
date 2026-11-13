'use strict';

const DEFAULTS = { enabled: true, sound: true, skipNative: true };

chrome.storage.sync.get(DEFAULTS, (items) => {
  for (const key of Object.keys(DEFAULTS)) {
    const box = document.getElementById(key);
    box.checked = Boolean(items[key]);
    box.addEventListener('change', () => chrome.storage.sync.set({ [key]: box.checked }));
  }
});

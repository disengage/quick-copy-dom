const toggleBtn = document.getElementById('toggleBtn');
const quickBtn = document.getElementById('quickBtn');
const quickSection = document.getElementById('quickSection');
const downloadCheckbox = document.getElementById('downloadOnSelection');
const selectorInput = document.getElementById('selectorInput');
const selectorHost = document.getElementById('selectorHost');
const selectorActionBtn = document.getElementById('selectorActionBtn');
const selectorActionIcon = document.getElementById('selectorActionIcon');

const SCRIPT_FILES = ['download-name.js', 'content.js'];
const SAVE_ICON = '<path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2Z"/><path d="M17 21v-8H7v8M7 3v5h8"/>';
const REMOVE_ICON = '<path d="M3 6h18M8 6V4h8v2m3 0-1 14H6L5 6m4 4v6m6-6v6"/>';

function saveWithLink(html, filename) {
  const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename || 'selection.html';
  link.rel = 'noopener';
  link.style.display = 'none';
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
let savedSelector = '';
let currentHost = '';
let selectorMatches = false;
let selectorValidationVersion = 0;
let previewRequestId = Date.now() * 1000;
let keepQuickHighlight = false;

function updateSelectorVisibility() {
  const value = selectorInput.value.trim();
  const hasSelector = value.length > 0;
  const isSavedSelector = hasSelector && value === savedSelector;
  const canSaveSelector = hasSelector && !isSavedSelector && selectorMatches && !!currentHost;

  quickSection.hidden = !hasSelector;
  selectorActionBtn.hidden = !isSavedSelector && !canSaveSelector;
  selectorActionBtn.classList.toggle('selector-action-danger', isSavedSelector);
  selectorActionBtn.setAttribute('aria-label', isSavedSelector ? 'Remove selector' : 'Save selector');
  selectorActionBtn.title = isSavedSelector ? 'Remove selector' : 'Save selector';
  selectorActionIcon.innerHTML = isSavedSelector ? REMOVE_ICON : SAVE_ICON;
}

function applySelector(selector) {
  selectorInput.value = selector || '';
  savedSelector = selectorInput.value.trim();
  selectorMatches = false;
  updateSelectorVisibility();
}

function hostFromUrl(url) {
  try {
    return new URL(url).hostname;
  } catch (error) {
    return '';
  }
}

async function updateHostSelector(selector) {
  if (!currentHost) return;
  const data = await chrome.storage.local.get({ selectorsByHost: {} });
  const selectorsByHost = { ...(data.selectorsByHost || {}) };
  if (selector) selectorsByHost[currentHost] = selector;
  else delete selectorsByHost[currentHost];
  await chrome.storage.local.set({ selectorsByHost });
}

async function loadSettings() {
  const tab = await activeTab();
  currentHost = hostFromUrl(tab?.url);
  selectorHost.textContent = currentHost;
  selectorHost.hidden = !currentHost;

  const data = await chrome.storage.local.get({
    selectorsByHost: {},
    lastSelector: '',
    downloadOnSelection: false
  });
  if (data.lastSelector) chrome.storage.local.remove('lastSelector');
  downloadCheckbox.checked = !!data.downloadOnSelection;
  const saved = currentHost ? (data.selectorsByHost || {})[currentHost] || '' : '';
  applySelector(saved);
}

async function persistCheckbox() {
  await chrome.storage.local.set({
    downloadOnSelection: downloadCheckbox.checked
  });
}

function sendTabMessage(tabId, message) {
  return new Promise((resolve, reject) => {
    chrome.tabs.sendMessage(tabId, message, (response) => {
      const error = chrome.runtime.lastError;
      if (error) {
        reject(new Error(error.message));
        return;
      }
      resolve(response);
    });
  });
}

async function inspectSelector(selector, showPreview) {
  const version = ++selectorValidationVersion;
  const requestId = ++previewRequestId;
  const trimmed = selector.trim();
  if (!trimmed) {
    selectorMatches = false;
    updateSelectorVisibility();
  }

  try {
    const tab = await activeTab();
    if (!tab?.id) return false;
    await inject(tab.id);
    const response = await sendTabMessage(tab.id, {
      action: 'previewSelector',
      selector: trimmed,
      show: showPreview,
      requestId
    });
    if (version !== selectorValidationVersion) return false;

    selectorMatches = !!response?.found;
    updateSelectorVisibility();
    return selectorMatches;
  } catch (error) {
    if (version === selectorValidationVersion) {
      selectorMatches = false;
      updateSelectorVisibility();
      console.error('Quick Copy DOM - Could not inspect selector:', error);
    }
    return false;
  }
}

async function saveSelector() {
  const value = selectorInput.value.trim();
  if (!value || !currentHost) return '';
  if (value === savedSelector) return value;

  const matches = await inspectSelector(value, document.activeElement === selectorInput);
  if (!matches || value !== selectorInput.value.trim()) return '';

  await updateHostSelector(value);
  savedSelector = value;
  updateSelectorVisibility();
  return value;
}

downloadCheckbox.addEventListener('change', () => {
  persistCheckbox().catch((error) => console.error(error));
});

selectorInput.addEventListener('input', () => {
  selectorMatches = false;
  updateSelectorVisibility();
  void inspectSelector(selectorInput.value.trim(), true);
});

selectorInput.addEventListener('focus', () => {
  void inspectSelector(selectorInput.value.trim(), true);
});

selectorInput.addEventListener('blur', () => {
  const requestId = ++previewRequestId;
  void activeTab()
    .then((tab) => tab?.id && sendTabMessage(tab.id, {
      action: 'previewSelector',
      selector: '',
      show: false,
      requestId
    }))
    .catch((error) => console.error('Quick Copy DOM - Could not clear selector highlight:', error));
});

selectorInput.addEventListener('keydown', (event) => {
  if (event.key !== 'Enter') return;
  event.preventDefault();
  const value = selectorInput.value.trim();
  if (value && currentHost && value !== savedSelector && selectorMatches) {
    selectorActionBtn.click();
  }
});

selectorActionBtn.addEventListener('mousedown', (event) => {
  event.preventDefault();
});

selectorActionBtn.addEventListener('click', async () => {
  try {
    const value = selectorInput.value.trim();
    if (!value) return;

    if (value === savedSelector) {
      await updateHostSelector('');
      savedSelector = '';
      selectorInput.value = '';
      selectorMatches = false;
      updateSelectorVisibility();
      const requestId = ++previewRequestId;
      const tab = await activeTab();
      if (tab?.id) {
        await sendTabMessage(tab.id, {
          action: 'previewSelector',
          selector: '',
          show: false,
          requestId
        });
      }
      return;
    }

    await saveSelector();
  } catch (error) {
    console.error('Quick Copy DOM - Could not update selector:', error);
  }
});

async function activeTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

async function inject(tabId) {
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: SCRIPT_FILES
    });
  } catch (error) {
    console.log('Script injection:', error.message);
  }
}

function previewOnPage(selector, show) {
  const requestId = ++previewRequestId;
  const trimmed = String(selector || '').trim();
  if (show && !trimmed) return;

  void (async () => {
    const tab = await activeTab();
    if (!tab?.id || requestId !== previewRequestId) return;
    if (show) await inject(tab.id);
    if (requestId !== previewRequestId) return;
    await sendTabMessage(tab.id, {
      action: 'previewSelector',
      selector: show ? trimmed : '',
      show,
      requestId
    });
  })().catch((error) => console.error('Quick Copy DOM - Could not preview selector:', error));
}

quickBtn.addEventListener('mouseenter', () => {
  previewOnPage(savedSelector, true);
});

quickBtn.addEventListener('mouseleave', () => {
  if (keepQuickHighlight) return;
  const typed = document.activeElement === selectorInput ? selectorInput.value.trim() : '';
  previewOnPage(typed, !!typed);
});

toggleBtn.addEventListener('click', async () => {
  await persistCheckbox();
  const tab = await activeTab();
  if (!tab?.id) return;

  await inject(tab.id);
  chrome.tabs.sendMessage(tab.id, {
    action: 'toggle',
    downloadOnSelection: downloadCheckbox.checked
  }, () => {
    if (chrome.runtime.lastError) {
      console.error(chrome.runtime.lastError.message);
      return;
    }
    window.close();
  });
});

quickBtn.addEventListener('click', async () => {
  await persistCheckbox();
  const selector = await saveSelector();
  if (!selector) return;

  const tab = await activeTab();
  if (!tab?.id) return;
  await inject(tab.id);

  keepQuickHighlight = true;
  previewRequestId += 1;
  const shouldDownload = downloadCheckbox.checked;
  chrome.tabs.sendMessage(tab.id, { action: 'quickSelect', selector }, (response) => {
    if (chrome.runtime.lastError || !response?.success) {
      keepQuickHighlight = false;
      const requestId = ++previewRequestId;
      chrome.tabs.sendMessage(tab.id, {
        action: 'previewSelector',
        selector: '',
        show: false,
        requestId
      }, () => {
        void chrome.runtime.lastError;
        window.close();
      });
      return;
    }

    const finish = (copied) => {
      chrome.tabs.sendMessage(tab.id, { action: 'copyResult', ok: copied }, () => {
        void chrome.runtime.lastError;
        window.close();
      });
    };

    const finishCopy = async () => {
      let copied = !!response.copied;
      if (!copied && response.html) {
        try {
          await navigator.clipboard.writeText(response.html);
          copied = true;
        } catch (error) {
          copied = copyTextFallback(response.html);
        }
      }
      finish(copied);
    };

    if (!(shouldDownload && response.fileHtml && response.filename)) {
      finishCopy();
      return;
    }

    chrome.runtime.sendMessage({
      action: 'downloadHtml',
      html: response.fileHtml,
      filename: response.filename
    }, (downloadResponse) => {
      const message = chrome.runtime.lastError?.message || downloadResponse?.error || '';
      if (message && !/cancel/i.test(message)) {
        try {
          saveWithLink(response.fileHtml, response.filename);
        } catch (error) {
          console.error('Quick Copy DOM - Save error:', error && error.message ? error.message : error);
        }
      }
      finishCopy();
    });
  });
});

function copyTextFallback(html) {
  const area = document.createElement('textarea');
  area.value = html;
  area.setAttribute('readonly', '');
  area.style.position = 'fixed';
  area.style.left = '-9999px';
  document.body.appendChild(area);
  area.focus();
  area.select();
  let copied = false;
  try {
    copied = document.execCommand('copy');
  } catch (error) {
    copied = false;
  }
  area.remove();
  return copied;
}

loadSettings().catch((error) => console.error(error));

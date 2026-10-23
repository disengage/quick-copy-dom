(() => {
  // Prevent multiple injections
  if (window.__quickCopyDomInitialized) return;
  window.__quickCopyDomInitialized = true;

  let isActive = false;
  let overlay = null;
  let tooltip = null;
  let currentElement = null;
  let downloadOnSelection = false;
  let downloadSettingVersion = 0;
  let previewRequestId = 0;

  function refreshDownloadSetting() {
    const version = ++downloadSettingVersion;
    chrome.storage.local.get({ downloadOnSelection: false }, (data) => {
      if (version !== downloadSettingVersion || chrome.runtime.lastError) return;
      downloadOnSelection = !!data.downloadOnSelection;
    });
  }

  refreshDownloadSetting();
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local' || !changes.downloadOnSelection) return;
    downloadOnSelection = !!changes.downloadOnSelection.newValue;
    downloadSettingVersion += 1;
  });

  // Create the highlight overlay
  function createOverlay() {
    overlay = document.createElement('div');
    overlay.id = 'quick-copy-dom-overlay';
    overlay.style.cssText = `
      position: fixed;
      pointer-events: none;
      z-index: 2147483647;
      border: 2px solid #3b82f6;
      background-color: rgba(59, 130, 246, 0.1);
      transition: all 0.05s ease-out;
      display: none;
      box-shadow: 0 0 0 1px rgba(59, 130, 246, 0.3);
    `;
    document.body.appendChild(overlay);

    // Create tooltip for element info
    tooltip = document.createElement('div');
    tooltip.id = 'quick-copy-dom-tooltip';
    tooltip.style.cssText = `
      position: fixed;
      z-index: 2147483647;
      background: #1e293b;
      color: #f1f5f9;
      padding: 6px 10px;
      border-radius: 6px;
      font-family: 'SF Mono', Monaco, 'Cascadia Code', monospace;
      font-size: 11px;
      pointer-events: none;
      display: none;
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
      max-width: 400px;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    `;
    document.body.appendChild(tooltip);
  }

  function uniqueSelector(element) {
    if (!(element instanceof Element)) return '';
    if (element === document.documentElement) return 'html';

    const segments = [];
    let node = element;

    while (node && node.nodeType === Node.ELEMENT_NODE && node !== document.documentElement) {
      if (node.id) {
        const idSelector = `#${CSS.escape(node.id)}`;
        try {
          if (document.querySelectorAll(idSelector).length === 1) {
            segments.unshift(idSelector);
            break;
          }
        } catch (error) {
          // Keep walking when this id cannot be queried.
        }
      }

      let segment = node.tagName.toLowerCase();
      const parent = node.parentElement;
      if (parent) {
        const sameTag = Array.from(parent.children).filter((child) => child.tagName === node.tagName);
        if (sameTag.length > 1) {
          segment += `:nth-of-type(${sameTag.indexOf(node) + 1})`;
        }
      }

      segments.unshift(segment);
      node = node.parentElement;
    }

    return segments.join(' > ');
  }

  function rememberSelector(element) {
    const selector = uniqueSelector(element);
    if (!selector) return;
    chrome.storage.local.set({ lastSelector: selector }).catch((error) => {
      console.error('Quick Copy DOM - Could not save selector:', error);
    });
  }

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

  function requestDownload(html) {
    const naming = globalThis.QuickCopyDom;
    const filename = naming
      ? naming.buildDownloadFilename(html, location.href)
      : 'selection.html';
    const fileHtml = naming ? naming.wrapHtmlDocument(html) : html;

    chrome.runtime.sendMessage({
      action: 'downloadHtml',
      html: fileHtml,
      filename
    }, (response) => {
      const message = chrome.runtime.lastError?.message || response?.error || '';
      if (!message || /cancel/i.test(message)) return;

      try {
        saveWithLink(fileHtml, filename);
      } catch (error) {
        showToast('Could not save HTML file', 'error');
        console.error('Quick Copy DOM - Save error:', error && error.message ? error.message : error);
      }
    });
  }

  function copyWithFallback(html) {
    const area = document.createElement('textarea');
    area.value = html;
    area.setAttribute('readonly', '');
    area.style.position = 'fixed';
    area.style.top = '0';
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

  function copyHtml(html) {
    const onSuccess = () => showToast('HTML copied to clipboard!');
    const onFailure = () => {
      if (copyWithFallback(html)) {
        onSuccess();
        return;
      }
      showToast('Failed to copy', 'error');
    };

    if (!navigator.clipboard || !navigator.clipboard.writeText) {
      onFailure();
      return;
    }

    navigator.clipboard.writeText(html).then(onSuccess).catch((error) => {
      console.error('Quick Copy DOM - clipboard:', error && error.name, error && error.message);
      onFailure();
    });
  }

  function selectionFile(html) {
    const naming = globalThis.QuickCopyDom;
    return {
      filename: naming ? naming.buildDownloadFilename(html, location.href) : 'selection.html',
      fileHtml: naming ? naming.wrapHtmlDocument(html) : html
    };
  }

  async function quickSelect(selector) {
    const trimmed = String(selector || '').trim();
    if (!trimmed) {
      showToast('No saved element to select', 'error');
      return { success: false };
    }

    let element = null;
    try {
      element = document.querySelector(trimmed);
    } catch (error) {
      showToast('Selector is invalid', 'error');
      return { success: false };
    }

    if (!element) {
      showToast('Saved element was not found on this page', 'error');
      return { success: false };
    }

    if (!overlay) createOverlay();
    addStyles();
    updateOverlay(element);

    const html = element.outerHTML;
    const file = selectionFile(html);
    let copied = false;

    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(html);
        copied = true;
      }
    } catch (error) {
      copied = false;
    }

    if (!copied) copied = copyWithFallback(html);

    setTimeout(() => {
      if (overlay) overlay.style.display = 'none';
      if (tooltip) tooltip.style.display = 'none';
    }, 700);

    return {
      success: true,
      html,
      copied,
      fileHtml: file.fileHtml,
      filename: file.filename
    };
  }

  function previewSelector(selector, show, requestId) {
    if (requestId < previewRequestId) return { found: false, stale: true };
    previewRequestId = requestId;

    let element = null;
    const trimmed = String(selector || '').trim();
    if (trimmed) {
      try {
        element = document.querySelector(trimmed);
      } catch (error) {
        element = null;
      }
    }

    if (show && element) {
      if (!overlay) createOverlay();
      addStyles();
      updateOverlay(element);
    } else {
      if (overlay) overlay.style.display = 'none';
      if (tooltip) tooltip.style.display = 'none';
    }

    return { found: !!element };
  }

  // Show toast notification
  function showToast(message, type = 'success') {
    addStyles();
    const existingToast = document.getElementById('quick-copy-dom-toast');
    if (existingToast) existingToast.remove();

    const toast = document.createElement('div');
    toast.id = 'quick-copy-dom-toast';
    toast.style.cssText = `
      position: fixed;
      bottom: 24px;
      right: 24px;
      padding: 14px 24px;
      background-color: ${type === 'success' ? '#10b981' : '#ef4444'};
      color: white;
      border-radius: 10px;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      font-size: 14px;
      font-weight: 500;
      z-index: 2147483647;
      box-shadow: 0 4px 20px rgba(0, 0, 0, 0.25);
      animation: quickCopySlideIn 0.3s ease-out;
      display: flex;
      align-items: center;
      gap: 10px;
    `;

    const icon = type === 'success'
      ? '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>'
      : '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="15" y1="9" x2="9" y2="15"></line><line x1="9" y1="9" x2="15" y2="15"></line></svg>';

    toast.innerHTML = `${icon}<span>${message}</span>`;
    document.body.appendChild(toast);

    setTimeout(() => {
      toast.style.animation = 'quickCopySlideOut 0.3s ease-out forwards';
      setTimeout(() => toast.remove(), 300);
    }, 2500);
  }

  // Get element selector string for tooltip
  function getElementSelector(el) {
    let selector = el.tagName.toLowerCase();

    if (el.id) {
      selector += `#${el.id}`;
    } else if (el.className && typeof el.className === 'string') {
      const classes = el.className.trim().split(/\s+/).slice(0, 2).join('.');
      if (classes) selector += `.${classes}`;
    }

    const dimensions = `${Math.round(el.offsetWidth)}×${Math.round(el.offsetHeight)}`;
    return `${selector} (${dimensions})`;
  }

  // Update overlay position
  function updateOverlay(element) {
    if (!overlay || !element) return;

    const rect = element.getBoundingClientRect();

    overlay.style.display = 'block';
    overlay.style.top = `${rect.top}px`;
    overlay.style.left = `${rect.left}px`;
    overlay.style.width = `${rect.width}px`;
    overlay.style.height = `${rect.height}px`;

    // Update tooltip
    tooltip.textContent = getElementSelector(element);
    tooltip.style.display = 'block';

    // Position tooltip above or below element
    const tooltipHeight = 30;
    const margin = 8;

    if (rect.top > tooltipHeight + margin) {
      tooltip.style.top = `${rect.top - tooltipHeight - margin}px`;
    } else {
      tooltip.style.top = `${rect.bottom + margin}px`;
    }

    tooltip.style.left = `${Math.max(8, rect.left)}px`;
  }

  // Mouse move handler
  function handleMouseMove(e) {
    if (!isActive) return;

    const element = document.elementFromPoint(e.clientX, e.clientY);

    // Ignore our own elements
    if (!element ||
        element.id === 'quick-copy-dom-overlay' ||
        element.id === 'quick-copy-dom-tooltip' ||
        element.id === 'quick-copy-dom-toast') {
      return;
    }

    currentElement = element;
    updateOverlay(element);
  }

  // Click handler
  function handleClick(e) {
    if (!isActive || !currentElement) return;

    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();

    const element = currentElement;
    const html = element.outerHTML;
    rememberSelector(element);
    if (downloadOnSelection) requestDownload(html);
    copyHtml(html);
    deactivate();

    return false;
  }

  // Escape key handler
  function handleKeyDown(e) {
    if (e.key === 'Escape' && isActive) {
      e.preventDefault();
      deactivate();
      showToast('Selector cancelled', 'error');
    }
  }

  // Activate the selector
  function activate() {
    if (isActive) return;

    refreshDownloadSetting();
    isActive = true;

    if (!overlay) {
      createOverlay();
      addStyles();
    }

    document.addEventListener('mousemove', handleMouseMove, true);
    document.addEventListener('click', handleClick, true);
    document.addEventListener('keydown', handleKeyDown, true);

    document.body.style.cursor = 'crosshair';
    showToast('Click on any element to copy its HTML');
  }

  // Deactivate the selector
  function deactivate() {
    isActive = false;
    currentElement = null;

    document.removeEventListener('mousemove', handleMouseMove, true);
    document.removeEventListener('click', handleClick, true);
    document.removeEventListener('keydown', handleKeyDown, true);

    if (overlay) {
      overlay.style.display = 'none';
    }
    if (tooltip) {
      tooltip.style.display = 'none';
    }

    document.body.style.cursor = '';
  }

  // Add animation styles
  function addStyles() {
    if (document.getElementById('quick-copy-dom-styles')) return;

    const style = document.createElement('style');
    style.id = 'quick-copy-dom-styles';
    style.textContent = `
      @keyframes quickCopySlideIn {
        from {
          transform: translateX(100%);
          opacity: 0;
        }
        to {
          transform: translateX(0);
          opacity: 1;
        }
      }
      @keyframes quickCopySlideOut {
        from {
          transform: translateX(0);
          opacity: 1;
        }
        to {
          transform: translateX(100%);
          opacity: 0;
        }
      }
    `;
    document.head.appendChild(style);
  }

  // Toggle the selector
  function toggle() {
    if (isActive) {
      deactivate();
    } else {
      activate();
    }
  }

  // Listen for messages from background script
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (!message || !message.action) return;

    if (message.action === 'toggle') {
      if (typeof message.downloadOnSelection === 'boolean') {
        downloadOnSelection = message.downloadOnSelection;
        downloadSettingVersion += 1;
      }
      refreshDownloadSetting();
      toggle();
      sendResponse({ success: true, isActive });
      return false;
    }

    if (message.action === 'quickSelect') {
      quickSelect(message.selector)
        .then((result) => sendResponse(result))
        .catch((error) => sendResponse({ success: false, error: error.message }));
      return true;
    }

    if (message.action === 'previewSelector') {
      sendResponse(previewSelector(message.selector, !!message.show, Number(message.requestId) || 0));
      return false;
    }

    if (message.action === 'copyResult') {
      showToast(
        message.ok ? 'HTML copied to clipboard!' : 'Failed to copy',
        message.ok ? 'success' : 'error'
      );
      sendResponse({ ok: true });
    }

    return false;
  });
})();

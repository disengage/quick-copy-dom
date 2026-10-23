// Manejar el atajo de teclado
chrome.commands.onCommand.addListener(async (command) => {
  if (command === 'toggle-selector') {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

    if (!tab) return;

    // Inyectar el content script si no está ya inyectado
    try {
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        files: ['download-name.js', 'content.js']
      });
    } catch (e) {
      console.log('Script already injected or error:', e.message);
    }

    // Enviar mensaje para toggle
    chrome.tabs.sendMessage(tab.id, { action: 'toggle' });
  }
});

function saveHtmlFile(html, filename, sendResponse) {
  const safeName = typeof filename === 'string' && filename.trim() ? filename.trim() : 'selection.html';
  let replied = false;

  function reply(payload) {
    if (replied) return;
    replied = true;
    try {
      sendResponse(payload);
    } catch (error) {
      // The popup can close before the download dialog returns.
    }
  }

  let dataUrl;
  try {
    // Service workers have no URL.createObjectURL, so the file is a data URL.
    dataUrl = `data:text/html;charset=utf-8,${encodeURIComponent(html)}`;
  } catch (error) {
    reply({ ok: false, error: error.message || 'Could not encode HTML file' });
    return;
  }

  try {
    chrome.downloads.download({
      url: dataUrl,
      filename: safeName,
      saveAs: true,
      conflictAction: 'uniquify'
    }, (downloadId) => {
      const error = chrome.runtime.lastError;
      if (!error && downloadId != null) {
        reply({ ok: true, error: null });
        return;
      }
      reply({ ok: false, error: error ? error.message : 'Download failed' });
    });
  } catch (error) {
    reply({ ok: false, error: error.message || 'Download failed' });
  }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || message.action !== 'downloadHtml') return;

  saveHtmlFile(typeof message.html === 'string' ? message.html : '', message.filename, sendResponse);
  return true;
});

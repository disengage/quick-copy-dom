(function (root) {
  'use strict';

  var TRACKING_PARAM = /^(utm_|fbclid$|gclid$|mc_eid$|ref$|ref_src$|source$|feature$)/i;

  function sanitizeFilename(name) {
    return String(name || '')
      .replace(/[\u200B-\u200D\uFEFF]/g, '')
      .replace(/[\\/:*?"<>|\u0000-\u001f]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .replace(/^\.+/, '')
      .replace(/[. ]+$/g, '')
      .slice(0, 100)
      .trim();
  }

  function decodeReadable(value) {
    var current = String(value || '');
    var pass;

    for (pass = 0; pass < 2; pass += 1) {
      if (!/%[0-9A-Fa-f]{2}/.test(current)) break;
      try {
        var next = decodeURIComponent(current);
        if (next === current) break;
        current = next;
      } catch (error) {
        break;
      }
    }

    return current;
  }

  function codePointText(code, fallback) {
    if (!Number.isFinite(code) || code < 0 || code > 0x10FFFF || (code >= 0xD800 && code <= 0xDFFF)) {
      return fallback;
    }
    return String.fromCodePoint(code);
  }

  function decodeHtmlEntities(text) {
    return String(text || '')
      .replace(/&nbsp;/gi, ' ')
      .replace(/&amp;/gi, '&')
      .replace(/&lt;/gi, '<')
      .replace(/&gt;/gi, '>')
      .replace(/&quot;/gi, '"')
      .replace(/&#39;|&apos;/gi, "'")
      .replace(/&#(\d+);/g, function (_, num) {
        return codePointText(Number(num), _);
      })
      .replace(/&#x([0-9a-f]+);/gi, function (_, hex) {
        return codePointText(parseInt(hex, 16), _);
      });
  }

  function firstHeadingText(html) {
    var source = String(html || '');

    if (typeof DOMParser === 'function') {
      try {
        var doc = new DOMParser().parseFromString(source, 'text/html');
        var heading = doc.querySelector('h1, h2, h3, h4, h5');
        if (!heading) return '';
        return heading.textContent.replace(/\s+/g, ' ').trim();
      } catch (error) {
        // Use the text scan below when parsing fails.
      }
    }

    var match = source.match(/<h[1-5]\b[^>]*>([\s\S]*?)<\/h[1-5]>/i);
    if (!match) return '';
    return decodeHtmlEntities(match[1].replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
  }

  function queryLabel(url) {
    var values = [];
    url.searchParams.forEach(function (value, key) {
      if (TRACKING_PARAM.test(key)) return;
      var decoded = decodeReadable(value).replace(/\s+/g, ' ').trim();
      if (decoded) values.push(decoded);
    });
    return values.join(' - ');
  }

  function filenameFromUrl(pageUrl) {
    try {
      var url = new URL(pageUrl);
      var host = url.hostname.replace(/^www\./i, '');
      var path = decodeReadable(url.pathname).replace(/\/+$/g, '');
      var segments = path
        .split('/')
        .filter(Boolean)
        .map(function (segment) {
          return segment.replace(/\.(html?|php|aspx?)$/i, '');
        })
        .filter(Boolean);

      if (!segments.length && url.hash.length > 1) {
        decodeReadable(url.hash.replace(/^#\/?/, ''))
          .split('/')
          .filter(Boolean)
          .forEach(function (segment) {
            segments.push(segment.replace(/\.(html?|php|aspx?)$/i, ''));
          });
      }

      var parts = [host].concat(segments.filter(Boolean));
      var query = queryLabel(url);
      if (query) parts.push(query);
      return sanitizeFilename(parts.filter(Boolean).join(' - '));
    } catch (error) {
      var withoutScheme = String(pageUrl || '')
        .replace(/^[a-z][a-z0-9+.-]*:\/\//i, '')
        .split(/[?#]/)[0];
      return sanitizeFilename(decodeReadable(withoutScheme));
    }
  }

  function buildDownloadFilename(html, pageUrl) {
    var heading = sanitizeFilename(firstHeadingText(html)).replace(/\.html?$/i, '');
    var fromUrl = filenameFromUrl(pageUrl).replace(/\.html?$/i, '');
    return (heading || fromUrl || 'selection') + '.html';
  }

  function wrapHtmlDocument(html) {
    var source = String(html || '');
    if (/^\s*(?:<!doctype|<html[\s>])/i.test(source)) return source;
    return '<!DOCTYPE html>\n<html>\n<head>\n<meta charset="utf-8">\n</head>\n<body>\n' +
      source +
      '\n</body>\n</html>\n';
  }

  root.QuickCopyDom = {
    buildDownloadFilename: buildDownloadFilename,
    wrapHtmlDocument: wrapHtmlDocument
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);

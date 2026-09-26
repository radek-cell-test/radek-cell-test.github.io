(window.LabCalBuild = window.LabCalBuild || {})['labcal_save.js'] = 'v1.577';  // file version — see labcal_build.js
/* ---------------------------------------------------------------------
   LabCal — shared file delivery
   ---------------------------------------------------------------------
   One way out for every generated file (PDF, Excel, CSV, PNG), picking the
   best route the device actually offers:

     1. Desktop save dialog  — Chrome/Edge expose showSaveFilePicker, which
        lets you choose the folder directly. Unchanged from before.

     2. iOS/iPadOS share sheet — Safari has NO save-file picker, and Chrome
        on iPad is Safari underneath, so a web page cannot choose a folder
        there. What it CAN do is hand the file to the system share sheet,
        where "Save to Files" lets you pick any folder, including iCloud,
        OneDrive and Dropbox — or send it straight to Mail.

        The share must be triggered by a real tap, and generating a PDF
        takes seconds, which is long enough for iOS to consider the original
        tap stale. So instead of sharing automatically, a bar appears with a
        Save/Share button: that tap is the fresh user gesture iOS requires.

        iOS is also fussy about the payload — sharing only works reliably
        when the share object contains the files array and nothing else, so
        no title/text/url are sent with it.

     3. Plain download — anything else behaves exactly as it always has.

   Self-contained: injects its own styles, needs no CSS in the host page.
   --------------------------------------------------------------------- */
(function (global) {
  'use strict';

  var doc = global.document;
  var STYLE_ID = 'labcal-save-style';
  var BAR_ID = 'labcal-save-bar';

  var MIME = {
    pdf: 'application/pdf',
    xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    csv: 'text/csv',
    png: 'image/png',
    zip: 'application/zip',
    json: 'application/json'
  };
  var LABEL = { pdf: 'PDF', xlsx: 'Excel file', csv: 'CSV', png: 'Image', zip: 'Archive', json: 'Backup file' };

  function extOf(filename) {
    var m = String(filename || '').match(/\.([a-z0-9]+)$/i);
    return m ? m[1].toLowerCase() : '';
  }
  function mimeFor(filename, override) {
    return override || MIME[extOf(filename)] || 'application/octet-stream';
  }
  function labelFor(filename) {
    return LABEL[extOf(filename)] || 'File';
  }

  // ---- delivery notice (v1.542) -------------------------------------------
  // Tells the rest of the page that a file actually left LabCal — saved with
  // the picker, handed to the share sheet (and not cancelled), or downloaded.
  // labcal_certs.js listens for it to mark certificates as saved out, so an
  // unsaved one is never quietly pruned. opts.certIds names the certificate
  // records a file carries (e.g. a merged job); otherwise the file name is
  // matched.
  var DELIVERED_EVENT = 'labcal-file-delivered';
  function announceDelivered(filename, how, opts) {
    try {
      global.dispatchEvent(new CustomEvent(DELIVERED_EVENT, { detail: {
        filename: (opts && opts.__origName) || filename, how: how,
        certIds: (opts && opts.certIds) ? opts.certIds.slice() : null
      } }));
    } catch (e) { /* never let bookkeeping break a save */ }
  }

  // ---- plain download ----------------------------------------------------
  function download(blob, filename) {
    var url = URL.createObjectURL(blob);
    var a = doc.createElement('a');
    a.href = url;
    a.download = filename;
    doc.body.appendChild(a);
    a.click();
    setTimeout(function () {
      doc.body.removeChild(a);
      URL.revokeObjectURL(url);
    }, 1500);
  }

  // ---- capability checks -------------------------------------------------
  function hasDesktopPicker() {
    if (!('showSaveFilePicker' in global)) return false;
    try { return global.self === global.top; } catch (e) { return false; }
  }

  function canShareFile(blob, filename) {
    try {
      if (!global.navigator || !navigator.share || !navigator.canShare) return false;
      if (typeof global.File !== 'function') return false;
      var f = new File([blob], filename, { type: mimeFor(filename) });
      return navigator.canShare({ files: [f] });
    } catch (e) { return false; }
  }

  // ---- the share bar -----------------------------------------------------
  function injectStyle() {
    if (doc.getElementById(STYLE_ID)) return;
    var st = doc.createElement('style');
    st.id = STYLE_ID;
    st.textContent = [
      '#' + BAR_ID + '{position:fixed;left:0;right:0;bottom:0;z-index:99999;',
      '  display:flex;align-items:center;gap:10px;flex-wrap:wrap;',
      '  padding:12px 14px calc(12px + env(safe-area-inset-bottom));',
      '  background:#12161c;color:#fff;font-family:-apple-system,"Segoe UI",Helvetica,Arial,sans-serif;',
      '  box-shadow:0 -4px 18px rgba(0,0,0,.25)}',
      '#' + BAR_ID + ' .lsb-text{flex:1;min-width:150px;line-height:1.35}',
      '#' + BAR_ID + ' .lsb-text b{display:block;font-size:13.5px;font-weight:650}',
      '#' + BAR_ID + ' .lsb-text span{font-size:11px;opacity:.72;word-break:break-all}',
      '#' + BAR_ID + ' button{font:inherit;font-size:13px;font-weight:650;border-radius:7px;',
      '  padding:11px 16px;border:none;cursor:pointer;-webkit-tap-highlight-color:transparent}',
      '#' + BAR_ID + ' .lsb-primary{background:#0f9488;color:#fff}',
      '#' + BAR_ID + ' .lsb-ghost{background:transparent;color:#cfd8e0;border:1px solid #3a444f}',
      '#' + BAR_ID + ' .lsb-close{background:transparent;color:#8d99a5;padding:11px 12px;font-size:15px}',
      '@media (max-width:520px){#' + BAR_ID + ' .lsb-text{flex-basis:100%}',
      '  #' + BAR_ID + ' .lsb-primary,#' + BAR_ID + ' .lsb-ghost{flex:1}}',
      // never let the bar end up in a printed page or a captured PDF
      '@media print{#' + BAR_ID + '{display:none !important}}',
      'body.printMode #' + BAR_ID + ',body.pdfBusy #' + BAR_ID + '{display:none !important}'
    ].join('\n');
    doc.head.appendChild(st);
  }

  function closeBar() {
    var old = doc.getElementById(BAR_ID);
    if (old && old.parentNode) old.parentNode.removeChild(old);
  }

  function showShareBar(blob, filename, opts) {
    injectStyle();
    closeBar();
    var bar = doc.createElement('div');
    bar.id = BAR_ID;
    bar.innerHTML =
      '<div class="lsb-text"><b>' + labelFor(filename) + ' ready</b><span></span></div>' +
      '<button type="button" class="lsb-primary">Save / Share</button>' +
      '<button type="button" class="lsb-ghost">Download</button>' +
      '<button type="button" class="lsb-close" aria-label="Dismiss">&#10005;</button>';
    bar.querySelector('.lsb-text span').textContent = filename;

    bar.querySelector('.lsb-primary').addEventListener('click', async function () {
      var file;
      try {
        file = new File([blob], filename, { type: mimeFor(filename, opts && opts.mime) });
      } catch (e) { download(blob, filename); announceDelivered(filename, 'download', opts); closeBar(); return; }
      try {
        // files ONLY — adding title/text/url makes iOS refuse the share
        await navigator.share({ files: [file] });
        announceDelivered(filename, 'share', opts);
        closeBar();
      } catch (err) {
        // Cancelling the share sheet is not an error worth reporting; leave
        // the bar up so the file is not lost and can still be saved.
        if (err && (err.name === 'AbortError' || err.name === 'NotAllowedError')) return;
        download(blob, filename);
        announceDelivered(filename, 'download', opts);
        closeBar();
      }
    });
    bar.querySelector('.lsb-ghost').addEventListener('click', function () {
      download(blob, filename);
      announceDelivered(filename, 'download', opts);
      closeBar();
    });
    bar.querySelector('.lsb-close').addEventListener('click', closeBar);

    doc.body.appendChild(bar);
    return 'bar';
  }

  // ---- the one entry point ----------------------------------------------
  // Resolves as soon as the file has been handed off or the bar is showing,
  // so the calling page can re-enable its buttons straight away.
  async function deliver(blob, filename, opts) {
    opts = opts || {};
    if (!blob) return 'error';

    // v1.547: on the TEST site every file goes out as TEST_..., so a test
    // certificate can never be filed or sent as a real one. The original
    // name is kept for the certificate list's "saved out" tracking.
    try {
      if (global.LabCalTestMode && global.LabCalTestMode.active && filename && String(filename).indexOf('TEST_') !== 0) {
        opts.__origName = filename;
        filename = 'TEST_' + filename;
      }
    } catch (e) {}

    if (hasDesktopPicker()) {
      try {
        var handle = await global.showSaveFilePicker({
          suggestedName: filename,
          types: [{
            description: labelFor(filename),
            accept: (function () {
              var a = {};
              a[mimeFor(filename, opts.mime)] = ['.' + (extOf(filename) || 'bin')];
              return a;
            })()
          }]
        });
        var writable = await handle.createWritable();
        await writable.write(blob);
        await writable.close();
        announceDelivered(filename, 'saved', opts);
        return 'saved';
      } catch (err) {
        if (err && err.name === 'AbortError') return 'cancelled';
        // picker unavailable or failed — fall through to the routes below
      }
    }

    if (canShareFile(blob, filename)) return showShareBar(blob, filename, opts);

    download(blob, filename);
    announceDelivered(filename, 'download', opts);
    return 'downloaded';
  }

  global.LabCalSave = {
    deliver: deliver,
    download: download,
    close: closeBar,
    canShareFile: canShareFile,
    hasDesktopPicker: hasDesktopPicker,
    DELIVERED_EVENT: DELIVERED_EVENT
  };
})(typeof window !== 'undefined' ? window : this);

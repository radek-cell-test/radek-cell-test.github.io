(window.LabCalBuild = window.LabCalBuild || {})['labcal_nav.js'] = 'v1.597';  // file version — see labcal_build.js
/* ---------------------------------------------------------------------
   LabCal — Back / Home on the worksheet toolbar (v1.563)
   ---------------------------------------------------------------------
   Installed on the iPad Home Screen, LabCal runs without Safari's own
   Back button, so a worksheet had no way out. This adds  ← Back  and
   Home  to the front of the worksheet toolbar, keeps the toolbar on
   screen while scrolling, and keeps it clear of the status bar / notch.

   There is no router in LabCal: every screen is its own page, reached with
   an ordinary link. So navigation stays exactly that:
   • Back  = the browser's own history.back(), used only when the page we
             came from is another LabCal page in this same folder. If there
             is none (worksheet opened directly, from a bookmark, as the
             first page of the app), or Back does not leave the page, it
             goes to the LabCal home page instead — never out of the app
             and never "nothing happens".
   • Home  = index.html in this folder (the app's start page).

   Before leaving, readings are protected with the page's OWN save (the
   per-unit snapshot, or Cloud Temp's autosave). Only if the engineer has
   typed something and it could NOT be saved where it will be found again
   (no job ref / serial, or storage failed) is a confirmation shown.

   Usage (end of a worksheet's script):
     LabCalNav.init({ save: function () { ...return true if saved... } });
   --------------------------------------------------------------------- */
(function (global) {
  'use strict';
  var doc = global.document;
  var HOME = 'index.html';
  var opts = null;
  var userTyped = false;

  function folderOf(path) { return String(path || '').replace(/[^/]*$/, ''); }
  // The page we came from is a LabCal page of this same version folder.
  function cameFromLabCal() {
    try {
      if (!doc.referrer) return false;
      var r = new URL(doc.referrer);
      return r.origin === global.location.origin &&
             folderOf(r.pathname) === folderOf(global.location.pathname) &&
             r.pathname !== global.location.pathname;
    } catch (e) { return false; }
  }

  function tabLocked() {
    try { return !!(global.LabCalTabLock && global.LabCalTabLock.isLocked()); } catch (e) { return false; }
  }

  // v1.591 (Radek): "when I leave, save whatever was changed". The readings
  // were already kept (unit snapshot); what was lost were Model / Serial /
  // Location typed on the worksheet — the job list is the authority on those
  // and put its old values back when the unit was reopened. Leaving now does
  // what "Save to job list" does, silently. Blank fields are never pushed
  // (a blank serial must not wipe the unit's serial on the list). Only for a
  // worksheet opened from the job list, only in the tab that owns the unit.
  var pushedSig = '';
  function pushToJobList() {
    if (!userTyped) return false;
    try {
      var J = global.LabCalJobsheet;
      if (!J || !J.syncFromWorksheet || !J.link || typeof global.jobLinkFields !== 'function') return false;
      var l = J.link(); if (!l || !l.serial) return false;
      if (tabLocked()) return false;
      var f = global.jobLinkFields() || {}, patch = {};
      ['model', 'serial', 'location'].forEach(function (k) { if (f[k] != null && String(f[k]).trim() !== '') patch[k] = String(f[k]).trim(); });
      if (!Object.keys(patch).length) return false;
      var sig = JSON.stringify([l.jobRef, l.uid || l.serial, patch]);
      if (sig === pushedSig) return true;
      var d = J.syncFromWorksheet(patch);
      if (d) pushedSig = sig;
      return !!d;
    } catch (e) { console.warn('Could not update the job list on leaving:', e); return false; }
  }
  if (global.addEventListener) global.addEventListener('pagehide', function () { pushToJobList(); });

  // true = fine to leave. Saves first; asks only when typed readings would be lost.
  function okToLeave() {
    pushToJobList();
    if (!opts || !userTyped || opts.noWarn) return true;
    if (tabLocked()) return true;                       // this tab saves nothing by design; the other tab has the unit
    var saved = false;
    try { saved = opts.save ? opts.save() === true : false; } catch (e) { saved = false; }
    if (saved) return true;
    return global.confirm(opts.unsavedMessage ||
      'The readings on this worksheet are NOT saved.\n\n' +
      'They are only kept for a unit with a Job Ref and a Serial No. Fill those in (or generate the certificate) first, or they will be lost.\n\n' +
      'OK = leave anyway and lose them.  Cancel = stay here.');
  }

  function goHome() { global.location.href = HOME; }

  // v1.581 (Radek): Back from a worksheet returns to THIS unit's job list, not
  // the calendar. The job and unit come from this tab's own link (opened from
  // the job list), else from the Job Ref / Serial typed on the form — but only
  // when that job is on the job list. calibration.html opens that job and
  // scrolls to the unit (#job=…&unit=…).
  function jobTarget() {
    var ref = '', serial = '';
    try {
      var J = global.LabCalJobsheet;
      var l = J && J.link ? J.link() : null;
      if (l && l.jobRef) { ref = String(l.jobRef); serial = String(l.serial || ''); }
    } catch (e) {}
    if (!ref) {
      var j = doc.getElementById('jobRef'), s = doc.getElementById('serial');
      ref = j ? String(j.value || '').trim() : '';
      serial = s ? String(s.value || '').trim() : '';
    }
    if (!ref) return null;
    try {
      var J2 = global.LabCalJobsheet;
      if (!J2 || !J2.jobByRef || !J2.jobByRef(ref)) return null;
    } catch (e) { return null; }
    return 'calibration.html#job=' + encodeURIComponent(ref) + (serial ? '&unit=' + encodeURIComponent(serial) : '');
  }

  function back() {
    if (!okToLeave()) return;
    var t = jobTarget();
    if (t) { global.location.href = t; return; }
    if (cameFromLabCal() && global.history.length > 1) {
      var left = false;
      var mark = function () { left = true; };
      global.addEventListener('pagehide', mark, { once: true });
      global.history.back();
      // If history.back() did not take us anywhere (no usable entry), go home.
      global.setTimeout(function () {
        global.removeEventListener('pagehide', mark);
        if (!left && doc.visibilityState !== 'hidden') goHome();
      }, 1200);
      return;
    }
    goHome();
  }
  function home() { if (okToLeave()) goHome(); }

  // ---- toolbar -------------------------------------------------------------
  var CSS =
    // Sticky toolbar. Same spacing as before at rest (10px moved from margin to
    // padding so the background covers it); the status-bar / notch insets are added.
    '.toolbar{position:-webkit-sticky;position:sticky;top:0;z-index:40;background:#dfe6ee;' +
      'margin-top:0!important;margin-bottom:0!important;' +
      'padding:calc(10px + env(safe-area-inset-top,0px)) env(safe-area-inset-right,0px) 10px env(safe-area-inset-left,0px)}' +
    // Test site: its red banner is fixed at the top, sit just under it.
    'body.lcNavTest .toolbar{top:calc(26px + env(safe-area-inset-top,0px));padding-top:10px}' +
    // ~44 x 44 px touch targets for every toolbar button
    '.toolbar .btn{min-height:44px;min-width:44px}' +
    '.lcNavBtn{display:inline-flex;align-items:center;justify-content:center;gap:6px}' +
    '.lcNavBtn svg{width:18px;height:18px;flex:0 0 auto}' +
    // Short labels on narrow screens (phones, split view). The real button text
    // is not touched — the short label is drawn over it — so the pages' own
    // "Generating PDF…" / "Saved to job list ✓" messages still show (see watchLabel).
    '@media (max-width:600px){' +
      '.toolbar .btn.lcShort{font-size:0}' +
      '.toolbar .btn.lcShort::after{content:attr(data-short);font-size:13px}' +
    '}' +
    // very narrow (small phones): Back / Home as icons only so the row still fits
    '@media (max-width:420px){.lcNavBtn .lcNavTxt{display:none}}' +
    '@media print{.toolbar{position:static}}' +
    // v1.582: job + unit line (last row of the toolbar)
    '#lcJobLine{flex:1 1 100%;order:99;min-width:0;font:600 13px/1.35 -apple-system,system-ui,Arial,sans-serif;color:#24405e;' +
      'white-space:nowrap;overflow:hidden;text-overflow:ellipsis;padding:0 2px}' +
    '#lcJobLine .lcjl-sep{color:#7a8ea3;font-weight:400;margin:0 5px}' +
    '#lcJobLine .lcjl-left{font-weight:400;color:#3d5570}' +
    '#lcJobLine .lcjl-done{color:#1e7a45}' +
    // v1.582: More… opens a grouped drop-down list instead of spreading the
    // buttons across the toolbar.
    '#moreTools.lcMenu{position:fixed;z-index:60;width:270px;max-width:calc(100vw - 16px);box-sizing:border-box;overflow:auto;' +
      '-webkit-overflow-scrolling:touch;background:#fff;border:1px solid #9aa8b6;border-radius:10px;box-shadow:0 10px 28px rgba(0,0,0,.28);padding:6px}' +
    '#moreTools.lcMenu .lcm-group{padding:4px 0}' +
    '#moreTools.lcMenu .lcm-group+.lcm-group{border-top:1px solid #e1e6ec}' +
    '#moreTools.lcMenu .lcm-gt{font:600 11px -apple-system,system-ui,Arial,sans-serif;letter-spacing:.06em;text-transform:uppercase;color:#6b7c8e;padding:6px 10px 2px}' +
    '#moreTools.lcMenu .btn{display:block;width:100%;text-align:left;margin:2px 0;background:#fff;color:#111;border:0;border-radius:6px;font-weight:600;padding:10px}' +
    '#moreTools.lcMenu .btn:active,#moreTools.lcMenu .btn:hover{background:#eef2f6}' +
    '#moreTools.lcMenu .lcm-danger .btn{color:#a3261b}' +
    '#moreToolsBtn[aria-expanded="true"]{background:#24405e;color:#fff;border-color:#24405e}' +
    // v1.590: earlier visits of this serial (certificate register)
    '#lcHistLine{flex:1 1 100%;order:100;min-width:0;display:flex;align-items:center;gap:6px;min-height:44px;box-sizing:border-box;margin:0;' +
      'padding:4px 8px;border:1px solid #d9c38a;border-radius:8px;background:#fff8e6;color:#5a4000;text-align:left;cursor:pointer;' +
      'font:600 13px/1.3 -apple-system,system-ui,Arial,sans-serif}' +
    '#lcHistLine[hidden]{display:none}' +
    '#lcHistLine .lchl-txt{flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}' +
    '#lcHistLine .lchl-more{font-weight:400;color:#7a5c10;flex:0 0 auto}' +
    // v1.590: panels (history list, next unit)
    '.lcPanel{position:fixed;left:50%;transform:translateX(-50%);bottom:calc(12px + env(safe-area-inset-bottom,0px));z-index:70;' +
      'width:560px;max-width:calc(100vw - 16px);max-height:70vh;box-sizing:border-box;display:flex;flex-direction:column;background:#fff;' +
      'border:1px solid #9aa8b6;border-radius:12px;box-shadow:0 12px 34px rgba(0,0,0,.32);font:14px/1.35 -apple-system,system-ui,Arial,sans-serif;color:#1d2a38}' +
    '.lcPanel .lcp-head{padding:12px 14px 6px;font-weight:700;font-size:15px}' +
    '.lcPanel .lcp-sub{padding:0 14px 8px;color:#56687a;font-size:13px}' +
    '.lcPanel .lcp-list{overflow:auto;-webkit-overflow-scrolling:touch;padding:0 10px}' +
    '.lcPanel .lcp-item{display:block;width:100%;box-sizing:border-box;min-height:48px;margin:0 0 6px;padding:8px 10px;text-align:left;' +
      'background:#f4f7fa;border:1px solid #cfd8e2;border-radius:8px;font:inherit;color:inherit}' +
    '.lcPanel button.lcp-item{cursor:pointer}' +
    '.lcPanel button.lcp-item:active{background:#e3ebf3}' +
    '.lcPanel .lcp-l1{font-weight:600}' +
    '.lcPanel .lcp-l2{color:#56687a;font-size:12.5px;margin-top:2px}' +
    '.lcPanel .lcp-tag{display:inline-block;margin-left:6px;padding:0 6px;border-radius:9px;font-size:11px;font-weight:600;background:#e8eef4;color:#3d5570}' +
    '.lcPanel .lcp-tag.started{background:#fff0cf;color:#7a5200}' +
    '.lcPanel .lcp-tag.here{background:#dff3e6;color:#1e6b3c}' +
    '.lcPanel .lcp-foot{display:flex;gap:8px;justify-content:flex-end;padding:10px 14px 12px;border-top:1px solid #e1e6ec}' +
    '.lcPanel .lcp-foot button{min-height:44px;min-width:44px;padding:0 16px;border-radius:8px;border:1px solid #9aa8b6;background:#fff;font:600 14px -apple-system,system-ui,Arial,sans-serif}' +
    '.lcPanel .lcp-foot button.primary{background:#24405e;border-color:#24405e;color:#fff}' +
    '@media print{#lcJobLine,#lcHistLine,.lcPanel,#moreTools{display:none!important}}';

  var HOUSE = '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 11.5 12 4l9 7.5"/><path d="M5.5 10v10h13V10"/><path d="M10 20v-6h4v6"/></svg>';

  function button(id, html, label, onClick) {
    var b = doc.createElement('button');
    b.type = 'button';
    b.id = id;
    b.className = ((opts && opts.buttonClass) || 'btn light') + ' lcNavBtn';
    b.setAttribute('aria-label', label);
    b.title = label;
    b.innerHTML = html;
    b.addEventListener('click', onClick);
    return b;
  }

  // Short label only while the button shows its normal text; any other text the
  // page puts there (progress / result messages) is shown in full.
  function watchLabel(el, shortText) {
    if (!el) return;
    var normal = el.textContent;
    el.setAttribute('data-short', shortText);
    var apply = function () { el.classList.toggle('lcShort', el.textContent === normal); };
    apply();
    try { new MutationObserver(apply).observe(el, { childList: true, characterData: true, subtree: true }); } catch (e) {}
  }

  // v1.565: other pages (Data Logger Viewer) keep their own top bar — already
  // sticky and clear of the status bar — and only get the two buttons.
  var CSS_OWN_BAR =
    '.lcNavBtn{display:inline-flex;align-items:center;justify-content:center;gap:6px;min-height:44px;min-width:44px}' +
    '.lcNavBtn svg{width:18px;height:18px;flex:0 0 auto}' +
    '@media (max-width:760px){.lcNavBtn .lcNavTxt{display:none}}';

  // ---- v1.582 (Radek): job + unit line under the toolbar ----------------
  // "ENQ144403 › unit 2 of 5 · 3 left on the job · Well Pharmacy". Shown only when this
  // unit's job is on the job list (same test as the Back → Job list button).
  // Read-only: it only tells the engineer where he is.
  function serialKey(v) { return String(v || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, ''); }
  function jobLineInfo() {
    var J = global.LabCalJobsheet;
    if (!J || !J.jobByRef) return null;
    var ref = '', serial = '', uid = '';
    try {
      var l = J.link ? J.link() : null;
      if (l && l.jobRef) { ref = String(l.jobRef); serial = String(l.serial || ''); uid = String(l.uid || ''); }
    } catch (e) {}
    // The form wins when the engineer has typed another serial / job on it.
    var jf = doc.getElementById('jobRef'), sf = doc.getElementById('serial');
    var fRef = jf ? String(jf.value || '').trim() : '', fSer = sf ? String(sf.value || '').trim() : '';
    if (fRef && (!ref || J.jobKey(fRef) !== J.jobKey(ref))) { ref = fRef; serial = fSer; uid = ''; }
    else if (fSer && serialKey(fSer) !== serialKey(serial)) { serial = fSer; uid = ''; }
    if (!ref) return null;
    var job = null;
    try { job = J.jobSnapshot ? J.jobSnapshot(ref) : J.jobByRef(ref); } catch (e) { job = null; }
    if (!job || !job.devices) return null;
    var live = job.devices.filter(function (d) { return !d.duplicateMerged; });
    var idx = -1, sk = serialKey(serial);
    if (uid) live.forEach(function (d, i) { if (idx < 0 && d.uid && d.uid === uid) idx = i; });
    if (idx < 0 && sk) live.forEach(function (d, i) { if (idx < 0 && serialKey(d.serial) === sk) idx = i; });
    // Units left = not done and not "not required". (Before v1.589 this could
    // not use J.progressOf(): LabCalUnits.has() used to mark the unit as loaded
    // by this page and switch off the "a saved worksheet was found" question —
    // fixed in labcal_units.js v1.589, has() now only looks.)
    var left = live.filter(function (d) { return !d.done && !d.notRequired; }).length;
    return { ref: job.callNumber || ref, customer: job.customer || '', idx: idx, total: live.length,
             unit: idx > -1 ? live[idx] : null, serial: serial, left: left };
  }
  function esc(t) { return String(t == null ? '' : t).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function renderJobLine() {
    var el = doc.getElementById('lcJobLine'); if (!el) return;
    var i = null;
    try { i = jobLineInfo(); } catch (e) { i = null; }
    if (!i) { el.hidden = true; el.innerHTML = ''; el.removeAttribute('title'); return; }
    var sep = '<span class="lcjl-sep">·</span>';
    var unit = i.idx > -1 ? 'unit ' + (i.idx + 1) + ' of ' + i.total
      : (i.serial ? esc(i.serial) + ' — not on this job’s list' : 'no serial yet');
    var state = i.unit && i.unit.done ? '<span class="lcjl-done">✓ done</span>'
      : (i.unit && i.unit.notRequired ? 'not required' : '');
    var left = i.left > 0 ? i.left + ' left on the job' : 'nothing left on the job';
    // Customer last: a long hospital name is what gets cut short, never the unit.
    var html = esc(i.ref) + '<span class="lcjl-sep">›</span>' + unit + (state ? sep + state : '') +
      sep + '<span class="lcjl-left">' + left + '</span>' + (i.customer ? sep + esc(i.customer) : '');
    if (el.innerHTML !== html) el.innerHTML = html;
    el.hidden = false;
    el.title = el.textContent;
  }
  function installJobLine(bar) {
    if (doc.getElementById('lcJobLine')) return;
    var el = doc.createElement('div');
    el.id = 'lcJobLine';
    el.hidden = true;
    el.setAttribute('aria-live', 'polite');
    bar.appendChild(el);
    renderJobLine();
    global.setTimeout(renderJobLine, 600);
    doc.addEventListener('change', function (e) { if (e.target && (e.target.id === 'jobRef' || e.target.id === 'serial')) renderJobLine(); }, true);
    try {
      var J = global.LabCalJobsheet;
      if (J && J.CHANGE_EVENT) global.addEventListener(J.CHANGE_EVENT, function () { global.setTimeout(renderJobLine, 0); });
    } catch (e) {}
    // ticks written by another tab / by this page's own save
    global.addEventListener('storage', function () { global.setTimeout(renderJobLine, 60); });
    global.addEventListener('pageshow', renderJobLine);
    global.addEventListener('focus', renderJobLine);
  }

  // ---- v1.590 (Radek): earlier visits of this unit ------------------------
  // From the certificate register (labcal_certs.js): every certificate this
  // iPad made for the serial on the form, on OTHER jobs (this job's own
  // certificate is the revision question, not history). Shown only when
  // there is something; tap = the full list. Read-only.
  var MON = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
  function dmy(iso) {
    var m = String(iso || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
    return m ? m[3] + '/' + MON[Number(m[2]) - 1] + '/' + m[1] : '';
  }
  var SHEET_NAMES = { smd: 'SMD', snmd: 'SNMD', nsmd: 'NSMD', ibb: 'IBB', ws19_24: '19/24', barkey: 'Barkey', cloud_temp: 'Monitoring', monitoring: 'Monitoring' };
  function formUnit() {
    var jf = doc.getElementById('jobRef'), sf = doc.getElementById('serial');
    return { jobRef: jf ? String(jf.value || '').trim() : '', serial: sf ? String(sf.value || '').trim() : '' };
  }
  var histSeq = 0, histFor = '', histVisits = [];
  function earlierVisits(u) {
    var C = global.LabCalCerts;
    if (!C || !C.history || !serialKey(u.serial)) return Promise.resolve([]);
    var jk = serialKey(u.jobRef);
    return C.history(u.serial).then(function (list) {
      // one line per certificate number and job (a revised certificate
      // replaces the earlier one of the same visit)
      var seen = {};
      return (list || []).filter(function (e) {
        if (jk && serialKey(e.jobRef) === jk) return false;
        var k = serialKey(e.jobRef) + '|' + serialKey(e.certRef || e.filename);
        if (seen[k]) return false;
        seen[k] = true;
        return true;
      });
    }, function (e) { console.warn('Certificate register not read for the unit history:', e); return []; });
  }
  function renderHistLine() {
    var el = doc.getElementById('lcHistLine'); if (!el) return;
    var u = formUnit();
    var sig = serialKey(u.serial) + '|' + serialKey(u.jobRef);
    var seq = ++histSeq;
    earlierVisits(u).then(function (v) {
      if (seq !== histSeq) return;                      // the form changed meanwhile
      histFor = sig; histVisits = v;
      if (!v.length) { el.hidden = true; el.innerHTML = ''; el.removeAttribute('title'); return; }
      var e = v[0];
      var txt = 'Calibrated before: ' + dmy(e.savedAt || e.day) + ' · ' + (e.certRef || e.summary || e.filename) +
        (e.jobRef ? ' · job ' + e.jobRef : '') + (e.location ? ' · ' + e.location : '');
      el.innerHTML = '<span aria-hidden="true">↺</span><span class="lchl-txt">' + esc(txt) + '</span>' +
        '<span class="lchl-more">' + (v.length > 1 ? v.length + ' visits ›' : 'details ›') + '</span>';
      el.title = txt;
      el.hidden = false;
    });
  }
  function closePanel(id) { var p = doc.getElementById(id); if (p && p.parentNode) p.parentNode.removeChild(p); }
  function panel(id, head, sub, itemsHtml, footHtml) {
    closePanel('lcHistPanel'); closePanel('lcNextPanel');
    var p = doc.createElement('div');
    p.id = id; p.className = 'lcPanel'; p.setAttribute('role', 'dialog'); p.setAttribute('aria-label', head);
    p.innerHTML = '<div class="lcp-head">' + esc(head) + '</div>' + (sub ? '<div class="lcp-sub">' + esc(sub) + '</div>' : '') +
      '<div class="lcp-list">' + itemsHtml + '</div><div class="lcp-foot">' + footHtml + '</div>';
    doc.body.appendChild(p);
    return p;
  }
  function showHistory() {
    var v = histVisits, u = formUnit();
    if (!v.length) return;
    var items = v.map(function (e) {
      var l1 = dmy(e.savedAt || e.day) + ' · ' + (e.certRef || e.summary || e.filename) + (Number(e.rev) > 1 ? ' (rev ' + e.rev + ')' : '');
      var l2 = [e.jobRef ? 'job ' + e.jobRef : '', e.site, e.location, e.model, SHEET_NAMES[e.sheet] || e.sheet].filter(Boolean).join(' · ');
      return '<div class="lcp-item"><div class="lcp-l1">' + esc(l1) + '</div><div class="lcp-l2">' + esc(l2) + '</div></div>';
    }).join('');
    var p = panel('lcHistPanel', 'Serial ' + u.serial + ' — calibrated before', 'Certificates made on this iPad (kept about 13 months). Visits by other engineers are not included.',
      items, '<button type="button" class="primary" data-lcp="close">Close</button>');
    p.querySelector('[data-lcp="close"]').addEventListener('click', function () { closePanel('lcHistPanel'); });
  }
  function installHistLine(bar) {
    if (doc.getElementById('lcHistLine')) return;
    var el = doc.createElement('button');
    el.type = 'button';
    el.id = 'lcHistLine';
    el.hidden = true;
    el.setAttribute('aria-label', 'Earlier certificates for this serial');
    el.addEventListener('click', showHistory);
    bar.appendChild(el);
    renderHistLine();
    global.setTimeout(renderHistLine, 700);
    doc.addEventListener('change', function (e) { if (e.target && (e.target.id === 'jobRef' || e.target.id === 'serial')) renderHistLine(); }, true);
    try { if (global.LabCalCerts && global.LabCalCerts.onChange) global.LabCalCerts.onChange(function () { global.setTimeout(renderHistLine, 50); }); } catch (e) {}
    global.addEventListener('pageshow', renderHistLine);
  }

  // ---- v1.590 (Radek): next unit -------------------------------------------
  // After the certificate has gone out (saved / shared) or Save to job list,
  // a panel lists the units of this job still to do — the engineer taps the
  // one he is standing at (the order on the job sheet is not the order on
  // site). Tap → calibration.html opens that unit with its own Open button
  // (same tab-lock and worksheet checks). Job list / Stay here close it.
  function remainingUnits() {
    var i = null;
    try { i = jobLineInfo(); } catch (e) { i = null; }
    if (!i) return null;
    var J = global.LabCalJobsheet, job = null;
    try { job = J.jobSnapshot ? J.jobSnapshot(i.ref) : J.jobByRef(i.ref); } catch (e) { job = null; }
    if (!job || !job.devices) return null;
    var here = serialKey(i.serial), sheets = (J && J.SHEETS) || {};
    var left = job.devices.filter(function (d) {
      return !d.duplicateMerged && !d.done && !d.notRequired && !(here && serialKey(d.serial) === here);
    }).map(function (d) {
      var started = false;
      try { started = !!(global.LabCalUnits && d.sheet && d.serial && global.LabCalUnits.has(d.sheet, job.callNumber, d.serial)); } catch (e) {}
      return { model: d.model || d.equipment || '', serial: d.serial || '', location: d.location || '',
               sheet: d.sheet && sheets[d.sheet] ? (SHEET_NAMES[d.sheet] || sheets[d.sheet].name || d.sheet) : '',
               started: started };
    });
    return { ref: job.callNumber || i.ref, customer: job.customer || '', units: left, thisDone: !!(i.unit && i.unit.done) };
  }
  function openUnitUrl(ref, serial) {
    return 'calibration.html#job=' + encodeURIComponent(ref) + '&unit=' + encodeURIComponent(serial) + '&open=1';
  }
  function showNext() {
    var r = remainingUnits();
    if (!r) return false;
    var items = r.units.map(function (u, k) {
      var l2 = [u.serial ? 'SN ' + u.serial : 'no serial', u.location].filter(Boolean).join(' · ');
      return '<button type="button" class="lcp-item" data-lcn="' + k + '"><div class="lcp-l1">' + esc(u.model || '(no model)') +
        (u.started ? '<span class="lcp-tag started">started</span>' : '') +
        (u.sheet ? '<span class="lcp-tag">' + esc(u.sheet) + '</span>' : '<span class="lcp-tag">choose worksheet</span>') +
        '</div><div class="lcp-l2">' + esc(l2) + '</div></button>';
    }).join('');
    var head = r.units.length ? 'Next unit — ' + r.ref + ' · ' + r.units.length + ' left' : r.ref + ' — nothing left to do ✓';
    var sub = r.units.length ? 'Tap the unit you are at.' : 'Every unit on this job is done or not required. Save the job pack from the job list.';
    var p = panel('lcNextPanel', head, sub, items,
      '<button type="button" data-lcp="stay">Stay here</button><button type="button" class="primary" data-lcp="list">Job list</button>');
    p.querySelector('[data-lcp="stay"]').addEventListener('click', function () { closePanel('lcNextPanel'); });
    p.querySelector('[data-lcp="list"]').addEventListener('click', function () {
      if (!okToLeave()) return;
      global.location.href = 'calibration.html#job=' + encodeURIComponent(r.ref);
    });
    Array.prototype.forEach.call(p.querySelectorAll('[data-lcn]'), function (b) {
      b.addEventListener('click', function () {
        var u = r.units[Number(b.getAttribute('data-lcn'))];
        if (!u || !okToLeave()) return;
        global.location.href = openUnitUrl(r.ref, u.serial);
      });
    });
    return true;
  }
  function installNext() {
    // the certificate PDF has gone out (saved, shared or downloaded)
    global.addEventListener('labcal-file-delivered', function (e) {
      var d = (e && e.detail) || {};
      if (d.certIds || !/\.pdf$/i.test(String(d.filename || ''))) return;   // merged files / Excel: no
      global.setTimeout(showNext, 350);
    });
    // Save to job list (the engineer's own tap, when it worked)
    doc.addEventListener('click', function (e) {
      var b = e.target && e.target.closest && e.target.closest('#syncJobBtn');
      if (!b || !e.isTrusted) return;
      global.setTimeout(function () { if (/✓/.test(b.textContent)) showNext(); }, 60);
    });
    doc.addEventListener('keydown', function (e) { if (e.key === 'Escape') { closePanel('lcNextPanel'); closePanel('lcHistPanel'); } });
  }

  // ---- v1.582 (Radek): tidy More… menu -------------------------------------
  // The page's own buttons (with their own handlers) are moved, not copied,
  // into a drop-down list in groups. Nothing they do is changed.
  var MENU_GROUPS = [
    { name: 'This unit', test: /loadLocal/ },
    { name: 'Files & print', test: /generateExcel|excelImportFile|saveBackupToFile|backupRestoreFile|window\.print/ },
    { name: 'Set-up', test: /offsetFile|jobsheetFile/ },
    { name: 'Other', test: null },
    { name: 'Start again', test: /startNewCalibration|clearForm/, cls: 'lcm-danger' }
  ];
  function menuGroupOf(b) {
    var key = (b.getAttribute('onclick') || '') + ' ' + (b.id || '');
    for (var g = 0; g < MENU_GROUPS.length; g++) if (MENU_GROUPS[g].test && MENU_GROUPS[g].test.test(key)) return g;
    return 3;
  }
  function menuOpen() { var m = doc.getElementById('moreTools'); return !!(m && m.style.display !== 'none'); }
  function placeMenu() {
    var m = doc.getElementById('moreTools'), b = doc.getElementById('moreToolsBtn');
    if (!m || !b) return;
    var r = b.getBoundingClientRect();
    var w = Math.min(270, global.innerWidth - 16);
    var left = Math.max(8, Math.min(r.left, global.innerWidth - w - 8));
    m.style.top = Math.round(r.bottom + 6) + 'px';
    m.style.left = Math.round(left) + 'px';
    m.style.maxHeight = Math.max(160, global.innerHeight - r.bottom - 16) + 'px';
  }
  function setMenu(open) {
    var m = doc.getElementById('moreTools'), b = doc.getElementById('moreToolsBtn');
    if (!m) return;
    m.style.display = open ? 'block' : 'none';
    if (b) b.setAttribute('aria-expanded', open ? 'true' : 'false');
    if (open) placeMenu();
  }
  function installMoreMenu() {
    var m = doc.getElementById('moreTools'), b = doc.getElementById('moreToolsBtn');
    if (!m || !b || m.classList.contains('lcMenu')) return;
    var btns = Array.prototype.filter.call(m.children, function (x) { return x.tagName === 'BUTTON'; });
    var groups = MENU_GROUPS.map(function () { return []; });
    btns.forEach(function (x) { groups[menuGroupOf(x)].push(x); });
    groups.forEach(function (list, g) {
      if (!list.length) return;
      var box = doc.createElement('div');
      box.className = 'lcm-group' + (MENU_GROUPS[g].cls ? ' ' + MENU_GROUPS[g].cls : '');
      box.setAttribute('role', 'group');
      box.setAttribute('aria-label', MENU_GROUPS[g].name);
      var t = doc.createElement('div'); t.className = 'lcm-gt'; t.textContent = MENU_GROUPS[g].name;
      box.appendChild(t);
      list.forEach(function (x) { box.appendChild(x); });    // moved — handlers stay
      m.appendChild(box);
    });
    m.classList.add('lcMenu');
    m.setAttribute('role', 'menu');
    b.setAttribute('aria-haspopup', 'true');
    b.setAttribute('aria-controls', 'moreTools');
    // The list no longer re-opens by itself on the next page load.
    try { global.localStorage.setItem('labcal.ui.moreTools', '0'); } catch (e) {}
    if (b.textContent !== 'More…') b.textContent = 'More…';
    setMenu(false);
    // The pages' onclick="toggleMoreTools()" now opens / closes the list.
    global.toggleMoreTools = function () { setMenu(!menuOpen()); };
    // choosing an item, tapping elsewhere or Escape closes it
    m.addEventListener('click', function (e) {
      if (e.target && e.target.closest && e.target.closest('button')) global.setTimeout(function () { setMenu(false); }, 0);
    });
    doc.addEventListener('click', function (e) {
      if (!menuOpen()) return;
      var t = e.target;
      if (t && (m.contains(t) || b.contains(t))) return;
      setMenu(false);
    }, true);
    doc.addEventListener('keydown', function (e) { if (e.key === 'Escape' && menuOpen()) setMenu(false); });
    global.addEventListener('resize', function () { if (menuOpen()) placeMenu(); });
    global.addEventListener('scroll', function () { if (menuOpen()) placeMenu(); }, { passive: true });
  }

  function install() {
    var own = !!(opts && opts.bar);
    var bar = doc.querySelector(own ? opts.bar : '.toolbar');
    if (!bar || doc.getElementById('navBackBtn')) return;
    var st = doc.createElement('style');
    st.id = 'labcal-nav-css';
    st.textContent = own ? CSS_OWN_BAR : CSS;
    (doc.head || doc.body).appendChild(st);
    try { if (global.LabCalTestMode && global.LabCalTestMode.active) doc.body.classList.add('lcNavTest'); } catch (e) {}
    var first = bar.firstElementChild;
    bar.insertBefore(button('navBackBtn', '<span aria-hidden="true">←</span><span class="lcNavTxt">Back</span>', 'Back', back), first);
    bar.insertBefore(button('navHomeBtn', HOUSE + '<span class="lcNavTxt">Home</span>', 'LabCal home', home), first);
    // "← Job list" when Back will go to this unit's job list
    var setBackLabel = function () {
      var b = doc.getElementById('navBackBtn'); if (!b) return;
      var toJob = !!jobTarget();
      var txt = toJob ? 'Job list' : 'Back';
      var span = b.querySelector('.lcNavTxt'); if (span && span.textContent !== txt) span.textContent = txt;
      b.setAttribute('aria-label', toJob ? 'Back to the job list' : 'Back');
      b.title = b.getAttribute('aria-label');
    };
    setBackLabel();
    global.setTimeout(setBackLabel, 600);
    doc.addEventListener('change', function (e) { if (e.target && (e.target.id === 'jobRef' || e.target.id === 'serial')) setBackLabel(); }, true);
    if (!own) { installJobLine(bar); installHistLine(bar); installMoreMenu(); installNext(); }
    watchLabel(doc.getElementById('syncJobBtn'), 'Save');
    watchLabel(doc.getElementById('generateBtn'), 'PDF');
    // Only readings the ENGINEER typed count as work to protect — not values the
    // page fills in itself (restored unit, offsets, dates), which fire no user events.
    var typed = function (e) {
      var t = e.target;
      if (!e.isTrusted || !t || !t.matches || !t.matches('input,select,textarea') || t.type === 'file') return;
      if (bar.contains(t)) return;
      userTyped = true;
    };
    doc.addEventListener('input', typed, true);
    doc.addEventListener('change', typed, true);
  }

  function init(o) {
    opts = o || {};
    if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', install);
    else install();
  }

  global.LabCalNav = {
    init: init,
    back: back,
    home: home,
    okToLeave: okToLeave,
    _cameFromLabCal: cameFromLabCal,
    _jobTarget: jobTarget,
    _jobLine: jobLineInfo,
    _renderJobLine: renderJobLine,
    _renderHistLine: renderHistLine,
    showHistory: showHistory,
    showNext: showNext,
    _remaining: remainingUnits,
    _typed: function () { return userTyped; },
    markTyped: function () { userTyped = true; },   // v1.593: the time picker's taps count as the engineer's work
    _pushToJobList: pushToJobList
  };
})(typeof window !== 'undefined' ? window : this);

/* v1.575 — number entry on the worksheets (Radek: "check number entry on
 * every form"). Loaded on all 7 worksheets before their own scripts, so it
 * runs FIRST on every keystroke (capture phase) and the worksheet's own
 * checks and calculations only ever see a clean number:
 *   • "," typed as the decimal mark becomes "."   (4,5  → 4.5)
 *   • minus signs pasted from elsewhere (−, –, —) become "-"
 *   • spaces inside a number are removed           (- 5.0 → -5.0)
 * Number fields also get: no autocorrect / autocapitalise / spell check /
 * suggestion bar on the iPad keyboard, a numeric keyboard where one was
 * missing (SNMD Load/Chart when enabled), and Return = go to the next field.
 * Values themselves are never rounded, padded or otherwise changed.
 */
(function (global) {
  'use strict';
  var doc = global.document;
  if (!doc) return;

  function isNumberField(el) {
    if (!el || el.tagName !== 'INPUT') return false;
    var t = String(el.type || 'text').toLowerCase();
    if (t !== 'text' && t !== 'number' && t !== 'tel') return false;
    var im = el.getAttribute('inputmode');
    return im === 'decimal' || im === 'numeric' || el.hasAttribute('data-decimals');
  }

  function prepare(el) {
    if (!isNumberField(el) || el.__lcNum) return;
    el.__lcNum = true;
    if (!el.getAttribute('inputmode')) el.setAttribute('inputmode', 'decimal');
    el.setAttribute('autocomplete', 'off');
    el.setAttribute('autocorrect', 'off');
    el.setAttribute('autocapitalize', 'off');
    el.setAttribute('spellcheck', 'false');
    if (!el.getAttribute('enterkeyhint')) el.setAttribute('enterkeyhint', 'next');
  }
  function prepareAll() {
    Array.prototype.forEach.call(doc.querySelectorAll('input'), prepare);
  }

  // Only characters that can only mean one thing are changed. Certificate
  // numbers ("S 12345", inputmode numeric) keep their space.
  function clean(v, keepSpaces) {
    var s = String(v);
    s = s.replace(/[−‒–—﹣－]/g, '-');
    s = s.replace(/,/g, '.');
    if (!keepSpaces) s = s.replace(/\s+/g, '');
    return s;
  }

  // v1.576 (Radek, iPad): the worksheets jump to the next field as soon as a
  // number is "complete" (autoAdvance). That went wrong in two ways:
  //  • whole-degree fields (No Decimal Point: xx) counted "-3" as complete, so
  //    "-35" could never be typed — it jumped after the first digit;
  //  • deleting a digit to correct a number could leave a "complete" number
  //    ("15.0" → "1.0") and jump away mid-correction.
  // mayAdvance() is asked by every worksheet's autoAdvance first: never for
  // whole numbers (Return / tapping the next field moves on), only after a
  // digit was TYPED (not deleted) and only with the cursor at the end.
  var last = null;   // { el, insert, atEnd } for the latest keystroke
  function mayAdvance(el, decimals) {
    if (Number(decimals) === 0) return false;
    if (!last || last.el !== el) return true;       // not from a keystroke we saw
    return last.insert && last.atEnd;
  }
  doc.addEventListener('input', function (e) {
    var el = e.target;
    if (isNumberField(el)) {
      var it = e.inputType;   // undefined for script-made events → treat as typing
      last = { el: el, insert: !it || /^insert/.test(it), atEnd: true };
    }
    if (!isNumberField(el) || el.readOnly) { markEnd(el); return; }
    var keepSpaces = el.getAttribute('inputmode') === 'numeric' && !el.hasAttribute('data-decimals');
    var before = el.value, after = clean(before, keepSpaces);
    if (after === before) { markEnd(el); return; }
    var pos = null;
    try { pos = el.selectionStart; } catch (x) {}
    el.value = after;
    if (pos !== null) {
      var shift = before.slice(0, pos).length - clean(before.slice(0, pos), keepSpaces).length;
      try { el.setSelectionRange(pos - shift, pos - shift); } catch (x) {}
    }
    markEnd(el);
  }, true);
  function markEnd(el) {
    if (!last || last.el !== el) return;
    try {
      if (typeof el.selectionStart === 'number' && el.selectionStart !== null)
        last.atEnd = el.selectionStart === String(el.value).length;
    } catch (x) {}
  }

  doc.addEventListener('focusin', function (e) { prepare(e.target); }, true);

  // Return on the iPad keyboard = next field (like Tab), for number fields.
  doc.addEventListener('keydown', function (e) {
    if (e.key !== 'Enter' || e.isComposing) return;
    var el = e.target;
    if (!isNumberField(el)) return;
    e.preventDefault();
    var list = Array.prototype.filter.call(doc.querySelectorAll('input, select, textarea'), function (x) {
      return !x.disabled && !x.readOnly && x.type !== 'hidden' && x.offsetParent !== null;
    });
    var i = list.indexOf(el);
    if (i > -1 && list[i + 1]) list[i + 1].focus();
    else el.blur();
  }, true);

  if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', prepareAll);
  else prepareAll();
  global.addEventListener('load', prepareAll);
  global.LabCalNumbers = { clean: clean, isNumberField: isNumberField, prepareAll: prepareAll, mayAdvance: mayAdvance };
})(typeof window !== 'undefined' ? window : this);

/* v1.576 — "what is still missing" list on the worksheets (Radek: item 7).
 * When Generate PDF finds empty required fields or numbers in the wrong
 * format, instead of one alert and a jump to the FIRST field only, a panel
 * under the toolbar lists every one of them by name (section · row · column).
 * Tap a name = the worksheet scrolls to that field and puts the cursor in it.
 * Each name turns green with a tick as soon as the field is filled in
 * correctly; when all are done the panel says so. Nothing is filled in or
 * changed by the list — it only points. The checks themselves (which fields
 * are required, how many decimals) are the worksheet's own, unchanged.
 *
 *   LabCalMissing.show(emptyEls)  → true when the panel is shown; emptyEls are
 *                                   elements or {el, label, na} (na: "NA" counts as empty)
 *   LabCalMissing.labelFor(el)    → the name used in the list
 */
(function (global) {
  'use strict';
  var doc = global.document;
  if (!doc) return;

  function clean(t) {
    return String(t || '').replace(/\*/g, '').replace(/\(from product\)/i, '').replace(/[:\s]+$/g, '').replace(/\s+/g, ' ').trim();
  }
  // text in a cell that comes BEFORE the field (e.g. "Max *: <input>")
  function textBefore(el, cell) {
    var out = '';
    var walker = doc.createTreeWalker(cell, 4 /* text */, null);
    var n;
    while ((n = walker.nextNode())) {
      if (el.compareDocumentPosition(n) & 2 /* preceding */) {
        var p = n.parentNode;
        if (p && p.closest && (p.closest('select') || p.closest('option') || p.closest('button') || p.closest('.hintText'))) continue;
        out += ' ' + n.nodeValue;
      }
    }
    // keep only the words right before the field (after the previous field)
    var parts = out.split(/\s{2,}|:\s*(?=\S)/);
    return clean(parts[parts.length - 1] || out);
  }
  function cellIndex(cell) {
    var i = 0, c = cell.parentNode.firstElementChild;
    while (c && c !== cell) { i += c.colSpan || 1; c = c.nextElementSibling; }
    return i;
  }
  function cellAt(row, idx) {
    var i = 0, c = row.firstElementChild;
    while (c) { var span = c.colSpan || 1; if (idx >= i && idx < i + span) return c; i += span; c = c.nextElementSibling; }
    return null;
  }
  // Names for the fields every worksheet shares (same ids on all sheets).
  var FIXED = {
    certNo: 'Certificate No', sheetNo: 'Certificate No', worksheetNo: 'Worksheet No', jobRef: 'Job Ref',
    dateNative: 'Date', date: 'Date', site: 'Site', department: 'Department', dept: 'Department',
    manufacturer: 'Manufacturer', manufacturerOther: 'Manufacturer (other)', deviceType: 'Device type',
    model: 'Model', serial: 'Serial No', load: 'Load', calSystem: 'Calibration system',
    loadMode: 'Load column (select)', chartMode: 'Chart Recorder column (select)', displayMode: 'Display (select)',
    drtSerial: 'Reference thermometer', refTherm: 'Reference thermometer', rtRef: 'Room temp. thermometer',
    rtMax: 'Room temp. Max', rtMin: 'Room temp. Min',
    initialOffsets: 'Initial offsets', finalOffsets: 'Final offsets',
    initialSetpoint: 'Initial set point', finalSetpoint: 'Final set point',
    engineer: 'Engineer', checkedBy: 'Checked by'
  };
  var COL = { air1: 'Air Left', air2: 'Air Right', air: 'Air', load: 'Load', load1: 'Load Left', load2: 'Load Right',
    chart: 'Chart Recorder', chartair: 'Chart Air', chartload: 'Chart Load' };
  var ROW = { probe: 'Probe Serial No', max: 'Reference Max', min: 'Reference Min', display: 'Display' };
  var TIME = { probes_in: 'Probes loaded / adjusted at', cycle_start: 'Cycle start', cycle_end: 'Cycle end' };
  function fixedName(id) {
    if (!id) return '';
    if (FIXED[id]) return FIXED[id];
    var m, ph = function (x) { return x === 'af' ? 'As Found' : 'As Left'; };
    if ((m = id.match(/^(initial|final)OffsetsCal([1-4])$/))) {
      var ibb = !!doc.getElementById(m[1] + 'OffsetsCal3');
      var names = ibb ? { 1: 'Air', 2: 'Load', 3: 'Chart Air', 4: 'Chart Load' } : { 1: 'Air', 2: 'Load', 3: 'Cal 3', 4: 'Cal 4' };
      return (m[1] === 'initial' ? 'Initial' : 'Final') + ' offsets \u00b7 ' + names[m[2]];
    }
    if ((m = id.match(/^(af|al)_cycle_([a-z0-9]+)_(max|min)$/)) && COL[m[2]])
      return ph(m[1]) + ' \u00b7 Display cycle \u00b7 ' + COL[m[2]] + ' ' + (m[3] === 'max' ? 'Max' : 'Min');
    if ((m = id.match(/^(af|al)_(probes_in|cycle_start|cycle_end)_(h|m)$/)))
      return ph(m[1]) + ' \u00b7 ' + TIME[m[2]] + ' (' + (m[3] === 'h' ? 'hour' : 'minute') + ')';
    if ((m = id.match(/^(af|al)_([a-z0-9]+)_(probe|max|min|display)$/)) && COL[m[2]])
      return ph(m[1]) + ' \u00b7 ' + ROW[m[3]] + ' \u00b7 ' + COL[m[2]];
    return '';
  }
  function labelFor(el) {
    if (!el) return '';
    if (el.dataset && el.dataset.label) return el.dataset.label;
    var f = fixedName(el.id);
    if (f) return f;
    // Barkey rows: <div class="row"><div class="lbl">Name</div>… (found_ / left_)
    var rw = el.closest && el.closest('.row');
    var rl = rw && rw.querySelector('.lbl');
    if (rl) {
      var pm = String(el.id || '').match(/^(found|left)_/);
      return (pm ? (pm[1] === 'found' ? 'As Found \u00b7 ' : 'As Left \u00b7 ') : '') + clean(textOnly(rl));
    }
    // Barkey / Cloud Temp style: <div class="field"><label>Name</label>…
    var fld = el.closest && el.closest('.field');
    var fl = fld && fld.querySelector('label');
    if (fl) {
      var unit = /(Min|Sec)$/.exec(el.id || '');
      return clean(fl.textContent) + (unit ? ' (' + unit[1].toLowerCase() + ')' : '');
    }
    var lab = el.id && doc.querySelector('label[for="' + el.id + '"]');
    if (lab) return clean(lab.textContent);
    // table: section · row name · column name
    var parts = [];
    var cell = el.closest && el.closest('td,th');
    var row = cell && cell.parentNode;
    if (row && row.tagName === 'TR') {
      var idx = cellIndex(cell);
      var r = row.previousElementSibling, header = null;
      while (r) { if (r.querySelector('th')) { header = r; break; } r = r.previousElementSibling; }
      var sec = header && (header.querySelector('th.section') || null);
      if (sec) parts.push(clean(textOnly(sec)));
      var first = row.firstElementChild;
      if (first && first !== cell) { var rt = clean(textOnly(first)); if (rt && rt.length <= 60) parts.push(rt); }
      if (header && idx > 0) { var hc = cellAt(header, idx); var ht = clean(hc && textOnly(hc)); if (ht) parts.push(ht); }
      var before = textBefore(el, cell);
      if (before && before.length <= 50) parts.push(before);
    }
    if (!parts.length) parts.push(el.getAttribute('aria-label') || el.getAttribute('placeholder') || el.id || 'field');
    return parts.filter(function (p, i) { return p && parts.indexOf(p) === i; }).join(' \u00b7 ');
  }
  // an element's own words, without dropdown options / hints inside it
  function textOnly(node) {
    var c = node.cloneNode(true);
    Array.prototype.forEach.call(c.querySelectorAll('select,option,input,button,.hintText,.small,.muted'), function (x) { x.remove(); });
    return c.textContent;
  }

  function visible(el) { return !el.disabled && el.offsetParent !== null; }
  function formatOK(el) {
    try { if (typeof global.decimalOK === 'function') return global.decimalOK(el); } catch (e) {}
    return true;
  }
  function formatProblems() {
    return Array.prototype.filter.call(doc.querySelectorAll('[data-decimals]'), function (el) {
      return visible(el) && String(el.value || '').trim() !== '' && !formatOK(el);
    });
  }

  var panel = null, items = [];
  function done(it) {
    var v = String(it.el.value || '').trim();
    if (it.na && v.toUpperCase() === 'NA') return false;
    if (it.kind === 'empty') return v !== '' && (!it.el.dataset.decimals || formatOK(it.el));
    return v !== '' && formatOK(it.el);
  }
  function refresh() {
    if (!panel) return;
    var left = 0;
    items.forEach(function (it) {
      var ok = done(it);
      it.btn.classList.toggle('ok', ok);
      it.btn.setAttribute('aria-label', it.label + (ok ? ' — done' : ''));
      if (!ok) left++;
    });
    var h = panel.querySelector('.lcm-head');
    panel.classList.toggle('alldone', left === 0);
    h.textContent = left === 0
      ? 'All listed fields are filled in — tap Generate PDF again.'
      : left + ' field' + (left === 1 ? '' : 's') + ' to complete before the certificate can be made. Tap a name to go to it.';
  }
  // While the list is open the page gets extra room at the top, so a field
  // at the very top of the worksheet can still be scrolled clear of the list.
  var spacer = null;
  function makeRoom() {
    if (!panel) return;
    var bar = doc.querySelector('.toolbar');
    if (!spacer) {
      spacer = doc.createElement('div');
      spacer.id = 'lcMissingSpace';
      spacer.setAttribute('aria-hidden', 'true');
      if (bar && bar.parentNode) bar.parentNode.insertBefore(spacer, bar.nextSibling);
      else doc.body.insertBefore(spacer, doc.body.firstChild);
    }
    spacer.style.height = Math.ceil(panel.getBoundingClientRect().height + 12) + 'px';
  }
  function close() {
    if (panel) panel.remove();
    panel = null; items = [];
    if (spacer) { spacer.remove(); spacer = null; }
  }
  function go(el) {
    // put the field just below the list (the list stays where it is)
    try {
      var pb = panel ? panel.getBoundingClientRect().bottom : 0;
      var r = el.getBoundingClientRect();
      var y = (global.pageYOffset || 0) + r.top - pb - 70;
      global.scrollTo({ top: Math.max(0, y), behavior: 'smooth' });
    } catch (e) { try { el.scrollIntoView(); } catch (e2) {} }
    try { el.focus({ preventScroll: true }); } catch (e) { try { el.focus(); } catch (e2) {} }
    el.classList.add('lcm-flash');
    global.setTimeout(function () { el.classList.remove('lcm-flash'); }, 1600);
  }
  function css() {
    if (doc.getElementById('lcmStyle')) return;
    var s = doc.createElement('style');
    s.id = 'lcmStyle';
    s.textContent =
      '#lcMissing{position:fixed;left:12px;right:12px;z-index:45;max-width:980px;margin:0 auto;background:#fff8e6;border:2px solid #d9a21b;' +
      'border-radius:10px;box-shadow:0 6px 18px rgba(0,0,0,.25);font:14px/1.4 -apple-system,system-ui,sans-serif;color:#3b2a00;padding:10px 12px}' +
      '#lcMissing.alldone{background:#e9f7ef;border-color:#2e8b57;color:#174d2f}' +
      '#lcMissing .lcm-top{display:flex;gap:10px;align-items:center}' +
      '#lcMissing .lcm-head{flex:1 1 auto;font-weight:600}' +
      '#lcMissing .lcm-close{min-width:72px;min-height:44px;border:0;border-radius:8px;background:#5a3d00;color:#fff;font:600 14px -apple-system,system-ui,sans-serif}' +
      '#lcMissing.alldone .lcm-close{background:#2e8b57}' +
      '#lcMissing .lcm-list{display:flex;flex-wrap:wrap;gap:6px;margin-top:8px;max-height:min(22vh,160px);overflow:auto;-webkit-overflow-scrolling:touch}' +
      '#lcMissing .lcm-item{min-height:44px;padding:4px 10px;border-radius:8px;border:1px solid #d9a21b;background:#fff;color:#3b2a00;' +
      'font:14px -apple-system,system-ui,sans-serif;text-align:left}' +
      '#lcMissing .lcm-item .why{color:#a0522d;font-size:12px;margin-left:6px}' +
      '#lcMissing .lcm-item.ok{border-color:#2e8b57;background:#e9f7ef;color:#174d2f;text-decoration:line-through}' +
      '#lcMissing .lcm-item.ok::before{content:"\\2713  ";text-decoration:none}' +
      '.lcm-flash{outline:3px solid #d9a21b !important;outline-offset:2px}' +
      '@media print{#lcMissing,#lcMissingSpace{display:none}}';
    doc.head.appendChild(s);
  }
  function place() {
    if (!panel) return;
    var bar = doc.querySelector('.toolbar');
    var top = 8;
    if (bar) { var r = bar.getBoundingClientRect(); if (r.bottom > 0) top = Math.round(r.bottom) + 6; }
    panel.style.top = top + 'px';
  }

  function show(emptyEls) {
    try {
      var list = [];
      var seen = [];
      (emptyEls || []).forEach(function (x) {
        var el = x && x.nodeType === 1 ? x : x && x.el;
        if (el && seen.indexOf(el) === -1) { seen.push(el); list.push({ el: el, kind: 'empty', label: x.label || '', na: !!x.na }); }
      });
      formatProblems().forEach(function (el) { if (seen.indexOf(el) === -1) { seen.push(el); list.push({ el: el, kind: 'format' }); } });
      if (!list.length) return false;
      // page order
      list.sort(function (a, b) { return a.el.compareDocumentPosition(b.el) & 4 ? -1 : 1; });
      close();
      css();
      panel = doc.createElement('div');
      panel.id = 'lcMissing';
      panel.setAttribute('role', 'alert');
      var top = doc.createElement('div'); top.className = 'lcm-top';
      var head = doc.createElement('div'); head.className = 'lcm-head';
      var x = doc.createElement('button'); x.type = 'button'; x.className = 'lcm-close'; x.textContent = 'Close';
      x.addEventListener('click', close);
      top.appendChild(head); top.appendChild(x);
      var box = doc.createElement('div'); box.className = 'lcm-list';
      items = list.map(function (it) {
        it.label = it.label || labelFor(it.el);
        var b = doc.createElement('button');
        b.type = 'button'; b.className = 'lcm-item';
        b.appendChild(doc.createTextNode(it.label));
        if (it.kind === 'format') {
          var w = doc.createElement('span'); w.className = 'why';
          var ph = it.el.getAttribute('placeholder');
          w.textContent = ph ? '(format ' + ph + ')' : '(wrong format)';
          b.appendChild(w);
        }
        b.addEventListener('click', function () { go(it.el); });
        box.appendChild(b);
        it.btn = b;
        return it;
      });
      panel.appendChild(top); panel.appendChild(box);
      doc.body.appendChild(panel);
      place();
      refresh();
      makeRoom();
      try { if (global.LabCalLog) global.LabCalLog.add('warn', 'Generate PDF: ' + list.length + ' field(s) missing / wrong format'); } catch (e) {}
      go(list[0].el);
      return true;
    } catch (e) {
      try { console.warn('Missing-fields list could not be shown:', e); } catch (e2) {}
      return false;
    }
  }

  // Generate PDF tapped again: the list goes; if something is still missing
  // the worksheet's own check opens it again straight away.
  doc.addEventListener('click', function (e) {
    var t = e.target && e.target.closest && e.target.closest('#generateBtn');
    if (t && panel) close();
  }, true);
  doc.addEventListener('input', function () { if (panel) global.setTimeout(refresh, 0); }, true);
  doc.addEventListener('change', function () { if (panel) global.setTimeout(refresh, 0); }, true);
  global.addEventListener('scroll', function () { if (panel) place(); }, { passive: true });
  global.addEventListener('resize', function () { if (panel) place(); });

  global.LabCalMissing = { show: show, close: close, labelFor: labelFor, isOpen: function () { return !!panel; } };
})(typeof window !== 'undefined' ? window : this);

/* v1.583 — checker's fields locked (Radek, 27 Sep 2026).
 * The checker's Name, Signature and Date belong to the person who checks the
 * certificate afterwards — on paper or on the PDF — never to the engineer
 * filling the worksheet in. On every worksheet (SMD, SNMD, NSMD, 19/24, IBB,
 * Barkey, Cloud Temp) these fields are now greyed out, cannot be tapped, and
 * always read as EMPTY, so nothing can reach the screen, the PDF, the Excel
 * file or a saved/restored unit — even a value typed by an older version,
 * restored from a backup, or imported from an Excel file.
 * The lock is on the field's value itself: whatever any page code writes,
 * the field stays blank. The engineer's own fields are untouched. */
(function (global) {
  'use strict';
  var doc = global.document;
  var FIELDS = ['checker', 'checkDate', 'checkedBy'];          // inputs
  var SIGS = ['checkerSignature', 'checkSignature'];          // signature boxes
  var HINT = 'Checker — signs the printed / PDF copy';
  var valueDesc = Object.getOwnPropertyDescriptor(global.HTMLInputElement.prototype, 'value');

  function lockOne(el) {
    if (!el || el.__lcCheckerLocked) return;
    el.__lcCheckerLocked = true;
    try { valueDesc.set.call(el, ''); } catch (e) {}
    if (el.type === 'date') { try { el.type = 'text'; } catch (e) {} }   // no date picker, shows the hint
    try {
      Object.defineProperty(el, 'value', {
        configurable: true,
        get: function () { return ''; },
        set: function () { try { valueDesc.set.call(el, ''); } catch (e) {} }
      });
    } catch (e) {}
    el.disabled = true;
    el.readOnly = true;
    el.tabIndex = -1;
    el.placeholder = el.id === 'checkDate' ? '' : HINT;
    el.title = 'Left blank for the checker to sign by hand';
    el.classList.add('lcCheckerLocked');
    el.setAttribute('aria-disabled', 'true');
  }
  function clearSigs() {
    SIGS.forEach(function (id) {
      var s = doc.getElementById(id);
      if (s && s.textContent) s.textContent = '';
      if (s) s.classList.add('lcCheckerLocked');
    });
  }
  function lockAll() {
    FIELDS.forEach(function (id) { lockOne(doc.getElementById(id)); });
    clearSigs();
    if (!doc.getElementById('lc-checker-css')) {
      var st = doc.createElement('style');
      st.id = 'lc-checker-css';
      st.textContent = 'input.lcCheckerLocked{background:#eceff2!important;color:#888!important;cursor:not-allowed;font-style:italic;font-size:10.5px}'
        + '.signature.lcCheckerLocked{background:#eceff2!important}';
      (doc.head || doc.body).appendChild(st);
    }
  }
  if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', lockAll);
  else lockAll();
  global.addEventListener('load', function () { lockAll(); clearSigs(); });
  global.addEventListener('pageshow', clearSigs);
  global.LabCalChecker = { lockAll: lockAll, FIELDS: FIELDS };
})(typeof window !== 'undefined' ? window : this);

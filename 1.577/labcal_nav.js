(window.LabCalBuild = window.LabCalBuild || {})['labcal_nav.js'] = 'v1.577';  // file version — see labcal_build.js
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

  // true = fine to leave. Saves first; asks only when typed readings would be lost.
  function okToLeave() {
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

  function back() {
    if (!okToLeave()) return;
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
    '@media print{.toolbar{position:static}}';

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
    _typed: function () { return userTyped; }
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

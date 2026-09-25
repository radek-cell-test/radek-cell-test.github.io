/* ---------------------------------------------------------------------
   LabCal — per-unit worksheet snapshots
   ---------------------------------------------------------------------
   The worksheets have always autosaved, but into a single slot per
   worksheet: start the next unit and the previous one's readings are gone.
   This keeps a snapshot per UNIT (worksheet + job reference + serial), so a
   unit can be reopened later with everything still in it and amended.

   Storage: localStorage, one key per unit —
            labcal.unit.<sheet>.<jobRef>.<serial>
   Pruned automatically after KEEP_DAYS.

   Same caveat as everywhere else: browser storage is a working buffer, not
   an archive. The certificate PDF is the record.
   --------------------------------------------------------------------- */
(function (global) {
  'use strict';

  var PREFIX = 'labcal.unit.';
  var KEEP_DAYS = 30;
  var CHANGE_EVENT = 'labcal-units-changed';

  function todayIso() {
    var d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }

  function clean(v) {
    return String(v || '').trim().toUpperCase().replace(/[^A-Z0-9_-]/g, '');
  }

  // A unit is identified by worksheet + job + serial. Serial alone is not
  // enough: the same fridge can be calibrated on two different visits, and
  // those must not overwrite each other.
  function keyFor(sheet, jobRef, serial) {
    var s = clean(serial);
    if (!s) return '';
    return PREFIX + clean(sheet) + '.' + (clean(jobRef) || 'NOJOB') + '.' + s;
  }

  function store() {
    try { return global.localStorage; } catch (e) { return null; }
  }

  function save(sheet, jobRef, serial, state, meta) {
    var key = keyFor(sheet, jobRef, serial);
    var s = store();
    if (!key || !s) return false;
    var rec = {
      sheet: sheet, jobRef: jobRef || '', serial: serial || '',
      day: todayIso(),
      savedAt: new Date().toISOString(),
      meta: meta || {},
      state: state
    };
    try { s.setItem(key, JSON.stringify(rec)); }
    catch (e) {
      // Usually "storage full". The certificate is unaffected, but the
      // engineer must know this unit's readings are NOT being kept —
      // silently returning false hid it completely (v1.541).
      warnStorage(e);
      return false;
    }
    announce();
    return true;
  }

  function load(sheet, jobRef, serial) {
    var key = keyFor(sheet, jobRef, serial);
    var s = store();
    if (!key || !s) return null;
    try {
      var txt = s.getItem(key);
      return txt ? JSON.parse(txt) : null;
    } catch (e) { return null; }
  }

  function has(sheet, jobRef, serial) { return !!load(sheet, jobRef, serial); }

  function remove(sheet, jobRef, serial) {
    var key = keyFor(sheet, jobRef, serial);
    var s = store();
    if (!key || !s) return;
    try { s.removeItem(key); } catch (e) {}
    announce();
  }

  function list() {
    var s = store();
    if (!s) return [];
    var out = [];
    for (var i = 0; i < s.length; i++) {
      var k = s.key(i);
      if (!k || k.indexOf(PREFIX) !== 0) continue;
      try {
        var rec = JSON.parse(s.getItem(k));
        if (rec) { rec.key = k; out.push(rec); }
      } catch (e) { /* skip anything unreadable */ }
    }
    return out.sort(function (a, b) { return a.savedAt < b.savedAt ? 1 : -1; });
  }

  function prune(keepDays) {
    var keep = keepDays || KEEP_DAYS;
    var cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - keep);
    var cutIso = cutoff.getFullYear() + '-' + String(cutoff.getMonth() + 1).padStart(2, '0') + '-' + String(cutoff.getDate()).padStart(2, '0');
    var s = store();
    if (!s) return 0;
    var removed = 0;
    list().forEach(function (rec) {
      if ((rec.day || '') < cutIso) {
        try { s.removeItem(rec.key); removed++; } catch (e) {}
      }
    });
    return removed;
  }

  // ---- generic form capture -------------------------------------------
  // Every input/select/textarea carrying an id, which is how the worksheets
  // already define their own state.
  function captureForm(doc) {
    var out = {};
    var els = (doc || global.document).querySelectorAll('input,select,textarea');
    for (var i = 0; i < els.length; i++) {
      var el = els[i];
      if (!el.id) continue;
      if (el.type === 'file') continue;         // never restorable
      if (el.type === 'checkbox' || el.type === 'radio') { out[el.id] = el.checked ? '1' : ''; continue; }
      out[el.id] = el.value;
    }
    return out;
  }

  function applyForm(fields, doc) {
    if (!fields) return 0;
    var d = doc || global.document;
    var applied = 0;
    Object.keys(fields).forEach(function (id) {
      var el = d.getElementById(id);
      if (!el) return;
      if (el.type === 'file') return;
      if (el.type === 'checkbox' || el.type === 'radio') { el.checked = !!fields[id]; applied++; return; }
      el.value = fields[id];
      applied++;
    });
    return applied;
  }

  // ---- visible storage warning ----------------------------------------
  // Shared by every worksheet: shown whenever a write to browser storage
  // fails. Throttled so a full store does not flash on every keystroke.
  var WARN_ID = 'labcal-storage-warn';
  var lastWarnAt = 0;
  function warnStorage(err) {
    try { console.warn('LabCal storage write failed:', err); } catch (e) {}
    var doc = global.document;
    if (!doc || !doc.body) return;
    var now = Date.now();
    if (doc.getElementById(WARN_ID) || now - lastWarnAt < 30000) return;
    lastWarnAt = now;
    var full = err && (err.name === 'QuotaExceededError' || err.code === 22 || /quota/i.test(String(err.message || '')));
    var box = doc.createElement('div');
    box.id = WARN_ID;
    box.setAttribute('role', 'alert');
    box.style.cssText = 'position:fixed;left:12px;right:12px;top:calc(12px + env(safe-area-inset-top));z-index:100000;' +
      'background:#c0392b;color:#fff;padding:12px 14px;border-radius:8px;box-shadow:0 4px 18px rgba(0,0,0,.3);' +
      'font:600 13.5px/1.4 -apple-system,"Segoe UI",Helvetica,Arial,sans-serif;display:flex;gap:12px;align-items:flex-start';
    var txt = doc.createElement('div');
    txt.style.flex = '1';
    txt.textContent = (full
      ? 'Storage on this iPad is full \u2014 this worksheet\'s readings are NOT being saved. '
      : 'Could not save this worksheet\'s readings to the iPad. ') +
      'Generate the certificate before leaving this page, then make a backup and clear old jobs.';
    var btn = doc.createElement('button');
    btn.type = 'button';
    btn.textContent = '\u2715';
    btn.setAttribute('aria-label', 'Dismiss');
    btn.style.cssText = 'background:transparent;border:none;color:#fff;font-size:16px;padding:0 4px;cursor:pointer';
    btn.addEventListener('click', function () { if (box.parentNode) box.parentNode.removeChild(box); });
    if (!doc.getElementById(WARN_ID + '-style')) {
      var st = doc.createElement('style');
      st.id = WARN_ID + '-style';
      // never let the warning end up in a printed page or a captured PDF
      st.textContent = '@media print{#' + WARN_ID + '{display:none !important}}' +
        'body.printMode #' + WARN_ID + ',body.pdfBusy #' + WARN_ID + '{display:none !important}';
      (doc.head || doc.body).appendChild(st);
    }
    box.appendChild(txt); box.appendChild(btn);
    doc.body.appendChild(box);
  }

  function announce() {
    try { global.dispatchEvent(new CustomEvent(CHANGE_EVENT)); } catch (e) {}
  }

  global.LabCalUnits = {
    KEEP_DAYS: KEEP_DAYS,
    CHANGE_EVENT: CHANGE_EVENT,
    keyFor: keyFor,
    save: save,
    load: load,
    has: has,
    remove: remove,
    list: list,
    prune: prune,
    captureForm: captureForm,
    applyForm: applyForm,
    warnStorage: warnStorage
  };
})(typeof window !== 'undefined' ? window : this);

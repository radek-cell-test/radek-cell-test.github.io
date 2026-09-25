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

  // v1.564: never let an emptier form silently replace a unit's saved readings.
  // A worksheet that reloaded blank (or was opened afresh) and then had the
  // same job + serial typed in used to save that blank form straight over the
  // readings. The first time THIS page saves a unit that already has a saved
  // worksheet it did not load itself, and the save would blank values that
  // are there, the engineer is asked — OK loads the saved readings instead.
  var known = {};                     // units this page has loaded or saved
  function confirmOverwrite(key, s, sheet, jobRef, serial, state) {
    var prev = null;
    try { prev = JSON.parse(s.getItem(key) || 'null'); } catch (e) {}
    if (!prev || !prev.state) return true;
    var erased = Object.keys(prev.state).filter(function (id) {
      var was = String(prev.state[id] == null ? '' : prev.state[id]).trim();
      var now = String(state && state[id] != null ? state[id] : '').trim();
      return was !== '' && now === '';
    });
    if (!erased.length) return true;  // nothing saved would be lost
    known[key] = true;                // ask once per unit per page
    var canRestore = typeof global.restoreUnitSnapshot === 'function';
    var when = '';
    try { when = new Date(prev.savedAt).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }); } catch (e) {}
    var yes = global.confirm('A saved worksheet for serial ' + (serial || '') + (jobRef ? ' (job ' + jobRef + ')' : '') +
      ' was found' + (when ? ', last saved ' + when : '') + '.\n\n' +
      'This form does not have all of its readings.\n\n' +
      (canRestore ? 'OK = load the saved readings into this worksheet (recommended).\n' : 'OK = keep the saved readings (this form is not saved).\n') +
      'Cancel = keep this form and REPLACE the saved readings.');
    if (!yes) return true;            // engineer chose this form
    if (canRestore) {
      try {
        var rec = global.restoreUnitSnapshot(jobRef, serial);
        if (rec && typeof global.showRestoredBanner === 'function') global.showRestoredBanner(rec);
      } catch (e) { try { console.warn('Could not load the saved readings', e); } catch (e2) {} }
    }
    return false;                     // saved readings stay as they were
  }

  function save(sheet, jobRef, serial, state, meta) {
    var key = keyFor(sheet, jobRef, serial);
    var s = store();
    if (!key || !s) return false;
    // v1.559: only the tab that owns this unit may save its readings — a
    // second tab with the same unit open must not write over them.
    try {
      if (global.LabCalTabLock && !global.LabCalTabLock.canWrite(jobRef, serial)) return false;
    } catch (e) {}
    if (!known[key] && !confirmOverwrite(key, s, sheet, jobRef, serial, state)) return true;
    var rec = {
      sheet: sheet, jobRef: jobRef || '', serial: serial || '',
      day: todayIso(),
      savedAt: new Date().toISOString(),
      meta: meta || {},
      state: state
    };
    known[key] = true;
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
      if (txt) known[key] = true;
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

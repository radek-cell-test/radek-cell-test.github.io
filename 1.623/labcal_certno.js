(window.LabCalBuild = window.LabCalBuild || {})['labcal_certno.js'] = 'v1.623';  // file version — see labcal_build.js
/* ---------------------------------------------------------------------
   LabCal — certificate numbers given automatically (v1.612)
   ---------------------------------------------------------------------
   Radek (2 Nov 2026):
   • The engineer chooses CALIBRATION or VERIFICATION at the top of the
     worksheet. Nothing is pre-selected; Generate PDF will not run until
     one is chosen.
   • Calibration: the certificate number is given when the PDF is made —
       <engineer code><job number digits>-<3 digits>
       e.g. RZ145551-001, RZ145551-002 … for job ENQ145551.
     The engineer code comes from the probe offsets file (engineerCode,
     written by LabCal Office; default = the engineer's initials). A file
     without a code cannot make a calibration certificate.
   • The next number is the LOWEST number of this job (this engineer) not
     held by another unit, worked out from the certificates on this iPad and
     the certificate register — not from a separate counter. A deleted
     certificate (bin) gives its number back.
   • A revised certificate for the same unit keeps the unit's number.
   • Verification: no number — the certificate says "Verification".
   Used by SMD, NSMD, IBB, SNMD, 19/24 and Barkey. Cloud Temp and
   Monitoring Systems keep their own numbering.
   --------------------------------------------------------------------- */
(function (global) {
  'use strict';

  var VERIFICATION = 'Verification';
  var WAIT_MS = 8000;      // storage must answer within this, or no number is given
  var opts = null;         // { field, getOffsets, titleWords }

  // ---- pure helpers (also used by tests and the job list) ---------------
  function normCode(v) { return String(v == null ? '' : v).toUpperCase().replace(/[^A-Z0-9]/g, ''); }
  function validCode(v) { return /^[A-Z][A-Z0-9]{1,5}$/.test(normCode(v)); }
  // "R Zielski" → RZ, "Anna-Maria Nowak" → AMN (max 4 letters)
  function initialsOf(name) {
    return String(name || '').split(/[\s.\-_']+/).filter(Boolean)
      .map(function (w) { var m = w.match(/[A-Za-z]/); return m ? m[0].toUpperCase() : ''; })
      .join('').slice(0, 4);
  }
  function jobDigits(jobRef) { return String(jobRef == null ? '' : jobRef).replace(/\D/g, ''); }
  function key(v) { return String(v == null ? '' : v).toUpperCase().replace(/[^A-Z0-9]/g, ''); }
  function pad(n) { var s = String(n); while (s.length < 3) s = '0' + s; return s; }
  function prefixFor(code, jobRef) { return normCode(code) + jobDigits(jobRef); }
  function format(code, jobRef, seq) { return prefixFor(code, jobRef) + '-' + pad(seq); }
  // sequence number of `ref` when it belongs to this prefix, else 0
  function seqOf(ref, prefix) {
    var m = String(ref == null ? '' : ref).toUpperCase().replace(/\s+/g, '').match(/^([A-Z0-9]+)-(\d{3,})$/);
    return (m && m[1] === prefix) ? Number(m[2]) : 0;
  }
  function isNewFormat(ref) { return /^[A-Z][A-Z0-9]*\d-\d{3,}$/.test(String(ref == null ? '' : ref).toUpperCase().replace(/\s+/g, '')); }
  function isVerificationWord(ref) { return /^\s*verification\s*$/i.test(String(ref == null ? '' : ref)); }
  // The part of the file name for this number: RZ145551-001, Verification, S12345
  function filePart(ref, oldLetter) {
    var s = String(ref == null ? '' : ref).trim();
    if (isVerificationWord(s)) return VERIFICATION;
    if (isNewFormat(s)) return s.toUpperCase().replace(/\s+/g, '');
    var d = s.replace(/\D/g, '');
    if (d) return (oldLetter || 'S') + (d.length < 5 ? ('00000' + d).slice(-5) : d);
    return '';
  }

  // ---- which number? ------------------------------------------------------
  // ctx: { code, jobRef, serial, uid }  →  Promise<{ certRef, reused }>
  function allocate(ctx) {
    ctx = ctx || {};
    var C = global.LabCalCerts;
    var prefix = prefixFor(ctx.code, ctx.jobRef);
    if (!validCode(ctx.code)) return Promise.reject(new Error('no engineer code'));
    if (!jobDigits(ctx.jobRef)) return Promise.reject(new Error('no job number'));
    if (!C || !C.all || (C.supported && !C.supported())) return Promise.reject(new Error('certificate storage is not available'));
    var regP = C.registerAll ? Promise.resolve().then(C.registerAll).catch(function (e) {
      console.warn('Certificate register not read for numbering:', e); return [];
    }) : Promise.resolve([]);
    return Promise.all([C.all(), regP]).then(function (res) {
      var recs = res[0] || [], lines = res[1] || [];
      var jk = key(ctx.jobRef), sk = key(ctx.serial);
      function sameUnit(r) {
        if (key(r.jobRef) !== jk && jobDigits(r.jobRef) !== jobDigits(ctx.jobRef)) return false;
        if (ctx.uid && r.unitUid) return r.unitUid === ctx.uid;
        return !!sk && key(r.serial) === sk;
      }
      function regKeyOf(r) { return String(r.savedAt || '') + '|' + String(r.filename || ''); }
      var deletedKeys = {}, liveKeys = {};
      recs.forEach(function (r) { (r.deletedAt ? deletedKeys : liveKeys)[regKeyOf(r)] = true; });
      // every number still held: live certificates + register lines of
      // certificates no longer on the iPad (not deleted ones)
      var held = recs.filter(function (r) { return !r.deletedAt; }).concat(lines.filter(function (e) {
        var k = e.key || regKeyOf(e);
        return !e.deletedAt && !deletedKeys[k] && !liveKeys[k];
      }));
      var takenByOther = {};
      held.forEach(function (r) { var n = seqOf(r.certRef, prefix); if (n && !sameUnit(r)) takenByOther[n] = true; });

      // a revision keeps the unit's number (newest earlier certificate of this unit)
      var mine = recs.concat(lines).filter(function (r) {
        return sameUnit(r) && !isVerificationWord(r.certRef) && /[1-9]/.test(String(r.certRef || ''));
      }).sort(function (a, b) { return String(a.savedAt) < String(b.savedAt) ? 1 : -1; });
      for (var i = 0; i < mine.length; i++) {
        var ref = String(mine[i].certRef || '').trim();
        var n = seqOf(ref, prefix);
        if (n && !takenByOther[n]) return { certRef: format(ctx.code, ctx.jobRef, n), reused: true };
        if (!n && !isNewFormat(ref)) return { certRef: ref, reused: true };   // number from before v1.612 (S 12345)
      }
      var seq = 1;
      while (takenByOther[seq]) seq++;
      return { certRef: format(ctx.code, ctx.jobRef, seq), reused: false };
    });
  }

  // ---- the worksheet ------------------------------------------------------
  function $(id) { return global.document.getElementById(id); }
  function field() { return $(opts && opts.field || 'certNo'); }
  function modeEl() { return $('certMode'); }
  function mode() {
    var v = String((modeEl() || {}).value || '').toLowerCase();
    return v === 'calibration' || v === 'verification' ? v : '';
  }
  function engineerCode() {
    var raw = {};
    try { raw = (opts && opts.getOffsets && opts.getOffsets()) || {}; } catch (e) {}
    var c = normCode(raw.engineerCode);
    return validCode(c) ? c : '';
  }
  function fire(el) {
    try {
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    } catch (e) {}
  }

  function css() {
    if ($('lcCertModeCss')) return;
    var s = global.document.createElement('style');
    s.id = 'lcCertModeCss';
    s.textContent =
      '.lc-certmode{position:relative;display:flex;flex-wrap:wrap;align-items:center;gap:8px;margin:6px 0 10px;padding:8px 10px;' +
      'border:2px solid #0081C8;border-radius:10px;background:#EAF2F8;font:600 14px/1.3 -apple-system,system-ui,Arial,sans-serif}' +
      '.lc-certmode.lc-unset{border-color:#d08a00;background:#fff4d6}' +
      '.lc-certmode:has(.lc-cm-val.invalid){border-color:#b00000;background:#ffdede}' +
      '.lc-certmode .lc-cm-q{margin-right:4px}' +
      '.lc-certmode button{min-height:44px;min-width:150px;padding:8px 16px;border-radius:22px;border:2px solid #0081C8;background:#fff;color:#0081C8;' +
      'font:700 16px/1 -apple-system,system-ui,Arial,sans-serif;cursor:pointer;-webkit-tap-highlight-color:transparent}' +
      '.lc-certmode button.on{background:#0081C8;color:#fff}' +
      '.lc-certmode .lc-cm-val{position:absolute;left:12px;top:12px;width:1px;height:1px;opacity:0;border:0;padding:0;pointer-events:none}' +
      '.lc-certmode .lc-cm-note{flex:1 1 220px;font-weight:500;font-size:12.5px;color:#334}' +
      '.lc-certmode .lc-cm-note.bad{color:#b00000;font-weight:700}' +
      '@media print{.lc-certmode{display:none!important}}' +
      '.printMode .lc-certmode{display:none!important}';
    (global.document.head || global.document.documentElement).appendChild(s);
  }

  function refreshTitle() {
    var t = $('titleText');
    if (!t) return;
    var s = t.textContent || '';
    if (mode() === 'verification') s = s.replace(/Calibration/g, 'Verification').replace(/CALIBRATION/g, 'VERIFICATION');
    else s = s.replace(/Verification/g, 'Calibration').replace(/VERIFICATION/g, 'CALIBRATION');
    if (s !== t.textContent) t.textContent = s;
  }

  function render() {
    var box = $('certModeBox'), m = mode();
    if (box) {
      box.classList.toggle('lc-unset', !m);
      Array.prototype.forEach.call(box.querySelectorAll('button[data-mode]'), function (b) {
        var on = b.getAttribute('data-mode') === m;
        b.classList.toggle('on', on);
        b.setAttribute('aria-pressed', on ? 'true' : 'false');
      });
      var note = $('certModeNote');
      if (note) {
        var code = engineerCode(), bad = false, text;
        if (!m) text = 'Choose one before you start. Calibration gets a certificate number when the PDF is made; Verification has no number.';
        else if (m === 'verification') text = 'No certificate number — the certificate says "Verification".';
        else if (!code) { bad = true; text = 'Your offsets file has no engineer code, so no certificate number can be given. Ask the office for a new offsets file from LabCal Office.'; }
        else text = 'The number is given when the PDF is made: ' + code + (jobDigits(($('jobRef') || {}).value) || '<job>') + '-001, -002 …';
        note.textContent = text;
        note.classList.toggle('bad', bad);
      }
      var mv = modeEl(); if (mv && m) mv.classList.remove('invalid');
    }
    var f = field();
    if (f) f.placeholder = m === 'calibration' ? 'given at PDF' : (m ? '' : '');
    refreshTitle();
  }

  function setMode(m) {
    var el = modeEl(); if (!el) return;
    el.value = m;
    var f = field();
    if (f) {
      if (m === 'verification') f.value = VERIFICATION;
      else if (isVerificationWord(f.value)) f.value = '';
      fire(f);
    }
    fire(el);
    render();
  }

  // Any write to #certMode (restore, autosave, Start new) redraws the toggle.
  function watch(el) {
    try {
      var d = Object.getOwnPropertyDescriptor(global.HTMLInputElement.prototype, 'value');
      Object.defineProperty(el, 'value', {
        configurable: true,
        get: function () { return d.get.call(this); },
        set: function (v) { d.set.call(this, v); global.setTimeout(render, 0); }
      });
    } catch (e) { global.setInterval(render, 800); }
  }

  // opts: { field: 'certNo' | 'sheetNo', getOffsets: () => offsets JSON }
  function bind(o) {
    opts = o || {};
    css();
    var el = modeEl();
    if (el) {
      el.readOnly = true;
      watch(el);
    }
    var box = $('certModeBox');
    if (box) {
      Array.prototype.forEach.call(box.querySelectorAll('button[data-mode]'), function (b) {
        b.addEventListener('click', function () { setMode(b.getAttribute('data-mode')); });
      });
    }
    var f = field();
    if (f) {
      f.readOnly = true;
      f.setAttribute('tabindex', '-1');
      f.title = 'Given automatically when the PDF is made';
      // a half-typed number from before v1.612 ("S ", "B 12") is cleared
      if (/^[SB]\s*\d{0,4}$/i.test(String(f.value || '').trim())) f.value = '';
    }
    var jr = $('jobRef');
    if (jr) jr.addEventListener('input', function () { global.setTimeout(render, 0); });
    try { if (global.LabCalOffsets && global.LabCalOffsets.onChange) global.LabCalOffsets.onChange(render); } catch (e) {}
    render();
    global.setTimeout(render, 300);
  }

  // Generate PDF, after the identity / revision check: put the number in.
  // Returns Promise<boolean> — false = stop, nothing is made.
  function assign(ctx) {
    ctx = ctx || {};
    var f = field(), m = mode();
    if (!f) return Promise.resolve(true);
    if (!m) {
      global.alert('Choose CALIBRATION or VERIFICATION at the top of the worksheet first.\n\nNo certificate was made.');
      try { modeEl().classList.add('invalid'); $('certModeBox').scrollIntoView({ block: 'center' }); } catch (e) {}
      return Promise.resolve(false);
    }
    if (m === 'verification') {
      f.value = VERIFICATION; fire(f);
      try { if (global.LabCalGuard && global.LabCalGuard.setCertRef) global.LabCalGuard.setCertRef(VERIFICATION); } catch (e) {}
      return Promise.resolve(true);
    }
    var code = engineerCode();
    if (!code) {
      global.alert('No engineer code in your offsets file, so no certificate number can be given.\n\n' +
        'Ask the office for a new offsets file made in LabCal Office (it carries your engineer code, e.g. RZ), load it on the LabCal home page, then generate again.\n\nNo certificate was made.');
      return Promise.resolve(false);
    }
    var jobRef = String(($('jobRef') || {}).value || '').trim();
    if (!jobDigits(jobRef)) {
      global.alert('The Job Reference No has no number in it (e.g. ENQ145551), so no certificate number can be given.\n\nNo certificate was made.');
      try { $('jobRef').focus(); } catch (e) {}
      return Promise.resolve(false);
    }
    var serial = String(($('serial') || {}).value || '').trim();
    var timer;
    var wait = new Promise(function (res, rej) { timer = global.setTimeout(function () { rej(new Error('certificate storage did not answer')); }, (global.LabCalCertNo && global.LabCalCertNo.waitMs) || WAIT_MS); });
    var finder = (global.LabCalCertNo && global.LabCalCertNo.allocate) || allocate;
    return Promise.race([finder({ code: code, jobRef: jobRef, serial: serial, uid: ctx.uid || '' }), wait]).then(function (r) {
      global.clearTimeout(timer);
      f.value = r.certRef; fire(f);
      try { if (global.LabCalGuard && global.LabCalGuard.setCertRef) global.LabCalGuard.setCertRef(r.certRef); } catch (e) {}
      try { if (global.LabCalLog) global.LabCalLog.add('info', 'Certificate number ' + r.certRef + (r.reused ? ' (kept for this unit)' : ' (new)')); } catch (e) {}
      return true;
    }, function (e) {
      global.clearTimeout(timer);
      console.warn('Certificate number not given:', e);
      global.alert('The certificate number could not be given (' + ((e && e.message) || e) + ').\n\n' +
        'LabCal never guesses a number. Wait a moment and tap Generate PDF again; if it keeps happening, close and reopen LabCal.\n\nNo certificate was made.');
      return false;
    });
  }

  global.LabCalCertNo = {
    VERIFICATION: VERIFICATION,
    normCode: normCode,
    validCode: validCode,
    initialsOf: initialsOf,
    jobDigits: jobDigits,
    format: format,
    seqOf: seqOf,
    isNewFormat: isNewFormat,
    isVerificationWord: isVerificationWord,
    filePart: filePart,
    allocate: allocate,
    bind: bind,
    assign: assign,
    mode: mode,
    setMode: setMode,
    engineerCode: engineerCode,
    refreshTitle: refreshTitle,
    render: render
  };
})(typeof window !== 'undefined' ? window : this);

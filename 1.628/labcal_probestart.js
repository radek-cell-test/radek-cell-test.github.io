(window.LabCalBuild = window.LabCalBuild || {})['labcal_probestart.js'] = 'v1.628';  // file version — see labcal_build.js
// ============================================================================
// LabCal v1.628 (Radek, 9 Nov 2026) — "Probes & loading time" start panel.
//
// The first thing an engineer sees on a timed worksheet (SMD, NSMD, IBB, SNMD,
// 19/24) for a unit that has not started yet: big buttons to choose the probes
// and the time the probes went in. Live probes became a read-only view.
//
// Nothing here writes a field by itself. "Save and start" puts the probes and
// the time into the same queue Live probes used (labcal_livequeue.js) and asks
// LabCalTiming.takeQueue() to enter them — exactly as a hand pick: same
// change events, the worksheet's own probe rules, corrections from the
// offsets file, timing checks, autosave. No calculation is touched.
//
// Rules (Radek):
//  • a probe IN USE in another unit right now is locked (grey, "in …");
//    a probe booked later by another unit only says so (amber), as in v1.626;
//  • Air 1 = an "…A" probe, Air 2 = a "…B" probe (the worksheet's rule: one A
//    and one B); Load is not an Air probe; NSMD / IBB Load may be "None";
//  • the loading time is a fact — now or earlier, never later. If the
//    thermometer is busy when this unit's cycle would start, that is NOT
//    blocked here: the panel says the stabilisation will be longer and when
//    the cycle can start at the earliest (the Cycle start picker blocks a
//    clash — labcal_timing.js);
//  • shown only when: job + serial known, "Probes loaded at" empty, no As
//    Found probe chosen, no As Found reading typed, no certificate, nothing
//    already waiting in the queue, this tab may write the unit, not skipped
//    in this tab.
// ============================================================================
(function (global) {
  'use strict';

  var PAGES = {
    'calibration_worksheet_smd.html': 'smd', 'calibration_worksheet_nsmd.html': 'nsmd', 'calibration_worksheet_ibb.html': 'ibb',
    'calibration_worksheet_snmd.html': 'snmd', 'calibration_worksheet_19_24.html': 'ws19_24'
  };
  var FAM = { smd: 'dostmann', nsmd: 'dostmann', ibb: 'dostmann', snmd: 'fluke_comark', ws19_24: 'fluke_comark' };
  var FAM_NAME = { dostmann: 'Dostmann', fluke_comark: 'Fluke & Comark' };
  var SHEET_NAME = { smd: 'SMD', nsmd: 'NSMD', ibb: 'IBB', snmd: 'SNMD', ws19_24: '19/24' };
  var STAB = 30;
  var SKIP_PREFIX = 'labcal.ps.skip.';

  var st = null;   // the open panel: {job, serial, sheet, cols, opts, pick, min, ...}

  function $(id) { return document.getElementById(id); }
  function kp(v) { return String(v || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, ''); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function pad2(n) { return String(n).padStart(2, '0'); }
  function dm(abs) { return ((Math.round(abs) % 1440) + 1440) % 1440; }
  function hh(abs) { var m = dm(abs); return pad2(Math.floor(m / 60)) + ':' + pad2(m % 60); }
  function thisSheet() {
    try { return PAGES[String(global.location.pathname || '').split('/').pop().toLowerCase()] || ''; } catch (e) { return ''; }
  }
  function nowAbs() {
    var S = global.LabCalSchedule;
    try { if (S && S.live) return S.live().now; } catch (e) {}
    var d = new Date(); return d.getHours() * 60 + d.getMinutes();
  }
  function skipKey(job, serial) { return SKIP_PREFIX + kp(job) + '|' + kp(serial); }
  function skipped(job, serial) { try { return global.sessionStorage.getItem(skipKey(job, serial)) === '1'; } catch (e) { return false; } }
  function setSkipped(job, serial) { try { global.sessionStorage.setItem(skipKey(job, serial), '1'); } catch (e) {} }

  // the probe <select> of an As Found column, when the engineer can choose it
  function probeSel(col) {
    var el = $('af_' + col + '_probe');
    if (!el || el.tagName !== 'SELECT' || el.disabled) return null;
    if (el.closest && el.closest('.notApplicableCol')) return null;
    return el;
  }
  function optionsOf(el) {
    return Array.prototype.filter.call(el.options, function (o) { return o.value !== '' && !/N\/A/i.test(o.value); })
      .map(function (o) { return { name: o.value, label: o.textContent || o.value }; });
  }
  function group(name) { var l = String(name || '').trim().slice(-1).toUpperCase(); return l === 'A' || l === 'B' ? l : null; }

  // ---- when to show --------------------------------------------------------
  // → '' = show, else the reason it is not shown (tests read it)
  function whyNot() {
    var sheet = thisSheet(), Q = global.LabCalLiveQueue, T = global.LabCalTiming;
    if (!sheet) return 'not a timed worksheet';
    try { if (global.localStorage.getItem('labcal.ps.off') === '1') return 'turned off on this iPad'; } catch (e) {}   // tests (run.js) — older suites click the worksheet straight away
    if (!Q || !Q.PROBE_COLS || !T || !T.takeQueue) return 'queue or timing not loaded';
    var job = ($('jobRef') || {}).value || '', serial = ($('serial') || {}).value || '';
    if (!kp(job) || !kp(serial)) return 'no job or serial';
    if (skipped(job, serial)) return 'skipped in this tab';
    var h = $('af_probes_in_h'), m = $('af_probes_in_m');
    if (!h || !m || h.disabled || m.disabled) return 'Probes loaded at not open';
    if (h.value !== '' || m.value !== '') return 'Probes loaded at already entered';
    var cols = Q.PROBE_COLS[sheet] || [];
    if (cols.some(function (c) { var el = $('af_' + c + '_probe'); return el && el.value && !/N\/A/i.test(el.value); })) return 'probes already chosen';
    if (!probeSel('air1') || !probeSel('air2')) return 'probe lists not ready';
    if (optionsOf(probeSel('air1')).length < 2) return 'probe lists not ready';
    try { if (T.afReadingsEntered && T.afReadingsEntered()) return 'As Found readings entered'; } catch (e) {}
    try { if (global.LabCalUnits && global.LabCalUnits.standingOf && global.LabCalUnits.standingOf({ jobRef: job, serial: serial }).done) return 'certificate made'; } catch (e) {}
    try { if (Q.pending(job, serial).length) return 'something already waiting for this unit'; } catch (e) {}
    try { if (global.LabCalTabLock && !global.LabCalTabLock.canWrite(job, serial)) return 'another tab has this unit'; } catch (e) {}
    try { if (global.LabCalUnits && global.LabCalUnits.editingIdentity && global.LabCalUnits.editingIdentity()) return 'serial being edited'; } catch (e) {}
    if ($('tpOverlay')) return 'time picker open';
    return '';
  }

  // ---- other units: probes in use, thermometer measuring -------------------
  function probeUse(job, serial) {
    var S = global.LabCalSchedule, out = {};
    if (!S || !S.kit) return out;
    var fam = FAM[thisSheet()];
    try {
      S.kit().forEach(function (c) {
        if (c.fam !== fam) return;
        c.probes.forEach(function (p) {
          (p.who || []).forEach(function (w) {
            if (kp(w.serial) === kp(serial) && kp(w.job) === kp(job)) return;      // this unit itself
            var k = kp(p.name), cur = out[k];
            if (w.state === 'use') out[k] = { use: true, who: w.who, until: w.until };
            else if (!cur) out[k] = { use: false, who: w.who, from: w.from };
          });
        });
      });
    } catch (e) {}
    return out;
  }
  function busyList(job, serial) {
    var S = global.LabCalSchedule, fam = FAM[thisSheet()], out = [];
    if (!S || !S._others) return out;
    try {
      S._others('').forEach(function (u) {
        if (FAM[u.sheet] !== fam) return;
        if (kp(u.serial) === kp(serial) && kp(u.job) === kp(job)) return;
        var who = (SHEET_NAME[u.sheet] || u.sheet) + ' ' + u.serial;
        (u.measure || []).forEach(function (b) { out.push({ s: b.s, e: b.e, who: who }); });
        if (S.openCycles) S.openCycles(u).forEach(function (b) { out.push({ s: b.s, e: b.e, who: who, open: true }); });   // started, no end yet
      });
    } catch (e) {}
    return out.sort(function (a, b) { return a.s - b.s; });
  }
  function cycLen() {
    try { return global.LabCalTiming && global.LabCalTiming.minCycle ? global.LabCalTiming.minCycle() : 40; } catch (e) { return 40; }
  }
  // probes in at abs → { cs, ce, pushedBy }
  function windowFor(abs) {
    var cyc = cycLen(), c = abs + STAB, by = null, n = 0;
    for (;;) {
      var hit = null;
      st.busy.forEach(function (b) { if (c < b.e && b.s < c + cyc && (!hit || b.e > hit.e)) hit = b; });
      if (!hit || n++ > 100) break;
      c = hit.e; by = hit;
    }
    return { cs: c, ce: c + cyc, cyc: cyc, by: by };
  }

  // ---- the panel -------------------------------------------------------------
  function style() {
    if ($('psStyle')) return;
    var s = document.createElement('style');
    s.id = 'psStyle';
    s.textContent =
      '#psOverlay{position:fixed;inset:0;z-index:2147483000;background:#EAF2F8;overflow:auto;-webkit-overflow-scrolling:touch;font-family:-apple-system,"Segoe UI",system-ui,sans-serif;color:#10263A}' +
      '#psOverlay *{box-sizing:border-box}' +
      '.psHead{background:#0081C8;color:#fff;display:flex;align-items:center;gap:14px;padding:10px 20px;min-height:58px;flex-wrap:wrap}' +
      '.psHead b{font-size:19px;flex:1 1 auto}.psHead .psTag{font-size:14px;background:rgba(255,255,255,.18);padding:5px 12px;border-radius:999px}' +
      '.psTitle{padding:16px 24px 0;display:flex;flex-wrap:wrap;align-items:baseline;gap:6px 16px}.psTitle h2{margin:0;font-size:25px}.psTitle span{font-size:14px;color:#4A5A6A}' +
      '.psBody{display:flex;flex-wrap:wrap;gap:16px;padding:14px 24px}' +
      '.psCard{background:#fff;border-radius:18px;padding:18px 20px;box-shadow:0 1px 3px rgba(16,38,58,.08);display:flex;flex-direction:column;gap:12px;flex:1 1 420px;min-width:0}' +
      '.psStep{display:flex;align-items:center;gap:10px;font-size:20px;font-weight:700}.psStep i{font-style:normal;width:30px;height:30px;border-radius:50%;background:#0081C8;color:#fff;display:flex;align-items:center;justify-content:center;font-size:16px}' +
      '.psStep small{margin-left:auto;font-size:13px;font-weight:400;color:#4A5A6A}' +
      '.psColName{font-size:15px;font-weight:600;color:#2C3E50}.psRow{display:flex;flex-wrap:wrap;gap:10px}' +
      '.psP{min-width:82px;min-height:62px;border-radius:14px;border:1px solid #B9CCDC;background:#fff;color:#10263A;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:3px;padding:4px 8px;font:inherit;cursor:pointer;touch-action:manipulation}' +
      '.psP b{font-size:20px;line-height:1}.psP small{font-size:11px;line-height:1.1}' +
      '.psP.sel{background:#0081C8;border:2px solid #0067A3;color:#fff}' +
      '.psP.lock{background:#E6EAEE;border:1px dashed #A7B2BD;color:#56616D;cursor:not-allowed}' +
      '.psP.booked:not(.sel){border-color:#D97706}.psP.booked:not(.sel) small{color:#8A4B00}' +
      '.psTime{display:flex;align-items:center;gap:14px}.psTime output{font-size:60px;font-weight:700;color:#0067A3;font-variant-numeric:tabular-nums;min-width:170px;text-align:center}' +
      '.psSq{width:56px;height:56px;border-radius:14px;border:1px solid #B9CCDC;background:#fff;font-size:26px;color:#10263A;touch-action:manipulation}.psSq:disabled{opacity:.35}' +
      '.psQuick{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px}' +
      '.psQ{height:50px;border-radius:14px;border:1px solid #B9CCDC;background:#fff;font-size:16px;color:#10263A;touch-action:manipulation}.psQ.on{border:2px solid #0081C8;background:#E3F1FA;color:#004E7C;font-weight:600}' +
      '.psStrip{display:flex;flex-direction:column;gap:5px}.psAxis,.psLane{position:relative;margin-left:70px}.psAxis{height:16px;font-size:11px;color:#4A5A6A}' +
      '.psAxis span{position:absolute;transform:translateX(-50%)}.psLaneRow{display:flex;align-items:center}.psLaneRow>div:first-child{width:70px;font-size:12px;font-weight:600;color:#2C3E50;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}' +
      '.psLane{flex:1;height:28px;background:#F3F7FA;border-radius:8px;margin-left:0}' +
      '.psBar{position:absolute;top:3px;height:22px;border-radius:6px;font-size:11px;font-weight:600;display:flex;align-items:center;padding:0 5px;overflow:hidden;white-space:nowrap}' +
      '.psBar.busy{background:#C9D3DC;color:#2C3E50}.psBar.cyc{background:#0081C8;color:#fff}' +
      '.psBar.stab{background:repeating-linear-gradient(135deg,#D5EAF7 0 6px,#EAF4FB 6px 12px);border:1px solid #8CC3E6;color:#004E7C}' +
      '.psNow{position:absolute;top:-3px;bottom:-3px;width:2px;background:#C62828}' +
      '.psSay{border-radius:12px;padding:11px 14px;font-size:15px}.psSay.ok{background:#E7F5EC;color:#145C36}.psSay.warn{background:#FFF4E0;color:#6B3E00}.psSay.stop{background:#FDECEA;color:#7A1A12}' +
      '.psFoot{display:flex;flex-wrap:wrap;gap:12px;padding:0 24px 24px}' +
      '.psGo{flex:1 1 420px;min-height:62px;border-radius:16px;border:none;background:#0081C8;color:#fff;font-size:18px;font-weight:700;text-align:left;padding:0 22px;touch-action:manipulation}' +
      '.psGo:disabled{background:#E6EAEE;color:#56616D;border:1px dashed #A7B2BD}' +
      '.psSkip{min-height:62px;border-radius:16px;border:1px solid #B9CCDC;background:#fff;color:#10263A;font-size:16px;padding:0 20px;touch-action:manipulation}' +
      '@media (max-width:600px){.psTime output{font-size:46px;min-width:130px}.psQuick{grid-template-columns:repeat(2,minmax(0,1fr))}}';
    document.head.appendChild(s);
  }

  function open() {
    if (st || whyNot()) return false;
    var sheet = thisSheet(), Q = global.LabCalLiveQueue;
    var job = $('jobRef').value, serial = $('serial').value;
    var cols = Q.PROBE_COLS[sheet].filter(function (c) { return !!probeSel(c); });
    var opts = {};
    cols.forEach(function (c) { opts[c] = optionsOf(probeSel(c)); });
    var now = nowAbs();
    st = { job: job, serial: serial, sheet: sheet, cols: cols, opts: opts, pick: {}, now: now, abs: now, quick: 0,
           use: probeUse(job, serial), busy: busyList(job, serial), say: '' };
    style();
    var o = document.createElement('div');
    o.id = 'psOverlay';
    o.setAttribute('role', 'dialog');
    o.setAttribute('aria-modal', 'true');
    o.setAttribute('aria-label', 'Probes and loading time');
    o.addEventListener('click', onClick);
    document.body.appendChild(o);
    render();
    return true;
  }
  function close() {
    st = null;
    var o = $('psOverlay'); if (o) o.remove();
  }

  function modelText() {
    var ids = ['model', 'equipModel', 'unitModel', 'equipment'];
    for (var i = 0; i < ids.length; i++) { var e = $(ids[i]); if (e && String(e.value || '').trim()) return String(e.value).trim(); }
    return '';
  }
  function thermText() { return FAM_NAME[FAM[st.sheet]]; }

  function btn(col, p) {
    var u = st.use[kp(p.name)], other = st.cols.filter(function (c) { return c !== col && st.pick[c] === p.name; })[0];
    var sel = st.pick[col] === p.name, cls = 'psP', note = '', dis = false;
    if (sel) { cls += ' sel'; note = 'chosen'; }
    else if (u && u.use) { cls += ' lock'; note = 'in ' + u.who; dis = true; }
    else if (other) { cls += ' lock'; note = (global.LabCalLiveQueue.COL_LABELS[other] || other); dis = true; }
    else if (u) { cls += ' booked'; note = 'booked ' + (u.from || '') + ' ' + u.who; }
    return '<button type="button" class="' + cls + '" data-col="' + col + '" data-p="' + esc(p.name) + '"' + (dis ? ' disabled aria-disabled="true"' : '') +
      ' aria-pressed="' + (sel ? 'true' : 'false') + '"><b>' + esc(p.name) + '</b><small>' + esc(note) + '</small></button>';
  }
  function colRows() {
    var Q = global.LabCalLiveQueue;
    return st.cols.map(function (col) {
      var list = st.opts[col];
      if (col === 'air1') list = list.filter(function (p) { return group(p.name) === 'A'; });
      if (col === 'air2') list = list.filter(function (p) { return group(p.name) === 'B'; });
      var label = col === 'air1' ? 'Air 1 — an "A" probe' : col === 'air2' ? 'Air 2 — a "B" probe' : 'Load';
      var none = (Q.optional && Q.optional(st.sheet, col)) ?
        '<button type="button" class="psP' + (st.noneLoad ? ' sel' : '') + '" data-col="' + col + '" data-p="" aria-pressed="' + (st.noneLoad ? 'true' : 'false') + '"><b>None</b><small>No Load Fitted</small></button>' : '';
      return '<div class="psColName">' + label + '</div><div class="psRow">' + list.map(function (p) { return btn(col, p); }).join('') + none + '</div>';
    }).join('');
  }

  function strip() {
    var w = windowFor(st.abs);
    var from = Math.min(st.abs, st.now) - 60, to = Math.max(w.ce, st.now) + 30;
    st.busy.forEach(function (b) { if (b.e > from - 120 && b.s < to + 120) { if (b.s < from && b.e > from - 120) from = Math.max(b.s, from - 120); } });
    from = Math.floor(from / 30) * 30; to = Math.ceil(to / 30) * 30;
    var span = to - from;
    function pos(a, b) { var l = Math.max(a, from), r = Math.min(b, to); if (r <= l) return null; return 'left:' + ((l - from) / span * 100).toFixed(2) + '%;width:' + ((r - l) / span * 100).toFixed(2) + '%'; }
    var step = span > 300 ? 120 : 60, ticks = '';
    for (var t = Math.ceil(from / step) * step; t <= to; t += step) ticks += '<span style="left:' + ((t - from) / span * 100).toFixed(2) + '%">' + hh(t) + '</span>';
    var nowL = st.now >= from && st.now <= to ? '<div class="psNow" style="left:' + ((st.now - from) / span * 100).toFixed(2) + '%"></div>' : '';
    var lanes = {}, order = [];
    st.busy.forEach(function (b) { var p = pos(b.s, b.e); if (!p) return; if (!lanes[b.who]) { lanes[b.who] = ''; order.push(b.who); } lanes[b.who] += '<div class="psBar busy" style="' + p + '">' + hh(b.s) + '–' + hh(b.e) + '</div>'; });
    var html = '<div class="psStrip"><div class="psAxis">' + ticks + '</div>';
    order.forEach(function (who) { html += '<div class="psLaneRow"><div title="' + esc(who) + '">' + esc(who) + '</div><div class="psLane">' + lanes[who] + nowL + '</div></div>'; });
    var ps = pos(st.abs, w.cs), pc = pos(w.cs, w.ce);
    html += '<div class="psLaneRow"><div>This unit</div><div class="psLane">' +
      (ps ? '<div class="psBar stab" style="' + ps + '">stabilise</div>' : '') +
      (pc ? '<div class="psBar cyc" style="' + pc + '">As Found cycle</div>' : '') + nowL + '</div></div></div>';
    var say = w.by ?
      '<div class="psSay warn" id="psSay"><b>Thermometer busy:</b> ' + esc(w.by.who) + ' measures until ' + hh(w.by.e) + '. Longer stabilisation — As Found cycle at the earliest ' + hh(w.cs) + '–' + hh(w.ce) + '.</div>' :
      '<div class="psSay ok" id="psSay"><b>No clash.</b> Stabilise until ' + hh(w.cs) + ', As Found cycle ' + hh(w.cs) + '–' + hh(w.ce) + ' (' + w.cyc + ' min).</div>';
    return html + say;
  }

  function pickText() {
    var L = global.LabCalLiveQueue.COL_LABELS;
    return st.cols.map(function (c) { return st.pick[c] ? L[c] + ' ' + st.pick[c] : (st.noneLoad && c === 'load' ? 'no Load' : ''); }).filter(Boolean).join(' · ');
  }
  function valid() {
    var Q = global.LabCalLiveQueue;
    var r = Q.checkProbes(st.sheet, cleanPick());
    if (!r.ok) return r;
    var Lopt = Q.optional && Q.optional(st.sheet, 'load');
    if (st.cols.indexOf('load') !== -1 && Lopt && !st.pick.load && !st.noneLoad) return { ok: false, reason: 'Choose a Load probe, or None (No Load Fitted).' };
    var lockedPick = st.cols.filter(function (c) { var u = st.pick[c] && st.use[kp(st.pick[c])]; return u && u.use; });
    if (lockedPick.length) return { ok: false, reason: 'A chosen probe is in another unit.' };
    if (st.abs > st.now) return { ok: false, reason: 'The loading time cannot be later than now.' };
    return { ok: true };
  }
  function cleanPick() { var o = {}; st.cols.forEach(function (c) { if (st.pick[c]) o[c] = st.pick[c]; }); return o; }

  function render() {
    var o = $('psOverlay'); if (!o || !st) return;
    var model = modelText(), v = valid();
    var quick = [0, 5, 10, 15].map(function (back) {
      return '<button type="button" class="psQ' + (st.abs === st.now - back ? ' on' : '') + '" data-back="' + back + '">' + (back ? '−' + back + ' min' : 'Now ' + hh(st.now)) + '</button>';
    }).join('');
    o.innerHTML =
      '<div class="psHead"><b>' + esc((model ? model + ' · ' : '') + 'S/N ' + st.serial) + '</b><span class="psTag">' + esc(SHEET_NAME[st.sheet] + ' · ' + thermText()) + '</span></div>' +
      '<div class="psTitle"><h2>Before you start: probes and loading time</h2><span>Then the worksheet opens with them filled in. Job ' + esc(st.job) + '</span></div>' +
      '<div class="psBody">' +
        '<div class="psCard" id="psProbes"><div class="psStep"><i>1</i>Choose probes<small>Grey = in another unit (locked)</small></div>' + colRows() + '</div>' +
        '<div class="psCard" id="psWhen"><div class="psStep"><i>2</i>When did the probes go in?</div>' +
          '<div class="psTime"><button type="button" class="psSq" data-step="-1" aria-label="One minute earlier">−</button><output id="psClock">' + hh(st.abs) + '</output>' +
          '<button type="button" class="psSq" data-step="1" aria-label="One minute later"' + (st.abs >= st.now ? ' disabled' : '') + '>+</button></div>' +
          '<div class="psQuick">' + quick + '</div>' +
          '<div class="psColName">' + esc(thermText()) + ' — what it is measuring</div>' + strip() +
        '</div>' +
      '</div>' +
      '<div class="psFoot">' +
        '<button type="button" class="psGo" id="psGo"' + (v.ok ? '' : ' disabled') + '>' +
          (v.ok ? 'Save and start — ' + esc(pickText()) + ' · loaded ' + hh(st.abs) : esc(v.reason)) + '</button>' +
        '<button type="button" class="psSkip" id="psSkip">Skip — I\'ll enter them on the worksheet</button>' +
      '</div>' +
      (st.say ? '<div class="psSay stop" style="margin:0 24px 24px">' + esc(st.say) + '</div>' : '');
  }

  function onClick(e) {
    if (!st) return;
    var b = e.target && e.target.closest && e.target.closest('button');
    if (!b || b.disabled) return;
    if (b.dataset.col) {
      var col = b.dataset.col, p = b.dataset.p;
      if (p === '') { st.noneLoad = !st.noneLoad; delete st.pick[col]; }
      else { st.pick[col] = st.pick[col] === p ? '' : p; if (col === 'load') st.noneLoad = false; }
      st.say = ''; render(); return;
    }
    if (b.dataset.step) { st.now = nowAbs(); st.abs = Math.min(st.now, st.abs + Number(b.dataset.step)); render(); return; }
    if (b.dataset.back !== undefined) { st.now = nowAbs(); st.abs = st.now - Number(b.dataset.back); render(); return; }
    if (b.id === 'psSkip') { setSkipped(st.job, st.serial); close(); return; }
    if (b.id === 'psGo') save();
  }

  function save() {
    var Q = global.LabCalLiveQueue, T = global.LabCalTiming;
    st.now = nowAbs();
    if (st.abs > st.now) st.abs = st.now;
    var v = valid();
    if (!v.ok) { st.say = v.reason; render(); return; }
    var job = st.job, serial = st.serial, sheet = st.sheet, probes = cleanPick(), abs = st.abs;
    var why = whyNotQuiet();
    if (why) { st.say = 'Not saved — ' + why + '. Close this and check the worksheet.'; render(); return; }
    var r1 = Q.putProbes(job, serial, sheet, probes);
    if (r1 && r1.ok === false) { st.say = r1.reason || 'The probes could not be saved.'; render(); return; }
    var r2 = Q.put(job, serial, sheet, 'af_probes_in', pad2(Math.floor(dm(abs) / 60)), pad2(dm(abs) % 60));
    if (r2 && r2.ok === false) {
      try { Q.pending(job, serial).forEach(function (it) { if (it.base === 'probes') Q.cancel(job, serial, it.id); }); } catch (e) {}
      st.say = r2.reason || 'The time could not be saved.'; render(); return;
    }
    close();
    T.takeQueue({ from: 'Probes & time' });
  }
  // the same checks as whyNot() except the queue — used at Save
  function whyNotQuiet() {
    var h = $('af_probes_in_h'), m = $('af_probes_in_m');
    if (!h || !m || h.disabled || m.disabled) return 'Probes loaded at cannot be entered';
    if (h.value !== '' || m.value !== '') return 'the worksheet already has a loading time';
    try { if (global.LabCalTiming.afReadingsEntered()) return 'As Found readings are already entered'; } catch (e) {}
    return '';
  }

  // show it once the unit is on the form (opened from a job, fields fill in a moment)
  function maybeOpen() {
    var tries = 0;
    (function look() {
      if (st) return;
      var why = whyNot();
      if (!why) { open(); return; }
      if ((why === 'no job or serial' || why === 'probe lists not ready') && ++tries < 40) { global.setTimeout(look, 250); return; }
    })();
  }
  if (document.readyState === 'complete') global.setTimeout(maybeOpen, 900);
  else global.addEventListener('load', function () { global.setTimeout(maybeOpen, 900); });

  global.LabCalProbeStart = { open: open, close: close, whyNot: whyNot, isOpen: function () { return !!st; }, _state: function () { return st; } };
})(window);

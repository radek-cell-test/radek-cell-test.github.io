/* ==========================================================================
   LabCal — stabilisation & cycle-time checks (v1.551; messages with times v1.555)
   --------------------------------------------------------------------------
   Shared by the standard worksheets: SMD, SNMD, NSMD, 19/24 and IBB.
   (NOT Barkey, NOT the monitoring-system forms.)

   Calibration timing rules — confirmed by Radek, 25 Sep 2026. Do not change
   without asking:
     1. Stabilisation is always at least 30 min, whatever probes are used.
          AF: Probes loaded at -> AF Cycle start   >= 30 min
          AL: Adjusted at      -> AL Cycle start   >= 30 min
     2. Cycle time depends on the probe sets used:
          Air only (one set of probes)   -> cycle >= 20 min
          Air + Load (a Load probe used) -> cycle >= 40 min
        Chart Air / Chart Load / Chart Recorder never count as an extra set;
        only a Load probe does. Same minimum for the AF and AL cycles.
     3. Cycle time = Cycle end - Cycle start (hh:mm, same day).
     4. Too short = BLOCK (red field, inline message, Generate PDF / Excel
        refused). End before start is blocked with its own message.
     5. AL "Adjusted at" cannot be earlier than AF "Cycle end" — the unit
        can only be adjusted once the As Found cycle has finished. (Replaces
        the old IBB-only "Adjusted at >= 40 min after AF Cycle start" rule.)

   Each checked pair is only judged once BOTH of its times are entered; the
   worksheet's required-field check is what demands that they are entered.
   The AL row is only judged while As Left is open (its time pickers are
   enabled) — when As Left is not needed the row is stamped N/A.

   The worksheet owns the markup (the timing band table) and tells this module
   whether a Load probe is in use via LabCalTiming.setup({ loadUsed: fn }).
   The probe-set count is always READ from the worksheet's own state — never
   guessed here.
   ========================================================================== */
(function (global) {
  'use strict';

  var STAB_MIN = 30;
  var CYCLE_MIN_AIR = 20;
  var CYCLE_MIN_AIR_LOAD = 40;
  var OVERNIGHT_MAX_MIN = 5 * 60;    // v1.568: longest gap that may run past midnight (was 12 h in v1.566; Radek: 5 h)

  var AF_TIME_IDS = ['af_probes_in_h', 'af_probes_in_m', 'af_cycle_start_h', 'af_cycle_start_m',
                     'af_cycle_end_h', 'af_cycle_end_m'];
  var AL_TIME_IDS = ['al_adjusted_h', 'al_adjusted_m', 'al_cycle_start_h', 'al_cycle_start_m',
                     'al_cycle_end_h', 'al_cycle_end_m'];
  var AL_CALC_IDS = ['al_stabilisation', 'al_cycletime'];
  var NA_CALC = 'N/A';

  var cfg = { loadUsed: function () { return true; } };
  var alStamped = false;

  function $(id) { return document.getElementById(id); }

  function injectStyle() {
    if ($('labcalTimingStyle')) return;
    var st = document.createElement('style');
    st.id = 'labcalTimingStyle';
    st.textContent =
      'table.timingBand{margin-top:8px;table-layout:fixed}' +
      'table.timingBand th{font-size:11px}' +
      'table.timingBand td{text-align:center}' +
      'table.timingBand td.tbRow{font-weight:700;background:#e3e3e3}' +
      'table.timingBand .tbPair{display:inline-flex;align-items:center;gap:2px;justify-content:center}' +
      'table.timingBand select.timeSel{width:44px}' +
      'table.timingBand input.tbCalc{width:100%;text-align:center}' +
      'table.timingBand #al_adj_made{text-align:left}' +
      'select.timingBad,input.timingBad{background:#ffdede!important;border-bottom:2px solid #b00020!important;color:#900!important}' +
      '.timingMsgs{font-size:11px;color:#b00000;text-align:left;padding:2px 4px}' +
      '.timingMsgs div{margin:1px 0}' +
      '.timingMin{font-weight:400;font-size:10px;color:#333;display:block}' +
      'table.timingBand td.alTimeCell.notNeeded select,table.timingBand td.alTimeCell.notNeeded input{text-decoration:line-through;background:#dcdcdc!important;color:#777!important}';
    document.head.appendChild(st);
  }

  function buildOptions(sel, max) {
    if (!sel || sel.options.length) return;
    var html = '<option value="">--</option>';
    for (var i = 0; i < max; i++) {
      var v = String(i).padStart(2, '0');
      html += '<option value="' + v + '">' + v + '</option>';
    }
    sel.innerHTML = html;
  }

  function toMinutes(hId, mId) {
    var h = $(hId) && $(hId).value, m = $(mId) && $(mId).value;
    if (h === '' || h == null || m === '' || m == null) return null;
    return Number(h) * 60 + Number(m);
  }

  function fmt(mins) {
    var h = Math.floor(mins / 60), m = mins % 60;
    return String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0');
  }

  function loadUsed() {
    try { return !!cfg.loadUsed(); } catch (e) { console.warn('LabCalTiming: loadUsed() failed', e); return true; }
  }
  function minCycle() { return loadUsed() ? CYCLE_MIN_AIR_LOAD : CYCLE_MIN_AIR; }
  function minCycleText() {
    return loadUsed() ? '≥ 40 min (Air + Load)' : '≥ 20 min (Air only)';
  }

  // As Left timing is only judged while As Left is actually open.
  function alActive() {
    var s = $('al_cycle_start_h');
    return !!s && !s.disabled && !alStamped;
  }

  function markBad(ids, bad) {
    ids.forEach(function (id) { var e = $(id); if (e) e.classList.toggle('timingBad', !!bad); });
  }

  // One "from -> to" pair. Returns null if fine / not yet entered, or a
  // problem {msg, focusId}.
  function pair(fromIds, toIds, minGap, calcId, texts) {
    var a = toMinutes(fromIds[0], fromIds[1]);
    var b = toMinutes(toIds[0], toIds[1]);
    var calc = calcId ? $(calcId) : null;
    if (a === null || b === null) {
      if (calc) { calc.value = ''; calc.classList.remove('timingBad'); }
      markBad(toIds, false);
      return null;
    }
    var diff = b - a;
    // v1.566: a calibration that runs past midnight (23:40 -> 00:15) is 35 min,
    // not "earlier than". A later time on the next day is accepted only while
    // the gap stays under OVERNIGHT_MAX_MIN, so a real typo (10:50 -> 10:05 would
    // be 23 h 15 min) is still caught.
    if (diff < 0 && diff + 1440 <= OVERNIGHT_MAX_MIN) diff += 1440;
    if (calc) calc.value = diff >= 0 ? fmt(diff) : 'Invalid';
    var problem = null;
    // v1.555: messages quote the times actually entered, e.g.
    // "AL: Adjusted at (08:17) cannot be earlier than AF Cycle end (08:50)".
    var at = fmt(a), bt = fmt(b);
    if (diff < 0) problem = { msg: texts.reversed(at, bt), focusId: toIds[0] };
    else if (diff < minGap) problem = { msg: texts.short(at, bt, diff), focusId: toIds[0] };
    markBad(toIds, !!problem);
    if (calc) calc.classList.toggle('timingBad', !!problem);
    return problem;
  }

  // Recalculate the Stabilisation / Cycle time displays, mark the fields and
  // show the inline messages. Returns { ok, problems:[{msg, focusId}] }.
  function check() {
    var problems = [];
    var cyc = minCycle();
    var setLabel = loadUsed() ? 'Air + Load' : 'Air only';

    var tag = $('timingCycleMin'); if (tag) tag.textContent = minCycleText();

    var p = pair(['af_probes_in_h', 'af_probes_in_m'], ['af_cycle_start_h', 'af_cycle_start_m'], STAB_MIN, 'af_stabilisation', {
      reversed: function (a, b) { return 'AF: Cycle start (' + b + ') cannot be earlier than Probes loaded at (' + a + ')'; },
      short: function (a, b, d) { return 'AF: stabilisation must be at least 30 min \u2014 Probes loaded at ' + a + ' \u2192 Cycle start ' + b + ' is only ' + d + ' min'; }
    });
    if (p) problems.push(p);
    p = pair(['af_cycle_start_h', 'af_cycle_start_m'], ['af_cycle_end_h', 'af_cycle_end_m'], cyc, 'af_cycletime', {
      reversed: function (a, b) { return 'AF: Cycle end (' + b + ') cannot be earlier than Cycle start (' + a + ')'; },
      short: function (a, b, d) { return 'AF: cycle time must be at least ' + cyc + ' min for ' + setLabel + ' \u2014 Cycle start ' + a + ' \u2192 Cycle end ' + b + ' is only ' + d + ' min'; }
    });
    if (p) problems.push(p);

    if (alActive()) {
      // Adjusted at must not be before the AF cycle has finished.
      p = pair(['af_cycle_end_h', 'af_cycle_end_m'], ['al_adjusted_h', 'al_adjusted_m'], 0, null, {
        reversed: function (a, b) { return 'AL: Adjusted at (' + b + ') cannot be earlier than AF Cycle end (' + a + ')'; },
        short: function () { return ''; }
      });
      if (p) problems.push(p);
      p = pair(['al_adjusted_h', 'al_adjusted_m'], ['al_cycle_start_h', 'al_cycle_start_m'], STAB_MIN, 'al_stabilisation', {
        reversed: function (a, b) { return 'AL: Cycle start (' + b + ') cannot be earlier than Adjusted at (' + a + ')'; },
        short: function (a, b, d) { return 'AL: stabilisation must be at least 30 min \u2014 Adjusted at ' + a + ' \u2192 Cycle start ' + b + ' is only ' + d + ' min'; }
      });
      if (p) problems.push(p);
      p = pair(['al_cycle_start_h', 'al_cycle_start_m'], ['al_cycle_end_h', 'al_cycle_end_m'], cyc, 'al_cycletime', {
        reversed: function (a, b) { return 'AL: Cycle end (' + b + ') cannot be earlier than Cycle start (' + a + ')'; },
        short: function (a, b, d) { return 'AL: cycle time must be at least ' + cyc + ' min for ' + setLabel + ' \u2014 Cycle start ' + a + ' \u2192 Cycle end ' + b + ' is only ' + d + ' min'; }
      });
      if (p) problems.push(p);
    } else {
      markBad(AL_TIME_IDS, false);
      AL_CALC_IDS.forEach(function (id) {
        var e = $(id); if (!e) return;
        e.classList.remove('timingBad');
        e.value = alStamped ? NA_CALC : '';
      });
    }

    var box = $('timingMsgs');
    if (box) {
      box.innerHTML = '';
      problems.forEach(function (pr) {
        var d = document.createElement('div');
        d.textContent = '⚠ ' + pr.msg;
        box.appendChild(d);
      });
      box.style.display = problems.length ? '' : 'none';
    }
    return { ok: problems.length === 0, problems: problems };
  }

  // Called from the worksheet's setAdjustmentMode(stamped, unlocked).
  // stamped  = As Left not needed ("Adjustment not needed" / N/A stamp)
  // unlocked = As Left open for entry
  function applyAdjustmentMode(stamped, unlocked) {
    alStamped = !!stamped;
    AL_TIME_IDS.forEach(function (id) {
      var sel = $(id); if (!sel) return;
      sel.disabled = !unlocked;
      var blank = sel.querySelector('option[value=""]');
      if (blank) blank.textContent = stamped ? 'N/A' : '--';
      if (stamped) sel.value = '';
      sel.classList.toggle('ok', !!stamped);
    });
    document.querySelectorAll('table.timingBand td.alTimeCell').forEach(function (td) {
      td.classList.toggle('notNeeded', !!stamped);
    });
    AL_CALC_IDS.forEach(function (id) {
      var e = $(id); if (!e) return;
      if (stamped) e.value = NA_CALC;
      else if (e.value === NA_CALC) e.value = '';
    });
    check();
  }

  // Ids the required-field check must demand. AL ids only when As Left has
  // to be completed (the worksheet decides that).
  function requiredIds(alRequired) {
    return AF_TIME_IDS.concat(alRequired ? AL_TIME_IDS : []);
  }

  function tv(val, h, m) { return (val(h) || '--') + ':' + (val(m) || '--'); }

  // Excel export — labels kept identical to the pre-v1.551 ones where a
  // field already existed, so older files still import.
  function exportRows(push, val) {
    push('AF Probes in', tv(val, 'af_probes_in_h', 'af_probes_in_m'));
    push('AF Cycle start', tv(val, 'af_cycle_start_h', 'af_cycle_start_m'));
    push('AF Stabilisation Time', val('af_stabilisation'));
    push('AF Cycle end', tv(val, 'af_cycle_end_h', 'af_cycle_end_m'));
    push('AF Cycle time', val('af_cycletime'));
    push('AL Adjustment made', val('al_adj_made'));
    push('AL Adjusted at', tv(val, 'al_adjusted_h', 'al_adjusted_m'));
    push('AL Cycle start', tv(val, 'al_cycle_start_h', 'al_cycle_start_m'));
    push('AL Stabilisation Time', val('al_stabilisation'));
    push('AL Cycle end', tv(val, 'al_cycle_end_h', 'al_cycle_end_m'));
    push('AL Cycle time', val('al_cycletime'));
  }

  // Excel import. Missing rows (older files) simply leave the fields blank;
  // the calculated Stabilisation / Cycle time fields are recalculated, never
  // imported.
  function importRows(fieldMap, setTimeFields, setValById) {
    setTimeFields('af_probes_in_h', 'af_probes_in_m', fieldMap['AF Probes in']);
    setTimeFields('af_cycle_start_h', 'af_cycle_start_m', fieldMap['AF Cycle start']);
    setTimeFields('af_cycle_end_h', 'af_cycle_end_m', fieldMap['AF Cycle end']);
    setValById('al_adj_made', fieldMap['AL Adjustment made']);
    setTimeFields('al_adjusted_h', 'al_adjusted_m', fieldMap['AL Adjusted at']);
    setTimeFields('al_cycle_start_h', 'al_cycle_start_m', fieldMap['AL Cycle start']);
    setTimeFields('al_cycle_end_h', 'al_cycle_end_m', fieldMap['AL Cycle end']);
  }

  function setup(opts) {
    if (opts && typeof opts.loadUsed === 'function') cfg.loadUsed = opts.loadUsed;
    injectStyle();
    ['af_probes_in_h', 'af_cycle_start_h', 'af_cycle_end_h', 'al_adjusted_h', 'al_cycle_start_h', 'al_cycle_end_h']
      .forEach(function (id) { buildOptions($(id), 24); });
    ['af_probes_in_m', 'af_cycle_start_m', 'af_cycle_end_m', 'al_adjusted_m', 'al_cycle_start_m', 'al_cycle_end_m']
      .forEach(function (id) { buildOptions($(id), 60); });
    var tag = $('timingCycleMin'); if (tag) tag.textContent = minCycleText();
  }

  global.LabCalTiming = {
    setup: setup,
    check: check,
    applyAdjustmentMode: applyAdjustmentMode,
    requiredIds: requiredIds,
    exportRows: exportRows,
    importRows: importRows,
    minCycle: minCycle,
    loadUsed: loadUsed,
    AF_TIME_IDS: AF_TIME_IDS,
    AL_TIME_IDS: AL_TIME_IDS,
    STAB_MIN: STAB_MIN,
    CYCLE_MIN_AIR: CYCLE_MIN_AIR,
    CYCLE_MIN_AIR_LOAD: CYCLE_MIN_AIR_LOAD
  };
})(window);

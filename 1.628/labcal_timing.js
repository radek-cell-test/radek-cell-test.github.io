(window.LabCalBuild = window.LabCalBuild || {})['labcal_timing.js'] = 'v1.628';  // file version — see labcal_build.js
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
      'select.schedBad,input.schedBad{background:#ffdede!important;border-bottom:2px solid #b00020!important;color:#900!important}' +
      '.timingMsgs div.timingWarn{color:#8a5a00}' +
      '.timingMsgs a.timingOpen{display:inline-block;padding:6px 4px;min-height:32px;color:#1a5fb4;font-weight:700;text-decoration:underline}' +
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

  // ---- v1.581: Cycle end filled in automatically (Radek) --------------------
  // Cycle end = Cycle start + the minimum cycle (20 min Air only, 40 min
  // Air + Load), written as soon as Cycle start is chosen — no waiting, no
  // stopwatch. It is only a suggestion the engineer can change:
  //   • an EMPTY Cycle end is filled;
  //   • a Cycle end this page filled itself follows Cycle start and the
  //     20/40 rule when either changes (e.g. a Load probe chosen later);
  //   • a Cycle end the engineer picked by hand is never touched, and a
  //     saved unit reopened with a Cycle end keeps it as it was;
  //   • clearing Cycle start clears a Cycle end this page filled.
  // Midnight: 23:50 + 20 min -> 00:10 (accepted by the overnight rule).
  var autoEnd = { af: { val: null, start: null }, al: { val: null, start: null } };
  function setTime(hId, mId, mins) {
    var h = $(hId), m = $(mId);
    if (!h || !m) return;
    if (mins === null) { h.value = ''; m.value = ''; return; }
    h.value = String(Math.floor(mins / 60)).padStart(2, '0');
    m.value = String(mins % 60).padStart(2, '0');
  }
  function fillCycleEnd(row) {
    var st = autoEnd[row];
    var sH = row + '_cycle_start_h', sM = row + '_cycle_start_m';
    var eH = row + '_cycle_end_h', eM = row + '_cycle_end_m';
    var endSel = $(eH);
    if (!endSel || endSel.disabled) { st.val = null; st.start = null; return; }
    var start = toMinutes(sH, sM), end = toMinutes(eH, eM);
    var ours = end !== null && end === st.val;
    // After the start moved: the end that followed the OLD start is ours too.
    if (end !== null && !ours && st.start !== null && st.val === null) {
      ours = end === (st.start + CYCLE_MIN_AIR) % 1440 || end === (st.start + CYCLE_MIN_AIR_LOAD) % 1440;
    }
    if (start === null) {
      if (ours) setTime(eH, eM, null);
      st.val = null; st.start = null;
      return;
    }
    if (end === null || ours) {
      var target = (start + minCycle()) % 1440;
      if (end !== target) setTime(eH, eM, target);
      st.val = target;
    } else {
      st.val = null;           // picked by hand — leave it alone from now on
    }
    st.start = start;
  }

  // Recalculate the Stabilisation / Cycle time displays, mark the fields and
  // show the inline messages. Returns { ok, problems:[{msg, focusId}] }.
  function check() {
    var problems = [];
    try { fillCycleEnd('af'); if (alActive()) fillCycleEnd('al'); else { autoEnd.al.val = null; autoEnd.al.start = null; } }
    catch (e) { console.warn('LabCalTiming: Cycle end fill failed', e); }
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

    // v1.595: thermometer / probe timeline across units (labcal_schedule.js):
    // the same thermometer or probe in two units at once = BLOCK; an old
    // draft or a probe count that needs more time than this sheet = warning.
    var warns = [];
    try {
      if (global.LabCalSchedule) {
        var sc = global.LabCalSchedule.check();
        sc.blocks.forEach(function (b) { problems.push(b); });
        warns = sc.warns;
      }
    } catch (e) { console.warn('LabCalTiming: thermometer timeline check failed', e); }

    // v1.596: "Thermometer — today" strip under the band (never printed).
    try { if (global.LabCalSchedule && global.LabCalSchedule.renderStrip) global.LabCalSchedule.renderStrip(); }
    catch (e) { console.warn('LabCalTiming: thermometer strip failed', e); }

    var box = $('timingMsgs');
    if (box) {
      box.innerHTML = '';
      var line = function (pr, warn) {
        var d = document.createElement('div');
        if (warn) d.className = 'timingWarn';
        d.textContent = '⚠ ' + pr.msg;
        if (pr.link) {
          var a = document.createElement('a');
          a.href = pr.link; a.className = 'timingOpen';
          a.textContent = pr.linkText || 'Open that unit ›';   // v1.605: stray worksheets link to Tools
          d.appendChild(document.createTextNode(' '));
          d.appendChild(a);
        }
        box.appendChild(d);
      };
      problems.forEach(function (pr) { line(pr, false); });
      warns.forEach(function (pr) { line(pr, true); });
      box.style.display = (problems.length || warns.length) ? '' : 'none';
    }
    return { ok: problems.length === 0, problems: problems, warnings: warns };
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

  // ---- v1.593 (Radek): touch time picker -----------------------------------
  // On the iPad a <select> opens a long list (00…59) to scroll through. Now a
  // tap on any hh:mm pair in the timing band opens a panel with big buttons:
  // first the hour (00–23), then the minute (00–59) — two taps. "Now" puts in
  // the current time, "Clear" empties the pair, "Cancel" / tap outside keeps
  // what was there.
  // The two <select>s stay exactly as they were and remain the ONLY place the
  // time is kept: the panel just writes their values and fires the same
  // input/change events a hand-picked value fires. So the stabilisation /
  // cycle-time checks, automatic Cycle end, midnight rule, saving, Excel and
  // the PDF all work unchanged. A disabled pair (As Left locked / N/A) does
  // not open.
  var PICK_LABELS = {
    af_probes_in: 'AF — Probes loaded at', af_cycle_start: 'AF — Cycle start', af_cycle_end: 'AF — Cycle end',
    al_adjusted: 'AL — Adjusted at / probes back in', al_cycle_start: 'AL — Cycle start', al_cycle_end: 'AL — Cycle end'
  };
  var pick = null;   // { base, h, m, step: 'h'|'m' } while the panel is open

  function pickerStyle() {
    if ($('labcalTimePickStyle')) return;
    var st = document.createElement('style');
    st.id = 'labcalTimePickStyle';
    st.textContent =
      'table.timingBand .tbPair.tpOn{position:relative}' +
      '.tpHit{position:absolute;left:0;top:0;width:100%;height:100%;margin:0;padding:0;border:0;background:transparent;opacity:0;cursor:pointer;z-index:2;-webkit-tap-highlight-color:transparent}' +
      '#tpOverlay{position:fixed;top:0;left:0;right:0;bottom:0;z-index:10050;background:rgba(0,0,0,.45);display:flex;align-items:center;justify-content:center;padding:16px;box-sizing:border-box}' +
      '#tpPanel{background:#fff;color:#111;border-radius:12px;box-shadow:0 8px 30px rgba(0,0,0,.35);width:100%;max-width:560px;max-height:100%;overflow:auto;padding:14px;box-sizing:border-box;font-family:inherit}' +
      '#tpPanel .tpTitle{font-size:15px;font-weight:700;color:#333;text-align:center}' +
      '#tpPanel .tpShow{display:flex;justify-content:center;align-items:center;gap:6px;margin:8px 0 10px;font-size:40px;font-weight:700;font-variant-numeric:tabular-nums}' +
      '#tpPanel .tpPart{min-width:78px;min-height:56px;border:2px solid #ccc;border-radius:8px;background:#f4f4f4;font:inherit;color:#111;cursor:pointer;padding:0 6px}' +
      '#tpPanel .tpPart.tpAct{border-color:#1a5fb4;background:#e6efff;color:#1a5fb4}' +
      '#tpPanel .tpHint{text-align:center;font-size:13px;color:#555;margin-bottom:6px}' +
      '#tpPanel .tpGrid{display:grid;gap:6px}' +
      '#tpPanel .tpGrid.tpH{grid-template-columns:repeat(6,1fr)}' +
      '#tpPanel .tpGrid.tpM{grid-template-columns:repeat(10,1fr)}' +
      '#tpPanel .tpGrid button{min-height:52px;font-size:20px;border:1px solid #bbb;border-radius:8px;background:#fafafa;color:#111;cursor:pointer;padding:0;font-variant-numeric:tabular-nums;touch-action:manipulation}' +
      '#tpPanel .tpGrid.tpM button{min-height:46px;font-size:17px}' +
      '#tpPanel .tpGrid button.tpSel{background:#1a5fb4;border-color:#1a5fb4;color:#fff;font-weight:700}' +
      '#tpPanel .tpBar{display:flex;gap:8px;margin-top:12px}' +
      '#tpPanel .tpBar button{flex:1;min-height:48px;font-size:16px;border-radius:8px;border:1px solid #999;background:#f0f0f0;color:#111;cursor:pointer;touch-action:manipulation}' +
      '#tpPanel .tpBar button.tpOk{background:#1a5fb4;border-color:#1a5fb4;color:#fff;font-weight:700}' +
      '#tpPanel .tpBar button:disabled{opacity:.4;cursor:default}' +
      '#tpPanel .tpGrid button.tpBusy{background:#e4e4e4;color:#888;border-style:dashed}' +
      '#tpPanel .tpGrid button.tpSome{box-shadow:inset 0 -4px 0 #b5b5b5}' +
      '#tpPanel .tpGrid button.tpBusy.tpSel{background:#1a5fb4;color:#fff}' +
      '#tpPanel .tpBusyNote{font-size:12px;color:#555;text-align:center;margin:0 0 6px}' +
      '#tpPanel .tpBar button.tpEarly{background:#e8f3e8;border-color:#2a7a2a;color:#1d5a1d;font-weight:700}' +
      '#tpPanel .tpEarlyWhy{font-size:12px;color:#555;text-align:center;margin-top:6px}' +
      '#tpPanel .tpBlock{margin-top:8px;padding:10px 12px;border-radius:10px;background:#FDECEA;border:1px solid #F3B4AE;color:#7A1A12;font-size:14px;line-height:1.35}' +
      '#tpPanel .tpBlock .tpUse{display:inline-block;margin:6px 0 0 4px;min-height:44px;padding:0 16px;border-radius:12px;border:none;background:#0081C8;color:#fff;font-weight:700;font-size:15px}' +
      '@media (max-width:480px){#tpPanel .tpGrid.tpM{grid-template-columns:repeat(6,1fr)}}';
    document.head.appendChild(st);
  }

  function pad2(n) { return String(n).padStart(2, '0'); }
  function escHtml(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }

  function commitPick(hv, mv) {
    if (!pick) return;
    var base = pick.base;
    var h = $(pick.base + '_h'), m = $(pick.base + '_m');
    closePicker();
    if (!h || !m || h.disabled || m.disabled) return;
    if (h.value === hv && m.value === mv) return;           // nothing changed
    h.value = hv; m.value = mv;
    // The pair was set by the engineer's own taps — count it as their work
    // (the unsaved-work guard only trusts real events, and these are ours).
    try { if (global.LabCalNav && global.LabCalNav.markTyped) global.LabCalNav.markTyped(); } catch (e) {}
    [h, m].forEach(function (el) {
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    });
    // v1.615 (Radek): Cycle end set → straight on to the Display cycle Air Max
    // of the same row (AF / AL), only when it is still empty. Synchronous, so
    // the iPad keyboard opens (it is still the engineer's tap).
    var cm = /^(af|al)_cycle_end$/.exec(base);
    if (cm && hv !== '' && mv !== '') {
      var nx = $(cm[1] + '_cycle_air_max');
      if (nx && !nx.disabled && !nx.readOnly && nx.offsetParent !== null && String(nx.value || '').trim() === '') {
        try { nx.focus(); if (nx.scrollIntoView) nx.scrollIntoView({ block: 'center' }); } catch (e) {}
      }
    }
  }

  function closePicker() {
    pick = null;
    var o = $('tpOverlay'); if (o) o.remove();
    document.removeEventListener('keydown', pickKey, true);
  }
  function pickKey(e) { if (e.key === 'Escape') { e.preventDefault(); closePicker(); } }

  function renderPicker() {
    var o = $('tpOverlay'); if (!o || !pick) return;
    var p = o.querySelector('#tpPanel');
    var isH = pick.step === 'h';
    var html = '<div class="tpTitle">' + (PICK_LABELS[pick.base] || 'Time') + '</div>' +
      '<div class="tpShow"><button type="button" class="tpPart' + (isH ? ' tpAct' : '') + '" data-step="h">' + (pick.h || '--') + '</button>:' +
      '<button type="button" class="tpPart' + (!isH ? ' tpAct' : '') + '" data-step="m">' + (pick.m || '--') + '</button></div>' +
      '<div class="tpHint">' + (pick.preset ? 'From Live probes — check the time, then OK' : (isH ? 'Tap the hour' : 'Tap the minute')) + '</div>' +
      '<div class="tpGrid ' + (isH ? 'tpH' : 'tpM') + '">';
    var n = isH ? 24 : 60, cur = isH ? pick.h : pick.m;
    // v1.596 (stage 2): on Cycle start, minutes that would put this cycle on
    // top of another unit's measurement on the same thermometer are greyed
    // and say why. v1.628: a clashing one is no longer entered (tryCommit).
    var plan = null, early = null;
    try {
      var S = global.LabCalSchedule;
      if (S && S.planFor) { plan = S.planFor(pick.base); if (plan) early = S.earliest(pick.base); }
    } catch (e) { plan = null; early = null; }
    if (plan && plan.busy.length) {
      html = html.replace('<div class="tpGrid', '<div class="tpBusyNote">Thermometer ' + escHtml(plan.therm) + ' busy: ' +
        plan.busy.map(function (b) { return fmt(((b.s % 1440) + 1440) % 1440) + '\u2013' + fmt(((b.e % 1440) + 1440) % 1440) + ' ' + escHtml(b.who) + (b.draft ? ' (old draft)' : ''); }).join(' \u00b7 ') +
        '</div><div class="tpGrid');
    }
    for (var i = 0; i < n; i++) {
      var v = pad2(i), cls = [], title = '';
      if (v === cur) cls.push('tpSel');
      if (plan && plan.busy.length) {
        if (isH) {
          var hit = 0;
          for (var mm = 0; mm < 60; mm++) if (S.clashesAt(plan, i * 60 + mm).length) hit++;
          if (hit === 60) { cls.push('tpBusy'); title = 'Thermometer busy this whole hour'; }
          else if (hit) { cls.push('tpSome'); title = 'Thermometer busy for part of this hour'; }
        } else if (pick.h) {
          var cl = S.clashesAt(plan, Number(pick.h) * 60 + i);
          if (cl.length) {
            cls.push('tpBusy');
            title = 'Thermometer busy until ' + fmt(((cl[cl.length - 1].e % 1440) + 1440) % 1440) + ' (' + cl.map(function (b) { return b.who; }).join(', ') + ')';
          }
        }
      }
      html += '<button type="button" data-v="' + v + '"' + (cls.length ? ' class="' + cls.join(' ') + '"' : '') + (title ? ' title="' + escHtml(title) + '"' : '') + '>' + v + '</button>';
    }
    html += '</div><div class="tpBar">' +
      '<button type="button" data-act="clear">Clear</button>' +
      '<button type="button" data-act="now">Now</button>' +
      (plan ? '<button type="button" class="tpEarly" data-act="earliest"' + (early && early.ok ? ' data-early="' + early.min + '">Earliest ' + early.text : ' disabled>Earliest') + '</button>' : '') +
      '<button type="button" data-act="cancel">Cancel</button>' +
      '<button type="button" class="tpOk" data-act="ok"' + (pick.h && pick.m ? '' : ' disabled') + '>OK</button></div>';
    if (plan && early) html += '<div class="tpEarlyWhy">' + escHtml(early.ok ? 'Earliest ' + early.text + ': ' + early.why : early.why) + '</div>';
    if (pick.block) {
      var bl = pick.block, f = function (v) { return fmt(((v % 1440) + 1440) % 1440); };
      html += '<div class="tpBlock" id="tpBlock" role="alert"><b>' + escHtml(pick.h + ':' + pick.m) + ' not entered.</b> Thermometer ' + escHtml(bl.therm || '') +
        ' measures ' + escHtml(bl.who) + ' ' + f(bl.from) + '\u2013' + f(bl.until) + ' \u2014 one thermometer cannot measure two cycles at once.' +
        (bl.early ? ' <button type="button" class="tpUse" data-act="earliest" data-early="' + bl.early.min + '">Use ' + escHtml(bl.early.text) + '</button>' : '') + '</div>';
    }
    p.innerHTML = html;
  }

  function onPickerClick(e) {
    if (!pick) return;
    if (e.target && e.target.id === 'tpOverlay') { closePicker(); return; }   // tap outside = Cancel
    var b = e.target && e.target.closest && e.target.closest('button');
    if (!b) return;
    if (b.dataset.step) { pick.step = b.dataset.step; renderPicker(); return; }
    if (b.dataset.v) {
      if (pick.step === 'h') { pick.h = b.dataset.v; pick.step = 'm'; pick.block = null; renderPicker(); }
      else { pick.m = b.dataset.v; tryCommit(pick.h || '00', pick.m); }   // the minute tap finishes
      return;
    }
    var act = b.dataset.act;
    if (act === 'cancel') closePicker();
    else if (act === 'clear') commitPick('', '');
    else if (act === 'ok') { if (pick.h && pick.m) tryCommit(pick.h, pick.m); }
    else if (act === 'earliest') { var em = Number(b.dataset.early); if (!isNaN(em)) commitPick(pad2(Math.floor(em / 60)), pad2(em % 60)); }
    else if (act === 'now') { var d = new Date(); tryCommit(pad2(d.getHours()), pad2(d.getMinutes())); }
  }

  // v1.628 (Radek, 9 Nov 2026): a Cycle start (AF / AL) that would put this
  // cycle on top of another unit's measurement on the same thermometer is
  // NOT entered — one thermometer cannot measure two cycles at once (the
  // worksheet's K1 check already blocked such a sheet; now the picker stops it
  // at the tap). The panel says who measures until when and offers the
  // earliest free time. Old drafts (warnings only) do not block.
  function clashFor(hv, mv) {
    try {
      var S = global.LabCalSchedule;
      if (!S || !S.planFor || !S.clashesAt) return null;
      var plan = S.planFor(pick.base);
      if (!plan || !plan.busy.length) return null;
      var cl = S.clashesAt(plan, Number(hv) * 60 + Number(mv)).filter(function (b) { return !b.draft; });
      if (!cl.length) return null;
      var last = cl.reduce(function (a, b) { return b.e > a.e ? b : a; });
      var early = S.earliest(pick.base);
      return { who: last.who, from: last.s, until: last.e, therm: plan.therm, early: early && early.ok ? early : null };
    } catch (e) { return null; }
  }
  function tryCommit(hv, mv) {
    var c = clashFor(hv, mv);
    if (!c) { commitPick(hv, mv); return; }
    pick.h = hv; pick.m = mv;
    pick.block = c;
    renderPicker();
  }

  // v1.623: preset {h, m} = a time tapped on the Live probes timeline. It is
  // only shown in the panel — nothing is written until the engineer taps OK.
  function openPicker(base, preset) {
    var h = $(base + '_h'), m = $(base + '_m');
    if (!h || !m || h.disabled || m.disabled) return false;
    closePicker();
    pickerStyle();
    var ok = preset && /^\d\d$/.test(String(preset.h)) && /^\d\d$/.test(String(preset.m));
    pick = { base: base, h: ok ? String(preset.h) : (h.value || ''), m: ok ? String(preset.m) : (m.value || ''), step: 'h', preset: !!ok };
    var o = document.createElement('div');
    o.id = 'tpOverlay';
    o.setAttribute('role', 'dialog');
    o.setAttribute('aria-modal', 'true');
    o.innerHTML = '<div id="tpPanel"></div>';
    o.addEventListener('click', onPickerClick);
    document.body.appendChild(o);
    document.addEventListener('keydown', pickKey, true);
    renderPicker();
    return true;
  }

  // A see-through button laid over each hh:mm pair; the selects underneath
  // still show the time (and the red "too short" marking).
  function attachPickers() {
    pickerStyle();
    Object.keys(PICK_LABELS).forEach(function (base) {
      var h = $(base + '_h');
      var pairEl = h && h.closest ? h.closest('.tbPair') : null;
      if (!pairEl || pairEl.querySelector('.tpHit')) return;
      pairEl.classList.add('tpOn');
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'tpHit';
      b.tabIndex = -1;
      b.setAttribute('aria-label', 'Pick time: ' + PICK_LABELS[base]);
      b.dataset.base = base;
      b.addEventListener('click', function (e) { e.preventDefault(); openPicker(base); });
      pairEl.appendChild(b);
    });
  }

  // ---- v1.623 (Radek): a time asked for on the Live probes timeline ---------
  // live_probes.html never writes a time. It leaves a note in this tab's
  // sessionStorage ({job, serial, base, h?, m?, at}) and opens the unit; here,
  // once this worksheet shows THAT unit (job + serial match), the touch
  // picker opens on that time pair. The engineer confirms with OK — the
  // worksheet's own checks (30 min stabilising, cycle length, thermometer
  // busy, midnight rule) and autosave then work exactly as for a hand-picked
  // time. A note older than 3 min, or for another unit, is dropped.
  var LIVE_KEY = 'labcal.live.setTime';
  function liveNote() { try { return JSON.parse(global.sessionStorage.getItem(LIVE_KEY) || 'null'); } catch (e) { return null; } }
  function dropLiveNote() { try { global.sessionStorage.removeItem(LIVE_KEY); } catch (e) {} }
  function kp(v) { return String(v || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, ''); }
  function liveSay(msg) {
    var old = $('lcLiveSay'); if (old) old.remove();
    var d = document.createElement('div');
    d.id = 'lcLiveSay';
    d.setAttribute('role', 'alert');
    d.style.cssText = 'position:fixed;left:50%;top:16px;transform:translateX(-50%);z-index:10060;max-width:560px;width:calc(100% - 32px);box-sizing:border-box;' +
      'background:#FFF7E6;border:2px solid #D97706;color:#5A3A00;border-radius:10px;padding:12px 16px;font:15px/1.4 -apple-system,Segoe UI,Arial,sans-serif;box-shadow:0 6px 20px rgba(0,0,0,.2)';
    d.textContent = msg + '  (tap to close)';
    d.addEventListener('click', function () { d.remove(); });
    document.body.appendChild(d);
    global.setTimeout(function () { if (d.parentNode) d.remove(); }, 9000);
  }
  function takeLiveNote() {
    var n = liveNote();
    if (!n || !n.base || !PICK_LABELS[n.base]) { if (n) dropLiveNote(); return; }
    if (!(Date.now() - Number(n.at || 0) < 180000)) { dropLiveNote(); return; }
    var tries = 0;
    (function look() {
      var j = $('jobRef'), sn = $('serial');
      var match = j && sn && kp(j.value) === kp(n.job) && kp(sn.value) === kp(n.serial);
      if (!match) {
        if (++tries < 40) { global.setTimeout(look, 200); return; }   // the unit is still being filled in
        dropLiveNote();
        liveSay('Live probes asked for "' + PICK_LABELS[n.base] + '" on S/N ' + n.serial + ', but this worksheet shows another unit — nothing was changed.');
        return;
      }
      dropLiveNote();
      var preset = /^\d\d$/.test(String(n.h)) && /^\d\d$/.test(String(n.m)) ? { h: n.h, m: n.m } : null;
      var pairEl = $(n.base + '_h');
      try { if (pairEl && pairEl.scrollIntoView) pairEl.scrollIntoView({ block: 'center' }); } catch (e) {}
      if (!openPicker(n.base, preset)) {
        liveSay('"' + PICK_LABELS[n.base] + '" cannot be set yet on this worksheet' +
          (/^al_/.test(n.base) ? ' — As Left is not open on this worksheet (it opens when As Found needs an adjustment).' : '.') + ' Nothing was changed.');
      }
    })();
  }

  // ---- v1.625 (Radek, 9 Nov 2026): times SENT from Live probes ------------
  // Live probes puts a confirmed time (now or earlier) in a queue
  // (labcal_livequeue.js) and never writes the worksheet. Here, whenever this
  // worksheet is running with THAT unit on it and this tab owns the unit,
  // the queued times are entered exactly like a time picked with the touch
  // picker (same input/change events → same checks, Cycle end fill and
  // autosave). A time already on the worksheet is never replaced without
  // asking. Every time sent gets an answer back to Live probes.
  var queueBusy = false;
  function takeQueue(opts) {
    var Q = global.LabCalLiveQueue;
    var from = (opts && opts.from) || 'Live probes';           // v1.628: also the Probes & time panel
    if (!Q || queueBusy || pick) return;                     // not while the picker is open
    if (document.hidden) return;                             // asked again when the tab is shown
    var j = $('jobRef'), sn = $('serial');
    var job = j ? j.value : '', serial = sn ? sn.value : '';
    if (!kp(serial) || !Q.pending(job, serial).length) return;
    try { if (global.LabCalUnits && global.LabCalUnits.editingIdentity && global.LabCalUnits.editingIdentity()) return; } catch (e) {}
    try { if (global.LabCalTabLock && !global.LabCalTabLock.canWrite(job, serial)) return; } catch (e) {}   // another tab owns this unit — it takes them
    queueBusy = true;
    var items = Q.take(job, serial), entered = [], said = [], probesEntered = [];
    var today = Q.todayIso();
    // a unit with its certificate made: a changed time would mean a revised
    // certificate (v1.617) — never started from Live probes
    var certified = false;
    try { certified = !!(global.LabCalUnits && global.LabCalUnits.standingOf && global.LabCalUnits.standingOf({ jobRef: job, serial: serial }).done); } catch (e) {}
    try {
      items.forEach(function (it) {
        var isProbes = it.base === 'probes';
        var label = Q.LABELS[it.base] || it.base, t = isProbes ? (Q.probesText ? Q.probesText(it.probes) : '') : it.h + ':' + it.m;
        if (certified) { Q.report(job, serial, it, false, label + ' ' + t + ' not entered — this unit already has its certificate.'); said.push(label + ' ' + t + ': not entered (certificate already made)'); return; }
        if (it.day !== today) { Q.report(job, serial, it, false, label + ' ' + t + ' was sent on ' + it.day + ' — not entered on another day.'); said.push(label + ' ' + t + ': not entered (sent on another day)'); return; }
        if (isProbes) { takeProbes(Q, job, serial, it, t, probesEntered, said); return; }   // v1.626
        var h = $(it.base + '_h'), m = $(it.base + '_m');
        if (!h || !m) { Q.report(job, serial, it, false, label + ' is not on this worksheet.'); said.push(label + ': not on this worksheet'); return; }
        if (h.disabled || m.disabled) {
          var why = /^al_/.test(it.base) ? ' — As Left is not open (it opens when As Found needs an adjustment)' : '';
          Q.report(job, serial, it, false, label + ' ' + t + ' cannot be entered yet' + why + '.'); said.push(label + ' ' + t + ': not entered' + why); return;
        }
        if (h.value === it.h && m.value === it.m) { Q.report(job, serial, it, true, label + ' ' + t + ' was already on the worksheet.'); return; }
        if (h.value !== '' || m.value !== '') {
          var was = (h.value || '--') + ':' + (m.value || '--');
          var yes = global.confirm('Live probes sent ' + label + ' = ' + t + ' for S/N ' + serial + '.\n\nThis worksheet already has ' + was + '.\n\n' +
            'OK = use ' + t + '\nCancel = keep ' + was);
          if (!yes) { Q.report(job, serial, it, false, label + ': kept ' + was + ' (the worksheet already had it) — ' + t + ' not entered.', true); said.push(label + ': kept ' + was); return; }
        }
        h.value = it.h; m.value = it.m;
        try { if (global.LabCalNav && global.LabCalNav.markTyped) global.LabCalNav.markTyped(); } catch (e) {}
        [h, m].forEach(function (el) {
          el.dispatchEvent(new Event('input', { bubbles: true }));
          el.dispatchEvent(new Event('change', { bubbles: true }));
        });
        entered.push(it);
      });
      var res = null;
      try { res = check(); } catch (e) { res = null; }
      var probs = res && res.problems ? res.problems.map(function (p) { return p.msg; }).filter(Boolean) : [];
      // v1.626: probes — after the worksheet has re-checked them (A/B, Load vs Air)
      probesEntered.forEach(function (it) {
        var t = Q.probesText(it.probes);
        var flagged = probeFlags();
        Q.report(job, serial, it, true, 'Probes ' + t + ' entered' + (flagged ? ' — the worksheet says: ' + flagged : '.'));
        said.push('Probes ' + t + ' entered' + (flagged ? ' (' + flagged + ')' : ''));
      });
      entered.forEach(function (it) {
        var label = Q.LABELS[it.base] || it.base, t = it.h + ':' + it.m;
        Q.report(job, serial, it, true, label + ' ' + t + ' entered' + (probs.length ? ' — the worksheet says: ' + probs[0] : '.'));
        said.push(label + ' ' + t + ' entered');
      });
      if (said.length) {
        liveSay('From ' + from + ': ' + said.join(' · ') + (probs.length ? '. Check the timing message on the worksheet.' : '.'));
        var first = entered[0] ? $(entered[0].base + '_h') : probesEntered[0] ? $('af_air1_probe') : null;
        try { if (first && first.scrollIntoView) first.scrollIntoView({ block: 'center' }); } catch (e) {}
      }
    } catch (e) {
      console.error('LabCalTiming: Live probes times could not be entered', e);
      liveSay('Live probes sent times or probes for this unit, but they could not be entered (' + (e && e.message) + '). Enter them on the worksheet.');
    } finally {
      queueBusy = false;
    }
  }
  // ---- v1.626 (Radek, 9 Nov 2026): PROBES sent from Live probes ------------
  // Set like a probe picked from the worksheet's own list (same change event →
  // As Left copy, Chart = Load, corrections from the offsets file, checks,
  // autosave). Radek's rules:
  //  • the probe must be in THIS worksheet's list (its offsets file);
  //  • different probes already chosen AND As Found readings already entered
  //    → not entered (a new probe would change the correction of readings
  //    already taken) — the engineer changes it on the worksheet if needed;
  //  • different probes, no readings yet → the worksheet asks.
  function probeSel(col) {
    var el = $('af_' + col + '_probe');
    if (!el || el.tagName !== 'SELECT' || el.disabled) return null;
    if (el.closest && el.closest('.notApplicableCol')) return null;
    return el;
  }
  function hasOption(el, v) {
    return Array.prototype.some.call(el.options, function (o) { return o.value === v; });
  }
  // As Found readings (Reference / Display / Chart / cycle max-min) typed in
  function afReadingsEntered() {
    var NA = /^-?N\/A-?$/i;
    return Array.prototype.some.call(document.querySelectorAll('input[id^="af_"]'), function (el) {
      if (!/^af_[a-z0-9_]+_(max|min)$/.test(el.id)) return false;
      var v = String(el.value || '').trim();
      return v !== '' && !NA.test(v);
    });
  }
  // the worksheet's own probe warnings after a change (A/B, Load = Air)
  function probeFlags() {
    var bad = Array.prototype.filter.call(document.querySelectorAll('select.probe[id^="af_"]'), function (el) { return el.classList.contains('invalid'); });
    if (!bad.length) return '';
    var air = bad.some(function (el) { return /_air\d_probe$/.test(el.id); });
    return air ? 'Air 1 and Air 2 must be one A and one B probe' : 'the Load / Chart probe is one of the Air probes';
  }
  function takeProbes(Q, job, serial, it, t, probesEntered, said) {
    var cols = Object.keys(it.probes || {});
    var sels = {}, missing = [], notListed = [];
    cols.forEach(function (c) {
      var el = probeSel(c);
      if (!el) { missing.push(Q.COL_LABELS[c] || c); return; }
      if (!hasOption(el, it.probes[c])) { notListed.push(it.probes[c]); return; }
      sels[c] = el;
    });
    if (!cols.length || missing.length) {
      Q.report(job, serial, it, false, 'Probes ' + t + ' not entered — ' + (missing.length ? missing.join(', ') + ' cannot be chosen on this worksheet' + (missing.indexOf('Load') !== -1 ? ' (No Load Fitted?) — send them again without Load.' : '.') : 'nothing was sent.'));
      said.push('Probes: not entered'); return;
    }
    if (notListed.length) {
      Q.report(job, serial, it, false, 'Probes ' + t + ' not entered — ' + notListed.join(', ') + ' not in this worksheet\'s probe list (check the offsets file on the worksheet).');
      said.push('Probes: not entered (' + notListed.join(', ') + ' not in the probe list)'); return;
    }
    var differ = cols.filter(function (c) { return sels[c].value !== '' && sels[c].value !== it.probes[c]; });
    var same = cols.every(function (c) { return sels[c].value === it.probes[c]; });
    if (same) { Q.report(job, serial, it, true, 'Probes ' + t + ' were already on the worksheet.'); return; }
    var was = cols.map(function (c) { return (Q.COL_LABELS[c] || c) + ' ' + (sels[c].value || '—'); }).join(' · ');
    if (differ.length && afReadingsEntered()) {
      Q.report(job, serial, it, false, 'Probes ' + t + ' not entered — the worksheet already has ' + was + ' and As Found readings are entered. Change a probe on the worksheet if it is really needed.', true);
      said.push('Probes: kept ' + was + ' (readings already entered)'); return;
    }
    if (differ.length) {
      var yes = global.confirm('Live probes sent probes for S/N ' + serial + ':\n' + t + '\n\nThis worksheet already has:\n' + was + '\n\n' +
        'OK = use the sent probes\nCancel = keep ' + was);
      if (!yes) { Q.report(job, serial, it, false, 'Probes: kept ' + was + ' (the worksheet already had them) — ' + t + ' not entered.', true); said.push('Probes: kept ' + was); return; }
    }
    try { if (global.LabCalNav && global.LabCalNav.markTyped) global.LabCalNav.markTyped(); } catch (e) {}
    cols.forEach(function (c) {
      var el = sels[c];
      if (el.value === it.probes[c]) return;
      el.value = it.probes[c];
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    });
    probesEntered.push(it);
  }

  var queueTimer = null;
  function takeQueueSoon(ms) {
    if (queueTimer) global.clearTimeout(queueTimer);
    queueTimer = global.setTimeout(function () { queueTimer = null; try { takeQueue(); } catch (e) {} }, ms || 300);
  }
  // after the unit is on the form (opened from a job, the fields fill in a moment)
  function takeQueueAfterLoad() {
    var tries = 0;
    (function look() {
      var sn = $('serial');
      if (!(sn && kp(sn.value)) && ++tries < 40) { global.setTimeout(look, 200); return; }
      takeQueue();
    })();
  }
  function wireQueue() {
    if (global.__labcalQueueWired) return;
    global.__labcalQueueWired = true;
    global.addEventListener('storage', function (e) {
      if (e && e.key && global.LabCalLiveQueue && e.key.indexOf(global.LabCalLiveQueue.Q_PREFIX) === 0) takeQueueSoon(300);
    });
    document.addEventListener('visibilitychange', function () { if (!document.hidden) takeQueueSoon(500); });
    global.addEventListener('pageshow', function () { takeQueueSoon(600); });
    global.addEventListener('focus', function () { takeQueueSoon(600); });
    // Serial / Job Reference typed or corrected → maybe now this unit has times waiting
    document.addEventListener('focusout', function (e) {
      var t = e && e.target;
      if (t && (t.id === 'serial' || t.id === 'jobRef')) takeQueueSoon(900);
    }, true);
    if (document.readyState === 'complete') global.setTimeout(takeQueueAfterLoad, 700);
    else global.addEventListener('load', function () { global.setTimeout(takeQueueAfterLoad, 700); });
  }

  function setup(opts) {
    if (opts && typeof opts.loadUsed === 'function') cfg.loadUsed = opts.loadUsed;
    try { wireQueue(); } catch (e) { console.warn('LabCalTiming: Live probes queue not wired', e); }   // v1.625
    injectStyle();
    ['af_probes_in_h', 'af_cycle_start_h', 'af_cycle_end_h', 'al_adjusted_h', 'al_cycle_start_h', 'al_cycle_end_h']
      .forEach(function (id) { buildOptions($(id), 24); });
    ['af_probes_in_m', 'af_cycle_start_m', 'af_cycle_end_m', 'al_adjusted_m', 'al_cycle_start_m', 'al_cycle_end_m']
      .forEach(function (id) { buildOptions($(id), 60); });
    var tag = $('timingCycleMin'); if (tag) tag.textContent = minCycleText();
    try { attachPickers(); } catch (e) { console.warn('LabCalTiming: time picker not attached', e); }   // v1.593
    // v1.623: a time asked for on Live probes — after the page has put the unit in
    try {
      if (document.readyState === 'complete') global.setTimeout(takeLiveNote, 400);
      else global.addEventListener('load', function () { global.setTimeout(takeLiveNote, 400); });
    } catch (e) { console.warn('LabCalTiming: Live probes note not read', e); }
    // v1.595 (Radek): the AL row time starts the re-stabilisation — the later
    // of the adjustment and putting the probes back in (they are often used
    // in another unit meanwhile). 30 min are counted from it (CAL04 step 5).
    try {
      var th = Array.prototype.filter.call(document.querySelectorAll('table.timingBand th'), function (t) { return /Adjusted at/.test(t.textContent); })[0];
      if (th && !th.querySelector('.alHint')) {
        var sp = document.createElement('span');
        sp.className = 'timingMin alHint';
        sp.textContent = 'AL: after adjusting, probes back in';
        th.appendChild(sp);
      }
    } catch (e) {}
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
    CYCLE_MIN_AIR_LOAD: CYCLE_MIN_AIR_LOAD,
    fillCycleEnd: fillCycleEnd,
    openPicker: openPicker,      // v1.593
    closePicker: closePicker,
    takeQueue: takeQueue,        // v1.625: times sent from Live probes
    afReadingsEntered: afReadingsEntered   // v1.626
  };
})(window);

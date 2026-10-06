(window.LabCalBuild = window.LabCalBuild || {})['labcal_schedule.js'] = 'v1.604';  // file version — see labcal_build.js
/* ==========================================================================
   LabCal — thermometer & probe timeline (v1.595, stage 1)
   --------------------------------------------------------------------------
   Design agreed with Radek (28 Sep 2026) — Claude Docs "LabCal — harmonogram
   termometrów i sond (projekt)". Read-only: builds timelines from what the
   worksheets already save and NEVER writes a time itself.

   Resources
     • Thermometer = its serial number (offsets file refThermSerial, worksheet
       field drtSerial). Reserved ONLY while measuring:
         AF Cycle start → AF Cycle end,  AL Cycle start → AL Cycle end.
       The whole thermometer = one measurement at a time (Radek: never two
       units on the two channels at once).
     • Probe = thermometer serial + probe name ("45640/4 · 6B"). Held while
       it is in a unit:
         AF: Probes loaded at → AF Cycle end
         AL: time in the AL row ("Probes loaded at / Adjusted at") → AL Cycle end
       AF and AL are ALWAYS separate holds — after an adjustment probes are
       often taken out and used in another unit meanwhile (Radek).
     During stabilisation and re-stabilisation the thermometer is free.

   Checks (for the unit open in this worksheet, against every other unit
   saved on this iPad on the same day, any job):
     K1 same thermometer measuring at the same time      → BLOCK
     K2 same probe in two units at the same time          → BLOCK
     K4 probes chosen need more time than the sheet's rule → warning only
        (passes = distinct probes ÷ channels, rounded up, × 20 min — it only
        EXPLAINS the fixed 20/40 rule, it never replaces it: Radek)
   A clash with a unit that has no certificate yet and has not been touched
   for 12 h (an old draft) is a warning, not a block (Radek).
   Touching ends are fine (one ends 08:50, the next starts 08:50). Times past
   midnight follow the timing rule (≤ 5 h = next day). Skipped: units in the
   bin, "not required" units, units with no thermometer serial or no times.
   Barkey / Cloud Temp / Monitoring have no times and are not in the timeline.
   ========================================================================== */
(function (global) {
  'use strict';

  var PREFIX = 'labcal.unit.';
  var SHEETS = ['smd', 'nsmd', 'ibb', 'snmd', 'ws19_24'];
  var SHEET_NAMES = { smd: 'SMD', nsmd: 'NSMD', ibb: 'IBB', snmd: 'SNMD', ws19_24: '19/24' };
  var ECOSYSTEM = { smd: 'dostmann', nsmd: 'dostmann', ibb: 'dostmann', snmd: 'fluke_comark', ws19_24: 'fluke_comark' };
  var PAGES = { 'calibration_worksheet_smd.html': 'smd', 'calibration_worksheet_nsmd.html': 'nsmd', 'calibration_worksheet_ibb.html': 'ibb',
                'calibration_worksheet_snmd.html': 'snmd', 'calibration_worksheet_19_24.html': 'ws19_24' };
  var OVERNIGHT_MAX_MIN = 5 * 60;      // same as labcal_timing.js
  var STALE_MS = 12 * 3600 * 1000;     // an unfinished worksheet untouched this long = old draft
  var PASS_MIN = 20;
  var PROBE_RE = /^(af|al)_[a-z0-9]+_probe$/;

  function $(id) { return global.document.getElementById(id); }
  function store() { try { return global.localStorage; } catch (e) { return null; } }
  function norm(s) { return String(s == null ? '' : s).trim().toUpperCase().replace(/\s+/g, ''); }
  function keyPart(v) { return String(v || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, ''); }
  function validProbe(v) { v = String(v == null ? '' : v).trim(); return !!v && !/^-?N\/?A-?$/i.test(v); }
  function hhmm(abs) { var m = ((abs % 1440) + 1440) % 1440; return String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0'); }
  function dayNum(iso) { var t = Date.parse(String(iso || '') + 'T00:00:00Z'); return isNaN(t) ? null : Math.floor(t / 864e5); }

  function thisSheet() {
    try {
      var f = String(global.location.pathname || '').split('/').pop().toLowerCase();
      return PAGES[f] || '';
    } catch (e) { return ''; }
  }

  function tmin(state, h, m) {
    var a = state[h], b = state[m];
    if (a == null || b == null || a === '' || b === '' || !/^\d\d?$/.test(String(a)) || !/^\d\d?$/.test(String(b))) return null;
    return Number(a) * 60 + Number(b);
  }

  // One unit (from a saved snapshot or the open form) → its timeline.
  function unitFrom(state, info) {
    state = state || {};
    var date = String(state.dateNative || info.day || '').slice(0, 10);
    var base = dayNum(date);
    if (base === null) return null;
    var names = ['probesIn', 'afStart', 'afEnd', 'alAdj', 'alStart', 'alEnd'];
    var raw = [tmin(state, 'af_probes_in_h', 'af_probes_in_m'), tmin(state, 'af_cycle_start_h', 'af_cycle_start_m'),
               tmin(state, 'af_cycle_end_h', 'af_cycle_end_m'), tmin(state, 'al_adjusted_h', 'al_adjusted_m'),
               tmin(state, 'al_cycle_start_h', 'al_cycle_start_m'), tmin(state, 'al_cycle_end_h', 'al_cycle_end_m')];
    var t = {}, prev = null, roll = 0;
    raw.forEach(function (v, i) {
      if (v === null) { t[names[i]] = null; return; }
      var abs = base * 1440 + v + roll;
      if (prev !== null && abs < prev && abs + 1440 - prev <= OVERNIGHT_MAX_MIN) { roll += 1440; abs += 1440; }
      t[names[i]] = abs; prev = abs;
    });
    var probes = { af: [], al: [] };
    Object.keys(state).forEach(function (id) {
      var m = PROBE_RE.exec(id);
      if (!m || !validProbe(state[id])) return;
      var p = norm(state[id]);
      if (probes[m[1]].indexOf(p) === -1) probes[m[1]].push(p);
    });
    var therm = norm(state.drtSerial);
    var u = { sheet: info.sheet, job: String(state.jobRef || info.jobRef || '').trim(), serial: String(state.serial || info.serial || '').trim(),
              date: date, therm: therm, t: t, probes: probes, savedAt: info.savedAt || '', key: info.key || '' };
    u.measure = [];
    if (t.afStart !== null && t.afEnd !== null && t.afEnd > t.afStart) u.measure.push({ row: 'af', s: t.afStart, e: t.afEnd });
    if (t.alStart !== null && t.alEnd !== null && t.alEnd > t.alStart) u.measure.push({ row: 'al', s: t.alStart, e: t.alEnd });
    u.holds = [];
    var afS = t.probesIn !== null ? t.probesIn : t.afStart;
    if (afS !== null && t.afEnd !== null && t.afEnd > afS) probes.af.forEach(function (p) { u.holds.push({ row: 'af', probe: p, s: afS, e: t.afEnd }); });
    var alS = t.alAdj !== null ? t.alAdj : t.alStart;
    if (alS !== null && t.alEnd !== null && t.alEnd > alS) (probes.al.length ? probes.al : probes.af).forEach(function (p) { u.holds.push({ row: 'al', probe: p, s: alS, e: t.alEnd }); });
    return u;
  }

  function label(u) { return (SHEET_NAMES[u.sheet] || u.sheet) + ' S/N ' + (u.serial || '?') + (u.job ? ' (job ' + u.job + ')' : ''); }

  // Where the other unit stands on the job list.
  function standing(u) {
    var J = global.LabCalJobsheet, out = { skip: false, done: false, onList: false };
    if (!J || !u.job) return out;
    try {
      if (J.binnedJobs && J.binnedJobs().some(function (b) { return keyPart(b.callNumber) === keyPart(u.job); })) {
        var live = J.jobByRef && J.jobByRef(u.job);
        if (!live) { out.skip = true; return out; }
      }
      var job = (J.jobSnapshot ? J.jobSnapshot(u.job) : null) || (J.jobByRef ? J.jobByRef(u.job) : null);
      if (!job) return out;
      var d = (job.devices || []).filter(function (x) { return !x.duplicateMerged && keyPart(x.serial) === keyPart(u.serial); })[0];
      if (!d) return out;
      out.onList = true;
      out.done = !!d.done;
      if (d.notRequired && !d.done) out.skip = true;
    } catch (e) {}
    return out;
  }

  // 'skip' (bin / not required) · 'block' (certificate, or being worked on)
  // · 'warn' (no certificate, untouched for 12 h = old draft). Memoised per
  // check so the job list is read once per unit.
  function levelOf(o) {
    var st = standing(o);
    if (st.skip) return 'skip';
    if (st.done) return 'block';
    var age = Date.now() - (Date.parse(o.savedAt) || 0);
    return age >= STALE_MS ? 'warn' : 'block';
  }
  function levelMemo() {
    var memo = {};
    return function (o) { var k = o.key || label(o); return memo[k] || (memo[k] = levelOf(o)); };
  }

  // Every other saved unit (cached by the raw text, so typing stays quick).
  var cache = {};
  function others(selfKey) {
    var s = store(), out = [];
    if (!s) return out;
    var seen = {};
    for (var i = 0; i < s.length; i++) {
      var k = s.key(i);
      if (!k || k.indexOf(PREFIX) !== 0 || k === selfKey) continue;
      var sheet = k.slice(PREFIX.length).split('.')[0].toLowerCase();
      if (SHEETS.indexOf(sheet) === -1) continue;
      seen[k] = true;
      var raw = s.getItem(k);
      if (cache[k] && cache[k].raw === raw) { if (cache[k].unit) out.push(cache[k].unit); continue; }
      var unit = null;
      try {
        var rec = JSON.parse(raw || 'null');
        if (rec && rec.state) unit = unitFrom(rec.state, { sheet: rec.sheet || sheet, jobRef: rec.jobRef, serial: rec.serial, day: rec.day, savedAt: rec.savedAt, key: k });
      } catch (e) { unit = null; }
      cache[k] = { raw: raw, unit: unit };
      if (unit) out.push(unit);
    }
    Object.keys(cache).forEach(function (k) { if (!seen[k]) delete cache[k]; });
    return out;
  }

  function channels(sheet) {
    try {
      var O = global.LabCalOffsets, raw = O && O.load ? O.load(ECOSYSTEM[sheet]) : null;
      var ports = {};
      Object.keys((raw && raw.probes) || {}).forEach(function (k) { var p = raw.probes[k] && raw.probes[k].port; if (p) ports[p] = true; });
      var n = Object.keys(ports).length;
      return n >= 1 ? n : 2;
    } catch (e) { return 2; }
  }

  function currentUnit(sheet) {
    var U = global.LabCalUnits;
    var state = U && U.captureForm ? U.captureForm(global.document) : {};
    var key = U && U.keyFor ? U.keyFor(sheet, state.jobRef, state.serial) : '';
    var today = new Date();
    var iso = today.getFullYear() + '-' + String(today.getMonth() + 1).padStart(2, '0') + '-' + String(today.getDate()).padStart(2, '0');
    var u = unitFrom(state, { sheet: sheet, day: iso, key: key });
    return { u: u, key: key };
  }

  function overlap(a, b) { return a.s < b.e && b.s < a.e; }
  function link(u) { return 'calibration.html#job=' + encodeURIComponent(u.job) + '&unit=' + encodeURIComponent(u.serial) + '&open=1'; }
  function mark(id) { var e = $(id); if (e) e.classList.add('schedBad'); }

  // → { blocks:[{msg, focusId, link?}], warns:[{msg, focusId?, link?}], timeline }
  function check() {
    var res = { blocks: [], warns: [] };
    var d = global.document;
    if (!d) return res;
    Array.prototype.forEach.call(d.querySelectorAll('.schedBad'), function (e) { e.classList.remove('schedBad'); });
    var sheet = thisSheet();
    if (!sheet) return res;
    var cur = currentUnit(sheet), me = cur.u;
    if (!me) return res;

    // K4 — probes chosen vs the sheet's cycle rule (explains, never blocks)
    try {
      var T = global.LabCalTiming;
      if (T && T.minCycle) {
        var chosen = [];
        Array.prototype.forEach.call(d.querySelectorAll('select.probe'), function (sel) {
          if (!/^af_/.test(sel.id) || sel.disabled || !validProbe(sel.value)) return;
          var p = norm(sel.value);
          if (chosen.indexOf(p) === -1) chosen.push(p);
        });
        var ch = channels(sheet), passes = Math.ceil(chosen.length / ch), need = passes * PASS_MIN, rule = T.minCycle();
        if (chosen.length && need > rule) {
          res.warns.push({ msg: chosen.length + ' probes (' + chosen.join(', ') + ') on a ' + ch + '-channel thermometer = ' + passes + ' passes × ' + PASS_MIN +
            ' min = ' + need + ' min, but this worksheet times ' + rule + ' min. Check the Load / Chart probe.', focusId: 'af_load_probe' });
        }
      }
    } catch (e) { console.warn('LabCalSchedule: probe count check failed', e); }

    if (!me.therm || (!me.measure.length && !me.holds.length)) return res;
    var list = others(cur.key).filter(function (o) { return o.therm === me.therm && (o.measure.length || o.holds.length); });
    var done = {}, levels = levelMemo();
    list.forEach(function (o) {
      function level() { return levels(o); }
      // K1 — the same thermometer measuring two units at once
      me.measure.forEach(function (a) {
        o.measure.forEach(function (b) {
          if (!overlap(a, b)) return;
          var lv = level(); if (lv === 'skip') return;
          var id = 'K1|' + a.row + '|' + o.key + '|' + b.row;
          if (done[id]) return; done[id] = true;
          var rowName = a.row === 'af' ? 'AF' : 'AL';
          var msg = rowName + ': thermometer ' + me.therm + ' is measuring ' + label(o) + ' ' + (b.row === 'af' ? 'As Found' : 'As Left') + ' ' +
                    hhmm(b.s) + '–' + hhmm(b.e) + ' — this ' + rowName + ' cycle ' + hhmm(a.s) + '–' + hhmm(a.e) +
                    ' overlaps it. One thermometer measures one unit at a time; it is free from ' + hhmm(b.e) + '.';
          var item = { msg: msg, focusId: a.row + '_cycle_start_h', link: o.job ? link(o) : '' };
          if (lv === 'warn') { item.msg += ' (That worksheet has no certificate and was last changed ' + ago(o.savedAt) + ' — if it was never done, clear its times.)'; res.warns.push(item); }
          else { res.blocks.push(item); mark(a.row + '_cycle_start_h'); mark(a.row + '_cycle_start_m'); }
        });
      });
      // K2 — the same probe in two units at once (one message per unit and row)
      var groups = {};
      me.holds.forEach(function (a) {
        o.holds.forEach(function (b) {
          if (a.probe !== b.probe || !overlap(a, b)) return;
          var id = a.row + '|' + b.row;
          var g = groups[id] || (groups[id] = { a: a, b: b, probes: [] });
          if (g.probes.indexOf(a.probe) === -1) g.probes.push(a.probe);
        });
      });
      Object.keys(groups).forEach(function (id) {
        var g = groups[id], lv = level();
        if (lv === 'skip') return;
        var many = g.probes.length > 1;
        var msg = (g.a.row === 'af' ? 'AF' : 'AL') + ': probe' + (many ? 's ' : ' ') + g.probes.join(', ') + ' (thermometer ' + me.therm + ') ' + (many ? 'are' : 'is') +
                  ' in ' + label(o) + ' ' + hhmm(g.b.s) + '\u2013' + hhmm(g.b.e) + ' \u2014 ' + (many ? 'they' : 'it') + ' cannot also be in this unit ' + hhmm(g.a.s) + '\u2013' + hhmm(g.a.e) + '.';
        var sels = [];
        Array.prototype.forEach.call(d.querySelectorAll('select.probe'), function (e) {
          if (e.id.indexOf(g.a.row === 'af' ? 'af_' : 'al_') === 0 && g.probes.indexOf(norm(e.value)) !== -1) sels.push(e);
        });
        var focusId = g.a.row === 'af' ? (sels[0] ? sels[0].id : 'af_probes_in_h') : 'al_adjusted_h';
        var item = { msg: msg, focusId: focusId, link: o.job ? link(o) : '' };
        if (lv === 'warn') { item.msg += ' (That worksheet has no certificate and was last changed ' + ago(o.savedAt) + ' \u2014 if it was never done, clear its times.)'; res.warns.push(item); }
        else {
          res.blocks.push(item);
          sels.forEach(function (e) { e.classList.add('schedBad'); });
          if (g.a.row === 'af') { mark('af_probes_in_h'); mark('af_probes_in_m'); } else { mark('al_adjusted_h'); mark('al_adjusted_m'); }
        }
      });
    });
    return res;
  }

  // ==========================================================================
  // v1.596 — stage 2: guidance (Radek, design section 12). All read-only: it
  // never writes a time or a probe by itself. "Earliest" only fills Cycle
  // start when the engineer taps it.
  // ==========================================================================
  var STAB_MIN = 30;
  function shortLabel(u) { return (SHEET_NAMES[u.sheet] || u.sheet) + ' ' + (u.serial || '?'); }
  function nowAbs() { var d = new Date(); return dayNum(isoOf(d)) * 1440 + d.getHours() * 60 + d.getMinutes(); }
  function isoOf(d) { return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
  function minCycleNow() { try { return global.LabCalTiming && global.LabCalTiming.minCycle ? global.LabCalTiming.minCycle() : 20; } catch (e) { return 20; } }

  // The open unit and every other unit on the same thermometer (bin / not
  // required already left out), each with its level.
  function context() {
    var sheet = thisSheet();
    if (!sheet) return null;
    var cur = currentUnit(sheet), me = cur.u;
    if (!me) return null;
    var levels = levelMemo(), list = [];
    if (me.therm) {
      others(cur.key).forEach(function (o) {
        if (o.therm !== me.therm || (!o.measure.length && !o.holds.length)) return;
        var lv = levels(o);
        if (lv !== 'skip') list.push({ u: o, lv: lv });
      });
    }
    return { sheet: sheet, me: me, key: cur.key, list: list };
  }

  // ---- Time picker: Cycle start (AF / AL) ---------------------------------
  // → null when this pair is not a Cycle start, else
  //   { therm, cyc, busy:[{s,e,who,row,draft}], toAbs(minOfDay), floor, floorWhy, prev }
  function planFor(base) {
    var row = base === 'af_cycle_start' ? 'af' : base === 'al_cycle_start' ? 'al' : '';
    if (!row) return null;
    var c = context();
    if (!c) return null;
    var me = c.me, t = me.t;
    var prev = row === 'af' ? t.probesIn : (t.alAdj !== null ? t.alAdj : t.afEnd);
    var baseDay = dayNum(me.date);
    var busy = [];
    c.list.forEach(function (x) {
      x.u.measure.forEach(function (b) { busy.push({ s: b.s, e: b.e, who: shortLabel(x.u), full: label(x.u), row: b.row, draft: x.lv === 'warn', unit: x.u }); });
    });
    busy.sort(function (a, b) { return a.s - b.s; });
    var floor = null, floorWhy = '';
    if (row === 'af') {
      if (t.probesIn !== null) { floor = t.probesIn + STAB_MIN; floorWhy = 'Probes loaded at ' + hhmm(t.probesIn) + ' + 30 min'; }
      else floorWhy = 'Enter "Probes loaded at" first';
    } else {
      if (t.alAdj !== null) { floor = t.alAdj + STAB_MIN; floorWhy = 'Adjusted at ' + hhmm(t.alAdj) + ' + 30 min'; }
      else floorWhy = 'Enter "Adjusted at" first';
    }
    return {
      row: row, therm: me.therm, cyc: minCycleNow(), busy: busy, floor: floor, floorWhy: floorWhy, prev: prev,
      toAbs: function (v) {
        var abs = baseDay * 1440 + v;
        if (prev !== null && abs < prev && abs + 1440 - prev <= OVERNIGHT_MAX_MIN) abs += 1440;
        return abs;
      }
    };
  }

  // Would a cycle starting at minute-of-day v clash? → the clashing blocks.
  function clashesAt(plan, v) {
    var s = plan.toAbs(v), e = s + plan.cyc;
    return plan.busy.filter(function (b) { return s < b.e && b.s < e; });
  }

  // Earliest correct Cycle start: after the 30 min stabilisation AND with the
  // thermometer free for the whole cycle (20 / 40 min). Old drafts (warnings)
  // do not push it later. → { ok, min, text } or { ok:false, why }
  function earliest(base) {
    var plan = planFor(base);
    if (!plan) return { ok: false, why: '' };
    if (plan.floor === null) return { ok: false, why: plan.floorWhy };
    var c = plan.floor, guard = 0, pushedBy = null;
    for (;;) {
      var e = c + plan.cyc, hit = null;
      plan.busy.forEach(function (b) { if (!b.draft && c < b.e && b.s < e && (!hit || b.e > hit.e)) hit = b; });
      if (!hit) break;
      c = hit.e; pushedBy = hit;
      if (++guard > 200) return { ok: false, why: 'Thermometer busy all day' };
    }
    if (c - plan.floor > OVERNIGHT_MAX_MIN && Math.floor(c / 1440) !== Math.floor(plan.floor / 1440)) {
      return { ok: false, why: 'Thermometer not free within 5 h' };
    }
    var why = pushedBy ? 'thermometer ' + plan.therm + ' busy with ' + pushedBy.who + ' until ' + hhmm(pushedBy.e) : plan.floorWhy;
    return { ok: true, min: ((c % 1440) + 1440) % 1440, text: hhmm(c), why: why };
  }

  // ---- Probe dropdowns: "(in SMD 123 until 09:50)" -------------------------
  // The note is put on the options only while the list is being opened and
  // taken off again the moment a probe is chosen or the list closes, so the
  // option text the worksheet reads (certificate, Excel, Chart mirror) is
  // never changed.
  var NOTE_ATTR = 'data-sched-orig';
  function probeWindow(me, row) {
    var t = me.t, cyc = minCycleNow(), s, e;
    if (row === 'af') {
      s = t.probesIn !== null ? t.probesIn : t.afStart;
      e = t.afEnd !== null ? t.afEnd : (s !== null ? s + (t.probesIn !== null ? STAB_MIN : 0) + cyc : null);
    } else {
      s = t.alAdj !== null ? t.alAdj : t.alStart;
      e = t.alEnd !== null ? t.alEnd : (s !== null ? s + (t.alAdj !== null ? STAB_MIN : 0) + cyc : null);
    }
    if (s === null) {                       // no times yet: from now, if the worksheet is for today
      if (me.date !== isoOf(new Date())) return null;
      s = nowAbs(); e = s + STAB_MIN + cyc;
    }
    if (e === null || e <= s) e = s + 1;
    return { s: s, e: e };
  }
  function probeNotes(row) {
    var c = context();
    if (!c || !c.me.therm) return {};
    var w = probeWindow(c.me, row), notes = {};
    if (!w) return notes;
    c.list.forEach(function (x) {
      x.u.holds.forEach(function (h) {
        if (!(w.s < h.e && h.s < w.e)) return;
        var txt = 'in ' + shortLabel(x.u) + (h.s > w.s ? ' ' + hhmm(h.s) + '–' + hhmm(h.e) : ' until ' + hhmm(h.e)) + (x.lv === 'warn' ? ', old draft' : '');
        (notes[h.probe] = notes[h.probe] || []).push(txt);
      });
    });
    return notes;
  }
  function clearProbeNotes(sel) {
    var list = sel ? [sel] : global.document.querySelectorAll('select.probe');
    Array.prototype.forEach.call(list, function (s) {
      Array.prototype.forEach.call(s.options, function (o) {
        if (o.hasAttribute(NOTE_ATTR)) { o.text = o.getAttribute(NOTE_ATTR); o.removeAttribute(NOTE_ATTR); }
      });
    });
  }
  function noteProbes(sel) {
    if (!sel || sel.disabled || !/^(af|al)_/.test(sel.id)) return;
    clearProbeNotes(sel);
    var notes;
    try { notes = probeNotes(sel.id.slice(0, 2)); } catch (e) { return; }
    Array.prototype.forEach.call(sel.options, function (o) {
      if (!o.value) return;
      var n = notes[norm(o.value)];
      if (!n || !n.length) return;
      o.setAttribute(NOTE_ATTR, o.text);
      o.text = o.text + ' — ' + n.join('; ');
    });
  }
  function wireProbeNotes() {
    var d = global.document;
    if (!d || !thisSheet() || d.__schedProbeNotes) return;
    d.__schedProbeNotes = true;
    var open = function (e) { var s = e.target; if (s && s.tagName === 'SELECT' && s.classList.contains('probe')) noteProbes(s); };
    var close = function (e) { var s = e.target; if (s && s.tagName === 'SELECT' && s.classList.contains('probe')) clearProbeNotes(s); };
    // capture phase: runs BEFORE the worksheet's own input/change handlers
    d.addEventListener('touchstart', open, true);
    d.addEventListener('mousedown', open, true);
    d.addEventListener('focus', open, true);
    d.addEventListener('input', close, true);
    d.addEventListener('change', close, true);
    d.addEventListener('blur', close, true);
    global.addEventListener('beforeprint', function () { clearProbeNotes(); });
  }

  // ---- "Thermometer — today" strip under the timing band -------------------
  function stripData() {
    var c = context();
    if (!c || !c.me.therm) return null;
    var me = c.me, day = dayNum(me.date), lo = day * 1440, hi = lo + 1440 + OVERNIGHT_MAX_MIN;
    var blocks = [];
    me.measure.forEach(function (m) { blocks.push({ s: m.s, e: m.e, row: m.row, mine: true, who: 'This unit', full: 'This unit' }); });
    c.list.forEach(function (x) {
      x.u.measure.forEach(function (m) {
        if (m.e <= lo || m.s >= hi) return;
        var clash = me.measure.some(function (a) { return a.s < m.e && m.s < a.e; });
        blocks.push({ s: m.s, e: m.e, row: m.row, mine: false, clash: clash, draft: x.lv === 'warn', who: shortLabel(x.u), full: label(x.u), link: x.u.job ? link(x.u) : '' });
      });
    });
    if (!blocks.length) return null;
    blocks.sort(function (a, b) { return a.s - b.s; });
    var s0 = Math.min.apply(null, blocks.map(function (b) { return b.s; })), e0 = Math.max.apply(null, blocks.map(function (b) { return b.e; }));
    var from = Math.floor((s0 - 15) / 60) * 60, to = Math.ceil((e0 + 15) / 60) * 60;
    if (to - from < 120) to = from + 120;
    return { therm: me.therm, blocks: blocks, from: from, to: to };
  }

  function stripStyle() {
    var d = global.document;
    if (d.getElementById('labcalSchedStyle')) return;
    var st = d.createElement('style');
    st.id = 'labcalSchedStyle';
    st.textContent =
      '.schedStrip{padding:4px 4px 6px;text-align:left;font-size:11px;color:#333}' +
      '.schedStrip .ssHead{font-weight:700;margin-bottom:3px}' +
      '.schedStrip .ssAxis{position:relative;height:50px;background:#f3f3f3;border:1px solid #ccc;border-radius:4px}' +
      '.schedStrip .ssTick{position:absolute;top:0;bottom:0;border-left:1px dotted #bbb}' +
      '.schedStrip .ssTick span{position:absolute;top:-1px;left:2px;font-size:9px;color:#777}' +
      '.schedStrip .ssBlk{position:absolute;top:11px;height:18px;border-radius:3px;background:#9a9a9a;color:#fff;font-size:10px;line-height:19px;overflow:hidden;white-space:nowrap;text-overflow:ellipsis;padding:0 3px;box-sizing:border-box;border:0;cursor:pointer;min-width:6px;touch-action:manipulation}' +
      '.schedStrip .ssBlk.mine{background:#1a5fb4;top:30px}' +
      '.schedStrip .ssBlk.clash{background:#b00020}' +
      '.schedStrip .ssBlk.draft{background:repeating-linear-gradient(45deg,#b58a2a,#b58a2a 4px,#d6b25e 4px,#d6b25e 8px)}' +
      '.schedStrip .ssInfo{margin-top:4px;min-height:14px}' +
      '.schedStrip .ssInfo a{color:#1a5fb4;font-weight:700;text-decoration:underline;display:inline-block;padding:4px 2px}' +
      '.printMode .schedStrip,.printMode .timingMsgs div.timingWarn{display:none!important}' +
      '@media print{.schedStrip{display:none!important}}' +
      '.thermToday{margin:10px 0;padding:10px 12px;border:1px solid #cfd8e3;border-radius:10px;background:#f7faff;font-size:13px;color:#222}' +
      '.thermToday .tdHead{font-weight:700;font-size:12px;letter-spacing:.04em;text-transform:uppercase;color:#445;margin-bottom:6px}' +
      '.thermToday .tdTherm{padding:6px 0;border-top:1px solid #e1e7ef}' +
      '.thermToday .tdTherm:first-of-type{border-top:0}' +
      '.thermToday .tdName{margin-bottom:3px}' +
      '.thermToday .tdNow{color:#2a7a2a;font-size:12px}' +
      '.thermToday .tdNow.busy{color:#1a5fb4;font-weight:700}' +
      '.thermToday .tdUnit{display:flex;flex-wrap:wrap;align-items:center;gap:4px 10px;padding:3px 0 3px 10px;border-left:3px solid #bbb;margin:2px 0}' +
      '.thermToday .tdUnit.meas{border-left-color:#1a5fb4}' +
      '.thermToday .tdUnit.stab{border-left-color:#2a7a2a}' +
      '.thermToday .tdUnit.wait{border-left-color:#b36b00;color:#8a5a00}' +
      '.thermToday .tdUnit.done{color:#666}' +
      '.thermToday .tdUnit.draft{border-left-style:dashed}' +
      '.thermToday .tdWho{font-weight:700;min-width:120px}' +
      '.thermToday .tdWho small{font-weight:400;color:#666}' +
      '.thermToday .tdState{flex:1}' +
      '.thermToday a.tdOpen{color:#1a5fb4;font-weight:700;text-decoration:underline;padding:6px 4px;min-height:32px;display:inline-flex;align-items:center}';
    d.head.appendChild(st);
  }

  function renderStrip() {
    var d = global.document;
    var band = d && d.getElementById('timingBand');
    if (!band) return;
    var box = d.getElementById('schedStrip');
    var data = null;
    try { data = stripData(); } catch (e) { console.warn('LabCalSchedule: strip failed', e); }
    if (!data) { if (box) box.style.display = 'none'; return; }
    stripStyle();
    if (!box) {
      var tr = d.createElement('tr');
      tr.id = 'schedStripRow';
      tr.setAttribute('data-html2canvas-ignore', 'true');
      tr.innerHTML = '<td colspan="7" style="padding:0"><div id="schedStrip" class="schedStrip" data-html2canvas-ignore="true"></div></td>';
      (band.tBodies[0] || band).appendChild(tr);
      box = d.getElementById('schedStrip');
      box.addEventListener('click', function (e) {
        var b = e.target && e.target.closest ? e.target.closest('.ssBlk') : null;
        if (!b) return;
        e.preventDefault();
        var info = box.querySelector('.ssInfo');
        info.textContent = b.getAttribute('data-full') + ' · ' + b.getAttribute('data-what');
        var href = b.getAttribute('data-link');
        if (href) { var a = d.createElement('a'); a.href = href; a.textContent = 'Open ›'; info.appendChild(d.createTextNode(' ')); info.appendChild(a); }
      });
    }
    box.style.display = '';
    var span = data.to - data.from, pct = function (v) { return ((v - data.from) / span * 100).toFixed(2) + '%'; };
    var html = '<div class="ssHead">Thermometer ' + esc(data.therm) + ' — today</div><div class="ssAxis">';
    for (var h = data.from; h <= data.to; h += 60) html += '<div class="ssTick" style="left:' + pct(h) + '"><span>' + hhmm(h).slice(0, 2) + '</span></div>';
    data.blocks.forEach(function (b) {
      var cls = 'ssBlk' + (b.mine ? ' mine' : b.clash ? ' clash' : b.draft ? ' draft' : '');
      var what = (b.row === 'af' ? 'As Found ' : 'As Left ') + hhmm(b.s) + '–' + hhmm(b.e) + (b.clash ? ' — overlaps this unit' : '') + (b.draft ? ' — old draft, no certificate' : '');
      html += '<button type="button" class="' + cls + '" style="left:' + pct(b.s) + ';width:' + ((b.e - b.s) / span * 100).toFixed(2) + '%"' +
        ' data-full="' + esc(b.full) + '" data-what="' + esc(what) + '" data-link="' + esc(b.link || '') + '" title="' + esc(b.full + ' · ' + what) + '">' +
        esc((b.mine ? 'This' : b.who) + ' ' + (b.row === 'af' ? 'AF' : 'AL')) + '</button>';
    });
    html += '</div><div class="ssInfo">Tap a block to see whose unit it is.</div>';
    box.innerHTML = html;
  }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }

  // ---- "Thermometers today" (v1.596) ------------------------------------------
  // One row per thermometer; every unit with times today and its state now.
  // v1.597 (Radek): the panel was taken OFF the job page — too much clutter.
  // today() / renderToday() are kept (tested) for a later, folded version.
  function today(at) {
    var now = at || new Date(), iso = isoOf(now), nAbs = dayNum(iso) * 1440 + now.getHours() * 60 + now.getMinutes();
    var levels = levelMemo(), byTherm = {};
    others('').forEach(function (u) {
      if (!u.therm || u.date !== iso) return;
      var t = u.t;
      if (t.probesIn === null && t.afStart === null && t.alAdj === null) return;
      var st = standing(u);
      if (st.skip) return;
      (byTherm[u.therm] = byTherm[u.therm] || []).push({ u: u, done: st.done, draft: levels(u) === 'warn' });
    });
    return Object.keys(byTherm).sort().map(function (th) {
      var units = byTherm[th];
      var busyNow = null, next = null;
      units.forEach(function (x) {
        x.u.measure.forEach(function (m) {
          if (m.s <= nAbs && nAbs < m.e) busyNow = { x: x, m: m };
          else if (m.s > nAbs && (!next || m.s < next.m.s)) next = { x: x, m: m };
        });
      });
      units.forEach(function (x) { x.state = stateOf(x, nAbs, busyNow); x.sortAt = firstTime(x.u); });
      units.sort(function (a, b) { return a.sortAt - b.sortAt; });
      var head = busyNow ? 'measuring ' + shortLabel(busyNow.x.u) + ' until ' + hhmm(busyNow.m.e)
        : next ? 'free — next ' + shortLabel(next.x.u) + ' at ' + hhmm(next.m.s) : 'free';
      return { therm: th, head: head, busy: !!busyNow, units: units.map(function (x) {
        return { label: label(x.u), short: shortLabel(x.u), sheet: x.u.sheet, job: x.u.job, serial: x.u.serial, state: x.state.text, kind: x.state.kind,
                 done: x.done, draft: x.draft, link: x.u.job ? link(x.u) : '' };
      }) };
    });
  }
  function firstTime(u) { var t = u.t; return [t.probesIn, t.afStart, t.alAdj, t.alStart].filter(function (v) { return v !== null; })[0] || 0; }
  function stateOf(x, n, busyNow) {
    var t = x.u.t;
    var waiting = function (ready) {
      if (busyNow && busyNow.x !== x && ready <= n) return { kind: 'wait', text: 'waiting for thermometer — free ' + hhmm(busyNow.m.e) };
      return null;
    };
    if (t.alEnd !== null && n >= t.alEnd) return { kind: 'done', text: 'finished ' + hhmm(t.alEnd) + (x.done ? ' ✓' : '') };
    if (t.alStart !== null && n >= t.alStart) return { kind: 'meas', text: 'measuring As Left' + (t.alEnd !== null ? ' until ' + hhmm(t.alEnd) : '') };
    if (t.alAdj !== null && n >= t.alAdj) {
      var r = t.alAdj + STAB_MIN;
      return waiting(r) || { kind: 'stab', text: 're-stabilising — As Left from ' + hhmm(t.alStart !== null ? t.alStart : r) };
    }
    if (t.afEnd !== null && n >= t.afEnd) {
      if (t.alAdj !== null) return { kind: 'adj', text: 'As Found finished ' + hhmm(t.afEnd) + ' — adjusting, probes back in ' + hhmm(t.alAdj) };
      return { kind: x.done ? 'done' : 'af', text: (x.done ? 'finished ' : 'As Found finished ') + hhmm(t.afEnd) + (x.done ? ' ✓' : '') };
    }
    if (t.afStart !== null && n >= t.afStart) return { kind: 'meas', text: 'measuring As Found' + (t.afEnd !== null ? ' until ' + hhmm(t.afEnd) : '') };
    if (t.probesIn !== null && n >= t.probesIn) {
      var ready = t.probesIn + STAB_MIN;
      if (t.afStart !== null) return { kind: 'stab', text: 'stabilising — As Found from ' + hhmm(t.afStart) };
      return waiting(ready) || { kind: 'stab', text: ready > n ? 'stabilising — ready ' + hhmm(ready) : 'stabilised — ready since ' + hhmm(ready) };
    }
    var first = firstTime(x.u);
    return { kind: 'plan', text: 'probes in at ' + hhmm(first) };
  }

  function renderToday(el) {
    if (!el) return;
    var rows = [];
    try { rows = today(); } catch (e) { console.warn('LabCalSchedule: today panel failed', e); }
    if (!rows.length) { el.style.display = 'none'; el.innerHTML = ''; return; }
    stripStyle();
    el.style.display = '';
    el.innerHTML = '<div class="tdHead">Thermometers today</div>' + rows.map(function (r) {
      return '<div class="tdTherm"><div class="tdName"><b>' + esc(r.therm) + '</b> <span class="tdNow' + (r.busy ? ' busy' : '') + '">' + esc(r.head) + '</span></div>' +
        r.units.map(function (u) {
          return '<div class="tdUnit ' + u.kind + (u.draft ? ' draft' : '') + '"><span class="tdWho">' + esc(u.short) + (u.job ? ' <small>' + esc(u.job) + '</small>' : '') + '</span>' +
            '<span class="tdState">' + esc(u.state) + (u.draft ? ' (old draft)' : '') + '</span>' +
            (u.link ? '<a class="tdOpen" href="' + esc(u.link) + '">Open ›</a>' : '') + '</div>';
        }).join('') + '</div>';
    }).join('');
  }

  function ago(iso) {
    var t = Date.parse(iso);
    if (isNaN(t)) return 'some time ago';
    try { return new Date(t).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }); } catch (e) { return String(iso); }
  }

  // Another tab saved a unit → re-check this one (the timing band redraws).
  var pending = null;
  if (global.addEventListener) {
    global.addEventListener('storage', function (e) {
      if (!e || !e.key || e.key.indexOf(PREFIX) !== 0) return;
      if (pending) global.clearTimeout(pending);
      pending = global.setTimeout(function () {
        pending = null;
        try { if (global.LabCalTiming && thisSheet()) global.LabCalTiming.check(); } catch (x) {}
      }, 300);
    });
  }

  try { wireProbeNotes(); } catch (e) {}

  global.LabCalSchedule = {
    check: check,
    planFor: planFor,          // v1.596 stage 2
    clashesAt: clashesAt,
    earliest: earliest,
    renderStrip: renderStrip,
    noteProbes: noteProbes,
    clearProbeNotes: clearProbeNotes,
    today: today,
    renderToday: renderToday,
    _unitFrom: unitFrom,
    _others: others,
    STALE_MS: STALE_MS
  };
})(typeof window !== 'undefined' ? window : this);

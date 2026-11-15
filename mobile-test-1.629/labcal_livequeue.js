(window.LabCalBuild = window.LabCalBuild || {})['labcal_livequeue.js'] = 'v1.629';  // file version — see labcal_build.js
/* ---------------------------------------------------------------------
   LabCal — times sent from Live probes to a worksheet (v1.625)
   ---------------------------------------------------------------------
   Radek (9 Nov 2026) chose the "queue" way for the Live probes planner:

   • Live probes NEVER writes a worksheet's readings. The rule from v1.559
     stays: only the tab that owns a unit writes its readings.
   • In Live probes the engineer taps a time (now or earlier — never a
     future time) and "Send to worksheet". That time goes into this queue.
   • The worksheet takes it the next time it runs with THAT unit on it
     (an iPad pauses tabs in the background, so usually when the engineer
     goes to the unit's tab, or opens the unit). It enters the time through
     the same path as its own time picker, so every timing rule (30 min
     stabilising, 20/40 min cycle, thermometer busy, midnight) and the
     autosave work exactly as for a hand-picked time.
   • A time already on the worksheet is never replaced silently: the
     worksheet asks.
   • The worksheet writes back what happened (entered / problem / kept),
     which Live probes shows.

   Storage (localStorage, shared by the tabs):
     labcal.live.q.<JOB>|<SERIAL>     { job, serial, sheet, items:[{id, base, h, m, day, at}] }
     labcal.live.res.<JOB>|<SERIAL>   [{ id, base, h, m, ok, kept?, msg, at }]  (newest last, max 10)
   A time is for TODAY only: a queued time from an earlier day is dropped
   by the worksheet with a note (it is never entered on another day).

   v1.626 (Radek, 9 Nov 2026 — planner stage 2): PROBES can be sent too.
     item { id, base:'probes', probes:{ air1:'1A', air2:'2B', load:'3A' }, day, at }
   One probes item per unit (the newest wins); it goes before the times, so
   the worksheet has its probes when "Probes loaded at" goes in. The
   worksheet sets them exactly like a probe picked from its own list (the
   correction values then come from the offsets file as always). Radek's
   rules: different probes already on the worksheet AND As Found readings
   already entered → NOT entered (changing a probe would change the
   correction of readings already taken); different probes, no readings →
   the worksheet asks. A probe in use in another unit cannot be picked in
   Live probes. Columns per worksheet: PROBE_COLS.

   v1.627 (Radek, 9 Nov 2026 — planner stage 3): PLANS. A time LATER than
   now is a plan, not something to send:
     labcal.live.plan.<JOB>|<SERIAL>  { id, job, serial, sheet, base, h, m, day, at, probes? }
   One plan per unit (its next step), for TODAY only. Plans live here and in
   Live probes ONLY — no worksheet ever reads them (the rule stays: a
   worksheet takes only confirmed now / earlier times, through its own
   checks). When the planned time comes, Live probes offers "Send now",
   which goes through put() / putProbes() like any other time.
   --------------------------------------------------------------------- */
(function (global) {
  'use strict';

  var Q_PREFIX = 'labcal.live.q.';
  var R_PREFIX = 'labcal.live.res.';
  var P_PREFIX = 'labcal.live.plan.';   // v1.627
  var CHANGE_EVENT = 'labcal-livequeue-changed';
  var RES_KEEP_MS = 12 * 3600 * 1000;
  var BASES = ['af_probes_in', 'af_cycle_start', 'af_cycle_end', 'al_adjusted', 'al_cycle_start', 'al_cycle_end'];
  var LABELS = { af_probes_in: 'Probes loaded at', af_cycle_start: 'Cycle start', af_cycle_end: 'Cycle end',
                 al_adjusted: 'Adjusted at', al_cycle_start: 'AL Cycle start', al_cycle_end: 'AL Cycle end', probes: 'Probes' };

  // v1.626: the probe columns the engineer picks on each worksheet (As Found row).
  // The rest follow by themselves on the worksheet: As Left = As Found,
  // SMD/NSMD Chart = Load, 19/24 Load 1/2 = Air 1/2, IBB chart columns mirror.
  var PROBE_COLS = { smd: ['air1', 'air2', 'load'], nsmd: ['air1', 'air2', 'load'], ibb: ['air1', 'air2', 'load'],
                     snmd: ['air1', 'air2'], ws19_24: ['air1', 'air2'] };
  var COL_LABELS = { air1: 'Air 1', air2: 'Air 2', load: 'Load' };
  // NSMD and IBB can be "No Load Fitted" (set on the worksheet, which then
  // makes its Load probe N/A) — there Load may be left out. NSMD's Chart
  // Recorder with its own readings keeps its probe chosen on the worksheet.
  var OPTIONAL_COLS = { nsmd: ['load'], ibb: ['load'] };
  function optional(sheet, col) { return (OPTIONAL_COLS[sheet] || []).indexOf(col) !== -1; }
  // the worksheet's own rules (probeGroup / checkAirProbeGroups / checkLoadChartVsAirProbes):
  // Air 1 and Air 2 = one "…A" and one "…B" probe; Load is not one of the Air probes.
  function probeGroup(id) { var l = String(id || '').trim().slice(-1).toUpperCase(); return l === 'A' || l === 'B' ? l : null; }
  function checkProbes(sheet, probes) {
    var cols = PROBE_COLS[sheet];
    if (!cols) return { ok: false, reason: 'Probes cannot be sent to this worksheet.' };
    probes = probes || {};
    var miss = cols.filter(function (c) { return !optional(sheet, c) && !String(probes[c] || '').trim(); });
    if (miss.length) return { ok: false, reason: 'Choose a probe for ' + miss.map(function (c) { return COL_LABELS[c]; }).join(', ') + '.' };
    var g1 = probeGroup(probes.air1), g2 = probeGroup(probes.air2);
    if (!(g1 && g2 && g1 !== g2)) return { ok: false, reason: 'Air 1 and Air 2 must be one A probe and one B probe.' };
    if (probes.load && (probes.load === probes.air1 || probes.load === probes.air2)) return { ok: false, reason: 'The Load probe cannot be one of the Air probes.' };
    return { ok: true };
  }

  function ls() { try { return global.localStorage; } catch (e) { return null; } }
  function norm(v) { return String(v || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, ''); }
  function unitKey(job, serial) { var s = norm(serial); return s ? norm(job) + '|' + s : ''; }
  function read(k) { var s = ls(); try { var t = s && s.getItem(k); return t ? JSON.parse(t) : null; } catch (e) { return null; } }
  function write(k, v) {
    var s = ls();
    if (!s) return false;
    try { if (v === null) s.removeItem(k); else s.setItem(k, JSON.stringify(v)); }
    catch (e) { return false; }
    try { global.dispatchEvent(new CustomEvent(CHANGE_EVENT, { detail: { key: k } })); } catch (e) {}
    return true;
  }
  function pad2(n) { return String(n).padStart(2, '0'); }
  function todayIso(d) { d = d || new Date(); return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()); }
  function nowMin(d) { d = d || new Date(); return d.getHours() * 60 + d.getMinutes(); }
  function newId() { return 'q' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }

  // ---- Live probes side -------------------------------------------------
  // Queue one time. h/m = 'HH','MM' of TODAY. Refused: unknown pair, bad
  // time, a time later than now (plans are not sent to a worksheet).
  //   → { ok, item?, reason? }
  function put(job, serial, sheet, base, h, m) {
    var k = unitKey(job, serial);
    if (!k) return { ok: false, reason: 'This unit has no serial number.' };
    if (BASES.indexOf(base) === -1) return { ok: false, reason: 'Unknown time field.' };
    h = String(h); m = String(m);
    if (!/^\d\d$/.test(h) || !/^\d\d$/.test(m) || Number(h) > 23 || Number(m) > 59) return { ok: false, reason: 'Not a valid time.' };
    if (Number(h) * 60 + Number(m) > nowMin()) return { ok: false, reason: 'Only now or an earlier time can be sent to the worksheet.' };
    var q = read(Q_PREFIX + k) || { job: String(job || ''), serial: String(serial || ''), sheet: sheet || '', items: [] };
    q.sheet = sheet || q.sheet || '';
    q.items = (q.items || []).filter(function (it) { return it.base !== base; });   // one time per field — the newest wins
    var item = { id: newId(), base: base, h: h, m: m, day: todayIso(), at: Date.now() };
    q.items.push(item);
    q.items.sort(byOrder);
    if (!write(Q_PREFIX + k, q)) return { ok: false, reason: 'This iPad would not keep the time (storage full or blocked).' };
    return { ok: true, item: item };
  }
  // v1.626: queue the probes for a unit. probes = { air1, air2, load? } (ids
  // from the offsets file). Refused: unknown worksheet, a column missing, the
  // worksheet's A/B or Load rule broken.
  function putProbes(job, serial, sheet, probes) {
    var k = unitKey(job, serial);
    if (!k) return { ok: false, reason: 'This unit has no serial number.' };
    var chk = checkProbes(sheet, probes);
    if (!chk.ok) return chk;
    var clean = {};
    PROBE_COLS[sheet].forEach(function (c) { var v = String(probes[c] || '').trim(); if (v) clean[c] = v; });
    var q = read(Q_PREFIX + k) || { job: String(job || ''), serial: String(serial || ''), sheet: sheet || '', items: [] };
    q.sheet = sheet || q.sheet || '';
    q.items = (q.items || []).filter(function (it) { return it.base !== 'probes'; });
    var item = { id: newId(), base: 'probes', probes: clean, day: todayIso(), at: Date.now() };
    q.items.push(item);
    q.items.sort(byOrder);
    if (!write(Q_PREFIX + k, q)) return { ok: false, reason: 'This iPad would not keep the probes (storage full or blocked).' };
    return { ok: true, item: item };
  }
  // probes first, then the times AF → AL
  function byOrder(a, b) { return rank(a.base) - rank(b.base); }
  function rank(base) { return base === 'probes' ? -1 : BASES.indexOf(base); }
  // "Air 1 1A · Air 2 2B · Load 3A"
  function probesText(probes) {
    return Object.keys(probes || {}).map(function (c) { return (COL_LABELS[c] || c) + ' ' + probes[c]; }).join(' · ');
  }
  function pending(job, serial) {
    var q = read(Q_PREFIX + unitKey(job, serial));
    return q && q.items ? q.items.slice() : [];
  }
  // Withdraw one sent time (only while the worksheet has not taken it).
  function cancel(job, serial, id) {
    var k = Q_PREFIX + unitKey(job, serial), q = read(k);
    if (!q || !q.items) return false;
    var before = q.items.length;
    q.items = q.items.filter(function (it) { return it.id !== id; });
    if (q.items.length === before) return false;
    return write(k, q.items.length ? q : null);
  }
  function results(job, serial) {
    var list = read(R_PREFIX + unitKey(job, serial)) || [];
    var cut = Date.now() - RES_KEEP_MS;
    return list.filter(function (r) { return r && r.at > cut; });
  }
  function dropResult(job, serial, id) {
    var k = R_PREFIX + unitKey(job, serial);
    var list = (read(k) || []).filter(function (r) { return r.id !== id; });
    return write(k, list.length ? list : null);
  }
  // every unit with something queued: [{ job, serial, sheet, items }]
  function all() {
    var s = ls(), out = [];
    if (!s) return out;
    for (var i = 0; i < s.length; i++) {
      var k = s.key(i);
      if (!k || k.indexOf(Q_PREFIX) !== 0) continue;
      var q = read(k);
      if (q && q.items && q.items.length) out.push(q);
    }
    return out;
  }

  // ---- v1.627: plans (Live probes only — never read by a worksheet) -----
  // The steps that can be planned: the ones that START something. Cycle end
  // is filled by the worksheet from Cycle start (20 / 40 min).
  var PLAN_BASES = ['af_probes_in', 'af_cycle_start', 'al_adjusted', 'al_cycle_start'];
  // Plan the unit's next step at h:m TODAY. Refused: no serial, a step that
  // cannot be planned, a bad time, a time not later than now (send that).
  //   → { ok, item?, reason? }
  function putPlan(job, serial, sheet, base, h, m, probes) {
    var k = unitKey(job, serial);
    if (!k) return { ok: false, reason: 'This unit has no serial number.' };
    if (PLAN_BASES.indexOf(base) === -1) return { ok: false, reason: (LABELS[base] || 'This time') + ' cannot be planned — the worksheet fills it in.' };
    h = String(h); m = String(m);
    if (!/^\d\d$/.test(h) || !/^\d\d$/.test(m) || Number(h) > 23 || Number(m) > 59) return { ok: false, reason: 'Not a valid time.' };
    if (Number(h) * 60 + Number(m) <= nowMin()) return { ok: false, reason: 'A plan is for later today — send now or an earlier time to the worksheet instead.' };
    var item = { id: newId(), job: String(job || ''), serial: String(serial || ''), sheet: sheet || '', base: base, h: h, m: m, day: todayIso(), at: Date.now() };
    if (probes && PROBE_COLS[sheet]) {
      var clean = {};
      PROBE_COLS[sheet].forEach(function (c) { var v = String(probes[c] || '').trim(); if (v) clean[c] = v; });
      if (Object.keys(clean).length) {
        var chk = checkProbes(sheet, clean);
        if (!chk.ok) return chk;
        item.probes = clean;
      }
    }
    if (!write(P_PREFIX + k, item)) return { ok: false, reason: 'This iPad would not keep the plan (storage full or blocked).' };
    return { ok: true, item: item };
  }
  // the unit's plan for today, or null (a plan from another day is dropped)
  function plan(job, serial) {
    var k = unitKey(job, serial);
    if (!k) return null;
    var p = read(P_PREFIX + k);
    if (!p) return null;
    if (p.day !== todayIso()) { write(P_PREFIX + k, null); return null; }
    return p;
  }
  function dropPlan(job, serial) {
    var k = unitKey(job, serial);
    if (!k || !read(P_PREFIX + k)) return false;
    return write(P_PREFIX + k, null);
  }
  // every plan for today (older ones are dropped on the way)
  function plans() {
    var s = ls(), out = [], keys = [];
    if (!s) return out;
    for (var i = 0; i < s.length; i++) { var k = s.key(i); if (k && k.indexOf(P_PREFIX) === 0) keys.push(k); }
    keys.forEach(function (k) {
      var p = read(k);
      if (!p || p.day !== todayIso()) { write(k, null); return; }
      out.push(p);
    });
    return out;
  }

  // ---- worksheet side ---------------------------------------------------
  // Takes the unit's queue off (so no other tab can take it twice) and
  // returns its items. The caller MUST report every item with report().
  function take(job, serial) {
    var k = Q_PREFIX + unitKey(job, serial), q = read(k);
    if (!q || !q.items || !q.items.length) return [];
    write(k, null);
    return q.items.slice();
  }
  function report(job, serial, item, ok, msg, kept) {
    var k = R_PREFIX + unitKey(job, serial);
    var cut = Date.now() - RES_KEEP_MS;
    var list = (read(k) || []).filter(function (r) { return r && r.at > cut && r.id !== item.id; });
    var r = { id: item.id, base: item.base, h: item.h, m: item.m, ok: !!ok, kept: !!kept, msg: String(msg || ''), at: Date.now() };
    if (item.probes) r.probes = item.probes;   // v1.626
    list.push(r);
    while (list.length > 10) list.shift();
    return write(k, list);
  }

  global.LabCalLiveQueue = {
    put: put, putProbes: putProbes, checkProbes: checkProbes, probesText: probesText,   // v1.626
    PROBE_COLS: PROBE_COLS, COL_LABELS: COL_LABELS, OPTIONAL_COLS: OPTIONAL_COLS, optional: optional,
    pending: pending, cancel: cancel, results: results, dropResult: dropResult, all: all,
    take: take, report: report,
    putPlan: putPlan, plan: plan, dropPlan: dropPlan, plans: plans, PLAN_BASES: PLAN_BASES, P_PREFIX: P_PREFIX,   // v1.627
    unitKey: unitKey, todayIso: todayIso,
    BASES: BASES, LABELS: LABELS, Q_PREFIX: Q_PREFIX, R_PREFIX: R_PREFIX, CHANGE_EVENT: CHANGE_EVENT
  };
})(window);

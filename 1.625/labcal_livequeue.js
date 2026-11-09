(window.LabCalBuild = window.LabCalBuild || {})['labcal_livequeue.js'] = 'v1.625';  // file version — see labcal_build.js
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
   --------------------------------------------------------------------- */
(function (global) {
  'use strict';

  var Q_PREFIX = 'labcal.live.q.';
  var R_PREFIX = 'labcal.live.res.';
  var CHANGE_EVENT = 'labcal-livequeue-changed';
  var RES_KEEP_MS = 12 * 3600 * 1000;
  var BASES = ['af_probes_in', 'af_cycle_start', 'af_cycle_end', 'al_adjusted', 'al_cycle_start', 'al_cycle_end'];
  var LABELS = { af_probes_in: 'Probes loaded at', af_cycle_start: 'Cycle start', af_cycle_end: 'Cycle end',
                 al_adjusted: 'Adjusted at', al_cycle_start: 'AL Cycle start', al_cycle_end: 'AL Cycle end' };

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
    q.items.sort(function (a, b) { return BASES.indexOf(a.base) - BASES.indexOf(b.base); });
    if (!write(Q_PREFIX + k, q)) return { ok: false, reason: 'This iPad would not keep the time (storage full or blocked).' };
    return { ok: true, item: item };
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
    list.push({ id: item.id, base: item.base, h: item.h, m: item.m, ok: !!ok, kept: !!kept, msg: String(msg || ''), at: Date.now() });
    while (list.length > 10) list.shift();
    return write(k, list);
  }

  global.LabCalLiveQueue = {
    put: put, pending: pending, cancel: cancel, results: results, dropResult: dropResult, all: all,
    take: take, report: report,
    unitKey: unitKey, todayIso: todayIso,
    BASES: BASES, LABELS: LABELS, Q_PREFIX: Q_PREFIX, R_PREFIX: R_PREFIX, CHANGE_EVENT: CHANGE_EVENT
  };
})(window);

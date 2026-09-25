/* ---------------------------------------------------------------------
   LabCal — shared probe offsets vault
   ---------------------------------------------------------------------
   One place for the two probe-offset ecosystems, so the engineer loads
   each JSON file ONCE (on the LabCal home page) and every worksheet picks
   it up automatically for as long as the calibration certificate is valid.

   Storage:  localStorage, one key per ecosystem —
             labcal.offsets.dostmann
             labcal.offsets.fluke_comark
   Record:   { device, raw, fileName, savedAt }

   The two ecosystems stay strictly separate — a Dostmann file can never
   satisfy a Fluke & Comark worksheet, or the other way round.

   Everything here degrades safely: if localStorage is unavailable (private
   browsing, file:// on some browsers) every call still returns a sensible
   "nothing loaded" answer and the worksheets fall back to their own
   "Load offsets" button exactly as before.
   --------------------------------------------------------------------- */
(function (global) {
  'use strict';

  var PREFIX = 'labcal.offsets.';
  var CHANGE_EVENT = 'labcal-offsets-changed';

  // Warn this many days before the reference thermometer certificate runs out.
  var SOON_DAYS = 60;
  var CRITICAL_DAYS = 14;

  var DEVICES = {
    dostmann: {
      id: 'dostmann',
      name: 'Dostmann',
      full: 'Dostmann probe offsets',
      manager: 'Dostmann Offset Manager',
      used: 'Barkey · Standard Medical Device'
    },
    fluke_comark: {
      id: 'fluke_comark',
      name: 'Fluke & Comark',
      full: 'Fluke & Comark probe offsets',
      manager: 'Fluke & Comark Offset Manager',
      used: 'Standard Non-Medical · 19/24 Range · Monitoring Systems'
    }
  };
  var DEVICE_IDS = ['dostmann', 'fluke_comark'];

  var MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  // ---- dates -------------------------------------------------------------
  function isoToday() {
    var d = new Date();
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  }
  function pad(n) { return String(n).padStart(2, '0'); }
  function currentYearMonth() { return isoToday().slice(0, 7); }

  function monthLabel(ym) {
    var m = String(ym || '').match(/^(\d{4})-(\d{2})$/);
    if (!m) return '';
    return MONTHS[Number(m[2]) - 1] + '/' + m[1];
  }

  // A "valid until 2026-09" certificate is good through the LAST day of
  // September, so the countdown has to run to the end of that month.
  function daysLeft(ym) {
    var m = String(ym || '').match(/^(\d{4})-(\d{2})$/);
    if (!m) return null;
    var end = new Date(Number(m[1]), Number(m[2]), 0);      // day 0 of next month = last day of this one
    end.setHours(23, 59, 59, 999);
    var now = new Date();
    return Math.ceil((end - now) / 86400000);
  }

  // ---- reading an offsets file ------------------------------------------
  // Older Dostmann exports predate the `device` field; anything without one
  // is treated as Dostmann, which is how the worksheets have always read them.
  function deviceOf(raw) {
    if (!raw || typeof raw !== 'object') return null;
    if (raw.device === 'fluke_comark') return 'fluke_comark';
    if (raw.device === 'dostmann' || !raw.device) return 'dostmann';
    return null;
  }

  function probeCount(raw) {
    if (!raw) return 0;
    var src = raw.probes || raw.offsets;
    if (!src) return 0;
    if (Array.isArray(src)) return src.length;
    if (typeof src === 'object') return Object.keys(src).length;
    return 0;
  }

  // Returns { ok, device, probes, validUntil, error }
  function validate(raw, expectedDevice) {
    if (!raw || typeof raw !== 'object') {
      return { ok: false, error: 'That file is not a probe offsets export.' };
    }
    var device = deviceOf(raw);
    if (!device) {
      return { ok: false, error: 'Unrecognised thermometer type "' + raw.device + '" in this file.' };
    }
    if (expectedDevice && device !== expectedDevice) {
      return {
        ok: false, device: device,
        error: 'That is a ' + DEVICES[device].name + ' file — this slot needs a ' + DEVICES[expectedDevice].name + ' file.'
      };
    }
    var n = probeCount(raw);
    if (!n) {
      return { ok: false, device: device, error: 'No probe data found in that file.' };
    }
    if (!raw.validUntil || !/^\d{4}-\d{2}$/.test(raw.validUntil)) {
      return {
        ok: false, device: device,
        error: 'That file has no "valid until" date. Set one in the ' + DEVICES[device].manager + ' and export again.'
      };
    }
    return { ok: true, device: device, probes: n, validUntil: raw.validUntil };
  }

  // ---- storage -----------------------------------------------------------
  // The availability probe writes a throwaway key. That write must NOT sit
  // under PREFIX, and must NOT be repeated on every read: every write raises a
  // `storage` event in every OTHER tab of this site, so a probe inside the
  // watched prefix made two open tabs answer each other forever — each one
  // re-rendering its tiles hundreds of times a second until every tab was
  // closed. Probe once, off-prefix, and cache the answer.
  var PROBE_KEY = '__labcal_storage_probe__';
  var storageChecked = false;
  var storageRef = null;
  function storage() {
    if (storageChecked) return storageRef;
    storageChecked = true;
    try {
      var s = global.localStorage;
      s.setItem(PROBE_KEY, '1');
      s.removeItem(PROBE_KEY);
      storageRef = s;
    } catch (e) { storageRef = null; }
    return storageRef;
  }

  function deviceKeys() {
    return DEVICE_IDS.map(function (d) { return PREFIX + d; });
  }

  // Cheap fingerprint of what is actually in the vault, so listeners can tell
  // a real change from noise and skip redundant redraws entirely.
  function signature() {
    return DEVICE_IDS.map(function (d) {
      var rec = readRecord(d);
      return d + ':' + (rec ? (rec.savedAt || '') + '|' + (rec.raw.validUntil || '') : '-');
    }).join(';');
  }

  function readRecord(device) {
    var s = storage(); if (!s) return null;
    try {
      var txt = s.getItem(PREFIX + device);
      if (!txt) return null;
      var rec = JSON.parse(txt);
      if (!rec || !rec.raw) return null;
      // Guard against a file being filed under the wrong ecosystem by an
      // older/edited copy of the suite.
      if (deviceOf(rec.raw) !== device) return null;
      return rec;
    } catch (e) { return null; }
  }

  function save(raw, fileName) {
    var v = validate(raw);
    if (!v.ok) return v;
    var s = storage();
    if (!s) return { ok: false, device: v.device, error: 'This browser will not let LabCal remember files (private browsing?). The worksheet still works — load the file there instead.' };
    var rec = { device: v.device, raw: raw, fileName: fileName || '', savedAt: new Date().toISOString() };
    try {
      s.setItem(PREFIX + v.device, JSON.stringify(rec));
    } catch (e) {
      return { ok: false, device: v.device, error: 'Not enough browser storage left to remember this file.' };
    }
    announce(v.device);
    return { ok: true, device: v.device, probes: v.probes, validUntil: v.validUntil };
  }

  function load(device) {
    var rec = readRecord(device);
    return rec ? rec.raw : null;
  }

  function remove(device) {
    var s = storage(); if (!s) return;
    try { s.removeItem(PREFIX + device); } catch (e) {}
    announce(device);
  }

  // ---- status ------------------------------------------------------------
  // level: none | expired | critical | soon | ok
  function info(device) {
    var meta = DEVICES[device] || { id: device, name: device, full: device, manager: '', used: '' };
    var rec = readRecord(device);
    if (!rec) {
      return {
        device: device, meta: meta, loaded: false, level: 'none',
        headline: 'Not loaded', detail: 'Load the ' + meta.name + ' offsets file to unlock its worksheets.'
      };
    }
    var raw = rec.raw;
    var left = daysLeft(raw.validUntil);
    var label = monthLabel(raw.validUntil);
    var expired = raw.validUntil < currentYearMonth();
    var level = expired ? 'expired' : (left <= CRITICAL_DAYS ? 'critical' : (left <= SOON_DAYS ? 'soon' : 'ok'));
    var headline, detail;
    if (expired) {
      headline = 'EXPIRED ' + label;
      detail = 'This certificate ran out ' + Math.abs(left) + ' day' + (Math.abs(left) === 1 ? '' : 's') + ' ago. No certificate can be generated until the thermometer is recalibrated and a new file is loaded.';
    } else if (level === 'critical') {
      headline = left + ' day' + (left === 1 ? '' : 's') + ' left';
      detail = 'Certificate runs out at the end of ' + label + '. Book the recalibration now.';
    } else if (level === 'soon') {
      headline = left + ' days left';
      detail = 'Certificate runs out at the end of ' + label + '.';
    } else {
      headline = 'Valid to ' + label;
      detail = left + ' days left on this certificate.';
    }
    return {
      device: device, meta: meta, loaded: true, level: level,
      headline: headline, detail: detail,
      validUntil: raw.validUntil, validLabel: label, daysLeft: left, expired: expired,
      probes: probeCount(raw),
      refThermSerial: raw.refThermSerial || '',
      engineerName: raw.engineerName || '',
      roomTherms: Array.isArray(raw.roomTherms) ? raw.roomTherms.length : 0,
      stopwatches: Array.isArray(raw.stopwatches) ? raw.stopwatches.length : 0,
      fileName: rec.fileName || '',
      savedAt: rec.savedAt || ''
    };
  }

  function all() { return DEVICE_IDS.map(info); }

  // Is this ecosystem usable for calibration right now?
  function isCurrent(device) {
    var i = info(device);
    return i.loaded && !i.expired;
  }

  function summary() {
    var list = all();
    var current = list.filter(function (i) { return i.loaded && !i.expired; });
    var worst = null;
    list.forEach(function (i) {
      if (!i.loaded) return;
      var rank = { expired: 0, critical: 1, soon: 2, ok: 3 };
      if (worst === null || rank[i.level] < rank[worst.level]) worst = i;
    });
    return {
      list: list,
      loadedCount: list.filter(function (i) { return i.loaded; }).length,
      currentCount: current.length,
      anyCurrent: current.length > 0,
      allCurrent: current.length === DEVICE_IDS.length,
      worst: worst
    };
  }

  // ---- change notification ----------------------------------------------
  function announce(device) {
    try {
      global.dispatchEvent(new CustomEvent(CHANGE_EVENT, { detail: { device: device } }));
    } catch (e) {
      // Very old browsers — CustomEvent constructor unavailable.
      try {
        var ev = global.document.createEvent('Event');
        ev.initEvent(CHANGE_EVENT, true, true);
        global.dispatchEvent(ev);
      } catch (e2) {}
    }
  }

  // Listeners are called at most once per real change. Bursts are coalesced
  // and a callback is skipped entirely when the vault contents are identical
  // to the last time it ran — so nothing can be redrawn in a tight loop, and
  // a tap can never land on a tile that is about to be replaced.
  function onChange(fn) {
    if (typeof fn !== 'function') return;
    var last = signature();
    var queued = false;
    function trigger() {
      if (queued) return;
      queued = true;
      global.setTimeout(function () {
        queued = false;
        var now = signature();
        if (now === last) return;   // nothing actually changed — do nothing
        last = now;
        try { fn(); } catch (e) {}
      }, 60);
    }
    global.addEventListener(CHANGE_EVENT, trigger);
    // Another tab (home page open alongside a worksheet) changing the vault.
    // Only the two real ecosystem keys count; everything else on this origin
    // — worksheet autosaves included — is ignored.
    global.addEventListener('storage', function (e) {
      if (!e || !e.key) return;
      if (deviceKeys().indexOf(e.key) === -1) return;
      trigger();
    });
  }

  // ---- file helper -------------------------------------------------------
  // Read a File chosen from an <input type="file">, validate it, store it.
  // Returns a promise for the same shape as validate(), plus .raw on success.
  function ingestFile(file, expectedDevice) {
    return new Promise(function (resolve) {
      if (!file) { resolve({ ok: false, error: 'No file selected.' }); return; }
      var fr = new FileReader();
      fr.onerror = function () { resolve({ ok: false, error: 'That file could not be read.' }); };
      fr.onload = function () {
        var raw;
        try { raw = JSON.parse(fr.result); }
        catch (e) { resolve({ ok: false, error: 'That file is not valid JSON — export a fresh copy from the Offset Manager.' }); return; }
        var v = validate(raw, expectedDevice);
        if (!v.ok) { resolve(v); return; }
        var saved = save(raw, file.name);
        // Even if it could not be remembered, hand the data back so the page
        // can still use it for this session.
        resolve({ ok: true, device: v.device, probes: v.probes, validUntil: v.validUntil, raw: raw, remembered: !!saved.ok, warning: saved.ok ? '' : saved.error });
      };
      fr.readAsText(file);
    });
  }

  global.LabCalOffsets = {
    DEVICES: DEVICES,
    DEVICE_IDS: DEVICE_IDS,
    SOON_DAYS: SOON_DAYS,
    CHANGE_EVENT: CHANGE_EVENT,
    currentYearMonth: currentYearMonth,
    monthLabel: monthLabel,
    daysLeft: daysLeft,
    deviceOf: deviceOf,
    probeCount: probeCount,
    validate: validate,
    save: save,
    load: load,
    remove: remove,
    info: info,
    all: all,
    isCurrent: isCurrent,
    summary: summary,
    onChange: onChange,
    signature: signature,
    ingestFile: ingestFile,
    available: function () { return !!storage(); }
  };
})(typeof window !== 'undefined' ? window : this);

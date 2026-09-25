/* ---------------------------------------------------------------------
   LabCal — backup & restore
   ---------------------------------------------------------------------
   Everything this suite remembers lives in browser storage, which iPadOS
   clears after roughly a week away from the site — and which any "clear
   website data" wipes instantly. This packs the lot into one file that can
   be saved to Files/iCloud through the normal share sheet, and put back on
   the same device or a new one.

   What goes in — ONLY the things that exist nowhere else:
     • probe offsets, both ecosystems, exactly as loaded
     • the learned model -> worksheet routing
     • the current jobsheet worklist and its cross-day progress
     • per-unit worksheet snapshots (part-finished readings)
     • certificate DETAILS (never the PDFs — see below)

   Certificate PDFs are deliberately NOT embedded. An early version did, and
   13 certificates produced a 23 MB single-line JSON that crashed the Files
   app on iPad every time it tried to preview it. Base64 also inflates every
   PDF by a third. Certificates are documents you already save and share from
   the calibration page; a settings backup is a few tens of KB and opens
   anywhere. Backups written by that earlier version can still be restored —
   the reader still understands an embedded PDF, the writer just never
   produces one.

   Restore MERGES. It never deletes anything already on the device:
     • offsets      — taken when the slot is empty or the backup's is newer
     • routes       — merged, newer 'updated' wins
     • progress     — union; a unit ticked in either place stays ticked
     • snapshots    — taken when absent or newer
     • certificates — added when not already present (filename + time)
   --------------------------------------------------------------------- */
(function (global) {
  'use strict';

  var SCHEMA = 2;
  // A backup should never get big enough to choke a file previewer.
  var SIZE_WARN_BYTES = 2 * 1024 * 1024;
  var KEY_LAST_BACKUP = 'labcal.backup.lastAt';
  var OFFSET_PREFIX = 'labcal.offsets.';
  var UNIT_PREFIX = 'labcal.unit.';

  function store() {
    try { return global.localStorage; } catch (e) { return null; }
  }
  function readJson(key, fallback) {
    var s = store(); if (!s) return fallback;
    try { var t = s.getItem(key); return t ? JSON.parse(t) : fallback; }
    catch (e) { return fallback; }
  }
  function writeJson(key, value) {
    var s = store(); if (!s) return false;
    try { s.setItem(key, JSON.stringify(value)); return true; }
    catch (e) { return false; }
  }

  function nowIso() { return new Date().toISOString(); }

  // ---- binary helpers ----------------------------------------------------
  function base64ToBlob(b64, type) {
    var bin = global.atob(b64);
    var len = bin.length;
    var bytes = new Uint8Array(len);
    for (var i = 0; i < len; i++) bytes[i] = bin.charCodeAt(i);
    return new Blob([bytes], { type: type || 'application/pdf' });
  }

  // ---- gathering ---------------------------------------------------------
  function collectLocalKeys(prefix) {
    var s = store(); if (!s) return {};
    var out = {};
    for (var i = 0; i < s.length; i++) {
      var k = s.key(i);
      if (!k || k.indexOf(prefix) !== 0) continue;
      try { out[k] = JSON.parse(s.getItem(k)); } catch (e) { /* skip unreadable */ }
    }
    return out;
  }

  function build(options) {
    options = options || {};
    var pack = {
      kind: 'labcal-backup',
      schema: SCHEMA,
      exportedAt: nowIso(),
      appVersion: options.appVersion || '',
      offsets: collectLocalKeys(OFFSET_PREFIX),
      routes: readJson('labcal.jobsheet.routes', {}),
      jobsheet: readJson('labcal.jobsheet.current', null),
      progress: readJson('labcal.jobsheet.progress', {}),
      units: collectLocalKeys(UNIT_PREFIX),
      certificates: []
    };

    if (!global.LabCalCerts || !global.LabCalCerts.supported()) return Promise.resolve(pack);

    return global.LabCalCerts.days().then(function (days) {
      var all = [];
      var chain = Promise.resolve();
      days.forEach(function (d) {
        chain = chain.then(function () {
          return global.LabCalCerts.listDay(d.day).then(function (list) { all = all.concat(list); });
        });
      });
      return chain.then(function () { return all; });
    }).then(function (all) {
      var chain = Promise.resolve();
      all.forEach(function (rec) {
        chain = chain.then(function () {
          var entry = {
            day: rec.day, savedAt: rec.savedAt, filename: rec.filename,
            certRef: rec.certRef, serial: rec.serial, model: rec.model,
            site: rec.site, jobRef: rec.jobRef, sheet: rec.sheet,
            size: rec.size, superseded: !!rec.superseded,
            summary: rec.summary || '', summaryTone: rec.summaryTone || ''
          };
          // Details only. The PDF itself stays out — see the note at the top.
          pack.certificates.push(entry);
        });
      });
      return chain.then(function () { return pack; });
    }).catch(function () { return pack; });
  }

  // Rough size of the finished file, so the size is known before saving.
  function estimate(options) {
    return build(options).then(function (pack) {
      return { bytes: JSON.stringify(pack).length, certificates: pack.certificates.length };
    });
  }

  function toBlob(pack) {
    return new Blob([JSON.stringify(pack)], { type: 'application/json' });
  }

  function fileName(now) {
    var d = now || new Date();
    function p(n) { return String(n).padStart(2, '0'); }
    return 'labcal_backup_' + d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate())
         + '_' + p(d.getHours()) + p(d.getMinutes()) + '.json';
  }

  function markBackedUp() {
    var s = store(); if (!s) return;
    try { s.setItem(KEY_LAST_BACKUP, nowIso()); } catch (e) {}
  }
  function lastBackupAt() {
    var s = store(); if (!s) return null;
    try { return s.getItem(KEY_LAST_BACKUP); } catch (e) { return null; }
  }
  function daysSinceBackup() {
    var at = lastBackupAt();
    if (!at) return null;
    return Math.floor((Date.now() - new Date(at).getTime()) / 86400000);
  }

  // ---- storage protection & health (v1.541) ------------------------------
  // iPadOS (Safari engine — Chrome on iPad included) may wipe all of this
  // site's storage after ~7 days away, or when the iPad runs low on space.
  // navigator.storage.persist() asks it not to. The browser decides; it
  // never prompts on iPad, so asking is harmless and is done on each visit.
  function requestPersist() {
    try {
      var st = global.navigator && global.navigator.storage;
      if (!st || !st.persist) return Promise.resolve(null);
      return st.persisted().then(function (already) {
        return already ? true : st.persist();
      }).catch(function () { return null; });
    } catch (e) { return Promise.resolve(null); }
  }

  // Opened from the Home Screen icon (its own storage, exempt from the
  // 7-day wipe) or in an ordinary browser tab?
  function isHomeScreenApp() {
    try {
      if (global.navigator && global.navigator.standalone === true) return true;
      if (!global.matchMedia) return false;
      return global.matchMedia('(display-mode: standalone)').matches ||
             global.matchMedia('(display-mode: fullscreen)').matches;
    } catch (e) { return false; }
  }

  // Characters held in localStorage. The iPad limit is about 5 MB per site
  // for localStorage, separate from IndexedDB, so this is what runs out
  // first as part-finished worksheets accumulate.
  function localStorageChars() {
    var s = store(); if (!s) return 0;
    var n = 0;
    try {
      for (var i = 0; i < s.length; i++) {
        var k = s.key(i) || '';
        n += k.length + String(s.getItem(k) || '').length;
      }
    } catch (e) {}
    return n;
  }
  var LOCAL_LIMIT_CHARS = 5 * 1024 * 1024;

  function storageStatus() {
    var out = {
      persisted: null,           // true / false / null (browser cannot say)
      homeScreen: isHomeScreenApp(),
      localChars: localStorageChars(),
      localLimitChars: LOCAL_LIMIT_CHARS,
      usage: null, quota: null   // whole site, incl. IndexedDB & offline cache
    };
    var st = null;
    try { st = global.navigator && global.navigator.storage; } catch (e) {}
    if (!st) return Promise.resolve(out);
    var p1 = st.persisted ? st.persisted().then(function (v) { out.persisted = !!v; }).catch(function () {}) : Promise.resolve();
    var p2 = st.estimate ? st.estimate().then(function (e) { out.usage = e.usage; out.quota = e.quota; }).catch(function () {}) : Promise.resolve();
    return Promise.all([p1, p2]).then(function () { return out; });
  }

  // ---- inspecting a backup before using it ------------------------------
  function inspect(pack) {
    if (!pack || pack.kind !== 'labcal-backup') throw new Error('That is not a LabCal backup file.');
    if (pack.schema > SCHEMA) throw new Error('That backup was written by a newer version of LabCal.');
    var offsets = Object.keys(pack.offsets || {}).map(function (k) {
      var rec = pack.offsets[k] || {};
      return {
        device: rec.device || k.replace(OFFSET_PREFIX, ''),
        validUntil: (rec.raw && rec.raw.validUntil) || '',
        savedAt: rec.savedAt || ''
      };
    });
    var certs = pack.certificates || [];
    return {
      exportedAt: pack.exportedAt || '',
      offsets: offsets,
      routes: Object.keys(pack.routes || {}).length,
      jobsheet: pack.jobsheet ? {
        callNumber: pack.jobsheet.callNumber || '',
        customer: pack.jobsheet.customer || '',
        devices: (pack.jobsheet.devices || []).length
      } : null,
      progressJobs: Object.keys(pack.progress || {}).length,
      units: Object.keys(pack.units || {}).length,
      certificates: certs.length,
      certificatesWithPdf: certs.filter(function (c) { return !!c.pdf; }).length
    };
  }

  // ---- restoring ---------------------------------------------------------
  function restore(pack) {
    inspect(pack);   // throws if it isn't a usable backup
    var report = { offsets: 0, routes: 0, progress: 0, units: 0, certificates: 0, skipped: 0 };
    var s = store();
    if (!s) return Promise.reject(new Error('This browser will not let LabCal write to storage.'));

    // --- offsets: only when missing, or the backup's copy is newer
    Object.keys(pack.offsets || {}).forEach(function (key) {
      var incoming = pack.offsets[key];
      if (!incoming || !incoming.raw) return;
      var existing = null;
      try { existing = JSON.parse(s.getItem(key)); } catch (e) {}
      if (existing && String(existing.savedAt || '') >= String(incoming.savedAt || '')) { report.skipped++; return; }
      try { s.setItem(key, JSON.stringify(incoming)); report.offsets++; } catch (e) {}
    });

    // --- learned routes: merged, newer 'updated' wins
    var routes = readJson('labcal.jobsheet.routes', {}) || {};
    Object.keys(pack.routes || {}).forEach(function (k) {
      var incoming = pack.routes[k];
      var mine = routes[k];
      var incomingUpdated = (incoming && incoming.updated) || '';
      var mineUpdated = (mine && mine.updated) || '';
      if (!mine || incomingUpdated > mineUpdated) { routes[k] = incoming; report.routes++; }
    });
    writeJson('labcal.jobsheet.routes', routes);

    // --- progress: union. A unit ticked in either place stays ticked.
    var progress = readJson('labcal.jobsheet.progress', {}) || {};
    Object.keys(pack.progress || {}).forEach(function (job) {
      progress[job] = progress[job] || {};
      Object.keys(pack.progress[job] || {}).forEach(function (serial) {
        if (!progress[job][serial] || !progress[job][serial].done) {
          progress[job][serial] = pack.progress[job][serial];
          report.progress++;
        }
      });
    });
    writeJson('labcal.jobsheet.progress', progress);

    // --- worklist: only when nothing is loaded, so a job in hand is never
    //     swapped out from under the engineer
    if (pack.jobsheet && !readJson('labcal.jobsheet.current', null)) {
      writeJson('labcal.jobsheet.current', pack.jobsheet);
    }

    // --- unit snapshots: taken when absent or newer
    Object.keys(pack.units || {}).forEach(function (key) {
      var incoming = pack.units[key];
      if (!incoming) return;
      var existing = null;
      try { existing = JSON.parse(s.getItem(key)); } catch (e) {}
      if (existing && String(existing.savedAt || '') >= String(incoming.savedAt || '')) { report.skipped++; return; }
      try { s.setItem(key, JSON.stringify(incoming)); report.units++; } catch (e) {}
    });

    // --- certificates: added when not already present
    var certs = (pack.certificates || []).filter(function (c) { return !!c.pdf; });
    if (!certs.length || !global.LabCalCerts || !global.LabCalCerts.supported()) {
      return Promise.resolve(report);
    }
    return global.LabCalCerts.days().then(function (days) {
      var have = [];
      var chain = Promise.resolve();
      days.forEach(function (d) {
        chain = chain.then(function () {
          return global.LabCalCerts.listDay(d.day).then(function (list) { have = have.concat(list); });
        });
      });
      return chain.then(function () { return have; });
    }).then(function (have) {
      var seen = {};
      have.forEach(function (r) { seen[(r.filename || '') + '|' + (r.savedAt || '')] = true; });
      var chain = Promise.resolve();
      certs.forEach(function (c) {
        if (seen[(c.filename || '') + '|' + (c.savedAt || '')]) { report.skipped++; return; }
        chain = chain.then(function () {
          var blob = base64ToBlob(c.pdf, 'application/pdf');
          return global.LabCalCerts.addRestored(blob, c).then(function () { report.certificates++; });
        });
      });
      return chain.then(function () { return report; });
    }).catch(function () { return report; });
  }

  global.LabCalBackup = {
    SCHEMA: SCHEMA,
    SIZE_WARN_BYTES: SIZE_WARN_BYTES,
    build: build,
    estimate: estimate,
    toBlob: toBlob,
    fileName: fileName,
    inspect: inspect,
    restore: restore,
    markBackedUp: markBackedUp,
    lastBackupAt: lastBackupAt,
    daysSinceBackup: daysSinceBackup,
    base64ToBlob: base64ToBlob,
    requestPersist: requestPersist,
    storageStatus: storageStatus,
    isHomeScreenApp: isHomeScreenApp
  };
})(typeof window !== 'undefined' ? window : this);

(window.LabCalBuild = window.LabCalBuild || {})['labcal_jobfiles.js'] = 'v1.600';  // file version — see labcal_build.js
/* ---------------------------------------------------------------------
   LabCal — the jobsheet PDF of each job (v1.585, Radek)
   ---------------------------------------------------------------------
   When a jobsheet PDF is loaded on the calibration page, the PDF itself is
   kept with its job (until v1.584 only its file name was), so it can be
   looked at on site from the job page and goes into the job pack as its own
   file (<JOB>_jobsheet.pdf) — NOT into the merged certificates PDF.

   Storage: its own small IndexedDB ("labcal-jobfiles"), separate from the
   certificate store, so the certificate database never needs upgrading.
   One PDF per job (key = job key, e.g. ENQ144403); loading the jobsheet of
   the same job again replaces it with the newer file.

   The file stays while the job is on the list or in the bin. When a job
   leaves the bin for good, the calibration page removes its PDF (tidy()).
   Not in the backup (the backup carries no PDFs at all).
   --------------------------------------------------------------------- */
(function (global) {
  'use strict';

  var DB_NAME = 'labcal-jobfiles';
  var DB_VERSION = 1;
  var STORE = 'files';

  function supported() {
    try { return !!global.indexedDB; } catch (e) { return false; }
  }

  var dbPromise = null;
  function open() {
    if (!supported()) return Promise.reject(new Error('This browser has no space to keep jobsheet PDFs.'));
    if (dbPromise) return dbPromise;
    dbPromise = new Promise(function (resolve, reject) {
      // same guard as labcal_certs.js: iOS can leave the open request hanging
      var settled = false;
      var timer = setTimeout(function () {
        if (settled) return;
        settled = true; dbPromise = null;
        reject(new Error('Jobsheet storage did not respond.'));
      }, 2500);
      var done = function (fn) { return function (arg) { if (settled) return; settled = true; clearTimeout(timer); fn(arg); }; };
      resolve = done(resolve); reject = done(reject);
      var req = global.indexedDB.open(DB_NAME, DB_VERSION);
      req.onblocked = function () { reject(new Error('Jobsheet storage is locked by another tab of this site.')); };
      req.onupgradeneeded = function () {
        var db = req.result;
        if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'key' });
      };
      req.onsuccess = function () {
        var db = req.result;
        // v1.587: iPadOS closes a database connection behind the page's back
        // (app sent to the background, memory pressure). The page kept using
        // the dead connection and every read failed with "The database
        // connection is closing". Forget it the moment it closes, so the next
        // read opens a fresh one.
        db.onclose = function () { if (dbPromise && dbPromise.__db === db) dbPromise = null; };
        db.onversionchange = function () { try { db.close(); } catch (e) {} if (dbPromise && dbPromise.__db === db) dbPromise = null; };
        if (dbPromise) dbPromise.__db = db;
        resolve(db);
      };
      req.onerror = function () { reject(req.error || new Error('Could not open the jobsheet store.')); };
    });
    return dbPromise;
  }
  // v1.587: if the connection turns out to be closed (iPadOS closes it
  // without always telling the page), open a fresh one and try once more.
  function tx(mode) {
    return open().then(function (db) {
      try { return db.transaction(STORE, mode).objectStore(STORE); }
      catch (e) {
        if (!e || (e.name !== 'InvalidStateError' && !/clos/i.test(String(e.message)))) throw e;
        console.warn('Jobsheet storage connection was closed — opening it again.');
        dbPromise = null;
        return open().then(function (db2) { return db2.transaction(STORE, mode).objectStore(STORE); });
      }
    });
  }
  // tests only: close the connection the way iPadOS does (without resetting it)
  function closeForTest() { return open().then(function (db) { db.onclose = null; db.close(); }); }

  function wrap(request) {
    return new Promise(function (resolve, reject) {
      request.onsuccess = function () { resolve(request.result); };
      request.onerror = function () { reject(request.error); };
    });
  }
  function jobKey(ref) { return String(ref || '').trim().toUpperCase() || 'NOJOB'; }

  function sha256Of(blob) {
    try {
      if (global.LabCalCerts && global.LabCalCerts.sha256Of) return global.LabCalCerts.sha256Of(blob);
    } catch (e) {}
    return Promise.resolve('');
  }

  // Keep this PDF as the jobsheet of job `ref`. Resolves with the stored
  // record's details (no blob), or rejects — the caller says so on screen.
  function put(ref, blob, fileName) {
    if (!blob || !blob.size) return Promise.reject(new Error('The jobsheet file is empty.'));
    var rec = {
      key: jobKey(ref), jobRef: String(ref || ''), fileName: fileName || (jobKey(ref) + '.pdf'),
      savedAt: new Date().toISOString(), size: blob.size, sha256: '',
      blob: blob.type === 'application/pdf' ? blob : new Blob([blob], { type: 'application/pdf' })
    };
    return sha256Of(rec.blob).then(function (h) { rec.sha256 = h || ''; })
      .then(function () { return tx('readwrite'); })
      .then(function (os) { return wrap(os.put(rec)); })
      .then(function () { return info(rec); });
  }
  function info(rec) {
    return rec ? { key: rec.key, jobRef: rec.jobRef, fileName: rec.fileName, savedAt: rec.savedAt, size: rec.size, sha256: rec.sha256 } : null;
  }
  function get(ref) {
    return tx('readonly').then(function (os) { return wrap(os.get(jobKey(ref))); }).then(function (r) { return r || null; });
  }
  function meta(ref) { return get(ref).then(info); }
  function remove(ref) {
    return tx('readwrite').then(function (os) { return wrap(os.delete(jobKey(ref))); });
  }
  function keys() {
    return tx('readonly').then(function (os) { return wrap(os.getAllKeys()); });
  }
  // Remove the PDFs of jobs that are neither on the list nor in the bin.
  function tidy(keepKeys) {
    var keep = {};
    (keepKeys || []).forEach(function (k) { keep[jobKey(k)] = true; });
    return keys().then(function (ks) {
      var gone = ks.filter(function (k) { return !keep[k]; });
      var chain = Promise.resolve();
      gone.forEach(function (k) { chain = chain.then(function () { return remove(k); }); });
      return chain.then(function () { return gone.length; });
    }).catch(function () { return 0; });
  }

  global.LabCalJobFiles = {
    supported: supported,
    _closeForTest: closeForTest,
    jobKey: jobKey,
    put: put,
    get: get,
    meta: meta,
    remove: remove,
    keys: keys,
    tidy: tidy
  };
})(typeof window !== 'undefined' ? window : this);

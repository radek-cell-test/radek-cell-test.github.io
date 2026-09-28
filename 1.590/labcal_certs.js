(window.LabCalBuild = window.LabCalBuild || {})['labcal_certs.js'] = 'v1.590';  // file version — see labcal_build.js
/* ---------------------------------------------------------------------
   LabCal — the day's certificates
   ---------------------------------------------------------------------
   Every PDF a worksheet generates is also kept here, so the calibration
   page can show what has been produced today: view it again, share it, or
   staple the whole day into one PDF.

   Storage: IndexedDB (localStorage cannot hold files). Records are pruned
   automatically after KEEP_DAYS so the database never grows without bound.

   IMPORTANT: this is a convenience buffer, NOT an archive. Browser storage
   is cleared by iPadOS after roughly a week of not visiting the site, and
   by anything that clears site data. Certificates must still be saved out
   properly the same day — the panel says so on screen.
   --------------------------------------------------------------------- */
(function (global) {
  'use strict';

  var DB_NAME = 'labcal-certs';
  var DB_VERSION = 1;
  var STORE = 'certs';
  var KEEP_DAYS = 14;
  // v1.584 (Radek): a deleted certificate goes to the BIN for 30 days before it
  // is really removed. While it is in the bin its number stays reserved (the
  // clash check and the _rev2 check still see it) and it can be restored.
  var BIN_DAYS = 30;
  var CHANGE_EVENT = 'labcal-certs-changed';

  var doc = global.document;
  var lastError = null;   // why the last filing attempt failed, if it did

  function todayIso() {
    var d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }

  function supported() {
    try { return !!global.indexedDB; } catch (e) { return false; }
  }

  var dbPromise = null;
  function open() {
    if (!supported()) return Promise.reject(new Error('This browser has no space to keep the day\'s certificates.'));
    if (dbPromise) return dbPromise;
    dbPromise = new Promise(function (resolve, reject) {
      // iOS can leave an IndexedDB open request pending indefinitely — another
      // tab holding the database, or Safari simply not answering. Fail after a
      // few seconds instead of hanging whatever is waiting on it.
      var settled = false;
      var timer = setTimeout(function () {
        if (settled) return;
        settled = true;
        dbPromise = null;                      // let the next attempt try again
        reject(new Error('Certificate storage did not respond.'));
      }, 2500);
      var done = function (fn) {
        return function (arg) {
          if (settled) return;
          settled = true; clearTimeout(timer); fn(arg);
        };
      };
      resolve = done(resolve); reject = done(reject);

      var req = global.indexedDB.open(DB_NAME, DB_VERSION);
      req.onblocked = function () {
        reject(new Error('Certificate storage is locked by another tab of this site. Close the other tabs and try again.'));
      };
      req.onupgradeneeded = function () {
        var db = req.result;
        if (!db.objectStoreNames.contains(STORE)) {
          var os = db.createObjectStore(STORE, { keyPath: 'id', autoIncrement: true });
          os.createIndex('day', 'day', { unique: false });
        }
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
      req.onerror = function () { reject(req.error || new Error('Could not open the certificate store.')); };
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
        console.warn('Certificate storage connection was closed — opening it again.');
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

  // ---- writing ----------------------------------------------------------
  // meta: { filename, certRef, serial, model, site, jobRef, sheet }
  function add(blob, meta) {
    meta = meta || {};
    var rec = {
      day: todayIso(),
      savedAt: new Date().toISOString(),
      filename: meta.filename || 'certificate.pdf',
      certRef: meta.certRef || '',
      serial: meta.serial || '',
      model: meta.model || '',
      site: meta.site || '',
      jobRef: meta.jobRef || '',
      sheet: meta.sheet || '',
      unitUid: meta.unitUid || '',   // the permanent link to its unit
      // v1.545: a readable label for sheets without a certificate number
      // (Monitoring System), and whether anything needed adjusting
      summary: meta.summary || '',
      summaryTone: meta.summaryTone || '',
      summaryShort: meta.summaryShort || '',
      // v1.550: revision number (1, 2, 3 …) and a SHA-256 fingerprint of the
      // exact PDF, so any copy found later in Files can be recognised.
      rev: Number(meta.rev) || revFromName(meta.filename),
      sha256: '',
      size: blob && blob.size ? blob.size : 0,
      // v1.542: records whether this PDF has actually left LabCal (saved,
      // shared or downloaded). Until it has, prune() will not remove it.
      // Records from before v1.542 have no 'track' and prune as they always did.
      track: 1,
      deliveredAt: '',
      deliveredHow: '',
      blob: blob
    };
    // Generating again for the same job + serial + worksheet is an amendment.
    // The earlier certificate is NOT deleted — it was a real document that may
    // already have been sent — it is marked superseded so the panel can show
    // which one is current.
    return sha256Of(blob)
      .then(function (h) { rec.sha256 = h || ''; })
      .then(function () { return supersedeEarlier(rec); })
      .then(function () { return tx('readwrite'); })
      .then(function (os) { return wrap(os.add(rec)); })
      .then(function (id) {
        announce();
        // v1.590: wait (briefly) for the register line too — iOS drops a write
        // that is still pending when the share sheet takes the page away.
        return Promise.race([register(rec), new Promise(function (r) { setTimeout(r, 1500); })])
          .then(function () { return id; });
      })
      .catch(function (e) {
        // Never let a storage problem lose the engineer their certificate —
        // the file has already been saved/shared by this point. But do not
        // hide it either: a certificate that was never filed will not appear
        // on its job, and silence made that look like a display bug.
        lastError = (e && e.message) ? e.message : String(e);
        console.warn('Could not file this certificate in the day list:', e);
        return null;
      });
  }

  // ---- v1.550: file identity -------------------------------------------
  function revFromName(name) {
    var m = String(name || '').match(/_rev(\d+)\.[a-z0-9]+$/i);
    return m ? Number(m[1]) : 1;
  }

  // SHA-256 of a Blob/ArrayBuffer as lowercase hex. '' where the browser
  // cannot do it (never throws — a fingerprint is a bonus, not a gate).
  function sha256Of(data) {
    try {
      var subtle = global.crypto && global.crypto.subtle;
      if (!subtle || !data) return Promise.resolve('');
      var bufP = (data instanceof ArrayBuffer) ? Promise.resolve(data)
               : (data.buffer instanceof ArrayBuffer && data.byteLength !== undefined) ? Promise.resolve(data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength))
               : blobToArrayBuffer(data);
      return bufP.then(function (buf) { return subtle.digest('SHA-256', buf); })
        .then(function (d) {
          var b = new Uint8Array(d), s = '';
          for (var i = 0; i < b.length; i++) s += ('0' + b[i].toString(16)).slice(-2);
          return s;
        }).catch(function () { return ''; });
    } catch (e) { return Promise.resolve(''); }
  }

  // One file-name format for every certificate (v1.550):
  //   <job>_<certificate>_<serial>_<yyyy-mm-dd>[_revN].<ext>
  // e.g. ENQ142178_S12345_21800897_2026-09-25.pdf, …_rev2.pdf for a revision.
  function fileNamePart(v, fallback) {
    var s = String(v == null ? '' : v).trim().replace(/[^A-Za-z0-9-]+/g, '_').replace(/^[_-]+|[_-]+$/g, '');
    return s || fallback;
  }
  function certFileName(o) {
    o = o || {};
    var rev = Number(o.rev) || 1;
    return [fileNamePart(o.jobRef, 'NoJob'), fileNamePart(o.certPart, 'Cert'),
            fileNamePart(o.serial, 'NoSerial'), fileNamePart(o.date, 'NoDate')].join('_') +
           (rev > 1 ? '_rev' + rev : '') + '.' + (o.ext || 'pdf');
  }

  function sameUnit(a, b) {
    return (a.sheet || '') === (b.sheet || '')
        && (a.jobRef || '') === (b.jobRef || '')
        && (a.serial || '') !== ''
        && (a.serial || '') === (b.serial || '');
  }

  function supersedeEarlier(rec) {
    return all().then(function (list) {
      var earlier = list.filter(function (r) { return !r.superseded && sameUnit(r, rec); });
      if (!earlier.length) return;
      return tx('readwrite').then(function (os) {
        return Promise.all(earlier.map(function (r) {
          r.superseded = true;
          r.supersededAt = new Date().toISOString();
          return wrap(os.put(r));
        }));
      });
    }).catch(function () { /* never block a certificate over bookkeeping */ });
  }

  // Put a certificate back from a backup, keeping its original day and time.
  // Deliberately skips the supersede pass: the backup already records which
  // ones were superseded, and re-running it would rewrite that history.
  function addRestored(blob, meta) {
    meta = meta || {};
    var rec = {
      day: meta.day || todayIso(),
      savedAt: meta.savedAt || new Date().toISOString(),
      filename: meta.filename || 'certificate.pdf',
      certRef: meta.certRef || '', serial: meta.serial || '', model: meta.model || '',
      site: meta.site || '', jobRef: meta.jobRef || '', sheet: meta.sheet || '',
      summary: meta.summary || '', summaryTone: meta.summaryTone || '',
      size: blob && blob.size ? blob.size : (meta.size || 0),
      superseded: !!meta.superseded,
      restored: true,
      deletedAt: meta.deletedAt || undefined,
      binnedWith: meta.binnedWith || undefined,
      blob: blob
    };
    return tx('readwrite')
      .then(function (os) { return wrap(os.add(rec)); })
      .then(function (id) { announce(); register(rec); return id; });
  }

  // Re-file a certificate against a different unit or job. Used when a
  // certificate ends up recorded with details that do not match the unit it
  // belongs to; the values it was filed under are kept alongside.
  function refile(id, patch) {
    return tx('readwrite').then(function (os) {
      return wrap(os.get(id)).then(function (rec) {
        if (!rec) throw new Error('That certificate is no longer in storage.');
        if (rec.origSerial === undefined) rec.origSerial = rec.serial || '';
        if (rec.origJobRef === undefined) rec.origJobRef = rec.jobRef || '';
        if (patch.serial !== undefined) rec.serial = patch.serial;
        if (patch.jobRef !== undefined) rec.jobRef = patch.jobRef;
        if (patch.sheet !== undefined) rec.sheet = patch.sheet;
        if (patch.unitUid !== undefined) rec.unitUid = patch.unitUid;
        rec.refiledAt = new Date().toISOString();
        return wrap(os.put(rec)).then(function (r) { register(rec); return r; });
      });
    }).then(function (r) { announce(); return r; });
  }

  function remove(id) {
    return tx('readwrite')
      .then(function (os) { return wrap(os.delete(id)); })
      .then(function () { announce(); });
  }

  // v1.584: "Clear day" moves the day's certificates to the bin.
  function clearDay(day) {
    return listDay(day).then(function (list) {
      return trash(list.map(function (r) { return r.id; }));
    });
  }

  // ---- bin (v1.584) -------------------------------------------------------
  // trash(ids, {binnedWith}) — binnedWith ties certificates to a job that was
  // deleted with them, so restoring the job brings them back too.
  function trash(ids, opts) {
    ids = (ids || []).filter(function (x) { return x !== null && x !== undefined; });
    if (!ids.length) return Promise.resolve(0);
    var when = new Date().toISOString();
    return tx('readwrite').then(function (os) {
      return Promise.all(ids.map(function (id) {
        return wrap(os.get(id)).then(function (r) {
          if (!r || r.deletedAt) return 0;
          r.deletedAt = when;
          r.binnedWith = (opts && opts.binnedWith) || '';
          return wrap(os.put(r)).then(function () { return 1; });
        });
      }));
    }).then(function (n) {
      var c = n.reduce(function (a, b) { return a + b; }, 0);
      if (c) announce();
      return c;
    });
  }

  // Put one certificate back. If a newer certificate for the same unit was
  // made while it sat in the bin, it comes back as superseded (the newer one
  // stays the current one).
  function untrash(id) {
    return all().then(function (list) {
      var rec = list.filter(function (r) { return r.id === id; })[0];
      if (!rec) throw new Error('That certificate is no longer in the bin.');
      if (!rec.deletedAt) return rec;
      var newer = list.some(function (r) {
        return r.id !== rec.id && !isDeleted(r) && String(r.savedAt || '') > String(rec.savedAt || '') &&
          ((rec.unitUid && r.unitUid) ? rec.unitUid === r.unitUid : sameUnit(r, rec));
      });
      return tx('readwrite').then(function (os) {
        delete rec.deletedAt; delete rec.binnedWith;
        rec.restoredAt = new Date().toISOString();
        if (newer) rec.superseded = true;
        return wrap(os.put(rec)).then(function () { announce(); return rec; });
      });
    });
  }

  // Every certificate that was deleted together with job bin entry `binId`.
  function untrashWith(binId) {
    if (!binId) return Promise.resolve(0);
    return all().then(function (list) {
      var ids = list.filter(function (r) { return r.deletedAt && r.binnedWith === binId; }).map(function (r) { return r.id; });
      var chain = Promise.resolve(0);
      ids.forEach(function (id) { chain = chain.then(function (n) { return untrash(id).then(function () { return n + 1; }); }); });
      return chain;
    });
  }

  // What is in the bin, newest deletion first. `purgeOn` = the day it goes for good.
  function binned() {
    return all().then(function (list) {
      return list.filter(isDeleted).map(function (r) {
        r.purgeOn = binPurgeDay(r.deletedAt);
        return r;
      }).sort(function (a, b) { return String(a.deletedAt) < String(b.deletedAt) ? 1 : -1; });
    });
  }
  function binPurgeDay(deletedAt) {
    var d = new Date(deletedAt);
    if (isNaN(d)) return '';
    d.setDate(d.getDate() + BIN_DAYS);
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }

  // ---- reading ----------------------------------------------------------
  function all() {
    return tx('readonly').then(function (os) { return wrap(os.getAll()); });
  }

  // jobRef narrows to a single job. More than one job in a day is normal, and
  // the certificates for each must stay separable.
  // Certificate numbers are like "S 51430" / "B 00123". Order by the number,
  // not as text, so 51440 follows 51439 rather than sorting beside 514.
  function certOrder(c) {
    var m = String(c.certRef || c.filename || '').match(/(\d+)/);
    return m ? parseInt(m[1], 10) : Number.MAX_SAFE_INTEGER;
  }
  function byCertNumber(a, b) {
    var d = certOrder(a) - certOrder(b);
    if (d) return d;
    return String(a.savedAt || '') < String(b.savedAt || '') ? -1 : 1;
  }

  function isDeleted(r) { return !!(r && r.deletedAt); }

  // opts.withDeleted: include certificates in the bin (backup only). Every
  // list the engineer sees leaves them out.
  function listDay(day, jobRef, opts) {
    var want = day || todayIso();
    var withDeleted = !!(opts && opts.withDeleted);
    return all().then(function (list) {
      return list
        .filter(function (r) { return r.day === want; })
        .filter(function (r) { return withDeleted || !isDeleted(r); })
        .filter(function (r) { return jobRef === undefined || (r.jobRef || '') === jobRef; })
        .sort(function (a, b) { return a.savedAt < b.savedAt ? -1 : 1; });
    });
  }

  // The jobs worked on a given day, in the order they were first certified.
  function jobsOnDay(day) {
    return listDay(day).then(function (list) {
      var order = [], byRef = {};
      list.forEach(function (r) {
        var ref = r.jobRef || '';
        if (!byRef[ref]) {
          byRef[ref] = { jobRef: ref, site: r.site || '', count: 0, bytes: 0 };
          order.push(ref);
        }
        byRef[ref].count += 1;
        byRef[ref].bytes += r.size || 0;
        if (!byRef[ref].site && r.site) byRef[ref].site = r.site;
      });
      return order.map(function (ref) { return byRef[ref]; });
    });
  }

  function days(opts) {
    var withDeleted = !!(opts && opts.withDeleted);
    return all().then(function (list) {
      var seen = {};
      list.forEach(function (r) { if (withDeleted || !isDeleted(r)) seen[r.day] = (seen[r.day] || 0) + 1; });
      return Object.keys(seen).sort().reverse().map(function (d) {
        return { day: d, count: seen[d] };
      });
    });
  }

  function get(id) {
    return tx('readonly').then(function (os) { return wrap(os.get(id)); });
  }

  // ---- housekeeping -----------------------------------------------------
  function prune(keepDays) {
    var keep = keepDays || KEEP_DAYS;
    var cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - keep);
    var cutIso = cutoff.getFullYear() + '-' + String(cutoff.getMonth() + 1).padStart(2, '0') + '-' + String(cutoff.getDate()).padStart(2, '0');
    var binCut = new Date(Date.now() - BIN_DAYS * 24 * 3600 * 1000).toISOString();
    // v1.590: copy what is on the iPad into the register BEFORE anything is
    // pruned, so the first run of this version loses no certificate numbers.
    return seedRegister().then(all).then(function (list) {
      // v1.542: never auto-delete a current certificate that has not been
      // saved out yet — it may be the only copy.
      // v1.584: a certificate in the bin is kept BIN_DAYS from the day it was
      // deleted (whatever day it was made), then removed for good.
      var old = list.filter(function (r) {
        if (isDeleted(r)) return String(r.deletedAt) < binCut;
        return r.day < cutIso && !isUnsaved(r);
      });
      return Promise.all(old.map(function (r) { return remove(r.id); })).then(function () { return old.length; });
    }).catch(function () { return 0; })
      .then(function (n) { return pruneRegister().then(function () { return n; }, function () { return n; }); });
  }

  // ---- merging ----------------------------------------------------------
  // pdf-lib is ~500 KB, so it is only fetched when a merge is actually asked
  // for rather than on every page load. It is served from this site (not a
  // CDN) so it works with no signal.
  function loadPdfLib() {
    if (global.PDFLib) return Promise.resolve(global.PDFLib);
    return new Promise(function (resolve, reject) {
      var s = doc.createElement('script');
      s.src = 'pdf-lib.min.js';
      s.onload = function () {
        if (global.PDFLib) resolve(global.PDFLib);
        else reject(new Error('The PDF merge library did not load correctly.'));
      };
      s.onerror = function () {
        reject(new Error('Could not load the PDF merge library. If you are offline, open the home page once while online and tap "Refresh offline copy".'));
      };
      doc.head.appendChild(s);
    });
  }

  // Blob.arrayBuffer() is missing on older Safari (pre-14), which is exactly
  // the sort of iPad that might still be in a van. Fall back to FileReader.
  function blobToArrayBuffer(blob) {
    if (blob && typeof blob.arrayBuffer === 'function') return blob.arrayBuffer();
    return new Promise(function (resolve, reject) {
      var fr = new global.FileReader();
      fr.onload = function () { resolve(fr.result); };
      fr.onerror = function () { reject(fr.error || new Error('Could not read the stored certificate.')); };
      fr.readAsArrayBuffer(blob);
    });
  }

  // Staple every certificate from a day into one PDF, in the order produced.
  // cover: an optional Blob placed in front of the certificates — used for the
  // job summary, so a merged job opens on the list of what was done.
  // opts.latestOnly: one certificate per unit — the newest. A pack sent to a
  // customer should carry the current certificate for each unit, not the
  // superseded ones as well.
  // v1.550: staple a given list of certificate records into one PDF (in
  // certificate-number order), optional cover first. Used by the job pack,
  // which spans every day of a job. Same per-file rules as mergeDay: one
  // unreadable certificate is skipped, never sinks the whole file.
  function mergeRecords(records, cover, onProgress) {
    var list = (records || []).filter(function (r) { return r && r.blob; }).slice().sort(byCertNumber);
    if (!list.length) return Promise.reject(new Error('There are no certificates to merge.'));
    return loadPdfLib().then(function (PDFLib) {
      return PDFLib.PDFDocument.create().then(function (out) {
        var ids = [];
        function addBuf(blob) {
          return blobToArrayBuffer(blob)
            .then(function (buf) { return PDFLib.PDFDocument.load(buf); })
            .then(function (src) { return out.copyPages(src, src.getPageIndices()); })
            .then(function (pages) { pages.forEach(function (pg) { out.addPage(pg); }); });
        }
        var chain = cover ? addBuf(cover).catch(function (e) { console.warn('Summary cover skipped:', e); }) : Promise.resolve();
        list.forEach(function (rec, i) {
          chain = chain.then(function () {
            if (onProgress) onProgress(i + 1, list.length);
            return addBuf(rec.blob).then(function () { ids.push(rec.id); })
              .catch(function (e) { console.warn('Skipped ' + rec.filename + ' while merging:', e); });
          });
        });
        return chain.then(function () { return out.save(); }).then(function (bytes) {
          return { blob: new Blob([bytes], { type: 'application/pdf' }), count: ids.length, ids: ids };
        });
      });
    });
  }

  function mergeDay(day, onProgress, jobRef, cover, opts) {
    var want = day || todayIso();
    opts = opts || {};
    return Promise.all([listDay(want, jobRef), loadPdfLib()]).then(function (res) {
      var list = res[0], PDFLib = res[1];
      if (opts.latestOnly) {
        var newest = {};
        list.forEach(function (c) {
          var key = c.unitUid || ('s:' + String(c.serial || '').toUpperCase().replace(/[^A-Z0-9]/g, '')) || ('id:' + c.id);
          var prev = newest[key];
          if (!prev || String(c.savedAt || '') > String(prev.savedAt || '')) newest[key] = c;
        });
        var keep = {};
        Object.keys(newest).forEach(function (k) { keep[newest[k].id] = true; });
        list = list.filter(function (c) { return keep[c.id]; });
      }
      // a merged job reads in certificate-number order
      list = list.slice().sort(byCertNumber);
      if (!list.length) throw new Error('There are no certificates to merge for that job.');
      var mergedIds = [];   // only those actually in the file (v1.542)
      return PDFLib.PDFDocument.create().then(function (out) {
        function addCover() {
          if (!cover) return Promise.resolve();
          return blobToArrayBuffer(cover)
            .then(function (buf) { return PDFLib.PDFDocument.load(buf); })
            .then(function (src) { return out.copyPages(src, src.getPageIndices()); })
            .then(function (pages) { pages.forEach(function (p) { out.addPage(p); }); })
            .catch(function (e) { console.warn('Summary cover skipped:', e); });
        }
        var i = 0;
        function next() {
          if (i >= list.length) return out.save();
          var rec = list[i];
          if (onProgress) onProgress(i + 1, list.length);
          return blobToArrayBuffer(rec.blob)
            .then(function (buf) { return PDFLib.PDFDocument.load(buf); })
            .then(function (src) { return out.copyPages(src, src.getPageIndices()); })
            .then(function (pages) {
              pages.forEach(function (p) { out.addPage(p); });
              mergedIds.push(rec.id);
              i++;
              return next();
            })
            .catch(function (e) {
              // One unreadable certificate must not sink the whole merge.
              console.warn('Skipped ' + rec.filename + ' while merging:', e);
              i++;
              return next();
            });
        }
        return addCover().then(next);
      }).then(function (bytes) {
        return { blob: new Blob([bytes], { type: 'application/pdf' }), count: list.length, cover: !!cover, ids: mergedIds };
      });
    });
  }

  // ---- saved-out tracking (v1.542) --------------------------------------
  // A certificate is "unsaved" when it was produced by v1.542 or later, is the
  // current one for its unit, and has not yet left LabCal. Those are shown on
  // the calibration page and are never pruned automatically.
  function isUnsaved(r) {
    return !!(r && r.track && !r.deliveredAt && !r.superseded && !r.deletedAt);
  }

  function markDelivered(ids, how) {
    ids = (ids || []).filter(function (x) { return x !== null && x !== undefined; });
    if (!ids.length) return Promise.resolve(0);
    return tx('readwrite').then(function (os) {
      return Promise.all(ids.map(function (id) {
        return wrap(os.get(id)).then(function (r) {
          if (!r || r.deliveredAt) return 0;
          r.deliveredAt = new Date().toISOString();
          r.deliveredHow = how || '';
          return wrap(os.put(r)).then(function () { return 1; });
        });
      }));
    }).then(function (n) {
      var c = n.reduce(function (a, b) { return a + b; }, 0);
      if (c) announce();
      return c;
    }).catch(function (e) {
      // Failing here only means the certificate still shows as unsaved — the
      // safe direction. Say so in the console, do not interrupt the engineer.
      console.warn('Could not mark certificate as saved out:', e);
      return 0;
    });
  }

  // The newest record with this exact file name — used when a single
  // certificate is saved or shared straight from its worksheet.
  function markDeliveredByFilename(filename, how) {
    if (!filename || !/\.pdf$/i.test(filename)) return Promise.resolve(0);
    return all().then(function (list) {
      var hits = list.filter(function (r) { return r.filename === filename; });
      if (!hits.length) return 0;
      hits.sort(function (a, b) { return a.id - b.id; });
      return markDelivered([hits[hits.length - 1].id], how);
    }).catch(function () { return 0; });
  }

  function unsaved() {   // (isUnsaved already leaves the bin out)
    return all().then(function (list) {
      return list.filter(isUnsaved).sort(function (a, b) { return a.savedAt < b.savedAt ? -1 : 1; });
    });
  }

  if (global.addEventListener) {
    global.addEventListener('labcal-file-delivered', function (e) {
      var d = (e && e.detail) || {};
      if (!supported()) return;
      if (d.certIds && d.certIds.length) markDelivered(d.certIds, d.how);
      else markDeliveredByFilename(d.filename, d.how);
    });
  }

  // ---- v1.590: certificate REGISTER --------------------------------------
  // Radek (28 Sep 2026): a certificate PDF is kept on the iPad for 14 days
  // (30 in the bin). After that its number looked free again, and nothing
  // was left to say the unit had ever been calibrated here. The register
  // keeps a small line for EVERY certificate made on this iPad — number,
  // serial, model, job, site, location, day, revision, worksheet; never the
  // PDF — for REGISTER_KEEP_DAYS (about 13 months, so last year's visit is
  // still there when the unit is due again a few weeks late).
  //   • the certificate-number check also looks here (numbers stay blocked)
  //   • the worksheet shows the unit's earlier visits from here (history)
  // Own IndexedDB database, so the certificate store is not changed at all
  // and an older LabCal folder on the same site keeps working.
  // Never blocks a certificate: every failure is logged and ignored.
  var REG_DB = 'labcal-register';
  var REG_STORE = 'entries';
  var REGISTER_KEEP_DAYS = 400;
  var REG_SEEDED = 'labcal.register.seeded';
  var regPromise = null;
  function regOpen() {
    if (!supported()) return Promise.reject(new Error('No IndexedDB'));
    if (regPromise) return regPromise;
    regPromise = new Promise(function (resolve, reject) {
      var settled = false;
      var timer = setTimeout(function () {
        if (settled) return;
        settled = true; regPromise = null;
        reject(new Error('Certificate register did not respond.'));
      }, 2500);
      var done = function (fn) { return function (a) { if (settled) return; settled = true; clearTimeout(timer); fn(a); }; };
      resolve = done(resolve); reject = done(reject);
      var req = global.indexedDB.open(REG_DB, 1);
      req.onblocked = function () { reject(new Error('Certificate register is locked by another tab.')); };
      req.onupgradeneeded = function () {
        var db = req.result;
        if (!db.objectStoreNames.contains(REG_STORE)) {
          var os = db.createObjectStore(REG_STORE, { keyPath: 'key' });
          os.createIndex('serialKey', 'serialKey', { unique: false });
          os.createIndex('refKey', 'refKey', { unique: false });
          os.createIndex('day', 'day', { unique: false });
        }
      };
      req.onsuccess = function () {
        var db = req.result;
        db.onclose = function () { if (regPromise && regPromise.__db === db) regPromise = null; };
        db.onversionchange = function () { try { db.close(); } catch (e) {} if (regPromise && regPromise.__db === db) regPromise = null; };
        if (regPromise) regPromise.__db = db;
        resolve(db);
      };
      req.onerror = function () { reject(req.error || new Error('Could not open the certificate register.')); };
    });
    return regPromise;
  }
  function regTx(mode) {
    return regOpen().then(function (db) {
      try { return db.transaction(REG_STORE, mode).objectStore(REG_STORE); }
      catch (e) {
        if (!e || (e.name !== 'InvalidStateError' && !/clos/i.test(String(e.message)))) throw e;
        regPromise = null;
        return regOpen().then(function (db2) { return db2.transaction(REG_STORE, mode).objectStore(REG_STORE); });
      }
    });
  }
  function regKeyOf(rec) { return String(rec.savedAt || '') + '|' + String(rec.filename || ''); }
  // Where the unit stands on its job (e.g. "Fridge room 2") — from the job
  // list, when LabCal still has that job. Optional.
  function locationOf(rec) {
    try {
      var J = global.LabCalJobsheet;
      if (!J || !J.jobByRef || !rec.jobRef) return '';
      var job = J.jobByRef(rec.jobRef);
      if (!job || !job.devices) return '';
      var sk = normRef(rec.serial), hit = null;
      job.devices.forEach(function (d) {
        if (hit) return;
        if ((rec.unitUid && d.uid === rec.unitUid) || (sk && normRef(d.serial) === sk)) hit = d;
      });
      return hit ? String(hit.location || '') : '';
    } catch (e) { return ''; }
  }
  function regEntry(rec, keep) {
    keep = keep || {};
    return {
      key: regKeyOf(rec),
      certRef: rec.certRef || '', refKey: normRef(rec.certRef),
      serial: rec.serial || '', serialKey: normRef(rec.serial),
      model: rec.model || '', site: rec.site || '',
      location: keep.location || locationOf(rec),
      jobRef: rec.jobRef || '', sheet: rec.sheet || '',
      unitUid: rec.unitUid || '',
      day: rec.day || String(rec.savedAt || '').slice(0, 10), savedAt: rec.savedAt || '',
      filename: rec.filename || '', rev: Number(rec.rev) || revFromName(rec.filename),
      summary: rec.summary || '',
      engineer: keep.engineer || ''
    };
  }
  // Add (or refresh) the register line for one certificate record.
  function register(rec) {
    if (!rec || !rec.savedAt) return Promise.resolve(false);
    return regTx('readwrite').then(function (os) {
      return wrap(os.get(regKeyOf(rec))).then(function (old) {
        return wrap(os.put(regEntry(rec, old || {})));
      });
    }).then(function () { return true; }).catch(function (e) {
      console.warn('Could not add certificate ' + (rec.certRef || rec.filename || '') + ' to the register:', e);
      return false;
    });
  }
  // Lines brought in from a backup / another iPad (already register-shaped).
  function registerEntries(entries) {
    entries = (entries || []).filter(function (e) { return e && e.savedAt; });
    if (!entries.length) return Promise.resolve(0);
    return regTx('readwrite').then(function (os) {
      return Promise.all(entries.map(function (e) {
        var k = e.key || regKeyOf(e);
        return wrap(os.get(k)).then(function (old) {
          if (old) return 0;
          var line = regEntry(e, e);
          line.key = k;
          return wrap(os.put(line)).then(function () { return 1; });
        });
      }));
    }).then(function (n) { return n.reduce(function (a, b) { return a + b; }, 0); })
      .catch(function (e) { console.warn('Could not add lines to the certificate register:', e); return 0; });
  }
  function registerAll() {
    return regTx('readonly').then(function (os) { return wrap(os.getAll()); });
  }
  // First time this LabCal runs: every certificate already on the iPad goes
  // into the register (idempotent — lines are keyed by time + file name).
  var seeding = null;
  function seedRegister() {
    if (seeding) return seeding;
    var ls = null; try { ls = global.localStorage; } catch (e) {}
    try { if (ls && ls.getItem(REG_SEEDED)) return (seeding = Promise.resolve(0)); } catch (e) {}
    seeding = all().then(function (list) {
      var chain = Promise.resolve(0);
      list.forEach(function (r) { chain = chain.then(function (n) { return register(r).then(function (ok) { return n + (ok ? 1 : 0); }); }); });
      return chain;
    }).then(function (n) {
      try { if (ls) ls.setItem(REG_SEEDED, new Date().toISOString()); } catch (e) {}
      return n;
    }).catch(function (e) { seeding = null; console.warn('Certificate register: could not copy existing certificates in:', e); return 0; });
    return seeding;
  }
  function regByIndex(index, value) {
    if (!value) return Promise.resolve([]);
    return seedRegister().then(function () { return regTx('readonly'); })
      .then(function (os) { return wrap(os.index(index).getAll(value)); });
  }
  function pruneRegister(keepDays) {
    var keep = keepDays || REGISTER_KEEP_DAYS;
    var cut = new Date(); cut.setDate(cut.getDate() - keep);
    var cutIso = cut.getFullYear() + '-' + String(cut.getMonth() + 1).padStart(2, '0') + '-' + String(cut.getDate()).padStart(2, '0');
    return regTx('readwrite').then(function (os) {
      return wrap(os.getAll()).then(function (list) {
        var old = list.filter(function (e) { return String(e.day || '') < cutIso; });
        return Promise.all(old.map(function (e) { return wrap(os.delete(e.key)); })).then(function () { return old.length; });
      });
    }).catch(function () { return 0; });
  }
  // Every certificate this iPad has made for a serial (any job, any
  // worksheet), newest first. Punctuation in the serial is ignored.
  function history(serial) {
    var sk = normRef(serial);
    if (!sk || !supported()) return Promise.resolve([]);
    return regByIndex('serialKey', sk).then(function (list) {
      return list.sort(function (a, b) { return String(a.savedAt) < String(b.savedAt) ? 1 : -1; });
    });
  }

  // ---- certificate number reuse check (v1.542) ---------------------------
  // Before a certificate is generated: has this certificate number already
  // been issued for a DIFFERENT unit? Regenerating for the same unit (an
  // amendment) is normal and passes silently. Returns a Promise<boolean> —
  // true = carry on. Never blocks on a storage problem: if the list cannot
  // be read within 2.5 s, generation continues (v1.576: and the check finishes
  // in the background — see confirmCertRefFree).
  function normRef(v) { return String(v || '').toUpperCase().replace(/[^A-Z0-9]/g, ''); }
  function findCertRefUse(certRef, unit) {
    var want = normRef(certRef);
    unit = unit || {};
    if (!want || !/\d/.test(want) || !supported()) return Promise.resolve([]);
    // v1.571 (Radek): an all-zero number (S 00000, B 00000) is not a
    // certificate number at all — it marks a VERIFICATION (e.g. temperature
    // confirmed after a repair), which every engineer uses for many units.
    // Same test as LabCalVectorPdf.isVerificationRef: digits present, all 0.
    if (/^0+$/.test(want.replace(/\D/g, ''))) return Promise.resolve([]);
    var serial = normRef(unit.serial);
    var other = function (r) {
      if (normRef(r.certRef) !== want) return false;
      if (unit.unitUid && r.unitUid) return r.unitUid !== unit.unitUid;
      return normRef(r.serial) !== serial;
    };
    return all().then(function (list) {
      var hits = list.filter(other);
      // v1.590: certificates no longer on the iPad (pruned after 14 / 30
      // days) are still in the register — their numbers stay taken.
      var seen = {};
      list.forEach(function (r) { seen[regKeyOf(r)] = true; });
      return regByIndex('refKey', want).then(function (lines) {
        return hits.concat(lines.filter(function (e) { return !seen[e.key] && other(e); })
          .map(function (e) { e.fromRegister = true; return e; })
          .sort(function (a, b) { return String(a.savedAt) < String(b.savedAt) ? -1 : 1; }));
      }, function (e) {
        console.warn('Certificate register not read for the number check:', e);
        return hits;
      });
    });
  }
  // v1.576: the check is never skipped silently any more.
  //  • storage answers within 2.5 s  → as before (question only on a clash)
  //  • storage answers LATER         → generation has already gone ahead; the
  //    check still finishes in the background and, if the number is on a
  //    different unit, a red bar on the worksheet says so (no pop-up in the
  //    middle of saving/sharing)
  //  • storage fails or never answers (30 s) → amber bar "not checked"
  // Everything is also written to the on-device error log.
  var LATE_GIVE_UP_MS = 30000;
  function clashText(c) {
    return [c.serial ? 'serial ' + c.serial : 'no serial', c.model, c.site, c.jobRef ? 'job ' + c.jobRef : '', c.day,
            c.deletedAt ? 'DELETED \u2014 in the bin' : '',
            c.fromRegister ? 'from the certificate register (PDF no longer on this iPad)' : '']
      .filter(Boolean).join(' \u00b7 ');
  }
  function notify(id, tone, text) {
    try { if (global.LabCalLog && global.LabCalLog.notice) { global.LabCalLog.notice(id, tone, text); return; } } catch (e) {}
    console.warn(text);
  }
  function certNoNotChecked(certRef, why) {
    notify('certno', 'amber',
      'Certificate No. ' + String(certRef).trim() + ' was NOT checked against earlier certificates (' + why + ').\n' +
      'Make sure this number has not been used for another unit.');
  }
  function confirmCertRefFree(certRef, unit) {
    var timedOut = false, settled = false;
    var startedIso = new Date().toISOString();
    var ref = String(certRef || '').trim();
    var finder = (global.LabCalCerts && global.LabCalCerts.findCertRefUse) || findCertRefUse;
    var check = Promise.resolve().then(function () { return finder(certRef, unit); }).then(function (clashes) {
      settled = true;
      clashes = clashes || [];
      if (timedOut) {
        clashes = clashes.filter(function (r) { return !r.savedAt || String(r.savedAt) < startedIso; });
        // too late — generation already went ahead; never pop a question up
        // in the middle of saving/sharing. Tell the engineer on the page.
        if (clashes.length) {
          var c0 = clashes[clashes.length - 1];
          notify('certno', 'red',
            'Certificate No. ' + ref + ' has ALSO been used for a DIFFERENT unit:\n' + clashText(c0) +
            (clashes.length > 1 ? ' (+' + (clashes.length - 1) + ' more)' : '') +
            '\nThe check finished late, so the certificate was already made. Two units must not share a certificate number \u2014 correct the number and generate again.');
        } else {
          console.warn('Certificate number check finished late (' + ref + '): no clash.');
        }
        return true;
      }
      if (!clashes.length) return true;
      var c = clashes[clashes.length - 1];
      return global.confirm(
        'Certificate No. ' + ref + ' has already been used for a DIFFERENT unit:\n\n' +
        clashText(c) + (clashes.length > 1 ? '\n(+' + (clashes.length - 1) + ' more)' : '') +
        '\n\nTwo units must not share a certificate number. Tap Cancel to change the number, or OK to generate anyway.');
    }).catch(function (e) {
      settled = true;
      console.warn('Certificate number check failed:', e);
      if (normRef(certRef)) certNoNotChecked(certRef, 'certificate storage did not answer');
      return true;
    });
    var timeout = new Promise(function (resolve) {
      setTimeout(function () { resolve('timeout'); }, 2500);
    });
    return Promise.race([check, timeout]).then(function (r) {
      if (r === 'timeout') {
        timedOut = true;
        console.warn('Certificate number check still waiting after 2.5 s (' + ref + ') \u2014 carrying on, finishing it in the background.');
        setTimeout(function () {
          if (settled) return;
          settled = true;
          certNoNotChecked(certRef, 'certificate storage did not answer');
        }, (global.LabCalCerts && global.LabCalCerts.lateGiveUpMs) || LATE_GIVE_UP_MS);
        return true;
      }
      return r;
    });
  }

  // IndexedDB fires no cross-tab event, so a certificate generated on a
  // worksheet would not reach a calibration page open in another tab. A
  // localStorage ping does travel between tabs, so use it as the signal.
  var PING = 'labcal.certs.ping';
  function announce() {
    try { global.dispatchEvent(new CustomEvent(CHANGE_EVENT)); } catch (e) {}
    try { global.localStorage.setItem(PING, String(Date.now())); } catch (e) {}
  }
  function onChange(fn) {
    if (typeof fn !== 'function') return;
    global.addEventListener(CHANGE_EVENT, fn);
    global.addEventListener('storage', function (e) {
      if (!e || e.key === PING) fn();
    });
  }

  // The merged file is named after the job so two jobs on the same day can
  // never be confused for each other.
  function mergedFileName(day, jobRef) {
    var d = day || todayIso();
    var ref = String(jobRef || '').trim().replace(/[^A-Za-z0-9_-]/g, '');
    return (ref ? ref + '_' : 'LabCal_') + 'certificates_' + d + '.pdf';
  }

  function formatSize(bytes) {
    if (!bytes) return '';
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return Math.round(bytes / 1024) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  }

  global.LabCalCerts = {
    KEEP_DAYS: KEEP_DAYS,
    BIN_DAYS: BIN_DAYS,
    isDeleted: isDeleted,
    trash: trash,
    untrash: untrash,
    untrashWith: untrashWith,
    binned: binned,
    CHANGE_EVENT: CHANGE_EVENT,
    supported: supported,
    _closeForTest: closeForTest,
    lastError: function () { return lastError; },
    todayIso: todayIso,
    add: add,
    addRestored: addRestored,
    refile: refile,
    all: all,
    get: get,
    remove: remove,
    clearDay: clearDay,
    listDay: listDay,
    jobsOnDay: jobsOnDay,
    mergedFileName: mergedFileName,
    days: days,
    prune: prune,
    mergeDay: mergeDay,
    byCertNumber: byCertNumber,
    onChange: onChange,
    formatSize: formatSize,
    isUnsaved: isUnsaved,
    unsaved: unsaved,
    markDelivered: markDelivered,
    findCertRefUse: findCertRefUse,
    REGISTER_KEEP_DAYS: REGISTER_KEEP_DAYS,
    register: register,
    registerEntries: registerEntries,
    registerAll: registerAll,
    seedRegister: seedRegister,
    pruneRegister: pruneRegister,
    history: history,
    confirmCertRefFree: confirmCertRefFree,
    sha256Of: sha256Of,
    mergeRecords: mergeRecords,
    certFileName: certFileName,
    revFromName: revFromName
  };
})(typeof window !== 'undefined' ? window : this);

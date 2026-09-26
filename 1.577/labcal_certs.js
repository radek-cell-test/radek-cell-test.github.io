(window.LabCalBuild = window.LabCalBuild || {})['labcal_certs.js'] = 'v1.577';  // file version — see labcal_build.js
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
      req.onsuccess = function () { resolve(req.result); };
      req.onerror = function () { reject(req.error || new Error('Could not open the certificate store.')); };
    });
    return dbPromise;
  }

  function tx(mode) {
    return open().then(function (db) {
      return db.transaction(STORE, mode).objectStore(STORE);
    });
  }

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
      .then(function (id) { announce(); return id; })
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
      blob: blob
    };
    return tx('readwrite')
      .then(function (os) { return wrap(os.add(rec)); })
      .then(function (id) { announce(); return id; });
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
        return wrap(os.put(rec));
      });
    }).then(function (r) { announce(); return r; });
  }

  function remove(id) {
    return tx('readwrite')
      .then(function (os) { return wrap(os.delete(id)); })
      .then(function () { announce(); });
  }

  function clearDay(day) {
    return listDay(day).then(function (list) {
      return Promise.all(list.map(function (r) { return remove(r.id); }));
    });
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

  function listDay(day, jobRef) {
    var want = day || todayIso();
    return all().then(function (list) {
      return list
        .filter(function (r) { return r.day === want; })
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

  function days() {
    return all().then(function (list) {
      var seen = {};
      list.forEach(function (r) { seen[r.day] = (seen[r.day] || 0) + 1; });
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
    return all().then(function (list) {
      // v1.542: never auto-delete a current certificate that has not been
      // saved out yet — it may be the only copy.
      var old = list.filter(function (r) { return r.day < cutIso && !isUnsaved(r); });
      return Promise.all(old.map(function (r) { return remove(r.id); })).then(function () { return old.length; });
    }).catch(function () { return 0; });
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
    return !!(r && r.track && !r.deliveredAt && !r.superseded);
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

  function unsaved() {
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
    return all().then(function (list) {
      return list.filter(function (r) {
        if (normRef(r.certRef) !== want) return false;
        if (unit.unitUid && r.unitUid) return r.unitUid !== unit.unitUid;
        return normRef(r.serial) !== serial;
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
    return [c.serial ? 'serial ' + c.serial : 'no serial', c.model, c.site, c.jobRef ? 'job ' + c.jobRef : '', c.day]
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
    CHANGE_EVENT: CHANGE_EVENT,
    supported: supported,
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
    confirmCertRefFree: confirmCertRefFree,
    sha256Of: sha256Of,
    mergeRecords: mergeRecords,
    certFileName: certFileName,
    revFromName: revFromName
  };
})(typeof window !== 'undefined' ? window : this);

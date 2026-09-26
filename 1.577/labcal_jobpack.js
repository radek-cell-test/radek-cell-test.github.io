(window.LabCalBuild = window.LabCalBuild || {})['labcal_jobpack.js'] = 'v1.577';  // file version — see labcal_build.js
/* ---------------------------------------------------------------------
   LabCal — job pack & certificate check (v1.550)
   ---------------------------------------------------------------------
   JOB PACK — one file per job, saved once:
     <JOB>_<customer>_<date>.zip
       <folder>/<JOB>_ALL_certificates.pdf    summary + every current cert
       <folder>/<JOB>_job_summary.pdf
       <folder>/certificates/<each current certificate>.pdf
       <folder>/labcal_manifest.json          unit ↔ file ↔ SHA-256
       <folder>/README.txt
   Only the CURRENT certificate of each unit goes in (superseded ones stay
   on record in LabCal but are not packed).

   CHECK — pick PDFs (or a job pack ZIP) from Files and LabCal says, for
   each one, whether it is the current certificate it has on record, an
   older (superseded) version, a LabCal certificate that differs from every
   stored copy, or something it does not recognise. For the jobs involved
   it also lists finished units with no current certificate among the files.

   ZIP is written uncompressed ("stored"): PDFs are already compressed, and
   it keeps this dependency-free. Reading also handles deflated entries
   where the browser offers DecompressionStream.
   --------------------------------------------------------------------- */
(function (global) {
  'use strict';

  // ---- CRC-32 -------------------------------------------------------------
  var CRC_TABLE = (function () {
    var t = new Uint32Array(256);
    for (var n = 0; n < 256; n++) {
      var c = n;
      for (var k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
      t[n] = c >>> 0;
    }
    return t;
  })();
  function crc32(bytes) {
    var c = 0xFFFFFFFF;
    for (var i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8);
    return (c ^ 0xFFFFFFFF) >>> 0;
  }

  function utf8(s) { return new TextEncoder().encode(s); }

  function toBytes(blobOrBuf) {
    if (blobOrBuf instanceof Uint8Array) return Promise.resolve(blobOrBuf);
    if (blobOrBuf instanceof ArrayBuffer) return Promise.resolve(new Uint8Array(blobOrBuf));
    if (typeof blobOrBuf === 'string') return Promise.resolve(utf8(blobOrBuf));
    if (blobOrBuf && typeof blobOrBuf.arrayBuffer === 'function') return blobOrBuf.arrayBuffer().then(function (b) { return new Uint8Array(b); });
    return new Promise(function (resolve, reject) {
      var fr = new FileReader();
      fr.onload = function () { resolve(new Uint8Array(fr.result)); };
      fr.onerror = function () { reject(fr.error); };
      fr.readAsArrayBuffer(blobOrBuf);
    });
  }

  // ---- ZIP writer (stored) ----------------------------------------------
  function dosTime(d) {
    return {
      time: ((d.getHours() << 11) | (d.getMinutes() << 5) | Math.floor(d.getSeconds() / 2)) & 0xFFFF,
      date: (((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate()) & 0xFFFF
    };
  }
  // entries: [{ name, data (Blob|Uint8Array|string) }]
  function makeZip(entries) {
    return Promise.all(entries.map(function (e) { return toBytes(e.data); })).then(function (datas) {
      var now = dosTime(new Date());
      var parts = [], central = [], offset = 0;
      entries.forEach(function (e, i) {
        var name = utf8(e.name), data = datas[i], crc = crc32(data);
        var h = new DataView(new ArrayBuffer(30));
        h.setUint32(0, 0x04034b50, true); h.setUint16(4, 20, true); h.setUint16(6, 0x0800, true);
        h.setUint16(8, 0, true); h.setUint16(10, now.time, true); h.setUint16(12, now.date, true);
        h.setUint32(14, crc, true); h.setUint32(18, data.length, true); h.setUint32(22, data.length, true);
        h.setUint16(26, name.length, true); h.setUint16(28, 0, true);
        parts.push(new Uint8Array(h.buffer), name, data);
        var c = new DataView(new ArrayBuffer(46));
        c.setUint32(0, 0x02014b50, true); c.setUint16(4, 20, true); c.setUint16(6, 20, true);
        c.setUint16(8, 0x0800, true); c.setUint16(10, 0, true); c.setUint16(12, now.time, true); c.setUint16(14, now.date, true);
        c.setUint32(16, crc, true); c.setUint32(20, data.length, true); c.setUint32(24, data.length, true);
        c.setUint16(28, name.length, true); c.setUint16(30, 0, true); c.setUint16(32, 0, true);
        c.setUint16(34, 0, true); c.setUint16(36, 0, true); c.setUint32(38, 0, true); c.setUint32(42, offset, true);
        central.push(new Uint8Array(c.buffer), name);
        offset += 30 + name.length + data.length;
      });
      var cdSize = central.reduce(function (n, p) { return n + p.length; }, 0);
      var end = new DataView(new ArrayBuffer(22));
      end.setUint32(0, 0x06054b50, true); end.setUint16(8, entries.length, true); end.setUint16(10, entries.length, true);
      end.setUint32(12, cdSize, true); end.setUint32(16, offset, true);
      return new Blob(parts.concat(central, [new Uint8Array(end.buffer)]), { type: 'application/zip' });
    });
  }

  // ---- ZIP reader -------------------------------------------------------
  function inflateRaw(bytes) {
    if (typeof global.DecompressionStream !== 'function') {
      return Promise.reject(new Error('This ZIP is compressed. Unzip it in Files first, then pick the PDFs.'));
    }
    var ds = new global.DecompressionStream('deflate-raw');
    var stream = new Blob([bytes]).stream().pipeThrough(ds);
    return new Response(stream).arrayBuffer().then(function (b) { return new Uint8Array(b); });
  }
  function readZip(bytes) {
    var dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    var eocd = -1;
    for (var i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--) {
      if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
    }
    if (eocd < 0) return Promise.reject(new Error('Not a readable ZIP file.'));
    var count = dv.getUint16(eocd + 10, true), p = dv.getUint32(eocd + 16, true);
    var out = [], dec = new TextDecoder();
    for (var n = 0; n < count; n++) {
      if (dv.getUint32(p, true) !== 0x02014b50) break;
      var method = dv.getUint16(p + 10, true), csize = dv.getUint32(p + 20, true);
      var nlen = dv.getUint16(p + 28, true), xlen = dv.getUint16(p + 30, true), clen = dv.getUint16(p + 32, true);
      var local = dv.getUint32(p + 42, true);
      var name = dec.decode(bytes.subarray(p + 46, p + 46 + nlen));
      var lnl = dv.getUint16(local + 26, true), lxl = dv.getUint16(local + 28, true);
      var start = local + 30 + lnl + lxl;
      out.push({ name: name, method: method, data: bytes.subarray(start, start + csize) });
      p += 46 + nlen + xlen + clen;
    }
    return Promise.all(out.filter(function (e) { return !/\/$/.test(e.name); }).map(function (e) {
      if (e.method === 0) return Promise.resolve({ name: e.name, bytes: e.data });
      if (e.method === 8) return inflateRaw(e.data).then(function (b) { return { name: e.name, bytes: b }; });
      return Promise.resolve({ name: e.name, bytes: null, error: 'unsupported compression' });
    }));
  }

  // ---- helpers ------------------------------------------------------------
  function key(v) { return String(v || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, ''); }
  function part(v, fb) {
    var s = String(v == null ? '' : v).trim().replace(/[^A-Za-z0-9-]+/g, '_').replace(/^[_-]+|[_-]+$/g, '');
    return s || fb;
  }
  function todayIso() {
    var d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }
  function unitKeyOf(r) {
    return r.unitUid ? 'u:' + r.unitUid : 's:' + (r.sheet || '') + ':' + key(r.serial);
  }
  function isVerification(ref) {
    var V = global.LabCalVectorPdf;
    return !!(V && V.isVerificationRef && V.isVerificationRef(ref));
  }

  // The current certificate of every unit on a job (all days).
  function currentCertificatesFor(jobRef) {
    return global.LabCalCerts.all().then(function (list) {
      var mine = list.filter(function (r) { return key(r.jobRef) === key(jobRef) && r.blob; });
      var newest = {};
      mine.forEach(function (r) {
        var k = unitKeyOf(r), prev = newest[k];
        if (!prev) { newest[k] = r; return; }
        // a non-superseded record beats a superseded one; then the newest
        if ((prev.superseded && !r.superseded) ||
            (!!prev.superseded === !!r.superseded && String(r.savedAt) > String(prev.savedAt))) newest[k] = r;
      });
      return Object.keys(newest).map(function (k) { return newest[k]; });
    });
  }

  // ---- JOB PACK -----------------------------------------------------------
  function buildJobPack(jobRef, onProgress) {
    var C = global.LabCalCerts, J = global.LabCalJobsheet, V = global.LabCalVectorPdf;
    if (!C || !C.supported()) return Promise.reject(new Error('Certificate storage is not available.'));
    var job = J && J.jobByRef ? J.jobByRef(jobRef) : null;
    var ref = (job && job.callNumber) || jobRef || '';
    var customer = (job && (job.customer || job.site)) || '';
    var folder = part(ref, 'NoJob') + (customer ? '_' + part(customer, '') : '') + '_' + todayIso();
    folder = folder.replace(/_+/g, '_');

    return currentCertificatesFor(ref).then(function (certs) {
      if (!certs.length) throw new Error('There are no certificates on file for job ' + (ref || '(no reference)') + ' yet.');
      var summary = null;
      try {
        if (job && V && V.blobJobSummary && global.jspdf) summary = V.blobJobSummary(job, J.progressOf(job));
      } catch (e) { console.warn('Job summary not built:', e); }

      return C.mergeRecords(certs, summary, onProgress).then(function (merged) {
        return Promise.all([C.sha256Of(merged.blob), summary ? C.sha256Of(summary) : Promise.resolve('')])
          .then(function (h) { merged.sha256 = h[0]; if (summary) summary.__sha = h[1]; return merged; });
      }).then(function (merged) {
        var used = {}, entries = [], units = [];
        function uniqueName(n) {
          var base = n, i = 2;
          while (used[n.toLowerCase()]) { n = base.replace(/(\.[a-z0-9]+)$/i, '_' + (i++) + '$1'); }
          used[n.toLowerCase()] = true;
          return n;
        }
        var certFile = {};
        certs.forEach(function (r) {
          var name = uniqueName(r.filename || ('certificate_' + r.id + '.pdf'));
          certFile[r.id] = 'certificates/' + name;
          entries.push({ name: folder + '/certificates/' + name, data: r.blob });
        });
        entries.unshift({ name: folder + '/' + part(ref, 'NoJob') + '_ALL_certificates.pdf', data: merged.blob });
        if (summary) entries.splice(1, 0, { name: folder + '/' + part(ref, 'NoJob') + '_job_summary.pdf', data: summary });

        // manifest: every unit of the job, and which file is its certificate
        var claimed = {};
        var devices = job ? (job.devices || []).filter(function (d) { return !d.duplicateMerged; }) : [];
        devices.forEach(function (d, i) {
          var rec = certs.filter(function (r) { return d.uid && r.unitUid === d.uid; })[0] ||
                    certs.filter(function (r) { return !claimed[r.id] && key(r.serial) && key(r.serial) === key(d.serial); })[0] || null;
          if (rec) claimed[rec.id] = true;
          units.push({
            n: i + 1, uid: d.uid || '', model: d.model || d.equipment || '', serial: d.serial || '', location: d.location || '',
            status: d.done ? (isVerification(d.certRef) ? 'verified' : 'calibrated') : (d.notRequired ? 'not required' : 'to do'),
            certificate: rec ? { file: certFile[rec.id], certRef: rec.certRef || '', rev: rec.rev || 1,
                                 sha256: rec.sha256 || '', savedAt: rec.savedAt || '', sheet: rec.sheet || '' } : null
          });
        });
        certs.filter(function (r) { return !claimed[r.id]; }).forEach(function (r) {
          units.push({ n: units.length + 1, uid: r.unitUid || '', model: r.model || '', serial: r.serial || '', location: '',
                       status: 'certificate not matched to a unit on the job list',
                       certificate: { file: certFile[r.id], certRef: r.certRef || '', rev: r.rev || 1,
                                      sha256: r.sha256 || '', savedAt: r.savedAt || '', sheet: r.sheet || '' } });
        });
        var manifest = {
          kind: 'labcal-job-pack', version: 1, created: new Date().toISOString(),
          job: { ref: ref, customer: customer }, units: units,
          files: { all: { file: part(ref, 'NoJob') + '_ALL_certificates.pdf', sha256: merged.sha256 || '' },
                   summary: summary ? { file: part(ref, 'NoJob') + '_job_summary.pdf', sha256: summary.__sha || '' } : null }
        };
        entries.push({ name: folder + '/labcal_manifest.json', data: JSON.stringify(manifest, null, 2) });
        entries.push({ name: folder + '/README.txt', data:
          'LabCal job pack - ' + ref + (customer ? ' - ' + customer : '') + '\r\n' +
          'Created ' + new Date().toLocaleString('en-GB') + '\r\n\r\n' +
          part(ref, 'NoJob') + '_ALL_certificates.pdf  - job summary followed by every current certificate\r\n' +
          'certificates/  - each current certificate on its own\r\n' +
          'labcal_manifest.json  - which file belongs to which unit, with a SHA-256 fingerprint of each\r\n\r\n' +
          'To check these files later: LabCal > Calibration > Check certificates, and pick this ZIP or the PDFs.\r\n' });
        return makeZip(entries).then(function (zip) {
          return { blob: zip, name: folder + '.zip', ids: certs.map(function (r) { return r.id; }),
                   count: certs.length, units: units };
        });
      });
    });
  }

  // ---- REVIEW before "Save job pack" (v1.575) --------------------------------
  // The job pack goes to the office, where the final certificates are made.
  // Before it is saved, list what the office would otherwise have to chase:
  // units not finished, finished units with no certificate on this iPad,
  // certificates made before a serial correction, certificates that match no
  // unit. Revised certificates, verifications and "not required" units are
  // listed for information. Nothing here changes any data.
  //   → { ref, total, warn: n, items: [{ level:'warn'|'info', title, units:[text] }] }
  function reviewJobPack(jobRef) {
    var C = global.LabCalCerts, J = global.LabCalJobsheet;
    if (!C || !C.supported()) return Promise.reject(new Error('Certificate storage is not available.'));
    var job = J && J.jobByRef ? J.jobByRef(jobRef) : null;
    var ref = (job && job.callNumber) || jobRef || '';
    return currentCertificatesFor(ref).then(function (certs) {
      var devices = job ? (job.devices || []).filter(function (d) { return !d.duplicateMerged; }) : [];
      var claimed = {}, recOf = [];
      devices.forEach(function (d, i) {
        var rec = certs.filter(function (r) { return d.uid && r.unitUid === d.uid; })[0] ||
                  certs.filter(function (r) { return !claimed[r.id] && key(r.serial) && key(r.serial) === key(d.serial); })[0] || null;
        if (rec) claimed[rec.id] = true;
        recOf[i] = rec;
      });
      function who(d) {
        return [d.model || d.equipment || '', d.serial || 'no serial', d.location || ''].filter(Boolean).join(' · ');
      }
      var notDone = [], noCert = [], oldSerial = [], revised = [], verified = [], notReq = [];
      devices.forEach(function (d, i) {
        var rec = recOf[i];
        if (d.notRequired && !d.done) {
          notReq.push(who(d) + ((d.notRequiredReason || d.reason) ? ' — ' + (d.notRequiredReason || d.reason) : ''));
          return;
        }
        if (!d.done) {
          var started = false;
          try { started = !!(J.isStarted && J.isStarted(ref, d)); } catch (e) {}
          notDone.push(who(d) + (started ? ' — readings started, not finished' : ''));
          return;
        }
        if (!rec) noCert.push(who(d) + (d.certRef ? ' — ' + d.certRef : ''));
        if (d.serialWas) oldSerial.push(who(d) + ' — certificate shows ' + d.serialWas);
        if (rec && Number(rec.rev) > 1) revised.push(who(d) + ' — ' + (rec.certRef || '') + ' rev ' + rec.rev);
        if (isVerification(d.certRef)) verified.push(who(d));
      });
      var stray = certs.filter(function (r) { return !claimed[r.id]; }).map(function (r) {
        return [r.model || '', r.serial || 'no serial', r.certRef || ''].filter(Boolean).join(' · ');
      });
      var items = [];
      function add(level, list, one, many) {
        if (list.length) items.push({ level: level, title: (list.length === 1 ? one : many.replace('#', list.length)), units: list });
      }
      add('warn', notDone, '1 unit is not finished — no certificate in the pack', '# units are not finished — no certificate in the pack');
      add('warn', noCert, '1 finished unit has no certificate on this iPad', '# finished units have no certificate on this iPad');
      add('warn', oldSerial, '1 certificate was made before its serial was corrected', '# certificates were made before their serial was corrected');
      add('warn', stray, '1 certificate on this job matches no unit on the list', '# certificates on this job match no unit on the list');
      add('info', revised, '1 revised certificate (the latest one goes in the pack)', '# revised certificates (the latest ones go in the pack)');
      add('info', verified, '1 verification (S 00000)', '# verifications (S 00000)');
      add('info', notReq, '1 unit marked not required', '# units marked not required');
      return {
        ref: ref, total: devices.length, certificates: certs.length,
        warn: items.filter(function (x) { return x.level === 'warn'; }).length, items: items
      };
    });
  }

  // ---- CHECK --------------------------------------------------------------
  function latin1(bytes) {
    var s = '', CH = 0x8000;
    for (var i = 0; i < bytes.length; i += CH) s += String.fromCharCode.apply(null, bytes.subarray(i, i + CH));
    return s;
  }
  function identityIn(bytes) {
    var m = latin1(bytes).match(/\/Keywords\s*\((labcal=1;[^)]*)\)/);
    if (!m) return null;
    var id = {};
    m[1].split(';').forEach(function (kv) {
      var i = kv.indexOf('=');
      if (i > 0) id[kv.slice(0, i).trim()] = kv.slice(i + 1).trim();
    });
    return id;
  }

  function checkOnePdf(name, bytes, records) {
    var C = global.LabCalCerts;
    return C.sha256Of(bytes).then(function (sha) {
      var byHash = sha ? records.filter(function (r) { return r.sha256 && r.sha256 === sha; })[0] : null;
      var id = identityIn(bytes);
      var res = { file: name, sha256: sha, identity: id };
      function sameUnitAs(a) {
        return function (r) {
          if (a.unitUid && r.unitUid) return a.unitUid === r.unitUid;
          return key(r.serial) === key(a.serial) && key(r.jobRef) === key(a.jobRef);
        };
      }
      if (byHash) {
        var newer = records.filter(sameUnitAs(byHash)).filter(function (r) {
          return r.id !== byHash.id && String(r.savedAt) > String(byHash.savedAt);
        }).sort(function (a, b) { return String(a.savedAt) < String(b.savedAt) ? 1 : -1; });
        res.record = byHash;
        if (byHash.superseded || newer.length) { res.status = 'old'; res.newer = newer[0] || null; }
        else res.status = 'ok';
        return res;
      }
      if (id) {
        var cands = records.filter(function (r) {
          if (id.uid && r.unitUid) return r.unitUid === id.uid;
          return key(r.serial) === key(id.serial) && key(r.jobRef) === key(id.job);
        });
        res.status = cands.length ? 'changed' : 'foreign';
        res.candidates = cands;
        return res;
      }
      var sameName = records.filter(function (r) { return r.filename === name.split('/').pop(); })[0];
      res.status = sameName ? 'changed' : 'unknown';
      if (sameName) res.candidates = [sameName];
      return res;
    });
  }

  // files: FileList/array of File. Returns { results, jobs:[{ref, missing:[device]}] }
  function checkFiles(files) {
    var C = global.LabCalCerts, J = global.LabCalJobsheet;
    if (!C || !C.supported()) return Promise.reject(new Error('Certificate storage is not available.'));
    var pdfs = [], manifests = [];
    var reads = Array.prototype.map.call(files, function (f) {
      return toBytes(f).then(function (bytes) {
        if (/\.zip$/i.test(f.name) || /zip/.test(f.type || '')) {
          return readZip(bytes).then(function (entries) {
            entries.forEach(function (e) {
              if (!e.bytes) return;
              if (/\.pdf$/i.test(e.name)) pdfs.push({ name: f.name + ' › ' + e.name.split('/').slice(1).join('/'), bytes: e.bytes });
              else if (/labcal_manifest\.json$/i.test(e.name)) {
                try { manifests.push(JSON.parse(new TextDecoder().decode(e.bytes))); } catch (x) {}
              }
            });
          });
        }
        pdfs.push({ name: f.name, bytes: bytes });
      });
    });
    return Promise.all(reads).then(function () { return C.all(); }).then(function (records) {
      // the pack's own merged PDF and summary are listed in its manifest
      var packFiles = {};
      manifests.forEach(function (m) {
        var f = m.files || {};
        ['all', 'summary'].forEach(function (k) {
          if (f[k] && f[k].sha256) packFiles[f[k].sha256] = { what: k, job: (m.job || {}).ref || '' };
        });
      });
      return Promise.all(pdfs.map(function (p) {
        return checkOnePdf(p.name, p.bytes, records).then(function (r) {
          if (r.status === 'unknown' && r.sha256 && packFiles[r.sha256]) { r.status = 'packfile'; r.pack = packFiles[r.sha256]; }
          return r;
        });
      })).then(function (results) {
        // completeness per job touched by these files
        var jobRefs = {};
        results.forEach(function (r) {
          if (r.record && r.record.jobRef) jobRefs[key(r.record.jobRef)] = r.record.jobRef;
          else if (r.identity && r.identity.job) jobRefs[key(r.identity.job)] = r.identity.job;
        });
        manifests.forEach(function (m) { if (m.job && m.job.ref) jobRefs[key(m.job.ref)] = m.job.ref; });
        var okIds = {};
        results.forEach(function (r) { if (r.status === 'ok' && r.record) okIds[r.record.id] = true; });
        var jobs = Object.keys(jobRefs).map(function (k) {
          var job = J && J.jobByRef ? J.jobByRef(jobRefs[k]) : null;
          if (!job) return { ref: jobRefs[k], known: false, missing: [] };
          var missing = (job.devices || []).filter(function (d) { return d.done && !d.duplicateMerged; }).filter(function (d) {
            var mine = records.filter(function (r) {
              return !r.superseded && ((d.uid && r.unitUid === d.uid) || (key(r.serial) === key(d.serial) && key(r.jobRef) === k));
            });
            return !mine.some(function (r) { return okIds[r.id]; });
          });
          return { ref: job.callNumber, known: true, missing: missing };
        });
        return { results: results, jobs: jobs };
      });
    });
  }

  global.LabCalJobPack = {
    buildJobPack: buildJobPack,
    reviewJobPack: reviewJobPack,
    checkFiles: checkFiles,
    makeZip: makeZip,
    readZip: readZip,
    identityIn: identityIn,
    currentCertificatesFor: currentCertificatesFor
  };
})(typeof window !== 'undefined' ? window : this);

(window.LabCalBuild = window.LabCalBuild || {})['labcal_jobpack.js'] = 'v1.604';  // file version — see labcal_build.js
/* ---------------------------------------------------------------------
   LabCal — job pack & certificate check (v1.550)
   ---------------------------------------------------------------------
   JOB PACK — one file per job, saved once:
     <JOB>_<customer>_<date>.zip
       <folder>/<JOB>_ALL_certificates.pdf    summary + every current cert
       <folder>/<JOB>_job_summary.pdf
       <folder>/<JOB>_jobsheet.pdf            the jobsheet as loaded (v1.585, when kept)
       <folder>/certificates/<each current certificate>.pdf
       <folder>/labcal_manifest.sealed        unit ↔ file ↔ SHA-256 (sealed, v1.594;
                                              older packs: labcal_manifest.json)
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
      var t0 = new Date(), now = dosTime(new Date(t0.getFullYear(), t0.getMonth(), t0.getDate(), 0, 0, 0));   // v1.594: date only
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
  // README carries the DATE only (v1.581, Radek): same DD/Mon/YYYY form as the
  // certificates. The manifest keeps its full ISO time — "Check certificates"
  // and the fingerprints rely on it, and it is a technical record, not a note.
  function readmeDate() {
    var d = new Date();
    var M = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    return String(d.getDate()).padStart(2, '0') + '/' + M[d.getMonth()] + '/' + d.getFullYear();
  }
  function unitKeyOf(r) {
    return r.unitUid ? 'u:' + r.unitUid : 's:' + (r.sheet || '') + ':' + key(r.serial);
  }
  function isVerification(ref) {
    var V = global.LabCalVectorPdf;
    return !!(V && V.isVerificationRef && V.isVerificationRef(ref));
  }

  // ---- v1.594 (Radek): sealed manifest -------------------------------------
  // The pack's checklist (which file belongs to which unit, SHA-256 of each,
  // when each certificate was made) is written as labcal_manifest.sealed:
  // AES-256-GCM (the browser's own crypto), so opened in Notepad it is
  // unreadable, and changing a single byte makes LabCal refuse it as
  // "altered". The key is NOT in the pack — it is here in LabCal's code.
  // Honest limit: anyone who reads LabCal's code can find the key; this
  // stops casual reading and editing, it is not a secret from a programmer.
  // Radek keeps a separate reader (labcal_manifest_reader.html, NOT part of
  // the app) that opens a sealed manifest on his computer.
  // Keys have an id so a later version can add a new key and still read old
  // packs. Older packs (plain labcal_manifest.json) are still read.
  var MANIFEST_KEYS = { k1: '5aeb45b1b8b9c246bf88bcdfaf2c98c669ee30fee144b460b13a0b07ff9ea538' };
  var MANIFEST_KEY_NOW = 'k1';
  var SEAL_HEAD = 'LabCal sealed manifest v1';
  var SEALED_NAME = 'labcal_manifest.sealed';
  var MANIFEST_RE = /(^|\/)labcal_manifest\.(sealed|json)$/i;

  function hexBytes(h) { var a = new Uint8Array(h.length / 2); for (var i = 0; i < a.length; i++) a[i] = parseInt(h.substr(i * 2, 2), 16); return a; }
  function b64(bytes) { var s = ''; for (var i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000)); return global.btoa(s); }
  function unb64(t) { var s = global.atob(t), a = new Uint8Array(s.length); for (var i = 0; i < s.length; i++) a[i] = s.charCodeAt(i); return a; }
  function subtle() { return global.crypto && global.crypto.subtle; }
  function sealKey(id, use) {
    return subtle().importKey('raw', hexBytes(MANIFEST_KEYS[id]), { name: 'AES-GCM' }, false, [use]);
  }
  // manifest object → { name, data } for the ZIP. The browser's crypto is
  // always there on the https site; if it is not, the pack is refused with a
  // clear message rather than written unsealed (an unsealed checklist from
  // this version would look like an older pack and could be edited).
  function sealManifest(manifest) {
    var json = JSON.stringify(manifest, null, 2);
    if (!subtle() || !global.crypto.getRandomValues) {
      return Promise.reject(new Error('This browser cannot seal the job pack checklist (no secure crypto). Open LabCal from its https address and try again.'));
    }
    var id = MANIFEST_KEY_NOW, iv = global.crypto.getRandomValues(new Uint8Array(12));
    var aad = new TextEncoder().encode(SEAL_HEAD + '|' + id);
    return sealKey(id, 'encrypt').then(function (k) {
      return subtle().encrypt({ name: 'AES-GCM', iv: iv, additionalData: aad, tagLength: 128 }, k, new TextEncoder().encode(json));
    }).then(function (ct) {
      var c = new Uint8Array(ct), all = new Uint8Array(12 + c.length);
      all.set(iv, 0); all.set(c, 12);
      var body = b64(all).replace(/(.{76})/g, '$1\r\n');
      return { name: SEALED_NAME, sealed: true,
               data: SEAL_HEAD + '\r\nkey: ' + id + '\r\nThis file is read by LabCal (Check certificates, Combine packs). Changing it makes the pack untrusted.\r\n\r\n' + body + '\r\n' };
    });
  }
  // A plain labcal_manifest.json is only genuine from LabCal before v1.594.
  function plainAllowed(m) {
    var v = /v?1\.(\d+)/.exec(String((m && m.app) || ''));
    return !v || Number(v[1]) < 594;
  }
  // bytes of labcal_manifest.sealed / .json → Promise<{ manifest, state }>
  //   state: 'sealed' (checked, unchanged) | 'plain' (older pack)
  //   rejects with { altered: true } when the seal does not check out.
  function openManifest(name, bytes) {
    var text = new TextDecoder().decode(bytes);
    if (/\.json$/i.test(name)) {
      var m = null; try { m = JSON.parse(text); } catch (e) {}
      if (!m) return Promise.reject({ altered: true, why: 'the checklist is damaged' });
      if (!plainAllowed(m)) return Promise.reject({ altered: true, why: 'the checklist should be sealed (made by LabCal ' + m.app + ') but is plain text' });
      return Promise.resolve({ manifest: m, state: 'plain' });
    }
    var lines = text.split(/\r?\n/);
    var km = /^key:\s*(\w+)\s*$/.exec(lines[1] || '');
    if (lines[0] !== SEAL_HEAD || !km) return Promise.reject({ altered: true, why: 'the checklist is not in LabCal’s format' });
    if (!MANIFEST_KEYS[km[1]]) return Promise.reject({ altered: true, why: 'the checklist was sealed by a newer LabCal — update this iPad' });
    if (!subtle()) return Promise.reject({ altered: false, why: 'this browser cannot open sealed checklists' });
    var body = lines.slice(3).join('').replace(/\s+/g, ''), all;
    try { all = unb64(body); } catch (e) { return Promise.reject({ altered: true, why: 'the checklist has been changed' }); }
    if (all.length < 12 + 16) return Promise.reject({ altered: true, why: 'the checklist has been changed' });
    var aad = new TextEncoder().encode(SEAL_HEAD + '|' + km[1]);
    return sealKey(km[1], 'decrypt').then(function (k) {
      return subtle().decrypt({ name: 'AES-GCM', iv: all.subarray(0, 12), additionalData: aad, tagLength: 128 }, k, all.subarray(12));
    }).then(function (plain) {
      var m = JSON.parse(new TextDecoder().decode(plain));
      return { manifest: m, state: 'sealed' };
    }, function () {
      throw { altered: true, why: 'the checklist has been changed since LabCal made it' };
    });
  }

  // The current certificate of every unit on a job (all days).
  function currentCertificatesFor(jobRef) {
    return global.LabCalCerts.all().then(function (list) {
      // v1.584: certificates in the bin never go in a pack
      var mine = list.filter(function (r) { return key(r.jobRef) === key(jobRef) && r.blob && !r.deletedAt; });
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

  // v1.586: who made the pack — the engineer named in the loaded offsets file
  function engineerName() {
    try {
      var O = global.LabCalOffsets;
      var list = (O && O.all) ? O.all() : [];
      for (var i = 0; i < list.length; i++) if (list[i] && list[i].engineerName) return list[i].engineerName;
    } catch (e) {}
    return '';
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

      // v1.585 (Radek): the jobsheet PDF goes in as its own file — never
      // into the merged certificates PDF, which stays certificates only.
      var jobsheet = null;
      var F = global.LabCalJobFiles;
      var sheetP = (F && F.supported && F.supported())
        ? F.get(ref).then(function (r) { if (r && r.blob && r.blob.size) jobsheet = r; }).catch(function (e) { console.warn('Jobsheet PDF not added to the pack:', e); })
        : Promise.resolve();

      return sheetP.then(function () { return C.mergeRecords(certs, summary, onProgress); }).then(function (merged) {
        return Promise.all([C.sha256Of(merged.blob), summary ? C.sha256Of(summary) : Promise.resolve(''),
                            jobsheet ? C.sha256Of(jobsheet.blob) : Promise.resolve('')])
          .then(function (h) { merged.sha256 = h[0]; if (summary) summary.__sha = h[1]; if (jobsheet) jobsheet.__sha = h[2]; return merged; });
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
        var sheetName = part(ref, 'NoJob') + '_jobsheet.pdf';
        if (jobsheet) entries.splice(summary ? 2 : 1, 0, { name: folder + '/' + sheetName, data: jobsheet.blob });

        // manifest: every unit of the job, and which file is its certificate
        var claimed = {};
        var devices = job ? (job.devices || []).filter(function (d) { return !d.duplicateMerged; }) : [];
        devices.forEach(function (d, i) {
          var rec = certs.filter(function (r) { return d.uid && r.unitUid === d.uid; })[0] ||
                    certs.filter(function (r) { return !claimed[r.id] && key(r.serial) && key(r.serial) === key(d.serial); })[0] || null;
          if (rec) claimed[rec.id] = true;
          units.push({
            n: i + 1, uid: d.uid || '', model: d.model || d.equipment || '', serial: d.serial || '', location: d.location || '',
            // v1.586: what "Combine job packs" needs to rebuild the job summary
            sheet: d.sheet || '', reason: (d.notRequired && !d.done) ? (d.notRequiredReason || d.reason || '') : '', detail: d.detail || '',
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
          engineer: engineerName(), app: (global.LabCalBuild && global.LabCalBuild['labcal_jobpack.js']) || '',
          job: { ref: ref, customer: customer }, units: units,
          files: { all: { file: part(ref, 'NoJob') + '_ALL_certificates.pdf', sha256: merged.sha256 || '' },
                   summary: summary ? { file: part(ref, 'NoJob') + '_job_summary.pdf', sha256: summary.__sha || '' } : null,
                   jobsheet: jobsheet ? { file: sheetName, sha256: jobsheet.__sha || '', original: jobsheet.fileName || '', loadedAt: jobsheet.savedAt || '' } : null }
        };
        return sealManifest(manifest).then(function (sm) {
        entries.push({ name: folder + '/' + sm.name, data: sm.data });
        entries.push({ name: folder + '/README.txt', data:
          'LabCal job pack - ' + ref + (customer ? ' - ' + customer : '') + '\r\n' +
          'Created ' + readmeDate() + '\r\n\r\n' +
          part(ref, 'NoJob') + '_ALL_certificates.pdf  - job summary followed by every current certificate\r\n' +
          (jobsheet ? sheetName + '  - the jobsheet this job was loaded from (' + (jobsheet.fileName || '') + ')\r\n' : '') +
          'certificates/  - each current certificate on its own\r\n' +
          sm.name + '  - LabCal\'s checklist: which file belongs to which unit, with a fingerprint of each' + (sm.sealed ? ' (sealed - read by LabCal)' : '') + '\r\n\r\n' +
          'To check these files later: LabCal > Calibration > Check certificates, and pick this ZIP or the PDFs.\r\n' });
        return makeZip(entries).then(function (zip) {
          return { blob: zip, name: folder + '.zip', ids: certs.map(function (r) { return r.id; }),
                   count: certs.length, units: units, jobsheet: !!jobsheet };
        });
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
      // v1.584: identical to a certificate that was deleted (in the bin)
      if (byHash && byHash.deletedAt) { res.record = byHash; res.status = 'removed'; return res; }
      if (byHash) {
        var newer = records.filter(sameUnitAs(byHash)).filter(function (r) {
          return r.id !== byHash.id && !r.deletedAt && String(r.savedAt) > String(byHash.savedAt);
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
    var pdfs = [], manifests = [], manRaw = [], packs = [];
    var reads = Array.prototype.map.call(files, function (f) {
      return toBytes(f).then(function (bytes) {
        if (/\.zip$/i.test(f.name) || /zip/.test(f.type || '')) {
          return readZip(bytes).then(function (entries) {
            entries.forEach(function (e) {
              if (!e.bytes) return;
              if (/\.pdf$/i.test(e.name)) pdfs.push({ name: f.name + ' › ' + e.name.split('/').slice(1).join('/'), bytes: e.bytes });
              else if (MANIFEST_RE.test(e.name)) manRaw.push({ zip: f.name, name: e.name, bytes: e.bytes });
            });
          }).then(function () {
            // v1.594: sealed checklist — opened and checked; an altered one is
            // reported and NOT used to vouch for any file.
            var mine = manRaw.filter(function (mr) { return mr.zip === f.name; });
            manRaw = manRaw.filter(function (mr) { return mr.zip !== f.name; });
            // a sealed checklist wins over any plain one found next to it
            if (mine.some(function (mr) { return /\.sealed$/i.test(mr.name); })) mine = mine.filter(function (mr) { return /\.sealed$/i.test(mr.name); });
            return Promise.all(mine.map(function (mr) {
              return openManifest(mr.name, mr.bytes).then(function (o) {
                manifests.push(o.manifest);
                packs.push({ file: mr.zip, state: o.state, job: (o.manifest.job || {}).ref || '' });
              }, function (err) {
                packs.push({ file: mr.zip, state: err && err.altered === false ? 'unreadable' : 'altered', why: (err && err.why) || 'the checklist could not be read' });
              });
            }));
          });
        }
        pdfs.push({ name: f.name, bytes: bytes });
      });
    });
    return Promise.all(reads).then(function () { return C.all(); }).then(function (records) {
      // the pack's own merged PDF and summary are listed in its manifest
      var packFiles = {}, packCerts = {};
      manifests.forEach(function (m) {
        var f = m.files || {};
        ['all', 'summary', 'jobsheet'].forEach(function (k) {
          if (f[k] && f[k].sha256) packFiles[f[k].sha256] = { what: k, job: (m.job || {}).ref || '' };
        });
        // v1.586: certificates listed in the pack's checklist — in a combined
        // pack some were made on another engineer's iPad
        (m.units || []).forEach(function (u) {
          var c = u.certificate;
          if (c && c.sha256) packCerts[c.sha256] = { job: (m.job || {}).ref || '', serial: u.serial || '', certRef: c.certRef || '',
                                                      engineer: c.engineer || m.engineer || '', fromPack: c.fromPack || '' };
        });
      });
      return Promise.all(pdfs.map(function (p) {
        return checkOnePdf(p.name, p.bytes, records).then(function (r) {
          if (r.status === 'unknown' && r.sha256 && packFiles[r.sha256]) { r.status = 'packfile'; r.pack = packFiles[r.sha256]; }
          else if ((r.status === 'unknown' || r.status === 'foreign') && r.sha256 && packCerts[r.sha256]) { r.status = 'packcert'; r.pack = packCerts[r.sha256]; }
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
              return !r.superseded && !r.deletedAt && ((d.uid && r.unitUid === d.uid) || (key(r.serial) === key(d.serial) && key(r.jobRef) === k));
            });
            return !mine.some(function (r) { return okIds[r.id]; });
          });
          return { ref: job.callNumber, known: true, missing: missing };
        });
        return { results: results, jobs: jobs, packs: packs };
      });
    });
  }


  // ---- COMBINE job packs (v1.586, Radek) ---------------------------------
  // Two (or more) engineers on one job, each doing their OWN units, each
  // saving their own job pack. "Combine job packs" makes ONE pack for the
  // office from them — only from the files, so it works on any iPad (or a
  // computer) and nothing on this iPad is changed.
  //
  //   readPack(file)           → the pack's manifest + its files
  //   planCombine(packs)       → what would go in, and anything to decide:
  //       errors    — different jobs, not a job pack: nothing is made
  //       conflicts — the SAME unit certified in two packs with different
  //                   files: the engineer picks which one goes in
  //       warnings  — a file that does not match its fingerprint, the same
  //                   certificate number on two units, different jobsheets
  //   buildCombined(plan, choices) → { blob, name, … } — a normal job pack
  //       (same layout, manifest lists where each certificate came from), so
  //       "Check certificates" works on it like on any other pack.
  function readPack(file, label) {
    return toBytes(file).then(function (bytes) {
      return readZip(bytes).catch(function () { throw new Error((label || file.name) + ' is not a ZIP file.'); });
    }).then(function (entries) {
      var man = entries.filter(function (e) { return MANIFEST_RE.test(e.name) && /\.sealed$/i.test(e.name) && e.bytes; })[0] ||
                entries.filter(function (e) { return MANIFEST_RE.test(e.name) && e.bytes; })[0];
      if (!man) throw new Error((label || file.name) + ' is not a LabCal job pack (it has no LabCal checklist).');
      return openManifest(man.name, man.bytes).then(function (o) { return { man: man, o: o, entries: entries }; }, function (err) {
        throw new Error((label || file.name) + ': ' + ((err && err.why) || 'the checklist could not be read') +
          (err && err.altered === false ? '.' : ' \u2014 this pack cannot be trusted and was not used.'));
      });
    }).then(function (x) {
      var man = x.man, entries = x.entries, manifest = x.o.manifest;
      if (!manifest || manifest.kind !== 'labcal-job-pack') throw new Error((label || file.name) + ' is not a LabCal job pack.');
      var folder = man.name.replace(MANIFEST_RE, '');
      var files = {};
      entries.forEach(function (e) {
        if (!e.bytes) return;
        var rel = folder && e.name.indexOf(folder + '/') === 0 ? e.name.slice(folder.length + 1) : e.name;
        files[rel] = e.bytes;
      });
      return { label: label || file.name || 'pack', folder: folder, manifest: manifest, files: files, sealed: x.o.state === 'sealed' };
    });
  }

  function unitIdentity(u) {
    var s = key(u.serial);
    return s ? 'S:' + s : 'M:' + key(u.model) + '|' + key(u.location);
  }

  function planCombine(packs) {
    var C = global.LabCalCerts;
    var plan = { ref: '', customer: '', packs: [], units: [], conflicts: [], warnings: [], errors: [], jobsheet: null };
    if (!packs || packs.length < 2) plan.errors.push('Pick at least two job packs to combine.');
    var refs = {};
    (packs || []).forEach(function (pk) {
      var r = (pk.manifest.job && pk.manifest.job.ref) || '';
      refs[key(r) || '(none)'] = r || '(no job reference)';
    });
    var refKeys = Object.keys(refs);
    if (refKeys.length > 1) plan.errors.push('These packs are for DIFFERENT jobs (' + refKeys.map(function (k) { return refs[k]; }).join(', ') + '). Only packs of the same job can be combined.');
    var first = (packs && packs[0] && packs[0].manifest) || {};
    plan.ref = (first.job && first.job.ref) || '';
    plan.customer = (first.job && first.job.customer) || '';

    var byId = {}, order = [], checks = [];
    (packs || []).forEach(function (pk, pi) {
      var m = pk.manifest;
      var certs = 0;
      (m.units || []).forEach(function (u) {
        var id = unitIdentity(u);
        if (!byId[id]) {
          byId[id] = { id: id, model: u.model || '', serial: u.serial || '', location: u.location || '', sheet: u.sheet || (u.certificate && u.certificate.sheet) || '',
                       statuses: [], reasons: [], details: [], options: [] };
          order.push(id);
        }
        var U = byId[id];
        if (!U.location && u.location) U.location = u.location;
        if (!U.model && u.model) U.model = u.model;
        if (!U.sheet && (u.sheet || (u.certificate && u.certificate.sheet))) U.sheet = u.sheet || u.certificate.sheet;
        U.statuses.push(u.status || '');
        if (u.reason) U.reasons.push(u.reason);
        if (u.detail) U.details.push(u.detail);
        var c = u.certificate;
        if (!c || !c.file) return;
        certs++;
        var bytes = pk.files[c.file];
        if (!bytes) { plan.warnings.push(pk.label + ': the certificate file ' + c.file + ' is missing from the pack — ' + (u.serial || u.model) + ' left out from this pack.'); return; }
        var opt = { pack: pi, packLabel: pk.label, engineer: m.engineer || '', file: c.file, name: c.file.split('/').pop(), certRef: c.certRef || '', rev: c.rev || 1,
                    savedAt: c.savedAt || '', sheet: c.sheet || '', sha256: c.sha256 || '', bytes: bytes };
        checks.push(C.sha256Of(bytes).then(function (h) {
          opt.actual = h || '';
          if (opt.sha256 && h && opt.sha256 !== h) {
            opt.changed = true;
            plan.warnings.push(pk.label + ': ' + opt.name + ' does NOT match its fingerprint in the pack — the file was changed after the pack was made.');
          }
        }));
        U.options.push(opt);
      });
      var js = m.files && m.files.jobsheet;
      if (js && js.file && pk.files[js.file]) {
        var cand = { pack: pi, packLabel: pk.label, name: js.file, original: js.original || '', loadedAt: js.loadedAt || '', sha256: js.sha256 || '', bytes: pk.files[js.file] };
        if (!plan.jobsheet) plan.jobsheet = cand;
        else if (cand.sha256 !== plan.jobsheet.sha256) {
          if (String(cand.loadedAt) > String(plan.jobsheet.loadedAt)) plan.jobsheet = cand;
          plan.__sheetDiffers = true;
        }
      }
      plan.packs.push({ label: pk.label, engineer: m.engineer || '', created: m.created || '', units: (m.units || []).length, certificates: certs,
                        combined: !!m.combined });
    });
    if (plan.__sheetDiffers) plan.warnings.push('The packs carry different jobsheet PDFs — the newest one (' + (plan.jobsheet.original || plan.jobsheet.name) + ', from ' + plan.jobsheet.packLabel + ') is used.');
    delete plan.__sheetDiffers;

    return Promise.all(checks).then(function () {
      order.forEach(function (id) {
        var U = byId[id];
        // the same file in two packs (e.g. a pack combined twice) counts once
        var seen = {}, opts = [];
        U.options.forEach(function (o) {
          var h = o.actual || o.sha256 || (o.name + '|' + o.savedAt);
          if (seen[h]) return; seen[h] = true; opts.push(o);
        });
        U.options = opts;
        var st = U.statuses;
        U.status = opts.length ? (isVerification(opts[0].certRef) ? 'verified' : 'calibrated')
                 : (st.indexOf('not required') !== -1 ? 'not required' : 'to do');
        U.reason = U.reasons[0] || '';
        U.detail = U.details[0] || '';
        if (opts.length > 1) {
          var newest = opts.slice().sort(function (a, b) { return String(a.savedAt) < String(b.savedAt) ? 1 : -1; })[0];
          plan.conflicts.push({ unit: plan.units.length, label: [U.model, U.serial || 'no serial', U.location].filter(Boolean).join(' · '),
                                options: opts.map(function (o, oi) { return { i: oi, pack: o.packLabel, engineer: o.engineer, certRef: o.certRef, rev: o.rev, savedAt: o.savedAt, name: o.name }; }),
                                suggested: opts.indexOf(newest) });
        }
        // a unit certified by one engineer and "not required" / "to do" in the
        // other pack is simply certified — nothing to decide
        plan.units.push(U);
      });
      // the same certificate number on two different units
      var byRef = {};
      plan.units.forEach(function (U) {
        U.options.forEach(function (o) {
          var r = key(o.certRef);
          if (!r || !/\d/.test(r) || /^0+$/.test(r.replace(/\D/g, ''))) return;
          (byRef[r] = byRef[r] || {})[U.id] = { ref: o.certRef, who: (U.serial || U.model) + ' (' + o.packLabel + ')' };
        });
      });
      Object.keys(byRef).forEach(function (r) {
        var ids = Object.keys(byRef[r]);
        if (ids.length > 1) plan.warnings.push('Certificate No. ' + byRef[r][ids[0]].ref + ' is used for ' + ids.length + ' different units: ' +
          ids.map(function (i) { return byRef[r][i].who; }).join(', ') + '. Two units must not share a certificate number.');
      });
      plan.certificates = plan.units.filter(function (U) { return U.options.length; }).length;
      return plan;
    });
  }

  // choices: { unitIndex: optionIndex } for the conflicts (default = suggested)
  function buildCombined(plan, choices, onProgress) {
    var C = global.LabCalCerts, V = global.LabCalVectorPdf;
    if (plan.errors && plan.errors.length) return Promise.reject(new Error(plan.errors[0]));
    choices = choices || {};
    var pick = {};
    plan.conflicts.forEach(function (cf) { pick[cf.unit] = (choices[cf.unit] !== undefined) ? Number(choices[cf.unit]) : cf.suggested; });
    var ref = plan.ref, customer = plan.customer;
    var folder = (part(ref, 'NoJob') + (customer ? '_' + part(customer, '') : '') + '_' + todayIso() + '_combined').replace(/_+/g, '_');

    var chosen = [];   // [{ U, o }]
    plan.units.forEach(function (U, ui) {
      if (!U.options.length) return;
      var o = U.options[pick[ui] !== undefined ? pick[ui] : 0] || U.options[0];
      chosen.push({ U: U, o: o, ui: ui });
    });
    if (!chosen.length) return Promise.reject(new Error('None of these packs has a certificate in it.'));

    // one job summary for the whole job
    var job = { callNumber: ref, customer: customer, devices: plan.units.map(function (U, ui) {
      var ch = chosen.filter(function (x) { return x.ui === ui; })[0];
      return { model: U.model, serial: U.serial, location: U.location, sheet: (ch && ch.o.sheet) || U.sheet,
               done: !!ch, certRef: ch ? ch.o.certRef : '', detail: U.detail,
               notRequired: !ch && U.status === 'not required', notRequiredReason: U.reason };
    }) };
    var done = job.devices.filter(function (d) { return d.done; }).length;
    var notReq = job.devices.filter(function (d) { return d.notRequired; }).length;
    var progress = { total: job.devices.length, done: done, notRequired: notReq, outstanding: job.devices.length - done - notReq };
    var summary = null;
    try { if (V && V.blobJobSummary && global.jspdf) summary = V.blobJobSummary(job, progress); }
    catch (e) { console.warn('Combined job summary not built:', e); }

    var records = chosen.map(function (x, i) {
      return { id: i + 1, certRef: x.o.certRef, filename: x.o.name, savedAt: x.o.savedAt,
               blob: new Blob([x.o.bytes], { type: 'application/pdf' }) };
    });
    return C.mergeRecords(records, summary, onProgress).then(function (merged) {
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
      var fileOf = {};
      chosen.forEach(function (x, i) {
        var name = uniqueName(x.o.name || ('certificate_' + (i + 1) + '.pdf'));
        fileOf[x.ui] = 'certificates/' + name;
        entries.push({ name: folder + '/certificates/' + name, data: records[i].blob });
      });
      var P = part(ref, 'NoJob');
      entries.unshift({ name: folder + '/' + P + '_ALL_certificates.pdf', data: merged.blob });
      if (summary) entries.splice(1, 0, { name: folder + '/' + P + '_job_summary.pdf', data: summary });
      var sheetName = P + '_jobsheet.pdf';
      if (plan.jobsheet) entries.splice(summary ? 2 : 1, 0, { name: folder + '/' + sheetName, data: new Blob([plan.jobsheet.bytes], { type: 'application/pdf' }) });

      plan.units.forEach(function (U, ui) {
        var ch = chosen.filter(function (x) { return x.ui === ui; })[0];
        units.push({ n: ui + 1, uid: '', model: U.model, serial: U.serial, location: U.location, sheet: (ch && ch.o.sheet) || U.sheet,
          reason: U.reason, detail: U.detail, status: U.status,
          certificate: ch ? { file: fileOf[ui], certRef: ch.o.certRef, rev: ch.o.rev, sha256: ch.o.actual || ch.o.sha256, savedAt: ch.o.savedAt,
                              sheet: ch.o.sheet, fromPack: ch.o.packLabel, engineer: ch.o.engineer } : null });
      });
      var manifest = {
        kind: 'labcal-job-pack', version: 1, created: new Date().toISOString(), combined: true,
        engineer: plan.packs.map(function (p) { return p.engineer; }).filter(Boolean).filter(function (v, i, a) { return a.indexOf(v) === i; }).join(' + '),
        app: (global.LabCalBuild && global.LabCalBuild['labcal_jobpack.js']) || '',
        sources: plan.packs.map(function (p) { return { file: p.label, engineer: p.engineer, created: p.created, units: p.units, certificates: p.certificates }; }),
        job: { ref: ref, customer: customer }, units: units,
        files: { all: { file: P + '_ALL_certificates.pdf', sha256: merged.sha256 || '' },
                 summary: summary ? { file: P + '_job_summary.pdf', sha256: summary.__sha || '' } : null,
                 jobsheet: plan.jobsheet ? { file: sheetName, sha256: plan.jobsheet.sha256 || '', original: plan.jobsheet.original || '', loadedAt: plan.jobsheet.loadedAt || '' } : null }
      };
      return sealManifest(manifest).then(function (sm) {
      entries.push({ name: folder + '/' + sm.name, data: sm.data });
      entries.push({ name: folder + '/README.txt', data:
        'LabCal job pack (COMBINED) - ' + ref + (customer ? ' - ' + customer : '') + '\r\n' +
        'Created ' + readmeDate() + '\r\n\r\n' +
        'Combined from ' + plan.packs.length + ' job packs:\r\n' +
        plan.packs.map(function (p) { return '  ' + p.label + (p.engineer ? ' - ' + p.engineer : '') + ' - ' + p.certificates + ' certificate' + (p.certificates === 1 ? '' : 's'); }).join('\r\n') + '\r\n\r\n' +
        P + '_ALL_certificates.pdf  - job summary followed by every current certificate\r\n' +
        (plan.jobsheet ? sheetName + '  - the jobsheet this job was loaded from' + (plan.jobsheet.original ? ' (' + plan.jobsheet.original + ')' : '') + '\r\n' : '') +
        'certificates/  - each current certificate on its own\r\n' +
        sm.name + '  - LabCal\'s checklist: which file belongs to which unit and which pack it came from, with a fingerprint of each' + (sm.sealed ? ' (sealed - read by LabCal)' : '') + '\r\n\r\n' +
        'To check these files later: LabCal > Calibration > Check certificates, and pick this ZIP or the PDFs.\r\n' });
      return makeZip(entries).then(function (zip) {
        return { blob: zip, name: folder + '.zip', count: chosen.length, units: units, manifest: manifest };
      });
      });
    });
  }

  global.LabCalJobPack = {
    _sealManifest: sealManifest, _openManifest: openManifest,   // v1.594 (tests)
    readPack: readPack,
    planCombine: planCombine,
    buildCombined: buildCombined,
    buildJobPack: buildJobPack,
    reviewJobPack: reviewJobPack,
    checkFiles: checkFiles,
    makeZip: makeZip,
    readZip: readZip,
    identityIn: identityIn,
    currentCertificatesFor: currentCertificatesFor
  };
})(typeof window !== 'undefined' ? window : this);

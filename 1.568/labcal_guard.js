/* ---------------------------------------------------------------------
   LabCal — certificate identity guard (v1.550)
   ---------------------------------------------------------------------
   Runs when Generate PDF is tapped, BEFORE anything is produced, and makes
   sure the certificate is filed against the right unit:

   1. Which unit is this?  The job list is the authority on unit identity.
      • Opened from the job list, but the serial on the worksheet no longer
        matches that unit          → ask before going on.
      • Not opened from the job list (or a stale link from an earlier unit),
        but the job is known       → find the unit by serial and ask to link
                                     it; if the serial is not on the job,
                                     ask, and file it unlinked.
      • A stale link to a different job is dropped silently, so a
        certificate can never inherit another unit's identity.

   2. Is this a revision?  If the unit already has a certificate, ask
      whether this is a revised one. The earlier certificate stays on
      record (marked superseded, as before) and the new file gets _rev2,
      _rev3 … so two different PDFs never share a file name.

   Never blocks on a storage problem: if the certificate list does not
   answer within 2.5 s the check is skipped (and says so in the console).
   Returns Promise<{ ok, rev, uid }>.
   --------------------------------------------------------------------- */
(function (global) {
  'use strict';

  function key(v) { return String(v || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, ''); }

  var last = null;   // context of the most recent successful check

  function dayLabel(iso) {
    var m = String(iso || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (!m) return '';
    var MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    return Number(m[3]) + '/' + MON[Number(m[2]) - 1] + '/' + m[1];
  }

  function revOf(r) {
    if (r && Number(r.rev) > 0) return Number(r.rev);
    var m = String((r && r.filename) || '').match(/_rev(\d+)\.[a-z]+$/i);
    return m ? Number(m[1]) : 1;
  }

  // ---- 1. unit identity --------------------------------------------------
  function checkIdentity(ctx) {
    var J = global.LabCalJobsheet;
    if (!J || !J.link || !J.jobByRef) return { ok: true, uid: '' };
    var l = J.link();
    var job = ctx.jobRef ? J.jobByRef(ctx.jobRef) : null;
    var wsSerial = key(ctx.serial);

    if (!job) {
      // A job LabCal does not hold. Never let an old link from another job
      // attach its unit id to this certificate.
      if (l && key(l.jobRef) !== key(ctx.jobRef)) J.setLink(null);
      return { ok: true, uid: (l && key(l.jobRef) === key(ctx.jobRef)) ? (l.uid || '') : '' };
    }

    var devices = (job.devices || []).filter(function (d) { return !d.duplicateMerged; });
    var linked = null;
    if (l && key(l.jobRef) === key(job.callNumber)) {
      linked = devices.filter(function (d) { return l.uid && d.uid === l.uid; })[0] ||
               devices.filter(function (d) { return key(d.serial) === key(l.serial); })[0] || null;
    }

    if (linked) {
      if (wsSerial && key(linked.serial) && key(linked.serial) !== wsSerial) {
        var go = global.confirm(
          'Serial number check\n\n' +
          'This worksheet was opened for:\n  ' + (linked.model || 'unit') + ' — serial ' + linked.serial + '  (job ' + job.callNumber + ')\n\n' +
          'but the worksheet now says serial ' + ctx.serial + '.\n\n' +
          'OK = generate; the certificate is filed against that unit and its serial is updated to ' + ctx.serial + '.\n' +
          'Cancel = go back and check the serial.');
        if (!go) return { ok: false };
      }
      return { ok: true, uid: linked.uid || '' };
    }

    // Not linked to a unit of this job (opened directly, or a stale link).
    var match = wsSerial ? devices.filter(function (d) { return key(d.serial) === wsSerial; })[0] : null;
    if (match) {
      var ok = global.confirm(
        'This worksheet was not opened from the job list.\n\n' +
        'Serial ' + ctx.serial + ' is on job ' + job.callNumber + ':\n  ' +
        (match.model || 'unit') + (match.location ? ' — ' + match.location : '') + '\n\n' +
        'OK = generate and file the certificate against that unit.\nCancel = go back.');
      if (!ok) return { ok: false };
      J.setLink({ jobRef: job.callNumber, serial: match.serial, uid: match.uid || '' });
      return { ok: true, uid: match.uid || '' };
    }
    var anyway = global.confirm(
      'Serial ' + (ctx.serial || '(blank)') + ' is NOT on the list for job ' + job.callNumber + '.\n\n' +
      'The certificate will not be linked to any unit of that job.\n\n' +
      'OK = generate anyway.\nCancel = go back and check the serial or job reference.');
    if (!anyway) return { ok: false };
    J.setLink(null);
    return { ok: true, uid: '' };
  }

  // ---- 2. revision -------------------------------------------------------
  function earlierCertificates(ctx, uid) {
    var C = global.LabCalCerts;
    if (!C || !C.supported || !C.supported() || !C.all) return Promise.resolve([]);
    return C.all().then(function (list) {
      return list.filter(function (r) {
        if (uid && r.unitUid) return r.unitUid === uid;
        return key(r.serial) && key(r.serial) === key(ctx.serial) &&
               key(r.jobRef) === key(ctx.jobRef) &&
               (!ctx.sheet || !r.sheet || r.sheet === ctx.sheet ||
                // IBB and NSMD certificates were filed as 'smd' before v1.550
                (r.sheet === 'smd' && (ctx.sheet === 'ibb' || ctx.sheet === 'nsmd')));
      });
    });
  }

  // v1.566: every unit has a real serial number — there is no such thing as a
  // unit without one. A stand-in ("N/A", "-", "TBC", "000"…) would also make two
  // different units look like the SAME unit (same saved readings, same tick),
  // so a certificate is never made for one. Safety net only.
  var PLACEHOLDERS = ['NA', 'NONE', 'NIL', 'NULL', 'TBC', 'TBA', 'TBD', 'UNKNOWN', 'UNK', 'NK', 'NOSERIAL', 'NOSN', 'NOSERIALNO',
    'NOSERIALNUMBER', 'NOTKNOWN', 'NOTAVAILABLE', 'NOTLEGIBLE', 'ILLEGIBLE', 'MISSING', 'BLANK', 'SERIAL', 'SERIALNO', 'SN', 'X', 'XX', 'XXX'];
  function isPlaceholderSerial(serial) {
    var k = key(serial);
    if (!k) return true;                         // only punctuation / spaces
    if (/^0+$/.test(k)) return true;             // 0, 000…
    return PLACEHOLDERS.indexOf(k) !== -1;
  }

  function beforeGenerate(ctx) {
    ctx = ctx || {};
    if (isPlaceholderSerial(ctx.serial)) {
      global.alert('Serial No "' + String(ctx.serial || '').trim() + '" is not a real serial number.\n\n' +
        'Every unit must have its own serial number on the certificate. Enter the serial from the unit\'s rating plate.\n\nNo certificate was made.');
      try { var el = global.document && global.document.getElementById('serial'); if (el) el.focus(); } catch (e) {}
      return Promise.resolve({ ok: false, rev: 1, uid: '' });
    }
    // v1.559: a tab whose unit is open in another tab never makes a certificate.
    try {
      if (global.LabCalTabLock && !global.LabCalTabLock.canWrite(ctx.jobRef, ctx.serial)) {
        global.alert('Serial ' + (ctx.serial || '') + (ctx.jobRef ? ' (job ' + ctx.jobRef + ')' : '') +
          ' is open in another tab.\n\nNo certificate was made. Use the other tab, or open the unit again from the job list.');
        return Promise.resolve({ ok: false, rev: 1, uid: '' });
      }
    } catch (e) {}
    var id;
    try { id = checkIdentity(ctx); } catch (e) { console.warn('Identity check skipped:', e); id = { ok: true, uid: '' }; }
    if (!id.ok) return Promise.resolve({ ok: false, rev: 1, uid: '' });

    var timedOut = false;
    var work = earlierCertificates(ctx, id.uid).then(function (prior) {
      if (timedOut) return { ok: true, rev: 1 };
      if (!prior.length) return { ok: true, rev: 1 };
      var current = prior.filter(function (r) { return !r.superseded; });
      var shown = (current.length ? current : prior).slice()
        .sort(function (a, b) { return String(a.savedAt) < String(b.savedAt) ? 1 : -1; })[0];
      var nextRev = prior.reduce(function (m, r) { return Math.max(m, revOf(r)); }, 1) + 1;
      var yes = global.confirm(
        'This unit already has a certificate:\n  ' +
        (shown.certRef || shown.summary || shown.filename) + '  —  ' + dayLabel(shown.savedAt || shown.day) + '\n\n' +
        'Generate a REVISED certificate?\n' +
        'The earlier one stays on record, marked as superseded. The new file is named …_rev' + nextRev + '.pdf so the two can never be mixed up.\n\n' +
        'OK = revised certificate.  Cancel = go back.');
      return yes ? { ok: true, rev: nextRev } : { ok: false, rev: nextRev };
    }).catch(function (e) {
      console.warn('Certificate history check skipped:', e);
      return { ok: true, rev: 1 };
    });
    var timer = new Promise(function (res) { setTimeout(function () { res('timeout'); }, 2500); });
    return Promise.race([work, timer]).then(function (r) {
      if (r === 'timeout') {
        timedOut = true;
        console.warn('Certificate history check skipped — storage did not respond.');
        r = { ok: true, rev: 1 };
      }
      r.uid = id.uid;
      if (r.ok) {
        last = { at: Date.now(), sheet: ctx.sheet || '', serial: ctx.serial || '', jobRef: ctx.jobRef || '',
                 certRef: ctx.certRef || '', uid: id.uid || '', rev: r.rev || 1 };
      }
      return r;
    });
  }

  // The revision to put in the file name — only while the worksheet still
  // shows the unit that was just checked.
  function revisionFor(serial) {
    if (!last || key(last.serial) !== key(serial)) return 1;
    return last.rev || 1;
  }

  // Identity to embed in the PDF being generated right now (≤ 2 min old).
  function currentIdentity() {
    if (!last || Date.now() - last.at > 120000) return null;
    return last;
  }

  global.LabCalGuard = {
    beforeGenerate: beforeGenerate,
    isPlaceholderSerial: isPlaceholderSerial,
    revisionFor: revisionFor,
    currentIdentity: currentIdentity
  };
})(typeof window !== 'undefined' ? window : this);

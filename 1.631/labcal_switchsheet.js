(window.LabCalBuild = window.LabCalBuild || {})['labcal_switchsheet.js'] = 'v1.631';  // file version — see labcal_build.js
/* ---------------------------------------------------------------------
   LabCal — "Change worksheet" (v1.631, Radek 17 Nov 2026)
   ---------------------------------------------------------------------
   The office sometimes gives the wrong model, so a unit is opened on the
   wrong form (e.g. 19/24 instead of SNMD). Until now the only way out was
   to type everything again on the right form.

   More… › Change worksheet… moves this unit to another form:
     • same thermometer family (Dostmann: SMD / NSMD / IBB,
       Fluke & Comark: SNMD / 19/24) — unit details, probes, times and
       readings are carried across, every field that exists on both forms;
     • a different thermometer family — ONLY the unit details (job, site,
       location, model, serial, manufacturer, controller settings, comments).
       Probes and readings taken with one thermometer can never be corrected
       with the other thermometer's offsets, so they are not carried.
   Nothing is calculated here: the new form recalculates everything itself
   when it opens, exactly as for any reopened unit.

   What happens:
     1. this form's readings are saved as usual (they stay as they are —
        the old form's save is then listed in Tools › Stray saved worksheets);
     2. the carried fields are written as the NEW form's saved worksheet for
        this job + serial (asks first if that form already has one);
     3. the job list's form for this unit is changed (labcal_jobsheet.js);
     4. the new form opens for this unit, in this tab.
   The certificate number field is never carried: it is given when the PDF
   is made, and the number already held by this unit is reused.
   --------------------------------------------------------------------- */
(function (global) {
  'use strict';

  var FORMS = {
    smd:     { name: 'Standard Medical (SMD)',      short: 'SMD',   href: 'calibration_worksheet_SMD.html',   family: 'dostmann' },
    nsmd:    { name: 'Non-Standard Medical (NSMD)', short: 'NSMD',  href: 'calibration_worksheet_NSMD.html',  family: 'dostmann' },
    ibb:     { name: 'IBB / Blood Bank',            short: 'IBB',   href: 'calibration_worksheet_IBB.html',   family: 'dostmann' },
    snmd:    { name: 'Standard Non-Medical (SNMD)', short: 'SNMD',  href: 'calibration_worksheet_SNMD.html',  family: 'fluke_comark' },
    ws19_24: { name: '19/24 Range',                 short: '19/24', href: 'calibration_worksheet_19_24.html', family: 'fluke_comark' }
  };
  var FAMILY = { dostmann: 'Dostmann', fluke_comark: 'Fluke & Comark' };

  // never carried: the number is given at PDF time; files cannot be restored
  var NEVER = { certNo: 1, sheetNo: 1, offsetFile: 1, excelImportFile: 1, jobsheetFile: 1 };
  // carried to a form of the other thermometer family — the unit, not the measurement
  var DETAILS = ['jobRef', 'site', 'department', 'model', 'serial', 'manufacturer', 'manufacturerOther',
    'deviceType', 'date', 'dateNative', 'certMode', 'comments',
    'initialSetpoint', 'initialOffsetsCal1', 'initialOffsetsCal2'];

  function $(id) { return global.document.getElementById(id); }
  function val(id) { var e = $(id); return e ? String(e.value || '').trim() : ''; }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function when(iso) { try { return new Date(iso).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }); } catch (e) { return ''; } }

  // The ids of every field on the other form (from the offline copy). null = could not read it.
  function idsOf(href) {
    if (!global.fetch || !global.DOMParser) return Promise.resolve(null);
    return global.fetch(href, { cache: 'no-store' }).then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.text();
    }).then(function (html) {
      var doc = new global.DOMParser().parseFromString(html, 'text/html');
      var out = {};
      Array.prototype.forEach.call(doc.querySelectorAll('input[id],select[id],textarea[id]'), function (el) {
        if (el.type !== 'file') out[el.id] = 1;
      });
      return out;
    }).catch(function () { return null; });
  }

  // Which fields go across. Pure — tested on its own.
  //   state: captured form { id: value }   ids: target ids or null   sameFamily: bool
  //   → { carried: {id: value}, left: [ids with a value that stay behind] }
  function plan(state, ids, sameFamily) {
    var carried = {}, left = [];
    Object.keys(state || {}).forEach(function (id) {
      var v = state[id];
      var filled = String(v == null ? '' : v).trim() !== '';
      var ok = !NEVER[id] && (sameFamily || DETAILS.indexOf(id) !== -1) && (!ids || ids[id]);
      if (ok) carried[id] = v;
      else if (filled && !NEVER[id]) left.push(id);
    });
    return { carried: carried, left: left };
  }
  // Calculated cells are recalculated on the new form — not worth listing.
  function isCalc(id) { return /(_calc|_corr|_avg|_diff|_display|cycletime|stabilisation)$/.test(id) || /^(rtAvg)$/.test(id); }

  var box = null;
  function close() { if (box && box.parentNode) box.parentNode.removeChild(box); box = null; }

  function dialog(fromSheet) {
    close();
    var from = FORMS[fromSheet];
    box = global.document.createElement('div');
    box.id = 'lcSwitchSheet';
    box.setAttribute('role', 'dialog');
    box.style.cssText = 'position:fixed;inset:0;z-index:2000;background:rgba(0,0,0,.45);display:flex;align-items:center;justify-content:center;padding:16px;box-sizing:border-box;font-family:-apple-system,system-ui,Arial,sans-serif';
    var rows = Object.keys(FORMS).filter(function (k) { return k !== fromSheet; }).map(function (k) {
      var f = FORMS[k], same = f.family === from.family;
      return '<button type="button" data-to="' + k + '" style="display:block;width:100%;text-align:left;margin:8px 0;padding:12px 14px;min-height:56px;border-radius:10px;border:2px solid ' + (same ? '#0081C8' : '#c9a227') + ';background:#fff;cursor:pointer;font:inherit">' +
        '<b style="font-size:16px">' + esc(f.name) + '</b><br><span style="font-size:13px;color:' + (same ? '#1e5a7a' : '#7a5a06') + '">' +
        (same ? 'Same thermometer (' + esc(FAMILY[f.family]) + ') — unit details, probes, times and readings are carried across'
              : 'Other thermometer (' + esc(FAMILY[f.family]) + ') — only the unit details are carried; probes and readings must be taken on that form') +
        '</span></button>';
    }).join('');
    box.innerHTML = '<div style="background:#fff;border-radius:12px;max-width:560px;width:100%;max-height:86vh;overflow:auto;padding:16px 18px;box-shadow:0 10px 40px #0006">' +
      '<h3 style="margin:0 0 6px;font-size:18px">Change worksheet</h3>' +
      '<div style="font-size:13.5px;color:#334;line-height:1.4">This unit (S/N <b>' + esc(val('serial') || '?') + '</b>' + (val('jobRef') ? ', job ' + esc(val('jobRef')) : '') +
      ') is on the <b>' + esc(from.name) + '</b> form. Move it to:</div>' + rows +
      '<div style="font-size:12.5px;color:#556;margin-top:6px">The readings on this form are saved and kept as they are. The certificate number is not carried — it is given when the PDF is made on the new form. Check every value on the new form before generating.</div>' +
      '<div style="text-align:right;margin-top:12px"><button type="button" data-cancel style="min-height:44px;padding:8px 18px;border-radius:22px;border:2px solid #0081C8;background:#fff;color:#0081C8;font:700 15px/1 -apple-system,system-ui,Arial,sans-serif;cursor:pointer">Cancel</button></div></div>';
    global.document.body.appendChild(box);
    box.querySelector('[data-cancel]').addEventListener('click', close);
    box.addEventListener('click', function (e) { if (e.target === box) close(); });
    return box;
  }

  // Called from the worksheet's More… menu.
  //   fromSheet: the page's UNIT_SHEET   saveNow: the page's flush / save function
  function open(fromSheet, saveNow) {
    var J = global.LabCalJobsheet, U = global.LabCalUnits;
    if (!FORMS[fromSheet]) { global.alert('Change worksheet is not available on this form.'); return; }
    if (!U || !U.carry || !U.captureForm) { global.alert('labcal_units.js is out of date on this device, so the unit cannot be moved.\n\nOpen the LabCal home page while online and tap "Refresh offline copy".'); return; }
    try { if (global.LabCalTabLock && global.LabCalTabLock.isLocked()) { global.alert('This tab is locked (the unit is open in another tab). Nothing was moved.'); return; } } catch (e) {}
    if (!val('serial')) { global.alert('Enter the Serial No first — the unit is kept by job + serial.'); return; }
    var b = dialog(fromSheet);
    Array.prototype.forEach.call(b.querySelectorAll('[data-to]'), function (btn) {
      btn.addEventListener('click', function () {
        var to = btn.getAttribute('data-to');
        close();
        move(fromSheet, to, saveNow);
      });
    });
  }

  function move(fromSheet, to, saveNow) {
    var J = global.LabCalJobsheet, U = global.LabCalUnits;
    var from = FORMS[fromSheet], dest = FORMS[to];
    var jobRef = val('jobRef'), serial = val('serial');
    var same = from.family === dest.family;
    // 1. this form's readings saved, as on every leave
    try { if (typeof saveNow === 'function') saveNow(); } catch (e) { console.warn('Change worksheet: save before moving failed', e); }
    var state = U.captureForm(global.document);
    return idsOf(dest.href).then(function (ids) {
      var p = plan(state, ids, same);
      var left = p.left.filter(function (id) { return !isCalc(id); });
      var lines = ['Move S/N ' + serial + (jobRef ? ' (job ' + jobRef + ')' : '') + ' from ' + from.short + ' to ' + dest.short + '?', ''];
      if (same) lines.push('Carried across: unit details, probes, times and readings (' + Object.keys(p.carried).length + ' fields).');
      else lines.push('Different thermometer (' + FAMILY[dest.family] + '): ONLY the unit details are carried. Choose the probes and take the readings on the ' + dest.short + ' form.');
      if (!ids) lines.push('', '(The ' + dest.short + ' form could not be read beforehand — fields it does not have are simply ignored when it opens.)');
      if (left.length) lines.push('', 'Not on the ' + dest.short + ' form / not carried (' + left.length + '): ' + left.slice(0, 14).join(', ') + (left.length > 14 ? ', …' : ''));
      var st = U.standingOf ? U.standingOf({ jobRef: jobRef, serial: serial }) : {};
      if (st.done) lines.push('', 'A certificate has already been made for this unit. A certificate made on the ' + dest.short + ' form will be a further one — check the certificate list afterwards.');
      lines.push('', 'The ' + from.short + ' readings stay saved as they are (Tools › Stray saved worksheets lists them for removal).');
      if (!global.confirm(lines.join('\n'))) return false;

      // 2. the new form's saved worksheet
      var existing = U.peek ? U.peek(to, jobRef, serial) : null;
      if (existing && !global.confirm('The ' + dest.short + ' form already has a saved worksheet for S/N ' + serial + ' (saved ' + when(existing.savedAt) + ').\n\nOK = replace it with what is on this ' + from.short + ' form.\nCancel = leave everything as it is (nothing moved).')) return false;
      var meta = { model: val('model'), site: val('site'), carriedFrom: fromSheet, carriedAt: new Date().toISOString(), carriedAll: same };
      if (!U.carry(to, jobRef, serial, p.carried, meta, true)) {
        global.alert('The ' + dest.short + ' worksheet could not be saved on this iPad (storage full, or the unit is open in another tab). Nothing was moved — this form is unchanged.');
        return false;
      }
      // 3. the job list: this unit now uses the new form
      var d = null;
      try { if (J && J.changeSheet) d = J.changeSheet({ jobRef: jobRef, serial: serial, sheet: to }); } catch (e) { console.warn('Change worksheet: job list not updated', e); }
      // 4. open the new form for this unit, in this tab
      var job = null;
      try { job = J && J.jobByRef && jobRef ? J.jobByRef(jobRef) : null; } catch (e) {}
      var l = null; try { l = J && J.link ? J.link() : null; } catch (e) {}
      if (J && J.handoffUnit) {
        J.handoffUnit({
          sheet: to,
          uid: (d && d.uid) || (l && l.uid) || '',
          device: d ? { model: d.model, equipment: d.equipment, serial: d.serial, location: d.location }
                    : { model: val('model'), serial: serial, location: val('department') },
          jobsheet: job ? { customer: job.customer, callNumber: job.callNumber, address: job.address, department: job.department, visitDate: job.visitDate }
                        : { customer: val('site'), callNumber: jobRef, department: val('department') }
        });
      }
      try { if (global.LabCalLog) global.LabCalLog.add('info', 'Change worksheet: S/N ' + serial + ' ' + from.short + ' → ' + dest.short + (same ? ' (readings carried)' : ' (details only)')); } catch (e) {}
      global.location.href = dest.href;
      return true;
    });
  }

  global.LabCalSwitchSheet = { FORMS: FORMS, DETAILS: DETAILS, plan: plan, open: open, move: move };
})(typeof window !== 'undefined' ? window : this);

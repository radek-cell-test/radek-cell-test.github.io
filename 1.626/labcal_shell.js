(window.LabCalBuild = window.LabCalBuild || {})['labcal_shell.js'] = 'v1.626';  // file version — see labcal_build.js
/* LabCal v1.620 (logo) / v1.619 — side menu on every page (UI redesign, stage 1).
 * ---------------------------------------------------------------------------
 * Radek (6 Nov 2026): the "Licznik Prądu" look — a menu down the left side on
 * every LabCal page. Loaded in <head> of every page, straight after
 * labcal_errlog.js, so the page knows its layout before anything is drawn.
 *
 *   Section pages (Home, Jobs, Tools, Monitoring):
 *       iPad landscape  → full menu, 226 px
 *       iPad portrait   → icon rail, 68 px (tap the logo = full menu over the page)
 *       phone (< 600)   → no rail, a menu button top left
 *   Work pages (worksheets, Cloud Temp, logger viewer, PDF merge):
 *       ≥ 900 px wide   → icon rail, 68 px
 *       narrower        → nothing (the A4 sheet needs the width; Back / Home
 *                         on the toolbar are still there)
 *
 * LOOK ONLY. It reads a few things to show them (version, last backup, the
 * engineer from the offsets file, units still to do on the current job) and
 * never writes anything except, on the way into calibration.html, which view
 * that page should open (the same sessionStorage key the page itself uses).
 * Leaving a worksheet from the menu goes through LabCalNav.okToLeave() — the
 * same "save / readings NOT saved" check as the toolbar's Home button.
 * Nothing here is drawn on a certificate: the menu is hidden while a PDF is
 * made (.printMode) and when printing.
 */
(function (global) {
  'use strict';
  var doc = global.document;
  var html = doc.documentElement;

  var PAGE = (String(global.location.pathname).split('/').pop() || 'index.html').toLowerCase();
  var SECTION_PAGES = { 'index.html': 1, 'calibration.html': 1, 'tools.html': 1, 'monitoring_systems.html': 1, 'live_probes.html': 1 };
  var KIND = SECTION_PAGES[PAGE] ? 'section' : 'work';
  html.classList.add('lcs', 'lcs-' + KIND);

  // The hash this page was opened with — calibration.html clears its hash
  // as soon as its own script runs, so it is taken here, before that.
  var START_HASH = String(global.location.hash || '').replace(/^#/, '');

  // ---- calibration.html: which view to open (before the page's own script) --
  // calibration.html#calendar → the calendar; #jobs → the job that is open.
  // The page decides its view from sessionStorage 'labcal.cal.view' (v1.581).
  if (PAGE === 'calibration.html') {
    try {
      if (START_HASH === 'calendar') global.sessionStorage.removeItem('labcal.cal.view');
      else if (START_HASH === 'jobs') {
        var cur = currentJob();
        if (cur && cur.callNumber) global.sessionStorage.setItem('labcal.cal.view', JSON.stringify({ job: cur.callNumber }));
      }
    } catch (e) {}
  }

  // ---- data shown in the menu (read only) ----------------------------------
  function readJson(key, dflt) {
    try { var v = global.localStorage.getItem(key); return v ? JSON.parse(v) : dflt; } catch (e) { return dflt; }
  }
  function currentJob() {
    var key = '';
    try { key = global.localStorage.getItem('labcal.jobsheet.active') || ''; } catch (e) {}
    if (!key) return null;
    var jobs = readJson('labcal.jobsheet.jobs', {}) || {};
    return jobs[key] || null;
  }
  // Units still to do on the job that is open (same count as the job list:
  // merged duplicates left out, done and "not required" not counted).
  function unitsToDo() {
    var j = currentJob();
    if (!j || !Array.isArray(j.devices)) return 0;
    return j.devices.filter(function (d) { return d && !d.duplicateMerged && !d.done && !d.notRequired; }).length;
  }
  // v1.622: units with a stabilisation / cycle / adjustment running now (the
  // same count as the Live probes page). Only on pages that load
  // labcal_schedule.js + labcal_jobsheet.js; read at most every 15 s (and when
  // another tab saves), so the menu stays light on the iPad.
  var runAt = 0, runN = 0;
  function unitsRunning(force) {
    var S = global.LabCalSchedule, J = global.LabCalJobsheet;
    if (!S || !S.live || !J) return 0;
    if (!force && Date.now() - runAt < 15000) return runN;
    runAt = Date.now();
    try { runN = S.live().running || 0; } catch (e) { runN = 0; }
    return runN;
  }
  function version() {
    var m = doc.querySelector('meta[name="labcal-build"]');
    return m ? String(m.getAttribute('content') || '') : '';
  }
  function engineer() {
    var ids = ['dostmann', 'fluke_comark'];
    for (var i = 0; i < ids.length; i++) {
      var r = readJson('labcal.offsets.' + ids[i], null);
      var n = r && r.raw && r.raw.engineerName;
      if (n) return String(n);
    }
    return '';
  }
  function backupLabel() {
    var at = null;
    try { at = global.localStorage.getItem('labcal.backup.lastAt'); } catch (e) {}
    if (!at) return { text: 'Never backed up', cls: 'lcs-bad' };
    var d = new Date(at); if (isNaN(d)) return { text: 'Never backed up', cls: 'lcs-bad' };
    var days = Math.floor((Date.now() - d.getTime()) / 86400000);
    var now = new Date();
    var sameDay = d.toDateString() === now.toDateString();
    var hm = ('0' + d.getHours()).slice(-2) + ':' + ('0' + d.getMinutes()).slice(-2);
    if (sameDay) return { text: 'Backed up ' + hm, cls: 'lcs-ok' };
    if (days <= 1) return { text: 'Backed up yesterday', cls: 'lcs-ok' };
    return { text: 'Backed up ' + days + ' days ago', cls: days > 7 ? 'lcs-bad' : (days > 3 ? 'lcs-warn' : 'lcs-ok') };
  }
  // Offline copy: the service worker's cache for THIS version folder exists.
  function offlineState(cb) {
    try {
      if (!global.caches || !global.caches.keys) return cb(false);
      var folder = String(global.location.pathname).replace(/[^/]*$/, '');
      global.caches.keys().then(function (keys) {
        cb(keys.some(function (k) { return /^labcal-static-/.test(k) && k.slice(-(folder.length + 1)) === '@' + folder; }));
      }, function () { cb(false); });
    } catch (e) { cb(false); }
  }

  // ---- menu -----------------------------------------------------------------
  var P = {
    today: '<rect x="3" y="3" width="7" height="9" rx="1.5"/><rect x="14" y="3" width="7" height="5" rx="1.5"/><rect x="14" y="12" width="7" height="9" rx="1.5"/><rect x="3" y="16" width="7" height="5" rx="1.5"/>',
    jobs: '<rect x="5" y="4" width="14" height="17" rx="2"/><path d="M9 4V3h6v1M9 10h6M9 14h6M9 18h3"/>',
    calendar: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>',
    probes: '<circle cx="12" cy="13" r="8"/><path d="M12 9v4l2.5 2M10 2h4"/>',
    worksheets: '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5M9 13h6M9 17h6"/>',
    certificates: '<circle cx="12" cy="9" r="6"/><path d="M8.5 14 7 22l5-3 5 3-1.5-8"/>',
    tools: '<path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.8-3.8a6 6 0 0 1-7.9 7.9l-6.9 6.9a2.1 2.1 0 0 1-3-3l6.9-6.9a6 6 0 0 1 7.9-7.9z"/>',
    settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1A1.7 1.7 0 0 0 9 19.4a1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1A1.7 1.7 0 0 0 4.6 9a1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
    backup: '<ellipse cx="12" cy="5" rx="8" ry="3"/><path d="M4 5v14c0 1.7 3.6 3 8 3s8-1.3 8-3V5M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3"/>',
    lock: '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>',
    menu: '<path d="M4 6h16M4 12h16M4 18h16"/>',
    close: '<path d="M6 6l12 12M18 6 6 18"/>'
  };
  function icon(n) {
    return '<svg class="lcs-ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + (P[n] || '') + '</svg>';
  }

  // The certificate register (later stage) is not built yet — shown, greyed,
  // so the menu does not change shape later. Live probes: v1.622 (stage 3).
  var ITEMS = [
    { id: 'today', label: 'Today', href: 'index.html' },
    { id: 'jobs', label: 'Current job', href: 'calibration.html#jobs', badge: 'todo' },   // v1.623 (Radek): was "Jobs"
    { id: 'calendar', label: 'Calendar', href: 'calibration.html#calendar' },
    { id: 'probes', label: 'Live probes', href: 'live_probes.html', badge: 'running' },
    { sep: 'Library' },
    { id: 'worksheets', label: 'Worksheets', href: 'calibration.html#worksheets' },
    { id: 'certificates', label: 'Certificates', soon: true },
    { id: 'tools', label: 'Tools', href: 'tools.html' },
    { id: 'settings', label: 'Settings', href: 'index.html#settings' }
  ];

  function defaultActive() {
    if (PAGE === 'index.html') return 'today';
    if (PAGE === 'calibration.html') return 'jobs';
    if (PAGE === 'live_probes.html') return 'probes';
    if (PAGE === 'tools.html' || PAGE === 'data_logger_viewer.html' || PAGE === 'pdf_merge_reorder.html') return 'tools';
    return 'worksheets';
  }
  function activeId() {
    try { if (typeof global.lcShellActive === 'function') { var a = global.lcShellActive(); if (a) return a; } } catch (e) {}
    return defaultActive();
  }

  function esc(t) { return String(t == null ? '' : t).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }

  function itemsHtml() {
    var todo = unitsToDo();
    return ITEMS.map(function (it) {
      if (it.sep) return '<div class="lcs-sep">' + esc(it.sep) + '</div>';
      var badge = it.badge === 'todo' && todo ? '<span class="lcs-badge" data-lcs-badge="' + it.id + '">' + todo + '</span>' : '';
      if (it.badge === 'running') badge = '';   // filled in by refresh()
      if (it.soon) {
        return '<span class="lcs-item lcs-soon" data-lcs="' + it.id + '" aria-disabled="true" title="' + esc(it.label) + ' — coming in a later version">' +
          icon(it.id) + '<span class="lcs-lbl">' + esc(it.label) + '</span><span class="lcs-tag">soon</span></span>';
      }
      return '<a class="lcs-item" data-lcs="' + it.id + '" href="' + it.href + '" title="' + esc(it.label) + '" aria-label="' + esc(it.label) + '">' +
        icon(it.id) + '<span class="lcs-lbl">' + esc(it.label) + '</span>' + badge + '</a>';
    }).join('');
  }

  function build() {
    if (doc.getElementById('lcsMenu')) return;
    var nav = doc.createElement('nav');
    nav.id = 'lcsMenu';
    nav.className = 'lcs-menu';
    nav.setAttribute('aria-label', 'LabCal menu');
    nav.innerHTML =
      '<button type="button" class="lcs-brand" id="lcsBrand" aria-label="LabCal — show the whole menu">' +
        // v1.620: Labcold logo (white on Labcold blue). Rail = the snowflake only (same image, cropped).
        '<span class="lcs-logo"><img src="labcold-logo-white.png" alt="Labcold" width="150" height="35"><span class="lcs-flake" aria-hidden="true"></span></span>' +
        '<span class="lcs-bt"><b>LabCal</b><small>Calibration Suite</small></span>' +
      '</button>' +
      '<div class="lcs-items" id="lcsItems">' + itemsHtml() + '</div>' +
      '<div class="lcs-foot" id="lcsFoot">' +
        '<div class="lcs-f" id="lcsOffline" title="Offline copy"><span class="lcs-dot"></span><span class="lcs-lbl" id="lcsOfflineTxt">Offline · ' + esc(version()) + '</span></div>' +
        '<a class="lcs-f" id="lcsBackup" href="index.html#backup" title="Last backup — tap to back up">' + icon('backup') + '<span class="lcs-lbl" id="lcsBackupTxt"></span></a>' +
        '<div class="lcs-f" id="lcsEng" title="Engineer — locked, from the offsets file">' + icon('lock') + '<span class="lcs-lbl" id="lcsEngTxt"></span></div>' +
      '</div>';
    doc.body.insertBefore(nav, doc.body.firstChild);

    var shade = doc.createElement('div');
    shade.id = 'lcsShade'; shade.className = 'lcs-shade';
    doc.body.insertBefore(shade, nav.nextSibling);

    var mb = doc.createElement('button');
    mb.type = 'button'; mb.id = 'lcsMenuBtn'; mb.className = 'lcs-menubtn';
    mb.setAttribute('aria-label', 'Menu');
    mb.innerHTML = icon('menu');
    doc.body.insertBefore(mb, shade.nextSibling);

    doc.getElementById('lcsBrand').addEventListener('click', function () { setOpen(!html.classList.contains('lcs-open')); });
    mb.addEventListener('click', function () { setOpen(true); });
    shade.addEventListener('click', function () { setOpen(false); });
    doc.addEventListener('keydown', function (e) { if (e.key === 'Escape' && html.classList.contains('lcs-open')) setOpen(false); });
    nav.addEventListener('click', onClick);
    refresh();
    offlineState(function (ok) {
      var d = doc.getElementById('lcsOffline'), t = doc.getElementById('lcsOfflineTxt');
      if (!d || !t) return;
      d.classList.toggle('lcs-ok', ok); d.classList.toggle('lcs-no', !ok);
      t.textContent = (ok ? 'Offline ready · ' : 'Not stored offline · ') + version();
    });
    global.addEventListener('storage', function (e) { if (e && e.key && e.key.indexOf('labcal.unit.') === 0) runAt = 0; refresh(); });
    global.addEventListener('focus', refresh);
    global.setInterval(refresh, 1500);
  }

  // The whole menu over the page (rail and phone layouts).
  function setOpen(open) {
    html.classList.toggle('lcs-open', !!open);
    var b = doc.getElementById('lcsBrand');
    if (b) b.setAttribute('aria-expanded', open ? 'true' : 'false');
  }

  // Taps in the menu. Same page → the page's own hook (no reload); leaving a
  // worksheet → the toolbar's leave check first.
  function onClick(e) {
    var a = e.target && e.target.closest ? e.target.closest('a[href]') : null;
    if (!a) return;
    var href = a.getAttribute('href') || '';
    var target = href.split('#')[0] || PAGE;
    var hash = href.indexOf('#') >= 0 ? href.split('#')[1] : '';
    if (target.toLowerCase() === PAGE && typeof global.lcShellGo === 'function') {
      e.preventDefault();
      setOpen(false);
      try { Promise.resolve(global.lcShellGo(hash || (a.getAttribute('data-lcs') || ''))).then(refresh, refresh); } catch (err) { console.warn(err); }
      return;
    }
    if (global.LabCalNav && typeof global.LabCalNav.okToLeave === 'function') {
      var ok = true;
      try { ok = global.LabCalNav.okToLeave(); } catch (err) { ok = true; }
      if (!ok) { e.preventDefault(); return; }
    }
    setOpen(false);
  }

  var lastSig = '';
  function refresh() {
    var items = doc.getElementById('lcsItems');
    if (!items) return;
    var act = activeId();
    var todo = unitsToDo();
    var bk = backupLabel();
    var eng = engineer();
    var run = unitsRunning();
    var sig = [act, todo, bk.text, bk.cls, eng, run].join('|');
    if (sig === lastSig) return;
    lastSig = sig;
    Array.prototype.forEach.call(items.querySelectorAll('[data-lcs]'), function (el) {
      var on = el.getAttribute('data-lcs') === act;
      el.classList.toggle('on', on);
      if (on) el.setAttribute('aria-current', 'page'); else el.removeAttribute('aria-current');
    });
    var jobs = items.querySelector('[data-lcs="jobs"]');
    if (jobs) {
      var b = jobs.querySelector('.lcs-badge');
      if (todo && !b) { b = doc.createElement('span'); b.className = 'lcs-badge'; jobs.appendChild(b); }
      if (b) { if (todo) { b.textContent = todo; b.title = todo + ' unit' + (todo === 1 ? '' : 's') + ' to do on the current job'; } else b.remove(); }
    }
    var pr = items.querySelector('[data-lcs="probes"]');
    if (pr) {
      var rb = pr.querySelector('.lcs-badge');
      if (run && !rb) { rb = doc.createElement('span'); rb.className = 'lcs-badge lcs-run'; rb.setAttribute('data-lcs-badge', 'probes'); pr.appendChild(rb); }
      if (rb) { if (run) { rb.textContent = run; rb.title = run + ' unit' + (run === 1 ? '' : 's') + ' stabilising or cycling now'; } else rb.remove(); }
    }
    var bt = doc.getElementById('lcsBackupTxt'), bl = doc.getElementById('lcsBackup');
    if (bt) bt.textContent = bk.text;
    if (bl) { bl.className = 'lcs-f ' + bk.cls; bl.title = bk.text + ' — tap to back up'; }
    var et = doc.getElementById('lcsEngTxt');
    if (et) et.textContent = eng || 'No offsets file';
  }

  // ---- after the page's own script: targets in the hash ---------------------
  function afterLoad() {
    if (!START_HASH || typeof global.lcShellGo !== 'function') return;
    var t = START_HASH;
    if (PAGE === 'calibration.html' && (t === 'calendar' || t === 'jobs')) return;   // done above
    if (!/^(worksheets|settings|backup)$/.test(t)) return;
    global.setTimeout(function () {
      try { Promise.resolve(global.lcShellGo(t)).then(refresh, refresh); } catch (e) {}
    }, 50);
  }

  if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', function () { build(); });
  else build();
  global.addEventListener('load', afterLoad);

  global.LabCalShell = {
    refresh: function () { lastSig = ''; runAt = 0; refresh(); },
    setOpen: setOpen,
    startHash: function () { return START_HASH; },
    _unitsToDo: unitsToDo,
    _unitsRunning: function () { return unitsRunning(true); },
    _engineer: engineer,
    _backupLabel: backupLabel
  };
})(typeof window !== 'undefined' ? window : this);

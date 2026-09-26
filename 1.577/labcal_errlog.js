(window.LabCalBuild = window.LabCalBuild || {})['labcal_errlog.js'] = 'v1.577';  // file version — see labcal_build.js
/* ---------------------------------------------------------------------
   LabCal — on-device error log + on-page notices (v1.576)
   ---------------------------------------------------------------------
   When something goes wrong in the field (a check skipped because storage
   did not answer, a script error, a file missing from the offline copy),
   the engineer usually only sees the end result. This keeps a short record
   ON THE iPad of what happened, so it can be looked at afterwards:
     • Home → Settings → Backup & restore → "Error log"
     • it also travels inside every backup file (never restored back)

   What is recorded: JavaScript errors, failed promises, files that failed
   to load, and every console.warn / console.error LabCal itself writes
   (those are the "check skipped", "could not save" messages).
   Nothing is sent anywhere. At most 200 entries, 30 days; repeats of the
   same message within 10 minutes are counted instead of added again.

   LabCalLog.notice(id, tone, text) — a bar pinned to the bottom of the page
   with a Close button, for things the engineer must see that happen AFTER
   a moment has passed (e.g. a late certificate number check). Nothing is
   blocked by it. tone: 'red' | 'amber'.

   Must be loaded straight after labcal_build.js, before other modules, so
   their problems are recorded too.
   --------------------------------------------------------------------- */
(function (global) {
  'use strict';

  var KEY = 'labcal.errlog';
  var MAX = 200;
  var KEEP_MS = 30 * 86400000;
  var REPEAT_MS = 10 * 60000;
  var MSG_MAX = 400;
  var busy = false;          // never log while logging (console wrap loops)

  function store() { try { return global.localStorage; } catch (e) { return null; } }
  function version() {
    try { return (global.LabCalBuildCheck && global.LabCalBuildCheck.VERSION) || (global.LabCalBuild || {})['labcal_errlog.js'] || ''; }
    catch (e) { return ''; }
  }
  function pageName() {
    try { return String(global.location.pathname || '').split('/').pop() || 'index.html'; } catch (e) { return ''; }
  }

  function list() {
    var s = store(); if (!s) return [];
    try {
      var v = JSON.parse(s.getItem(KEY) || '[]');
      return Array.isArray(v) ? v : [];
    } catch (e) { return []; }
  }
  function save(arr) {
    var s = store(); if (!s) return;
    try { s.setItem(KEY, JSON.stringify(arr)); }
    catch (e) {
      // storage full: keep the newest half rather than nothing
      try { s.setItem(KEY, JSON.stringify(arr.slice(-Math.floor(MAX / 4)))); } catch (e2) {}
    }
  }

  function textOf(x) {
    if (x == null) return String(x);
    if (typeof x === 'string') return x;
    if (x instanceof Error || (x && x.message && x.name)) return (x.name && x.name !== 'Error' ? x.name + ': ' : '') + x.message;
    try { var j = JSON.stringify(x); return j && j.length > 200 ? j.slice(0, 200) + '…' : j; } catch (e) { return String(x); }
  }

  function add(level, msg) {
    if (busy) return;
    busy = true;
    try {
      var m = String(msg == null ? '' : msg).replace(/\s+/g, ' ').trim();
      if (m.length > MSG_MAX) m = m.slice(0, MSG_MAX) + '…';
      if (!m) return;
      var now = Date.now();
      var p = pageName();
      var arr = list().filter(function (e) { return e && now - Date.parse(e.t || 0) < KEEP_MS; });
      var last = arr[arr.length - 1];
      if (last && last.m === m && last.p === p && last.l === level && now - Date.parse(last.t) < REPEAT_MS) {
        last.n = (last.n || 1) + 1;
        last.t = new Date(now).toISOString();
      } else {
        arr.push({ t: new Date(now).toISOString(), v: version(), p: p, l: level, m: m });
      }
      if (arr.length > MAX) arr = arr.slice(-MAX);
      save(arr);
    } catch (e) {
    } finally { busy = false; }
  }

  function clear() { var s = store(); if (s) { try { s.removeItem(KEY); } catch (e) {} } }
  function count() { return list().length; }

  // ---- capture -----------------------------------------------------------
  if (global.addEventListener) {
    // capture phase: also sees <script>/<link> that failed to load
    global.addEventListener('error', function (e) {
      try {
        var t = e && e.target;
        if (t && t !== global && (t.src || t.href)) {
          add('error', 'Could not load file ' + String(t.src || t.href).split('/').pop());
          return;
        }
        var where = e.filename ? ' @ ' + String(e.filename).split('/').pop() + ':' + (e.lineno || '?') : '';
        add('error', (e.message || textOf(e.error)) + where);
      } catch (x) {}
    }, true);
    global.addEventListener('unhandledrejection', function (e) {
      try { add('error', 'Unhandled: ' + textOf(e && e.reason)); } catch (x) {}
    });
  }
  ['warn', 'error'].forEach(function (lvl) {
    var c = global.console;
    if (!c || typeof c[lvl] !== 'function' || c[lvl].__labcalLog) return;
    var orig = c[lvl];
    var wrapped = function () {
      try { add(lvl, Array.prototype.map.call(arguments, textOf).join(' ')); } catch (e) {}
      return orig.apply(c, arguments);
    };
    wrapped.__labcalLog = true;
    c[lvl] = wrapped;
  });

  // ---- notices -----------------------------------------------------------
  function notice(id, tone, text) {
    var d = global.document;
    if (!d || !d.body) return null;
    var elId = 'labcalNotice_' + String(id || 'x').replace(/[^A-Za-z0-9_-]/g, '');
    var old = d.getElementById(elId);
    if (old) old.remove();
    var red = tone === 'red';
    var bar = d.createElement('div');
    bar.id = elId;
    bar.className = 'labcal-notice ' + (red ? 'red' : 'amber');
    bar.setAttribute('role', 'alert');
    // stack above any notice already showing
    var n = d.querySelectorAll('.labcal-notice').length;
    bar.style.cssText = 'position:fixed;left:12px;right:12px;z-index:10001;' +
      'bottom:calc(' + (12 + n * 8) + 'px + env(safe-area-inset-bottom, 0px));' +
      'background:' + (red ? '#8a1c1c' : '#fff4d6') + ';color:' + (red ? '#fff' : '#5a3d00') + ';' +
      'border:2px solid ' + (red ? '#5c0f0f' : '#d9a21b') + ';border-radius:10px;' +
      'font:600 14px/1.45 -apple-system,system-ui,sans-serif;padding:12px 12px 12px 16px;' +
      'display:flex;gap:12px;align-items:center;box-shadow:0 4px 14px rgba(0,0,0,.3);max-width:900px;margin:0 auto';
    var txt = d.createElement('div');
    txt.style.cssText = 'flex:1 1 auto;white-space:pre-line';
    txt.textContent = text;
    var btn = d.createElement('button');
    btn.type = 'button';
    btn.textContent = 'Close';
    btn.style.cssText = 'flex:0 0 auto;min-width:72px;min-height:44px;border-radius:8px;border:0;font:600 14px -apple-system,system-ui,sans-serif;' +
      'background:' + (red ? '#fff' : '#5a3d00') + ';color:' + (red ? '#8a1c1c' : '#fff');
    btn.addEventListener('click', function () { bar.remove(); });
    bar.appendChild(txt);
    bar.appendChild(btn);
    d.body.appendChild(bar);
    add(red ? 'error' : 'warn', 'Shown to engineer: ' + text);
    return bar;
  }

  global.LabCalLog = { KEY: KEY, add: add, list: list, clear: clear, count: count, notice: notice };
})(typeof window !== 'undefined' ? window : this);

/* LabCal — file version check (v1.574).
 *
 * Every LabCal page and every labcal_*.js file carries the version it belongs
 * to. If the iPad ends up holding a MIX — say a new worksheet page with an
 * older labcal_vector_pdf.js left in the offline copy — a certificate could
 * come out in an old layout, or a check could be missing, without anyone
 * noticing. This file compares them once the page has loaded and, when they
 * differ, shows a bar at the top of the page saying which files are out of
 * step and how to fix it (Refresh offline copy on the LabCal home page).
 *
 *   page:     <meta name="labcal-build" content="v1.574">
 *   modules:  first line  (window.LabCalBuild = …)['labcal_x.js'] = 'v1.574';
 *   this file: VERSION below
 *
 * A labcal_*.js loaded by the page that never registered is from before
 * v1.574 (no stamp at all), so it counts as out of step too.
 * Nothing is blocked — this only tells the engineer. Must be loaded first.
 */
(function (global) {
  'use strict';
  var VERSION = 'v1.574';
  var reg = global.LabCalBuild = global.LabCalBuild || {};
  reg['labcal_build.js'] = VERSION;

  function pageVersion() {
    var m = global.document && global.document.querySelector('meta[name="labcal-build"]');
    return m ? String(m.getAttribute('content') || '').trim() : '';
  }

  // Which labcal_*.js files this page loads, by their script tags.
  function loadedModules() {
    var out = [];
    var tags = global.document ? global.document.querySelectorAll('script[src]') : [];
    Array.prototype.forEach.call(tags, function (s) {
      var m = String(s.getAttribute('src') || '').match(/(?:^|\/)(labcal_[a-z0-9_]+\.js)(?:\?|$)/i);
      if (m && out.indexOf(m[1]) === -1) out.push(m[1]);
    });
    return out;
  }

  // [{ file, version }] of everything that is not the page's version.
  function mismatches() {
    var want = pageVersion() || VERSION;
    var bad = [];
    if (VERSION !== want) bad.push({ file: 'labcal_build.js', version: VERSION });
    loadedModules().forEach(function (f) {
      if (f === 'labcal_build.js') return;
      var v = reg[f];
      if (v !== want) bad.push({ file: f, version: v || 'older than v1.574' });
    });
    return { page: want, bad: bad };
  }

  function showBar(res) {
    var d = global.document;
    if (!d || !d.body || d.getElementById('labcalBuildBar')) return;
    var bar = d.createElement('div');
    bar.id = 'labcalBuildBar';
    bar.setAttribute('role', 'alert');
    bar.style.cssText = 'position:sticky;top:0;z-index:10000;background:#8a1c1c;color:#fff;' +
      'font:600 13px/1.4 -apple-system,system-ui,sans-serif;padding:10px 14px;display:flex;gap:12px;' +
      'align-items:center;flex-wrap:wrap;box-shadow:0 2px 6px rgba(0,0,0,.3)';
    var list = res.bad.slice(0, 4).map(function (b) { return b.file + ' (' + b.version + ')'; }).join(', ') +
      (res.bad.length > 4 ? ' and ' + (res.bad.length - 4) + ' more' : '');
    var txt = d.createElement('span');
    txt.style.flex = '1 1 320px';
    txt.textContent = 'LabCal files on this iPad do not match: this page is ' + res.page + ', but ' + list +
      '. Certificates may not come out right. Open the LabCal home page while online and tap "Refresh offline copy".';
    var home = d.createElement('a');
    home.href = 'index.html';
    home.textContent = 'LabCal home';
    home.style.cssText = 'background:#fff;color:#8a1c1c;padding:10px 16px;border-radius:8px;text-decoration:none;min-height:24px';
    bar.appendChild(txt);
    if (!/(^|\/)index\.html$|\/$/.test(global.location.pathname)) bar.appendChild(home);
    d.body.insertBefore(bar, d.body.firstChild);
  }

  function check() {
    var res;
    try { res = mismatches(); } catch (e) { return; }
    global.LabCalBuild.result = res;
    if (res.bad.length) {
      try { console.warn('LabCal file versions differ:', res); } catch (e) {}
      showBar(res);
    }
  }

  global.LabCalBuildCheck = { VERSION: VERSION, mismatches: mismatches, check: check };
  if (global.addEventListener) global.addEventListener('load', check);
})(typeof window !== 'undefined' ? window : this);

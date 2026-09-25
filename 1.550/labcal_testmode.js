/* ---------------------------------------------------------------------
   LabCal — TEST MODE (v1.547)
   ---------------------------------------------------------------------
   The same files are uploaded to two places:
     • radek-cell.github.io        — the real LabCal
     • radek-cell-test.github.io   — the test copy
   On the TEST address only:
     • a red "TEST VERSION" bar sits on top of every page,
     • page titles start with [TEST],
     • every file LabCal hands out is named TEST_...,
   so a test certificate can never be mistaken for, or sent as, a real one.
   On the real address nothing here does anything.
   --------------------------------------------------------------------- */
(function (global) {
  'use strict';
  var TEST_HOSTS = ['radek-cell-test.github.io'];
  var host = '';
  try { host = String(global.location && global.location.hostname || '').toLowerCase(); } catch (e) {}
  var active = TEST_HOSTS.indexOf(host) !== -1;

  global.LabCalTestMode = { active: active, host: host, TEST_HOSTS: TEST_HOSTS };
  if (!active || !global.document) return;

  var doc = global.document;
  try { if (doc.title && doc.title.indexOf('[TEST]') !== 0) doc.title = '[TEST] ' + doc.title; } catch (e) {}

  function addBar() {
    if (doc.getElementById('labcal-test-bar')) return;
    var st = doc.createElement('style');
    st.textContent =
      '#labcal-test-bar{position:fixed;left:0;right:0;top:0;z-index:100001;background:#c0392b;color:#fff;' +
      'font:700 12.5px/1 -apple-system,"Segoe UI",Helvetica,Arial,sans-serif;letter-spacing:.4px;text-align:center;' +
      'padding:calc(6px + env(safe-area-inset-top)) 10px 6px;box-shadow:0 2px 6px rgba(0,0,0,.25);pointer-events:none}' +
      'body{padding-top:26px !important}' +
      '@media print{#labcal-test-bar{display:none !important}body{padding-top:0 !important}}' +
      'body.printMode #labcal-test-bar,body.pdfBusy #labcal-test-bar{display:none !important}';
    (doc.head || doc.body).appendChild(st);
    var bar = doc.createElement('div');
    bar.id = 'labcal-test-bar';
    bar.textContent = 'TEST VERSION — ' + host + ' — certificates made here are NOT valid';
    doc.body.appendChild(bar);
  }
  if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', addBar);
  else addBar();
})(typeof window !== 'undefined' ? window : this);

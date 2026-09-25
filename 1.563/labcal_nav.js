/* ---------------------------------------------------------------------
   LabCal — Back / Home on the worksheet toolbar (v1.563)
   ---------------------------------------------------------------------
   Installed on the iPad Home Screen, LabCal runs without Safari's own
   Back button, so a worksheet had no way out. This adds  ← Back  and
   Home  to the front of the worksheet toolbar, keeps the toolbar on
   screen while scrolling, and keeps it clear of the status bar / notch.

   There is no router in LabCal: every screen is its own page, reached with
   an ordinary link. So navigation stays exactly that:
   • Back  = the browser's own history.back(), used only when the page we
             came from is another LabCal page in this same folder. If there
             is none (worksheet opened directly, from a bookmark, as the
             first page of the app), or Back does not leave the page, it
             goes to the LabCal home page instead — never out of the app
             and never "nothing happens".
   • Home  = index.html in this folder (the app's start page).

   Before leaving, readings are protected with the page's OWN save (the
   per-unit snapshot, or Cloud Temp's autosave). Only if the engineer has
   typed something and it could NOT be saved where it will be found again
   (no job ref / serial, or storage failed) is a confirmation shown.

   Usage (end of a worksheet's script):
     LabCalNav.init({ save: function () { ...return true if saved... } });
   --------------------------------------------------------------------- */
(function (global) {
  'use strict';
  var doc = global.document;
  var HOME = 'index.html';
  var opts = null;
  var userTyped = false;

  function folderOf(path) { return String(path || '').replace(/[^/]*$/, ''); }
  // The page we came from is a LabCal page of this same version folder.
  function cameFromLabCal() {
    try {
      if (!doc.referrer) return false;
      var r = new URL(doc.referrer);
      return r.origin === global.location.origin &&
             folderOf(r.pathname) === folderOf(global.location.pathname) &&
             r.pathname !== global.location.pathname;
    } catch (e) { return false; }
  }

  function tabLocked() {
    try { return !!(global.LabCalTabLock && global.LabCalTabLock.isLocked()); } catch (e) { return false; }
  }

  // true = fine to leave. Saves first; asks only when typed readings would be lost.
  function okToLeave() {
    if (!opts || !userTyped) return true;
    if (tabLocked()) return true;                       // this tab saves nothing by design; the other tab has the unit
    var saved = false;
    try { saved = opts.save ? opts.save() === true : false; } catch (e) { saved = false; }
    if (saved) return true;
    return global.confirm(opts.unsavedMessage ||
      'The readings on this worksheet are NOT saved.\n\n' +
      'They are only kept for a unit with a Job Ref and a Serial No. Fill those in (or generate the certificate) first, or they will be lost.\n\n' +
      'OK = leave anyway and lose them.  Cancel = stay here.');
  }

  function goHome() { global.location.href = HOME; }

  function back() {
    if (!okToLeave()) return;
    if (cameFromLabCal() && global.history.length > 1) {
      var left = false;
      var mark = function () { left = true; };
      global.addEventListener('pagehide', mark, { once: true });
      global.history.back();
      // If history.back() did not take us anywhere (no usable entry), go home.
      global.setTimeout(function () {
        global.removeEventListener('pagehide', mark);
        if (!left && doc.visibilityState !== 'hidden') goHome();
      }, 1200);
      return;
    }
    goHome();
  }
  function home() { if (okToLeave()) goHome(); }

  // ---- toolbar -------------------------------------------------------------
  var CSS =
    // Sticky toolbar. Same spacing as before at rest (10px moved from margin to
    // padding so the background covers it); the status-bar / notch insets are added.
    '.toolbar{position:-webkit-sticky;position:sticky;top:0;z-index:40;background:#dfe6ee;' +
      'margin-top:0!important;margin-bottom:0!important;' +
      'padding:calc(10px + env(safe-area-inset-top,0px)) env(safe-area-inset-right,0px) 10px env(safe-area-inset-left,0px)}' +
    // Test site: its red banner is fixed at the top, sit just under it.
    'body.lcNavTest .toolbar{top:calc(26px + env(safe-area-inset-top,0px));padding-top:10px}' +
    // ~44 x 44 px touch targets for every toolbar button
    '.toolbar .btn{min-height:44px;min-width:44px}' +
    '.lcNavBtn{display:inline-flex;align-items:center;justify-content:center;gap:6px}' +
    '.lcNavBtn svg{width:18px;height:18px;flex:0 0 auto}' +
    // Short labels on narrow screens (phones, split view). The real button text
    // is not touched — the short label is drawn over it — so the pages' own
    // "Generating PDF…" / "Saved to job list ✓" messages still show (see watchLabel).
    '@media (max-width:600px){' +
      '.toolbar .btn.lcShort{font-size:0}' +
      '.toolbar .btn.lcShort::after{content:attr(data-short);font-size:13px}' +
    '}' +
    // very narrow (small phones): Back / Home as icons only so the row still fits
    '@media (max-width:420px){.lcNavBtn .lcNavTxt{display:none}}' +
    '@media print{.toolbar{position:static}}';

  var HOUSE = '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 11.5 12 4l9 7.5"/><path d="M5.5 10v10h13V10"/><path d="M10 20v-6h4v6"/></svg>';

  function button(id, html, label, onClick) {
    var b = doc.createElement('button');
    b.type = 'button';
    b.id = id;
    b.className = 'btn light lcNavBtn';
    b.setAttribute('aria-label', label);
    b.title = label;
    b.innerHTML = html;
    b.addEventListener('click', onClick);
    return b;
  }

  // Short label only while the button shows its normal text; any other text the
  // page puts there (progress / result messages) is shown in full.
  function watchLabel(el, shortText) {
    if (!el) return;
    var normal = el.textContent;
    el.setAttribute('data-short', shortText);
    var apply = function () { el.classList.toggle('lcShort', el.textContent === normal); };
    apply();
    try { new MutationObserver(apply).observe(el, { childList: true, characterData: true, subtree: true }); } catch (e) {}
  }

  function install() {
    var bar = doc.querySelector('.toolbar');
    if (!bar || doc.getElementById('navBackBtn')) return;
    var st = doc.createElement('style');
    st.id = 'labcal-nav-css';
    st.textContent = CSS;
    (doc.head || doc.body).appendChild(st);
    try { if (global.LabCalTestMode && global.LabCalTestMode.active) doc.body.classList.add('lcNavTest'); } catch (e) {}
    var first = bar.firstElementChild;
    bar.insertBefore(button('navBackBtn', '<span aria-hidden="true">←</span><span class="lcNavTxt">Back</span>', 'Back', back), first);
    bar.insertBefore(button('navHomeBtn', HOUSE + '<span class="lcNavTxt">Home</span>', 'LabCal home', home), first);
    watchLabel(doc.getElementById('syncJobBtn'), 'Save');
    watchLabel(doc.getElementById('generateBtn'), 'PDF');
    // Only readings the ENGINEER typed count as work to protect — not values the
    // page fills in itself (restored unit, offsets, dates), which fire no user events.
    var typed = function (e) {
      var t = e.target;
      if (!e.isTrusted || !t || !t.matches || !t.matches('input,select,textarea') || t.type === 'file') return;
      if (bar.contains(t)) return;
      userTyped = true;
    };
    doc.addEventListener('input', typed, true);
    doc.addEventListener('change', typed, true);
  }

  function init(o) {
    opts = o || {};
    if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', install);
    else install();
  }

  global.LabCalNav = {
    init: init,
    back: back,
    home: home,
    okToLeave: okToLeave,
    _cameFromLabCal: cameFromLabCal,
    _typed: function () { return userTyped; }
  };
})(typeof window !== 'undefined' ? window : this);

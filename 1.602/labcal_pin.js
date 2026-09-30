(window.LabCalBuild = window.LabCalBuild || {})['labcal_pin.js'] = 'v1.602';  // file version — see labcal_build.js
/* ---------------------------------------------------------------------
   LabCal — 4-digit PIN pad (v1.594)
   ---------------------------------------------------------------------
   Radek: the PIN is known to every engineer. It is a "stop and think"
   step before Delete job and before Settings — NOT a password. (LabCal is
   a public web app; anything it checks is in its own code.)

   LabCalPin.ask({ title, message }) → Promise<true | false>
     true  = the right PIN was entered
     false = Cancel / Escape / tap outside
   The panel stays open after a wrong PIN ("Wrong PIN — try again"). After
   5 wrong PINs in a row it waits 30 s before the next try.

   • Own on-screen keypad 0–9 (big buttons), digits shown only as ●.
   • ⌫ removes one digit; OK works only with exactly 4 digits.
   • Physical keyboard: 0–9, Backspace, Enter (= OK), Escape (= Cancel).
   • No <input>: iPadOS would pop its keyboard up, move the page and offer
     to save the "password". No prompt(): iOS suppresses it in the
     installed Home Screen app.
   • The PIN is not written in this file — only a SHA-256 fingerprint of
     it (with a fixed salt). Entered digits are never logged, stored or
     shown anywhere.
   To change the PIN: put the new fingerprint in PIN_SHA256 below
   (sha256 of SALT + the 4 digits) and release a new version.
   --------------------------------------------------------------------- */
(function (global) {
  'use strict';

  var SALT = 'LabCal-pin-v1:7f3a9c21e4b8';
  var PIN_SHA256 = 'ebfa8f7ce91a667e5c8f89f67171644eb91581304fef753eb52c8a88bdcdd3fc';
  var MAX_TRIES = 5;
  var WAIT_MS = 30000;
  var LOCK_KEY = 'labcal.pin.wait';     // { fails, until } — no digits kept

  // ---- SHA-256 (small, synchronous; no dependency on crypto.subtle) -----
  var K = [0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2];
  function sha256Hex(ascii) {
    var bytes = [], i;
    for (i = 0; i < ascii.length; i++) bytes.push(ascii.charCodeAt(i) & 0xff);
    var bitLen = bytes.length * 8;
    bytes.push(0x80);
    while (bytes.length % 64 !== 56) bytes.push(0);
    for (i = 7; i >= 0; i--) bytes.push(i > 3 ? 0 : (bitLen >>> (i * 8)) & 0xff);
    var H = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];
    var W = new Array(64);
    function rotr(x, n) { return (x >>> n) | (x << (32 - n)); }
    for (var off = 0; off < bytes.length; off += 64) {
      for (i = 0; i < 16; i++) W[i] = (bytes[off + i * 4] << 24) | (bytes[off + i * 4 + 1] << 16) | (bytes[off + i * 4 + 2] << 8) | bytes[off + i * 4 + 3];
      for (i = 16; i < 64; i++) {
        var s0 = rotr(W[i - 15], 7) ^ rotr(W[i - 15], 18) ^ (W[i - 15] >>> 3);
        var s1 = rotr(W[i - 2], 17) ^ rotr(W[i - 2], 19) ^ (W[i - 2] >>> 10);
        W[i] = (W[i - 16] + s0 + W[i - 7] + s1) | 0;
      }
      var a = H[0], b = H[1], c = H[2], d = H[3], e = H[4], f = H[5], g = H[6], h = H[7];
      for (i = 0; i < 64; i++) {
        var S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
        var t1 = (h + S1 + ((e & f) ^ (~e & g)) + K[i] + W[i]) | 0;
        var S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
        var t2 = (S0 + ((a & b) ^ (a & c) ^ (b & c))) | 0;
        h = g; g = f; f = e; e = (d + t1) | 0; d = c; c = b; b = a; a = (t1 + t2) | 0;
      }
      H[0] = (H[0] + a) | 0; H[1] = (H[1] + b) | 0; H[2] = (H[2] + c) | 0; H[3] = (H[3] + d) | 0;
      H[4] = (H[4] + e) | 0; H[5] = (H[5] + f) | 0; H[6] = (H[6] + g) | 0; H[7] = (H[7] + h) | 0;
    }
    return H.map(function (x) { return ('00000000' + (x >>> 0).toString(16)).slice(-8); }).join('');
  }
  function isRight(digits) { return /^\d{4}$/.test(digits) && sha256Hex(SALT + digits) === PIN_SHA256; }

  // ---- wrong-PIN pause ---------------------------------------------------
  function readWait() {
    try { var o = JSON.parse(global.localStorage.getItem(LOCK_KEY) || 'null'); return o && typeof o === 'object' ? o : { fails: 0, until: 0 }; }
    catch (e) { return { fails: 0, until: 0 }; }
  }
  function writeWait(o) { try { global.localStorage.setItem(LOCK_KEY, JSON.stringify(o)); } catch (e) {} }
  function clearWait() { try { global.localStorage.removeItem(LOCK_KEY); } catch (e) {} }

  // ---- panel -------------------------------------------------------------
  function injectStyle() {
    var d = global.document;
    if (d.getElementById('labcalPinStyle')) return;
    var st = d.createElement('style');
    st.id = 'labcalPinStyle';
    st.textContent =
      '#lcPinOverlay{position:fixed;top:0;left:0;right:0;bottom:0;z-index:10060;background:rgba(0,0,0,.5);display:flex;align-items:center;justify-content:center;padding:16px;box-sizing:border-box}' +
      '#lcPinPanel{background:#fff;color:#111;border-radius:14px;box-shadow:0 10px 34px rgba(0,0,0,.35);width:100%;max-width:340px;max-height:100%;overflow:auto;padding:16px;box-sizing:border-box;font-family:inherit;text-align:center}' +
      '#lcPinPanel .pinTitle{font-size:17px;font-weight:700;margin:0 0 4px}' +
      '#lcPinPanel .pinMsg{font-size:13px;color:#444;margin:0 0 10px;line-height:1.35}' +
      '#lcPinPanel .pinDots{display:flex;justify-content:center;gap:12px;margin:6px 0 6px}' +
      '#lcPinPanel .pinDots span{width:40px;height:48px;border:2px solid #bbb;border-radius:8px;display:flex;align-items:center;justify-content:center;font-size:26px;line-height:1;color:#111;background:#f7f7f7}' +
      '#lcPinPanel .pinDots span.on{border-color:#1a5fb4;background:#eef4ff}' +
      '#lcPinPanel .pinErr{min-height:20px;font-size:14px;font-weight:700;color:#b00020;margin:2px 0 8px}' +
      '#lcPinPanel .pinPad{display:grid;grid-template-columns:repeat(3,1fr);gap:8px}' +
      '#lcPinPanel .pinPad button,#lcPinPanel .pinBar button{min-height:56px;font-size:24px;border:1px solid #bbb;border-radius:10px;background:#fafafa;color:#111;cursor:pointer;touch-action:manipulation;-webkit-tap-highlight-color:transparent;font-family:inherit}' +
      '#lcPinPanel .pinPad button:active{background:#e6efff}' +
      '#lcPinPanel .pinPad button.pinDel{font-size:22px}' +
      '#lcPinPanel .pinPad button.pinOk{background:#1a5fb4;border-color:#1a5fb4;color:#fff;font-weight:700;font-size:20px}' +
      '#lcPinPanel .pinPad button:disabled{opacity:.35;cursor:default}' +
      '#lcPinPanel .pinBar{margin-top:10px;display:flex}' +
      '#lcPinPanel .pinBar button{flex:1;min-height:48px;font-size:16px;background:#f0f0f0;border-color:#999}' +
      '#lcPinPanel.shake{animation:lcPinShake .3s}' +
      '@keyframes lcPinShake{0%,100%{transform:translateX(0)}25%{transform:translateX(-8px)}75%{transform:translateX(8px)}}';
    d.head.appendChild(st);
  }

  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }

  var current = null;   // only one panel at a time

  function ask(opts) {
    opts = opts || {};
    var d = global.document;
    if (current) current.finish(false);
    injectStyle();
    return new Promise(function (resolve) {
      var digits = '', done = false, timer = null;
      var ov = d.createElement('div');
      ov.id = 'lcPinOverlay';
      ov.setAttribute('role', 'dialog');
      ov.setAttribute('aria-modal', 'true');
      ov.setAttribute('aria-label', opts.title || 'Enter PIN');
      var keys = '';
      ['1', '2', '3', '4', '5', '6', '7', '8', '9'].forEach(function (k) { keys += '<button type="button" data-k="' + k + '">' + k + '</button>'; });
      keys += '<button type="button" class="pinDel" data-k="del" aria-label="Delete one digit">⌫</button>' +
              '<button type="button" data-k="0">0</button>' +
              '<button type="button" class="pinOk" data-k="ok" disabled>OK</button>';
      ov.innerHTML = '<div id="lcPinPanel">' +
        '<div class="pinTitle">' + esc(opts.title || 'Enter PIN') + '</div>' +
        (opts.message ? '<div class="pinMsg">' + esc(opts.message) + '</div>' : '') +
        '<div class="pinDots" aria-live="polite"><span></span><span></span><span></span><span></span></div>' +
        '<div class="pinErr" role="alert"></div>' +
        '<div class="pinPad">' + keys + '</div>' +
        '<div class="pinBar"><button type="button" data-k="cancel">Cancel</button></div></div>';
      d.body.appendChild(ov);
      var panel = ov.querySelector('#lcPinPanel');
      var dots = ov.querySelectorAll('.pinDots span');
      var err = ov.querySelector('.pinErr');
      var ok = ov.querySelector('[data-k="ok"]');

      function waitLeft() { var w = readWait(); return Math.max(0, (w.until || 0) - Date.now()); }
      function draw() {
        for (var i = 0; i < 4; i++) { dots[i].textContent = i < digits.length ? '●' : ''; dots[i].className = i < digits.length ? 'on' : ''; }
        var left = waitLeft();
        ok.disabled = digits.length !== 4 || left > 0;
        if (left > 0) err.textContent = 'Too many wrong PINs — wait ' + Math.ceil(left / 1000) + ' s';
      }
      function tick() {
        if (done) return;
        var left = waitLeft();
        draw();
        if (left > 0) timer = global.setTimeout(tick, 500);
        else { if (/wait/.test(err.textContent)) err.textContent = ''; timer = null; draw(); }
      }
      function finish(result) {
        if (done) return;
        done = true; digits = '';
        if (timer) global.clearTimeout(timer);
        d.removeEventListener('keydown', onKey, true);
        if (ov.parentNode) ov.parentNode.removeChild(ov);
        if (current && current.ov === ov) current = null;
        resolve(result);
      }
      function press(k) {
        if (done) return;
        if (k === 'cancel') { finish(false); return; }
        if (k === 'del') { digits = digits.slice(0, -1); if (!waitLeft()) err.textContent = ''; draw(); return; }
        if (k === 'ok') { submit(); return; }
        if (/^\d$/.test(k) && digits.length < 4) { digits += k; if (!waitLeft()) err.textContent = ''; draw(); }
      }
      function submit() {
        if (digits.length !== 4 || waitLeft() > 0) return;
        var right = isRight(digits);
        digits = '';
        if (right) { clearWait(); finish(true); return; }
        var w = readWait();
        w.fails = (w.fails || 0) + 1;
        if (w.fails >= MAX_TRIES) { w.fails = 0; w.until = Date.now() + WAIT_MS; }
        writeWait(w);
        err.textContent = 'Wrong PIN — try again';
        panel.classList.remove('shake'); void panel.offsetWidth; panel.classList.add('shake');
        draw();
        if (waitLeft() > 0) tick();
      }
      function onKey(e) {
        if (done) return;
        var k = e.key;
        if (/^\d$/.test(k)) press(k);
        else if (k === 'Backspace' || k === 'Delete') press('del');
        else if (k === 'Enter') press('ok');
        else if (k === 'Escape') press('cancel');
        else return;
        e.preventDefault(); e.stopPropagation();
      }
      ov.addEventListener('click', function (e) {
        if (e.target === ov) { finish(false); return; }
        var b = e.target.closest && e.target.closest('button[data-k]');
        if (b && !b.disabled) press(b.getAttribute('data-k'));
      });
      d.addEventListener('keydown', onKey, true);
      current = { ov: ov, finish: finish };
      try { if (d.activeElement && d.activeElement.blur) d.activeElement.blur(); } catch (e) {}   // no iPad keyboard left open
      draw();
      if (waitLeft() > 0) tick();
    });
  }

  global.LabCalPin = { ask: ask, isOpen: function () { return !!current; } };
})(typeof window !== 'undefined' ? window : this);

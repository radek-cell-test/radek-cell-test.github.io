/* ---------------------------------------------------------------------
   LabCal — several units in several tabs, safely (v1.559)
   ---------------------------------------------------------------------
   Engineers calibrate several units at once, each in its own tab. Before
   v1.559 the tabs shared state that belonged to ONE unit (the "which unit
   is this worksheet for" link, the worksheet autosave), so a certificate
   could be filed against the unit open in a different tab.

   This module gives every tab its own identity and makes sure a unit
   (job reference + serial) is worked on in ONE tab at a time:

   • Tab id      — kept in sessionStorage, which every browser keeps per
                   tab (it survives reloads and navigation in that tab).
   • Unit lock   — localStorage 'labcal.lock.<JOB>|<SERIAL>' = which tab
                   owns that unit. Opening a unit from the job list takes
                   it over; the older tab is then LOCKED (full-screen
                   notice, no saving, no certificate) until it is closed.
                   Typing a serial that another tab owns does not take it
                   over — that tab shows the notice instead.
   • Autosave    — per tab: autosaveKey('calibration_autosave.smd').

   Everything is best-effort around storage errors, but the one rule is
   never broken: a tab that does not own its unit cannot write the unit's
   readings, update the job list or generate a certificate.
   --------------------------------------------------------------------- */
(function (global) {
  'use strict';

  var TAB_KEY = 'labcal.tab.id';
  var LOCK_PREFIX = 'labcal.lock.';
  var SEEN_KEY = 'labcal.tabs.seen';           // { tabId: lastSeenIso } — for pruning
  var LOCK_DEAD_MS = 12 * 3600 * 1000;         // a lock untouched for 12 h belongs to a closed tab
  var AUTOSAVE_KEEP_DAYS = 30;
  var HEARTBEAT_MS = 30 * 1000;

  var mem = {};                                  // fallback if sessionStorage is unavailable
  function ss() { try { return global.sessionStorage; } catch (e) { return null; } }
  function ls() { try { return global.localStorage; } catch (e) { return null; } }
  function readJson(store, k) { try { var t = store && store.getItem(k); return t ? JSON.parse(t) : null; } catch (e) { return null; } }
  function writeJson(store, k, v) {
    try { if (!store) return false; if (v === null) store.removeItem(k); else store.setItem(k, JSON.stringify(v)); return true; }
    catch (e) { return false; }
  }
  function norm(v) { return String(v || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, ''); }
  function nowIso() { return new Date().toISOString(); }

  // ---- tab id ------------------------------------------------------------
  function newId() { return 't' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }
  function tabId() {
    var s = ss(), id = null;
    try { id = s ? s.getItem(TAB_KEY) : mem[TAB_KEY]; } catch (e) {}
    if (!id) {
      id = newId();
      try { if (s) s.setItem(TAB_KEY, id); else mem[TAB_KEY] = id; } catch (e) { mem[TAB_KEY] = id; }
    }
    return id;
  }
  function resetTabId() {
    var id = newId();
    try { var s = ss(); if (s) s.setItem(TAB_KEY, id); else mem[TAB_KEY] = id; } catch (e) { mem[TAB_KEY] = id; }
    return id;
  }
  function markSeen() {
    var all = readJson(ls(), SEEN_KEY) || {};
    all[tabId()] = nowIso();
    writeJson(ls(), SEEN_KEY, all);
  }

  // ---- per-tab session values (used by labcal_jobsheet.js for the link) ----
  function sessionGet(k) {
    var s = ss();
    if (!s) return mem[k] === undefined ? null : mem[k];
    return readJson(s, k);
  }
  function sessionSet(k, v) {
    var s = ss();
    if (!s) { if (v === null) delete mem[k]; else mem[k] = v; return true; }
    return writeJson(s, k, v);
  }

  // ---- unit locks --------------------------------------------------------
  function unitKey(jobRef, serial) {
    var s = norm(serial);
    if (!s) return '';
    return (norm(jobRef) || 'NOJOB') + '|' + s;
  }
  function lockOf(key) { return key ? readJson(ls(), LOCK_PREFIX + key) : null; }
  function isDead(lock) {
    if (!lock || !lock.at) return true;
    var t = Date.parse(lock.at);
    return !isFinite(t) || (Date.now() - t) > LOCK_DEAD_MS;
  }
  function writeLock(key) {
    if (!key) return false;
    return writeJson(ls(), LOCK_PREFIX + key, { tab: tabId(), sheet: state.sheet || '', at: nowIso() });
  }
  function releaseLock(key) {
    var l = lockOf(key);
    if (l && l.tab === tabId()) writeJson(ls(), LOCK_PREFIX + key, null);
  }

  // Held by ANOTHER live tab? (for the job list, before it opens a unit)
  function holder(jobRef, serial) {
    var l = lockOf(unitKey(jobRef, serial));
    if (!l || l.tab === tabId() || isDead(l)) return null;
    return l;
  }

  // ---- state of this (worksheet) tab --------------------------------------
  var state = {
    active: false,     // init() was called — this page is a worksheet
    sheet: '',
    identity: null,    // function returning { jobRef, serial }
    key: '',           // unit key this tab currently works on
    owned: {},         // keys this tab has held during this page's life
    refused: {},       // key -> 'lost' | 'taken' (sticky, see evaluate)
    dismissed: '',     // key whose full-screen notice was put away to edit the serial
    locked: false,
    reason: ''         // 'lost' | 'taken'
  };

  function currentKey() {
    if (!state.identity) return '';
    var u = {};
    try { u = state.identity() || {}; } catch (e) {}
    return unitKey(u.jobRef, u.serial);
  }

  // Decide whether this tab may work on the unit shown on its form.
  //   force = arrived from the job list: take the unit over.
  // Once a tab has been refused a unit it stays refused for that unit for
  // the rest of the page's life, even if the other tab later lets go:
  //  • 'lost'  — its readings are older than the other tab's, so it must
  //              never write them back over the newer ones;
  //  • 'taken' — it never had that unit's readings at all.
  // Changing the serial/job on the form to a free unit, or opening the
  // unit from the job list (a fresh page), are the only ways out.
  function evaluate(force) {
    if (!state.active) return true;
    var key = currentKey();
    if (key !== state.key) {
      if (state.key && !state.locked) releaseLock(state.key);   // let go of the old unit
      state.key = key;
    }
    if (!key) { setLocked(false); return true; }             // no serial yet — nothing to clash with
    if (state.refused[key] && !force) { setLocked(true, state.refused[key]); return false; }
    var l = lockOf(key);
    var mine = !!(l && l.tab === tabId());
    if (force || mine || !l || isDead(l)) {
      if (force) delete state.refused[key];
      // Write only when taking the unit. Rewriting a lock we already hold on
      // every check would fire a storage event in every other tab, which
      // checks and rewrites its own — an endless storm. The heartbeat keeps
      // an owned lock fresh.
      if (!mine || force) writeLock(key);
      state.owned[key] = true;
      setLocked(false);
      return true;
    }
    var why = state.owned[key] ? 'lost' : 'taken';
    state.refused[key] = why;
    if (why === 'lost') dropOwnAutosaves();
    setLocked(true, why);
    return false;
  }
  // A tab that lost its unit must not bring its older readings back on reload.
  function dropOwnAutosaves() {
    var s = ls(); if (!s) return;
    var suffix = '@' + tabId(), rm = [];
    for (var i = 0; i < s.length; i++) { var k = s.key(i); if (k && /autosave/.test(k) && k.slice(-suffix.length) === suffix) rm.push(k); }
    rm.forEach(function (k) { try { s.removeItem(k); } catch (e) {} });
  }

  // ---- the notice ---------------------------------------------------------
  var overlay = null;
  function unitLabel() {
    var u = {};
    try { u = state.identity ? (state.identity() || {}) : {}; } catch (e) {}
    return (u.serial ? 'serial ' + u.serial : 'this unit') + (u.jobRef ? ' (job ' + u.jobRef + ')' : '');
  }
  function setLocked(on, reason) {
    state.locked = !!on;
    state.reason = on ? (reason || 'taken') : '';
    if (!global.document || !global.document.body) return;
    if (!on) {
      if (overlay) { overlay.remove(); overlay = null; }
      if (strip) { strip.remove(); strip = null; }
      state.dismissed = '';
      return;
    }
    if (state.dismissed && state.dismissed === state.key && state.reason === 'taken') { showStrip(); return; }
    if (!overlay) {
      overlay = global.document.createElement('div');
      overlay.id = 'labcalTabLock';
      overlay.setAttribute('role', 'alertdialog');
      overlay.style.cssText = 'position:fixed;inset:0;z-index:99999;background:rgba(40,0,0,.72);display:flex;align-items:center;justify-content:center;padding:16px;font-family:Arial,sans-serif';
      global.document.body.appendChild(overlay);
    }
    var lost = state.reason === 'lost';
    overlay.innerHTML =
      '<div style="background:#fff;max-width:520px;width:100%;border-radius:10px;padding:20px 22px;border:3px solid #b00000;box-shadow:0 8px 30px rgba(0,0,0,.4)">' +
      '<div style="font-size:20px;font-weight:bold;color:#b00000;margin-bottom:10px">&#9888; ' +
      (lost ? 'This unit is now open in another tab' : 'This unit is already open in another tab') + '</div>' +
      '<div style="font-size:15px;line-height:1.45;color:#222">' +
      (lost
        ? escapeHtml(unitLabel()) + ' was opened again in another tab. So that the two copies cannot mix, this tab is <b>locked</b>: nothing here is saved and no certificate can be made from it.<br><br>Carry on in the other tab &mdash; the readings typed here were saved before it opened, so they are already there. You can close this tab.'
        : escapeHtml(unitLabel()) + ' is being worked on in another tab. Two tabs must never fill in the same unit, so nothing here is saved and no certificate can be made from it.<br><br>Use that tab &mdash; or, if it has been closed, open the unit again from the job list.') +
      '</div>' +
      '<div style="display:flex;gap:10px;flex-wrap:wrap;margin-top:16px">' +
      '<a href="calibration.html" style="flex:1;min-width:150px;text-align:center;background:#1f4e79;color:#fff;text-decoration:none;padding:12px;border-radius:7px;font-weight:bold">Go to job list</a>' +
      (lost ? '' : '<button type="button" id="labcalTabLockEdit" style="flex:1;min-width:150px;padding:12px;border-radius:7px;border:1px solid #888;background:#f2f2f2;font-weight:bold;font-size:14px">Change the serial / job here</button>') +
      '</div></div>';
    var edit = overlay.querySelector('#labcalTabLockEdit');
    if (edit) edit.addEventListener('click', function () {
      // Let them correct a mistyped serial; still locked until it no longer clashes.
      state.dismissed = state.key;
      if (overlay) { overlay.remove(); overlay = null; }
      showStrip();
      var el = global.document.getElementById('serial');
      if (el) { try { el.focus(); el.select(); } catch (e) {} }
    });
  }
  var strip = null;
  function showStrip() {
    if (!global.document || !global.document.body) return;
    if (!strip) {
      strip = global.document.createElement('div');
      strip.id = 'labcalTabLockStrip';
      strip.style.cssText = 'position:fixed;left:0;right:0;top:0;z-index:99998;background:#b00000;color:#fff;font:bold 14px Arial,sans-serif;padding:8px 12px;text-align:center';
      global.document.body.appendChild(strip);
    }
    strip.textContent = '⚠ ' + unitLabel() + ' is open in another tab — this tab is not saving and cannot make a certificate. Change the serial / job, or use the other tab.';
  }
  function escapeHtml(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }

  function refresh(force) {
    evaluate(force);
    return !state.locked;
  }

  // ---- public checks used by the other modules ----------------------------
  // May this tab write readings / job list / certificate for jobRef+serial?
  function canWrite(jobRef, serial) {
    if (!state.active) return true;               // not a worksheet page
    var key = unitKey(jobRef, serial);
    if (!key) return true;
    if (key === state.key) return refresh(false);
    // A different unit from what the form says (should not happen) — only if nobody else has it.
    var l = lockOf(key);
    return !l || l.tab === tabId() || isDead(l);
  }
  function isLocked() { if (state.active) refresh(false); return state.locked; }

  // ---- per-tab autosave ----------------------------------------------------
  function autosaveKey(base) { return base + '@' + tabId(); }
  // Autosaves of this worksheet made in OTHER tabs (or before v1.559), newest
  // first — offered only with an explicit question, never loaded silently.
  function otherAutosaves(base) {
    var s = ls(), out = [];
    if (!s) return out;
    var mine = autosaveKey(base);
    var seen = readJson(s, SEEN_KEY) || {};
    for (var i = 0; i < s.length; i++) {
      var k = s.key(i);
      if (!k || k === mine) continue;
      if (k !== base && k.indexOf(base + '@') !== 0) continue;
      var tab = k === base ? '' : k.slice(base.length + 1);
      out.push({ key: k, data: s.getItem(k), seenAt: tab ? (seen[tab] || '') : '' });
    }
    out.sort(function (a, b) { return String(b.seenAt) < String(a.seenAt) ? -1 : 1; });
    return out;
  }
  function prune() {
    var s = ls();
    if (!s) return;
    var seen = readJson(s, SEEN_KEY) || {};
    var cutoff = Date.now() - AUTOSAVE_KEEP_DAYS * 86400000;
    var dead = {};
    Object.keys(seen).forEach(function (t) { var at = Date.parse(seen[t]); if (!isFinite(at) || at < cutoff) dead[t] = true; });
    var remove = [];
    for (var i = 0; i < s.length; i++) {
      var k = s.key(i);
      if (!k) continue;
      if (k.indexOf(LOCK_PREFIX) === 0) { if (isDead(readJson(s, k))) remove.push(k); continue; }
      var at = k.lastIndexOf('@t');
      if (at > 0 && /autosave/.test(k)) {
        var tab = k.slice(at + 1);
        if (dead[tab] || !seen[tab]) { if (!seen[tab]) seen[tab] = nowIso(); else remove.push(k); }
      }
    }
    remove.forEach(function (k) { try { s.removeItem(k); } catch (e) {} });
    Object.keys(dead).forEach(function (t) { delete seen[t]; });
    writeJson(s, SEEN_KEY, seen);
  }

  // ---- duplicate tabs -----------------------------------------------------
  // "Duplicate tab" copies sessionStorage, so two tabs could share an id.
  // A new page asks; if a live tab answers with the same id, take a new one.
  var chan = null;
  function startChannel() {
    if (!global.BroadcastChannel) return;
    try { chan = new global.BroadcastChannel('labcal-tabs'); } catch (e) { chan = null; return; }
    var nonce = Math.random().toString(36).slice(2);
    chan.onmessage = function (ev) {
      var m = ev && ev.data || {};
      if (m.type === 'hello' && m.tab === tabId() && m.nonce !== nonce) {
        chan.postMessage({ type: 'dup', tab: m.tab, nonce: m.nonce });
      } else if (m.type === 'dup' && m.nonce === nonce) {
        // we are the copy: new identity, and we do not own anything we did not open
        resetTabId();
        state.owned = {};
        markSeen();
        refresh(false);
      } else if (m.type === 'lock') {
        refresh(false);
      }
    };
    chan.postMessage({ type: 'hello', tab: tabId(), nonce: nonce });
  }
  function announceLock() { try { if (chan) chan.postMessage({ type: 'lock' }); } catch (e) {} }

  // ---- worksheet setup ------------------------------------------------------
  //   LabCalTabLock.init({ sheet:'smd', identity: unitIdentity })
  // Call once, after the job-list handoff has been applied.
  function init(opts) {
    opts = opts || {};
    state.active = true;
    state.sheet = opts.sheet || '';
    state.identity = typeof opts.identity === 'function' ? opts.identity : null;
    var fromList = !!(global.LabCalJobsheet && global.LabCalJobsheet.arrivedFromList && global.LabCalJobsheet.arrivedFromList());
    markSeen();
    prune();
    startChannel();
    refresh(fromList);
    if (!state.locked) announceLock();

    // another tab took or released a lock
    global.addEventListener('storage', function (e) {
      if (!e || !e.key || e.key.indexOf(LOCK_PREFIX) !== 0) return;
      refresh(false);
    });
    // the serial / job being typed
    ['serial', 'jobRef'].forEach(function (id) {
      var el = global.document.getElementById(id);
      if (!el) return;
      el.addEventListener('change', function () { refresh(false); announceLock(); });
      el.addEventListener('blur', function () { refresh(false); announceLock(); });
    });
    global.document.addEventListener('visibilitychange', function () {
      if (global.document.visibilityState === 'visible') { markSeen(); refresh(false); }
    });
    global.addEventListener('pageshow', function (e) { if (e && e.persisted) { markSeen(); refresh(false); } });
    // leaving the page (back to the job list, closing the tab) frees the unit
    global.addEventListener('pagehide', function () { if (state.key && !state.locked) releaseLock(state.key); });
    global.setInterval(function () {
      if (global.document.visibilityState !== 'visible') return;
      markSeen();
      if (state.key && !state.locked) { var l = lockOf(state.key); if (l && l.tab === tabId()) writeLock(state.key); else refresh(false); }
    }, HEARTBEAT_MS);
  }

  global.LabCalTabLock = {
    init: init,
    tabId: tabId,
    unitKey: unitKey,
    holder: holder,
    canWrite: canWrite,
    isLocked: isLocked,
    refresh: refresh,
    autosaveKey: autosaveKey,
    otherAutosaves: otherAutosaves,
    sessionGet: sessionGet,
    sessionSet: sessionSet,
    _state: state
  };
})(typeof window !== 'undefined' ? window : this);

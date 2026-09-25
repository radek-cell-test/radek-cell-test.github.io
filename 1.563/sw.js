// ---------------------------------------------------------------------
// LabCal Calibration Suite — service worker
// Bump CACHE_VERSION any time the HTML/JS files change and you want
// devices that already installed the app to pick up the new version.
// ---------------------------------------------------------------------
const CACHE_VERSION  = 'v107';
// v1.553: cache names carry the folder this worker serves (e.g. /1.553/), so
// two LabCal versions on the same site (the test site keeps one folder per
// version) can no longer delete each other's offline copy.
const SCOPE_TAG      = new URL(self.registration ? self.registration.scope : self.location.href).pathname;
const STATIC_CACHE   = `labcal-static-${CACHE_VERSION}@${SCOPE_TAG}`;
const RUNTIME_CACHE  = `labcal-runtime-${CACHE_VERSION}@${SCOPE_TAG}`;

// Same-origin app shell — every page in the suite.
// Add new pages here (and to OFFLINE_PAGES in index.html) when you add them.
const APP_SHELL = [
  './',
  './index.html',
  './icon-180.png',   // Home Screen icon (v1.546)
  './icon-512.png',
  // shared modules — the probe offsets vault every page reads from
  './labcal_offsets.js',
  './labcal_jobsheet.js',
  './labcal_testmode.js',
  './labcal_save.js',
  './labcal_certs.js',
  './labcal_guard.js',
  './labcal_jobpack.js',
  './labcal_units.js',
  './labcal_tablock.js',   // v1.559: one unit in one tab
  './labcal_nav.js',       // v1.563: Back / Home on worksheet toolbars
  './labcal_timing.js',
  './labcal_backup.js',
  './labcal_pdf.js',
  './labcal_vector_pdf.js',
  './labcal_font_dancing.js',
  './pdf-lib.min.js',   // ~512 KB, loaded only when merging a day's certificates
  // third-party libraries — served from this site since v1.542 so nothing
  // the worksheets need depends on a CDN being reachable (see lib/README.txt)
  './lib/jspdf.umd.min.js',
  './lib/html2pdf.bundle.min.js',
  './lib/html2pdf.min.js',
  './lib/xlsx.full.min.js',
  './lib/pdf.min.js',
  './lib/pdf.worker.min.js',
  './lib/html2canvas-pro.min.js',
  './lib/dancing-script.css',
  './lib/dancing-script-latin-600-normal.woff2',
  // section pages
  './calibration.html',
  './tools.html',
  // calibration worksheets
  './barkey_calibration_form.html',
  './calibration_worksheet_SMD.html',
  './calibration_worksheet_NSMD.html',
  './calibration_worksheet_IBB.html',
  './calibration_worksheet_SNMD.html',
  './calibration_worksheet_19_24.html',
  './monitoring_systems.html',
  './cloud_temp.html',
  // tools & utilities
  './data_logger_viewer.html',
  './pdf_merge_reorder.html'   // ~1.9 MB, fully self-contained
];

// Third-party libraries the worksheets load from CDNs (pdf.js, html2pdf,
// xlsx, jspdf, html2canvas-pro, Google font CSS). These URLs are versioned,
// so caching them long-term is safe.
// v1.542: every library is now in ./lib and listed in APP_SHELL above. The
// pages no longer load anything from cdnjs / jsdelivr / Google Fonts, so
// there is nothing left to fetch from third parties.
const CDN_ASSETS = [];

const ALL_ASSETS = [...APP_SHELL, ...CDN_ASSETS];

// ---------------------------------------------------------------------
// Caching helpers
// ---------------------------------------------------------------------

// The Google Fonts stylesheet only *references* the real font files on
// fonts.gstatic.com. Caching the CSS alone leaves the cursive signature
// font unavailable offline, so pull those URLs out and cache them too.
async function cacheReferencedFonts(cache, url, res){
  if(!url.includes('fonts.googleapis.com')) return;
  try{
    const css = await res.clone().text();
    if(!css) return; // opaque response — nothing readable
    const fontUrls = [...css.matchAll(/url\((https:\/\/fonts\.gstatic\.com[^)]+)\)/g)].map(m => m[1]);
    await Promise.all(fontUrls.map(async f => {
      try{
        const fr = await fetch(f, { mode: 'no-cors', cache: 'reload' });
        await cache.put(f, fr);
      }catch(e){ /* non-fatal */ }
    }));
  }catch(e){ /* non-fatal */ }
}

// Fetch a URL and store it.
//
// IMPORTANT: a no-cors ("opaque") response looks identical whether the CDN
// returned the real library or a 403/404 error page — status is always 0 and
// the body can't be read. Blindly caching those means a flaky connection or
// captive portal can silently store junk while reporting a successful
// download, and the worksheet then breaks offline with no warning.
// So: do a normal CORS request first and require res.ok. Only fall back to an
// opaque request as a last resort, and flag it as unverified so the caller can
// tell the engineer rather than promising everything is fine.
//
// Returns { ok, verified }.
async function cacheOne(cache, url){
  const sameOrigin = new URL(url, self.location.href).origin === self.location.origin;
  try{
    const res = await fetch(url, { cache: 'reload' });
    if(res && res.ok){
      await cache.put(url, res.clone());
      await cacheReferencedFonts(cache, url, res);
      return { ok:true, verified:true };
    }
  }catch(e){ /* fall through to the opaque attempt */ }

  if(!sameOrigin){
    try{
      const res = await fetch(url, { mode: 'no-cors', cache: 'reload' });
      if(res && res.type === 'opaque'){
        await cache.put(url, res);
        return { ok:true, verified:false };
      }
    }catch(e){ /* give up on this one */ }
  }
  return { ok:false, verified:false };
}

// Cache a list of URLs one at a time, reporting progress. Never throws —
// a single failure must not abandon the whole download.
async function cacheList(cache, urls, onProgress){
  const failed = [], unverified = [];
  for(const url of urls){
    const r = await cacheOne(cache, url);
    if(!r.ok) failed.push(url);
    else if(!r.verified) unverified.push(url);
    if(onProgress) onProgress(url, r.ok);
  }
  return { failed, unverified };
}

// ---------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(STATIC_CACHE);
    // NOTE: deliberately not cache.addAll() — that is atomic, so one
    // missing or blocked file would abort the entire install and leave
    // the app with no offline support at all.
    const { failed } = await cacheList(cache, ALL_ASSETS);
    const firstInstall = !self.registration.active;
    if(!firstInstall && failed.length){
      // v1.553: an UPDATE must be complete or not happen at all. With the
      // page served from the iPad first, a half-downloaded new version would
      // mean some files new and some missing. Throwing makes the browser
      // discard this attempt; the working version stays in charge and the
      // browser tries again on a later visit.
      await caches.delete(STATIC_CACHE);
      throw new Error('LabCal update incomplete — missing: ' + failed.join(', '));
    }
    // First install: nothing to protect, start working straight away.
    // Updates: wait until the engineer taps "Update" (SKIP_WAITING message)
    // or every LabCal tab is closed, so a page never switches version while
    // a worksheet is open.
    if(firstInstall) self.skipWaiting();
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    // Remove this folder's older versions, plus pre-v1.553 caches (names
    // without a folder tag). Other folders' tagged caches are left alone.
    await Promise.all(
      keys.filter(k => k.startsWith('labcal-') && k !== STATIC_CACHE && k !== RUNTIME_CACHE
                    && (k.endsWith('@' + SCOPE_TAG) || !k.includes('@')))
          .map(k => caches.delete(k))
    );
    await self.clients.claim();
  })());
});

// ---------------------------------------------------------------------
// Explicit "Download for offline use" from index.html
// The page asks us to precache; we do it into STATIC_CACHE (so it survives
// and is found by the status check) and report progress + any failures.
// ---------------------------------------------------------------------
self.addEventListener('message', event => {
  const data = event.data || {};
  // v1.553: the page's "Update now" button.
  if(data.type === 'SKIP_WAITING'){ self.skipWaiting(); return; }
  if(data.type === 'GET_VERSION'){
    const port = event.ports && event.ports[0];
    if(port) port.postMessage({ type:'VERSION', version: CACHE_VERSION });
    return;
  }
  if(data.type !== 'PRECACHE_ALL') return;
  const port = event.ports && event.ports[0];
  event.waitUntil((async () => {
    try{
      const cache = await caches.open(STATIC_CACHE);
      const urls = ALL_ASSETS;
      // v1.553: fill in only what is MISSING from this version's copy. Files
      // already stored are never replaced here, because the site may already
      // hold a newer version — mixing the two is what once produced
      // "…is not a function" errors. New versions arrive as a complete
      // update of the service worker instead (see install).
      let done = 0;
      const failed = [], unverified = [];
      for(const url of urls){
        const have = await cache.match(url, { ignoreSearch: true });
        if(!have){
          const r = await cacheOne(cache, url);
          if(!r.ok) failed.push(url); else if(!r.verified) unverified.push(url);
        }
        done++;
        if(port) port.postMessage({ type:'PROGRESS', done, total: urls.length });
      }
      if(port) port.postMessage({ type:'DONE', failed, unverified, total: urls.length });
    }catch(e){
      if(port) port.postMessage({ type:'DONE', failed:['(unexpected error) ' + (e && e.message)], unverified:[], total:0 });
    }
  })());
});

// ---------------------------------------------------------------------
// Fetch
// ---------------------------------------------------------------------

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  const sameOrigin = url.origin === self.location.origin;

  // v1.553: EVERYTHING on this site is served from the copy stored on the
  // iPad first — pages, labcal_*.js and ./lib alike. A weak signal can no
  // longer make a page hang: the network is only used for a file this
  // version has not stored. (Before v1.553 pages and scripts were
  // network-first with no time limit, so one bar of signal meant waiting
  // until the request gave up — airplane mode was the only way round it.)
  //
  // Page and scripts can never be of different versions: they all come out
  // of this worker's own cache (STATIC_CACHE, one per version), and a new
  // version only takes over once it has stored every file (install above).
  if (sameOrigin) {
    event.respondWith((async () => {
      const cache = await caches.open(STATIC_CACHE);
      const isPage = req.mode === 'navigate' || req.destination === 'document';
      // Pages are opened with ?job=… etc., so match them without the query.
      let hit = await cache.match(req, { ignoreSearch: isPage || url.pathname.includes('/lib/') });
      if (!hit && isPage && url.pathname.endsWith('/')) hit = await cache.match('./index.html');
      if (hit) return hit;
      try {
        const fresh = await fetch(req);
        if (fresh && fresh.ok && !isPage) {
          const rt = await caches.open(RUNTIME_CACHE);
          rt.put(req, fresh.clone());
        }
        return fresh;
      } catch (e) {
        const rt = await caches.match(req, { ignoreSearch: true });
        if (rt) return rt;
        if (isPage) {
          const home = await cache.match('./index.html');
          return home || new Response(
            '<h1>Offline</h1><p>This page has not been downloaded for offline use yet.</p>',
            { headers: { 'Content-Type': 'text/html' } }
          );
        }
        throw e;
      }
    })());
    return;
  }

  // Third-party files (none since v1.542): cache-first.
  event.respondWith((async () => {
    const cached = await caches.match(req);
    if (cached) return cached;
    try {
      const fresh = await fetch(req, { mode: 'no-cors' });
      const cache = await caches.open(RUNTIME_CACHE);
      cache.put(req, fresh.clone());
      return fresh;
    } catch (e) {
      return cached;
    }
  })());
});

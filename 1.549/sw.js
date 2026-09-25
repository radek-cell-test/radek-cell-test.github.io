// ---------------------------------------------------------------------
// LabCal Calibration Suite — service worker
// Bump CACHE_VERSION any time the HTML/JS files change and you want
// devices that already installed the app to pick up the new version.
// ---------------------------------------------------------------------
const CACHE_VERSION  = 'v93';
const STATIC_CACHE   = `labcal-static-${CACHE_VERSION}`;
const RUNTIME_CACHE  = `labcal-runtime-${CACHE_VERSION}`;

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
  './labcal_units.js',
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
    await cacheList(cache, ALL_ASSETS);
    self.skipWaiting();
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(
      keys.filter(k => k !== STATIC_CACHE && k !== RUNTIME_CACHE)
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
  if(data.type !== 'PRECACHE_ALL') return;
  const port = event.ports && event.ports[0];
  event.waitUntil((async () => {
    try{
      const cache = await caches.open(STATIC_CACHE);
      const urls = ALL_ASSETS;
      let done = 0;
      const { failed, unverified } = await cacheList(cache, urls, () => {
        done++;
        if(port) port.postMessage({ type:'PROGRESS', done, total: urls.length });
      });
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

  // HTML pages: try the network first (so edits show up while online),
  // fall back to the cached copy the moment the network fails (offline).
  if (req.mode === 'navigate' || req.destination === 'document') {
    event.respondWith((async () => {
      try {
        const fresh = await fetch(req);
        const cache = await caches.open(STATIC_CACHE);
        cache.put(req, fresh.clone());
        return fresh;
      } catch (e) {
        const cached = await caches.match(req, { ignoreSearch: true });
        if (cached) return cached;
        const home = await caches.match('./index.html');
        return home || new Response(
          '<h1>Offline</h1><p>This page has not been downloaded for offline use yet.</p>',
          { headers: { 'Content-Type': 'text/html' } }
        );
      }
    })());
    return;
  }

  const sameOrigin = new URL(req.url).origin === self.location.origin;

  // ./lib/ — pinned third-party libraries (v1.542). They never change under
  // a given name, so serve the stored copy first, exactly as the CDN copies
  // were: no waiting on weak hospital Wi-Fi for 1 MB files that are already
  // on the iPad.
  if (sameOrigin && new URL(req.url).pathname.includes('/lib/')) {
    event.respondWith((async () => {
      const cached = await caches.match(req, { ignoreSearch: true });
      if (cached) return cached;
      const fresh = await fetch(req);
      if (fresh && fresh.ok) {
        const cache = await caches.open(STATIC_CACHE);
        cache.put(req, fresh.clone());
      }
      return fresh;
    })());
    return;
  }

  // OUR OWN files (labcal_*.js and anything else on this site): network-first,
  // exactly like the HTML pages.
  //
  // These used to be cache-first, which caused a nasty class of fault: an
  // updated page would load against a stale copy of its own JavaScript, so a
  // newly added function simply would not exist. It showed up as
  // "LabCalVectorPdf.blobJobSummary is not a function" and as buttons that
  // did nothing, on a device that looked fully up to date. The page and the
  // scripts it depends on must move together.
  if (sameOrigin) {
    event.respondWith((async () => {
      try {
        const fresh = await fetch(req, { cache: 'no-cache' });
        if (fresh && fresh.ok) {
          const cache = await caches.open(STATIC_CACHE);
          cache.put(req, fresh.clone());
        }
        return fresh;
      } catch (e) {
        const cached = await caches.match(req, { ignoreSearch: true });
        if (cached) return cached;
        throw e;
      }
    })());
    return;
  }

  // Third-party libraries and fonts: cache-first, since those URLs are
  // versioned and never change under us.
  event.respondWith((async () => {
    const cached = await caches.match(req);
    if (cached) return cached;
    try {
      const fresh = await fetch(req, { mode: 'no-cors' });
      const cache = await caches.open(RUNTIME_CACHE);
      cache.put(req, fresh.clone());
      return fresh;
    } catch (e) {
      return cached; // nothing we can do — not previously cached, no network
    }
  })());
});

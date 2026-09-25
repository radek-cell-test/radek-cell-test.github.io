/* ---------------------------------------------------------------------
   LabCal — certificate PDF render settings
   ---------------------------------------------------------------------
   The worksheets are rasterised to a JPEG and wrapped in a PDF (html2canvas
   cannot produce live text, and the whole swapFieldsForText approach exists
   because of that). So the file size is decided by two numbers: the capture
   scale and the JPEG quality.

   The suite shipped with scale 2 and quality 0.98, which produced roughly
   1 MB per certificate. JPEG quality above about 0.90 spends a lot of bytes
   on detail that is invisible in flat-colour text and table rules, and a
   210 mm page at scale 2 is ~190 dpi when 150 dpi already prints cleanly.

   Standard is the new default. High and Maximum are there for when a
   customer wants an especially crisp copy; Maximum is the old behaviour
   exactly, so nothing is lost.

   Actual sizes are visible per certificate in the day panel on the
   calibration page — worth comparing rather than taking my word for it.
   --------------------------------------------------------------------- */
(function (global) {
  'use strict';

  var KEY = 'labcal.pdf.quality';
  var KEY_STYLE = 'labcal.pdf.style';

  var PRESETS = {
    standard: {
      id: 'standard', name: 'Standard',
      scale: 1.7, quality: 0.82,
      note: 'Smallest files, still sharp in print. Recommended.'
    },
    high: {
      id: 'high', name: 'High',
      scale: 2, quality: 0.92,
      note: 'Noticeably larger files, for an especially crisp copy.'
    },
    max: {
      id: 'max', name: 'Maximum',
      scale: 2, quality: 0.98,
      note: 'The original setting — around 1 MB per certificate.'
    }
  };

  function store() {
    try { return global.localStorage; } catch (e) { return null; }
  }

  function current() {
    var s = store();
    var id = 'standard';
    if (s) {
      try { id = s.getItem(KEY) || 'standard'; } catch (e) {}
    }
    return PRESETS[id] || PRESETS.standard;
  }

  function setPreset(id) {
    if (!PRESETS[id]) return false;
    var s = store();
    if (!s) return false;
    try { s.setItem(KEY, id); } catch (e) { return false; }
    return true;
  }

  // 'image' — the html2canvas capture used since the suite began.
  // 'text'  — drawn as real text with jsPDF. Far smaller and selectable, but
  //           only implemented for the 19/24 worksheet so far; the others
  //           ignore this and always use the image path.
  // Text is the default. It is a fifth of the size, selectable and searchable,
  // and prints sharper. Image remains available for Cloud Temp (which has no
  // text generator yet) and as a fallback if a text certificate ever fails.
  function style() {
    var s = store();
    if (!s) return 'text';
    try {
      var v = s.getItem(KEY_STYLE);
      return v === 'image' ? 'image' : 'text';
    } catch (e) { return 'text'; }
  }

  function setStyle(v) {
    var s = store();
    if (!s) return false;
    try { s.setItem(KEY_STYLE, v === 'text' ? 'text' : 'image'); return true; } catch (e) { return false; }
  }

  function scale() { return current().scale; }
  function quality() { return current().quality; }

  // Drop-in for html2pdf's `image` option.
  function imageOpts() {
    return { type: 'jpeg', quality: current().quality };
  }

  // Drop-in for html2pdf's `html2canvas` option. `extra` merges in anything
  // a particular worksheet needs on top.
  function canvasOpts(extra) {
    var out = { scale: current().scale, useCORS: true, backgroundColor: '#ffffff' };
    if (extra) Object.keys(extra).forEach(function (k) { out[k] = extra[k]; });
    return out;
  }

  global.LabCalPdf = {
    PRESETS: PRESETS,
    current: current,
    setPreset: setPreset,
    style: style,
    setStyle: setStyle,
    scale: scale,
    quality: quality,
    imageOpts: imageOpts,
    canvasOpts: canvasOpts
  };
})(typeof window !== 'undefined' ? window : this);

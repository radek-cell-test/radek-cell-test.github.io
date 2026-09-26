(window.LabCalBuild = window.LabCalBuild || {})['labcal_vector_pdf.js'] = 'v1.577';  // file version — see labcal_build.js
/* ---------------------------------------------------------------------
   LabCal — vector (text) certificate generator
   ---------------------------------------------------------------------
   Draws the certificate as real text with jsPDF instead of screenshotting
   the page with html2canvas. Roughly 25 KB instead of ~400 KB, selectable,
   searchable, and sharp at any zoom.

   Coordinates are millimetres from the TOP-left of an A4 page, which is how
   jsPDF works. Every helper takes the box it draws into, so nothing is
   positioned by a hard-coded offset from the page edge.

   This covers the 19/24 Range worksheet only. The other four still use the
   image path; the setting on the home page chooses between them.
   --------------------------------------------------------------------- */
(function (global) {
  'use strict';

  // ---- page geometry ---------------------------------------------------
  var PW = 210, PH = 297;

  // A "Generated <date time>" line was useful for telling a regenerated
  // certificate from the one it replaced, but on a UKAS document a timestamp
  // later than the calibration date invites awkward questions. Off unless
  // this is turned back on deliberately.
  var SHOW_GENERATED_STAMP = false;
  var MX = 12, MT = 11;          // margins
  var IN = PW - MX * 2;

  // ---- palette (matches the on-screen worksheet) -----------------------
  var INK = [17, 17, 17];
  var RULE = [185, 194, 203];
  var RULE_D = [139, 150, 161];
  var HDR_BG = [236, 239, 242];
  var GREEN_BG = [233, 245, 234];
  var AMBER_BG = [253, 243, 220];
  var GREY_TXT = [154, 163, 171];
  var GREY_BG = [241, 243, 245];
  var CHIP_BG = [242, 246, 250];
  var CHIP_BD = [211, 219, 227];
  var BLUE_MK = [47, 111, 208];
  var GREEN_MK = [30, 158, 82];
  var GREEN_BD = [158, 207, 168];
  var GREEN_TX = [32, 96, 58];
  var RED = [221, 51, 51];
  var SIGCOL = [26, 58, 107];
  var BADGE_BG = [228, 245, 230];
  var BADGE_TX = [30, 122, 60];
  var NOTE = [85, 85, 85];

  function val(id) {
    var el = document.getElementById(id);
    if (!el) return '';
    if (el.tagName === 'SELECT') {
      if (!el.value) return '';            // nothing chosen — not the placeholder text
      var o = el.options[el.selectedIndex];
      return o ? o.text.trim() : '';
    }
    return String(el.value || '').trim();
  }

  // Only meaningful for calculated <span>/<td> cells. A form control's
  // textContent is not its value — on a <select> it is every option's text
  // run together — so those return nothing and fall through to val().
  function txtOf(id) {
    var el = document.getElementById(id);
    if (!el) return '';
    if (el.tagName === 'SELECT' || el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') return '';
    return String(el.textContent || '').trim();
  }

  function dash(v) { return v === '' || v == null ? '\u2013N/A\u2013' : String(v); }

  // The worksheet already decides pass/fail and paints the cell. Read that
  // rather than recomputing the tolerance here, so the certificate can never
  // disagree with what is on screen.
  function stateOf(id) {
    var el = document.getElementById(id);
    if (!el) return null;
    if (el.classList.contains('bad')) return 'bad';
    if (el.classList.contains('ok')) return 'ok';
    return null;
  }

  var RED_BG = [255, 226, 226];
  var RED_BD = [214, 150, 150];
  var RED_TX = [140, 30, 30];
  function tintFor(state) {
    return state === 'bad' ? RED_BG : (state === 'ok' ? GREEN_BG : null);
  }

  // The built-in PDF fonts cover Latin-1 only; anything else (ticks, arrows)
  // comes out as a stray glyph. Drop it rather than print rubbish.
  // jsPDF's standard fonts use WinAnsi, which DOES include en/em dashes and
  // curly quotes but NOT ticks, snowflakes or arrows. Strip only what it
  // genuinely cannot draw — an earlier version of this took the em dash out of
  // "Adjustment not needed — Air and Load..." as collateral damage.
  var UNSUPPORTED = /[\u2713\u2714\u2716\u2717\u2718\u2744\u2190-\u21FF\u2600-\u27BF]/g;
  var KEEP = '\u2013\u2014\u2018\u2019\u201C\u201D\u2022\u20AC';
  // v1.569 (Radek): every date on a certificate reads DD/MON/YYYY, e.g.
  // 05/SEP/2026, and month-year dates MON/YYYY (DEC/2099). Worksheets saved
  // by an older version still hold "5/Sep/2026", and the checker's date box
  // is a date picker (2026-09-25), so the PDF puts every date into that one
  // form itself rather than trusting what each worksheet happened to store.
  var MON_UP = ['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'];
  var MON_RX = '(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)';
  function pdfDates(t) {
    return String(t)
      .replace(new RegExp('\\b(\\d{1,2})/' + MON_RX + '/(\\d{4})\\b', 'gi'), function (_, d, m, y) {
        return String(d).padStart(2, '0') + '/' + m.toUpperCase() + '/' + y;
      })
      .replace(new RegExp('\\b' + MON_RX + '/(\\d{4})\\b', 'gi'), function (_, m, y) {
        return m.toUpperCase() + '/' + y;
      });
  }
  // A date field's value as printed: "2026-09-25" -> "25/SEP/2026"; anything
  // else goes through pdfDates() when drawn.
  function dateField(v) {
    var s = String(v == null ? '' : v).trim();
    var m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    return m ? m[3] + '/' + MON_UP[Number(m[2]) - 1] + '/' + m[1] : s;
  }

  function ascii(v) {
    return pdfDates(String(v == null ? '' : v))
      .replace(/\u2026/g, '...')           // iPad smart punctuation; not in the base font
      .replace(UNSUPPORTED, '')
      .replace(new RegExp('[^\\x20-\\xFF' + KEEP + ']', 'g'), '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  // A room thermometer reads "UKAS107 (valid until Aug/2026)" on screen. The
  // validity is already shown in its own badge, so only the serial is needed.
  // Pull "Jan/2027" out of a cell that may also carry a validity badge.
  function monthYear(v) {
    var m = ascii(v).match(/([A-Za-z]{3}\/\d{4}|\d{4}-\d{2})/);
    return m ? m[1] : '';
  }

  // An all-zero certificate number is the verification code: the worksheets
  // themselves retitle to "Engineer Verification Worksheet" on "S 00000" and
  // "BARKEY VERIFICATION WORKSHEET" on "B 00000". The same test decides whether
  // a finished unit was calibrated or only verified, so the job summary says
  // which one rather than the catch-all "Certified".
  //
  // Read from the digits rather than matching the exact string, so a stray
  // space or a different prefix letter still reads correctly. No digits at all
  // is NOT a verification — an unnumbered unit counts as calibrated.
  function isVerificationRef(certRef) {
    var digits = String(certRef == null ? '' : certRef).replace(/\D/g, '');
    return digits.length > 0 && /^0+$/.test(digits);
  }

  function serialOnly(v) {
    return ascii(v).split(' (')[0].trim();
  }

  function mmss(mins, secs) {
    if (!mins && !secs) return '\u2014';
    var m = String(mins || '0'), sc = String(secs || '0');
    return m + ' min ' + (sc.length < 2 ? '0' + sc : sc) + ' sec';
  }

  // =====================================================================
  // Drawing helpers
  // =====================================================================
  function Engine(doc) {
    this.d = doc;
    this.y = MT;
  }

  Engine.prototype.font = function (size, style) {
    this.d.setFontSize(size);
    this.d.setFont('helvetica', style || 'normal');
    return this;
  };

  Engine.prototype.fill = function (rgb) { this.d.setFillColor(rgb[0], rgb[1], rgb[2]); return this; };
  Engine.prototype.stroke = function (rgb) { this.d.setDrawColor(rgb[0], rgb[1], rgb[2]); return this; };
  Engine.prototype.colour = function (rgb) { this.d.setTextColor(rgb[0], rgb[1], rgb[2]); return this; };

  // Text with the baseline placed from the TOP of the given line.
  Engine.prototype.t = function (s, x, y, size, style, rgb, align) {
    this.font(size, style).colour(rgb || INK);
    this.d.text(ascii(s), x, y, align ? { align: align } : undefined);
    return this;
  };

  Engine.prototype.w = function (s, size, style) {
    this.font(size, style);
    return this.d.getTextWidth(pdfDates(String(s)));
  };

  // Fit a free-text value into the width its column actually has.
  //
  // Site and department come off the job sheet and can be any length. "The
  // Clatterbridge Cancer Centre - Liverpool" is wider than its half-page
  // column, and a long ward/location wider still, so both used to run straight
  // through the label beside them, or off the right-hand edge of the page.
  //
  // Shrink the type first, down to `min` — the same approach pill() and
  // badge() already take, and it keeps the row at exactly the height and
  // position it has always had, so nothing below it moves. Only if the value
  // still will not fit at the smallest readable size is the tail trimmed, and
  // then it is marked with an ellipsis: a visibly shortened name, never a
  // silently clipped one. Returns { text, size }.
  Engine.prototype.fitText = function (s, avail, size, style, min) {
    var text = ascii(s), sz = size, floor = min || 6.2;
    while (sz > floor && this.w(text, sz, style) > avail) sz -= 0.1;
    if (!text || this.w(text, sz, style) <= avail) return { text: text, size: sz };
    var ell = '...';                    // the true ellipsis is not in the base font
    while (text.length > 1 && this.w(text + ell, sz, style) > avail) text = text.slice(0, -1);
    return { text: text.replace(/[\s,;:\-]+$/, '') + ell, size: sz };
  };

  Engine.prototype.box = function (x, y, w, h, fillRgb, strokeRgb, lw) {
    if (fillRgb) this.fill(fillRgb);
    if (strokeRgb) { this.stroke(strokeRgb); this.d.setLineWidth(lw || 0.25); }
    this.d.rect(x, y, w, h, fillRgb && strokeRgb ? 'FD' : (fillRgb ? 'F' : 'S'));
    return this;
  };

  Engine.prototype.rbox = function (x, y, w, h, r, fillRgb, strokeRgb, lw) {
    if (fillRgb) this.fill(fillRgb);
    if (strokeRgb) { this.stroke(strokeRgb); this.d.setLineWidth(lw || 0.2); }
    this.d.roundedRect(x, y, w, h, r, r, fillRgb && strokeRgb ? 'FD' : (fillRgb ? 'F' : 'S'));
    return this;
  };

  Engine.prototype.line = function (x1, y1, x2, y2, rgb, lw) {
    this.stroke(rgb || RULE); this.d.setLineWidth(lw || 0.25);
    this.d.line(x1, y1, x2, y2);
    return this;
  };

  Engine.prototype.star = function (x, y) {
    this.t('*', x, y, 5.5, 'bold', RED);
    return this;
  };

  // Label with its red required marker, returns where the value should start.
  Engine.prototype.label = function (text, x, y, size, required) {
    this.t(text, x, y, size);
    var w = this.w(text, size);
    if (required) {
      this.star(x + w + 0.5, y - 1.2);
      this.t(':', x + w + 2, y, size);
      return x + w + 4;
    }
    return x + w + 1.5;
  };

  Engine.prototype.badge = function (text, x, y, w, h) {
    h = h || 4.4;
    var label = ascii(text);
    var size = 6;
    while (size > 4.4 && this.w(label, size, 'bold') > w - 7) size -= 0.2;
    this.rbox(x, y, w, h, 1.2, BADGE_BG, GREEN_BD, 0.2);
    // a drawn tick, since the character is not in the standard font
    var tx = x + 2, ty = y + h / 2;
    this.stroke(BADGE_TX); this.d.setLineWidth(0.35);
    this.d.line(tx - 0.6, ty, tx + 0.1, ty + 0.8);
    this.d.line(tx + 0.1, ty + 0.8, tx + 1.3, ty - 0.9);
    this.t(label, x + 4.4 + (w - 6) / 2, y + h - 1.4, size, 'bold', BADGE_TX, 'center');
    return this;
  };

  Engine.prototype.pill = function (text, x, y, w, h, size) {
    h = h || 4.8;
    var label = ascii(text);
    var sz = size || 6.8;
    while (sz > 4.6 && this.w(label, sz) > w - 2.5) sz -= 0.2;
    this.rbox(x, y, w, h, 2.2, [255, 255, 255], RULE_D, 0.25);
    this.t(label, x + w / 2, y + h - 1.5, sz, 'normal', INK, 'center');
    return this;
  };

  Engine.prototype.chip = function (text, x, y, w, h) {
    h = h || 4.2;
    this.rbox(x, y, w, h, 1, GREY_BG, null);
    this.t(text, x + w / 2, y + h - 1.3, 6.8, 'normal', GREY_TXT, 'center');
    return this;
  };

  // =====================================================================
  // Shared page header
  // =====================================================================
  // Title and subtitle on the left, LABCOLD wordmark on the right with the
  // certificate number beneath it. Every worksheet uses this, so they cannot
  // drift apart.
  // Both worksheets retitle themselves as a VERIFICATION worksheet when the
  // sheet number is the all-zero code. The title lives in #titleText, so read
  // it rather than hard-coding "Calibration".
  function headingFor(fallbackTitle, fallbackSubtitle) {
    var live = ascii(txtOf('titleText'));
    if (!live) return { title: fallbackTitle, subtitle: fallbackSubtitle };
    if (/verification/i.test(live)) {
      return { title: 'Engineer Verification Worksheet', subtitle: fallbackSubtitle };
    }
    return { title: fallbackTitle, subtitle: fallbackSubtitle };
  }

  function drawHeader(e, doc, opts) {
    var y = MT;
    e.t(opts.title, MX, y + 5, 14, 'bold');
    e.t(opts.subtitle, MX, y + 9.6, 7.5, 'bold', [40, 70, 120]);

    e.t('LABCOLD', PW - MX, y + 6.5, 19, 'bold', INK, 'right');
    var markW = e.w('LABCOLD', 19, 'bold');
    (function snowflake(cx, cy, r) {
      e.stroke([91, 155, 213]); doc.setLineWidth(0.45);
      for (var i = 0; i < 3; i++) {
        var a = (Math.PI / 3) * i;
        doc.line(cx - Math.cos(a) * r, cy - Math.sin(a) * r, cx + Math.cos(a) * r, cy + Math.sin(a) * r);
      }
    })(PW - MX - markW - 5, y + 4.5, 2.6);

    var noX = PW - MX - 30;
    e.t('No', noX - 4, y + 12.5, 9, 'normal', INK, 'right');
    e.star(noX - 3.5, y + 11.3);
    e.t(':', noX - 1, y + 12.5, 9);
    e.t(opts.number || '', noX + 3, y + 12.5, 12.5, 'bold');
    e.line(noX + 1, y + 14, PW - MX, y + 14, INK, 0.4);
    return y + 18;
  }

  // A status line can be long ("...Load and Chart Recorder are not applicable
  // on this worksheet"), so wrap it and grow the box rather than letting it
  // run off the right-hand edge.
  function drawBanner(e, doc, y, text, bad, size) {
    size = size || 7.8;
    doc.setFont('helvetica', 'bold'); doc.setFontSize(size);
    var lines = doc.splitTextToSize(ascii(text), IN - 6);
    var h = Math.max(6, 2.2 + lines.length * 3.2);
    e.box(MX, y, IN, h, bad ? RED_BG : GREEN_BG, bad ? RED_BD : GREEN_BD, 0.2);
    lines.forEach(function (ln, i) {
      e.t(ln, MX + 3, y + 4 + i * 3.2, size, 'bold', bad ? RED_TX : GREEN_TX);
    });
    return y + h + 1.6;
  }

  // =====================================================================
  // Comments box, then signatures
  // =====================================================================
  // Comments sit above the signatures so they read as part of the record.
  // The box grows to fit; anything that will not fit continues on page 2.
  function drawCommentsAndSignatures(e, doc, y, haveScript, ctx) {
    var comments = val('comments');
    doc.setFont('helvetica', 'normal'); doc.setFontSize(8);
    // Worksheets that record an automatic configuration statement (currently
    // Non-Standard Medical Device) expose it in a hidden field. It is printed
    // above the engineer's own comments, kept visibly separate, and is never
    // mixed into the text the engineer typed. Sheets without the field are
    // unaffected.
    var config = val('configSummary');
    // Non-Standard Medical Device also records whether the controller could be
    // adjusted at all. Printed with the configuration, above and separate from
    // the engineer's own comments.
    var ctlNote = val('controllerNote');
    var configLines = config ? doc.splitTextToSize(config, IN - 6) : [];
    if (ctlNote) {
      if (configLines.length) configLines = configLines.concat(['']);
      configLines = configLines.concat(doc.splitTextToSize(ctlNote, IN - 6));
    }
    var boldCount = configLines.length;
    var bodyText = comments ? (configLines.length ? 'Engineer comments:\n' : '') + comments : '';
    var comLines = configLines
      .concat(configLines.length && bodyText ? [''] : [])
      .concat(bodyText ? doc.splitTextToSize(bodyText, IN - 6) : []);
    var HEAD_H = 5.0, LINE_H = 3.3, PAD_TOP = 2.6, PAD_BOT = 1.8, SIG_H = 9.1, MIN_COMH = 12;

    // Draws the Engineer's Name / Checker's Name signature rows starting at
    // yStart and returns the y position after both. Shared by the normal
    // page-1 layout and the "moved to page 2" safety branch below, so the
    // two rows are always drawn identically wherever they end up landing.
    function signatureRows(yStart) {
      var yy = yStart;
      [["Engineer's Name", val('engineer'), val('engineerSignature') || val('engineer'), dateField(val('engDate') || val('date')), true],
       ["Checker's Name:", val('checker'), val('checkerSignature'), dateField(val('checkDate')), false]
      ].forEach(function (r) {
        var top = yy;
        e.box(MX, top, IN, SIG_H, null, RULE_D, 0.25);
        var a = MX + IN * 0.36, b = MX + IN * 0.68;
        e.line(a, top, a, top + SIG_H, RULE_D, 0.25);
        e.line(b, top, b, top + SIG_H, RULE_D, 0.25);
        e.t(r[0], MX + 2, top + 3.4, 7.3);
        if (r[4]) {
          var lw = e.w(r[0], 7.3);
          e.star(MX + 2 + lw + 0.6, top + 2.2);
          e.t(':', MX + 2 + lw + 2.4, top + 3.4, 7.3);
        }
        if (r[1]) e.t(r[1], MX + 5, top + 7.6, 8.5, 'bold');
        e.t('Signature:', a + 2, top + 3.4, 7.3);
        if (r[2]) {
          if (haveScript) {
            doc.setFont('DancingScript', 'normal'); doc.setFontSize(13);
            doc.setTextColor(SIGCOL[0], SIGCOL[1], SIGCOL[2]);
            doc.text(ascii(r[2]), a + 5, top + 8);
            doc.setFont('helvetica', 'normal');
          } else {
            e.t(r[2], a + 5, top + 8, 11, 'italic', SIGCOL);
          }
        }
        e.t('Date:', b + 2, top + 3.4, 7.3);
        if (r[3]) e.t(r[3], b + 6, top + 7.6, 8.5, 'bold');
        yy = top + SIG_H;
      });
      return yy;
    }

    var availH = (PH - 8 - SIG_H * 2 - 2.5) - y;

    // Safety net: on a very full page there can be less room left than even
    // a completely empty Comments box needs (MIN_COMH) before the space
    // reserved for both signature rows. Drawing anyway would push the
    // signature boxes past the physical page edge, silently losing the
    // Checker's Name/Signature/Date row when printed \u2014 this is exactly what
    // happened on a full "adjustment required + adjustment made" IBB
    // certificate once the Controller Settings box grew to four offsets
    // (v1.537): only ~1.4mm was left, yet the code always drew a 12mm-tall
    // empty Comments box regardless. If even the smallest possible Comments
    // box does not fit, the whole Comments+signatures block now moves to a
    // fresh page 2 \u2014 the same continuation-page layout already used below
    // for a very long typed comment, just triggered earlier, before anything
    // gets drawn past the page edge.
    if (availH < MIN_COMH) {
      e.t('Comments and signatures \u2014 continued on page 2', MX, y + 4, 8, 'italic', NOTE);
      e.t('Page 1 of 2', PW - MX, y + 4, 6.2, 'normal', NOTE, 'right');
      doc.addPage();
      var yA = MT;
      e.t((ctx && ctx.subtitle ? 'Engineer Calibration Worksheet' : 'Worksheet') + ' \u2014 continuation', MX, yA + 5, 12, 'bold');
      e.t('No: ' + ((ctx && ctx.certNo) || ''), PW - MX, yA + 5, 11, 'bold', INK, 'right');
      e.t([val('site'), val('serial'), val('jobRef')].filter(Boolean).join('  \u00b7  '),
          PW - MX, yA + 9.2, 7, 'normal', NOTE, 'right');
      e.line(MX, yA + 11.5, PW - MX, yA + 11.5, RULE_D, 0.3);
      yA += 15;

      // Nothing printed on page 1, so the full comment text (if any) prints
      // here in one piece \u2014 page 2 has the whole page to work with.
      var comHA = Math.max(MIN_COMH, HEAD_H + PAD_TOP + comLines.length * LINE_H + PAD_BOT);
      e.box(MX, yA, IN, comHA, null, RULE_D, 0.25);
      e.box(MX + 0.2, yA + 0.2, IN - 0.4, HEAD_H, HDR_BG, null);
      e.t('Comments', MX + 2, yA + 4, 8.5, 'bold');
      e.t('(calculations, deviations, customer requests)', MX + 20, yA + 4, 7.3, 'normal', NOTE);
      comLines.forEach(function (ln, i) {
        e.t(ln, MX + 3, yA + HEAD_H + PAD_TOP + i * LINE_H, 8, i < boldCount ? 'bold' : 'normal');
      });
      yA += comHA + 2.5;

      yA = signatureRows(yA);
      e.t('Page 2 of 2', PW - MX, PH - 8, 6.2, 'normal', NOTE, 'right');
      return yA;
    }

    var maxLines = Math.max(0, Math.floor((availH - HEAD_H - PAD_TOP - PAD_BOT) / LINE_H));
    var overflow = comLines.length > maxLines ? comLines : [];
    var shown = overflow.length ? [] : comLines;
    var comH = overflow.length ? 7 : Math.max(MIN_COMH, HEAD_H + PAD_TOP + shown.length * LINE_H + PAD_BOT);

    e.box(MX, y, IN, comH, null, RULE_D, 0.25);
    e.box(MX + 0.2, y + 0.2, IN - 0.4, HEAD_H, HDR_BG, null);
    e.t('Comments', MX + 2, y + 4, 8.5, 'bold');
    if (overflow.length) e.t('\u2014 continued on page 2', MX + 22, y + 4, 7.3, 'italic', NOTE);
    else e.t('(calculations, deviations, customer requests)', MX + 20, y + 4, 7.3, 'normal', NOTE);
    shown.forEach(function (ln, i) {
      e.t(ln, MX + 3, y + HEAD_H + PAD_TOP + i * LINE_H, 8, i < boldCount ? 'bold' : 'normal');
    });
    y += comH + 2.5;

    y = signatureRows(y);

    if (overflow.length) {
      e.t('Page 1 of 2', PW - MX, y + 3.6, 6.2, 'normal', NOTE, 'right');
      doc.addPage();
      var y2 = MT;
      e.t((ctx && ctx.subtitle ? 'Engineer Calibration Worksheet' : 'Worksheet') + ' \u2014 continuation', MX, y2 + 5, 12, 'bold');
      e.t('No: ' + ((ctx && ctx.certNo) || ''), PW - MX, y2 + 5, 11, 'bold', INK, 'right');
      e.t([val('site'), val('serial'), val('jobRef')].filter(Boolean).join('  \u00b7  '),
          PW - MX, y2 + 9.2, 7, 'normal', NOTE, 'right');
      e.line(MX, y2 + 11.5, PW - MX, y2 + 11.5, RULE_D, 0.3);
      y2 += 15;
      var perPage = Math.floor((PH - 16 - y2 - HEAD_H - PAD_TOP - PAD_BOT) / LINE_H);
      var rest = overflow.slice(0, perPage);
      var boxH = HEAD_H + PAD_TOP + rest.length * LINE_H + PAD_BOT;
      e.box(MX, y2, IN, boxH, null, RULE_D, 0.25);
      e.box(MX + 0.2, y2 + 0.2, IN - 0.4, HEAD_H, HDR_BG, null);
      e.t('Comments (continued)', MX + 2, y2 + 4, 8.5, 'bold');
      rest.forEach(function (ln, i) { e.t(ln, MX + 3, y2 + HEAD_H + PAD_TOP + i * LINE_H, 8); });
      y2 += boxH;
      if (overflow.length > perPage) {
        e.t('\u2026 ' + (overflow.length - perPage) + ' further line(s) not shown \u2014 shorten the comments.',
            MX, y2 + 4, 6.5, 'italic', RED);
      }
      e.t('Page 2 of 2', PW - MX, PH - 8, 6.2, 'normal', NOTE, 'right');
    }
    return y;
  }

  // =====================================================================
  // Measurement table
  // =====================================================================
  // Shared by every worksheet. `groups` describes the column bands:
  //   [{title:'Air (T1)', span:2}, {title:'Load (T2)', span:2}]
  //   [{title:'Air', span:2}, {title:'Load', span:1}, {title:'Chart Recorder', span:1}]
  // A span of 2 gets the Left/Right sub-header with its coloured dots.
  function makeTable(e, doc, groups, labelW) {
    var cols = groups.reduce(function (n, g) { return n + g.span; }, 0);
    var COL = (IN - labelW) / cols;
    var bands = [];
    (function () { var at = 0; groups.forEach(function (g) { bands.push([at, g.span]); at += g.span; }); })();

    // inlineLR: no Left/Right sub-header row — the dots go in the probe cells
    // instead, which saves a full row per table.
    function header(title, y, inlineLR) {
      var hh = 5;
      e.box(MX, y, IN, hh, HDR_BG, RULE_D, 0.25);
      e.t(title, MX + 2, y + hh - 1.4, 7.5, 'bold');
      e.line(MX + labelW, y, MX + labelW, y + hh, RULE_D, 0.25);
      var x = MX + labelW;
      groups.forEach(function (g, gi) {
        if (gi) e.line(x, y, x, y + hh, RULE_D, 0.25);
        // A single-span column (e.g. IBB's Load / Chart Load, each half the
        // width of the two-channel Air / Chart Air groups) can be too narrow
        // for its own tolerance heading once that heading always shows the
        // full "(±0.300 °C)" text — it used to be shorter text sometimes
        // ("N/A", "No Display") before this sheet was locked to Standard.
        // Shrink the heading to fit its own column, same as fitText()
        // already does for long site/department names elsewhere, rather
        // than letting it bleed into the next column.
        var fit = e.fitText(g.title, g.span * COL - 2, 7.5, 'bold', 5.2);
        e.t(fit.text, x + g.span * COL / 2, y + hh - 1.4, fit.size, 'bold', INK, 'center');
        x += g.span * COL;
      });
      y += hh;
      if (inlineLR) return y;

      var sh = 4.6;
      e.box(MX, y, IN, sh, HDR_BG, RULE_D, 0.25);
      e.line(MX + labelW, y, MX + labelW, y + sh, RULE_D, 0.25);
      x = MX + labelW;
      groups.forEach(function (g, gi) {
        if (gi) e.line(x, y, x, y + sh, RULE_D, 0.18);
        if (g.span === 2) {
          ['Left', 'Right'].forEach(function (lab, i) {
            var cx = x + i * COL;
            if (i) e.line(cx, y, cx, y + sh, RULE_D, 0.18);
            var dot = i === 0 ? [47, 111, 208] : [217, 131, 36];
            e.fill(dot); doc.circle(cx + COL / 2 - 7, y + sh / 2, 1.6, 'F');
            e.t(i === 0 ? 'L' : 'R', cx + COL / 2 - 7, y + sh / 2 + 0.8, 5.5, 'bold', [255, 255, 255], 'center');
            e.t(lab, cx + COL / 2 - 4.6, y + sh - 1.4, 7);
          });
        }
        x += g.span * COL;
      });
      return y + sh;
    }

    function row(label, vals, y, opt) {
      opt = opt || {};
      var h = opt.h || 4.7;
      var top = y;
      var lines = Array.isArray(label) ? label : [label];
      e.box(MX, top, IN, h, [255, 255, 255], null);

      if (opt.tint || opt.tints) {
        if (opt.merged) {
          bands.forEach(function (b, bi) {
            var t = opt.tints ? opt.tints[bi] : opt.tint;
            if (t) e.box(MX + labelW + b[0] * COL + 0.2, top + 0.2, b[1] * COL - 0.4, h - 0.4, t, null);
          });
        } else {
          for (var i = 0; i < cols; i++) {
            var t = opt.tints ? opt.tints[i] : opt.tint;
            if (t) e.box(MX + labelW + i * COL + 0.2, top + 0.2, COL - 0.4, h - 0.4, t, null);
          }
        }
      }

      var lead = 2.2;
      var first = top + h / 2 - (lead * (lines.length - 1)) / 2 + 0.9;
      lines.forEach(function (ln, i) {
        e.t(ln, MX + 2, first + i * lead, lines.length > 1 ? 6 : 7,
            opt.bold ? 'bold' : 'normal', opt.grey ? GREY_TXT : INK);
      });
      if (opt.required) e.star(MX + 2 + e.w(lines[0], lines.length > 1 ? 6 : 7) + 0.6, first - 1.1);

      if (opt.merged) {
        bands.forEach(function (b, bi) {
          var cx = MX + labelW + b[0] * COL;
          e.t(dash(vals[bi]), cx + b[1] * COL / 2, top + h / 2 + 1.2, 8.5, 'bold',
              opt.grey ? GREY_TXT : INK, 'center');
        });
      } else {
        vals.forEach(function (v, i) {
          var cx = MX + labelW + i * COL;
          var greyThis = opt.grey || (opt.greyvals && opt.greyvals.indexOf(i) !== -1);
          if (opt.boxed) {
            var CH = 4.4, CW = COL - 10;
            var bxx = cx + (COL - CW) / 2, by = top + (h - CH) / 2;
            if (opt.inlineLR) {
              // which side of the pair this column is, shown as the same
              // coloured dot the worksheet uses
              var band = null, at = 0;
              groups.forEach(function (g) {
                if (i >= at && i < at + g.span) band = g;
                at += g.span;
              });
              if (band && band.span === 2) {
                var side = (i % 2 === 0) ? 'L' : 'R';
                var dotC = side === 'L' ? [47, 111, 208] : [217, 131, 36];
                e.fill(dotC); doc.circle(bxx - 3.4, top + h / 2, 1.5, 'F');
                e.t(side, bxx - 3.4, top + h / 2 + 0.8, 5.2, 'bold', [255, 255, 255], 'center');
                bxx += 1.4; CW -= 2.8;
                e.rbox(bxx, by, CW, CH, 0.8, greyThis ? GREY_BG : CHIP_BG, CHIP_BD, 0.2);
                e.t(String(v || '\u2014'), bxx + CW / 2, by + CH - 1.4, 7,
                    greyThis ? 'normal' : 'bold', greyThis ? GREY_TXT : INK, 'center');
                if (opt.strike && String(v || '').trim()) {
                  var tw2 = e.w(String(v || ''), 7);
                  e.line(bxx + CW / 2 - tw2 / 2 - 0.6, by + CH / 2 + 0.2,
                         bxx + CW / 2 + tw2 / 2 + 0.6, by + CH / 2 + 0.2, GREY_TXT, 0.2);
                }
                return;
              }
            }
            e.rbox(bxx, by, CW, CH, 0.8, greyThis ? GREY_BG : CHIP_BG, CHIP_BD, 0.2);
            e.t(String(v || '\u2014'), cx + COL / 2, by + CH - 1.4, 7.2,
                greyThis ? 'normal' : 'bold', greyThis ? GREY_TXT : INK, 'center');
            if (opt.strike && String(v || '').trim()) {
              var tw = e.w(String(v || ''), 7.2);
              e.line(cx + COL / 2 - tw / 2 - 0.6, by + CH / 2 + 0.2,
                     cx + COL / 2 + tw / 2 + 0.6, by + CH / 2 + 0.2, GREY_TXT, 0.2);
            }
          } else {
            e.t(dash(v), cx + COL / 2, top + h / 2 + 1.2, 8.5,
                opt.bold ? 'bold' : 'normal', greyThis ? GREY_TXT : INK, 'center');
          }
          if (opt.marks && opt.marks[i]) {
            var mk = opt.marks[i];
            var mkColour = (typeof mk === 'string' ? mk : mk.c) === 'blue' ? BLUE_MK : GREEN_MK;
            var mx1 = cx + 3, mx2 = cx + COL - 3;
            // A Chart Recorder mirroring both Air channels prints them in one
            // cell as "Left / Right". Underline only the channel that actually
            // won the highest-max / lowest-min selection, exactly as the Air
            // column does — underlining the whole cell would mark both.
            if (mk && typeof mk === 'object' && mk.part != null) {
              var full = String(dash(v)), sep = ' / ', at = full.indexOf(sep);
              if (at > -1) {
                var st = opt.bold ? 'bold' : 'normal';
                var fw = e.w(full, 8.5, st);
                var left = cx + COL / 2 - fw / 2;
                if (mk.part === 0) { mx1 = left; mx2 = left + e.w(full.slice(0, at), 8.5, st); }
                else { mx1 = left + e.w(full.slice(0, at + sep.length), 8.5, st); mx2 = left + fw; }
                mx1 -= 0.5; mx2 += 0.5;
              }
            }
            e.line(mx1, top + h - 1, mx2, top + h - 1, mkColour, 0.45);
          }
        });
      }

      e.line(MX, top + h, MX + IN, top + h, RULE, 0.18);
      var keep = { 0: true }; keep[cols] = true;
      if (opt.merged) bands.forEach(function (b) { keep[b[0]] = true; });
      else for (var g = 0; g <= cols; g++) keep[g] = true;
      Object.keys(keep).forEach(function (g) {
        e.line(MX + labelW + Number(g) * COL, top, MX + labelW + Number(g) * COL, top + h, RULE, 0.18);
      });
      e.line(MX, top, MX, top + h, RULE_D, 0.25);
      e.line(MX + IN, top, MX + IN, top + h, RULE_D, 0.25);
      return top + h;
    }

    return { header: header, row: row, cols: cols, colWidth: COL };
  }

  // v1.551: compact Display cycle table — one row for AF and one for AL, Air
  // and Load side by side (was four rows). Same values, same order of
  // precedence (displayed text, then field value); it only takes two rows so
  // the new timing band below still leaves Comments + signatures on page 1.
  // Returns the y below the table.
  function drawDisplayCycleCompact(e, y, airLabel, loadLabel, alNA) {
    var W = [18, 28, 28, 28, 28, 28, 28];
    var tot = W.reduce(function (a, b) { return a + b; }, 0);
    W = W.map(function (w) { return w * IN / tot; });
    var hh = 5;
    e.box(MX, y, IN, hh, HDR_BG, RULE_D, 0.25);
    var cx = MX;
    ['Display cycle', airLabel + ' Max', airLabel + ' Min', airLabel + ' Average',
     loadLabel + ' Max', loadLabel + ' Min', loadLabel + ' Average'].forEach(function (lab, i) {
      var f = e.fitText(lab, W[i] - 1.6, 7.3, 'bold', 5.6);
      e.t(f.text, cx + W[i] / 2, y + hh - 1.4, f.size, 'bold', INK, 'center');
      if (i) e.line(cx, y, cx, y + hh, RULE_D, 0.25);
      cx += W[i];
    });
    // a heavier rule between the Air and Load groups
    e.line(MX + W[0] + W[1] + W[2] + W[3], y, MX + W[0] + W[1] + W[2] + W[3], y + hh + 5.4 * 2, RULE_D, 0.3);
    y += hh;
    var rh = 5.4;
    [['AF', 'af', false], ['AL', 'al', !!alNA]].forEach(function (r) {
      var top = y, grey = r[2];
      e.box(MX + 0.2, top + 0.2, W[0] - 0.4, rh - 0.4, HDR_BG, null);
      e.t(r[0], MX + W[0] / 2, top + rh - 1.6, 7.5, 'bold', INK, 'center');
      var ids = [r[1] + '_cycle_air_max', r[1] + '_cycle_air_min', r[1] + '_cycle_air_avg',
                 r[1] + '_cycle_load_max', r[1] + '_cycle_load_min', r[1] + '_cycle_load_avg'];
      var cxx = MX + W[0];
      ids.forEach(function (id, i) {
        e.box(cxx + 0.2, top + 0.2, W[i + 1] - 0.4, rh - 0.4, grey ? GREY_BG : GREEN_BG, null);
        e.t(dash(txtOf(id) || val(id)), cxx + W[i + 1] / 2, top + rh - 1.6, 8.5, 'bold', grey ? GREY_TXT : INK, 'center');
        cxx += W[i + 1];
      });
      e.line(MX, top + rh, MX + IN, top + rh, RULE, 0.18);
      var gx = MX;
      W.forEach(function (w) { gx += w; e.line(gx, top, gx, top + rh, RULE, 0.18); });
      e.line(MX, top, MX, top + rh, RULE_D, 0.25);
      e.line(MX + IN, top, MX + IN, top + rh, RULE_D, 0.25);
      y = top + rh;
    });
    return y;
  }

  // =====================================================================
  // v1.551: shared AF/AL timing band — SMD, SNMD, NSMD, 19/24 and IBB
  // =====================================================================
  //  |    | Probes loaded at / Adjusted at | Cycle start | Stabilisation Time | Cycle end | Cycle time | AL Adjustment made |
  //  | AF | ...                                                                                      |                    |
  //  | AL | ... (N/A chips when As Left is not needed)                                               | note / chip        |
  // The worksheet is the authority: this prints the times and the calculated
  // Stabilisation / Cycle time exactly as the worksheet shows them (the
  // worksheet refuses to generate while any of them breaks the rules).
  // Returns the y below the band.
  function drawTimingBand(e, y, alNA) {
    var TW = [9, 38, 22, 25, 22, 22, 48];
    var ttot = TW.reduce(function (a, b) { return a + b; }, 0);
    TW = TW.map(function (w) { return w * IN / ttot; });
    var thh = 5;
    e.box(MX, y, IN, thh, HDR_BG, RULE_D, 0.25);
    var tcx = MX;
    ['', 'Probes loaded at / Adjusted at', 'Cycle start', 'Stabilisation Time', 'Cycle end', 'Cycle time', 'AL Adjustment made']
      .forEach(function (lab, i) {
        if (lab) {
          var f = e.fitText(lab, TW[i] - 1.6, 7.3, 'bold', 5.6);
          e.t(f.text, tcx + TW[i] / 2, y + thh - 1.4, f.size, 'bold', INK, 'center');
        }
        if (i) e.line(tcx, y, tcx, y + thh, RULE_D, 0.25);
        tcx += TW[i];
      });
    y += thh;
    var trh = 5.4;
    function hm(hId, mId, cx, top) {
      e.t(val(hId) || '—', cx - 5, top + trh - 1.4, 8.5, 'bold', INK, 'center');
      e.t(':', cx, top + trh - 1.4, 8, 'normal', INK, 'center');
      e.t(val(mId) || '—', cx + 5, top + trh - 1.4, 8.5, 'bold', INK, 'center');
    }
    [
      { row: 'AF', from: ['af_probes_in_h', 'af_probes_in_m'], start: ['af_cycle_start_h', 'af_cycle_start_m'],
        stab: 'af_stabilisation', end: ['af_cycle_end_h', 'af_cycle_end_m'], cyc: 'af_cycletime', na: false },
      { row: 'AL', from: ['al_adjusted_h', 'al_adjusted_m'], start: ['al_cycle_start_h', 'al_cycle_start_m'],
        stab: 'al_stabilisation', end: ['al_cycle_end_h', 'al_cycle_end_m'], cyc: 'al_cycletime', na: !!alNA }
    ].forEach(function (r, idx) {
      var top = y;
      var tint = r.na ? GREY_BG : GREEN_BG;
      e.box(MX + 0.2, top + 0.2, TW[0] - 0.4, trh - 0.4, HDR_BG, null);
      e.t(r.row, MX + TW[0] / 2, top + trh - 1.6, 7.5, 'bold', INK, 'center');
      var cxx = MX + TW[0];
      for (var i = 1; i <= 5; i++) {
        e.box(cxx + 0.2, top + 0.2, TW[i] - 0.4, trh - 0.4, tint, null);
        if (r.na) e.chip('N/A', cxx + 3, top + 0.6, TW[i] - 6);
        cxx += TW[i];
      }
      if (!r.na) {
        var x = MX + TW[0];
        hm(r.from[0], r.from[1], x + TW[1] / 2, top); x += TW[1];
        hm(r.start[0], r.start[1], x + TW[2] / 2, top); x += TW[2];
        e.t(dash(txtOf(r.stab) || val(r.stab)), x + TW[3] / 2, top + trh - 1.4, 8.5, 'bold', INK, 'center'); x += TW[3];
        hm(r.end[0], r.end[1], x + TW[4] / 2, top); x += TW[4];
        e.t(dash(txtOf(r.cyc) || val(r.cyc)), x + TW[5] / 2, top + trh - 1.4, 8.5, 'bold', INK, 'center');
      }
      var ax = MX + IN - TW[6];
      if (idx === 1) {
        var adj = val('al_adj_made') || (alNA ? 'Adjustment not needed' : 'Adjustment made');
        if (adj === '-N/A-') adj = alNA ? 'Adjustment not needed' : 'Adjustment made';
        var fa = e.fitText(adj, TW[6] - 4, 6.8, 'normal', 5);
        e.rbox(ax + 1, top + 0.6, TW[6] - 2, 4.2, 1, GREY_BG, null);
        e.t(fa.text, ax + TW[6] / 2, top + 0.6 + 4.2 - 1.3, fa.size, 'normal', alNA ? GREY_TXT : INK, 'center');
      }
      e.line(MX, top + trh, MX + IN, top + trh, RULE, 0.18);
      var gx = MX;
      TW.forEach(function (w) { gx += w; e.line(gx, top, gx, top + trh, RULE, 0.18); });
      e.line(MX, top, MX, top + trh, RULE_D, 0.25);
      e.line(MX + IN, top, MX + IN, top + trh, RULE_D, 0.25);
      y = top + trh;
    });
    return y;
  }

  // =====================================================================
  // Certificate — Standard 19 range / 24 range
  // =====================================================================
  function build19_24() {
    var jsPDFctor = (global.jspdf && global.jspdf.jsPDF) || global.jsPDF;
    if (!jsPDFctor) throw new Error('The PDF library did not load.');
    var doc = new jsPDFctor({ unit: 'mm', format: 'a4', orientation: 'portrait', compress: true });

    // signature font
    var haveScript = false;
    try {
      if (global.LabCalDancingFont) {
        doc.addFileToVFS('DancingScript.ttf', global.LabCalDancingFont);
        doc.addFont('DancingScript.ttf', 'DancingScript', 'normal');
        haveScript = true;
      }
    } catch (e) { haveScript = false; }

    var e = new Engine(doc);
    var y = MT;

    // ---------------- header ----------------
    var head1924 = headingFor('Engineer Calibration Worksheet', 'Standard 19 range/24 range');
    y = drawHeader(e, doc, {
      title: head1924.title,
      subtitle: head1924.subtitle,
      number: val('certNo') || txtOf('certNo')
    });

    // ---------------- meta ----------------
    var META = [
      ['Job Reference No', val('jobRef'), 'Date', dateField(val('date') || val('dateNative'))],
      ['Site', val('site'), 'Department', val('department')],
      ['Model', val('model'), 'Serial No', val('serial')],
      ['Manufacturer', val('manufacturer') === 'Other...' ? val('manufacturerOther') : val('manufacturer'),
        'Load', val('load')]
    ];
    var half = IN / 2;
    META.forEach(function (r, i) {
      var yy = y + i * 5.2;
      [[r[0], r[1], MX], [r[2], r[3], MX + half]].forEach(function (pair) {
        e.t(pair[0], pair[2], yy, 8);
        var w = e.w(pair[0], 8);
        e.star(pair[2] + w + 0.6, yy - 1.2);
        e.t(':', pair[2] + w + 2.4, yy, 8);
        var fv = e.fitText(pair[1], half - 34 - 6, 8.5, 'bold');
        e.t(fv.text, pair[2] + 34, yy, fv.size, 'bold');
        e.stroke(RULE_D); doc.setLineWidth(0.15);
        doc.setLineDashPattern([0.4, 0.6], 0);
        doc.line(pair[2] + 33, yy + 1.4, pair[2] + half - 6, yy + 1.4);
        doc.setLineDashPattern([], 0);
      });
    });
    y += META.length * 5.2 + 3;

    // ---------------- instrument + controller block ----------------
    // One bordered block: reference thermometer, room temperature, then the
    // two controller rows. Same shape as the Barkey sheet.
    var LAB_W = 40, ROW_H = 8, CT_ROW = 6.4;
    var blockTop = y, blockH = ROW_H * 2 + CT_ROW * 2;
    e.box(MX, blockTop, IN, blockH, null, RULE_D, 0.25);
    e.line(MX + LAB_W, blockTop, MX + LAB_W, blockTop + blockH, RULE_D, 0.25);
    e.line(MX, blockTop + ROW_H, MX + IN, blockTop + ROW_H, RULE_D, 0.18);
    e.line(MX, blockTop + ROW_H * 2, MX + IN, blockTop + ROW_H * 2, RULE_D, 0.18);
    e.line(MX + LAB_W, blockTop + ROW_H * 2 + CT_ROW, MX + IN, blockTop + ROW_H * 2 + CT_ROW, RULE_D, 0.18);

    // --- row 1: digital reference thermometer ---
    var r1 = blockTop + 5.2;
    e.t('Digital Reference Thermometer', MX + 2, r1, 6.8, 'bold');
    var dCols = [56, 34, IN - LAB_W - 90];
    var dxs = [], dacc = MX + LAB_W;
    dCols.forEach(function (w) { dxs.push([dacc, w]); dacc += w; });
    dxs.slice(1).forEach(function (c) { e.line(c[0], blockTop, c[0], blockTop + ROW_H, RULE_D, 0.18); });
    e.label('Serial no', dxs[0][0] + 2, r1, 7, true);
    e.pill(serialOnly(val('drtSerial')) || '\u2014', dxs[0][0] + 19, blockTop + 1.6, 34, 4.8, 7);
    var dVal = e.label('Cal due', dxs[1][0] + 2, r1, 7, false);
    e.t(txtOf('drtDue') || val('drtDue') || '\u2014', dVal + 1, r1, 8.5, 'bold');
    var drtStatus = ascii(txtOf('drtCalStatus'));
    if (drtStatus) e.badge(drtStatus, dxs[2][0] + 2, blockTop + 1.8, dxs[2][1] - 4, 4.4);

    // --- row 2: room temperature ---
    var rtTop = blockTop + ROW_H, r2 = rtTop + 5.2;
    e.t('Room Temperature (RT)', MX + 2, r2, 6.8, 'bold');
    var rtCols = [56, 29, 20, 20, IN - LAB_W - 125];
    var xs = [], acc = MX + LAB_W;
    rtCols.forEach(function (w) { xs.push([acc, w]); acc += w; });
    xs.slice(1).forEach(function (c) { e.line(c[0], rtTop, c[0], rtTop + ROW_H, RULE_D, 0.18); });
    e.label('RT Ref', xs[0][0] + 2, r2, 7, true);
    e.pill(serialOnly(val('rtRef')) || '\u2014', xs[0][0] + 13, rtTop + 1.6, 19, 4.8, 6.8);
    var rtv = ascii(txtOf('rtRefValidity'));
    if (rtv) e.badge(rtv, xs[0][0] + 34, rtTop + 1.8, xs[0][1] - 36, 4.4);
    [[xs[1], 'Cal due:', txtOf('rtDue') || val('rtDue') || monthYear(rtv), false],
     [xs[2], 'Max', val('rtMax'), true],
     [xs[3], 'Min', val('rtMin'), true],
     [xs[4], 'Average:', txtOf('rtAvg') || val('rtAvg'), false]
    ].forEach(function (col) {
      var vxx = e.label(col[1], col[0][0] + 2, r2, 7, col[3]);
      e.t(col[2] || '\u2014', vxx + 1, r2, 8.5, 'bold');
    });

    // --- rows 3 and 4: controller settings ---
    var ctTop = blockTop + ROW_H * 2;
    e.t('Controller Settings', MX + 2, ctTop + CT_ROW - 1.6, 6.8, 'bold');
    var ctSplit = MX + LAB_W + 66;
    e.line(ctSplit, ctTop, ctSplit, blockTop + blockH, RULE_D, 0.18);

    function ctLine(top, offLabel, v1, v2, spLabel, spVal, note, greyed) {
      var mid = top + CT_ROW - 2.2;
      var x = MX + LAB_W + 2;
      x = e.label(offLabel, x, mid, 6.8, true);
      [['Cal 1:', v1], ['Cal 2:', v2]].forEach(function (p, i) {
        var bx = x + i * 24;
        e.t(p[0], bx, mid, 6.8);
        if (greyed) e.chip(p[1], bx + 9, mid - 3.1, 12);
        else e.t(p[1] || '\u2014', bx + 10, mid, 7.8, 'bold');
      });
      var sx = e.label(spLabel, ctSplit + 2, mid, 6.8, true);
      if (greyed) e.chip(spVal, sx + 1, mid - 3.1, 14);
      else e.t(spVal || '\u2014', sx + 1, mid, 8.5, 'bold');
      // which offset point the corrections were taken from
      if (note) e.t('Nearest offset point used: ' + note, sx + 17, mid, 6.2, 'normal', [50, 90, 160]);
    }

    // The worksheet marks the As Left table 'notNeeded' when no adjustment is
    // required; that single flag drives the controller row, the banner and
    // whether the As Left table prints crossed out.
    var alNotNeededYet = (function () {
      var t = document.getElementById('alTable');
      if (t) return t.classList.contains('notNeeded');
      var ids = ['al_air_display', 'al_load_display', 'al_air1_max', 'al_load1_max'];
      return !ids.some(function (id) {
        var v = val(id);
        return v !== '' && v !== '-N/A-' && !isNaN(parseFloat(v));
      });
    })();
    var alDone = !alNotNeededYet;
    ctLine(ctTop, 'Initial offsets', val('initialOffsetsCal1'), val('initialOffsetsCal2'),
           'Initial set point', val('initialSetpoint'),
           (txtOf('initialNearestPoint') || '').replace('\u2014', ''), false);
    ctLine(ctTop + CT_ROW, 'Final offsets',
           alNotNeededYet ? 'N/A' : val('finalOffsetsCal1'),
           alNotNeededYet ? 'N/A' : val('finalOffsetsCal2'),
           'Final set point',
           alNotNeededYet ? '\u2013N/A\u2013' : val('finalSetpoint'),
           alNotNeededYet ? '' : (txtOf('finalNearestPoint') || '').replace('\u2014', ''),
           alNotNeededYet);
    y = blockTop + blockH + 2.5;

    // ---------------- status banner ----------------
    function banner(text, h, size, bad) { y = drawBanner(e, doc, y, text, bad, size); }
    var afStatus = txtOf('afStatus');
    var afBad = stateOf('afStatus') === 'bad';
    banner(afStatus || 'As Found: within tolerance.', 6, 7.8, afBad);

    // ---------------- measurement tables ----------------
    var T = makeTable(e, doc, [{ title: 'Air (T1)', span: 2 }, { title: 'Load (T2)', span: 2 }], 40);
    function tableHeader(title) { y = T.header(title, y, true); }   // L/R in the probe cells
    function trow(label, vals, opt) { y = T.row(label, vals, y, opt); }

    // which corrected max/min were used (the blue and green underlines)
    function markers(prefix, key) {
      // The worksheet tags the corrected values it actually used.
      var flagged = {};
      ['air1', 'air2', 'load1', 'load2'].forEach(function (col, i) {
        var el = document.getElementById(prefix + '_' + col + '_' + key + '_calc');
        if (!el) return;
        if (el.classList.contains('selectedHigh')) flagged[i] = 'blue';
        if (el.classList.contains('selectedLow')) flagged[i] = 'green';
      });
      if (Object.keys(flagged).length) return flagged;
      // fall back to working it out, for a sheet that has not been recalculated
      var ids = [prefix + '_air1_' + key + '_calc', prefix + '_air2_' + key + '_calc',
                 prefix + '_load1_' + key + '_calc', prefix + '_load2_' + key + '_calc'];
      var nums = ids.map(function (id) {
        var t = txtOf(id) || val(id);
        var n = parseFloat(t);
        return isNaN(n) ? null : n;
      });
      var live = nums.filter(function (n) { return n !== null; });
      if (!live.length) return null;
      var target = key === 'max' ? Math.max.apply(null, live) : Math.min.apply(null, live);
      var out = {};
      nums.forEach(function (n, i) {
        if (n !== null && Math.abs(n - target) < 1e-9) out[i] = key === 'max' ? 'blue' : 'green';
      });
      return out;
    }

    function cellset(prefix, key) {
      return [prefix + '_air1_' + key, prefix + '_air2_' + key,
              prefix + '_load1_' + key, prefix + '_load2_' + key].map(function (id) {
        return txtOf(id) || val(id);
      });
    }

    function measurementTable(prefix, title, greyed) {
      tableHeader(title);
      trow(prefix === 'af' ? 'Probe Serial No' : 'Probe Serial No (as As Found)',
           cellset(prefix, 'probe'),
           { boxed: true, inlineLR: true, required: prefix === 'af', h: 5.4,
             greyvals: greyed ? [0, 1, 2, 3] : [], strike: greyed });
      trow('Display (from product)',
           [txtOf(prefix + '_air_display') || val(prefix + '_air_display'),
            txtOf(prefix + '_load_display') || val(prefix + '_load_display')],
           { merged: true, tint: greyed ? GREY_BG : GREEN_BG, bold: true, required: true, grey: greyed });
      trow('Reference Max', cellset(prefix, 'max'),
           { tint: greyed ? GREY_BG : GREEN_BG, required: true, grey: greyed, greyvals: greyed ? [] : [2, 3] });
      trow('Probe Correction value', cellset(prefix, 'max_corr'),
           { tint: greyed ? GREY_BG : AMBER_BG, grey: greyed });
      trow('Max + Correction', cellset(prefix, 'max_calc'),
           { bold: true, grey: greyed, marks: greyed ? null : markers(prefix, 'max') });
      trow('Reference Min', cellset(prefix, 'min'),
           { tint: greyed ? GREY_BG : GREEN_BG, required: true, grey: greyed, greyvals: greyed ? [] : [2, 3] });
      trow('Probe Correction Value', cellset(prefix, 'min_corr'),
           { tint: greyed ? GREY_BG : AMBER_BG, grey: greyed });
      trow('Min + Correction', cellset(prefix, 'min_calc'),
           { bold: true, grey: greyed, marks: greyed ? null : markers(prefix, 'min') });
      trow(['Average ref: Min & Max', '(after correction)'],
           [txtOf(prefix + '_air_avg') || val(prefix + '_air_avg'),
            txtOf(prefix + '_load_avg') || val(prefix + '_load_avg')],
           { merged: true, bold: true, h: 6.2, tint: greyed ? GREY_BG : null, grey: greyed });
      trow(['Difference of Average', 'Reference vs Display'],
           [txtOf(prefix + '_air_diff') || val(prefix + '_air_diff'),
            txtOf(prefix + '_load_diff') || val(prefix + '_load_diff')],
           { merged: true, bold: true, h: 6.2, grey: greyed,
             tints: greyed ? [GREY_BG, GREY_BG]
                           : [tintFor(stateOf(prefix + '_air_diff')),
                              tintFor(stateOf(prefix + '_load_diff'))] });
    }

    measurementTable('af', 'As Found (AF)', false);
    y += 1.6;

    var adjNeeded = alDone;
    // The worksheet's own wording where it fits on a line, otherwise a
    // concise equivalent — it distinguishes "adjustment carried out" from
    // "As Found not yet complete", which a generic line would lose.
    var alScreen1924 = ascii(txtOf('alStatus'));
    var alShort1924 = adjNeeded
      ? 'Adjustment carried out \u2014 see the As Left readings below.'
      : 'Adjustment not needed \u2014 As Found within tolerance \u00b10.5 \u00b0C. As Left not applicable.';
    banner(alScreen1924 && alScreen1924.length <= 110 ? alScreen1924 : alShort1924,
           6, 7.6, stateOf('alStatus') === 'bad');

    measurementTable('al', 'As Left (AL)', !adjNeeded);
    y += 2;

    // ---------------- display cycle ----------------
    y = drawDisplayCycleCompact(e, y, 'Air (T1)', 'Load (T2)', !adjNeeded); // v1.551
    y += 1.5;
    y = drawTimingBand(e, y, !adjNeeded); // v1.551
    y += 2.5;

    // ---------------- comments, then signatures ----------------
    y = drawCommentsAndSignatures(e, doc, y, haveScript, {
      certNo: val('certNo') || txtOf('certNo'),
      subtitle: head1924.subtitle
    });

    if (y > PH - 6) {
      console.warn('LabCal vector PDF: content ran to ' + y.toFixed(1) + ' mm (page is ' + PH + ' mm).');
    }

    return doc;
  }

  // =====================================================================
  // Certificate — Standard Non-Medical Device
  // =====================================================================
  // Same furniture as the 19/24 sheet. The differences: the tolerance depends
  // on the device type, the columns are Air L/R, Load and Chart Recorder, and
  // Load and Chart Recorder can be marked not applicable for a given unit.
  // Standard Medical and Standard Non-Medical share a layout. The differences
  // are declared here rather than duplicated as two near-identical builders.
  var SHEET_SPECS = {
    snmd: {
      subtitle: function () {
        var tol = ascii(txtOf('deviceToleranceHint'));
        return 'Standard Non-Medical Device \u2014 ' + (val('deviceType') || 'Fridge') + (tol ? '  \u00b7  ' + tol : '');
      },
      tolerance: function () {
        var m = ascii(txtOf('deviceToleranceHint')).match(/[\u00b1][^\s]*\s*\u00b0C/);
        return m ? m[0] : '';
      },
      extraMeta: null,
      variations: true,
      dualOffsets: false
    },
    nsmd: {
      subtitle: function () {
        return 'Non-Standard Medical Device \u2014 ' + (val('deviceType') || '') + '  \u00b7  Tolerance: \u00b10.300 \u00b0C';
      },
      tolerance: function () { return '\u00b10.300 \u00b0C'; },
      extraMeta: function () { return ['Calibration System', val('calSystem')]; },
      variations: false,
      dualOffsets: true,
      offsetLabels: ['Air:', 'Load:']
    },
    // IBB / Blood Bank: same layout, tolerance and calculation engine as
    // Non-Standard Medical (it is built from that worksheet). The two extra
    // Chart Recorder controller offsets it records do not fit the Controller
    // Settings box's Cal 1/Cal 2 layout, so they are printed as a Comments
    // line by the worksheet itself (controllerNote) rather than drawn here \u2014
    // see chartOffsetsNoteText() in calibration_worksheet_IBB.html.
    ibb: {
      subtitle: function () {
        // Just "IBB" before the dash (not "IBB / Blood Bank Device") \u2014 one of
        // the three device-type options is itself named "Blood Bank", which
        // made the old wording read as "IBB / Blood Bank Device \u2014 Blood Bank".
        return 'IBB \u2014 ' + (val('deviceType') || '') + '  \u00b7  Tolerance: \u00b10.300 \u00b0C';
      },
      tolerance: function () { return '\u00b10.300 \u00b0C'; },
      extraMeta: function () { return ['Calibration System', val('calSystem')]; },
      variations: false,
      dualOffsets: true,
      offsetLabels: ['Air:', 'Load:']
    },
    smd: {
      subtitle: function () {
        return 'Standard Medical Device \u2014 ' + (val('deviceType') || '') + '  \u00b7  Tolerance: \u00b10.300 \u00b0C';
      },
      tolerance: function () { return '\u00b10.300 \u00b0C'; },
      extraMeta: function () { return ['Calibration System', val('calSystem')]; },
      variations: false,
      dualOffsets: true
    }
  };

  function buildSNMD(specKey) {
    var spec = SHEET_SPECS[specKey || 'snmd'];
    var jsPDFctor = (global.jspdf && global.jspdf.jsPDF) || global.jsPDF;
    if (!jsPDFctor) throw new Error('The PDF library did not load.');
    var doc = new jsPDFctor({ unit: 'mm', format: 'a4', orientation: 'portrait', compress: true });

    var haveScript = false;
    try {
      if (global.LabCalDancingFont) {
        doc.addFileToVFS('DancingScript.ttf', global.LabCalDancingFont);
        doc.addFont('DancingScript.ttf', 'DancingScript', 'normal');
        haveScript = true;
      }
    } catch (e) { haveScript = false; }

    var e = new Engine(doc);
    var head = headingFor('Engineer Calibration Worksheet', spec.subtitle());
    var y = drawHeader(e, doc, { title: head.title, subtitle: head.subtitle, number: val('certNo') });

    // ---------------- meta ----------------
    var META = [
      ['Job Reference No', val('jobRef'), 'Date', dateField(val('date') || val('dateNative'))],
      ['Site', val('site'), 'Department', val('department')],
      ['Model', val('model'), 'Serial No', val('serial')],
      ['Manufacturer', val('manufacturer') === 'Other...' ? val('manufacturerOther') : val('manufacturer'),
        'Load', val('load')]
    ];
    if (spec.extraMeta) {
      var extra = spec.extraMeta();
      META.push([extra[0], extra[1], '', '']);
    }
    var half = IN / 2;
    META.forEach(function (r, i) {
      var yy = y + i * 5.2;
      [[r[0], r[1], MX], [r[2], r[3], MX + half]].forEach(function (pair) {
        if (!pair[0]) return;
        e.t(pair[0], pair[2], yy, 8);
        var w = e.w(pair[0], 8);
        e.star(pair[2] + w + 0.6, yy - 1.2);
        e.t(':', pair[2] + w + 2.4, yy, 8);
        var fv = e.fitText(pair[1], half - 34 - 6, 8.5, 'bold');
        e.t(fv.text, pair[2] + 34, yy, fv.size, 'bold');
        e.stroke(RULE_D); doc.setLineWidth(0.15);
        doc.setLineDashPattern([0.4, 0.6], 0);
        doc.line(pair[2] + 33, yy + 1.4, pair[2] + half - 6, yy + 1.4);
        doc.setLineDashPattern([], 0);
      });
    });
    y += META.length * 5.2 - 0.5;

    var variation = spec.variations ? val('variationNote') : '';
    if (variation) {
      e.t('Non-Standard Variations', MX, y + 3, 8);
      var vw = e.w('Non-Standard Variations', 8);
      e.star(MX + vw + 0.6, y + 1.8);
      e.t(':', MX + vw + 2.4, y + 3, 8);
      e.t(variation, MX + 34, y + 3, 8.5, 'bold');
      y += 4.6;
    }
    y += 1;

    // ---------------- instrument + controller block ----------------
    var LAB_W = 40, ROW_H = 8, CT_ROW = 6.4;
    var blockTop = y, blockH = ROW_H * 2 + CT_ROW * 2;
    e.box(MX, blockTop, IN, blockH, null, RULE_D, 0.25);
    e.line(MX + LAB_W, blockTop, MX + LAB_W, blockTop + blockH, RULE_D, 0.25);
    e.line(MX, blockTop + ROW_H, MX + IN, blockTop + ROW_H, RULE_D, 0.18);
    e.line(MX, blockTop + ROW_H * 2, MX + IN, blockTop + ROW_H * 2, RULE_D, 0.18);
    e.line(MX + LAB_W, blockTop + ROW_H * 2 + CT_ROW, MX + IN, blockTop + ROW_H * 2 + CT_ROW, RULE_D, 0.18);

    var r1 = blockTop + 5.2;
    e.t('Digital Reference Thermometer', MX + 2, r1, 6.8, 'bold');
    var dCols = [56, 34, IN - LAB_W - 90];
    var dxs = [], dacc = MX + LAB_W;
    dCols.forEach(function (w) { dxs.push([dacc, w]); dacc += w; });
    dxs.slice(1).forEach(function (c) { e.line(c[0], blockTop, c[0], blockTop + ROW_H, RULE_D, 0.18); });
    e.label('Serial no', dxs[0][0] + 2, r1, 7, true);
    e.pill(serialOnly(val('drtSerial')) || '\u2014', dxs[0][0] + 19, blockTop + 1.6, 34, 4.8, 7);
    var dVal = e.label('Cal due', dxs[1][0] + 2, r1, 7, false);
    e.t(txtOf('drtDue') || val('drtDue') || '\u2014', dVal + 1, r1, 8.5, 'bold');
    var drtStatus = ascii(txtOf('drtCalStatus'));
    if (drtStatus) e.badge(drtStatus, dxs[2][0] + 2, blockTop + 1.8, dxs[2][1] - 4, 4.4);

    var rtTop = blockTop + ROW_H, r2 = rtTop + 5.2;
    e.t('Room Temperature (RT)', MX + 2, r2, 6.8, 'bold');
    var rtCols = [56, 29, 20, 20, IN - LAB_W - 125];
    var xs = [], acc = MX + LAB_W;
    rtCols.forEach(function (w) { xs.push([acc, w]); acc += w; });
    xs.slice(1).forEach(function (c) { e.line(c[0], rtTop, c[0], rtTop + ROW_H, RULE_D, 0.18); });
    e.label('RT Ref', xs[0][0] + 2, r2, 7, true);
    e.pill(serialOnly(val('rtRef')) || '\u2014', xs[0][0] + 13, rtTop + 1.6, 19, 4.8, 6.8);
    var rtv = ascii(txtOf('rtRefValidity'));
    if (rtv) e.badge(rtv, xs[0][0] + 34, rtTop + 1.8, xs[0][1] - 36, 4.4);
    [[xs[1], 'Cal due:', txtOf('rtDue') || val('rtDue') || monthYear(rtv), false],
     [xs[2], 'Max', val('rtMax'), true],
     [xs[3], 'Min', val('rtMin'), true],
     [xs[4], 'Average:', txtOf('rtAvg') || val('rtAvg'), false]
    ].forEach(function (col) {
      var vxx = e.label(col[1], col[0][0] + 2, r2, 7, col[3]);
      e.t(col[2] || '\u2014', vxx + 1, r2, 8.5, 'bold');
    });

    var ctTop = blockTop + ROW_H * 2;
    e.t('Controller Settings', MX + 2, ctTop + CT_ROW - 1.6, 6.8, 'bold');
    var ctSplit = MX + LAB_W + 66;
    e.line(ctSplit, ctTop, ctSplit, blockTop + blockH, RULE_D, 0.18);

    var alNotNeededYet = (function () {
      var t = document.getElementById('alTable');
      return t ? t.classList.contains('notNeeded') : true;
    })();

    // Non-Medical has one offsets field per row; Medical has Cal 1 and Cal 2.
    function ctLine(top, offLabel, offVal, spLabel, spVal, note, greyed) {
      var mid = top + CT_ROW - 2.2;
      var x = e.label(offLabel, MX + LAB_W + 2, mid, 6.8, true);
      if (spec.dualOffsets) {
        var offLabels = spec.offsetLabels || ['Cal 1:', 'Cal 2:'];
        [[offLabels[0], offVal[0]], [offLabels[1], offVal[1]]].forEach(function (pair, i) {
          var bx = x + i * 24;
          e.t(pair[0], bx, mid, 6.8);
          if (greyed) e.chip(pair[1], bx + 9, mid - 3.1, 12);
          else e.t(pair[1] || '\u2014', bx + 10, mid, 7.8, 'bold');
        });
      } else if (greyed) e.chip(offVal, x + 1, mid - 3.1, 16);
      else e.t(offVal || '\u2014', x + 1, mid, 7.8, 'bold');
      var sx = e.label(spLabel, ctSplit + 2, mid, 6.8, true);
      if (greyed) e.chip(spVal, sx + 1, mid - 3.1, 14);
      else e.t(spVal || '\u2014', sx + 1, mid, 8.5, 'bold');
      if (note) e.t('Nearest offset point used: ' + note, sx + 17, mid, 6.2, 'normal', [50, 90, 160]);
    }
    // Non-Standard Medical Device offers a Controller Offset Mode, because not
    // every manufacturer's controller has Labcold's Air/Load offsets. The
    // Controller Settings block follows whichever mode was chosen; sheets
    // without the selector (no #controllerMode element) are unaffected.
    var ctlModeEl = document.getElementById('controllerMode');
    var ctlMode = ctlModeEl ? ctlModeEl.value : 'standard';
    if (ctlMode === 'none') {
      // Never leave unexplained blank boxes: say plainly that the controller
      // could not be adjusted.
      var midA = ctTop + CT_ROW - 2.2;
      var xA = e.label('Controller adjustment', MX + LAB_W + 2, midA, 6.8, true);
      e.t('Not available', xA + 1, midA, 8.5, 'bold');
      var sxA = e.label('Initial set point', ctSplit + 2, midA, 6.8, true);
      e.t(val('initialSetpoint') || '\u2014', sxA + 1, midA, 8.5, 'bold');
      var noteA = (txtOf('initialNearestPoint') || '').replace('\u2014', '');
      if (noteA) e.t('Nearest offset point used: ' + noteA, sxA + 17, midA, 6.2, 'normal', [50, 90, 160]);
      var midB = ctTop + CT_ROW * 2 - 2.2;
      // Kept short so it cannot run past the vertical split into the set
      // point column; the full statement is in the Comments box.
      e.t('Controller parameters could not be adjusted.', MX + LAB_W + 2, midB, 6.8, 'normal', NOTE);
      var sxB = e.label('Final set point', ctSplit + 2, midB, 6.8, true);
      e.chip('\u2013N/A\u2013', sxB + 1, midB - 3.1, 14);
    } else if (ctlMode === 'custom') {
      // Show the parameters under the names this controller actually uses.
      var params = [];
      for (var pi = 1; pi <= 4; pi++) {
        var pn = val('ctlParam' + pi + 'Name'), pv = val('ctlParam' + pi + 'Init'), pf = val('ctlParam' + pi + 'Final');
        if (pn || pv || pf) params.push([pn || ('Parameter ' + pi), pv, pf]);
      }
      [['Initial settings', 1], ['Final settings', 2]].forEach(function (rowSpec, ri) {
        var mid = ctTop + CT_ROW * (ri + 1) - 2.2;
        var x = e.label(rowSpec[0], MX + LAB_W + 2, mid, 6.8, true);
        var txt = params.length
          ? params.map(function (pp) { return pp[0] + ': ' + (pp[ri + 1] || '\u2014'); }).join('   ')
          : '\u2014';
        // Custom parameter names are free text and can be long. Shrink to fit
        // the space before the vertical split rather than running across it,
        // and trim as a last resort — the full list is always written out in
        // the Comments box as well, so nothing is lost either way.
        var avail = (ctSplit - 2) - (x + 1);
        var fs = 7.0;
        while (fs > 4.8 && e.w(txt, fs, 'bold') > avail) fs -= 0.2;
        if (e.w(txt, fs, 'bold') > avail) {
          while (txt.length > 4 && e.w(txt + '\u2026', fs, 'bold') > avail) txt = txt.slice(0, -1);
          txt += '\u2026';
        }
        e.t(txt, x + 1, mid, fs, 'bold');
        var sx = e.label(ri === 0 ? 'Initial set point' : 'Final set point', ctSplit + 2, mid, 6.8, true);
        var spv = ri === 0 ? val('initialSetpoint') : (alNotNeededYet ? '\u2013N/A\u2013' : val('finalSetpoint'));
        if (ri === 1 && alNotNeededYet) e.chip(spv, sx + 1, mid - 3.1, 14);
        else e.t(spv || '\u2014', sx + 1, mid, 8.5, 'bold');
        var nt = ri === 0 ? (txtOf('initialNearestPoint') || '').replace('\u2014', '')
                          : (alNotNeededYet ? '' : (txtOf('finalNearestPoint') || '').replace('\u2014', ''));
        if (nt) e.t('Nearest offset point used: ' + nt, sx + 17, mid, 6.2, 'normal', [50, 90, 160]);
      });
    } else {
      var initOff = spec.dualOffsets ? [val('initialOffsetsCal1'), val('initialOffsetsCal2')] : val('initialOffsets');
      var finalOff = spec.dualOffsets
        ? (alNotNeededYet ? ['N/A', 'N/A'] : [val('finalOffsetsCal1'), val('finalOffsetsCal2')])
        : (alNotNeededYet ? 'N/A' : val('finalOffsets'));
      ctLine(ctTop, 'Initial offsets', initOff, 'Initial set point', val('initialSetpoint'),
             (txtOf('initialNearestPoint') || '').replace('\u2014', ''), false);
      ctLine(ctTop + CT_ROW, 'Final offsets', finalOff,
             'Final set point', alNotNeededYet ? '\u2013N/A\u2013' : val('finalSetpoint'),
             alNotNeededYet ? '' : (txtOf('finalNearestPoint') || '').replace('\u2014', ''), alNotNeededYet);
    }
    y = blockTop + blockH + 2.5;

    // ---------------- banners ----------------
    function banner(text, h, size, bad) { y = drawBanner(e, doc, y, text, bad, size); }
    banner(txtOf('afStatus') || 'As Found: readings recorded.', 6, 7.8, stateOf('afStatus') === 'bad');

    // ---------------- measurement tables ----------------
    // Non-Standard Medical carries per-unit Load/Chart Recorder tolerance —
    // print it right on the column header. document.getElementById returns
    // null on every other sheet, so this leaves Standard Medical/Non-Medical
    // untouched.
    var loadModeEl = document.getElementById('loadMode');
    var chartModeEl = document.getElementById('chartMode');
    var displayModeEl = document.getElementById('displayMode');
    // The worksheet decides each column's active tolerance in one place, and
    // prints it into the column heading. Read that heading back rather than
    // recomputing it here, so the tolerance on the certificate can never
    // disagree with the tolerance the calculation actually applied.
    function headingTol(id, fallback) {
      var el = document.getElementById(id);
      var t = el ? String(el.textContent || '').trim() : '';
      if (t.charAt(0) === '(' && t.charAt(t.length - 1) === ')') t = t.slice(1, -1).trim();
      return t || fallback;
    }
    var noDecimalDisplay = !!displayModeEl && displayModeEl.value === 'no-decimal';
    var airTitle = 'Air';
    if (displayModeEl) {
      airTitle = 'Air (' + headingTol('airTolAf', noDecimalDisplay ? '±1.000 °C' : '±0.300 °C') + ')';
    }
    var loadTitle = 'Load';
    if (loadModeEl) {
      var lm = loadModeEl.value;
      loadTitle = 'Load (' + headingTol('loadTolAf',
        lm === 'not-present' ? 'N/A' : lm === 'no-display' ? 'No Display' : '±0.300 °C') + ')';
    }
    var chartTitle = 'Chart Recorder';
    if (chartModeEl) {
      var cm = chartModeEl.value;
      chartTitle = 'Chart Recorder (' + headingTol('chartTolAf',
        cm === 'not-fitted' ? 'N/A' : '±0.300 °C') + ')';
    }
    var T = makeTable(e, doc, [{ title: airTitle, span: 2 },
                               { title: loadTitle, span: 1 },
                               { title: chartTitle, span: 1 }], 44);

    function cells(prefix, key) {
      return [prefix + '_air1_' + key, prefix + '_air2_' + key,
              prefix + '_load_' + key, prefix + '_chart_' + key].map(function (id) {
        return txtOf(id) || val(id);
      });
    }
    function marks(prefix, key) {
      var out = {};
      ['air1', 'air2', 'load', 'chart'].forEach(function (col, i) {
        var el = document.getElementById(prefix + '_' + col + '_' + key + '_calc');
        if (!el) return;
        if (el.classList.contains('selectedHigh')) out[i] = 'blue';
        if (el.classList.contains('selectedLow')) out[i] = 'green';
      });
      // A Chart Recorder mirroring both Air channels prints them in the one
      // Chart column as "Left / Right". The worksheet already marks whichever
      // mirrored channel won — using Air's own highest-max / lowest-min
      // selection — so pass that through as the half to underline instead of
      // marking the whole cell, which would underline both channels.
      var L = document.getElementById(prefix + '_chartL_' + key + '_calc');
      var R = document.getElementById(prefix + '_chartR_' + key + '_calc');
      if (out[3] && L && R && R.style.display !== 'none') {
        var mark = key === 'max' ? 'selectedHigh' : 'selectedLow';
        var onL = L.classList.contains(mark), onR = R.classList.contains(mark);
        if (onL !== onR) out[3] = { c: out[3], part: onL ? 0 : 1 };
      }
      return Object.keys(out).length ? out : null;
    }

    function table(prefix, title, greyed) {
      y = T.header(title, y, true);          // L/R shown in the probe cells
      var g = greyed;
      y = T.row(prefix === 'af' ? 'Probe Serial No' : 'Probe Serial No (as As Found)',
                cells(prefix, 'probe'), y,
                { boxed: true, inlineLR: true, required: prefix === 'af', h: 5.4,
                  greyvals: g ? [0, 1, 2, 3] : [], strike: g });
      y = T.row('Display (from product)',
                [txtOf(prefix + '_air_display') || val(prefix + '_air_display'),
                 txtOf(prefix + '_load_display') || val(prefix + '_load_display'),
                 txtOf(prefix + '_chart_display') || val(prefix + '_chart_display')], y,
                { merged: true, tint: g ? GREY_BG : GREEN_BG, bold: true, required: true, grey: g });
      y = T.row('Reference Max', cells(prefix, 'max'), y,
                { tint: g ? GREY_BG : GREEN_BG, required: true, grey: g });
      y = T.row('Probe Correction value', cells(prefix, 'max_corr'), y,
                { tint: g ? GREY_BG : AMBER_BG, grey: g });
      y = T.row('Max + Correction', cells(prefix, 'max_calc'), y,
                { bold: true, grey: g, marks: g ? null : marks(prefix, 'max') });
      y = T.row('Reference Min', cells(prefix, 'min'), y,
                { tint: g ? GREY_BG : GREEN_BG, required: true, grey: g });
      y = T.row('Probe Correction Value', cells(prefix, 'min_corr'), y,
                { tint: g ? GREY_BG : AMBER_BG, grey: g });
      y = T.row('Min + Correction', cells(prefix, 'min_calc'), y,
                { bold: true, grey: g, marks: g ? null : marks(prefix, 'min') });
      y = T.row(['Average ref: Min & Max', '(after correction)'],
                [txtOf(prefix + '_air_avg') || val(prefix + '_air_avg'),
                 txtOf(prefix + '_load_avg') || val(prefix + '_load_avg'),
                 txtOf(prefix + '_chart_avg') || val(prefix + '_chart_avg')], y,
                { merged: true, bold: true, h: 6.2, tint: g ? GREY_BG : null, grey: g });
      y = T.row(['Difference of Average', 'Reference vs Display'],
                [txtOf(prefix + '_air_diff') || val(prefix + '_air_diff'),
                 txtOf(prefix + '_load_diff') || val(prefix + '_load_diff'),
                 txtOf(prefix + '_chart_diff') || val(prefix + '_chart_diff')], y,
                { merged: true, bold: true, h: 6.2, grey: g,
                  tints: g ? [GREY_BG, GREY_BG, GREY_BG]
                           : [tintFor(stateOf(prefix + '_air_diff')),
                              tintFor(stateOf(prefix + '_load_diff')),
                              tintFor(stateOf(prefix + '_chart_diff'))] });
    }

    table('af', 'As Found (AF)', false);
    y += 1.6;
    // The on-screen wording is deliberately fuller; on paper a single line
    // reads better and buys a row of space.
    var tolTxt = spec.tolerance();
    var alScreen = ascii(txtOf('alStatus'));
    var alShort = alNotNeededYet
      ? ('Adjustment not needed \u2014 As Found within tolerance' + (tolTxt ? ' ' + tolTxt : '') + '. As Left not applicable.')
      : 'Adjustment carried out \u2014 see the As Left readings below.';
    banner(alScreen && alScreen.length <= 110 ? alScreen : alShort, 6, 7.6, stateOf('alStatus') === 'bad');
    table('al', 'As Left (AL)', alNotNeededYet);
    y += 2;

    // ---------------- display cycle ----------------
    y = drawDisplayCycleCompact(e, y, 'Air', 'Load', alNotNeededYet); // v1.551
    y += 1.5;
    y = drawTimingBand(e, y, alNotNeededYet); // v1.551
    y += 2.5;

    // ---------------- comments, then signatures ----------------
    y = drawCommentsAndSignatures(e, doc, y, haveScript, { certNo: val('certNo'), subtitle: head.subtitle });
    return doc;
  }

  // =====================================================================
  // Certificate — IBB / Blood Bank
  // =====================================================================
  // Shares the same page furniture, meta block, controller-settings box,
  // display-cycle table and comments/signature block as buildSNMD (copied
  // below rather than shared, so nothing here can ever affect the SMD/
  // NSMD/SNMD certificates). The one real difference is the measurement
  // table: this worksheet always shows six columns — Air, Chart Air, Load,
  // Chart Load — instead of buildSNMD's fixed four, so it needs its own
  // table-drawing logic; see the comment above the six-column section below.
  function buildIBB() {
    var spec = SHEET_SPECS.ibb;
    var jsPDFctor = (global.jspdf && global.jspdf.jsPDF) || global.jsPDF;
    if (!jsPDFctor) throw new Error('The PDF library did not load.');
    var doc = new jsPDFctor({ unit: 'mm', format: 'a4', orientation: 'portrait', compress: true });

    var haveScript = false;
    try {
      if (global.LabCalDancingFont) {
        doc.addFileToVFS('DancingScript.ttf', global.LabCalDancingFont);
        doc.addFont('DancingScript.ttf', 'DancingScript', 'normal');
        haveScript = true;
      }
    } catch (e) { haveScript = false; }

    var e = new Engine(doc);
    var head = headingFor('Engineer Calibration Worksheet', spec.subtitle());
    var y = drawHeader(e, doc, { title: head.title, subtitle: head.subtitle, number: val('certNo') });

    // ---------------- meta ----------------
    var META = [
      ['Job Reference No', val('jobRef'), 'Date', dateField(val('date') || val('dateNative'))],
      ['Site', val('site'), 'Department', val('department')],
      ['Model', val('model'), 'Serial No', val('serial')],
      ['Manufacturer', val('manufacturer') === 'Other...' ? val('manufacturerOther') : val('manufacturer'),
        'Load', val('load')]
    ];
    if (spec.extraMeta) {
      var extra = spec.extraMeta();
      META.push([extra[0], extra[1], '', '']);
    }
    var half = IN / 2;
    META.forEach(function (r, i) {
      var yy = y + i * 5.2;
      [[r[0], r[1], MX], [r[2], r[3], MX + half]].forEach(function (pair) {
        if (!pair[0]) return;
        e.t(pair[0], pair[2], yy, 8);
        var w = e.w(pair[0], 8);
        e.star(pair[2] + w + 0.6, yy - 1.2);
        e.t(':', pair[2] + w + 2.4, yy, 8);
        var fv = e.fitText(pair[1], half - 34 - 6, 8.5, 'bold');
        e.t(fv.text, pair[2] + 34, yy, fv.size, 'bold');
        e.stroke(RULE_D); doc.setLineWidth(0.15);
        doc.setLineDashPattern([0.4, 0.6], 0);
        doc.line(pair[2] + 33, yy + 1.4, pair[2] + half - 6, yy + 1.4);
        doc.setLineDashPattern([], 0);
      });
    });
    y += META.length * 5.2 - 0.5;

    var variation = spec.variations ? val('variationNote') : '';
    if (variation) {
      e.t('Non-Standard Variations', MX, y + 3, 8);
      var vw = e.w('Non-Standard Variations', 8);
      e.star(MX + vw + 0.6, y + 1.8);
      e.t(':', MX + vw + 2.4, y + 3, 8);
      e.t(variation, MX + 34, y + 3, 8.5, 'bold');
      y += 4.6;
    }
    y += 0.3;

    // ---------------- instrument + controller block ----------------
    // Controller Settings needs four rows, not two: this sheet has its own
    // Chart Air/Chart Load controller offsets (a separate physical chart
    // recorder, not shown anywhere else on the certificate) alongside the
    // usual Air/Load pair. buildIBB() has been its own independent function
    // since v1.532 (SMD/NSMD/SNMD render via buildSNMD() and never touch
    // this code), so widening this block is IBB-only and cannot affect any
    // other sheet's certificate.
    // CT_ROW was 6.4mm (v1.537); ROW_H was 8mm. Both trimmed in v1.539 to
    // claw back the vertical space the four-offset widening used up —
    // every row here still only ever carries one line of text (or a
    // pill/badge sized to fit it), so the trimmed heights still leave
    // comfortable clearance around the actual content; verified visually,
    // not just by arithmetic, against a rendered certificate.
    var LAB_W = 40, ROW_H = 7.2, CT_ROW = 5.0;
    var blockTop = y, blockH = ROW_H * 2 + CT_ROW * 4;
    e.box(MX, blockTop, IN, blockH, null, RULE_D, 0.25);
    e.line(MX + LAB_W, blockTop, MX + LAB_W, blockTop + blockH, RULE_D, 0.25);
    e.line(MX, blockTop + ROW_H, MX + IN, blockTop + ROW_H, RULE_D, 0.18);
    e.line(MX, blockTop + ROW_H * 2, MX + IN, blockTop + ROW_H * 2, RULE_D, 0.18);
    // v1.575: the line between Initial and Final is drawn by each Controller
    // Settings layout below (the standard layout is now a small table).
    var ctMidLine = function () {
      e.line(MX + LAB_W, blockTop + ROW_H * 2 + CT_ROW * 2, MX + IN, blockTop + ROW_H * 2 + CT_ROW * 2, RULE_D, 0.18);
    };

    var r1 = blockTop + 4.6;
    e.t('Digital Reference Thermometer', MX + 2, r1, 6.8, 'bold');
    var dCols = [56, 34, IN - LAB_W - 90];
    var dxs = [], dacc = MX + LAB_W;
    dCols.forEach(function (w) { dxs.push([dacc, w]); dacc += w; });
    dxs.slice(1).forEach(function (c) { e.line(c[0], blockTop, c[0], blockTop + ROW_H, RULE_D, 0.18); });
    e.label('Serial no', dxs[0][0] + 2, r1, 7, true);
    e.pill(serialOnly(val('drtSerial')) || '\u2014', dxs[0][0] + 19, blockTop + 1.6, 34, 4.8, 7);
    var dVal = e.label('Cal due', dxs[1][0] + 2, r1, 7, false);
    e.t(txtOf('drtDue') || val('drtDue') || '\u2014', dVal + 1, r1, 8.5, 'bold');
    var drtStatus = ascii(txtOf('drtCalStatus'));
    if (drtStatus) e.badge(drtStatus, dxs[2][0] + 2, blockTop + 1.8, dxs[2][1] - 4, 4.4);

    var rtTop = blockTop + ROW_H, r2 = rtTop + 4.6;
    e.t('Room Temperature (RT)', MX + 2, r2, 6.8, 'bold');
    var rtCols = [56, 29, 20, 20, IN - LAB_W - 125];
    var xs = [], acc = MX + LAB_W;
    rtCols.forEach(function (w) { xs.push([acc, w]); acc += w; });
    xs.slice(1).forEach(function (c) { e.line(c[0], rtTop, c[0], rtTop + ROW_H, RULE_D, 0.18); });
    e.label('RT Ref', xs[0][0] + 2, r2, 7, true);
    e.pill(serialOnly(val('rtRef')) || '\u2014', xs[0][0] + 13, rtTop + 1.6, 19, 4.8, 6.8);
    var rtv = ascii(txtOf('rtRefValidity'));
    if (rtv) e.badge(rtv, xs[0][0] + 34, rtTop + 1.8, xs[0][1] - 36, 4.4);
    [[xs[1], 'Cal due:', txtOf('rtDue') || val('rtDue') || monthYear(rtv), false],
     [xs[2], 'Max', val('rtMax'), true],
     [xs[3], 'Min', val('rtMin'), true],
     [xs[4], 'Average:', txtOf('rtAvg') || val('rtAvg'), false]
    ].forEach(function (col) {
      var vxx = e.label(col[1], col[0][0] + 2, r2, 7, col[3]);
      e.t(col[2] || '\u2014', vxx + 1, r2, 8.5, 'bold');
    });

    var ctTop = blockTop + ROW_H * 2;
    e.t('Controller Settings', MX + 2, ctTop + CT_ROW - 1.6, 6.8, 'bold');
    var ctSplit = MX + LAB_W + 66;
    e.line(ctSplit, ctTop, ctSplit, blockTop + blockH, RULE_D, 0.18);
    var ctlModeEl0 = document.getElementById('controllerMode');
    if (ctlModeEl0 && (ctlModeEl0.value === 'none' || ctlModeEl0.value === 'custom')) ctMidLine();

    var alNotNeededYet = (function () {
      var t = document.getElementById('alTable');
      return t ? t.classList.contains('notNeeded') : true;
    })();

    // Non-Medical has one offsets field per row; Medical has Cal 1 and Cal 2.
    function ctLine(top, offLabel, offVal, spLabel, spVal, note, greyed) {
      var mid = top + CT_ROW - 2.2;
      var x = e.label(offLabel, MX + LAB_W + 2, mid, 6.8, true);
      if (spec.dualOffsets) {
        var offLabels = spec.offsetLabels || ['Cal 1:', 'Cal 2:'];
        [[offLabels[0], offVal[0]], [offLabels[1], offVal[1]]].forEach(function (pair, i) {
          var bx = x + i * 24;
          e.t(pair[0], bx, mid, 6.8);
          if (greyed) e.chip(pair[1], bx + 9, mid - 3.1, 12);
          else e.t(pair[1] || '\u2014', bx + 10, mid, 7.8, 'bold');
        });
      } else if (greyed) e.chip(offVal, x + 1, mid - 3.1, 16);
      else e.t(offVal || '\u2014', x + 1, mid, 7.8, 'bold');
      var sx = e.label(spLabel, ctSplit + 2, mid, 6.8, true);
      if (greyed) e.chip(spVal, sx + 1, mid - 3.1, 14);
      else e.t(spVal || '\u2014', sx + 1, mid, 8.5, 'bold');
      if (note) e.t('Nearest offset point used: ' + note, sx + 17, mid, 6.2, 'normal', [50, 90, 160]);
    }
    // Non-Standard Medical Device offers a Controller Offset Mode, because not
    // every manufacturer's controller has Labcold's Air/Load offsets. The
    // Controller Settings block follows whichever mode was chosen; sheets
    // without the selector (no #controllerMode element) are unaffected.
    var ctlModeEl = document.getElementById('controllerMode');
    var ctlMode = ctlModeEl ? ctlModeEl.value : 'standard';
    if (ctlMode === 'none') {
      // Never leave unexplained blank boxes: say plainly that the controller
      // could not be adjusted.
      var midA = ctTop + CT_ROW - 2.2;
      var xA = e.label('Controller adjustment', MX + LAB_W + 2, midA, 6.8, true);
      e.t('Not available', xA + 1, midA, 8.5, 'bold');
      var sxA = e.label('Initial set point', ctSplit + 2, midA, 6.8, true);
      e.t(val('initialSetpoint') || '\u2014', sxA + 1, midA, 8.5, 'bold');
      var noteA = (txtOf('initialNearestPoint') || '').replace('\u2014', '');
      if (noteA) e.t('Nearest offset point used: ' + noteA, sxA + 17, midA, 6.2, 'normal', [50, 90, 160]);
      var midB = ctTop + CT_ROW * 2 - 2.2;
      // Kept short so it cannot run past the vertical split into the set
      // point column; the full statement is in the Comments box.
      e.t('Controller parameters could not be adjusted.', MX + LAB_W + 2, midB, 6.8, 'normal', NOTE);
      var sxB = e.label('Final set point', ctSplit + 2, midB, 6.8, true);
      e.chip('\u2013N/A\u2013', sxB + 1, midB - 3.1, 14);
    } else if (ctlMode === 'custom') {
      // Show the parameters under the names this controller actually uses.
      var params = [];
      for (var pi = 1; pi <= 4; pi++) {
        var pn = val('ctlParam' + pi + 'Name'), pv = val('ctlParam' + pi + 'Init'), pf = val('ctlParam' + pi + 'Final');
        if (pn || pv || pf) params.push([pn || ('Parameter ' + pi), pv, pf]);
      }
      [['Initial settings', 1], ['Final settings', 2]].forEach(function (rowSpec, ri) {
        var mid = ctTop + CT_ROW * (ri + 1) - 2.2;
        var x = e.label(rowSpec[0], MX + LAB_W + 2, mid, 6.8, true);
        var txt = params.length
          ? params.map(function (pp) { return pp[0] + ': ' + (pp[ri + 1] || '\u2014'); }).join('   ')
          : '\u2014';
        // Custom parameter names are free text and can be long. Shrink to fit
        // the space before the vertical split rather than running across it,
        // and trim as a last resort — the full list is always written out in
        // the Comments box as well, so nothing is lost either way.
        var avail = (ctSplit - 2) - (x + 1);
        var fs = 7.0;
        while (fs > 4.8 && e.w(txt, fs, 'bold') > avail) fs -= 0.2;
        if (e.w(txt, fs, 'bold') > avail) {
          while (txt.length > 4 && e.w(txt + '\u2026', fs, 'bold') > avail) txt = txt.slice(0, -1);
          txt += '\u2026';
        }
        e.t(txt, x + 1, mid, fs, 'bold');
        var sx = e.label(ri === 0 ? 'Initial set point' : 'Final set point', ctSplit + 2, mid, 6.8, true);
        var spv = ri === 0 ? val('initialSetpoint') : (alNotNeededYet ? '\u2013N/A\u2013' : val('finalSetpoint'));
        if (ri === 1 && alNotNeededYet) e.chip(spv, sx + 1, mid - 3.1, 14);
        else e.t(spv || '\u2014', sx + 1, mid, 8.5, 'bold');
        var nt = ri === 0 ? (txtOf('initialNearestPoint') || '').replace('\u2014', '')
                          : (alNotNeededYet ? '' : (txtOf('finalNearestPoint') || '').replace('\u2014', ''));
        if (nt) e.t('Nearest offset point used: ' + nt, sx + 17, mid, 6.2, 'normal', [50, 90, 160]);
      });
    } else {
      // v1.575 (Radek): the four controller offsets as a small table —
      //            Air   Chart Air   Load   Chart Load  |  Set point  Nearest offset point used
      //   Initial  -8.2    -9.8      -9.7     -9.8      |    4.0          5 °C
      //   Final    -9.7    -9.9      -9.9     -9.6      |    4.0          5 °C
      // Column order follows the measurement tables (Air, Chart Air, Load,
      // Chart Load). Cal 1 = Air, Cal 2 = Load, Cal 3 = Chart Air,
      // Cal 4 = Chart Load (worksheet field ids unchanged).
      var HEAD_H = 4.6, ROW2 = (CT_ROW * 4 - HEAD_H) / 2;
      var tx0 = MX + LAB_W, rowLabW = 22, colW = (ctSplit - tx0 - rowLabW) / 4;
      var headY = ctTop, row1Y = ctTop + HEAD_H, row2Y = row1Y + ROW2;
      e.box(tx0, headY, MX + IN - tx0, HEAD_H, GREY_BG, null);
      e.line(tx0, row1Y, MX + IN, row1Y, RULE_D, 0.18);
      e.line(tx0, row2Y, MX + IN, row2Y, RULE_D, 0.18);
      for (var ci = 0; ci <= 4; ci++) {
        var lx = tx0 + rowLabW + ci * colW;
        if (ci < 4) e.line(lx, headY, lx, blockTop + blockH, RULE_D, 0.12);
      }
      var colNames = ['Air', 'Chart Air', 'Load', 'Chart Load'];
      colNames.forEach(function (n, k) {
        e.t(n, tx0 + rowLabW + colW * k + colW / 2, headY + HEAD_H - 1.4, 6.4, 'bold', INK, 'center');
      });
      e.t('Set point', ctSplit + 2, headY + HEAD_H - 1.4, 6.4, 'bold');
      e.t('Nearest offset point used', ctSplit + 26, headY + HEAD_H - 1.4, 6.4, 'bold');
      var initRow = [val('initialOffsetsCal1'), val('initialOffsetsCal3'), val('initialOffsetsCal2'), val('initialOffsetsCal4')];
      var finalRow = [val('finalOffsetsCal1'), val('finalOffsetsCal3'), val('finalOffsetsCal2'), val('finalOffsetsCal4')];
      [[row1Y, 'Initial offsets', initRow, val('initialSetpoint'), (txtOf('initialNearestPoint') || '').replace('—', ''), false],
       [row2Y, 'Final offsets', finalRow, val('finalSetpoint'), (txtOf('finalNearestPoint') || '').replace('—', ''), alNotNeededYet]
      ].forEach(function (r) {
        var mid = r[0] + ROW2 / 2 + 1.2;
        e.label(r[1], tx0 + 2, mid, 6.6, true);
        r[2].forEach(function (v, k) {
          var cx = tx0 + rowLabW + colW * k;
          if (r[5]) e.chip('N/A', cx + 1.5, mid - 3.1, colW - 3);
          else e.t(v || '—', cx + colW / 2, mid, 8, 'bold', INK, 'center');
        });
        if (r[5]) e.chip('–N/A–', ctSplit + 2, mid - 3.1, 14);
        else {
          e.t(r[3] || '—', ctSplit + 2, mid, 8.5, 'bold');
          if (r[4]) e.t(r[4], ctSplit + 26, mid, 7, 'normal', [50, 90, 160]);
        }
      });
    }
    y = blockTop + blockH + 1.3;

    // ---------------- banners ----------------
    function banner(text, h, size, bad) { y = drawBanner(e, doc, y, text, bad, size); }
    banner(txtOf('afStatus') || 'As Found: readings recorded.', 6, 7.8, stateOf('afStatus') === 'bad');

    // ---------------- measurement tables ----------------
    // IBB / Blood Bank always carries two independent chart-recorder
    // columns in addition to Air and Load — Chart Air (mirroring Air's own
    // probes) and Chart Load (mirroring Load's) — so this sheet gets its own
    // six-column measurement table rather than reusing the shared four-column
    // one above. Nothing here is shared with buildSNMD(); SMD/NSMD/SNMD
    // certificates are entirely unaffected by this function.
    var loadModeEl = document.getElementById('loadMode');
    var displayModeEl = document.getElementById('displayMode');
    // The worksheet decides each column's active tolerance in one place, and
    // prints it into the column heading. Read that heading back rather than
    // recomputing it here, so the tolerance on the certificate can never
    // disagree with the tolerance the calculation actually applied.
    function headingTol(id, fallback) {
      var el = document.getElementById(id);
      var t = el ? String(el.textContent || '').trim() : '';
      if (t.charAt(0) === '(' && t.charAt(t.length - 1) === ')') t = t.slice(1, -1).trim();
      return t || fallback;
    }
    var noDecimalDisplay = !!displayModeEl && displayModeEl.value === 'no-decimal';
    var airTitle = 'Air (' + headingTol('airTolAf', noDecimalDisplay ? '±1.000 °C' : '±0.300 °C') + ')';
    // Chart Air is a separate physical instrument that is never absent on
    // this form (Air itself is never "not fitted"), so its tolerance is
    // always the plain fixed ±0.300 °C — never widened by Air's own
    // "No Decimal Point" mode.
    var chartAirTitle = 'Chart Air (' + headingTol('chartAirTolAf', '±0.300 °C') + ')';
    var lm = loadModeEl ? loadModeEl.value : 'standard';
    var loadTitle = 'Load (' + headingTol('loadTolAf',
      lm === 'not-present' ? 'N/A' : lm === 'no-display' ? 'No Display' : '±0.300 °C') + ')';
    // Chart Load mirrors Load, so it goes N/A exactly when Load itself does.
    var chartLoadTitle = 'Chart Load (' + headingTol('chartLoadTolAf',
      lm === 'not-present' ? 'N/A' : '±0.300 °C') + ')';
    var T = makeTable(e, doc, [{ title: airTitle, span: 2 },
                               { title: chartAirTitle, span: 2 },
                               { title: loadTitle, span: 1 },
                               { title: chartLoadTitle, span: 1 }], 44);

    function cells(prefix, key) {
      return [prefix + '_air1_' + key, prefix + '_air2_' + key,
              prefix + '_chartair1_' + key, prefix + '_chartair2_' + key,
              prefix + '_load_' + key, prefix + '_chartload_' + key].map(function (id) {
        return txtOf(id) || val(id);
      });
    }
    function marks(prefix, key) {
      // Chart Air/Chart Load each have their own real Max+Correction/
      // Min+Correction cells now (mirrorChartAir/mirrorChartLoad copy the
      // selectedHigh/selectedLow marks straight onto them), so — unlike the
      // old single combined Chart Recorder column — no special "which half
      // of a merged L/R cell won" handling is needed here at all.
      var out = {};
      ['air1', 'air2', 'chartair1', 'chartair2', 'load', 'chartload'].forEach(function (col, i) {
        var el = document.getElementById(prefix + '_' + col + '_' + key + '_calc');
        if (!el) return;
        if (el.classList.contains('selectedHigh')) out[i] = 'blue';
        if (el.classList.contains('selectedLow')) out[i] = 'green';
      });
      return Object.keys(out).length ? out : null;
    }

    function table(prefix, title, greyed) {
      y = T.header(title, y, true);          // L/R shown in the probe cells
      var g = greyed;
      y = T.row(prefix === 'af' ? 'Probe Serial No' : 'Probe Serial No (as As Found)',
                cells(prefix, 'probe'), y,
                { boxed: true, inlineLR: true, required: prefix === 'af', h: 5.4,
                  greyvals: g ? [0, 1, 2, 3, 4, 5] : [], strike: g });
      // Display cycle Max/Min: Chart Air and Chart Load each capture their
      // own Max/Min now (own capture, averaged into their own calculated
      // Display below), exactly like Air and Load already do.
      y = T.row('Display Max (from product)',
                [txtOf(prefix + '_cycle_air_max') || val(prefix + '_cycle_air_max'),
                 txtOf(prefix + '_cycle_chartair_max') || val(prefix + '_cycle_chartair_max'),
                 txtOf(prefix + '_cycle_load_max') || val(prefix + '_cycle_load_max'),
                 txtOf(prefix + '_cycle_chartload_max') || val(prefix + '_cycle_chartload_max')], y,
                { merged: true, tint: g ? GREY_BG : GREEN_BG, bold: true, required: true, grey: g });
      y = T.row('Display Min (from product)',
                [txtOf(prefix + '_cycle_air_min') || val(prefix + '_cycle_air_min'),
                 txtOf(prefix + '_cycle_chartair_min') || val(prefix + '_cycle_chartair_min'),
                 txtOf(prefix + '_cycle_load_min') || val(prefix + '_cycle_load_min'),
                 txtOf(prefix + '_cycle_chartload_min') || val(prefix + '_cycle_chartload_min')], y,
                { merged: true, tint: g ? GREY_BG : GREEN_BG, bold: true, required: true, grey: g });
      y = T.row('Display (from product)',
                [txtOf(prefix + '_air_display') || val(prefix + '_air_display'),
                 txtOf(prefix + '_chartair_display') || val(prefix + '_chartair_display'),
                 txtOf(prefix + '_load_display') || val(prefix + '_load_display'),
                 txtOf(prefix + '_chartload_display') || val(prefix + '_chartload_display')], y,
                { merged: true, tint: g ? GREY_BG : GREEN_BG, bold: true, required: true, grey: g });
      y = T.row('Reference Max', cells(prefix, 'max'), y,
                { tint: g ? GREY_BG : GREEN_BG, required: true, grey: g });
      y = T.row('Probe Correction value', cells(prefix, 'max_corr'), y,
                { tint: g ? GREY_BG : AMBER_BG, grey: g });
      y = T.row('Max + Correction', cells(prefix, 'max_calc'), y,
                { bold: true, grey: g, marks: g ? null : marks(prefix, 'max') });
      y = T.row('Reference Min', cells(prefix, 'min'), y,
                { tint: g ? GREY_BG : GREEN_BG, required: true, grey: g });
      y = T.row('Probe Correction Value', cells(prefix, 'min_corr'), y,
                { tint: g ? GREY_BG : AMBER_BG, grey: g });
      y = T.row('Min + Correction', cells(prefix, 'min_calc'), y,
                { bold: true, grey: g, marks: g ? null : marks(prefix, 'min') });
      y = T.row(['Average ref: Min & Max', '(after correction)'],
                [txtOf(prefix + '_air_avg') || val(prefix + '_air_avg'),
                 txtOf(prefix + '_chartair_avg') || val(prefix + '_chartair_avg'),
                 txtOf(prefix + '_load_avg') || val(prefix + '_load_avg'),
                 txtOf(prefix + '_chartload_avg') || val(prefix + '_chartload_avg')], y,
                { merged: true, bold: true, h: 6.2, tint: g ? GREY_BG : null, grey: g });
      y = T.row(['Difference of Average', 'Reference vs Display'],
                [txtOf(prefix + '_air_diff') || val(prefix + '_air_diff'),
                 txtOf(prefix + '_chartair_diff') || val(prefix + '_chartair_diff'),
                 txtOf(prefix + '_load_diff') || val(prefix + '_load_diff'),
                 txtOf(prefix + '_chartload_diff') || val(prefix + '_chartload_diff')], y,
                { merged: true, bold: true, h: 6.2, grey: g,
                  tints: g ? [GREY_BG, GREY_BG, GREY_BG, GREY_BG]
                           : [tintFor(stateOf(prefix + '_air_diff')),
                              tintFor(stateOf(prefix + '_chartair_diff')),
                              tintFor(stateOf(prefix + '_load_diff')),
                              tintFor(stateOf(prefix + '_chartload_diff'))] });
    }


    table('af', 'As Found (AF)', false);
    // v1.539: gaps here and after the AL table trimmed slightly (1.6→1.0,
    // 2→1.3) to help claw back the room the four-offset Controller Settings
    // box used up — table row heights themselves are untouched.
    y += 0.8;
    // The on-screen wording is deliberately fuller; on paper a single line
    // reads better and buys a row of space.
    var tolTxt = spec.tolerance();
    var alScreen = ascii(txtOf('alStatus'));
    var alShort = alNotNeededYet
      ? ('Adjustment not needed \u2014 As Found within tolerance' + (tolTxt ? ' ' + tolTxt : '') + '. As Left not applicable.')
      : 'Adjustment carried out \u2014 see the As Left readings below.';
    banner(alScreen && alScreen.length <= 110 ? alScreen : alShort, 6, 7.6, stateOf('alStatus') === 'bad');
    table('al', 'As Left (AL)', alNotNeededYet);
    y += 1.1;

    // ---------------- timing ----------------
    // v1.551: shared band (adds Cycle end / Cycle time) — see drawTimingBand().
    y = drawTimingBand(e, y, alNotNeededYet);
    y += 2.5;

    // ---------------- comments, then signatures ----------------
    y = drawCommentsAndSignatures(e, doc, y, haveScript, { certNo: val('certNo'), subtitle: head.subtitle });
    return doc;
  }


  // =====================================================================
  // Certificate — Barkey
  // =====================================================================
  // Same page furniture as the 19/24 sheet, but the Barkey worksheet is a
  // single column of readings with a specification and a pass/fail tick per
  // row, plus a stopwatch check.
  function buildBarkey() {
    var jsPDFctor = (global.jspdf && global.jspdf.jsPDF) || global.jsPDF;
    if (!jsPDFctor) throw new Error('The PDF library did not load.');
    var doc = new jsPDFctor({ unit: 'mm', format: 'a4', orientation: 'portrait', compress: true });

    var haveScript = false;
    try {
      if (global.LabCalDancingFont) {
        doc.addFileToVFS('DancingScript.ttf', global.LabCalDancingFont);
        doc.addFont('DancingScript.ttf', 'DancingScript', 'normal');
        haveScript = true;
      }
    } catch (e) { haveScript = false; }

    var e = new Engine(doc);
    var y = MT;

    // ---------------- header ----------------
    var headBk = headingFor('Engineer Calibration Worksheet', 'Barkey');
    y = drawHeader(e, doc, {
      title: headBk.title,
      subtitle: headBk.subtitle,
      number: val('sheetNo')
    });

    // ---------------- meta ----------------
    // Engineer appears in the signature block and the reference thermometer
    // has its own row below, so neither needs repeating here.
    var META = [
      ['Job reference', val('jobRef'), 'Date', dateField(val('date') || val('dateNative'))],
      ['Site', val('site'), 'Department', val('dept')],
      ['Model', val('model'), 'Serial number', val('serial')]
    ];
    var half = IN / 2;
    META.forEach(function (r, i) {
      var yy = y + i * 5.2;
      [[r[0], r[1], MX], [r[2], r[3], MX + half]].forEach(function (pair) {
        e.t(pair[0], pair[2], yy, 8);
        var w = e.w(pair[0], 8);
        e.star(pair[2] + w + 0.6, yy - 1.2);
        e.t(':', pair[2] + w + 2.4, yy, 8);
        var fv = e.fitText(pair[1], half - 38 - 6, 8.5, 'bold');
        e.t(fv.text, pair[2] + 38, yy, fv.size, 'bold');
        e.stroke(RULE_D); doc.setLineWidth(0.15);
        doc.setLineDashPattern([0.4, 0.6], 0);
        doc.line(pair[2] + 37, yy + 1.4, pair[2] + half - 6, yy + 1.4);
        doc.setLineDashPattern([], 0);
      });
    });
    y += META.length * 5.2 + 3;

    // ---------------- reference thermometer + room temperature ----------------
    // One bordered block, two labelled rows, the same shape as the room
    // temperature row on the 19/24 sheet.
    var LAB_W = 40, ROW_H = 8;
    var blockTop = y, blockH = ROW_H * 2;
    e.box(MX, blockTop, IN, blockH, null, RULE_D, 0.25);
    e.line(MX + LAB_W, blockTop, MX + LAB_W, blockTop + blockH, RULE_D, 0.25);
    e.line(MX, blockTop + ROW_H, MX + IN, blockTop + ROW_H, RULE_D, 0.18);

    // --- row 1: digital reference thermometer ---
    var r1 = blockTop + 5.2;
    e.t('Digital Reference Thermometer', MX + 2, r1, 6.8, 'bold');
    var dCols = [56, 34, IN - LAB_W - 90];
    var dxs = [], dacc = MX + LAB_W;
    dCols.forEach(function (w) { dxs.push([dacc, w]); dacc += w; });
    dxs.slice(1).forEach(function (c) { e.line(c[0], blockTop, c[0], blockTop + ROW_H, RULE_D, 0.18); });

    e.label('Serial no', dxs[0][0] + 2, r1, 7, true);
    e.pill(serialOnly(val('refTherm')) || '\u2014', dxs[0][0] + 19, blockTop + 1.6, 34, 4.8, 7);
    var dVal = e.label('Cal due', dxs[1][0] + 2, r1, 7, false);
    e.t(monthYear(txtOf('refThermCalDue')) || '\u2014', dVal + 1, r1, 8.5, 'bold');
    var drtBadge = ascii(txtOf('refThermCalDue'));
    if (/valid/i.test(drtBadge)) {
      e.badge(drtBadge.replace(/^[^A-Za-z]*/, ''), dxs[2][0] + 2, blockTop + 1.8, dxs[2][1] - 4, 4.4);
    }

    // --- row 2: room temperature ---
    var rtTop = blockTop + ROW_H, r2 = rtTop + 5.2;
    e.t('Room Temperature (RT)', MX + 2, r2, 6.8, 'bold');
    var rtCols = [56, 29, 20, 20, IN - LAB_W - 125];
    var xs = [], acc = MX + LAB_W;
    rtCols.forEach(function (w) { xs.push([acc, w]); acc += w; });
    xs.slice(1).forEach(function (c) { e.line(c[0], rtTop, c[0], rtTop + ROW_H, RULE_D, 0.18); });

    e.label('RT Ref', xs[0][0] + 2, r2, 7, true);
    e.pill(serialOnly(val('rtRef')) || '\u2014', xs[0][0] + 13, rtTop + 1.6, 19, 4.8, 6.8);
    var rtv = ascii(txtOf('rtRefValidity'));
    if (rtv) e.badge(rtv, xs[0][0] + 34, rtTop + 1.8, xs[0][1] - 36, 4.4);

    [[xs[1], 'Cal due:', monthYear(txtOf('rtRefValidity')), false],
     [xs[2], 'Max', val('rtMax'), true],
     [xs[3], 'Min', val('rtMin'), true],
     [xs[4], 'Average:', txtOf('rtAvg'), false]
    ].forEach(function (col) {
      var vxx = e.label(col[1], col[0][0] + 2, r2, 7, col[3]);
      e.t(col[2] || '\u2014', vxx + 1, r2, 8.5, 'bold');
    });
    y = blockTop + blockH + 2.5;

    // ---------------- measurement sections ----------------
    var LBL_W = 62, TICK_W = 9;
    var VAL_W = 34;
    var SPEC_W = IN - LBL_W - VAL_W - TICK_W;

    function sectionBar(text) {
      var h = 5.2;
      e.box(MX, y, IN, h, [51, 51, 51], null);
      e.t(text, PW / 2, y + h - 1.5, 8.2, 'bold', [255, 255, 255], 'center');
      y += h;
    }

    function readingRow(label, value, spec, tick, opt) {
      opt = opt || {};
      var h = opt.h || 5.6;
      var top = y;
      var tint = opt.greyed ? GREY_BG
               : (tick === 'pass' ? GREEN_BG : (tick === 'fail' ? [255, 222, 222] : null));
      if (tint) e.box(MX, top, IN, h, tint, null);
      var col = opt.greyed ? GREY_TXT : INK;
      var baseline = top + h / 2 + 1.1;
      var stem = String(label).replace(/:\s*$/, '');
      if (opt.required) {
        // "... heating *:" — marker between the text and the colon
        e.t(':', MX + LBL_W - 2, baseline, 7.6, opt.bold ? 'bold' : 'normal', col, 'right');
        e.star(MX + LBL_W - 4.6, baseline - 1.3);
        e.t(stem, MX + LBL_W - 5.2, baseline, 7.6, opt.bold ? 'bold' : 'normal', col, 'right');
      } else {
        e.t(label, MX + LBL_W - 2, baseline, 7.6, opt.bold ? 'bold' : 'normal', col, 'right');
      }
      e.t(dash(value), MX + LBL_W + VAL_W / 2, top + h / 2 + 1.2, 8.6,
          opt.bold || opt.calc ? 'bold' : 'normal', col, 'center');
      if (spec) e.t(spec, MX + LBL_W + VAL_W + 2, top + h / 2 + 1, 6.6, 'normal', opt.greyed ? GREY_TXT : NOTE);
      if (tick === 'pass' || tick === 'fail') {
        var tx = MX + LBL_W + VAL_W + SPEC_W + TICK_W / 2;
        var ty = top + h / 2;
        e.stroke(tick === 'pass' ? [30, 120, 60] : [190, 40, 40]); doc.setLineWidth(0.6);
        if (tick === 'pass') {
          doc.line(tx - 1.6, ty, tx - 0.4, ty + 1.4);
          doc.line(tx - 0.4, ty + 1.4, tx + 1.8, ty - 1.8);
        } else {
          doc.line(tx - 1.6, ty - 1.6, tx + 1.6, ty + 1.6);
          doc.line(tx - 1.6, ty + 1.6, tx + 1.6, ty - 1.6);
        }
      }
      e.line(MX, top + h, MX + IN, top + h, RULE, 0.18);
      [LBL_W, LBL_W + VAL_W, LBL_W + VAL_W + SPEC_W].forEach(function (o) {
        e.line(MX + o, top, MX + o, top + h, RULE, 0.18);
      });
      e.line(MX, top, MX, top + h, RULE_D, 0.25);
      e.line(MX + IN, top, MX + IN, top + h, RULE_D, 0.25);
      y = top + h;
    }

    function tickOf(id) {
      var el = document.getElementById(id);
      if (!el) return null;
      if (el.classList.contains('pass')) return 'pass';
      if (el.classList.contains('fail')) return 'fail';
      var t = (el.textContent || '').trim();
      if (t === '\u2713') return 'pass';
      if (t === '\u2717') return 'fail';
      // fall back to the row's own class, which is where the colour lives
      var row = el.closest ? el.closest('.row') : null;
      if (row) {
        if (row.classList.contains('pass')) return 'pass';
        if (row.classList.contains('fail')) return 'fail';
      }
      return null;
    }

    function section(prefix, title, greyed) {
      sectionBar(title);
      var o = { greyed: greyed };
      readingRow('Probe:', greyed ? 'N/A' : (val(prefix + '_probe') || '\u2014'), '', null,
                 { greyed: greyed, required: !greyed });
      readingRow('Reference temperature (\u00b0C):', greyed ? 'N/A' : val(prefix + '_ref'),
                 greyed ? '' : txtOf(prefix + '_nearest'), null, { greyed: greyed, required: !greyed });
      readingRow('Probe Correction value (\u00b0C):', greyed ? 'N/A' : txtOf(prefix + '_corr'),
                 'auto, 3 d.p.', null, { greyed: greyed, calc: true });
      readingRow('Reference + correction (\u00b0C):', greyed ? 'N/A' : txtOf(prefix + '_refcorr'),
                 greyed ? '' : txtOf(prefix + '_window'), greyed ? null : tickOf(prefix + '_tickRef'),
                 { greyed: greyed, bold: true });
      readingRow('Calibration temperature (\u00b0C):', greyed ? 'N/A' : val(prefix + '_cal'),
                 'Spec: Ref. + corr. \u00b1 0.50 \u00b0C', greyed ? null : tickOf(prefix + '_tickCal'),
                 { greyed: greyed, bold: true, required: !greyed });
      readingRow('Temperature display in the device, heating:', greyed ? 'N/A' : val(prefix + '_heat'),
                 'Spec: Ref. + corr. \u00b1 0.50 \u00b0C', greyed ? null : tickOf(prefix + '_tickHeat'),
                 { greyed: greyed, required: !greyed });
      readingRow('Temperature display in the device, inlet:', greyed ? 'N/A' : val(prefix + '_inlet'),
                 'Spec: Ref. + corr. \u00b1 0.50 \u00b0C', greyed ? null : tickOf(prefix + '_tickInlet'),
                 { greyed: greyed, required: !greyed });
      readingRow('SW inlet operating temperature:', greyed ? 'N/A' : val(prefix + '_sw'),
                 'Spec: Cal. temp + 1.00 \u00b1 0.50 \u00b0C', greyed ? null : tickOf(prefix + '_tickSw'),
                 { greyed: greyed, required: !greyed });
      readingRow('HW inlet overtemperature triggering:', greyed ? 'N/A' : val(prefix + '_hw'),
                 'Spec: 48.00 \u00b1 1.00 \u00b0C', greyed ? null : tickOf(prefix + '_tickHw'),
                 { greyed: greyed, required: !greyed });
    }

    // Did every As Found check pass? The worksheet colours each row, so read
    // the result from there rather than recomputing the tolerances here.
    function sectionResult(prefix) {
      var keys = ['tickCal', 'tickHeat', 'tickInlet', 'tickSw', 'tickHw'];
      var marks = keys.map(function (k) { return tickOf(prefix + '_' + k); });
      return {
        complete: marks.every(function (m) { return m !== null; }),
        anyFail: marks.some(function (m) { return m === 'fail'; }),
        allPass: marks.every(function (m) { return m === 'pass'; })
      };
    }

    function banner(text, good) { y = drawBanner(e, doc, y, text, !good); }

    var afResult = sectionResult('found');
    banner(afResult.allPass
      ? 'As Found: every check within specification.'
      : (afResult.anyFail
          ? 'As Found: one or more checks outside specification \u2014 adjustment required.'
          : 'As Found: readings recorded.'),
      !afResult.anyFail);

    section('found', 'Temperature Check \u2013 As found', false);
    y += 2;

    // As Left is locked off whenever no adjustment was required
    var leftSec = document.getElementById('leftSec');
    var leftOff = leftSec ? leftSec.classList.contains('leftOff') : true;
    banner(leftOff
      ? 'Adjustment not needed \u2014 all As Found checks were within specification, so the As Left section is not applicable.'
      : 'Adjustment carried out \u2014 see the As Left readings below.',
      leftOff);
    section('left', txtOf('leftBar') || 'Temperature Check \u2013 As left after adjustment', leftOff);
    y += 2.5;

    // ---------------- stopwatch ----------------
    sectionBar('Stopwatch Check');
    var swH = 9;
    e.box(MX, y, IN, swH, null, RULE_D, 0.25);
    var swCells = [
      ['Stopwatch serial no', serialOnly(val('swSerial')) || '\u2014'],
      ['Unit time', mmss(val('unitMin'), val('unitSec'))],
      ['Stopwatch time', mmss(val('swMin'), val('swSec'))]
    ];
    var sw = IN / swCells.length;
    swCells.forEach(function (c, i) {
      var x = MX + i * sw;
      if (i) e.line(x, y, x, y + swH, RULE_D, 0.18);
      e.t(c[0], x + 1.6, y + 3, 6.3, 'normal', NOTE);
      e.t(c[1], x + 1.6, y + 6.4, 8.2, 'bold');
    });
    y += swH + 2.5;

    // ---------------- comments, footer, signatures ----------------
    var comments = val('comments');
    doc.setFont('helvetica', 'normal'); doc.setFontSize(8);
    var comLines = comments ? doc.splitTextToSize(comments, IN - 6) : [];
    var HEAD_H = 5.0, LINE_H = 3.3, PAD_TOP = 2.6, PAD_BOT = 1.8, FOOT_H = 4.4, SIG_H = 9.1;
    var availH = (PH - 6 - FOOT_H - SIG_H * 2 - 2.5) - y;
    var maxLines = Math.max(0, Math.floor((availH - HEAD_H - PAD_TOP - PAD_BOT) / LINE_H));
    var overflow = comLines.length > maxLines ? comLines : [];
    var shown = overflow.length ? [] : comLines;
    var comH = overflow.length ? 7 : Math.max(12, HEAD_H + PAD_TOP + shown.length * LINE_H + PAD_BOT);

    e.box(MX, y, IN, comH, null, RULE_D, 0.25);
    e.box(MX + 0.2, y + 0.2, IN - 0.4, HEAD_H, HDR_BG, null);
    e.t('Comments', MX + 2, y + 4, 8.5, 'bold');
    if (overflow.length) e.t('\u2014 continued on page 2', MX + 22, y + 4, 7.3, 'italic', NOTE);
    else e.t('(calculations, deviations, customer requests)', MX + 20, y + 4, 7.3, 'normal', NOTE);
    shown.forEach(function (ln, i) {
      e.t(ln, MX + 3, y + HEAD_H + PAD_TOP + i * LINE_H, 8);
    });
    y += comH + 2.5;

    [['Engineer', val('eng'), val('engineerSignature') || val('eng'), dateField(val('engDate') || val('date')), true],
     ['Checked by', val('checker'), val('checkerSignature'), dateField(val('checkDate')), false]
    ].forEach(function (r) {
      var top = y;
      e.box(MX, top, IN, SIG_H, null, RULE_D, 0.25);
      var a = MX + IN * 0.36, b = MX + IN * 0.68;
      e.line(a, top, a, top + SIG_H, RULE_D, 0.25);
      e.line(b, top, b, top + SIG_H, RULE_D, 0.25);
      e.t(r[0], MX + 2, top + 3.4, 7.3);
      if (r[4]) {
        var lw = e.w(r[0], 7.3);
        e.star(MX + 2 + lw + 0.6, top + 2.2);
        e.t(':', MX + 2 + lw + 2.4, top + 3.4, 7.3);
      }
      if (r[1]) e.t(r[1], MX + 5, top + 7.6, 8.5, 'bold');
      e.t('Signature:', a + 2, top + 3.4, 7.3);
      if (r[2]) {
        if (haveScript) {
          doc.setFont('DancingScript', 'normal'); doc.setFontSize(13);
          doc.setTextColor(SIGCOL[0], SIGCOL[1], SIGCOL[2]);
          doc.text(ascii(r[2]), a + 5, top + 8);
          doc.setFont('helvetica', 'normal');
        } else {
          e.t(r[2], a + 5, top + 8, 11, 'italic', SIGCOL);
        }
      }
      e.t('Date:', b + 2, top + 3.4, 7.3);
      if (r[3]) e.t(r[3], b + 6, top + 7.6, 8.5, 'bold');
      y = top + SIG_H;
    });

    var stamp = new Date();
    function two(n) { return String(n).padStart(2, '0'); }
    var MONTHS = ['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'];
    var stampTxt = 'Generated ' + two(stamp.getDate()) + '/' + MONTHS[stamp.getMonth()] + '/' + stamp.getFullYear()
                 + ' ' + two(stamp.getHours()) + ':' + two(stamp.getMinutes());
    if (SHOW_GENERATED_STAMP) e.t(stampTxt, MX, y + 3.6, 6.2, 'normal', NOTE);
    if (overflow.length) e.t('Page 1 of 2', PW - MX, y + 3.6, 6.2, 'normal', NOTE, 'right');
    y += FOOT_H;

    if (overflow.length) {
      doc.addPage();
      var y2 = MT;
      e.t('Barkey Calibration Worksheet \u2014 continuation', MX, y2 + 5, 12, 'bold');
      e.t('No: ' + val('sheetNo'), PW - MX, y2 + 5, 11, 'bold', INK, 'right');
      e.t([val('site'), val('serial'), val('jobRef')].filter(Boolean).join('  \u00b7  '),
          PW - MX, y2 + 9.2, 7, 'normal', NOTE, 'right');
      e.line(MX, y2 + 11.5, PW - MX, y2 + 11.5, RULE_D, 0.3);
      y2 += 15;
      var perPage = Math.floor((PH - 16 - y2 - HEAD_H - PAD_TOP - PAD_BOT) / LINE_H);
      var rest = overflow.slice(0, perPage);
      var boxH = HEAD_H + PAD_TOP + rest.length * LINE_H + PAD_BOT;
      e.box(MX, y2, IN, boxH, null, RULE_D, 0.25);
      e.box(MX + 0.2, y2 + 0.2, IN - 0.4, HEAD_H, HDR_BG, null);
      e.t('Comments (continued)', MX + 2, y2 + 4, 8.5, 'bold');
      rest.forEach(function (ln, i) { e.t(ln, MX + 3, y2 + HEAD_H + PAD_TOP + i * LINE_H, 8); });
      y2 += boxH;
      if (overflow.length > perPage) {
        e.t('\u2026 ' + (overflow.length - perPage) + ' further line(s) not shown \u2014 shorten the comments.',
            MX, y2 + 4, 6.5, 'italic', RED);
      }
      if (SHOW_GENERATED_STAMP) e.t(stampTxt, MX, PH - 8, 6.2, 'normal', NOTE);
      e.t('Page 2 of 2', PW - MX, PH - 8, 6.2, 'normal', NOTE, 'right');
    }

    if (y > PH - 6) {
      console.warn('LabCal vector PDF (Barkey): content ran to ' + y.toFixed(1) + ' mm (page is ' + PH + ' mm).');
    }
    return doc;
  }

  // =====================================================================
  // Job summary
  // =====================================================================
  // An end-of-day sheet for the whole job: every unit, where it was, which
  // worksheet it took, what happened to it and its certificate number.
  // Takes the job straight from the worklist, so it cannot disagree with the
  // panel on screen.
  function buildJobSummary(job, progress) {
    var jsPDFctor = (global.jspdf && global.jspdf.jsPDF) || global.jsPDF;
    if (!jsPDFctor) throw new Error('The PDF library did not load.');
    if (!job || !job.devices || !job.devices.length) throw new Error('There are no units on this job yet.');
    // A row the jobsheet repeated is folded into its twin on the worklist, so
    // it must not appear as an extra line here either — the counts in the
    // header come from progress(), which already leaves it out.
    var summaryDevices = job.devices.filter(function (d) { return !d.duplicateMerged; });
    if (!summaryDevices.length) throw new Error('There are no units on this job yet.');
    var doc = new jsPDFctor({ unit: 'mm', format: 'a4', orientation: 'portrait', compress: true });
    var e = new Engine(doc);

    var SHEETS = (global.LabCalJobsheet && global.LabCalJobsheet.SHEETS) || {};
    var COLS = [8, 28, 32, 38, 24, 28, 28];
    var HEADS = ['#', 'Model', 'Serial number', 'Location', 'Worksheet', 'Status', 'Certificate'];
    var ROW_H = 5.4;

    function pageHead(first) {
      var y = MT;
      e.t(first ? 'Job Summary' : 'Job Summary (continued)', MX, y + 5, 14, 'bold');
      e.t([job.callNumber || '(no job reference)', job.customer || ''].filter(Boolean).join('  \u00b7  '),
          MX, y + 9.6, 8, 'bold', [40, 70, 120]);
      e.t('LABCOLD', PW - MX, y + 6.5, 15, 'bold', INK, 'right');
      var d = new Date();
      var MONTHS = ['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'];
      e.t(String(d.getDate()).padStart(2, '0') + '/' + MONTHS[d.getMonth()] + '/' + d.getFullYear(),
          PW - MX, y + 11, 8, 'normal', NOTE, 'right');
      y += 15;

      if (first) {
        var p = progress || {};
        // Counted off the same list the table draws from, so the tally can
        // never disagree with the rows underneath it.
        var doneUnits = summaryDevices.filter(function (d) { return d.done; });
        var verified = doneUnits.filter(function (d) { return isVerificationRef(d.certRef); }).length;
        var calibrated = doneUnits.length - verified;
        var bits = [p.total + ' unit' + (p.total === 1 ? '' : 's')];
        // Say only what happened: a job with no verifications should not carry
        // a "0 verified", and vice versa.
        if (calibrated || !verified) bits.push(calibrated + ' calibrated');
        if (verified) bits.push(verified + ' verified');
        bits.push((p.notRequired || 0) + ' not required');
        bits.push((p.outstanding || 0) + ' outstanding');
        e.box(MX, y, IN, 7, (p.outstanding ? [253, 243, 220] : GREEN_BG),
              (p.outstanding ? [227, 196, 150] : GREEN_BD), 0.2);
        e.t(bits.join('   \u00b7   '), MX + 3, y + 4.8, 8.5, 'bold',
            p.outstanding ? [122, 76, 6] : GREEN_TX);
        y += 9.5;
      }

      var hh = 5.6;
      e.box(MX, y, IN, hh, HDR_BG, RULE_D, 0.25);
      var x = MX;
      HEADS.forEach(function (h, i) {
        if (i) e.line(x, y, x, y + hh, RULE_D, 0.25);
        e.t(h, x + 1.8, y + hh - 1.7, 7.2, 'bold');
        x += COLS[i];
      });
      return y + hh;
    }

    // v1.549: Monitoring System has no certificate number. Its channel count
    // ("2 ch, 1 adj.") goes with the status; the Certificate column shows
    // the Worksheet No, or a dash. Units finished under 1.545-1.548 carry
    // "2 ch · in tol" in certRef — read those the same way.
    function monitoringParts(d) {
      var ref = d.certRef || '', det = d.detail || '';
      var L = /^(\d+) ch \u00b7 (?:in tol|(\d+) adj)$/;
      function conv(s) { var m = L.exec(s); return m ? m[1] + ' ch' + (m[2] ? ', ' + m[2] + ' adj.' : '') : s; }
      if (L.test(ref)) { if (!det) det = ref; ref = ''; }
      return { ref: ref, detail: conv(det) };
    }

    function statusOf(d) {
      if (d.done) {
        return { text: isVerificationRef(d.certRef) ? 'Verified' : 'Calibrated',
                 tint: GREEN_BG, col: GREEN_TX };
      }
      if (d.notRequired) return { text: 'Not required', tint: GREY_BG, col: GREY_TXT };
      if (global.LabCalJobsheet && global.LabCalJobsheet.isStarted &&
          global.LabCalJobsheet.isStarted(job.callNumber, d)) {
        return { text: 'Started', tint: [253, 243, 220], col: [122, 76, 6] };
      }
      return { text: 'To do', tint: null, col: INK };
    }

    // The summary lists units in the same order as the merged pack: certified
    // units by certificate number, then everything still outstanding.
    var ordered = summaryDevices.slice().sort(function (a, b) {
      var an = a.certRef ? (String(a.certRef).match(/(\d+)/) || [0, 0])[1] : null;
      var bn = b.certRef ? (String(b.certRef).match(/(\d+)/) || [0, 0])[1] : null;
      if (an !== null && bn !== null) return parseInt(an, 10) - parseInt(bn, 10);
      if (an !== null) return -1;
      if (bn !== null) return 1;
      return 0;                       // neither certified: leave as they came
    });

    var y = pageHead(true);
    ordered.forEach(function (d, i) {
      if (y + ROW_H > PH - 18) { doc.addPage(); y = pageHead(false); }
      var st = statusOf(d);
      if (st.tint) e.box(MX, y, IN, ROW_H, st.tint, null);
      var sheetName = d.sheet && SHEETS[d.sheet] ? SHEETS[d.sheet].name : '\u2014';
      var serial = d.serial || '\u2014';
      var mp = monitoringParts(d);
      var cells = [String(i + 1), d.model || d.equipment || '\u2014', serial,
                   d.location || '\u2014', sheetName,
                   st.text + (d.done && mp.detail ? ' \u00b7 ' + mp.detail : ''),
                   mp.ref || '\u2014'];
      var x = MX;
      cells.forEach(function (c, ci) {
        if (ci) e.line(x, y, x, y + ROW_H, RULE, 0.18);
        var size = 7.4;
        while (size > 5 && e.w(c, size) > COLS[ci] - 3) size -= 0.2;
        e.t(c, x + 1.8, y + ROW_H - 1.7, size,
            (ci === 5 || ci === 6) ? 'bold' : 'normal',
            (ci === 5) ? st.col : (d.notRequired && !d.done ? GREY_TXT : INK));
        x += COLS[ci];
      });
      e.line(MX, y + ROW_H, MX + IN, y + ROW_H, RULE, 0.18);
      e.line(MX, y, MX, y + ROW_H, RULE_D, 0.25);
      e.line(MX + IN, y, MX + IN, y + ROW_H, RULE_D, 0.25);
      // a corrected serial is worth showing alongside what the sheet said
      if (d.sheetSerial && serialDiffers(d.sheetSerial, d.serial)) {
        e.t('jobsheet read ' + d.sheetSerial, MX + COLS[0] + COLS[1] + 1.8, y + ROW_H + 2.6, 5.6, 'italic', NOTE);
        y += 3;
      }
      y += ROW_H;
    });

    y += 4;
    e.t('Not required units are shown for completeness and were not calibrated. '
      + 'Certificates are issued separately per unit.', MX, y, 6.6, 'normal', NOTE);

    var n = doc.getNumberOfPages();
    for (var pg = 1; pg <= n; pg++) {
      doc.setPage(pg);
      e.t('Page ' + pg + ' of ' + n, PW - MX, PH - 8, 6.2, 'normal', NOTE, 'right');
      e.t((job.callNumber || '') + (job.customer ? '  \u00b7  ' + job.customer : ''),
          MX, PH - 8, 6.2, 'normal', NOTE);
    }
    return doc;
  }

  // =====================================================================
  // Monitoring System (Cloud Temp) — v1.543
  // =====================================================================
  // A4 LANDSCAPE, like the image version it replaces: the channel table has
  // ten columns and does not fit a portrait page at a readable size.
  //
  // Everything is READ from the worksheet — values, the N/A state of each
  // As Left row and its out-of-tolerance flag are the worksheet's own
  // decisions (row classes .notNeeded / .outOfTolerance). Nothing here
  // recomputes a correction, a difference or a tolerance.
  //
  // Channels are never split across pages; later pages repeat the column
  // headings under a banner naming the site / job / serial, and every page
  // carries "Page x of y".
  function buildCloudTemp(opts) {
    opts = opts || {};
    var jsPDFctor = (global.jspdf && global.jspdf.jsPDF) || global.jsPDF;
    if (!jsPDFctor) throw new Error('The PDF library did not load.');
    var doc = new jsPDFctor({ unit: 'mm', format: 'a4', orientation: 'landscape', compress: true });

    var haveScript = false;
    try {
      if (global.LabCalDancingFont) {
        doc.addFileToVFS('DancingScript.ttf', global.LabCalDancingFont);
        doc.addFont('DancingScript.ttf', 'DancingScript', 'normal');
        haveScript = true;
      }
    } catch (err) { haveScript = false; }

    var e = new Engine(doc);
    var LW = 297, LH = 210, LM = 10, LIN = LW - LM * 2, BOTTOM = LH - 9;
    var BLUE_HDR = [26, 58, 107];
    var PHASE_BG = [238, 243, 250];

    function tol() {
      var t = Number(opts.tolerance);
      return isFinite(t) && t > 0 ? t.toFixed(1) : '';
    }

    // ---------------- page 1 header ----------------
    function drawTitle(y) {
      e.t('MONITORING SYSTEM CALIBRATION WORKSHEET', LM, y + 6, 15, 'bold');
      e.t('Monitoring system' + (tol() ? '  ·  Tolerance: ±' + tol() + ' °C (As Left required when the As Found difference is outside it)' : ''),
          LM, y + 10.6, 7.5, 'bold', [40, 70, 120]);
      e.t('LABCOLD', LW - LM, y + 6.5, 19, 'bold', [47, 111, 208], 'right');
      var markW = e.w('LABCOLD', 19, 'bold');
      (function snowflake(cx, cy, r) {
        e.stroke([26, 58, 107]); doc.setLineWidth(0.5);
        for (var i = 0; i < 3; i++) {
          var a = (Math.PI / 3) * i;
          doc.line(cx - Math.cos(a) * r, cy - Math.sin(a) * r, cx + Math.cos(a) * r, cy + Math.sin(a) * r);
        }
      })(LW - LM - markW - 4.5, y + 4.4, 2.6);
      e.t('medical & scientific refrigeration', LW - LM, y + 9.6, 6, 'bold', NOTE, 'right');
      var wsX = LW - LM - 32;
      e.t('Worksheet No', wsX - 16, y + 15.5, 7.5, 'normal', INK, 'right');
      e.t('(for lab use):', wsX - 1, y + 15.5, 6.3, 'normal', NOTE, 'right');
      var ws = e.fitText(val('worksheetNo'), 30, 8.5, 'bold');
      if (ws.text) e.t(ws.text, wsX + 16, y + 15.2, ws.size, 'bold', INK, 'center');
      e.line(wsX, y + 16.4, LW - LM, y + 16.4, INK, 0.3);
      return y + 20;
    }

    // one "Label*: value" field with a dotted rule; value shrinks to fit
    function field(label, value, x, w, y, required, labelW) {
      var lx = e.label(label, x, y, 7.6, required);
      var vx = labelW ? Math.max(lx, x + labelW) : lx;
      var avail = x + w - vx - 3;
      var fv = e.fitText(value, avail, 8.6, 'bold', 6);
      if (fv.text) e.t(fv.text, vx + 1, y - 0.3, fv.size, 'bold');
      e.stroke(RULE_D); doc.setLineWidth(0.15);
      doc.setLineDashPattern([0.4, 0.6], 0);
      doc.line(vx, y + 1.2, x + w - 3, y + 1.2);
      doc.setLineDashPattern([], 0);
    }

    function badgeFrom(id, x, y, w) {
      var raw = txtOf(id);
      if (!raw) return;
      var el = document.getElementById(id);
      var expired = el && el.classList.contains('expired');
      var text = ascii(raw).replace(/^[^A-Za-z0-9]*/, '');
      if (expired) {
        e.rbox(x, y, w, 4.6, 1.2, RED_BG, RED_BD, 0.2);
        e.t(text, x + w / 2, y + 3.3, 6, 'bold', RED_TX, 'center');
      } else {
        e.badge(text, x, y, w, 4.6);
      }
    }

    function drawFields(y) {
      var c = [LM, LM + 70, LM + 140, LM + 225];
      var date = dateField(val('date') || val('dateNative'));
      field('Job Reference No', val('jobRef'), c[0], 70, y, true);
      field('Date', date, c[1], 70, y, true);
      field('Site', val('site'), c[2], 81, y, true);
      // Sheet x of y
      e.t('Sheet', c[3], y, 7.6);
      e.t(val('sheetNo') || '', c[3] + 22, y - 0.3, 8.6, 'bold', INK, 'center');
      e.line(c[3] + 14, y + 1.2, c[3] + 30, y + 1.2, RULE_D, 0.15);
      e.t('of', c[3] + 33, y, 7.6);
      e.t(val('sheetOf') || '', c[3] + 44, y - 0.3, 8.6, 'bold', INK, 'center');
      e.line(c[3] + 37, y + 1.2, LW - LM, y + 1.2, RULE_D, 0.15);

      y += 6.4;
      field('Department', val('department'), c[0], 70, y, true);
      field('System Model', val('model'), c[1], 70, y, true);
      field('System Serial No', val('serial'), c[2], LW - LM - c[2], y, true);

      y += 6.4;
      field('Digital Reference Thermometer Serial No', val('drtSerial'), c[0], LIN - 42, y, true);
      badgeFrom('drtValidity', LW - LM - 38, y - 3.5, 38);

      y += 6.4;
      field('Room Temp Max', val('rtMax'), c[0], 55, y, true);
      field('Min', val('rtMin'), c[0] + 55, 45, y, true);
      field('Average', val('rtAvg'), c[0] + 100, 38, y, false);
      field('Ref UKAS', val('refUkas'), c[0] + 138, LIN - 138 - 42, y, false);
      badgeFrom('refUkasValidity', LW - LM - 38, y - 3.5, 38);
      return y + 4.5;
    }

    // ---------------- continuation banner (pages 2+) ----------------
    function drawContinuation(y) {
      var parts = [];
      if (val('site')) parts.push(val('site'));
      if (val('jobRef')) parts.push('Job ' + val('jobRef'));
      if (val('worksheetNo')) parts.push('WS ' + val('worksheetNo'));
      if (val('serial')) parts.push('S/N ' + val('serial'));
      e.t('Monitoring System Calibration Worksheet — continued', LM, y + 4.5, 9.5, 'bold', BLUE_HDR);
      var fv = e.fitText(parts.join('  —  '), LIN - 110, 8, 'bold', 6);
      e.t(fv.text, LW - LM, y + 4.5, fv.size, 'bold', BLUE_HDR, 'right');
      e.line(LM, y + 6.6, LW - LM, y + 6.6, BLUE_HDR, 0.45);
      return y + 10;
    }

    // ---------------- table ----------------
    var COLS = [
      { key: 'pt',   w: 24, head: ['Point No'] },
      { key: 'desc', w: 70, head: ['Point Description', '(incl. monitoring system probe ref)'] },
      { key: 'display', w: 19, head: ['Monitor', 'Display (°C)'] },
      { key: 'ref',  w: 19, head: ['Reference', 'Temp (°C)'] },
      { key: 'corr', w: 21, head: ['Probe', 'Correction', '(°C)'] },
      { key: 'refcorr', w: 21, head: ['Reference +', 'Correction', '(°C)'] },
      { key: 'diff', w: 21, head: ['Difference', 'Ref. vs', 'Display (°C)'] },
      { key: 'offset', w: 19, head: ['Monitor', 'Offset (°C)'] },
      { key: 'probe', w: 29, head: ['Ref. Probe Serial No'] },
      { key: 'phase', w: 34, head: [''] }
    ];
    var colX = {}, acc = LM;
    COLS.forEach(function (c) { colX[c.key] = acc; acc += c.w; });
    var HEAD_H = 11, ROW_H = 6.6, CH_H = ROW_H * 2;

    function drawTableHead(y) {
      e.box(LM, y, LIN, HEAD_H, HDR_BG, INK, 0.3);
      COLS.forEach(function (c, i) {
        if (i) e.line(colX[c.key], y, colX[c.key], y + HEAD_H, RULE_D, 0.2);
        var lines = c.head.filter(Boolean);
        var startY = y + HEAD_H / 2 - (lines.length - 1) * 1.45 + 1;
        lines.forEach(function (ln, k) {
          var small = c.key === 'desc' && k === 1;
          e.t(ln, colX[c.key] + c.w / 2, startY + k * 2.9, small ? 5.6 : 6.6, small ? 'normal' : 'bold', small ? NOTE : INK, 'center');
        });
      });
      e.line(LM, y + HEAD_H, LW - LM, y + HEAD_H, BLUE_HDR, 0.5);
      return y + HEAD_H;
    }

    function cellText(key, s, top, size, style, rgb) {
      var c = COLS.filter(function (x) { return x.key === key; })[0];
      var fv = e.fitText(s, c.w - 2, size || 8, style || 'normal', 5.5);
      e.t(fv.text, colX[key] + c.w / 2, top + ROW_H / 2 + 1.2, fv.size, style || 'normal', rgb || INK, 'center');
    }
    function cellFill(key, top, rgb) {
      var c = COLS.filter(function (x) { return x.key === key; })[0];
      e.box(colX[key] + 0.25, top + 0.25, c.w - 0.5, ROW_H - 0.5, rgb, null);
    }

    function readChannel(idx) {
      var cell = document.getElementById('p' + idx + '_descCell');
      var alRow = document.getElementById('p' + idx + '_row_al');
      var afRow = document.getElementById('p' + idx + '_row_af');
      function phase(ph) {
        return {
          display: val('p' + idx + '_' + ph + '_display'),
          ref: val('p' + idx + '_' + ph + '_ref'),
          corr: val('p' + idx + '_' + ph + '_corr'),
          sp: txtOf('p' + idx + '_' + ph + '_spHint'),
          refcorr: val('p' + idx + '_' + ph + '_refcorr'),
          diff: val('p' + idx + '_' + ph + '_diff'),
          offset: val('p' + idx + '_' + ph + '_offset'),
          probe: val('p' + idx + '_' + ph + '_probe'),
          label: txtOf('p' + idx + '_' + ph + '_label')
        };
      }
      return {
        pointNo: val('p' + idx + '_pointNo'),
        mode: (cell && cell.dataset.mode) || 'ambient',
        location: val('p' + idx + '_location'),
        deviceType: val('p' + idx + '_deviceType'),
        model: val('p' + idx + '_model'),
        serial: val('p' + idx + '_serial'),
        deviceStart: !!(afRow && afRow.classList.contains('pointStart')),
        alNA: !!(alRow && alRow.classList.contains('notNeeded')),
        alOut: !!(alRow && alRow.classList.contains('outOfTolerance')),
        af: phase('af'),
        al: phase('al')
      };
    }

    function drawChannel(ch, y, firstOnPage) {
      var bottom = y + CH_H;
      // outer frame + column rules
      e.box(LM, y, LIN, CH_H, null, INK, 0.25);
      if (ch.deviceStart && !firstOnPage) e.line(LM, y, LW - LM, y, BLUE_HDR, 0.6);
      COLS.forEach(function (c, i) {
        if (i) e.line(colX[c.key], y, colX[c.key], bottom, RULE_D, 0.2);
      });
      // AF / AL split (not through point no / description)
      e.line(colX.display, y + ROW_H, LW - LM, y + ROW_H, RULE_D, 0.2);

      // point no
      var pt = e.fitText(ch.pointNo, COLS[0].w - 3, 9, 'bold', 6);
      e.t(pt.text, colX.pt + COLS[0].w / 2, y + CH_H / 2 + 1.4, pt.size, 'bold', [95, 105, 115], 'center');

      // description
      var dx = colX.desc + 2, dw = COLS[1].w - 4;
      var lines = [];
      if (ch.mode === 'device') {
        lines.push({ t: [ch.deviceType, ch.location].filter(Boolean).join('  ·  ') || 'Device', s: 'bold' });
        lines.push({ t: 'Model: ' + (ch.model || '—'), s: 'normal' });
        lines.push({ t: 'Serial: ' + (ch.serial || '—'), s: 'normal' });
      } else {
        lines.push({ t: 'Room Ambient Temperature', s: 'bold' });
        lines.push({ t: ch.location || '—', s: 'normal' });
      }
      var lh = 3.7, top0 = y + CH_H / 2 - ((lines.length - 1) * lh) / 2 + 1.1;
      lines.forEach(function (ln, k) {
        var fv = e.fitText(ln.t, dw, 7.4, ln.s, 5.4);
        e.t(fv.text, dx, top0 + k * lh, fv.size, ln.s);
      });

      // As Found row — the worksheet decides whether As Left was needed
      var af = ch.af, r1 = y;
      cellFill('corr', r1, AMBER_BG);
      cellFill('diff', r1, ch.alNA ? GREEN_BG : AMBER_BG);
      cellFill('phase', r1, PHASE_BG);
      cellText('display', af.display, r1);
      cellText('ref', af.ref, r1);
      e.t(ascii(af.corr), colX.corr + COLS[4].w / 2, r1 + 3.4, 7.8, 'normal', INK, 'center');
      if (af.sp) e.t(af.sp, colX.corr + COLS[4].w / 2, r1 + 5.7, 4.8, 'bold', [120, 90, 20], 'center');
      cellText('refcorr', af.refcorr, r1, 8, 'bold');
      cellText('diff', af.diff, r1, 8, 'bold');
      cellText('offset', af.offset, r1);
      cellText('probe', af.probe, r1, 7);
      cellText('phase', 'As Found', r1, 7.4, 'bold');

      // As Left row
      var al = ch.al, r2 = y + ROW_H;
      if (ch.alNA) {
        ['display', 'ref', 'corr', 'refcorr', 'diff', 'offset'].forEach(function (k) {
          cellFill(k, r2, GREY_BG);
          cellText(k, 'NA', r2, 6.8, 'bold', GREY_TXT);
        });
        cellText('probe', 'NA', r2, 6.8, 'bold', GREY_TXT);
        e.t('As Left — N/A', colX.phase + COLS[9].w / 2, r2 + 2.9, 6.2, 'bolditalic', [150, 100, 20], 'center');
        e.t('(within tolerance)', colX.phase + COLS[9].w / 2, r2 + 5.2, 5.6, 'italic', [150, 100, 20], 'center');
      } else {
        cellFill('corr', r2, AMBER_BG);
        cellFill('diff', r2, ch.alOut ? RED_BG : GREEN_BG);
        cellFill('phase', r2, ch.alOut ? RED_BG : PHASE_BG);
        cellText('display', al.display, r2);
        cellText('ref', al.ref, r2);
        e.t(ascii(al.corr), colX.corr + COLS[4].w / 2, r2 + 3.4, 7.8, 'normal', INK, 'center');
        if (al.sp) e.t(al.sp, colX.corr + COLS[4].w / 2, r2 + 5.7, 4.8, 'bold', [120, 90, 20], 'center');
        cellText('refcorr', al.refcorr, r2, 8, 'bold');
        cellText('diff', al.diff, r2, 8, 'bold', ch.alOut ? RED_TX : INK);
        cellText('offset', al.offset, r2);
        cellText('probe', al.probe, r2, 7);
        cellText('phase', ch.alOut ? 'As Left — OUT OF TOLERANCE' : 'As Left', r2, 7.4, 'bold', ch.alOut ? RED_TX : INK);
      }
      return bottom;
    }

    // ---------------- footer: names, signatures, dates ----------------
    var FOOT_H = 20;
    function drawFooter(y) {
      y += 6;
      var cA = LM, cB = LM + 100, cC = LM + 190;
      [['Engineer Name', val('engineer'), txtOf('engSignature') || val('engineer'), dateField(val('engDate') || val('date')), true],
       // v1.549: no checker named = no checker date on the certificate
       ['Checked By (Name)', val('checkedBy'), '' /* v1.575: signed by hand, like the other worksheets */, val('checkedBy') ? dateField(val('checkDate')) : '', false]
      ].forEach(function (r, i) {
        var yy = y + i * 8.5;
        field(r[0], r[1], cA, 92, yy, r[4]);
        e.t('Signature:', cB, yy, 7.6);
        if (r[2]) {
          if (haveScript) {
            doc.setFont('DancingScript', 'normal'); doc.setFontSize(14);
            doc.setTextColor(SIGCOL[0], SIGCOL[1], SIGCOL[2]);
            doc.text(ascii(r[2]), cB + 16, yy + 0.4);
            doc.setFont('helvetica', 'normal');
          } else {
            e.t(r[2], cB + 16, yy, 11, 'italic', SIGCOL);
          }
        }
        field('Date', r[3], cC, LW - LM - cC, yy, false, 12);
      });
      return y + 17;
    }

    // ---------------- lay out the pages ----------------
    var idxs = [];
    document.querySelectorAll('#pointsBody tr[id$="_row_af"]').forEach(function (tr) {
      var m = tr.id.match(/^p(\d+)_row_af$/);
      if (m && document.getElementById('p' + m[1] + '_pointNo')) idxs.push(Number(m[1]));
    });
    if (!idxs.length) throw new Error('There are no points on the worksheet.');
    var channels = idxs.map(readChannel);

    var y = drawTitle(MT - 1);
    y = drawFields(y + 2);
    y = drawTableHead(y + 2);
    var firstOnPage = true;
    channels.forEach(function (ch) {
      if (y + CH_H > BOTTOM) {
        doc.addPage('a4', 'landscape');
        y = drawContinuation(MT - 1);
        y = drawTableHead(y);
        firstOnPage = true;
      }
      y = drawChannel(ch, y, firstOnPage);
      firstOnPage = false;
    });
    if (y + FOOT_H > BOTTOM) {
      doc.addPage('a4', 'landscape');
      y = drawContinuation(MT - 1);
    }
    drawFooter(y);

    // page numbers once the total is known
    var total = doc.getNumberOfPages();
    for (var p = 1; p <= total; p++) {
      doc.setPage(p);
      e.t('Page ' + p + ' of ' + total, LW - LM, LH - 5, 6.4, 'normal', NOTE, 'right');
    }
    doc.setPage(total);
    return doc;
  }

  function serialDiffers(a, b) {
    return String(a || '').replace(/[^a-z0-9]/gi, '').toUpperCase()
        !== String(b || '').replace(/[^a-z0-9]/gi, '').toUpperCase();
  }

  // v1.548: the TEST watermark added in v1.547 was removed at Radek's
  // request — PDFs are identical on the test and real sites. The test site
  // is still marked by the red bar and the TEST_ file names.
  // v1.550: every certificate carries its LabCal identity in the PDF's
  // document properties (not printed, not visible on the page): unit id,
  // job, certificate number, serial, worksheet and revision. "Check
  // certificates" on the calibration page reads it back from any copy.
  function finish(doc, kind) {
    try {
      var G = global.LabCalGuard, id = G && G.currentIdentity ? G.currentIdentity() : null;
      var ver = '';
      try { ver = (global.document && global.document.querySelector('meta[name="labcal-version"]') || {}).content || ''; } catch (e) {}
      if (kind === 'cert' && id) {
        var clean = function (v) { return ascii(v).replace(/[;=()\\]/g, ' ').trim(); };
        doc.setProperties({
          title: 'LabCal certificate ' + clean(id.certRef || id.serial),
          subject: 'Job ' + clean(id.jobRef) + ' \u00b7 serial ' + clean(id.serial),
          creator: 'LabCal' + (ver ? ' ' + ver : ''),
          keywords: 'labcal=1; uid=' + clean(id.uid) + '; job=' + clean(id.jobRef) + '; cert=' + clean(id.certRef) +
                    '; serial=' + clean(id.serial) + '; sheet=' + clean(id.sheet) + '; rev=' + (id.rev || 1) +
                    '; made=' + new Date().toISOString()
        });
      } else if (kind === 'summary') {
        doc.setProperties({ title: 'LabCal job summary', creator: 'LabCal' + (ver ? ' ' + ver : '') });
      }
    } catch (e) { /* identity is a bonus, never block a PDF over it */ }
    return doc.output('blob');
  }

  global.LabCalVectorPdf = {
    // Exported so the calibration page words a finished unit the same way the
    // job summary does. One implementation decides calibrated vs verified —
    // see the note on isVerificationRef above.
    isVerificationRef: isVerificationRef,
    supports: function (sheet) {
      return sheet === 'ws19_24' || sheet === 'barkey' || sheet === 'snmd' || sheet === 'smd' || sheet === 'nsmd' || sheet === 'ibb' || sheet === 'cloud_temp';
    },
    buildSNMD: function () { return buildSNMD('snmd'); },
    blobSNMD: function () { return finish(buildSNMD('snmd'), 'cert'); },
    buildSMD: function () { return buildSNMD('smd'); },
    buildNSMD: function () { return buildSNMD('nsmd'); },
    buildIBB: buildIBB,
    buildJobSummary: buildJobSummary,
    blobJobSummary: function (job, progress) { return finish(buildJobSummary(job, progress), 'summary'); },
    blobSMD: function () { return finish(buildSNMD('smd'), 'cert'); },
    blobNSMD: function () { return finish(buildSNMD('nsmd'), 'cert'); },
    blobIBB: function () { return finish(buildIBB(), 'cert'); },
    build19_24: build19_24,
    blob19_24: function () { return finish(build19_24(), 'cert'); },
    buildBarkey: buildBarkey,
    blobBarkey: function () { return finish(buildBarkey(), 'cert'); },
    blobCloudTemp: function (opts) { return finish(buildCloudTemp(opts), 'cert'); }
  };
})(typeof window !== 'undefined' ? window : this);

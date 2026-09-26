(window.LabCalBuild = window.LabCalBuild || {})['labcal_jobsheet.js'] = 'v1.577';  // file version — see labcal_build.js
/* ---------------------------------------------------------------------
   LabCal — shared jobsheet module
   ---------------------------------------------------------------------
   Load the jobsheet ONCE on the calibration page. It parses the equipment
   list, keeps it as the day's worklist, and hands each device off to the
   right worksheet with the header already filled in.

   The parser below is lifted verbatim from the worksheets, where it has
   been proven against four different jobsheet layouts (Formats A-D plus a
   generic fallback). Nothing about the parsing logic has been changed.

   Storage:  localStorage
             labcal.jobsheet.current  — parsed sheet + per-device progress
             labcal.jobsheet.handoff  — the one device a worksheet should load
             labcal.jobsheet.routes   — learned model -> worksheet mapping

   Requires pdf.js (window.pdfjsLib) on any page that parses a PDF.
   --------------------------------------------------------------------- */
(function (global) {
  'use strict';

  var KEY_CURRENT = 'labcal.jobsheet.current';
  var KEY_HANDOFF = 'labcal.jobsheet.handoff';
  var KEY_ROUTES  = 'labcal.jobsheet.routes';
  var KEY_PROGRESS = 'labcal.jobsheet.progress';
  var KEY_EXTRA = 'labcal.jobsheet.extra';   // units added on site, per job
  var KEY_LINK  = 'labcal.jobsheet.link';    // which unit the open worksheet belongs to
  var KEY_DUPOK = 'labcal.jobsheet.dupok';   // duplicates the engineer confirmed are genuine
  var KEY_FIXES = 'labcal.jobsheet.fixes';   // corrections to a jobsheet's own data
  var KEY_JOBS = 'labcal.jobsheet.jobs';     // every job, keyed by reference
  var KEY_ACTIVE = 'labcal.jobsheet.active'; // which job is open
  var CHANGE_EVENT = 'labcal-jobsheet-changed';

  // ===================================================================
  // PARSER (verbatim from the worksheets)
  // ===================================================================
  function mergeOrdinalSuperscripts(items){
    // v1.549: "3rd", "1st", "2nd", "4th"... Jobsheets print the suffix as a
    // raised (superscript) "rd". pdf.js returns it as a separate piece sitting
    // a few points higher, so it was grouped as a line of its own and ended up
    // in front of the text: "Medical Room, 3rd Floor" came out as
    // "rd Medical Room, 3 Floor". Glue any lone st/nd/rd/th that sits right
    // after a number (touching it horizontally, level with or slightly above
    // it) back onto that number before the lines are built.
    const list=(items||[]).map(it=>Object.assign({}, it));
    const dropped=new Set();
    list.forEach((s,i)=>{
      if(!s || typeof s.str!=='string' || !/^\s*(st|nd|rd|th)\s*$/i.test(s.str) || !s.transform) return;
      const sx=s.transform[4], sy=s.transform[5];
      let best=-1, bestGap=Infinity;
      list.forEach((b,j)=>{
        if(j===i || dropped.has(j) || !b || typeof b.str!=='string' || !b.transform) return;
        if(!/\d\s*$/.test(b.str)) return;
        const end=b.transform[4]+(b.width||0);
        const gap=sx-end, dy=sy-b.transform[5];
        if(gap<-4 || gap>3 || dy<-0.5 || dy>8) return;
        if(Math.abs(gap)<bestGap){ bestGap=Math.abs(gap); best=j; }
      });
      if(best<0) return;
      const b=list[best];
      b.str=b.str.replace(/\s+$/,'')+s.str.trim();
      b.width=Math.max(b.width||0, sx+(s.width||0)-b.transform[4]);
      dropped.add(i);
    });
    return list.filter((_,i)=>!dropped.has(i));
  }
  async function pdfToRows(file){
    const buf=await file.arrayBuffer();
    const pdf=await pdfjsLib.getDocument({data:buf}).promise;
    const rows=[];
    for(let p=1;p<=pdf.numPages;p++){
      const page=await pdf.getPage(p);
      const content=await page.getTextContent();
      const byY={};
      mergeOrdinalSuperscripts(content.items).forEach(it=>{
        if(!it.str || !it.str.trim()) return;
        const y=Math.round(it.transform[5]);
        let key=null;
        for(const k of Object.keys(byY)){ if(Math.abs(Number(k)-y)<=3){ key=k; break; } }
        if(key===null) key=String(y);
        (byY[key]=byY[key]||[]).push({x:it.transform[4],str:it.str,w:it.width||0});
      });
      Object.keys(byY).map(Number).sort((a,b)=>b-a).forEach(y=>{
        const items=glueSeparators(byY[String(y)].sort((a,b)=>a.x-b.x));
        const text=items.map(o=>o.str).join(' ').replace(/\s+/g,' ').trim();
        if(text) rows.push({page:p,y,items,text});
      });
    }
    return rows;
  }
  // v1.561: the PDF text engine returns a hyphen or slash as its OWN piece
  // of text even when it is part of a code: "731405033248PW" + "-" (touching,
  // no space). That lone "-" then fell into the next column and the serial
  // was stitched to its wrapped tail as "731405033248PWLC" instead of
  // "731405033248PW-LC". Glue a separator back onto the text it touches.
  // Only when there is no gap (≤1 pt) — "Rowlands Pharmacy - 1002" has real
  // spaces (≈2.5 pt) and stays as it is.
  function glueSeparators(items){
    const TOUCH=1;
    const out=[];
    for(let i=0;i<items.length;i++){
      const it=items[i], prev=out[out.length-1];
      const isSep=/^[-\u2010-\u2013\/]$/.test(String(it.str||'').trim());
      const endOf=o=>o.x+(o.w||0);
      if(isSep && prev && prev.w && Math.abs(it.x-endOf(prev))<=TOUCH){
        prev.str=String(prev.str).replace(/\s+$/,'')+String(it.str).trim();
        prev.w=endOf(it)-prev.x;
        // and the text straight after it, if that touches too ("E-mail", "UCR10-200")
        const next=items[i+1];
        if(next && it.w && Math.abs(next.x-endOf(it))<=TOUCH && !/^[-\u2010-\u2013\/]$/.test(String(next.str||'').trim())){
          prev.str+=String(next.str).replace(/^\s+/,'');
          prev.w=endOf(next)-prev.x;
          i++;
        }
        continue;
      }
      out.push(Object.assign({},it));
    }
    return out;
  }
  function findItemX(items,word){
    const w=word.toLowerCase();
    // startsWith handles cases where the PDF text engine merges adjacent
    // header words into one run, e.g. "Model" + "No" -> a single item "Model No"
    const it=items.find(i=>{
      const s=i.str.toLowerCase().trim();
      return s===w || s.startsWith(w+' ') || s.startsWith(w);
    });
    if(it) return it.x;
    // Some PDFs' embedded fonts cause the browser's text engine to split a
    // single word mid-letter across 2-3 separate items (e.g. "Serial" comes
    // out as "Ser" + "ial"). Try concatenating a few consecutive items and
    // matching the word at the start of that combined string.
    for(let i=0;i<items.length;i++){
      let combined='';
      for(let j=i;j<Math.min(i+4,items.length);j++){
        combined+=items[j].str;
        if(combined.toLowerCase().startsWith(w)) return items[i].x;
        if(combined.length>=w.length+4) break;
      }
    }
    return null;
  }
  function leadingWordX(items,word){
    const x=findItemX(items,word);
    if(x==null || !items.length) return null;
    const minX=Math.min(...items.map(it=>it.x));
    return Math.abs(x-minX)<3 ? x : null;
  }
  // Put each text run in a column.
  //
  // Headers are LEFT-aligned but the values under them are CENTRED, so a
  // value's starting x moves left as the text gets longer. Matching on the
  // start alone therefore breaks for long values: on a real Labcold jobsheet
  // the Serial and Location headers sit at x=191.9 and x=363.2, so anything
  // starting left of their midpoint (277.55) is read as a serial — and
  // "Dispensary L7 Aisle 1 Unchecked Items Fridge 2" starts at 276.9. It lost
  // by 0.65 of a point, and the location was swallowed into the serial cell.
  //
  // So look at the span the text actually covers first. That long location
  // runs 276.9 -> 488.3, which straddles the Location header and comes nowhere
  // near the Serial one. A value that covers exactly one header belongs to it,
  // whatever alignment the sheet uses — a left-aligned value starts on its own
  // header, a centred one grows out across it. Only when the span settles
  // nothing (no header covered, or several) do we fall back to the old
  // nearest-start test, which is also what happens when the PDF gives us no
  // width to work with.
  function classifyRowToColumns(items,anchors,maxDist){
    const cols={};
    const put=(key,str)=>{ cols[key]=(cols[key]?cols[key]+' ':'')+str; };
    items.forEach(it=>{
      const w=Number(it.w)||0;
      if(w>0){
        const covered=anchors.filter(a=>a.x>=it.x && a.x<=it.x+w);
        if(covered.length===1){ put(covered[0].key,it.str); return; }
      }
      let best=null,bestD=Infinity;
      anchors.forEach(a=>{ const d=Math.abs(it.x-a.x); if(d<bestD){bestD=d;best=a;} });
      if(best && bestD<=maxDist) put(best.key,it.str);
    });
    return cols;
  }
  // Fallback when column-anchor matching fails to find a model value: strip
  // known dates and the already-identified serial(s) from the row text, and
  // take what's left over as the model code.
  function guessModelFromText(rowText,knownValues){
    let t=rowText.replace(/\d{2}\/\d{2}\/\d{4}/g,' ');
    (knownValues||[]).filter(Boolean).forEach(v=>{ t=t.split(v).join(' '); });
    const tokens=t.split(/\s+/).filter(Boolean);
    const candidate=tokens.find(tok=>/[A-Za-z]/.test(tok) && /\d/.test(tok) && tok.length>=4);
    return candidate||(tokens[0]||'');
  }
  function isBoilerplateLine(text){
    return /^labcold limited$/i.test(text) ||
      /^cherrywood$/i.test(text) ||
      /^chineham park$/i.test(text) ||
      /^basingstoke$/i.test(text) ||
      /^hants$/i.test(text) ||
      /^rg24\s*8wf$/i.test(text) ||
      /^registered in england/i.test(text) ||
      /^vat ref\.?\s*no\.?/i.test(text) ||
      /^sales tel:/i.test(text) ||
      /^e-mail:/i.test(text);
  }
  function parseJobsheetRows(rowsIn){
    // Every page repeats the same Labcold letterhead/footer block. When a
    // table or section runs past the bottom of a page, that boilerplate would
    // otherwise get scanned as if it were more table rows or section content.
    const rows=rowsIn.filter(r=>!isBoilerplateLine(r.text));
    const texts=rows.map(r=>r.text);
    const devices=[];

    // Format A / C: single-line 3-column header — "Model Serial Location" or
    // "Serial No Model No Type" (maintenance route jobsheets), or "Model No
    // Serial Department" (single-unit jobsheets), or "Serial Equipment #
    // Location" (asset-tag jobsheets with no true model number). Column order
    // and the exact label on the 2nd/3rd columns vary between jobsheets, so we
    // match Model OR Equipment for the 2nd column, and Location/Department/Type
    // for the 3rd, looking up each column's x position independently (order on
    // the page doesn't matter for that).
    const hdrAIdx=rows.findIndex(r=>{
      const items=r.items;
      const hasModel=findItemX(items,'model')!=null;
      const hasEquip=findItemX(items,'equipment')!=null;
      const hasSerial=findItemX(items,'serial')!=null;
      const hasLoc=findItemX(items,'location')!=null || findItemX(items,'department')!=null || findItemX(items,'type')!=null;
      return (hasModel||hasEquip) && hasSerial && hasLoc;
    });
    if(hdrAIdx!==-1){
      const hdrItems=rows[hdrAIdx].items;
      const anchors=[];
      let modelX=findItemX(hdrItems,'Model');
      let modelColIsEquipment=false;
      if(modelX==null){ modelX=findItemX(hdrItems,'Equipment'); modelColIsEquipment=true; }
      if(modelX!=null) anchors.push({key:'model',x:modelX});
      const serialX=findItemX(hdrItems,'Serial'); if(serialX!=null) anchors.push({key:'serial',x:serialX});
      let locationX=findItemX(hdrItems,'Location');
      if(locationX==null) locationX=findItemX(hdrItems,'Department');
      if(locationX==null) locationX=findItemX(hdrItems,'Type');
      if(locationX!=null) anchors.push({key:'location',x:locationX});
      const locationFragments=[];
      for(let i=hdrAIdx+1;i<rows.length;i++){
        const t=texts[i];
        if(!t || /^customer\b/i.test(t)) break;
        // x-anchored classification handles model/location values that contain
        // spaces (e.g. "LEC - LSR151UK", "Research & Development Clinic Room"),
        // which a plain whitespace split would break apart incorrectly.
        const cols=classifyRowToColumns(rows[i].items,anchors,300);
        const modelOrEquip=(cols.model||'').trim();
        const serial=(cols.serial||'').trim();
        const location=(cols.location||'').trim();
        if(location) locationFragments.push(location);
        if(!modelOrEquip && !serial){
          // No model/serial on this line — likely a wrapped continuation line
          // of a single Location cell that's vertically merged across several
          // device rows (one shared site description spanning many units).
          // Skip it rather than stopping the whole table scan.
          continue;
        }
        if(!/\d/.test(serial)) break;
        const device={model:modelColIsEquipment?'':modelOrEquip,serial,location};
        if(modelColIsEquipment) device.equipment=modelOrEquip;
        devices.push(device);
      }
      // If a location cell is merged across rows, most/all devices will have
      // come out with an empty or only-partial location. Reassemble the full
      // text from every fragment seen in the table and apply it uniformly.
      //
      // Only when MOST rows came out empty, though. A merged cell leaves
      // nearly every row without a location; one blank cell in an otherwise
      // well-filled column is just a blank cell. Treating that as a merge
      // pasted all thirteen locations onto all fourteen units of a 14-unit
      // job — every unit reading "Dispensary L7 Checked Items Fridge 1
      // PharmaC Counter M1 ..." — which destroys good data to paper over one
      // missing cell. Leave the one gap for the engineer to fill instead.
      const mergedLocation=locationFragments.join(' ').replace(/\s+/g,' ').trim();
      const withOwnLocation=devices.filter(d=>d.location).length;
      if(mergedLocation && devices.length && withOwnLocation*3<=devices.length){
        devices.forEach(d=>{ d.location=mergedLocation; });
      }
    }

    // Format B: "Labcold S/Number | Non Labcold S/Number | Model No | Type | Warranty End Date | Maintenance End Date" (single-unit breakdown jobsheets)
    if(!devices.length){
      // Header wording is always split as "Labcold S/Number", "Non Labcold S/Number",
      // "Model No", "Warranty End Date", "Maintenance End Date" — but different PDFs
      // wrap the line breaks differently (sometimes "No"/"Date" fall onto a second
      // continuation line, sometimes not). Detecting by first-word items on a single
      // row is robust to all the wrapping variants seen so far.
      const hdrBIdx=rows.findIndex(r=>{
        const items=r.items;
        const hasLabcold=findItemX(items,'labcold')!=null;
        const hasModel=findItemX(items,'model')!=null;
        const hasWarranty=findItemX(items,'warranty')!=null;
        const hasMaintenance=findItemX(items,'maintenance')!=null;
        return hasLabcold && hasModel && hasWarranty && hasMaintenance;
      });
      if(hdrBIdx!==-1){
        const hdrItems=rows[hdrBIdx].items;
        const anchors=[];
        const labcoldX=findItemX(hdrItems,'Labcold'); if(labcoldX!=null) anchors.push({key:'serial',x:labcoldX});
        const nonX=findItemX(hdrItems,'Non'); if(nonX!=null) anchors.push({key:'serial2',x:nonX});
        const modelX=findItemX(hdrItems,'Model'); if(modelX!=null) anchors.push({key:'model',x:modelX});
        const typeX=findItemX(hdrItems,'Type'); if(typeX!=null) anchors.push({key:'type',x:typeX});
        const warrantyX=findItemX(hdrItems,'Warranty'); if(warrantyX!=null) anchors.push({key:'warranty',x:warrantyX});
        const maintX=findItemX(hdrItems,'Maintenance'); if(maintX!=null) anchors.push({key:'maintenance',x:maintX});
        // Skip any further header continuation lines (e.g. "S/Number S/Number",
        // "S/Number No Date Date") — these never contain digits, unlike the
        // actual data row (serial numbers, dates) that follows them.
        let i=hdrBIdx+1;
        while(i<rows.length && texts[i] && !/\d/.test(texts[i]) && !/^customer\b/i.test(texts[i])) i++;
        for(;i<rows.length;i++){
          const t=texts[i];
          if(!t || /^customer\b/i.test(t)) break;
          const cols=classifyRowToColumns(rows[i].items,anchors,60);
          let model=(cols.model||'').trim();
          let serial=(cols.serial||cols.serial2||'').trim();
          if(!model && !serial) break;
          if(!model) model=guessModelFromText(t,[serial]);
          if(!serial) serial=guessModelFromText(t,[model]);
          devices.push({model,serial,location:''});
        }
      }
    }

    // Format D: generic fallback for any jobsheet layout not matched above.
    // Rather than requiring an exact known header wording, this looks for any
    // row containing a serial-like column ("Serial", "S/Number") together with
    // a model-like column ("Model", "Equipment") — whatever labels the third
    // (location-ish) column uses, if any, are picked up too. This is what
    // catches new/unseen jobsheet layouts without needing a dedicated branch
    // for each one.
    if(!devices.length){
      const hdrDIdx=rows.findIndex(r=>{
        const items=r.items;
        const hasSerial=findItemX(items,'serial')!=null || findItemX(items,'s/number')!=null;
        const hasModel=findItemX(items,'model')!=null || findItemX(items,'equipment')!=null;
        return hasSerial && hasModel;
      });
      if(hdrDIdx!==-1){
        const hdrItems=rows[hdrDIdx].items;
        const anchors=[];
        let serialX=findItemX(hdrItems,'serial');
        if(serialX==null) serialX=findItemX(hdrItems,'s/number');
        if(serialX!=null) anchors.push({key:'serial',x:serialX});
        let modelX=findItemX(hdrItems,'model');
        const modelColIsEquipment=modelX==null;
        if(modelX==null) modelX=findItemX(hdrItems,'equipment');
        if(modelX!=null) anchors.push({key:'model',x:modelX});
        let locationX=findItemX(hdrItems,'Location');
        if(locationX==null) locationX=findItemX(hdrItems,'Department');
        if(locationX==null) locationX=findItemX(hdrItems,'Type');
        if(locationX!=null) anchors.push({key:'location',x:locationX});
        const locationFragments=[];
        let i=hdrDIdx+1;
        while(i<rows.length && texts[i] && !/\d/.test(texts[i]) && !/^customer\b/i.test(texts[i])) i++;
        for(;i<rows.length;i++){
          const t=texts[i];
          if(!t || /^customer\b/i.test(t)) break;
          const cols=classifyRowToColumns(rows[i].items,anchors,300);
          const modelOrEquip=(cols.model||'').trim();
          const serial=(cols.serial||'').trim();
          const location=(cols.location||'').trim();
          if(location) locationFragments.push(location);
          if(!modelOrEquip && !serial) continue;
          if(!/\d/.test(serial) && !/\d/.test(modelOrEquip)) break;
          const device={model:modelColIsEquipment?'':modelOrEquip,serial,location};
          if(modelColIsEquipment) device.equipment=modelOrEquip;
          devices.push(device);
        }
        // Same majority test as Format A above: only a genuinely merged
        // cell (most rows empty) may overwrite locations that did parse.
        const mergedLocation=locationFragments.join(' ').replace(/\s+/g,' ').trim();
        const withOwnLocation=devices.filter(d=>d.location).length;
        if(mergedLocation && devices.length && withOwnLocation*3<=devices.length){
          devices.forEach(d=>{ d.location=mergedLocation; });
        }
      }
    }

    let customer='',callNumber='',callDate='',visitDate='',address='',department='';
    const custHeaderIdx=rows.findIndex(r=>leadingWordX(r.items,'customer')!=null);
    if(custHeaderIdx!==-1 && texts[custHeaderIdx+1]){
      const dl=texts[custHeaderIdx+1];
      const dateM=dl.match(/(\d{2}\/\d{2}\/\d{4}\s+\d{1,2}:\d{2})/);
      const lastToken=dl.match(/(\S+)\s*$/);
      if(lastToken) callNumber=lastToken[1];
      if(dateM){ callDate=dateM[1]; customer=dl.slice(0,dateM.index).trim(); }
      else customer=dl.replace(callNumber,'').trim();
      // Long customer names sometimes wrap onto their own continuation line
      // (e.g. "The Clatterbridge Cancer" / "Centre - Liverpool") — that line
      // has no Call Date/Type/Number values, just more customer-column text.
      const callDateX=findItemX(rows[custHeaderIdx].items,'call') ?? Infinity;
      let ci=custHeaderIdx+2, contLines=0;
      while(ci<rows.length && contLines<2 && rows[ci].items.length && rows[ci].items.every(it=>it.x<callDateX-10)){
        const items=rows[ci].items;
        if(leadingWordX(items,'address')!=null || leadingWordX(items,'department')!=null || leadingWordX(items,'main')!=null || leadingWordX(items,'site')!=null || leadingWordX(items,'fault')!=null || leadingWordX(items,'customer')!=null) break;
        customer=(customer+' '+texts[ci]).trim();
        ci++; contLines++;
      }
    }
    // Some jobsheets pack a stray right-hand notes column onto the same rows as
    // Department/Address (e.g. "Department Please report to porter cabin
    // outside"). Detecting these sections by their leftmost word only — and
    // clipping continuation lines to whatever x-boundary that row implies —
    // keeps that overflow text out of the extracted value.
    const deptHeaderRowIdx=rows.findIndex((r,idx)=>idx!==hdrAIdx && leadingWordX(r.items,'department')!=null);
    if(deptHeaderRowIdx!==-1){
      const hdrItems=rows[deptHeaderRowIdx].items;
      const deptX=Math.min(...hdrItems.map(it=>it.x));
      const rightItems=hdrItems.filter(it=>it.x>deptX+5).sort((a,b)=>a.x-b.x);
      const boundaryX=rightItems.length?rightItems[0].x:Infinity;
      const dlines=[];
      for(let i=deptHeaderRowIdx+1;i<rows.length;i++){
        const items=rows[i].items;
        if(!items.length || leadingWordX(items,'address')!=null || leadingWordX(items,'main')!=null || leadingWordX(items,'site')!=null || leadingWordX(items,'fault')!=null || leadingWordX(items,'customer')!=null) break;
        const own=items.filter(it=>it.x<boundaryX-10);
        if(own.length) dlines.push(own.map(it=>it.str).join(' '));
      }
      department=dlines.join(', ');
    }
    const addrHeaderIdx=rows.findIndex(r=>leadingWordX(r.items,'address')!=null);
    if(addrHeaderIdx!==-1){
      const hdrItems=rows[addrHeaderIdx].items;
      const addrX=Math.min(...hdrItems.map(it=>it.x));
      const rightItems=hdrItems.filter(it=>it.x>addrX+5).sort((a,b)=>a.x-b.x);
      const boundaryX=rightItems.length?rightItems[0].x:Infinity;
      const addrLines=[];
      for(let i=addrHeaderIdx+1;i<rows.length;i++){
        const items=rows[i].items;
        if(!items.length || leadingWordX(items,'main')!=null || leadingWordX(items,'site')!=null || leadingWordX(items,'fault')!=null || leadingWordX(items,'customer')!=null || leadingWordX(items,'department')!=null || findItemX(items,'details')!=null) break;
        const own=items.filter(it=>it.x<boundaryX-10);
        if(own.length) addrLines.push(own.map(it=>it.str).join(' '));
      }
      address=addrLines.join(', ');
    }
    const faultHeaderIdx=rows.findIndex(r=>findItemX(r.items,'fault')!=null && findItemX(r.items,'visit')!=null);
    if(faultHeaderIdx!==-1){
      let di=faultHeaderIdx+1;
      if(/^for$/i.test(texts[di]||'')) di++;
      const dl=texts[di]||'';
      const dates=[...dl.matchAll(/\d{2}\/\d{2}\/\d{4}/g)];
      if(dates.length) visitDate=dates[dates.length-1][0];
    }

    if(department) devices.forEach(d=>{ if(!d.location) d.location=department; });

    // Job reference numbers are consistently formatted like "ENQ123456"
    // regardless of jobsheet layout, so a direct search across the whole
    // document is more reliable than reading it out of a specific table
    // column — use it to fill in (or correct) whatever the per-row parsing
    // above found.
    const enqMatch=texts.join(' ').match(/\bENQ-?\d{4,}\b/i)
      || rows.map(r=>r.items.map(it=>it.str).join('')).join(' ').match(/\bENQ-?\d{4,}\b/i);
    if(enqMatch) callNumber=enqMatch[0].toUpperCase();

    return {devices:tidyDevices(devices),customer,callNumber,callDate,visitDate,address,department};
  }
  // A long serial in a narrow table cell wraps onto a second line. The tail
  // ("LC" under "761503260747PW-") arrives as its own row with no model, and
  // was previously turned into a phantom second unit with a stub serial.
  // Stitch those tails back onto the serial above them.
  function isContinuationFragment(prev, cur){
    if(!prev) return false;
    if(String(cur.model||'').trim() || String(cur.equipment||'').trim()) return false;
    var frag=String(cur.serial||'').trim();
    var prevSerial=String(prev.serial||'').trim();
    if(!frag || !prevSerial) return false;
    // The cell was split mid-code: the line above ends on a hyphen or slash.
    if(/[-\/]$/.test(prevSerial)) return true;
    // Or a very short letters-only tail sitting under a long code.
    if(frag.length<=4 && !/[0-9]/.test(frag) && prevSerial.length>=6) return true;
    return false;
  }

  function tidyDevices(devices){
    var out=[];
    for(var i=0;i<devices.length;i++){
      var d=devices[i], prev=out[out.length-1];
      if(isContinuationFragment(prev,d)){
        prev.serial=String(prev.serial||'')+String(d.serial||'').trim();
        if(!prev.location && d.location) prev.location=d.location;
        continue;
      }
      // A row with no model, no equipment and only a stub serial is table
      // noise rather than a unit.
      var hasModel=String(d.model||'').trim() || String(d.equipment||'').trim();
      var serial=String(d.serial||'').trim();
      if(!hasModel && serial.length<5) continue;
      out.push(d);
    }
    return out;
  }

  function ddmmyyyyToIso(v){
    const m=String(v||'').match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
    if(!m) return '';
    return `${m[3]}-${m[2]}-${m[1]}`;
  }
  // ===================================================================
  // WORKSHEET ROUTING
  // ===================================================================
  // Two kinds of rule:
  //   match      — tested against the model + equipment + location text
  //   modelMatch — tested against the NORMALISED model code only
  //                (uppercased, punctuation and spaces stripped), so
  //                "RLDF 15-19", "rldf1519" and "RLDF1519" behave the same.
  //
  // Rules are tried in order and the first hit wins. Anything that matches
  // nothing asks the engineer once, then remembers the answer.
  var RULES = [
    // Named kit — unambiguous from the description itself.
    { match: /barkey|plasmatherm|plasma\s*therm/i, sheet: 'barkey' },
    { match: /cloud\s*temp|cloudtemp/i,            sheet: 'cloud_temp' },
    { match: /thermo\s*max|monitor\s*max/i,        sheet: 'monitoring' },

    // LPTU0008 is a Barkey. Tolerant of how many leading zeros get typed.
    { modelMatch: /^LPTU0*8(?![0-9])/,             sheet: 'barkey' },

    // Anything whose model code ends in MD is a medical device.
    // Checked BEFORE the 19/24 rule: a code ending "MD" cannot also end in
    // "19"/"24", so the two can never both fire, but the order makes that
    // explicit rather than accidental.
    { modelMatch: /MD$/,                           sheet: 'smd' },

    // The 19 range and the 24 range: 0119, 0219, 0519, 1019, 1519 and the
    // matching 24s. Anchored to the end of the model code.
    { modelMatch: /(?:19|24)$/,                    sheet: 'ws19_24' },

    // The 10 range — FO110, FO210, FO310 and anything else ending in 10 —
    // takes the standard non-medical form. Checked after the MD rule, so an
    // "…10MD" code still goes to Medical.
    // NOTE: this also catches RLDG1010 (the model on ENQ139969). Confirm that
    // is right, or tell me to narrow this to the FO family only.
    { modelMatch: /10$/,                           sheet: 'snmd' }
  ];

  var SHEETS = {
    barkey:      { id:'barkey',      name:'Barkey',                 href:'barkey_calibration_form.html',        offsets:'dostmann' },
    smd:         { id:'smd',         name:'Standard Medical',       href:'calibration_worksheet_SMD.html',      offsets:'dostmann' },
    nsmd:        { id:'nsmd',        name:'Non-Standard Medical',   href:'calibration_worksheet_NSMD.html',     offsets:'dostmann' },
    ibb:         { id:'ibb',         name:'IBB / Blood Bank',       href:'calibration_worksheet_IBB.html',      offsets:'dostmann' },
    snmd:        { id:'snmd',        name:'Standard Non-Medical',   href:'calibration_worksheet_SNMD.html',     offsets:'fluke_comark' },
    ws19_24:     { id:'ws19_24',     name:'19/24 Range',            href:'calibration_worksheet_19_24.html',    offsets:'fluke_comark' },
    cloud_temp:  { id:'cloud_temp',  name:'Cloud Temp',             href:'cloud_temp.html',                     offsets:'fluke_comark' },
    monitoring:  { id:'monitoring',  name:'Monitoring Systems',     href:'monitoring_systems.html',             offsets:'fluke_comark' }
  };

  // Full normalised model code, used by the modelMatch rules.
  function normalisedModel(model) {
    return String(model || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  }

  // Model codes are normalised so that "RLDF 1010A", "rldf-1010a" and
  // "RLDF1010A" all learn and match as the same thing.
  function modelKey(model) {
    return normalisedModel(model).slice(0, 12);
  }

  function readJson(key, fallback) {
    try {
      var txt = global.localStorage.getItem(key);
      return txt ? JSON.parse(txt) : fallback;
    } catch (e) { return fallback; }
  }
  function writeJson(key, value) {
    try {
      if (value === null) global.localStorage.removeItem(key);
      else global.localStorage.setItem(key, JSON.stringify(value));
      return true;
    } catch (e) { return false; }
  }

  function routes() { return readJson(KEY_ROUTES, {}) || {}; }

  // Records were plain strings ("modelKey": "smd") in v1.3. Read both shapes.
  function routeRecord(value) {
    if (!value) return null;
    if (typeof value === 'string') return { sheet: value };
    return value;
  }

  // Remember that this model goes to this worksheet, so the next jobsheet
  // with the same kit routes itself without being asked.
  //
  // `suggested` is what the app had proposed before the engineer chose. When
  // the two differ, that disagreement is the single most useful thing in the
  // export — it says a built-in rule is wrong or missing.
  function learnRoute(model, sheetId, suggested) {
    var k = modelKey(model);
    if (!k || !SHEETS[sheetId]) return;
    var r = routes();
    var prev = routeRecord(r[k]) || {};
    var rec = {
      sheet: sheetId,
      model: String(model || ''),
      uses: (prev.uses || 0) + 1,
      updated: new Date().toISOString()
    };
    if (suggested && suggested !== sheetId) rec.correctedFrom = suggested;
    else if (prev.correctedFrom && prev.sheet === sheetId) rec.correctedFrom = prev.correctedFrom;
    r[k] = rec;
    writeJson(KEY_ROUTES, r);
    announce();
  }
  function forgetRoutes() { writeJson(KEY_ROUTES, null); announce(); }

  function routeCount() { return Object.keys(routes()).length; }

  // A shareable summary of everything the app has learned, so it can be sent
  // back and folded into the built-in RULES above. Contains equipment model
  // codes and routing choices only — no customer, site or job information.
  function exportRoutes() {
    var r = routes();
    var keys = Object.keys(r).sort();
    var learned = keys.map(function (k) {
      var rec = routeRecord(r[k]) || {};
      var device = { model: rec.model || k };
      var s = suggestFromRules(device);
      return {
        key: k,
        model: rec.model || '',
        chosen: rec.sheet,
        uses: rec.uses || 1,
        updated: rec.updated || '',
        // What the built-in rules would say today. 'agrees:false' entries are
        // the ones worth acting on.
        ruleWouldSay: s.sheet || null,
        agrees: !s.sheet ? null : s.sheet === rec.sheet,
        correctedFrom: rec.correctedFrom || null
      };
    });
    return {
      kind: 'labcal-routing-feedback',
      version: 1,
      exportedAt: new Date().toISOString(),
      totals: {
        learned: learned.length,
        notCoveredByRules: learned.filter(function (e) { return e.ruleWouldSay === null; }).length,
        disagreeWithRules: learned.filter(function (e) { return e.agrees === false; }).length
      },
      routes: learned
    };
  }

  // Built-in rules only, ignoring anything learned.
  function suggestFromRules(device) {
    var hay = [device.model, device.equipment, device.location].filter(Boolean).join(' ');
    var code = normalisedModel(device.model);
    for (var i = 0; i < RULES.length; i++) {
      var rule = RULES[i];
      if (rule.match && rule.match.test(hay)) return { sheet: rule.sheet, why: 'rule' };
      if (rule.modelMatch && code && rule.modelMatch.test(code)) return { sheet: rule.sheet, why: 'rule' };
    }
    return { sheet: '', why: '' };
  }

  // Returns { sheet, why } — `why` is 'learned', 'rule' or '' (unknown).
  // What you have chosen before beats a built-in rule, so a correction sticks.
  function suggestSheet(device) {
    var learned = routeRecord(routes()[modelKey(device.model)]);
    if (learned && SHEETS[learned.sheet]) return { sheet: learned.sheet, why: 'learned' };
    return suggestFromRules(device);
  }

  // ===================================================================
  // THE DAY'S WORKLIST
  // ===================================================================
  // ===================================================================
  // PROGRESS THAT SURVIVES ACROSS DAYS
  // ===================================================================
  // A job can run over several days. Reloading the same jobsheet tomorrow
  // must not wipe out yesterday's ticks, so what has been certified is kept
  // against the JOB (not against the loaded worklist) and merged back in
  // whenever that jobsheet is loaded again.
  function progressStore() { return readJson(KEY_PROGRESS, {}) || {}; }

  // Every unit gets a permanent id the moment it joins a job. Certificates are
  // filed against this, not against the serial — a serial can be corrected, a
  // certificate number can repeat (S 00000 on a verification sheet), and a job
  // reference can be mistyped. The id never changes, so the link never breaks.
  function newUid() {
    return 'u' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  }

  function serialKey(serial) {
    return String(serial || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
  }

  function progressFor(jobRef) {
    var all = progressStore();
    return all[String(jobRef || '')] || {};
  }

  // A unit that is not on site, or that the customer does not want done, is
  // marked not required rather than left looking outstanding forever. It is
  // recorded against the job so it survives reloading the jobsheet.
  function setNotRequired(jobRef, serial, on, reason) {
    var k = serialKey(serial);
    if (!k) return;
    var all = progressStore();
    var job = all[String(jobRef || '')] || {};
    var prev = job[k] || {};
    if (on) {
      job[k] = {
        done: prev.done || false,
        doneAt: prev.doneAt || '',
        certRef: prev.certRef || '',
        detail: prev.detail || '',
        notRequired: true,
        notRequiredAt: new Date().toISOString(),
        reason: reason || ''
      };
    } else if (prev.notRequired) {
      if (prev.done) {
        job[k] = { done: true, doneAt: prev.doneAt, certRef: prev.certRef, detail: prev.detail || '' };
      } else {
        delete job[k];
      }
    }
    all[String(jobRef || '')] = job;
    writeJson(KEY_PROGRESS, all);
    applyProgressToCurrent();
    announce();
  }

  // ---- units added on site ------------------------------------------------
  function extraStore() { return readJson(KEY_EXTRA, {}) || {}; }
  function extrasFor(jobRef) { return extraStore()[String(jobRef || '')] || []; }

  function addDevice(device) {
    var js = current();
    if (!js) return null;
    var entry = {
      uid: newUid(),
      model: String(device.model || '').trim(),
      equipment: '',
      serial: String(device.serial || '').trim(),
      location: String(device.location || '').trim(),
      addedManually: true,
      addedAt: new Date().toISOString()
    };
    if (!entry.model && !entry.serial) return null;

    var all = extraStore();
    var list = all[String(js.callNumber || '')] || [];
    var dupe = list.some(function (x) { return serialKey(x.serial) === serialKey(entry.serial) && serialKey(entry.serial); });
    if (!dupe) { list.push(entry); all[String(js.callNumber || '')] = list; writeJson(KEY_EXTRA, all); }

    var s2 = suggestSheet(entry);
    js.devices.push({
      idx: js.devices.length, uid: entry.uid,
      model: entry.model, equipment: '', serial: entry.serial, location: entry.location,
      sheet: s2.sheet, sheetWhy: s2.why, suggested: s2.sheet,
      done: false, doneAt: '', certRef: '', addedManually: true
    });
    writeJson(KEY_CURRENT, js);
    saveActiveJob();
    announce();
    return entry;
  }

  // Corrections are remembered against the job, so re-uploading the same
  // (still wrong) jobsheet does not undo them or duplicate the unit.
  function fixesStore() { return readJson(KEY_FIXES, {}) || {}; }
  function fixesFor(jobRef) { return fixesStore()[String(jobRef || '')] || {}; }
  function recordFix(jobRef, originalSerial, patch) {
    var k = serialKey(originalSerial);
    if (!k) return;
    var all = fixesStore();
    var job = all[String(jobRef || '')] || {};
    var prev = job[k] || {};
    job[k] = {
      serial: patch.serial !== undefined ? patch.serial : prev.serial,
      model: patch.model !== undefined ? patch.model : prev.model,
      location: patch.location !== undefined ? patch.location : prev.location,
      at: new Date().toISOString()
    };
    all[String(jobRef || '')] = job;
    writeJson(KEY_FIXES, all);
  }

  // Jobsheets carry wrong serials often enough that they have to be
  // correctable on site. Changing a serial has to carry the unit's progress
  // with it, otherwise a corrected unit looks untouched again.
  function editDevice(idx, patch) {
    var js = current();
    if (!js || !js.devices[idx]) return null;
    var d = js.devices[idx];
    var oldSerial = d.serial;
    var newSerial = patch.serial === undefined ? d.serial : String(patch.serial).trim();
    var changedSerial = serialKey(newSerial) !== serialKey(oldSerial);
    // v1.560: serialKey ignores punctuation (so "17800903_2000184" and
    // "178009032000184" are recognised as the same unit), which made a
    // correction that only added/removed a "_", "-" or space look like "no
    // change" — the list silently kept the old spelling and reopening the
    // worksheet put it back. The spelling is now saved whenever the text
    // differs; progress only moves when the unit key itself changes.
    var retypedSerial = !changedSerial && String(newSerial) !== String(oldSerial || '').trim();

    var changed = [];
    if (patch.model !== undefined && String(patch.model).trim() !== d.model) changed.push('model');
    if (patch.location !== undefined && String(patch.location).trim() !== d.location) changed.push('location');
    if (changedSerial || retypedSerial) changed.push('serial');

    if (patch.model !== undefined) d.model = String(patch.model).trim();
    if (patch.location !== undefined) d.location = String(patch.location).trim();

    if (changed.length) {
      d.edited = true;
      d.editedAt = new Date().toISOString();
      d.editedFields = (d.editedFields || []).concat(changed).filter(function (v, i, a) {
        return a.indexOf(v) === i;
      });
    }
    recordFix(js.callNumber, d.sheetSerial || oldSerial, {
      serial: newSerial, model: d.model, location: d.location
    });
    if (!d.sheetSerial) d.sheetSerial = oldSerial;   // as printed on the jobsheet

    if (changedSerial) {
      // move the progress record onto the corrected serial
      var all = progressStore();
      var job = all[String(js.callNumber || '')] || {};
      var oldKey = serialKey(oldSerial), newKey = serialKey(newSerial);
      if (oldKey && job[oldKey]) {
        if (newKey) job[newKey] = job[oldKey];
        delete job[oldKey];
        all[String(js.callNumber || '')] = job;
        writeJson(KEY_PROGRESS, all);
      }
      // and any part-finished worksheet saved against the old serial
      if (global.LabCalUnits && d.sheet && oldKey && newKey) {
        try {
          var snap = global.LabCalUnits.load(d.sheet, js.callNumber, oldSerial);
          if (snap && snap.state) {
            global.LabCalUnits.save(d.sheet, js.callNumber, newSerial, snap.state, snap.meta || {});
            global.LabCalUnits.remove(d.sheet, js.callNumber, oldSerial);
          }
        } catch (e) { /* the correction still stands */ }
      }
      // keep hand-added units findable under their new serial
      if (d.addedManually) {
        var ex = extraStore();
        var list = (ex[String(js.callNumber || '')] || []).map(function (x) {
          if (serialKey(x.serial) === oldKey) {
            return { uid: d.uid, model: d.model, equipment: '', serial: newSerial, location: d.location,
                     addedManually: true, addedAt: x.addedAt };
          }
          return x;
        });
        ex[String(js.callNumber || '')] = list;
        writeJson(KEY_EXTRA, ex);
      }
      // a certificate already issued carries the old serial — record that
      if (d.done && oldSerial) d.serialWas = oldSerial;
      d.serial = newSerial;
    } else if (retypedSerial) {
      // same unit, corrected spelling: the part-finished worksheet is stored
      // under the spelling (labcal_units keeps "_" and "-"), so move it too
      if (global.LabCalUnits && d.sheet) {
        try {
          var snap2 = global.LabCalUnits.load(d.sheet, js.callNumber, oldSerial);
          if (snap2 && snap2.state && !global.LabCalUnits.load(d.sheet, js.callNumber, newSerial)) {
            global.LabCalUnits.save(d.sheet, js.callNumber, newSerial, snap2.state, snap2.meta || {});
            global.LabCalUnits.remove(d.sheet, js.callNumber, oldSerial);
          }
        } catch (e) { /* the correction still stands */ }
      }
      if (d.addedManually) {
        var ex2 = extraStore(), k2 = serialKey(oldSerial);
        ex2[String(js.callNumber || '')] = (ex2[String(js.callNumber || '')] || []).map(function (x) {
          if (serialKey(x.serial) === k2) { x.serial = newSerial; x.uid = d.uid; }
          return x;
        });
        writeJson(KEY_EXTRA, ex2);
      }
      if (d.done && oldSerial) d.serialWas = oldSerial;
      d.serial = newSerial;
    }

    // a corrected model may belong on a different worksheet
    if (patch.model !== undefined && !d.done) {
      var sug = suggestSheet(d);
      if (sug.sheet && sug.why !== 'learned') { d.sheet = sug.sheet; d.sheetWhy = sug.why; }
    }

    writeJson(KEY_CURRENT, js);
    saveActiveJob();
    announce();
    return d;
  }

  function removeDevice(idx) {
    var js = current();
    if (!js || !js.devices[idx]) return false;
    var d = js.devices[idx];
    if (!d.addedManually) return false;    // only hand-added units can be removed
    var all = extraStore();
    var list = (all[String(js.callNumber || '')] || []).filter(function (x) {
      return serialKey(x.serial) !== serialKey(d.serial);
    });
    all[String(js.callNumber || '')] = list;
    writeJson(KEY_EXTRA, all);
    js.devices.splice(idx, 1);
    js.devices.forEach(function (x, i) { x.idx = i; });
    writeJson(KEY_CURRENT, js);
    saveActiveJob();
    announce();
    return true;
  }

  function recordProgress(jobRef, serial, info) {
    var k = serialKey(serial);
    if (!k) return;
    var all = progressStore();
    var job = all[String(jobRef || '')] || {};
    var prev = job[k] || {};
    job[k] = {
      done: true,
      doneAt: info && info.doneAt ? info.doneAt : (prev.doneAt || new Date().toISOString()),
      // v1.549: a Monitoring System result passes `detail` ("2 ch, 1 adj.")
      // and its own reference (Worksheet No, often empty) — that replaces
      // whatever was there, including the 1.545 "2 ch · in tol" stop-gap.
      certRef: (info && info.detail !== undefined) ? (info.certRef || '') : ((info && info.certRef) || prev.certRef || ''),
      detail: (info && info.detail) || prev.detail || ''
    };
    all[String(jobRef || '')] = job;
    writeJson(KEY_PROGRESS, all);
  }

  function clearProgress(jobRef) {
    var all = progressStore();
    delete all[String(jobRef || '')];
    writeJson(KEY_PROGRESS, all);
    announce();
  }

  // Certificates are the real evidence a unit was done. If the progress store
  // has been cleared but certificates for this job still exist, put the ticks
  // back from those.
  function reconcileFromCertificates(jobRef, certificates) {
    var changed = false;
    (certificates || []).forEach(function (c) {
      if ((c.jobRef || '') !== String(jobRef || '')) return;
      if (!c.serial) return;
      var existing = progressFor(jobRef)[serialKey(c.serial)];
      if (existing && existing.done) return;
      recordProgress(jobRef, c.serial, c.summaryShort
        ? { doneAt: c.savedAt, certRef: c.certRef || '', detail: c.summaryShort }
        : { doneAt: c.savedAt, certRef: c.certRef || '' });
      changed = true;
    });
    var js = current();
    if (js && String(js.callNumber || '') === String(jobRef || '')) {
      if (applyProgressToCurrent()) changed = true;
    }
    if (changed) announce();
    return changed;
  }

  // Fold the stored progress into the loaded worklist.
  // Jobs saved before unit ids existed get one now, once.
  function ensureUids() {
    var js = readJson(KEY_CURRENT, null);
    if (!js || !js.devices) return;
    var changed = false;
    js.devices.forEach(function (d) { if (!d.uid) { d.uid = newUid(); changed = true; } });
    if (changed) { writeJson(KEY_CURRENT, js); saveActiveJob(); }
  }

  // A jobsheet sometimes lists the same unit twice. Keep the first and cross
  // the rest off, so they do not sit there as work still to do and so that
  // certifying one does not look like certifying the other. An engineer who
  // decides the sheet was right can put one back, and that decision sticks.
  // How many of a repeated serial the engineer has confirmed are real units.
  // Two rows with the same serial are indistinguishable, so the decision is
  // recorded against the job and the serial, not against a row.
  function dupOkStore() { return readJson(KEY_DUPOK, {}) || {}; }
  function dupAllowance(jobRef, serial) {
    var job = dupOkStore()[String(jobRef || '')] || {};
    return job[serialKey(serial)] || 0;
  }
  function allowOneMoreDuplicate(jobRef, serial) {
    var all = dupOkStore();
    var job = all[String(jobRef || '')] || {};
    var k = serialKey(serial);
    if (!k) return;
    job[k] = (job[k] || 0) + 1;
    all[String(jobRef || '')] = job;
    writeJson(KEY_DUPOK, all);
  }

  // A jobsheet that lists the same unit twice used to leave a second row on
  // the worklist, crossed off as "not required". That reads as a job with an
  // extra unit that someone decided to skip, which is not what happened — the
  // jobsheet simply repeated itself, and the engineer still has to scroll past
  // it and wonder. An exact serial match is the same physical unit, so the two
  // rows are folded into one and the survivor carries a note saying the
  // jobsheet listed it twice.
  //
  // Nothing is lost by folding: progress, "not required" and certificates are
  // all stored against the serial, not against a row, so the surviving row
  // already carries every bit of state the copy would have shown. Two genuinely
  // different units that share a serial are still supported — the engineer says
  // so once (splitDuplicate) and the allowance below keeps them apart from then
  // on, exactly as before.
  function markDuplicates(js) {
    if (!js || !js.devices) return;
    var seen = {}, keeper = {}, allowed = {};
    js.devices.forEach(function (d) {
      // clear any previous automatic marking before working it out again
      if (d.duplicateOf) {
        d.duplicateOf = null;
        if (/^Duplicate of/.test(d.notRequiredReason || '')) {
          d.notRequired = false; d.notRequiredReason = '';
        }
      }
      d.duplicateMerged = false;
      d.duplicateCopies = 0;
    });
    js.devices.forEach(function (d) {
      var k = serialKey(d.serial);
      if (!k) return;                       // no serial: cannot tell them apart
      if (!seen[k]) {
        seen[k] = d.uid || true;
        keeper[k] = d;
        allowed[k] = dupAllowance(js.callNumber, d.serial);
        return;
      }
      if (allowed[k] > 0) { allowed[k]--; return; }   // confirmed as a real unit
      d.duplicateOf = seen[k];
      d.duplicateMerged = true;                       // folded away, not shown
      var first = keeper[k];
      if (first) {
        first.duplicateCopies = (first.duplicateCopies || 0) + 1;
        // Take anything the surviving row was missing from the copy — a
        // repeated row sometimes carries a location the first one lost.
        if (!first.location && d.location) first.location = d.location;
        if (!first.model && d.model) first.model = d.model;
        if (!first.equipment && d.equipment) first.equipment = d.equipment;
      }
    });
  }

  // "These really are two different units that happen to share a serial."
  // Called from the surviving row; hands one copy back and re-marks.
  function splitDuplicate(idx) {
    var js = current();
    if (!js || !js.devices[idx]) return false;
    var d = js.devices[idx];
    if (!d.duplicateCopies) return false;
    allowOneMoreDuplicate(js.callNumber, d.serial);
    markDuplicates(js);
    writeJson(KEY_CURRENT, js);
    saveActiveJob();
    announce();
    return true;
  }

  // Put a crossed-off duplicate back on the list, for good.
  function undoDuplicate(idx) {
    var js = current();
    if (!js || !js.devices[idx]) return false;
    var d = js.devices[idx];
    allowOneMoreDuplicate(js.callNumber, d.serial);
    d.duplicateOf = null;
    d.duplicateRestored = true;
    if (/^Duplicate of/.test(d.notRequiredReason || '')) {
      d.notRequired = false; d.notRequiredReason = '';
    }
    writeJson(KEY_CURRENT, js);
    saveActiveJob();
    announce();
    return true;
  }

  function applyProgressToCurrent() {
    ensureUids();
    var js = current();
    if (!js) return false;
    var prog = progressFor(js.callNumber);
    var changed = false;
    js.devices.forEach(function (d) {
      var p = prog[serialKey(d.serial)];
      if (!p) {
        // A duplicate is marked by the jobsheet itself, not by a progress
        // record, so it must not be cleared here.
        if (d.notRequired && !d.duplicateOf) { d.notRequired = false; d.notRequiredReason = ''; changed = true; }
        return;
      }
      if (p.done && !d.done) {
        d.done = true;
        d.doneAt = p.doneAt || '';
        d.certRef = d.certRef || p.certRef || '';
        d.detail = d.detail || p.detail || '';
        d.carriedOver = true;   // certified before this worklist was loaded
        changed = true;
      }
      if (!!p.notRequired !== !!d.notRequired) {
        d.notRequired = !!p.notRequired;
        d.notRequiredReason = p.reason || '';
        changed = true;
      }
    });
    if (changed) { writeJson(KEY_CURRENT, js); saveActiveJob(); }
    return changed;
  }

  function todayIso() {
    var d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }

  // ---- jobs -------------------------------------------------------------
  // More than one job can be open at once; each keeps its own unit list and
  // progress. A job is identified by its reference (the ENQ number), so
  // loading the same jobsheet again merges into the job already there rather
  // than starting a second copy of it.
  function jobsStore() { return readJson(KEY_JOBS, {}) || {}; }
  function jobKey(ref) { return String(ref || '').trim().toUpperCase() || 'NOJOB'; }

  // A job by its reference, whether or not it is the one currently open.
  function jobByRef(ref) {
    var all = jobsStore();
    return all[jobKey(ref)] || null;
  }

  function progressOf(job) {
    if (!job || !job.devices) return { total: 0, done: 0, notRequired: 0, outstanding: 0 };
    // A row folded into its twin is not a unit — it must not be counted.
    var devices = job.devices.filter(function (d) { return !d.duplicateMerged; });
    var today = todayIso(), out = { total: devices.length, done: 0, today: 0, earlier: 0, started: 0, notRequired: 0, outstanding: 0 };
    devices.forEach(function (d) {
      if (d.notRequired && !d.done) { out.notRequired++; return; }
      if (d.done) {
        out.done++;
        if (String(d.doneAt || '').slice(0, 10) === today) out.today++; else out.earlier++;
      } else if (isStarted(job.callNumber, d)) out.started++;
    });
    out.outstanding = out.total - out.done - out.notRequired;
    return out;
  }

  // v1.564: the calendar cards counted ticks from the job's saved copy only.
  // Ticks recorded in the progress store (the job page folds them in when the
  // job is opened) were missing there until then, so a bar could sit at 0 %.
  // Read-only copy with the progress store applied, as applyProgressToCurrent does.
  function withStoredProgress(job) {
    if (!job || !job.devices) return job;
    var prog = progressStore()[String(job.callNumber || '')] || {};
    var copy = JSON.parse(JSON.stringify(job));
    copy.devices.forEach(function (d) {
      var p = prog[serialKey(d.serial)];
      if (!p) return;
      if (p.done && !d.done) { d.done = true; d.doneAt = p.doneAt || ''; }
      if (!!p.notRequired !== !!d.notRequired && !d.duplicateOf) d.notRequired = !!p.notRequired;
    });
    return copy;
  }

  // Which days did work actually happen on this job? Opened, certified,
  // marked not required, or corrected — anything the engineer touched.
  function activeDaysOf(job) {
    var days = {};
    var add = function (iso) { if (iso) days[String(iso).slice(0, 10)] = true; };
    if (!job) return [];
    add(job.day); add(job.openedAt); add(job.loadedAt);
    (job.devices || []).forEach(function (d) {
      add(d.doneAt); add(d.notRequiredAt); add(d.editedAt); add(d.addedAt);
    });
    // progress records carry dates for work done before this list was loaded
    var prog = (progressStore()[String(job.callNumber || '')]) || {};
    Object.keys(prog).forEach(function (k) {
      add(prog[k].doneAt); add(prog[k].notRequiredAt);
    });
    return Object.keys(days).sort();
  }

  // Jobs touched on a given day, newest first.
  function jobsActiveOn(day) {
    var all = jobsStore();
    return Object.keys(all).map(function (k) {
      var j = all[k];
      var days = activeDaysOf(j);
      if (days.indexOf(day) === -1) return null;
      var p = progressOf(withStoredProgress(j));   // v1.564: same ticks as the job page
      return {
        key: k, callNumber: j.callNumber || '', customer: j.customer || '',
        department: j.department || '', fileName: j.fileName || '',
        openedAt: j.openedAt || '', firstDay: days[0], lastDay: days[days.length - 1],
        multiDay: days.length > 1, days: days,
        total: p.total, done: p.done, notRequired: p.notRequired, outstanding: p.outstanding,
        started: p.started
      };
    }).filter(Boolean).sort(function (a, b) { return (b.openedAt || '') < (a.openedAt || '') ? -1 : 1; });
  }

  // Every day any job was touched — for marking the calendar.
  function allActiveDays() {
    var all = jobsStore(), out = {};
    Object.keys(all).forEach(function (k) {
      activeDaysOf(all[k]).forEach(function (d) { out[d] = (out[d] || 0) + 1; });
    });
    return out;
  }

  function listJobs() {
    var all = jobsStore();
    return Object.keys(all).map(function (k) {
      var j = all[k];
      var devices = (j.devices || []).filter(function (d) { return !d.duplicateMerged; });
      var done = devices.filter(function (d) { return d.done; }).length;
      var skipped = devices.filter(function (d) { return d.notRequired && !d.done; }).length;
      return {
        key: k, callNumber: j.callNumber || '', customer: j.customer || '',
        day: j.day || '', openedAt: j.openedAt || '', fileName: j.fileName || '',
        total: devices.length, done: done, notRequired: skipped,
        outstanding: devices.length - done - skipped
      };
    }).sort(function (a, b) { return (b.openedAt || '') < (a.openedAt || '') ? -1 : 1; });
  }

  function activeKey() {
    try { return global.localStorage.getItem(KEY_ACTIVE) || ''; } catch (e) { return ''; }
  }
  function setActiveJob(key) {
    try { global.localStorage.setItem(KEY_ACTIVE, key || ''); } catch (e) {}
    var all = jobsStore();
    writeJson(KEY_CURRENT, all[key] || null);
    if (all[key]) applyProgressToCurrent();
    announce();
    return current();
  }
  function saveActiveJob() {
    var js = current();
    if (!js) return;
    var all = jobsStore();
    all[jobKey(js.callNumber)] = js;
    writeJson(KEY_JOBS, all);
    try { global.localStorage.setItem(KEY_ACTIVE, jobKey(js.callNumber)); } catch (e) {}
  }
  function deleteJob(key) {
    var all = jobsStore();
    delete all[key];
    writeJson(KEY_JOBS, all);
    if (activeKey() === key) {
      var next = Object.keys(all)[0] || '';
      setActiveJob(next);
    } else {
      announce();
    }
  }

  // A job created by hand, for work with no jobsheet.
  function createJob(info) {
    var ref = String((info && info.callNumber) || '').trim();
    var js = {
      openedAt: new Date().toISOString(),
      day: (info && info.day) || todayIso(),
      fileName: '',
      customer: String((info && info.customer) || '').trim(),
      callNumber: ref,
      callDate: '', visitDate: '', address: '', department: '',
      devices: [],
      manual: true
    };
    var all = jobsStore();
    if (all[jobKey(ref)]) return setActiveJob(jobKey(ref));   // already open
    all[jobKey(ref)] = js;
    writeJson(KEY_JOBS, all);
    writeJson(KEY_CURRENT, js);
    try { global.localStorage.setItem(KEY_ACTIVE, jobKey(ref)); } catch (e) {}
    announce();
    return current();
  }

  function current() {
    var js = readJson(KEY_CURRENT, null);
    if (!js || !js.devices) return null;
    return js;
  }

  // Store a freshly parsed sheet as today's worklist.
  function setCurrent(parsed, fileName) {
    var js = {
      loadedAt: new Date().toISOString(),
      openedAt: new Date().toISOString(),
      day: todayIso(),
      fileName: fileName || '',
      customer: parsed.customer || '',
      callNumber: parsed.callNumber || '',
      callDate: parsed.callDate || '',
      visitDate: parsed.visitDate || '',
      address: parsed.address || '',
      department: parsed.department || '',
      devices: (parsed.devices || []).map(function (d, i) {
        var s = suggestSheet(d);
        return {
          idx: i,
          model: d.model || '',
          equipment: d.equipment || '',
          serial: d.serial || '',
          location: d.location || '',
          sheet: s.sheet,
          sheetWhy: s.why,
          suggested: s.sheet,
          uid: newUid(),
          done: false,
          doneAt: '',
          certRef: ''
        };
      })
    };
    // Apply any corrections made on site to the sheet's own data first, so a
    // re-uploaded sheet with the same typo lines up with the unit already on
    // the list rather than arriving as a duplicate.
    var fixes = fixesFor(js.callNumber);
    js.devices.forEach(function (d) {
      var f = fixes[serialKey(d.serial)];
      if (!f) return;
      d.sheetSerial = d.serial;
      if (f.serial) d.serial = f.serial;
      if (f.model) d.model = f.model;
      if (f.location) d.location = f.location;
      d.corrected = true;
      d.edited = true;
      d.editedAt = f.at || '';
      d.editedFields = ['corrected on site'];
    });

    // Loading the same jobsheet again (day two of the same job) merges into
    // the job already open rather than replacing it: units already on the
    // list keep their state, and anything new on the sheet is appended.
    var existing = jobsStore()[jobKey(js.callNumber)];
    if (existing && existing.devices) {
      var bySerial = {};
      existing.devices.forEach(function (d) {
        var k = serialKey(d.serial);
        if (k) bySerial[k] = d;
      });
      js.devices = js.devices.map(function (d) {
        var k = serialKey(d.serial);
        var was = k && bySerial[k];
        if (!was) return d;
        delete bySerial[k];
        // keep everything the engineer has decided about this unit
        d.uid = was.uid || d.uid;      // the unit keeps the id it already had
        d.sheet = was.sheet || d.sheet;
        d.sheetWhy = was.sheetWhy || d.sheetWhy;
        d.done = was.done; d.doneAt = was.doneAt; d.certRef = was.certRef; d.detail = was.detail || '';
        d.notRequired = was.notRequired; d.notRequiredReason = was.notRequiredReason;
        d.carriedOver = was.carriedOver;
        d.duplicateRestored = d.duplicateRestored || was.duplicateRestored;
        d.edited = d.edited || was.edited;
        d.editedAt = d.editedAt || was.editedAt;
        d.editedFields = d.editedFields || was.editedFields;
        d.sheetSerial = d.sheetSerial || was.sheetSerial;
        return d;
      });
      // units that were on the job but not on this sheet (added on site, or
      // dropped from a revised sheet) stay on the list
      Object.keys(bySerial).forEach(function (k) { js.devices.push(bySerial[k]); });
      js.devices.forEach(function (d, i) { d.idx = i; });
      js.openedAt = existing.openedAt || js.openedAt;
    }

    // Units added by hand on an earlier visit belong to this job too, so put
    // them back when the jobsheet is loaded again.
    extrasFor(js.callNumber).forEach(function (x) {
      var already = js.devices.some(function (d) {
        return serialKey(d.serial) && serialKey(d.serial) === serialKey(x.serial);
      });
      if (already) return;
      var sx = suggestSheet(x);
      js.devices.push({
        idx: js.devices.length, uid: x.uid || newUid(),
        model: x.model, equipment: '', serial: x.serial, location: x.location,
        sheet: sx.sheet, sheetWhy: sx.why, suggested: sx.sheet,
        done: false, doneAt: '', certRef: '', addedManually: true
      });
    });

    markDuplicates(js);

    writeJson(KEY_CURRENT, js);
    // Same job, later day: bring yesterday's ticks back.
    applyProgressToCurrent();
    saveActiveJob();
    announce();
    return current();
  }

  function clearCurrent() { writeJson(KEY_CURRENT, null); writeJson(KEY_HANDOFF, null); announce(); }

  function updateDevice(idx, patch) {
    var js = current(); if (!js || !js.devices[idx]) return null;
    Object.keys(patch || {}).forEach(function (k) { js.devices[idx][k] = patch[k]; });
    writeJson(KEY_CURRENT, js);
    saveActiveJob();                   // v1.559: a worksheet chosen for a unit survived only until another job was opened
    announce();
    return js;
  }

  // extra (optional): { detail } — a short result for sheets without a
  // certificate number (Monitoring System, v1.549).
  function markDone(serial, certRef, extra) {
    if (tabLocked()) return;
    // v1.559: act on THIS tab's job and unit (its link), not on whichever
    // job happens to be current — another tab may have opened a different one.
    var l = link();
    // v1.564: a worksheet not opened from the job list (unit typed in, or picked
    // from its own "Load Jobsheet PDF") has no link. It now passes its Job Ref,
    // so the tick lands on THAT job even when another job is open on the list —
    // before, the unit was looked for only in the open job and silently not ticked.
    var ref = (l && l.jobRef) ? l.jobRef : ((extra && extra.jobRef) ? String(extra.jobRef).trim() : '');
    if (ref && jobKey((current() || {}).callNumber) !== jobKey(ref) && jobsStore()[jobKey(ref)]) {
      return withJob(ref, function () { return markDone(serial, certRef, extra); });
    }
    var js = current(); if (!js) return;
    var hit = null;
    if (l && l.uid && jobKey(js.callNumber) === jobKey(l.jobRef)) {
      hit = js.devices.filter(function (d) { return d.uid === l.uid && !d.duplicateMerged; })[0] || null;
      // the link is to a different unit than the serial being certified — trust neither blindly
      if (hit && serialKey(hit.serial) !== serialKey(serial)) hit = null;
    }
    if (!hit) hit = js.devices.filter(function (d) {
      return d.serial && String(d.serial).trim() === String(serial || '').trim();
    })[0];
    if (!hit) return;
    hit.done = true;
    hit.doneAt = new Date().toISOString();
    if (extra && extra.detail !== undefined) { hit.certRef = certRef || ''; hit.detail = extra.detail || ''; }
    else if (certRef) hit.certRef = certRef;
    writeJson(KEY_CURRENT, js);
    saveActiveJob();                   // v1.559: also into the job store, so switching jobs keeps it
    recordProgress(js.callNumber, serial, extra && extra.detail !== undefined
      ? { doneAt: hit.doneAt, certRef: certRef || '', detail: extra.detail || '' }
      : { doneAt: hit.doneAt, certRef: certRef });
    announce();
  }

  // A unit counts as "started" when a worksheet snapshot exists for it but no
  // certificate has been produced — i.e. readings were entered and not
  // finished. Only available when the units module is loaded.
  function isStarted(jobRef, device) {
    if (!global.LabCalUnits || !device.sheet || !device.serial) return false;
    return global.LabCalUnits.has(device.sheet, jobRef, device.serial);
  }

  function progress() {
    var js = current();
    if (!js) return { total: 0, done: 0, today: 0, earlier: 0, started: 0 };
    var devices = js.devices.filter(function (d) { return !d.duplicateMerged; });
    var today = todayIso(), out = { total: devices.length, done: 0, today: 0, earlier: 0, started: 0, notRequired: 0, outstanding: 0 };
    devices.forEach(function (d) {
      if (d.notRequired && !d.done) { out.notRequired++; return; }
      if (d.done) {
        out.done++;
        if (String(d.doneAt || '').slice(0, 10) === today) out.today++;
        else out.earlier++;
      } else if (isStarted(js.callNumber, d)) {
        out.started++;
      }
    });
    out.outstanding = out.total - out.done - out.notRequired;
    return out;
  }

  // ===================================================================
  // HANDOFF TO A WORKSHEET
  // ===================================================================
  // The calibration page writes one device here, then navigates. The
  // worksheet picks it up on load and clears it, so a later refresh of that
  // worksheet doesn't silently overwrite work in progress.
  function handoff(idx) {
    var js = current(); if (!js || !js.devices[idx]) return null;
    var d = js.devices[idx];
    var payload = {
      at: new Date().toISOString(),
      sheet: d.sheet,
      device: { model: d.model, equipment: d.equipment, serial: d.serial, location: d.location },
      jobsheet: {
        customer: js.customer, callNumber: js.callNumber, address: js.address,
        department: js.department, visitDate: js.visitDate
      }
    };
    writeJson(KEY_HANDOFF, payload);
    setLink({ jobRef: js.callNumber, serial: d.serial, uid: d.uid || '', sheet: d.sheet || '' });   // v1.564: + sheet (resume after reload)
    if (d.sheet) learnRoute(d.model, d.sheet, d.suggested);
    return payload;
  }

  // Hand a unit to its worksheet without going through the worklist — used
  // when reopening from the certificate list to amend a finished unit.
  function handoffUnit(payload) {
    var p = {
      at: new Date().toISOString(),
      sheet: payload.sheet,
      device: payload.device || {},
      jobsheet: payload.jobsheet || {}
    };
    writeJson(KEY_HANDOFF, p);
    setLink({ jobRef: (payload.jobsheet || {}).callNumber || '', serial: (payload.device || {}).serial || '', sheet: payload.sheet || '' });
    return p;
  }

  // ---- the link between a worksheet and its unit --------------------------
  // A worksheet needs to know which unit on which job it is filling in, so a
  // serial corrected on the worksheet can be pushed back to the list. The
  // link is stored, not held in memory, so it survives the page reload that
  // happens when navigating between the two.
  //
  // v1.559: the link is kept PER TAB (sessionStorage). It used to be one
  // value shared by every tab, so with two units open in two tabs the
  // older tab read the newer tab's unit — and its certificate could be
  // filed against, and rename, the wrong unit. sessionStorage survives the
  // navigation from the job list to the worksheet in the same tab, and a
  // reload, but is never seen by another tab.
  function sessionStore() { try { return global.sessionStorage; } catch (e) { return null; } }
  var memLink = null;
  function setLink(l) {
    var s = sessionStore();
    if (!s) { memLink = l || null; return; }
    try {
      if (!l) s.removeItem(KEY_LINK); else s.setItem(KEY_LINK, JSON.stringify(l));
    } catch (e) { memLink = l || null; }
  }
  function link() {
    var s = sessionStore();
    if (!s) return memLink;
    try { var t = s.getItem(KEY_LINK); return t ? JSON.parse(t) : memLink; } catch (e) { return memLink; }
  }
  // The pre-v1.559 shared link cannot be trusted to belong to any one tab.
  try { global.localStorage.removeItem(KEY_LINK); } catch (e) {}

  // A worksheet tab locked by labcal_tablock.js (its unit is open in
  // another tab) must not touch the job list.
  function tabLocked() {
    try { return !!(global.LabCalTabLock && global.LabCalTabLock.isLocked()); } catch (e) { return false; }
  }

  // Run fn with job `ref` as the current job, then put the previously
  // current job back. v1.559: a worksheet in one tab marking its unit done
  // used to act on whatever job another tab had open — the tick was lost.
  function withJob(ref, fn) {
    var js = current();
    if (!ref || (js && jobKey(js.callNumber) === jobKey(ref))) return fn();
    var all = jobsStore();
    if (!all[jobKey(ref)]) return fn();
    var prevKey = activeKey();
    if (js) saveActiveJob();                      // keep the current job exactly as it is
    setActiveJob(jobKey(ref));
    try { return fn(); }
    finally {
      saveActiveJob();
      setActiveJob(prevKey);
    }
  }

  // Push what the worksheet now says back onto its unit. Returns the updated
  // device, or null if the worksheet is not linked to one.
  function syncFromWorksheet(patch) {
    var l = link();
    if (!l || !l.serial) return null;
    if (tabLocked()) return null;
    var js = current();
    if (!js || jobKey(js.callNumber) !== jobKey(l.jobRef)) {
      // v1.559: edit that job without leaving it open in place of the
      // job another tab (or the job list) is showing
      if (jobsStore()[jobKey(l.jobRef)]) return withJob(l.jobRef, function () { return syncFromWorksheet(patch); });
    }
    if (!js) return null;
    var idx = -1;
    js.devices.forEach(function (d, i) {
      if (idx === -1 && l.uid && d.uid === l.uid) idx = i;
    });
    if (idx === -1) {
      js.devices.forEach(function (d, i) {
        if (idx === -1 && serialKey(d.serial) === serialKey(l.serial)) idx = i;
      });
    }
    if (idx === -1) return null;
    var d = editDevice(idx, patch);
    if (d) setLink({ jobRef: l.jobRef, serial: d.serial, uid: d.uid || l.uid || '' });
    return d;
  }

  // Read AND clear — a handoff is consumed exactly once.
  function takeHandoff(expectedSheet) {
    var p = readJson(KEY_HANDOFF, null);
    if (!p) return null;
    // Opened a different worksheet than the one routed to? Leave it alone so
    // the intended worksheet still gets it.
    if (expectedSheet && p.sheet && p.sheet !== expectedSheet) return null;
    writeJson(KEY_HANDOFF, null);
    arrived = p;
    return p;
  }
  // v1.564: the iPad reloads a worksheet tab it had put to sleep (and a
  // pull-to-refresh does the same). The tab still knows its unit (the link is
  // kept per tab), but there is no hand-off any more, so the worksheet came
  // back EMPTY — and typing the job + serial into that empty form saved the
  // blank form over the unit's readings. Rebuild the hand-off from the link so
  // the worksheet reopens its unit exactly as from the job list.
  // Only for a RELOAD (or back/forward) of the same worksheet type. A worksheet
  // opened afresh (tools card, link) is not this tab's old unit: its link is
  // dropped, so a certificate made there can never be filed against that unit.
  function navigationType() {
    try { var e = global.performance.getEntriesByType('navigation')[0]; if (e && e.type) return e.type; } catch (err) {}
    try { var t = global.performance.navigation.type; return t === 1 ? 'reload' : t === 2 ? 'back_forward' : 'navigate'; } catch (err) {}
    return 'navigate';
  }
  function resumeFromLink(sheet) {
    var l = link();
    if (!l || !l.serial) return null;
    var how = navigationType();
    if (how !== 'reload' && how !== 'back_forward') {
      if (!readJson(KEY_HANDOFF, null)) setLink(null);
      return null;
    }
    if (!l.sheet || l.sheet !== sheet) return null;
    var job = jobByRef(l.jobRef), d = null;
    if (job && job.devices) {
      d = job.devices.filter(function (x) { return l.uid && x.uid === l.uid && !x.duplicateMerged; })[0] ||
          job.devices.filter(function (x) { return serialKey(x.serial) === serialKey(l.serial) && !x.duplicateMerged; })[0] || null;
    }
    return {
      at: new Date().toISOString(), sheet: sheet, resumed: true,
      device: d ? { model: d.model, equipment: d.equipment, serial: d.serial, location: d.location } : { serial: l.serial },
      jobsheet: job ? { customer: job.customer, callNumber: job.callNumber, address: job.address, department: job.department, visitDate: job.visitDate }
                    : { callNumber: l.jobRef }
    };
  }

  // Did this page arrive from the job list? (labcal_tablock.js: opening a
  // unit from the list takes it over from any older tab.)
  var arrived = null;
  function arrivedFromList() { return !!arrived; }

  function announce() {
    try { global.dispatchEvent(new CustomEvent(CHANGE_EVENT)); } catch (e) {}
  }

  function onChange(fn) {
    if (typeof fn !== 'function') return;
    global.addEventListener(CHANGE_EVENT, fn);
    var queued = false;
    global.addEventListener('storage', function (e) {
      if (!e || !e.key) return;
      if (e.key !== KEY_CURRENT && e.key !== KEY_ROUTES) return;
      if (queued) return;
      queued = true;
      global.setTimeout(function () { queued = false; try { fn(); } catch (err) {} }, 60);
    });
  }

  // ===================================================================
  // PUBLIC API
  // ===================================================================
  global.LabCalJobsheet = {
    SHEETS: SHEETS,
    CHANGE_EVENT: CHANGE_EVENT,
    // parsing
    pdfToRows: pdfToRows,
    parseRows: parseJobsheetRows,
    parseFile: async function (file) {
      if (!global.pdfjsLib) throw new Error('PDF library not available (no internet connection to load it)');
      var rows = await pdfToRows(file);
      var parsed = parseJobsheetRows(rows);
      if (!parsed.devices.length) {
        console.error('Jobsheet PDF parsing found no devices. Extracted lines:', rows.map(function (r) { return r.text; }));
        throw new Error('No equipment list found in this PDF. Open the browser console for the extracted text — share that if you need this fixed.');
      }
      return parsed;
    },
    // worklist
    current: current,
    setCurrent: setCurrent,
    clearCurrent: clearCurrent,
    listJobs: listJobs,
    activeDaysOf: activeDaysOf,
    jobsActiveOn: jobsActiveOn,
    allActiveDays: allActiveDays,
    jobByRef: jobByRef,
    progressOf: progressOf,
    activeKey: activeKey,
    setActiveJob: setActiveJob,
    createJob: createJob,
    deleteJob: deleteJob,
    jobKey: jobKey,
    updateDevice: updateDevice,
    markDone: markDone,
    arrivedFromList: arrivedFromList,
    progress: progress,
    isStarted: isStarted,
    progressFor: progressFor,
    recordProgress: recordProgress,
    setNotRequired: setNotRequired,
    undoDuplicate: undoDuplicate,
    splitDuplicate: splitDuplicate,
    addDevice: addDevice,
    editDevice: editDevice,
    fixesFor: fixesFor,
    removeDevice: removeDevice,
    extrasFor: extrasFor,
    clearProgress: clearProgress,
    reconcileFromCertificates: reconcileFromCertificates,
    applyProgressToCurrent: applyProgressToCurrent,
    // routing
    suggestSheet: suggestSheet,
    learnRoute: learnRoute,
    forgetRoutes: forgetRoutes,
    routes: routes,
    routeCount: routeCount,
    exportRoutes: exportRoutes,
    suggestFromRules: suggestFromRules,
    normalisedModel: normalisedModel,
    modelKey: modelKey,
    // handoff
    handoff: handoff,
    handoffUnit: handoffUnit,
    setLink: setLink,
    newUid: newUid,
    link: link,
    syncFromWorksheet: syncFromWorksheet,
    takeHandoff: takeHandoff,
    resumeFromLink: resumeFromLink,
    onChange: onChange,
    ddmmyyyyToIso: ddmmyyyyToIso
  };
})(typeof window !== 'undefined' ? window : this);

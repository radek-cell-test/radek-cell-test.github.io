# LabCal — offsets vault, jobsheet worklist, iPad saving, day panel (v1.531)

Load each offsets file **once, on the home page**. Every worksheet then picks it
up automatically until the reference thermometer's certificate expires.

## v1.531 — Non-Standard Medical Device: flexible Controller Offset Modes

The Controller Settings section no longer assumes every unit has Labcold's
Cal 1 / Cal 2 offsets. A new **Controller Offset Mode** selector sits in the
Controller Settings label, with three modes.

**Standard Air / Load Offsets** — unchanged behaviour, with the offsets
labelled **Air** and **Load** on the certificate as well as on the form
(they already read Air/Load on the form; the certificate said Cal 1 / Cal 2).

**Custom Offsets** — for controllers with different adjustment parameters.
The engineer names each parameter and records its initial and final value,
1 to 4 of them, with Add and Remove. The Air/Load dropdowns are locked and
cleared so they cannot contribute a stale value. These are documentary
settings: they are printed on the certificate under the names given, and
never touch the temperature calculations.

**No Controller Offset Adjustment Available** — for units whose controller
is locked, needs manufacturer software, or is simply not adjustable by the
engineer. The offset fields are replaced by a plain "Controller adjustment:
Not available" statement, nothing about offsets is required, and no final
offset or final set point is ever demanded.

Crucially, none of this touches measurement. Reference readings, probe
corrections, corrected Max and Min, the reference average, the difference
against the display and the tolerance verdict all run exactly as before in
every mode — measurement capability and adjustment capability are now two
separate things.

**Out of tolerance with no adjustment available** no longer tells the
engineer to do something they cannot do. Instead of "adjustment required",
As Found reads e.g. *"outside tolerance (difference 0.800 °C). Controller
offset adjustment not available — deviation documented."*, As Left is
declared not applicable and nothing in it is required — though it stays
open in case a second verification set is wanted — and the certificate
carries an automatic note recording that the unit was found outside
tolerance and could not be adjusted.

The automatic configuration line now also names the controller mode, and
the controller note is printed with it, above and separate from the
engineer's own comments, which are never touched.

The Initial set point stays required in every mode: it is what picks each
probe's correction, so it is a measurement input rather than an adjustment
one. The Final set point becomes N/A whenever no adjustment can be made.

## v1.530 — Non-Standard Medical Device: certificate output and mode logic corrections

**Chart Recorder underlining on the certificate.** A recorder mirroring both
Air channels prints them in the one Chart Recorder column as
`-35.936 / -35.924`, and the underline was being drawn across the whole
cell, so both channels appeared marked. Only the channel that actually won
is underlined now — the highest corrected maximum in blue, the lowest
corrected minimum in green — using Air's own selection, so the Chart
Recorder marks exactly what the Air column marks.

**Every column heading now shows its active tolerance**, on the worksheet
and on the certificate: `Air (±0.300 °C)`, `Air (±1.000 °C)`,
`Load (±0.300 °C)`, `Chart Recorder (±0.300 °C)`. A linked Chart Recorder
inherits the tolerance of the column it is based on, so Air on "No Decimal
Point" with the recorder based on Air prints `Chart Recorder (±1.000 °C)`.
There is now one function per column deciding the tolerance, and both the
calculation and the printed heading read it — the certificate reads the
heading straight off the worksheet, so the figure shown can never drift
from the figure applied. A column with no product display shows
`No Display` rather than a tolerance, so the certificate never implies a
comparison that did not happen.

**The selected configuration is recorded automatically.** The Air, Load and
Chart Recorder modes are written as, for example, *Configuration: Air –
Standard; Load – Load Fitted No Display; Chart Recorder – Based on Air
Readings.* It appears above the comments box on the worksheet and above the
engineer's comments on the certificate, and updates whenever a dropdown
changes. It is held in its own field, never inside the comments box, so it
cannot overwrite anything the engineer typed — or be overwritten by it.

**Columns with no display are now excluded from the adjustment decision**
rather than counted as a pass. Their Difference is N/A, is never treated as
zero, and never counts as a failure; the status bar says how many columns
were excluded and why. The reference chain — corrected maximum, corrected
minimum and reference average — is unaffected and continues to calculate,
which is what "Load Fitted No Display" has always needed.

**A Chart Recorder linked to a Load that is not fitted** now reads N/A
across the whole column instead of sitting blank, since it has no source to
derive from.

Verified against every one of the 45 combinations of the three dropdowns.

## v1.529 — Non-Standard Medical Device: mode logic corrected

Corrections to the Air/Load/Chart Recorder modes. No change to the shared
calculation functions — the modes only control which fields are available,
which are required, and where linked values come from.

**Tolerances are per-mode again.** Air's "No Decimal Point" widens **Air
only** to ±1.0 °C. Load and a Standard Chart Recorder are always ±0.300 °C
and always entered to one decimal place, exactly as on the Standard
Medical Device form. Previously Air's no-decimal setting also widened Load
to ±1.0 °C and switched it to whole degrees; that inheritance is removed.

**Chart Recorder "Based on Air Readings" and "Digital Chart Recorder Based
on Air"** now genuinely mirror the Air measurement system. The Chart
Recorder column splits into the same two channels Air uses — Air Left →
Chart Left, Air Right → Chart Right — and mirrors Reference Max, Probe
Correction, Max + Correction, Reference Min, Probe Correction and Min +
Correction across for both channels, read-only, along with the high/low
marks on whichever channel the average actually used. Average, Display and
Difference follow Air's. Everything re-links on every change. Previously
these fields were simply greyed out as N/A and only the finished average
was copied.

**"Digital Chart Recorder Based on Load"** mirrors Load the same way as a
single channel, with its Display taken from the Load Display cycle.

The certificate is unaffected: the Chart Recorder column's own field is
kept behind the mirrored cells carrying the combined value (e.g.
`5.000 / 5.100`), so the PDF still prints one Chart Recorder column with
exactly the layout it had before.

Switching a Chart Recorder out of a linked mode now clears the mirrored
figures, so a linked reading can never be left behind in a field the
engineer can type into — or printed on a certificate as if it had been
measured.

Verified against the worked example in the specification: Reference Max
5.000 + 0.038 = 5.038, Reference Min 4.000 + 0.038 = 4.038, Average 4.538 —
for Load Standard, Load Fitted No Display, and Chart Recorder Standard.

## v1.528 — Non-Standard Medical Device: Air/Load/Chart Recorder dropdowns redesigned per written spec

Replaces v1.527's Load and Chart Recorder options with the definitive set
from the user's written specification. Air Mode keeps the same behaviour
as before, relabelled to match:

**Air Mode**: Standard / **No Decimal Point** (was "No decimal point on
the display") / **No Display Fitted** (was "Not present") — same values,
same calculations, label only.

**Load Mode**: Standard / **No Load Fitted** (was "Not present") /
**Load Fitted No Display** (new — replaces v1.527's "No decimal point on
load"). "Load Fitted No Display" keeps Load's own Reference Max/Min
readings enabled and required, but disables and excludes only Load's
Display and Display-cycle fields — for units where Load's probe is fitted
but nothing shows its reading anywhere. This is independent of Air's own
Display setting.

**Chart Recorder Mode**: Standard (was "Digital recorder") / **No Chart
Recorder Fitted** (was "Not fitted") / **Chart Recorder Based on Air
Readings** (unchanged) / **Digital Chart Recorder Based on Load** (new) /
**Digital Chart Recorder Based on Air** (new — behaves identically to
"Chart Recorder Based on Air Readings"; the two are distinct dropdown
labels per the spec). v1.527's "Digital recorder with calibrate button"
option has been removed. Both new "Based on ..." modes dynamically mirror
their source's Average/Display every time a value changes — never a
one-off copy — and are read-only, matching "Chart Recorder Based on Air
Readings"'s existing behaviour.

Old saved jobs and Excel exports carrying any now-retired value (Load's
old "Two-point"/"Single point"/"No decimal point on load", or Chart's
"calibrate button") are reset to blank rather than guessed at, so the
mode-selection gate (added in v1.527) prompts a fresh, correct pick from
today's options.

## v1.527 — Non-Standard Medical Device: settings must be chosen before entering readings; Load and Chart Recorder options extended

Three changes, all confined to the Non-Standard Medical Device worksheet:

**Air, Load and Chart Recorder must now be selected before you can start
entering readings.** Previously the three settings dropdowns in the As
Found table header could be left on "-- select --" while numbers were
still typed into Reference Max/Min and Display — meaning readings could be
entered before the unit's actual configuration was chosen, and would then
be silently judged against whichever default happened to apply. Now
Reference Max/Min and Display for Air, Load and Chart Recorder all stay
locked (same greyed-out treatment as "load the offsets file first") until
all three dropdowns have a real selection, with a tooltip explaining why.

**Load's dropdown is now Standard / No decimal point on load / Not
present** — replacing "Two-point / Single point / Not present". This
matches the wording already used for Air's own Display setting, and gives
Load its own independent no-decimal-point option: whole-degree entry and
±1.0°C tolerance for Load's own readings, whether or not Air's Display has
decimals. (Air's own "No decimal point on the display" still widens Load
too, exactly as before, for models where Load reads the same onboard
display as Air — either setting alone is enough.) Old saved jobs and Excel
exports using the previous "Two-point"/"Single point" values are mapped
across automatically (Two-point → Standard, Single point → No decimal
point on load) so nothing already in progress is lost.

**Chart Recorder gains a fourth option: "Digital recorder with calibrate
button"**, alongside the renamed "Standard" (was "Digital recorder"),
"Based on Air readings" and "Not fitted". It behaves identically to
Standard — its own probe, its own Max/Min/Display readings, judged to the
usual ±0.300°C/1dp — the only difference is the label, for recorders
checked via their own built-in calibrate button rather than read as a
plain digital display.

## v1.526 — Non-Standard Medical Device: Air/Load/Chart Recorder settings laid out consistently

Purely a layout change, no calculation or tolerance behaviour altered.
Display's selector (Standard / No decimal point on the display / Not
present) moved out of the general job-details area and into the As Found
table header, directly under **Air** — the same place Load's and Chart
Recorder's own selectors already live. All three columns now present the
same way: a settings dropdown sitting right in that column's header, so
switching what's fitted for Air, Load and Chart Recorder reads as one
consistent row of controls instead of Display living somewhere else on the
form. As Left mirrors Air's choice with a small badge in its own header,
exactly as it already did for Load and Chart Recorder.

The explanatory note (previously a small aside next to the Display field)
now sits as its own line above the As Found table, and only appears when
Air's setting actually needs explaining (No decimal point, or Not
present).

## v1.525 — Non-Standard Medical Device: Display now has a "No decimal point" variation

The Display selector added in v1.524 (Standard / Not present) gains a third
option, matching the variation Standard Non-Medical already offers:

**"No decimal point on the display"** — for units whose onboard display only
ever shows whole degrees. Air's Display and Display cycle fields (and
Load's, since Load reads the same onboard display) switch to whole-degree
entry, and the tolerance for whatever is judged against that display widens
from ±0.300°C to ±1.0°C — the same reasoning already accepted for Standard
Non-Medical's own "No decimal point" variation, just extended to a display
that Air and Load can share. Chart Recorder's own digital readout, when
fitted independently ("Digital recorder" mode), is a separate instrument
and keeps its standard ±0.300°C and one-decimal entry regardless; when
Chart Recorder is instead "Based on Air readings", it inherits Air's
figures and tolerance exactly, as it already did.

The certificate's Air column header now also states its tolerance (e.g.
"Air (±1.0°C)"), matching the per-column headers Load and Chart Recorder
already show.

The previous "Fitted" option is now named "Standard" (same meaning, no
change in behaviour); a worksheet or Excel export already saved with the
old "Fitted" value is read back correctly on import.

## v1.524 — Non-Standard Medical Device worksheet: Load/Chart Recorder/Display now amendable per unit

The Non-Standard Medical Device worksheet (WS-07) is no longer just a copy of
Standard Medical — this is the first pass at what actually makes it
"non-standard": every unit on this sheet can differ in which columns are
fitted, so each of Load, Chart Recorder and Display now has its own
selector at the top of the AF table, and the worksheet adapts around
whatever is chosen. This is currently the only worksheet in the suite with
this flexibility.

**Load** — "Two-point (±0.300°C)" (the previous fixed behaviour), "Single
point (±1.0°C)" for units only calibrated at one load reading, or "Not
present" for units with no load position on this model at all. As Left
mirrors whichever tolerance was chosen for As Found.

**Chart Recorder** — "Digital recorder" (independent probe and readings, as
before), "Based on Air readings" for chart recorders with no probe of their
own, which copies Air's finished average/display/result rather than taking
separate readings, or "Not fitted" for units with no chart recorder at all.

**Display** — "Fitted" or "Not present", for units with no digital readout
on the unit itself. Air's (and, when applicable, Load's) own reading is
still taken and averaged as normal; simply nothing exists to compare it
against, so that comparison is treated as satisfied rather than leaving As
Found stuck incomplete. Chart Recorder's own digital readout (when fitted)
is a separate instrument and is unaffected by this.

Whichever columns are marked absent are disabled, greyed out and stamped
`-N/A-`, matching the treatment Standard Non-Medical already uses for its
own permanently-absent columns — the difference here is that on this sheet
it can be set per unit rather than being fixed for the whole worksheet. The
certificate's table headers show the tolerance actually used for each
active column (e.g. "Load (±1.0°C)"), and the status bar and As
Left "adjustment needed" wording adjust to name only the columns actually
fitted on that unit.

If a column already has readings typed in and the engineer changes their
mind about what's fitted, those readings are cleared and replaced with the
N/A stamp immediately — a switched-off column never carries old numbers
underneath the disabled state, and no stale pass/fail underline or tint
from before the switch can carry through to the certificate.

## v1.523 — Non-Standard Medical worksheet and certificate-number ordering, carried forward from v1.515

This suite's line had branched before v1.515, so it never picked up the two
things finished in that session. Both are now merged in:

**New worksheet: Non-Standard Medical Device** (`calibration_worksheet_NSMD.html`,
WS-07). It is a copy of the Standard Medical worksheet with nothing else
changed, so it behaves identically today — the starting point for the changes
that make it a non-standard sheet. It is registered for routing (manual
selection only — no model code routes to it automatically yet), offline
caching, text certificates and the offsets vault (Dostmann), and its
certificate is headed *Non-Standard Medical Device*.

Note the naming now in use: **Standard Medical**, **Non-Standard Medical**
(new) and **Standard Non-Medical** are three separate worksheets.

**Merged job PDFs and the job summary are ordered by certificate number**,
smallest first, certified units before anything still outstanding. The number
is read numerically, so S 51440 follows S 51439 rather than sorting beside
S 514.

This README's changelog below still reads as if v1.514 were current — the
entries for whatever shipped between v1.515 and v1.522 on this branch were
never written up here. Nothing in this release touches that gap; it only adds
the two items above on top of v1.522 as it stood.

## v1.44 — text by default, and the certificates panel sorted

**Text certificates are now the default** on a fresh device. Image is still
selectable, and Cloud Temp continues to produce image certificates because it
has no text version yet.

**The job bar had leaked into the certificates panel.** That is why *+ New job*
and *Load jobsheet* appeared down there — an earlier edit matched the header
markup of both panels and inserted the bar into each. Removed; the certificates
section now has only its own controls.

**A day picker that is always present.** Previously the day selector only
appeared once more than one day had certificates, so on a quiet day there was no
way to look at anything. Now there is a date field, a **Today** button when you
have navigated away, and shortcut buttons for the most recent days with counts.
A day with nothing on it reads plainly: *"Certificates — none on 01 Aug ·
0 certificates"*.

**Clearer header.** *"Certificates — today"* with *"3 certificates across 2 jobs
· 412 KB"* beneath, then the day bar, then one group per job with its own
**Merge job & share**.

## Version numbering

From here versions run **v1.500, v1.501, v1.502 …** — three digits, so there is
room for a lot of small releases before anything needs a bigger number.

## v1.514 — signature block locked, duplicates crossed off, status filter

**The engineer's name, signature and date are no longer typed on the sheet.**
They come from the offsets file and are locked. Who performed the calibration
and when are part of the record, not free text a later hand can change. The
date is the day the work is done.

The **checker's** name, signature and date stay open — that is somebody else's
to sign.

**Duplicated units on a jobsheet.** Where the same serial appears twice, the
first is kept and the rest are crossed off with a **duplicate** tag and the
reason shown. They stop counting as outstanding, and certifying one can no
longer look like certifying the other.

If the sheet was right and they really are two units, **Put back** restores one
and that decision sticks — recorded against the job and serial, so re-uploading
the same sheet tomorrow does not cross it off again. Two rows with the same
serial are indistinguishable, so the decision has to be recorded against the
serial rather than a row.

**Status filter.** Beside the search box: **All · To do · Started · Done · Not
required**, each with its count. Useful on a long job for seeing what is left
without reading every row.

## v1.513 — load a whole memory card on an iPad

Nothing was broken. **iOS Safari does not support folder upload at all** — the
"Choose folder" button relies on a feature Apple has never implemented, so on an
iPad it falls back to picking files, one folder at a time. On a laptop the same
button works normally.

**The way round it: zip the card.** In the Files app, long-press the card's
folder and choose **Compress**, then load the single `.zip`. Subfolders and all,
in one go.

The viewer unzips it itself using the browser's own decompression, so there is
no library to fetch and it still works with no signal. Both stored and deflated
entries are handled; `__MACOSX` and dot-files are skipped.

Tested on a real card zipped with two month subfolders and both compression
methods: **36 days loaded in one action**, with the incomplete-reading count
reported as usual. Loading plain CSVs is unchanged.

If the zip is very large, give it a few seconds — it is decompressing a few
hundred files on the iPad itself.

## v1.512 — the filename as a last resort

A certificate is matched to its unit in this order:

1. **Unit id** — assigned once, never changes. Nothing typed afterwards breaks it.
2. **Serial** — including every serial that unit has had.
3. **Job reference**.
4. **Filename** — new. The name is built from the serial and job number, so a
   certificate filed with an empty serial field often still carries it there.

The filename is deliberately last. It is made of exactly the things that get
corrected, so it is the weakest of the four — but it costs nothing and it
rescues records that would otherwise have nothing to match on. A match needs at
least four characters, so a short or blank serial cannot sweep up another unit's
certificate.

Tested with the worst case — no unit id, no serial, no job reference, only a
filename — and the certificate found its unit while a second unit on the same
job did not claim it.

### What is not possible

Remembering **where the PDF was saved** cannot be done on iPad. When a file goes
through the iOS share sheet, Safari never tells the page where it went — no
path, and no permission to read it back later. Desktop Chrome does have an API
that returns a durable handle, but iOS Safari does not support it, so it would
work on the laptop and not on the device the work actually happens on.

## v1.511 — the current certificate leads

**Merge job & share now takes one certificate per unit — the newest.** A pack
going to a customer should carry the current certificate for each unit, not the
superseded ones alongside it.

**On the unit's row**, only the current certificate is shown. Earlier ones fold
behind a small **+2 earlier** button and appear struck through when expanded.

They are still kept, not deleted. A superseded certificate may already have been
emailed to a customer, and a version that once left the building is worth being
able to look at. But it is out of the way, and out of the pack.

## v1.510 — storage can never block the PDF

v1.509 made the PDF wait for the certificate to be filed. That was right in
principle and wrong in practice: on iPad the storage request can hang
indefinitely — another tab holding the database, or Safari simply not
answering — and the PDF then never appeared at all. Generate went grey and
nothing happened. My fault, and a worse failure than the one it fixed.

Two limits now:

- **Opening the database gives up after 2.5 seconds**, and reports it, instead
  of leaving everything waiting on it. A locked database says which problem it
  is: *"Certificate storage is locked by another tab of this site."*
- **Filing gives up after 2.5 seconds** and the PDF carries on regardless. The
  hint says *"PDF saved, but certificate storage did not respond… use Find… on
  the unit if it is missing."*

Healthy storage is unaffected — the write takes milliseconds, so filing still
happens before the share sheet opens, which is the whole point of v1.509. The
timeout only matters when something is wrong, and then the PDF wins.

Tested both ways: with working storage the certificate is filed and the PDF
delivered in about a second; with storage that never answers at all the PDF is
still delivered and the button comes back.

## v1.509 — file the certificate before sharing it

**This is the one that was losing certificates.** The order was:

    generate → share (iOS share sheet) → file it → mark the unit done

The share sheet waits for the engineer. If you saved the PDF and then left the
page — tapped Back, switched tabs, went to the next unit — the storage write was
still pending and iOS abandoned it. The PDF was safely saved; the record of it
was not. That is why 27 certificates were in storage but the one just made was
missing, and why it failed *sometimes* rather than always: it depended entirely
on what you did next.

The order is now:

    generate → file it and WAIT for the write → mark done → share

By the time the share sheet opens, the certificate is already on the job. Leaving
the page at any point after that cannot lose it.

Applied to all five worksheets, on both the text and image paths.

Tested with a share sheet that never returns at all: the certificate is still
filed, still carries its unit id, and still appears on the unit's row.

## v1.508 — certificates linked by unit, not by serial

The redesign. Every one of the "certificate not showing" faults came from the
same weakness: certificates were matched to units by **serial number**, which is
precisely the thing that gets corrected, mistyped or repeated.

**Every unit now gets a permanent id** the moment it joins a job — read from a
jobsheet or added on site. Opening it hands that id to the worksheet, and the
certificate is filed against it.

The id never changes. So the link survives:

- correcting the serial, model or location afterwards
- a certificate number that repeats — `S 00000` on a verification sheet
- a mistyped or missing job reference
- reloading the same jobsheet the next day

Tested by breaking every old link at once: a certificate issued as `S 00000`,
then the unit's serial, model **and** location all changed to something
completely different. The certificate stayed on its unit. A second unit added
afterwards did not pick it up.

Serial matching is still there as a fallback for certificates issued before this
release, and **Find…** remains for anything that still needs attaching by hand —
attaching now writes the unit id, so it stays attached from then on.

## v1.507 — find a certificate and put it on its unit

A certificate that does not attach itself now has a **Find…** button on the
unit's amber chip. It lists everything actually in certificate storage — number,
serial, job reference and date — so you can see whether the record exists at all,
and **Use this** files it against that unit.

That answers the question the screen could not before. If the list is empty it
says so plainly: *"Nothing else is in certificate storage on this device — the
PDF was saved out, but no record of it was kept here."* If the record is there
with details that do not match, one tap fixes it.

Re-filing keeps what the certificate was originally filed under, so nothing is
lost by correcting it.

### A bug found while testing this

Attaching a certificate showed it **twice**. Filing it triggers a refresh while
the handler is already reloading, and both loads were writing into the same
object. The load now builds its result separately and only publishes it if it is
still the most recent — the last write wins instead of two interleaving.

## v1.506 — a corrected serial no longer strands its certificate

The diagnostic added in v1.505 found it on the first try: the unit showed
*"S 12345 not stored on this device"* — and, beside it, the **edited** tag.

The certificate had been issued, then the serial was corrected. Certificates
were matched to units on the **current** serial only, so one issued beforehand
matched nothing and appeared to be missing.

A unit now answers to every serial it has had: the one printed on the jobsheet,
any it was corrected from, and its current one. The certificate reattaches and
carries a small **as OLD-123** tag, so the serial it was issued under stays
visible rather than being quietly rewritten — the certificate itself still says
the old number, and the page should not pretend otherwise.

Reproduced from the screenshot before fixing: certificate issued under one
serial, serial corrected, certificate stranded. It now shows on the unit's row.

## v1.505 — say why a certificate is missing

A certificate not appearing on its job has had three different causes so far,
and every one of them looked identical on screen: an empty row. This release
makes the app say which it is.

**On the worksheet.** If a certificate cannot be filed, the hint beside the
buttons now says so — *"PDF saved, but this browser will not store it, so it
will not appear on the job list."* The PDF itself is unaffected; it has already
been saved or shared by that point. Previously this failed to a console warning
nobody sees.

**On the job page.** If certificate storage is unavailable, or reading fails, a
red note explains it rather than the page simply looking empty. And a unit that
is certified but has no certificate on file shows an amber chip —
*"S 51430 not stored on this device"* — instead of a blank row.

Neither of these fixes a cause. They turn a silent failure into a message that
says what to do, which is the difference between a five-minute check and a long
guess at whose fault it is.

## v1.504 — the certificate was filed under the wrong job

Not the page failing to refresh this time — the certificate really was being
filed against the **previous** job.

Opening a unit filled the worksheet's header only where a field was **empty**.
But the worksheet's own autosave had already restored the last unit worked, so
the job reference box still held the earlier job's ENQ number, and the fill left
it alone. The certificate was then filed under that old reference and never
appeared on the new job.

Arriving from a job list, that list is authoritative: model, serial, location,
site and job reference are now **overwritten**, not just filled when blank.
Applied to all four converted worksheets.

Reproduced first — first job ENQ111 left in the autosave, second job ENQ222
opened — and confirmed the worksheet now reads ENQ222 and the certificate lands
on the right job.

**Safety net.** A certificate now counts as belonging to a job if it carries the
job reference **or** its serial matches one of that job's units. Anything that
arrives under a different reference still shows on its unit's row, tagged
*other job ref* with the reference it was filed under. A certificate that
exists should never be invisible.

**Smaller correction boxes.** The Edit fields were far too large on a tablet —
now sized to their content: model 140 px, serial 190 px, location filling the
line beneath.

## v1.503 — a new certificate shows up without being chased

A certificate generated on a worksheet did not appear on the job page when you
came back. The certificate was filed correctly — the page simply never learned
about it. Two causes, both fixed:

**Safari's back-forward cache.** Going back restores the page exactly as it
was, without re-running any script, so the job page showed what it showed
before you left. It now re-renders on `pageshow` when the page was restored
from cache, and on regaining focus.

**No cross-tab signal.** Certificates live in IndexedDB, which fires no event
other tabs can hear — so a calibration page open in a second tab never found
out. Filing a certificate now also writes a `localStorage` ping, which does
travel between tabs, and the calibration page redraws when it sees one.

Tested with two pages sharing one storage: with the job page open and
untouched, generating a certificate in the other tab made it appear on the
unit's row on its own. Same after a simulated back-forward restore.

## v1.502 — a job is one page

The certificates panel is gone from the job view. **Each unit now carries its own
certificate on its own row** — a green chip with the certificate number and
**View** and **Share**. A superseded one sits beside it, struck through and
labelled, so an amended unit shows both.

Everything else about the row is unchanged: Open, Reopen, ✕ not required, Edit,
the tags and the search all work as before.

**One file from one place.** **Merge job & share** is now in the job header
beside **Job summary PDF**. It produces the summary followed by every
certificate on the job.

Certificates belonging to the job but matching no unit — usually a serial
corrected after the certificate was issued — are listed under **Other
certificates for this job** rather than disappearing.

**The calendar opens on the month**, with **Two weeks** to fold it down.

## v1.501 — tidier calibration page

**Worksheet tiles fold away.** Work now starts from a job, so the six worksheet
cards are collapsed behind **Show** at the top of the page. They stay available
for opening a sheet on its own, and the page remembers whether you left them out.

**The correction form says what each box is.** Model, Serial number and Location
are labelled, and the heading names the unit — *"Correct X-99"*. Before, the
fields were only distinguishable by their placeholder text, which disappears as
soon as there is a value in them, so on an existing unit it was three unlabelled
boxes.

**The job dropdown is gone.** Switching jobs is what the day view is for, and
having a second way to do it invited exactly the mix-ups the redesign was meant
to remove. The job view now has a back button and **Replace jobsheet**, nothing
else.

## v1.500 — the calibration page is now a day, then a job

Two levels, one thing on screen at a time. The old layout showed one job's units
above *every* job's certificates, which is what made it easy to mix up.

**The day.** A calendar — two weeks by default, **Month** for the full grid —
with a dot under any day that has work on it. Under it, the jobs worked that
day as cards: reference, site, and `1 of 3 done · 1 left · 1 not required`, with
a progress bar. Arrows step a day at a time, or a month at a time in month view.
There is a date picker and a **Today** button.

A job appears on **every day it was actually touched** — opened, certified,
marked not required, corrected — so a job running Monday to Wednesday shows on
all three, and Wednesday shows what you really did that day.

Certificates on a day that belong to no job get their own **No job reference**
card rather than being hidden.

**The job.** Tap a card and you get that job: the unit list exactly as before,
and **only that job's certificates** beneath it. A back button returns to the
day. Loading a jobsheet drops you straight into its job.

### Fixed on the way

- **The data logger viewer would not load anything.** Merging the two copies in
  v1.46 left two variables undeclared in the newer file's `ingest`, so it threw
  on the first file. Declared, and empty log files are now reported as *empty*
  rather than *skipped* — only a genuine read failure counts as skipped.
- One tap on the calendar's back arrow jumped five months, because the day view
  re-bound its handlers on every render. Same fault as the earlier "+ Add unit"
  bug: bind only when the markup was actually replaced.

## v1.47 — merged job PDF opens on its summary

**Merge job & share** now puts the job summary in front of the certificates.
One file that opens on the list of every unit — model, serial, location,
worksheet, status, certificate number — with the totals across the top, then
each certificate behind it in order.

If the summary cannot be built for any reason the merge still runs; the cover
is skipped rather than the whole file failing.

Verified that the cover lands first. The certificate pages after it use the
same merge path as before, which was verified separately — the test harness
cannot exercise both together because it clones stored files in a way pdf-lib
rejects.

## v1.46 — one data logger viewer, not two

The copy of the viewer bundled in the suite was an older build: 19 range, 24
range and T3, but none of the IBB Blood Bank work — no Eurotherm parser, no HMI
audit trail, no clock-reset detection, no dual per-channel alarm limits. The
good version had been developed separately and never folded back in.

They are now one file. The newer viewer is the base, with two things carried
across into it:

- **the 10 range parser** added in v1.45
- **the iPad share sheet** for the chart PNG and summary CSV, which the newer
  standalone build predated

The four existing parsers — `parseCsv`, `parseIBB`, `parseIBBEventLog` and
`parse24` — were checked byte-for-byte against the uploaded file and are
**identical**. Only three lines were removed anywhere in the merge, all of them
in the two places the change belongs.

Two copies of the same tool drifting apart is the pattern that caused several
bugs earlier in this suite. Worth keeping to the one file from here.

## v1.45 — 10 range logs in the data logger viewer

The older pharmacy fridges are now readable alongside the 19 and 24 ranges.

**The format.** One file per day named `YYMMDD.csv`, no header row, carriage
returns instead of newlines, eleven fields per line:

    time, T1, T2, D, C, F, I, H, L, B, P

`T2` reads `-273.1` when no second probe is fitted. The eight flags are the
ones Labcold's own Internet-Explorer-only viewer used, which identifies them by
letter: **D**oor, **C**ompressor, **F**an, **I**?, **H**igh alarm, **L**ow
alarm, **B**attery, **P**ower. Older cards write those letters (or blanks)
instead of 1 and 0, and both encodings are accepted.

**I have not labelled flag I** — the original viewer only gives the letter and
I would be guessing. It is parsed and carried through, so naming it later is a
one-line change. Worth confirming what that channel is on the controller.

**Readings written without their leading digit.** Some files contain values
like `  .8` where `3.8` was meant. These are **left out rather than read as
0.8**: plotting them would invent a low-temperature excursion that never
happened, which on a fridge review is worse than a gap. The load message says
how many were dropped.

Checked against a full card: 191 files, 186 parsed, 5 genuinely empty, none
unreadable, 647 incomplete readings identified and excluded.

## v1.44 — text certificates by default

**Text is now the default certificate style** on a device that has not chosen
otherwise. It applies to Barkey, Standard Medical, Standard Non-Medical and the
19/24 Range; Cloud Temp still produces the image version on its own, so nothing
breaks there. Image remains selectable on the home page if a particular customer
ever wants it.

**Certificate panel.** The day now reads as an explicit count — *"Certificates —
today · 0"* — rather than "none yet today", so a day with nothing on it is a
state you can see. The date picker and Today button were already there and are
unchanged. The panel carries no job controls: new job and load jobsheet belong
to the worklist above and appear only there.

## v1.43 — edits carry both ways, and a simpler worksheet toolbar

**The remaining sync fault.** Correcting a serial on the job list did not reach a
worksheet that had **already been started**. The cause: the worksheet restores
its saved readings after filling in the header, and that snapshot was saved with
whatever serial the unit had at the time — so an old snapshot quietly reinstated
the old serial.

The job list is now treated as the source of truth for identity: after the
readings are restored, the model, serial, location, site and job reference are
re-applied from the list over the top. Tested on the exact sequence — start a
calibration, correct the serial on the main page, reopen the unit: the corrected
serial appears **and the readings are still there**.

**Simpler toolbar.** Worksheets now show **Save to job list** and **Generate
PDF**, with everything else — Excel export and import, print, start new
calibration, load offsets, load jobsheet, load saved — folded behind **More…**.
Nothing is removed; the fold just remembers whether you left it open.

## v1.42 — worksheet and job list kept in sync

Opening a unit from the job list now **links** the worksheet to that unit, and
the link is stored rather than held in memory, so it survives moving between
the two pages.

**Save to job list** — a new button beside *Generate PDF* on every worksheet.
Correct the serial, model or location on the worksheet, press it, and the job
list is updated: the row shows the corrected details, carries the **edited**
tag, and keeps *"jobsheet read …"* underneath. It also runs automatically when a
certificate is generated, so the certificate can never be filed against a serial
the list does not have.

Both directions were tested:

- correct on the **worksheet** → back to the list, the row is updated and tagged
- correct on the **list** → open the unit, the worksheet opens with the
  corrected serial and location, and the certificate ties to it

If a worksheet is opened directly rather than from a job, the button says so
instead of failing quietly.

## v1.41 — an "edited" marker

A unit you have corrected now carries a purple **edited** tag, and its line
shows what the jobsheet originally said: *"jobsheet read 20800627_4000029"*.
Holding the tag shows which fields changed and when.

It is stored on the unit and on the job, so it survives:

- opening a worksheet and coming back to the list
- switching to another job and back
- re-uploading the same (still wrong) jobsheet the next day

The job summary PDF already showed the original serial beneath a corrected one,
so a customer or an assessor can see the discrepancy rather than having it
quietly overwritten.

## v1.40 — the stale-script fault (important)

**"LabCalVectorPdf.blobJobSummary is not a function"**, and Save doing nothing,
were the same fault: the service worker served **our own JavaScript cache-first**
while serving the HTML network-first. So an up-to-date page could load against
last week's copy of its own modules, and any newly added function simply did not
exist. Nothing on screen suggested anything was wrong.

Same-origin files are now fetched **network-first**, exactly like the pages, and
fall back to cache only when there is no signal. The page and the scripts it
depends on move together.

This was not a one-off: every feature added since text certificates was exposed
to it. If anything else has behaved oddly on the iPad while looking fine on the
laptop, this was probably why.

**Belt and braces:** each action now checks that the function it needs actually
exists, and if not says so in plain language — *"labcal_jobsheet.js is out of
date on this device… tap Refresh offline copy"* — rather than throwing a
developer error or silently doing nothing.

**Edit form relaid out.** Model and serial on the first line, location on a full
width line beneath with Save and Cancel, instead of three fields squeezed onto
one row. Saving returns to the normal view.

## v1.39 — correcting a jobsheet, and the end-of-day summary

**Correcting a unit.** Every row has **Edit**, which opens an inline editor for
model, serial and location. Jobsheets carry wrong serials often enough that this
had to be fixable on site.

Changing a serial is not just a label change, because progress is keyed by
serial. The correction carries with it:

- the unit's **certified / not required** state
- any **part-finished worksheet** saved against the old serial
- its entry if it was **added on site**
- and the correction is **remembered against the job**, so re-uploading the same
  (still wrong) jobsheet tomorrow keeps your version instead of re-adding the
  unit under its typo

The serial as printed on the jobsheet is kept alongside, and shown on the
summary as *"jobsheet read SN-88211"*. If the unit was already certified, the
message says plainly that the certificate already issued still carries the old
serial — that is a document that has left the building, and the app should not
pretend otherwise.

**Job summary PDF.** A **Job summary PDF** button on the job panel produces an
end-of-day sheet: every unit numbered, with model, serial, location, which
worksheet it took, its status and its certificate number. Totals across the top
— *14 units · 8 certified · 2 not required · 4 outstanding* — amber while
anything is outstanding, green when the job is finished. Certified rows are
green, not-required rows greyed, started rows amber. It paginates for long jobs
and each page carries the job reference and site.

About 6 KB, and it reads the job straight from the worklist, so it cannot
disagree with the panel on screen.

## v1.38 — why those buttons did nothing, and proper multiple jobs

### The bugs

**The red ✕ did nothing** because it used a native `prompt()` to ask for a
reason. iOS suppresses `prompt()` in an installed web app, so the dialog never
appeared, the call returned nothing, and the code treated that as "cancelled".
No dialogs are used in the job panel at all now — pressing ✕ opens a small
amber strip in the row with a reason box and Confirm/Cancel, and removing a unit
asks in the same way.

**Adding a unit did nothing** for a different reason. In the empty state the
button handlers were re-attached on every render instead of only when the markup
changed, so a second render left two copies on each button — and "+ Add unit"
toggled the form open and immediately closed again. Both branches now bind only
when the markup was actually replaced.

Both were tested with `prompt()` and `confirm()` deliberately throwing, which is
how an installed iOS web app behaves.

### Multiple jobs

The page now holds as many jobs as you like, each with its own unit list and
progress:

- **A job selector** at the top of the panel: `ENQ139969 — Optegra Eye Hospital ·
  1/4 · 2 left`. Switching is instant and each job remembers its own state.
- **+ New job** starts one by hand with a reference, site and date — for work
  with no jobsheet.
- **Load jobsheet** creates a job, or merges into the one already there.

**Merging by job reference.** Upload the same jobsheet tomorrow and it merges
into the existing job rather than starting a second copy: certified units keep
their ticks and certificate numbers, units marked not required stay marked,
units added on site stay on the list, and anything new on the sheet is appended.
Tested with a revised sheet carrying an extra unit — the extra appeared, nothing
else moved.

## v1.37 — the worklist becomes a job control panel

**Not required.** Every outstanding unit has a red **✕**. Press it and you are
asked for an optional reason — not on site, customer declined — and the unit is
struck off with a *not required* tag and the reason shown beneath it. It stops
counting as outstanding but stays visible, and **Put back** undoes it. The mark
is stored against the job, so it survives reloading the jobsheet tomorrow.

**Add a unit on site.** *+ Add unit* takes a model, serial and location and adds
it to the current job, tagged *added on site*. It routes itself to the right
worksheet by the same rules as everything else, and it comes back when the
jobsheet is loaded again. Only hand-added units can be removed; jobsheet units
stay put.

**Search.** A box filters by serial, model or location — useful once a job runs
to a dozen units. The count beside it reads "3 of 14" while filtering.

**Clearer progress.** The line now reads *"1 of 4 done · 2 left · 1 today ·
1 not required"*, with **how many are left** in bold, since that is the number
that matters when you are deciding whether you can leave site. The bar shows
settled units in grey behind the green.

### Bugs caught while building it

Two, both found by testing the module directly before touching the interface:
units added on site were lost when the jobsheet was reloaded, and undoing a
*not required* mark left the unit still flagged, because clearing the mark
removes the stored record and the code treated a missing record as "no change".

## v1.36 — main page tidied

**Settings fold away.** *Certificate PDF* and *Backup & restore* are things you
set once and leave, so they now live behind a **Settings** button and stay
collapsed. The drawer remembers whether you left it open.

Two exceptions, because a folded setting is a setting you forget: the button
line always shows **how long since the last backup** and which certificate style
is selected, and the drawer **opens itself** if you have never backed up or the
last backup is more than a week old — the point at which browser storage starts
clearing.

**Offset tiles are about half the height.** Each is now one row: name and
description on the left, the day countdown on the right where it still reads as
the biggest thing on the tile, then the details and buttons beneath. The
countdown, the colour coding and the recalibration warning banner are untouched,
since those are the parts that earn their space.

**Smaller hero.** The heading is one line instead of two and roughly a third of
the previous size, the lede is shorter, and the background trace is smaller and
fainter. Around 70 mm of vertical space recovered before you reach the offsets.

## v1.35 — Standard Medical text certificates

Four of the five worksheets now produce text certificates. The setting reads
**Text (all except Cloud Temp)**.

Standard Medical shares its layout with Standard Non-Medical, so rather than a
second near-identical generator there is now one builder with the differences
declared in a small spec:

| | Standard Medical | Standard Non-Medical |
|---|---|---|
| Tolerance | fixed ±0.300 °C | depends on device type |
| Offsets | Cal 1 and Cal 2 | single field |
| Extra field | Calibration System | Non-Standard Variations |

Everything else — the four columns, the instrument block, the banners, the
comments and signatures — is the same code.

**Banner wording now prefers the worksheet's own.** The certificate was
substituting its own concise line, which lost a distinction that matters: "As
Found not yet complete" is not the same as "adjustment carried out". The screen
wording is used whenever it fits on one line, with the concise version as
fallback.

Every worksheet was generated in every state — normal, failing, verification
code, long comments, and mid-adjustment — and all land on a single page except
a genuinely long comment, which continues to page 2 as intended.

## v1.34 — everything on one page

The Non-Medical certificate was running to two pages. Three changes, each of
which also tightens the other sheets:

**Left/Right moved into the probe cells.** The coloured L and R dots now sit
beside each probe serial instead of occupying a whole sub-header row — about
9 mm saved per certificate, and it reads more directly: the marker is next to
the thing it labels.

**One-line status wording.** The certificate now writes its own concise line —
*"Adjustment not needed — As Found within tolerance ±3.0 °C. As Left not
applicable."* — rather than reproducing the fuller sentence the worksheet shows
on screen. The screen keeps the longer wording, which is more useful while
you're working.

**Tighter top.** A couple of millimetres out of the header and the variations
line.

Result: Non-Medical, 19/24 and Barkey are all single page with a normal comment.
A genuinely long comment still continues to page 2, as it should.

### A bug this shook out

Moving comments above the signatures meant the comments box no longer left room
for the signatures beneath it — on a long comment the sign-off ran 7 mm off the
bottom of the page. The generator's own overflow check caught it. The 19/24
sheet now uses the same shared comments-and-signatures block as the others,
which reserves that space properly.

## v1.33 — comments above signatures, and Standard Non-Medical text certificates

**Comments now sit above the signatures**, on the certificates *and* on the
worksheets themselves (19/24 and Non-Medical). They read as part of the record
rather than an afterthought below the sign-off.

**Standard Non-Medical Device generates text certificates.** The setting reads
**Text (19/24, Barkey, Non-Medical)**; SMD and Cloud Temp still use the image
path. Roughly 19 KB. It carries the device type and its tolerance in the
subtitle, the Non-Standard Variations line, and the Air / Load / Chart Recorder
column layout, with Load and Chart Recorder printing as N/A where they do not
apply to the unit.

The Final set point on this worksheet also gained the **nearest offset point
used**, matching the 19/24 sheet.

### Under the bonnet

Rather than copy the 19/24 table code, the measurement table is now one shared
`makeTable()` that takes a description of the column bands — two-column groups
get the Left/Right sub-header automatically. Comments-and-signatures and the
status banners are shared too. Three duplicated copies of that logic was how the
green-instead-of-red bug got in, so this is deliberate.

The refactor was checked by rendering the 19/24 certificate before and after and
comparing pixel by pixel: **identical**.

Status banners also wrap now instead of running off the right edge — the
Non-Medical "Load and Chart Recorder are not applicable" line was long enough to
overflow.

## v1.32 — 19/24 instrument block, and the final offset point

**The 19/24 certificate now has the same bordered block as Barkey**, with the
reference thermometer brought in off its own floating line. Four labelled rows
in one border:

| | |
|---|---|
| **Digital Reference Thermometer** | serial, cal due, validity badge |
| **Room Temperature (RT)** | RT ref, badge, cal due, max, min, average |
| **Controller Settings** | initial offsets, initial set point, nearest offset point |
| | final offsets, final set point, nearest offset point |

**Nearest offset point on the Final set point.** The worksheet only showed this
for the Initial set point, but the As Left corrections are taken from the point
nearest the *final* set point, so it is worth stating. Added to **both the
worksheet and the certificate** — the certificate reads it from the page rather
than working it out separately, so the two cannot disagree.

On a sheet needing no adjustment the final row stays as N/A chips, as before.

## v1.31 — verification worksheets, and a tidier Barkey header

**The all-zero sheet code now carries through.** Entering `B 00000` or
`S 00000` retitles the worksheet as a *Verification* worksheet on screen, but
the text certificate was still printing "Calibration". It now reads the live
title from the page, so the PDF says **Engineer Verification Worksheet** to
match. A normal sheet number is unaffected.

**Barkey header tidied.** Engineer and Reference thermometer have come out of
the field grid — the engineer is already in the signature block, and the
thermometer now has a proper row of its own. The header block is two labelled
rows in one border:

| | |
|---|---|
| **Digital Reference Thermometer** | serial, cal due date, validity badge |
| **Room Temperature (RT)** | RT ref, validity badge, cal due, max, min, average |

That leaves the field grid as job reference, date, site, department, model and
serial number.

## v1.30 — one standard header on every certificate

Barkey now carries the same header as the 19/24 sheet: **"Engineer Calibration
Worksheet"** on the left with the worksheet name beneath it, and the **LABCOLD
wordmark on the right with the certificate number underneath**.

Rather than copying the layout into each generator, there is now a single
`drawHeader()` that both call. They cannot drift apart, and the three worksheets
still to be converted will inherit the same header for free.

## v1.29 — failures now show as failures on the 19/24 certificate

A real bug, and a bad one on a calibration document: **the text certificate
painted the Difference of Average row green and the status banner green
regardless of the result.** A unit that failed on screen — red row, red banner,
adjustment required — printed as though it had passed.

The cause was mine: I hard-coded those colours instead of reading what the
worksheet had already decided. The generator now takes the state from the
worksheet's own `ok`/`bad` classes, so the certificate cannot disagree with the
screen:

- **Difference of Average** is tinted per column (Air and Load can differ), red
  when out of tolerance, green when in.
- **Status banners** go red with red text when the worksheet says adjustment is
  required, and carry the worksheet's own wording.
- **The high/low markers** (blue on the highest corrected maximum, green on the
  lowest corrected minimum) now read the worksheet's `selectedHigh` and
  `selectedLow` flags rather than being recalculated here.
- **The As Left section** takes its crossed-out state from the worksheet's
  `notNeeded` flag. Previously it inferred it from whether readings had been
  typed, so a sheet needing adjustment but not yet filled in printed as
  crossed out.

Verified both ways: in tolerance (green throughout, As Left crossed out) and
out of tolerance (red banner, red difference row, As Left live and awaiting
readings).

## v1.28 — no timestamp, and Barkey matched to the 19/24 layout

**The "Generated <date time>" line is gone.** On a UKAS document a timestamp
later than the calibration date invites questions an engineer should not have to
answer — a certificate regenerated to correct a typo would appear to have been
produced days after the work. It is a one-line switch
(`SHOW_GENERATED_STAMP` in `labcal_vector_pdf.js`) if it is ever wanted back.
Page numbering on two-page certificates is unaffected.

**Barkey now follows the 19/24 layout.** It gained:

- the **reference thermometer row** — serial in a pill, cal due date, validity
  badge — instead of being buried in the header fields
- a bordered **Room Temperature (RT)** row with the thermometer pill, its
  validity badge, cal due, max, min and average on one line
- **status banners** above each section: green *"As Found: every check within
  specification"*, or red *"one or more checks outside specification —
  adjustment required"*, and the same before As Left

Checked both ways: with everything in tolerance (five green ticks, green
banners, As Left greyed as N/A) and with the heating display deliberately out
(pink row, red cross, red banner, and the As Left section unlocked and live).

## v1.27 — text certificates for Barkey

The Barkey worksheet now generates text certificates too. The setting reads
**Text (19/24 + Barkey)**; the other three worksheets still use the image path.

**11 KB** for a Barkey certificate — it is a shorter sheet than the 19/24.

Everything from the worksheet carries over: the reference/correction/window
calculations, the specification text on each row, the pass and fail marks
(drawn, not typed, so they cannot come out as stray characters), the greyed-out
As Left block when no adjustment was required, the stopwatch check, and the
cursive signature. Long comments overflow to a second page exactly as on the
19/24 sheet.

Four things fixed while building it, all found by generating from the live
worksheet rather than a mock-up: the snowflake was drawn over the wordmark; the
"Ref. cal due" cell picked up the validity badge text instead of the date; the
stopwatch times showed a dash instead of zero seconds; and the required-field
markers sat after the colon instead of before it.

## v1.26 — long comments no longer disappear

**The bug:** the text generator capped the comments box at four lines and threw
away anything beyond that, without saying so. Write a long note and the
certificate came out looking like the version before you wrote it.

Now the box grows to fit what you have written. If it will not fit on page 1,
page 1 shows *"Comments — continued on page 2"* and the **whole** comment is
printed on a second page, headed with the certificate number, site, serial and
job reference so a loose sheet is still identifiable.

**Also added: a "Generated <date time>" line** at the bottom of every text
certificate. Regenerating a certificate produces the same filename as before, so
two versions were impossible to tell apart once saved. Now they are.

### If a regenerated certificate still looks like the old one

Check the Generated line at the bottom first — that tells you which copy you are
looking at.

- **On the iPad**, saving over a file of the same name can leave Files showing
  the old preview. Open it from the Files app rather than the preview, or save
  under a new name and delete the old one.
- **In the day panel**, regenerating for the same job and serial marks the older
  certificate *superseded* and keeps both. Make sure you are sharing or merging
  the current one, not the superseded row above it.
- **Merging** works per job. Two certificates only merge together if they carry
  the same job reference; a blank job reference puts one in its own group.

## v1.25 — text certificate fixes from the first real one

Three things the first genuinely generated certificate exposed:

**The room temperature row was unreadable.** The RT Ref box, its validity badge
and "Cal due" were all printed on top of each other, because the thermometer is
named `UKAS107 (valid until Aug/2026)` — far longer than the box allowed for.
The serial alone is now shown (`UKAS107`); the validity is already in the badge
beside it, so nothing is lost. Boxes and badges also shrink their text to fit
rather than overflowing.

**Stray apostrophes before "Valid to ...".** The tick character is not in the
PDF's built-in font, so it printed as a stray glyph and threw the letter spacing
out. The tick is now drawn as two short lines instead of typed.

**Max and Min in the room temperature row** no longer have a green background,
as asked — they read as plain white cells like Average.

One self-inflicted wound worth recording: the fix for the tick stripped every
character outside Latin-1, which also removed the em dash from "Adjustment not
needed — Air and Load...". The filter now removes only what the font genuinely
cannot draw (ticks, arrows, symbols) and keeps dashes and quotes.

## v1.24 — the Image/Text switch actually appears

v1.23 shipped the text certificate generator but **not the control to turn it
on** — the home page still showed only "Certificate PDF size" with Standard /
High / Maximum. My fault, and worth recording how it happened.

An earlier edit inserted a block of code after every occurrence of the text
`renderPdfQuality();`. That string appears inside the function's own body as
well as at the call site, so the block was inserted three times, nested inside
itself. The file still parsed — the copies ended up in different scopes — so the
syntax check passed. The v1.23 edit that was supposed to add the switch then
failed to match the mangled text and did nothing, silently.

Fixed: the duplicated blocks are stripped out and one clean copy is in place.
The panel is now titled **Certificate PDF** with two dropdowns — style
(Image / Text) and, for image mode, quality.

Also corrected: the home page self-check was looking for
`labcal_vector_pdf.js` and `labcal_font_dancing.js`, which only the 19/24
worksheet loads, so it would have reported two missing files that were not
missing. The home page now checks only what it loads; the worksheet checks its
own two and says so in the hint beside the buttons if Text is selected but the
files did not load.

## v1.23 — text certificates (19/24 Range)

The 19/24 worksheet can now draw its certificate as **real text** with jsPDF
instead of screenshotting the page. About **18 KB** instead of ~400 KB, and the
numbers are selectable, searchable and sharp at any zoom.

**Choosing it.** *Certificate PDF* on the home page switches between **Image
(all worksheets)** and **Text (19/24 Range)**. Image stays the default until you
have compared a few. The other four worksheets ignore the setting and always use
the image path — they are not converted yet.

**It cannot cost you a certificate.** If anything goes wrong building the text
version, the error is logged, you get a message, and generation falls straight
through to the image path that has always worked.

**New files:** `labcal_vector_pdf.js` (the generator) and
`labcal_font_dancing.js` (the signature font — Dancing Script pinned to weight
600 and subset to signature glyphs, 28 KB instead of the full 133 KB family,
embedded once per document).

### Known limitations

- 19/24 Range only.
- The layout is fixed rather than reflowing. Comments are capped at four lines,
  and an unusually long site name or model could crowd its field. The generator
  logs a warning if content ever runs past the page edge.
- Checked against S 51430 from ENQ142086: same readings, same corrections, same
  markers, same status text.

## v1.22 — telling you when something didn't load

Every shared module was written to degrade gracefully if it is missing. That is
right in principle, but it meant a file that never got uploaded failed silently
— and a missing `labcal_pdf.js` quietly restores the old ~1 MB certificates with
nothing on screen to say so.

Now:

- The home page shows a **red banner listing any shared file that did not
  load**, what it breaks, and what to do about it.
- Each worksheet's PDF hint states the setting in force —
  *"quality: Standard (1.7×, q0.82)"* — or warns outright that `labcal_pdf.js`
  is not loaded.
- After generating, the hint shows the **actual size of the file just created**,
  so there is no guessing.

### If certificates are still ~1 MB

1. Check the footer of the home page reads **v1.22**. If it shows an older
   version, the browser is serving a cached copy: open the page online, tap
   **Refresh offline copy**, then close every tab of the site and reopen.
2. Check the home page shows a **Certificate PDF size** panel. If it is missing,
   `labcal_pdf.js` was not uploaded — the red banner will say so.
3. Open a worksheet and look at the hint next to the buttons. It names the
   quality in force.

## v1.21 — smaller certificate PDFs

The worksheets are captured as an image and wrapped in a PDF, so file size
comes down to two numbers: capture scale and JPEG quality. Every worksheet
shipped with **scale 2 and quality 0.98**, which is where the ~1 MB came from.
JPEG quality above about 0.90 spends a lot of bytes on detail that simply is not
there in flat black text and table rules.

Measured on a rendered certificate page — dense small text, table rules, shaded
pass/fail cells, cursive signature:

| Setting | Scale | Quality | Resolution | Size |
|---|---|---|---|---|
| Maximum (the old setting) | 2 | 0.98 | ~192 dpi | 605 KB |
| High | 2 | 0.92 | ~192 dpi | 425 KB (30% smaller) |
| **Standard (new default)** | 1.7 | 0.82 | ~163 dpi | **273 KB (55% smaller)** |

163 dpi still prints cleanly — 150 dpi is the usual floor for text. On your real
certificates, expect roughly 1 MB to become **400–450 KB**, and a 13-unit job to
drop from about 13 MB to 5–6 MB.

**Certificate PDF size** on the home page switches between the three. Maximum is
the old behaviour exactly, so nothing is lost if a customer wants a crisper
copy. The setting applies to all five worksheets, including the Cloud Temp
multi-page capture.

Don't take my word for the numbers — the day panel shows the actual size of
every certificate, so generate one before and after and compare.

## v1.20 — backup size fix (important)

v1.19 embedded the certificate PDFs in the backup. With 13 certificates that
produced a **23 MB single-line JSON**, and the iPad Files app crashed every time
it tried to preview it. My mistake — base64 also inflates every PDF by a third,
so the file was worse than the sum of its parts.

**Certificate PDFs are no longer put in the backup.** The same device now
produces a **41 KB** file instead of 22.6 MB.

The reasoning: a backup should hold what exists *nowhere else* — offsets,
learned routing, worklist progress, part-finished worksheets. Certificates are
finished documents you already save and share from the calibration page, where
each job merges into a single PDF. Their **details** are still in the backup
(job, serial, certificate number, time), so job progress ticks still rebuild
after a restore.

Backups written by v1.19 still restore correctly — the reader still understands
an embedded PDF, the writer just never produces one. There is also now a warning
if a backup somehow exceeds 2 MB, before it gets saved.

### If a 23 MB backup is stuck on your iPad

Do not tap the file. In Files, tap **Select**, tick it, and delete — selecting
never opens a preview. If Files crashes on launch, force-quit it first (swipe up
and hold, swipe the card away), or force-restart the iPad. If the file went to
iCloud, deleting it from iCloud.com on a computer avoids the iPad opening it at
all.

## v1.19 — backup & restore

Everything this suite remembers lives in browser storage, which iPadOS clears
after about a week away from the site. **Back up now** on the home page packs
the lot into one file and sends it through the share sheet — save it to Files or
iCloud and it lives off the iPad.

What goes in: both offsets files, the learned routing, the current worklist and
its cross-day progress, part-finished worksheets, and certificate details.
(Certificate PDFs are not included — see v1.20 above.)

The panel tracks when you last backed up — plain under 3 days, amber up to a
week, red past that with a reminder about what iPadOS does.

**Restore merges. It never deletes anything already on the device.**

| | |
|---|---|
| Offsets | taken when the slot is empty or the backup's copy is newer |
| Learned routing | merged, newer entry wins |
| Job progress | union — a unit ticked in either place stays ticked |
| Worklist | only loaded when none is open, so a job in hand is never swapped out |
| Worksheet snapshots | taken when absent or newer |
| Certificates | added when not already present, matched on filename and time |

Before anything is written, it shows exactly what the file contains — offsets
and their validity, how many routes, which job, how many part-finished
worksheets and certificates — and asks. Restoring the same file twice changes
nothing the second time. Files that are not LabCal backups, or come from a newer
version, are refused rather than half-applied.

Tested by filling a device, backing it up, wiping it completely, and restoring:
offsets, worklist, progress, routing, part-finished readings and the certificate
PDF all came back byte-for-byte, and the calibration section unlocked itself
again.

## v1.18 — jobs that run over several days

Reload the same jobsheet tomorrow and the ticks come back. Progress is kept
against the **job**, not against the loaded worklist, and merged in whenever
that jobsheet is loaded again. A different job with the same serial is not
affected — the record is keyed by job reference *and* serial.

The progress line now breaks the tally down, e.g.

> 3 of 5 done · 1 today · 2 on earlier days · 1 started

Rows carried over from a previous visit are tagged with the date they were
certified. A unit with readings entered but no certificate yet is tagged
**started**, and the progress bar shows that as an amber section ahead of the
green — so a unit half-done when you ran out of time on Tuesday is obvious on
Wednesday. The panel heading says "continued" when part of the tally came from
an earlier day.

Certificates are treated as the real evidence: if the progress record is ever
lost, the ticks are rebuilt from the certificates on file for that job.

**New routing rule.** Model codes ending in **10** — FO110, FO210, FO310 and so
on — go to Standard Non-Medical. It is checked after the MD rule, so an
"…10MD" code still goes to Medical.

⚠️ Note this also catches **RLDG1010**, the model on ENQ139969. If that one
should not be Standard Non-Medical, say so and I will narrow the rule to the FO
family only. In the meantime, routing it by hand on the worklist overrides the
rule permanently for that model.

## v1.17 — reopen and amend a unit

Each worksheet used to autosave into a single slot, so starting the next unit
wiped the previous one's readings. Snapshots are now kept **per unit** — keyed
by worksheet + job reference + serial — and saved as you type.

**Reopening.** Tap a unit on the worklist (finished units say "Reopen") and the
worksheet comes back with everything still in it: readings, probe selections,
comments, certificate number. There is also a **Reopen** button on each row of
the certificate list, for going back to a unit whose jobsheet you have since
replaced. A banner at the top of the worksheet says what was restored and when.

**Amendments don't overwrite history.** Generating again for the same job and
serial marks the earlier certificate **superseded** rather than deleting it —
it was a real document and may already have been sent. Both stay in the panel,
the superseded one dimmed and labelled, so it is obvious which is current. You
can still delete it by hand if it never left the iPad.

The same key includes the job reference, so calibrating the same fridge on a
later visit starts clean rather than pulling up last time's readings.

Snapshots are pruned after 30 days. **Cloud Temp is not covered yet** — its
worksheet builds channel rows dynamically and needs its own handling; say the
word and I will do that one next.

## Version numbering

Renumbered to the 1.x scheme at v1.16 and counting up from there; this build is
**v1.17**. Earlier
releases in these notes were numbered 1.2–1.6; they are the same builds, just
renumbered so there is plenty of room before 2.0. The `sw.js` CACHE_VERSION is a
separate counter — it only has to differ from the previous one to force a
refresh, and is now **v11**.

## v1.16 — two fixes

**Wrapped serials no longer create phantom units.** A long serial in a narrow
table cell wraps onto a second line in the PDF. The tail arrived as its own row
with no model, and became a second unit with a stub serial — so ENQ139969 showed
two units when it has one. Tails are now stitched back onto the serial above
them, and rows with no model and only a stub serial are dropped as table noise.
That jobsheet now reads correctly as one unit, `761503260747PW-LC` / RLDG1010.

Note the serial keeps the hyphen, because that is what the PDF's text layer and
the printed page both show. If it should really be `761503260747PWLC` with no
hyphen, say so and I will strip it on the join.

**More than one job a day.** The certificate panel is now grouped by job. Each
group shows its ENQ number, the site, how many certificates and their size, and
has its own **Merge job & share** button. The merged file is named after the
job — `ENQ139969_certificates_2026-08-13.pdf` — so two jobs on the same day can
never be confused. Certificates generated without a job reference are grouped
under "No job reference". **Clear day** still clears the whole day.

## v1.6 — routing rules and feedback

Three rules are now built in, on top of the named-kit ones:

| Model code | Worksheet |
|---|---|
| ends in **19** or **24** (0119, 0219, 0519, 1019, 1519 and the 24s) | 19/24 Range |
| ends in **MD** | Standard Medical |
| **LPTU0008** | Barkey |

Matching is done on the model code with spaces, dashes and case stripped, so
"RLDF 15-19", "rldf1519" and "RLDF1519" all behave the same. The MD rule is
checked before the 19/24 rule — a code ending "MD" cannot also end in "19" or
"24", so they can never both fire, but the order makes that explicit. If you do
have codes like **RLDF1519MD**, tell me which way they should go.

**Corrections beat rules.** If a rule sends something to the wrong worksheet and
you change it, that choice is remembered and wins from then on.

**Sending the learned data back.** At the bottom of the worklist panel there is
now a line showing how many models have been learned, with **Export routing**.
That produces a JSON file (through the usual share sheet) containing, for each
model: what you chose, what the built-in rules would have said, whether the two
agree, how many times it has been used, and — where relevant — what rule your
choice overrode. The `disagreeWithRules` and `notCoveredByRules` totals at the
top are the entries worth acting on. Send me that file and I will fold it into
the built-in rules.

The export contains equipment model codes and routing choices only. No customer,
site, job reference, serial or location data goes into it.

**Reset learned** clears everything the app has worked out, leaving the built-in
rules in place.

## v1.5 — today's certificates

Below the worklist on the calibration page there is now a panel listing every
certificate generated today: filename, time, site, model, serial and size. Each
one has **View** (opens it in a tab, no second download), **Save / Share** (the
same iOS share sheet), and **Delete**.

**Merge all & share** staples the whole day into a single PDF and hands it to
the share sheet — one file to email or file at the end of a run. It uses the
same pdf-lib engine as the merge tool, served from your own site rather than a
CDN so it works offline, and only downloaded when you actually press the button.
An unreadable certificate is skipped rather than sinking the whole merge.

If you worked on previous days, a day selector appears so you can go back.
Records older than 14 days are pruned automatically.

**Read the yellow note on the panel.** This is a convenience buffer held by the
browser, not an archive. iPadOS clears it after about a week away from the site,
and so does anything that clears site data. Save each certificate properly the
same day — the panel says so on screen for exactly this reason. A storage
failure here can never lose you a certificate: the file is saved or shared
first, and filing it in the list is a separate, non-fatal step afterwards.

## v1.4 — saving files on iPad

**The constraint:** a web page cannot choose a save folder on iPad. Safari has
no save-file picker, and Chrome on iPad is Safari underneath, so it inherits the
same limit. That part cannot be coded around.

**What now happens instead:** every generated file goes through
`labcal_save.js`, which picks the best route the device actually offers.

- **Desktop (Chrome/Edge)** — the native save dialog, exactly as before.
- **iPad** — a bar appears at the bottom: *"PDF ready — Save / Share"*. Tapping
  it opens the iOS share sheet, where **Save to Files** lets you choose any
  folder, including iCloud, OneDrive and Dropbox. Or send it straight to Mail
  without saving first. There is also a **Download** button on the bar if you
  just want the old behaviour.
- **Anything else** — a plain download, unchanged.

The extra tap is deliberate and unavoidable: iOS only allows a share that comes
from a fresh tap, and generating a PDF takes long enough that the original
button press has gone stale. Cancelling the share sheet leaves the bar up so the
file is never lost.

This covers **PDF and Excel from every worksheet**, the **merged PDF** from the
merge tool, and the **chart PNG and summary CSV** from the data logger viewer.

## v1.3 — jobsheet worklist

Load the jobsheet PDF **once, on the calibration page**. It becomes the day's
worklist: every unit on the sheet gets a row, routed to the correct worksheet,
and opening one carries the customer, job reference, model, serial and location
straight into the header. No jobsheet? The panel stays out of the way and you
pick a worksheet exactly as before.

**Routing.** I only know three rules for certain (Barkey, Cloud Temp, Thermo/
Monitor Max), so anything else asks you the first time — and then remembers it.
Pick "Standard Medical" for an RLDF1010A once and every future jobsheet routes
that model itself. The learned list lives in `labcal.jobsheet.routes`; the
hard-coded rules are the `RULES` array at the top of `labcal_jobsheet.js` if you
would rather state them outright.

**Ticks.** Generating a certificate ticks that unit off the worklist and records
its certificate number, so the panel always shows what's left.

**Safety.** A device is handed to a worksheet exactly once, and only ever fills
fields that are empty — reopening a worksheet can never overwrite readings you
have already taken.

The parser is the same one that was already inside the worksheets (four jobsheet
layouts plus a generic fallback), moved into `labcal_jobsheet.js` unchanged so
there is now one copy instead of five.

## v1.2.1 — frozen tiles fix (iPad)

v1.2 had a bug that froze the tiles whenever **two or more tabs of the site were
open at once**. The vault checked whether storage was usable by writing a
throwaway key on *every read* — and that key sat inside the range of keys the
other tabs were watching. So each tab's read woke the other tab, which read,
which woke the first one back, hundreds of times a second. Tiles were rebuilt
mid-tap (hence frozen and jittering) and taps landed on elements that no longer
existed. Closing every tab cleared it because the loop needs two tabs to bounce
between.

Fixed three ways: the storage check now runs once per page and writes outside
the watched key range; change listeners ignore anything that isn't one of the
two ecosystem keys and skip redundant redraws; and tiles are only rewritten when
the markup has actually changed, so a redraw can never swallow a tap.

Also: an open worksheet no longer rebuilds its dropdowns unless the offsets file
genuinely changed, so a probe you have already selected mid-job stays selected.

## Upload these files

Everything in this folder goes to the same directory on your site. The files
that actually changed:

| File | What changed |
|---|---|
| `labcal_offsets.js` | The shared offsets vault. Must sit next to the HTML files. |
| `labcal_jobsheet.js` | Jobsheet parser, worklist and worksheet routing. |
| `labcal_save.js` | Save/share routing, including the iOS share sheet. |
| `labcal_certs.js` | The day's certificate list (IndexedDB), job grouping and merge. |
| `labcal_units.js` | Per-unit worksheet snapshots for reopening and amending. |
| `labcal_backup.js` | One-file backup and merging restore. |
| `labcal_pdf.js` | Certificate PDF quality, and the image/text style switch. |
| `labcal_vector_pdf.js` | **NEW** — text-based certificate generator (19/24 Range). |
| `labcal_font_dancing.js` | **NEW** — subset signature font for text certificates. |
| `pdf-lib.min.js` | **NEW** — PDF merge engine, lazy-loaded only when merging. |
| `index.html` | Offsets panel with countdown + warnings; Calibration section locks until a file is loaded |
| `calibration.html` | Jobsheet worklist panel; each worksheet card locks unless *its own* ecosystem's file is loaded |
| `monitoring_systems.html` | Same gating for Cloud Temp |
| `barkey_calibration_form.html` | Auto-loads Dostmann offsets from the vault |
| `calibration_worksheet_SMD.html` | Auto-loads Dostmann offsets |
| `calibration_worksheet_SNMD.html` | Auto-loads Fluke & Comark offsets |
| `calibration_worksheet_19_24.html` | Auto-loads Fluke & Comark offsets |
| `cloud_temp.html` | Auto-loads Fluke & Comark offsets |
| `sw.js` | Cache bumped to **v57**; same-origin files network-first |
| `data_logger_viewer.html` | Chart PNG and summary CSV go through the share sheet on iPad |
| `pdf_merge_reorder.html` | Merged PDF goes through the share sheet on iPad |
| `tools.html` | Unchanged — included so the folder is complete |

After uploading, open the home page once while online so the service worker
picks up v57, then hit **Refresh offline copy**.

## Which file unlocks what

| Ecosystem | Unlocks |
|---|---|
| **Dostmann** | Barkey · Standard Medical Device · Non-Standard Medical Device |
| **Fluke & Comark** | Standard Non-Medical · 19/24 Range · Monitoring Systems (Cloud Temp) |

The two are never interchangeable — loading a Fluke file into the Dostmann slot
is refused with a clear message, and vice versa.

## Countdown and warnings

The vault counts down to the **last day of the "valid until" month**.

- more than 60 days left → green "Valid to Mon/YYYY"
- 60 days or less → amber "N days left" on the home page
- 14 days or less → red pulsing warning on the home page **and** an amber strip
  at the top of every worksheet
- expired → everything using that file locks; no PDF or Excel can be generated

## Notes

- Storage is the browser's `localStorage` for this site, so it is per-device and
  per-browser. iPad Safari clears it after about 7 days with no visits to the
  site — **this is what Backup & restore is for.** Back up at the end of a job
  and the offsets, progress and part-finished work all survive.
- The "Load offsets" button on each worksheet still works and now **writes back
  to the vault**, so loading a file on any worksheet updates all the others.
- If `labcal_offsets.js` is ever missing, nothing locks up: the pages fall back
  to the old per-worksheet behaviour.

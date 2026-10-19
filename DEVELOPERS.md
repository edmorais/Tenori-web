# Tenori-Loop for the web — developer notes

How the web version is built and tested. For how to use the app, see README.md.

The Android build of Tenori·Loop, rebuilt as one HTML page. It keeps the
16 × 16 matrix, the four layers, the six voices, the twelve scales and twelve
keys, swing, the tempo-locked ping-pong echo, the eight pattern slots and the
plain-text `.tnl` format. Bell and Pluck are new voices.

Open `TenoriLoop-standalone.html` in a browser, or use the published artifact.
Press **PLAY** first: browsers only start sound after a tap or a click.

## What changed from the Android build

**Responsive layout.** The page picks one of three arrangements from the
window:

| Window | Layout |
| --- | --- |
| taller than wide | display on top, matrix full width, layer keys, then a tabbed deck (VOICE, SCALE, MIX, FILE) |
| wider than tall, or shorter than 820 px | matrix full height on the left, display and tabbed deck on the right; the deck scrolls inside itself, the page does not |
| 980 × 820 or larger | matrix on the left, all four control pages open at once, keyboard help shown |

In portrait the matrix gives back a few pixels when the deck would run past the
screen, down to 85 % of its width. Only very short phones (360 × 640) scroll.

**More skeuomorphic.** The interface is now an instrument body: a machined
graphite case with four screws and its name, TENORI-LOOP, engraved small in
the top margin in every layout, a recessed matrix window of frosted silicone
keys (unlit, as dark as the earlier flat pads), each standing in its own well with a visible side wall; a lit key
shines through its face from an LED behind it, its sides glow and light spills
into the well, a sounding note flashes white-hot at the core, and a key you
hold sinks into its well, a teal vacuum-fluorescent display with
a live scope, keys that travel when pressed and carry LEDs, fader slots with
ridged caps and a printed scale, and a small piano keyboard for the key. The
LÖVE build's teal accent and layer colours are kept, so it reads as the same
app. Beat columns are a shade lighter, a tick marks every beat and a dot marks
every root row.

**Bell.** The old Bell was two-operator FM with an inharmonic 3.5 : 1 ratio
and an index of 4.2, which put most of the attack on sidebands that don't
belong to the note. The new Bell is built from the modes of a struck metal bar
(ratios 1, 2, 2.756, 5.404, 8.933, as on a glockenspiel). Each mode decays at
its own rate, the high ones first. A near-unison twin of the fundamental beats
slowly, like the doublet of a real bell. A short self-modulation on the
fundamental gives the mallet's brightness for the first 90 ms.

**Pluck.** The old Pluck rounded the string to a whole number of samples and
didn't compensate the half sample of its averaging filter, so it went flat as
it went up. At 44.1 kHz it was 13 cents flat at A5 and 44 cents flat at D6.
The new Pluck is an extended Karplus-Strong string:

- an allpass filter supplies the fractional period, so every note is in tune;
- the loop gain is solved from NOTE LENGTH, with the averaging filter's own
  loss at the fundamental taken out;
- the pick is noise darkened in proportion to the pitch, so a low string isn't
  hiss and a high one isn't dull, and accents pick brighter;
- a pick-position comb hollows the harmonics a pick near the bridge wouldn't
  excite;
- every pick has new noise, so repeated notes are not identical;
- the excitation is normalised, so all pitches start equally loud.

The other four voices, the clock, the echo and the soft clipper are the LÖVE
code, ported line for line.

## How the audio works

The engine (`dsp.js`) is plain JavaScript with no browser calls. The page runs
it in an **AudioWorklet**, loaded from a `blob:` URL, then a `data:` URL. If
the browser refuses both, it runs the same engine in a **ScriptProcessor**.
The sequencer clock counts samples inside the engine, as in the LÖVE build.
Each step comes back with the context time it plays at, and the matrix lights
it only when `getOutputTimestamp()` says that time is reaching the speaker. So
the lights follow the sound, not the screen's frame rate.

Phones get 24 voices and desktops 32. When all voices are busy, the quietest
one is taken.

## Saving

| | |
| --- | --- |
| working pattern | saved 0.4 s after each change and when the page is hidden; restored on the next visit |
| slots 1–8 | **STORE**, then a slot. Tap a lit slot to load it |
| text | **COPY** puts the pattern on the clipboard; **TEXT** shows it for pasting back; ctrl+C / ctrl+V copy and paste it when nothing is selected |
| files | **OPEN** a `.tnl` file, or drop one anywhere on the page |

All of these live in the browser's storage for this page, on this device.
The pattern itself has no Save-as-file button: COPY or TEXT gives you the
file's text, and every audio export (below) carries the `.tnl` too.

## Saving audio

**RENDER TO AUDIO** on the FILE page (or **w**) turns the pattern into a 48 kHz,
16-bit stereo WAV. A second copy of the engine renders it offline, faster
than real time, so the file is what you hear: the same voices, swing, echo
and master level. Muted layers stay out. Everything is computed in the
browser; nothing is uploaded.

| Control | What it does |
| --- | --- |
| PASSES 1× 2× 4× 8× | how many times round the 16 steps |
| RING OUT | starts from silence, then lets the last notes and echoes fade out (up to 8 s) |
| LOOP | plays one pass first and throws it away, then keeps exactly the chosen passes, cut on the samples where step 1 fires. The file starts with the previous pass's echoes already sounding, so it repeats cleanly in a sampler or a DAW |

The file is named from the pattern, for example
`tenori-loop_A-minor-pent_112bpm_2x_loop.wav`.

**Where the file goes.** The standalone page downloads the `.wav`. The
published artifact can only hand over files through the viewer's save
dialog, and `.wav` isn't one of the types it allows, so there you get a
`.zip` holding the `.wav` and the pattern's `.tnl`. It is stored, not
compressed, so it unzips instantly and the audio is untouched.

If the peak reaches full scale, the display says so: lower MASTER for
headroom. The soft clipper still keeps the file from hard clipping.

The format is the LÖVE build's: integer values, then each layer as 16 lines of
`.` and `#`, highest row first. The parser builds the whole new state and
checks every field before it touches the live pattern, so a bad file changes
nothing and the display says what was wrong.

## Keys

| Key | Action |
| --- | --- |
| space | play / stop |
| 1–4 | select layer (tap a selected layer key again to mute it) |
| m | mute the layer |
| c, shift+C | clear the layer, clear all |
| r | random line on the layer |
| ↑ ↓ | tempo |
| ← → | mode |
| [ ] | key |
| shift+1–8, alt+1–8 | load slot, store slot (ctrl+1–8 also stores, where the browser allows it) |

## Files

    README.md           the user guide
    DEVELOPERS.md       these notes
    dsp.js              the audio engine and sequencer clock
    app.html            markup and styles
    app.js              matrix, controls, layout, storage, text format
    build.py            inlines both into TenoriLoop.html (artifact) and
                        TenoriLoop-standalone.html (opens from disk)
    test/audio.js       pitch, level and decay of every voice, offline
    test/engine.js      clock, swing, gain staging, CPU cost
    test/ui.py          Playwright: plays, paints, edits, saves, reloads
    test/export.py      Playwright: renders WAVs and zips through the buttons
    test/shots.py       screenshots at six window sizes
    shots/              the screenshots

## Tests

    node test/audio.js 48000      # also 44100 and 96000
    node test/engine.js
    python3 build.py && python3 test/ui.py
    python3 test/export.py
    python3 test/shots.py

**Audio** (all passing at 44.1, 48 and 96 kHz). Every voice is rendered at five
pitches from A2 to D6 and its pitch is measured by autocorrelation. The worst
error for the new Bell and Pluck is 1.2 cents. The Bell's and Pluck's decay
follows NOTE LENGTH within about 10–25 %, measured to −60 dB of the peak.

**Engine.** 10 checks, all passing:

- 16ths at 120 BPM are exactly 125 ms apart;
- swing lengthens and shortens alternate steps but keeps the pair length;
- with all 1,024 cells lit, echo and master at 100 %, the output stays
  within ±1 and has no NaN, for every voice;
- play restarts from step 1; nothing steps while stopped.

CPU on this machine, 32 voices, every cell lit at 240 BPM: Bell 6 %, other
voices under 2 % of one core. Two findings fixed on the way: spent bell modes
and the echo feedback were sinking into denormal numbers (a hundredfold
slowdown), and the engine first ran 25 times slower because of global lookups,
so it now lives in a closure.

**Interface.** 37 checks in headless Chromium, all passing, on both audio
paths:

- the demo pattern makes sound and the step readout follows it;
- stop lets notes ring out to silence;
- click, a fast drag with no gaps, and erasing drags;
- layers, mute, voices, octave limits, piano key, mode, faders by drag and
  keyboard, keyboard shortcuts;
- store, clear, recall a slot exactly; reload restores the pattern and slots;
- 12 malformed files refused without a crash, the live pattern untouched,
  Windows line endings accepted.

**Audio export.** 28 checks, all passing:

- the WAV is 48 kHz, 16-bit stereo, and its notes land on the sixteenth grid
  to within a millisecond;
- RING OUT is the passes plus a fade that ends in silence;
- LOOP is exactly N passes long to the sample (102,857 frames for one pass at
  112 BPM), opens already sounding, and its end-to-start jump is no larger
  than an ordinary sample step;
- an empty pattern, or one only on muted layers, is refused with a message;
- through a stand-in for the published page's save dialog: the `.zip` is
  valid with correct CRCs, holds the WAV and a `.tnl` identical to the
  pattern, and declining the save says so and frees the button;
- worst case, 56 s of audio (8 passes at 40 BPM, dense bells, full echo)
  renders in about 4 s.

**Layout.** Screenshots at 1440 × 900, 1280 × 720, 390 × 844 (phone),
844 × 390 (phone landscape), 820 × 1180 (tablet) and 360 × 640. None scrolls
sideways. Only 360 × 640 scrolls at all.

## What was and wasn't verified

**Verified:** everything above, in headless Chromium (Playwright 1.56) with the
two typefaces served locally, since this machine can't reach Google Fonts.
Touch taps and tab changes at phone size.

**Not verified:**

- **Nobody listened to it.** The new voices were measured, not heard.
- **No real phone, Safari or Firefox.** Safari's AudioWorklet and
  `getOutputTimestamp` are the likeliest places for a difference; the
  ScriptProcessor path exists for a browser that refuses the worklet.
- **The published artifact's sandbox.** If its policy refuses worklet modules
  from `blob:` and `data:` URLs, the page falls back to the ScriptProcessor,
  which has more latency. The console says which path it took.
- **The real save dialog.** The zip path was tested against a stand-in that
  follows the published `downloads` contract, not against claude.ai's own
  dialog.
- **Files from the LÖVE build.** The format was rebuilt from the earlier
  conversation, not from its source. The field names `swing`, `len`, `echo`
  and `master` and the highest-row-first order are my reading of it. The
  parser also accepts `notelen` and `length`, but a LÖVE file with the rows
  the other way up would load upside down.

# Tenori·Loop - Web

Tenori-Loop is a light-up step sequencer that runs in your browser. You paint
notes on a 16 × 16 grid of pads, and it plays them back in a loop. Each lit pad
flashes as its note sounds.

It has four layers, six instrument voices, twelve scales in any key, swing and
a stereo echo. It works on phones, tablets and computers, and there is nothing
to install. When a loop sounds good, you can save it as an audio file.

Tenori-Loop is inspired by the Tenori-on, the light-up matrix instrument that
was created by Toshio Iwai and Yamaha.

You can try it here! <https://edmorais.github.io/Tenori-web/>

Built iteratively with Claude Opus 5.5.


---

## Getting started

1. **Open Tenori-Loop.** Use the published page, or open
   `TenoriLoop-standalone.html` in an up-to-date browser such as Chrome, Edge,
   Firefox or Safari.
2. **Press PLAY.** Browsers allow sound only after you tap or click, so the
   first press also switches the sound on.
3. **Change the pattern while it plays.** Tap pads to add or remove notes.
4. **Press STOP** to stop. Notes that are already sounding fade out naturally.

The first time you open Tenori-Loop, a short demo pattern is loaded. After that,
it opens with the pattern you were working on last.

---

## The grid

- **Columns are steps in time.** The 16 columns make one bar of 16th notes.
  While the pattern plays, a soft light moves across the columns. The short
  marks above the grid show the beats (every fourth step).
- **Rows are notes.** The bottom row is the lowest note and the top row is the
  highest. All rows are notes of the scale you chose, so every note fits. The
  teal dots on the left mark the key note, for example every A in A minor.
- **Low notes sit to the left and high notes to the right** of the stereo
  field. The first step of each beat plays slightly louder.

### Drawing notes

| To | Do this |
| --- | --- |
| Add a note | Tap or click an unlit pad |
| Remove a note | Tap or click a lit pad |
| Draw a line of notes | Drag across unlit pads |
| Erase a line of notes | Start the drag on a lit pad |

On a touch screen you can draw with several fingers at once. When you light a
pad, you hear its note (once the sound is on).

You always draw on the **current layer** (see below). Notes on the other layers
show as a small coloured glow inside the unlit pads, so you can see how the
layers fit together.

---

## Layers

Tenori-Loop has four layers. Each layer has its own pattern, voice and octave.
For example, you can use one layer for a bass line, one for a melody and the
other two for chords or effects.

| Layer | Colour | Demo setting |
| --- | --- | --- |
| 1 | amber | Pluck |
| 2 | blue | Sine, one octave down |
| 3 | pink | Triangle, one octave up |
| 4 | green | Bell |

The four layer keys under the grid show each layer's voice and octave.

- **Tap a layer key** to draw on that layer.
- **Tap the selected layer key again**, or press **MUTE**, to mute that layer.
  Its notes stay on the grid, dimly lit, but they do not play. Do the same
  again to unmute it.

---

## The controls

On a phone or a small window, the controls are on four pages: **VOICE**,
**SCALE**, **MIX** and **FILE**. Tap a tab to change page. On a large screen,
all four pages show at the same time.

### VOICE: the sound of the current layer

Choose one of six voices. When you press a voice key, you hear a sample note.

| Voice | Sound |
| --- | --- |
| **Sine** | A pure, soft tone. Good for bass and gentle backgrounds. |
| **Tri** | Mellow and slightly hollow, like a soft flute or an old game console. |
| **Saw** | Bright and buzzy. It cuts through the mix. |
| **Square** | Hollow and reedy, the classic chiptune sound. |
| **Bell** | A struck metal bar, like a glockenspiel or a celesta. It rings on after the note. |
| **Pluck** | A plucked string, like a harp or a nylon guitar. Notes on the beat are picked a little brighter. |

- **OCTAVE − / +** moves the current layer down or up, by up to two octaves.
- **CLEAR** removes all the notes on the current layer.
- **RANDOM** writes a random melody on the current layer. It replaces the notes
  that were there.
- **NOTE LENGTH** sets how long the notes ring, from very short (5%) to very
  long (100%). It applies to all layers.

> CLEAR, RANDOM and loading a pattern cannot be undone. To keep a pattern
> before you try something, store it in a slot first (see FILE).

### SCALE: the key and the scale

- **The small keyboard** chooses the key, that is, the note the scale starts
  on.
- **MODE ◀ ▶** steps through the twelve scales.
- The line below lists the notes in the scale. It also gives the lowest note of
  the current layer.

| Scale | Character |
| --- | --- |
| Major | Bright and happy |
| Natural Minor | Sad or serious |
| Harmonic Minor | Minor, with an exotic, dramatic step near the top |
| Dorian | Minor, but lighter. Common in jazz, funk and folk |
| Phrygian | Dark, with a Spanish or Middle-Eastern colour |
| Lydian | Dreamy and floating |
| Mixolydian | Major, with a relaxed, bluesy feel |
| Major Pentatonic | Five notes. Open and folk-like |
| Minor Pentatonic | Five notes. The rock and blues favourite |
| Blues | Minor pentatonic plus the "blue" note |
| Whole Tone | Six equal steps. Hazy and unresolved |
| Chromatic | All twelve notes. Anything goes, including clashes |

**Tip:** The pentatonic and blues scales almost never sound wrong, so they are
a good place to start. They also give the grid the widest range, more than
three octaves from the bottom row to the top.

When you change the key or the scale, the pads stay where they are and the
notes follow. This is a quick way to hear the same pattern in a new mood.

### MIX: tempo, groove and effects

| Fader | What it does | Range |
| --- | --- | --- |
| **TEMPO** | Speed, in beats per minute | 40–240 BPM |
| **SWING** | Delays every second step, which gives a shuffle or groove | 0–70% |
| **ECHO** | A stereo echo that bounces left and right. It is timed to three steps and follows the tempo. Higher settings give louder and longer repeats. | 0–100% |
| **MASTER** | Overall volume | 0–100% |

To set a fader, drag its cap, or tap anywhere along its slot to jump there.
With a keyboard, select the fader with Tab. Then use the arrow keys to move it
by 1, Page Up and Page Down to move it by 10, and Home and End to go to either
end.

### FILE: patterns and audio

#### Pattern slots

There are eight slots for patterns. A slot's light is on when it holds a
pattern.

- **To store a pattern:** press **STORE** (its light turns on), then press a
  slot. A pattern already in that slot is replaced.
- **To load a pattern:** press a slot that has its light on. If the music is
  playing, the new pattern takes over without a break.

#### Sharing patterns as text

A pattern is a short piece of plain text. You can paste it into a message or a
note, and load it again later or on another device.

- **COPY** copies the current pattern to the clipboard.
- **TEXT** shows the pattern in a box. You can read it, edit it or paste
  another pattern into it. Then press **LOAD THIS TEXT**. The box also has a
  **CLEAR ALL** key, which empties every layer.
- **Paste** a pattern anywhere on the page with Ctrl+V (Cmd+V on a Mac).
- **OPEN** loads a pattern file (`.tnl`). You can also drag a `.tnl` file onto
  the page.

If a pattern cannot be loaded, the display says why, and your current pattern
does not change.

#### Render to audio

This section saves the loop as a stereo WAV file (48 kHz, 16-bit). The file
sounds the same as what you hear in the app, with the same voices, swing, echo
and volume. Muted layers are left out.

1. Choose the number of **PASSES**: 1, 2, 4 or 8 times through the 16 steps.
2. Choose how the file starts and ends:
   - **RING OUT** starts from silence and lets the last notes and echoes fade
     away at the end. Use it to listen to or share a finished piece.
   - **LOOP** is cut exactly on the start of the pattern, with the echoes from
     the pass before already sounding. Use it in a sampler, a looper or music
     software, where the file repeats with no gap or click.
3. Press **SAVE AUDIO**.

The line under the controls gives the length of the file. The file is made on
your own device, in a second or two. Nothing is uploaded.

| Where you use Tenori-Loop | What you get |
| --- | --- |
| The standalone file | A `.wav` file, which downloads directly |
| The published page in Claude | A `.zip` file that holds the `.wav` and the pattern (`.tnl`). Confirm the save in the dialog that opens. |

The file name describes the pattern, for example
`tenori-loop_A-minor-pent_112bpm_2x_loop.wav`.

If the display says that the sound reaches full scale, turn MASTER down a
little and save again. This gives the file some headroom.

---

## The display

The panel at the top shows:

- the key and the scale, a ▶ sign while the pattern plays, and the current
  layer and its voice (with **MUTE** if the layer is muted);
- the tempo, in large digits;
- the step that is playing (**STEP 05/16**);
- a small oscilloscope that shows the sound;
- short messages, for example "Stored in slot 3", or why something did not
  work.

---

## Keyboard shortcuts

These work on a computer when you are not typing in the text box.

| Key | Action |
| --- | --- |
| Space | Play / stop |
| 1 – 4 | Choose a layer |
| M | Mute or unmute the current layer |
| C | Clear the current layer |
| Shift + C | Clear all layers |
| R | Random melody on the current layer |
| W | Save audio |
| ↑ / ↓ | Tempo up / down by 1 BPM |
| ← / → | Previous / next scale |
| [ / ] | Key down / up by a semitone |
| Shift + 1–8 | Load slot 1–8 |
| Alt + 1–8 (Option on a Mac) | Store in slot 1–8 |
| Ctrl + C / Cmd + C | Copy the pattern as text (when nothing is selected) |
| Ctrl + V / Cmd + V | Paste a pattern |

---

## Screen layouts

Tenori-Loop arranges itself to fit the screen. When you rotate a phone or
resize a window, it changes layout at once.

| Screen | Layout |
| --- | --- |
| Phone, upright | Display at the top, then the grid, then the controls on pages |
| Phone on its side, tablet, laptop | Grid on the left, display and controls on the right. A long control page scrolls by itself. |
| Large screen | Grid on the left, all four control pages open at once, and a list of keyboard shortcuts |

---

## What is saved, and where

Tenori-Loop saves automatically:

- the pattern you are working on, a moment after each change. It comes back
  when you open the app again;
- the eight pattern slots;
- the control page and layer you used last, and your audio settings.

All of this is kept **in your browser, on this device only**. Another browser,
another device or a private window starts empty. Clearing your browser's site
data also removes your patterns. To keep a pattern safe, or to move it to
another device, use **COPY** or **TEXT** and keep the text somewhere. The zip
from the published page also includes the pattern.

---

## Pattern files (.tnl)

A pattern file is plain text, so you can read it and edit it by hand. This is
the beginning of the demo pattern:

```
TENORILOOP 1
bpm 112
swing 18
len 40
echo 35
master 80
key 10
scale 9
layer 1 6 0 0
................
................
................
................
................
........#.......
......#...#.....
...#.......#....
..#..#.......#..
..............#.
#...............
................
................
................
................
................
layer 2 1 -1 0
…
```

| Line | Meaning |
| --- | --- |
| `bpm` | Tempo, 40–240 |
| `swing`, `len`, `echo`, `master` | Swing (0–70), note length (5–100), echo and master volume (0–100), in percent |
| `key` | 1–12, from C (1) up to B (12). A is 10. |
| `scale` | 1–12, in the order of the scale table above. Minor Pentatonic is 9. |
| `layer` | Layer number, voice, octave, mute. Voices: 1 Sine, 2 Tri, 3 Saw, 4 Square, 5 Bell, 6 Pluck. Octave −2 to 2. Mute 0 (off) or 1 (on). |
| 16 rows of `.` and `#` | The layer's grid. Each row has 16 characters. `#` is a lit pad and `.` is an unlit pad. The first row is the top of the grid. |

---

## Troubleshooting

**There is no sound.**
Press PLAY, or tap the page once, because browsers start sound only after you
interact with the page. Check your device volume and the MASTER fader, and make
sure the layer is not muted. On an iPhone or iPad, the silent switch can also
mute sound in the browser.

**My slots are empty.**
The slots are stored in the browser where you made them. They are not there in
a different browser, on another device, in a private window, or after you
clear your browser data.

**The display says "Saving files isn't available in this view".**
This view of the page cannot save files. Open `TenoriLoop-standalone.html`
instead. It saves the WAV file directly.

**Some notes are cut short in a very dense pattern.**
Tenori-Loop plays up to 24 notes at the same time on a touch-screen device
and 32 on a computer. When more notes ring at once, the quietest one stops to make room.
Use a shorter NOTE LENGTH, or fewer notes on the same step.

**"Nothing to render".**
All the layers that are not muted are empty. Draw some notes or unmute a layer,
then save again.

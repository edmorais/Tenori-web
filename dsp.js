// ===========================================================================
// TENORI·LOOP audio engine.
// The same source runs in an AudioWorklet, in a ScriptProcessor fallback and
// under Node for the offline tests, so it touches no browser API at all.
// The sequencer clock lives here, in samples, exactly as in the LÖVE build:
// a step boundary can fall anywhere inside a block, and every step is
// reported back with the context time at which it becomes audible.
// ===========================================================================

var TENORI = (function () {
'use strict';
// everything lives in this closure: global loads are slow in some hosts
var GRID = 16, LAYERS = 4;
var W_SINE = 0, W_TRI = 1, W_SAW = 2, W_SQR = 3, W_BELL = 4, W_PLUCK = 5;
var SCALE_STEPS = [
  [0, 2, 4, 5, 7, 9, 11], [0, 2, 3, 5, 7, 8, 10], [0, 2, 3, 5, 7, 8, 11],
  [0, 2, 3, 5, 7, 9, 10], [0, 1, 3, 5, 7, 8, 10], [0, 2, 4, 6, 7, 9, 11],
  [0, 2, 4, 5, 7, 9, 10], [0, 2, 4, 7, 9], [0, 3, 5, 7, 10],
  [0, 3, 5, 6, 7, 10], [0, 2, 4, 6, 8, 10], [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]
];
var BASE_MIDI = 48;                         // C3 on the bottom row at octave 0
var LAYER_GAIN = [0.95, 0.80, 0.75, 0.70];
// Per-waveform trim so a row sounds equally loud whichever voice plays it.
// Measured by test/audio.js (RMS over the first 250 ms at A3, A4 and A5).
var WAVE_GAIN = [1.00, 1.00, 0.60, 0.50, 1.00, 0.85];

// Bell: a struck metal bar, built from its own vibration modes rather than
// from FM. Ratios 2.76, 5.40 and 8.93 are the free-free bar modes of a
// glockenspiel; the octave partial and the near-unison twin (a slow beat, the
// "doublet" every real bell has) give it a sung, rounder centre.
// [frequency ratio, level, decay as a share of the note length]
var BELL_MODES = [
  [1.000, 1.00, 1.25],
  [1.0021, 0.30, 1.00],
  [2.000, 0.30, 0.55],
  [2.756, 0.34, 0.30],
  [5.404, 0.17, 0.12],
  [8.933, 0.07, 0.06]
];
var NMODES = BELL_MODES.length;

var SIN_N = 4096;
var SIN_T = new Float32Array(SIN_N + 1);
for (var i = 0; i <= SIN_N; i++) SIN_T[i] = Math.sin(i / SIN_N * Math.PI * 2);

// sine of a phase measured in turns, any range
function sinT(ph) {
  ph -= ph | 0;                       // phases stay far below 2^31
  if (ph < 0) ph += 1;
  var f = ph * SIN_N, k = f | 0;
  return SIN_T[k] + (SIN_T[k + 1] - SIN_T[k]) * (f - k);
}

// polyBLEP residual: removes most of the aliasing at a discontinuity
function polyBlep(t, dt) {
  if (t < dt) { var u = t / dt; return u + u - u * u - 1; }
  if (t > 1 - dt) { var w = (t - 1) / dt; return w * w + w + w + 1; }
  return 0;
}

function softClip(v) {
  if (v > 3) return 1;
  if (v < -3) return -1;
  return v * (27 + v * v) / (27 + 9 * v * v);
}

function midiToFreq(m) { return 440 * Math.pow(2, (m - 69) / 12); }

function makeVoice(ksMax) {
  return {
    active: false, wave: 0, phase: 0, inc: 0,
    env: 0, attacking: false, atkInc: 0, envDec: 1, ampL: 0, ampR: 0,
    // bell
    nm: 0, mph: new Float64Array(NMODES), minc: new Float64Array(NMODES),
    mamp: new Float32Array(NMODES), mdec: new Float32Array(NMODES),
    fmI: 0, fmDec: 1,
    // pluck
    ks: new Float32Array(ksMax), ksLen: 2, ksIdx: 0, ksG: 0.99,
    apC: 0, apX: 0, apY: 0, prev: 0, hpX: 0, hpY: 0
  };
}

function level(v) { return v.wave === W_BELL ? v.env * v.mamp[0] : v.env; }

function TenoriEngine(sr, maxVoice) {
  var E = {};
  E.sr = sr;
  var KS_MAX = Math.ceil(sr / 25) + 8;     // room for the lowest reachable note
  var voices = [];
  for (var i = 0; i < maxVoice; i++) voices.push(makeVoice(KS_MAX));
  E.voices = voices;

  E.cells = new Uint8Array(LAYERS * GRID * GRID);   // (L*16 + step)*16 + row
  E.wave = [W_PLUCK, W_SINE, W_TRI, W_BELL];
  E.oct = [0, -1, 1, 0];
  E.mute = [0, 0, 0, 0];
  E.P = { playing: false, bpm: 112, swing: 0.18, noteLen: 0.40, echo: 0.35,
          master: 0.80, keyRoot: 9, scaleIdx: 8 };
  E.events = [];

  var seq = 0, toNext = 0;
  var noteCount = 0;
  var rng = 0x2545F491;
  function noise() {
    rng ^= rng << 13; rng ^= rng >>> 17; rng ^= rng << 5;
    return (rng >>> 0) / 2147483648 - 1;
  }

  var dlSize = Math.ceil(sr * 1.6);
  var dlL = new Float32Array(dlSize), dlR = new Float32Array(dlSize);
  var dlPos = 0, dlTime = sr * 0.4, fbL = 0, fbR = 0;
  var mixL = new Float32Array(128), mixR = new Float32Array(128);

  E.rowToMidi = function (row, L) {
    var steps = SCALE_STEPS[E.P.scaleIdx], n = steps.length;
    var o = Math.floor(row / n);
    return BASE_MIDI + E.P.keyRoot + E.oct[L] * 12 + steps[row % n] + 12 * o;
  };

  // ---------------------------------------------------------------- trigger
  function trigger(v, wv, freq, amp, pan, len, accent) {
    v.wave = wv;
    v.phase = 0;
    v.inc = Math.min(freq / sr, 0.45);
    v.env = 0;
    v.attacking = true;
    v.atkInc = 1 / (0.004 * sr);
    v.envDec = Math.pow(0.0004, 1 / (Math.max(0.03, len) * sr));

    if (wv === W_BELL) {
      v.atkInc = 1 / (0.0015 * sr);               // a mallet, not a bow
      v.envDec = Math.pow(0.0004, 1 / (Math.max(0.05, len) * 6 * sr));
      var nm = 0;
      for (var k = 0; k < NMODES; k++) {
        var f = freq * BELL_MODES[k][0];
        if (f > sr * 0.42) break;                 // nothing to say above Nyquist
        // high modes of a high note die faster, as they do on a real bar
        var t = Math.max(0.04, len * BELL_MODES[k][2] / (1 + f / 6000));
        v.mph[nm] = k * 0.13;                     // decorrelate the onsets a little
        v.minc[nm] = f / sr;
        v.mamp[nm] = BELL_MODES[k][1];
        v.mdec[nm] = Math.pow(0.001, 1 / (t * sr));
        nm++;
      }
      v.nm = nm;
      v.fmI = accent ? 0.085 : 0.06;              // brief hammer brightness (turns)
      v.fmDec = Math.pow(0.001, 1 / (0.09 * sr));
    } else if (wv === W_PLUCK) {
      pluckSetup(v, freq, len, accent);
      v.env = 1;                                  // the string is the attack
      v.attacking = false;
      v.envDec = Math.pow(0.0004, 1 / (Math.max(0.05, len) * 2.1 * sr));
    }

    var p = Math.max(-1, Math.min(1, pan));
    var g = amp * WAVE_GAIN[wv];
    v.ampL = g * Math.cos((p + 1) * Math.PI * 0.25);
    v.ampR = g * Math.sin((p + 1) * Math.PI * 0.25);
    v.active = true;
  }

  // Extended Karplus-Strong. The loop is the delay line, a two-point average
  // (half a sample of delay) and a first-order allpass that supplies the
  // fractional remainder, so every note lands on pitch instead of on the
  // nearest whole-sample period. The loop gain is solved from the requested
  // decay with the average's own loss at the fundamental taken out.
  function pluckSetup(v, freq, len, accent) {
    var N = sr / freq;
    var Ni = Math.floor(N - 0.5 - 0.1);
    if (Ni < 2) Ni = 2;
    if (Ni > KS_MAX - 1) Ni = KS_MAX - 1;
    var frac = N - 0.5 - Ni;
    v.apC = (1 - frac) / (1 + frac);
    v.apX = 0; v.apY = 0; v.prev = 0; v.hpX = 0; v.hpY = 0;
    v.ksLen = Ni; v.ksIdx = 0;

    // the bright pick dies first, so the body rings a little past the target
    // and the note as heard lasts as long as NOTE LENGTH asks
    var t60 = Math.max(0.1, len * 1.7);
    var g = Math.pow(0.001, 1 / (freq * t60)) / Math.max(0.2, Math.cos(Math.PI * freq / sr));
    v.ksG = Math.min(0.99995, g);

    // The pick: noise, darkened in proportion to the pitch (so a low string
    // isn't hiss and a high one isn't dull), then a pick-position comb that
    // hollows the harmonics a finger near the bridge would not excite.
    noteCount = (noteCount + 1) | 0;
    rng = (Math.floor(freq * 7919) ^ (noteCount * 2654435761)) | 1;
    var fc = Math.min(sr * 0.2, freq * (accent ? 8 : 5.5));
    var a = 1 - Math.exp(-2 * Math.PI * fc / sr);
    var y1 = 0, y2 = 0, ks = v.ks, sum = 0;
    for (var i = 0; i < Ni; i++) {
      y1 += (noise() - y1) * a;
      y2 += (y1 - y2) * a;
      ks[i] = y2;
    }
    var P = Math.max(1, Math.round(Ni * 0.14));
    for (var j = Ni - 1; j >= P; j--) ks[j] -= 0.85 * ks[j - P];
    for (var m = 0; m < Ni; m++) sum += ks[m];
    var mean = sum / Ni, e = 0;
    for (var q = 0; q < Ni; q++) { ks[q] -= mean; e += ks[q] * ks[q]; }
    var rms = Math.sqrt(e / Ni) || 1;
    var s = 0.62 / rms;
    for (var z = 0; z < Ni; z++) ks[z] *= s;
  }

  function alloc() {
    var quietest = voices[0], lo = Infinity;
    for (var i = 0; i < voices.length; i++) {
      var v = voices[i];
      if (!v.active) return v;
      var l = level(v);
      if (l < lo) { lo = l; quietest = v; }
    }
    return quietest;
  }

  function fire(L, row, accent) {
    var freq = midiToFreq(E.rowToMidi(row, L));
    var amp = LAYER_GAIN[L] * (accent ? 0.34 : 0.27);
    var pan = -0.55 + row / (GRID - 1) * 1.1;
    var len = 0.05 + E.P.noteLen * E.P.noteLen * 2.2;
    trigger(alloc(), E.wave[L], freq, amp, pan, len, accent);
  }
  E.fire = fire;

  // ----------------------------------------------------------------- render
  function renderVoice(v, L, R, off, n) {
    var env = v.env, aL = v.ampL, aR = v.ampR, i, s;
    var end = off + n;
    var wave = v.wave;

    if (wave === W_BELL) {
      var nm = v.nm, mph = v.mph, minc = v.minc, mamp = v.mamp, mdec = v.mdec;
      var fmI = v.fmI, fmDec = v.fmDec;
      for (i = off; i < end; i++) {
        // fundamental, phase-modulated by itself for the first few tens of ms
        var p0 = mph[0];
        s = mamp[0] * sinT(p0 + fmI * SIN_T[((p0 - (p0 | 0)) * SIN_N) | 0]);
        mph[0] = p0 + minc[0];
        mamp[0] *= mdec[0];
        for (var k = 1; k < nm; k++) {
          s += mamp[k] * sinT(mph[k]);
          mph[k] += minc[k];
          mamp[k] *= mdec[k];
        }
        fmI *= fmDec;
        if (v.attacking) {
          env += v.atkInc;
          if (env >= 1) { env = 1; v.attacking = false; }
        } else env *= v.envDec;
        s *= env * 0.62;
        L[i] += s * aL; R[i] += s * aR;
      }
      v.fmI = fmI;
      for (k = 0; k < nm; k++) {
        if (mph[k] > 1e6) mph[k] -= mph[k] | 0;
        // a spent mode is dropped before it sinks into denormal range,
        // where every multiply costs a hundred times more
        if (mamp[k] < 1e-6) { mamp[k] = 0; mdec[k] = 0; }
      }
      while (v.nm > 1 && mamp[v.nm - 1] === 0) v.nm--;
      v.env = env;
      if (!v.attacking && env * mamp[0] < 0.00012) v.active = false;
      return;
    }

    if (wave === W_PLUCK) {
      var ks = v.ks, len = v.ksLen, idx = v.ksIdx, gk = v.ksG, C = v.apC;
      var apX = v.apX, apY = v.apY, prev = v.prev, hpX = v.hpX, hpY = v.hpY;
      var envDec = v.envDec;
      for (i = off; i < end; i++) {
        var out = ks[idx];
        var avg = 0.5 * (out + prev);
        prev = out;
        var ap = C * avg + apX - C * apY;
        apX = avg; apY = ap;
        ks[idx] = ap * gk;
        if (++idx >= len) idx = 0;
        // gentle DC / sub-bass guard, ~15 Hz
        var hp = out - hpX + 0.998 * hpY;
        hpX = out; hpY = hp;
        env *= envDec;
        s = hp * env;
        L[i] += s * aL; R[i] += s * aR;
      }
      v.ksIdx = idx; v.apX = apX; v.apY = apY; v.prev = prev; v.hpX = hpX; v.hpY = hpY;
      v.env = env;
      v.attacking = false;
      if (env < 0.0001) v.active = false;
      return;
    }

    var ph = v.phase, inc = v.inc;
    for (i = off; i < end; i++) {
      if (wave === W_SINE) s = sinT(ph);
      else if (wave === W_TRI) s = ph < 0.5 ? 4 * ph - 1 : 3 - 4 * ph;
      else if (wave === W_SAW) s = 2 * ph - 1 - polyBlep(ph, inc);
      else {
        s = ph < 0.5 ? 1 : -1;
        s += polyBlep(ph, inc);
        var t2 = ph + 0.5; if (t2 >= 1) t2 -= 1;
        s -= polyBlep(t2, inc);
      }
      ph += inc; if (ph >= 1) ph -= 1;
      if (v.attacking) {
        env += v.atkInc;
        if (env >= 1) { env = 1; v.attacking = false; }
      } else env *= v.envDec;
      s *= env;
      L[i] += s * aL; R[i] += s * aR;
    }
    v.phase = ph;
    v.env = env;
    if (!v.attacking && env < 0.0001) v.active = false;
  }

  function stepLen() {
    var base = 60 / Math.max(20, E.P.bpm) / 4 * sr;
    var sw = E.P.swing * 0.34;
    return ((seq - 1) % 2 === 0) ? base * (1 + sw) : base * (1 - sw);
  }

  function advance(t) {
    seq = seq % GRID + 1;
    var c = seq - 1, accent = c % 4 === 0, n = 0;
    for (var L = 0; L < LAYERS; L++) {
      if (E.mute[L]) continue;
      var base = (L * GRID + c) * GRID;
      for (var r = 0; r < GRID; r++) if (E.cells[base + r]) { fire(L, r, accent); n++; }
    }
    E.events.push({ step: c, time: t, len: 0, n: n });
    return E.events[E.events.length - 1];
  }

  function postFX(L, R, n) {
    var wet = E.P.echo, fb = E.P.echo * 0.72;
    var mg = E.P.master * 1.15;
    var target = Math.min(60 / Math.max(20, E.P.bpm) / 4 * sr * 3, dlSize - 4);
    for (var i = 0; i < n; i++) {
      dlTime += (target - dlTime) * 0.0015 * (48000 / sr);
      var rp = dlPos - dlTime;
      while (rp < 0) rp += dlSize;
      var i0 = rp | 0, fr = rp - i0, i1 = i0 + 1;
      if (i1 >= dlSize) i1 = 0;
      var dl = dlL[i0] + (dlL[i1] - dlL[i0]) * fr;
      var dr = dlR[i0] + (dlR[i1] - dlR[i0]) * fr;
      fbL += (dl - fbL) * 0.45 + 1e-24;            // darken each repeat
      fbR += (dr - fbR) * 0.45 + 1e-24;            // (the 1e-24 keeps out denormals)
      dlL[dlPos] = L[i] + fbR * fb;                // cross-feed: ping-pong
      dlR[dlPos] = R[i] + fbL * fb;
      if (++dlPos >= dlSize) dlPos = 0;
      L[i] = softClip((L[i] + dl * wet) * mg);
      R[i] = softClip((R[i] + dr * wet) * mg);
    }
  }

  // Fill outL/outR (n frames). t0 is the context time of the first frame.
  E.render = function (outL, outR, n, t0) {
    if (mixL.length < n) { mixL = new Float32Array(n); mixR = new Float32Array(n); }
    var L = mixL, R = mixR, i;
    for (i = 0; i < n; i++) { L[i] = 0; R[i] = 0; }
    i = 0;
    while (i < n) {
      var chunk;
      if (E.P.playing) {
        if (toNext <= 0) {
          var ev = advance(t0 + i / sr);
          var sl = stepLen();
          ev.len = sl / sr;
          toNext += sl;
        }
        chunk = Math.min(n - i, Math.max(1, Math.ceil(toNext)));
        toNext -= chunk;
      } else chunk = n - i;
      for (var k = 0; k < voices.length; k++) {
        var v = voices[k];
        if (v.active) renderVoice(v, L, R, i, chunk);
      }
      i += chunk;
    }
    postFX(L, R, n);
    for (i = 0; i < n; i++) outL[i] = L[i];
    if (outR && outR !== outL) for (i = 0; i < n; i++) outR[i] = R[i];
    else for (i = 0; i < n; i++) outL[i] = 0.5 * (L[i] + R[i]);
  };

  E.message = function (m) {
    if (m.type === 'state') {
      if (m.cells) E.cells.set(m.cells);
      if (m.wave) E.wave = m.wave.slice();
      if (m.oct) E.oct = m.oct.slice();
      if (m.mute) E.mute = m.mute.slice();
      if (m.P) {
        var was = E.P.playing;
        for (var key in m.P) E.P[key] = m.P[key];
        if (E.P.playing && !was) { seq = 0; toNext = 0; }
      }
    } else if (m.type === 'audition') {
      fire(m.L, m.row, false);
    } else if (m.type === 'panic') {
      for (var i = 0; i < voices.length; i++) voices[i].active = false;
    }
  };
  return E;
}

return { TenoriEngine: TenoriEngine, SCALE_STEPS: SCALE_STEPS, BASE_MIDI: BASE_MIDI,
         W_BELL: W_BELL, W_PLUCK: W_PLUCK, WAVE_GAIN: WAVE_GAIN };
})();

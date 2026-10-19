(function () {
'use strict';
// ============================================================== constants
var GRID = 16, LAYERS = 4, SLOTS = 8;
var WAVE_NAMES = ['Sine', 'Tri', 'Saw', 'Square', 'Bell', 'Pluck'];
var KEY_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
var SCALE_NAMES = ['Major', 'Nat Minor', 'Harm Minor', 'Dorian', 'Phrygian', 'Lydian',
  'Mixolydian', 'Major Pent', 'Minor Pent', 'Blues', 'Whole Tone', 'Chromatic'];
var LAYER_COL = ['#ffb24c', '#56d8ff', '#ff6fc0', '#9bff7a'];
var LAYER_RGB = LAYER_COL.map(function (h) { return [parseInt(h.substr(1, 2), 16), parseInt(h.substr(3, 2), 16), parseInt(h.substr(5, 2), 16)]; });
var FILE_MAGIC = 'TENORILOOP', FILE_VER = 1;
var STORE = 'tenori-loop:';
var COARSE = window.matchMedia && matchMedia('(pointer: coarse)').matches;

var DSP_SRC = document.getElementById('dsp-src').textContent;
var T = window.TENORI;   // the same engine runs here for the fallback and the pitch maths

// ================================================================== state
var S = {
  cells: new Uint8Array(LAYERS * GRID * GRID),
  wave: [5, 0, 1, 4], oct: [0, -1, 1, 0], mute: [0, 0, 0, 0],
  P: { playing: false, bpm: 112, swing: 0.18, noteLen: 0.40, echo: 0.35, master: 0.80, keyRoot: 9, scaleIdx: 8 }
};
var curLayer = 0, curTab = 'voice';
function ci(L, c, r) { return (L * GRID + c) * GRID + r; }

// ================================================================== audio
var A = { ctx: null, node: null, engine: null, analyser: null, ok: false, mode: '', queue: [], starting: false };

function postState() {
  var m = { type: 'state', cells: S.cells.slice(), wave: S.wave.slice(), oct: S.oct.slice(), mute: S.mute.slice(), P: Object.assign({}, S.P) };
  if (A.node && A.mode === 'worklet') A.node.port.postMessage(m);
  else if (A.engine) A.engine.message(m);
}
function audition(L, r) {
  if (!A.ok || S.mute[L]) return;
  var m = { type: 'audition', L: L, row: r };
  if (A.mode === 'worklet') A.node.port.postMessage(m); else A.engine.message(m);
}

function workletSource(maxV) {
  return DSP_SRC + '\nclass TenoriProc extends AudioWorkletProcessor {\n' +
    ' constructor(o) { super(); this.E = TENORI.TenoriEngine(sampleRate, (o.processorOptions && o.processorOptions.maxV) || ' + maxV + ');\n' +
    '   this.port.onmessage = (e) => this.E.message(e.data); }\n' +
    ' process(ins, outs) { const o = outs[0]; if (!o || !o[0]) return true;\n' +
    '   this.E.render(o[0], o[1] || o[0], o[0].length, currentTime);\n' +
    '   if (this.E.events.length) { this.port.postMessage(this.E.events); this.E.events = []; }\n' +
    '   return true; }\n}\nregisterProcessor("tenori-loop", TenoriProc);\n';
}

function ensureAudio() {
  if (A.ctx) { if (A.ctx.state !== 'running') A.ctx.resume(); return; }
  var AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) { toast('This browser has no Web Audio', true); return; }
  try { A.ctx = new AC({ latencyHint: 'interactive' }); } catch (e) { A.ctx = new AC(); }
  var ctx = A.ctx;
  ctx.resume();
  A.analyser = ctx.createAnalyser();
  A.analyser.fftSize = 1024;
  A.analyser.connect(ctx.destination);
  var maxV = COARSE ? 24 : 32;

  function useScriptProcessor(reason) {
    var E = T.TenoriEngine(ctx.sampleRate, maxV);
    var sp = ctx.createScriptProcessor(COARSE ? 2048 : 1024, 0, 2);
    sp.onaudioprocess = function (e) {
      var b = e.outputBuffer;
      E.render(b.getChannelData(0), b.getChannelData(1), b.length, e.playbackTime);
      if (E.events.length) { pushEvents(E.events); E.events = []; }
    };
    sp.connect(A.analyser);
    A.engine = E; A.node = sp; A.mode = 'script'; A.ok = true;
    postState();
    if (reason) console.info('Tenori·Loop: using ScriptProcessor (' + reason + ')');
  }

  if (!ctx.audioWorklet || typeof AudioWorkletNode === 'undefined') { useScriptProcessor('no AudioWorklet'); return; }
  var src = workletSource(maxV);
  var urls = [];
  try { urls.push(URL.createObjectURL(new Blob([src], { type: 'application/javascript' }))); } catch (e) {}
  urls.push('data:application/javascript;charset=utf-8,' + encodeURIComponent(src));
  A.starting = true;
  (function tryNext(i) {
    if (i >= urls.length) { A.starting = false; useScriptProcessor('worklet module refused'); return; }
    ctx.audioWorklet.addModule(urls[i]).then(function () {
      var node = new AudioWorkletNode(ctx, 'tenori-loop', { numberOfInputs: 0, numberOfOutputs: 1, outputChannelCount: [2], processorOptions: { maxV: maxV } });
      node.port.onmessage = function (e) { pushEvents(e.data); };
      node.connect(A.analyser);
      A.node = node; A.mode = 'worklet'; A.ok = true; A.starting = false;
      postState();
    }).catch(function () { tryNext(i + 1); });
  })(0);
}

function pushEvents(evs) { for (var i = 0; i < evs.length; i++) A.queue.push(evs[i]); if (A.queue.length > 256) A.queue.splice(0, A.queue.length - 256); }

// The context time now leaving the speaker. Steps are released to the screen
// only when they get here, so the lights match what you hear.
function audibleTime() {
  var ctx = A.ctx;
  if (!ctx) return 0;
  if (ctx.getOutputTimestamp) {
    var ts = ctx.getOutputTimestamp();
    if (ts && ts.contextTime > 0) return ts.contextTime;
  }
  return ctx.currentTime - (ctx.baseLatency || 0) - (ctx.outputLatency || 0);
}

// ================================================================== grid canvas
var cv = document.getElementById('grid'), g = cv.getContext('2d');
var G = { side: 0, dpr: 1, pad: 0, cell: 0, spr: null };
var flash = new Float32Array(LAYERS * GRID * GRID);
var ripples = [];
var displayStep = -1, stepAt = 0, stepLen = 0.125;

function cellX(c) { return G.pad + c * G.cell; }
function cellY(r) { return G.pad + (GRID - 1 - r) * G.cell; }

// Pads are drawn once per size into sprites. Each one is a translucent
// silicone key standing in a well cut into the panel: a dark well, a body
// with a visible side wall, a frosted top face with a chamfered edge and a
// satin highlight, and an LED behind it. Lit, the LED shines through the
// face (white-hot core, coloured falloff), the side wall glows and light
// spills into the well around the key.
function makeSprites(forceCs) {
  var cs = forceCs || Math.max(6, Math.round(G.cell));
  function mk(fn) { var c = document.createElement('canvas'); c.width = cs; c.height = cs; fn(c.getContext('2d')); return c; }
  function rr(x, l, t, w, h, r) { x.beginPath(); x.moveTo(l + r, t); x.arcTo(l + w, t, l + w, t + h, r); x.arcTo(l + w, t + h, l, t + h, r); x.arcTo(l, t + h, l, t, r); x.arcTo(l, t, l + w, t, r); x.closePath(); }
  function mix(c, k, w) { return c.map(function (v) { return Math.round(v * k + 255 * (w || 0)); }).map(function (v) { return Math.min(255, v); }).join(','); }

  var wi = cs * 0.035, ws = cs - 2 * wi, wr = ws * 0.24;          // the well
  var pi = cs * 0.105, ps = cs - 2 * pi, pr = ps * 0.22;          // the key
  var th = Math.max(1, cs * 0.055);                               // its side wall
  var face = { l: pi, t: pi - th * 0.35, w: ps, h: ps - th * 0.6 };

  // fine grain for the frosted silicone, shared by every sprite
  var grain = document.createElement('canvas'); grain.width = cs; grain.height = cs;
  (function () {
    var gx = grain.getContext('2d'), im = gx.createImageData(cs, cs), seed = 1234567;
    for (var i = 0; i < im.data.length; i += 4) {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      var v = seed % 255, on = v & 1;
      im.data[i] = im.data[i + 1] = im.data[i + 2] = on ? 255 : 0;
      im.data[i + 3] = (v % 9);
    }
    gx.putImageData(im, 0, 0);
  })();

  function well(x, lit) {
    rr(x, wi, wi, ws, ws, wr);
    var g1 = x.createLinearGradient(0, wi, 0, wi + ws);
    g1.addColorStop(0, '#010203'); g1.addColorStop(1, '#0b0e12');
    x.fillStyle = g1; x.fill();
    if (lit) {                                                    // light escaping round the key
      x.save(); x.clip();
      var g2 = x.createRadialGradient(cs / 2, cs / 2, ps * 0.3, cs / 2, cs / 2, ws * 0.62);
      g2.addColorStop(0, 'rgba(' + lit + ',.75)'); g2.addColorStop(1, 'rgba(' + lit + ',0)');
      x.fillStyle = g2; x.fillRect(0, 0, cs, cs);
      x.restore();
    }
    // the lower lip of the cut catches the room light
    x.save(); rr(x, wi, wi, ws, ws, wr); x.clip();
    x.strokeStyle = 'rgba(255,255,255,.07)'; x.lineWidth = Math.max(1, cs * 0.02);
    rr(x, wi, wi - cs * 0.02, ws, ws, wr); x.stroke();
    x.restore();
  }

  function key(x, opt) {                                         // opt: {down, rgb, beat, dim}
    var dy = opt.down ? th * 0.8 : 0, f = { l: face.l, t: face.t + dy, w: face.w, h: face.h };
    // body and side wall
    if (!opt.down) {
      x.save();
      if (opt.rgb) { x.shadowColor = 'rgba(' + opt.rgb.join(',') + ',.9)'; x.shadowBlur = cs * 0.12; }
      else { x.shadowColor = 'rgba(0,0,0,.85)'; x.shadowBlur = cs * 0.07; x.shadowOffsetY = th * 0.7; }
      rr(x, pi, pi, ps, ps, pr);
      x.fillStyle = opt.rgb ? 'rgb(' + mix(opt.rgb, 0.55) + ')' : '#15181d';
      x.fill();
      x.restore();
      var sw = x.createLinearGradient(0, pi + ps * 0.5, 0, pi + ps);  // side wall shading
      sw.addColorStop(0, 'rgba(0,0,0,0)'); sw.addColorStop(1, opt.rgb ? 'rgba(0,0,0,.25)' : 'rgba(0,0,0,.5)');
      rr(x, pi, pi, ps, ps, pr); x.fillStyle = sw; x.fill();
    }
    // the top face
    rr(x, f.l, f.t, f.w, f.h, pr);
    var cx = f.l + f.w / 2, cy = f.t + f.h * 0.48;
    if (opt.rgb) {
      var c = opt.rgb, fg = x.createRadialGradient(cx, cy, 0, cx, cy, f.w * 0.72);
      fg.addColorStop(0, '#ffffff');
      fg.addColorStop(0.2, 'rgb(' + mix(c, 0.5, 0.5) + ')');
      fg.addColorStop(0.55, 'rgb(' + mix(c, 1, 0.06) + ')');
      fg.addColorStop(1, 'rgb(' + mix(c, 0.72) + ')');
      x.fillStyle = fg; x.fill();
    } else {
      var og = x.createLinearGradient(0, f.t, 0, f.t + f.h);
      og.addColorStop(0, opt.beat ? '#2f3540' : '#262b33'); og.addColorStop(1, opt.beat ? '#1b1f26' : '#16191e');   // the earlier pads' tones
      x.fillStyle = og; x.fill();
      var dif = x.createRadialGradient(cx, cy, 0, cx, cy, f.w * 0.55);  // the frosted diffuser, faintly milky in the middle
      dif.addColorStop(0, 'rgba(200,215,235,.07)'); dif.addColorStop(1, 'rgba(200,215,235,0)');
      x.fillStyle = dif; x.fill();
    }
    x.save(); rr(x, f.l, f.t, f.w, f.h, pr); x.clip();
    x.globalAlpha = opt.rgb ? 0.5 : 1; x.drawImage(grain, 0, 0); x.globalAlpha = 1;
    // satin highlight across the top third
    var sh = x.createLinearGradient(0, f.t, 0, f.t + f.h * 0.45);
    sh.addColorStop(0, opt.rgb ? 'rgba(255,255,255,.38)' : 'rgba(255,255,255,.16)'); sh.addColorStop(1, 'rgba(255,255,255,0)');
    rr(x, f.l + f.w * 0.08, f.t + f.h * 0.04, f.w * 0.84, f.h * 0.4, pr * 0.8); x.fillStyle = sh; x.fill();
    // pressed keys sit in their own shadow
    if (opt.down) { var ds = x.createLinearGradient(0, f.t, 0, f.t + f.h * 0.3); ds.addColorStop(0, 'rgba(0,0,0,.35)'); ds.addColorStop(1, 'rgba(0,0,0,0)'); x.fillStyle = ds; x.fillRect(0, 0, cs, cs); }
    x.restore();
    // chamfer: lit along the top, shaded along the bottom
    var ch = x.createLinearGradient(0, f.t, 0, f.t + f.h);
    ch.addColorStop(0, opt.rgb ? 'rgba(255,255,255,.55)' : 'rgba(255,255,255,.22)');
    ch.addColorStop(0.5, 'rgba(255,255,255,0)'); ch.addColorStop(1, 'rgba(0,0,0,.35)');
    x.lineWidth = Math.max(1, cs * 0.028); rr(x, f.l + x.lineWidth / 2, f.t + x.lineWidth / 2, f.w - x.lineWidth, f.h - x.lineWidth, pr); x.strokeStyle = ch; x.stroke();
  }

  var spr = { cs: cs, off: [], offDown: [], on: [], onDown: [], dim: [], ghost: [], hot: [], glow: [] };
  for (var k = 0; k < 2; k++) {
    spr.off.push(mk(function (x) { well(x, null); key(x, { beat: k }); }));
    spr.offDown.push(mk(function (x) { well(x, null); key(x, { beat: k, down: true }); }));
  }
  LAYER_RGB.forEach(function (c) {
    var rgb = c.join(',');
    spr.on.push(mk(function (x) { well(x, rgb); key(x, { rgb: c }); }));
    spr.onDown.push(mk(function (x) { well(x, rgb); key(x, { rgb: c, down: true }); }));
    // a muted layer's notes: the LED barely on behind the frosting
    spr.dim.push(mk(function (x) {
      well(x, null); key(x, { beat: 0 });
      var g1 = x.createRadialGradient(cs / 2, cs * 0.47, 0, cs / 2, cs * 0.47, ps * 0.42);
      g1.addColorStop(0, 'rgba(' + rgb + ',.55)'); g1.addColorStop(1, 'rgba(' + rgb + ',0)');
      x.fillStyle = g1; x.fillRect(0, 0, cs, cs);
    }));
    // another layer's note, seen through an unlit key: a soft coloured glint
    spr.ghost.push(mk(function (x) {
      var g1 = x.createRadialGradient(cs / 2, cs * 0.47, 0, cs / 2, cs * 0.47, ps * 0.26);
      g1.addColorStop(0, 'rgba(' + rgb + ',.9)'); g1.addColorStop(0.4, 'rgba(' + rgb + ',.45)'); g1.addColorStop(1, 'rgba(' + rgb + ',0)');
      x.fillStyle = g1; x.fillRect(0, 0, cs, cs);
    }));
    // the flash when a note sounds: added on top, so the core blows out to white
    spr.hot.push(mk(function (x) {
      rr(x, face.l, face.t, face.w, face.h, pr); x.save(); x.clip();
      var g1 = x.createRadialGradient(cs / 2, cs * 0.47, 0, cs / 2, cs * 0.47, ps * 0.7);
      g1.addColorStop(0, 'rgba(255,255,255,.95)'); g1.addColorStop(0.3, 'rgba(' + mix(c, 0.7, 0.3) + ',.7)'); g1.addColorStop(1, 'rgba(' + rgb + ',.15)');
      x.fillStyle = g1; x.fillRect(0, 0, cs, cs); x.restore();
    }));
    var gs = cs * 3;
    var gc = document.createElement('canvas'); gc.width = gs; gc.height = gs;
    var gx = gc.getContext('2d'), gg = gx.createRadialGradient(gs / 2, gs / 2, 0, gs / 2, gs / 2, gs / 2);
    gg.addColorStop(0, 'rgba(' + rgb + ',.6)'); gg.addColorStop(0.3, 'rgba(' + rgb + ',.22)'); gg.addColorStop(1, 'rgba(' + rgb + ',0)');
    gx.fillStyle = gg; gx.fillRect(0, 0, gs, gs);
    spr.glow.push(gc);
  });
  G.spr = spr;
}

function sizeGrid() {
  var r = cv.getBoundingClientRect();
  var dpr = Math.min(3, window.devicePixelRatio || 1);
  var side = Math.round(r.width * dpr);
  if (side < 16) return;
  if (side === G.side && dpr === G.dpr) return;
  G.side = side; G.dpr = dpr;
  cv.width = side; cv.height = side;
  G.pad = side * 0.035;
  G.cell = (side - 2 * G.pad) / GRID;
  makeSprites();
}

function rootRows() {
  var steps = T.SCALE_STEPS[S.P.scaleIdx], rows = [];
  for (var r = 0; r < GRID; r++) if (r % steps.length === 0) rows.push(r);
  return rows;
}

function drawGrid(now) {
  if (!G.spr) return;
  var s = G.side, cs = G.cell, spr = G.spr, d = spr.cs;
  g.globalCompositeOperation = 'source-over';
  var bg = g.createLinearGradient(0, 0, 0, s);
  bg.addColorStop(0, '#0c0f13'); bg.addColorStop(1, '#07090c');
  g.fillStyle = bg; g.fillRect(0, 0, s, s);

  // silkscreen: a tick over every beat, a dot beside every root row
  g.fillStyle = 'rgba(123,134,154,.55)';
  for (var c = 0; c < GRID; c += 4) g.fillRect(cellX(c) + cs * 0.1, G.pad * 0.38, cs * 0.8, Math.max(1, G.pad * 0.12));
  g.fillStyle = 'rgba(87,224,200,.8)';
  rootRows().forEach(function (r) { g.beginPath(); g.arc(G.pad * 0.5, cellY(r) + cs / 2, Math.max(1.2, G.pad * 0.13), 0, Math.PI * 2); g.fill(); });

  var ph = displayStep;

  var cur = curLayer, glowList = [], held = {};
  for (var pid in pointers) held[pointers[pid].c * GRID + pointers[pid].r] = 1;
  for (c = 0; c < GRID; c++) {
    var x = cellX(c), beat = (c % 4 === 0) ? 1 : 0;
    for (var r = 0; r < GRID; r++) {
      var y = cellY(r), down = held[c * GRID + r];
      var on = S.cells[ci(cur, c, r)];
      if (on && S.mute[cur]) g.drawImage(spr.dim[cur], x, y, cs, cs);
      else if (on) g.drawImage(down ? spr.onDown[cur] : spr.on[cur], x, y, cs, cs);
      else {
        g.drawImage(down ? spr.offDown[beat] : spr.off[beat], x, y, cs, cs);
        for (var L = 0; L < LAYERS; L++) if (L !== cur && S.cells[ci(L, c, r)] && !S.mute[L]) { g.globalAlpha = 0.55; g.drawImage(spr.ghost[L], x, y, cs, cs); g.globalAlpha = 1; break; }
      }
      for (L = 0; L < LAYERS; L++) {
        var f = flash[ci(L, c, r)];
        if (f > 0.02) glowList.push(L, c, r, f);
      }
    }
  }
  // the playhead lights the column from behind
  if (ph >= 0 && S.P.playing) {
    g.globalCompositeOperation = 'lighter';
    var col = g.createLinearGradient(cellX(ph), 0, cellX(ph) + cs, 0);
    col.addColorStop(0, 'rgba(170,210,255,0)'); col.addColorStop(0.5, 'rgba(170,210,255,.07)'); col.addColorStop(1, 'rgba(170,210,255,0)');
    g.fillStyle = col; g.fillRect(cellX(ph), G.pad * 0.7, cs, s - G.pad * 1.4);
  }

  g.globalCompositeOperation = 'lighter';
  for (var i = 0; i < glowList.length; i += 4) {
    var gl = glowList[i], gc = glowList[i + 1], gr = glowList[i + 2], gf = glowList[i + 3];
    var gx = cellX(gc) + cs / 2, gy = cellY(gr) + cs / 2, gsz = cs * 3 * (0.75 + 0.25 * gf);
    g.globalAlpha = Math.min(1, gf);
    g.drawImage(spr.glow[gl], gx - gsz / 2, gy - gsz / 2, gsz, gsz);
    if (gl === cur) { g.globalAlpha = Math.min(1, gf) * 0.7; g.drawImage(spr.hot[gl], cellX(gc), cellY(gr), cs, cs); }
    else { g.globalAlpha = Math.min(1, gf) * 0.8; g.drawImage(spr.ghost[gl], cellX(gc) - cs * 0.25, cellY(gr) - cs * 0.25, cs * 1.5, cs * 1.5); }
  }
  g.lineWidth = Math.max(1, cs * 0.06);
  for (i = 0; i < ripples.length; i++) {
    var rp = ripples[i];
    g.globalAlpha = rp.life * 0.7;
    g.strokeStyle = LAYER_COL[rp.L];
    g.beginPath(); g.arc(rp.x, rp.y, rp.rad, 0, Math.PI * 2); g.stroke();
  }
  g.globalAlpha = 1;
  g.globalCompositeOperation = 'source-over';
}

function spawnRipple(L, c, r) {
  if (ripples.length > 120) ripples.shift();
  ripples.push({ L: L, x: cellX(c) + G.cell / 2, y: cellY(r) + G.cell / 2, rad: G.cell * 0.3, life: 1 });
}

// ================================================================== painting
var pointers = {};
function cellAt(ev) {
  var rect = cv.getBoundingClientRect();
  var x = (ev.clientX - rect.left) * (G.side / rect.width), y = (ev.clientY - rect.top) * (G.side / rect.height);
  var c = Math.floor((x - G.pad) / G.cell), rr = GRID - 1 - Math.floor((y - G.pad) / G.cell);
  if (c < 0 || c >= GRID || rr < 0 || rr >= GRID) return null;
  return [c, rr];
}
function paint(c, r, v) {
  var k = ci(curLayer, c, r);
  if (S.cells[k] === v) return false;
  S.cells[k] = v;
  if (v) { audition(curLayer, r); flash[k] = Math.max(flash[k], 0.8); spawnRipple(curLayer, c, r); }
  return true;
}
cv.addEventListener('pointerdown', function (ev) {
  ensureAudio();
  var hit = cellAt(ev);
  if (!hit) return;
  ev.preventDefault();
  try { cv.setPointerCapture(ev.pointerId); } catch (e) {}
  var v = S.cells[ci(curLayer, hit[0], hit[1])] ? 0 : 1;
  pointers[ev.pointerId] = { v: v, c: hit[0], r: hit[1] };
  if (paint(hit[0], hit[1], v)) changed();
});
cv.addEventListener('pointermove', function (ev) {
  var p = pointers[ev.pointerId];
  if (!p) return;
  var hit = cellAt(ev);
  if (!hit || (hit[0] === p.c && hit[1] === p.r)) return;
  // walk the cells between the last sample and this one, so a fast drag leaves no gaps
  var dc = hit[0] - p.c, dr = hit[1] - p.r, n = Math.max(Math.abs(dc), Math.abs(dr)), any = false;
  for (var i = 1; i <= n; i++) any = paint(Math.round(p.c + dc * i / n), Math.round(p.r + dr * i / n), p.v) || any;
  p.c = hit[0]; p.r = hit[1];
  if (any) changed();
});
function endPointer(ev) { delete pointers[ev.pointerId]; }
cv.addEventListener('pointerup', endPointer);
cv.addEventListener('pointercancel', endPointer);
cv.addEventListener('lostpointercapture', endPointer);

// ================================================================== controls
var $ = function (id) { return document.getElementById(id); };
var device = $('device');

var WAVE_ICONS = [
  'M2 7 C5 -1, 9 -1, 12 7 S19 15, 22 7 S 28 -1, 28 7',
  'M2 7 L7 2 L17 12 L22 7 L27 2',
  'M2 12 L13 2 L13 12 L24 2 L24 12 L28 8',
  'M2 12 L2 2 L10 2 L10 12 L18 12 L18 2 L26 2 L26 12',
  'M11 11 C11 4 12 2 15 2 C18 2 19 4 19 11 L21 12 L9 12 Z M14 13 L16 13',
  'M2 7 C4 1 6 1 7 7 S10 12 11 7 S14 4 15 7 S18 9 19 7 S22 6 23 7 L28 7'
];

function buildLayers() {
  var box = $('layers'); box.innerHTML = '';
  for (var L = 0; L < LAYERS; L++) {
    var b = document.createElement('button');
    b.className = 'key lkey'; b.dataset.l = L; b.style.setProperty('--lc', LAYER_COL[L]);
    b.innerHTML = '<span class="leds"><span class="led m"></span><span class="led s" style="--lc:' + LAYER_COL[L] + '"></span></span><span class="num">' + (L + 1) + '</span><span class="sub"></span>';
    b.title = 'Layer ' + (L + 1) + ' (' + (L + 1) + '). Tap the selected layer again to mute it.';
    b.addEventListener('click', (function (L) { return function () {
      if (L === curLayer) { toggleMute(); return; }
      curLayer = L; syncUI();
    }; })(L));
    box.appendChild(b);
  }
  var m = document.createElement('button');
  m.className = 'key mkey'; m.id = 'btMute'; m.title = 'Mute this layer (m)';
  m.innerHTML = '<span class="led"></span>MUTE';
  m.addEventListener('click', toggleMute);
  box.appendChild(m);
}
function buildWaves() {
  var box = $('waves'); box.innerHTML = '';
  WAVE_NAMES.forEach(function (n, w) {
    var b = document.createElement('button');
    b.className = 'key wkey'; b.dataset.w = w;
    b.innerHTML = '<span class="led"></span><svg viewBox="0 0 30 14" aria-hidden="true"><path d="' + WAVE_ICONS[w] + '"/></svg>' + n;
    b.addEventListener('click', function () { S.wave[curLayer] = w; changed(); syncUI(); audition(curLayer, 7); });
    box.appendChild(b);
  });
}
function buildPiano() {
  var box = $('piano'); box.innerHTML = '';
  var whites = [0, 2, 4, 5, 7, 9, 11], blacks = [1, 3, 6, 8, 10];
  var bpos = { 1: 1, 3: 2, 6: 4, 8: 5, 10: 6 };
  whites.forEach(function (k) {
    var b = document.createElement('button'); b.className = 'pk w'; b.dataset.k = k; b.textContent = KEY_NAMES[k];
    b.setAttribute('aria-label', 'Key ' + KEY_NAMES[k]);
    box.appendChild(b);
  });
  blacks.forEach(function (k) {
    var b = document.createElement('button'); b.className = 'pk b'; b.dataset.k = k; b.textContent = KEY_NAMES[k];
    b.setAttribute('aria-label', 'Key ' + KEY_NAMES[k]);
    b.style.left = 'calc(4px + (100% - 8px) * ' + (bpos[k] / 7) + ')';
    box.appendChild(b);
  });
  box.addEventListener('click', function (e) {
    var t = e.target.closest('.pk'); if (!t) return;
    S.P.keyRoot = +t.dataset.k; changed(); syncUI();
  });
}
function buildSlots() {
  var box = $('slots'); box.innerHTML = '';
  for (var i = 0; i < SLOTS; i++) {
    var b = document.createElement('button');
    b.className = 'key skey'; b.dataset.i = i;
    b.innerHTML = '<span class="led"></span>' + (i + 1);
    b.addEventListener('click', (function (i) { return function () {
      if (saveArmed) { saveSlot(i); setArmed(false); } else loadSlot(i);
    }; })(i));
    box.appendChild(b);
  }
}

// faders -----------------------------------------------------------------
var faders = {};
function fader(id, get, set) {
  var el = $(id), min = +el.dataset.min, max = +el.dataset.max, unit = el.dataset.unit;
  var slot = el.querySelector('.slot'), cap = el.querySelector('.capf'), fill = el.querySelector('.fill'), out = el.querySelector('output');
  el.setAttribute('aria-valuemin', min); el.setAttribute('aria-valuemax', max);
  function show() {
    var v = get(), t = (v - min) / (max - min);
    var pct = 'calc(11px + (100% - 22px) * ' + t + ')';
    cap.style.left = pct; fill.style.width = 'calc((100% - 22px) * ' + t + ' + 9px)';
    out.textContent = Math.round(v) + unit;
    el.setAttribute('aria-valuenow', Math.round(v));
  }
  function fromX(clientX) {
    var r = slot.getBoundingClientRect();
    var t = (clientX - r.left - 11) / (r.width - 22);
    t = Math.max(0, Math.min(1, t));
    var v = Math.round(min + t * (max - min));
    if (v !== Math.round(get())) { set(v); changed(); show(); updateReadout(); }
  }
  var drag = null;
  el.addEventListener('pointerdown', function (e) { ensureAudio(); drag = e.pointerId; try { el.setPointerCapture(e.pointerId); } catch (x) {} fromX(e.clientX); e.preventDefault(); });
  el.addEventListener('pointermove', function (e) { if (drag === e.pointerId) fromX(e.clientX); });
  el.addEventListener('pointerup', function () { drag = null; });
  el.addEventListener('pointercancel', function () { drag = null; });
  el.addEventListener('keydown', function (e) {
    var d = { ArrowLeft: -1, ArrowDown: -1, ArrowRight: 1, ArrowUp: 1, PageDown: -10, PageUp: 10 }[e.key];
    if (e.key === 'Home') d = min - get(); if (e.key === 'End') d = max - get();
    if (d === undefined) return;
    e.preventDefault(); e.stopPropagation();
    set(Math.max(min, Math.min(max, Math.round(get()) + d))); changed(); show(); updateReadout();
  });
  faders[id] = show;
  show();
}

// ================================================================== actions
function changed() { postState(); scheduleAutosave(); }
function toggleMute() { S.mute[curLayer] = S.mute[curLayer] ? 0 : 1; changed(); syncUI(); }
function clearLayer(L) { for (var c = 0; c < GRID; c++) for (var r = 0; r < GRID; r++) S.cells[ci(L, c, r)] = 0; }
function randomLayer(L) {
  clearLayer(L);
  // a playable random line, not noise: one or two notes per beat, mostly
  // stepwise, leaning on the lower half for low layers
  var r = Math.floor(Math.random() * 8) + 2;
  for (var c = 0; c < GRID; c++) {
    if (Math.random() < (c % 4 === 0 ? 0.85 : c % 2 === 0 ? 0.5 : 0.28)) {
      r = Math.max(0, Math.min(GRID - 1, r + Math.round((Math.random() - 0.5) * 5)));
      S.cells[ci(L, c, r)] = 1;
      if (Math.random() < 0.12) S.cells[ci(L, c, Math.min(GRID - 1, r + 2 + Math.floor(Math.random() * 3)))] = 1;
    }
  }
}
function setPlaying(on) {
  ensureAudio();
  S.P.playing = on;
  if (on) { displayStep = -1; A.queue.length = 0; }
  changed(); syncUI();
}
function nudgeBpm(d) { S.P.bpm = Math.max(40, Math.min(240, Math.round(S.P.bpm) + d)); changed(); faders.fBpm(); updateReadout(); }
function cycleScale(d) { S.P.scaleIdx = (S.P.scaleIdx + d + 12) % 12; changed(); syncUI(); }
function shiftKey(d) { S.P.keyRoot = (S.P.keyRoot + d + 12) % 12; changed(); syncUI(); }

$('btPlay').addEventListener('click', function () { setPlaying(!S.P.playing); });
$('octDn').addEventListener('click', function () { S.oct[curLayer] = Math.max(-2, S.oct[curLayer] - 1); changed(); syncUI(); audition(curLayer, 7); });
$('octUp').addEventListener('click', function () { S.oct[curLayer] = Math.min(2, S.oct[curLayer] + 1); changed(); syncUI(); audition(curLayer, 7); });
$('btClear').addEventListener('click', function () { clearLayer(curLayer); changed(); toast('Layer ' + (curLayer + 1) + ' cleared'); });
$('btRand').addEventListener('click', function () { randomLayer(curLayer); changed(); });
$('scDn').addEventListener('click', function () { cycleScale(-1); });
$('scUp').addEventListener('click', function () { cycleScale(1); });
document.querySelectorAll('.tab').forEach(function (t) { t.addEventListener('click', function () { curTab = t.dataset.tab; syncTabs(); saveUIPrefs(); }); });

// ================================================================== readout
var toastT = 0, toastMsg = '', toastBad = false;
function toast(msg, bad) { toastMsg = msg; toastBad = !!bad; toastT = performance.now() + 2600; updateReadout(); }
function scaleNoteNames() {
  var steps = T.SCALE_STEPS[S.P.scaleIdx];
  return steps.map(function (s) { return KEY_NAMES[(S.P.keyRoot + s) % 12]; }).join(' · ');
}
function updateReadout() {
  $('rdMain').innerHTML = '<b>' + KEY_NAMES[S.P.keyRoot] + '</b> ' + SCALE_NAMES[S.P.scaleIdx].toUpperCase() +
    ' <span class="ann' + (S.P.playing ? ' on' : '') + '">▶</span> <span>L' + (curLayer + 1) + ' ' + WAVE_NAMES[S.wave[curLayer]].toUpperCase() + '</span>' +
    (S.mute[curLayer] ? ' <span style="color:var(--mute)">MUTE</span>' : '');
  $('rdBpm').textContent = Math.round(S.P.bpm);
  $('rdStep').textContent = 'STEP ' + (displayStep >= 0 && S.P.playing ? String(displayStep + 1).padStart(2, '0') : '--') + '/16';
  var m = $('rdMsg'), now = performance.now(), msg = '', bad = false;
  if (now < toastT) { msg = toastMsg; bad = toastBad; }
  else if (!A.ctx) msg = 'PRESS PLAY';
  else if (A.ctx.state !== 'running') msg = 'TAP TO WAKE AUDIO';
  m.textContent = msg; m.className = 'rd-msg' + (bad ? ' bad' : '');
  syncExport();
}

function syncTabs() {
  document.querySelectorAll('.tab').forEach(function (t) { t.setAttribute('aria-selected', t.dataset.tab === curTab ? 'true' : 'false'); });
  document.querySelectorAll('.panel').forEach(function (p) { p.classList.toggle('on', p.dataset.tab === curTab); });
}

function syncUI() {
  document.querySelectorAll('.lkey').forEach(function (b) {
    var L = +b.dataset.l;
    b.classList.toggle('latched', L === curLayer);
    b.querySelector('.led.s').classList.toggle('on', L === curLayer);
    b.querySelector('.led.m').classList.toggle('on', !!S.mute[L]);
    b.querySelector('.sub').textContent = WAVE_NAMES[S.wave[L]].toUpperCase() + (S.oct[L] ? ' ' + (S.oct[L] > 0 ? '+' : '') + S.oct[L] : '');
    b.setAttribute('aria-pressed', L === curLayer ? 'true' : 'false');
  });
  $('btMute').classList.toggle('lit', !!S.mute[curLayer]);
  $('btMute').setAttribute('aria-pressed', S.mute[curLayer] ? 'true' : 'false');
  device.style.setProperty('--lc', LAYER_COL[curLayer]);
  document.querySelectorAll('.wkey').forEach(function (b) {
    var on = +b.dataset.w === S.wave[curLayer];
    b.classList.toggle('latched', on); b.classList.toggle('lit', on);
    b.style.setProperty('--lc', LAYER_COL[curLayer]);
    b.setAttribute('aria-pressed', on ? 'true' : 'false');
  });
  $('voiceTitle').textContent = 'LAYER ' + (curLayer + 1) + ' · VOICE';
  $('octVal').textContent = (S.oct[curLayer] > 0 ? '+' : '') + S.oct[curLayer];
  document.querySelectorAll('.pk').forEach(function (b) { b.classList.toggle('on', +b.dataset.k === S.P.keyRoot); b.setAttribute('aria-pressed', +b.dataset.k === S.P.keyRoot ? 'true' : 'false'); });
  $('scVal').textContent = SCALE_NAMES[S.P.scaleIdx];
  $('scNotes').textContent = 'Rows climb ' + scaleNoteNames() + ', lowest note ' + noteName(T.BASE_MIDI + S.P.keyRoot + S.oct[curLayer] * 12) + ' on layer ' + (curLayer + 1) + '.';
  $('btPlay').classList.toggle('lit', S.P.playing);
  $('btPlay').setAttribute('aria-pressed', S.P.playing ? 'true' : 'false');
  $('playLabel').textContent = S.P.playing ? 'STOP' : 'PLAY';
  for (var k in faders) faders[k]();
  syncSlots();
  updateReadout();
}
function noteName(m) { return KEY_NAMES[m % 12] + (Math.floor(m / 12) - 1); }

// ================================================================== text format
// Same plain format as the LÖVE build: integers only, and each layer's grid
// written as 16 lines of dots and hashes, highest row first, so a file looks
// like the pattern and can't carry code.
function serialize() {
  var o = [FILE_MAGIC + ' ' + FILE_VER,
    'bpm ' + Math.round(S.P.bpm), 'swing ' + Math.round(S.P.swing * 100), 'len ' + Math.round(S.P.noteLen * 100),
    'echo ' + Math.round(S.P.echo * 100), 'master ' + Math.round(S.P.master * 100),
    'key ' + (S.P.keyRoot + 1), 'scale ' + (S.P.scaleIdx + 1)];
  for (var L = 0; L < LAYERS; L++) {
    o.push('layer ' + (L + 1) + ' ' + (S.wave[L] + 1) + ' ' + S.oct[L] + ' ' + (S.mute[L] ? 1 : 0));
    for (var r = GRID - 1; r >= 0; r--) {
      var line = '';
      for (var c = 0; c < GRID; c++) line += S.cells[ci(L, c, r)] ? '#' : '.';
      o.push(line);
    }
  }
  return o.join('\n') + '\n';
}

// Builds a complete new state and checks every field before anything live is
// touched, so a bad file leaves the running pattern alone.
function parse(text) {
  if (typeof text !== 'string') return { err: 'not text' };
  if (text.length > 200000) return { err: 'file is too large to be a pattern' };
  var lines = text.replace(/\r/g, '').split('\n');
  var head = (lines[0] || '').trim().split(/\s+/);
  if (head[0] !== FILE_MAGIC) return { err: 'not a Tenori·Loop pattern' };
  var ver = parseInt(head[1], 10);
  if (!(ver >= 1)) return { err: 'missing version' };
  if (ver > FILE_VER) return { err: 'made by a newer version (' + ver + ')' };
  var st = { cells: new Uint8Array(LAYERS * GRID * GRID), wave: S.wave.slice(), oct: S.oct.slice(), mute: S.mute.slice(), P: {} };
  var RANGE = { bpm: [40, 240], swing: [0, 70], len: [5, 100], echo: [0, 100], master: [0, 100], key: [1, 12], scale: [1, 12] };
  var ALIAS = { notelen: 'len', length: 'len', note: 'len', tempo: 'bpm', mode: 'scale' };
  var L = -1, row = 0, seen = [false, false, false, false];
  for (var i = 1; i < lines.length; i++) {
    var ln = lines[i].trim();
    if (!ln || ln.charAt(0) === ';' || ln.charAt(0) === '-' && ln.charAt(1) === '-') continue;
    if (/^[.#]+$/.test(ln)) {
      if (L < 0) return { err: 'line ' + (i + 1) + ': grid row before any layer' };
      if (ln.length !== GRID) return { err: 'line ' + (i + 1) + ': a grid row must be ' + GRID + ' wide' };
      if (row >= GRID) return { err: 'line ' + (i + 1) + ': layer ' + (L + 1) + ' has more than ' + GRID + ' rows' };
      var r = GRID - 1 - row;
      for (var c = 0; c < GRID; c++) st.cells[ci(L, c, r)] = ln.charAt(c) === '#' ? 1 : 0;
      row++;
      continue;
    }
    var w = ln.split(/\s+/), k = w[0].toLowerCase();
    k = ALIAS[k] || k;
    if (k === 'layer') {
      if (L >= 0 && row !== GRID) return { err: 'layer ' + (L + 1) + ' has ' + row + ' rows, not ' + GRID };
      var n = [1, 2, 3, 4].map(function (j) { return parseInt(w[j], 10); });
      if (!(n[0] >= 1 && n[0] <= LAYERS)) return { err: 'line ' + (i + 1) + ': no layer ' + w[1] };
      if (!(n[1] >= 1 && n[1] <= WAVE_NAMES.length)) return { err: 'line ' + (i + 1) + ': no waveform ' + w[2] };
      if (!(n[2] >= -2 && n[2] <= 2)) return { err: 'line ' + (i + 1) + ': octave must be -2 to 2' };
      if (!(n[3] === 0 || n[3] === 1)) return { err: 'line ' + (i + 1) + ': mute must be 0 or 1' };
      L = n[0] - 1; row = 0; seen[L] = true;
      st.wave[L] = n[1] - 1; st.oct[L] = n[2]; st.mute[L] = n[3];
      continue;
    }
    if (RANGE[k]) {
      var v = Number(w[1]);
      if (!isFinite(v) || v !== Math.floor(v)) return { err: 'line ' + (i + 1) + ': ' + k + ' needs a whole number' };
      if (v < RANGE[k][0] || v > RANGE[k][1]) return { err: 'line ' + (i + 1) + ': ' + k + ' must be ' + RANGE[k][0] + '–' + RANGE[k][1] };
      st.P[k] = v;
      continue;
    }
    // unknown keywords are skipped, so a later version's extras don't break this one
  }
  if (L >= 0 && row !== GRID) return { err: 'layer ' + (L + 1) + ' has ' + row + ' rows, not ' + GRID + ' (truncated?)' };
  if (!seen.some(Boolean)) return { err: 'no layers in this pattern' };
  return { st: st };
}
function applyState(st) {
  S.cells.set(st.cells);
  S.wave = st.wave; S.oct = st.oct; S.mute = st.mute;
  var p = st.P;
  if (p.bpm !== undefined) S.P.bpm = p.bpm;
  if (p.swing !== undefined) S.P.swing = p.swing / 100;
  if (p.len !== undefined) S.P.noteLen = p.len / 100;
  if (p.echo !== undefined) S.P.echo = p.echo / 100;
  if (p.master !== undefined) S.P.master = p.master / 100;
  if (p.key !== undefined) S.P.keyRoot = p.key - 1;
  if (p.scale !== undefined) S.P.scaleIdx = p.scale - 1;
  changed(); syncUI();   // loading never rewinds: patterns swap under the playhead
}
function loadText(text, what) {
  var res = parse(text);
  if (res.err) { toast(what + ': ' + res.err, true); return false; }
  applyState(res.st); toast(what + ' loaded'); return true;
}

// ================================================================== storage
var mem = {}, storageOK = true;
function sget(k) { try { var v = localStorage.getItem(STORE + k); return v === null ? mem[k] || null : v; } catch (e) { storageOK = false; return mem[k] || null; } }
function sset(k, v) { mem[k] = v; try { localStorage.setItem(STORE + k, v); return true; } catch (e) { storageOK = false; return false; } }
function sdel(k) { delete mem[k]; try { localStorage.removeItem(STORE + k); } catch (e) {} }
var autoT = 0;
function scheduleAutosave() { clearTimeout(autoT); autoT = setTimeout(function () { sset('autosave', serialize()); }, 400); }
window.addEventListener('pagehide', function () { sset('autosave', serialize()); });
document.addEventListener('visibilitychange', function () { if (document.hidden) sset('autosave', serialize()); });
function saveUIPrefs() { sset('ui', JSON.stringify({ tab: curTab, layer: curLayer })); }

var saveArmed = false;
function setArmed(on) {
  saveArmed = on;
  $('btSave').classList.toggle('lit', on);
  document.querySelectorAll('.skey').forEach(function (b) { b.classList.toggle('armed', on); });
  if (on) toast('Tap a slot to store this pattern');
}
$('btSave').addEventListener('click', function () { setArmed(!saveArmed); });
function syncSlots() {
  document.querySelectorAll('.skey').forEach(function (b) {
    var full = !!sget('slot' + (+b.dataset.i + 1));
    b.classList.toggle('lit', full);
    b.title = 'Slot ' + (+b.dataset.i + 1) + (full ? ': tap to load' : ': empty');
  });
}
function saveSlot(i) {
  var ok = sset('slot' + (i + 1), serialize());
  syncSlots();
  toast(ok ? 'Stored in slot ' + (i + 1) : 'Stored in slot ' + (i + 1) + ' until you close this page', !ok);
}
function loadSlot(i) {
  var t = sget('slot' + (i + 1));
  if (!t) { toast('Slot ' + (i + 1) + ' is empty. Press STORE, then the slot', true); return; }
  loadText(t, 'Slot ' + (i + 1));
}

// copy / paste / files ---------------------------------------------------
function showText(on) { $('textBox').hidden = !on; if (on) $('patText').value = serialize(); }
$('btText').addEventListener('click', function () { showText($('textBox').hidden); });
$('btCopy').addEventListener('click', function () {
  var t = serialize();
  var fallback = function () { showText(true); var ta = $('patText'); ta.focus(); ta.select(); toast('Copy the selected text'); };
  if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(t).then(function () { toast('Pattern copied as text'); }, fallback);
  else fallback();
});
$('btLoadText').addEventListener('click', function () { loadText($('patText').value, 'Text'); });
$('btClearAll').addEventListener('click', function () { for (var L = 0; L < LAYERS; L++) clearLayer(L); changed(); toast('All layers cleared'); });
$('btOpen').addEventListener('click', function () { $('fileIn').click(); });
$('fileIn').addEventListener('change', function () { var f = this.files[0]; if (f) readFile(f); this.value = ''; });
function readFile(f) {
  if (f.size > 200000) { toast(f.name + ': too large to be a pattern', true); return; }
  var fr = new FileReader();
  fr.onload = function () { loadText(String(fr.result), f.name); };
  fr.onerror = function () { toast(f.name + ': could not be read', true); };
  fr.readAsText(f);
}
var dragDepth = 0;
window.addEventListener('dragenter', function (e) { if (e.dataTransfer && Array.prototype.indexOf.call(e.dataTransfer.types, 'Files') >= 0) { dragDepth++; $('dropHint').hidden = false; e.preventDefault(); } });
window.addEventListener('dragover', function (e) { e.preventDefault(); });
window.addEventListener('dragleave', function () { if (--dragDepth <= 0) { dragDepth = 0; $('dropHint').hidden = true; } });
window.addEventListener('drop', function (e) {
  e.preventDefault(); dragDepth = 0; $('dropHint').hidden = true;
  var f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
  if (f) readFile(f);
});
// ================================================================== audio export
// A second copy of the engine renders the pattern offline, faster than real
// time, so the file is what you hear: the same voices, swing, echo and master
// stage. Muted layers stay out, as they do when playing.
var EXPORT_SR = 48000, LOOP_CHOICES = [1, 2, 4, 8];
var EX = { loops: 2, seamless: false, busy: false };

function loopFrames(sr) { return 4 * 60 / Math.max(20, S.P.bpm) * sr; }   // 16 sixteenths

// Ring out: N loops from silence, then everything left to fade, up to 8 s.
// Seamless: one loop of pre-roll is thrown away, then exactly N loops are
// kept, cut on the samples where step 1 fires, so the file repeats cleanly
// with the echo and the long notes of the previous pass already in it.
function renderPattern(opts, progress) {
  return new Promise(function (resolve) {
    var sr = EXPORT_SR, E = T.TenoriEngine(sr, 32);
    E.message({ type: 'state', cells: S.cells.slice(), wave: S.wave.slice(), oct: S.oct.slice(), mute: S.mute.slice(),
                P: Object.assign({}, S.P, { playing: true }) });
    var lf = loopFrames(sr), B = 512;
    var stopAt = opts.seamless ? Infinity : Math.floor(opts.loops * lf);
    var maxTail = sr * 8, guess = opts.seamless ? (opts.loops + 2) * lf : stopAt + maxTail;
    var chunksL = [], chunksR = [], n = 0, starts = [], quiet = 0, tail = 0;
    var bl = new Float32Array(B), br = new Float32Array(B);
    function slice() {
      var until = performance.now() + 30;
      while (performance.now() < until) {
        var len = B;
        if (n < stopAt && n + len > stopAt) len = stopAt - n;          // stop exactly before the next pass
        if (n === stopAt && E.P.playing) E.message({ type: 'state', P: { playing: false } });
        E.render(bl, br, len, n / sr);
        for (var i = 0; i < E.events.length; i++) if (E.events[i].step === 0) starts.push(Math.round(E.events[i].time * sr));
        E.events.length = 0;
        chunksL.push(bl.slice(0, len)); chunksR.push(br.slice(0, len));
        n += len;
        if (opts.seamless) {
          if (starts.length >= opts.loops + 2) return finish(starts[1], starts[opts.loops + 1]);
        } else if (n > stopAt) {
          var pk = 0;
          for (i = 0; i < len; i++) pk = Math.max(pk, Math.abs(bl[i]), Math.abs(br[i]));
          quiet = pk < 0.0002 ? quiet + len : 0;
          tail += len;
          if (quiet >= sr * 0.25 || tail >= maxTail) return finish(0, n - quiet + Math.min(quiet, Math.round(sr * 0.05)));
        }
      }
      progress(Math.min(0.99, n / guess));
      setTimeout(slice, 0);
    }
    function finish(a, b) {
      var frames = b - a, L = new Float32Array(frames), R = new Float32Array(frames), pos = 0, at = 0;
      for (var c = 0; c < chunksL.length; c++) {
        var cl = chunksL[c], cr = chunksR[c];
        for (var i = 0; i < cl.length; i++, pos++) if (pos >= a && pos < b) { L[at] = cl[i]; R[at] = cr[i]; at++; }
      }
      var peak = 0;
      for (i = 0; i < frames; i++) peak = Math.max(peak, Math.abs(L[i]), Math.abs(R[i]));
      progress(1);
      resolve({ L: L, R: R, frames: frames, sr: sr, peak: peak, loopStarts: starts });
    }
    slice();
  });
}

// 16-bit PCM WAV, with triangular dither so quiet tails don't turn to grit
function encodeWav(L, R, sr) {
  var n = L.length, buf = new ArrayBuffer(44 + n * 4), v = new DataView(buf);
  function str(o, s) { for (var i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); }
  str(0, 'RIFF'); v.setUint32(4, 36 + n * 4, true); str(8, 'WAVE');
  str(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 2, true);
  v.setUint32(24, sr, true); v.setUint32(28, sr * 4, true); v.setUint16(32, 4, true); v.setUint16(34, 16, true);
  str(36, 'data'); v.setUint32(40, n * 4, true);
  var o = 44;
  for (var i = 0; i < n; i++) {
    for (var ch = 0; ch < 2; ch++) {
      var x = (ch ? R[i] : L[i]) * 32767 + (Math.random() - Math.random());
      x = Math.max(-32768, Math.min(32767, Math.round(x)));
      v.setInt16(o, x, true); o += 2;
    }
  }
  return new Uint8Array(buf);
}

// A stored (uncompressed) zip: the published page may only hand over files
// on an allowlist, and .zip is on it while .wav is not.
var CRC_T = null;
function crc32(b) {
  if (!CRC_T) { CRC_T = new Uint32Array(256); for (var i = 0; i < 256; i++) { var c = i; for (var k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; CRC_T[i] = c >>> 0; } }
  var crc = 0xFFFFFFFF;
  for (var j = 0; j < b.length; j++) crc = CRC_T[(crc ^ b[j]) & 0xFF] ^ (crc >>> 8);
  return (crc ^ 0xFFFFFFFF) >>> 0;
}
function makeZip(files) {
  var d = new Date(), time = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1);
  var date = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
  var parts = [], central = [], off = 0;
  files.forEach(function (f) {
    var name = new TextEncoder().encode(f.name), data = f.data, crc = crc32(data);
    var h = new DataView(new ArrayBuffer(30));
    h.setUint32(0, 0x04034b50, true); h.setUint16(4, 20, true); h.setUint16(8, 0, true);
    h.setUint16(10, time, true); h.setUint16(12, date, true); h.setUint32(14, crc, true);
    h.setUint32(18, data.length, true); h.setUint32(22, data.length, true); h.setUint16(26, name.length, true);
    var c = new DataView(new ArrayBuffer(46));
    c.setUint32(0, 0x02014b50, true); c.setUint16(4, 20, true); c.setUint16(6, 20, true);
    c.setUint16(12, time, true); c.setUint16(14, date, true); c.setUint32(16, crc, true);
    c.setUint32(20, data.length, true); c.setUint32(24, data.length, true); c.setUint16(28, name.length, true);
    c.setUint32(42, off, true);
    parts.push(new Uint8Array(h.buffer), name, data);
    central.push(new Uint8Array(c.buffer), name);
    off += 30 + name.length + data.length;
  });
  var cdSize = central.reduce(function (s, p) { return s + p.length; }, 0);
  var e = new DataView(new ArrayBuffer(22));
  e.setUint32(0, 0x06054b50, true); e.setUint16(8, files.length, true); e.setUint16(10, files.length, true);
  e.setUint32(12, cdSize, true); e.setUint32(16, off, true);
  return new Blob(parts.concat(central, [new Uint8Array(e.buffer)]), { type: 'application/zip' });
}

function exportName() {
  var key = KEY_NAMES[S.P.keyRoot].replace('#', 's');
  var sc = SCALE_NAMES[S.P.scaleIdx].toLowerCase().replace(/\s+/g, '-');
  return 'tenori-loop_' + key + '-' + sc + '_' + Math.round(S.P.bpm) + 'bpm_' + EX.loops + 'x' + (EX.seamless ? '_loop' : '');
}
function exportSeconds() { return EX.loops * loopFrames(1); }
function syncExport() {
  $('loopsVal').textContent = EX.loops + '×';
  $('btRingOut').classList.toggle('latched', !EX.seamless); $('btRingOut').classList.toggle('lit', !EX.seamless);
  $('btSeamless').classList.toggle('latched', EX.seamless); $('btSeamless').classList.toggle('lit', EX.seamless);
  $('btRingOut').setAttribute('aria-pressed', !EX.seamless ? 'true' : 'false');
  $('btSeamless').setAttribute('aria-pressed', EX.seamless ? 'true' : 'false');
  $('btWav').classList.toggle('lit', EX.busy); $('btWav').disabled = EX.busy;
  $('exNote').textContent = EX.loops + (EX.loops === 1 ? ' pass' : ' passes') + ' · ' + exportSeconds().toFixed(1) + ' s' +
    (EX.seamless ? ', cut to repeat cleanly' : ' + fade-out') + ' · 48 kHz 16-bit stereo WAV';
}

function saveBlob(name, blob) {
  var url = URL.createObjectURL(blob), a = document.createElement('a');
  a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
}

function exportAudio() {
  if (EX.busy) return;
  var silent = true;
  for (var L = 0; L < LAYERS && silent; L++) if (!S.mute[L]) for (var i = L * 256; i < L * 256 + 256; i++) if (S.cells[i]) { silent = false; break; }
  if (silent) { toast('Nothing to render: every unmuted layer is empty', true); return; }
  EX.busy = true; syncExport();
  var opts = { loops: EX.loops, seamless: EX.seamless }, base = exportName();
  renderPattern(opts, function (p) { toast('Rendering ' + Math.round(p * 100) + '%'); }).then(function (r) {
    var wav = encodeWav(r.L, r.R, r.sr);
    var note = r.peak >= 0.99 ? ' (peaks at full scale: lower MASTER for headroom)' : '';
    var host = window.claude && typeof window.claude.use === 'function';
    if (!host) {                                     // standalone page: a plain download works
      saveBlob(base + '.wav', new Blob([wav], { type: 'audio/wav' }));
      toast('Saved ' + base + '.wav' + note);
      EX.busy = false; syncExport();
      return;
    }
    var zip = makeZip([{ name: base + '.wav', data: wav }, { name: base + '.tnl', data: new TextEncoder().encode(serialize()) }]);
    toast('Confirm the save in the dialog');
    window.claude.use('downloads').then(function (dl) {
      if (!dl) throw { code: 'unavailable' };
      return dl.save({ filename: base + '.zip', data: zip });
    }).then(function () { toast('Saved ' + base + '.zip' + note); }, function (e) {
      var code = e && e.code;
      if (code === 'declined') toast('Save cancelled');
      else if (code === 'rate_limited') toast('A save dialog is already open', true);
      else toast('Saving files isn\'t available in this view. The standalone page saves WAV directly', true);
    }).then(function () { EX.busy = false; syncExport(); });
  });
}
$('loopsDn').addEventListener('click', function () { EX.loops = LOOP_CHOICES[Math.max(0, LOOP_CHOICES.indexOf(EX.loops) - 1)]; syncExport(); saveExportPrefs(); });
$('loopsUp').addEventListener('click', function () { EX.loops = LOOP_CHOICES[Math.min(LOOP_CHOICES.length - 1, LOOP_CHOICES.indexOf(EX.loops) + 1)]; syncExport(); saveExportPrefs(); });
$('btRingOut').addEventListener('click', function () { EX.seamless = false; syncExport(); saveExportPrefs(); });
$('btSeamless').addEventListener('click', function () { EX.seamless = true; syncExport(); saveExportPrefs(); });
$('btWav').addEventListener('click', exportAudio);
function saveExportPrefs() { sset('export', JSON.stringify({ loops: EX.loops, seamless: EX.seamless })); }

function editingText(e) { var t = e.target; return t && (t.tagName === 'TEXTAREA' || t.tagName === 'INPUT'); }
document.addEventListener('copy', function (e) {
  if (editingText(e) || String(window.getSelection())) return;
  e.clipboardData.setData('text/plain', serialize()); e.preventDefault(); toast('Pattern copied as text');
});
document.addEventListener('paste', function (e) {
  if (editingText(e)) return;
  var t = e.clipboardData && e.clipboardData.getData('text/plain');
  if (t) { e.preventDefault(); loadText(t, 'Pasted pattern'); }
});

// ================================================================== keyboard
document.addEventListener('keydown', function (e) {
  if (editingText(e) || e.metaKey || (e.ctrlKey && !/^Digit/.test(e.code))) return;
  var k = e.key, d = /^Digit([1-8])$/.exec(e.code);
  if (d && (e.shiftKey || e.altKey || e.ctrlKey)) {
    var i = +d[1] - 1; e.preventDefault();
    if (e.shiftKey) loadSlot(i); else saveSlot(i);
    return;
  }
  if (k === ' ' && e.target.tagName !== 'BUTTON') { e.preventDefault(); setPlaying(!S.P.playing); return; }
  if (k === ' ') return;
  if (/^[1-4]$/.test(k)) { curLayer = +k - 1; syncUI(); return; }
  if (k === 'm' || k === 'M') { toggleMute(); return; }
  if (k === 'C' && e.shiftKey) { for (var L = 0; L < LAYERS; L++) clearLayer(L); changed(); toast('All layers cleared'); return; }
  if (k === 'c') { clearLayer(curLayer); changed(); toast('Layer ' + (curLayer + 1) + ' cleared'); return; }
  if (k === 'r' || k === 'R') { randomLayer(curLayer); changed(); return; }
  if (k === 'w' || k === 'W') { exportAudio(); return; }
  if (e.target.closest && e.target.closest('.fader')) return;
  if (k === 'ArrowUp') { e.preventDefault(); nudgeBpm(1); return; }
  if (k === 'ArrowDown') { e.preventDefault(); nudgeBpm(-1); return; }
  if (k === 'ArrowLeft') { e.preventDefault(); cycleScale(-1); return; }
  if (k === 'ArrowRight') { e.preventDefault(); cycleScale(1); return; }
  if (k === '[') { shiftKey(-1); return; }
  if (k === ']') { shiftKey(1); return; }
});
// any first touch wakes the audio, as browsers require
document.addEventListener('pointerdown', function () { if (A.ctx && A.ctx.state !== 'running') A.ctx.resume(); }, true);

// ================================================================== layout
// port: one column. land: the matrix takes the full height beside a tabbed
// deck. desk: the matrix beside every control page at once.
function layout() {
  var W = document.documentElement.clientWidth, H = window.innerHeight;
  var mode = (W >= 980 && H >= 820 && W / H >= 1.2) ? 'desk' : (W / H >= 1.05 && W >= 560) ? 'land' : 'port';
  device.dataset.layout = mode;
  var gut = W <= 420 ? 10 : 16;
  document.querySelector('.stage').style.paddingBlock = mode === 'desk' ? '12px' : '8px';
  var devPad = W <= 420 ? 10 : 14, padV = W <= 420 ? 34 : 40, gap = 12;   // padV: the case's top margin carries the name
  var m;
  if (mode === 'port') {
    var colW = Math.min(W - 2 * gut, 560) - 2 * devPad;
    m = Math.min(colW, Math.max(260, H * 0.6));
  } else if (mode === 'land') {
    m = Math.min(H - 20 - padV, (Math.min(W, 1240) - 2 * gut - 2 * devPad - gap) * 0.6);
  } else {
    var top = 64;
    m = Math.min(H - 24 - padV - top - gap, Math.min(W, 1500) - 2 * gut - 2 * devPad - gap - 480, 920);
  }
  device.style.setProperty('--m', Math.max(220, Math.floor(m)) + 'px');
  if (mode === 'port') {
    // give back the few pixels that would push the deck past the screen,
    // but never shrink the matrix below 85% of the column
    var floor = Math.floor(document.querySelector('.bezel').getBoundingClientRect().width * 0.85);
    for (var it = 0; it < 4; it++) {
      var over = document.documentElement.scrollHeight - H;
      if (over <= 0) break;
      var real = document.querySelector('.bezel').getBoundingClientRect().width;
      if (real <= floor) break;
      device.style.setProperty('--m', Math.max(floor, Math.floor(real - over)) + 'px');
    }
  }
  requestAnimationFrame(sizeGrid);
}
window.addEventListener('resize', layout);
if (document.fonts && document.fonts.ready) document.fonts.ready.then(layout);
window.addEventListener('load', layout);
if (window.ResizeObserver) new ResizeObserver(function () { sizeGrid(); }).observe(cv);

// ================================================================== frame loop
var sc = $('scope'), sg = sc.getContext('2d'), scopeBuf = null, lastT = performance.now();
function drawScope() {
  var r = sc.getBoundingClientRect(), dpr = window.devicePixelRatio || 1;
  var w = Math.max(1, Math.round(r.width * dpr)), h = Math.max(1, Math.round(r.height * dpr));
  if (sc.width !== w || sc.height !== h) { sc.width = w; sc.height = h; }
  sg.clearRect(0, 0, w, h);
  sg.strokeStyle = 'rgba(87,224,200,.25)'; sg.lineWidth = 1;
  sg.beginPath(); sg.moveTo(0, h / 2); sg.lineTo(w, h / 2); sg.stroke();
  if (!A.analyser) return;
  if (!scopeBuf) scopeBuf = new Float32Array(A.analyser.fftSize);
  A.analyser.getFloatTimeDomainData(scopeBuf);
  var n = scopeBuf.length, st = 0;
  for (var i = 1; i < n / 2; i++) if (scopeBuf[i - 1] < 0 && scopeBuf[i] >= 0) { st = i; break; }   // trigger on a rising zero
  sg.strokeStyle = '#57e0c8'; sg.lineWidth = Math.max(1, dpr); sg.shadowColor = '#57e0c8'; sg.shadowBlur = 4 * dpr;
  sg.beginPath();
  var span = n / 2;
  for (i = 0; i < span; i++) {
    var x = i / (span - 1) * w, y = h / 2 - scopeBuf[st + i] * h * 0.9;
    if (i) sg.lineTo(x, y); else sg.moveTo(x, y);
  }
  sg.stroke(); sg.shadowBlur = 0;
}

function frame(now) {
  var dt = Math.min(0.1, (now - lastT) / 1000); lastT = now;
  // release every step that has reached the speaker
  if (A.ctx) {
    var t = audibleTime(), fired = false;
    while (A.queue.length && A.queue[0].time <= t) {
      var ev = A.queue.shift();
      if (!S.P.playing) continue;
      displayStep = ev.step; stepAt = now; stepLen = ev.len; fired = true;
      for (var L = 0; L < LAYERS; L++) {
        if (S.mute[L]) continue;
        for (var r = 0; r < GRID; r++) if (S.cells[ci(L, ev.step, r)]) {
          flash[ci(L, ev.step, r)] = 1;
          if (L === curLayer || Math.random() < 0.5) spawnRipple(L, ev.step, r);
        }
      }
    }
    if (fired) updateReadout();
  }
  var k = Math.exp(-dt * 7);
  for (var i = 0; i < flash.length; i++) if (flash[i] > 0) flash[i] = flash[i] * k < 0.01 ? 0 : flash[i] * k;
  for (i = ripples.length - 1; i >= 0; i--) {
    var rp = ripples[i];
    rp.life -= dt * 1.6; rp.rad += G.cell * dt * 3.2;
    if (rp.life <= 0) ripples.splice(i, 1);
  }
  drawGrid(now);
  drawScope();
  if (toastT && now > toastT) { toastT = 0; updateReadout(); }
  requestAnimationFrame(frame);
}

// ================================================================== start
function seedDemo() {
  // A minor pentatonic: rows 0,5,10,15 are A in successive octaves
  var put = function (L, list) { list.forEach(function (p) { S.cells[ci(L, p[0], p[1])] = 1; }); };
  put(0, [[0, 5], [2, 7], [3, 8], [5, 7], [6, 9], [8, 10], [10, 9], [11, 8], [13, 7], [14, 6]]);
  put(1, [[0, 0], [3, 0], [6, 1], [8, 2], [11, 2], [12, 3], [14, 4]]);
  put(2, [[2, 5], [5, 7], [9, 6], [13, 8]]);
  put(3, [[0, 10], [6, 12], [10, 11], [14, 13]]);
}
buildLayers(); buildWaves(); buildPiano(); buildSlots();
fader('fLen', function () { return S.P.noteLen * 100; }, function (v) { S.P.noteLen = v / 100; });
fader('fBpm', function () { return S.P.bpm; }, function (v) { S.P.bpm = v; });
fader('fSwing', function () { return S.P.swing * 100; }, function (v) { S.P.swing = v / 100; });
fader('fEcho', function () { return S.P.echo * 100; }, function (v) { S.P.echo = v / 100; });
fader('fMaster', function () { return S.P.master * 100; }, function (v) { S.P.master = v / 100; });

var restored = false, auto = sget('autosave');
if (auto) { var res = parse(auto); if (res.st) { applyState(res.st); restored = true; } }
if (!restored) seedDemo();
S.P.playing = false;
try { var xp = JSON.parse(sget('export') || '{}'); if (LOOP_CHOICES.indexOf(xp.loops) >= 0) EX.loops = xp.loops; EX.seamless = !!xp.seamless; } catch (e) {}
try { var ui = JSON.parse(sget('ui') || '{}'); if (ui.tab) curTab = ui.tab; if (ui.layer >= 0 && ui.layer < 4) curLayer = ui.layer; } catch (e) {}
syncTabs(); syncUI(); layout();
if (restored) toast('Restored your last pattern');
requestAnimationFrame(frame);

window.__tenori = { S: S, A: A, serialize: serialize, parse: parse, applyState: applyState, layout: layout, ensureAudio: ensureAudio, flash: flash, setPlaying: setPlaying,
  sprites: function (cs) { G.cell = cs; makeSprites(cs); }, spr: function () { return G.spr; },
  renderPattern: renderPattern, encodeWav: encodeWav, makeZip: makeZip, EX: EX, exportAudio: exportAudio, exportName: exportName };
})();

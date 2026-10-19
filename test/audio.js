// Offline measurements of every voice: pitch error, loudness, decay.
const load = require('./load');
const D = load();
const SR = +(process.argv[2] || 48000);
const NAMES = ['Sine', 'Tri', 'Saw', 'Square', 'Bell', 'Pluck'];

function renderNote(wave, midi, noteLen, secs) {
  const E = D.TenoriEngine(SR, 8);
  E.P.echo = 0; E.P.master = 0.8; E.P.scaleIdx = 11; E.P.keyRoot = 0; E.P.noteLen = noteLen;
  const rel = midi - 48;
  const oct = Math.floor(rel / 12) - (rel % 12 === 0 && rel > 0 ? 0 : 0);
  E.oct[0] = Math.max(-2, Math.min(2, Math.floor((rel - 3) / 12)));
  const row = rel - E.oct[0] * 12;
  if (row < 0 || row > 15) throw new Error('row ' + row);
  E.wave[0] = wave;
  E.fire(0, row, false);
  const n = Math.round(SR * secs), out = new Float32Array(n);
  const B = 128, L = new Float32Array(B), R = new Float32Array(B);
  for (let i = 0; i < n; i += B) {
    E.render(L, R, B, i / SR);
    for (let k = 0; k < B && i + k < n; k++) out[i + k] = 0.5 * (L[k] + R[k]);
  }
  return out;
}

// period by normalised autocorrelation, refined by a parabola
function pitch(x, f0) {
  const a = Math.round(SR * 0.03), b = Math.round(SR * 0.23);
  const seg = x.subarray(a, b);
  const lo = Math.floor(SR / (f0 * 1.15)), hi = Math.ceil(SR / (f0 / 1.15));
  const ac = [];
  for (let lag = lo - 1; lag <= hi + 1; lag++) {
    let s = 0, e1 = 0, e2 = 0;
    for (let i = 0; i + lag < seg.length; i++) { s += seg[i] * seg[i + lag]; e1 += seg[i] * seg[i]; e2 += seg[i + lag] * seg[i + lag]; }
    ac.push(s / Math.sqrt(e1 * e2 + 1e-20));
  }
  let best = 1;
  for (let i = 1; i < ac.length - 1; i++) if (ac[i] > ac[best]) best = i;
  const y0 = ac[best - 1], y1 = ac[best], y2 = ac[best + 1];
  const d = 0.5 * (y0 - y2) / (y0 - 2 * y1 + y2);
  return SR / (lo - 1 + best + d);
}

function stats(x) {
  let peak = 0, e = 0;
  const n25 = Math.round(SR * 0.25);
  for (let i = 0; i < x.length; i++) peak = Math.max(peak, Math.abs(x[i]));
  for (let i = 0; i < n25; i++) e += x[i] * x[i];
  const blk = Math.round(SR * 0.01);
  let t60 = -1;
  for (let i = 0; i + blk < x.length; i += blk) {
    let m = 0; for (let k = 0; k < blk; k++) m = Math.max(m, Math.abs(x[i + k]));
    if (m < peak * 0.001 && i > SR * 0.02) { t60 = i / SR; break; }
  }
  return { peak, rms: Math.sqrt(e / n25), t60 };
}

const cents = (f, ref) => 1200 * Math.log2(f / ref);
let worst = 0, fails = 0;
const midis = [45, 57, 69, 81, 86];
const rmsByWave = [];
for (let w = 0; w < 6; w++) {
  const row = [];
  for (const m of midis) {
    const f0 = 440 * Math.pow(2, (m - 69) / 12);
    const x = renderNote(w, m, 0.4, 2.5);
    const st = stats(x), f = pitch(x, f0), c = cents(f, f0);
    row.push(st.rms);
    if (w >= 4) worst = Math.max(worst, Math.abs(c));
    let bad = !isFinite(st.peak) || !(st.peak > 0.01) || st.peak > 1 || !(Math.abs(c) <= 3);
    if (bad) fails++;
    console.log(`${NAMES[w].padEnd(6)} midi ${m} ${f0.toFixed(1).padStart(7)}Hz  pitch ${c >= 0 ? '+' : ''}${c.toFixed(2)}c  peak ${st.peak.toFixed(3)}  rms ${st.rms.toFixed(3)}  t60 ${st.t60 < 0 ? '>2.5' : st.t60.toFixed(2)}s${bad ? '  <-- FAIL' : ''}`);
  }
  rmsByWave.push(row);
}
const mean = rmsByWave.map(r => r.reduce((a, b) => a + b) / r.length);
console.log('\nmean rms per wave:', mean.map((v, i) => NAMES[i] + ' ' + v.toFixed(3)).join('  '));
console.log('loudness spread (dB, max/min of mean rms):', (20 * Math.log10(Math.max(...mean) / Math.min(...mean))).toFixed(2));

// what the old Pluck did: a whole-sample period plus the average's half sample
console.log('\nold Pluck tuning (integer period + 0.5), at', SR, 'Hz:');
for (const m of midis) {
  const f0 = 440 * Math.pow(2, (m - 69) / 12);
  const fo = SR / (Math.round(SR / f0) + 0.5);
  console.log(`  midi ${m}: ${cents(fo, f0).toFixed(1)} cents`);
}

// decay follows NOTE LENGTH for the two reworked voices
console.log('\ndecay vs NOTE LENGTH (target tail = 0.05 + len^2 * 2.2 s):');
for (const w of [4, 5]) for (const nl of [0.2, 0.4, 0.7, 1.0]) {
  const x = renderNote(w, 69, nl, 3.5), st = stats(x);
  console.log(`  ${NAMES[w]} len ${nl}: target ${(0.05 + nl * nl * 2.2).toFixed(2)}s  measured t60 ${st.t60 < 0 ? '>3.5' : st.t60.toFixed(2)}s`);
}
console.log(fails ? `\n${fails} FAILURE(S)` : '\nALL PITCH/LEVEL CHECKS PASSED (worst reworked-voice error ' + worst.toFixed(2) + ' cents)');
process.exit(fails ? 1 : 0);

// Sequencer clock, gain staging and CPU cost of the engine.
const load = require('./load'); const D = load();
let fails = 0; const check = (ok, w) => { console.log((ok ? '  PASS  ' : '  FAIL  ') + w); if (!ok) fails++; };
const SR = 48000, B = 128;
function run(E, secs) {
  const L = new Float32Array(B), R = new Float32Array(B); let peak = 0, nan = false, events = [];
  for (let i = 0; i < SR * secs; i += B) {
    E.render(L, R, B, i / SR);
    for (let k = 0; k < B; k++) { const a = Math.abs(L[k]), b = Math.abs(R[k]); if (!(a <= 1 && b <= 1)) nan = true; peak = Math.max(peak, a, b); }
    events.push(...E.events); E.events.length = 0;
  }
  return { peak, nan, events };
}
// clock: 120 BPM, no swing -> a 16th every 0.125 s; with swing 0.5 -> 0.146/0.104
{
  const E = D.TenoriEngine(SR, 32); E.message({ type: 'state', P: { playing: true, bpm: 120, swing: 0 } });
  const { events } = run(E, 4.2);
  const d = events.slice(1).map((e, i) => e.time - events[i].time);
  check(events[0].step === 0 && events[16].step === 0, 'starts on step 1 and wraps after 16');
  check(d.every(x => Math.abs(x - 0.125) < 1 / SR + 1e-9), `straight 16ths at 120 BPM are 125 ms (${d[0].toFixed(5)})`);
  const E2 = D.TenoriEngine(SR, 32); E2.message({ type: 'state', P: { playing: true, bpm: 120, swing: 0.5 } });
  const ev2 = run(E2, 2).events, d2 = ev2.slice(1).map((e, i) => e.time - ev2[i].time);
  check(Math.abs(d2[0] - 0.125 * 1.17) < 1e-4 && Math.abs(d2[1] - 0.125 * 0.83) < 1e-4, `swing pushes every other 16th late (${d2[0].toFixed(4)} / ${d2[1].toFixed(4)})`);
  check(Math.abs(d2[0] + d2[1] - 0.25) < 1e-4, 'swing keeps the pair length, so the tempo holds');
}
// worst case a user can paint: every cell on every layer, max echo, master 100%
for (const w of [[0, 1, 2, 3], [4, 4, 4, 4], [5, 5, 5, 5]]) {
  const E = D.TenoriEngine(SR, 32);
  E.cells.fill(1); E.wave = w;
  E.message({ type: 'state', P: { playing: true, bpm: 240, echo: 1, master: 1, noteLen: 1 } });
  const t = process.hrtime.bigint(); const r = run(E, 6); const ms = Number(process.hrtime.bigint() - t) / 1e6;
  check(!r.nan && r.peak <= 1, `all 1024 cells, waves ${w.join(',')}: bounded, peak ${r.peak.toFixed(3)}, ${ (ms / 6 / 10).toFixed(1)}% of one core`);
}
// the shipped demo-style load: moderate pattern
{
  const E = D.TenoriEngine(SR, 32);
  for (let i = 0; i < E.cells.length; i++) E.cells[i] = Math.random() < 0.12 ? 1 : 0;
  E.message({ type: 'state', P: { playing: true } });
  const r = run(E, 8);
  check(!r.nan && r.peak < 0.9, `typical density (12%): peak ${r.peak.toFixed(3)}`);
}
// stopping keeps voices ringing out, starting again rewinds to step 1
{
  const E = D.TenoriEngine(SR, 32); E.message({ type: 'state', P: { playing: true } }); run(E, 0.7);
  E.message({ type: 'state', P: { playing: false } }); const a = run(E, 0.5);
  check(a.events.length === 0, 'no steps while stopped');
  E.message({ type: 'state', P: { playing: true } }); const b = run(E, 0.05);
  check(b.events[0] && b.events[0].step === 0, 'play restarts from step 1');
}
console.log(fails ? `${fails} FAILURE(S)` : 'ALL ENGINE CHECKS PASSED'); process.exit(fails ? 1 : 0);

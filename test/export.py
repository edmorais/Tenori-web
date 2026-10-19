# Renders the pattern to audio through the real buttons and checks the files.
import sys, io, wave, zipfile, pathlib, time, struct
from playwright.sync_api import sync_playwright
import numpy as np
url = 'file://' + str(pathlib.Path(__file__).resolve().parent.parent / 'TenoriLoop-standalone.html')
out = pathlib.Path(__file__).resolve().parent.parent / 'shots'
fails = 0
def check(ok, what):
    global fails
    print(('  PASS  ' if ok else '  FAIL  ') + what)
    if not ok: fails += 1
def read_wav(b):
    w = wave.open(io.BytesIO(b))
    fr = w.readframes(w.getnframes())
    a = np.frombuffer(fr, dtype='<i2').reshape(-1, 2).astype(np.float64) / 32768
    return w.getnchannels(), w.getframerate(), w.getsampwidth(), a
FAKE_HOST = """window.claude = { use: async (n) => n !== 'downloads' ? null : { save: async (r) => {
  if (window.__decline) throw { code: 'declined', message: 'no' };
  window.__saved = { filename: r.filename, bytes: Array.from(new Uint8Array(await r.data.arrayBuffer())) }; return { status: 'saved' }; } } };"""

with sync_playwright() as p:
    b = p.chromium.launch()
    # ---------------------------------------------------- standalone: bare WAV
    ctx = b.new_context(viewport={'width': 1440, 'height': 900}, accept_downloads=True)
    pg = ctx.new_page(); errs = []; pg.on('pageerror', lambda e: errs.append(str(e)))
    pg.goto(url); pg.wait_for_timeout(300)
    bpm = pg.evaluate("window.__tenori.S.P.bpm"); loop_s = 4 * 60 / bpm
    for loops, seamless in ((2, False), (1, True), (4, True)):
        pg.evaluate("([l, s]) => { const x = window.__tenori.EX; x.loops = l; x.seamless = s; }", [loops, seamless])
        t0 = time.time()
        with pg.expect_download() as dl: pg.click('#btWav')
        d = dl.value; data = pathlib.Path(d.path()).read_bytes(); ms = (time.time() - t0) * 1000
        ch, sr, sw, a = read_wav(data)
        name = d.suggested_filename
        check(ch == 2 and sr == 48000 and sw == 2, f'{name}: 48 kHz 16-bit stereo ({ms:.0f} ms to render)')
        n, want = len(a), loops * loop_s * 48000
        if seamless:
            check(abs(n - want) <= 1, f'  LOOP {loops}x is exactly {loops} pass(es): {n} frames, expected {want:.1f}')
            d1 = np.abs(np.diff(a[:, 0])); wrap = abs(a[-1, 0] - a[0, 0])
            check(wrap <= np.percentile(d1, 99.9), f'  the wrap from end to start is no bigger than an ordinary step ({wrap:.4f} vs 99.9th pct {np.percentile(d1, 99.9):.4f})')
            check(np.abs(a[:2400]).max() > 0.01, '  it opens already sounding (pre-roll echoes carried in)')
        else:
            check(want <= n <= want + 8.1 * 48000, f'  RING OUT: {n / 48000:.2f} s = {loops} passes ({want / 48000:.2f} s) + {(n - want) / 48000:.2f} s tail')
            check(np.abs(a[-480:]).max() < 0.002, '  it ends in silence')
            check(np.abs(a[:48]).max() < 0.3, '  it starts at the first note, not mid-sound')
        rms = np.sqrt((a ** 2).mean())
        check(0.01 < rms and np.abs(a).max() <= 1.0, f'  level: rms {rms:.3f}, peak {np.abs(a).max():.3f}')
    # the file matches what plays: the onsets fall on the sixteenth grid
    pg.evaluate("() => { const x = window.__tenori.EX; x.loops = 1; x.seamless = false; const S = window.__tenori.S; S.cells.fill(0); S.P.swing = 0; S.P.echo = 0;"
                " for (let c = 0; c < 16; c += 4) S.cells[(0*16+c)*16+5] = 1; }")
    with pg.expect_download() as dl: pg.click('#btWav')
    _, _, _, a = read_wav(pathlib.Path(dl.value.path()).read_bytes())
    env = np.abs(a[:, 0]); step = 60 / bpm / 4 * 48000
    onsets = [int(np.argmax(env[int(k * step): int(k * step) + 400] > 0.02)) + int(k * step) for k in (0, 4, 8, 12)]
    check(all(abs(o - k * step) < 60 for o, k in zip(onsets, (0, 4, 8, 12))), f'notes land on the beat grid (onsets {onsets}, beat = {4*step:.0f} frames)')
    # nothing to render
    pg.evaluate("() => { window.__tenori.S.cells.fill(0); }")
    pg.click('#btWav'); pg.wait_for_timeout(200)
    check('Nothing to render' in pg.inner_text('#rdMsg'), 'an empty pattern is refused: ' + pg.inner_text('#rdMsg'))
    pg.evaluate("() => { const S = window.__tenori.S; S.cells[5] = 1; S.mute[0] = 1; }")
    pg.click('#btWav'); pg.wait_for_timeout(200)
    check('Nothing to render' in pg.inner_text('#rdMsg'), 'a pattern that is only on muted layers is refused too')
    # worst case time: 8 passes at 40 BPM with dense bells
    pg.evaluate("() => { const t = window.__tenori, S = t.S; S.mute = [0,0,0,0]; S.wave = [4,4,4,4]; S.P.bpm = 40; S.P.echo = 1; S.P.noteLen = 1;"
                " for (let i = 0; i < S.cells.length; i++) S.cells[i] = (i * 7919) % 5 === 0 ? 1 : 0; t.EX.loops = 8; t.EX.seamless = false; }")
    t0 = time.time()
    with pg.expect_download(timeout=120000) as dl: pg.click('#btWav')
    sec = len(read_wav(pathlib.Path(dl.value.path()).read_bytes())[3]) / 48000
    check(True, f'worst case: {sec:.1f} s of audio (8 passes at 40 BPM, 205 bells) rendered in {time.time() - t0:.1f} s')
    check(not errs, 'no page errors ' + str(errs[:3]))
    ctx.close()

    # ---------------------------------------------------- published page: zip via the downloads capability
    ctx = b.new_context(viewport={'width': 390, 'height': 844}, device_scale_factor=2, has_touch=True, is_mobile=True)
    ctx.add_init_script(FAKE_HOST)
    pg = ctx.new_page(); errs = []; pg.on('pageerror', lambda e: errs.append(str(e)))
    pg.goto(url); pg.wait_for_timeout(300)
    pg.tap('.tab[data-tab="file"]'); pg.wait_for_timeout(100)
    pg.screenshot(path=str(out / 'phone-file-audio.png'))
    check(pg.is_visible('#btWav'), 'SAVE AUDIO sits on the FILE page on a phone')
    tnl = pg.evaluate("window.__tenori.serialize()")
    pg.evaluate("window.__log=[]; const m=document.getElementById('rdMsg'); new MutationObserver(()=>window.__log.push(m.textContent)).observe(m,{childList:true,characterData:true,subtree:true})")
    pg.tap('#btWav'); pg.wait_for_function("window.__saved", timeout=30000)
    s = pg.evaluate("window.__saved")
    z = zipfile.ZipFile(io.BytesIO(bytes(s['bytes'])))
    names = z.namelist()
    check(s['filename'].endswith('.zip') and z.testzip() is None, f"{s['filename']}: a valid zip, CRCs check")
    check(sorted(n.rsplit('.', 1)[1] for n in names) == ['tnl', 'wav'], f'  it holds the WAV and the pattern: {names}')
    ch, sr, sw, a = read_wav(z.read([n for n in names if n.endswith('.wav')][0]))
    check(ch == 2 and sr == 48000 and len(a) > 48000, f'  the WAV inside plays: {len(a) / 48000:.2f} s')
    check(z.read([n for n in names if n.endswith('.tnl')][0]).decode() == tnl, '  the .tnl inside is the pattern, byte for byte')
    log = pg.evaluate("window.__log")
    check(any(m.startswith('Saved') for m in log), '  the display confirms the save: ' + [m for m in log if m][-1])
    pg.evaluate("window.__decline = true; window.__saved = null")
    pg.tap('#btWav'); pg.wait_for_function("document.getElementById('rdMsg').textContent.includes('cancelled')", timeout=30000)
    check(not pg.evaluate("window.__tenori.EX.busy") and not pg.is_disabled('#btWav'), 'declining the save says so and frees the button')
    check(not errs, 'no page errors ' + str(errs[:3]))
    ctx.close(); b.close()
print('ALL EXPORT CHECKS PASSED' if not fails else '%d FAILURE(S)' % fails)
sys.exit(1 if fails else 0)

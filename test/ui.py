# Drives the page the way a person would and checks state, sound and storage.
import sys, json, pathlib
from playwright.sync_api import sync_playwright
url = 'file://' + str(pathlib.Path(__file__).resolve().parent.parent / 'TenoriLoop-standalone.html')
fails = 0
def check(ok, what):
    global fails
    print(('  PASS  ' if ok else '  FAIL  ') + what)
    if not ok: fails += 1
JS_LEVEL = "() => { const a = window.__tenori.A.analyser; if (!a) return 0; const b = new Float32Array(a.fftSize); a.getFloatTimeDomainData(b); return Math.max(...b.map(Math.abs)); }"
def level(pg, ms=1200):
    best = 0
    for _ in range(ms // 100):
        pg.wait_for_timeout(100); best = max(best, pg.evaluate(JS_LEVEL))
    return best

def cell_point(pg, c, r):
    return pg.evaluate("""([c, r]) => { const cv = document.getElementById('grid'), b = cv.getBoundingClientRect();
      const s = b.width, pad = s * 0.035, cell = (s - 2 * pad) / 16;
      return [b.left + pad + (c + 0.5) * cell, b.top + pad + (15 - r + 0.5) * cell]; }""", [c, r])
CELL = "([L,c,r]) => window.__tenori.S.cells[(L*16+c)*16+r]"

with sync_playwright() as p:
    b = p.chromium.launch(args=['--autoplay-policy=no-user-gesture-required'])
    for mode in ('worklet', 'script'):
        ctx = b.new_context(viewport={'width': 1440, 'height': 900})
        if mode == 'script':
            ctx.add_init_script("delete window.AudioWorkletNode;")
        pg = ctx.new_page(); errs = []
        pg.on('pageerror', lambda e: errs.append(str(e)))
        pg.goto(url); pg.wait_for_timeout(300)
        print('--', mode)
        pg.click('#btPlay'); lv = level(pg)
        check(pg.evaluate("window.__tenori.A.mode") == mode, 'audio path is ' + mode)
        check(lv > 0.02, 'the demo pattern makes sound (peak %.3f)' % lv)
        steps = set()
        for _ in range(14):
            pg.wait_for_timeout(90); steps.add(pg.inner_text('#rdStep'))
        check(len(steps) >= 6, 'the step readout follows the audio (%d distinct)' % len(steps))
        pg.click('#btPlay'); pg.wait_for_timeout(1500)
        check(level(pg, 500) < 0.003, 'STOP lets the notes ring out to silence')
        if mode == 'script': ctx.close(); continue

        # painting: click toggles, a drag paints a run, a drag from a lit cell erases
        pg.evaluate("window.__tenori.S.cells.fill(0)")
        x, y = cell_point(pg, 3, 4); pg.mouse.click(x, y)
        check(pg.evaluate(CELL, [0, 3, 4]) == 1, 'click lights a cell on the current layer')
        pg.mouse.click(x, y)
        check(pg.evaluate(CELL, [0, 3, 4]) == 0, 'a second click clears it')
        x0, y0 = cell_point(pg, 0, 8); x1, y1 = cell_point(pg, 15, 8)
        pg.mouse.move(x0, y0); pg.mouse.down(); pg.mouse.move(x1, y1, steps=3); pg.mouse.up()
        run = sum(pg.evaluate(CELL, [0, c, 8]) for c in range(16))
        check(run == 16, 'a fast drag across the row leaves no gaps (%d/16)' % run)
        pg.mouse.move(x0, y0); pg.mouse.down(); pg.mouse.move(x1, y1, steps=2); pg.mouse.up()
        check(sum(pg.evaluate(CELL, [0, c, 8]) for c in range(16)) == 0, 'a drag that starts on a lit cell erases')

        # layers, mute, voice, octave
        pg.click('.lkey[data-l="2"]'); pg.mouse.click(x, y)
        check(pg.evaluate(CELL, [2, 3, 4]) == 1 and pg.evaluate(CELL, [0, 3, 4]) == 0, 'layer 3 paints on its own pattern')
        pg.click('.lkey[data-l="2"]')
        check(pg.evaluate("window.__tenori.S.mute[2]") == 1, 'tapping the selected layer again mutes it')
        pg.click('#btMute')
        check(pg.evaluate("window.__tenori.S.mute[2]") == 0, 'MUTE unmutes it')
        pg.click('.wkey[data-w="4"]')
        check(pg.evaluate("window.__tenori.S.wave[2]") == 4, 'BELL sets the layer voice')
        pg.click('#octUp'); pg.click('#octUp'); pg.click('#octUp')
        check(pg.evaluate("window.__tenori.S.oct[2]") == 2, 'octave stops at +2')
        pg.click('.pk[data-k="2"]')
        check(pg.evaluate("window.__tenori.S.P.keyRoot") == 2, 'the piano key sets the key to D')
        pg.click('#scUp')
        check(pg.evaluate("window.__tenori.S.P.scaleIdx") == 9, 'MODE ▶ steps to Blues')

        # faders by drag and by keyboard
        box = pg.locator('#fBpm .slot').bounding_box()
        pg.mouse.move(box['x'] + 11, box['y'] + 15); pg.mouse.down(); pg.mouse.move(box['x'] + box['width'] - 11, box['y'] + 15, steps=4); pg.mouse.up()
        check(pg.evaluate("window.__tenori.S.P.bpm") == 240, 'dragging TEMPO to the end gives 240')
        pg.focus('#fBpm'); pg.keyboard.press('PageDown')
        check(pg.evaluate("window.__tenori.S.P.bpm") == 230 and pg.inner_text('#rdBpm') == '230', 'PageDown on the fader steps 10 and the display follows')

        # keyboard shortcuts
        pg.focus('#grid')
        pg.keyboard.press('2'); check(pg.evaluate("1+0") and pg.evaluate("document.querySelector('.lkey[data-l=\"1\"]').classList.contains('latched')"), 'key 2 selects layer 2')
        pg.keyboard.press('ArrowUp'); check(pg.evaluate("window.__tenori.S.P.bpm") == 231, 'up arrow nudges the tempo')
        pg.keyboard.press(']'); check(pg.evaluate("window.__tenori.S.P.keyRoot") == 3, '] transposes up')
        pg.keyboard.press('r'); check(sum(pg.evaluate("Array.from(window.__tenori.S.cells.slice(256,512))")) > 4, 'r writes a random line on layer 2')

        # storage: store, change, recall; then reload restores the autosave
        before = pg.evaluate("window.__tenori.serialize()")
        pg.click('.tab[data-tab="file"]') if pg.is_visible('.tab[data-tab="file"]') else None
        pg.click('#btSave'); pg.click('.skey[data-i="2"]')
        check(pg.evaluate("document.querySelector('.skey[data-i=\"2\"]').classList.contains('lit')"), 'slot 3 lights after STORE')
        pg.keyboard.press('Shift+C')
        check(sum(pg.evaluate("Array.from(window.__tenori.S.cells)")) == 0, 'shift+C clears every layer')
        pg.click('.skey[data-i="2"]')
        check(pg.evaluate("window.__tenori.serialize()") == before, 'slot 3 brings the pattern back exactly')
        pg.wait_for_timeout(600)
        pg.reload(); pg.wait_for_timeout(400)
        check(pg.evaluate("window.__tenori.serialize()") == before, 'a reload restores the working pattern')
        check(pg.evaluate("document.querySelector('.skey[data-i=\"2\"]').classList.contains('lit')"), 'slots survive a reload')

        # the text format: round trip and hostile input
        txt = pg.evaluate("window.__tenori.serialize()")
        rows = [l for l in txt.split('\n') if l and set(l) <= set('.#')]
        check(len(rows) == 64 and all(len(r) == 16 for r in rows), 'the file is 64 grid rows of 16 dots and hashes')
        check('.' not in ''.join(l for l in txt.split('\n') if not set(l) <= set('.#')).replace('TENORILOOP', ''), 'no decimal points anywhere in the numbers')
        bad = ['', 'hello world', 'TENORILOOP 99\nbpm 120\n', 'TENORILOOP 1\nbpm 999999\n', 'TENORILOOP 1\nbpm -50\nscale 400\n',
               'TENORILOOP 1\nlayer 9 1 0 0\n####\n', 'TENORILOOP 1\nlayer 1 99 -80 1\n', txt[:len(txt)//2],
               'TENORILOOP 1\n' + '#' * 5000, 'TENORILOOP 1\nlayer 1 1 0 0\n' + '#' * 400, 'TENORILOOP 1\n\0\0\0binary\0junk\n', 'TENORILOOP 1\nbpm 12.5\n']
        res = pg.evaluate("(cases) => cases.map(c => { try { const r = window.__tenori.parse(c); return r.err ? 'err' : 'ok'; } catch (e) { return 'crash ' + e; } })", bad)
        check(all(r == 'err' for r in res), 'all 12 malformed inputs are refused without a crash ' + str(res))
        check(pg.evaluate("(t) => !window.__tenori.parse(t).err", txt.replace('\n', '\r\n')), 'Windows line endings load')
        check(pg.evaluate("window.__tenori.serialize()") == txt, 'refused files leave the live pattern alone')
        pg.click('#btText'); pg.fill('#patText', 'nonsense'); pg.click('#btLoadText')
        check('not a Tenori' in pg.inner_text('#rdMsg'), 'a bad paste is reported on the display: ' + pg.inner_text('#rdMsg'))
        check(not errs, 'no page errors ' + str(errs[:3]))
        ctx.close()
    b.close()
print('ALL UI CHECKS PASSED' if not fails else '%d FAILURE(S)' % fails)
sys.exit(1 if fails else 0)

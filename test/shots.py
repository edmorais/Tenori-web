import sys, json, pathlib
from playwright.sync_api import sync_playwright
url = 'file://' + str(pathlib.Path(__file__).resolve().parent.parent / 'TenoriLoop-standalone.html')
out = pathlib.Path(__file__).resolve().parent.parent / 'shots'
VIEWS = [('desk-1440x900', 1440, 900, 1, False), ('laptop-1280x720', 1280, 720, 1, False),
         ('phone-390x844', 390, 844, 3, True), ('phone-land-844x390', 844, 390, 3, True),
         ('tablet-820x1180', 820, 1180, 2, True), ('small-360x640', 360, 640, 2, True)]
only = sys.argv[1:] 
import base64
FD = pathlib.Path('/tmp/claude-0/-home-claude/4daa7daf-740a-5476-94cd-869e7f3582eb/scratchpad/fonts')
def face(fam, path, w):
    return "@font-face{font-family:'%s';font-weight:%d;font-display:block;src:url(data:font/woff2;base64,%s) format('woff2')}" % (fam, w, base64.b64encode(path.read_bytes()).decode())
CSS = ''
for w in (500, 600, 700):
    f = next(FD.glob('*saira*/package/files/saira-semi-condensed-latin-%d-normal.woff2' % w))
    CSS += face('Saira Semi Condensed', f, w)
for w in (400, 600):
    f = next(FD.glob('*martian*/package/files/martian-mono-latin-%d-normal.woff2' % w))
    CSS += face('Martian Mono', f, w)
with sync_playwright() as p:
    b = p.chromium.launch(args=['--autoplay-policy=no-user-gesture-required'])
    for name, w, h, dpr, touch in VIEWS:
        if only and not any(o in name for o in only): continue
        ctx = b.new_context(viewport={'width': w, 'height': h}, device_scale_factor=dpr, has_touch=touch, is_mobile=touch)
        pg = ctx.new_page(); errs = []
        pg.route('https://fonts.googleapis.com/**', lambda r: r.fulfill(status=200, content_type='text/css', body=CSS))
        pg.on('console', lambda m: errs.append(m.type + ': ' + m.text) if m.type in ('error', 'warning') else None)
        pg.on('pageerror', lambda e: errs.append('pageerror: ' + str(e)))
        pg.goto(url); pg.wait_for_timeout(400)
        pg.click('#btPlay'); pg.wait_for_timeout(1600)
        info = pg.evaluate("""() => { const t = window.__tenori, d = document.documentElement, dev = document.getElementById('device');
          const r = dev.getBoundingClientRect(), g = document.getElementById('grid').getBoundingClientRect();
          return { mode: t.A.mode, ctx: t.A.ctx && t.A.ctx.state, layout: dev.dataset.layout, sr: t.A.ctx && t.A.ctx.sampleRate,
                   hscroll: d.scrollWidth > d.clientWidth, docH: d.scrollHeight, devW: Math.round(r.width), devH: Math.round(r.height),
                   grid: Math.round(g.width) + 'x' + Math.round(g.height), step: document.getElementById('rdStep').textContent } }""")
        pg.screenshot(path=str(out / (name + '.png')))
        print(name, json.dumps(info), errs[:5])
        ctx.close()
    b.close()

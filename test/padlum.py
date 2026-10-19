# Mean brightness of an unlit pad (on the matrix background), old design vs current.
import pathlib, sys
from playwright.sync_api import sync_playwright
url = 'file://' + str(pathlib.Path(__file__).resolve().parent.parent / 'TenoriLoop-standalone.html')
OLD = r"""(cs) => {
  function mk(w, h, fn) { var c = document.createElement('canvas'); c.width = w; c.height = h; fn(c.getContext('2d')); return c; }
  function rr(x, c, y, w, h, r) { x.beginPath(); x.moveTo(c + r, y); x.arcTo(c + w, y, c + w, y + h, r); x.arcTo(c + w, y + h, c, y + h, r); x.arcTo(c, y + h, c, y, r); x.arcTo(c, y, c + w, y, r); x.closePath(); }
  var b = cs * 0.80, o = (cs - b) / 2, rad = b * 0.24, out = [];
  for (var k = 0; k < 2; k++) out.push(mk(cs, cs, function (x) {
    rr(x, o, o + b * 0.04, b, b, rad); x.fillStyle = 'rgba(0,0,0,.65)'; x.fill();
    var gr = x.createLinearGradient(0, o, 0, o + b);
    gr.addColorStop(0, k ? '#2f3540' : '#262b33'); gr.addColorStop(1, k ? '#1b1f26' : '#16191e');
    rr(x, o, o, b, b * 0.96, rad); x.fillStyle = gr; x.fill();
    var hl = x.createRadialGradient(o + b * 0.38, o + b * 0.28, 0, o + b * 0.38, o + b * 0.28, b * 0.6);
    hl.addColorStop(0, 'rgba(255,255,255,.10)'); hl.addColorStop(1, 'rgba(255,255,255,0)');
    x.fillStyle = hl; x.fill();
    x.strokeStyle = 'rgba(255,255,255,.06)'; x.lineWidth = 1; x.stroke();
  }));
  return out; }"""
MEASURE = """(sprites) => sprites.map(function (s) {
  var c = document.createElement('canvas'); c.width = s.width; c.height = s.height; var x = c.getContext('2d');
  x.fillStyle = '#0a0c10'; x.fillRect(0, 0, c.width, c.height); x.drawImage(s, 0, 0);
  var d = x.getImageData(0, 0, c.width, c.height).data, sum = 0, n = 0, face = 0, fn = 0, w = c.width;
  for (var i = 0; i < d.length; i += 4) {
    var l = 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2]; sum += l; n++;
    var px = (i / 4) % w, py = Math.floor(i / 4 / w);
    if (px > w * 0.3 && px < w * 0.7 && py > w * 0.3 && py < w * 0.7) { face += l; fn++; }
  }
  return [Math.round(sum / n * 10) / 10, Math.round(face / fn * 10) / 10]; })"""
with sync_playwright() as p:
    b = p.chromium.launch(); pg = b.new_page(viewport={'width': 1440, 'height': 900}); pg.goto(url); pg.wait_for_timeout(400)
    cs = pg.evaluate("window.__tenori.G ? 0 : 0") or 40
    old = pg.evaluate("(cs) => { const o = (" + OLD + ")(cs); return (" + MEASURE + ")(o); }", cs)
    new = pg.evaluate("(cs) => { window.__tenori.sprites(cs); return (" + MEASURE + ")(window.__tenori.spr().off); }", cs)
    print('cell', cs, 'px   [whole cell, centre of face]')
    print('old  plain / beat:', old)
    print('new  plain / beat:', new)
    b.close()

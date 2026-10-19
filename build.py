import pathlib
d = pathlib.Path(__file__).parent
html = (d/'app.html').read_text()
dsp = (d/'dsp.js').read_text()
app = (d/'app.js').read_text()
assert '</script' not in dsp and '</script' not in app
html = html.replace('/*__DSP__*/', dsp).replace('/*__APP__*/', app)
(d/'TenoriLoop.html').write_text(html)
print('built', len(html), 'bytes')
sa = ('<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n'
      '<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">\n'
      '<style>:root{padding-top:env(safe-area-inset-top,0px);padding-bottom:env(safe-area-inset-bottom,0px)}body{margin:0}</style>\n'
      '</head>\n<body>\n' + html + '\n</body>\n</html>\n')
(d/'TenoriLoop-standalone.html').write_text(sa)
print('standalone', len(sa), 'bytes')

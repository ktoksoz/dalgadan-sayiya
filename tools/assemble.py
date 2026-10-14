"""index.html'i parçalardan kurar (yalnızca yazım kolaylığı; yayınlanan site derlemesizdir).
tools/parts/ch*.html  -> slaytlar (sırayla)
js/demos/ch*.js       -> demo betikleri
css/demos-ch*.css     -> demo stilleri
Kullanım: python3 tools/assemble.py"""
import glob, os, re
root = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
os.chdir(root)
t = open("tools/index.template.html", encoding="utf-8").read()
# mevcut index.html'deki sürüm etiketini koru
v = "1"
if os.path.exists("index.html"):
    m = re.search(r'\?v=(\d+)"', open("index.html", encoding="utf-8").read())
    if m: v = m.group(1)
def key(p):
    m = re.search(r"ch(\d+)([a-z]*)", p)
    return (int(m.group(1)), m.group(2))
parts = sorted(glob.glob("tools/parts/ch*.html"), key=key)
slides = "\n".join(open(p, encoding="utf-8").read().strip() + "\n" for p in parts)
scripts = "\n".join(f'<script src="{p}?v=1"></script>' for p in sorted(glob.glob("js/demos/ch*.js"), key=key))
css = "\n".join(f'<link rel="stylesheet" href="{p}?v=1">' for p in sorted(glob.glob("css/demos-ch*.css"), key=key))
out = t.replace("<!-- @slides -->", slides).replace("<!-- @scripts -->", scripts).replace("<!-- @css -->", css)
out = re.sub(r'\?v=\d+"', f'?v={v}"', out)
open("index.html", "w", encoding="utf-8").write(out)
n = out.count('<section class="slide')
print(f"index.html: {len(parts)} bölüm, {n} slayt")

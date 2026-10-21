"""Package Periodic Lab as an installable phone app (a Progressive Web App) for GitHub Pages.

Why a PWA instead of a native Android app: it's the same code as the Claude artifact, installs from
Chrome with "Add to Home screen" / "Install app", runs full-screen and offline, and needs no Play Store,
no build toolchain and no developer account. A native app would mean a second codebase to keep in sync.

What this script does
  1. Wraps site/index.html in a full HTML document (the artifact host adds this wrapper for us; GitHub
     Pages doesn't), adding the manifest, icons and the service-worker registration.
  2. Copies bench.js and the data files.
  3. Writes data/discussed.json (your element log) from an export of the artifact's database.
  4. Writes manifest.webmanifest, sw.js (offline cache) and the app icons.

Run: python3 -I build/build_app.py <site_dir> <log_export_dir> <out_dir>
"""
import json, os, shutil, sys, glob, hashlib
from PIL import Image, ImageDraw

site, log_dir, out = sys.argv[1:4]
os.makedirs(os.path.join(out, "data"), exist_ok=True)
os.makedirs(os.path.join(out, "icons"), exist_ok=True)

# ---------- data + scripts ----------
for f in ("bench.js", "learn.js", "view3d.js", "data/elements.json", "data/molecules.json", "data/lessons.json", "data/reactions.json", "data/mol3d.json", "data/photos.json"):
    if os.path.exists(os.path.join(site, f)): shutil.copyfile(os.path.join(site, f), os.path.join(out, f))
if os.path.isdir(os.path.join(site, "photos")):
    shutil.copytree(os.path.join(site, "photos"), os.path.join(out, "photos"), dirs_exist_ok=True)
log = []
for f in sorted(glob.glob(os.path.join(log_dir, "*.json"))):
    d = json.load(open(f)); d.setdefault("symbol", os.path.basename(f)[:-5]); log.append(d)
log.sort(key=lambda d: d.get("z", 999))
json.dump(log, open(os.path.join(out, "data/discussed.json"), "w"), indent=1, ensure_ascii=False)

# ---------- icons: an atom on a dark tile ----------
def icon(size, pad_frac):
    S = size * 4                                   # draw big, then downsample for smooth edges
    im = Image.new("RGB", (S, S), (14, 18, 23)); d = ImageDraw.Draw(im)
    c, R = S / 2, S * (0.5 - pad_frac)
    for k, (rx, ry, rot) in enumerate([(R * .92, R * .36, 0), (R * .92, R * .36, 60), (R * .92, R * .36, 120)]):
        ring = Image.new("L", (S, S), 0); rd = ImageDraw.Draw(ring)
        rd.ellipse([c - rx, c - ry, c + rx, c + ry], outline=255, width=int(S * .018))
        ring = ring.rotate(rot, resample=Image.BICUBIC, center=(c, c))
        im.paste((110, 155, 255), mask=ring)
    import math
    for k, rot in enumerate([0, 60, 120]):
        a = math.radians(rot); ex, ey = c + R * .92 * math.cos(a + .9) * 1, c
        t = .9 + k * 2.1
        x = c + R * .92 * math.cos(t) * math.cos(math.radians(rot)) - R * .36 * math.sin(t) * math.sin(math.radians(rot))
        y = c + R * .92 * math.cos(t) * math.sin(math.radians(rot)) + R * .36 * math.sin(t) * math.cos(math.radians(rot))
        r = S * .035; d.ellipse([x - r, y - r, x + r, y + r], fill=(110, 155, 255))
    for i, col in enumerate([(240, 112, 95), (125, 134, 146), (240, 112, 95), (125, 134, 146), (240, 112, 95)]):
        ang = i * 2.4; rr = S * .045 * math.sqrt(i + .5) * .9
        x, y = c + rr * math.cos(ang), c + rr * math.sin(ang); r = S * .045
        d.ellipse([x - r, y - r, x + r, y + r], fill=col)
    return im.resize((size, size), Image.LANCZOS)
icon(192, .08).save(os.path.join(out, "icons/icon-192.png"))
icon(512, .08).save(os.path.join(out, "icons/icon-512.png"))
icon(512, .2).save(os.path.join(out, "icons/maskable-512.png"))   # extra padding: Android crops these into circles/squircles

# ---------- manifest ----------
json.dump({
    "name": "Periodic Lab", "short_name": "Periodic Lab",
    "description": "Explore atoms, snap them into molecules, and keep a log of the elements we've talked about.",
    "start_url": "./", "scope": "./", "display": "standalone", "orientation": "any",
    "background_color": "#0E1217", "theme_color": "#0E1217",
    "icons": [
        {"src": "icons/icon-192.png", "sizes": "192x192", "type": "image/png"},
        {"src": "icons/icon-512.png", "sizes": "512x512", "type": "image/png"},
        {"src": "icons/maskable-512.png", "sizes": "512x512", "type": "image/png", "purpose": "maskable"},
    ],
}, open(os.path.join(out, "manifest.webmanifest"), "w"), indent=1)

# ---------- page ----------
page = open(os.path.join(site, "index.html")).read()
head = """<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="theme-color" content="#0E1217">
<link rel="manifest" href="manifest.webmanifest">
<link rel="icon" href="icons/icon-192.png">
<link rel="apple-touch-icon" href="icons/icon-192.png">
<style>:root{color-scheme:light;padding-top:env(safe-area-inset-top,0px);padding-bottom:env(safe-area-inset-bottom,0px)}
body{margin:0;font:14px system-ui,sans-serif}img{max-width:100%}[hidden]{display:none!important}</style>
</head><body>
"""
sw_reg = """
<script>
/* offline support + "Install app" in Chrome */
if ("serviceWorker" in navigator) addEventListener("load", () => navigator.serviceWorker.register("sw.js").catch(() => {}));
</script>
</body></html>
"""
open(os.path.join(out, "index.html"), "w").write(head + page + sw_reg)

# ---------- service worker: cache the app so it opens offline ----------
files = ["./", "index.html", "bench.js", "learn.js", "view3d.js", "data/elements.json", "data/molecules.json", "data/lessons.json", "data/reactions.json", "data/mol3d.json", "data/photos.json", "manifest.webmanifest",
         "icons/icon-192.png", "icons/icon-512.png", "icons/maskable-512.png"]
files = [f for f in files if f == "./" or os.path.exists(os.path.join(out, f))]
digest = hashlib.sha1(b"".join(open(os.path.join(out, f), "rb").read() for f in files if f != "./")).hexdigest()[:10]
open(os.path.join(out, "sw.js"), "w").write(f"""/* Periodic Lab service worker. The cache name changes whenever the app files change,
   so a new version replaces the old one on the next launch. */
const CACHE = "plab-{digest}";
const APP = {json.dumps(files)};
self.addEventListener("install", e => {{ e.waitUntil(caches.open(CACHE).then(c => c.addAll(APP)).then(() => self.skipWaiting())); }});
self.addEventListener("activate", e => {{ e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())); }});
self.addEventListener("fetch", e => {{
  const url = new URL(e.request.url);
  if (e.request.method !== "GET") return;
  // the element log changes from chats: try the network first, fall back to the saved copy
  if (url.pathname.endsWith("/data/discussed.json")) {{
    e.respondWith(fetch(e.request).then(r => {{ const copy = r.clone(); caches.open(CACHE).then(c => c.put(e.request, copy)); return r; }}).catch(() => caches.match(e.request)));
    return;
  }}
  // fonts: keep a copy so the app looks right offline
  if (url.host.endsWith("fonts.googleapis.com") || url.host.endsWith("fonts.gstatic.com")) {{
    e.respondWith(caches.match(e.request).then(hit => hit || fetch(e.request).then(r => {{ const copy = r.clone(); caches.open(CACHE).then(c => c.put(e.request, copy)); return r; }})));
    return;
  }}
  // photos: saved the first time you open them, so the gallery works offline after one look
  if (url.pathname.includes("/photos/")) {{
    e.respondWith(caches.match(e.request).then(hit => hit || fetch(e.request).then(r => {{ const copy = r.clone(); caches.open(CACHE).then(c => c.put(e.request, copy)); return r; }})));
    return;
  }}
  // everything else: app files from the cache, network if missing
  e.respondWith(caches.match(e.request, {{ignoreSearch: true}}).then(hit => hit || fetch(e.request)));
}});
""")
open(os.path.join(out, ".nojekyll"), "w").write("")
print("app built:", out, "cache", digest, "log entries", len(log))

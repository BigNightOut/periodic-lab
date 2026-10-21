"""Collect a small, properly licensed photo gallery from Wikimedia Commons.

For each element (and ~45 everyday molecules) we read the matching English Wikipedia article's image
list, keep only real photos (JPEG, no diagrams/models/spectra by filename), and accept a file only if it
lives on Wikimedia Commons under public domain, CC0, CC BY or CC BY-SA. Author, license and source page
are stored for the credit line. Photos are shrunk to 560px WebP.
Run: python3 -I build/fetch_photos.py <site_dir>
"""
import json, os, re, sys, io, time, html, urllib.parse, urllib.request, concurrent.futures as cf
from PIL import Image

SITE = sys.argv[1]
UA = {"User-Agent": "PeriodicLab/1.0 (personal learning app; dennychow99@gmail.com)"}
OUT_EL, OUT_MOL = os.path.join(SITE, "photos/el"), os.path.join(SITE, "photos/mol")
for d in (OUT_EL, OUT_MOL):
    os.makedirs(d, exist_ok=True)   # existing downloads are reused; delete the folder to start over

import hashlib, threading, urllib.error
CACHE = "/tmp/claude-0/-home-claude/7db43b1f-2080-52d1-812a-8ef826d8c6ca/scratchpad/wmcache"; os.makedirs(CACHE, exist_ok=True)
_lock, _last = threading.Lock(), [0.0]
def get(url, tries=4):
    """Polite fetch: one request at a time, ~1 per second, backs off on 429, caches API answers on disk."""
    key = os.path.join(CACHE, hashlib.sha1(url.encode()).hexdigest())
    api = "api.php" in url or "/api/rest_v1/" in url
    if api and os.path.exists(key): return open(key, "rb").read()
    for k in range(tries):
        with _lock:
            wait = 0.9 - (time.time() - _last[0])
            if wait > 0: time.sleep(wait)
            _last[0] = time.time()
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=30) as r: b = r.read()
            if api: open(key, "wb").write(b)
            return b
        except urllib.error.HTTPError as e:
            if e.code == 404: return None
            time.sleep(min(30, int(e.headers.get("Retry-After") or 0) or 8 * (k + 1)))
        except Exception:
            time.sleep(3 * (k + 1))
    return None
def getj(url):
    b = get(url); return json.loads(b) if b else None

BAD = re.compile(r"diagram|structure|formula|model|ball|stick|spectr|orbital|shell|lattice|unit.?cell|logo|map|chart|graph|symbol|icon|svg|bohr|periodic|3d|molecule|skeletal|lewis|ion|isotope|decay|stamp|portrait of|signature", re.I)
FREE = re.compile(r"^(public domain|pd|cc0|cc by(-sa)?( \d\.\d)?.*)$", re.I)

def media(title):
    j = getj("https://en.wikipedia.org/api/rest_v1/page/media-list/" + urllib.parse.quote(title.replace(" ", "_")))
    out = []
    for it in (j or {}).get("items", []):
        t = it.get("title", "")
        if it.get("type") != "image" or not re.search(r"\.jpe?g$", t, re.I) or BAD.search(t): continue
        out.append({"title": t, "caption": (it.get("caption") or {}).get("text", "")})
    return out

def commons_info(titles):
    """Batch lookup: only files hosted on Commons with a free license survive."""
    res = {}
    for i in range(0, len(titles), 40):
        chunk = titles[i:i + 40]
        q = "https://commons.wikimedia.org/w/api.php?action=query&format=json&prop=imageinfo&iiprop=url|extmetadata|mime&iiurlwidth=640&titles=" + urllib.parse.quote("|".join(chunk))
        j = getj(q) or {}
        for pg in (j.get("query", {}).get("pages", {}) or {}).values():
            ii = (pg.get("imageinfo") or [None])[0]
            if not ii or pg.get("missing") is not None: continue
            md = ii.get("extmetadata", {})
            lic = re.sub("<[^>]+>", "", (md.get("LicenseShortName") or {}).get("value", "")).strip()
            if not FREE.match(lic) or "nc" in lic.lower() or "nd" in lic.lower(): continue
            artist = html.unescape(re.sub("<[^>]+>", "", (md.get("Artist") or {}).get("value", ""))).strip() or "Unknown"
            desc = html.unescape(re.sub("<[^>]+>", "", (md.get("ImageDescription") or {}).get("value", ""))).strip()
            res[pg["title"].replace(" ", "_")] = {"thumb": ii.get("thumburl"), "license": lic, "credit": artist[:80], "desc": desc,
                                                  "source": ii.get("descriptionurl"), "mime": ii.get("mime")}
        time.sleep(0.3)
    return res

def save(thumb, path):
    if os.path.exists(path) and os.path.getsize(path) > 2000: return os.path.getsize(path) < 90_000
    b = get(thumb)
    if not b: return False
    try:
        im = Image.open(io.BytesIO(b)).convert("RGB")
        if im.width > 560: im = im.resize((560, round(im.height * 560 / im.width)), Image.LANCZOS)
        im.save(path, "WEBP", quality=70, method=5)
        return os.path.getsize(path) < 90_000
    except Exception: return False

def clean_caption(c, fallback):
    c = re.sub(r"\s+", " ", html.unescape(re.sub("<[^>]+>", "", c or ""))).strip()
    if not c or len(c) < 8: c = fallback
    return (c[:150].rsplit(" ", 1)[0] + "…") if len(c) > 150 else c

def kind_for(text, first, molecule):
    if molecule: return "real"
    if first: return "portrait"
    return "origin" if re.search(r"\bore\b|mineral|crystal|native|mine\b|deposit|rock|meteorit|nature", text, re.I) else "use"

els = json.load(open(os.path.join(SITE, "data/elements.json")))
mols = {m["id"]: m for m in json.load(open(os.path.join(SITE, "data/molecules.json")))}
MAJOR = set("H He C N O Na Mg Al Si P S Cl Ar K Ca Ti Cr Fe Co Ni Cu Zn Ga Ag Sn I Xe W Pt Au Hg Pb U Pu Li B F Ne Nd Ge".split())
TITLE_FIX = {"Mercury": "Mercury (element)", "Lead": "Lead", "Tin": "Tin", "Iron": "Iron", "Gold": "Gold"}
# molecules: Wikipedia article titles for the everyday set (lead structure drawings get filtered out)
MOL_TITLES = {"water": "Water", "o2": "Oxygen", "n2": "Nitrogen", "co2": "Carbon dioxide", "glucose": "Glucose", "methane": "Methane",
  "nacl": "Sodium chloride", "ammonia": "Ammonia", "h2so4": "Sulfuric acid", "ethylene": "Ethylene", "polyethylene": "Polyethylene",
  "h2": "Hydrogen", "ethanol": "Ethanol", "sucrose": "Sucrose", "polypropylene": "Polypropylene", "pvc": "Polyvinyl chloride",
  "pet": "Polyethylene terephthalate", "propane": "Propane", "aceticacid": "Vinegar", "caffeine": "Caffeine", "aspirin": "Aspirin",
  "urea": "Urea", "hcl": "Hydrochloric acid", "isooctane": "Gasoline", "dodecane": "Kerosene", "benzene": "Benzene",
  "polystyrene": "Polystyrene", "ptfe": "Polytetrafluoroethylene", "acetone": "Acetone", "co": "Carbon monoxide",
  "h2o2": "Hydrogen peroxide", "ozone": "Ozone", "o3": "Ozone", "citricacid": "Citric acid", "ascorbic": "Vitamin C",
  "acetaminophen": "Paracetamol", "fe2o3": "Rust", "sio2": "Quartz", "diamond": "Diamond", "graphite": "Graphite",
  "stainless": "Stainless steel", "steel": "Steel", "cu_metal": "Copper wire and cable", "brass": "Brass", "bronze": "Bronze",
  "caco3": "Limestone", "nahco3": "Sodium bicarbonate", "naoh": "Sodium hydroxide", "glycol": "Ethylene glycol",
  "methanol": "Methanol", "al2o3": "Corundum", "tio2": "Titanium dioxide", "mgo": "Magnesium oxide", "cao": "Calcium oxide",
  "butane": "Butane", "acetylene": "Acetylene", "hexadecane": "Diesel fuel", "naphthalene": "Naphthalene", "sic": "Silicon carbide", "wc": "Tungsten carbide"}
MOL_TITLES = {k: v for k, v in MOL_TITLES.items() if k in mols}

HINTS = {"nacl": "halite salt crystal", "polyethylene": "bag film bottle polyethylene hdpe", "water": "water drop ice ocean wave", "co2": "dry ice carbon dioxide",
  "o2": "liquid oxygen", "n2": "liquid nitrogen", "h2": "hydrogen", "glucose": "glucose sugar crystal", "sucrose": "sugar sucrose",
  "pet": "bottle pet", "pvc": "pipe pvc", "polystyrene": "foam styrofoam polystyrene", "ptfe": "teflon ptfe pan", "fe2o3": "rust rusty",
  "sio2": "quartz crystal", "diamond": "diamond", "graphite": "graphite", "stainless": "stainless", "steel": "steel", "brass": "brass",
  "bronze": "bronze", "cu_metal": "copper wire cable", "aceticacid": "vinegar", "isooctane": "gasoline petrol pump", "dodecane": "kerosene",
  "hexadecane": "diesel", "methane": "methane flame gas", "propane": "propane tank cylinder", "ammonia": "ammonia fertilizer", "caffeine": "caffeine coffee",
  "aspirin": "aspirin tablet", "acetaminophen": "paracetamol tablet", "ascorbic": "vitamin c orange citrus", "citricacid": "citric lemon",
  "ethanol": "ethanol alcohol", "methanol": "methanol", "acetone": "acetone", "benzene": "benzene", "urea": "urea", "h2so4": "sulfuric acid",
  "hcl": "hydrochloric", "h2o2": "peroxide", "o3": "ozone", "co": "carbon monoxide", "caco3": "limestone chalk", "nahco3": "baking soda bicarbonate",
  "naoh": "sodium hydroxide lye pellets", "glycol": "antifreeze", "al2o3": "corundum sapphire ruby", "tio2": "titanium dioxide pigment",
  "mgo": "magnesium oxide", "cao": "lime quicklime", "butane": "butane lighter", "acetylene": "acetylene welding torch", "naphthalene": "mothball naphthalene",
  "sic": "silicon carbide", "wc": "tungsten carbide", "polypropylene": "polypropylene"}
EXTRA_WORDS = "ore mineral native crystal nugget wire sample ingot pellet pure metal rod bar foil powder chunk".split()
def lead_image(title):
    j = getj("https://en.wikipedia.org/api/rest_v1/page/summary/" + urllib.parse.quote(title.replace(" ", "_"))) or {}
    src = (j.get("originalimage") or {}).get("source", "")
    if not src: return None
    name = urllib.parse.unquote(src.split("?")[0].rsplit("/", 1)[-1])
    return None if name.lower().endswith(".svg") else {"title": "File:" + name, "caption": ""}
def collect(key, title, n, molecule):
    words = (HINTS.get(key, "") if molecule else title.split(" (")[0]).lower().split()
    items = media(title); time.sleep(0.2)
    def score(it):
        t = (it["caption"] + " " + it["title"]).lower()
        hit = sum(w in t for w in words)
        return hit + (0.5 * sum(w in t for w in EXTRA_WORDS) if not molecule else 0)
    picked = [it for it in items if score(it) >= 1]
    picked.sort(key=score, reverse=True)
    if not molecule:
        lead = lead_image(title); time.sleep(0.2)
        if lead:
            picked = [lead] + [it for it in picked if it["title"].replace(" ", "_") != lead["title"].replace(" ", "_")]
    return key, title, picked[:n + 3]

jobs = [(e["symbol"], TITLE_FIX.get(e["name"], e["name"]), 3 if e["symbol"] in MAJOR else 1, False) for e in els if e["z"] <= 100]
jobs += [(k, t, 1, True) for k, t in MOL_TITLES.items()]
cand = {}
with cf.ThreadPoolExecutor(1) as ex:
    for key, title, items in ex.map(lambda j: collect(*j), jobs):
        cand[key] = items
titles = sorted({it["title"].replace(" ", "_") for items in cand.values() for it in items})
info = commons_info(titles)
print("candidates", len(titles), "free on Commons", len(info))

photos = {"elements": {}, "molecules": {}}
tasks = []
for key, title, n, molecule in jobs:
    got = []
    for it in cand.get(key, []):
        meta = info.get(it["title"].replace(" ", "_"))
        if not meta or not meta["thumb"]: continue
        if meta["mime"] != "image/jpeg" and not (not molecule and not got and meta["mime"] == "image/png"): continue
        got.append((it, meta))
        if len(got) >= n: break
    for i, (it, meta) in enumerate(got):
        if molecule: path, rel = os.path.join(OUT_MOL, f"{key}.webp"), f"photos/mol/{key}.webp"
        else: path, rel = os.path.join(OUT_EL, f"{key}-{i + 1}.webp"), f"photos/el/{key}-{i + 1}.webp"
        cap = clean_caption(it["caption"], clean_caption(meta["desc"], title))
        tasks.append((key, molecule, path, {"file": rel, "kind": kind_for(cap + " " + it["title"], i == 0, molecule), "caption": cap,
                                            "credit": meta["credit"], "license": meta["license"], "source": meta["source"]}, meta["thumb"]))
def run(t):
    key, molecule, path, rec, thumb = t
    ok = save(thumb, path); time.sleep(0.15)
    return key, molecule, rec if ok else None, path
with cf.ThreadPoolExecutor(1) as ex:
    for key, molecule, rec, path in ex.map(run, tasks):
        if not rec:
            if os.path.exists(path): os.remove(path)
            continue
        photos["molecules" if molecule else "elements"].setdefault(key, []).append(rec)
# keep each element's list ordered portrait first
for k, v in photos["elements"].items(): v.sort(key=lambda r: r["file"])
json.dump(photos, open(os.path.join(SITE, "data/photos.json"), "w"), indent=1, ensure_ascii=False)
total = sum(os.path.getsize(os.path.join(SITE, r["file"])) for g in photos.values() for v in g.values() for r in v)
print("elements with photos:", len(photos["elements"]), "molecules:", len(photos["molecules"]),
      "files:", sum(len(v) for g in photos.values() for v in g.values()), "MB:", round(total / 1e6, 2))

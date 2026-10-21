"""Build site/data/elements.json from PubChem's periodic table + hand-written content batches.

Why a build step: PubChem gives authoritative physical data (public domain, US gov);
the teaching content lives in content/batch_*.json; the page only ever reads one merged file.
Run:  python3 -I build/build_elements.py <pubchem.json> <content_dir> <out.json>
"""
import json, re, sys, glob, os

pub_path, content_dir, out_path = sys.argv[1:4]
rows = json.load(open(pub_path))["Table"]["Row"]
cols = json.load(open(pub_path))["Table"]["Columns"]["Column"]

NOBLE = {"He": "1s2", "Ne": "[He]2s2 2p6", "Ar": "[Ne]3s2 3p6", "Kr": "[Ar]4s2 3d10 4p6",
         "Xe": "[Kr]5s2 4d10 5p6", "Rn": "[Xe]6s2 4f14 5d10 6p6"}

def expand(cfg):
    """Expand '[Ar]4s1 3d10' into a list of (n, l, count)."""
    cfg = re.sub(r"\(.*?\)", "", cfg).strip()
    m = re.match(r"\[(\w+)\]\s*(.*)", cfg)
    out = []
    if m:
        out += expand(NOBLE[m.group(1)])
        cfg = m.group(2)
    for tok in cfg.split():
        mm = re.match(r"(\d)([spdf])(\d+)", tok)
        if mm:
            out.append((int(mm.group(1)), mm.group(2), int(mm.group(3))))
    return out

# Seat engine needs a "typical bonding capacity" for nonmetals and a "typical ion charge" for metals.
COVALENT_VALENCE = {"H": 1, "B": 3, "C": 4, "N": 3, "O": 2, "F": 1, "Si": 4, "P": 3, "S": 2, "Cl": 1,
                    "Ge": 4, "As": 3, "Se": 2, "Br": 1, "Sb": 3, "Te": 2, "I": 1, "At": 1}
ANION_CHARGE = {"N": -3, "O": -2, "F": -1, "P": -3, "S": -2, "Cl": -1, "Se": -2, "Br": -1, "Te": -2, "I": -1, "H": -1, "C": -4}

def position(z):
    """(row, col) on the 18-column grid; f-block goes to rows 9/10."""
    if z == 1: return 1, 1
    if z == 2: return 1, 18
    periods = [(3, 10, 2), (11, 18, 3), (19, 36, 4), (37, 54, 5), (55, 86, 6), (87, 118, 7)]
    for lo, hi, p in periods:
        if lo <= z <= hi:
            i = z - lo
            if p in (2, 3):
                return p, (i + 1 if i < 2 else i + 11)
            if p in (4, 5):
                return p, i + 1
            # periods 6/7: 2 s-block, then La/Ac at col 3, f-block below, then d from col 4
            if i < 2: return p, i + 1
            if i == 2: return p, 3                 # La / Ac
            if 3 <= i <= 16: return p + 3, i + 1   # Ce-Lu / Th-Lr -> rows 9/10, cols 4-17
            return p, i - 13
    raise ValueError(z)

content = {}
for f in sorted(glob.glob(os.path.join(content_dir, "batch_*.json"))):
    for item in json.load(open(f)):
        content[item["z"]] = item

elements = []
for r in rows:
    c = dict(zip(cols, r["Cell"]))
    z = int(c["AtomicNumber"]); sym = c["Symbol"]
    orb = expand(c["ElectronConfiguration"])
    shells = [0] * 7
    for n, l, k in orb:
        shells[n - 1] += k
    while shells and shells[-1] == 0:
        shells.pop()
    assert sum(shells) == z, (sym, shells)
    row, col = position(z)
    mass = float(c["AtomicMass"])
    cat = c["GroupBlock"]
    ox = [s.strip() for s in c["OxidationStates"].split(",") if s.strip()]
    pos_ox = [int(s) for s in ox if s.startswith("+")]
    # main-group = s/p block; the octet "open seats" picture only applies there
    last_l = max(orb, key=lambda t: (t[0], "spdf".index(t[1])))[1] if orb else "s"
    block = "f" if row >= 9 else ("d" if 3 <= col <= 12 else ("s" if col <= 2 or z == 2 else "p"))
    if z in (57, 89): block = "f"  # La/Ac sit with the f-block family in this table
    valence = shells[-1]
    e = {
        "z": z, "symbol": sym, "name": c["Name"], "mass": mass,
        "neutrons": max(0, round(mass) - z),       # most common isotope, approx.
        "config": re.sub(r"\s*\(.*?\)", "", c["ElectronConfiguration"]).strip(),
        "shells": shells, "valence": valence, "block": block,
        "category": cat, "row": row, "col": col,
        "en": float(c["Electronegativity"]) if c["Electronegativity"] else None,
        "ionization": float(c["IonizationEnergy"]) if c["IonizationEnergy"] else None,
        "radius": int(c["AtomicRadius"]) if c["AtomicRadius"] else None,
        "state": c["StandardState"].replace("Expected to be a ", "").lower() or None,
        "melt": float(c["MeltingPoint"]) if c["MeltingPoint"] else None,
        "boil": float(c["BoilingPoint"]) if c["BoilingPoint"] else None,
        "density": float(c["Density"]) if c["Density"] else None,
        "year": c["YearDiscovered"],
        "ox": ox,
        "cpk": c["CPKHexColor"] or None,
        "covalentValence": COVALENT_VALENCE.get(sym),
        "cationCharge": (pos_ox[0] if pos_ox else None),
        "anionCharge": ANION_CHARGE.get(sym),
    }
    e.update({k: v for k, v in content.get(z, {}).items() if k != "z"})
    elements.append(e)

json.dump(elements, open(out_path, "w"), separators=(",", ":"), ensure_ascii=False)
print("elements:", len(elements), "with content:", len(content), "bytes:", os.path.getsize(out_path))
for s in ("H", "C", "Cu", "U", "La", "Lu", "Og"):
    e = next(x for x in elements if x["symbol"] == s)
    print(s, e["shells"], e["row"], e["col"], e["block"], e["neutrons"], e["cationCharge"])

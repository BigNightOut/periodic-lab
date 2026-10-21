"""Check lessons.json and reactions.json against the molecule library.

Lessons:   every step's goal must be reachable (atoms/bonds only grow step to step) and the last step's
           goal must be exactly the target molecule (same atom counts, same bonds by element pair + order).
Reactions: every reactant/product id must exist, and atoms must balance on both sides.
Run: python3 -I build/validate_content.py <site/data dir>   (exit code 1 on any problem)
"""
import json, os, sys
from collections import Counter

D = sys.argv[1]
mols = {m["id"]: m for m in json.load(open(os.path.join(D, "molecules.json")))}
extra = os.path.join(D, "molecules_extra_preview.json")
if os.path.exists(extra):
    for m in json.load(open(extra)): mols.setdefault(m["id"], m)
problems = []

def bond_multiset(m):
    """Bonds of a library molecule as Counter{(A,B,order)} with A<=B, ignoring chain-end markers."""
    at = m["atoms"]; c = Counter()
    for i, j, o in m["bonds"]:
        a, b = at[i][0], at[j][0]
        if "*" in (a, b): continue
        a, b = sorted((a, b)); c[(a, b, o)] += 1
    return c

def lattice_ionic_ok(m):
    return m["kind"] == "lattice" and m["lattice"]["style"] == "ionic"

lp = os.path.join(D, "lessons.json")
if os.path.exists(lp):
    L = json.load(open(lp))
    seen = set()
    for u in L["units"]:
        for les in u["lessons"]:
            lid = les["id"]
            if lid in seen: problems.append(f"lesson {lid}: duplicate id")
            seen.add(lid)
            t = mols.get(les["target"])
            if not t: problems.append(f"lesson {lid}: unknown target {les['target']}"); continue
            if t["kind"] == "lattice" and not lattice_ionic_ok(t): problems.append(f"lesson {lid}: target {t['id']} is not buildable on the bench"); continue
            prev_atoms, prev_bonds = Counter(), Counter()
            for k, st in enumerate(les["steps"]):
                g = st.get("goal", {})
                atoms = Counter(g.get("atoms", {}))
                bonds = Counter()
                for b in g.get("bonds", []):
                    a, c, o, n = b
                    a, c = sorted((a, c)); bonds[(a, c, o)] += n
                for s, n in prev_atoms.items():
                    if atoms[s] < n: problems.append(f"lesson {lid} step {k+1}: atoms shrink ({s})")
                prev_atoms, prev_bonds = atoms, bonds
                for key in ("say", "why"):
                    if not st.get(key): problems.append(f"lesson {lid} step {k+1}: missing '{key}'")
            want_atoms = Counter({s: n for s, n in t["counts"].items()})
            if prev_atoms != want_atoms: problems.append(f"lesson {lid}: last step atoms {dict(prev_atoms)} != target {dict(want_atoms)}")
            if t["kind"] != "lattice":
                if prev_bonds != bond_multiset(t): problems.append(f"lesson {lid}: last step bonds {dict(prev_bonds)} != target {dict(bond_multiset(t))}")
            for key in ("title", "intro", "done"):
                if not les.get(key): problems.append(f"lesson {lid}: missing '{key}'")
            ch = les.get("check") or {}
            if not (ch.get("q") and ch.get("answer") and ch.get("points")): problems.append(f"lesson {lid}: incomplete 'check'")
    print("lessons:", len(seen))

rp = os.path.join(D, "reactions.json")
if os.path.exists(rp):
    R = json.load(open(rp))
    for r in R:
        side = []
        for key in ("reactants", "products"):
            c = Counter()
            for mid, n in r[key]:
                m = mols.get(mid)
                if not m: problems.append(f"reaction {r['id']}: unknown molecule {mid}"); continue
                for s, k in m["counts"].items(): c[s] += k * n
            side.append(c)
        if side[0] != side[1]: problems.append(f"reaction {r['id']}: not balanced {dict(side[0])} vs {dict(side[1])}")
        for key in ("name", "equation", "story", "energy"):
            if not r.get(key): problems.append(f"reaction {r['id']}: missing '{key}'")
    print("reactions:", len(R))

print("\n".join(problems) if problems else "OK: no problems")
sys.exit(1 if problems else 0)

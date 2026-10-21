"""Turn molecules_src.py into site/data/molecules.json with explicit hydrogens and 2D coordinates.

Design choice: RDKit (BSD-3, the standard open-source cheminformatics toolkit) runs only here at
build time. The page ships plain coordinates, so it loads instantly and has no runtime dependency.
Run: python3 -I build/build_molecules.py <out.json>
"""
import json, sys, os
from collections import Counter
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from molecules_src import M
from rdkit import Chem
from rdkit.Chem import AllChem, rdDepictor

rdDepictor.SetPreferCoordGen(True)
out_path = sys.argv[1]
result = []
# fun facts are written separately (molecule_facts.json) so the library file stays readable
_fp = os.path.join(os.path.dirname(os.path.abspath(__file__)), "molecule_facts.json")
FACTS = json.load(open(_fp)) if os.path.exists(_fp) else {}

for m in M:
    e = {k: v for k, v in m.items() if k not in ("smiles", "counts")}
    if m["kind"] in ("molecule", "polymer"):
        mol = Chem.MolFromSmiles(m["smiles"])
        assert mol is not None, m["id"]
        mol = Chem.AddHs(mol)
        Chem.Kekulize(mol, clearAromaticFlags=True)   # show benzene as alternating single/double bonds
        rdDepictor.Compute2DCoords(mol)
        conf = mol.GetConformer()
        import math
        if any(math.isnan(conf.GetAtomPosition(i).x) for i in range(mol.GetNumAtoms())):
            # CoordGen returns NaN for some tiny molecules (H2, HCl); RDKit's classic depictor handles them
            rdDepictor.SetPreferCoordGen(False); rdDepictor.Compute2DCoords(mol); rdDepictor.SetPreferCoordGen(True)
            conf = mol.GetConformer()
        atoms = []
        for a in mol.GetAtoms():
            p = conf.GetAtomPosition(a.GetIdx())
            sym = a.GetSymbol()
            atoms.append([("*" if sym == "*" else sym), round(p.x, 3), round(-p.y, 3), a.GetFormalCharge()])
        bonds = [[b.GetBeginAtomIdx(), b.GetEndAtomIdx(), int(b.GetBondTypeAsDouble())] for b in mol.GetBonds()]
        counts = Counter(a[0] for a in atoms if a[0] != "*")
        e.update(atoms=atoms, bonds=bonds)
    else:
        counts = Counter(m.get("counts") or m["lattice"]["comp"])
        if m["lattice"]["style"] in ("metal",):
            counts = Counter({k: 1 for k in counts})
    e["counts"] = dict(sorted(counts.items()))
    e["facts"] = FACTS.get(m["id"], [])
    result.append(e)

ids = Counter(x["id"] for x in result)
assert all(v == 1 for v in ids.values()), [k for k, v in ids.items() if v > 1]
json.dump(result, open(out_path, "w"), separators=(",", ":"), ensure_ascii=False)
print("molecules:", len(result), "bytes:", os.path.getsize(out_path))
for x in result:
    if x["kind"] != "lattice":
        f = "".join(f"{k}{v if v > 1 else ''}" for k, v in x["counts"].items())
        print(f"{x['id']:16s} {x['formula']:14s} -> {f}")

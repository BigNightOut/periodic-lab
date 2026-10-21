"""Real 3D shapes for the "Spin in 3D" view.

RDKit (BSD-3) embeds each molecule in 3D (ETKDG) and relaxes it with the MMFF force field, so methane
comes out as a tetrahedron, water bent at ~104°, benzene flat. Atom order matches molecules.json
(same SMILES, same explicit hydrogens), so labels line up. Lattices are skipped.
Run: python3 -I build/build_3d.py <site/data/molecules.json> <out mol3d.json>
"""
import json, sys, os
from rdkit import Chem
from rdkit.Chem import AllChem
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from molecules_src import M
extra_p = os.path.join(os.path.dirname(os.path.abspath(__file__)), "molecules_extra.json")
EXTRA = json.load(open(extra_p)) if os.path.exists(extra_p) else []
smiles = {m["id"]: m["smiles"] for m in M if m.get("smiles")}
smiles.update({m["id"]: m["smiles"] for m in EXTRA if m.get("smiles")})

src, out_path = sys.argv[1:3]
built = {m["id"]: m for m in json.load(open(src))}
out, skipped = {}, []
for mid, smi in smiles.items():
    m2 = built.get(mid)
    if not m2 or m2["kind"] == "lattice": continue
    mol = Chem.AddHs(Chem.MolFromSmiles(smi))
    Chem.Kekulize(mol, clearAromaticFlags=True)
    if mol.GetNumAtoms() != len(m2["atoms"]): skipped.append((mid, "atom count")); continue
    params = AllChem.ETKDGv3(); params.randomSeed = 7
    if AllChem.EmbedMolecule(mol, params) != 0:
        params.useRandomCoords = True
        if AllChem.EmbedMolecule(mol, params) != 0: skipped.append((mid, "embed")); continue
    try:
        if AllChem.MMFFHasAllMoleculeParams(mol): AllChem.MMFFOptimizeMolecule(mol, maxIters=2000)
        else: AllChem.UFFOptimizeMolecule(mol, maxIters=2000)
    except Exception: pass
    conf = mol.GetConformer()
    pts = [[round(conf.GetAtomPosition(i).x, 3), round(conf.GetAtomPosition(i).y, 3), round(conf.GetAtomPosition(i).z, 3)] for i in range(mol.GetNumAtoms())]
    # center on the middle
    for k in range(3):
        c = sum(p[k] for p in pts) / len(pts)
        for p in pts: p[k] = round(p[k] - c, 3)
    out[mid] = pts
json.dump(out, open(out_path, "w"), separators=(",", ":"))
print("3D shapes:", len(out), "skipped:", skipped, "bytes:", os.path.getsize(out_path))

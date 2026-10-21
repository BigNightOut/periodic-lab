"""Curated molecule / material library.

Each entry is hand-written teaching content. Structures come from SMILES and are laid out by RDKit
at build time (build_molecules.py), so the page needs no chemistry library at runtime.

Fields
  id, name, formula (display), kind: "molecule" | "polymer" | "lattice"
  smiles      molecules/polymers. Polymers use [*] for "chain continues".
  lattice     lattices: {"style": ionic|network|bridge|graphite|metal|alloy|interstitial, "comp": {sym: share}}
  blurb       what it is + why it forms the way it does (seat language), 1-2 sentences
  uses        short line
  lens        optional {"nexus": ..., "rocket": ...}
  aliases     optional list of other names for search
"""

M = []
def mol(id, name, formula, smiles, blurb, uses, lens=None, kind="molecule", aliases=None):
    M.append(dict(id=id, name=name, formula=formula, kind=kind, smiles=smiles, blurb=blurb, uses=uses,
                  lens=lens or {}, aliases=aliases or []))
def lat(id, name, formula, style, comp, blurb, uses, lens=None, aliases=None, counts=None):
    M.append(dict(id=id, name=name, formula=formula, kind="lattice", lattice=dict(style=style, comp=comp),
                  blurb=blurb, uses=uses, lens=lens or {}, aliases=aliases or [], counts=counts))

# ---------- Hydrogen & simple gases ----------
mol("h2", "Hydrogen gas", "H2", "[H][H]",
    "Each hydrogen has 1 hand. They hold hands, and now neither has an empty hand. The lightest molecule there is.",
    "Adding hydrogen to fuels at refineries, ammonia, fuel cells, liquid hydrogen rocket fuel.",
    {"rocket": "Liquid H2 (-253 °C) gets the most push per pound of any common rocket propellant. But it's so light that it needs huge tanks.",
     "nexus": "Hydrogen is the scarce ingredient at your plant. Polyethylene has only 2 H per carbon, so not every broken piece can fill its hands and become methane."})
mol("o2", "Oxygen gas", "O2", "O=O",
    "Each oxygen has 2 hands. They hold both hands with each other: a double bond.",
    "Breathing, burning, steelmaking, and liquid oxygen (LOX), what rocket fuel burns with.",
    {"rocket": "Liquid oxygen is most of the weight of a methane or kerosene rocket. Raptor reportedly burns about 3.6 kg of oxygen per kg of methane."})
mol("o3", "Ozone", "O3", "[O-][O+]=O",
    "Three oxygens can't all hold hands in a simple, even way. So the shared electrons smear across all three. That awkward grip makes it quick to react.",
    "High-up shield against the sun's UV; cleaning and disinfecting water.")
mol("n2", "Nitrogen gas", "N2", "N#N",
    "Each nitrogen has 3 hands, and they hold all three at once: a triple bond. It's one of the strongest bonds in chemistry. That's why N2 barely reacts.",
    "78% of air; a do-nothing gas used to blanket reactors and tanks.",
    {"nexus": "At Nexus, nitrogen is flushed through the reactors to push oxygen out. So plastic breaks apart instead of burning.",
     "rocket": "Nitrogen gas flushes out lines. It's also the gas pushed out of simple cold-gas thrusters."})
mol("cl2", "Chlorine gas", "Cl2", "ClCl",
    "Each chlorine has 1 hand. Two chlorines hold hands, and both are satisfied.",
    "Making PVC, cleaning drinking water, bleach.")
mol("f2", "Fluorine gas", "F2", "FF",
    "Like chlorine, each has 1 hand, so they hold hands once. Fluorine tugs on electrons harder than any element. So F2 attacks almost anything.",
    "Making uranium hexafluoride, sulfur hexafluoride (SF6) and other fluorine chemicals.")
mol("br2", "Bromine", "Br2", "BrBr", "Each bromine has 1 hand, so two of them hold hands. It's a liquid at room temperature.",
    "Fire-slowing additives, drilling fluids, water treatment.")
mol("i2", "Iodine", "I2", "II", "Each iodine has 1 hand, so two hold hands. The atoms are big and soft, so it's a solid that turns straight into purple vapor.",
    "Germ killer, iodized salt, helping insides show up on X-rays.")

# ---------- Hydrocarbons (the pyrolysis family) ----------
mol("methane", "Methane", "CH4", "C",
    "Carbon has 4 hands and no other carbon to hold. So all 4 hands grab hydrogens. Every hand held: the most settled shape for one carbon.",
    "Natural gas fuel, making hydrogen, rocket fuel.",
    {"nexus": "The smallest thing your plant makes. It stays a gas even when cooled, and is usually burned to heat the reactor.",
     "rocket": "Raptor's fuel. It burns clean (little soot or carbon gunk) and can be made on Mars with the Sabatier reaction."},
    aliases=["natural gas", "CH4"])
mol("ethane", "Ethane", "C2H6", "CC",
    "Two carbons hold hands using one hand each. Each carbon has 3 hands left, and each grabs a hydrogen.",
    "Main raw material for US ethane 'crackers', plants that turn it into ethylene.",
    {"nexus": "Cheap shale ethane is why most US crackers run on ethane, not naphtha (a light oil). Your plant's oil can stand in for naphtha, so it fits crackers fed on liquid."})
mol("ethylene", "Ethylene", "C2H4", "C=C",
    "Each carbon holds 2 hydrogens and the other carbon, with one hand left. So they hold hands twice: a C=C double bond. That second grip is the 'handle' for linking into plastic chains.",
    "The building block of polyethylene; the most-made carbon-based chemical.",
    {"nexus": "Cracking pulls hydrogen off ethane to make ethylene. Then ethylenes get linked into polyethylene. Your plant partly runs that backwards. But polyethylene breaks into many sizes, not mostly back to ethylene."},
    aliases=["ethene"])
mol("acetylene", "Acetylene", "C2H2", "C#C",
    "Each carbon holds just 1 hydrogen, leaving 3 hands free. So the carbons hold all 3: a triple bond. Lots of stored energy.",
    "Welding and cutting torches with oxygen (about 3,100 °C flame).", aliases=["ethyne"])
mol("propane", "Propane", "C3H8", "CCC", "Three carbons in a row. End carbons hold 3 H, the middle one 2.",
    "Heating and grill fuel (LPG), raw material for propylene.",
    {"nexus": "Part of the light gas that comes off your plant's reactor."})
mol("propylene", "Propylene", "C3H6", "CC=C",
    "Three carbons; two hold hands twice. That double grip is where polypropylene chains link.",
    "Building block of polypropylene.", {"nexus": "Like ethylene, it stays a gas at room temperature. It leaves with the gases that don't turn to liquid."},
    aliases=["propene"])
mol("butane", "Butane", "C4H10", "CCCC", "4 carbons in a row, spare hands all on H. Straight chains (alkanes) follow CnH(2n+2).",
    "Lighter fluid, mixing into LPG.")
mol("butadiene", "1,3-Butadiene", "C4H6", "C=CC=C", "4 carbons; two pairs hold hands twice (two double bonds).",
    "Man-made rubber (tires).")
mol("isooctane", "Octane (iso-octane)", "C8H18", "CC(C)CC(C)(C)C",
    "8 carbons in a branched shape. Branching resists engine knock, which is where the 'octane rating' comes from.",
    "The gasoline yardstick fuel (rated 100).", {"nexus": "Gasoline-size molecules (C5-C12) are part of what your plant's oil can be refined into."},
    aliases=["octane", "gasoline"])
mol("dodecane", "Dodecane (RP-1 stand-in)", "C12H26", "CCCCCCCCCCCC",
    "12 carbons holding hands in a line. Kerosene and RP-1 are mixes of molecules around this size.",
    "Jet fuel and rocket kerosene size.",
    {"rocket": "RP-1 is very pure kerosene, burned by Falcon 9's Merlin engines. Long chains can leave carbon gunk (coking) in engines. That's one reason Starship chose methane.",
     "nexus": "Diesel- and kerosene-size chains (about C10-C20) cool into liquid oil at your plant."},
    aliases=["kerosene", "RP-1", "jet fuel"])
mol("hexadecane", "Hexadecane (cetane)", "C16H34", "CCCCCCCCCCCCCCCC",
    "16 carbons holding hands in a line. It's the yardstick for how well diesel ignites (the cetane number).",
    "Diesel yardstick fuel.", {"nexus": "Middle of your oil range. Much longer chains (C20+) are wax."}, aliases=["cetane", "diesel"])
mol("benzene", "Benzene", "C6H6", "c1ccccc1",
    "Six carbons hold hands in a ring, each also holding one hydrogen. Each has one spare hand, shared around the whole ring. That makes it very stable.",
    "Starting point for styrene, nylon, plastics, dyes.",
    {"nexus": "In the reactor's heat, broken pieces can curl up into rings like this (aromatics). They are a step on the road to char."})
mol("toluene", "Toluene", "C7H8", "Cc1ccccc1", "A benzene ring holding a methyl (CH3) group.",
    "Solvent, gasoline octane booster.")
mol("styrene", "Styrene", "C8H8", "C=Cc1ccccc1", "Benzene ring plus a C=C (vinyl) handle for linking up.",
    "Building block of polystyrene and ABS.",
    {"nexus": "Heated, polystyrene mostly unzips back to styrene, like a zipper. Polyethylene instead snaps at random spots."})
mol("naphthalene", "Naphthalene", "C10H8", "c1ccc2ccccc2c1",
    "Two benzene rings joined at an edge. As more rings join, hydrogen per carbon drops toward zero.",
    "Mothballs, a starting point for dyes.",
    {"nexus": "Joined rings are how char grows. Keep stripping hydrogen and joining rings, and you head toward graphite-like carbon."})

# ---------- Polymers ----------
mol("polyethylene", "Polyethylene", "(C2H4)n", "[*]CCCCCC[*]",
    "Ethylene lets go of its second grip. Each carbon uses that freed hand to grab the next one, over and over. Shown: a 6-carbon slice of a chain thousands of carbons long.",
    "Bags, films, bottles, pipe. The most common plastic.",
    {"nexus": "Your plant's main feed. Heat breaks the carbon-carbon grips (weaker than carbon-hydrogen) at random spots. That gives gas, oil, wax and char."},
    kind="polymer", aliases=["PE", "HDPE", "LDPE"])
mol("polypropylene", "Polypropylene", "(C3H6)n", "[*]CC(C)CC(C)CC(C)[*]",
    "Polyethylene's chain, with a CH3 branch on every other carbon.",
    "Containers, auto parts, packaging.",
    {"nexus": "Breaks apart a bit more easily than polyethylene, because the branch points are weak spots."},
    kind="polymer", aliases=["PP"])
mol("polystyrene", "Polystyrene", "(C8H8)n", "[*]CC(c1ccccc1)CC(c1ccccc1)[*]",
    "A chain of carbons holding hands, with a benzene ring hanging off every other carbon.",
    "Foam cups, packaging, disposable cutlery.", kind="polymer", aliases=["PS", "styrofoam"])
mol("pvc", "PVC", "(C2H3Cl)n", "[*]CC(Cl)CC(Cl)CC(Cl)[*]",
    "Polyethylene, but every other carbon holds a chlorine in one hand instead of a hydrogen.",
    "Pipe, siding, wire insulation.",
    {"nexus": "A problem for your plant. Heating it releases HCl, which eats away equipment. It must be kept out of the feed."},
    kind="polymer", aliases=["polyvinyl chloride"])
mol("ptfe", "PTFE (Teflon)", "(C2F4)n", "[*]C(F)(F)C(F)(F)C(F)(F)C(F)(F)[*]",
    "Every hydrogen is swapped for fluorine. Carbon and fluorine grip harder than almost any one-hand hold. So almost nothing sticks or reacts.",
    "Non-stick coatings, seals, liners that resist chemicals.",
    {"rocket": "Used for seals and liners that must survive liquid oxygen."}, kind="polymer", aliases=["teflon"])
mol("pet", "PET", "(C10H8O4)n", "[*]OCCOC(=O)c1ccc(cc1)C(=O)[*]",
    "Rings and ester links (C-O-C=O) in the chain. Those oxygens make it act very differently from polyethylene.",
    "Drink bottles, polyester fiber.",
    {"nexus": "Usually unwanted at your plant. Its oxygen ends up as CO2, water and acids instead of oil."},
    kind="polymer", aliases=["polyester"])

# ---------- Oxygen chemistry ----------
mol("water", "Water", "H2O", "O",
    "Oxygen has 2 hands, and each holds a hydrogen. Oxygen also keeps two pairs of electrons to itself. They push the H's into a bent shape.",
    "Life, dissolving things, cooling, steam.",
    {"rocket": "The main thing coming out of hydrogen and methane engines.", "nexus": "Wet feed at your plant steals heat and adds oxygen to the products."})
mol("h2o2", "Hydrogen peroxide", "H2O2", "OO",
    "Two oxygens hold hands, and that O-O grip is weak. It snaps easily, giving off oxygen and heat.",
    "Bleaching, killing germs, single-ingredient rocket fuel (high-test peroxide).",
    {"rocket": "High-test peroxide breaks down over silver, a catalyst (a helper that isn't used up), into hot steam and oxygen. Used in early rockets and thrusters."})
mol("co", "Carbon monoxide", "CO", "[C-]#[O+]",
    "Carbon and oxygen hold hands three times: a very strong triple bond. It forms when there isn't enough oxygen to make CO2.",
    "Syngas (a gas mix for making chemicals and methanol); poisonous.")
mol("co2", "Carbon dioxide", "CO2", "O=C=O",
    "Each oxygen has 2 hands and holds both with carbon. Two double grips use all 4 of carbon's hands.",
    "Fizzy drinks, dry ice, plant food; main greenhouse gas.",
    {"rocket": "Mars' air is about 95% CO2. That's the carbon source for making methane there."})
mol("methanol", "Methanol", "CH4O", "CO", "Methane, but one of carbon's hands holds an OH group instead of a hydrogen.",
    "Fuel, making formaldehyde, solvent.", aliases=["wood alcohol", "CH3OH"])
mol("ethanol", "Ethanol", "C2H6O", "CCO", "Ethane, but one end holds an OH instead of a hydrogen.", "Drinking alcohol, fuel additive, solvent.", aliases=["alcohol"])
mol("dme", "Dimethyl ether", "C2H6O", "COC", "Same atoms as ethanol, but oxygen sits in the middle: an isomer.",
    "Spray-can propellant, diesel stand-in.")
mol("formaldehyde", "Formaldehyde", "CH2O", "C=O", "Carbon holds oxygen with 2 hands and a hydrogen in each other hand.",
    "Resins, plywood glue, preservative.")
mol("aceticacid", "Acetic acid", "C2H4O2", "CC(=O)O", "A methyl (CH3) group holding hands with a carboxylic acid (COOH) group.",
    "Vinegar, making PET and vinyl acetate.")
mol("acetone", "Acetone", "C3H6O", "CC(C)=O", "A C=O carbon holding a methyl group on each side.", "Solvent, nail polish remover.")
mol("glycol", "Ethylene glycol", "C2H6O2", "OCCO", "Ethane, but each end holds an OH instead of a hydrogen.", "Antifreeze, PET ingredient.")
mol("glucose", "Glucose", "C6H12O6", "OCC1OC(O)C(O)C(O)C1O", "A ring of 5 carbons and 1 oxygen, with OH groups all around.",
    "Blood sugar; building block of starch and cellulose.")

# ---------- Nitrogen ----------
mol("ammonia", "Ammonia", "NH3", "N", "Nitrogen has 3 hands, each holding a hydrogen. It keeps one pair of electrons to itself, on top.",
    "Fertilizer (Haber-Bosch), refrigerant, cleaning.")
mol("hcn", "Hydrogen cyanide", "HCN", "C#N", "Carbon holds nitrogen with 3 hands (a triple bond) and a hydrogen with its 4th.",
    "Starting point for nylon and acrylic; very poisonous.")
mol("n2o", "Nitrous oxide", "N2O", "[N-]=[N+]=O", "A straight N-N-O chain with charge spread across it.",
    "Anesthetic, whipped cream propellant, oxygen source for hybrid rockets.",
    {"rocket": "The oxygen source in hybrid rocket motors. It builds its own tank pressure."})
mol("no2", "Nitrogen dioxide", "NO2", "[O-][N+]=O",
    "An odd number of electrons, so one hand is always left empty. That makes it a reactive radical.",
    "Part of smog; making nitric acid.")
mol("n2o4", "Dinitrogen tetroxide", "N2O4", "[O-][N+](=O)[N+]([O-])=O",
    "Two NO2 molecules each have one empty hand. They grab each other, making an N-N bond.",
    "Rocket oxygen source that stores well.",
    {"rocket": "With hydrazine fuels it catches fire on contact (hypergolic), so no igniter is needed. Used on Dragon's Draco thrusters."},
    aliases=["NTO", "nitrogen tetroxide"])
mol("hydrazine", "Hydrazine", "N2H4", "NN", "Two nitrogens hold hands. Each uses its other 2 hands to hold hydrogens.",
    "Single-ingredient satellite thruster fuel, foaming agents.",
    {"rocket": "Breaks down into hot gas over iridium, a catalyst (a helper that isn't used up). The classic satellite thruster fuel."})
mol("mmh", "Monomethylhydrazine", "CH6N2", "CNN", "Hydrazine, but one hand holds a methyl (CH3) group instead of a hydrogen.",
    "Storable rocket fuel that lights on contact.", {"rocket": "Paired with N2O4 in spacecraft thrusters such as Dragon's Draco and SuperDraco."},
    aliases=["MMH"])
mol("urea", "Urea", "CH4N2O", "NC(N)=O", "A C=O carbon with two NH2 groups.", "Fertilizer, diesel exhaust fluid (DEF).")
mol("nitricacid", "Nitric acid", "HNO3", "O[N+](=O)[O-]", "Nitrogen holds three oxygens. One of them also holds the hydrogen.",
    "Fertilizer, making explosives, etching metal.")

# ---------- Sulfur / phosphorus / halides ----------
mol("h2s", "Hydrogen sulfide", "H2S", "S", "Sulfur, like oxygen, has 2 hands. Each holds a hydrogen.",
    "Rotten-egg gas in sour crude and natural gas; where refinery sulfur comes from.",
    {"nexus": "Sulfur in your plant's feed ends up as H2S and other sulfur chemicals. They must be scrubbed out of the gas and oil."})
mol("so2", "Sulfur dioxide", "SO2", "O=S=O", "Sulfur is bigger, so it can hold out extra hands. It holds each oxygen with 2 hands.",
    "Making sulfuric acid, keeping food fresh; a cause of acid rain.")
mol("h2so4", "Sulfuric acid", "H2SO4", "OS(=O)(=O)O", "Sulfur in the middle holds four oxygens. Two of them also hold a hydrogen.",
    "The most-made industrial chemical: fertilizer, batteries, refining.")
mol("hcl", "Hydrogen chloride", "HCl", "Cl", "1 hand each, so they hold hands once. In water it becomes hydrochloric acid.",
    "Cleaning steel (pickling), PVC chemistry.", {"nexus": "Given off when PVC is heated. That's why PVC is screened out of your plant's feed."})
mol("hf", "Hydrogen fluoride", "HF", "F", "They hold hands once, but fluorine tugs the handshake hard toward itself.",
    "Etching glass, alkylation in refineries, fluorine chemicals.",
    {"nexus": "Some refineries use HF as the catalyst (helper) in alkylation, a step that builds high-octane gasoline."})
mol("ccl4", "Carbon tetrachloride", "CCl4", "ClC(Cl)(Cl)Cl", "Methane's shape, but carbon's 4 hands hold chlorines instead of hydrogens.",
    "Once a solvent and used to make refrigerants; now restricted.")
mol("cf4", "Tetrafluoromethane", "CF4", "FC(F)(F)F", "Carbon's 4 hands each hold a fluorine. Extremely stable.",
    "Plasma etching in chip making.")
mol("chcl3", "Chloroform", "CHCl3", "ClC(Cl)Cl", "Carbon's 4 hands hold one hydrogen and three chlorines.", "Solvent; used to make refrigerants.")
mol("ph3", "Phosphine", "PH3", "P", "Phosphorus, like nitrogen, has 3 hands. Each holds a hydrogen.", "Chip doping; fumigant.")
mol("pcl3", "Phosphorus trichloride", "PCl3", "ClP(Cl)Cl", "Phosphorus's 3 hands each hold a chlorine.", "Making pesticides and flame retardants.")
mol("sf6", "Sulfur hexafluoride", "SF6", "FS(F)(F)(F)(F)F",
    "Sulfur is big enough to hold out 6 hands, more than the usual rule. Extremely stable.",
    "Insulating gas in high-voltage switches.")

# ---------- Silicon & boron ----------
mol("silane", "Silane", "SiH4", "[SiH4]", "Silicon sits below carbon, so it also has 4 hands, each holding a hydrogen: silicon's methane.",
    "Making ultra-pure silicon for chips and solar cells.")
mol("teb", "Triethylborane", "C6H15B", "CCB(CC)CC",
    "Boron has only 3 hands, so it holds 3 groups. Even then it has a gap that wants electrons. That hunger is why it catches fire on contact with air.",
    "Igniter that catches fire by itself in air.", {"rocket": "The TEB in TEA-TEB, which lights Falcon 9's Merlin engines with a green flash."}, aliases=["TEB"])
mol("tea", "Triethylaluminium", "C6H15Al", "CC[Al](CC)CC",
    "Aluminum, like boron, holds with 3 hands but still has a gap that wants electrons. So it reacts violently with oxygen and water.",
    "Helper for making plastics (co-catalyst), igniter.",
    {"rocket": "The TEA in TEA-TEB igniter on Falcon 9.",
     "nexus": "Teams up with titanium catalysts (Ziegler-Natta) to make polyethylene and polypropylene."},
    aliases=["TEA", "triethylaluminum"])

# ---------- Noble gas compounds ----------
mol("xef2", "Xenon difluoride", "XeF2", "F[Xe]F",
    "Xenon has 0 hands. But it's big, with outer electrons far from its center, so fluorine can tug them into handshakes anyway.",
    "Adds fluorine to other chemicals; etching silicon.")
mol("xef4", "Xenon tetrafluoride", "XeF4", "F[Xe](F)(F)F", "Four fluorines around xenon in a flat square.",
    "Proof that noble gases aren't totally inert.")

# ---------- Organometallics / catalysts-adjacent ----------
mol("nickelcarbonyl", "Nickel carbonyl", "C4NiO4", "[Ni](=C=O)(=C=O)(=C=O)=C=O",
    "Four CO molecules each give nickel both halves of a handshake. Very poisonous gas.",
    "Purifying nickel (the Mond process).")

# ---------- Rocket solids ----------
lat("ap", "Ammonium perchlorate", "NH4ClO4", "ionic", {"N": 1, "Cl": 1},
    "A solid of charged pieces, NH4+ and ClO4-, stuck together like magnets. The ClO4- carries 4 oxygens ready to hand over.",
    "Oxygen source in solid rocket boosters (mixed with aluminum powder).",
    {"rocket": "Shuttle SRBs and SLS boosters burn ammonium perchlorate with aluminum powder in a rubbery binder."},
    aliases=["AP"], counts={"N": 1, "H": 4, "Cl": 1, "O": 4})

# ---------- Ionic lattices ----------
lat("nacl", "Sodium chloride", "NaCl", "ionic", {"Na": 1, "Cl": 1},
    "Sodium would rather give away its 1 loose electron. Chlorine has 1 empty hand and takes it. Now Na+ and Cl- stick like magnets in a grid, not as molecules.",
    "Table salt; source of chlorine and sodium hydroxide.", aliases=["salt"])
lat("kcl", "Potassium chloride", "KCl", "ionic", {"K": 1, "Cl": 1}, "Same as table salt: one electron handed over.", "Potash fertilizer, salt substitute.")
lat("lif", "Lithium fluoride", "LiF", "ionic", {"Li": 1, "F": 1}, "Lithium gives 1, fluorine takes 1.", "Molten-salt reactors, UV lenses.")
lat("mgo", "Magnesium oxide", "MgO", "ionic", {"Mg": 1, "O": 1},
    "Magnesium gives away 2 electrons; oxygen's 2 empty hands take them. Double charges grip hard, so it melts at about 2,800 °C.",
    "Heat-proof furnace bricks, antacid.")
lat("cao", "Calcium oxide", "CaO", "ionic", {"Ca": 1, "O": 1}, "Calcium gives 2 electrons; oxygen takes 2.", "Quicklime: cement, steelmaking flux.")
lat("caf2", "Calcium fluoride", "CaF2", "ionic", {"Ca": 1, "F": 2}, "Calcium gives away 2 electrons, so it takes 2 fluorines (1 each).", "Fluorite lenses; fluorine source.")
lat("mgcl2", "Magnesium chloride", "MgCl2", "ionic", {"Mg": 1, "Cl": 2}, "Magnesium gives 2 electrons, so it pairs with 2 chlorines.", "Road de-icer, making magnesium metal.")
lat("cacl2", "Calcium chloride", "CaCl2", "ionic", {"Ca": 1, "Cl": 2}, "Calcium gives 2, each chlorine takes 1.", "De-icing, soaking up moisture.")
lat("al2o3", "Aluminum oxide", "Al2O3", "ionic", {"Al": 2, "O": 3},
    "Aluminum gives away 3 electrons; oxygen takes 2. The smallest even match is 2 Al to 3 O (6 electrons each way).",
    "Sapphire, grinding grit, catalyst supports, the protective skin on aluminum.",
    {"nexus": "Alumina is a common base for catalysts (reaction helpers), and part of zeolite and clay catalysts.",
     "rocket": "The white smoke from solid rocket boosters is mostly aluminum oxide particles."}, aliases=["alumina", "sapphire", "corundum"])
lat("fe2o3", "Iron(III) oxide", "Fe2O3", "ionic", {"Fe": 2, "O": 3},
    "Iron gives 3 electrons, oxygen takes 2, so 2 Fe balance 3 O. This is red rust.",
    "Rust; iron ore (hematite); coloring.", aliases=["rust", "hematite"])
lat("fe3o4", "Magnetite", "Fe3O4", "ionic", {"Fe": 3, "O": 4}, "A mix of Fe2+ and Fe3+ ions with oxygen. Naturally magnetic.", "Iron ore; the first magnets (lodestone).")
lat("cuo", "Copper(II) oxide", "CuO", "ionic", {"Cu": 1, "O": 1}, "Copper gives 2, oxygen takes 2. The black tarnish on hot copper.", "Coloring, catalysts.")
lat("cu2o", "Copper(I) oxide", "Cu2O", "ionic", {"Cu": 2, "O": 1}, "Here copper gives just its 1 loose electron, so 2 Cu per O. Red-colored.", "Antifouling boat paint, early semiconductors.")
lat("tio2", "Titanium dioxide", "TiO2", "ionic", {"Ti": 1, "O": 2}, "Titanium gives 4 electrons, enough for 2 oxygens.", "White pigment in paint and sunscreen.")
lat("zno", "Zinc oxide", "ZnO", "ionic", {"Zn": 1, "O": 1}, "Zinc gives 2 electrons, oxygen takes 2.", "Sunscreen, curing rubber.")
lat("li2o", "Lithium oxide", "Li2O", "ionic", {"Li": 2, "O": 1}, "Each lithium gives 1 electron. Oxygen has 2 empty hands, so it needs two.", "Glass and ceramic glazes.")
lat("naoh", "Sodium hydroxide", "NaOH", "ionic", {"Na": 1, "O": 1}, "Na+ and OH- stuck together like magnets.", "Lye: soap, paper, aluminum refining.",
    aliases=["lye", "caustic soda"], counts={"Na": 1, "O": 1, "H": 1})
lat("caco3", "Calcium carbonate", "CaCO3", "ionic", {"Ca": 1, "C": 1},
    "Ca2+ stuck like a magnet to carbonate (CO3 2-), a carbon holding 3 oxygens.",
    "Limestone, chalk, shells; raw material for cement.", aliases=["limestone", "chalk"], counts={"Ca": 1, "C": 1, "O": 3})
lat("nahco3", "Sodium bicarbonate", "NaHCO3", "ionic", {"Na": 1, "C": 1}, "Na+ and HCO3- stuck together like magnets.", "Baking soda; fire extinguishers.",
    aliases=["baking soda"], counts={"Na": 1, "H": 1, "C": 1, "O": 3})
lat("lih", "Lithium hydride", "LiH", "ionic", {"Li": 1, "H": 1}, "Here hydrogen takes an electron (H-) instead of holding hands.", "Hydrogen storage, nuclear shielding.")
lat("licoo2", "Lithium cobalt oxide", "LiCoO2", "ionic", {"Li": 1, "Co": 1}, "Layers of cobalt oxide with charged lithium (Li+) sliding in between.",
    "Cathode in many phone and laptop batteries.", counts={"Li": 1, "Co": 1, "O": 2})
lat("uo2", "Uranium dioxide", "UO2", "ionic", {"U": 1, "O": 2}, "Uranium gives 4 electrons, enough for 2 oxygens.", "Nuclear reactor fuel pellets.")

# ---------- Network covalent ----------
lat("diamond", "Diamond", "C", "network", {"C": 1},
    "Every carbon holds 4 other carbons, one per hand, in a 3D web. No weak direction, so it's the hardest natural material.",
    "Cutting tools, grinding grit, gems, heat spreaders.")
lat("graphite", "Graphite", "C", "graphite", {"C": 1},
    "Each carbon holds 3 neighbors in flat hexagon sheets. Its 4th electron roams across the sheet, so graphite carries electricity. Sheets slide over each other.",
    "Pencils, lubricant, battery anodes, electrodes.",
    {"nexus": "Char at your plant is messy, graphite-like carbon: what's left when hydrogen is stripped off and rings join.",
     "rocket": "Carbon-carbon (graphite fibers set in carbon) protects the hottest front edges."}, aliases=["char", "carbon", "graphene", "coke"])
lat("si", "Silicon crystal", "Si", "network", {"Si": 1}, "Each silicon holds 4 others, like diamond. But the grips are weaker, so a few electrons can break free: a semiconductor.",
    "Computer chips, solar cells.")
lat("sio2", "Silica (quartz)", "SiO2", "bridge", {"Si": 1, "O": 2},
    "Each silicon holds 4 oxygens. Each oxygen uses its 2 hands to bridge 2 silicons. That shared web gives the 1:2 ratio.",
    "Glass, sand, quartz crystals, optical fiber.",
    {"rocket": "The Shuttle's tiles were silica fibers and mostly air, so they blocked heat extremely well. Starship's tiles are reportedly a silica-based ceramic too.",
     "nexus": "Silica is a building block of clay and zeolite catalysts."}, aliases=["quartz", "glass", "sand", "silicon dioxide"])
lat("sic", "Silicon carbide", "SiC", "network", {"Si": 1, "C": 1}, "Si and C take turns, each using all 4 hands to hold the other kind. Diamond-like hardness.",
    "Grinding grit, EV power chips, brake discs, armor.")
lat("bn", "Boron nitride", "BN", "graphite", {"B": 1, "N": 1}, "B and N take turns in hexagon sheets, like graphite. Boron's gap gets filled by nitrogen's spare pair.",
    "High-temperature crucibles, lubricant, cosmetics.")
lat("gaas", "Gallium arsenide", "GaAs", "network", {"Ga": 1, "As": 1}, "Ga (3 outer electrons) and As (5) average 4, so they build a silicon-like crystal.",
    "LEDs, lasers, high-efficiency solar cells.", {"rocket": "Multi-junction gallium arsenide solar cells power many satellites, especially high-power ones."})
lat("wc", "Tungsten carbide", "WC", "network", {"W": 1, "C": 1}, "Carbon atoms tucked into a tungsten grid; extremely hard.", "Drill bits, cutting tools, ballpoint pen tips.")
lat("zeolite", "Zeolite (ZSM-5 type)", "Na, Al, Si, O framework", "bridge", {"Si": 3, "Al": 1, "Na": 1},
    "A silica web with some silicons swapped for aluminum. Each swap leaves a charge that holds a sodium or an acidic hydrogen inside molecule-sized holes.",
    "Cracking catalysts, detergents, water softeners.",
    {"nexus": "Zeolite powder in your plant's hot bath snaps chains at acid spots inside its holes, steering products toward gasoline/diesel-length molecules."},
    aliases=["ZSM-5", "zeolite catalyst"], counts={"Na": 1, "Al": 1, "Si": 3, "O": 8})

# ---------- Metals & alloys ----------
for sym, name, why, uses, lens in [
    ("Cu", "Copper metal", "Metals don't hold hands one-to-one. Each copper atom tosses its 1 loose (4s) electron into a shared 'sea' drifting through the grid. A voltage pushes that sea along: current.",
     "Wiring, motors, heat exchangers.", {"rocket": "Raptor's combustion chamber is reportedly a copper alloy (metal mix). Copper moves heat well, carrying it into the methane flowing through the cooling channels."}),
    ("Fe", "Iron metal", "Iron atoms in a grid, sharing their outer electrons as a sea. Some electrons (d-electrons) also line up into magnetic zones.", "Steel, magnets, cast iron.", None),
    ("Al", "Aluminum metal", "Each atom tosses 3 outer electrons into the sea. Light atoms, strong hold.", "Aircraft, cans, power lines.",
     {"rocket": "Aluminum alloys (including aluminum-lithium) are used for Falcon 9's propellant tanks."}),
    ("Ni", "Nickel metal", "A metal grid whose surface atoms can grab other molecules and loosen their grips.", "Stainless steel, superalloys, batteries, catalysts.",
     {"rocket": "The Sabatier catalyst (helper): CO2 and H2 meet on nickel's surface and leave as methane and water.",
      "nexus": "Nickel catalysts add hydrogen to oils (hydrotreating)."}),
    ("Pt", "Platinum metal", "Surface atoms grab molecules just hard enough to break and rebuild their grips, then let go.", "Catalytic converters, reforming catalysts, jewelry.",
     {"nexus": "In refinery reformers, platinum catalysts reshape naphtha into high-octane ring molecules (aromatics)."}),
    ("Na", "Sodium metal", "Each atom has 1 very loose outer electron. Soft enough to cut with a knife, and reacts violently with water.", "Coolant in some reactors, sodium lamps.", None),
    ("Li", "Lithium metal", "The lightest metal. Each atom gives 1 loose outer electron to the sea.", "Batteries, alloys.", None),
    ("Ti", "Titanium metal", "A strong metal grid at about 60% the density of steel. It forms a tough oxide (rust-like) skin.", "Aerospace frames, implants.",
     {"rocket": "Titanium is used for high-strength fittings and, on Falcon 9, its grid fins."}),
    ("W", "Tungsten metal", "Its atoms grip each other very hard: the highest melting point of any metal (3,422 °C).", "Filaments, heavy alloys, X-ray tube targets.", None),
    ("Au", "Gold metal", "Gold holds its outer electron tightly, so it barely reacts. Relativity effects shift its color to yellow.", "Electronics contacts, jewelry, spacecraft thermal films.", None),
    ("Ag", "Silver metal", "Each atom gives 1 loose electron to the sea. The best electrical conductor of all elements.", "Contacts, mirrors, solar cell paste.", None),
    ("Mg", "Magnesium metal", "Each atom gives 2 outer electrons to the sea. Very light.", "Lightweight alloys, flares.", None),
    ("Zn", "Zinc metal", "2 outer electrons per atom; it corrodes in place of steel.", "Galvanizing steel, batteries, brass.", None),
]:
    lat(sym.lower() + "_metal", name, sym, "metal", {sym: 1}, why, uses, lens)

lat("steel", "Carbon steel", "Fe + ~0.2-1% C", "interstitial", {"Fe": 50, "C": 1},
    "Small carbon atoms wedge into gaps in the iron grid and pin its layers so they can't slide. A trace of carbon makes iron several times stronger.",
    "Structures, tools, cars.", aliases=["steel"])
lat("stainless", "Stainless steel (304-type)", "Fe + ~18% Cr + ~8% Ni", "alloy", {"Fe": 72, "Cr": 18, "Ni": 8},
    "Chromium in the iron grid reacts with air to form a thin chromium-oxide skin. The skin heals itself and stops rust. Nickel keeps it tough at super-cold temperatures.",
    "Kitchenware, tanks, chemical plants.",
    {"rocket": "Starship's hull began as 304L stainless. SpaceX has since moved to its own alloy, reportedly called '30X'. Steel stays strong at -183 °C (liquid oxygen) and weakens less than aluminum when hot.",
     "nexus": "Stainless is common for reactors and piping where corrosion matters."}, aliases=["stainless", "304", "30X"])
lat("bronze", "Bronze", "Cu + ~12% Sn", "alloy", {"Cu": 88, "Sn": 12}, "Bigger tin atoms in the copper grid make the layers harder to slide. So it's harder than either metal alone.",
    "Bearings, bells, sculptures.")
lat("brass", "Brass", "Cu + ~35% Zn", "alloy", {"Cu": 65, "Zn": 35}, "Zinc atoms take some copper spots in the grid. That makes it harder and easier to machine.",
    "Plumbing fittings, instruments, ammunition casings.")
lat("alli", "Aluminum-lithium alloy", "Al + ~1-2% Li", "alloy", {"Al": 98, "Li": 2},
    "Lithium is the lightest metal. Each percent of lithium cuts density by about 3% and stiffens the alloy.",
    "Aircraft and rocket tanks.", {"rocket": "Falcon 9's tanks and the Shuttle's later external tank used aluminum-lithium alloy."})
lat("inconel", "Inconel (nickel superalloy)", "Ni + ~20% Cr + Fe", "alloy", {"Ni": 70, "Cr": 20, "Fe": 10},
    "A nickel-chromium grid that stays strong and resists oxygen attack even red-hot.",
    "Turbine blades, exhaust parts.", {"rocket": "Nickel superalloys are used in rocket turbopumps and engine parts that see hot, oxygen-rich gas."})
lat("solder", "Solder (tin-silver-copper)", "Sn + ~3% Ag + ~0.5% Cu", "alloy", {"Sn": 96, "Ag": 3, "Cu": 1}, "Mostly tin, which melts low. Small additions make the joint stronger.", "Electronics assembly.")

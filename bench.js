/* =====================================================================================
   Workbench: drag atoms together to make them "hold hands" (bond), pull hard to break.

   Model
     atoms: {id, sym, x, y, vx, vy, hands?, charge?}   hands = override from a loaded recipe
     bonds: {a, b, order, kind}  kind "cov" = shared electrons, "ion" = electrons handed over
   Hands
     nonmetal: covalent valence (C 4, N 3, O 2, H 1...). Each covalent bond of order k uses k hands.
               Receiving an electron from a metal also fills a hand.
     metal:    electrons it can give (its highest common + charge). It's "happy" once the number given
               matches one of its real charges (Cu can be +1 or +2, Fe +2 or +3).
     noble:    0 hands.
   Physics
     springs on bonds + short-range repulsion + damping. The dragged atom follows the pointer; if a bond
     stretches past BREAK x its rest length, it snaps. That's the "yank to break" feel.
   Uses globals from index.html: S, atomColor, textOn, css, esc, isMetal, isNoble, drawLattice.
   ===================================================================================== */
const Bench = (() => {
  const atoms = [], bonds = [];
  let nextId = 1, cv, ctx, W = 0, H = 0, dpr = 1, raf = 0, visible = false;
  let view = "ball";                 // "ball" | "ring"
  const cam = {x: 0, y: 0, s: 1}, camT = {x: 0, y: 0, s: 1};
  let zoomBond = null;               // bond being inspected (double-click)
  let drag = null, selected = null, lastTouched = null, hoverTrash = false;
  let pendingBondClick = 0;
  /* Zoom and pan. manualCam = you zoomed or panned yourself, so the auto-framing (fit) steps aside
     until you press Fit. ptrs tracks fingers so two of them can pinch. */
  let manualCam = false, pinch = null, pan = null;
  const ptrs = new Map();
  const ZMIN = 0.3, ZMAX = 6;
  const clampS = (s) => Math.max(ZMIN, Math.min(ZMAX, s));
  const shownTips = new Set();
  // grid lines on/off, and where you parked the idea cloud (both remembered on this device)
  const store = {get(k, d){ try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch(_){ return d; } },
    set(k, v){ try { localStorage.setItem(k, JSON.stringify(v)); } catch(_){} }};
  let gridOn = store.get("plab.grid", 1) !== 0;
  let cloudMini = !!store.get("plab.cloudMini", 0), cloudPos = store.get("plab.cloudPos", null), cloudDrag = null;
  const BREAK = 2.3;                 // stretch factor that breaks a bond while dragging
  const $ = (id) => document.getElementById(id);

  /* ---------- element rules ---------- */
  const el = (sym) => S.bySym[sym];
  const nameOf = (sym) => sym === "*" ? "chain" : (el(sym)?.name || sym).toLowerCase();
  const Name = (sym) => { const n = el(sym)?.name || sym; return n; };
  function kindOf(sym){ if (sym === "*") return "ghost"; const e = el(sym); return isNoble(e) ? "noble" : isMetal(e) ? "metal" : "nonmetal"; }
  function baseHands(sym){
    if (sym === "*") return 1;
    const e = el(sym), k = kindOf(sym);
    if (k === "noble") return 0;
    if (k === "metal"){ const pos = (e.ox||[]).filter(s=>s.startsWith("+")).map(Number); return pos.length ? Math.max(...pos) : (e.cationCharge || e.valence); }
    if (e.covalentValence != null) return e.covalentValence;
    return e.valence >= 4 ? 8 - e.valence : e.valence;
  }
  const handsOf = (a) => a.hands ?? baseHands(a.sym);
  // dative ("spare-pair") bonds don't use up hands: one atom brings both electrons from a pair it wasn't using
  function used(a){ let u = 0; for (const b of bonds) if ((b.a === a || b.b === a) && b.kind !== "dat") u += b.order; return u; }
  const free = (a) => Math.max(0, handsOf(a) - used(a));
  function metalHappy(a){
    const g = used(a); if (!g) return false;
    const pos = (el(a.sym).ox||[]).filter(s=>s.startsWith("+")).map(Number);
    return pos.includes(g) || (!pos.length && g === handsOf(a));
  }
  const needsMore = (a) => kindOf(a.sym) === "metal" ? !metalHappy(a) : free(a) > 0;
  const size = (sym) => sym === "H" ? 13 : sym === "*" ? 6 : 19;
  const ringR = (sym) => sym === "H" ? 24 : 34;
  function rest(b){ return b.kind === "ion" ? 82 : size(b.a.sym) + size(b.b.sym) + (b.kind === "dat" ? 22 : 14); }
  /* Boron's empty spot: boron has 3 electrons for 4 places, so even with all 3 hands held its shell has only 6.
     The 4th place is an empty socket that only a whole spare pair can fill (a dative bond). */
  const hasSocket = (a) => kindOf(a.sym) === "nonmetal" && el(a.sym)?.valence === 3 && !bonds.some(b => b.kind === "dat" && b.b === a);
  const sparePairs = (a) => kindOf(a.sym) === "nonmetal" && a.sym !== "H" ? outerItems(a).filter(i => i === "pair").length : 0;
  function datPairFor(a, b){
    if (hasSocket(a) && sparePairs(b) > 0) return {donor: b, acceptor: a};
    if (hasSocket(b) && sparePairs(a) > 0) return {donor: a, acceptor: b};
    return null;
  }
  const bondBetween = (p, q) => bonds.find(b => (b.a === p && b.b === q) || (b.a === q && b.b === p));
  const neighbors = (a) => bonds.filter(b => b.a === a || b.b === a).map(b => b.a === a ? b.b : b.a);

  /* ---------- coordinates ---------- */
  const toScreen = (x, y) => [W/2 + (x - cam.x) * cam.s, H/2 + (y - cam.y) * cam.s];
  const toWorld = (sx, sy) => [(sx - W/2) / cam.s + cam.x, (sy - H/2) / cam.s + cam.y];

  /* ---------- setup ---------- */
  function mount(){
    cv = $("wbCanvas"); ctx = cv.getContext("2d");
    cv.addEventListener("pointerdown", onDown);
    cv.addEventListener("pointermove", onMove);
    cv.addEventListener("pointerup", onUp);
    cv.addEventListener("pointercancel", onUp);
    cv.addEventListener("dblclick", onDbl);
    cv.addEventListener("wheel", onWheel, {passive: false});
    $("wbZoomIn").addEventListener("click", () => zoomBtn(1.35));
    $("wbZoomOutBtn").addEventListener("click", () => zoomBtn(1 / 1.35));
    $("wbFit").addEventListener("click", () => { manualCam = false; if (zoomBond) unzoom(); else fit(true); });
    $("wbDup").addEventListener("click", duplicate);
    $("wbPartsBtn").addEventListener("click", () => toggleParts());
    $("wbUndo").addEventListener("click", undo); undoBtn();
    $("wbGrid").addEventListener("click", () => { gridOn = !gridOn; try { localStorage.setItem("plab.grid", gridOn ? "1" : "0"); } catch(_){} gridBtn(); });
    gridBtn();
    mountCloudDrag();
    document.addEventListener("keydown", (ev) => {
      if (!visible) return;
      if (ev.key === "Escape"){ closePop(); unzoom(); }
      if ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === "z" && !ev.target.closest?.("input,textarea,select")){ ev.preventDefault(); undo(); }
      if ((ev.key === "Delete" || ev.key === "Backspace") && selected && document.activeElement === document.body){ removeAtom(selected); ev.preventDefault(); }
    });
    $("wbView").querySelectorAll("button").forEach(b => b.addEventListener("click", () => setView(b.dataset.v)));
    $("wbFill").addEventListener("click", fillH);
    $("wbTidy").addEventListener("click", () => { relax(240); manualCam = false; fit(true); });
    $("wbClear").addEventListener("click", clear);
    $("wbBreak").addEventListener("click", breakApart);
    setInterval(() => { if (visible && atoms.length && !drag) renderCloud(focusInfo); }, 15000);   // rotate element facts
    $("wbRecipesBtn").addEventListener("click", toggleRecipes);
    $("wbZoomOut").addEventListener("click", unzoom);
    $("wbShowF").addEventListener("click", () => { document.body.classList.toggle("show-f"); $("wbShowF").setAttribute("aria-pressed", document.body.classList.contains("show-f")); sizeToWindow(); });
    addEventListener("resize", () => { if (visible){ sizeToWindow(); placeCloud(); } });
    buildRecipes();
    // quick starts in the empty state: ready-made molecules to pull apart
    const quick = [["methane", "Methane"], ["water", "Water"], ["co2", "CO2"], ["nacl", "Table salt"], ["polyethylene", "Polyethylene"]];
    $("wbQuick").innerHTML = `<span class="small muted" style="align-self:center">Or start from:</span>` + quick.map(([id, n]) => `<button class="btn" data-q="${id}">${n}</button>`).join("");
    $("wbQuick").querySelectorAll("[data-q]").forEach(b => b.addEventListener("click", () => addMolecule(S.mols.find(m => m.id === b.dataset.q))));
  }
  function sizeToWindow(){
    const wrap = $("workbench");
    const top = wrap.getBoundingClientRect().top + scrollY;
    const h = Math.max(innerWidth <= 760 ? 380 : 440, innerHeight - (top - scrollY) - (innerWidth <= 760 ? 8 : 54));
    wrap.style.height = h + "px";
    const r = cv.getBoundingClientRect();
    dpr = Math.min(2, devicePixelRatio || 1); W = r.width; H = r.height;
    cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr);
  }
  function show(){
    visible = true; $("workbench").hidden = false; sizeToWindow(); update(); placeCloud();
    if (!raf) raf = requestAnimationFrame(loop);
  }
  function hide(){ visible = false; $("workbench").hidden = true; cancelAnimationFrame(raf); raf = 0; closePop(); }

  /* ---------- undo: a snapshot of the bench before each change you make ---------- */
  const history = [];
  let histHold = 0;                      // >0 while one action adds many atoms (counts as one step)
  function remember(){
    if (histHold) return;
    history.push({atoms: atoms.map(a => ({id: a.id, sym: a.sym, x: a.x, y: a.y, hands: a.hands, charge: a.charge})),
      bonds: bonds.map(b => ({a: b.a.id, b: b.b.id, order: b.order, kind: b.kind}))});
    if (history.length > 40) history.shift();
    undoBtn();
  }
  function undo(){
    const snapOf = history.pop(); undoBtn(); if (!snapOf) return;
    const byId = new Map(); atoms.length = 0; bonds.length = 0;
    for (const o of snapOf.atoms){ const a = {id: o.id, sym: o.sym, x: o.x, y: o.y, vx: 0, vy: 0}; if (o.hands != null) a.hands = o.hands; if (o.charge) a.charge = o.charge; atoms.push(a); byId.set(o.id, a); }
    for (const o of snapOf.bonds) bonds.push({a: byId.get(o.a), b: byId.get(o.b), order: o.order, kind: o.kind});
    selected = lastTouched = atoms[atoms.length - 1] || null; zoomBond = null; closePop();
    loadingRecipe = true; setTimeout(() => { loadingRecipe = false; }, 0);   // undoing back to a finished molecule isn't a new build
    note(null, "Undone. Tap Undo again to step back further.");
    fit(); update();
  }
  function undoBtn(){ const b = $("wbUndo"); if (b) b.disabled = !history.length; }

  /* ---------- editing ---------- */
  function freeSpot(){
    // spiral out from the view center until we find room
    for (let i = 0; i < 400; i++){
      const ang = i * 2.4, r = 30 + i * 6;
      const x = cam.x + Math.cos(ang) * r * (i ? 1 : 0), y = cam.y + Math.sin(ang) * r * 0.7 * (i ? 1 : 0);
      if (atoms.every(a => Math.hypot(a.x - x, a.y - y) > 70) && inBounds(x, y)) return [x, y];
    }
    return [cam.x + (Math.random() - .5) * 200, cam.y + (Math.random() - .5) * 120];
  }
  let headHc = 62, toolsHc = 76;
  const headH = () => headHc;
  const measureHead = () => {
    headHc = (document.querySelector(".wb-head")?.offsetHeight || 50) + 12;
    const wb = $("workbench"); if (!wb) return;
    wb.style.setProperty("--headh", headHc + "px");
    // the toolbar wraps to 2 rows on phones; the lesson/reaction card docks just above it
    toolsHc = document.querySelector(".wb-tools")?.offsetHeight || 48;
    wb.style.setProperty("--toolsh", toolsHc + "px");
  };
  function inBounds(x, y){ const [sx, sy] = toScreen(x, y); return sx > 40 && sx < W - 40 - (W > 760 ? 330 : 0) && sy > headH() + 20 && sy < H - (W > 760 ? 60 : toolsHc + 70); }
  function add(sym, x, y, extra){
    remember();
    if (x == null) [x, y] = freeSpot();
    const a = {id: nextId++, sym, x, y, vx: 0, vy: 0, ...(extra||{})};
    atoms.push(a); lastTouched = a; selected = a;
    if (!shownTips.has("add") && atoms.length === 1) tipAt(a, "add", `This ${nameOf(sym)} atom has ${describeHands(a)}. Add another atom, then drag them close together.`);
    else if (atoms.length === 2 && !shownTips.has("drag")) tipAt(a, "drag", "Now drag one atom right next to the other. If both have an empty hand, they'll hold on.");
    fit(); update(); return a;
  }
  function describeHands(a){
    const k = kindOf(a.sym), h = handsOf(a);
    if (k === "noble") return "no empty hands (it's already full)";
    if (k === "metal") return `${h === 1 ? "1 electron" : "up to " + h + " electrons"} it would rather give away`;
    return `${h} hand${h === 1 ? "" : "s"}`;
  }
  function removeAtom(a){
    remember();
    for (let i = bonds.length - 1; i >= 0; i--) if (bonds[i].a === a || bonds[i].b === a) bonds.splice(i, 1);
    atoms.splice(atoms.indexOf(a), 1);
    if (selected === a) selected = null; if (lastTouched === a) lastTouched = atoms[atoms.length - 1] || null;
    update();
  }
  function clear(){ if (atoms.length) remember(); lastNote = null; const bn = $("wbBanner"); if (bn) bn.hidden = true; atoms.length = 0; bonds.length = 0; selected = lastTouched = null; zoomBond = null; manualCam = false; Object.assign(camT, {x:0, y:0, s:1}); hideTip(); closePop(); hideCard(); update(); }
  function tryBond(a, b){
    if (bondBetween(a, b)) return false;
    const ka = kindOf(a.sym), kb = kindOf(b.sym);
    if (ka === "noble" || kb === "noble"){ const n = ka === "noble" ? a : b; tipAt(n, null, `${Name(n.sym)} is already full. It has no empty hands, so it won't hold on.`); return false; }
    if (ka === "metal" && kb === "metal"){ tipAt(a, "metals", "Two metals don't hold hands one-on-one. In a lump of metal, the atoms share their loose electrons as a crowd. That crowd is why metals carry electricity."); return false; }
    if (ka === "metal" || kb === "metal"){
      const m = ka === "metal" ? a : b, n = m === a ? b : a;
      const give = Math.min(free(m), free(n));
      if (give <= 0){ tipAt(n, null, free(n) ? `${Name(m.sym)} has no more electrons to give.` : `${Name(n.sym)}'s hands are all full already.`); return false; }
      remember(); bonds.push({a: m, b: n, order: give, kind: "ion"});
      tipAt(n, "ion", `${Name(m.sym)} doesn't share. It hands ${give === 1 ? "its electron" : give + " electrons"} to ${nameOf(n.sym)}. Now one is + and one is −, and they stick together like magnets.`);
      return true;
    }
    if (!free(a) || !free(b)){
      // no free hand on one side: maybe one atom can lend a whole spare pair to boron's empty spot
      const d = datPairFor(a, b);
      if (d){
        remember(); bonds.push({a: d.donor, b: d.acceptor, order: 1, kind: "dat"});
        tipAt(d.acceptor, "dat", `The ${nameOf(d.donor.sym)} brought a whole spare pair and plugged it into the ${nameOf(d.acceptor.sym)}'s empty spot. Both electrons came from the ${nameOf(d.donor.sym)}, so the ${nameOf(d.acceptor.sym)} didn't have to put one in. Chemists call this a <b>dative bond</b>. The arrow points from the giver to the taker.`);
        return true;
      }
      const sock = hasSocket(a) ? a : hasSocket(b) ? b : null, other = sock === a ? b : a;
      if (sock && !free(sock)){
        tipAt(sock, null, `The ${nameOf(sock.sym)} has an empty spot (the amber outline), but its hands are all used, so it has no electron to chip in. Only a partner that brings a whole spare pair can fill it. ${Name(other.sym)} ${other.sym === "H" ? "has just 1 electron, no spare pair" : "has no spare pair right now"}. Try ammonia's nitrogen or water's oxygen.`);
        return false;
      }
      const f = free(a) ? b : a; tipAt(f, null, `${Name(f.sym)}'s ${handsOf(f) === 1 ? "only hand is" : "hands are all"} already held.`); return false;
    }
    remember(); bonds.push({a, b, order: 1, kind: "cov"});
    if (!shownTips.has("bond")) tipAt(b, "bond", "They're holding hands. Each atom put in one electron, and those two shared electrons are the bond. Turn on Ring view to see them sitting in the overlap.");
    return true;
  }
  function addOrder(bd){
    if (bd.kind !== "cov") return;
    if (bd.order >= 3 || !free(bd.a) || !free(bd.b)){ tipMid(bd, null, bd.order >= 3 ? "Three handshakes is the most two atoms can share." : "To add another handshake, both atoms need an empty hand."); return; }
    remember(); bd.order++;
    tipMid(bd, bd.order === 2 ? "double" : "triple", bd.order === 2
      ? "Double bond: two handshakes between the same two atoms. The second one is the weaker grip. Opening it is how ethylene links up into polyethylene."
      : "Triple bond: three handshakes. Very strong, and it packs a lot of energy, like in acetylene torches.");
    update();
  }
  function breakBond(bd, why){
    remember();
    bonds.splice(bonds.indexOf(bd), 1);
    tipMid(bd, why === "pull" ? "break" : null, why === "pull"
      ? "You pulled hard enough to break the bond. Both atoms get their hands back. Heat does this in the reactor at Nexus: it shakes atoms until bonds snap."
      : "Bond broken. Both atoms get their hands back.");
    update();
  }
  function fillH(){
    const targets = atoms.filter(a => a.sym !== "H" && a.sym !== "*" && kindOf(a.sym) === "nonmetal" && free(a) > 0);
    if (!targets.length){ tipCenter("Nothing to fill. Every nonmetal atom already has its hands held."); return; }
    remember(); histHold++;
    for (const a of targets){
      const n = free(a), angs = freeAngles(a, n);
      for (const ang of angs){
        const h = add("H", a.x + Math.cos(ang) * 46, a.y + Math.sin(ang) * 46);
        bonds.push({a, b: h, order: 1, kind: "cov"});
      }
    }
    histHold--; relax(120); update();
  }

  /* ---------- recipes (library molecules) ---------- */
  function benchable(m){
    if (m.kind !== "lattice") return true;
    if (m.lattice.style !== "ionic") return false;
    const syms = Object.keys(m.counts);
    if (syms.length !== 2) return false;
    const metal = syms.find(s => isMetal(el(s))), non = syms.find(s => !isMetal(el(s)));
    if (!metal || !non) return false;
    const need = m.counts[non] * Math.abs(el(non).anionCharge ?? baseHands(non));
    const each = need / m.counts[metal];
    const pos = (el(metal).ox||[]).filter(s=>s.startsWith("+")).map(Number);
    return Number.isInteger(each) && pos.includes(each);
  }
  let loadingRecipe = false;
  // one molecule = one Undo step, however many atoms it adds
  function addMolecule(m){
    if (!benchable(m)) return false;
    remember(); histHold++;
    try { return addMoleculeInner(m); } finally { histHold--; }
  }
  function addMoleculeInner(m){
    loadingRecipe = true; setTimeout(() => { loadingRecipe = false; }, 0);
    hideCard();
    const ox = atoms.length ? Math.max(...atoms.map(a => a.x)) + 140 : cam.x;
    const oy = cam.y;
    if (m.kind === "lattice"){
      // a formula unit: metals hand electrons to nonmetals
      const syms = Object.keys(m.counts), metal = syms.find(s => isMetal(el(s))), non = syms.find(s => s !== metal);
      const ms = [], ns = [];
      for (let i = 0; i < m.counts[metal]; i++) ms.push(add(metal, ox + i * 90 - 40, oy - 45));
      for (let i = 0; i < m.counts[non]; i++) ns.push(add(non, ox + i * 90 - 40, oy + 45));
      for (const a of ms) for (const n of ns){ const g = Math.min(free(a), free(n)); if (g > 0) bonds.push({a, b: n, order: g, kind: "ion"}); }
    } else {
      const SC = 36, made = [];
      const xs = m.atoms.map(p => p[1]), ys = m.atoms.map(p => p[2]);
      const cx = (Math.min(...xs) + Math.max(...xs)) / 2, cy = (Math.min(...ys) + Math.max(...ys)) / 2;
      const sum = m.atoms.map(() => 0);
      for (const [i, j, o] of m.bonds){ sum[i] += o; sum[j] += o; }
      m.atoms.forEach((p, i) => {
        const extra = {};
        if (p[0] !== "*" && sum[i] !== baseHands(p[0])) extra.hands = sum[i];   // charged / expanded atoms keep their recipe count
        if (p[3]) extra.charge = p[3];
        made.push(add(p[0], ox + (p[1] - cx) * SC, oy + (p[2] - cy) * SC, extra));
      });
      for (const [i, j, o] of m.bonds) bonds.push({a: made[i], b: made[j], order: o, kind: "cov"});
    }
    lastTouched = atoms[atoms.length - 1]; selected = lastTouched;
    relax(60); fit(); update();
    note(null, `Loaded <b>${esc(m.name)}</b>. Pull atoms off it, or hit <b>Break apart</b> to pop every bond.`);
    return true;
  }
  function buildRecipes(){
    const box = $("wbRecipes");
    const ok = S.mols.filter(benchable);
    const ranked = ok.filter(m => m.rank).sort((p, q) => p.rank - q.rank);
    const tabs = [["everyday", "Everyday, ranked"], ["nexus", "Plastics & fuels"], ["rocket", "Rockets"], ["all", "A to Z"]];
    const tab = buildRecipes.tab || (ranked.length ? "everyday" : "all");
    let body;
    if (tab === "everyday") body = `<ol class="rank">${ranked.map(m => `<li><button data-r="${m.id}"><span class="rk">${m.rank}</span><span class="rn"><b>${esc(m.name)}</b> <span class="fm">${esc(m.formula)}</span><span class="rw">${esc(m.rankWhy || "")}</span></span></button></li>`).join("")}</ol>`;
    else {
      const list = ok.filter(tab === "nexus" ? (m => m.lens?.nexus) : tab === "rocket" ? (m => m.lens?.rocket) : (() => true)).sort((p, q) => p.name.localeCompare(q.name));
      body = `<div class="mlist">${list.map(m => `<button data-r="${m.id}">${esc(m.name)}<span class="fm">${esc(m.formula)}</span></button>`).join("")}</div>`;
    }
    box.innerHTML = `<div class="row" style="justify-content:space-between"><b>Recipes</b><button class="btn" id="wbRecipesClose">Close</button></div>
      <p class="small muted" style="margin:4px 0 8px">Drops the finished molecule on the bench. Drag it, spin it, pull it apart.</p>
      <div class="mini-seg rtabs" role="tablist">${tabs.filter(([k]) => k !== "everyday" || ranked.length).map(([k, t]) => `<button data-tab="${k}" aria-pressed="${k === tab}">${t}</button>`).join("")}</div>` + body;
    box.querySelectorAll("[data-tab]").forEach(b => b.addEventListener("click", () => { buildRecipes.tab = b.dataset.tab; buildRecipes(); }));
    box.querySelectorAll("[data-r]").forEach(b => b.addEventListener("click", () => { addMolecule(S.mols.find(m => m.id === b.dataset.r)); toggleRecipes(false); }));
    $("wbRecipesClose").addEventListener("click", () => toggleRecipes(false));
  }
  function toggleRecipes(force){ const box = $("wbRecipes"); box.hidden = force === false ? true : force === true ? false : !box.hidden; if (!box.hidden) $("wbParts").hidden = true; }

  /* ---------- recognition ---------- */
  function components(){
    const seen = new Set(), out = [];
    for (const a of atoms){
      if (seen.has(a)) continue;
      const comp = [], stack = [a]; seen.add(a);
      while (stack.length){ const x = stack.pop(); comp.push(x); for (const n of neighbors(x)) if (!seen.has(n)){ seen.add(n); stack.push(n); } }
      out.push(comp);
    }
    return out;
  }
  function signatureOf(list, bondList){
    // each atom: symbol + sorted neighbor symbols with bond order; then sort all. Good enough to tell isomers apart for small molecules.
    return list.map(a => a.s + "(" + bondList.filter(b => b.i === a || b.j === a).map(b => (b.i === a ? b.j.s : b.i.s) + b.o).sort().join(",") + ")").sort().join("|");
  }
  let LIBSIG = null;
  function libSig(){
    if (LIBSIG) return LIBSIG;
    LIBSIG = new Map();
    for (const m of S.mols) if (m.kind !== "lattice"){
      const nodes = m.atoms.map(p => ({s: p[0]}));
      const bl = m.bonds.map(([i, j, o]) => ({i: nodes[i], j: nodes[j], o}));
      LIBSIG.set(signatureOf(nodes, bl), m);
    }
    return LIBSIG;
  }
  function countsOf(comp){ const c = {}; for (const a of comp) if (a.sym !== "*") c[a.sym] = (c[a.sym]||0) + 1; return c; }
  const key = c => Object.keys(c).sort().map(s => s + c[s]).join("");
  function formula(c){
    const ks = Object.keys(c), hasC = ks.includes("C");
    ks.sort((p, q) => { if (hasC){ const o = s => s === "C" ? 0 : s === "H" ? 1 : 2; if (o(p) !== o(q)) return o(p) - o(q); return p.localeCompare(q); }
      const mp = isMetal(el(p)) ? 0 : 1, mq = isMetal(el(q)) ? 0 : 1; return mp - mq || (el(p).en||0) - (el(q).en||0); });
    return ks.map(s => s + (c[s] > 1 ? c[s] : "")).join("");
  }
  function identify(comp){
    const c = countsOf(comp), fm = formula(c);
    const open = comp.filter(needsMore);
    const ionic = bonds.some(b => b.kind === "ion" && comp.includes(b.a));
    let match = null, isomerOf = null;
    if (!open.length && comp.length > 1){
      const nodes = new Map(comp.map(a => [a, {s: a.sym}]));
      const bl = bonds.filter(b => b.kind === "cov" && nodes.has(b.a)).map(b => ({i: nodes.get(b.a), j: nodes.get(b.b), o: b.order}));
      match = ionic ? null : libSig().get(signatureOf([...nodes.values()], bl)) || null;
      if (!match){
        const k = key(c);
        const same = S.mols.filter(m => key(m.counts) === k && (ionic ? m.kind === "lattice" : m.kind !== "lattice"));
        if (ionic) match = same[0] || null; else isomerOf = same[0] || null;
      }
    }
    return {comp, counts: c, formula: fm, open, ionic, match, isomerOf, done: !open.length && comp.length > 1};
  }
  function statusFor(info){
    const {comp, open, match, isomerOf, done, formula: fm} = info;
    if (comp.length === 1){
      const a = comp[0];
      if (kindOf(a.sym) === "noble") return `1 ${nameOf(a.sym)} atom. It's already full, so it stays on its own.`;
      return `1 ${nameOf(a.sym)} atom with ${describeHands(a)}. Add atoms and drag them close.`;
    }
    if (done){
      const extra = socketText(comp);
      if (extra) return doneLine(info) + extra;
      if (match) return `Every hand is held. This is <b>${esc(match.name)}</b> ${match.formula.startsWith("(") || match.name.includes("(") ? "· " + esc(match.formula) : "(" + esc(match.formula) + ")"}.`;
      if (isomerOf) return `Every hand is held. Same atoms as <b>${esc(isomerOf.name)}</b>, but arranged differently, so it's a different molecule.`;
      return `Every hand is held. That's a stable ${esc(fm)}, but it isn't in my library yet.`;
    }
    // already have exactly the right atoms for a known molecule? say so first, loud and clear
    const near = almostFor(info);
    if (near.length){
      const names = near.map(m => `<b>${esc(m.name)}</b>`).join(" or ");
      const lead = `<span class="almost">Almost there</span> You have all the atoms for ${names} (${esc(near[0].formula)}). `;
      return lead + openHandsText(info);
    }
    return openHandsText(info);
  }
  function doneLine(info){
    const {match, isomerOf, formula: fm} = info;
    if (match) return `Every hand is held. This is <b>${esc(match.name)}</b> ${match.formula.startsWith("(") || match.name.includes("(") ? "· " + esc(match.formula) : "(" + esc(match.formula) + ")"}.`;
    if (isomerOf) return `Every hand is held. Same atoms as <b>${esc(isomerOf.name)}</b>, but arranged differently.`;
    const named = {B1H6N1: "ammonia borane, studied as a way to store hydrogen fuel", B1F3H3N1: "the BF3–ammonia pair", B1F3H2O1: "BF3 holding onto water"}[key(info.counts)];
    return named ? `Every hand is held. This is <b>${named}</b>.` : `Every hand is held. That's a stable ${esc(fm)}, but it isn't in my library yet.`;
  }
  /* extra lines when boron is involved: its empty spot, or a spare-pair bond filling it */
  function socketText(comp){
    const dat = bonds.find(b => b.kind === "dat" && comp.includes(b.a));
    const sock = comp.find(a => hasSocket(a) && free(a) === 0);
    let t = "";
    if (dat) t += ` The ${nameOf(dat.a.sym)} is lending its spare pair to the ${nameOf(dat.b.sym)} (the arrow), so now the ${nameOf(dat.b.sym)} has a full 8.`;
    if (sock) t += ` The ${nameOf(sock.sym)}'s hands are all held, but its shell only has 6, not 8. The <b>amber outline</b> is room for one whole pair: drop on an atom with a spare pair, like ammonia's nitrogen or water's oxygen.`;
    return t;
  }
  /* library molecules whose atom counts match the bench piece exactly (not finished yet) */
  function almostFor(info){
    if (!info || info.done || info.comp.length < 2) return [];
    const k = key(info.counts);
    return S.mols.filter(m => benchable(m) && m.kind !== "polymer" && key(m.counts) === k).slice(0, 2);
  }
  function openHandsText(info){
    const {open} = info;
    // what's still open, in plain words
    const bySym = {};
    for (const a of open){
      const g = (bySym[a.sym] ||= {metal: kindOf(a.sym) === "metal", atoms: 0, hands: []});
      g.atoms++; g.hands.push(g.metal ? handsOf(a) - used(a) : free(a));
    }
    const parts = Object.entries(bySym).map(([s, v]) => {
      if (v.metal) return `${nameOf(s)} still has an electron to give`;
      const same = v.hands.every(h => h === v.hands[0]), h = v.hands[0];
      if (v.atoms === 1) return `${nameOf(s)} still has ${h} empty hand${h > 1 ? "s" : ""}`;
      return same ? `${v.atoms} ${nameOf(s)}s each still have ${h} empty hand${h > 1 ? "s" : ""}` : `${v.atoms} ${nameOf(s)}s still have ${v.hands.reduce((x, y) => x + y, 0)} empty hands between them`;
    });
    const first = parts[0][0].toUpperCase() + parts[0].slice(1);
    const rest = parts.slice(1);
    let s = first + (rest.length ? (rest.length === 1 ? " and " : ", ") + rest.join(", ") : "") + ".";
    const nonH = open.filter(a => kindOf(a.sym) === "nonmetal" && a.sym !== "H");
    // two atoms already holding hands, both with a hand left: the fix is to hold with the spare hands too
    const dbl = bonds.find(b => b.kind === "cov" && b.order < 3 && info.comp.includes(b.a) && free(b.a) > 0 && free(b.b) > 0);
    if (dbl){
      const A = nameOf(dbl.a.sym), B = nameOf(dbl.b.sym), both = A === B ? `The two ${A}s` : `The ${A} and ${B}`;
      return s + ` ${both} are already holding hands and each has a spare one, so they can hold with that too: a ${dbl.order === 1 ? "double" : "triple"} bond. <button class="statbtn" data-dbl>Make it a ${dbl.order === 1 ? "double" : "triple"} bond</button>`;
    }
    // empty hands on atoms that AREN'T neighbors (e.g. both ends of C-C-C): a double bond can't reach.
    // Say why, and offer to move one hydrogen so two neighbors end up with the free hands.
    const fix = neighborFix(info);
    if (fix){
      const X = nameOf(fix.x.sym), M = nameOf(fix.mid.sym);
      return s + ` The empty hands are on two atoms that aren't holding each other: the ${M} sits between them. A double bond only forms between neighbors (like 3 people in a row: the two on the ends can't hold hands).` +
        (fix.h ? ` Fix: move one hydrogen off the middle ${M} onto an end ${X} (yank it off, drop it on). Then the middle and the other end are neighbors with free hands. <button class="statbtn" data-fixmove>Move it for me</button>` : "");
    }
    s += nonH.length ? " It can't last like this. Connect more atoms, or tap <b>Fill with H</b>." : " It can't last like this. Connect more atoms.";
    return s;
  }
  function neighborFix(info){
    const openN = info.comp.filter(a => kindOf(a.sym) === "nonmetal" && a.sym !== "H" && free(a) > 0);
    if (openN.length < 2 || openN.some(p => openN.some(q => p !== q && bondBetween(p, q)))) return null;
    for (const x of openN) for (const z of openN){
      if (x === z) continue;
      const mid = neighbors(x).find(y => y.sym !== "H" && neighbors(z).includes(y));
      if (!mid) continue;
      const h = neighbors(mid).find(n => n.sym === "H" && bondBetween(mid, n)?.kind === "cov");
      return {x, z, mid, h};
    }
    return null;
  }
  function applyNeighborFix(fix){
    if (!fix?.h) return;
    remember();
    const bd = bondBetween(fix.mid, fix.h); bonds.splice(bonds.indexOf(bd), 1);
    const ang = freeAngles(fix.x, 1)[0] ?? 0;
    fix.h.x = fix.x.x + Math.cos(ang) * 40; fix.h.y = fix.x.y + Math.sin(ang) * 40;
    bonds.push({a: fix.x, b: fix.h, order: 1, kind: "cov"});
    relax(40);
    note(null, `Moved a hydrogen from the middle ${nameOf(fix.mid.sym)} to the end ${nameOf(fix.x.sym)}. Now two neighbors each have a free hand, so they can make a double bond.`);
    update();
  }
  let lastDone = new Set(), lastAlmost = new Set(), glowAtoms = new Set(), focusInfo = null, quiet = false;   // quiet: a reaction is playing, it shows its own banner
  function focusOf(comps){ return comps.find(c => c.comp.includes(selected)) || comps.find(c => c.comp.includes(lastTouched)) || comps[comps.length - 1]; }
  /* ---------- "how to read this" strip under the status line ---------- */
  let legendOpen = innerWidth > 760;   // folded by default on phones
  try { const v = localStorage.getItem("plab.legend"); if (v != null) legendOpen = v !== "0"; } catch(_){}
  function renderLegend(){
    const box = $("wbLegend"); if (!box) return;
    if (!atoms.length){ box.innerHTML = ""; return; }
    if (!legendOpen){ box.innerHTML = `<button class="lgbtn" id="lgToggle">How to read this</button>`; }
    else {
      const ink = "currentColor", acc = css("--accent"), seat = css("--seat");
      const line = (n) => `<svg width="26" height="12" viewBox="0 0 26 12">${n === 2 ? `<line x1="2" y1="4" x2="24" y2="4" stroke="${ink}" stroke-width="2"/><line x1="2" y1="8" x2="24" y2="8" stroke="${ink}" stroke-width="2"/>` : `<line x1="2" y1="6" x2="24" y2="6" stroke="${ink}" stroke-width="2"/>`}</svg>`;
      const dash = `<svg width="14" height="14" viewBox="0 0 14 14"><circle cx="7" cy="7" r="5" fill="none" stroke="${seat}" stroke-width="1.6" stroke-dasharray="2.5 2.5"/></svg>`;
      const pair = `<svg width="22" height="14" viewBox="0 0 22 14"><circle cx="7" cy="7" r="3.3" fill="${acc}"/><circle cx="15" cy="7" r="3.3" fill="${acc}"/></svg>`;
      const ion = `<svg width="26" height="12" viewBox="0 0 26 12"><line x1="2" y1="6" x2="24" y2="6" stroke="${ink}" stroke-width="2" stroke-dasharray="3 4"/></svg>`;
      const items = view === "ring"
        ? [[pair, "2 dots in an overlap = a shared pair (one bond)"], [dash, "empty hand: wants another electron"], [ion, "dashed line = electron handed over (+ and − stick)"]]
        : [[line(1), "1 line = 1 handshake (2 shared electrons)"], [line(2), "2 lines = double bond"], [dash, "empty hand: it won't last like this"], [ion, "electron handed over"]];
      if (atoms.some(hasSocket)) items.push([`<svg width="22" height="14" viewBox="0 0 22 14"><circle cx="7" cy="7" r="4" fill="none" stroke="${css("--warn")}" stroke-width="1.6" stroke-dasharray="2 1.6"/><circle cx="15" cy="7" r="4" fill="none" stroke="${css("--warn")}" stroke-width="1.6" stroke-dasharray="2 1.6"/></svg>`, "amber = boron's empty spot: room for a whole pair"]);
      if (bonds.some(b => b.kind === "dat")) items.push([`<svg width="26" height="12" viewBox="0 0 26 12"><line x1="2" y1="6" x2="18" y2="6" stroke="${acc}" stroke-width="2"/><path d="M24 6 L17 2 L17 10 Z" fill="${acc}"/></svg>`, "arrow = one atom brought both electrons"]);
      box.innerHTML = items.map(([g, t]) => `<span class="lg">${g}${t}</span>`).join("") +
        `<span class="lg">Drag gently to move. Yank hard to snap one bond. Tap a bond for more.</span> <button class="lgbtn" id="lgToggle">Hide</button>`;
    }
    $("lgToggle").addEventListener("click", () => { legendOpen = !legendOpen; try { localStorage.setItem("plab.legend", legendOpen ? "1" : "0"); } catch(_){} renderLegend(); });
  }
  const hooks = [];   // other modules (lessons, reactions) listen here
  function update(){
    if (!visible) return;
    renderLegend(); measureHead();
    const comps = components().map(identify);
    const focus = focusOf(comps);
    focusInfo = focus || null;
    $("wbEmpty").hidden = atoms.length > 0;
    $("wbStatus").innerHTML = focus ? statusFor(focus) : "";
    $("wbStatus").querySelector("[data-fixmove]")?.addEventListener("click", () => applyNeighborFix(neighborFix(focus)));
    $("wbStatus").querySelector("[data-dbl]")?.addEventListener("click", () => {
      const b = bonds.find(b => b.kind === "cov" && b.order < 3 && focus.comp.includes(b.a) && free(b.a) > 0 && free(b.b) > 0);
      if (b) addOrder(b);
    });
    const real = comps.filter(c => c.formula);
    $("wbChips").innerHTML = real.length > 1 ? real.map(c => `<span class="wbchip ${c.done ? "ok" : ""}">${esc(c.match?.name || wordsFor(c.counts))}${c.done ? " ✓" : ""}</span>`).join("") : "";
    // a molecule just got finished -> "You built it!" banner
    const doneNow = new Set(comps.filter(c => c.done && c.match).map(c => c.match.id + ":" + c.comp.map(a => a.id).sort().join(",")));
    for (const k of doneNow) if (!lastDone.has(k)){ const c = comps.find(x => x.match && k.startsWith(x.match.id + ":")); if (c && !loadingRecipe && !quiet){ celebrate(c.match); rememberBuilt(c.match); } }
    lastDone = doneNow;
    const almostNow = new Map();
    for (const c of comps){ const near = almostFor(c)[0]; if (near) almostNow.set(near.id + ":" + c.comp.map(a => a.id).sort().join(","), {m: near, c}); }
    for (const [k, v] of almostNow) if (!lastAlmost.has(k) && !loadingRecipe && !quiet)
      celebrate(v.m, "Almost there", v.m.name, "One more step: fill the glowing empty hands", "almost");
    lastAlmost = new Set(almostNow.keys());
    glowAtoms = new Set([...almostNow.values()].flatMap(v => v.c.open));
    $("wbBreak").disabled = !(focus && bonds.some(b => focus.comp.includes(b.a)));
    $("wbDup").disabled = !(focus && focus.comp.length > 1);
    renderCloud(focus);
    renderDetails(focus);
    if (typeof markActive === "function") markActive();
    for (const h of hooks) try { h(comps); } catch(e){ console.error(e); }
  }
  function counts(){ const c = {}; for (const a of atoms) if (a.sym !== "*") c[a.sym] = (c[a.sym]||0) + 1; return c; }

  /* ---------- break a whole molecule apart ---------- */
  function breakApart(){
    const f = focusInfo; if (!f) return;
    const set = new Set(f.comp), had = bonds.filter(b => set.has(b.a)).length;
    if (!had) return;
    remember();
    for (let i = bonds.length - 1; i >= 0; i--) if (set.has(bonds[i].a)) bonds.splice(i, 1);
    // pop outward from the middle so you can see every atom is loose
    const cx = f.comp.reduce((t, a) => t + a.x, 0) / f.comp.length, cy = f.comp.reduce((t, a) => t + a.y, 0) / f.comp.length;
    for (const a of f.comp){ const dx = a.x - cx, dy = a.y - cy, d = Math.hypot(dx, dy) || 1; a.vx += dx / d * 7 + (Math.random() - .5) * 2; a.vy += dy / d * 7 + (Math.random() - .5) * 2; }
    // keep the biggest atom in focus so the cloud talks about it
    const hub = f.comp.filter(a => a.sym !== "*").sort((p, q) => handsOf(q) - handsOf(p))[0]; if (hub){ selected = lastTouched = hub; }
    note(null, `All ${had} bond${had > 1 ? "s" : ""} broken. Every atom has its hands back. That's like pyrolysis heat turned all the way up: in the reactor, bonds snap a few at a time.`);
    update();
  }

  /* ---------- duplicate: copy the selected molecule and set it beside the original ---------- */
  function duplicate(){
    const f = focusInfo; if (!f || !f.comp.length) return;
    remember();
    const comp = f.comp, xs = comp.map(a => a.x), shift = Math.max(...xs) - Math.min(...xs) + 110;
    const map = new Map();
    loadingRecipe = true; setTimeout(() => { loadingRecipe = false; }, 0);   // a copy isn't a new build: no banner
    for (const a of comp){
      const c = {id: nextId++, sym: a.sym, x: a.x + shift, y: a.y + 16, vx: 0, vy: 0};
      if (a.hands != null) c.hands = a.hands; if (a.charge) c.charge = a.charge;
      atoms.push(c); map.set(a, c);
    }
    for (const b of bonds.slice()) if (map.has(b.a) && map.has(b.b)) bonds.push({a: map.get(b.a), b: map.get(b.b), order: b.order, kind: b.kind});
    selected = lastTouched = map.get(comp.find(a => a.sym !== "H") || comp[0]);
    const nm = f.match?.name || wordsFor(f.counts);
    const dbl = bonds.some(b => map.has(b.a) && b.kind === "cov" && b.order >= 2);
    note(null, `Copied <b>${esc(nm)}</b>. ${dbl
      ? "To link copies into a chain (that's how plastic is made): tap a double bond and choose <b>Loosen one handshake</b>. Each carbon gets a free hand. Then drag a free carbon onto a free carbon in the other copy."
      : "Drag the copy wherever you want it."}`);
    fit(); update();
  }
  /* double -> single (or triple -> double): frees one hand on each atom without separating them */
  function lessOrder(bd){
    if (bd.kind !== "cov" || bd.order < 2) return;
    remember(); bd.order--;
    note(null, `Loosened one handshake. The ${nameOf(bd.a.sym)} and ${nameOf(bd.b.sym)} still hold on, and each now has a free hand to grab something new. That's exactly what happens when ethylene links up into polyethylene.`);
    update();
  }

  /* ---------- parts shelf: ready-made pieces with free hands, plus things you've built ----------
     Coordinates are in bond-length units; free hands point the open way. */
  const PARTS = (() => {
    const ring = [], rb = [];
    for (let i = 0; i < 6; i++){ const t = i * Math.PI / 3; ring.push(["C", 1.15 * Math.cos(t), 1.15 * Math.sin(t)]); rb.push([i, (i + 1) % 6, i % 2 ? 1 : 2]); }
    for (let i = 0; i < 6; i++){ if (i === 3) continue; const t = i * Math.PI / 3; rb.push([i, ring.length, 1]); ring.push(["H", 2.05 * Math.cos(t), 2.05 * Math.sin(t)]); }
    return [
      {id: "ch3", name: "Methyl group", f: "CH3", what: "A carbon holding 3 hydrogens, with 1 free hand. It caps the end of a chain.",
        atoms: [["C", 0, 0], ["H", -0.5, -0.87], ["H", -1, 0], ["H", -0.5, 0.87]], bonds: [[0, 1, 1], [0, 2, 1], [0, 3, 1]]},
      {id: "ch2", name: "Chain link", f: "CH2", what: "A carbon holding 2 hydrogens, with 2 free hands. Two of them with a double bond make ethylene. A long row of them is polyethylene.",
        atoms: [["C", 0, 0], ["H", 0, -1], ["H", 0, 1]], bonds: [[0, 1, 1], [0, 2, 1]]},
      {id: "oh", name: "Hydroxyl group", f: "OH", what: "An oxygen holding 1 hydrogen, with 1 free hand. Stick it on a carbon chain and you get an alcohol, like ethanol.",
        atoms: [["O", 0, 0], ["H", -0.8, -0.6]], bonds: [[0, 1, 1]]},
      {id: "nh2", name: "Amino group", f: "NH2", what: "A nitrogen holding 2 hydrogens, with 1 free hand. It's the nitrogen part of the amino acids your body builds proteins from.",
        atoms: [["N", 0, 0], ["H", -0.8, -0.6], ["H", -0.8, 0.6]], bonds: [[0, 1, 1], [0, 2, 1]]},
      {id: "co", name: "Carbonyl group", f: "C=O", what: "A carbon double-bonded to an oxygen, with 2 free hands on the carbon. It's in acetone, sugars, and plastics like PET.",
        atoms: [["C", 0, 0], ["O", 0, -1.15]], bonds: [[0, 1, 2]]},
      {id: "cooh", name: "Acid group", f: "COOH", what: "A carbon with a double-bonded oxygen and an O-H, with 1 free hand. It's what makes vinegar (acetic acid) sour.",
        atoms: [["C", 0, 0], ["O", 0.9, -0.75], ["O", 0.9, 0.75], ["H", 1.75, 0.95]], bonds: [[0, 1, 2], [0, 2, 1], [2, 3, 1]]},
      {id: "ph", name: "Benzene ring", f: "C6H5", what: "Six carbons in a flat ring, with 1 free hand. It's the ring in styrene, aspirin, and many plastics.",
        atoms: ring, bonds: rb},
    ];
  })();
  const BUILT_KEY = "plab.built";
  let built = [];
  try { built = JSON.parse(localStorage.getItem(BUILT_KEY) || "[]"); } catch(_){ built = []; }
  function rememberBuilt(m){
    built = [m.id, ...built.filter(id => id !== m.id)].slice(0, 12);
    try { localStorage.setItem(BUILT_KEY, JSON.stringify(built)); } catch(_){}
    if (!$("wbParts").hidden) buildParts();
  }
  function addPart(p){ remember(); histHold++; try { addPartInner(p); } finally { histHold--; } }
  function addPartInner(p){
    loadingRecipe = true; setTimeout(() => { loadingRecipe = false; }, 0);
    const SC = 38, ox = atoms.length ? Math.max(...atoms.map(a => a.x)) + 130 : cam.x, oy = cam.y;
    const made = p.atoms.map(([s, x, y]) => add(s, ox + x * SC, oy + y * SC));
    for (const [i, j, o] of p.bonds) bonds.push({a: made[i], b: made[j], order: o, kind: "cov"});
    selected = lastTouched = made[0];
    relax(30); fit();
    note(null, `Added a <b>${esc(p.name)}</b> (${esc(p.f)}). The dashed circles are its free hands: drag it onto another piece to connect them.`);
    update();
  }
  function buildParts(){
    const box = $("wbParts");
    const mine = built.map(id => S.mols.find(m => m.id === id)).filter(Boolean);
    box.innerHTML = `<div class="row" style="justify-content:space-between"><b>Parts shelf</b><button class="btn" id="wbPartsClose">Close</button></div>
      <p class="small muted" style="margin:4px 0 8px">Ready-made pieces with free hands. Tap one to drop it on the bench, then snap pieces together.</p>
      <div class="parts">${PARTS.map(p => `<button data-part="${p.id}"><b>${esc(p.name)}</b><span class="fm">${esc(p.f)}</span><span class="rw">${esc(p.what)}</span></button>`).join("")}</div>
      <div class="eyebrow" style="margin:14px 0 6px">Things you've built</div>
      ${mine.length ? `<div class="parts">${mine.map(m => `<button data-built="${m.id}"><b>${esc(m.name)}</b><span class="fm">${esc(m.formula)}</span></button>`).join("")}</div>`
        : `<p class="small muted">Nothing yet. Every molecule you finish by hand lands here, so you can drop a whole one in with one tap.</p>`}`;
    $("wbPartsClose").addEventListener("click", () => toggleParts(false));
    box.querySelectorAll("[data-part]").forEach(b => b.addEventListener("click", () => { addPart(PARTS.find(p => p.id === b.dataset.part)); toggleParts(false); }));
    box.querySelectorAll("[data-built]").forEach(b => b.addEventListener("click", () => { addMolecule(S.mols.find(m => m.id === b.dataset.built)); toggleParts(false); }));
  }
  function toggleParts(force){
    const box = $("wbParts"), open = force === undefined ? box.hidden : force;
    if (open){ buildParts(); toggleRecipes(false); }
    box.hidden = !open;
  }

  /* ---------- names: say "2 carbons + 4 hydrogens", not just "C2H4" ---------- */
  function orderSyms(c){
    const ks = Object.keys(c), hasC = ks.includes("C");
    return ks.sort((p, q) => { if (hasC){ const o = s => s === "C" ? 0 : s === "H" ? 1 : 2; if (o(p) !== o(q)) return o(p) - o(q); return p.localeCompare(q); }
      const mp = isMetal(el(p)) ? 0 : 1, mq = isMetal(el(q)) ? 0 : 1; return mp - mq || (el(p).en||0) - (el(q).en||0); });
  }
  const cap = (t) => t ? t[0].toUpperCase() + t.slice(1) : t;
  function wordsFor(c){
    return orderSyms(c).map(s => `${c[s]} ${nameOf(s)}${c[s] > 1 ? "s" : ""}`).join(" + ");
  }

  /* ---------- idea cloud: hints, fun facts, what just happened ---------- */
  let lastNote = null;          // {text, t}
  function note(key, text){
    if (key && shownTips.has(key)) return;
    if (key) shownTips.add(key);
    lastNote = {text, t: performance.now()};
    renderCloud(focusInfo);
  }
  // keep the old call sites working: every tip now lands in the cloud instead of on top of the atoms
  const tipAt = (a, key, text) => note(key, text);
  const tipMid = (bd, key, text) => note(key, text);
  const tipCenter = (text) => note(null, text);
  function hideTip(){}
  const subtract = (m, c) => { const d = {}; for (const [s, n] of Object.entries(m)) if (n - (c[s] || 0) > 0) d[s] = n - (c[s] || 0); return d; };
  const diffText = (d) => Object.entries(d).map(([s, n]) => `${n} ${n === 1 ? nameOf(s) : nameOf(s) + (nameOf(s).endsWith("s") ? "" : "s")}`).join(" and ");
  function ideasFor(info){
    if (!info || !info.formula) return [];
    const c = info.counts, have = Object.keys(c), out = [];
    if (info.done && !info.match && !info.ionic) return honestHints(info);
    if (info.done && info.match){
      const same = S.mols.filter(m => m !== info.match && m.kind !== "lattice" && Object.keys(m.counts).sort().join() === have.slice().sort().join()).slice(0, 2);
      for (const m of same) out.push({text: `Same elements, different molecule: try building <b>${esc(m.name)}</b> (${esc(m.formula)}).`, add: subtract(m.counts, c), id: m.id});
      out.push({text: `Hit <b>Break apart</b> and rebuild it from scratch.`});
      return out.slice(0, 3);
    }
    // library molecules this could grow into: contain everything on the bench, at most one new element
    const cands = [];
    for (const m of S.mols){
      if (!benchable(m) || m.kind === "polymer") continue;
      if (!have.every(s => (m.counts[s] || 0) >= c[s])) continue;
      const extra = Object.keys(m.counts).filter(s => !c[s]);
      if (extra.length > 1) continue;
      const d = subtract(m.counts, c), size = Object.values(d).reduce((a, b) => a + b, 0);
      if (!size || size > 10) continue;
      cands.push({m, d, size: size + extra.length * 3});
    }
    cands.sort((p, q) => p.size - q.size);
    if (!cands.length) return honestHints(info);
    for (const {m, d} of cands.slice(0, 3)){
      const k = have.length && have.every(s => m.counts[s] % c[s] === 0) && Object.keys(m.counts).length === have.length ? m.counts[have[0]] / c[have[0]] : 0;
      const twin = k >= 2 && have.every(s => m.counts[s] === k * c[s]);
      out.push(twin
        ? {text: `Build ${k === 2 ? "a second" : (k - 1) + " more"} ${esc(info.formula)} and connect them: that's <b>${esc(m.name)}</b> (${esc(m.formula)}).`, add: d, id: m.id}
        : {text: `Add ${diffText(d)} and connect ${Object.values(d).reduce((a, b) => a + b, 0) > 1 ? "them" : "it"}: that's <b>${esc(m.name)}</b> (${esc(m.formula)}).`, add: d, id: m.id});
    }
    return out;
  }
  /* When the bench holds something no real molecule grows from, say so, and point at real things nearby:
     library molecules that share the most elements, plus the element's own best-known compounds. */
  function honestHints(info){
    const c = info.counts, have = Object.keys(c), out = [];
    out.push({text: info.done
      ? `Every hand is held, but this exact molecule isn't one I know to be real. Real chemistry is pickier than hand-counting: some atoms prefer certain partners.`
      : `Heads up: no real molecule I know grows from this combination. It's a fine experiment, but here are real things close to it.`});
    const scored = S.mols.filter(m => benchable(m)).map(m => { const ks = Object.keys(m.counts); const shared = have.filter(s => m.counts[s]).length; return {m, score: shared * 10 - Math.abs(ks.length - have.length) - Object.values(m.counts).reduce((a, b) => a + b, 0) / 40}; })
      .filter(x => x.score >= 10).sort((p, q) => q.score - p.score).slice(0, 2);
    for (const {m} of scored) out.push({text: `Real and close: <b>${esc(m.name)}</b> (${esc(m.formula)}). <button class="linkbtn" data-load="${m.id}">Load it</button>`});
    const rare = have.filter(s => !["H", "C", "O"].includes(s)).slice(0, 2);
    for (const s of rare){ const b = el(s)?.bonds?.[0]; if (b) out.push({text: `What ${nameOf(s)} really makes: <b>${esc(b.formula)}</b>, ${esc(b.name.toLowerCase())}. ${esc(b.note)}`}); }
    return out.slice(0, 4);
  }
  function factsFor(info){
    if (!info) return [];
    if (info.done && info.match) return (info.match.facts || []).slice(0, 3);
    // while building: a fact about one of the elements on the bench
    const syms = Object.keys(info.counts).filter(s => el(s)?.number);
    if (!syms.length) return [];
    const e = el(syms[(Math.floor(performance.now() / 15000)) % syms.length]);
    return [`${e.name} by the numbers: ${e.number.value}. ${e.number.label}.`];
  }
  function gridBtn(){ const b = $("wbGrid"); if (b){ b.setAttribute("aria-pressed", gridOn); b.textContent = gridOn ? "Grid on" : "Grid off"; } }
  /* ---------- the idea cloud can be dragged by its top bar (laptop) and minimized (both) ---------- */
  function placeCloud(){
    const box = $("wbCloud"); if (!box) return;
    if (phone() || !cloudPos){ box.style.left = box.style.top = box.style.right = ""; return; }
    const wb = $("workbench"), w = box.offsetWidth || 300;
    const x = Math.max(6, Math.min(wb.clientWidth - w - 6, cloudPos.x)), y = Math.max(6, Math.min(wb.clientHeight - 48, cloudPos.y));
    box.style.left = x + "px"; box.style.top = y + "px"; box.style.right = "auto";
  }
  function mountCloudDrag(){
    const box = $("wbCloud");
    // the drag follows the pointer anywhere on the page, but only starts once it moves,
    // so a plain click (or double-click) on the bar still works
    const move = (e) => {
      if (!cloudDrag) return;
      if (!cloudDrag.live){
        if (Math.hypot(e.clientX - cloudDrag.x0, e.clientY - cloudDrag.y0) < 4) return;
        cloudDrag.live = true; box.classList.add("dragging");
      }
      e.preventDefault();
      cloudPos = {x: e.clientX - cloudDrag.wb.left - cloudDrag.dx, y: e.clientY - cloudDrag.wb.top - cloudDrag.dy}; placeCloud();
    };
    const end = () => {
      if (!cloudDrag) return;
      const moved = cloudDrag.live; cloudDrag = null; box.classList.remove("dragging");
      removeEventListener("pointermove", move); removeEventListener("pointerup", end); removeEventListener("pointercancel", end);
      if (moved) store.set("plab.cloudPos", cloudPos);
    };
    box.addEventListener("pointerdown", (e) => {
      if (phone() || !e.target.closest(".cl-bar") || e.target.closest(".cl-min")) return;
      if (e.pointerType === "mouse") e.preventDefault();   // no text selection while dragging (clicks still work)
      const r = box.getBoundingClientRect();
      cloudDrag = {dx: e.clientX - r.left, dy: e.clientY - r.top, x0: e.clientX, y0: e.clientY, live: false, wb: $("workbench").getBoundingClientRect()};
      addEventListener("pointermove", move); addEventListener("pointerup", end); addEventListener("pointercancel", end);
    });
    // double-click the bar: put it back in its corner
    box.addEventListener("dblclick", (e) => { if (!e.target.closest(".cl-bar")) return; cloudPos = null; store.set("plab.cloudPos", null); placeCloud(); });
  }
  function renderCloud(info){
    const box = $("wbCloud"); if (!box) return;
    if (!atoms.length){ box.hidden = true; return; }
    box.classList.toggle("mini", cloudMini);
    const fresh = lastNote && performance.now() - lastNote.t < 20000 ? lastNote.text : null;
    const ideas = ideasFor(info), facts = factsFor(info);
    let html = "";
    if (info?.done && info.match) html += `<div class="cl-title">${esc(info.match.name)}</div><div class="cl-f"><span class="mono">${esc(info.match.formula)}</span> · ${esc(wordsFor(info.counts))}</div>`;
    else if (info?.formula){
      const near = almostFor(info);
      html += `<div class="cl-title">${esc(cap(wordsFor(info.counts)))}</div><div class="cl-f"><span class="mono">${esc(info.formula)}</span>${near.length ? ` · almost ${esc(near[0].name)}` : info.open.length ? " · still building" : ""}</div>`;
      if (near.length && near[0].blurb) html += `<div class="cl-item now"><span class="cl-tag idea">Almost</span>${esc(near[0].name)}: ${esc(near[0].blurb)}</div>`;
    }
    if (fresh) html += `<div class="cl-item now"><span class="cl-tag">Just now</span>${fresh}</div>`;
    if (info?.done && info.match && typeof photoFor === "function") html += photoFor("molecules", info.match.id);
    if (info?.done && info.match && info.match.kind !== "lattice") html += `<div class="cl-item now"><button class="btn primary" data-spin>Spin in 3D</button></div>`;
    const det = info?.done && info.match?.details;
    if (det){
      for (const [k, t] of [["what", "What it is"], ["where", "Where you meet it"], ["bonds", "Why the bonds work"], ["extra", "One more thing"]])
        if (det[k]) html += `<div class="cl-item"><span class="cl-tag">${t}</span>${esc(det[k])}</div>`;
    }
    for (const f of facts) html += `<div class="cl-item"><span class="cl-tag fact">Fun fact</span>${esc(f)}</div>`;
    for (const [i, it] of ideas.entries()) html += `<div class="cl-item idea"><span class="cl-tag idea">Idea</span>${it.text}${it.add && Object.keys(it.add).length ? ` <button class="linkbtn" data-idea="${i}">Add the atoms</button>` : ""}</div>`;
    const n = ideas.length + facts.length + (fresh ? 1 : 0);
    const nearL = almostFor(info)[0];
    const label = info?.done && info.match ? info.match.name : nearL ? `Almost ${nearL.name}` : info?.counts ? wordsFor(info.counts) : "";
    const bar = `<div class="cl-bar" title="${phone() ? "" : "Drag to move. Double-click to put it back."}">${phone() ? "" : `<span class="cl-grip" aria-hidden="true">⠿</span>`}<button class="cl-head" id="clToggle" type="button">Idea cloud${phone() && !cloudMini ? ` <span class="cl-count">${esc(label)} · ${n} ${n === 1 ? "tip" : "tips"} ${box.classList.contains("open") ? "▾" : "▴"}</span>` : ""}</button><button class="cl-min" id="clMin" type="button" aria-label="${cloudMini ? "Show" : "Minimize"} the idea cloud">${cloudMini ? "Show" : "–"}</button></div>`;
    box.innerHTML = bar + (cloudMini ? "" : html);
    box.hidden = false;
    $("clToggle").addEventListener("click", () => { if (cloudMini){ cloudMini = false; store.set("plab.cloudMini", 0); renderCloud(focusInfo); return; } if (phone()){ box.classList.toggle("open"); renderCloud(focusInfo); fit(); } });
    $("clMin").addEventListener("click", () => { cloudMini = !cloudMini; store.set("plab.cloudMini", cloudMini ? 1 : 0); box.classList.remove("open"); renderCloud(focusInfo); placeCloud(); fit(); });
    box.querySelector("[data-spin]")?.addEventListener("click", () => typeof open3D === "function" && open3D(info.match));
    box.querySelectorAll("[data-load]").forEach(b => b.addEventListener("click", () => { const m = S.mols.find(x => x.id === b.dataset.load); if (m) addMolecule(m); }));
    box.querySelectorAll("[data-idea]").forEach(b => b.addEventListener("click", () => {
      const it = ideas[+b.dataset.idea];
      for (const [sym, n] of Object.entries(it.add)) for (let i = 0; i < n; i++) add(sym);
      note(null, `Added. Now drag the new atoms onto your molecule.`);
    }));
  }
  let bannerTimer = 0;
  function celebrate(m, small, big, sub, tone){
    const b = $("wbBanner");
    b.classList.toggle("almost", tone === "almost");
    b.innerHTML = `<span class="bn-small">${esc(small || "You just built")}</span><span class="bn-big">${esc(big || m.name)}</span><span class="mono bn-f">${esc(sub || m.formula)}</span>`;
    b.hidden = false; b.classList.remove("go"); void b.offsetWidth; b.classList.add("go");
    clearTimeout(bannerTimer); bannerTimer = setTimeout(() => { b.hidden = true; }, 4200);
    lastNote = null;
  }

  /* ---------- details under the bench (the full write-up) ---------- */
  function renderDetails(info){
    const box = $("wbDetails"); if (!box) return;
    if (!info || !info.formula){ box.hidden = true; return; }
    box.hidden = false;
    const c = info.counts, m = info.done ? info.match : null;
    // hands count: what each element brings and what's left
    const comp = info.comp.filter(a => a.sym !== "*");
    const cov = bonds.filter(b => b.kind === "cov" && info.comp.includes(b.a));
    const ion = bonds.filter(b => b.kind === "ion" && info.comp.includes(b.a));
    const rows = Object.keys(c).map(sym => {
      const k = kindOf(sym), h = baseHands(sym);
      const each = k === "noble" ? "0 hands (full)" : k === "metal" ? `gives up to ${h} electron${h > 1 ? "s" : ""}` : `${h} hand${h > 1 ? "s" : ""}`;
      const total = k === "nonmetal" ? c[sym] * h : "";
      return `<tr><td><b>${esc(Name(sym))}</b> <span class="muted">(${sym})</span> × ${c[sym]}</td><td class="muted">${each}</td><td class="r">${total}</td></tr>`;
    }).join("");
    const shakes = cov.reduce((t, b) => t + b.order, 0), given = ion.reduce((t, b) => t + b.order, 0);
    const emptyLeft = comp.filter(a => kindOf(a.sym) === "nonmetal").reduce((t, a) => t + free(a), 0);
    const els = Object.keys(c).map(sym => { const e = el(sym); return `<div class="dt-el"><span class="dt-tile" style="--cat-bg:var(${(CAT[e.category]||["--st-unknown"])[0]})">${sym}</span>
      <div style="min-width:0"><b>${esc(e.name)}</b> <span class="muted small">${esc(e.tagline || "")}</span> <button class="linkbtn" data-open="${sym}">Open its card</button></div></div>`; }).join("");
    const setK = Object.keys(c).sort().join();
    const sameSet = S.mols.filter(x => x !== m && Object.keys(x.counts).sort().join() === setK).slice(0, 14);
    const plusOne = S.mols.filter(x => { const ks = Object.keys(x.counts); return ks.length === Object.keys(c).length + 1 && Object.keys(c).every(s => x.counts[s]); }).slice(0, 12);
    const list = (arr) => arr.map(x => `<button data-mol="${x.id}">${esc(x.name)}<span class="fm">${esc(x.formula)}</span></button>`).join("");
    const L = m?.lens || {};
    box.innerHTML = `
      <div class="dt-head"><div><span class="eyebrow">On your bench</span><h2>${esc(m ? m.name : cap(wordsFor(c)))} <span class="mono muted dt-f">${esc(m ? m.formula : info.formula)}</span></h2>
        <p class="dt-status">${statusFor(info)}</p></div>
        <button class="btn" id="dtBreak" ${bonds.some(b => info.comp.includes(b.a)) ? "" : "disabled"}>Break apart</button></div>
      <div class="dt-grid">
        <section class="dt-card"><h3>Hands count</h3>
          <table class="dt-table">${rows}</table>
          <p class="small" style="margin:6px 0 0">${shakes ? `<b>${shakes}</b> handshake${shakes > 1 ? "s" : ""} (bonds) use <b>${shakes * 2}</b> hands.` : ""} ${given ? `<b>${given}</b> electron${given > 1 ? "s" : ""} handed from metal to nonmetal.` : ""}
          ${emptyLeft ? `<b>${emptyLeft}</b> empty hand${emptyLeft > 1 ? "s" : ""} left.` : info.comp.length > 1 ? "No empty hands left." : ""}</p>
        </section>
        ${m ? `<section class="dt-card"><h3>What it is</h3>${typeof photoFor === "function" ? photoFor("molecules", m.id) : ""}<p>${esc(m.blurb)}</p><p class="small"><b>Used for:</b> ${esc(m.uses)}</p>
          ${m.kind !== "lattice" ? `<button class="btn btn3d" id="dt3d">Spin in 3D</button>` : ""}
          ${L.nexus ? `<div class="lensbox nexus"><span class="eyebrow"><span class="dot" style="background:var(--nexus)"></span>Nexus / pyrolysis</span><p>${esc(L.nexus)}</p></div>` : ""}
          ${L.rocket ? `<div class="lensbox rocket"><span class="eyebrow"><span class="dot" style="background:var(--rocket)"></span>Rockets</span><p>${esc(L.rocket)}</p></div>` : ""}</section>` : ""}
        ${m?.details ? `<section class="dt-card"><h3>Read more</h3>${[["where", "Where you meet it"], ["bonds", "Why the bonds work"], ["extra", "One more thing"]].filter(([k]) => m.details[k]).map(([k, t]) => `<p><b>${t}.</b> ${esc(m.details[k])}</p>`).join("")}</section>` : ""}
        ${m && m.facts?.length ? `<section class="dt-card"><h3>Fun facts</h3><ul class="uses">${m.facts.map(f => `<li>${esc(f)}</li>`).join("")}</ul></section>` : ""}
        <section class="dt-card"><h3>The elements in it</h3>${els}</section>
        ${sameSet.length ? `<section class="dt-card"><h3>Also made from these elements</h3><div class="mlist">${list(sameSet)}</div></section>` : ""}
        ${plusOne.length ? `<section class="dt-card"><h3>Add one more element</h3><div class="mlist">${list(plusOne)}</div></section>` : ""}
      </div>`;
    $("dtBreak").addEventListener("click", breakApart);
    $("dt3d")?.addEventListener("click", () => { scrollTo({top: 0, behavior: "smooth"}); open3D(m); });
    box.querySelectorAll("[data-open]").forEach(b => b.addEventListener("click", () => { setMode("explore"); onCell(b.dataset.open); scrollTo({top: 0, behavior: "smooth"}); }));
    box.querySelectorAll("[data-mol]").forEach(b => b.addEventListener("click", () => { loadMolecule(b.dataset.mol); scrollTo({top: 0, behavior: "smooth"}); }));
  }
  function showCard(){} function hideCard(){}
  /* ---------- bond strength ----------
     Average bond energies in kJ/mol: the energy to snap one mole of that bond. Textbook averages;
     the real value shifts a little from molecule to molecule. Key: sorted symbols + order. */
  const BOND_E = {
    "H-H1":436,"C-H1":413,"C-C1":348,"C-C2":614,"C-C3":839,"C-O1":358,"C-O2":799,"C-O3":1072,"H-O1":463,"O-O1":146,"O-O2":495,
    "H-N1":391,"N-N1":163,"N-N2":418,"N-N3":941,"C-N1":293,"C-N2":615,"C-N3":891,"F-H1":567,"Cl-H1":431,"Br-H1":366,"H-I1":299,
    "C-F1":485,"C-Cl1":328,"Br-C1":276,"C-I1":240,"F-F1":155,"Cl-Cl1":242,"Br-Br1":193,"I-I1":151,"H-S1":339,"C-S1":259,"O-S2":523,
    "H-P1":322,"Cl-P1":326,"H-Si1":323,"O-Si1":452,"Si-Si1":226,"N-O1":201,"N-O2":607,"F-S1":327,"F-Xe1":130,"B-C1":356
  };
  function bondEnergy(bd){ const [p, q] = [bd.a.sym, bd.b.sym].sort(); return BOND_E[`${p}-${q}${bd.order}`] ?? null; }
  function meterHTML(bd){
    if (bd.kind === "ion") return `<div class="meter-note">Not one bond: in a crystal every + pulls on every − around it. That's why salts melt so hot (table salt at 801 °C).</div>`;
    const e = bondEnergy(bd);
    if (e == null) return `<div class="meter-note">No common average value for this pair.</div>`;
    const pct = Math.min(100, e / 1072 * 100);
    const cmp = e < 200 ? "weak: snaps easily" : e < 380 ? "medium" : e < 600 ? "strong" : "very strong";
    const name = `${bd.a.sym}${bd.order === 2 ? "=" : bd.order === 3 ? "≡" : "–"}${bd.b.sym}`;
    const nice = `${Name(bd.a.sym)}–${nameOf(bd.b.sym)} ${bd.order === 2 ? "double" : bd.order === 3 ? "triple" : "single"} bond`;
    let hint = "";
    if (name === "C–C" || name === "C–H" || name === "H–C") hint = " Carbon–carbon (348) is weaker than carbon–hydrogen (413), so heat snaps carbon chains before it strips hydrogens off.";
    return `<div class="meter"><div class="meter-top"><span>Bond strength</span><span class="mono">${e} kJ/mol · ${cmp}</span></div>
      <div class="meter-bar"><i style="width:${pct.toFixed(0)}%"></i></div>
      <div class="meter-note">${esc(nice)} (${esc(name)}), average. kJ/mol means kilojoules per mole: the energy it takes to snap a big batch of these bonds. Bigger = harder to break.${hint}</div></div>`;
  }
  function openPop(bd){
    const p = $("wbPop"), [x, y] = toScreen((bd.a.x + bd.b.x) / 2, (bd.a.y + bd.b.y) / 2);
    const canAdd = bd.kind === "cov" && bd.order < 3 && free(bd.a) && free(bd.b);
    p.innerHTML = `<div class="small" style="margin-bottom:6px"><b>${Name(bd.a.sym)}–${Name(bd.b.sym)}</b>: ${bd.kind === "ion" ? "electron handed over" : bd.order === 1 ? "1 handshake" : bd.order + " handshakes"}</div>
      <div class="row">${bd.kind === "cov" ? `<button class="btn" data-act="more" ${canAdd ? "" : "disabled"}>+ handshake</button>` : ""}
      <button class="btn" data-act="zoom">Zoom in</button>${bd.kind === "cov" && bd.order > 1 ? `<button class="btn" data-act="less">Loosen one handshake</button>` : ""}<button class="btn" data-act="break">Break</button></div>${meterHTML(bd)}`;
    p.hidden = false;
    p.style.left = Math.max(8, Math.min(W - 270, x - 130)) + "px"; p.style.top = Math.max(56, Math.min(H - p.offsetHeight - 10, y - 150)) + "px";
    p.querySelector('[data-act="more"]')?.addEventListener("click", () => { closePop(); addOrder(bd); });
    p.querySelector('[data-act="zoom"]').addEventListener("click", () => { closePop(); zoomTo(bd); });
    p.querySelector('[data-act="break"]').addEventListener("click", () => { closePop(); breakBond(bd, "click"); });
    p.querySelector('[data-act="less"]')?.addEventListener("click", () => { closePop(); lessOrder(bd); });
  }
  function closePop(){ const p = $("wbPop"); if (p) p.hidden = true; }

  /* ---------- zoom into one bond ---------- */
  function zoomTo(bd){
    zoomBond = bd; closePop(); hideTip();
    Object.assign(camT, {x: (bd.a.x + bd.b.x) / 2, y: (bd.a.y + bd.b.y) / 2, s: Math.min(3.2, Math.max(2, Math.min(W, H) / 230))});
    const A = Name(bd.a.sym), B = Name(bd.b.sym);
    let txt;
    if (bd.kind === "ion") txt = `<b>${A} handed ${bd.order === 1 ? "an electron" : bd.order + " electrons"} to ${B.toLowerCase()}.</b> The moved electron (outlined) now sits on ${B.toLowerCase()}'s ring. ${A} is left with a + charge, ${B.toLowerCase()} with a −, and opposite charges pull together. Nothing is shared.`;
    else txt = `<b>${A} and ${B.toLowerCase()} each put in ${bd.order === 1 ? "one electron" : bd.order + " electrons"}.</b> The ${bd.order * 2} electrons in the glowing overlap are shared, so <i>both</i> atoms get to count them. That's what fills their empty hands. ${bd.order > 1 ? `${bd.order} shared pairs = a ${bd.order === 2 ? "double" : "triple"} bond.` : "One shared pair = a single bond."}`;
    $("wbZoomText").innerHTML = txt + meterHTML(bd); $("wbZoom").hidden = false;
  }
  function unzoom(){ if (!zoomBond) return; zoomBond = null; manualCam = false; Object.assign(camT, {x: cam.x, y: cam.y, s: 1}); fit(true); $("wbZoom").hidden = true; }
  /* ---------- zoom and pan by hand ---------- */
  // zoom by factor f, keeping the world point under screen spot (sx, sy) fixed
  function zoomAt(sx, sy, f){
    const [wx, wy] = toWorld(sx, sy), s = clampS(cam.s * f);
    cam.s = camT.s = s;
    cam.x = camT.x = wx - (sx - W / 2) / s; cam.y = camT.y = wy - (sy - H / 2) / s;
    manualCam = true;
  }
  function onWheel(ev){ ev.preventDefault(); const [sx, sy] = pos(ev); zoomAt(sx, sy, Math.exp(-ev.deltaY * 0.0015)); }
  // buttons ease toward the new zoom around the current view center
  // zooming in heads toward the atom you last tapped, so you land on something instead of empty bench
  function zoomBtn(f){
    camT.s = clampS(camT.s * f); manualCam = true;
    const t = f > 1 && selected && atoms.includes(selected) ? selected : null;
    if (t){ camT.x = t.x; camT.y = t.y; } else { camT.x = cam.x; camT.y = cam.y; }
  }
  function setView(v){ view = v; fit(); renderLegend(); $("wbView").querySelectorAll("button").forEach(b => b.setAttribute("aria-pressed", b.dataset.v === v));
    if (v !== "ring") hideTip();
    if (v === "ring") tipCenter("Ring view: each atom shows its outer ring. Dots in an overlap are shared pairs (the bonds). Dashed circles are empty hands."); }
  /* force = reframe even if you zoomed/panned yourself (Fit and Tidy buttons) */
  function fit(force){
    if (manualCam && !force) return;
    if (!atoms.length){ Object.assign(camT, {x: 0, y: 0, s: 1}); return; }
    // frame where atoms are headed (a.tx/a.ty during a reaction), not where they are mid-glide
    const xs = atoms.map(a => a.tx ?? a.x), ys = atoms.map(a => a.ty ?? a.y);
    const bw = Math.max(...xs) - Math.min(...xs) + 140, bh = Math.max(...ys) - Math.min(...ys) + 160;
    const side = W > 760 ? (cloudMini ? 0 : 330) : 0;   // the idea cloud sits on the right (on phones it's a drawer at the bottom)
    const lc = $("wbLearn"), cardOn = lc && !lc.hidden && lc.offsetHeight > 0;
    const left = W > 760 && cardOn ? 350 : 0;   // lesson / reaction card on the left
    const toolsH = document.querySelector(".wb-tools")?.offsetHeight || 76;
    let bottom = side ? 0 : ($("wbCloud").classList.contains("open") ? H * 0.55 : toolsH + 66);   // phone: space the cloud strip + toolbar take
    if (!side && cardOn){   // phone: the card docks at the bottom, so keep the atoms above its top edge
      const wr = $("workbench").getBoundingClientRect(), r = lc.getBoundingClientRect();
      bottom = Math.max(bottom, wr.bottom - r.top + 8);
    }
    const top = headH(), avail = H - top - (side ? 70 : 10) - bottom;
    const s = Math.min(view === "ring" ? 2.1 : 1.7, Math.max(0.4, Math.min((W - side - left) / bw, avail / bh)));
    Object.assign(camT, {x: (Math.max(...xs) + Math.min(...xs)) / 2 + (side - left) / 2 / s, y: (Math.max(...ys) + Math.min(...ys)) / 2 - (top - (side ? 70 : 10) - bottom) / 2 / s - (side ? 35 : 0) / s, s});
  }

  /* ---------- pointer ---------- */
  let touchPad = 0;   // extra hit radius for fingers
  function hitAtom(sx, sy){
    let best = null, bd = 1e9;
    for (const a of atoms){ const [x, y] = toScreen(a.x, a.y), d = Math.hypot(x - sx, y - sy), r = (view === "ring" ? Math.min(ringR(a.sym), 22) : size(a.sym)) * cam.s + 6 + touchPad; if (d < r && d < bd){ best = a; bd = d; } }
    return best;
  }
  function hitBond(sx, sy){
    for (const b of bonds){
      const [x1, y1] = toScreen(b.a.x, b.a.y), [x2, y2] = toScreen(b.b.x, b.b.y);
      const dx = x2 - x1, dy = y2 - y1, L2 = dx*dx + dy*dy || 1;
      const t = Math.max(0, Math.min(1, ((sx - x1) * dx + (sy - y1) * dy) / L2));
      if (Math.hypot(x1 + t * dx - sx, y1 + t * dy - sy) < 8 + touchPad && t > .15 && t < .85) return b;
    }
    return null;
  }
  const pos = (ev) => { const r = cv.getBoundingClientRect(); return [ev.clientX - r.left, ev.clientY - r.top]; };
  const phone = () => W <= 760;
  const inTrash = (sx, sy) => phone() ? (sx > W - 96 && sy > headH() && sy < headH() + 70) : (sx > W - 96 && sy > H - 84);
  let lastBondTap = {b: null, t: 0}, lastAtomTap = {a: null, t: 0};
  function onDown(ev){
    ev.preventDefault();
    touchPad = ev.pointerType === "touch" ? 12 : 0;
    const [sx, sy] = pos(ev); closePop();
    ptrs.set(ev.pointerId, [sx, sy]);
    try { cv.setPointerCapture(ev.pointerId); } catch(_){}
    if (ptrs.size === 2){
      // second finger down: whatever the first finger was doing becomes a pinch (the atom stays where it is)
      if (drag){ drag = null; $("wbTrash").classList.remove("hot"); hoverTrash = false; }
      pan = null; clearTimeout(pendingBondClick);
      const [p, q] = [...ptrs.values()];
      pinch = {d: Math.hypot(p[0] - q[0], p[1] - q[1]) || 1, s: cam.s, mid: toWorld((p[0] + q[0]) / 2, (p[1] + q[1]) / 2)};
      return;
    }
    if (ptrs.size > 2) return;
    const a = hitAtom(sx, sy);
    if (a){
      const [wx, wy] = toWorld(sx, sy);
      drag = {a, ox: a.x - wx, oy: a.y - wy, sx, sy, moved: false};
      selected = a; lastTouched = a; cv.setPointerCapture(ev.pointerId); hideTip();
      return;
    }
    const bd = hitBond(sx, sy);
    if (bd){
      const now = performance.now();
      clearTimeout(pendingBondClick);
      if (lastBondTap.b === bd && now - lastBondTap.t < 380){ lastBondTap = {b: null, t: 0}; zoomTo(bd); return; }
      lastBondTap = {b: bd, t: now};
      pendingBondClick = setTimeout(() => openPop(bd), 300); return;
    }
    // empty space: drag to pan. A plain tap (no movement) still deselects, like before.
    pan = {sx, sy, cx: cam.x, cy: cam.y, moved: false};
  }
  function onMove(ev){
    const [sx, sy] = pos(ev);
    if (ptrs.has(ev.pointerId)) ptrs.set(ev.pointerId, [sx, sy]);
    if (pinch && ptrs.size >= 2){
      const [p, q] = [...ptrs.values()], d = Math.hypot(p[0] - q[0], p[1] - q[1]) || 1;
      const s = clampS(pinch.s * d / pinch.d), mx = (p[0] + q[0]) / 2, my = (p[1] + q[1]) / 2;
      cam.s = camT.s = s;
      cam.x = camT.x = pinch.mid[0] - (mx - W / 2) / s; cam.y = camT.y = pinch.mid[1] - (my - H / 2) / s;
      manualCam = true; return;
    }
    if (pan){
      if (Math.hypot(sx - pan.sx, sy - pan.sy) > 4) pan.moved = true;
      if (pan.moved){
        cam.x = camT.x = pan.cx - (sx - pan.sx) / cam.s; cam.y = camT.y = pan.cy - (sy - pan.sy) / cam.s;
        manualCam = true; cv.style.cursor = "grabbing";
      }
      return;
    }
    if (!drag){ cv.style.cursor = hitAtom(sx, sy) ? "grab" : hitBond(sx, sy) ? "pointer" : "default"; return; }
    const [wx, wy] = toWorld(sx, sy);
    const nx = wx + drag.ox, ny = wy + drag.oy, ddx = nx - drag.a.x, ddy = ny - drag.a.y;
    drag.a.x = nx; drag.a.y = ny; drag.a.vx = drag.a.vy = 0;
    // atoms hanging only on this one (hydrogens, chain-end markers) come along for the ride
    // (only end caps like H, and never the very atom you might be pushing onto)
    for (const n of neighbors(drag.a)) if ((n.sym === "H" || n.sym === "*") && neighbors(n).length === 1 && n !== drag.onto && drag.a.sym !== "H"){ n.x += ddx; n.y += ddy; }
    if (Math.hypot(sx - drag.sx, sy - drag.sy) > 3) drag.moved = true;
    // pushed onto an atom it's already holding? remember it: letting go there adds a handshake
    // (checked against the pointer, since the partner gets nudged away as they overlap)
    drag.onto = null;
    for (const b of neighbors(drag.a)){ const [bx, by] = toScreen(b.x, b.y); if (Math.hypot(bx - sx, by - sy) < (size(b.sym) + 16) * cam.s + touchPad){ drag.onto = b; break; } }
    hoverTrash = inTrash(sx, sy);
    $("wbTrash").classList.toggle("hot", hoverTrash);
    cv.style.cursor = "grabbing";
    // yank to break: any bond on the dragged atom stretched too far snaps
    let worst = null, ws = BREAK;
    for (const b of bonds) if (b.a === drag.a || b.b === drag.a){ const st = Math.hypot(b.a.x - b.b.x, b.a.y - b.b.y) / rest(b); if (st > ws){ ws = st; worst = b; } }
    if (worst) breakBond(worst, "pull");
  }
  function onUp(ev){
    ptrs.delete(ev.pointerId);
    if (pinch){ if (ptrs.size < 2) pinch = null; return; }   // lifting one finger ends the pinch; the other finger does nothing
    if (pan){
      if (!pan.moved){ selected = null; if (zoomBond) unzoom(); }
      pan = null; cv.style.cursor = "default"; return;
    }
    if (!drag) return;
    const a = drag.a, [sx, sy] = pos(ev);
    if (inTrash(sx, sy)){ removeAtom(a); }
    else {
      // snap: closest unbonded atom within reach
      let best = null, bd = 1e9;
      const reach = (b) => Math.max(78, 70 / cam.s, rest({a, b, kind: kindOf(a.sym) === "metal" || kindOf(b.sym) === "metal" ? "ion" : "cov"}) * 1.35);
      for (const b of atoms) if (b !== a && !bondBetween(a, b)){ const d = Math.hypot(a.x - b.x, a.y - b.y); if (d < reach(b) && d < bd){ best = b; bd = d; } }
      // dropped right on top of an atom it's already holding? hold with another hand (double/triple bond)
      const onto = drag.onto && bondBetween(a, drag.onto) ? drag.onto : null;
      if (onto && drag.moved){ const bd2 = bondBetween(a, onto); addOrder(bd2); a.x += (a.x - onto.x) * 0.8 + 20; }
      else if (best && tryBond(a, best) && phone()) fit();
      if (!drag.moved){
        // two quick taps on the same atom: open it in the full Explore view
        const now = performance.now();
        if (lastAtomTap.a === a && now - lastAtomTap.t < 380){
          lastAtomTap = {a: null, t: 0};
          $("wbTrash").classList.remove("hot"); hoverTrash = false; drag = null;
          if (typeof openAtomPop === "function") openAtomPop(a.sym);
          return;
        }
        lastAtomTap = {a, t: now};
        const k = kindOf(a.sym);
        const sh = el(a.sym)?.shells || [];
        const shellTxt = sh.length > 1 ? ` ${sh.length} shells (the ${sh.length - 1} faint inner ring${sh.length > 2 ? "s" : ""} + the bold outer one). ` : " ";
        const g = typeof gstFor === "function" ? gstFor(el(a.sym)) : null;
        tipAt(a, null, `<b>${Name(a.sym)}</b> (${a.sym}).${shellTxt}${g ? `<b>${g.verdict}.</b> ` : ""}${k === "metal" ? (used(a) ? `It has given away ${used(a)} electron${used(a) > 1 ? "s" : ""}` : `It can give away up to ${handsOf(a)} electron${handsOf(a) > 1 ? "s" : ""}`) : k === "noble" ? "Full, no hands" : `${handsOf(a)} hand${handsOf(a) > 1 ? "s" : ""}, ${free(a)} still empty`}. Drag to move it; drop it on the trash to remove it.`);
      }
    }
    $("wbTrash").classList.remove("hot"); hoverTrash = false;
    drag = null; update();
  }
  function onDbl(ev){
    const [sx, sy] = pos(ev); clearTimeout(pendingBondClick); closePop();
    if (hitAtom(sx, sy)) return;   // double-tapping an atom opens the Explore view (handled in onUp, works on phones too)
    const bd = hitBond(sx, sy);
    if (bd) zoomTo(bd); else if (zoomBond) unzoom();
  }

  /* ---------- physics ---------- */
  function step(dt){
    const K = 0.18, REP = 2600, DAMP = 0.78;
    for (const b of bonds){
      if (b.a.tx != null || b.b.tx != null) continue;
      const dx = b.b.x - b.a.x, dy = b.b.y - b.a.y, d = Math.hypot(dx, dy) || 0.01, f = K * (d - rest(b)), ux = dx / d, uy = dy / d;
      if (drag && (b.a === drag.a || b.b === drag.a) && f < 0) continue;   // pushing partners together on purpose: hold still
      b.a.vx += f * ux; b.a.vy += f * uy; b.b.vx -= f * ux; b.b.vy -= f * uy;
    }
    // bent shapes: an atom with 2 neighbors and spare electron pairs (O in water, S in H2S) pushes them to ~105°
    for (const a of atoms){
      if (kindOf(a.sym) !== "nonmetal" || handsOf(a) !== 2 || el(a.sym).valence < 6) continue;
      const nb = neighbors(a); if (nb.length !== 2) continue;
      const [p, q] = nb, bp = bondBetween(a, p), bq = bondBetween(a, q);
      if (!bp || !bq || bp.order > 1 || bq.order > 1) continue;
      const target = Math.sqrt(rest(bp) ** 2 + rest(bq) ** 2 - 2 * rest(bp) * rest(bq) * Math.cos(105 * Math.PI / 180));
      const dx = q.x - p.x, dy = q.y - p.y, d = Math.hypot(dx, dy) || .01, f = 0.08 * (d - target), ux = dx / d, uy = dy / d;
      p.vx += f * ux; p.vy += f * uy; q.vx -= f * ux; q.vy -= f * uy;
    }
    for (let i = 0; i < atoms.length; i++) for (let j = i + 1; j < atoms.length; j++){
      const p = atoms[i], q = atoms[j], dx = q.x - p.x, dy = q.y - p.y, d2 = dx*dx + dy*dy;
      if (d2 > 160*160) continue;
      // while you push an atom onto its own partner, don't let the partner run away
      if (drag && (p === drag.a || q === drag.a) && bondBetween(p, q)) continue;
      const d = Math.sqrt(d2) || 0.5, f = Math.min(6, REP / (d2 + 60)), ux = dx / d, uy = dy / d;
      p.vx -= f * ux; p.vy -= f * uy; q.vx += f * ux; q.vy += f * uy;
    }
    const [x0, y0] = toWorld(30, headH()), [x1, y1] = toWorld(W - 30 - (W > 760 ? 320 : 0), H - (W > 760 ? 70 : (toolsHc + 70)));
    for (const a of atoms){
      if (drag && drag.a === a) continue;
      if (a.tx != null){ a.x += (a.tx - a.x) * 0.1; a.y += (a.ty - a.y) * 0.1; a.vx = a.vy = 0; continue; }
      a.vx *= DAMP; a.vy *= DAMP; a.x += a.vx * dt; a.y += a.vy * dt;
      // keep atoms on screen, but only while the bench frames itself (zoomed in by hand, the view is smaller than the bench)
      if (!manualCam && x1 > x0 && y1 > y0){ if (a.x < x0) a.vx += (x0 - a.x) * .05; if (a.x > x1) a.vx -= (a.x - x1) * .05; if (a.y < y0) a.vy += (y0 - a.y) * .05; if (a.y > y1) a.vy -= (a.y - y1) * .05; }
    }
  }
  function relax(n){ for (let i = 0; i < n; i++) step(1); }

  /* ---------- drawing ---------- */
  function freeAngles(a, n){
    // pick n directions far from existing bonds
    const taken = neighbors(a).map(o => Math.atan2(o.y - a.y, o.x - a.x));
    const even = evenAngles(taken, n); if (even) return even;
    const out = [];
    for (let k = 0; k < n; k++){
      let best = 0, bestD = -1;
      for (let i = 0; i < 36; i++){
        const ang = -Math.PI / 2 + i * Math.PI / 18;
        const all = taken.concat(out);
        const d = all.length ? Math.min(...all.map(t => Math.abs(Math.atan2(Math.sin(ang - t), Math.cos(ang - t))))) : Math.PI;
        if (d > bestD + 1e-6){ bestD = d; best = ang; }
      }
      out.push(best);
    }
    return out;
  }
  function loop(){
    raf = requestAnimationFrame(loop);
    if (!visible || !W) return;
    step(1);
    for (const k of ["x", "y", "s"]) cam[k] += (camT[k] - cam[k]) * 0.15;
    draw();
  }
  function draw(){
    const t = performance.now() / 1000;
    const ink = css("--ink"), muted = css("--muted"), accent = css("--accent"), line = css("--line"), seat = css("--seat"), surface = css("--surface");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, W, H);
    // faint grid: it's a bench
    if (gridOn){
      ctx.strokeStyle = line; ctx.globalAlpha = .45; ctx.lineWidth = 1;
      let g = 40 * cam.s; while (g < 14) g *= 4; while (g > 240) g /= 4;   // keep the spacing readable at any zoom
      const ox = (W/2 - cam.x * cam.s) % g, oy = (H/2 - cam.y * cam.s) % g;
      for (let x = ox; x < W; x += g){ ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke(); }
      for (let y = oy; y < H; y += g){ ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke(); }
      ctx.globalAlpha = 1;
    }
    ctx.save(); ctx.translate(W/2, H/2); ctx.scale(cam.s, cam.s); ctx.translate(-cam.x, -cam.y);
    const ringMode = view === "ring";
    const focusSet = zoomBond ? new Set([zoomBond.a, zoomBond.b]) : null;
    const dimFor = (a) => focusSet && !focusSet.has(a) ? 0.18 : 1;
    // snap preview while dragging
    if (drag){
      for (const b of atoms) if (b !== drag.a && !bondBetween(drag.a, b) && Math.hypot(drag.a.x - b.x, drag.a.y - b.y) < Math.max(80, 70 / cam.s)){
        ctx.setLineDash([4, 5]); ctx.strokeStyle = accent; ctx.lineWidth = 2 / cam.s; ctx.beginPath(); ctx.moveTo(drag.a.x, drag.a.y); ctx.lineTo(b.x, b.y); ctx.stroke(); ctx.setLineDash([]);
      }
    }
    if (ringMode || zoomBond) drawRings(focusSet, dimFor, t, {ink, muted, accent, seat});
    if (!ringMode){
      // bonds
      for (const b of bonds){
        if (focusSet && focusSet.has(b.a) && focusSet.has(b.b)) continue;
        ctx.globalAlpha = Math.min(dimFor(b.a), dimFor(b.b));
        const dx = b.b.x - b.a.x, dy = b.b.y - b.a.y, d = Math.hypot(dx, dy) || 1, nx = -dy / d, ny = dx / d;
        const stretch = d / rest(b);
        if (b.kind === "ion"){
          ctx.setLineDash([3, 5]); ctx.strokeStyle = muted; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(b.a.x, b.a.y); ctx.lineTo(b.b.x, b.b.y); ctx.stroke(); ctx.setLineDash([]);
        } else if (b.kind === "dat"){
          drawDativeArrow(b, accent);
        } else {
          const offs = b.order === 2 ? [-3.5, 3.5] : b.order === 3 ? [-6, 0, 6] : [0];
          ctx.strokeStyle = stretch > 1.6 ? css("--proton") : ink; ctx.lineWidth = 2.6 * Math.min(1, 1.6 / cam.s);   // thinner when zoomed in, so it stays a line
          for (const k of offs){ ctx.beginPath(); ctx.moveTo(b.a.x + nx*k, b.a.y + ny*k); ctx.lineTo(b.b.x + nx*k, b.b.y + ny*k); ctx.stroke(); }
        }
        ctx.globalAlpha = 1;
      }
      // atoms
      for (const a of atoms){
        if (focusSet && focusSet.has(a)) continue;
        ctx.globalAlpha = dimFor(a);
        if (a.sym === "*"){ ctx.fillStyle = muted; ctx.font = "700 14px Archivo, sans-serif"; ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.fillText("…", a.x, a.y); ctx.globalAlpha = 1; continue; }
        const r = size(a.sym), col = atomColor(a.sym), k = kindOf(a.sym);
        // empty hands: small dashed circles pointing away from bonds
        const deep = cam.s >= DEEP_AT, kz = Math.min(1, 1.6 / cam.s);
        if (k === "nonmetal" && !deep){
          if (hasSocket(a)) drawSocket(a, r + 12, kz);
          for (const ang of freeAngles(a, free(a))){
            const hx = a.x + Math.cos(ang) * (r + 11), hy = a.y + Math.sin(ang) * (r + 11);
            if (glowAtoms.has(a)){   // almost done: the hands that still need filling pulse
              const pulse = 0.5 + 0.5 * Math.sin(performance.now() / 260);
              ctx.beginPath(); ctx.arc(hx, hy, 7 + pulse * 3, 0, 7); ctx.fillStyle = css("--warn"); ctx.globalAlpha = 0.35 + pulse * 0.35; ctx.fill(); ctx.globalAlpha = dimFor(a);
            }
            const k2 = Math.min(1, 1.6 / cam.s); ctx.setLineDash([2.5 * k2, 2.5 * k2]); ctx.strokeStyle = seat; ctx.lineWidth = 1.6 * k2; ctx.beginPath(); ctx.arc(hx, hy, 5.5, 0, 7); ctx.stroke(); ctx.setLineDash([]);
          }
        } else if (k === "metal" && !deep){
          // electrons a metal can still give: same size as other electrons, just outside the ring
          const left = handsOf(a) - used(a);
          if (!metalHappy(a)) for (const ang of freeAngles(a, Math.max(0, left))){ ctx.beginPath(); ctx.arc(a.x + Math.cos(ang) * (r + 7), a.y + Math.sin(ang) * (r + 7), 3.2 * kz, 0, 7); ctx.fillStyle = accent; ctx.fill(); }
        }
        // selection: a thin ring that stays thin when you zoom in
        if (a === selected){
          if (deep){ ctx.setLineDash([6 / cam.s, 4 / cam.s]); ctx.beginPath(); ctx.arc(a.x, a.y, r + 7 / cam.s, 0, 7); ctx.strokeStyle = accent; ctx.lineWidth = 1.5 / cam.s; ctx.stroke(); ctx.setLineDash([]); }
          else { ctx.beginPath(); ctx.arc(a.x, a.y, r + 3 + 2 * kz, 0, 7); ctx.strokeStyle = accent; ctx.lineWidth = 2 * kz; ctx.stroke(); }
        }
        drawShellAtom(a, r, col, t, dimFor(a), {ink, muted, accent});
        const ch = chargeOf(a);
        if (ch){ ctx.fillStyle = ink; ctx.font = "700 12px Archivo, sans-serif"; ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.fillText((Math.abs(ch) > 1 ? Math.abs(ch) : "") + (ch > 0 ? "+" : "−"), a.x + r + 2, a.y - r + 2); }
        ctx.globalAlpha = 1;
      }
      drawNames(surface, muted);
    }
    ctx.restore();
  }
  /* One atom in Balls & sticks view, drawn like a tiny Bohr model so you can see how big it really is:
       nucleus disc with the symbol, faint rings for the inner shells (always), a bold ring for the outer shell.
     Zoom changes the detail, not the layout (the atom's size on the bench never changes):
       zoom < 1.6   rings only
       zoom >= 1.6  electron dots on the inner rings
       zoom >= 2.6  outer electrons too, and the inner dots drift slowly, like Explore (calmer) */
  const DOTS_AT = 1.6, DEEP_AT = 2.6;
  function drawShellAtom(a, r, col, t, alpha, c){
    if (cam.s >= DEEP_AT){ const [sx, sy] = toScreen(a.x, a.y); if (sx > -r * cam.s && sx < W + r * cam.s && sy > -r * cam.s && sy < H + r * cam.s) return drawExploreAtom(a, r, col, t, alpha, c); }
    const sh = el(a.sym)?.shells || [1], inner = sh.length - 1;
    const nucR = r * (a.sym === "H" ? 0.62 : 0.6), px = 1 / cam.s;   // px = one screen pixel in bench units
    // the outer shell's space, lightly tinted with the element's color
    ctx.beginPath(); ctx.arc(a.x, a.y, r, 0, 7); ctx.fillStyle = col; ctx.globalAlpha = alpha * 0.2; ctx.fill(); ctx.globalAlpha = alpha;
    // inner shells: evenly spaced between the nucleus and the outer ring
    const ringAt = (i) => nucR + (r - nucR) * (i + 1) / (inner + 1);
    ctx.strokeStyle = c.muted; ctx.lineWidth = Math.max(0.5, 0.8 * px * Math.min(cam.s, 2));
    for (let i = 0; i < inner; i++){ ctx.globalAlpha = alpha * 0.55; ctx.beginPath(); ctx.arc(a.x, a.y, ringAt(i), 0, 7); ctx.stroke(); }
    ctx.globalAlpha = alpha;
    // outer shell: bold, this is where bonding happens
    ctx.beginPath(); ctx.arc(a.x, a.y, r, 0, 7); ctx.strokeStyle = col; ctx.lineWidth = 2.2 * Math.min(1, 1.6 / cam.s); ctx.stroke();
    // electrons, only when zoomed in enough to see them (and only if this atom is on screen)
    if (cam.s >= DOTS_AT){
      const [sx, sy] = toScreen(a.x, a.y);
      if (sx > -60 && sx < W + 60 && sy > -60 && sy < H + 60){
        const dr = Math.max(0.9, 2.1 * px * Math.min(cam.s, 3));
        const drift = cam.s >= DEEP_AT && !REDUCED ? t * 0.25 : 0;
        ctx.fillStyle = css("--electron-inner");
        for (let i = 0; i < inner; i++){
          const n = sh[i], R = ringAt(i), off = drift * (i % 2 ? -1 : 1) + i * 0.4;
          // a shell's dots appear once they'd sit at least ~5 screen px apart (big shells like francium's 32 need more zoom)
          const gap = 2 * Math.PI * R / n;            // spacing between dots, in bench units
          if (gap * cam.s < 5) continue;
          const rr = Math.min(dr, gap * 0.3);
          for (let k = 0; k < n; k++){ const ang = off + k * Math.PI * 2 / n; ctx.beginPath(); ctx.arc(a.x + Math.cos(ang) * R, a.y + Math.sin(ang) * R, rr, 0, 7); ctx.fill(); }
        }
      }
    }
    // nucleus with the symbol
    ctx.beginPath(); ctx.arc(a.x, a.y, nucR, 0, 7); ctx.fillStyle = col; ctx.fill();
    ctx.fillStyle = textOn(col.startsWith("#") ? col : "#3A3F47");
    ctx.font = `700 ${a.sym === "H" ? 11 : a.sym.length > 1 ? 11 : 13}px Archivo, sans-serif`; ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.fillText(a.sym, a.x, a.y + 0.5);
  }
  const REDUCED = matchMedia("(prefers-reduced-motion: reduce)").matches;
  /* Deep zoom: the same look as Explore. A nucleus of protons (red) and neutrons (gray), thin rings,
     inner electrons slowly circling. The outer electrons stay put, because their positions ARE the bonds.
     The bench layout never changes: the atom is the same size, just drawn in more detail. */
  function drawExploreAtom(a, r, col, t, alpha, c){
    const e = el(a.sym), sh = e?.shells || [1], nSh = sh.length, px = 1 / cam.s;
    // nucleus about as big, relative to the rings, as in Explore: small for light atoms, bigger for heavy ones
    const A = (e?.z || 1) + (e?.neutrons || 0), nucR = r * (0.17 + 0.13 * Math.sqrt(A / 240));
    const ringAt = (k) => nucR + 2 + (r - nucR - 2) * (k + 1) / nSh;   // the last ring is the outer shell, at r
    ctx.globalAlpha = alpha;
    ctx.beginPath(); ctx.arc(a.x, a.y, r, 0, 7); ctx.fillStyle = css("--surface"); ctx.fill();   // a clean backdrop so bonds don't run through the atom
    ctx.lineWidth = 1 * px; ctx.strokeStyle = css("--line");
    for (let k = 0; k < nSh - 1; k++){ ctx.beginPath(); ctx.arc(a.x, a.y, ringAt(k), 0, 7); ctx.stroke(); }
    ctx.beginPath(); ctx.arc(a.x, a.y, r, 0, 7); ctx.strokeStyle = col; ctx.lineWidth = 1.6 * px; ctx.stroke();
    drawNucleus(a.sym, a.x, a.y, nucR);
    const dr = 2.8 * px;
    ctx.fillStyle = css("--electron-inner");
    for (let k = 0; k < nSh - 1; k++){
      const n = sh[k], R = ringAt(k), gap = 2 * Math.PI * R / n; if (gap * cam.s < 5) continue;
      const rot = REDUCED ? 0 : t * 0.35 / (k + 1) * (k % 2 ? -1 : 1), rr = Math.min(dr, gap * 0.3);
      for (let i = 0; i < n; i++){ const ang = rot + i * 2 * Math.PI / n; ctx.beginPath(); ctx.arc(a.x + Math.cos(ang) * R, a.y + Math.sin(ang) * R, rr, 0, 7); ctx.fill(); }
    }
    drawOuterElectrons(a, r, 3.8 * px, c.accent);
    // the symbol, small, over the nucleus (halo keeps it readable on the red/gray balls)
    // the symbol sits just above the nucleus, so the protons and neutrons stay visible
    const ly = a.y - nucR - 9 * px;
    ctx.font = `800 ${14 * px}px Archivo, sans-serif`; ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.lineJoin = "round"; ctx.lineWidth = 3.5 * px; ctx.strokeStyle = css("--surface"); ctx.strokeText(a.sym, a.x, ly);
    ctx.fillStyle = css("--ink"); ctx.fillText(a.sym, a.x, ly);
  }
  // nuclei are drawn once per element and size, then reused (redrawing ~200 balls per atom every frame would be slow)
  const nucCache = new Map();
  function drawNucleus(sym, x, y, R){
    const e = el(sym); if (!e) return;
    const devR = R * cam.s * dpr, bucket = Math.max(8, Math.min(220, Math.round(devR / 6) * 6));
    const pc = css("--proton"), nc = css("--neutron"), k = `${sym}:${bucket}:${pc}:${nc}`;
    let spr = nucCache.get(k);
    if (!spr){
      const A = e.z + e.neutrons, sz = bucket * 2 + 6, c = sz / 2, ball = Math.max(1.2, bucket / Math.sqrt(A) * 0.98);
      spr = document.createElement("canvas"); spr.width = spr.height = sz;
      const g = spr.getContext("2d");
      for (const [nx, ny, isP] of nucleusLayout(e.z, e.neutrons)){ g.beginPath(); g.arc(c + nx * bucket, c + ny * bucket, ball, 0, 7); g.fillStyle = isP ? pc : nc; g.fill(); }
      nucCache.set(k, spr); if (nucCache.size > 150) nucCache.delete(nucCache.keys().next().value);
    }
    const w = spr.width * R / bucket;   // scale the sprite so its nucleus radius = R (bench units)
    ctx.drawImage(spr, x - w / 2, y - w / 2, w, w);
  }
  /* boron's empty spot: two dashed amber circles (room for a whole pair), in the biggest gap around the atom */
  function drawSocket(a, R, kz, usedAngles){
    const taken = neighbors(a).map(o => Math.atan2(o.y - a.y, o.x - a.x)).concat(usedAngles || freeAngles(a, free(a)));
    let ang = Math.PI / 2;
    if (taken.length){
      const srt = taken.map(x => (x + Math.PI * 4) % (Math.PI * 2)).sort((p, q) => p - q);
      let best = -1;
      for (let i = 0; i < srt.length; i++){ const p = srt[i], q = i + 1 < srt.length ? srt[i + 1] : srt[0] + Math.PI * 2; if (q - p > best){ best = q - p; ang = (p + q) / 2; } }
    }
    const cx = a.x + Math.cos(ang) * R, cy = a.y + Math.sin(ang) * R, tx = -Math.sin(ang), ty = Math.cos(ang), rr = 4.2 * kz, off = 4.6 * kz;
    const warn = css("--warn");
    ctx.save(); ctx.globalAlpha *= 0.9;
    for (const sgn of [-1, 1]){
      ctx.beginPath(); ctx.arc(cx + tx * off * sgn, cy + ty * off * sgn, rr, 0, 7);
      ctx.fillStyle = `color-mix(in srgb, ${warn} 22%, transparent)`; try { ctx.fill(); } catch(_){}
      ctx.setLineDash([2 * kz, 1.6 * kz]); ctx.strokeStyle = warn; ctx.lineWidth = 1.6 * kz; ctx.stroke(); ctx.setLineDash([]);
    }
    ctx.restore();
  }
  /* spare-pair bond: an arrow from the atom that brought both electrons to the one that took them */
  function drawDativeArrow(b, accent){
    const dx = b.b.x - b.a.x, dy = b.b.y - b.a.y, d = Math.hypot(dx, dy) || 1, ux = dx / d, uy = dy / d, nx = -uy, ny = ux, kz = Math.min(1, 1.6 / cam.s);
    const sx = b.a.x + ux * size(b.a.sym), sy = b.a.y + uy * size(b.a.sym), ex = b.b.x - ux * (size(b.b.sym) + 2), ey = b.b.y - uy * (size(b.b.sym) + 2), ah = 9 * kz;
    ctx.strokeStyle = accent; ctx.lineWidth = 2.6 * kz; ctx.beginPath(); ctx.moveTo(sx, sy); ctx.lineTo(ex - ux * ah * 0.8, ey - uy * ah * 0.8); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(ex, ey); ctx.lineTo(ex - ux * ah + nx * ah * 0.6, ey - uy * ah + ny * ah * 0.6); ctx.lineTo(ex - ux * ah - nx * ah * 0.6, ey - uy * ah - ny * ah * 0.6); ctx.closePath(); ctx.fillStyle = accent; ctx.fill();
  }
  /* inner shells for Ring view: faint rings between the nucleus and the outer ring, dots once zoomed in */
  function ringInnerShells(a, nucR, R, t){
    const sh = el(a.sym)?.shells || [1], inner = sh.length - 1; if (!inner) return;
    const at = (i) => nucR + (R - nucR) * (i + 1) / (inner + 1);
    ctx.strokeStyle = css("--muted"); ctx.lineWidth = Math.max(0.5, 0.8 / cam.s * Math.min(cam.s, 2));
    const g0 = ctx.globalAlpha;
    for (let i = 0; i < inner; i++){ ctx.globalAlpha = g0 * 0.5; ctx.beginPath(); ctx.arc(a.x, a.y, at(i), 0, 7); ctx.stroke(); }
    ctx.globalAlpha = g0;
    if (cam.s < DOTS_AT) return;
    const dr = 2.2 / cam.s * Math.min(cam.s, 2.5); ctx.fillStyle = css("--electron-inner");
    for (let i = 0; i < inner; i++){
      const n = sh[i], Ri = at(i), gap = 2 * Math.PI * Ri / n; if (gap * cam.s < 5) continue;
      const rot = cam.s >= DEEP_AT && !REDUCED ? t * 0.3 / (i + 1) * (i % 2 ? -1 : 1) : i * 0.4, rr = Math.min(dr, gap * 0.3);
      for (let k = 0; k < n; k++){ const ang = rot + k * 2 * Math.PI / n; ctx.beginPath(); ctx.arc(a.x + Math.cos(ang) * Ri, a.y + Math.sin(ang) * Ri, rr, 0, 7); ctx.fill(); }
    }
  }
  /* Deep zoom: the outer electrons. Shared ones sit on the bond (a pair per handshake);
     the rest sit on the outer ring, pointing away from the bonds. Same counting as Ring view. */
  function drawOuterElectrons(a, R, dr, accent){
    const items = outerItems(a), taken = neighbors(a).map(o => Math.atan2(o.y - a.y, o.x - a.x));
    const angs = freeAnglesFrom(taken, items.length);
    const dot = (x, y, fill) => { ctx.beginPath(); ctx.arc(x, y, dr, 0, 7); ctx.fillStyle = fill; ctx.fill(); };
    items.forEach((it, i) => {
      const ang = angs[i], px = a.x + Math.cos(ang) * R, py = a.y + Math.sin(ang) * R, tx = -Math.sin(ang) * dr * 1.3, ty = Math.cos(ang) * dr * 1.3;
      if (it === "pair" || it === "got"){ dot(px + tx, py + ty, accent); dot(px - tx, py - ty, accent); }
      else if (it === "single"){
        // one electron + an empty dashed spot beside it: the hand waiting for a partner's electron
        dot(px + tx, py + ty, accent);
        ctx.beginPath(); ctx.arc(px - tx, py - ty, dr, 0, 7); ctx.setLineDash([dr * 0.8, dr * 0.8]); ctx.strokeStyle = css("--seat"); ctx.lineWidth = dr * 0.45; ctx.stroke(); ctx.setLineDash([]);
      }
      else dot(px, py, accent);
    });
    if (hasSocket(a)) drawSocket(a, R, dr / 3.4, angs);
    // shared pairs: drawn once per bond, from the lower-id atom, on the bond line where the two rings meet
    for (const b of bonds){
      if ((b.kind !== "cov" && b.kind !== "dat") || (b.a !== a && b.b !== a)) continue;
      const o = b.a === a ? b.b : b.a; if (o.id < a.id) continue;
      const dx = o.x - a.x, dy = o.y - a.y, d = Math.hypot(dx, dy) || 1, ux = dx / d, uy = dy / d, nx = -uy, ny = ux;
      const mx = a.x + ux * d / 2, my = a.y + uy * d / 2;
      for (let k = 0; k < b.order; k++){
        const off = (k - (b.order - 1) / 2) * dr * 4.5;
        dot(mx + nx * off - ux * dr * 1.3, my + ny * off - uy * dr * 1.3, accent);
        dot(mx + nx * off + ux * dr * 1.3, my + ny * off + uy * dr * 1.3, accent);
      }
    }
  }
  /* Names under atoms, so you don't have to know the symbols. Shown when there's room:
     few atoms, or zoomed in. Hydrogens get labels only when zoomed in (there are a lot of them). */
  function drawNames(surface, muted){
    const many = atoms.length > 14;
    const fs = 10.5 * Math.min(Math.max(cam.s, 1), 1.5) / cam.s;   // about 10-16 px on screen at any zoom
    ctx.font = `600 ${fs}px Archivo, sans-serif`; ctx.textAlign = "center"; ctx.textBaseline = "top";
    ctx.lineJoin = "round"; ctx.lineWidth = 3 / cam.s; ctx.strokeStyle = surface; ctx.fillStyle = muted;
    for (const a of atoms){
      if (a.sym === "*") continue;
      const isH = a.sym === "H";
      const show = a === selected || (isH ? (cam.s >= 1.6 || atoms.length <= 4) : (cam.s >= 1.25 || !many));
      if (!show) continue;
      const nm = Name(a.sym), y = a.y + size(a.sym) + (cam.s >= DOTS_AT ? 9 : 3) / cam.s + (cam.s >= DEEP_AT ? 2 : 0);
      ctx.strokeText(nm, a.x, y); ctx.fillText(nm, a.x, y);
    }
    ctx.textBaseline = "middle";
  }
  function chargeOf(a){
    if (a.charge) return a.charge;
    let c = 0;
    for (const b of bonds) if (b.kind === "ion"){ if (b.a === a) c += b.order; if (b.b === a) c -= b.order; }
    return c;
  }
  function drawRings(focusSet, dimFor, t, col){
    const list = focusSet ? atoms.filter(a => focusSet.has(a)) : atoms;
    const bl = focusSet ? bonds.filter(b => focusSet.has(b.a) || focusSet.has(b.b)) : bonds;
    // shared pairs (bond electrons) live in the overlap of the two rings
    for (const b of bl){
      if (b.kind === "ion"){
        ctx.setLineDash([3, 5]); ctx.strokeStyle = col.muted; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(b.a.x, b.a.y); ctx.lineTo(b.b.x, b.b.y); ctx.stroke(); ctx.setLineDash([]);
        continue;
      }
      const dx = b.b.x - b.a.x, dy = b.b.y - b.a.y, d = Math.hypot(dx, dy) || 1, ux = dx / d, uy = dy / d, nx = -uy, ny = ux;
      const ea = ringR(b.a.sym), eb = ringR(b.b.sym);
      const fade = focusSet && b !== zoomBond ? 0.25 : 1;
      const cx = ((b.a.x + ux * ea) + (b.b.x - ux * eb)) / 2, cy = ((b.a.y + uy * ea) + (b.b.y - uy * eb)) / 2;
      const glow = ctx.createRadialGradient(cx, cy, 0, cx, cy, 14 + 4 * b.order);
      const pulse = 0.35 + 0.15 * Math.sin(t * 2.4);
      glow.addColorStop(0, `color-mix(in srgb, ${col.accent} ${Math.round(pulse * 100)}%, transparent)`);
      try { ctx.fillStyle = glow; } catch(_) { ctx.fillStyle = col.accent; }
      ctx.globalAlpha = 0.9 * fade; ctx.beginPath(); ctx.arc(cx, cy, 14 + 4 * b.order, 0, 7); ctx.fill(); ctx.globalAlpha = fade;
      for (let k = 0; k < b.order; k++){
        const off = (k - (b.order - 1) / 2) * 9;
        for (const s of [-1, 1]){
          ctx.beginPath(); ctx.arc(cx + nx * off + ux * s * 3.2, cy + ny * off + uy * s * 3.2, 3.4, 0, 7); ctx.fillStyle = col.accent; ctx.fill();
        }
      }
      ctx.globalAlpha = 1;
    }
    for (const a of list){
      if (a.sym === "*") continue;
      const R = ringR(a.sym), e = el(a.sym), k = kindOf(a.sym);
      ctx.globalAlpha = focusSet ? 1 : dimFor(a);
      ctx.beginPath(); ctx.arc(a.x, a.y, R, 0, 7); ctx.strokeStyle = col.ink; ctx.globalAlpha *= .55; ctx.lineWidth = 1.4; ctx.stroke(); ctx.globalAlpha = focusSet ? 1 : dimFor(a);
      const nucR = a.sym === "H" ? 9 : 12, ccol = atomColor(a.sym);
      ringInnerShells(a, nucR + 2, R, t);
      if (cam.s >= DEEP_AT){
        drawNucleus(a.sym, a.x, a.y, nucR * 0.85);
        ctx.font = `800 ${14 / cam.s}px Archivo, sans-serif`; ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.lineJoin = "round"; ctx.lineWidth = 3.5 / cam.s; ctx.strokeStyle = css("--surface"); ctx.strokeText(a.sym, a.x, a.y); ctx.fillStyle = col.ink; ctx.fillText(a.sym, a.x, a.y);
      } else {
        ctx.beginPath(); ctx.arc(a.x, a.y, nucR, 0, 7); ctx.fillStyle = ccol; ctx.fill();
        ctx.fillStyle = textOn(ccol.startsWith("#") ? ccol : "#3A3F47"); ctx.font = `700 ${a.sym.length > 1 ? 10 : 11}px Archivo, sans-serif`; ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.fillText(a.sym, a.x, a.y + .5);
      }
      // electrons that are not in a shared pair
      const myBonds = bonds.filter(b => b.a === a || b.b === a);
      const taken = myBonds.map(b => { const o = b.a === a ? b.b : b.a; return Math.atan2(o.y - a.y, o.x - a.x); });
      const items = outerItems(a);
      const angs = freeAnglesFrom(taken, items.length);
      items.forEach((it, i) => {
        const ang = angs[i], px = a.x + Math.cos(ang) * R, py = a.y + Math.sin(ang) * R, tx = -Math.sin(ang), ty = Math.cos(ang);
        const dot = (x, y, fill, stroke) => { ctx.beginPath(); ctx.arc(x, y, 3.3, 0, 7); if (fill){ ctx.fillStyle = fill; ctx.fill(); } if (stroke){ ctx.strokeStyle = stroke; ctx.lineWidth = 1.6; ctx.stroke(); } };
        if (it === "pair"){ dot(px + tx * 4, py + ty * 4, css("--electron-inner")); dot(px - tx * 4, py - ty * 4, css("--electron-inner")); }
        else if (it === "got"){ dot(px + tx * 4, py + ty * 4, css("--electron-inner")); dot(px - tx * 4, py - ty * 4, col.accent, css("--proton")); }
        else if (it === "single"){ dot(px + tx * 4, py + ty * 4, col.accent); ctx.setLineDash([2, 2]); dot(px - tx * 4, py - ty * 4, null, col.seat); ctx.setLineDash([]); }
        else dot(px, py, col.accent);
      });
      if (hasSocket(a)) drawSocket(a, R, 1, angs);
      const ch = chargeOf(a);
      if (ch){ ctx.fillStyle = col.ink; ctx.font = "700 13px Archivo, sans-serif"; ctx.fillText((Math.abs(ch) > 1 ? Math.abs(ch) : "") + (ch > 0 ? "+" : "−"), a.x + R * .78, a.y - R * .78); }
      ctx.globalAlpha = 1;
    }
  }
  /* The outer electrons that are NOT in a shared pair, as a list:
     "pair" (two of its own), "single" (one, waiting for a partner), "got" (a pair completed by an electron
     a metal handed over), "dot" (a metal's electron it hasn't given away yet). Used by Ring view and deep zoom. */
  function outerItems(a){
    const e = el(a.sym), k = kindOf(a.sym), v = e.valence, items = [];
    const myBonds = bonds.filter(b => b.a === a || b.b === a);
    if (k === "metal"){
      const given = myBonds.filter(b => b.kind === "ion").reduce((s, b) => s + b.order, 0);
      for (let i = 0; i < Math.max(0, v - given); i++) items.push("dot");
    } else if (k === "noble"){
      for (let i = 0; i < v / 2; i++) items.push("pair");
    } else {
      const covUsed = myBonds.filter(b => b.kind === "cov").reduce((s, b) => s + b.order, 0);
      const got = myBonds.filter(b => b.kind === "ion").reduce((s, b) => s + b.order, 0);
      const own = Math.max(0, v - covUsed);
      const singles = Math.max(0, handsOf(a) - covUsed - got);
      const gotPairs = Math.min(got, Math.max(0, own - singles));
      const lent = myBonds.filter(b => b.kind === "dat" && b.a === a).length;   // spare pairs lent to boron
      const lonePairs = Math.max(0, Math.round((own - singles - gotPairs) / 2) - lent);
      for (let i = 0; i < lonePairs; i++) items.push("pair");
      for (let i = 0; i < gotPairs; i++) items.push("got");
      for (let i = 0; i < singles; i++) items.push("single");
    }
    return items;
  }
  // with no bond (or just one) nothing pins the directions, so spread everything evenly:
  // 3 directions = a Y (peace sign), 4 = a plus. Electrons push apart as far as they can.
  function evenAngles(taken, n){
    if (taken.length === 0) return Array.from({length: n}, (_, k) => -Math.PI / 2 + k * 2 * Math.PI / n);
    if (taken.length === 1) return Array.from({length: n}, (_, k) => taken[0] + (k + 1) * 2 * Math.PI / (n + 1));
    return null;
  }
  function freeAnglesFrom(taken, n){
    const even = evenAngles(taken, n); if (even) return even;
    const out = [];
    for (let k = 0; k < n; k++){
      let best = 0, bestD = -1;
      for (let i = 0; i < 48; i++){
        const ang = -Math.PI / 2 + i * Math.PI / 24, all = taken.concat(out);
        const d = all.length ? Math.min(...all.map(t => Math.abs(Math.atan2(Math.sin(ang - t), Math.cos(ang - t))))) : Math.PI;
        if (d > bestD + 1e-6){ bestD = d; best = ang; }
      }
      out.push(best);
    }
    return out;
  }

  // internals other modules build on (lessons, reactions, 3D). Kept small on purpose.
  const api = {setQuiet: (v) => { quiet = v; }, hooks, baseHands, neighbors, tryBond, addOrder, bondBetween, free, handsOf, kindOf, note, celebrate, fit, relax, components: () => components().map(identify),
    removeAtom, rest, undo, get historyLength(){ return history.length; }, get cam(){ return cam; }, get W(){ return W; }, get H(){ return H; }, toWorld, toScreen, isVisible: () => visible, phone: () => phone()};
  return {api, mount, show, hide, add, addMolecule, breakApart, benchable, clear, counts, setView, get atoms(){ return atoms; }, get bonds(){ return bonds; }, fillH, update, _identify: () => components().map(identify), _screenOf: (a) => { const r = cv.getBoundingClientRect(); const [x, y] = toScreen(a.x, a.y); return [r.left + x, r.top + y]; }, _status: () => $("wbStatus").textContent};
})();

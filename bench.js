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
  const shownTips = new Set();
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
  function used(a){ let u = 0; for (const b of bonds) if (b.a === a || b.b === a) u += b.order; return u; }
  const free = (a) => Math.max(0, handsOf(a) - used(a));
  function metalHappy(a){
    const g = used(a); if (!g) return false;
    const pos = (el(a.sym).ox||[]).filter(s=>s.startsWith("+")).map(Number);
    return pos.includes(g) || (!pos.length && g === handsOf(a));
  }
  const needsMore = (a) => kindOf(a.sym) === "metal" ? !metalHappy(a) : free(a) > 0;
  const size = (sym) => sym === "H" ? 13 : sym === "*" ? 6 : 19;
  const ringR = (sym) => sym === "H" ? 24 : 34;
  function rest(b){ return b.kind === "ion" ? 82 : size(b.a.sym) + size(b.b.sym) + 14; }
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
    document.addEventListener("keydown", (ev) => {
      if (!visible) return;
      if (ev.key === "Escape"){ closePop(); unzoom(); }
      if ((ev.key === "Delete" || ev.key === "Backspace") && selected && document.activeElement === document.body){ removeAtom(selected); ev.preventDefault(); }
    });
    $("wbView").querySelectorAll("button").forEach(b => b.addEventListener("click", () => setView(b.dataset.v)));
    $("wbFill").addEventListener("click", fillH);
    $("wbTidy").addEventListener("click", () => { relax(240); fit(); });
    $("wbClear").addEventListener("click", clear);
    $("wbBreak").addEventListener("click", breakApart);
    setInterval(() => { if (visible && atoms.length && !drag) renderCloud(focusInfo); }, 15000);   // rotate element facts
    $("wbRecipesBtn").addEventListener("click", toggleRecipes);
    $("wbZoomOut").addEventListener("click", unzoom);
    $("wbShowF").addEventListener("click", () => { document.body.classList.toggle("show-f"); $("wbShowF").setAttribute("aria-pressed", document.body.classList.contains("show-f")); sizeToWindow(); });
    addEventListener("resize", () => visible && sizeToWindow());
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
    visible = true; $("workbench").hidden = false; sizeToWindow(); update();
    if (!raf) raf = requestAnimationFrame(loop);
  }
  function hide(){ visible = false; $("workbench").hidden = true; cancelAnimationFrame(raf); raf = 0; closePop(); }

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
  let headHc = 62;
  const headH = () => headHc;
  const measureHead = () => { headHc = (document.querySelector(".wb-head")?.offsetHeight || 50) + 12; $("workbench")?.style.setProperty("--headh", headHc + "px"); };
  function inBounds(x, y){ const [sx, sy] = toScreen(x, y); return sx > 40 && sx < W - 40 - (W > 760 ? 330 : 0) && sy > headH() + 20 && sy < H - (W > 760 ? 60 : 150); }
  function add(sym, x, y, extra){
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
    for (let i = bonds.length - 1; i >= 0; i--) if (bonds[i].a === a || bonds[i].b === a) bonds.splice(i, 1);
    atoms.splice(atoms.indexOf(a), 1);
    if (selected === a) selected = null; if (lastTouched === a) lastTouched = atoms[atoms.length - 1] || null;
    update();
  }
  function clear(){ const bn = $("wbBanner"); if (bn) bn.hidden = true; atoms.length = 0; bonds.length = 0; selected = lastTouched = null; zoomBond = null; Object.assign(camT, {x:0, y:0, s:1}); hideTip(); closePop(); hideCard(); update(); }
  function tryBond(a, b){
    if (bondBetween(a, b)) return false;
    const ka = kindOf(a.sym), kb = kindOf(b.sym);
    if (ka === "noble" || kb === "noble"){ const n = ka === "noble" ? a : b; tipAt(n, null, `${Name(n.sym)} is already full. It has no empty hands, so it won't hold on.`); return false; }
    if (ka === "metal" && kb === "metal"){ tipAt(a, "metals", "Two metals don't hold hands one-on-one. In a lump of metal, the atoms share their loose electrons as a crowd. That crowd is why metals carry electricity."); return false; }
    if (ka === "metal" || kb === "metal"){
      const m = ka === "metal" ? a : b, n = m === a ? b : a;
      const give = Math.min(free(m), free(n));
      if (give <= 0){ tipAt(n, null, free(n) ? `${Name(m.sym)} has no more electrons to give.` : `${Name(n.sym)}'s hands are all full already.`); return false; }
      bonds.push({a: m, b: n, order: give, kind: "ion"});
      tipAt(n, "ion", `${Name(m.sym)} doesn't share. It hands ${give === 1 ? "its electron" : give + " electrons"} to ${nameOf(n.sym)}. Now one is + and one is −, and they stick together like magnets.`);
      return true;
    }
    if (!free(a) || !free(b)){ const f = free(a) ? b : a; tipAt(f, null, `${Name(f.sym)}'s ${handsOf(f) === 1 ? "only hand is" : "hands are all"} already held.`); return false; }
    bonds.push({a, b, order: 1, kind: "cov"});
    if (!shownTips.has("bond")) tipAt(b, "bond", "They're holding hands. Each atom put in one electron, and those two shared electrons are the bond. Turn on Ring view to see them sitting in the overlap.");
    return true;
  }
  function addOrder(bd){
    if (bd.kind !== "cov") return;
    if (bd.order >= 3 || !free(bd.a) || !free(bd.b)){ tipMid(bd, null, bd.order >= 3 ? "Three handshakes is the most two atoms can share." : "To add another handshake, both atoms need an empty hand."); return; }
    bd.order++;
    tipMid(bd, bd.order === 2 ? "double" : "triple", bd.order === 2
      ? "Double bond: two handshakes between the same two atoms. The second one is the weaker grip. Opening it is how ethylene links up into polyethylene."
      : "Triple bond: three handshakes. Very strong, and it packs a lot of energy, like in acetylene torches.");
    update();
  }
  function breakBond(bd, why){
    bonds.splice(bonds.indexOf(bd), 1);
    tipMid(bd, why === "pull" ? "break" : null, why === "pull"
      ? "You pulled hard enough to break the bond. Both atoms get their hands back. Heat does this in the reactor at Nexus: it shakes atoms until bonds snap."
      : "Bond broken. Both atoms get their hands back.");
    update();
  }
  function fillH(){
    const targets = atoms.filter(a => a.sym !== "H" && a.sym !== "*" && kindOf(a.sym) === "nonmetal" && free(a) > 0);
    if (!targets.length){ tipCenter("Nothing to fill. Every nonmetal atom already has its hands held."); return; }
    for (const a of targets){
      const n = free(a), angs = freeAngles(a, n);
      for (const ang of angs){
        const h = add("H", a.x + Math.cos(ang) * 46, a.y + Math.sin(ang) * 46);
        bonds.push({a, b: h, order: 1, kind: "cov"});
      }
    }
    relax(120); update();
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
  function addMolecule(m){
    if (!benchable(m)) return false;
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
  function toggleRecipes(force){ const box = $("wbRecipes"); box.hidden = force === false ? true : force === true ? false : !box.hidden; }

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
      if (match) return `Every hand is held. This is <b>${esc(match.name)}</b> ${match.formula.startsWith("(") ? esc(match.formula) : "(" + esc(match.formula) + ")"}.`;
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
    s += nonH.length ? " It can't last like this. Connect more atoms, or tap <b>Fill with H</b>." : " It can't last like this. Connect more atoms.";
    return s;
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
    $("wbStatus").querySelector("[data-dbl]")?.addEventListener("click", () => {
      const b = bonds.find(b => b.kind === "cov" && b.order < 3 && focus.comp.includes(b.a) && free(b.a) > 0 && free(b.b) > 0);
      if (b) addOrder(b);
    });
    const real = comps.filter(c => c.formula);
    $("wbChips").innerHTML = real.length > 1 ? real.map(c => `<span class="wbchip ${c.done ? "ok" : ""}">${esc(c.match?.name || c.formula)}${c.done ? " ✓" : ""}</span>`).join("") : "";
    // a molecule just got finished -> "You built it!" banner
    const doneNow = new Set(comps.filter(c => c.done && c.match).map(c => c.match.id + ":" + c.comp.map(a => a.id).sort().join(",")));
    for (const k of doneNow) if (!lastDone.has(k)){ const c = comps.find(x => x.match && k.startsWith(x.match.id + ":")); if (c && !loadingRecipe && !quiet) celebrate(c.match); }
    lastDone = doneNow;
    const almostNow = new Map();
    for (const c of comps){ const near = almostFor(c)[0]; if (near) almostNow.set(near.id + ":" + c.comp.map(a => a.id).sort().join(","), {m: near, c}); }
    for (const [k, v] of almostNow) if (!lastAlmost.has(k) && !loadingRecipe && !quiet)
      celebrate(v.m, "Almost there", v.m.name, "One more step: fill the glowing empty hands", "almost");
    lastAlmost = new Set(almostNow.keys());
    glowAtoms = new Set([...almostNow.values()].flatMap(v => v.c.open));
    $("wbBreak").disabled = !(focus && bonds.some(b => focus.comp.includes(b.a)));
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
    for (let i = bonds.length - 1; i >= 0; i--) if (set.has(bonds[i].a)) bonds.splice(i, 1);
    // pop outward from the middle so you can see every atom is loose
    const cx = f.comp.reduce((t, a) => t + a.x, 0) / f.comp.length, cy = f.comp.reduce((t, a) => t + a.y, 0) / f.comp.length;
    for (const a of f.comp){ const dx = a.x - cx, dy = a.y - cy, d = Math.hypot(dx, dy) || 1; a.vx += dx / d * 7 + (Math.random() - .5) * 2; a.vy += dy / d * 7 + (Math.random() - .5) * 2; }
    // keep the biggest atom in focus so the cloud talks about it
    const hub = f.comp.filter(a => a.sym !== "*").sort((p, q) => handsOf(q) - handsOf(p))[0]; if (hub){ selected = lastTouched = hub; }
    note(null, `All ${had} bond${had > 1 ? "s" : ""} broken. Every atom has its hands back. That's like pyrolysis heat turned all the way up: in the reactor, bonds snap a few at a time.`);
    update();
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
  function renderCloud(info){
    const box = $("wbCloud"); if (!box) return;
    if (!atoms.length){ box.hidden = true; return; }
    const fresh = lastNote && performance.now() - lastNote.t < 20000 ? lastNote.text : null;
    const ideas = ideasFor(info), facts = factsFor(info);
    let html = "";
    if (info?.done && info.match) html += `<div class="cl-title">${esc(info.match.name)} <span class="mono">${esc(info.match.formula)}</span></div>`;
    else if (info?.formula){
      const near = almostFor(info);
      html += `<div class="cl-title">${esc(info.formula)}<span class="cl-sub">${near.length ? `almost ${esc(near[0].name)}` : info.open.length ? "still building" : ""}</span></div>`;
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
    const label = info?.done && info.match ? info.match.name : nearL ? `Almost ${nearL.name}` : info?.formula || "";
    box.innerHTML = `<button class="cl-head" id="clToggle" type="button">Idea cloud${phone() ? ` <span class="cl-count">${esc(label)} · ${n} ${n === 1 ? "tip" : "tips"} ${box.classList.contains("open") ? "▾" : "▴"}</span>` : ""}</button>${html}`;
    box.hidden = false;
    $("clToggle").addEventListener("click", () => { if (phone()){ box.classList.toggle("open"); renderCloud(focusInfo); fit(); } });
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
      return `<tr><td><b>${sym}</b> × ${c[sym]}</td><td class="muted">${each}</td><td class="r">${total}</td></tr>`;
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
      <div class="dt-head"><div><span class="eyebrow">On your bench</span><h2>${esc(m ? m.name : info.formula)} ${m ? `<span class="mono muted dt-f">${esc(m.formula)}</span>` : ""}</h2>
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
    let hint = "";
    if (name === "C–C" || name === "C–H" || name === "H–C") hint = " C–C (348) is weaker than C–H (413), so heat snaps carbon chains before it strips hydrogens off.";
    return `<div class="meter"><div class="meter-top"><span>Bond strength</span><span class="mono">${e} kJ/mol · ${cmp}</span></div>
      <div class="meter-bar"><i style="width:${pct.toFixed(0)}%"></i></div>
      <div class="meter-note">${esc(name)} average.${hint}</div></div>`;
  }
  function openPop(bd){
    const p = $("wbPop"), [x, y] = toScreen((bd.a.x + bd.b.x) / 2, (bd.a.y + bd.b.y) / 2);
    const canAdd = bd.kind === "cov" && bd.order < 3 && free(bd.a) && free(bd.b);
    p.innerHTML = `<div class="small" style="margin-bottom:6px"><b>${Name(bd.a.sym)}–${Name(bd.b.sym)}</b>: ${bd.kind === "ion" ? "electron handed over" : bd.order === 1 ? "1 handshake" : bd.order + " handshakes"}</div>
      <div class="row">${bd.kind === "cov" ? `<button class="btn" data-act="more" ${canAdd ? "" : "disabled"}>+ handshake</button>` : ""}
      <button class="btn" data-act="zoom">Zoom in</button><button class="btn" data-act="break">Break</button></div>${meterHTML(bd)}`;
    p.hidden = false;
    p.style.left = Math.max(8, Math.min(W - 270, x - 130)) + "px"; p.style.top = Math.max(56, Math.min(H - p.offsetHeight - 10, y - 150)) + "px";
    p.querySelector('[data-act="more"]')?.addEventListener("click", () => { closePop(); addOrder(bd); });
    p.querySelector('[data-act="zoom"]').addEventListener("click", () => { closePop(); zoomTo(bd); });
    p.querySelector('[data-act="break"]').addEventListener("click", () => { closePop(); breakBond(bd, "click"); });
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
  function unzoom(){ if (!zoomBond) return; zoomBond = null; Object.assign(camT, {x: cam.x, y: cam.y, s: 1}); fit(); $("wbZoom").hidden = true; }
  function setView(v){ view = v; fit(); renderLegend(); $("wbView").querySelectorAll("button").forEach(b => b.setAttribute("aria-pressed", b.dataset.v === v));
    if (v !== "ring") hideTip();
    if (v === "ring") tipCenter("Ring view: each atom shows its outer ring. Dots in an overlap are shared pairs (the bonds). Dashed circles are empty hands."); }
  function fit(){
    if (!atoms.length){ Object.assign(camT, {x: 0, y: 0, s: 1}); return; }
    const xs = atoms.map(a => a.x), ys = atoms.map(a => a.y);
    const bw = Math.max(...xs) - Math.min(...xs) + 140, bh = Math.max(...ys) - Math.min(...ys) + 160;
    const side = W > 760 ? 330 : 0;   // the idea cloud sits on the right (on phones it's a drawer at the bottom)
    const left = W > 760 && !$("wbLearn").hidden ? 350 : 0;   // lesson / reaction card on the left
    const bottom = side ? 0 : ($("wbCloud").classList.contains("open") ? H * 0.55 : 130);   // phone: space the drawer + toolbar take
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
  let lastBondTap = {b: null, t: 0};
  function onDown(ev){
    ev.preventDefault();
    touchPad = ev.pointerType === "touch" ? 12 : 0;
    const [sx, sy] = pos(ev); closePop();
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
    selected = null;
    if (zoomBond) unzoom();
  }
  function onMove(ev){
    const [sx, sy] = pos(ev);
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
        const k = kindOf(a.sym);
        tipAt(a, null, `${Name(a.sym)}: ${k === "metal" ? `gives away ${used(a) ? "has given " + used(a) : "up to " + handsOf(a)} electron${handsOf(a) > 1 ? "s" : ""}` : k === "noble" ? "full, no hands" : `${handsOf(a)} hand${handsOf(a) > 1 ? "s" : ""}, ${free(a)} still empty`}. Drag to move it; drop it on the trash to remove it.`);
      }
    }
    $("wbTrash").classList.remove("hot"); hoverTrash = false;
    drag = null; update();
  }
  function onDbl(ev){
    const [sx, sy] = pos(ev); clearTimeout(pendingBondClick); closePop();
    const bd = hitBond(sx, sy) || (() => { const a = hitAtom(sx, sy); if (!a) return null; return bonds.find(b => b.a === a || b.b === a) || null; })();
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
    const [x0, y0] = toWorld(30, headH()), [x1, y1] = toWorld(W - 30 - (W > 760 ? 320 : 0), H - (W > 760 ? 70 : 150));
    for (const a of atoms){
      if (drag && drag.a === a) continue;
      if (a.tx != null){ a.x += (a.tx - a.x) * 0.1; a.y += (a.ty - a.y) * 0.1; a.vx = a.vy = 0; continue; }
      a.vx *= DAMP; a.vy *= DAMP; a.x += a.vx * dt; a.y += a.vy * dt;
      if (x1 > x0 && y1 > y0){ if (a.x < x0) a.vx += (x0 - a.x) * .05; if (a.x > x1) a.vx -= (a.x - x1) * .05; if (a.y < y0) a.vy += (y0 - a.y) * .05; if (a.y > y1) a.vy -= (a.y - y1) * .05; }
    }
  }
  function relax(n){ for (let i = 0; i < n; i++) step(1); }

  /* ---------- drawing ---------- */
  function freeAngles(a, n){
    // pick n directions far from existing bonds
    const taken = neighbors(a).map(o => Math.atan2(o.y - a.y, o.x - a.x));
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
    ctx.strokeStyle = line; ctx.globalAlpha = .45; ctx.lineWidth = 1;
    const g = 40 * cam.s, ox = (W/2 - cam.x * cam.s) % g, oy = (H/2 - cam.y * cam.s) % g;
    for (let x = ox; x < W; x += g){ ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke(); }
    for (let y = oy; y < H; y += g){ ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke(); }
    ctx.globalAlpha = 1;
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
        } else {
          const offs = b.order === 2 ? [-3.5, 3.5] : b.order === 3 ? [-6, 0, 6] : [0];
          ctx.strokeStyle = stretch > 1.6 ? css("--proton") : ink; ctx.lineWidth = 2.6;
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
        if (k === "nonmetal"){
          for (const ang of freeAngles(a, free(a))){
            const hx = a.x + Math.cos(ang) * (r + 11), hy = a.y + Math.sin(ang) * (r + 11);
            if (glowAtoms.has(a)){   // almost done: the hands that still need filling pulse
              const pulse = 0.5 + 0.5 * Math.sin(performance.now() / 260);
              ctx.beginPath(); ctx.arc(hx, hy, 7 + pulse * 3, 0, 7); ctx.fillStyle = css("--warn"); ctx.globalAlpha = 0.35 + pulse * 0.35; ctx.fill(); ctx.globalAlpha = dimFor(a);
            }
            ctx.setLineDash([2.5, 2.5]); ctx.strokeStyle = seat; ctx.lineWidth = 1.6; ctx.beginPath(); ctx.arc(hx, hy, 5.5, 0, 7); ctx.stroke(); ctx.setLineDash([]);
          }
        } else if (k === "metal"){
          const left = handsOf(a) - used(a);
          if (!metalHappy(a)) for (const ang of freeAngles(a, Math.max(0, left))){ ctx.beginPath(); ctx.arc(a.x + Math.cos(ang) * (r + 10), a.y + Math.sin(ang) * (r + 10), 4, 0, 7); ctx.fillStyle = accent; ctx.fill(); }
        }
        if (a === selected){ ctx.beginPath(); ctx.arc(a.x, a.y, r + 4, 0, 7); ctx.strokeStyle = accent; ctx.lineWidth = 2; ctx.stroke(); }
        ctx.beginPath(); ctx.arc(a.x, a.y, r, 0, 7); ctx.fillStyle = col; ctx.fill();
        ctx.fillStyle = textOn(col.startsWith("#") ? col : "#3A3F47"); ctx.font = `700 ${a.sym === "H" ? 12 : a.sym.length > 1 ? 13 : 15}px Archivo, sans-serif`; ctx.textAlign = "center"; ctx.textBaseline = "middle";
        ctx.fillText(a.sym, a.x, a.y + 0.5);
        const ch = chargeOf(a);
        if (ch){ ctx.fillStyle = ink; ctx.font = "700 12px Archivo, sans-serif"; ctx.fillText((Math.abs(ch) > 1 ? Math.abs(ch) : "") + (ch > 0 ? "+" : "−"), a.x + r + 2, a.y - r + 2); }
        ctx.globalAlpha = 1;
      }
    }
    ctx.restore();
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
      ctx.beginPath(); ctx.arc(a.x, a.y, nucR, 0, 7); ctx.fillStyle = ccol; ctx.fill();
      ctx.fillStyle = textOn(ccol.startsWith("#") ? ccol : "#3A3F47"); ctx.font = `700 ${a.sym.length > 1 ? 10 : 11}px Archivo, sans-serif`; ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.fillText(a.sym, a.x, a.y + .5);
      // electrons that are not in a shared pair
      const myBonds = bonds.filter(b => b.a === a || b.b === a);
      const taken = myBonds.map(b => { const o = b.a === a ? b.b : b.a; return Math.atan2(o.y - a.y, o.x - a.x); });
      const v = e.valence;
      const items = [];   // "pair" | "single" | "given" (gave away) | "got" (received pair partner)
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
        const lonePairs = Math.max(0, Math.round((own - singles - gotPairs) / 2));
        for (let i = 0; i < lonePairs; i++) items.push("pair");
        for (let i = 0; i < gotPairs; i++) items.push("got");
        for (let i = 0; i < singles; i++) items.push("single");
      }
      const angs = freeAnglesFrom(taken, items.length);
      items.forEach((it, i) => {
        const ang = angs[i], px = a.x + Math.cos(ang) * R, py = a.y + Math.sin(ang) * R, tx = -Math.sin(ang), ty = Math.cos(ang);
        const dot = (x, y, fill, stroke) => { ctx.beginPath(); ctx.arc(x, y, 3.3, 0, 7); if (fill){ ctx.fillStyle = fill; ctx.fill(); } if (stroke){ ctx.strokeStyle = stroke; ctx.lineWidth = 1.6; ctx.stroke(); } };
        if (it === "pair"){ dot(px + tx * 4, py + ty * 4, css("--electron-inner")); dot(px - tx * 4, py - ty * 4, css("--electron-inner")); }
        else if (it === "got"){ dot(px + tx * 4, py + ty * 4, css("--electron-inner")); dot(px - tx * 4, py - ty * 4, col.accent, css("--proton")); }
        else if (it === "single"){ dot(px + tx * 4, py + ty * 4, col.accent); ctx.setLineDash([2, 2]); dot(px - tx * 4, py - ty * 4, null, col.seat); ctx.setLineDash([]); }
        else dot(px, py, col.accent);
      });
      const ch = chargeOf(a);
      if (ch){ ctx.fillStyle = col.ink; ctx.font = "700 13px Archivo, sans-serif"; ctx.fillText((Math.abs(ch) > 1 ? Math.abs(ch) : "") + (ch > 0 ? "+" : "−"), a.x + R * .78, a.y - R * .78); }
      ctx.globalAlpha = 1;
    }
  }
  function freeAnglesFrom(taken, n){
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
    removeAtom, rest, get cam(){ return cam; }, get W(){ return W; }, get H(){ return H; }, toWorld, toScreen, isVisible: () => visible, phone: () => phone()};
  return {api, mount, show, hide, add, addMolecule, breakApart, benchable, clear, counts, setView, get atoms(){ return atoms; }, get bonds(){ return bonds; }, fillH, update, _identify: () => components().map(identify), _screenOf: (a) => { const r = cv.getBoundingClientRect(); const [x, y] = toScreen(a.x, a.y); return [r.left + x, r.top + y]; }, _status: () => $("wbStatus").textContent};
})();

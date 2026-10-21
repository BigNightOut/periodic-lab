/* =====================================================================================
   Learn: guided Lessons and step-by-step Reactions on top of the workbench.
   Loaded only when first needed (see index.html), so the bench itself stays light.

   Lessons   data/lessons.json  units -> lessons -> steps. Each step's `goal` is the full bench state
             to reach (atoms: min counts; bonds: [A, B, order, count]). We check after every bench change.
   Reactions data/reactions.json. When the finished molecules on the bench match a reaction's ingredients,
             a React button appears. Playing it: bonds break, atoms glide to new spots, new bonds form,
             one story step at a time.
   Uses Bench.api (bench.js) and page helpers from index.html: S, esc, $, CAT.
   ===================================================================================== */
window.Learn = (() => {
  const B = Bench.api;
  let lessons = null, reactions = null;
  let active = null;        // {lesson, step, passed:Set}
  let playing = null;       // {r, phase, atoms, ...}
  const done = new Set(JSON.parse(safeGet("plab.lessonsDone") || "[]"));
  function safeGet(k){ try { return localStorage.getItem(k); } catch(_){ return null; } }
  function safeSet(k, v){ try { localStorage.setItem(k, v); } catch(_){} }
  const mol = (id) => S.mols.find(m => m.id === id);

  async function loadData(){
    if (!lessons) lessons = await fetch("data/lessons.json").then(r => r.ok ? r.json() : {units: []}).catch(() => ({units: []}));
    if (!reactions) reactions = await fetch("data/reactions.json").then(r => r.ok ? r.json() : []).catch(() => []);
  }

  /* ---------------- bench state in the same shape as lesson goals ---------------- */
  function benchState(){
    const atoms = {}, bonds = {};
    for (const a of Bench.atoms) if (a.sym !== "*") atoms[a.sym] = (atoms[a.sym] || 0) + 1;
    for (const b of Bench.bonds){
      if (b.a.sym === "*" || b.b.sym === "*") continue;
      const [p, q] = [b.a.sym, b.b.sym].sort(), k = `${p}|${q}|${b.order}`;
      bonds[k] = (bonds[k] || 0) + 1;
    }
    return {atoms, bonds};
  }
  function goalMet(goal, exact){
    const st = benchState();
    for (const [s, n] of Object.entries(goal.atoms || {})) if ((st.atoms[s] || 0) < n) return false;
    const want = {};
    for (const [p0, q0, o, n] of goal.bonds || []){ const [p, q] = [p0, q0].sort(), k = `${p}|${q}|${o}`; want[k] = (want[k] || 0) + n; if ((st.bonds[k] || 0) < n) return false; }
    if (exact){
      // the finished molecule must be exactly the target: no extra atoms, no extra bonds
      for (const [s, n] of Object.entries(st.atoms)) if (n !== (goal.atoms?.[s] || 0)) return false;
      for (const [k, n] of Object.entries(st.bonds)) if (n !== (want[k] || 0)) return false;
    }
    return true;
  }
  function missingFor(goal){
    const st = benchState(), atoms = {}, bonds = [];
    for (const [s, n] of Object.entries(goal.atoms || {})) if ((st.atoms[s] || 0) < n) atoms[s] = n - (st.atoms[s] || 0);
    for (const [p0, q0, o, n] of goal.bonds || []){ const [p, q] = [p0, q0].sort(), have = st.bonds[`${p}|${q}|${o}`] || 0; if (have < n) bonds.push([p, q, o, n - have]); }
    return {atoms, bonds};
  }

  /* ---------------- "Show me": do the current step for you ---------------- */
  function doStep(goal){
    const miss = missingFor(goal);
    for (const [s, n] of Object.entries(miss.atoms)) for (let i = 0; i < n; i++) Bench.add(s);
    for (const [p, q, o, n] of miss.bonds){
      for (let k = 0; k < n; k++){
        // prefer upgrading an existing lower-order bond between the right pair, skipping atoms that
        // already have a multiple bond (so benzene-style rings alternate single/double)
        const same = (b) => [b.a.sym, b.b.sym].sort().join() === [p, q].sort().join();
        const hasMulti = (a) => Bench.bonds.some(b => (b.a === a || b.b === a) && b.order > 1);
        let up = Bench.bonds.find(b => b.kind === "cov" && b.order < o && same(b) && B.free(b.a) && B.free(b.b) && !hasMulti(b.a) && !hasMulti(b.b))
              || Bench.bonds.find(b => b.kind === "cov" && b.order < o && same(b) && B.free(b.a) && B.free(b.b));
        if (up && o > 1){ while (up.order < o && B.free(up.a) && B.free(up.b)) B.addOrder(up); continue; }
        const need = (sym) => B.kindOf(sym) === "metal" ? 1 : o;
        const nb = (a) => B.neighbors(a).filter(x => x.sym !== "H" && x.sym !== "*").length;
        const pairs = [];
        for (const a of Bench.atoms) if (a.sym === p && B.free(a) >= need(p))
          for (const b of Bench.atoms) if (b !== a && b.sym === q && !B.bondBetween(a, b) && B.free(b) >= need(q)){
            const common = B.neighbors(a).some(x => B.neighbors(b).includes(x));   // never make a 3-atom ring
            if (common) continue;
            // grow chains from the ends: loose atoms first, then chain ends; joining two ends closes a ring
            const score = (nb(a) === 1 ? 0 : nb(a) === 0 ? 1 : 3) + (nb(b) === 0 ? 0 : nb(b) === 1 ? 2 : 4) + Math.hypot(a.x - b.x, a.y - b.y) / 1000;
            pairs.push([score, a, b]);
          }
        pairs.sort((x, y) => x[0] - y[0]);
        let made = false;
        for (const [, a, b] of pairs.slice(0, 1)){
          b.x = a.x + 40 + Math.random() * 10; b.y = a.y + (Math.random() - .5) * 30;
          if (B.tryBond(a, b)){ const bd = B.bondBetween(a, b); while (bd.kind === "cov" && bd.order < o && B.free(a) && B.free(b)) B.addOrder(bd); made = true; break; }
        }
        if (!made) break;
      }
    }
    B.relax(40); B.fit(); Bench.update();
  }

  /* ---------------- the side card (lessons + reactions share it) ---------------- */
  function card(html){ const c = $("wbLearn"); c.innerHTML = html; c.hidden = false; return c; }
  function closeCard(){ const c = $("wbLearn"); if (c){ c.hidden = true; c.innerHTML = ""; } }

  /* ---------------- lessons ---------------- */
  async function openLessons(){
    await loadData();
    const box = $("wbDrawer");
    const units = lessons.units || [];
    if (!units.length){ box.innerHTML = `<div class="row" style="justify-content:space-between"><b>Lessons</b><button class="btn" data-close>Close</button></div><p class="small muted">Lessons are on their way in the next update.</p>`; box.hidden = false; box.querySelector("[data-close]").onclick = () => box.hidden = true; return; }
    const total = units.reduce((t, u) => t + u.lessons.length, 0), got = units.reduce((t, u) => t + u.lessons.filter(l => done.has(l.id)).length, 0);
    box.innerHTML = `<div class="row" style="justify-content:space-between"><b>Lessons</b><button class="btn" data-close>Close</button></div>
      <p class="small muted" style="margin:4px 0 8px">Build real molecules one step at a time. Easy at the top, harder as you go. ${got} of ${total} done.</p>` +
      units.map((u, ui) => `<div class="unit"><div class="eyebrow">Unit ${ui + 1}: ${esc(u.title)}</div><p class="small muted" style="margin:2px 0 6px">${esc(u.idea || "")}</p>
        <div class="lessonlist">${u.lessons.map(l => `<button data-l="${l.id}" class="${done.has(l.id) ? "done" : ""}"><span>${done.has(l.id) ? "✓" : "○"}</span>${esc(l.title)}</button>`).join("")}</div></div>`).join("");
    box.hidden = false;
    box.querySelector("[data-close]").onclick = () => box.hidden = true;
    box.querySelectorAll("[data-l]").forEach(b => b.onclick = () => { box.hidden = true; startLesson(b.dataset.l); });
  }
  function findLesson(id){ for (const u of lessons.units) for (const l of u.lessons) if (l.id === id) return {u, l}; return null; }
  function nextLessonId(id){ const all = lessons.units.flatMap(u => u.lessons); const i = all.findIndex(l => l.id === id); return all[i + 1]?.id; }
  function startLesson(id){
    const f = findLesson(id); if (!f) return;
    stopReaction();
    Bench.clear();
    active = {lesson: f.l, unit: f.u, step: 0, finished: false};
    renderLesson();
  }
  function renderLesson(){
    if (!active) return;
    const l = active.lesson, i = active.step, st = l.steps[i];
    if (active.finished) return renderLessonDone();
    card(`<div class="lc-top"><span class="eyebrow">Lesson · ${esc(active.unit.title)}</span><button class="linkbtn" data-quit>Quit</button></div>
      <h3 class="lc-title">${esc(l.title)}</h3>
      ${i === 0 ? `<p class="small muted lc-intro">${esc(l.intro)}</p>` : ""}
      <ol class="lc-steps">${l.steps.map((s, k) => `<li class="${k < i ? "ok" : k === i ? "now" : ""}">${k < i ? "✓ " : ""}${k === i ? `<b>${esc(s.say)}</b><div class="lc-why">${esc(s.why)}</div>` : esc(s.say)}</li>`).join("")}</ol>
      <div class="row"><button class="btn" data-show>Show me</button><span class="small muted">Step ${i + 1} of ${l.steps.length}</span></div>`);
    const c = $("wbLearn");
    c.querySelector("[data-quit]").onclick = quitLesson;
    c.querySelector("[data-show]").onclick = () => doStep(st.goal);
    const cur = c.querySelector("li.now"); cur?.scrollIntoView({block: "nearest"});
  }
  function quitLesson(){ active = null; closeCard(); }
  function checkLesson(){
    if (!active || active.finished) return;
    const l = active.lesson;
    let moved = false;
    while (active.step < l.steps.length && goalMet(l.steps[active.step].goal, active.step === l.steps.length - 1)){ active.step++; moved = true; }
    if (active.step >= l.steps.length){
      active.finished = true;
      done.add(l.id); safeSet("plab.lessonsDone", JSON.stringify([...done]));
      const m = mol(l.target); if (m) B.celebrate(m);
      renderLessonDone(); return;
    }
    if (moved) renderLesson();
  }
  function renderLessonDone(){
    const l = active.lesson, m = mol(l.target), next = nextLessonId(l.id);
    const photo = (typeof photoFor === "function") ? photoFor("molecules", l.target) : "";
    card(`<div class="lc-top"><span class="eyebrow">Lesson complete</span><button class="linkbtn" data-quit>Close</button></div>
      <h3 class="lc-title">You built ${esc(m?.name || l.title)}</h3>
      ${photo}
      <p>${esc(l.done)}</p>
      <div class="xb"><div class="eyebrow">Explain it back</div><p class="xb-q">${esc(l.check.q)}</p>
        <textarea id="xbIn" rows="3" placeholder="Say it in your own words..."></textarea>
        <div class="row"><button class="btn primary" data-check>Check my answer</button><button class="linkbtn" data-reveal>Show the answer</button></div>
        <div class="xb-out" id="xbOut"></div></div>
      <div class="row" style="margin-top:10px">${next ? `<button class="btn" data-next>Next lesson</button>` : ""}<button class="btn" data-all>All lessons</button></div>`);
    const c = $("wbLearn");
    c.querySelector("[data-quit]").onclick = quitLesson;
    c.querySelector("[data-all]").onclick = () => { quitLesson(); openLessons(); };
    if (next) c.querySelector("[data-next]").onclick = () => startLesson(next);
    c.querySelector("[data-reveal]").onclick = () => reveal(l);
    c.querySelector("[data-check]").onclick = () => grade(l);
  }
  function reveal(l, extra){
    $("xbOut").innerHTML = `${extra || ""}<div class="xb-ans"><b>A good answer:</b> ${esc(l.check.answer)}</div>
      <div class="small muted">Did yours cover these?</div><ul class="xb-pts">${l.check.points.map(p => `<li>${esc(p)}</li>`).join("")}</ul>`;
  }
  /* Explain-it-back grading: Claude checks the answer when this page runs inside Claude (sample capability).
     Anywhere else (the GitHub app), you compare against the model answer yourself. */
  let samplePromise = null;
  function getSample(){ if (!samplePromise) samplePromise = (window.claude?.use ? window.claude.use("sample") : Promise.resolve(null)).catch(() => null); return samplePromise; }
  async function grade(l){
    const ans = $("xbIn").value.trim(), out = $("xbOut");
    if (!ans){ out.innerHTML = `<p class="small muted">Type your answer first, even a rough one.</p>`; return; }
    const sample = await getSample();
    if (!sample){ reveal(l, `<p class="small muted">Compare yours with this:</p>`); return; }
    out.innerHTML = `<p class="small muted">Checking...</p>`;
    const prompt = `You are a friendly chemistry tutor for an adult beginner. Grade his explanation in plain, middle-school words. Use the "hands" picture (atoms have hands; a bond is holding hands; a stable molecule has every hand held).
Question: ${l.check.q}
Model answer: ${l.check.answer}
Key points a good answer covers: ${l.check.points.map((p, i) => `(${i + 1}) ${p}`).join(" ")}
His answer: """${ans.slice(0, 1500)}"""
Reply with only JSON: {"verdict":"got it"|"almost"|"not yet","right":["short phrase of what he got right"],"missed":["short phrase of a key point he missed or got wrong"],"fix":"one or two sentences correcting the specific wrong or missing part, directly, no hedging"}`;
    try {
      const r = await sample.json(prompt, {modelTier: "quick"});
      const v = String(r.verdict || "").toLowerCase();
      out.innerHTML = `<div class="xb-verdict ${v === "got it" ? "ok" : v === "almost" ? "mid" : "no"}">${esc(r.verdict || "")}</div>
        ${(r.right || []).length ? `<div class="small"><b>Right:</b> ${r.right.map(esc).join("; ")}</div>` : ""}
        ${(r.missed || []).length ? `<div class="small"><b>Missed:</b> ${r.missed.map(esc).join("; ")}</div>` : ""}
        ${r.fix ? `<p class="small">${esc(r.fix)}</p>` : ""}<button class="linkbtn" id="xbShow">Show the model answer</button>`;
      $("xbShow").onclick = () => reveal(l, out.innerHTML.replace(/<button[^>]*xbShow[^>]*>.*?<\/button>/, ""));
    } catch(e){
      reveal(l, `<p class="small muted">${e?.code === "not_granted" ? "Claude wasn't allowed to check it." : "Couldn't reach Claude just now."} Compare yours with this:</p>`);
    }
  }

  /* ---------------- reactions ---------------- */
  // which reactions could run with what's finished on the bench right now
  function available(comps){
    if (!reactions) return [];
    const have = {};
    for (const c of comps){
      if (!c.done) {
        // lone metal atoms (Na, Fe) count as their metal
        if (c.comp.length === 1 && B.kindOf(c.comp[0].sym) === "metal"){ const id = S.mols.find(m => m.lattice?.style === "metal" && m.counts[c.comp[0].sym] && Object.keys(m.counts).length === 1)?.id; if (id) have[id] = (have[id] || 0) + 1; }
        continue;
      }
      if (c.match) have[c.match.id] = (have[c.match.id] || 0) + 1;
    }
    return reactions.filter(r => r.reactants.every(([id, n]) => (have[id] || 0) >= n));
  }
  function onBenchChange(comps){
    if (active) checkLesson();
    if (playing) return;
    const av = available(comps), btn = $("wbReact");
    if (!btn) return;
    btn.hidden = !av.length;
    if (av.length){ btn.textContent = `React: ${av[0].name}`; btn.onclick = () => playReaction(av[0]); }
  }
  async function openReactions(){
    await loadData();
    const box = $("wbDrawer");
    const lv = {1: "Simple", 2: "Everyday", 3: "Industry and fuels", 4: "Advanced"};
    const byLevel = {};
    for (const r of reactions) (byLevel[r.level || 2] ||= []).push(r);
    box.innerHTML = `<div class="row" style="justify-content:space-between"><b>Reactions</b><button class="btn" data-close>Close</button></div>
      <p class="small muted" style="margin:4px 0 8px">Pick one to put its ingredients on the bench, then press <b>React</b> and step through it. Or build the ingredients yourself and the React button lights up.</p>` +
      Object.keys(byLevel).sort().map(k => `<div class="eyebrow" style="margin:10px 0 4px">${lv[k] || "More"}</div><div class="rxlist">${byLevel[k].map(r => `<button data-rx="${r.id}"><b>${esc(r.name)}</b><span class="mono small">${esc(r.equation)}</span><span class="small muted">${esc(r.energy)}</span></button>`).join("")}</div>`).join("");
    box.hidden = false;
    box.querySelector("[data-close]").onclick = () => box.hidden = true;
    box.querySelectorAll("[data-rx]").forEach(b => b.onclick = () => { box.hidden = true; loadReaction(reactions.find(r => r.id === b.dataset.rx)); });
  }
  function loadReaction(r){
    quitLesson(); stopReaction();
    Bench.clear();
    for (const [id, n] of r.reactants){ const m = mol(id); for (let i = 0; i < n; i++){ if (m.lattice?.style === "metal") Bench.add(Object.keys(m.counts)[0]); else Bench.addMolecule(m); } }
    B.fit(); Bench.update();
    card(`<div class="lc-top"><span class="eyebrow">Reaction</span><button class="linkbtn" data-quit>Close</button></div>
      <h3 class="lc-title">${esc(r.name)}</h3><div class="mono rx-eq">${esc(r.equation)}</div>
      <p class="small">The ingredients are on the bench. Press <b>React</b> to watch the bonds break and re-form.</p>
      <div class="row"><button class="btn primary" data-go>React</button></div>`);
    $("wbLearn").querySelector("[data-quit]").onclick = () => { stopReaction(); closeCard(); };
    $("wbLearn").querySelector("[data-go]").onclick = () => playReaction(r);
  }
  // Pick bench atoms for each reactant copy, plan where each product atom goes, then step through.
  function playReaction(r){
    quitLesson();
    const comps = B.components();
    const used = new Set(), reactAtoms = [];
    for (const [id, n] of r.reactants){
      let k = 0;
      for (const c of comps){
        if (k >= n) break;
        const isMetal = mol(id).lattice?.style === "metal";
        const ok = isMetal ? (c.comp.length === 1 && c.comp[0].sym === Object.keys(mol(id).counts)[0]) : (c.done && c.match?.id === id);
        if (ok && !c.comp.some(a => used.has(a))){ c.comp.forEach(a => { used.add(a); reactAtoms.push(a); }); k++; }
      }
    }
    // product slots laid out left to right around the reactants' center
    const cx = reactAtoms.reduce((t, a) => t + a.x, 0) / reactAtoms.length, cy = reactAtoms.reduce((t, a) => t + a.y, 0) / reactAtoms.length;
    const slots = [], prodBonds = [], ghosts = [];
    const prods = r.products.flatMap(([id, n]) => Array.from({length: n}, () => mol(id)));
    const widths = prods.map(m => m.atoms ? (Math.max(...m.atoms.map(a => a[1])) - Math.min(...m.atoms.map(a => a[1]))) * 40 + 90 : 90 * Object.values(m.counts).reduce((a, b) => a + b, 0) / 2 + 40);
    const totalW = widths.reduce((a, b) => a + b, 0);
    let x0 = cx - totalW / 2;
    prods.forEach((m, pi) => {
      const mid = x0 + widths[pi] / 2; x0 += widths[pi];
      const row = (pi % 2) * 30 - 15;
      if (m.atoms){
        const xs = m.atoms.map(a => a[1]), ys = m.atoms.map(a => a[2]), mx = (Math.min(...xs) + Math.max(...xs)) / 2, my = (Math.min(...ys) + Math.max(...ys)) / 2;
        const base = slots.length, map = {};
        const sum = m.atoms.map(() => 0); for (const [i, j, o] of m.bonds){ sum[i] += o; sum[j] += o; }
        m.atoms.forEach((a, i) => { if (a[0] === "*") return; map[i] = slots.length; slots.push({sym: a[0], x: mid + (a[1] - mx) * 40, y: cy + row + (a[2] - my) * 40, hands: sum[i] !== B.baseHands(a[0]) ? sum[i] : null, charge: a[3] || 0}); });
        for (const [i, j, o] of m.bonds){
          if (map[i] != null && map[j] != null) prodBonds.push([map[i], map[j], o, "cov"]);
          else { const g = map[i] == null ? i : j, to = map[i] == null ? map[j] : map[i]; ghosts.push({x: mid + (m.atoms[g][1] - mx) * 40, y: cy + row + (m.atoms[g][2] - my) * 40, to}); }
        }
      } else {
        // ionic formula unit: metals on top row, nonmetals below; each metal hands electrons to the nonmetals
        const syms = Object.keys(m.counts), metal = syms.find(s => B.kindOf(s) === "metal"), non = syms.find(s => s !== metal);
        const ms = [], ns = [];
        for (let i = 0; i < m.counts[metal]; i++){ ms.push(slots.length); slots.push({sym: metal, x: mid + (i - (m.counts[metal] - 1) / 2) * 80, y: cy + row - 40}); }
        for (let i = 0; i < m.counts[non]; i++){ ns.push(slots.length); slots.push({sym: non, x: mid + (i - (m.counts[non] - 1) / 2) * 80, y: cy + row + 40}); }
        prodBonds.push(["ionic", ms, ns]);
      }
    });
    // match each slot to the nearest unused reactant atom of the same element
    const free = new Set(reactAtoms), assign = [];
    for (const sl of slots){
      let best = null, bd = 1e9;
      for (const a of free) if (a.sym === sl.sym){ const d = Math.hypot(a.x - sl.x, a.y - sl.y); if (d < bd){ bd = d; best = a; } }
      if (!best){ Bench.api.note(null, "This reaction's atoms don't line up with what's on the bench."); return; }
      free.delete(best); assign.push(best);
    }
    playing = {r, phase: 0, reactAtoms, slots, assign, prodBonds, ghosts};
    B.setQuiet(true);
    $("wbReact").hidden = true;
    renderReactionStep();
  }
  function renderReactionStep(){
    const p = playing, r = p.r, n = r.story.length, k = p.phase;
    const heat = /gives off|releases/i.test(r.energy) ? "out" : /needs|takes/i.test(r.energy) ? "in" : "";
    card(`<div class="lc-top"><span class="eyebrow">Reaction · step ${Math.min(k + 1, n)} of ${n}</span><button class="linkbtn" data-quit>Stop</button></div>
      <h3 class="lc-title">${esc(r.name)}</h3><div class="mono rx-eq">${esc(r.equation)}</div>
      <ol class="lc-steps">${r.story.map((s, i) => `<li class="${i < k ? "ok" : i === k ? "now" : ""}">${i === k ? `<b>${esc(s)}</b>` : esc(s)}</li>`).join("")}</ol>
      ${k >= n - 1 ? `<p class="small"><b>Energy:</b> ${esc(r.energy)}${r.dH ? ` (${esc(r.dH)})` : ""}.</p>${r.everyday ? `<p class="small"><b>Where you see it:</b> ${esc(r.everyday)}</p>` : ""}
        ${r.lens?.nexus ? `<p class="small lenstxt nexus"><b>Nexus:</b> ${esc(r.lens.nexus)}</p>` : ""}${r.lens?.rocket ? `<p class="small lenstxt rocket"><b>Rockets:</b> ${esc(r.lens.rocket)}</p>` : ""}` : ""}
      <div class="row">${k < n - 1 ? `<button class="btn primary" data-next>Next</button>` : `<button class="btn" data-again>Play again</button>`}</div>`);
    const c = $("wbLearn");
    c.querySelector("[data-quit]").onclick = () => { stopReaction(); closeCard(); };
    c.querySelector("[data-next]")?.addEventListener("click", () => { p.phase++; runPhase(); renderReactionStep(); });
    c.querySelector("[data-again]")?.addEventListener("click", () => { const r0 = p.r; stopReaction(); loadReaction(r0); });
    if (k === 0) runPhase();
    $("workbench").classList.toggle("heat-in", heat === "in" && k === 0);
    $("workbench").classList.toggle("heat-out", heat === "out" && k === n - 1);
  }
  // phase 0: bonds in the ingredients break. middle phases: atoms glide to their new places. last: new bonds form.
  function runPhase(){
    const p = playing, n = p.r.story.length;
    if (p.phase === 0){
      const set = new Set(p.reactAtoms);
      for (let i = Bench.bonds.length - 1; i >= 0; i--) if (set.has(Bench.bonds[i].a)) Bench.bonds.splice(i, 1);
      for (const a of p.reactAtoms){ a.vx += (Math.random() - .5) * 6; a.vy += (Math.random() - .5) * 6; }
    } else if (p.phase < n - 1 || n <= 2){
      p.assign.forEach((a, i) => { a.tx = p.slots[i].x; a.ty = p.slots[i].y; });
    }
    if (p.phase === n - 1){
      p.assign.forEach((a, i) => { a.tx = p.slots[i].x; a.ty = p.slots[i].y; });
      setTimeout(() => {
        for (const pb of p.prodBonds){
          if (pb[0] === "ionic"){ const [, ms, ns] = pb; for (const mi of ms) for (const ni of ns){ const a = p.assign[mi], b = p.assign[ni]; const g = Math.min(B.free(a), B.free(b)); if (g > 0) Bench.bonds.push({a, b, order: g, kind: "ion"}); } }
          else { const [i, j, o] = pb; Bench.bonds.push({a: p.assign[i], b: p.assign[j], order: o, kind: "cov"}); }
        }
        // each atom now counts its hands the way the product does (CO's carbon, charged N in N2O4...)
        p.assign.forEach((a, i) => { const sl = p.slots[i]; delete a.hands; delete a.charge; if (sl.hands != null) a.hands = sl.hands; if (sl.charge) a.charge = sl.charge; });
        for (const g of p.ghosts){ const at = Bench.add("*", g.x, g.y); Bench.bonds.push({a: p.assign[g.to], b: at, order: 1, kind: "cov"}); }
        setTimeout(() => { for (const a of p.assign){ a.tx = a.ty = null; } B.fit(); Bench.update(); B.celebrate(null, "Reaction complete", p.r.name, p.r.equation); B.setQuiet(false); }, 500);
        Bench.update();
      }, 700);
    }
    Bench.update();
  }
  function stopReaction(){
    if (!playing) return;
    for (const a of Bench.atoms){ a.tx = a.ty = null; }
    playing = null; B.setQuiet(false); $("workbench").classList.remove("heat-in", "heat-out");
  }

  B.hooks.push(onBenchChange);
  loadData().then(() => Bench.update());
  return {openLessons, openReactions, startLesson, loadReaction};
})();

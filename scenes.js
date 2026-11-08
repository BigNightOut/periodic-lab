/* =====================================================================================
   "See it in action": short step-by-step scenes for elements we've covered, drawn in the
   SAME atom style as the bench (nucleus with symbol, faint inner rings, bold outer ring,
   electron dots, dashed empty hands) so they read as a continuation of what you build.

   How it's built (so you can add one):
     SCENES[id] = {title, steps: [{cap, dur}], take, draw(g, k, p, t, c)}
       k = step index, p = 0..1 eased progress through that step's animation,
       t = seconds since opening (for idle motion), c = theme colors.
     Everything is drawn in an 800 x 500 box and scaled to fit the screen.
   Loaded only the first time you open a scene (index.html -> openScene).
   ===================================================================================== */
window.Scenes = (() => {
  const $ = (id) => document.getElementById(id);
  const VW = 800, VH = 500;
  const REDUCED = matchMedia("(prefers-reduced-motion: reduce)").matches;
  let st = null;

  /* ---------- small math helpers ---------- */
  const clamp01 = (x) => Math.max(0, Math.min(1, x));
  const ease = (p) => p < 0.5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) / 2;
  const lerp = (a, b, p) => a + (b - a) * p;
  const mixP = (A, B, p) => [lerp(A[0], B[0], p), lerp(A[1], B[1], p)];
  const sub = (p, a, b) => clamp01((p - a) / (b - a));          // part of a step: progress between a and b
  function along(path, p){                                       // point at fraction p along a polyline
    const seg = []; let L = 0;
    for (let i = 1; i < path.length; i++){ const d = Math.hypot(path[i][0] - path[i - 1][0], path[i][1] - path[i - 1][1]); seg.push(d); L += d; }
    let s = clamp01(p) * L;
    for (let i = 0; i < seg.length; i++){ if (s <= seg[i] || i === seg.length - 1){ const r = seg[i] ? Math.min(1, s / seg[i]) : 0; return mixP(path[i], path[i + 1], r); } s -= seg[i]; }
    return path[path.length - 1];
  }
  const colors = () => ({ink: css("--ink"), muted: css("--muted"), line: css("--line"), accent: css("--accent"), inner: css("--electron-inner"),
    seat: css("--seat"), warn: css("--warn"), proton: css("--proton"), surface: css("--surface"), bg: css("--bg"), good: css("--good") || "#2E9E6B"});

  /* ---------- drawing kit: the bench's atom look ---------- */
  function dot(g, x, y, r, fill){ g.beginPath(); g.arc(x, y, r, 0, 7); g.fillStyle = fill; g.fill(); }
  function dashed(g, x, y, r, stroke, w = 1.6){ g.beginPath(); g.arc(x, y, r, 0, 7); g.setLineDash([2.5, 2.2]); g.strokeStyle = stroke; g.lineWidth = w; g.stroke(); g.setLineDash([]); }
  function text(g, s, x, y, o = {}){
    g.font = `${o.w || 600} ${o.size || 13}px ${o.mono ? "ui-monospace, monospace" : "Archivo, system-ui, sans-serif"}`;
    g.textAlign = o.align || "center"; g.textBaseline = o.base || "middle";
    if (o.halo){ g.lineJoin = "round"; g.lineWidth = 4; g.strokeStyle = o.halo; g.strokeText(s, x, y); }
    g.fillStyle = o.color || "#000"; g.fillText(s, x, y);
  }
  function arrow(g, x1, y1, x2, y2, color, w = 2.5, head = 10){
    const a = Math.atan2(y2 - y1, x2 - x1);
    g.strokeStyle = color; g.lineWidth = w; g.beginPath(); g.moveTo(x1, y1); g.lineTo(x2 - Math.cos(a) * head * 0.7, y2 - Math.sin(a) * head * 0.7); g.stroke();
    g.beginPath(); g.moveTo(x2, y2); g.lineTo(x2 - Math.cos(a - 0.45) * head, y2 - Math.sin(a - 0.45) * head); g.lineTo(x2 - Math.cos(a + 0.45) * head, y2 - Math.sin(a + 0.45) * head); g.closePath(); g.fillStyle = color; g.fill();
  }
  function rrect(g, x, y, w, h, r){ g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r); g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath(); }
  /* one atom.
       o.r       outer-ring radius (atom size)
       o.outer   outer electrons: a number (spread evenly) or an array of angles; [] for none
       o.hands   angles of empty hands (dashed spots on the ring)
       o.ion     outer shell gone: nucleus + inner shells only, with a + sign
       o.ringAlpha  fade the outer ring (0 = gone)
       o.spin    rotate inner electrons (slowly, like Explore)
       o.label   name under the atom */
  function atom(g, c, x, y, sym, o = {}){
    const e = S.bySym[sym], col = atomColor(sym), r = o.r ?? 26, sh = e.shells, inner = sh.length - 1;
    const nucR = r * (sym === "H" ? 0.55 : 0.48), base = (o.alpha ?? 1) * g.globalAlpha, ra = o.ringAlpha ?? (o.ion ? 0 : 1);   // respects a fade set by the caller
    const ringAt = (i) => nucR + (r - nucR) * (i + 1) / (inner + 1);
    g.save(); g.globalAlpha = base;
    if (o.glow){ g.beginPath(); g.arc(x, y, r + 10, 0, 7); g.fillStyle = `color-mix(in srgb, ${o.glow} 25%, transparent)`; try { g.fill(); } catch(_){} }
    if (ra > 0){ g.globalAlpha = base * 0.18 * ra; g.beginPath(); g.arc(x, y, r, 0, 7); g.fillStyle = col; g.fill(); g.globalAlpha = base; }
    // inner shells with their electrons
    for (let i = 0; i < inner; i++){
      const R = ringAt(i); g.globalAlpha = base * 0.55; g.strokeStyle = c.muted; g.lineWidth = 1; g.beginPath(); g.arc(x, y, R, 0, 7); g.stroke(); g.globalAlpha = base;
      const n = sh[i], gap = 2 * Math.PI * R / n; if (gap < 4.5) continue;
      const rot = (o.spin || 0) * (i % 2 ? -1 : 1) / (i + 1) + i * 0.4, dr = Math.min(2.4, gap * 0.3);
      for (let k = 0; k < n; k++){ const a = rot + k * 2 * Math.PI / n; dot(g, x + Math.cos(a) * R, y + Math.sin(a) * R, dr, c.inner); }
    }
    // outer shell
    if (ra > 0){
      g.globalAlpha = base * ra; g.beginPath(); g.arc(x, y, r, 0, 7); g.strokeStyle = `color-mix(in srgb, ${col} 70%, ${c.ink})`; g.lineWidth = 2.4; g.stroke();   // a touch of ink so pale atoms (helium) still show their ring
      const v = o.outer ?? e.valence, angs = Array.isArray(v) ? v : Array.from({length: v}, (_, k) => -Math.PI / 2 + k * 2 * Math.PI / Math.max(1, v));
      for (const a of angs) dot(g, x + Math.cos(a) * r, y + Math.sin(a) * r, 3.6, c.accent);
      for (const a of (o.hands || [])) dashed(g, x + Math.cos(a) * r, y + Math.sin(a) * r, 3.8, c.seat);
      g.globalAlpha = base;
    }
    // nucleus + symbol
    g.beginPath(); g.arc(x, y, nucR, 0, 7); g.fillStyle = col; g.fill();
    text(g, sym, x, y + 0.5, {w: 800, size: Math.max(9, Math.round(nucR * (sym.length > 1 ? 0.9 : 1.1))), color: textOn(col.startsWith("#") ? col : "#3A3F47")});
    if (o.ion && o.plus !== false) text(g, "+", x + nucR + 7, y - nucR - 4, {w: 800, size: 16, color: c.ink});
    if (o.label) text(g, o.label, x, y + r + 13, {size: 12, color: c.muted, halo: c.bg});
    g.restore();
  }
  /* a shared pair sitting on a bond line (2 dots), optionally missing one (the hole) */
  function pairOn(g, c, A, B, o = {}){
    const dx = B[0] - A[0], dy = B[1] - A[1], d = Math.hypot(dx, dy) || 1, ux = dx / d, uy = dy / d;
    const m = [(A[0] + B[0]) / 2 + (o.shift || 0) * ux, (A[1] + B[1]) / 2 + (o.shift || 0) * uy];
    const p1 = [m[0] - ux * 4.5, m[1] - uy * 4.5], p2 = [m[0] + ux * 4.5, m[1] + uy * 4.5];
    if (o.missing){
      g.beginPath(); g.arc(p2[0], p2[1], 9, 0, 7); g.fillStyle = `color-mix(in srgb, ${c.warn} ${Math.round(18 + 12 * (o.pulse || 0))}%, transparent)`; try { g.fill(); } catch(_){}
      dashed(g, p2[0], p2[1], 3.8, c.warn, 1.8);
      dot(g, p1[0], p1[1], 3.4, c.accent);
    } else { dot(g, p1[0], p1[1], 3.4, c.accent); dot(g, p2[0], p2[1], 3.4, c.accent); }
    return {p1, p2};
  }
  function line(g, A, B, color, w = 2, dash){ if (dash) g.setLineDash(dash); g.strokeStyle = color; g.lineWidth = w; g.beginPath(); g.moveTo(A[0], A[1]); g.lineTo(B[0], B[1]); g.stroke(); g.setLineDash([]); }

  /* =====================================================================================
     SCENES
     ===================================================================================== */
  const SCENES = {};

  /* ---------- Lithium: inside a phone battery ---------- */
  SCENES.battery = (() => {
    const A = [200, 272], B = [600, 332];                 // lithium's spot in graphite, and in the metal oxide
    const WIRE = [[200, 248], [200, 200], [200, 120], [330, 120], [470, 120], [600, 120], [600, 200], [600, 308]];
    const extra = [[140, 392], [262, 392]];               // other lithium atoms waiting their turn
    function stage(g, c, k, p){
      // case + electrolyte
      rrect(g, 60, 200, 680, 262, 18); g.fillStyle = `color-mix(in srgb, ${c.accent} 6%, ${c.surface})`; g.fill(); g.strokeStyle = c.line; g.lineWidth = 1.5; g.stroke();
      // graphite: layers of carbon
      rrect(g, 80, 214, 240, 234, 8); g.fillStyle = `color-mix(in srgb, ${c.muted} 10%, transparent)`; g.fill();
      for (const y of [236, 308, 356, 428]) for (let x = 96; x <= 304; x += 22){ dot(g, x, y, 6.5, atomColor("C")); }
      // metal oxide: cobalt + oxygen
      rrect(g, 480, 214, 240, 234, 8); g.fillStyle = `color-mix(in srgb, ${c.proton} 8%, transparent)`; g.fill();
      let i = 0; for (const y of [236, 284, 380, 428]) for (let x = 496; x <= 704; x += 26){ dot(g, x, y, (i++ % 2) ? 6 : 7.5, atomColor((i % 2) ? "Co" : "O")); }
      // separator
      line(g, [400, 214], [400, 448], c.muted, 2, [6, 6]);
      // wire + device
      g.strokeStyle = c.muted; g.lineWidth = 3; g.beginPath(); WIRE.slice(1, -1).forEach(([x, y], j) => j ? g.lineTo(x, y) : g.moveTo(x, y)); g.stroke();
      const busy = (k === 1 && p > 0.3 && p < 0.7) || (k === 5 && p > 0.3 && p < 0.7);
      rrect(g, 330, 88, 140, 64, 10); g.fillStyle = busy ? `color-mix(in srgb, ${c.warn} 30%, ${c.surface})` : c.surface; g.fill(); g.strokeStyle = c.ink; g.lineWidth = 1.5; g.stroke();
      text(g, k === 5 ? "Charger" : "Phone chips", 400, 114, {w: 750, size: 15, color: c.ink});
      text(g, k === 5 ? "(wall power)" : busy ? "powered!" : "", 400, 134, {size: 11.5, color: c.muted});
      text(g, "Graphite", 200, 480, {w: 700, size: 13, color: c.ink}); text(g, "Separator", 400, 480, {size: 12, color: c.muted}); text(g, "Metal oxide", 600, 480, {w: 700, size: 13, color: c.ink});
      for (const [x, y] of extra) atom(g, c, x, y, "Li", {r: 18, outer: [-Math.PI / 2], alpha: 0.75});
    }
    return {
      title: "Inside a phone battery",
      steps: [
        {cap: "A charged battery. Lithium atoms are parked between the layers of graphite (left). Each one has a single loose outer electron (the blue dot on its ring). It's barely held: the 2 inner electrons shield it from lithium's 3 protons."},
        {cap: "The phone turns on. The metal oxide (right) pulls on electrons much harder than lithium holds them. The separator (dashed line) blocks electrons, so the loose electron takes the only path: out through the wire and the phone's chips. That flow is the power.", dur: 2600},
        {cap: "Left behind is a lithium ion (Li⁺): just the nucleus and the inner shell of 2. With its outer shell gone, it's much smaller. It's positive (+) because it's missing an electron."},
        {cap: "The ion is pulled toward the electron now waiting on the right (opposite charges attract). It swims through the liquid and slips through the separator: ions can pass, electrons can't.", dur: 2200},
        {cap: "Back together inside the metal oxide, and the lithium is whole again. The energy was spent in the phone along the way. Billions of atoms doing this is your battery draining."},
        {cap: "Charging runs it backward. The charger, running on wall power, pushes the electron back through the wire into the graphite, and the ion follows it home. Like rolling a ball back up a hill so it can roll down again.", dur: 2800},
      ],
      take: "Lithium's loose electron takes the long way (the wire, powering the phone) while the leftover ion takes the shortcut inside the battery.",
      draw(g, k, p, t, c){
        stage(g, c, k, p);
        const spin = REDUCED ? 0 : t * 0.6;
        if (k === 0) atom(g, c, ...A, "Li", {r: 24, outer: [-Math.PI / 2], spin, glow: c.accent});
        if (k === 1){
          atom(g, c, ...A, "Li", {r: 24, outer: [], spin, ringAlpha: 1});
          const e = along(WIRE, p); dot(g, e[0], e[1], 5.5, c.accent); g.strokeStyle = c.ink; g.lineWidth = 1; g.stroke();
          if (p < 0.25) arrow(g, 228, 250, 228, 200, c.accent, 2, 9);
        }
        if (k === 2){ atom(g, c, ...A, "Li", {r: 24, ion: true, ringAlpha: 1 - p, spin}); dot(g, WIRE[7][0], WIRE[7][1], 5.5, c.accent); text(g, "waiting electron", WIRE[7][0] + 60, WIRE[7][1] - 10, {size: 11.5, color: c.muted, halo: c.bg}); }
        if (k === 3){
          const q = mixP(A, B, p); q[1] -= Math.sin(Math.PI * p) * 40;
          atom(g, c, ...q, "Li", {r: 24, ion: true, spin}); dot(g, WIRE[7][0], WIRE[7][1], 5.5, c.accent);
        }
        if (k === 4){ atom(g, c, ...B, "Li", {r: 24, outer: [-Math.PI / 2], ringAlpha: p, spin, glow: p > 0.6 ? c.good : null}); }
        if (k === 5){
          const e = along(WIRE.slice().reverse(), p), q = mixP(B, A, ease(sub(p, 0.12, 1))); q[1] -= Math.sin(Math.PI * sub(p, 0.12, 1)) * 40;
          const home = p > 0.97;
          atom(g, c, ...q, "Li", home ? {r: 24, outer: [-Math.PI / 2], spin} : {r: 24, ion: true, spin});
          if (!home) dot(g, e[0], e[1], 5.5, c.accent);
        }
      },
    };
  })();

  /* ---------- Helium: pushing fuel on Falcon 9 ---------- */
  SCENES.heliumTank = (() => {
    const TANK = {x: 300, y: 40, w: 200, h: 430};
    const rnd = (i) => { const s = Math.sin(i * 127.1 + 311.7) * 43758.5453; return s - Math.floor(s); };
    const He = Array.from({length: 14}, (_, i) => [325 + rnd(i) * 150, 0.1 + rnd(i + 50) * 0.8]);   // x, height fraction in the empty space
    const PIPE = [[220, 238], [262, 238], [262, 66], [318, 66]];
    function o2(g, c, x, y, r = 8){ line(g, [x - r, y - 1.5], [x + r, y - 1.5], c.ink, 1.4); line(g, [x - r, y + 1.5], [x + r, y + 1.5], c.ink, 1.4); dot(g, x - r, y, r, atomColor("O")); dot(g, x + r, y, r, atomColor("O")); text(g, "O", x - r, y + .5, {w: 800, size: 9, color: textOn(atomColor("O"))}); text(g, "O", x + r, y + .5, {w: 800, size: 9, color: textOn(atomColor("O"))}); }
    return {
      title: "Pushing fuel on Falcon 9",
      steps: [
        {cap: "Falcon 9's oxygen tank. Liquid oxygen, at −183 °C, sits at the bottom, with an empty space above it."},
        {cap: "The engine drinks the oxygen fast, so the level drops. That empty space has to be refilled, or the tank walls sag and the pumps start sucking gas instead of liquid.", dur: 2400},
        {cap: "Helium from high-pressure bottles flows in to fill the space. On Falcon 9, those bottles actually sit inside the cold oxygen tank, which lets them hold more.", dur: 2600},
        {cap: "Zoom in: helium's only shell holds 2 electrons, and it has 2. No empty hands, so it can't give, share, or take. Even sitting on pure oxygen, which makes most things burn, it can't react."},
        {cap: "Helium atoms zip around and bump into everything, like air in a bike tire. All those bumps push down on the liquid and shove the oxygen into the engine's pumps."},
        {cap: "A twist: Starship skips helium. It warms a little of its own oxygen and methane into gas and pushes with that. That's called autogenous pressurization (autogenous means self-made). No helium bottles means fewer parts that can fail."},
      ],
      take: "A full outer shell means helium never reacts, so it's the safest gas to push rocket fuel with.",
      draw(g, k, p, t, c){
        const level = k === 0 ? 175 : k === 1 ? lerp(175, 320, ease(p)) : 320;
        // tank
        rrect(g, TANK.x, TANK.y, TANK.w, TANK.h, 34); g.fillStyle = c.surface; g.fill();
        g.save(); rrect(g, TANK.x, TANK.y, TANK.w, TANK.h, 34); g.clip();
        g.fillStyle = "rgba(110,160,255,.28)"; g.fillRect(TANK.x, level, TANK.w, TANK.y + TANK.h - level);
        for (let y = level + 26; y < TANK.y + TANK.h - 12; y += 34) for (let x = 330 + ((y / 34) % 2) * 18; x < 480; x += 42) o2(g, c, x, y);
        // the empty space: helium (or, in Starship's case, its own gases)
        const amp = k >= 4 ? 7 : 2.5, sp = REDUCED ? 0 : (k >= 4 ? 3.2 : 1.2);
        for (let i = 0; i < He.length; i++){
          const [hx, hf] = He[i], hy = TANK.y + 28 + hf * (level - TANK.y - 56);
          const jx = hx + Math.sin(t * sp + i * 1.7) * amp, jy = hy + Math.cos(t * sp * 1.3 + i) * amp;
          if (k === 5){ const a = clamp01(p * 1.4); atom(g, c, jx, jy, "He", {r: 11, alpha: 1 - a}); if (a > 0) o2(g, c, jx, jy, 6); continue; }
          if (k < 2) continue;
          if (k > 2){ atom(g, c, jx, jy, "He", {r: 11}); continue; }
          // step 3: atoms arrive one after another through the pipe
          const f = p * He.length, n = Math.floor(f);
          if (i < n) atom(g, c, jx, jy, "He", {r: 11});
          else if (i === n){ const q = along(PIPE.concat([[jx, jy]]), f - n); atom(g, c, q[0], q[1], "He", {r: 11}); }
        }
        g.restore();
        rrect(g, TANK.x, TANK.y, TANK.w, TANK.h, 34); g.strokeStyle = c.ink; g.lineWidth = 2.2; g.stroke();
        text(g, "Liquid oxygen", 400, Math.min(455, level + 16), {w: 700, size: 12, color: c.ink, halo: c.surface});
        // sagging walls warning (step 2)
        if (k === 1 && p > 0.4){ g.strokeStyle = c.proton; g.lineWidth = 2.5; g.setLineDash([5, 4]);
          g.beginPath(); g.moveTo(TANK.x + 4, 70); g.quadraticCurveTo(TANK.x + 26, (70 + level) / 2, TANK.x + 4, level); g.stroke();
          g.beginPath(); g.moveTo(TANK.x + TANK.w - 4, 70); g.quadraticCurveTo(TANK.x + TANK.w - 26, (70 + level) / 2, TANK.x + TANK.w - 4, level); g.stroke(); g.setLineDash([]);
          text(g, "walls sag", TANK.x + TANK.w + 46, (70 + level) / 2, {w: 700, size: 13, color: c.proton}); }
        // bottle + pipe
        if (k < 5){
          g.strokeStyle = c.muted; g.lineWidth = 4; g.beginPath(); PIPE.forEach(([x, y], j) => j ? g.lineTo(x, y) : g.moveTo(x, y)); g.stroke();
          rrect(g, 110, 204, 112, 70, 30); g.fillStyle = c.surface; g.fill(); g.strokeStyle = c.ink; g.lineWidth = 2; g.stroke();
          for (let i = 0; i < 5; i++) atom(g, c, 132 + i * 17, 239 + (i % 2 ? 9 : -9), "He", {r: 8, outer: [], alpha: k >= 2 ? 0.55 : 1});
          text(g, "Helium bottle", 166, 292, {w: 700, size: 12, color: c.ink});
        }
        // engine outlet
        arrow(g, 400, 470, 400, 496, c.muted, 3, 9); text(g, "to the engine", 470, 486, {size: 12, color: c.muted});
        // pushing arrows
        if (k === 4) for (const x of [345, 400, 455]){ const bob = REDUCED ? 0 : Math.sin(t * 4 + x) * 3; arrow(g, x, level - 40 + bob, x, level - 8 + bob, c.accent, 3, 10); }
        // zoom bubble
        if (k === 3 || k === 4){
          const a = k === 3 ? ease(clamp01(p * 1.6)) : 1, bx = 650, by = 190;
          g.save(); g.globalAlpha = a;
          line(g, [470, 110], [bx - 88, by - 40], c.muted, 1.2, [4, 4]);
          g.beginPath(); g.arc(bx, by, 112, 0, 7); g.fillStyle = c.surface; g.fill(); g.strokeStyle = c.line; g.lineWidth = 2; g.stroke();
          atom(g, c, bx, by - 34, "He", {r: 38, outer: [-Math.PI / 2 - 0.25, -Math.PI / 2 + 0.25], spin: t * 0.3});
          text(g, "Helium: 2 of 2. Full.", bx, by + 22, {w: 750, size: 13.5, color: c.ink});
          text(g, "No empty hands.", bx, by + 40, {size: 12.5, color: c.muted});
          o2(g, c, bx, by + 72, 10); text(g, "oxygen: nothing to grab", bx, by + 96, {size: 11.5, color: c.muted});
          g.restore();
        }
        if (k === 5){
          const bx = 650, by = 200;
          g.beginPath(); g.arc(bx, by, 112, 0, 7); g.fillStyle = c.surface; g.fill(); g.strokeStyle = c.line; g.lineWidth = 2; g.stroke();
          text(g, "Starship", bx, by - 62, {w: 800, size: 17, color: c.ink});
          o2(g, c, bx - 34, by - 18, 9); text(g, "oxygen gas", bx - 34, by + 4, {size: 11.5, color: c.muted});
          atom(g, c, bx + 40, by - 18, "C", {r: 13, outer: [], alpha: 0.95}); text(g, "methane gas", bx + 40, by + 4, {size: 11.5, color: c.muted});
          text(g, "Its own fuel, warmed", bx, by + 40, {w: 650, size: 12.5, color: c.ink});
          text(g, "into gas, does the pushing.", bx, by + 58, {w: 650, size: 12.5, color: c.ink});
        }
      },
    };
  })();

  /* ---------- Beryllium: light and stiff (Webb's mirrors) ---------- */
  SCENES.beMirror = (() => {
    const lat = [];   // a small chunk of metal: hexagon-packed atoms
    for (let j = 0; j < 6; j++) for (let i = 0; i < 8; i++) lat.push([i * 46 + (j % 2) * 23, j * 40]);
    const roam = Array.from({length: 40}, (_, i) => [Math.sin(i * 12.9898) * 0.5 + 0.5, Math.sin(i * 78.233) * 0.5 + 0.5, 0.6 + (i % 5) * 0.15]);
    function chunk(g, c, ox, oy, s, t, squeeze = 0, crack = 0){
      const w = 7 * 46 + 23, h = 5 * 40;
      for (const [x, y] of lat){
        const yy = y * (1 - squeeze * (1 - y / h) * 0.04);   // barely moves when pushed
        atom(g, c, ox + x * s, oy + yy * s, "Be", {r: 17 * s, ion: true, plus: false});
      }
      // roaming electrons: the shared glue
      for (const [fx, fy, sp] of roam){
        const x = ox + ((fx + (REDUCED ? 0 : t * 0.05 * sp)) % 1) * w * s, y = oy + (fy + Math.sin(t * sp + fx * 9) * 0.04) * h * s;
        dot(g, x, y, 3.4 * Math.max(0.7, s), c.accent);
      }
      if (crack > 0){
        g.strokeStyle = c.proton; g.lineWidth = 3; g.beginPath();
        const pts = [[0.35, -0.08], [0.42, 0.2], [0.37, 0.42], [0.47, 0.66], [0.43, 0.9]];
        pts.slice(0, 1 + Math.round(crack * (pts.length - 1))).forEach(([fx, fy], i) => { const X = ox + fx * w * s, Y = oy + fy * h * s; i ? g.lineTo(X, Y) : g.moveTo(X, Y); }); g.stroke();
      }
    }
    function bars(g, c, x, y, p){
      const rows = [["Stiffness", 287, 200, "GPa"], ["Weight (same size)", 1.85, 7.85, "g/cm³"]];
      rows.forEach(([lab, be, st], i) => {
        const yy = y + i * 110, max = Math.max(be, st), L = 220;
        text(g, lab, x, yy, {w: 750, size: 14, align: "left", color: c.ink});
        g.fillStyle = atomColor("Be"); g.fillRect(x, yy + 14, L * be / max * p, 18); text(g, "Beryllium", x + L * be / max * p + 6, yy + 23, {size: 12, align: "left", color: c.ink});
        g.fillStyle = c.muted; g.fillRect(x, yy + 40, L * st / max * p, 18); text(g, "Steel", x + L * st / max * p + 6, yy + 49, {size: 12, align: "left", color: c.ink});
      });
      g.globalAlpha = clamp01(p * 2 - 1);
      text(g, "Stiffness for its weight:", x, y + 240, {w: 650, size: 14, align: "left", color: c.ink});
      text(g, "about 6× steel", x, y + 264, {w: 850, size: 22, align: "left", color: c.accent});
      g.globalAlpha = 1;
    }
    function mirror(g, c, cx, cy, R, p){
      // 18 hexagons in a honeycomb (the center one is a hole in Webb)
      const cells = []; for (let q = -2; q <= 2; q++) for (let r = -2; r <= 2; r++){ const s = -q - r; if (Math.max(Math.abs(q), Math.abs(r), Math.abs(s)) <= 2 && !(q === 0 && r === 0)) cells.push([q, r]); }
      cells.slice(0, 18).forEach(([q, r], i) => {
        const x = cx + R * 1.5 * q, y = cy + R * Math.sqrt(3) * (r + q / 2);
        g.globalAlpha = clamp01(p * 18 - i); g.beginPath();
        for (let a = 0; a < 6; a++){ const ang = a * Math.PI / 3; g.lineTo(x + Math.cos(ang) * R * 0.94, y + Math.sin(ang) * R * 0.94); }
        g.closePath(); g.fillStyle = "#D8B552"; g.fill(); g.strokeStyle = "#9C7A22"; g.lineWidth = 1.2; g.stroke();
      });
      g.globalAlpha = 1;
    }
    return {
      title: "Light and stiff: Webb's mirrors",
      steps: [
        {cap: "Beryllium has 4 protons: 2 electrons in the inner shell and 2 in the outer one. It's one of the smallest, lightest atoms that forms a solid metal."},
        {cap: "In a chunk of beryllium, each atom lets its 2 outer electrons roam. Those roaming electrons (blue) are a shared glue that holds the tightly packed atoms together. That's what makes it a metal."},
        {cap: "The atoms are tiny and packed very close, and the glue is strong for their size. Push on it and it barely bends. That's what stiff means: it doesn't bend under load."},
        {cap: "Compared with steel, beryllium is about 1.4 times stiffer and weighs about a quarter as much. Pound for pound, that makes it roughly 6 times stiffer.", dur: 2200},
        {cap: "That's why the James Webb Space Telescope's 18 mirror segments are beryllium, coated in a thin layer of gold. At about −233 °C in space, beryllium barely warps, so the mirror keeps its exact shape.", dur: 2200},
        {cap: "The catch: it's brittle, so a hard hit cracks it instead of denting it. And its dust is toxic to breathe. So it's only used where nothing else will do."},
      ],
      take: "Small atoms, packed tight, held together by strong electron glue: light and stiff.",
      draw(g, k, p, t, c){
        const spin = REDUCED ? 0 : t * 0.5;
        if (k === 0){ atom(g, c, 400, 230, "Be", {r: 72, spin, label: "Beryllium"}); text(g, "2 inner + 2 outer electrons", 400, 345, {size: 13, color: c.muted}); }
        if (k === 1){ g.globalAlpha = 1 - clamp01(p * 2); atom(g, c, 400, 230, "Be", {r: 72, spin}); g.globalAlpha = clamp01(p * 2 - 0.4); chunk(g, c, 228, 140, 1, t); g.globalAlpha = 1; }
        if (k === 2){
          chunk(g, c, 228, 140, 1, t, ease(p));
          const press = ease(sub(p, 0, 0.6)); arrow(g, 400, 40 + press * 40, 400, 110 + press * 18, c.proton, 5, 16);
          text(g, "push", 440, 70 + press * 30, {w: 750, size: 14, color: c.proton, align: "left"});
          if (p > 0.6) text(g, "barely moves", 400, 400, {w: 750, size: 15, color: c.ink});
        }
        if (k === 3){ chunk(g, c, 50, 150, 0.62, t); bars(g, c, 470, 110, ease(p)); }
        if (k === 4){ atom(g, c, 150, 250, "Be", {r: 44, spin, label: "Beryllium"}); mirror(g, c, 480, 245, 46, p); text(g, "Webb's mirror: 18 beryllium segments, gold-coated", 480, 470, {w: 650, size: 13, color: c.ink}); }
        if (k === 5){ chunk(g, c, 228, 140, 1, t, 0, ease(p)); text(g, "brittle: it cracks", 300, 410, {w: 750, size: 14, color: c.proton}); text(g, "toxic dust", 520, 410, {w: 750, size: 14, color: c.proton}); }
      },
    };
  })();

  /* ---------- Boron + silicon: the hole in a solar panel ---------- */
  SCENES.solarHole = (() => {
    const COLS = 6, ROWS = 4, X0 = 150, Y0 = 112, DX = 100, DY = 92;
    const P = (i, j) => [X0 + i * DX, Y0 + j * DY];
    const bonds = [];
    for (let j = 0; j < ROWS; j++) for (let i = 0; i < COLS; i++){ if (i + 1 < COLS) bonds.push([i, j, i + 1, j]); if (j + 1 < ROWS) bonds.push([i, j, i, j + 1]); }
    const bid = (a, b, c2, d) => bonds.findIndex(x => (x[0] === a && x[1] === b && x[2] === c2 && x[3] === d) || (x[0] === c2 && x[1] === d && x[2] === a && x[3] === b));
    const HOLES = [bid(2, 1, 3, 1), bid(3, 1, 4, 1), bid(4, 1, 5, 1), bid(5, 1, 5, 2)];   // the path the hole takes
    const symAt = (i, j, k) => (k >= 1 && i === 2 && j === 1) ? "B" : (k >= 4 && ((i === 4 && j === 2) || (i === 5 && j === 0) || (i === 3 && j === 3))) ? "P" : (k >= 4 && i === 1 && j === 3) ? "B" : "Si";
    return {
      title: "The hole in a solar panel",
      steps: [
        {cap: "Pure silicon. Each silicon has 4 outer electrons and shares one with each of its 4 neighbors. Every handshake (line) holds 2 electrons, so every atom ends up with a full 8."},
        {cap: "Swap one silicon for boron. Boron has only 3 outer electrons, so one of its 4 handshakes is missing an electron. That gap is called a hole (the amber spot)."},
        {cap: "An electron from the handshake next door hops into the hole. Now that handshake is the one missing an electron. The hole moved.", dur: 2000},
        {cap: "Hop after hop, the hole travels through the crystal, like an empty seat passed down a row. Electrons step one way and the hole moves the other. Moving charge is current.", dur: 3000},
        {cap: "A real panel has two layers. The boron side (left) is full of holes. The other side has phosphorus, which has 5 outer electrons: one more than it needs, so each carries a spare."},
        {cap: "Sunlight knocks electrons loose. Where the two layers meet, freed electrons get pushed toward the phosphorus side and holes toward the boron side. Connect a wire and the electrons flow around it: that's solar power.", dur: 2800},
      ],
      take: "Boron's missing electron makes a hole that can move. Holes and electrons moving in opposite directions are how a solar panel makes current.",
      draw(g, k, p, t, c){
        const pulse = REDUCED ? 0.5 : 0.5 + 0.5 * Math.sin(t * 4);
        if (k >= 4){   // the two layers
          g.fillStyle = `color-mix(in srgb, ${c.warn} 10%, transparent)`; g.fillRect(90, 60, 310, 400);
          g.fillStyle = `color-mix(in srgb, ${c.good} 10%, transparent)`; g.fillRect(400, 60, 310, 400);
          text(g, "Boron side: holes", 245, 50, {w: 750, size: 13.5, color: c.ink}); text(g, "Phosphorus side: spare electrons", 555, 50, {w: 750, size: 13.5, color: c.ink});
          line(g, [400, 60], [400, 460], c.muted, 1.5, [5, 5]);
        }
        // which bond is missing an electron right now (and the electron in flight)
        let holeAt = -1, hop = null;
        if (k === 1) holeAt = HOLES[0];
        if (k === 2){ holeAt = p < 0.98 ? HOLES[0] : HOLES[1]; hop = {from: HOLES[1], to: HOLES[0], q: ease(p)}; }
        if (k === 3){ const m = Math.min(1, Math.floor(p * 2)), q = ease((p * 2) % 1 || (p >= 1 ? 1 : 0)); holeAt = HOLES[1 + m]; hop = p < 1 ? {from: HOLES[2 + m], to: HOLES[1 + m], q} : null; if (p >= 1) holeAt = HOLES[3]; }
        const holes = k >= 4 ? [bid(2, 1, 3, 1), bid(1, 2, 1, 3)] : [];   // one hole next to each boron
        bonds.forEach((b, n) => {
          const A = P(b[0], b[1]), B = P(b[2], b[3]);
          line(g, A, B, c.line, 3);
          const missing = n === holeAt || holes.includes(n) || (hop && n === hop.from);
          const r = pairOn(g, c, A, B, {missing, pulse});
          if (hop && n === hop.from){ const dest = (() => { const b2 = bonds[hop.to]; const A2 = P(b2[0], b2[1]), B2 = P(b2[2], b2[3]); const dx = B2[0] - A2[0], dy = B2[1] - A2[1], d = Math.hypot(dx, dy); return [(A2[0] + B2[0]) / 2 + dx / d * 4.5, (A2[1] + B2[1]) / 2 + dy / d * 4.5]; })();
            const q = mixP(r.p2, dest, hop.q); dot(g, q[0], q[1], 3.8, c.accent); }
        });
        for (let j = 0; j < ROWS; j++) for (let i = 0; i < COLS; i++){
          const sym = symAt(i, j, k), [x, y] = P(i, j);
          atom(g, c, x, y, sym, {r: 22, outer: [], glow: (k === 1 && sym === "B") ? c.warn : null});
          if (sym === "P"){ const bob = REDUCED ? 0 : Math.sin(t * 3 + i) * 2; dot(g, x + 18, y - 26 + bob, 3.8, c.accent); }
        }
        if (k === 1) text(g, "boron: only 3 to share", P(2, 1)[0], P(2, 1)[1] - 40, {w: 700, size: 12.5, color: c.ink, halo: c.bg});
        if (k === 3 && p > 0.5){ arrow(g, 480, 430, 640, 430, c.warn, 3, 11); text(g, "the hole moves this way", 400, 430, {w: 700, size: 12.5, color: c.warn, align: "right"}); arrow(g, 640, 466, 480, 466, c.accent, 3, 11); text(g, "electrons step this way", 400, 466, {w: 700, size: 12.5, color: c.accent, align: "right"}); }
        if (k === 5){
          // sun, a freed electron heading right, a hole heading left, and the outside wire
          dot(g, 60, 40, 22, "#F2B53A"); for (let a = 0; a < 8; a++){ const ang = a * Math.PI / 4; line(g, [60 + Math.cos(ang) * 28, 40 + Math.sin(ang) * 28], [60 + Math.cos(ang) * 38, 40 + Math.sin(ang) * 38], "#F2B53A", 3); }
          arrow(g, 92, 62, 380, 196, "#F2B53A", 2.5, 10);
          const e = mixP([400, 205], [690, 205], ease(p)), h = mixP([400, 290], [110, 290], ease(p));
          dot(g, e[0], e[1], 5.5, c.accent); text(g, "freed electron", e[0], e[1] - 16, {w: 700, size: 11.5, color: c.accent, halo: c.bg});
          g.beginPath(); g.arc(h[0], h[1], 9, 0, 7); g.fillStyle = `color-mix(in srgb, ${c.warn} 30%, transparent)`; try { g.fill(); } catch(_){} dashed(g, h[0], h[1], 4.5, c.warn, 2); text(g, "hole", h[0], h[1] + 20, {w: 700, size: 11.5, color: c.warn, halo: c.bg});
          g.strokeStyle = c.ink; g.lineWidth = 3; g.beginPath(); g.moveTo(712, 250); g.lineTo(760, 250); g.lineTo(760, 484); g.lineTo(40, 484); g.lineTo(40, 250); g.lineTo(88, 250); g.stroke();
          const w = along([[760, 250], [760, 484], [40, 484], [40, 250]], (REDUCED ? 0.5 : (t * 0.25) % 1)); dot(g, w[0], w[1], 5, c.accent);
          text(g, "current through the wire", 400, 472, {w: 700, size: 12.5, color: c.ink, halo: c.bg});
        }
      },
    };
  })();

  /* ---------- Boron: why it's so hard ---------- */
  SCENES.boronHard = (() => {
    function ball(cx, cy, s){   // a 12-atom ball seen from above: an outer hexagon + an inner, turned hexagon
      const out = [], inn = [];
      for (let i = 0; i < 6; i++){ const a = i * Math.PI / 3; out.push([cx + Math.cos(a) * 95 * s, cy + Math.sin(a) * 95 * s]); const b = a + Math.PI / 6; inn.push([cx + Math.cos(b) * 46 * s, cy + Math.sin(b) * 46 * s]); }
      const L = []; for (let i = 0; i < 6; i++){ L.push([out[i], out[(i + 1) % 6]], [inn[i], inn[(i + 1) % 6]], [inn[i], out[i]], [inn[i], out[(i + 1) % 6]]); }
      return {pts: out.concat(inn), links: L, out};
    }
    const BALLS = [[220, 165], [580, 165], [220, 365], [580, 365]].map(([x, y]) => ball(x, y, 0.62));
    function drawBall(g, c, b, alpha = 1){
      g.save(); g.globalAlpha = alpha;
      for (const [A, B] of b.links) line(g, A, B, c.ink, 2);
      for (const [x, y] of b.pts) atom(g, c, x, y, "B", {r: 11, outer: []});
      g.restore();
    }
    function webLinks(g, c){
      const pairs = [[0, 1, 0, 3], [2, 3, 0, 3], [0, 2, 1, 5], [1, 3, 2, 4]];   // ball i outer[a] to ball j outer[b]
      for (const [i, j, a, b] of pairs) line(g, BALLS[i].out[a], BALLS[j].out[b], c.ink, 2.2);
      // the web keeps going off the edges
      for (const b of BALLS) for (const q of [1, 4]){ const [x, y] = b.out[q]; line(g, [x, y], [x + (x < 400 ? -40 : 40), y + (q === 1 ? 30 : -30)], c.muted, 1.6, [4, 4]); }
    }
    return {
      title: "Why boron is so hard",
      steps: [
        {cap: "Boron can't give its 3 electrons away (it grips too tightly), and sharing just 3 can't fill its shell. In a straight chain, empty hands are left everywhere."},
        {cap: "So borons bunch into balls of 12, each boron sharing electrons with 5 neighbors at once. The shape is a 20-sided die, called an icosahedron (eye-koss-uh-HEE-drun).", dur: 2000},
        {cap: "The balls bond to each other in every direction, making one giant 3D web. No weak layers, no loose ends.", dur: 2000},
        {cap: "To scratch or dent it, you'd have to break lots of short, strong bonds at once, in every direction. That's what hard means: it resists scratching and denting."},
        {cap: "Add carbon and you get boron carbide (B4C): the same balls, linked by short carbon-boron-carbon chains. It's one of the hardest materials ever made, and it's used in body-armor plates."},
        {cap: "Hard isn't tough, though. With no way to bend, a sharp hit cracks it. That's the same trade-off as the ceramic tiles on Starship's heat shield."},
      ],
      take: "Boron's 3 electrons push it into a 3D web of short, strong bonds: very hard, but brittle.",
      draw(g, k, p, t, c){
        if (k === 0 || (k === 1 && p < 0.5)){
          const a = k === 0 ? 1 : 1 - p * 2;
          g.save(); g.globalAlpha = a;
          const xs = [250, 330, 410, 490];
          for (let i = 0; i < 3; i++) line(g, [xs[i], 250], [xs[i + 1], 250], c.ink, 2.4);
          xs.forEach((x, i) => {
            const end = i === 0 || i === 3, hands = end ? [i === 0 ? Math.PI - 1.05 : -1.05, i === 0 ? Math.PI + 1.05 : 1.05] : [i % 2 ? -Math.PI / 2 : Math.PI / 2];
            atom(g, c, x, 250, "B", {r: 24, outer: [], hands, glow: c.warn});
          });
          text(g, "6 empty hands, nowhere to put them", 370, 330, {w: 700, size: 14, color: c.ink});
          g.restore();
        }
        if (k === 1 && p >= 0.5){ drawBall(g, c, ball(400, 250, 1.6), ease((p - 0.5) * 2)); text(g, "12 borons, each touching 5", 400, 470, {w: 700, size: 14, color: c.ink}); }
        if (k >= 2){
          const a = k === 2 ? ease(p) : 1;
          g.save(); g.globalAlpha = a; webLinks(g, c); g.restore();
          for (const b of BALLS) drawBall(g, c, b, 1);
        }
        if (k === 3){
          const d = ease(sub(p, 0, 0.6));
          g.beginPath(); g.moveTo(400, 30 + d * 60); g.lineTo(370, 0 + d * 60 - 40); g.lineTo(430, 0 + d * 60 - 40); g.closePath(); g.fillStyle = c.muted; g.fill();
          text(g, "scratch / dent", 470, 30 + d * 40, {w: 700, size: 13, color: c.ink, align: "left"});
          if (p > 0.6){ for (const [x, y] of [[360, 120], [440, 120], [400, 140]]) arrow(g, 400, 110, x, y + 30, c.accent, 2, 8); text(g, "every bond pushes back", 400, 270, {w: 750, size: 15, color: c.ink, halo: c.bg}); }
        }
        if (k === 4){
          const a = ease(p);
          g.save(); g.globalAlpha = a;
          const chain = [[330, 265], [400, 265], [470, 265]];
          line(g, BALLS[0].out[0], chain[0], c.ink, 2.2); line(g, chain[0], chain[1], c.ink, 2.2); line(g, chain[1], chain[2], c.ink, 2.2); line(g, chain[2], BALLS[3].out[3], c.ink, 2.2);
          atom(g, c, ...chain[0], "C", {r: 13, outer: []}); atom(g, c, ...chain[1], "B", {r: 12, outer: []}); atom(g, c, ...chain[2], "C", {r: 13, outer: []});
          text(g, "carbon-boron-carbon chain", 400, 300, {w: 700, size: 13, color: c.ink, halo: c.bg});
          text(g, "Boron carbide (B4C): body armor", 400, 480, {w: 800, size: 15, color: c.ink});
          g.restore();
        }
        if (k === 5){
          g.strokeStyle = c.proton; g.lineWidth = 3.5; g.beginPath();
          const pts = [[400, 40], [380, 120], [420, 190], [395, 260], [430, 340], [405, 420], [420, 470]];
          pts.slice(0, 1 + Math.round(ease(p) * (pts.length - 1))).forEach(([x, y], i) => i ? g.lineTo(x, y) : g.moveTo(x, y)); g.stroke();
          text(g, "a sharp hit cracks it", 560, 470, {w: 750, size: 14, color: c.proton});
        }
      },
    };
  })();

  /* =====================================================================================
     the player: canvas + caption + Back / Next
     ===================================================================================== */
  function open(id){
    const sc = SCENES[id]; if (!sc) return;
    close();
    const box = $("scenePop");
    box.innerHTML = `<div class="sc-card">
      <div class="sc-top"><div><div class="eyebrow">See it in action</div><h3>${esc(sc.title)}</h3></div><button class="btn" id="scClose">Close</button></div>
      <div class="sc-dots">${sc.steps.map(() => "<i></i>").join("")}</div>
      <canvas id="scCanvas" aria-label="${esc(sc.title)}, animated"></canvas>
      <p class="sc-cap" id="scCap" aria-live="polite"></p><div id="scTake"></div>
      <div class="sc-nav"><button class="btn" id="scBack">Back</button><button class="btn" id="scReplay">Replay step</button><button class="btn primary" id="scNext">Next</button></div></div>`;
    box.hidden = false;
    st = {sc, k: 0, t0: performance.now(), start: performance.now(), raf: 0};
    $("scClose").onclick = close;
    $("scBack").onclick = () => go(st.k - 1);
    $("scNext").onclick = () => st.k >= sc.steps.length - 1 ? close() : go(st.k + 1);
    $("scReplay").onclick = () => go(st.k);
    box.onclick = (e) => { if (e.target === box) close(); };
    addEventListener("keydown", onKey); addEventListener("resize", size);
    size(); go(0);
    st.raf = requestAnimationFrame(loop);
  }
  function onKey(e){
    if (!st) return;
    if (e.key === "Escape") close();
    else if (e.key === "ArrowRight") $("scNext").click();
    else if (e.key === "ArrowLeft") go(st.k - 1);
  }
  function size(){
    if (!st) return;
    const cv = $("scCanvas"), r = cv.getBoundingClientRect(), dpr = Math.min(2, devicePixelRatio || 1);
    cv.width = Math.round(r.width * dpr); cv.height = Math.round(r.width * 10 / 16 * dpr);
    st.g = cv.getContext("2d"); st.scale = r.width / VW * dpr; st.oy = (r.width * 10 / 16 * dpr - VH * st.scale) / 2;
  }
  function go(k){
    const sc = st.sc; k = Math.max(0, Math.min(sc.steps.length - 1, k));
    st.k = k; st.t0 = performance.now();
    $("scCap").textContent = sc.steps[k].cap;
    $("scTake").innerHTML = k === sc.steps.length - 1 && sc.take ? `<div class="sc-take"><b>Takeaway:</b> ${esc(sc.take)}</div>` : "";
    $("scBack").disabled = k === 0;
    $("scNext").textContent = k === sc.steps.length - 1 ? "Done" : "Next";
    document.querySelectorAll("#scenePop .sc-dots i").forEach((d, i) => d.classList.toggle("on", i <= k));
  }
  function loop(now){
    if (!st) return;
    st.raf = requestAnimationFrame(loop);
    const {g, sc, k} = st, dur = sc.steps[k].dur || 1600;
    const p = REDUCED ? 1 : ease(clamp01((now - st.t0) / dur)), t = (now - st.start) / 1000;
    g.setTransform(1, 0, 0, 1, 0, 0); g.clearRect(0, 0, g.canvas.width, g.canvas.height);
    g.setTransform(st.scale, 0, 0, st.scale, 0, Math.max(0, st.oy));
    try { sc.draw(g, k, p, t, colors()); } catch(err){ console.error(err); }
  }
  function close(){
    if (!st) { $("scenePop").hidden = true; return; }
    cancelAnimationFrame(st.raf); st = null;
    removeEventListener("keydown", onKey); removeEventListener("resize", size);
    const box = $("scenePop"); box.hidden = true; box.innerHTML = "";
  }
  return {open, close, list: () => Object.keys(SCENES)};
})();

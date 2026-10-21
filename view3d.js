/* =====================================================================================
   Spin in 3D: a small canvas viewer for finished molecules. No 3D library: positions come
   precomputed (data/mol3d.json, RDKit at build time), and we just rotate, project and draw.
   Every atom keeps its label, hydrogens included. Loaded only the first time you open it.
   ===================================================================================== */
window.View3D = (() => {
  let shapes = null, raf = 0, st = null;
  const $ = (id) => document.getElementById(id);
  async function data(){ if (!shapes) shapes = await fetch("data/mol3d.json").then(r => r.json()).catch(() => ({})); return shapes; }
  async function has(id){ return !!(await data())[id]; }

  async function open(m){
    const pts = (await data())[m.id]; if (!pts) return false;
    const box = $("view3d");
    box.innerHTML = `<div class="v3-top"><div><b>${esc(m.name)}</b> <span class="mono muted">${esc(m.formula)}</span></div><button class="btn" id="v3Close">Close</button></div>
      <canvas id="v3c" aria-label="${esc(m.name)} in 3D. Drag to turn it."></canvas>
      <div class="v3-foot small muted">Drag to turn it. This is the real shape: atoms spread their bonds as far apart as they can. ${shapeNote(m)}</div>`;
    box.hidden = false;
    $("v3Close").onclick = close;
    const cv = $("v3c"), ctx = cv.getContext("2d");
    const r = cv.getBoundingClientRect(), dpr = Math.min(2, devicePixelRatio || 1);
    cv.width = r.width * dpr; cv.height = r.height * dpr; ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const R = Math.max(...pts.map(p => Math.hypot(...p))) || 1;
    st = {m, pts, ctx, W: r.width, H: r.height, yaw: 0.6, pitch: -0.35, auto: true, scale: Math.min(r.width, r.height) * 0.38 / R, drag: null};
    cv.onpointerdown = (e) => { st.drag = [e.clientX, e.clientY, st.yaw, st.pitch]; st.auto = false; cv.setPointerCapture(e.pointerId); };
    cv.onpointermove = (e) => { if (!st.drag) return; st.yaw = st.drag[2] + (e.clientX - st.drag[0]) * 0.01; st.pitch = Math.max(-1.5, Math.min(1.5, st.drag[3] + (e.clientY - st.drag[1]) * 0.01)); };
    cv.onpointerup = () => { st.drag = null; };
    cancelAnimationFrame(raf); raf = requestAnimationFrame(loop);
    return true;
  }
  function shapeNote(m){
    const c = m.counts;
    if (m.id === "methane") return "Methane's 4 hydrogens point to the corners of a pyramid (a tetrahedron), not a flat plus sign.";
    if (m.id === "water") return "Water is bent: oxygen's two unused electron pairs push the hydrogens together.";
    if (m.id === "ammonia") return "Ammonia is a short pyramid: nitrogen's unused pair sits on top.";
    if (m.id === "co2") return "CO2 is a straight line: two double bonds pull in exactly opposite directions.";
    if (m.id === "benzene") return "Benzene is completely flat.";
    return "";
  }
  function close(){ cancelAnimationFrame(raf); raf = 0; st = null; const b = $("view3d"); if (b){ b.hidden = true; b.innerHTML = ""; } }
  function loop(){
    if (!st) return;
    raf = requestAnimationFrame(loop);
    if (st.auto && !matchMedia("(prefers-reduced-motion: reduce)").matches) st.yaw += 0.008;
    draw();
  }
  function draw(){
    const {ctx, W, H, pts, m} = st, cy = Math.cos(st.yaw), sy = Math.sin(st.yaw), cp = Math.cos(st.pitch), sp = Math.sin(st.pitch);
    const P = pts.map(([x, y, z]) => { const x1 = x * cy + z * sy, z1 = -x * sy + z * cy, y1 = y * cp - z1 * sp, z2 = y * sp + z1 * cp; const f = 6 / (6 + z2 * 0.35); return [W / 2 + x1 * st.scale * f, H / 2 - y1 * st.scale * f, z2, f]; });
    ctx.clearRect(0, 0, W, H);
    const ink = css("--ink");
    // bonds first (back to front by average depth), then atoms back to front
    const bonds = m.bonds.map(b => [b, (P[b[0]][2] + P[b[1]][2]) / 2]).sort((a, b) => a[1] - b[1]);
    const order = P.map((p, i) => [i, p[2]]).sort((a, b) => a[1] - b[1]);
    // ball size follows the zoom so it reads as balls and sticks at any size (H smaller than the rest)
    const rad = (sym) => sym === "*" ? 4 : Math.max(8, Math.min(sym === "H" ? 22 : 34, st.scale * (sym === "H" ? 0.22 : 0.34)));
    let bi = 0;
    for (const [i] of order){
      while (bi < bonds.length && bonds[bi][1] <= P[i][2]){ drawBond(bonds[bi][0]); bi++; }
      const [x, y, , f] = P[i], s = m.atoms[i][0];
      if (s === "*"){ ctx.fillStyle = css("--muted"); ctx.font = "700 14px Archivo, sans-serif"; ctx.textAlign = "center"; ctx.fillText("…", x, y); continue; }
      const r = rad(s) * f, col = atomColor(s);
      const g = ctx.createRadialGradient(x - r * .35, y - r * .35, r * .1, x, y, r);
      g.addColorStop(0, "rgba(255,255,255,.55)"); g.addColorStop(.35, col); g.addColorStop(1, col);
      ctx.beginPath(); ctx.arc(x, y, r, 0, 7); ctx.fillStyle = col; ctx.fill(); ctx.fillStyle = g; ctx.fill();
      ctx.fillStyle = textOn(col.startsWith("#") ? col : "#3A3F47"); ctx.font = `700 ${Math.round(Math.max(10, r * 0.75))}px Archivo, sans-serif`; ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.fillText(s, x, y + .5);
    }
    while (bi < bonds.length){ drawBond(bonds[bi][0]); bi++; }
    function drawBond([i, j, o]){
      // start and end at each ball's edge so a bond never covers an atom's own label
      const [ax, ay, , fa] = P[i], [bx, by, , fb] = P[j], L = Math.hypot(bx - ax, by - ay) || 1, ux = (bx - ax) / L, uy = (by - ay) / L;
      const ra = rad(m.atoms[i][0]) * fa * 0.85, rb = rad(m.atoms[j][0]) * fb * 0.85;
      if (L <= ra + rb) return;
      const x1 = ax + ux * ra, y1 = ay + uy * ra, x2 = bx - ux * rb, y2 = by - uy * rb, nx = -uy, ny = ux;
      const offs = o === 2 ? [-3, 3] : o === 3 ? [-5, 0, 5] : [0];
      ctx.strokeStyle = ink; ctx.lineWidth = Math.max(2.5, st.scale * 0.05); ctx.globalAlpha = (m.atoms[i][0] === "*" || m.atoms[j][0] === "*") ? .4 : .85;
      for (const k of offs){ ctx.beginPath(); ctx.moveTo(x1 + nx * k, y1 + ny * k); ctx.lineTo(x2 + nx * k, y2 + ny * k); ctx.stroke(); }
      ctx.globalAlpha = 1;
    }
  }
  return {open, close, has};
})();

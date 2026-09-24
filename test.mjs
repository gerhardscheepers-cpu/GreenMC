// Test harness: extracts the engine script from index.html and checks the
// math against hand-computed cases. Run: node test.mjs
import { readFileSync, writeFileSync, mkdirSync } from "fs";
import { execSync } from "child_process";
import vm from "vm";

const html = readFileSync(new URL("./index.html", import.meta.url), "utf8");
const engineSrc = html.match(/<script id="engine">([\s\S]*?)<\/script>/)[1];
const uiSrc = html.match(/<script id="ui">([\s\S]*?)<\/script>/)[1];

// 1. syntax-check both scripts
mkdirSync("/tmp/gdmc", { recursive: true });
writeFileSync("/tmp/gdmc/engine.js", engineSrc);
writeFileSync("/tmp/gdmc/ui.js", uiSrc);
for (const f of ["engine.js", "ui.js"]) {
  execSync(`node --check /tmp/gdmc/${f}`, { stdio: "inherit" });
}
console.log("OK  both scripts parse");

const ctx = {};
vm.createContext(ctx);
const E = vm.runInContext(engineSrc + "\n;ENGINE;", ctx);
if (!E) throw new Error("ENGINE not defined");

let fails = 0;
const eq = (name, got, want, tol) => {
  const ok = Math.abs(got - want) <= (tol ?? 1e-6);
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}: got ${got}, want ${want}`);
  if (!ok) fails++;
};

// rectInside sanity: full circle area of r=100 -> pi*100^2 = 31415.9
const p1 = { dSmall: 200, dLarge: 200, length: 3, thickCore: 25, thickSide: 25, kerf: 3,
  pattern: "tnt", cantWidth: 0,
  mcSap: 100, mcHeart: 50, rhoCore: 400, rhoPerimeter: 400, shrinkVol: 0, heartFrac: 0.5 };
// Side-board wane settings, as the UI defaults. Omitted from a params object
// the engine treats them as "no limit / no width cap / no length floor", which
// reproduces the unlimited-wane behaviour used by the geometry tests below.
const sideDef = { sideWidth: 125, minBoardLen: 2500, waneWidthFrac: 0.33, waneThickFrac: 0.5 };

// 2. limiting case: heartFrac = 0 -> every board is 100% sapwood
let r = E.compute({ ...p1, heartFrac: 0 });
r.boards.forEach(b => eq(`100% sapwood board ${b.no} heartPct`, b.heartPct, 0, 0.5));
// board MC must equal mcSap=100, rhoGreen = 400*(1+1.0) = 800
eq("heartFrac=0 board MC", r.boards[0].mc, 100, 0.5);
eq("heartFrac=0 board green density", r.boards[0].rhoGreen, 800, 2);

// 3. limiting case: heartFrac = 1 -> all heartwood
r = E.compute({ ...p1, heartFrac: 1 });
eq("heartFrac=1 board MC", r.boards[0].mc, 50, 0.5);
eq("heartFrac=1 board green density", r.boards[0].rhoGreen, 400 * 1.5, 2);

// 4. hand-checkable two-board log: diameter 400, t=100, kerf 0 ->
//    two boards y=[-50,50] and mirrored, full chord width 400... boards
//    are [-50,50] and [-50,-150]+[50,150]? t=100 -> centre [-50,50],
//    next [100,200]? kerf=0 -> y=50+0=50, next board [50,150] fits in R=200.
//    Verify centre board heart fraction with heartFrac 0.5 (rh=100):
//    rect 400x100 fully inside R=400 circle? corners at (200,50):
//    dist=206 > 200 -> NOT fully inside. So use analytic check instead:
//    area of rect [-200,200]x[-50,50] inside circle r=200 =
//    4 * integral_0^50 2*sqrt(200^2-y^2) dy
//    = 4 * [y*sqrt(R^2-y^2) + R^2*asin(y/R)]_0^50... compute numerically here:
const R = 200;
const integral = (a, b) => { // integral of sqrt(R^2-y^2) dy
  const n = 200000; let s = 0; const h = (b - a) / n;
  for (let i = 0; i < n; i++) { const y = a + (i + 0.5) * h; s += Math.sqrt(R * R - y * y) * h; }
  return s;
};
const areaWant = 2 * integral(-50, 50); // area = ∫ 2*sqrt(R²−y²) dy over y ∈ [−50,50]
const gotArea = E.rectInside(-200, 200, -50, 50, R, 400);
eq("rectInside analytic circle area", gotArea, areaWant, areaWant * 0.002);

// 5. mixed layout check: every board's volume must equal an independent
//    integration of (rectangle ∩ log) along the tapered log, and the board
//    masses must add up.
r = E.compute({ ...p1, heartFrac: 0.4, dLarge: 300, pattern: "cant", cantWidth: 60 });
const Rz5 = z => p1.dSmall / 2 + (300 / 2 - p1.dSmall / 2) * z / p1.length;
let volErr = 0;
for (const b of r.boards) {
  const steps = 120, NREF = 80, dz = b.length / steps;
  let ref = 0;
  for (let k = 0; k < steps; k++) {
    const z = b.zStart + (k + 0.5) * dz;
    ref += E.rectInside(b.x1, b.x2, b.y1, b.y2, Rz5(z), NREF) * dz * 1e-6;
  }
  volErr = Math.max(volErr, Math.abs(b.volume - ref) / Math.max(ref, 1e-9));
}
if (volErr > 0.01) {
  console.log("FAIL  board volume != independent taper integration (" + (100 * volErr).toFixed(2) + " %)"); fails++;
} else console.log("PASS  board volumes match independent integration along the log (max err",
  (100 * volErr).toFixed(3) + " %)");
const dryCheck = r.boards.reduce((s, b) => s + b.dryMass + b.waterMass - b.greenWeight, 0);
eq("mass conservation (dry+water==greenWeight)", dryCheck, 0, 1e-6);

// 6. monotonic MC: bark-side boards have more sapwood than centre board
r = E.compute(p1);
const outer = r.boards[0], centre = r.boards[Math.floor(r.boards.length / 2)];
if (!(outer.mc > centre.mc)) { console.log("FAIL  bark-side MC should exceed centre MC"); fails++; }
else console.log("PASS  bark-side MC > centre MC (", fmt(outer.mc), ">", fmt(centre.mc), ")");

// 7. cant pattern produces a cant item
r = E.compute({ ...p1, pattern: "cant", cantWidth: 100 });
if (!r.boards.some(b => b.isCant)) { console.log("FAIL  no cant in output"); fails++; }
else console.log("PASS  cant item present");

// effective cant width rule: 0 = no cant rows; a positive number caps the
// cant at that width (clamped to the inscribed square); non-finite (blank)
// means take the biggest square that fits the small end.
function effCantWidth(cantWidth, dSmall) {
  if (cantWidth === 0) return 0;
  const maxCw = Math.SQRT2 * dSmall / 2;
  if (typeof cantWidth === "number" && isFinite(cantWidth) && cantWidth > 0)
    return Math.min(cantWidth, maxCw);
  return maxCw;
}

// 8. cant wider than the inscribed square gets clamped, not dropped:
//    Ø200 log (R=100) -> max cant = 141 mm; user asks 200 -> clamped,
//    a cant item must still exist and a warning be raised.
r = E.compute({ ...p1, dSmall: 200, dLarge: 200, pattern: "cant", cantWidth: 200 });
if (!r.boards.some(b => b.isCant)) { console.log("FAIL  oversized cant was dropped"); fails++; }
else console.log("PASS  oversized cant clamped, not dropped");
if (!r.warnings.length) { console.log("FAIL  expected clamp warning"); fails++; }
else console.log("PASS  clamp warning raised:", r.warnings[0]);
// cant rows together must not exceed the inscribed-square area
const cantRows8 = r.boards.filter(b => b.isCant);
const cantArea = cantRows8.reduce((s, b) => s + b.volume / p1.length, 0);
if (cantArea > 0.020001) { console.log("FAIL  cant volume exceeds inscribed square"); fails++; }
else console.log("PASS  cant rows within inscribed square (area", (cantArea * 1e6).toFixed(0), "mm²,",
  cantRows8.length, "rows)");

// 9. cant layout: cant resawn into rows + vertical side boards left/right
const pc = { ...p1, pattern: "cant", cantWidth: 120 };
r = E.compute(pc);
const cantRows = r.boards.filter(b => b.isCant);
const sides = r.boards.filter(b => /^Side/.test(b.label));
if (cantRows.length < 2) { console.log("FAIL  expected several cant rows, got", cantRows.length); fails++; }
else console.log("PASS  cant resawn into", cantRows.length, "rows");
const sideCantExpect = effCantWidth(pc.cantWidth, pc.dSmall);
if (r.cantWidth === 0 || Math.abs(r.cantWidth - sideCantExpect) > 0.11) {
  console.log("FAIL  compute().cantWidth should echo the cant width used, got", r.cantWidth); fails++;
} else console.log("PASS  compute() reports the cant width used (" + r.cantWidth + " mm)");
if (!sides.some(b => /Side L/.test(b.label)) || !sides.some(b => /Side R/.test(b.label))) {
  console.log("FAIL  missing side boards L/R"); fails++;
} else console.log("PASS  side boards present both sides:", sides.map(b => b.label).join(", "));
// vertical side boards: sawn thickness = horizontal extent
const sR = sides.find(b => /Side R/.test(b.label));
if (Math.abs(sR.thickness - pc.thickSide) > 0.01) { console.log("FAIL  side board thickness wrong:", sR.thickness); fails++; }
else console.log("PASS  side board thickness =", sR.thickness, "mm");
// no overlapping rectangles in the layout (kerf-separated, disjoint)
let overlap = false;
for (let i = 0; i < r.boards.length && !overlap; i++) for (let j = i + 1; j < r.boards.length; j++) {
  const a = r.boards[i], c = r.boards[j];
  const ox = Math.min(a.x2, c.x2) - Math.max(a.x1, c.x1);
  const oy = Math.min(a.y2, c.y2) - Math.max(a.y1, c.y1);
  if (ox > 0.01 && oy > 0.01) { overlap = true; console.log("FAIL  overlap:", a.label, c.label); }
}
if (!overlap) console.log("PASS  no overlapping board rectangles");
else fails++;
// cant rows together span no more than the cant width
const rowThick = cantRows.reduce((s, b) => s + (b.y2 - b.y1), 0)
  + (cantRows.length - 1) * pc.kerf;
if (rowThick > Math.min(pc.cantWidth, Math.SQRT2 * pc.dSmall / 2) + 0.01) {
  console.log("FAIL  cant rows exceed cant width:", rowThick); fails++;
} else console.log("PASS  cant rows span", rowThick, "mm <= cant width");

// 9b. core/side board thicknesses, side-board width and wane trimming.
//     Defaults (Ø220/250, cant 155 = inscribed square): 3 core rows plus 4
//     side boards — above and below the cant and on both flanks — sawn to the
//     side thickness, edged to the 125 mm side board width and cut back from
//     the small end until the wane limits are met.
const pDef = { ...sideDef, dSmall: 220, dLarge: 250, length: 4.2, thickCore: 50, thickSide: 25,
  kerf: 2.5, pattern: "cant", cantWidth: 155,
  mcSap: 120, mcHeart: 40, rhoCore: 455, rhoPerimeter: 568, shrinkVol: 12, heartFrac: 0.45 };
const dDef = E.compute(pDef).boards;
const dCore = dDef.filter(b => b.isCant), dSide = dDef.filter(b => !b.isCant);
const cwDef = Math.min(pDef.cantWidth, Math.SQRT2 * pDef.dSmall / 2);
if (!(dCore.length === 3 && dSide.length === 4)) {
  console.log("FAIL  expected 3 core + 4 side boards, got", dCore.length, "core,", dSide.length, "side"); fails++;
} else console.log("PASS  Ø220/cant 155 yields", dCore.length, "core +", dSide.length, "side boards");
if (dCore.some(b => Math.abs(b.thickness - pDef.thickCore) > 0.01)) {
  console.log("FAIL  core board thickness != thickCore"); fails++;
} else console.log("PASS  core boards sawn to core thickness", pDef.thickCore, "mm");
if (dSide.some(b => Math.abs(b.thickness - pDef.thickSide) > 0.01)) {
  console.log("FAIL  side board thickness != thickSide"); fails++;
} else console.log("PASS  side boards sawn to side thickness", pDef.thickSide, "mm");
// side boards are edged to the side-board width and never wider than the cant;
// core rows are limited by the cant itself
const wCap9 = Math.min(pDef.sideWidth, cwDef);
const overW = dSide.filter(b => b.width > wCap9 + 0.01).concat(dCore.filter(b => b.width > cwDef + 0.01));
if (overW.length) { console.log("FAIL  board wider than the side width/cant:", overW.map(b => b.label + " " + b.width)); fails++; }
else console.log("PASS  side boards within", wCap9.toFixed(0), "mm (side board width / cant) and core rows within",
  cwDef.toFixed(0), "mm:",
  [...dCore, ...dSide].map(b => b.label + " " + b.width).join(", "));
// side boards must exist above AND below the cant, and on both flanks
if (!(dSide.some(b => b.y1 >= cwDef / 2 - 1) && dSide.some(b => b.y2 <= -cwDef / 2 + 1))) {
  console.log("FAIL  missing side boards above/below the cant"); fails++;
} else console.log("PASS  side boards above and below the cant");
// flank boards are the vertical ones (Side R…/Side L…) beside the cant
const flank = dSide.filter(b => /Side [LR]/.test(b.label));
if (!(flank.some(b => /Side R/.test(b.label)) && flank.some(b => /Side L/.test(b.label)))) {
  console.log("FAIL  missing flank side boards L/R"); fails++;
} else console.log("PASS  flank side boards present:", flank.map(b => b.label).join(", "));
// core rows run the whole log; the wane-limited side boards are cut back
if (dCore.some(b => b.trim !== "full" || Math.abs(b.length - pDef.length) > 1e-9)) {
  console.log("FAIL  core rows must run the full log length"); fails++;
} else console.log("PASS  core rows run the full log length");
if (dSide.some(b => b.trim !== "cut")) {
  console.log("FAIL  side boards should be cut back here:", dSide.map(b => b.label + " " + b.trim)); fails++;
} else console.log("PASS  side boards cut back from the small end:",
  dSide.map(b => b.label + " " + b.length.toFixed(2) + " of " + pDef.length + " m").join(", "));
if (dSide.some(b => Math.abs(b.length - pDef.length) < 1e-9)) {
  console.log("FAIL  wane-limited side boards must be shorter than the log"); fails++;
} else console.log("PASS  wane-limited side boards are shorter than the log");
// worst wane fractions of a board over the length it actually uses
function worstWane(p, b) {
  const Rz = z => p.dSmall / 2 + (((p.dLarge || p.dSmall) / 2) - p.dSmall / 2) * z / p.length;
  const isV = b.orient === "v";
  const t = isV ? b.x2 - b.x1 : b.y2 - b.y1, w = isV ? b.y2 - b.y1 : b.x2 - b.x1;
  const dIn = isV ? Math.min(Math.abs(b.x1), Math.abs(b.x2)) : Math.min(Math.abs(b.y1), Math.abs(b.y2));
  const dOut = isV ? Math.max(Math.abs(b.x1), Math.abs(b.x2)) : Math.max(Math.abs(b.y1), Math.abs(b.y2));
  let fw = 0, ft = 0;
  for (let k = 0; k < 400; k++) {
    const z = b.zStart + (k + 0.5) * b.length / 400, R = Rz(z);
    const C = Math.sqrt(Math.max(0, R * R - dOut * dOut));
    const E2 = Math.sqrt(Math.max(0, R * R - (w / 2) * (w / 2)));
    fw = Math.max(fw, (w - 2 * Math.min(w / 2, C)) / w);
    ft = Math.max(ft, (dOut - Math.max(dIn, E2)) / t);
  }
  return { fw, ft };
}
let waneBad = 0;
for (const b of dSide) {
  const wn = worstWane(pDef, b);
  if (wn.fw > pDef.waneWidthFrac + 1e-9 || wn.ft > pDef.waneThickFrac + 1e-9) {
    console.log("FAIL  wane above the limits on", b.label, wn.fw.toFixed(3), wn.ft.toFixed(3)); waneBad++;
  }
}
if (waneBad) fails += waneBad;
else console.log("PASS  every side board stays within both wane limits over its own length (worst",
  Math.max(...dSide.map(b => worstWane(pDef, b).fw)).toFixed(3), "width /",
  Math.max(...dSide.map(b => worstWane(pDef, b).ft)).toFixed(3), "thickness)");
// wane inside the limits is still real, and solid volume <= sawn volume
if (!dSide.some(b => b.wanePct > 0)) {
  console.log("FAIL  side boards should still contain wane inside the limits"); fails++;
} else console.log("PASS  wane remains inside the limits (max",
  Math.max(...dSide.map(b => b.wanePct)).toFixed(1) + " % of the width)");
const sumSawn9 = dDef.reduce((s, b) => s + b.volumeSawn, 0);
const sumSolid9 = dDef.reduce((s, b) => s + b.volume, 0);
if (!(sumSolid9 <= sumSawn9 + 1e-12 && sumSawn9 > 0)) {
  console.log("FAIL  solid volume must not exceed the sawn volume"); fails++;
} else console.log("PASS  solid wood", (1000 * sumSolid9).toFixed(1), "L <= sawn lumber",
  (1000 * sumSawn9).toFixed(1), "L");
const logVol9 = Math.PI / 12 * pDef.length * (Math.pow(pDef.dSmall / 1000, 2) +
  (pDef.dSmall / 1000) * (pDef.dLarge / 1000) + Math.pow(pDef.dLarge / 1000, 2));
if (!(sumSawn9 < logVol9)) { console.log("FAIL  lumber volume exceeds the log volume"); fails++; }
else console.log("PASS  recovery", (100 * sumSawn9 / logVol9).toFixed(0) + " % sawn /",
  (100 * sumSolid9 / logVol9).toFixed(0) + "% solid (log", (1000 * logVol9).toFixed(1), "L)");

// 9c. through-and-through: every board is treated as a side board (core board
//     thickness, side-board width, wane limits).
const tntC = E.compute({ ...pDef, pattern: "tnt", cantWidth: 0 }).boards;
if (tntC.some(b => Math.abs(b.thickness - pDef.thickCore) > 0.01)) {
  console.log("FAIL  live-sawn board thickness != thickCore"); fails++;
} else console.log("PASS  live sawing uses core thickness for all boards");
if (tntC.some(b => b.width > pDef.sideWidth + 0.01)) {
  console.log("FAIL  live-sawn board wider than the side board width"); fails++;
} else console.log("PASS  live-sawn boards edged to the side board width (" +
  tntC.map(b => b.width).join(", ") + " mm)");

// 9d. cutting back to the wane limits, dropping, and the shortest-board rule.
// A side board keeps its sawn width: if the part of the log that meets the
// wane limits is shorter than the shortest allowed board, the board is not
// produced at all instead of being edged down to a narrower board.
const pCyl = { ...pDef, dLarge: 220 };              // cylinder: nothing to cut back
const rCyl = E.compute(pCyl);
const cylSide = rCyl.boards.filter(b => !b.isCant);
if (cylSide.length || !rCyl.warnings.some(w => /Dropped/.test(w))) {
  console.log("FAIL  a cylindrical log must drop its waney side boards, got",
    cylSide.map(b => b.label + " " + b.width + " mm"), JSON.stringify(rCyl.warnings)); fails++;
} else console.log("PASS  cylindrical log: waney side boards dropped, no narrow boards (" +
  rCyl.warnings[0].slice(0, 74) + "…)");
// a longer minimum length drops the boards rather than edging them narrower
const pMin = { ...pDef, minBoardLen: 4000 };
const rMin = E.compute(pMin);
if (rMin.boards.some(b => !b.isCant) || !rMin.warnings.some(w => /Dropped/.test(w))) {
  console.log("FAIL  a 4 m minimum length should drop the cut-back boards",
    rMin.boards.filter(b => !b.isCant).map(b => b.label + " " + b.width)); fails++;
} else console.log("PASS  a 4 m minimum length drops the cut-back boards instead of edging them");
// every produced side board meets the shortest allowed length
if (!dSide.every(b => b.length >= pDef.minBoardLen / 1000 - 1e-9)) {
  console.log("FAIL  produced side boards must meet the minimum length:", dSide.map(b => b.length)); fails++;
} else console.log("PASS  produced side boards meet the minimum length (" +
  dSide.map(b => b.length.toFixed(2) + " m").join(", ") + ")");
// the reported case: Ø210/250, cant 155 clamped to 148 mm, side board 150 mm.
// The flanks at that width would only reach 2.2 m, so they are dropped and no
// narrow (edged) board appears anywhere.
const pEx = { ...sideDef, dSmall: 210, dLarge: 250, length: 4.2, thickCore: 50, thickSide: 25,
  kerf: 2.5, pattern: "cant", cantWidth: 155, sideWidth: 150,
  mcSap: 140, mcHeart: 40, rhoCore: 400, rhoPerimeter: 460, shrinkVol: 12, heartFrac: 0.6 };
const rEx = E.compute(pEx);
const exFlank = rEx.boards.filter(b => /Side [LR]/.test(b.label));
if (exFlank.length) {
  console.log("FAIL  Ø210 with a 150 mm side board should drop the flank boards, got",
    exFlank.map(b => b.label + " " + b.width + " mm " + b.length.toFixed(2) + " m")); fails++;
} else console.log("PASS  Ø210 + 150 mm side board: flanks dropped (" +
  (rEx.warnings.join(" ").match(/Side R1 \([^)]*\)/) || ["reason"])[0] + ")");
if (rEx.boards.some(b => !b.isCant && b.trim === "edged")) {
  console.log("FAIL  no side board may be edged narrower to save length");
  fails++;
} else console.log("PASS  no board was edged narrower to save length — widths are the sawn product width, " +
  "capped only by the log/cant:", rEx.boards.filter(b => !b.isCant)
    .map(b => b.label + " " + b.width + " mm").join(", "));
// the same log with the 125 mm product width does produce the flanks, cut back
const pEx125 = { ...pEx, sideWidth: 125 };
const ex125 = E.compute(pEx125).boards.filter(b => /Side [LR]/.test(b.label));
if (!(ex125.length === 2 && ex125.every(b => Math.abs(b.width - 125) < 0.01 &&
  b.trim === "cut" && b.length >= 2.5 - 1e-9))) {
  console.log("FAIL  Ø210 + 125 mm side board should give 125 mm flank boards >= 2.5 m, got",
    ex125.map(b => b.label + " " + b.width + " mm " + b.length.toFixed(2) + " m " + b.trim)); fails++;
} else console.log("PASS  Ø210 + 125 mm side board produces the flanks at 125 mm, cut to",
  ex125.map(b => b.length.toFixed(2) + " m").join(" / "));
// no produced board may be shorter than the shortest allowed length
const shortBad = [];
for (const pc of [pDef, pEx, pEx125, pCyl, pMin, { ...pDef, dSmall: 400, dLarge: 460, cantWidth: 250 }]) {
  for (const b of E.compute(pc).boards) {
    if (b.length < Math.min(pc.minBoardLen / 1000, pc.length) - 1e-9) shortBad.push("Ø" + pc.dSmall + " " + b.label);
  }
}
if (shortBad.length) { console.log("FAIL  boards shorter than allowed:", shortBad.join(", ")); fails++; }
else console.log("PASS  no produced board is shorter than the shortest allowed length");
// 9e. cant width is not limited: with the cant field blank the cant is the
// biggest square that fits the small end, so the core rows grow with the log
// (and the number of side boards to go with them). Typed widths are an upper
// cap and must never resaw more rows than the blank form on the same log.
function coreCount(pp) { return E.compute(pp).boards.filter(b => b.isCant).length; }
const pBig50 = { ...pDef, dSmall: 600, dLarge: 650, cantWidth: NaN };
const pBig75 = { ...pBig50, thickCore: 75 };
const nBig50 = coreCount(pBig50), nBig75 = coreCount(pBig75);
const pBigCap = { ...pBig50, cantWidth: 155 };
if (!(nBig50 >= 8)) { console.log("FAIL  blank cant on Ø600/650 @50 mm should give >= 8 core rows, got", nBig50); fails++; }
else console.log("PASS  blank cant on Ø600/650 @50 mm gives", nBig50, "core rows");
if (!(nBig75 >= 5)) { console.log("FAIL  blank cant on Ø600/650 @75 mm should give >= 5 core rows, got", nBig75); fails++; }
else console.log("PASS  blank cant on Ø600/650 @75 mm gives", nBig75, "core rows");
eq("blank cant grows with the log", coreCount({ ...pBig50, dSmall: 300, dLarge: 320 }),
  Math.max(1, Math.floor((Math.SQRT2 * 150 + 2.5) / (50 + 2.5))), 0);
if (!(coreCount(pBigCap) <= nBig50)) {
  console.log("FAIL  a 155 mm cap must not add core rows versus the blank form"); fails++;
} else console.log("PASS  typed cant width caps the blank form (" + coreCount(pBigCap) + " <= " + nBig50 + " core rows)");
const rBigBlank = E.compute(pBig50), rBigCap = E.compute(pBigCap);
if (!(rBigBlank.cantWidth > rBigCap.cantWidth + 1)) {
  console.log("FAIL  blank cant should be wider than the 155 mm cap", rBigBlank.cantWidth, rBigCap.cantWidth); fails++;
} else console.log("PASS  blank auto cant is wider (" + rBigBlank.cantWidth + " mm vs " +
  rBigCap.cantWidth + " mm cap), still inside the small end");
const rBigRows = rBigBlank.boards.filter(b => b.isCant);
if (rBigRows.some(b => b.trim !== "full" || Math.abs(b.width - rBigBlank.cantWidth) > Math.SQRT2 + 0.51)) {
  console.log("FAIL  auto-cant core rows must be full length and cant-wide"); fails++;
} else console.log("PASS  auto-cant core rows are full length and", rBigBlank.cantWidth, "mm wide");
if (rBigBlank.boards.some(b => !b.isCant && b.width > Math.min(pBig50.sideWidth, rBigBlank.cantWidth) + 0.01)) {
  console.log("FAIL  side boards wider than the side width / auto cant"); fails++;
} else console.log("PASS  side boards stay within 125 mm and the auto cant");
if (!(rBigBlank.boards.length > 14)) {
  console.log("FAIL  the big log should yield a full breakdown, got", rBigBlank.boards.length, "boards"); fails++;
} else console.log("PASS  big log yields", rBigBlank.boards.length, "boards in total");
// cant = 0 keeps meaning "no cant rows at all"
if (E.compute({ ...pBig50, cantWidth: 0 }).boards.some(b => b.isCant)) {
  console.log("FAIL  cantWidth 0 must give no cant rows"); fails++;
} else console.log("PASS  cantWidth 0 still means no cant");

// tighter wane limits can only reduce the solid volume
const volOf = w => E.compute({ ...pDef, waneWidthFrac: w, waneThickFrac: 1 })
  .boards.reduce((s, b) => s + b.volume, 0);
if (!(volOf(0.1) <= volOf(0.33) + 1e-12 && volOf(0.33) <= volOf(0.9) + 1e-12)) {
  console.log("FAIL  tighter wane limits must not raise the volume:", volOf(0.1), volOf(0.33), volOf(0.9)); fails++;
} else console.log("PASS  volume falls as the wane limits tighten (",
  (1000 * volOf(0.1)).toFixed(1), "<=", (1000 * volOf(0.33)).toFixed(1), "<=",
  (1000 * volOf(0.9)).toFixed(1), "L)");

// 10. heartwood fraction sampling: deterministic, in range, correct moments
const s1 = E.sampleHeartFrac(0.3, 0.7, 1000, 42);
const s2 = E.sampleHeartFrac(0.3, 0.7, 1000, 42);
const same = s1.every((v, i) => v === s2[i]);
if (!same) { console.log("FAIL  sampler not deterministic"); fails++; }
else console.log("PASS  sampler deterministic (seeded)");
const inRange = s1.every(v => v >= 0.3 && v <= 0.7);
if (!inRange) { console.log("FAIL  samples outside [min,max]"); fails++; }
else console.log("PASS  all 1000 samples within [0.3, 0.7]");
const mMean = s1.reduce((s, v) => s + v, 0) / s1.length;
const mSd = Math.sqrt(s1.reduce((s, v) => s + (v - mMean) * (v - mMean), 0) / s1.length);
eq("sample mean ~ (0.3+0.7)/2", mMean, 0.5, 0.02);
eq("sample sd ~ (max-min)/4", mSd, 0.1, 0.02);

// 11. distribution build sanity: MC of a pure-heartwood board independent of frac?
// cant rows near pith keep heart% ~ constant; bark-side boards lose sapwood as
// frac grows -> their MC must DECREASE with increasing heartFrac.
const pd = { dSmall: 400, dLarge: 400, length: 4, thickCore: 50, thickSide: 50, kerf: 3,
  pattern: "tnt", cantWidth: 0, mcSap: 120, mcHeart: 55, rhoCore: 400, rhoPerimeter: 400, shrinkVol: 0,
  heartFracMin: 0.4, heartFracMax: 0.9 };
// top board spans y=[134,184] mm; rh=0.4*200=80 -> pure sapwood (MC 120),
// rh=0.9*200=180 -> almost fully heartwood (MC ~55)
const lo = E.compute({ ...pd, heartFrac: 0.4 }), hi = E.compute({ ...pd, heartFrac: 0.9 });
if (!(hi.boards[0].mc < lo.boards[0].mc)) { console.log("FAIL  bark-side MC should fall as heartwood grows"); fails++; }
else console.log("PASS  bark-side board MC decreases with heartwood fraction (",
  fmt(lo.boards[0].mc), "->", fmt(hi.boards[0].mc), ")");

// 12. oven-dry (basic) density per board: consistency + radial model
const bo = lo.boards[0];
eq("rhoOvenDry = dryMass/volume", bo.rhoOvenDry, bo.dryMass / bo.volume);
// constant-density wood (core == perimeter): board density must equal 400
eq("uniform wood -> board rho = 400", E.compute({ ...pd, heartFrac: 0.5 }).boards[0].rhoOvenDry, 400, 0.5);
// linear radial gradient 300 (core) -> 500 (perimeter): density independent
// of the sampled heartFrac (deterministic per board), and outer boards
// must be denser than inner boards.
const pGrad = { ...pd, rhoCore: 300, rhoPerimeter: 500 };
const rr1 = E.compute({ ...pGrad, heartFrac: 0.3 });
const rr2 = E.compute({ ...pGrad, heartFrac: 0.9 });
eq("board rho independent of heartFrac (outer board)", rr1.boards[0].rhoOvenDry, rr2.boards[0].rhoOvenDry, 0.5);
if (!(rr2.boards[0].rhoOvenDry > rr2.boards[Math.floor(rr2.boards.length / 2)].rhoOvenDry)) {
  console.log("FAIL  outer board should be denser than centre board"); fails++;
} else console.log("PASS  outer board denser than centre board (",
  fmt(rr2.boards[0].rhoOvenDry), ">", fmt(rr2.boards[Math.floor(rr2.boards.length / 2)].rhoOvenDry), ")");
// analytic check: mean of rho(r)=300+200r/R over a FULL disc is
// 300 + 200*(2/3) = 433.3 (mean radius of a disc = 2R/3). Use rectRadial
// on the full square bounding the disc.
const g = E.rectRadial(-200, 200, -200, 200, 200, 0, 200);
eq("rectRadial disc area = pi*R^2", g.a, Math.PI * 200 * 200, 400);
eq("rectRadial disc mean r = 2R/3", g.rs / g.a, 2 * 200 / 3, 1.5);
eq("full-disc mean density of linear gradient", 300 + (500 - 300) * (g.rs / g.a) / 200, 300 + 200 * 2 / 3, 2);
// compute() wiring: independent numeric integration over the top band
// [-100,100] of a 400 mm log, rho(r)=300+200r/200
const band = E.compute({ ...pGrad, heartFrac: 0.0, dSmall: 400, dLarge: 400,
  thickCore: 200, thickSide: 200, kerf: 0, length: 1 });
let iArea = 0, iRho = 0;
const NQ = 400;
for (let iy = 0; iy < NQ; iy++) {
  const y = -100 + (iy + 0.5) * 200 / NQ;
  for (let ix = 0; ix < NQ; ix++) {
    const x = -173.205 + (ix + 0.5) * (2 * 173.205) / NQ; // chord at y=100
    const rr = Math.hypot(x, y);
    if (rr <= 200) { iArea++; iRho += 300 + 200 * rr / 200; }
  }
}
const expMean = iRho / iArea; // kg/m3 (unit cell areas cancel)
eq("band mean density vs independent integration", band.boards[0].rhoOvenDry, expMean, expMean * 0.01);
// 13. oven-dry-volume density convention: with shrinkVol s, reported
// rhoOvenDry must equal oven-dry mass / (green volume * (1-s/100)).
const ps = { ...pd, rhoCore: 400, rhoPerimeter: 400, shrinkVol: 10, heartFrac: 0.5 };
const bs = E.compute(ps).boards[0];
eq("rhoOD (OD volume) = 400 with shrinkVol 10", bs.rhoOvenDry, 400, 1);
// green density must satisfy rhoGreen = rhoOD * (1-s/100) * (1+MC/100)
eq("rhoGreen = rhoOD*odF*(1+MC)", bs.rhoGreen, bs.rhoOvenDry * 0.9 * (1 + bs.mc / 100), 1e-6 * 400);
// internal basic density must be rhoOD * odF -> dry mass check
eq("dry mass = rhoOD*odF*greenVol", bs.dryMass, 400 * 0.9 * bs.volume, 1e-6);
// MC independent of shrinkage convention
const bs0 = E.compute({ ...pd, rhoCore: 400, rhoPerimeter: 400, shrinkVol: 0, heartFrac: 0.5 }).boards[0];
eq("MC unchanged by shrinkage convention", bs.mc, bs0.mc, 1e-9);

// 14. between-log density sampling: within-log range = 0.7 x species range,
// log range always inside the species range
const dl = E.sampleLogDensity(400, 500, 1000, 43);
const dl2 = E.sampleLogDensity(400, 500, 1000, 43);
if (!dl.cores.every((v, i) => v === dl2.cores[i])) { console.log("FAIL  log-density sampler not deterministic"); fails++; }
else console.log("PASS  log-density sampler deterministic (seeded)");
const rangeOk = dl.cores.every((c, i) => Math.abs((dl.pers[i] - c) - 70) < 1e-9);
if (!rangeOk) { console.log("FAIL  within-log density range != 0.7 x species range"); fails++; }
else console.log("PASS  every log's radial density range = 0.7 x species range (70)");
const densInRange = dl.cores.every((c, i) => c >= 400 && dl.pers[i] <= 500);
if (!densInRange) { console.log("FAIL  log density range outside species range"); fails++; }
else console.log("PASS  all log ranges inside species range (400-500):",
  fmt(Math.min(...dl.cores)), "-", fmt(Math.max(...dl.pers)));
eq("log core density centred on allowed midpoint", dl.cores.reduce((s, v) => s + v, 0) / dl.cores.length, 415, 3);

// 15. between-log MC sampling: SD = 5 % of given value, floored at 1 %
const ms = E.sampleMc(120, 1000, 44);
const ms2 = E.sampleMc(120, 1000, 44);
if (!ms.every((v, i) => v === ms2[i])) { console.log("FAIL  MC sampler not deterministic"); fails++; }
else console.log("PASS  MC sampler deterministic (seeded)");
const mcMean = ms.reduce((s, v) => s + v, 0) / ms.length;
const mcSd = Math.sqrt(ms.reduce((s, v) => s + (v - mcMean) * (v - mcMean), 0) / ms.length);
eq("MC mean ~ given value", mcMean, 120, 1.5);
eq("MC sd ~ 5 % of given value", mcSd, 6, 0.8);
if (!ms.every(v => v >= 1)) { console.log("FAIL  MC values below 1 %"); fails++; }
else console.log("PASS  all MC samples >= 1 %");

function fmt(x) { return Number(x).toFixed(1); }
console.log(fails ? `\n${fails} FAILURE(S)` : "\nALL TESTS PASSED");
process.exit(fails ? 1 : 0);

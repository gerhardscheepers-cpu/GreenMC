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
  edgeTrim: 0, pattern: "tnt", cantWidth: 0,
  mcSap: 100, mcHeart: 50, rhoCore: 400, rhoPerimeter: 400, shrinkVol: 0, heartFrac: 0.5 };

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

// 5. mixed MC check ... mass/volume conservation at board level:
//    volume must equal rectRadial area x length; greenWeight = dry+water
r = E.compute({ ...p1, heartFrac: 0.4, dLarge: 300, pattern: "cant", cantWidth: 60 });
const Rmean5 = (p1.dSmall + 300) / 4, rh5 = Rmean5 * 0.4;
const layout5 = E.buildLayout({ ...p1, heartFrac: 0.4, dLarge: 300, pattern: "cant", cantWidth: 60 });
const volCheck = r.boards.reduce((s, b, i) => {
  const a = E.rectRadial(layout5[i].x1, layout5[i].x2, layout5[i].y1, layout5[i].y2, Rmean5, rh5).a;
  return s + (b.volume - a * 1e-6 * p1.length);
}, 0);
eq("volume = rectRadial area x length (all boards)", volCheck, 0, 1e-9);
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

// 9b. core/side board thicknesses and wane side boards.
//     Defaults: Ø220 + cant 155 = inscribed square -> previously no side
//     boards at all; with wane allowed we must get side boards on both
//     flanks and above/below the cant, sawn to the side thickness.
const pDef = { dSmall: 220, dLarge: 250, length: 4.2, thickCore: 50, thickSide: 25,
  kerf: 2.5, edgeTrim: 0, pattern: "cant", cantWidth: 155,
  mcSap: 120, mcHeart: 40, rhoCore: 455, rhoPerimeter: 568, shrinkVol: 12, heartFrac: 0.45 };
const dDef = E.compute(pDef).boards;
const dCore = dDef.filter(b => b.isCant), dSide = dDef.filter(b => !b.isCant);
const cwDef = Math.min(pDef.cantWidth, Math.SQRT2 * pDef.dSmall / 2);
if (!(dCore.length >= 2 && dSide.length >= 4)) {
  console.log("FAIL  expected core rows + wane side boards, got", dCore.length, "core,", dSide.length, "side"); fails++;
} else console.log("PASS  Ø220/cant 155 yields", dCore.length, "core +", dSide.length, "side boards (wane)");
if (dCore.some(b => Math.abs(b.thickness - pDef.thickCore) > 0.01)) {
  console.log("FAIL  core board thickness != thickCore"); fails++;
} else console.log("PASS  core boards sawn to core thickness", pDef.thickCore, "mm");
if (dSide.some(b => Math.abs(b.thickness - pDef.thickSide) > 0.01)) {
  console.log("FAIL  side board thickness != thickSide"); fails++;
} else console.log("PASS  side boards sawn to side thickness", pDef.thickSide, "mm");
// edging rule: nothing sawn wider than the cant
const overW = [...dCore, ...dSide].filter(b => b.width > cwDef + 0.01);
if (overW.length) { console.log("FAIL  board wider than cant:", overW.map(b => b.label + " " + b.width)); fails++; }
else console.log("PASS  no board wider than the cant (max width",
  Math.max(...[...dCore, ...dSide].map(b => b.width)), "<= " + cwDef.toFixed(0) + " mm)");
// side boards must exist above AND below the cant, and on both flanks
if (!(dSide.some(b => b.y1 >= cwDef / 2 - 1) && dSide.some(b => b.y2 <= -cwDef / 2 + 1))) {
  console.log("FAIL  missing side boards above/below the cant"); fails++;
} else console.log("PASS  side boards above and below the cant");
// flank boards are the vertical ones (Side R…/Side L…) beside the cant
const flank = dSide.filter(b => /Side [LR]/.test(b.label));
if (!(flank.some(b => /Side R/.test(b.label)) && flank.some(b => /Side L/.test(b.label)))) {
  console.log("FAIL  missing flank side boards L/R"); fails++;
} else console.log("PASS  flank side boards present:", flank.map(b => b.label).join(", "));
// wane must be real: a side board corner outside the log circle but volume > 0
const waneOk = dSide.some(b => b.volume > 0 &&
  (Math.hypot(b.x1, b.y1) > pDef.dSmall / 2 + 0.5 || Math.hypot(b.x2, b.y2) > pDef.dSmall / 2 + 0.5));
if (!waneOk) { console.log("FAIL  no wane detected in side boards"); fails++; }
else console.log("PASS  wane allowed: side board volume clipped to the log (area still counted)");

// 9c. through-and-through uses the core thickness for every board
const tntC = E.compute({ ...pDef, pattern: "tnt", cantWidth: 0 }).boards;
if (tntC.some(b => Math.abs(b.thickness - pDef.thickCore) > 0.01)) {
  console.log("FAIL  live-sawn board thickness != thickCore"); fails++;
} else console.log("PASS  live sawing uses core thickness for all boards");

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
const pd = { dSmall: 400, dLarge: 400, length: 4, thickCore: 50, thickSide: 50, kerf: 3, edgeTrim: 10,
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
  thickCore: 200, thickSide: 200, kerf: 0, edgeTrim: 0, length: 1 });
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

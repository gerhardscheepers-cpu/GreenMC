import { readFileSync } from "fs";
import vm from "vm";
const html = readFileSync("index.html", "utf8");
const engineSrc = html.match(/<script id="engine">([\s\S]*?)<\/script>/)[1];
const uiSrc = html.match(/<script id="ui">([\s\S]*?)<\/script>/)[1];

// ---------- minimal but faithful DOM stub ----------
// In a browser <input>.value is always a string (readParams' num() coerces it)
// and a <select>'s value is its selected / first option. Mirroring that here
// means the load-time run() exercises exactly the code path a browser does.
function attrs(tag) {
  const a = {};
  tag.replace(/([\w-]+)="([^"]*)"/g, (m, k, v) => { a[k] = v; return m; });
  return a;
}
const inputDefaults = new Map();
for (const m of html.matchAll(/<input\b[^>]*>/g)) {
  const a = attrs(m[0]);
  if (a.id) inputDefaults.set(a.id, a.value === undefined ? "" : a.value);
}
function selectDefault(id) {
  const m = html.match(new RegExp('<select[^>]*id="' + id + '"[^>]*>([\\s\\S]*?)</select>'));
  if (!m) return "";
  const sel = m[1].match(/<option[^>]*\bselected\b[^>]*>/);
  if (sel) return attrs(sel[0]).value || "";
  const first = m[1].match(/<option[^>]*>/);
  return first ? (attrs(first[0]).value || "") : "";
}
const mkClassList = () => {
  const s = new Set();
  return { add: c => s.add(c), remove: c => s.delete(c), contains: c => s.has(c), _s: s };
};
const elems = {};
const doc = {
  getElementById(id) {
    if (elems[id]) return elems[id];
    const n = {
      id, innerHTML: "", textContent: "", style: {}, classList: mkClassList(),
      value: inputDefaults.has(id) ? inputDefaults.get(id) : selectDefault(id),
      addEventListener() {}, setAttribute() {}, getAttribute() { return null; },
      // <select> behaviour: the first appended <option> becomes the value
      appendChild(c) { if (this.id === "species" && c && !this.value) this.value = String(c.value); },
      querySelector() { return null; }, querySelectorAll() { return []; }
    };
    elems[id] = n;
    return n;
  },
  createElement: () => ({
    value: "", textContent: "", style: {}, classList: mkClassList(),
    addEventListener() {}, appendChild() {}, setAttribute() {}
  }),
  addEventListener() {}, querySelector() { return null; }, querySelectorAll() { return []; }
};
const ctx = { document: doc, window: { print() {}, addEventListener() {} }, console };
vm.createContext(ctx);
const E = vm.runInContext(engineSrc + ";ENGINE;", ctx);
vm.runInContext(uiSrc, ctx); // init(): species options + applySpecies + run() on load

// ---------- 1. load-time simulation: the page must self-calculate ----------
let fails = 0;
const chk = (name, ok) => { console.log((ok ? "PASS" : "FAIL") + " - " + name); if (!ok) fails++; };
const tbl = () => elems["boardTable"].innerHTML;

chk("load: default log/board inputs exactly as specified",
  elems["dSmall"].value === "220" && elems["dLarge"].value === "250" &&
  elems["length"].value === "4.2" && elems["pattern"].value === "cant" &&
  elems["thickCore"].value === "50" && elems["thickSide"].value === "25" && elems["kerf"].value === "2.5" &&
  elems["edgeTrim"].value === "0" && elems["cantWidth"].value === "155");
chk("load: species select defaulted to a library entry", !!E.SPECIES[elems["species"].value]);
chk("load: results table rendered automatically", /<table/.test(tbl()) && !/Enter inputs/.test(tbl()));
chk("load: no validation warning", !/check the highlighted/.test(tbl()));
chk("load: no NaN in table", !/NaN/.test(tbl()));
chk("load: total volume line present", /Total lumber volume/.test(tbl()));
chk("load: cross-section rendered (3 circles)", (elems["cross"].innerHTML.match(/<circle/g) || []).length === 3);
chk("load: MC histogram rendered", /Moisture content distribution/.test(elems["chart"].innerHTML));
chk("load: density histogram rendered", /Oven-dry density distribution/.test(elems["chartRho"].innerHTML));
chk("load: board-selection checkboxes rendered", /type="checkbox"/.test(elems["boardSelect"].innerHTML));
chk("load: calculation used 1000 logs", /from 1000 runs/.test(elems["chart"].innerHTML));
const loadBoards = vm.runInContext("LAST.base.boards.length", ctx);
console.log("  (defaults 220/250 mm · 4.2 m · 50 mm core / 25 mm side · kerf 2.5 · cant 155 -> " +
  loadBoards + " items, " + (tbl().match(/<tr>/g) || []).length + " table rows)");

const p = { species: "Scots pine", dSmall: 400, dLarge: 460, length: 4.8,
  thickCore: 50, thickSide: 25, kerf: 3.4, edgeTrim: 10, pattern: "cant", cantWidth: 240,
  mcSap: 120, mcHeart: 55, rhoMin: 380, rhoMax: 440, shrinkVol: 12,
  heartFracMin: 0.35, heartFracMax: 0.55 };
// run the Monte-Carlo + full render via the UI layer (20 runs for speed)
vm.runInContext(`
  LAST = { p: ${JSON.stringify(p)}, ...buildDistribution(${JSON.stringify(p)}, 20) };
  LAST.sel = LAST.perBoard.map(() => true);
  renderAll();
`, ctx);
const r = LAST_base(); // helper below
function LAST_base() { return vm.runInContext("LAST.base", ctx); }
const cross = elems["cross"].innerHTML;
console.log("svg length:", cross.length);
console.log("has circles:", (cross.match(/<circle/g) || []).length, "(expect 3: log + Hmax + Hmin)");
console.log("has H labels:", cross.includes("Hmin") && cross.includes("Hmax"));
console.log("has rects:", (cross.match(/<rect/g) || []).length, "(items:" + r.boards.length + ")");
console.log("no NaN:", !/NaN/.test(cross));

// chart labels must use the same short tags as the cross-section
const chart = elems["chart"].innerHTML;
const tags = r.boards.map(shortTagOf);
let chartOk = tags.every(t => chart.includes(t));
console.log("chart mentions every selected board tag:", chartOk, "|", tags.join(","));
if (!chartOk) fails = (fails || 0) + 1;
console.log("histogram parts:", ["Avg.", "SDev.", "Min.", "Max.", "Moisture content distribution"]
  .every(k => chart.includes(k)) ? "present" : "MISSING");
console.log("histogram bins:", (chart.match(/<rect/g) || []).length);

// oven-dry density histogram: exists, has stats, x-label, same pooled count
const chartRho = elems["chartRho"].innerHTML;
console.log("rho histogram parts:", ["Oven-dry density distribution", "Avg.", "SDev.", "Min.", "Max.", "kg/m³"]
  .every(k => chartRho.includes(k)) ? "present" : "MISSING");
console.log("rho histogram bins:", (chartRho.match(/<rect/g) || []).length);
const pooledRhoVals = (chartRho.match(/· (\d+) values from/) || [])[1];
console.log("rho histogram pools values from runs:", pooledRhoVals === String(r.boards.length * 20),
  "(" + pooledRhoVals + ", expect " + r.boards.length * 20 + ")");

// densities must stay within the species range across all runs/boards
const allRho = vm.runInContext("LAST.perBoard.flatMap(pb => pb.rhos)", ctx);
const inBounds = allRho.every(v => v >= p.rhoMin - 1e-6 && v <= p.rhoMax + 1e-6);
console.log("all densities within species range:", inBounds,
  "(" + Math.min(...allRho).toFixed(0) + "-" + Math.max(...allRho).toFixed(0) + " vs " + p.rhoMin + "-" + p.rhoMax + ")");

function shortTagOf(b) {
  return b.label.replace("Core ", "C").replace("Side R", "R")
    .replace("Side L", "L").replace("Side ", "S");
}

// selection interplay: deselect all but one board -> fewer pooled values
vm.runInContext("LAST.sel = LAST.perBoard.map((b, i) => i === 1); renderHistogram(); renderRhoHistogram();", ctx);
const chart1 = elems["chart"].innerHTML;
console.log("single-board histogram has values line:", /values from \d+ runs/.test(chart1));
const chartRho1 = elems["chartRho"].innerHTML;
const p1 = (chart1.match(/(\d+) values from/) || [])[1];
const p2 = (chartRho1.match(/(\d+) values from/) || [])[1];
console.log("single-board pooling consistent:", p1 === p2 && p1 === "20", "(MC " + p1 + ", rho " + p2 + " values)");

// geometry check: board rects may include wane (corners outside the circle
// is realistic for through-and-through sawing; area math clips to the log),
// but corners must stay within the log's bounding square.
const Rsmall = p.dSmall / 2, bound = Math.SQRT2 * Rsmall + 0.01;
let ok = true;
for (const b of r.boards) {
  const corners = [[b.x1, b.y1], [b.x2, b.y1], [b.x1, b.y2], [b.x2, b.y2]];
  for (const [x, y] of corners)
    if (Math.hypot(x, y) > bound) { ok = false; console.log("OUTSIDE:", b.label, x, y); }
}
console.log("all board corners within log bounding square:", ok);
// the cant itself (green item) must lie fully inside the log circle
const cant = r.boards.find(b => b.isCant);
const cantIn = Math.hypot(cant.x2, cant.y2) <= Rsmall + 0.01;
console.log("cant fully inside log circle:", cantIn);
console.log("cant present:", !!cant, "| warnings:", r.warnings.length);

// edging rule: no side board may be wider than the cant width
const cwUsed = Math.min(p.cantWidth, Math.SQRT2 * Rsmall);
const tooWide = r.boards.filter(b => b.orient === "h" && !b.isCant && (b.x2 - b.x1) > cwUsed + 1e-9);
chk("no side board wider than the cant (" + cwUsed.toFixed(0) + " mm)",
  tooWide.length === 0);
// side boards must be sawn to the side-board thickness
const sideH = r.boards.filter(b => b.orient === "h" && !b.isCant);
chk("side boards sawn to side-board thickness", sideH.every(b => Math.abs(b.thickness - p.thickSide) < 0.01));
// wane is expected in live sawing: bark-side boards reach past the circle
const tnt = vm.runInContext("JSON.stringify(ENGINE.compute(" +
  JSON.stringify({ ...p, pattern: "tnt", cantWidth: 0 }) + ").boards)", ctx);
const tntBoards = JSON.parse(tnt);
const wane = tntBoards.some(b => Math.hypot(b.x2, b.y1) > Rsmall + 0.5);
chk("wane allowed (bark-side corners outside log circle, live sawing)", wane);

// ---------- summary ----------
console.log(fails === 0 ? "\nALL UI CHECKS PASSED" : "\n" + fails + " UI CHECK(S) FAILED");
process.exitCode = fails ? 1 : 0;

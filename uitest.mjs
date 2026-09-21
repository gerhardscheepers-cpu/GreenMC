import { readFileSync } from "fs";
import vm from "vm";
const html = readFileSync("index.html", "utf8");
const engineSrc = html.match(/<script id="engine">([\s\S]*?)<\/script>/)[1];
const uiSrc = html.match(/<script id="ui">([\s\S]*?)<\/script>/)[1];

// minimal DOM stub: getElementById returns an object capturing innerHTML
const elems = {};
const doc = {
  getElementById: id => (elems[id] = elems[id] || {
    innerHTML: "", value: "Scots pine (Pinus sylvestris)", textContent: "",
    addEventListener() {}, appendChild() {}
  }),
  createElement: () => ({
    value: "", textContent: "", appendChild() {}
  })
};
const ctx = { document: doc, window: {} };
vm.createContext(ctx);
const E = vm.runInContext(engineSrc + ";ENGINE;", ctx);
vm.runInContext(uiSrc, ctx); // runs init(): needs #species etc -> stubs fine

const p = { species: "Scots pine", dSmall: 400, dLarge: 460, length: 4.8,
  thickness: 50, kerf: 3.4, edgeTrim: 10, pattern: "cant", cantWidth: 240,
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
console.log("rho histogram pools values from runs:", pooledRhoVals === "160", "(" + pooledRhoVals + ")");

// densities must stay within the species range across all runs/boards
const allRho = vm.runInContext("LAST.perBoard.flatMap(pb => pb.rhos)", ctx);
const inBounds = allRho.every(v => v >= p.rhoMin - 1e-6 && v <= p.rhoMax + 1e-6);
console.log("all densities within species range:", inBounds,
  "(" + Math.min(...allRho).toFixed(0) + "-" + Math.max(...allRho).toFixed(0) + " vs " + p.rhoMin + "-" + p.rhoMax + ")");

function shortTagOf(b) {
  return b.isCant ? b.label.replace("Cant row ", "C")
    : b.label.startsWith("Side") ? b.label.replace("Side ", "")
    : b.label.replace("Board ", "B");
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

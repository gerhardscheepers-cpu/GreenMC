# GreenDensMC — Green moisture content and oven dry density estimator

A single-file browser tool (no install, no dependencies, works offline) that gives
sawmill staff a rough estimate of the **green moisture content (MC)** and **oven-dry
density** of lumber before or after sawing, from:

- log dimensions (small-end / large-end diameter, length),
- the sawing pattern (through-and-through, or cant + side boards) with **core board
  thickness**, **side board thickness**, kerf and cant width,
- **side board** settings: product **width**, **shortest board length** and the two
  **wane limits** (maximum wane fraction of the width / of the thickness),
- species properties: sapwood/heartwood green MC, species minimum/maximum
  oven-dry density, heartwood diameter range, volumetric shrinkage.

## Usage

Open `index.html` in any browser and press **Calculate**. Everything runs locally
in the page; nothing is uploaded.

For online use, the app is served by GitHub Pages at:

> https://gerhardscheepers-cpu.github.io/GreenMC/

(the page can also be embedded in another site, e.g. Wix, via an iframe).

## Model

1. **Layout** — a symmetric board layout is generated on the log cross-section
   (small end). Through-and-through centres boards of the core thickness on the
   pith. The cant pattern resaws the cant into **core boards** (core thickness,
   labelled `Core 1…n`) and adds **side boards**:
   - the boards above and below the cant (`Side 1…n`), and
   - the boards on both flanks (`Side R1`, `Side L1`).

   Side boards are sawn to the **side board thickness** and to the **side board
   width** (never wider than the cant, and never wider than the log's chord at
   their inner face at the small end). A cant wider than the inscribed square
   (√2 × radius) is clamped with a warning. Where the log boundary cuts a board
   corner the board keeps its sawn dimensions but only the wood inside the log
   counts (wane) — see the wane rule below.
2. **Wane rule (side boards)** — wane is measured as a fraction of the board's
   own width (wood missing across the outer face) and of its thickness (wood
   missing at the width edge). Both must stay within the two limits. Because the
   log tapers, the wane shrinks towards the large end, so a board is **cut back
   from the small end** to the point where the limits are met and the rest of the
   log is used. If what is left is shorter than the **shortest board length**, the
   board is **not produced at all** (a side board is never edged down to a
   narrower board); such boards are reported as warnings. A cylindrical log can
   therefore produce no side boards at all. Core boards sit inside the inscribed
   square, are wane-free and use the full log length.
3. **Between-log variation (Monte Carlo, 1000 logs)** — for every simulated log:
   - heartwood fraction ~ Normal((min + max)/2, (max − min)/4), kept within
     [min, max],
   - the log's radial density range is **0.7 × (species max − min density)** and
     is placed randomly (normal, rejection-sampled) inside the species density
     range, so log densities can never fall outside the species bounds,
   - sapwood and heartwood MC ~ Normal(given value, SD = 5 % of it), floored
     at 1 %.
   Sampling is seeded (mulberry32 + Box–Muller) and therefore reproducible.
4. **Per-board integration** — each board is sampled at 24 stations along the part of
   the log it uses, and its cross-section is integrated there on a 60×60 midpoint
   grid. The log radius at each station follows the linear taper, so the wood that
   is outside the log (wane) and the extra wood the board gains towards the large
   end are both accounted for. Area and ∫r·dA give the oven-dry mass under a
   linear radial density profile ρ(r) = ρ_core + (ρ_perimeter − ρ_core)·r/R, and
   the heartwood-area fraction gives the dry-mass-weighted MC
   MC = (m_water / m_dry) · 100.
5. **Outputs** — per-board table (thickness, **width sawn**, **width solid**,
   **length**, how wane was trimmed, heartwood/sapwood %, MC avg with min–max,
   oven-dry density avg with SD), totals for **lumber volume** (boards as sawn),
   **solid wood** and log volume with the **recovery %**, a cross-section drawing
   at mid-length showing board placement and the Hmin/Hmax heartwood circles, and
   two histograms (moisture content and oven-dry density) that pool the values of
   any selected subset of boards over all 1000 logs. Results can be exported as
   CSV or printed.

## Assumptions & accuracy

- circular cross-section; linear taper between the two end diameters, board widths
  limited by the small end; no within-zone MC gradient; core boards run the full
  log length, side boards are cut back to the wane limits;
- oven-dry density = oven-dry mass / oven-dry **volume**; the species-library
  volumetric shrinkage (green → oven-dry) exists only for volume conversion and
  does not affect board densities or MC;
- species values are class defaults (USDA Wood Handbook FPL-GTR-282 for the
  North American species; plantation-hardwood literature ranges for acacia,
  eucalypts, rubberwood and teak) — **calibrate them against your own mill
  measurements**;
- expected accuracy roughly ±10–15 % on MC — suitable for charge planning,
  kiln-load estimates and logistics, **not** for payment grading.

## Tests

With Node.js installed:

```
node test.mjs     # engine math: limiting cases, analytic integrals, conservation,
                  # layout geometry, wane trimming, samplers (72 checks)
node uitest.mjs   # full UI render against a DOM stub: table, cross-section, both
                  # histograms, board selection, wane warnings (25 checks)
```

Both extract the engine/UI scripts straight out of `index.html`, so the shipped
file is exactly what is tested.

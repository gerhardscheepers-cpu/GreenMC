# GreenDensMC — Green moisture content and oven dry density estimator

A single-file browser tool (no install, no dependencies, works offline) that gives
sawmill staff a rough estimate of the **green moisture content (MC)** and **oven-dry
density** of lumber before or after sawing, from:

- log dimensions (small-end / large-end diameter, length),
- the sawing pattern (through-and-through, or cant + side boards) with board
  thickness, kerf, edge trim and cant width,
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
   (small end). Through-and-through centres a board on the pith; the cant
   pattern resaws the cant into rows of the chosen thickness and adds vertical
   side boards on both flanks. Board widths are limited by the small-end chord,
   and a cant wider than the inscribed square (√2 × radius) is clamped with a
   warning.
2. **Between-log variation (Monte Carlo, 1000 logs)** — for every simulated log:
   - heartwood fraction ~ Normal((min + max)/2, (max − min)/4), kept within
     [min, max],
   - the log's radial density range is **0.7 × (species max − min density)** and
     is placed randomly (normal, rejection-sampled) inside the species density
     range, so log densities can never fall outside the species bounds,
   - sapwood and heartwood MC ~ Normal(given value, SD = 5 % of it), floored
     at 1 %.
   Sampling is seeded (mulberry32 + Box–Muller) and therefore reproducible.
3. **Per-board integration** — each board's cross-section is integrated on a
   60×60 midpoint grid: area and ∫r·dA give the oven-dry mass under a linear
   radial density profile ρ(r) = ρ_core + (ρ_perimeter − ρ_core)·r/R, and the
   heartwood-area fraction gives the dry-mass-weighted MC
   MC = (m_water / m_dry) · 100.
4. **Outputs** — per-board table (dimensions, heartwood/sapwood %, MC avg with
   min–max, oven-dry density avg with SD), a cross-section drawing at mid-length
   showing board placement and the Hmin/Hmax heartwood circles, and two
   histograms (moisture content and oven-dry density) that pool the values of
   any selected subset of boards over all 1000 logs. Results can be exported as
   CSV or printed.

## Assumptions & accuracy

- circular cross-section; taper handled via the mean-section radius; no
  within-zone MC gradient; boards run full length;
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
node test.mjs     # engine math: limiting cases, analytic integrals,
                  # conservation, samplers (48 checks)
node uitest.mjs   # full UI render against a DOM stub: table, cross-section,
                  # both histograms, board selection
```

Both extract the engine/UI scripts straight out of `index.html`, so the shipped
file is exactly what is tested.

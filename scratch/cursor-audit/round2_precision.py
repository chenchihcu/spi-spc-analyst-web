#!/usr/bin/env python3
"""90 vs 120 µm height% quantization effect on displayed mc (independent)."""
import json
import math
from pathlib import Path

import numpy as np

rows = json.loads(Path("/workspace/artifacts/round1-rows.json").read_text())
SPEC_H = {"lsl": 75, "usl": 125}


def robust(vals):
    m = float(np.median(vals))
    ad = np.abs(np.asarray(vals, float) - m)
    s = float(np.quantile(ad, 0.5)) * 1.4826
    if not (s > 1e-9):
        s = float(np.std(vals, ddof=1)) if len(vals) > 1 else 1e-9
    if not (s > 1e-9):
        s = 1e-9
    return m, s


def mc_for_group(g, stencil_um):
    gr = [r for r in rows if r["group"] == g]
    pads = {}
    for r in gr:
        pads.setdefault(r["pad"], []).append(r)
    P = []
    for pad, rs in pads.items():
        if len(rs) < 5:
            continue
        vals = []
        for r in rs:
            h = round(r["height"] if "height" in r and r.get("height") else r["hpct"] * 120 / 100, 2)
            # height not in slim rows - use hpct@120 back-convert
            h_um = round(r["hpct"] * 120 / 100, 2)
            hpct = round(h_um / stencil_um * 1000) / 10
            vals.append(hpct)
        m, s = robust(vals)
        cpk = min(SPEC_H["usl"] - m, m - SPEC_H["lsl"]) / (3 * s)
        P.append(cpk)
    if len(P) < 2:
        return None
    return float(np.median(P))


# slim rows lack height - re-derive from hpct@120 baseline
def mc_from_baseline_hpct(g, stencil_um):
    gr = [r for r in rows if r["group"] == g]
    pads = {}
    for r in gr:
        pads.setdefault(r["pad"], []).append(r)
    P = []
    for pad, rs in pads.items():
        if len(rs) < 5:
            continue
        vals = []
        for r in rs:
            h_um = round(r["hpct"] * 120 / 100, 2)
            hpct = round(h_um / stencil_um * 1000) / 10
            vals.append(hpct)
        m, s = robust(vals)
        cpk = min(SPEC_H["usl"] - m, m - SPEC_H["lsl"]) / (3 * s)
        P.append(cpk)
    return float(np.median(P)) if len(P) >= 2 else None


def fmt2(x):
    return round(x, 2)


out = {}
for g in ["R281", "ED4", "L17", "C94", "ED16"]:
    m90 = mc_from_baseline_hpct(g, 90)
    m120 = mc_from_baseline_hpct(g, 120)
    out[g] = {"mc_90_path": m90, "display_90": fmt2(m90) if m90 is not None else None, "mc_120_path": m120, "display_120": fmt2(m120) if m120 is not None else None}

Path("/workspace/artifacts/round2-precision.json").write_text(json.dumps(out, indent=2))
print(json.dumps(out, indent=2))

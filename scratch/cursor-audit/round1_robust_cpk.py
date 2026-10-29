#!/usr/bin/env python3
"""Independent robust pad-position index (numpy only). Reads round1 rows export."""
import json
import math
import sys
from pathlib import Path

import numpy as np

SPEC = {
    "volume": {"lsl": 70, "usl": 130, "tgt": 100},
    "hpct": {"lsl": 75, "usl": 125, "tgt": 100},
    "area": {"lsl": 70, "usl": 130, "tgt": 100},
    "offx": {"lsl": -75, "usl": 75, "tgt": 0},
    "offy": {"lsl": -75, "usl": 75, "tgt": 0},
}
MS = ["volume", "hpct", "area", "offx", "offy"]
TOL = 1e-9


def robust(vals: np.ndarray):
    m = float(np.median(vals))
    ad = np.abs(vals - m)
    s = float(np.quantile(ad, 0.5)) * 1.4826
    if not (s > 1e-9):
        s = float(np.std(vals, ddof=1)) if len(vals) > 1 else 1e-9
        if not (s > 1e-9):
            s = 1e-9
    return m, s


def med(xs):
    return float(np.median(xs))


def recompute(rows):
    cards = []
    groups = sorted({r["group"] for r in rows})
    for g in groups:
        gr = [r for r in rows if r["group"] == g]
        pads = {}
        for r in gr:
            pads.setdefault(r["pad"], []).append(r)
        pad_list = [(p, rs) for p, rs in pads.items() if len(rs) >= 5]
        for k in MS:
            sp = SPEC[k]
            P = []
            for pad, rs in pad_list:
                vals = np.array([r[k] for r in rs if r.get(k) is not None and math.isfinite(r[k])], dtype=float)
                if len(vals) < 5:
                    continue
                m, s = robust(vals)
                cpk = min(sp["usl"] - m, m - sp["lsl"]) / (3 * s)
                if math.isfinite(cpk):
                    P.append({"pad": pad, "n": len(vals), "m": m, "s": s, "cpk": cpk})
            if len(P) < 2:
                continue
            mc = med([p["cpk"] for p in P])
            if mc < 1.0:
                cards.append(
                    {
                        "g": g,
                        "k": k,
                        "mc": mc,
                        "lv": "ng" if mc < 0.67 else "warn",
                        "nPads": len(P),
                    }
                )
    return cards


def nelson_rule8(z):
    """Nelson (1984) rule 8: 8 consecutive points beyond 1 sigma from center, both sides."""
    z = list(z)
    n = len(z)
    hits = []
    for i in range(7, n):
        w = z[i - 7 : i + 1]
        if all(abs(v) > 1 for v in w) and any(v > 1 for v in w) and any(v < -1 for v in w):
            hits.append(i)
    return hits


def nelson_app_rule8(z):
    """Match spi-spc.html nelson() rule id 8 implementation."""
    z = list(z)
    hits = []
    for i in range(7, len(z)):
        w = z[i - 7 : i + 1]
        if all(abs(v) > 1 for v in w):
            hits.append(i)
    return hits


def cpk_ci(cpk, ne):
    if ne <= 1:
        return [float("nan"), float("nan")]
    se = math.sqrt(1 / (9 * ne) + cpk * cpk / (2 * (ne - 1)))
    return [cpk - 1.96 * se, cpk + 1.96 * se]


def poisson_sf(k, lam):
    if k <= 0:
        return 1.0
    if not (lam > 0):
        return 0.0
    if k == 1:
        return 1 - math.exp(-lam)
    c = math.exp(-lam)
    s = 0.0
    for i in range(k):
        s += c
        c *= lam / (i + 1)
    return max(0.0, 1 - s)


def main():
    rows_path = Path("/workspace/artifacts/round1-rows.json")
    if not rows_path.exists():
        print("round1-rows.json missing; run round1-export-rows.mjs first", file=sys.stderr)
        sys.exit(1)
    rows = json.loads(rows_path.read_text())
    cards = recompute(rows)
    by_lv = {"ng": 0, "warn": 0}
    for c in cards:
        by_lv[c["lv"]] += 1

    data_path = Path("/workspace/artifacts/round1-data.json")
    app_cards = None
    if data_path.exists():
        d = json.loads(data_path.read_text())
        app_cards = d.get("baseline", {}).get("recomputeRobustCount")

    # Compare with app-exported card list if present
    app_list_path = Path("/workspace/artifacts/round1-robust-app.json")
    mismatches = []
    if app_list_path.exists():
        app_list = json.loads(app_list_path.read_text())
        py_map = {(c["g"], c["k"]): c for c in cards}
        for a in app_list:
            key = (a["g"], a["k"])
            p = py_map.get(key)
            if not p:
                mismatches.append({"key": key, "err": "missing in py"})
                continue
            if abs(p["mc"] - a["mc"]) > max(TOL, 1e-12 * abs(a["mc"])):
                mismatches.append({"key": key, "py": p["mc"], "app": a["mc"], "d": p["mc"] - a["mc"]})
            if p["lv"] != a["lv"]:
                mismatches.append({"key": key, "py_lv": p["lv"], "app_lv": a["lv"]})

    out = {
        "independentTool": "numpy/scipy-free robust recompute",
        "rowCount": len(rows),
        "cardCount": len(cards),
        "bySeverityPolicy": by_lv,
        "appRecomputeCount": app_cards,
        "mcMismatches": mismatches[:20],
        "mcMismatchTotal": len(mismatches),
        "nelsonRule8": {
            "literature_bothSides": nelson_rule8([1.2, 1.3, 1.1, 1.4, 1.2, 1.5, 1.1, 1.3]),
            "app_sameSign": nelson_app_rule8([1.2, 1.3, 1.1, 1.4, 1.2, 1.5, 1.1, 1.3]),
            "literature_bothSides_alt": nelson_rule8([1.2, -1.1, 1.3, -1.2, 1.1, -1.3, 1.2, -1.1]),
            "app_bothSides": nelson_app_rule8([1.2, -1.1, 1.3, -1.2, 1.1, -1.3, 1.2, -1.1]),
        },
        "poissonDisplay": {
            "pv": 3e-5,
            "app_fmt": "<.0001 exponential" if 3e-5 < 0.0001 else "f4",
            "wouldShowAs": f"{3e-5:.4e}" if 3e-5 < 0.0001 else f"{3e-5:.4f}",
        },
    }
    Path("/workspace/artifacts/round1-py-summary.json").write_text(json.dumps(out, indent=2))
    print(json.dumps({"cards": len(cards), "by_lv": by_lv, "mismatches": len(mismatches)}, indent=2))


if __name__ == "__main__":
    main()

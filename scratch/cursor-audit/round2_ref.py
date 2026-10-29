#!/usr/bin/env python3
"""Independent reference for Round 2 Codex suspects + chart + quantization."""
import json
import math
from pathlib import Path

import numpy as np

OUT = Path("/workspace/artifacts/round2-py.json")


def nelson4_ref(z):
    z = list(z)
    hits = []
    for i in range(13, len(z)):
        alt = True
        for j in range(i - 11, i + 1):
            if j < 2:
                alt = False
                break
            v0, v1, v2 = z[j - 2], z[j - 1], z[j]
            if not all(math.isfinite(v) for v in (v0, v1, v2)):
                alt = False
                break
            a, b = v1 - v0, v2 - v1
            if a * b >= 0:
                alt = False
                break
        if alt:
            hits.append(i)
    return hits


def poisson_sf_tail(k, lam, terms=2000):
    """P(X >= k) for Poisson(lam) via direct tail sum with lgamma."""
    if k <= 0:
        return 1.0
    if not (lam > 0):
        return 0.0
    s = 0.0
    for j in range(k, k + terms):
        log_p = -lam + j * math.log(lam) - math.lgamma(j + 1)
        s += math.exp(log_p)
        if s > 1:
            return 1.0
        if j > k + 50 and s < 1e-300:
            break
    return min(1.0, max(0.0, s))


def xbar_recompute(rows, metric="volume"):
    by_board = {}
    for r in rows:
        by_board.setdefault(r["board"], []).append(r[metric])
    boards = sorted(by_board.keys())
    means = [float(np.mean(by_board[b])) for b in boards]
    g_mean = float(np.mean(means))  # mean of board means (alternative S03)
    g_mean_all = float(np.mean([r[metric] for r in rows]))  # app: mean all pads
    bmr = [abs(means[i] - means[i - 1]) for i in range(1, len(means))]
    s_b = float(np.mean(bmr)) / 1.128 if bmr else float("nan")
    pts = []
    for i, b in enumerate(boards):
        v = means[i]
        ucl = g_mean_all + 3 * s_b
        lcl = g_mean_all - 3 * s_b
        z = (v - g_mean_all) / s_b if s_b else 0
        pts.append({"lab": b, "v": v, "ucl": ucl, "lcl": lcl, "z": z})
    return {"gMean_app_style": g_mean_all, "gMean_board_mean": g_mean, "sB": s_b, "pts": pts}


def quantize_hpct_path(height_um, stencil_um):
    """Mimic unpivot: height to 2 decimals um, hpct to 1 decimal %."""
    h = round(height_um, 2)
    hpct = round(h / stencil_um * 1000) / 10
    return h, hpct


def main():
    rows = json.loads(Path("/workspace/artifacts/round1-rows.json").read_text())
    chart = json.loads(Path("/workspace/artifacts/round2-data.json").read_text())["chart301Volume"]

    py_xbar = xbar_recompute(rows, "volume")
    diffs = []
    for a, p in zip(chart["xbar"], py_xbar["pts"]):
        if a["lab"] != p["lab"]:
            continue
        for key in ("v", "ucl", "lcl", "z"):
            d = abs(a[key] - p[key])
            if d > max(1e-9, 1e-12 * abs(a[key])):
                diffs.append({"lab": a["lab"], "field": key, "app": a[key], "py": p[key], "d": d})

    poisson = {
        "k20_l1": poisson_sf_tail(20, 1),
        "k1000_l1000": poisson_sf_tail(1000, 1000),
        "k5_l1": poisson_sf_tail(5, 1),
    }

    nan_z = [float("nan")] * 14
    nelson4_nan = nelson4_ref(nan_z)

    # R281 hpct from rows - get heights per pad, simulate 90 vs 120 um import
    r281 = [r for r in rows if r["group"] == "R281" and r.get("hpct") is not None]
    # rows already at 120; reverse approximate height from hpct
    heights = [r["hpct"] * 120 / 100 for r in r281[:5]]

    out = {
        "nelson4_all_nan_hits": nelson4_nan,
        "poisson_independent": poisson,
        "xbar_point_diffs": diffs[:10],
        "xbar_max_diff": max((d["d"] for d in diffs), default=0),
        "xbar_n_diffs": len(diffs),
        "gMean_board_vs_all": {
            "all_pads": py_xbar["gMean_app_style"],
            "mean_of_board_means": py_xbar["gMean_board_mean"],
            "delta": py_xbar["gMean_app_style"] - py_xbar["gMean_board_mean"],
        },
    }
    OUT.write_text(json.dumps(out, indent=2))
    print(json.dumps({k: out[k] for k in ["nelson4_all_nan_hits", "poisson_independent", "xbar_n_diffs", "xbar_max_diff"]}, indent=2))


if __name__ == "__main__":
    main()

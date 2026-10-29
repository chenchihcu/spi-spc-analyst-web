#!/usr/bin/env python3
"""Exact spatial gradient replica: r=0.6 after group centering, n=30, G=10."""
import json
import math
import numpy as np
from scipy import stats

OUT = "/workspace/artifacts/round4-data.json"


def build_r06():
    rng = np.random.default_rng(20261029)
    groups = [f"G{i}" for i in range(10)]
    rows = []
    for g in groups:
        gx, gy = rng.uniform(-5, 5, size=2)
        # three pads per group with spread in x
        for dx in [-1.0, 0.0, 1.0]:
            x = gx + dx
            y = gy + 0.6 * dx + rng.normal(scale=0.01)
            rows.append((g, x, y))
    gids = np.array([r[0] for r in rows])
    xs = np.array([r[1] for r in rows], dtype=float)
    ys = np.array([r[2] for r in rows], dtype=float)
    cx = np.zeros_like(xs)
    res = np.zeros_like(ys)
    for g in np.unique(gids):
        m = gids == g
        cx[m] = xs[m] - xs[m].mean()
        res[m] = ys[m] - ys[m].mean()
    r = float(np.corrcoef(cx, res)[0, 1])
    n = len(cx)
    app_df = n - 2
    app_t = r * math.sqrt(app_df / max(1e-12, 1 - r * r))
    app_p = 2 * stats.t.sf(abs(app_t), app_df)
    uniq = list(np.unique(gids))
    k = len(uniq)
    X = np.zeros((n, k + 1))
    for i, g in enumerate(gids):
        X[i, uniq.index(g)] = 1
        X[i, k] = cx[i]
    beta, _, _, _ = np.linalg.lstsq(X, res, rcond=None)
    resid = res - X @ beta
    df_fe = n - (k + 1)
    mse = np.sum(resid**2) / df_fe
    cov = mse * np.linalg.inv(X.T @ X)
    se = math.sqrt(cov[-1, -1])
    fe_t = beta[-1] / se
    fe_p = 2 * stats.t.sf(abs(fe_t), df_fe)
    perm = []
    for _ in range(999):
        cx_p = cx.copy()
        for g in uniq:
            m = gids == g
            idx = np.where(m)[0]
            rng.shuffle(cx_p[idx])
        rp = np.corrcoef(cx_p, res)[0, 1]
        perm.append(rp * math.sqrt((n - 2) / max(1e-12, 1 - rp * rp)))
    perm_p = (np.sum(np.abs(perm) >= abs(app_t)) + 1) / (len(perm) + 1)
    return {
        "r": r,
        "app_df": app_df,
        "app_t": float(app_t),
        "app_p": float(app_p),
        "fe_df": int(df_fe),
        "fe_t": float(fe_t),
        "fe_p": float(fe_p),
        "app_would_card": bool(abs(r) >= 0.3 and app_p < 0.001),
        "fe_would_card": bool(abs(r) >= 0.3 and fe_p < 0.001),
        "perm_p_two_sided": float(perm_p),
    }


def main():
    data = json.loads(open(OUT, encoding="utf-8").read())
    data["spatial_py"] = build_r06()
    with open(OUT, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2, ensure_ascii=False)
    print(json.dumps(data["spatial_py"], indent=2))


if __name__ == "__main__":
    main()

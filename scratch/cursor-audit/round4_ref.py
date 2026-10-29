#!/usr/bin/env python3
"""Independent reference for R4 X4b spatial t-test and optional permutation."""
import json
import math
import numpy as np
from scipy import stats

OUT = "/workspace/artifacts/round4-data.json"


def spatial_fe_test():
    """Codex synthetic: 30 points, 10 groups, 3 per group, r=0.6 after group centering."""
    rng = np.random.default_rng(44293)
    groups = [f"G{i}" for i in range(10)]
    xs, ys, gids = [], [], []
    for g in groups:
        gx, gy = rng.normal(size=2)
        for _ in range(3):
            x = gx + rng.normal() * 0.3
            y = gy + 0.6 * x + rng.normal() * 0.3
            xs.append(x)
            ys.append(y)
            gids.append(g)
    xs = np.array(xs)
    ys = np.array(ys)
    gids = np.array(gids)

    # group center like app
    res = np.zeros_like(ys)
    cx = np.zeros_like(xs)
    for g in np.unique(gids):
        m = gids == g
        gm = ys[m].mean()
        gx = xs[m].mean()
        res[m] = ys[m] - gm
        cx[m] = xs[m] - gx

    r = np.corrcoef(cx, res)[0, 1]
    n = len(cx)
    app_df = n - 2
    app_t = r * math.sqrt(app_df / max(1e-12, 1 - r * r))
    app_p = 2 * stats.t.sf(abs(app_t), app_df)

    # FE OLS: y ~ group dummies + x
    uniq = list(np.unique(gids))
    k = len(uniq)
    X = np.zeros((n, k + 1))
    for i, g in enumerate(gids):
        X[i, uniq.index(g)] = 1
        X[i, k] = cx[i]
    # drop one dummy for identifiability — app uses centered x within group, intercept per group
    # Full rank: 10 intercepts + 1 slope = 11 params, df = 30-11=19
    beta, _, _, _ = np.linalg.lstsq(X, res, rcond=None)
    resid = res - X @ beta
    df_fe = n - (k + 1)
    sl = beta[-1]
    mse = np.sum(resid**2) / df_fe
    cov = mse * np.linalg.inv(X.T @ X)
    se = math.sqrt(cov[-1, -1])
    fe_t = sl / se
    fe_p = 2 * stats.t.sf(abs(fe_t), df_fe)

    # permutation on residuals (quick sanity): shuffle cx within groups
    perm_ts = []
    for _ in range(499):
        cx_p = cx.copy()
        for g in uniq:
            m = gids == g
            idx = np.where(m)[0]
            rng.shuffle(cx_p[idx])
        rp = np.corrcoef(cx_p, res)[0, 1]
        perm_ts.append(rp * math.sqrt((n - 2) / max(1e-12, 1 - rp * rp)))
    perm_p = (np.sum(np.abs(perm_ts) >= abs(app_t)) + 1) / (len(perm_ts) + 1)

    return {
        "n": int(n),
        "r": float(r),
        "app_df": int(app_df),
        "app_t": float(app_t),
        "app_p": float(app_p),
        "fe_df": int(df_fe),
        "fe_t": float(fe_t),
        "fe_p": float(fe_p),
        "app_would_card": bool(abs(r) >= 0.3 and app_p < 0.001),
        "fe_would_card": bool(abs(r) >= 0.3 and fe_p < 0.001),
        "perm_p_approx": float(perm_p),
    }


def ad_order_test():
    """Replicate AD subsample order sensitivity."""
    n = 3000
    p = (np.arange(1, n + 1) - 0.5) / n
    inv = stats.norm.ppf(p)
    batch_b = inv + 4
    interleaved = np.empty(2 * n)
    interleaved[0::2] = inv
    interleaved[1::2] = batch_b
    sorted_all = np.sort(interleaved)
    step = int(np.ceil(len(sorted_all) / 4000))

    def ad_anderson(vals):
        s = np.sort(np.asarray(vals, dtype=float))
        m, d = s.mean(), s.std(ddof=1)
        if d <= 0:
            return {"A": None, "p": None}
        F = stats.norm.cdf((s - m) / d)
        F = np.clip(F, 1e-12, 1 - 1e-12)
        i = np.arange(1, len(s) + 1)
        S = np.sum((2 * i - 1) * (np.log(F) + np.log(1 - F[::-1])))
        A = -len(s) - S / len(s)
        As = A * (1 + 0.75 / len(s) + 2.25 / (len(s) ** 2))
        # same piecewise as JS (approx)
        if As >= 0.6:
            pval = math.exp(1.2937 - 5.709 * As + 0.0186 * As * As)
        elif As >= 0.34:
            pval = math.exp(0.9177 - 4.279 * As - 1.38 * As * As)
        elif As >= 0.2:
            pval = 1 - math.exp(-8.318 + 42.796 * As - 59.938 * As * As)
        else:
            pval = 1 - math.exp(-13.436 + 101.14 * As - 223.73 * As * As)
        return {"A": float(As), "p": float(min(max(pval, 0), 1))}

    samp_a = interleaved[::step]
    samp_b = sorted_all[::step]
    return {
        "interleaved_sample": ad_anderson(samp_a),
        "sorted_sample": ad_anderson(samp_b),
        "full_sorted": ad_anderson(sorted_all),
        "step": step,
    }


def main():
    data = {}
    if __import__("pathlib").Path(OUT).exists():
        data = json.loads(open(OUT, encoding="utf-8").read())
    data["spatial_py"] = spatial_fe_test()
    data["ad_py"] = ad_order_test()
    with open(OUT, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2, ensure_ascii=False)
    print(json.dumps({"spatial": data["spatial_py"], "ad": data["ad_py"]}, indent=2))


if __name__ == "__main__":
    main()

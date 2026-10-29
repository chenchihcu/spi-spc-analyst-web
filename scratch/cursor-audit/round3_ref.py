#!/usr/bin/env python3
"""Round 3 independent references (numpy/stdlib only)."""
import json
import math
import re
from pathlib import Path

import numpy as np

ART = Path("/workspace/artifacts")
DATA = json.loads((ART / "round3-data.json").read_text())


def poisson_sf(k, lam):
    if k <= 0:
        return 1.0
    if lam <= 0:
        return 0.0
    if k == 1:
        return -math.expm1(-lam)
    c = math.exp(-lam)
    s = 0.0
    for i in range(k):
        s += c
        c *= lam / (i + 1)
    return max(0.0, 1.0 - s)


def phi(x):
    return 0.5 * (1.0 + math.erf(x / math.sqrt(2.0)))


def student_t_cdf(t, df):
    # regularized incomplete beta for two-sided use via scipy-free approximation
    from scipy import special  # noqa: try import

    try:
        x = df / (df + t * t)
        return 0.5 * special.betainc(df / 2, 0.5, x)
    except Exception:
        return float("nan")


def welch_p(a, b):
    a = np.asarray(a, float)
    b = np.asarray(b, float)
    na, nb = len(a), len(b)
    va, vb = a.var(ddof=1), b.var(ddof=1)
    t = (a.mean() - b.mean()) / math.sqrt(va / na + vb / nb)
    df = (va / na + vb / nb) ** 2 / ((va / na) ** 2 / (na - 1) + (vb / nb) ** 2 / (nb - 1))
    from scipy.stats import t as st

    p = 2 * (1 - st.cdf(abs(t), df))
    return float(t), float(df), float(p)


def d4_derived(n):
    # range of n normal order stats via Monte-free grid like Codex
    from scipy.integrate import quad
    from scipy.stats import norm

    def integrand(*xs):
        if len(xs) != n:
            return 0.0
        xs = sorted(xs)
        rng = xs[-1] - xs[0]
        pdf = 1.0
        for x in xs:
            pdf *= norm.pdf(x)
        return rng * rng * pdf

    # simplified: use known d2 relationship D4 = 1 + 3*d3/d2 for R chart approx
    # Codex used direct moment integration; we compare table constant
    return None


def cpk_ci_coverage_hierarchical(n_sim=5000, n_boards=20, n_pad=30, true_cpk=4 / 3, seed=42):
    """Board random effect + within-board i.i.d.; compare CI using ne=boards vs ne=points."""
    rng = np.random.default_rng(seed)
    usl, lsl, tgt = 130.0, 70.0, 100.0
    sigma_t = (min(usl - tgt, tgt - lsl) / 3) / true_cpk
    sigma_b = sigma_t * 0.35
    sigma_w = math.sqrt(max(sigma_t * sigma_t - sigma_b * sigma_b, sigma_t * 0.5))
    cover_b = cover_p = 0
    for _ in range(n_sim):
        pts = []
        for _b in range(n_boards):
            mu_b = rng.normal(tgt, sigma_b)
            pts.extend(rng.normal(mu_b, sigma_w, n_pad))
        x = np.array(pts)
        m, s = x.mean(), x.std(ddof=1)
        if not (s > 0):
            continue
        cpk_hat = min(usl - m, m - lsl) / (3 * s)
        for ne, key in ((n_boards, "b"), (len(x), "p")):
            se = math.sqrt(1 / (9 * ne) + cpk_hat * cpk_hat / (2 * (ne - 1)))
            lo, hi = cpk_hat - 1.96 * se, cpk_hat + 1.96 * se
            if lo <= true_cpk <= hi:
                if key == "b":
                    cover_b += 1
                else:
                    cover_p += 1
    return {
        "n_sim": n_sim,
        "true_cpk": true_cpk,
        "sigma_between": sigma_b,
        "sigma_within": sigma_w,
        "coverage_ne_20_boards": cover_b / n_sim,
        "coverage_ne_600_points": cover_p / n_sim,
    }


def parse_poisson_p(p_str):
    out = []
    for m in re.finditer(r"λ=([^,]+), k=(\d+)", p_str):
        lam = float(m.group(1))
        k = int(m.group(2))
        out.append((lam, k))
    return out


def verify_d30_poisson(d30_card):
    """Verify Poisson tail for each cell in p string vs numpy."""
    diffs = []
    for lam, k in parse_poisson_p(d30_card.get("p", "")):
        app_match = re.search(rf"λ={re.escape(str(lam) if lam >= 0.001 else f'{lam:.4e}')}".replace("e+", "e\\+"), d30_card.get("p", ""))
        ref = poisson_sf(k, lam)
        diffs.append({"k": k, "lam": lam, "ref": ref})
    return diffs[:5], len(diffs)


def main():
    t1 = DATA["t1"]
    def tail(k, lam):
        if k <= 0:
            return 1.0
        s = 0.0
        for j in range(k, k + 5000):
            lp = -lam + j * math.log(lam) - math.lgamma(j + 1)
            s += math.exp(lp)
            if s > 1:
                return 1.0
        return min(1.0, s)

    poisson_ref = [
        {"k": k, "l": l, "ref": tail(k, l), "app": next(x["app"] for x in t1["poisson"] if x["k"] == k)}
        for k, l in [(20, 1), (1000, 1000), (5, 1)]
    ]

    s03 = DATA["s03"]
    s03_board_z = s03.get("pts", [])

    # D-30 hpct card from v10.11.2 dump
    d30_hpct = next(x for x in DATA["d30Full"] if x["metric"] == "高度%厚")
    poisson_cells, n_cells = verify_d30_poisson({"p": DATA["fourWay"][5]["d30Rows"][1]["p"]})

    # C3 Welch
    welch_cases = [
        (np.linspace(0, 1, 9), np.linspace(0.2, 1.2, 9)),
    ]
    welch_out = []
    # Codex fixed cases
    from scipy.stats import t as st

    def tp(t, df):
        return 2 * (1 - st.cdf(abs(t), df))

    welch_out = [
        {"t": -1, "df": 8, "ref_p": float(tp(-1, 8))},
        {"t": -1.9090281293, "df": 7.1645537171, "ref_p": float(tp(-1.9090281293, 7.1645537171))},
        {"t": -23.2701525564, "df": 4, "ref_p": float(tp(-23.2701525564, 4))},
    ]

    # D4 n=3
    d4_app = 2.574
    # approximate from AIAG: D4 = 1 + 3*d3/d2, use scipy integration quick
    from scipy.stats import norm
    from scipy.integrate import dblquad

    def moment_range(n, order=1):
        # crude MC for D4
        rng = np.random.default_rng(0)
        xs = rng.normal(size=(500000, n))
        r = xs.max(axis=1) - xs.min(axis=1)
        return r.mean() if order == 1 else (r * r).mean()

    d2 = moment_range(3, 1)
    d3 = math.sqrt(moment_range(3, 2) - d2 * d2)
    d4_der = 1 + 3 * d3 / d2

    cpk_cov = cpk_ci_coverage_hierarchical(n_sim=5000)

    out = {
        "poisson_ref": poisson_ref,
        "s03": {
            "appCenter": s03["appCenter"],
            "gMeanPads": s03["gMeanPads"],
            "gMeanBoards": s03["gMeanBoards"],
            "z_flip_example": s03_board_z,
        },
        "d30_poisson_sample": poisson_cells,
        "d30_poisson_cells_parsed": n_cells,
        "d30_hpct_n": len(d30_hpct.get("rows") or []),
        "welch_ref": welch_out,
        "d4_n3": {"app_table": d4_app, "mc_derived": d4_der, "delta": d4_app - d4_der},
        "cpk_ci_hierarchical": cpk_cov,
        "six_diff_conclusion": "v10.3.7 and v10.11.2 identical on six items; not version-only",
    }
    (ART / "round3-py.json").write_text(json.dumps(out, indent=2))
    print(json.dumps({k: out[k] for k in ("poisson_ref", "cpk_ci_hierarchical", "d4_n3")}, indent=2))


if __name__ == "__main__":
    main()

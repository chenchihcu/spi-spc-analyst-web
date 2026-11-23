"""Multi-viewport & theme UI verification matrix for SPI·SPC Analyst.

Checks 1440 / 820 / 390 / 320 widths x light / dark themes under dpr=2:
- Zero page-level horizontal overflow (scrollWidth <= clientWidth)
- Canvas stability on revisit at dpr=2 (no dpr amplification)
- Mobile (390 / 320, pointer:coarse) touch target height >= 44px
- Dark-mode .report-preview text contrast >= 4.5
Collects all violations across the matrix before returning so one run surfaces every issue.
"""
import math
from playwright.sync_api import expect

from journeys import ensure_sample_loaded, login

MAIN_TABS = [
    "issues",
    "overview",
    "control",
    "capability",
    "sim3d",
    "deep",
    "improve",
    "ai",
    "report",
    "data",
]
DATA_SUBTABS = ["stencil-spec", "paste-spec", "runs"]
REVISIT_CANVAS_TABS = ("control", "deep")
REPRESENTATIVE_TABS = {"issues", "control", "report"}

MATRIX_VIEWPORTS = [
    {"name": "desktop-1440", "width": 1440, "height": 900, "mobile": False},
    {"name": "tablet-820", "width": 820, "height": 1024, "mobile": False},
    {"name": "mobile-390", "width": 390, "height": 844, "mobile": True},
    {"name": "mobile-320", "width": 320, "height": 640, "mobile": True},
]

_OVERFLOW_JS = """() => {
  const doc = document.documentElement;
  const sw = doc.scrollWidth;
  const cw = doc.clientWidth;
  const culprits = [];
  if (sw > cw) {
    for (const el of document.querySelectorAll('body *')) {
      const style = getComputedStyle(el);
      if (style.display === 'none' || style.visibility === 'hidden') continue;
      const r = el.getBoundingClientRect();
      if (r.width > 0 && r.right > cw + 1) {
        culprits.push({
          tag: el.tagName.toLowerCase(),
          id: el.id || '',
          cls: typeof el.className === 'string' ? el.className.slice(0, 60) : '',
          right: Math.round(r.right),
          width: Math.round(r.width),
        });
        if (culprits.length >= 5) break;
      }
    }
  }
  return { scrollWidth: sw, clientWidth: cw, overflow: Math.max(0, sw - cw), culprits };
}"""

_TOUCH_TARGET_JS = """(rootSel) => {
  const root = rootSel ? document.querySelector(rootSel) : document.body;
  if (!root) return [];
  const bad = [];
  const selectors = 'button, a[href], select, input:not([type=hidden]):not([type=checkbox]):not([type=radio]):not(.sr), summary, label.row:has(>input[type=checkbox]), label.row:has(>input[type=radio])';
  for (const el of root.querySelectorAll(selectors)) {
    const st = getComputedStyle(el);
    if (st.display === 'none' || st.visibility === 'hidden' || st.pointerEvents === 'none') continue;
    if (el.closest('[hidden], .sr')) continue;
    const r = el.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) continue;
    // Skip elements fully off-screen vertically or horizontally inside hidden overflow
    if (r.right <= 0 || r.bottom <= 0) continue;
    // Skip tiny inline text links inside prose paragraphs
    if (el.tagName === 'A' && st.display === 'inline') continue;
    if (r.height < 43.5) {
      bad.push({
        tag: el.tagName.toLowerCase(),
        id: el.id || '',
        cls: typeof el.className === 'string' ? el.className.slice(0, 50) : '',
        text: (el.innerText || el.getAttribute('aria-label') || '').trim().slice(0, 30),
        w: Math.round(r.width * 10) / 10,
        h: Math.round(r.height * 10) / 10,
      });
    }
  }
  return bad;
}"""

_REPORT_CONTRAST_JS = """() => {
  const root = document.querySelector('#reportPreview');
  if (!root) return { checked: 0, failures: [] };
  function parseColor(str) {
    const m = str && str.match(/rgba?\\((\\d+(?:\\.\\d+)?),\\s*(\\d+(?:\\.\\d+)?),\\s*(\\d+(?:\\.\\d+)?)(?:,\\s*(\\d+(?:\\.\\d+)?))?\\)/);
    if (!m) return null;
    return [Number(m[1]), Number(m[2]), Number(m[3]), m[4] === undefined ? 1 : Number(m[4])];
  }
  function effectiveBg(el) {
    let cur = el;
    while (cur && cur.nodeType === 1) {
      const c = parseColor(getComputedStyle(cur).backgroundColor);
      if (c && c[3] > 0.05) return c;
      cur = cur.parentElement;
    }
    return [255, 255, 255, 1];
  }
  function lum([r, g, b]) {
    const f = v => {
      const s = v / 255;
      return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
    };
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
  }
  const failures = [];
  let checked = 0;
  for (const el of root.querySelectorAll('h1,h2,h3,h4,p,td,th,li,b,strong,span,div')) {
    if (el.children.length > 0) continue;
    const text = (el.textContent || '').trim();
    if (!text) continue;
    const st = getComputedStyle(el);
    if (st.display === 'none' || st.visibility === 'hidden' || Number(st.opacity) < 0.1) continue;
    const r = el.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) continue;
    const fg = parseColor(st.color);
    const bg = effectiveBg(el);
    if (!fg || !bg) continue;
    const l1 = lum(fg), l2 = lum(bg);
    const ratio = (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
    checked++;
    if (ratio < 4.5) {
      failures.push({
        tag: el.tagName.toLowerCase(),
        cls: typeof el.className === 'string' ? el.className.slice(0, 40) : '',
        text: text.slice(0, 30),
        ratio: Math.round(ratio * 100) / 100,
        fg: st.color,
        bg: `rgb(${bg[0]}, ${bg[1]}, ${bg[2]})`,
      });
      if (failures.length >= 10) break;
    }
  }
  return { checked, failures };
}"""

_CANVAS_WIDTHS_JS = """(panelSel) => {
  const panel = document.querySelector(panelSel);
  if (!panel) return {};
  const out = {};
  for (const c of panel.querySelectorAll('canvas')) {
    const r = c.getBoundingClientRect();
    if (r.width > 0 && r.height > 0) {
      out[c.id || 'anon'] = Math.round(r.width * 10) / 10;
    }
  }
  return out;
}"""


def _navigate_tab(page, name, is_mobile):
    if is_mobile:
        direct = page.locator(f'button.mtab-btn[data-tab="{name}"]:visible')
        if direct.count() > 0:
            direct.first.click()
            expect(page.locator(f"#p-{name}")).to_be_visible()
            return
        page.locator("#mtabMore").click()
        expect(page.locator("#moreSheet")).to_be_visible()
        item = page.locator(f'#moreSheet [data-mtab="{name}"]')
        if item.count() > 0:
            item.first.click()
            expect(page.locator(f"#p-{name}")).to_be_visible()
            return
        page.locator("#moreSheetClose").click()
        raise RuntimeError(f"Mobile navigation item not found for tab: {name}")
    btn = page.locator(f'button.tab[data-tab="{name}"]')
    btn.scroll_into_view_if_needed()
    btn.click()
    expect(page.locator(f"#p-{name}")).to_be_visible()


def _set_theme(page, target_theme, is_mobile):
    current = page.evaluate("() => document.documentElement.getAttribute('data-theme') || 'light'")
    if current == target_theme:
        return
    if is_mobile:
        page.locator("#mtabMore").click()
        expect(page.locator("#moreSheet")).to_be_visible()
        page.locator("#mBtnUiSettings").click()
    else:
        page.locator("#btnMore").click()
        expect(page.locator("#moreMenu")).to_be_visible()
        page.locator("#btnOpenUiSettings").click()
    expect(page.locator("#appSettingsModal")).to_be_visible()
    page.locator("#btnThemeSettings").click()
    page.wait_for_function(
        "(want) => document.documentElement.getAttribute('data-theme') === want",
        arg=target_theme,
    )
    close_btn = page.locator("#appSettingsModal .sheet-close, #appSettingsClose").first
    close_btn.click()
    expect(page.locator("#appSettingsModal")).to_be_hidden()


def _check_modals(page, vp_name, theme, is_mobile, violations, note):
    modal_specs = [
        ("recPickerModal", "#mBtnOpenRecModal" if is_mobile else "#btnOpenRecModal", "#recPickerClose"),
        ("exportCenterModal", "#mBtnOpenExportModal" if is_mobile else "#btnOpenExportModal", "#exportCenterClose"),
        ("appSettingsModal", "#mBtnUiSettings" if is_mobile else "#btnOpenUiSettings", "#appSettingsModal .sheet-close"),
    ]
    for modal_id, open_sel, close_sel in modal_specs:
        if is_mobile:
            page.locator("#mtabMore").click()
            expect(page.locator("#moreSheet")).to_be_visible()
        elif open_sel == "#btnOpenUiSettings":
            page.locator("#btnMore").click()
            expect(page.locator("#moreMenu")).to_be_visible()
        page.locator(open_sel).click()
        expect(page.locator(f"#{modal_id}")).to_be_visible()
        ov = page.evaluate(_OVERFLOW_JS)
        if ov["overflow"] > 0:
            violations.append({
                "viewport": vp_name,
                "theme": theme,
                "target": f"modal:{modal_id}",
                "check": "overflow",
                "detail": ov,
            })
        if is_mobile:
            bad_taps = page.evaluate(_TOUCH_TARGET_JS, f"#{modal_id}")
            if bad_taps:
                violations.append({
                    "viewport": vp_name,
                    "theme": theme,
                    "target": f"modal:{modal_id}",
                    "check": "touch_target_44px",
                    "count": len(bad_taps),
                    "samples": bad_taps[:5],
                })
        page.locator(close_sel).first.click()
        expect(page.locator(f"#{modal_id}")).to_be_hidden()

    if is_mobile:
        # Check railSheet on mobile
        chip = page.locator("#btnRailChip")
        if chip.is_visible():
            chip.click()
            expect(page.locator("#railSheet")).to_be_visible()
            ov = page.evaluate(_OVERFLOW_JS)
            if ov["overflow"] > 0:
                violations.append({
                    "viewport": vp_name,
                    "theme": theme,
                    "target": "modal:railSheet",
                    "check": "overflow",
                    "detail": ov,
                })
            page.locator("#railSheetClose").click()
            expect(page.locator("#railSheet")).to_be_hidden()
    note("ui-matrix modals", viewport=vp_name, theme=theme)


def run_ui_matrix(
    pw,
    launch_base_kwargs,
    scratch,
    origin,
    credentials,
    version,
    evidence,
    note,
    *,
    all_screenshots=False,
    attach_error_listeners=None,
):
    """Run the 4-width x 2-theme UI matrix at dpr=2 and return structured results."""
    violations = []
    cells = []
    screenshot_count = 0

    for group_mobile in (False, True):
        group_vps = [vp for vp in MATRIX_VIEWPORTS if vp["mobile"] == group_mobile]
        profile_dir = scratch / ("profile-matrix-mobile" if group_mobile else "profile-matrix-desktop")
        kwargs = dict(launch_base_kwargs)
        kwargs.update({
            "viewport": {"width": group_vps[0]["width"], "height": group_vps[0]["height"]},
            "device_scale_factor": 2,
            "has_touch": group_mobile,
            "is_mobile": group_mobile,
        })
        context = pw.chromium.launch_persistent_context(str(profile_dir), **kwargs)
        try:
            page = context.pages[0]
            page.set_default_timeout(15000)
            if attach_error_listeners:
                attach_error_listeners(page, f"ui-matrix-{'mobile' if group_mobile else 'desktop'}")
            login(page, origin, credentials, version, note)
            ensure_sample_loaded(page, note)

            for vp in group_vps:
                vp_name = vp["name"]
                page.set_viewport_size({"width": vp["width"], "height": vp["height"]})
                page.wait_for_timeout(150)

                for theme in ("light", "dark"):
                    _set_theme(page, theme, group_mobile)
                    cell_start_violations = len(violations)
                    canvas_first = {}

                    for tab in MAIN_TABS:
                        _navigate_tab(page, tab, group_mobile)
                        page.wait_for_timeout(100)

                        ov = page.evaluate(_OVERFLOW_JS)
                        tab_failed = False
                        if ov["overflow"] > 0:
                            tab_failed = True
                            violations.append({
                                "viewport": vp_name,
                                "theme": theme,
                                "target": f"tab:{tab}",
                                "check": "overflow",
                                "detail": ov,
                            })

                        if group_mobile:
                            bad_taps = page.evaluate(_TOUCH_TARGET_JS, f"#p-{tab}")
                            if bad_taps:
                                tab_failed = True
                                violations.append({
                                    "viewport": vp_name,
                                    "theme": theme,
                                    "target": f"tab:{tab}",
                                    "check": "touch_target_44px",
                                    "count": len(bad_taps),
                                    "samples": bad_taps[:5],
                                })

                        if tab in REVISIT_CANVAS_TABS:
                            canvas_first[tab] = page.evaluate(_CANVAS_WIDTHS_JS, f"#p-{tab}")

                        if tab == "report" and theme == "dark":
                            contrast = page.evaluate(_REPORT_CONTRAST_JS)
                            if contrast["failures"]:
                                tab_failed = True
                                violations.append({
                                    "viewport": vp_name,
                                    "theme": theme,
                                    "target": "tab:report:#reportPreview",
                                    "check": "dark_report_contrast_4.5",
                                    "checked": contrast["checked"],
                                    "failures": contrast["failures"],
                                })

                        if tab == "data":
                            for sub in DATA_SUBTABS:
                                sub_btn = page.locator(f'#p-data button.subtab[data-sub="{sub}"]')
                                if sub_btn.is_visible():
                                    sub_btn.click()
                                    page.wait_for_timeout(80)
                                    sub_ov = page.evaluate(_OVERFLOW_JS)
                                    if sub_ov["overflow"] > 0:
                                        tab_failed = True
                                        violations.append({
                                            "viewport": vp_name,
                                            "theme": theme,
                                            "target": f"data-sub:{sub}",
                                            "check": "overflow",
                                            "detail": sub_ov,
                                        })

                        if all_screenshots or tab_failed or tab in REPRESENTATIVE_TABS:
                            suffix = "-FAIL" if tab_failed else ""
                            page.screenshot(path=evidence / f"matrix-{vp_name}-{theme}-{tab}{suffix}.png")
                            screenshot_count += 1

                    # Re-enter canvas tabs at dpr=2 to catch cumulative canvas width growth
                    for tab in REVISIT_CANVAS_TABS:
                        _navigate_tab(page, tab, group_mobile)
                        page.wait_for_timeout(100)
                        second = page.evaluate(_CANVAS_WIDTHS_JS, f"#p-{tab}")
                        first = canvas_first.get(tab, {})
                        for cid, w1 in first.items():
                            w2 = second.get(cid)
                            if w2 is not None and not math.isclose(w1, w2, abs_tol=2.5):
                                violations.append({
                                    "viewport": vp_name,
                                    "theme": theme,
                                    "target": f"tab:{tab}:canvas#{cid}",
                                    "check": "dpr2_revisit_canvas_growth",
                                    "first_width": w1,
                                    "second_width": w2,
                                })

                    _check_modals(page, vp_name, theme, group_mobile, violations, note)

                    cell_violations = len(violations) - cell_start_violations
                    cells.append({
                        "viewport": vp_name,
                        "width": vp["width"],
                        "height": vp["height"],
                        "mobile": group_mobile,
                        "theme": theme,
                        "status": "PASS" if cell_violations == 0 else "FAIL",
                        "violations": cell_violations,
                    })
                    note("ui-matrix cell", viewport=vp_name, theme=theme,
                         status="PASS" if cell_violations == 0 else "FAIL",
                         violations=cell_violations)
        finally:
            context.close()

    return {
        "dpr": 2,
        "cells": cells,
        "total_violations": len(violations),
        "violations": violations,
        "screenshots": screenshot_count,
    }

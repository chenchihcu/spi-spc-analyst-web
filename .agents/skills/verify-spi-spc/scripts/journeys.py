import csv
import math
import re
from pathlib import Path
from urllib.parse import parse_qs, urlsplit

from playwright.sync_api import expect


def login(page, origin, credentials, version, note):
    page.goto(origin)
    expect(page.locator("#loginForm")).to_be_visible()
    expect(page.locator(".ver")).to_have_text(f"v{version} · 更新 {credentials['built']}")
    page.locator("#user").fill(credentials["user"])
    page.locator("#pass").fill(credentials["password"])
    page.locator("#go").click()
    expect(page.locator("#appVer")).to_have_text("v" + version)
    note("login via form", version=version)


def doctor(page, origin, credentials, version, note):
    if page.url.split("/", 3)[:3] != origin.split("/", 3)[:3]:
        raise RuntimeError("Unexpected Chrome origin")
    expect(page.locator("#appVer")).to_have_text("v" + version)
    expect(page.locator("#appBuilt")).to_have_text(credentials["built"])
    for path in ("/__me", "/api/records"):
        # Chrome owns the Secure session cookie, including its loopback exception.
        status, data = page.evaluate("""async path => {
            const r = await fetch(path, {credentials: 'same-origin', cache: 'no-store', redirect: 'error'});
            return [r.status, await r.json()];
        }""", path)
        if status != 200:
            raise RuntimeError(f"Doctor {path} returned HTTP {status}")
        if path == "/__me" and data.get("user") != credentials["user"]:
            raise RuntimeError("Unexpected authenticated account")
        if path == "/api/records" and not isinstance(data.get("records"), list):
            raise RuntimeError("Invalid D1 list response")
        note("doctor", method="GET", path=path, status=status)


def open_tab(page, name, note):
    btn = page.locator(f'button[data-tab="{name}"]:visible')
    if btn.count() == 0:
        btn = page.locator(f'button.tab[data-tab="{name}"]')
        btn.scroll_into_view_if_needed()
    btn.first.click()
    expect(page.locator("#p-" + name)).to_be_visible()
    note("tab", name=name)


def ensure_sample_loaded(page, note):
    """Ensure the built-in demo dataset is loaded so analytical tabs have data."""
    sample_btn = page.locator("button[data-load-sample]:visible")
    if sample_btn.count() > 0:
        sample_btn.first.click()
        expect(page.locator("#p-gate")).to_be_hidden()
        note("loaded sample dataset from gate")
        return
    # If already past gate but currently on an uploaded run with few rows, check selRun
    sel_run = page.locator("#selRun")
    if sel_run.count() > 0:
        cur_text = sel_run.evaluate("s => s.options[s.selectedIndex]?.text || ''")
        if "範例" in cur_text or "試產" in cur_text:
            return
    # Load sample via Data -> Runs -> #btnSample
    open_tab(page, "data", note)
    page.locator('#p-data button.subtab[data-sub="runs"]').click()
    details = page.locator('#p-data [data-sub="runs"] details.demo-tools')
    if details.count() > 0 and details.get_attribute("open") is None:
        details.locator("summary").click()
    page.locator("#btnSample").click()
    note("loaded sample dataset via runs subtab")


def refresh(page, button, note, *, expected_count=0):
    def is_list(request, kind):
        url = urlsplit(request.url)
        return (url.netloc == urlsplit(page.url).netloc and url.path == "/api/records"
                and request.method == "GET" and parse_qs(url.query).get("kind") == [kind])

    with page.expect_request(lambda r: is_list(r, "spi")) as spi, page.expect_request(lambda r: is_list(r, "place")) as place:
        note("click refresh", selector=button)
        page.locator(button).click()
    for pending in (spi, place):
        response = pending.value.response()
        if response is None:
            raise RuntimeError("UI list request did not receive a response")
        url = urlsplit(response.url)
        if response.status != 200:
            raise RuntimeError(f"GET {url.path}?{url.query}: HTTP {response.status}")
        data = response.json()
        recs = data.get("records")
        if not isinstance(recs, list) or "next" not in data:
            raise RuntimeError("Invalid record list response shape")
        if expected_count is not None and len(recs) != expected_count:
            raise RuntimeError(f"Expected {expected_count} record(s), got {len(recs)}")
        note("UI response", trigger=button, method="GET", path=url.path + "?" + url.query,
             status=response.status, records=len(recs), next=data["next"])


def database(page, evidence, note, **_kwargs):
    open_tab(page, "data", note)
    page.locator("#btnOpenRecModal").click()
    expect(page.locator("#recPickerModal")).to_be_visible()
    expect(page.locator("#recPickerNotice")).to_contain_text("量測紀錄 0 筆")
    refresh(page, "#recPickerReload", note, expected_count=0)
    expect(page.locator("#recPickerNotice")).to_contain_text("座標檔 0 筆")
    expect(page.locator("#recPickerAuthNotice")).to_be_hidden()
    page.screenshot(path=evidence / "database-picker.png")
    page.locator("#recPickerClose").click()
    expect(page.locator("#recPickerModal")).to_be_hidden()

    spi = page.locator("#stateSpi")
    expect(spi).to_have_attribute("aria-disabled", "true")
    spi.click(force=True)
    expect(page.locator("#recPickerModal")).to_be_hidden()
    expect(page.locator("#proofModal")).to_be_hidden()
    place = page.locator("#statePlace")
    expect(place).to_have_attribute("role", "status")
    place.click()
    expect(page.locator("#recPickerModal")).to_be_hidden()
    note("status capsules", spi="aria-disabled", place="status")
    page.screenshot(path=evidence / "database-status.png")

    def picker_entry(selector, *, placement=False):
        page.locator(selector).click()
        expect(page.locator("#recPickerModal")).to_be_visible()
        expect(page.locator("#recPickerNotice")).to_contain_text("座標檔 0 筆")
        if placement:
            expect(page.locator("#pickQualitySeg")).to_be_hidden()
            expect(page.locator("#boxPickPlace")).to_be_visible()
            expect(page.locator("#boxPickSpi")).to_be_hidden()
        else:
            # 手機寬度下篩選收在「篩選」鈕內，先展開再檢查
            toggle = page.locator("#btnRecFilters")
            if toggle.is_visible() and toggle.get_attribute("aria-expanded") != "true":
                toggle.click()
            expect(page.locator("#pickQualitySeg")).to_be_visible()
            expect(page.locator("#boxPickSpi")).to_be_visible()
            expect(page.locator("#boxPickPlace")).to_be_hidden()
        note("picker entry", selector=selector, placement=placement, viewport=page.viewport_size)
        page.screenshot(path=evidence / ("picker-" + selector[1:] + ".png"))
        page.locator("#recPickerClose").click()

    page.locator("#btnOpenRecModal").click()
    page.locator("#btnPickImport").click()
    expect(page.locator("#boxPickImport")).to_be_visible()
    picker_entry("#btnSelectPlace", placement=True)
    open_tab(page, "issues", note)
    size = page.viewport_size
    try:
        page.set_viewport_size({"width": 390, "height": 844})
        page.locator("#mtabMore").click()
        picker_entry("#mBtnOpenRecModal")
    finally:
        page.set_viewport_size(size)


def _write_synthetic_fixtures(fixture_dir: Path):
    fixture_dir.mkdir(parents=True, exist_ok=True)
    place_csv = fixture_dir / "verify-place-top.csv"
    place_csv.write_text(
        "\n".join([
            "RefDes,Center-X(mm),Center-Y(mm),Layer,Footprint",
            "R1,10.00,15.00,TOP,0402",
            "R2,25.00,15.00,TOP,0402",
            "C1,10.00,30.00,TOP,0603",
            "U1,30.00,30.00,TOP,QFN16",
        ]) + "\n",
        encoding="utf-8",
    )
    spi_csv = fixture_dir / "verify-spi-top.csv"
    rows = ["PanelID,ComponentID,PinNumber,Package,Volume(%),Height(um),Area(%),OffsetX(um),OffsetY(um)"]
    comps = [("R1", "0402"), ("R2", "0402"), ("C1", "0603"), ("U1", "QFN16")]
    for b_idx in range(1, 4):
        board_id = f"B{b_idx:03d}"
        for c_idx, (comp, pkg) in enumerate(comps):
            for pin in (1, 2):
                vol = 96.0 + ((b_idx * 3 + c_idx * 2 + pin) % 9)
                h = 118.0 + ((b_idx + c_idx + pin) % 5)
                area = 98.0 + ((b_idx + pin) % 5)
                ox = (pin - 1.5) * 8.0
                oy = (c_idx - 1.5) * 4.0
                rows.append(f"{board_id},{comp},{pin},{pkg},{vol:.1f},{h:.1f},{area:.1f},{ox:.1f},{oy:.1f}")
    spi_csv.write_text("\n".join(rows) + "\n", encoding="utf-8")
    return place_csv, spi_csv


def records(page, evidence, note, *, scratch=None):
    """End-to-end D1 + R2 CRUD: upload controlled placement -> upload SPI without XY ->
    verify 3D CAD layout (no virtual grid warning) -> reload & reopen from cloud -> delete both.
    """
    fixture_dir = (Path(scratch) if scratch else evidence) / "fixtures"
    place_csv, spi_csv = _write_synthetic_fixtures(fixture_dir)

    # 1. Upload controlled placement CSV to D1 + R2
    page.locator("#btnOpenRecModal").click()
    expect(page.locator("#recPickerModal")).to_be_visible()
    page.locator("#btnPickPlace").click()
    expect(page.locator("#boxPickPlace")).to_be_visible()
    expect(page.locator("#btnShowPlaceForm")).to_be_visible()
    page.locator("#btnShowPlaceForm").click()
    expect(page.locator("#uploadRefModal")).to_be_visible()

    page.locator("#upPlaceFile").set_input_files(str(place_csv))
    page.locator("#upPlacePart").fill("TEST-VERIFY-01")
    page.locator("#upPlaceRev").fill("V1")
    page.locator("#upPlaceSide").select_option("TOP")
    page.locator("#upPlaceUnit").select_option("mm")

    with page.expect_response(
        lambda r: urlsplit(r.url).path == "/api/records" and r.request.method == "POST"
    ) as post_place:
        page.locator("#btnSubmitRef").click()
    place_resp = post_place.value
    if place_resp.status not in (200, 201):
        raise RuntimeError(f"POST /api/records (place) returned HTTP {place_resp.status}: {place_resp.text()[:300]}")
    expect(page.locator("#uploadRefModal")).to_be_hidden()
    expect(page.locator("#countPickPlace")).to_have_text("1")
    note("uploaded controlled placement", status=place_resp.status, file=place_csv.name)

    # 2. Import SPI CSV (without pad X/Y) linked to controlled placement -> save to D1 + R2
    page.locator("#btnPickImport").click()
    expect(page.locator("#boxPickImport")).to_be_visible()
    page.locator("#fileIn").set_input_files(str(spi_csv))
    expect(page.locator("#mapBox")).to_be_visible()
    page.locator("#selSide").select_option("TOP")
    page.locator("#inPart").fill("TEST-VERIFY-01")
    page.locator("#inRev").fill("V1")
    page.locator("#inImpStencil").fill("120")
    page.locator("#inWorkOrder").fill("WO-VERIFY-01")

    # Select the matching controlled placement directly (verifies blur->change does not swallow click)
    place_choice = page.locator("#placeChoices button[data-pick-place]").first
    expect(place_choice).to_be_visible()
    with page.expect_response(
        lambda r: urlsplit(r.url).path == "/api/records"
        and "id" in parse_qs(urlsplit(r.url).query)
        and r.request.method == "GET",
    ) as get_place:
        place_choice.click()
    if get_place.value.status != 200:
        raise RuntimeError(f"GET placement blob returned HTTP {get_place.value.status}")
    expect(page.locator("#placeState")).to_contain_text("TEST-VERIFY-01")
    expect(page.locator("#btnApply")).to_be_enabled()

    with page.expect_response(
        lambda r: urlsplit(r.url).path == "/api/records" and r.request.method == "POST"
    ) as post_spi:
        page.locator("#btnApply").click()
    spi_resp = post_spi.value
    if spi_resp.status not in (200, 201):
        raise RuntimeError(f"POST /api/records (spi) returned HTTP {spi_resp.status}: {spi_resp.text()[:300]}")
    expect(page.locator("#impDoneBanner")).to_be_visible()
    note("uploaded spi record", status=spi_resp.status, file=spi_csv.name)
    page.screenshot(path=evidence / "records-imported.png")

    # 3. Save default part spec for TEST-VERIFY-01 to unlock analysis (fail-closed spec gate)
    page.locator("#btnImpDoneInspect").click()
    expect(page.locator("#recPickerModal")).to_be_hidden()
    open_tab(page, "data", note)
    page.locator('#p-data button.subtab[data-sub="paste-spec"]').click()
    expect(page.locator("#btnSpecSave")).to_be_visible()
    page.locator("#btnSpecSave").click()
    expect(page.locator("#specSaveModal")).to_be_visible()
    page.locator("#specSaveDefault").check()
    with page.expect_response(
        lambda r: urlsplit(r.url).path == "/api/records" and r.request.method == "POST"
    ) as post_spec:
        page.locator("#specSaveOk").click()
    if post_spec.value.status not in (200, 201):
        raise RuntimeError(f"POST /api/records (spec) returned HTTP {post_spec.value.status}")
    expect(page.locator("#specSaveModal")).to_be_hidden()
    note("saved default part spec", part="TEST-VERIFY-01", status=post_spec.value.status)

    # 4. Inspect 3D view: controlled CAD coordinates active, virtual grid warning hidden
    open_tab(page, "sim3d", note)
    expect(page.locator("#view3d canvas")).to_be_visible()
    expect(page.locator("#view3d .webgl-fallback")).to_have_count(0)
    expect(page.locator("#grid3dWarn")).to_be_hidden()
    expect(page.locator("#hud")).to_contain_text(re.compile(r"[1-9]\d* 焊墊"))
    page.locator("#view3d canvas").screenshot(path=evidence / "records-sim3d-cad.png")
    note("verified 3d controlled coordinates", grid_warn_hidden=True, hud=page.locator("#hud").inner_text())

    # 4. Reload page & reopen SPI record from cloud D1 + R2
    page.reload()
    expect(page.locator("#btnOpenRecModal")).to_be_visible()
    page.locator("#btnOpenRecModal").click()
    expect(page.locator("#recPickerModal")).to_be_visible()
    expect(page.locator("#countPickSpi")).to_have_text("1")
    expect(page.locator("#countPickPlace")).to_have_text("1")

    load_btn = page.locator('#tblPickSpi button[data-act="open"], #tblPickSpi button:has-text("載入")').first
    expect(load_btn).to_be_visible()
    with page.expect_response(
        lambda r: urlsplit(r.url).path == "/api/records"
        and "id" in parse_qs(urlsplit(r.url).query)
        and r.request.method == "GET"
    ) as get_blob:
        load_btn.click()
    blob_resp = get_blob.value
    if blob_resp.status != 200:
        raise RuntimeError(f"GET record blob returned HTTP {blob_resp.status}")
    expect(page.locator("#recPickerModal")).to_be_hidden()
    note("reopened spi record from D1+R2", path=urlsplit(blob_resp.url).path + "?" + urlsplit(blob_resp.url).query, status=blob_resp.status)
    page.screenshot(path=evidence / "records-reopened.png")

    # 5. Delete SPI record first, then Placement record, confirming clean return to 0
    page.locator("#btnOpenRecModal").click()
    expect(page.locator("#recPickerModal")).to_be_visible()
    for tab_btn_sel, count_sel, kind in (
        ("#btnPickSpi", "#countPickSpi", "spi"),
        ("#btnPickPlace", "#countPickPlace", "place"),
    ):
        page.locator(tab_btn_sel).click()
        row_chk = page.locator(f"#{'tblPickSpi' if kind == 'spi' else 'tblPickPlace'} input[type='checkbox']").first
        expect(row_chk).to_be_visible()
        row_chk.check()
        expect(page.locator("#btnRecBatchDelete")).to_be_visible()
        page.locator("#btnRecBatchDelete").click()
        expect(page.locator("#confirmModal")).to_be_visible()
        page.locator("#confirmOk").click()
        expect(page.locator("#confirmModal")).to_be_hidden()
        expect(page.locator(count_sel)).to_have_text("0")
        note("deleted cloud record", kind=kind, remaining=0)

    page.locator("#recPickerClose").click()
    expect(page.locator("#recPickerModal")).to_be_hidden()


def control(page, evidence, note, **_kwargs):
    ensure_sample_loaded(page, note)
    open_tab(page, "control", note)
    expect(page.locator("#ctrlTitle")).to_contain_text("X̄")
    expect(page.locator("#ctrlSub")).to_contain_text(re.compile(r"CL\s*[-+]?\d"))
    expect(page.locator("#nelsonTbl tbody tr").first).to_be_visible()
    for selector in ("#cCtrl1", "#cCtrl2"):
        canvas = page.locator(selector)
        expect(canvas).to_be_visible()
        if not canvas.evaluate("""c => new Set(new Uint32Array(c.getContext('2d')
                  .getImageData(0, 0, c.width, c.height).data.buffer)).size > 4"""):
            raise RuntimeError("No chart pixels in " + selector)
    note("control limits", summary=page.locator("#ctrlSub").inner_text())


def sim3d(page, evidence, note, **_kwargs):
    ensure_sample_loaded(page, note)
    open_tab(page, "sim3d", note)
    board = page.locator("#selBoard")
    old = board.input_value()
    choices = board.locator("option").evaluate_all("(opts) => opts.map(o => o.value)")
    target = next((value for value in choices if value != old), None)
    if not target:
        raise RuntimeError("Seed has fewer than two selectable boards")
    board.select_option(target)
    expect(page.locator("#hud b").first).to_have_text(target)
    expect(page.locator("#hud")).to_contain_text(re.compile(r"[1-9]\d* 焊墊"))
    expect(page.locator("#view3d .webgl-fallback")).to_have_count(0)
    scene = page.locator("#view3d canvas")
    expect(scene).to_be_visible()
    scene.screenshot(path=evidence / "sim3d-scene.png")
    note("sample board", previous=old, selected=target, hud=page.locator("#hud").inner_text())


def tabs(page, evidence, note, **_kwargs):
    """Verify all remaining analytical tabs & data subtabs render real content without errors."""
    ensure_sample_loaded(page, note)
    tab_checks = [
        ("overview", "#p-overview .card:visible", "tabs-overview.png"),
        ("issues", "#issList", "tabs-issues.png"),
        ("capability", "#p-capability table:visible", "tabs-capability.png"),
        ("deep", "#p-deep .card:visible", "tabs-deep.png"),
        ("improve", "#p-improve .card:visible", None),
        ("ai", "#p-ai .card:visible", None),
    ]
    for name, content_sel, shot in tab_checks:
        open_tab(page, name, note)
        expect(page.locator(content_sel).first).to_be_visible()
        text_len = page.locator(f"#p-{name}").evaluate("el => (el.innerText || '').trim().length")
        if text_len < 20:
            raise RuntimeError(f"Tab {name} rendered unexpectedly sparse content ({text_len} chars)")
        if shot:
            page.screenshot(path=evidence / shot)
        note("verified tab content", tab=name, text_len=text_len)

    open_tab(page, "data", note)
    for sub in ("stencil-spec", "paste-spec", "runs"):
        page.locator(f'#p-data button.subtab[data-sub="{sub}"]').click()
        expect(page.locator(f'#p-data div[data-sub="{sub}"]')).to_be_visible()
        note("verified data subtab", sub=sub)


def scope(page, evidence, note, **_kwargs):
    """Verify component scope filtering: All -> Component Group -> Single Component -> Clear."""
    ensure_sample_loaded(page, note)
    open_tab(page, "overview", note)

    sel_group = page.locator("#selGroup")
    options = sel_group.locator("option").evaluate_all(
        "opts => opts.map(o => ({value: o.value, text: o.textContent.trim()}))"
    )
    target_group = next((o for o in options if o["value"] and o["value"] != "ALL"), None)
    if not target_group:
        raise RuntimeError("No selectable component group found in #selGroup")

    sel_group.select_option(target_group["value"])
    expect(sel_group).to_have_value(target_group["value"])
    note("selected component group", group=target_group["value"])

    # Select a single component via #inComp -> #compList (skip index 0 which is "全部元件")
    expect(page.locator("#compField")).to_be_visible()
    in_comp = page.locator("#inComp")
    in_comp.click()
    comp_opt = page.locator("#compList [role='option']").filter(has_not_text="全部元件").first
    expect(comp_opt).to_be_visible()
    comp_selected = comp_opt.inner_text().strip()
    comp_opt.click()
    expect(page.locator("#scopeBar")).to_be_visible()
    expect(page.locator("#scopeText")).to_contain_text(comp_selected.split()[0])
    note("selected single component", component=comp_selected)

    page.screenshot(path=evidence / "scope-active.png")

    # Verify scope persists across key analytical tabs
    for tab_name in ("control", "capability", "report"):
        open_tab(page, tab_name, note)
        expect(page.locator("#scopeBar")).to_be_visible()

    # Clear single-component scope and reset group back to ALL
    page.locator("#scopeClear").click()
    expect(page.locator("#scopeBar")).to_be_hidden()
    open_tab(page, "overview", note)
    sel_group.select_option("ALL")
    note("cleared component scope", previous_group=target_group["value"], previous_comp=comp_selected)


def export(page, evidence, note, **_kwargs):
    """Verify Export Center real file downloads: CSV, XLSX (ZIP magic), and Markdown."""
    ensure_sample_loaded(page, note)
    page.locator("#btnOpenExportModal").click()
    expect(page.locator("#exportCenterModal")).to_be_visible()
    expect(page.locator("#exportCenterSummary")).to_contain_text("焊墊筆數")
    page.screenshot(path=evidence / "export-center.png")

    checks = [
        ("iss-csv", ".csv", "csv"),
        ("iss-xlsx", ".xlsx", "xlsx"),
        ("rep-md", ".md", "md"),
    ]
    for exp_type, ext, kind in checks:
        btn = page.locator(f'#exportCenterModal button[data-exp-act="{exp_type}"]')
        expect(btn).to_be_visible()
        with page.expect_download() as dl_info:
            btn.click()
        dl = dl_info.value
        dl_path = dl.path()
        if not dl_path:
            raise RuntimeError(f"Download failed for {exp_type}")
        raw = Path(dl_path).read_bytes()
        if len(raw) < 32:
            raise RuntimeError(f"Downloaded {exp_type} is unexpectedly small ({len(raw)} bytes)")
        if kind == "xlsx" and not raw.startswith(b"PK\x03\x04"):
            raise RuntimeError(f"Downloaded {exp_type} does not start with ZIP/OpenXML magic bytes")
        if kind in ("csv", "md"):
            text = raw.decode("utf-8-sig")
            if len(text.strip()) < 10:
                raise RuntimeError(f"Downloaded {exp_type} decoded text is empty")
        if not dl.suggested_filename.lower().endswith(ext):
            raise RuntimeError(f"Unexpected filename for {exp_type}: {dl.suggested_filename}")
        note("verified export download", type=exp_type, filename=dl.suggested_filename, bytes=len(raw))

    page.locator("#exportCenterClose").click()
    expect(page.locator("#exportCenterModal")).to_be_hidden()


def report(page, evidence, note, **_kwargs):
    ensure_sample_loaded(page, note)
    open_tab(page, "report", note)
    cover = page.locator("#reportPreview #repSec1")
    summary = page.locator("#reportPreview #repSec2")
    expect(cover).to_be_visible()
    expect(summary).to_be_visible()
    page.locator("#chkRep2").uncheck()
    expect(summary).to_be_hidden()
    expect(cover).to_be_visible()
    page.screenshot(path=evidence / "report-summary-hidden.png")
    page.locator("#chkRep2").check()
    expect(summary).to_be_visible()
    note("report preview", summary_restored=True)


def _write_accuracy_fixtures(fixture_dir: Path):
    """Generate deterministic SPI + placement CSVs with engineered in-spec and OOS values."""
    fixture_dir.mkdir(parents=True, exist_ok=True)
    place_csv = fixture_dir / "accuracy-place-top.csv"
    place_csv.write_text(
        "\n".join([
            "RefDes,Center-X(mm),Center-Y(mm),Layer,Footprint",
            "R1,10.00,15.00,TOP,0402",
            "R2,25.00,15.00,TOP,0402",
            "C1,10.00,30.00,TOP,0603",
            "U1,30.00,30.00,TOP,QFN16",
        ]) + "\n",
        encoding="utf-8",
    )
    spi_csv = fixture_dir / "accuracy-spi-top.csv"
    base_vols = [95.0, 96.5, 97.5, 99.0, 100.5, 102.0, 103.5, 105.0]
    comps = [("R1", "0402"), ("R2", "0402"), ("C1", "0603"), ("U1", "QFN16")]
    rows = ["PanelID,ComponentID,PinNumber,Package,Volume(%),Height(um),Area(%),OffsetX(um),OffsetY(um)"]
    for b_idx in range(1, 5):
        board_id = f"B{b_idx:03d}"
        pad_idx = 0
        for comp, pkg in comps:
            for pin in (1, 2):
                vol = base_vols[pad_idx] + (b_idx - 2.5) * 0.4
                # Engineer exactly 2 Volume OOS defects under default spec (70-130%):
                # B002/R1-1 -> 62.0% (< 70 LSL) and B004/U1-2 -> 138.0% (> 130 USL)
                if board_id == "B002" and comp == "R1" and pin == 1:
                    vol = 62.0
                elif board_id == "B004" and comp == "U1" and pin == 2:
                    vol = 138.0
                h = 118.0 + (pad_idx % 4) * 1.0  # strictly within 90-150 um
                area = 97.0 + (pad_idx % 5) * 1.5  # strictly within 70-130 %
                ox = (pin - 1.5) * 8.0  # strictly within +/-75 um
                oy = (b_idx - 2.5) * 4.0
                rows.append(f"{board_id},{comp},{pin},{pkg},{vol:.1f},{h:.1f},{area:.1f},{ox:.1f},{oy:.1f}")
                pad_idx += 1
    spi_csv.write_text("\n".join(rows) + "\n", encoding="utf-8")
    return place_csv, spi_csv


def _compute_ground_truth(spi_csv: Path, *, vol_lsl: float, vol_usl: float):
    """Independently compute exact SPC metrics from the raw CSV file and specification."""
    with spi_csv.open("r", encoding="utf-8", newline="") as fh:
        records_raw = list(csv.DictReader(fh))

    def _mean(xs):
        return sum(xs) / len(xs)

    def _sd(xs):
        m = _mean(xs)
        return math.sqrt(sum((x - m) ** 2 for x in xs) / (len(xs) - 1))

    vols = [float(r["Volume(%)"]) for r in records_raw]
    n = len(vols)
    mu = _mean(vols)
    sd = _sd(vols)

    def is_oos(r):
        v = float(r["Volume(%)"])
        h = float(r["Height(um)"])
        a = float(r["Area(%)"])
        ox = float(r["OffsetX(um)"])
        oy = float(r["OffsetY(um)"])
        return (
            v < vol_lsl or v > vol_usl
            or h < 90.0 or h > 150.0
            or a < 70.0 or a > 130.0
            or ox < -75.0 or ox > 75.0
            or oy < -75.0 or oy > 75.0
        )

    defects = [r for r in records_raw if is_oos(r)]
    ppm = round(len(defects) / n * 1_000_000)

    g0402 = [float(r["Volume(%)"]) for r in records_raw if r["Package"] == "0402"]
    mu_0402 = _mean(g0402)
    sd_0402 = _sd(g0402)
    ppk_0402 = min((vol_usl - mu_0402) / (3.0 * sd_0402), (mu_0402 - vol_lsl) / (3.0 * sd_0402))

    by_board = {}
    for r in records_raw:
        by_board.setdefault(r["PanelID"], []).append(r)
    board_stats = {
        b: {
            "n": len(rs),
            "mean_vol": _mean([float(x["Volume(%)"]) for x in rs]),
            "defects": sum(1 for x in rs if is_oos(x)),
        }
        for b, rs in by_board.items()
    }
    return {
        "n": n,
        "boards": len(by_board),
        "pads": len({(r["ComponentID"], r["PinNumber"]) for r in records_raw}),
        "mean_vol": mu,
        "sd_vol": sd,
        "defects": defects,
        "defect_count": len(defects),
        "ppm": ppm,
        "g0402": {"n": len(g0402), "mean": mu_0402, "sd": sd_0402, "ppk": ppk_0402},
        "board_stats": board_stats,
    }


def accuracy(page, evidence, note, *, scratch=None):
    """Verify UI calculations, 3D HUD, Control Chart CL, exported CSVs, and spec-change
    recomputation against independent ground truth derived from raw CSV + specification.
    """
    fixture_dir = (Path(scratch) if scratch else evidence) / "fixtures-accuracy"
    place_csv, spi_csv = _write_accuracy_fixtures(fixture_dir)
    gt_v1 = _compute_ground_truth(spi_csv, vol_lsl=70.0, vol_usl=130.0)
    gt_v2 = _compute_ground_truth(spi_csv, vol_lsl=98.0, vol_usl=130.0)
    assert gt_v1["defect_count"] == 2, f"Expected 2 engineered defects in v1, got {gt_v1['defect_count']}"
    assert gt_v2["defect_count"] > gt_v1["defect_count"], "Spec v2 tightening must increase defects"

    # 1. Upload controlled placement + SPI measurement file and save Spec v1 (70-130%)
    page.locator("#btnOpenRecModal").click()
    expect(page.locator("#recPickerModal")).to_be_visible()
    page.locator("#btnPickPlace").click()
    page.locator("#btnShowPlaceForm").click()
    expect(page.locator("#uploadRefModal")).to_be_visible()
    page.locator("#upPlaceFile").set_input_files(str(place_csv))
    page.locator("#upPlacePart").fill("ACC-VERIFY-01")
    page.locator("#upPlaceRev").fill("V1")
    page.locator("#upPlaceSide").select_option("TOP")
    page.locator("#upPlaceUnit").select_option("mm")
    with page.expect_response(
        lambda r: urlsplit(r.url).path == "/api/records" and r.request.method == "POST"
    ) as post_place:
        page.locator("#btnSubmitRef").click()
    if post_place.value.status not in (200, 201):
        raise RuntimeError(f"Accuracy placement upload failed: HTTP {post_place.value.status}")
    expect(page.locator("#uploadRefModal")).to_be_hidden()

    page.locator("#btnPickImport").click()
    page.locator("#fileIn").set_input_files(str(spi_csv))
    expect(page.locator("#mapBox")).to_be_visible()
    page.locator("#selSide").select_option("TOP")
    page.locator("#inPart").fill("ACC-VERIFY-01")
    page.locator("#inRev").fill("V1")
    page.locator("#inImpStencil").fill("120")
    page.locator("#inWorkOrder").fill("WO-ACC-01")
    place_choice = page.locator("#placeChoices button[data-pick-place]").first
    expect(place_choice).to_be_visible()
    with page.expect_response(
        lambda r: urlsplit(r.url).path == "/api/records"
        and "id" in parse_qs(urlsplit(r.url).query)
        and r.request.method == "GET"
    ):
        place_choice.click()
    expect(page.locator("#placeState")).to_contain_text("ACC-VERIFY-01")
    with page.expect_response(
        lambda r: urlsplit(r.url).path == "/api/records" and r.request.method == "POST"
    ) as post_spi:
        page.locator("#btnApply").click()
    if post_spi.value.status not in (200, 201):
        raise RuntimeError(f"Accuracy SPI upload failed: HTTP {post_spi.value.status}")
    expect(page.locator("#impDoneBanner")).to_be_visible()
    page.locator("#btnImpDoneInspect").click()
    expect(page.locator("#recPickerModal")).to_be_hidden()

    # Save default Spec v1 (Volume 70-130%)
    open_tab(page, "data", note)
    page.locator('#p-data button.subtab[data-sub="paste-spec"]').click()
    page.locator("#btnSpecSave").click()
    expect(page.locator("#specSaveModal")).to_be_visible()
    page.locator("#specSaveDefault").check()
    with page.expect_response(
        lambda r: urlsplit(r.url).path == "/api/records" and r.request.method == "POST"
    ):
        page.locator("#specSaveOk").click()
    expect(page.locator("#specSaveModal")).to_be_hidden()

    def _assert_close(label, text, pattern, expected, tol):
        m = re.search(pattern, text)
        if not m:
            raise RuntimeError(f"Could not parse {label} from text: {text[:300]}")
        actual = float(m.group(1))
        if abs(actual - expected) > tol:
            raise RuntimeError(f"{label} mismatch: UI={actual}, raw={expected:.4f} (tol={tol})")
        return actual

    # 2. Verify Overview KPIs (Full board) against raw CSV + Spec v1
    open_tab(page, "overview", note)
    expect(page.locator("#kpis")).to_contain_text(f"{gt_v1['boards']} 片板 · {gt_v1['pads']} 個焊墊位置")
    kpis_v1 = page.locator("#kpis").inner_text()
    ui_mean_v1 = _assert_close("full-board mean", kpis_v1, r"平均\s*體積\s*([-+]?\d+(?:\.\d+)?)", gt_v1["mean_vol"], 0.1)
    ui_sd_v1 = _assert_close("full-board overall sd", kpis_v1, r"σ\s*整體\s*([-+]?\d+(?:\.\d+)?)", gt_v1["sd_vol"], 0.015)
    expect(page.locator("#kpis")).to_contain_text(f"{gt_v1['ppm']:,}")
    expect(page.locator("#kpis")).to_contain_text(f"不良焊墊 {gt_v1['defect_count']} 處")
    note(
        "accuracy overview v1 verified",
        ui_mean=ui_mean_v1,
        raw_mean=round(gt_v1["mean_vol"], 4),
        ui_sd=ui_sd_v1,
        raw_sd=round(gt_v1["sd_vol"], 4),
        defects=gt_v1["defect_count"],
        ppm=gt_v1["ppm"],
    )
    page.screenshot(path=evidence / "accuracy-overview-v1.png")

    # 3. Verify Single-Group (0402, n=16) Mean, Overall σ, and exact Ppk
    page.locator("#selGroup").select_option("0402")
    expect(page.locator("#kpis")).to_contain_text("4 片板 · 4 個焊墊位置")
    g = gt_v1["g0402"]
    kpis_g = page.locator("#kpis").inner_text()
    ui_g_mean = _assert_close("0402 mean", kpis_g, r"平均\s*體積\s*([-+]?\d+(?:\.\d+)?)", g["mean"], 0.1)
    ui_g_sd = _assert_close("0402 overall sd", kpis_g, r"σ\s*整體\s*([-+]?\d+(?:\.\d+)?)", g["sd"], 0.015)
    ui_g_ppk = _assert_close("0402 Ppk", kpis_g, r"Ppk\s*([-+]?\d+(?:\.\d+)?)", g["ppk"], 0.015)
    note(
        "accuracy group 0402 ppk verified",
        ui_mean=ui_g_mean,
        raw_mean=round(g["mean"], 4),
        ui_sd=ui_g_sd,
        raw_sd=round(g["sd"], 4),
        ui_ppk=ui_g_ppk,
        raw_ppk=round(g["ppk"], 4),
    )
    page.locator("#selGroup").select_option("ALL")

    # 4. Verify Control Chart CL matches ground-truth mean
    open_tab(page, "control", note)
    ctrl_sub = page.locator("#ctrlSub").inner_text()
    ui_cl = _assert_close("control CL", ctrl_sub, r"CL\s*([-+]?\d+(?:\.\d+)?)", gt_v1["mean_vol"], 0.05)
    note("accuracy control CL verified", ui_cl=ui_cl, raw_mean=round(gt_v1["mean_vol"], 4))

    # 5. Verify 3D HUD per-board stats for B002 against raw CSV
    open_tab(page, "sim3d", note)
    page.locator("#selBoard").select_option("B002")
    b2 = gt_v1["board_stats"]["B002"]
    expect(page.locator("#hud")).to_contain_text("B002")
    expect(page.locator("#hud")).to_contain_text(f"{b2['n']} 焊墊")
    expect(page.locator("#hud")).to_contain_text(f"不良 {b2['defects']}")
    hud_text = page.locator("#hud").inner_text()
    ui_b2_mean = _assert_close("3D HUD B002 mean", hud_text, r"平均體積\s*([-+]?\d+(?:\.\d+)?)", b2["mean_vol"], 0.1)
    note("accuracy 3d HUD B002 verified", board="B002", ui_mean=ui_b2_mean, raw_mean=round(b2["mean_vol"], 4), defects=b2["defects"])

    # 6. Verify Exported CSVs (def-csv and board-csv) against raw CSV + Spec v1
    page.locator("#btnOpenExportModal").click()
    expect(page.locator("#exportCenterModal")).to_be_visible()

    with page.expect_download() as dl_def:
        page.locator('#exportCenterModal button[data-exp-act="def-csv"]').click()
    def_text = Path(dl_def.value.path()).read_text(encoding="utf-8-sig")
    def_rows = [r for r in csv.reader(def_text.splitlines()) if any(c.strip() for c in r)]
    if len(def_rows) - 1 != gt_v1["defect_count"]:
        raise RuntimeError(f"def-csv row count mismatch: expected {gt_v1['defect_count']}, got {len(def_rows) - 1}")
    def_body = "\n".join(",".join(r) for r in def_rows[1:])
    for needle in ("B002", "R1-1", "少錫（體積 < LSL）", "B004", "U1-2", "多錫（體積 > USL）", "ACC-VERIFY-01 v1"):
        if needle not in def_body:
            raise RuntimeError(f"Expected {needle!r} in exported def-csv, got:\n{def_body}")
    def_vols = sorted(float(r[4]) for r in def_rows[1:])
    if def_vols != [62.0, 138.0]:
        raise RuntimeError(f"def-csv volumes mismatch: expected [62.0, 138.0], got {def_vols}")

    with page.expect_download() as dl_brd:
        page.locator('#exportCenterModal button[data-exp-act="board-csv"]').click()
    brd_text = Path(dl_brd.value.path()).read_text(encoding="utf-8-sig")
    brd_rows = [r for r in csv.reader(brd_text.splitlines()) if any(c.strip() for c in r)]
    if len(brd_rows) - 1 != gt_v1["boards"]:
        raise RuntimeError(f"board-csv row count mismatch: expected {gt_v1['boards']}, got {len(brd_rows) - 1}")
    brd_map = {r[0]: r for r in brd_rows[1:]}
    for b_id, b_gt in gt_v1["board_stats"].items():
        cols = brd_map.get(b_id)
        if not cols:
            raise RuntimeError(f"Missing board {b_id} in exported board-csv")
        # Check that at least one numeric column matches the board's exact ground-truth mean volume
        nums = []
        for c in cols[1:]:
            try:
                nums.append(float(c))
            except ValueError:
                pass
        if not any(abs(v - b_gt["mean_vol"]) <= 0.1 for v in nums):
            raise RuntimeError(f"board-csv mean mismatch for {b_id}: expected {b_gt['mean_vol']:.2f}, row={cols}")
    note("accuracy exported CSVs verified", def_rows=len(def_rows) - 1, board_rows=len(brd_rows) - 1)
    page.locator("#exportCenterClose").click()
    expect(page.locator("#exportCenterModal")).to_be_hidden()

    # 7. Specification Sensitivity: tighten Volume LSL from 70 -> 98 (Spec v2) and verify recomputation
    open_tab(page, "data", note)
    page.locator('#p-data button.subtab[data-sub="paste-spec"]').click()
    vol_lsl_in = page.locator("#sp-volume-lsl")
    expect(vol_lsl_in).to_be_visible()
    vol_lsl_in.fill("98")
    vol_lsl_in.dispatch_event("change")
    expect(page.locator("#btnSpecSave")).to_be_enabled()
    page.locator("#btnSpecSave").click()
    expect(page.locator("#specSaveModal")).to_be_visible()
    with page.expect_response(
        lambda r: urlsplit(r.url).path == "/api/records" and r.request.method == "POST"
    ):
        page.locator("#specSaveOk").click()
    expect(page.locator("#specSaveModal")).to_be_hidden()

    open_tab(page, "overview", note)
    expect(page.locator("#kpis")).to_contain_text(f"不良焊墊 {gt_v2['defect_count']} 處")
    expect(page.locator("#kpis")).to_contain_text(f"{gt_v2['ppm']:,}")
    note(
        "accuracy spec v2 sensitivity verified",
        lsl_v2=98.0,
        defects_v1=gt_v1["defect_count"],
        defects_v2=gt_v2["defect_count"],
        ppm_v2=gt_v2["ppm"],
    )
    page.screenshot(path=evidence / "accuracy-overview-v2.png")

    # 8. Cleanup: reload and delete ACC-VERIFY-01 SPI and Placement records so D1 returns to 0
    page.reload()
    expect(page.locator("#btnOpenRecModal")).to_be_visible()
    page.locator("#btnOpenRecModal").click()
    expect(page.locator("#recPickerModal")).to_be_visible()
    for tab_btn_sel, tbl_id, count_sel in (
        ("#btnPickSpi", "tblPickSpi", "#countPickSpi"),
        ("#btnPickPlace", "tblPickPlace", "#countPickPlace"),
    ):
        expect(page.locator("#recPickerProgress")).to_be_hidden()
        page.locator(tab_btn_sel).click()
        row_chk = page.locator(f"#{tbl_id} input[type='checkbox']").first
        expect(row_chk).to_be_visible()
        row_chk.check()
        page.locator("#btnRecBatchDelete").click()
        expect(page.locator("#confirmModal")).to_be_visible()
        page.locator("#confirmOk").click()
        expect(page.locator("#confirmModal")).to_be_hidden()
        expect(page.locator(count_sel)).to_have_text("0")
    page.locator("#recPickerClose").click()
    expect(page.locator("#recPickerModal")).to_be_hidden()


FEATURES = {
    "database": database,
    "records": records,
    "accuracy": accuracy,
    "control": control,
    "sim3d": sim3d,
    "tabs": tabs,
    "scope": scope,
    "export": export,
    "report": report,
}


def run_feature(feature, page, evidence, note, **kwargs):
    page.screenshot(path=evidence / f"{feature}-before.png")
    note("begin feature", feature=feature)
    FEATURES[feature](page, evidence, note, **kwargs)
    page.screenshot(path=evidence / f"{feature}-after.png")
    note("passed feature", feature=feature)

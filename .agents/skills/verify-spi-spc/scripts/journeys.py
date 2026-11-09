import re
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
    page.locator(f'button[data-tab="{name}"]:visible').click()
    expect(page.locator("#p-" + name)).to_be_visible()
    note("tab", name=name)


def refresh(page, button, note):
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
        if data.get("records") != [] or "next" not in data or data["next"] is not None:
            raise RuntimeError("Expected a complete empty record list")
        note("UI response", trigger=button, method="GET", path=url.path + "?" + url.query,
             status=response.status, records=0, next=None)


def database(page, evidence, note):
    open_tab(page, "data", note)
    page.locator('button[data-sub="records"]').click()
    expect(page.locator("#recCard")).to_be_visible()
    expect(page.locator("#recSpi")).to_contain_text("尚無量測紀錄")
    refresh(page, "#recReload", note)
    expect(page.locator("#recSpi")).to_contain_text("尚無量測紀錄")
    expect(page.locator("#recSpiSub")).to_have_text("0 筆")
    expect(page.locator("#recMode")).to_contain_text("verify@example.invalid")
    page.screenshot(path=evidence / "database-panel.png")
    page.locator("#btnOpenRecModal").click()
    expect(page.locator("#recPickerModal")).to_be_visible()
    expect(page.locator("#recPickerNotice")).to_contain_text("量測紀錄 0 筆")
    refresh(page, "#recPickerReload", note)
    expect(page.locator("#recPickerNotice")).to_contain_text("座標檔 0 筆")
    expect(page.locator("#recPickerAuthNotice")).to_be_hidden()
    page.screenshot(path=evidence / "database-picker.png")
    page.locator("#recPickerClose").click()

    def picker_entry(selector, *, placement=False):
        page.locator(selector).click()
        expect(page.locator("#recPickerModal")).to_be_visible()
        expect(page.locator("#recPickerNotice")).to_contain_text("座標檔 0 筆")
        if placement:
            expect(page.locator("#pickQualitySeg")).to_be_hidden()
            expect(page.locator("#boxPickPlace")).to_be_visible()
            expect(page.locator("#boxPickSpi")).to_be_hidden()
        else:
            expect(page.locator("#pickQualitySeg")).to_be_visible()
            expect(page.locator("#boxPickSpi")).to_be_visible()
            expect(page.locator("#boxPickPlace")).to_be_hidden()
        note("picker entry", selector=selector, placement=placement, viewport=page.viewport_size)
        page.screenshot(path=evidence / ("picker-" + selector[1:] + ".png"))
        page.locator("#recPickerClose").click()

    picker_entry("#stateSpi")
    picker_entry("#statePlace", placement=True)
    page.locator('button[data-sub="import"]').click()
    picker_entry("#btnSelectPlace", placement=True)
    open_tab(page, "issues", note)
    picker_entry("#btnBannerLoadDb")
    size = page.viewport_size
    try:
        page.set_viewport_size({"width": 390, "height": 844})
        page.locator("#mtabMore").click()
        picker_entry("#mBtnOpenRecModal")
    finally:
        page.set_viewport_size(size)


def control(page, evidence, note):
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


def sim3d(page, evidence, note):
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


def report(page, evidence, note):
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


FEATURES = {"database": database, "control": control, "sim3d": sim3d, "report": report}


def run_feature(feature, page, evidence, note):
    page.screenshot(path=evidence / f"{feature}-before.png")
    note("begin feature", feature=feature)
    FEATURES[feature](page, evidence, note)
    page.screenshot(path=evidence / f"{feature}-after.png")
    note("passed feature", feature=feature)

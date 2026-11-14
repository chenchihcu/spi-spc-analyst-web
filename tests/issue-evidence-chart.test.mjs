// 問題卡的證據小圖要與說明對得上、對得齊（v10.28.3）
// 1. 孤立極端焊墊卡的小圖畫事實清單裡的同一批焊墊（同順序、同數值），不是單一群組的板平均
// 2. 小圖的拉伸 SVG 只放繪圖標記；軸文字在 HTML，避免文字被拉寬、點變橢圓、標籤錯位
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { HTML, withIdb } = require("./_load");
let JSDOM, VirtualConsole;
try { ({ JSDOM, VirtualConsole } = require("jsdom")); } catch { /* 未安裝 jsdom 時略過 */ }

async function samplePage() {
  const html = fs.readFileSync(HTML, "utf8").replace(/<script src=[^>]+><\/script>/g, "");
  const vc = new VirtualConsole();
  const dom = new JSDOM(html, {
    runScripts: "dangerously", virtualConsole: vc, url: "https://example.test/",
    beforeParse(w) {
      w.HTMLCanvasElement.prototype.getContext = () => new Proxy({}, { get: (t, k) => (k === "measureText" ? () => ({ width: 1 }) : t[k] ?? (() => {})), set: (t, k, v) => ((t[k] = v), true) });
      w.Element.prototype.scrollIntoView = () => {};
      w.matchMedia = () => ({ matches: false, addEventListener() {} });
      w.ResizeObserver = class { observe() {} };
      w.scrollTo = () => {};
      w.Chart = class { constructor() {} destroy() {} static register() {} };
      withIdb(w);
      w.SPI_TEST_HOOK = { bootSample: true };
    },
  });
  for (let i = 0; i < 200 && !(dom.window.SPI_TEST_HOOK.S?.F?.length && !dom.window.SPI_TEST_HOOK.S.F.pending); i++) await new Promise((r) => setTimeout(r, 25));
  return dom;
}

test("問題卡證據小圖：內容與說明一致、軸文字不在拉伸的 SVG 內", { skip: !JSDOM && "未安裝 jsdom" }, async () => {
  const dom = await samplePage();
  const w = dom.window, d = w.document, S = w.SPI_TEST_HOOK.S;
  const iso = S.F.filter((x) => x.sig && x.sig.t === "iso");
  assert.ok(iso.length >= 2, "範例資料應有孤立極端焊墊卡");
  for (const x of iso) {
    const rows = x.sig.rows.slice(0, 10);
    assert.equal(x.ev.type, "bars", `#${x.id} 小圖應為各焊墊長條`);
    assert.deepEqual(Array.from(x.ev.labels), Array.from(rows, (c) => `${c.r.board}/${c.r.pad}`), `#${x.id} 小圖焊墊與事實清單同序`);
    assert.deepEqual(Array.from(x.ev.values), Array.from(rows, (c) => c.x), `#${x.id} 小圖數值＝事實清單的實測值`);
    x.ev.labels.forEach((lab, i) => assert.ok(x.facts[i].includes(lab.split("/")[0]) && x.facts[i].includes(lab.split("/")[1]), `#${x.id} 第 ${i + 1} 根長條對應第 ${i + 1} 行事實`));
    for (const i of x.ev.hi) assert.equal(rows[i].lv, x.lv, `#${x.id} 標色長條的等級與卡片一致`);
    // 跨群組的卡不可只畫一個群組
    assert.doesNotMatch(x.ev.title, /各板平均/);
  }

  d.querySelector('#issFilter [data-group="rules"]').click();
  const cards = [...d.querySelectorAll("#issList details.iss-card")];
  assert.ok(cards.length > 0);
  for (const c of cards) {
    const svg = c.querySelector(".iss-detail svg.ev");
    assert.ok(svg, `#${c.dataset.id} 有證據小圖`);
    assert.equal(svg.querySelector("text,circle"), null, `#${c.dataset.id} 拉伸的 SVG 內不可有文字或圓（會變形）`);
    assert.ok(svg.parentElement.classList.contains("ev-wrap"));
    assert.ok(c.querySelectorAll(".ev-yax span").length >= 1, `#${c.dataset.id} 有 y 軸標籤`);
    assert.ok(c.querySelectorAll(".ev-xax span").length >= 1, `#${c.dataset.id} 有 x 軸標籤`);
    const sp = c.querySelector("summary .iss-spark");
    if (sp) assert.equal(sp.querySelector("text"), null, "摘要迷你圖不含文字");
  }
  assert.equal(d.querySelector("#issList summary .ev-cap"), null, "摘要迷你圖不帶標題");
  // 長條 ≤ 6 根時，每根都有置中的標籤
  const two = cards.find((c) => c.querySelectorAll(".iss-detail svg.ev rect").length === 2);
  if (two) {
    const xs = [...two.querySelectorAll(".ev-xax span")];
    assert.equal(xs.length, 2, "兩根長條各有一個 x 標籤");
    assert.match(xs[0].getAttribute("style"), /left:25\.00%;transform:translateX\(-50%\)/);
  }
  // 參考線拉大刻度、兩個極值很接近時，y 標籤不可重疊（Codex 審查 #167）
  const html = w.SPI_TEST_HOOK.evSvg({ type: "bars", title: "t", labels: ["a", "b"], values: [10, 11], ref: [3], hi: [] }, "warn");
  const tops = [...html.matchAll(/<span style="top:([\d.]+)px">/g)].map((m) => +m[1]);
  assert.equal(tops.length, 2);
  assert.ok(tops[1] - tops[0] >= 15, `y 標籤間距 ${tops[1] - tops[0]}px 應 ≥ 一行高`);
  assert.match(html, />11\.0</);
  assert.match(html, />10\.0</);
  w.close();
});

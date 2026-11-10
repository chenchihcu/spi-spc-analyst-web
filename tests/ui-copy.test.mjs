import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const html = fs.readFileSync(path.join(ROOT, "spi-spc.html"), "utf8");

const forbidden = [
  "Executive Summary",
  "Closed-Loop Correction",
  "Pass/Fail)",
  "(OOC)",
  "(Shift)",
  "(Drift)",
  "Bridge Margin",
  "<summary>怎麼看</summary>",
  "<summary>偵測邏輯</summary>",
  "<summary>怎麼用</summary>",
  "<summary>判定方式</summary>",
  "<summary>風險分數怎麼算</summary>",
  "<summary>怎麼設定</summary>",
  'label:"體積 Volume"',
  "Reasoning Effort",
  "高 (high)",
  "Executive &",
  "Process &",
  "Stencil &",
  "批號 (Lot)",
  "面別 (Side)",
  "版本 (Rev)",
  "收件人 (To)",
  "副本 (Cc)",
  "本版尚未提供（規劃中）",
  "解讀：X̄ 圖看",
  "主題：明亮（切換深色）",
  "主題：深色（切換明亮）",
  "下載 3D 圖",
  "下載已勾選項目",
  "列印／存成 PDF",
  "常態機率圖 Q-Q",
  "高度 × 面積 散佈",
  "一鍵下載標準交付包",
];

test("spi-spc.html 不含禁用教學段與英文譯名", () => {
  for (const needle of forbidden) {
    assert.equal(
      html.includes(needle),
      false,
      `不應出現：${needle}`
    );
  }
});

test("spi-spc.html 保留功能型折疊", () => {
  assert.match(html, /id="aiPayloadDetails"/);
  assert.match(html, /id="recAuditBox"/);
  assert.match(html, /<summary>預覽送出內容<\/summary>/);
});

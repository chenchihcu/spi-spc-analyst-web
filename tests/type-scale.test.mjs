import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const html = fs.readFileSync(path.join(ROOT, "spi-spc.html"), "utf8");

test("typography tokens defined in :root", () => {
  const required = [
    "--fs-brand:32px",
    "--fs-body:14px",
    "--fs-heading:15px",
    "--fs-title:18px",
    "--fs-ui:13px",
    "--fs-caption:12px",
    "--fs-input:16px",
    "--fs-body-mobile:16px",
    "--fs-chart:10px",
    "--fs-tab-label:12px",
  ];
  for (const tok of required) {
    assert.match(html, new RegExp(tok.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")), `需定義 ${tok}`);
  }
});

test("spi-spc.html 不使用裸 font-size px（允許 font-size:0）", () => {
  const hits = [...html.matchAll(/font-size:\s*[0-9.]+px/gi)].map((m) =>
    m[0].replace(/\s/g, ""),
  );
  const bad = hits.filter((h) => h !== "font-size:0");
  assert.equal(
    bad.length,
    0,
    `發現裸 font-size px：${bad.slice(0, 8).join(", ")}`,
  );
});

test("Chart.js 預設字級讀取 --fs-caption", () => {
  assert.match(
    html,
    /getComputedStyle\(document\.documentElement\)\.getPropertyValue\("--fs-caption"\)/,
    "Chart 預設字級應從 --fs-caption 讀取",
  );
});

test("CJK 雙字重標準：除西文 @font-face 外，UI 樣式與標籤僅使用 400 與 700 字重", () => {
  const lines = html.split(/\r?\n/);
  const badWeights = [];
  lines.forEach((line, idx) => {
    // 略過西文 Webfont @font-face 定義區（前 30 行）
    if (idx < 30 && line.includes("@font-face")) return;
    const matches = line.match(/font-weight:\s*(?:500|600|800|900)/g);
    if (matches) {
      badWeights.push(`第 ${idx + 1} 行: ${line.trim()}`);
    }
  });
  assert.equal(
    badWeights.length,
    0,
    `發現違規非 400/700 CJK 字重：\n${badWeights.slice(0, 10).join("\n")}`,
  );
});

test("表單控制項顯式繼承字型 font-family:inherit", () => {
  assert.match(
    html,
    /select,input\[type=number\],input\[type=text\],input\[type=password\],textarea\{font:inherit;font-family:inherit;/,
    "表單輸入框應顯式包含 font-family:inherit",
  );
  assert.match(
    html,
    /button\{font:inherit;font-family:inherit;/,
    "按鈕應顯式包含 font-family:inherit",
  );
});

test("標準空狀態 .empty-state 樣式與表格包裹容器 .tbl 定義", () => {
  assert.match(html, /\.empty-state\{/, "需定義 .empty-state 樣式");
  assert.match(html, /\.empty-cell\{/, "需定義 .empty-cell 樣式");
  assert.match(html, /<div class="tbl"[^>]*>\s*<table id="statsTbl">/, "statsTbl 需被 .tbl 包裹");
  assert.match(html, /<div class="tbl"[^>]*>\s*<table id="matrixTbl">/, "matrixTbl 需被 .tbl 包裹");
});

test("模態視窗具備背景滾動鎖定與焦點捕捉守衛", () => {
  assert.match(
    html,
    /document\.body\.style\.overflow="hidden"/,
    "開啟 Modal 需鎖定 body 滾動",
  );
  assert.match(
    html,
    /document\.body\.style\.overflow=""/,
    "關閉 Modal 需還原 body 滾動",
  );
});

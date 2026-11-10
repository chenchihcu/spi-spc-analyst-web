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
    "--fs-heading:16px",
    "--fs-title:18px",
    "--fs-ui:13px",
    "--fs-caption:12px",
    "--fs-input:16px",
    "--fs-body-mobile:16px",
    "--fs-chart:12px",
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

test("全站嚴禁 <12px 字級：Chart.js 與 2D Canvas 全面 >=12px", () => {
  const lines = html.split(/\r?\n/);
  const badCharts = [];
  lines.forEach((l, idx) => {
    if (idx >= 6000 && idx <= 8000) {
      if (/size:\s*(?:[1-9]|10|11)\b/.test(l)) {
        badCharts.push("第 " + (idx + 1) + " 行 Chart.js 字級 <12px: " + l.trim());
      }
      const fontMatch = l.match(/ctx\.font\s*=\s*["']([^"']+)["']/);
      if (fontMatch) {
        const pxMatch = fontMatch[1].match(/(\d+)px/);
        if (pxMatch && parseInt(pxMatch[1], 10) < 12) {
          badCharts.push("第 " + (idx + 1) + " 行 Canvas 字級 <12px: " + l.trim());
        }
      }
    }
  });
  assert.equal(badCharts.length, 0, "發現圖表或 Canvas 字級 <12px：\n" + badCharts.join("\n"));
});

test("登入頁符合語義字級 Token 與雙字重合約 (lib/auth-handler.mjs)", async () => {
  const { loginPage } = await import("../lib/auth-handler.mjs");
  const resp = loginPage("/?test=1");
  const loginHtml = await resp.text();

  const required = ["--fs-brand:32px", "--fs-title:18px", "--fs-heading:16px", "--fs-body:14px", "--fs-ui:13px", "--fs-caption:12px", "--fs-input:16px"];
  for (const tok of required) {
    assert.match(loginHtml, new RegExp(tok.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")), "登入頁需定義 " + tok);
  }

  const styleMatch = loginHtml.match(/<style>([\s\S]*?)<\/style>/i);
  assert.ok(styleMatch, "登入頁需包含 <style>");
  const styleContent = styleMatch[1];
  const badWeights = [...styleContent.matchAll(/font-weight:\s*(?:500|600|800|900)/g)];
  assert.ok(badWeights.length <= 1, "登入頁樣式發現非 400/700 CJK 字重：" + badWeights.length);

  assert.match(loginHtml, /input\{[^}]*font-family:\s*inherit/i, "input 需顯式繼承字型");
  assert.match(loginHtml, /\.submit\{[^}]*font-family:\s*inherit/i, ".submit 需顯式繼承字型");
  assert.match(loginHtml, /\.submit\{[^}]*font-weight:\s*700/i, ".submit 需為 700 粗體");
});
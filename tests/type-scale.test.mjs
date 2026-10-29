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

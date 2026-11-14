// 登入頁個人化：SPI·SPC 品牌圖（焊墊掃描線＋迷你管制圖）、記住帳號、沿用主題偏好
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { createRequire } from "node:module";
import { loginPage } from "../lib/auth-handler.mjs";

const require = createRequire(import.meta.url);
let JSDOM, VirtualConsole;
try { ({ JSDOM, VirtualConsole } = require("jsdom")); } catch { /* 未安裝 jsdom 時略過 */ }
const AUTH_JS = fs.readFileSync(new URL("../vendor/login-auth.js", import.meta.url), "utf8");

async function page(iter) { return (await loginPage("/", iter).text()); }

/** 以 jsdom 開登入頁；seed 先寫入 localStorage；withAuth 時以內嵌方式載入 login-auth.js 並替換 fetch */
async function open({ seed = {}, withAuth = false, fetchImpl, blockStorage = false } = {}) {
  let html = await page(1000);
  if (withAuth) html = html.replace('<script src="/vendor/login-auth.js"></script>', `<script>${AUTH_JS}</script>`);
  const vc = new VirtualConsole();
  const errs = [];
  vc.on("jsdomError", (e) => { if (!/navigation/i.test(e.message)) errs.push(e.message); });
  const dom = new JSDOM(html, {
    url: "https://spi.example/__login", runScripts: "dangerously", pretendToBeVisual: true, virtualConsole: vc,
    beforeParse(w) {
      for (const [k, v] of Object.entries(seed)) w.localStorage.setItem(k, v);
      if (blockStorage) Object.defineProperty(w, "localStorage", { get() { throw new Error("blocked"); } });
      w.crypto.subtle || Object.defineProperty(w.crypto, "subtle", { value: globalThis.crypto.subtle });
      w.TextEncoder = globalThis.TextEncoder;
      if (fetchImpl) w.fetch = fetchImpl;
    },
  });
  await until(() => dom.window.document.readyState === "complete");
  return { dom, w: dom.window, d: dom.window.document, errs };
}

async function until(fn, ms = 5000) {
  const t0 = Date.now();
  while (!fn()) { if (Date.now() - t0 > ms) throw new Error("逾時"); await new Promise((r) => setTimeout(r, 10)); }
}

test("品牌區：焊墊掃描線與迷你管制圖為裝飾、口號已刪", async () => {
  const html = await page();
  assert.match(html, /<div class="scope" aria-hidden="true">[\s\S]*?<span class="scan"><\/span>/, "焊墊圖需含掃描線且 aria-hidden");
  assert.match(html, /<svg class="chart"[^>]*aria-hidden="true"/, "管制圖需 aria-hidden");
  assert.equal((html.match(/<circle[^>]*class="out"/g) || []).length, 1, "管制圖只有一點越界");
  assert.match(html, /\.chart circle\.out\{fill:var\(--paste-bad\)\}/, "越界點與不良焊墊同色");
  assert.match(html, /@keyframes scan\{from\{transform:translateX\(0\)\}to\{transform:translateX\(100%\)\}\}/, "掃描線只動 transform");
  assert.match(html, /@media \(prefers-reduced-motion:reduce\)\{[^}]*\.scan\{animation:none\}/, "減少動態時掃描線停止");
  assert.match(html, /@media \(max-width:720px\)\{[^\n]*\.chart\{display:none\}/, "窄版隱藏管制圖");
  assert.doesNotMatch(html, /把異常抓出來/, "口號應刪除");
});

test("登入頁不把密碼或 d 寫入任何儲存", () => {
  const all = AUTH_JS + "\n" + fs.readFileSync(new URL("../lib/auth-handler.mjs", import.meta.url), "utf8");
  for (const m of all.matchAll(/(?:localStorage|sessionStorage)\.setItem\(([^)]*)\)/g)) {
    assert.doesNotMatch(m[1], /\bpass\b|\bd\b/, "storage 寫入不可含密碼或 d：" + m[0]);
  }
  assert.doesNotMatch(all, /document\.cookie\s*=/, "不可由前端寫 cookie");
});

test("首次使用：無問候、帳號欄可見、記住預設勾選", { skip: !JSDOM && "未安裝 jsdom" }, async () => {
  const { d, errs } = await open();
  assert.equal(d.getElementById("who").hidden, true);
  assert.equal(d.getElementById("userField").hidden, false);
  assert.equal(d.getElementById("loginTitle").textContent, "登入");
  assert.equal(d.getElementById("remember").checked, true);
  assert.equal(d.documentElement.getAttribute("data-theme"), "light");
  assert.deepEqual(errs, []);
});

test("回訪：問候、預填帳號、不是你？清除", { skip: !JSDOM && "未安裝 jsdom" }, async () => {
  const { w, d } = await open({ seed: { "spi-last-user": "alice@x.com" } });
  assert.equal(d.getElementById("who").hidden, false);
  assert.equal(d.getElementById("whoUser").textContent, "alice@x.com");
  assert.equal(d.getElementById("user").value, "alice@x.com");
  assert.equal(d.getElementById("userField").hidden, true);
  assert.equal(d.getElementById("loginTitle").textContent, "歡迎回來");
  d.getElementById("notMe").click();
  assert.equal(w.localStorage.getItem("spi-last-user"), null);
  assert.equal(d.getElementById("user").value, "");
  assert.equal(d.getElementById("who").hidden, true);
  assert.equal(d.getElementById("userField").hidden, false);
  assert.equal(d.activeElement, d.getElementById("user"));
});

test("記錄不是 email 時不顯示、刪除且不以 HTML 插入", { skip: !JSDOM && "未安裝 jsdom" }, async () => {
  const { w, d } = await open({ seed: { "spi-last-user": "<img src=x onerror=alert(1)>" } });
  assert.equal(d.getElementById("who").hidden, true);
  assert.equal(w.localStorage.getItem("spi-last-user"), null);
  assert.equal(d.querySelector("#who img"), null);
});

test("沿用主程式深色主題；儲存被封鎖時仍可用", { skip: !JSDOM && "未安裝 jsdom" }, async () => {
  const dark = await open({ seed: { "spi-theme": "dark" } });
  assert.equal(dark.d.documentElement.getAttribute("data-theme"), "dark");
  const blocked = await open({ blockStorage: true });
  assert.equal(blocked.d.documentElement.getAttribute("data-theme"), "light");
  assert.equal(blocked.d.getElementById("who").hidden, true);
  assert.deepEqual(blocked.errs, []);
});

function stubFetch(ok, calls) {
  return async (url, init) => {
    calls.push(JSON.parse(init.body));
    return { ok, json: async () => (ok ? { ok: true, next: "/" } : { error: "bad" }) };
  };
}
async function submit(ctx, user, pass) {
  ctx.d.getElementById("user").value = user;
  ctx.d.getElementById("pass").value = pass;
  ctx.d.getElementById("loginForm").dispatchEvent(new ctx.w.Event("submit", { cancelable: true }));
  await until(() => ctx.d.getElementById("go").textContent === "登入" && !ctx.d.getElementById("go").disabled);
}

test("登入成功且勾選記住：存正規化帳號，不存密碼", { skip: !JSDOM && "未安裝 jsdom" }, async () => {
  const calls = [];
  const ctx = await open({ withAuth: true, fetchImpl: stubFetch(true, calls) });
  ctx.d.getElementById("user").value = "  Alice@X.com ";
  ctx.d.getElementById("pass").value = "secret-pw";
  ctx.d.getElementById("loginForm").dispatchEvent(new ctx.w.Event("submit", { cancelable: true }));
  await until(() => ctx.w.localStorage.getItem("spi-last-user") !== null);
  assert.equal(ctx.w.localStorage.getItem("spi-last-user"), "alice@x.com");
  assert.equal(calls.length, 1);
  const dump = JSON.stringify({ ...ctx.w.localStorage }) + JSON.stringify({ ...ctx.w.sessionStorage }) + ctx.d.cookie + ctx.w.location.href;
  assert.doesNotMatch(dump, /secret-pw/);
  assert.ok(!dump.includes(calls[0].d), "d 不可落地");
});

test("登入失敗不改記錄；取消勾選登入成功會刪除記錄", { skip: !JSDOM && "未安裝 jsdom" }, async () => {
  const fail = await open({ withAuth: true, seed: { "spi-last-user": "bob@x.com" }, fetchImpl: stubFetch(false, []) });
  await submit(fail, "carol@x.com", "wrong");
  assert.equal(fail.w.localStorage.getItem("spi-last-user"), "bob@x.com");

  const ok = await open({ withAuth: true, seed: { "spi-last-user": "bob@x.com" }, fetchImpl: stubFetch(true, []) });
  ok.d.getElementById("remember").checked = false;
  ok.d.getElementById("pass").value = "pw";
  ok.d.getElementById("loginForm").dispatchEvent(new ok.w.Event("submit", { cancelable: true }));
  await until(() => ok.w.localStorage.getItem("spi-last-user") === null);
});

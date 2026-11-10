// lib/auth-handler.mjs: 整合 Cloudflare Workers 免費方案配額的登入與身分驗證處理模組
// 實作規範：D-35, D-36, D-59, D-60 ③, R8-8, R8-9
import { APP_VERSION, APP_BUILT } from "#build-info";
import { SEC } from "./security-headers.mjs";
import { Repo } from "./repo.mjs";

export const COOKIE = "spi_auth";
export const SESSION_SECONDS = 12 * 60 * 60;

const enc = new TextEncoder();
const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");

export function safeEqual(a, b) {
  a = String(a || "");
  b = String(b || "");
  let diff = a.length ^ b.length;
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  }
  return diff === 0;
}

export const norm = (u) => String(u || "").trim().toLowerCase();

export function safeNext(next) {
  return typeof next === "string" && /^\/(?!\/)[^\s\\]*$/.test(next) && !next.startsWith("/__") ? next : "/";
}

/** 簽章用密碼標記：取 pepper-hmac-sha256$<iter>$<hex> 雜湊的前 16 碼 */
function credTag(cred) {
  const parts = String(cred || "").split("$");
  const h = parts[2] || parts[0];
  return h.slice(0, 16).toLowerCase();
}

/** 解析 AUTH_USERS JSON：回傳 Map<帳號, pepper-hmac-sha256$<iter>$<hex>> */
export function users(env) {
  const m = new Map();
  if (!env || !env.AUTH_USERS) return m;
  try {
    const v = JSON.parse(env.AUTH_USERS);
    const targetIter = String(env.AUTH_KDF_ITER || 600000);
    if (v && typeof v === "object" && !Array.isArray(v)) {
      for (const [u, h] of Object.entries(v)) {
        const strH = String(h || "").trim();
        const parts = strH.split("$");
        if (parts[0] === "pepper-hmac-sha256" && parts[1] === targetIter && /^[0-9a-f]{64}$/i.test(parts[2])) {
          m.set(norm(u), strH);
        }
      }
    }
  } catch {}
  return m;
}

export function configured(env) {
  if (!env || !env.AUTH_SECRET || env.AUTH_SECRET.length < 32) return false;
  if (!env.AUTH_PEPPER || env.AUTH_PEPPER.length < 32) return false;
  return users(env).size > 0;
}

async function hmacHex(secret, msg) {
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(msg));
  return hex(sig);
}

const b64u = (s) => btoa(String.fromCharCode(...enc.encode(s))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const unb64u = (s) => new TextDecoder().decode(Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0)));
const signMsg = (u, exp, h) => `${u}|${exp}|${credTag(h)}`;

export async function issueToken(env, user, nowSec = Math.floor(Date.now() / 1000)) {
  const u = norm(user);
  const h = users(env).get(u);
  if (!h) throw new Error("帳號不存在");
  const exp = nowSec + SESSION_SECONDS;
  const sig = await hmacHex(env.AUTH_SECRET, signMsg(u, exp, h));
  return `${exp}.${b64u(u)}.${sig}`;
}

export async function verifyToken(env, token, nowSec = Math.floor(Date.now() / 1000)) {
  if (!configured(env) || typeof token !== "string") return null;
  const m = token.match(/^(\d{10})\.([A-Za-z0-9_-]{1,200})\.([0-9a-f]{64})$/);
  if (!m || +m[1] < nowSec) return null;
  let u;
  try { u = norm(unb64u(m[2])); } catch { return null; }
  const h = users(env).get(u);
  if (!h) return null;
  const expected = await hmacHex(env.AUTH_SECRET, signMsg(u, m[1], h));
  return safeEqual(m[3], expected) ? u : null;
}

export function readCookie(header, name = COOKIE) {
  for (const part of String(header || "").split(";")) {
    const i = part.indexOf("=");
    if (i > 0 && part.slice(0, i).trim() === name) {
      try { return decodeURIComponent(part.slice(i + 1).trim()); } catch { return null; }
    }
  }
  return null;
}

/** 依 15 分鐘 5 次失敗規則計算鎖定時刻 (毫秒) */
export function lockUntil(times) {
  const t = [...times].sort((a, b) => a - b);
  let until = 0;
  const windowMs = 15 * 60_000, lockMs = 15 * 60_000, maxFails = 5;
  for (let i = maxFails - 1; i < t.length; i++) {
    if (t[i] - t[i - maxFails + 1] < windowMs) {
      until = Math.max(until, t[i] + lockMs);
    }
  }
  return until;
}

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

const MITCORP_PATH = "M13.8,-0.0L28.5,-0.1L29.2,0.0L30.6,1.0L31.5,2.9L34.7,29.0L35.0,29.8L36.2,30.2L37.5,29.8L38.3,28.2L46.9,3.5L48.0,1.5L48.8,0.8L50.5,-0.1L66.3,0.0L67.6,1.0L68.4,3.2L68.4,30.8L68.3,32.2L67.7,33.8L66.0,34.8L62.8,35.0L59.2,34.8L57.7,33.8L57.3,31.5L57.3,5.8L56.7,4.5L55.2,4.0L53.0,4.7L52.0,6.5L43.5,31.5L42.2,33.3L41.2,34.1L38.2,34.8L28.8,34.8L26.0,34.0L24.6,32.5L24.0,29.8L20.9,5.8L20.2,4.5L18.5,4.0L17.0,4.5L16.5,5.2L12.3,26.8L11.3,30.0L10.5,31.5L8.4,33.8L6.3,35.0L2.2,35.7L1.2,35.7L0.0,35.0L0.0,30.2L1.2,29.6L4.5,28.9L5.4,28.0L6.2,26.2L10.7,3.0L11.9,1.0L13.8,-0.0ZM73.2,-0.0L83.8,0.0L84.6,1.3L84.5,4.2L83.8,5.4L82.8,5.7L75.5,5.8L73.2,5.5L72.7,4.8L72.5,2.8L72.6,1.0L73.2,-0.0ZM90.0,1.7L95.5,1.6L97.2,2.1L97.8,2.8L98.2,4.0L98.3,8.5L98.6,9.2L99.3,9.7L109.8,9.8L110.9,10.2L111.4,12.0L110.9,13.2L110.2,13.6L99.8,13.7L98.8,14.1L98.2,15.5L98.3,27.0L99.0,29.8L100.5,30.9L104.2,31.1L112.5,30.9L113.1,31.5L113.2,33.0L113.0,33.8L112.2,34.6L110.5,35.0L104.5,35.3L95.8,35.1L92.0,33.9L89.9,32.2L88.9,30.5L88.4,27.5L88.4,5.5L88.6,3.0L89.2,2.1L90.0,1.7ZM130.5,9.2L135.5,9.3L144.3,10.0L145.5,10.4L146.1,11.0L146.2,13.2L145.7,14.0L145.0,14.3L140.3,13.8L133.0,13.6L129.5,13.9L127.0,14.9L125.1,17.0L124.3,20.0L124.3,24.0L125.1,27.8L127.0,29.8L130.0,30.9L137.5,31.1L145.2,30.4L146.0,31.0L146.3,32.0L146.2,33.5L145.5,34.3L142.5,35.0L135.2,35.4L129.5,35.4L124.0,34.9L120.5,33.9L118.2,32.8L116.1,30.8L115.1,29.2L114.0,25.5L113.9,20.0L115.0,15.8L116.1,14.0L118.2,12.0L120.5,10.8L124.2,9.8L130.5,9.2ZM161.8,9.5L168.5,9.3L174.8,9.9L178.2,10.8L180.2,11.8L182.8,14.0L183.9,15.8L184.7,18.8L184.9,24.5L184.7,26.2L183.8,29.2L181.8,32.0L178.8,33.9L175.5,34.9L166.0,35.7L156.8,34.8L153.8,33.8L152.0,32.9L150.4,31.5L149.2,30.0L148.3,28.0L147.9,25.5L148.0,18.2L149.1,15.0L151.0,12.8L154.0,11.0L158.0,9.8L161.8,9.5ZM203.0,9.5L209.8,9.4L210.7,10.5L210.8,11.8L210.5,12.8L209.5,13.6L201.8,13.9L200.2,14.2L199.2,14.8L198.7,16.0L198.7,31.0L198.3,33.5L197.5,34.5L196.2,34.9L190.5,34.8L189.1,33.8L188.8,32.0L188.7,15.2L189.2,12.5L190.0,11.7L191.9,10.8L197.2,9.8L203.0,9.5ZM224.0,9.5L230.5,9.3L237.9,9.8L242.2,10.9L244.2,12.0L246.2,14.0L247.0,15.2L247.8,17.3L247.8,27.8L246.9,30.0L245.9,31.5L244.8,32.6L242.8,33.8L240.0,34.8L232.2,35.5L223.2,35.4L222.6,36.0L222.4,36.8L222.2,43.5L221.3,44.8L213.5,44.8L212.6,43.5L212.4,41.8L212.6,13.0L213.2,11.7L214.6,10.8L218.5,9.9L224.0,9.5ZM75.5,9.9L79.0,9.8L81.5,10.0L82.8,10.8L83.4,12.0L83.5,32.2L83.0,33.8L81.5,34.8L75.5,34.8L74.1,34.0L73.7,33.2L73.6,12.0L74.0,10.8L75.5,9.9ZM163.2,13.0L160.8,14.0L159.4,15.2L158.3,18.8L158.1,22.5L158.3,26.5L159.2,29.2L160.5,30.8L162.8,31.8L166.0,32.1L169.8,31.8L172.0,30.8L173.0,29.8L173.9,28.2L174.4,25.0L174.4,21.8L173.9,16.5L173.0,15.0L171.9,14.0L168.5,12.9L163.2,13.0ZM226.0,13.0L223.5,13.5L222.7,14.0L222.4,14.5L222.5,30.5L224.0,31.6L227.5,31.9L232.5,31.9L235.0,31.0L236.0,30.1L237.0,28.7L237.7,25.5L237.8,20.8L237.0,16.2L235.3,14.0L233.0,13.1L230.2,12.8L226.0,13.0Z";

function padArt() {
  const rows = [];
  for (let r = 0; r < 6; r++) {
    const cells = [];
    for (let c = 0; c < 8; c++) {
      const round = r >= 2 && r <= 4 && c >= 2 && c <= 5;
      const bad = r === 3 && c === 4;
      cells.push(`<span class="pad${round ? " r" : ""}${bad ? " bad" : ""}"${bad ? ' aria-hidden="true"' : ""}></span>`);
    }
    rows.push(cells.join(""));
  }
  return rows.join("");
}

export function loginPage(nextPath, iter = 600000, limiterMissing = false) {
  const limiterBanner = limiterMissing
    ? `<div class="err" role="alert" style="margin-bottom:12px;background:var(--ng-soft);color:var(--ng);padding:10px 12px;border-radius:8px;">登入暫停：伺服器缺少登入限流設定，請通知管理員</div>`
    : "";
  const submitAttr = limiterMissing ? " disabled" : "";
  const html = `<!doctype html><html lang="zh-Hant" data-theme="light"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="color-scheme" content="light dark">
<meta name="theme-color" content="#F2F4F0" media="(prefers-color-scheme: light)">
<meta name="theme-color" content="#0F1311" media="(prefers-color-scheme: dark)">
<title>SPI·SPC 分析台 · 登入</title><meta name="robots" content="noindex">
<link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16'%3E%3Crect width='16' height='16' rx='3' fill='%23A3521D'/%3E%3Ctext x='8' y='12' font-size='10' font-weight='bold' fill='%23FFF' text-anchor='middle'%3ES%3C/text%3E%3C/svg%3E">
<style>
@font-face{font-family:"Barlow Condensed";font-weight:600;font-display:swap;src:url(/vendor/fonts/barlow-condensed-latin-600-normal.woff2) format("woff2")}
@font-face{font-family:"IBM Plex Mono";font-weight:400;font-display:swap;src:url(/vendor/fonts/ibm-plex-mono-latin-400-normal.woff2) format("woff2")}
:root{--bg:#F2F4F0;--surface:#FFFFFF;--ink:#18201B;--muted:#58625B;--line:#D2D8D1;--accent:#A3521D;--on-accent:#FFFFFF;--ng:#B83A2C;--ng-soft:#F7DDD9;--warn:#A86E12;
  --brand-bg:#E8ECE6;--brand-ink:#18201B;--brand-muted:#4A544D;--brand-accent:#6E3410;--logo-ink:#04273F;--paste:#C86D32;--paste-dim:#D2D8D1;--paste-bad:#B83A2C;
  --fs-brand:32px;--fs-brand-narrow:24px;--fs-title:18px;--fs-heading:16px;--fs-body:14px;--fs-ui:13px;--fs-caption:12px;--fs-input:16px;
  --f-display:"Barlow Condensed","Microsoft JhengHei","PingFang TC",system-ui,sans-serif;--f-body:"Microsoft JhengHei","PingFang TC","Noto Sans TC",system-ui,sans-serif;--f-mono:"IBM Plex Mono",ui-monospace,monospace;color-scheme:light}
@media (prefers-color-scheme:dark){:root:not([data-theme="light"]){--bg:#0F1311;--surface:#171C19;--ink:#E4E9E4;--muted:#98A39B;--line:#2D3731;--accent:#DB8A50;--on-accent:#14100C;--ng:#EC6F60;--ng-soft:#41201B;--warn:#E3AE50;--brand-bg:#0A0D0B;--brand-ink:#E4E9E4;--brand-muted:#98A39B;--brand-accent:#F2C6A5;--logo-ink:#E4E9E4;--paste:#DB8A50;--paste-dim:#3A2516;--paste-bad:#EC6F60;color-scheme:dark}}
:root[data-theme="dark"]{--bg:#0F1311;--surface:#171C19;--ink:#E4E9E4;--muted:#98A39B;--line:#2D3731;--accent:#DB8A50;--on-accent:#14100C;--ng:#EC6F60;--ng-soft:#41201B;--warn:#E3AE50;--brand-bg:#0A0D0B;--brand-ink:#E4E9E4;--brand-muted:#98A39B;--brand-accent:#F2C6A5;--logo-ink:#E4E9E4;--paste:#DB8A50;--paste-dim:#3A2516;--paste-bad:#EC6F60;color-scheme:dark}
*{box-sizing:border-box}
html,body{height:100%}
body{margin:0;background:var(--bg);color:var(--ink);font-family:var(--f-body);font-size:var(--fs-body);line-height:1.6;display:grid;place-items:center;padding:max(24px,env(safe-area-inset-top,0px)) max(16px,env(safe-area-inset-right,0px)) max(24px,env(safe-area-inset-bottom,0px)) max(16px,env(safe-area-inset-left,0px))}
.shell{width:min(860px,100%);display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);background:var(--surface);border:1px solid var(--line);border-radius:14px;overflow:hidden}
.brand{background:var(--brand-bg);color:var(--brand-ink);border-right:1px solid var(--line);padding:36px 32px;display:flex;flex-direction:column;justify-content:space-between;gap:28px}
.brand-head{display:flex;flex-direction:column;align-items:flex-start;gap:10px}
.mitcorp-logo{display:block;height:28px;width:auto;color:var(--logo-ink);flex-shrink:0}
.brand h1{margin:0;font-family:var(--f-display);font-size:var(--fs-brand);font-weight:700;line-height:1.05;letter-spacing:.02em;color:var(--brand-accent)}
.brand .sub{margin:4px 0 0;color:var(--brand-muted);font-size:var(--fs-ui);letter-spacing:.06em}
.art{display:grid;grid-template-columns:repeat(8,minmax(0,1fr));gap:8px;max-width:300px}
.pad{aspect-ratio:1.6;min-width:0;border-radius:2px;background:var(--paste)}
.pad.r{aspect-ratio:1;border-radius:50%}
.pad:nth-child(7n+3){background:var(--paste-dim)}
.pad.bad{background:var(--paste-bad);box-shadow:0 0 0 3px rgba(184,58,44,.25);animation:pulse 2.4s ease-in-out infinite}
@keyframes pulse{50%{box-shadow:0 0 0 6px rgba(184,58,44,.12)}}
.legend{display:flex;align-items:center;gap:8px;font-size:var(--fs-caption);color:var(--brand-muted)}
.legend i{width:10px;height:10px;border-radius:50%;background:var(--paste-bad);flex:none}
.ver{font-family:var(--f-mono);font-size:var(--fs-caption);color:var(--brand-muted)}
form{padding:40px 36px;display:grid;gap:16px;align-content:center}
form h2{margin:0;font-size:var(--fs-title);font-weight:700}
form .hint{margin:-8px 0 4px;color:var(--muted);font-size:var(--fs-ui)}
label{display:grid;gap:6px;font-size:var(--fs-body);color:var(--muted)}
.field{position:relative;display:flex}
input{width:100%;font:inherit;font-family:inherit;font-size:var(--fs-input);color:var(--ink);background:var(--bg);border:1px solid var(--line);border-radius:8px;padding:10px 12px;min-height:44px}
input[type=password],input.pw{padding-right:72px;font-family:var(--f-mono);letter-spacing:.08em}
input:focus-visible,button:focus-visible{outline:2px solid var(--accent);outline-offset:1px}
.toggle{position:absolute;right:6px;top:50%;transform:translateY(-50%);font:inherit;font-family:inherit;font-size:var(--fs-ui);color:var(--muted);background:none;border:1px solid transparent;border-radius:6px;padding:6px 10px;min-width:44px;min-height:44px;display:inline-flex;align-items:center;justify-content:center;cursor:pointer}
.toggle:hover{border-color:var(--line);color:var(--ink)}
.caps{font-size:var(--fs-caption);color:var(--warn);margin:-2px 0 0}
.err{display:flex;gap:8px;align-items:flex-start;background:var(--ng-soft);color:var(--ng);border-radius:8px;padding:10px 12px;font-size:var(--fs-ui)}
.submit{font:inherit;font-family:inherit;font-size:var(--fs-body);font-weight:700;cursor:pointer;border:none;border-radius:8px;min-height:46px;background:var(--accent);color:var(--on-accent);margin-top:4px}
.submit[disabled]{opacity:.75;cursor:not-allowed}
.foot{font-size:var(--fs-caption);color:var(--muted);margin:0}
@media (max-width:720px){body{place-items:start center;padding:max(12px,env(safe-area-inset-top,0px)) max(12px,env(safe-area-inset-right,0px)) max(12px,env(safe-area-inset-bottom,0px)) max(12px,env(safe-area-inset-left,0px))}.shell{grid-template-columns:1fr}.brand{border-right:none;border-bottom:1px solid var(--line);padding:12px 20px;gap:6px;max-height:160px;overflow:hidden}.brand-head{flex-direction:row;align-items:center;gap:10px;flex-wrap:wrap}.mitcorp-logo{height:20px}.brand h1{font-size:var(--fs-brand-narrow)}.brand .sub{display:none}.art{max-width:116px;gap:3px}.legend{display:none}.ver{font-size:var(--fs-caption)}form{padding:18px 20px;gap:12px}}
@media (prefers-reduced-motion:reduce){.pad.bad{animation:none}}
</style></head><body>
<main class="shell">
  <section class="brand" aria-label="Mitcorp SPI·SPC 分析台">
    <div class="brand-head">
      <svg class="mitcorp-logo" viewBox="0 0 248 45" width="154" height="28" fill="currentColor" fill-rule="evenodd" role="img" aria-label="Mitcorp"><path d="${MITCORP_PATH}"/></svg>
      <div><h1>SPI·SPC 分析台</h1><p class="sub">錫膏印刷檢測 · 統計製程問題偵測</p></div>
    </div>
    <div><div class="art" aria-hidden="true">${padArt()}</div>
      <p class="legend" style="margin:14px 0 0"><i aria-hidden="true"></i>從數千顆焊墊的統計資料中，把異常抓出來</p></div>
    <p class="ver" style="margin:0">${esc(APP_VERSION)} · 更新 ${esc(APP_BUILT)}</p>
  </section>
  <form id="loginForm" data-iter="${iter}" data-next="${esc(nextPath)}" novalidate>
    <div><h2>登入</h2></div>
    <p class="hint">請使用授權帳號登入（有效 12 小時）。</p>
    ${limiterBanner}
    <div class="err" role="alert" id="loginMsg" style="display:none"></div>
    <label for="user">帳號<input id="user" name="user" type="email" inputmode="email" autocomplete="username" required placeholder="name@company.com" aria-describedby="loginMsg"></label>
    <label for="pass">密碼
      <span class="field"><input id="pass" name="pass" type="password" class="pw" autocomplete="current-password" required aria-describedby="loginMsg">
      <button type="button" class="toggle" id="tg" aria-controls="pass" aria-pressed="false" aria-label="切換密碼顯示">顯示</button></span>
    </label>
    <p class="caps" id="caps" hidden>Caps Lock 已開啟</p>
    <button type="submit" class="submit" id="go"${submitAttr}>登入</button>
    <p class="foot">僅限授權人員使用。統計運算於瀏覽器執行；匯入之量測與座標檔、建立之分享連結將加密存於雲端資料庫供團隊回溯。</p>
  </form>
</main>
<script src="/vendor/login-auth.js"></script>
<script>
(function(){
  var p=document.getElementById("pass"),t=document.getElementById("tg"),c=document.getElementById("caps");
  if(t)t.addEventListener("click",function(){var s=p.type==="password";p.type=s?"text":"password";t.textContent=s?"隱藏":"顯示";t.setAttribute("aria-pressed",s);p.focus()});
  function caps(e){if(e.getModifierState)c.hidden=!e.getModifierState("CapsLock")}
  if(p){p.addEventListener("keydown",caps);p.addEventListener("keyup",caps);p.addEventListener("blur",function(){c.hidden=true})};
  var msg=document.getElementById("loginMsg");
  var obs=new MutationObserver(function(){msg.style.display=msg.textContent.trim()?"flex":"none"});
  obs.observe(msg,{childList:true,characterData:true,subtree:true});
})();
</script>
</body></html>`;
  return new Response(html, {
    status: 200,
    headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "X-Robots-Tag": "noindex", ...SEC },
  });
}

/** 核心處理控制器 */
export async function handle(req, env, next, opts = {}) {
  const url = new URL(req.url);
  const noStore = { "Cache-Control": "no-store", "X-Robots-Tag": "noindex", ...SEC };
  const now = opts.now ?? Date.now();
  const repo = opts.repo || (env.DB && env.BLOBS ? new Repo(env.DB, env.BLOBS) : null);

  if (!configured(env)) {
    return new Response("網站登入尚未設定（缺少 AUTH_USERS、AUTH_PEPPER 或 AUTH_SECRET 環境變數），暫停對外服務。", {
      status: 503,
      headers: { ...noStore, "Content-Type": "text/plain; charset=utf-8" },
    });
  }

  if (url.pathname === "/__logout") {
    return new Response(null, {
      status: 303,
      headers: { ...noStore, Location: "/__login", "Set-Cookie": `${COOKIE}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax` },
    });
  }

  // 檢查是否已登入
  const who = await verifyToken(env, readCookie(req.headers.get("cookie")), Math.floor(now / 1000));

  if (url.pathname === "/__login") {
    // 依 D-35: 已登入時 GET /__login 一律 303 導向 next
    if (req.method === "GET") {
      const nextPath = safeNext(url.searchParams.get("next"));
      if (who) {
        return new Response(null, { status: 303, headers: { ...noStore, Location: nextPath } });
      }
      const limiterMissing = !env.LOGIN_LIMIT || typeof env.LOGIN_LIMIT.limit !== "function";
      return loginPage(nextPath, +(env.AUTH_KDF_ITER || 600000), limiterMissing);
    }

    if (req.method === "POST") {
      // 依 D-60 ③: 收到含明文 pass 欄位一律回 400
      let body;
      try {
        body = await req.json();
      } catch {
        return Response.json({ error: "無效的 JSON 請求" }, { status: 400, headers: noStore });
      }

      if (body && body.pass !== undefined) {
        return Response.json({ error: "不接受明文密碼，請使用標準登入頁" }, { status: 400, headers: noStore });
      }

      const user = norm(body?.user);
      const d = String(body?.d || "");
      const nextPath = safeNext(body?.next);

      if (!user || !d) {
        return Response.json({ error: "帳號與驗證資訊不可為空" }, { status: 400, headers: noStore });
      }

      // 9.5 第 0 步: 輸入檢查與限流 (不碰 D1，僅以 IP 鍵呼叫一次)
      if (!env.LOGIN_LIMIT || typeof env.LOGIN_LIMIT.limit !== "function") {
        return Response.json({ error: "login_limiter_missing" }, { status: 503, headers: noStore });
      }
      const clientIp = opts.ip || "";
      const ipKey = clientIp ? "ip:" + clientIp : "ip:unknown";
      try {
        const ipRes = await env.LOGIN_LIMIT.limit({ key: ipKey });
        if (!ipRes.success) {
          return Response.json(
            { error: "rate_limited", message: "系統忙碌，請 1 分鐘後再試" },
            { status: 429, headers: { ...noStore, "Retry-After": "60" } }
          );
        }
      } catch (err) {
        return Response.json({ error: "login_limiter_error" }, { status: 503, headers: noStore });
      }

      // HMAC 雜湊鍵值
      const uHash = await hmacHex(env.AUTH_SECRET, "u:" + user);
      const ipHash = await hmacHex(env.AUTH_SECRET, opts.ip ? "ip:" + opts.ip : "ip:none");

      const isLocked = (rows) => {
        if (rows.length < 5) return false;
        const times = rows.map((r) => r.at);
        const maxAt = Math.max(...times);
        const minAt = Math.min(...times);
        return maxAt - minAt < 900000 && maxAt > now - 900000;
      };

      // 9.5 第 1 步: 讀取 (1 句，讀 <= 10 列)
      let uRows = [];
      let ipRows = [];
      try {
        if (repo) {
          const attempts = await repo.getAuthAttempts(uHash, ipHash, now);
          uRows = attempts.filter((r) => r.k === "u");
          ipRows = attempts.filter((r) => r.k === "ip");
          const uLocked = isLocked(uRows);
          const ipLocked = isLocked(ipRows);

          if (uLocked || ipLocked) {
            const uUnlock = uLocked ? Math.max(...uRows.map((r) => r.at)) + 900000 : 0;
            const ipUnlock = ipLocked ? Math.max(...ipRows.map((r) => r.at)) + 900000 : 0;
            const unlockAt = Math.max(uUnlock, ipUnlock);
            const unlockTime = new Date(unlockAt).toLocaleString("zh-TW", { timeZone: "Asia/Taipei", hour12: false });
            return Response.json(
              {
                error: "locked",
                unlockAt,
                message: `嘗試次數過多，已暫時鎖定。請於 ${unlockTime} (UTC+8) 後再試。`,
              },
              { status: 429, headers: noStore }
            );
          }
        }
      } catch (err) {
        return Response.json({ error: "login_db_unavailable" }, { status: 503, headers: noStore });
      }

      // 9.5 第 2 步: 原子條件式 INSERT (1 句)
      try {
        if (repo) {
          const insertedId = await repo.insertAuthAttemptAtomic(uHash, ipHash, now);
          if (!insertedId) {
            // 競態被其他請求鎖上，重跑第 1 步取最新鎖定時刻
            const attempts = await repo.getAuthAttempts(uHash, ipHash, now);
            uRows = attempts.filter((r) => r.k === "u");
            ipRows = attempts.filter((r) => r.k === "ip");
            const uUnlock = isLocked(uRows) ? Math.max(...uRows.map((r) => r.at)) + 900000 : now + 900000;
            const ipUnlock = isLocked(ipRows) ? Math.max(...ipRows.map((r) => r.at)) + 900000 : now + 900000;
            const unlockAt = Math.max(uUnlock, ipUnlock);
            const unlockTime = new Date(unlockAt).toLocaleString("zh-TW", { timeZone: "Asia/Taipei", hour12: false });
            return Response.json(
              {
                error: "locked",
                unlockAt,
                message: `嘗試次數過多，已暫時鎖定。請於 ${unlockTime} (UTC+8) 後再試。`,
              },
              { status: 429, headers: noStore }
            );
          }
        }
      } catch (err) {
        return Response.json({ error: "login_db_unavailable" }, { status: 503, headers: noStore });
      }

      // 9.5 第 3 步: 驗證密碼 HMAC (常數時間)
      const actualCred = users(env).get(user);
      const iter = String(env.AUTH_KDF_ITER || 600000);
      const computedHmac = await hmacHex(env.AUTH_PEPPER, d);
      const expectedCred = actualCred || `pepper-hmac-sha256$${iter}$${"0".repeat(64)}`;
      const expectedHmac = (expectedCred.split("$")[2] || "").toLowerCase();
      const match = safeEqual(computedHmac, expectedHmac);
      const ok = match && Boolean(actualCred);

      // 9.5 第 4 步: 成功刪除帳號鍵，失敗計算剩餘次數
      if (ok) {
        try {
          if (repo) {
            await repo.clearAuthAttemptsForUser(uHash);
          }
        } catch (err) {
          return Response.json({ error: "login_db_unavailable" }, { status: 503, headers: noStore });
        }
        const token = await issueToken(env, user, Math.floor(now / 1000));
        return Response.json(
          { ok: true, user, next: nextPath },
          {
            status: 200,
            headers: {
              ...noStore,
              "Set-Cookie": `${COOKIE}=${token}; Path=/; Max-Age=${SESSION_SECONDS}; HttpOnly; Secure; SameSite=Lax`,
            },
          }
        );
      }

      // 失敗: 由第 1 步讀到的資料 + 1 算出 remaining
      const uCount = uRows.length + 1;
      const ipCount = ipRows.length + 1;
      const maxCount = Math.max(uCount, ipCount);
      const remaining = Math.max(0, 5 - maxCount);
      const unlockAt = remaining === 0 ? now + 900000 : undefined;
      const leftMsg = ` 此帳號或此網路位置在 15 分鐘內再失敗 ${remaining} 次，將暫停登入 15 分鐘。`;
      const failMsg = `帳號或密碼不正確。${leftMsg}`;

      return Response.json(
        {
          error: "bad_credentials",
          remaining,
          unlockAt,
          message: failMsg,
        },
        { status: 401, headers: noStore }
      );
    }

    return Response.json({ error: "不支援的請求方法" }, { status: 405, headers: noStore });
  }

  // 驗證一般請求
  if (who) {
    if (url.pathname === "/__me") {
      return Response.json({ user: who }, { headers: noStore });
    }
    if (url.pathname.startsWith("/api/")) {
      const h = new Headers(req.headers);
      h.set("x-spi-user", who);
      return next(new Request(req, { headers: h }));
    }
    return next();
  }

  // 未登入請求
  if (url.pathname === "/__me" || url.pathname.startsWith("/api/")) {
    return Response.json({ error: "請先登入" }, { status: 401, headers: noStore });
  }

  // 未登入頁面請求依 D-35: 303 導向 /__login?next=...
  const redirectNext = url.pathname + url.search;
  return new Response(null, {
    status: 303,
    headers: { ...noStore, Location: `/__login?next=${encodeURIComponent(redirectNext)}` },
  });
}

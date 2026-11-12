import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const htmlPath = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "spi-spc.html");
let html = fs.readFileSync(htmlPath, "utf8");

const reps = [
  [
    'deepSub:"cross",improveSub:"compare"',
    'issuesSub:"list",controlSub:"uni",improveSub:"compare"',
  ],
  [
    `const LVL={ng:"嚴重",warn:"警示",info:"資訊"},GOLAB={sim3d:"看該板 3D",control:"看管制圖",adv:"看進階分析",deep:"深入分析",data:"看設定",improve:"改善建議"};`,
    `const LVL={ng:"嚴重",warn:"警示",info:"資訊"},GOLAB={sim3d:"看該板 3D",control:"看管制圖",capability:"看製程能力",cross:"看交叉驗證",adv:"看製程跡象",deep:"看製程跡象",stats:"看製程跡象",data:"看規格",improve:"看比較與行動",compare:"看回合比較",dfm:"看設計改善",lab:"看實驗驗證",multi:"看多變量管制圖"};`,
  ],
  [
    `function goto(g,from){if(!g)return;const GT={cross:"deep/cross",adv:"deep/adv",stats:"deep/stats",compare:"improve/compare",dfm:"improve/dfm",lab:"improve/lab"};`,
    `function goto(g,from){if(!g)return;const GT={cross:"issues/cross",adv:"deep",stats:"deep",capability:"capability",multi:"control/multi",compare:"improve/compare",dfm:"improve/dfm",lab:"improve/lab"};`,
  ],
  [
    `function showCtx(){const c=S.ctx,bar=$("#ctxBar");bar.hidden=!c||S.tab==="issues";`,
    `function showCtx(){const c=S.ctx,bar=$("#ctxBar");bar.hidden=!c||S.tab!=="issues"||S.issuesSub!=="cross";`,
  ],
  [
    `$("#fmGo").onclick=()=>setTab("deep/cross")}`,
    `$("#fmGo").onclick=()=>setTab("issues/cross")}`,
  ],
  [
    `function renderDeepPanel(){if(S.deepSub==="cross")renderCross();else if(S.deepSub==="adv")renderAdv();else renderStats()}`,
    `function renderDeepPanel(){renderAdv();renderStats()}`,
  ],
  [
    `function renderImprovePanel(){if(S.improveSub==="compare")renderCompare();else if(S.improveSub==="dfm")renderDfm();else renderLab()}`,
    `function renderImprovePanel(){if(S.improveSub==="compare")renderCompare();else if(S.improveSub==="dfm")renderDfm();else renderLab()}
function renderIssuesPanel(){if(S.issuesSub==="cross"){renderCross();renderFM()}else renderIssues()}
function renderControlPanel(){if(S.controlSub==="multi")renderHotellingT2UI();else renderControl()}`,
  ],
  [
    `const fn=({issues:renderIssues,overview:renderOverview,control:renderControl,capability:renderCap,sim3d:render3D,deep:renderDeepPanel,improve:renderImprovePanel,ai:()=>{},report:renderReport,data:()=>{renderSpecTbl();renderZones();renderAperture();renderRuns();if(S.sub==="settings"){updateSettingsUi();initAiPage()}}})[k];`,
    `const fn=({issues:renderIssuesPanel,overview:renderOverview,control:renderControlPanel,capability:renderCap,sim3d:render3D,deep:renderDeepPanel,improve:renderImprovePanel,ai:()=>{},report:renderReport,data:()=>{renderSpecTbl();renderZones();renderAperture();renderRuns();if(S.sub==="settings"){renderSpecTbl()}}})[k];`,
  ],
  [
    `const AN_TABS=new Set(["overview","control","capability","sim3d","ai"]),RAIL_NOTE={issues:"問題偵測自動掃描全部量測項目與元件群組，不需要選擇。","deep:stats":"統計異常與不良矩陣涵蓋全部量測。","improve:compare":"此頁使用頁內的 A／B 回合選項。","improve:dfm":"DFM 建議涵蓋全部元件群組。","improve:lab":"此頁使用各區塊內的選項。",report:"分析報告涵蓋整批試產資料，可勾選匯出章節。"};
function isAnalysisScopeTab(){return S.tab==="deep"?(S.deepSub==="cross"||S.deepSub==="adv"):AN_TABS.has(S.tab)}
function applyScope(){const on=isAnalysisScopeTab();$$("[data-scope=a]").forEach(el=>{
  if(el.id==="padField")el.hidden=!on||S.chart!=="imr";
  else if(el.id==="xrSizeField"||el.id==="xrModeField")el.hidden=!on||S.chart!=="xbarr";
  else el.hidden=!on;
});const noteKey=S.tab==="deep"?"deep:"+(S.deepSub||"cross"):S.tab==="improve"?"improve:"+(S.improveSub||"compare"):S.tab;const n=RAIL_NOTE[noteKey];$("#railNote").hidden=!n;$("#railNote").textContent=n||""}`,
    `const AN_TABS=new Set(["overview","control","capability","sim3d","deep","ai"]),RAIL_NOTE={issues:"問題偵測自動掃描全部量測項目與元件群組，不需要選擇。","issues:cross":"交叉驗證涵蓋全部量測項目。","deep":"製程跡象卡片會隨上方量測項目與群組更新。","improve:compare":"此頁使用頁內的 A／B 回合選項。","improve:dfm":"設計改善涵蓋全部元件群組。","improve:lab":"此頁使用各區塊內的選項。",report:"分析報告涵蓋整批試產資料，可勾選匯出章節。"};
function isAnalysisScopeTab(){return AN_TABS.has(S.tab)||(S.tab==="control"&&S.controlSub==="uni")}
function applyScope(){const analOn=isAnalysisScopeTab();const chartOn=S.tab==="control"&&S.controlSub==="uni";
$$("[data-scope=a]").forEach(el=>{el.hidden=!analOn});
$$("[data-scope=c]").forEach(el=>{
  if(el.id==="padField")el.hidden=!chartOn||S.chart!=="imr";
  else if(el.id==="xrSizeField"||el.id==="xrModeField")el.hidden=!chartOn||S.chart!=="xbarr";
  else el.hidden=!chartOn;
});
let noteKey=S.tab;if(S.tab==="issues")noteKey="issues:"+(S.issuesSub||"list");else if(S.tab==="improve")noteKey="improve:"+(S.improveSub||"compare");else if(S.tab==="control")noteKey=S.controlSub==="multi"?"control:multi":S.tab;
const n=RAIL_NOTE[noteKey];$("#railNote").hidden=!n;$("#railNote").textContent=n||""}`,
  ],
  [
    `function parseTabTarget(raw){
  const s=String(raw||"").replace(/^#/,"").trim();
  if(!s)return{tab:"issues"};
  const parts=s.split("/"),root=parts[0],sub=parts[1]||null;
  if(LEGACY_ROOTS.has(root))return{tab:"issues",legacy:true};
  if(root==="deep"){const deepSub=sub&&["cross","adv","stats"].includes(sub)?sub:"cross";return{tab:"deep",deepSub}}
  if(root==="improve"){const improveSub=sub&&["compare","dfm","lab"].includes(sub)?sub:"compare";return{tab:"improve",improveSub}}
  if(!ALL_TABS.includes(root))return{tab:"issues"};
  return{tab:root}
}
function tabHashFor(tab,deepSub,improveSub){
  if(tab==="deep")return"deep/"+(deepSub||"cross");
  if(tab==="improve")return"improve/"+(improveSub||"compare");
  return tab;
}
function duoPanelId(tab){if(tab==="deep"||tab==="improve"||LEGACY_ROOTS.has(tab))return tab==="improve"||["compare","dfm","lab"].includes(tab)?"improve":"deep";return tab}
function applyDeepImproveSubnav(){
  if(S.tab==="deep"){$$("#p-deep [data-subview]").forEach(el=>{el.hidden=el.dataset.subview!==(S.deepSub||"cross")});$$("[data-subnav-deep]").forEach(b=>{const on=b.dataset.subnavDeep===(S.deepSub||"cross");if(on)b.setAttribute("aria-current","page");else b.removeAttribute("aria-current")})}
  if(S.tab==="improve"){$$("#p-improve [data-subview]").forEach(el=>{el.hidden=el.dataset.subview!==(S.improveSub||"compare")});$$("[data-subnav-improve]").forEach(b=>{const on=b.dataset.subnavImprove===(S.improveSub||"compare");if(on)b.setAttribute("aria-current","page");else b.removeAttribute("aria-current")})}
}`,
    `function parseTabTarget(raw){
  const s=String(raw||"").replace(/^#/,"").trim();
  if(!s)return{tab:"issues"};
  const parts=s.split("/"),root=parts[0],sub=parts[1]||null;
  if(root==="issues"){const issuesSub=sub&&["list","cross"].includes(sub)?sub:"list";return{tab:"issues",issuesSub}}
  if(root==="control"){const controlSub=sub&&["uni","multi"].includes(sub)?sub:"uni";return{tab:"control",controlSub}}
  if(root==="deep"){if(sub==="cross")return{tab:"issues",issuesSub:"cross"};return{tab:"deep"}}
  if(root==="improve"){const improveSub=sub&&["compare","dfm","lab"].includes(sub)?sub:"compare";return{tab:"improve",improveSub}}
  if(LEGACY_ROOTS.has(root)){
    if(root==="cross")return{tab:"issues",issuesSub:"cross"};
    if(root==="compare"||root==="dfm"||root==="lab")return{tab:"improve",improveSub:root};
    return{tab:root==="adv"||root==="stats"?"deep":"issues",issuesSub:root==="cross"?"cross":"list"};
  }
  if(!ALL_TABS.includes(root))return{tab:"issues"};
  return{tab:root}
}
function tabHashFor(tab,issuesSub,controlSub,improveSub){
  if(tab==="issues")return issuesSub==="cross"?"issues/cross":"issues";
  if(tab==="control")return controlSub==="multi"?"control/multi":"control";
  if(tab==="improve")return"improve/"+(improveSub||"compare");
  if(tab==="deep")return"deep";
  return tab;
}
function duoPanelId(tab){
  if(tab==="issues"||tab==="issues/cross"||tab==="cross")return"issues";
  if(tab==="improve"||["compare","dfm","lab"].includes(tab))return"improve";
  if(["deep","adv","stats"].includes(tab))return"deep";
  return tab;
}
function applyIssuesControlImproveSubnav(){
  if(S.tab==="issues"){$$("#p-issues [data-issues-sub]").forEach(el=>{el.hidden=el.dataset.issuesSub!==(S.issuesSub||"list")});$$("[data-subnav-issues]").forEach(b=>{const on=b.dataset.subnavIssues===(S.issuesSub||"list");if(on)b.setAttribute("aria-current","page");else b.removeAttribute("aria-current")})}
  if(S.tab==="control"){$$("#p-control [data-control-sub]").forEach(el=>{el.hidden=el.dataset.controlSub!==(S.controlSub||"uni")});$$("[data-subnav-control]").forEach(b=>{const on=b.dataset.subnavControl===(S.controlSub||"uni");if(on)b.setAttribute("aria-current","page");else b.removeAttribute("aria-current")})}
  if(S.tab==="improve"){$$("#p-improve [data-subview]").forEach(el=>{el.hidden=el.dataset.subview!==(S.improveSub||"compare")});$$("[data-subnav-improve]").forEach(b=>{const on=b.dataset.subnavImprove===(S.improveSub||"compare");if(on)b.setAttribute("aria-current","page");else b.removeAttribute("aria-current")})}
}
function applyDeepImproveSubnav(){applyIssuesControlImproveSubnav()}`,
  ],
];

for (const [a, b] of reps) {
  if (!html.includes(a)) throw new Error("Missing patch anchor:\n" + a.slice(0, 120));
  html = html.replace(a, b);
}

// setTab body updates
html = html.replace(
  /if\(parsed\.deepSub\)S\.deepSub=parsed\.deepSub;\s*if\(parsed\.improveSub\)S\.improveSub=parsed\.improveSub;\s*if\(tab==="deep"&&!parsed\.deepSub\)S\.deepSub=S\.deepSub\|\|"cross";\s*if\(tab==="improve"&&!parsed\.improveSub\)S\.improveSub=S\.improveSub\|\|"compare";/,
  `if(parsed.issuesSub)S.issuesSub=parsed.issuesSub;
  if(parsed.controlSub)S.controlSub=parsed.controlSub;
  if(parsed.improveSub)S.improveSub=parsed.improveSub;
  if(tab==="issues"&&!parsed.issuesSub)S.issuesSub=S.issuesSub||"list";
  if(tab==="control"&&!parsed.controlSub)S.controlSub=S.controlSub||"uni";
  if(tab==="improve"&&!parsed.improveSub)S.improveSub=S.improveSub||"compare";`
);

html = html.replace(
  /const changed=S\.tab!==tab\|\|\(tab==="deep"&&parsed\.deepSub\)\|\|\(tab==="improve"&&parsed\.improveSub\);/,
  `const changed=S.tab!==tab||(tab==="issues"&&parsed.issuesSub)||(tab==="control"&&parsed.controlSub)||(tab==="improve"&&parsed.improveSub);`
);

html = html.replace(
  /if\(!fromHistory\)\{const h=tabHashFor\(tab,S\.deepSub,S\.improveSub\);/,
  `if(!fromHistory){const h=tabHashFor(tab,S.issuesSub,S.controlSub,S.improveSub);`
);

html = html.replace(
  `$$("[data-subnav-deep]").forEach(b=>{b.onclick=()=>setTab("deep/"+b.dataset.subnavDeep)});`,
  `$$("[data-subnav-issues]").forEach(b=>{b.onclick=()=>setTab(b.dataset.subnavIssues==="cross"?"issues/cross":"issues")});
$$("[data-subnav-control]").forEach(b=>{b.onclick=()=>setTab(b.dataset.subnavControl==="multi"?"control/multi":"control")});`
);

html = html.replace(
  `go:{tab:"adv",group:g,metric:k}})}`,
  `go:{tab:"capability",group:g,metric:k}})}`
);

html = html.replace(
  `go:{tab:"issues",pad:outItems[0].pad}`,
  `go:{tab:"multi",pad:outItems[0].pad}`
);

// renderAdv: move cpk + t2 out
html = html.replace(
  /  \/\/ 焊墊 Cpk[\s\S]*?onHover:\(e,els,ch\)=>\{ch\.canvas\.style\.cursor=els\.length\?"pointer":"default"\}\}\)\);\n  \/\/ 相關矩陣/,
  `  // 相關矩陣`
);

html = html.replace(/\n  renderHotellingT2UI\(\);\n  renderMorphologyUI\(\);/, `\n  renderMorphologyUI();`);

// renderCap: append pad cpk + sided at end before closing }
html = html.replace(
  /options:baseOpts\(\{plugins:\{legend:\{display:false\},vlines:\{\},tooltip:\{callbacks:\{label:i=>\{const b=B\[i\.dataIndex\];return`中位 \$\{f\(b\.med,1\)\}  Q1 \$\{f\(b\.q1,1\)\}  Q3 \$\{f\(b\.q3,1\)\}  範圍 \$\{f\(b\.min,1\)\}–\$\{f\(b\.max,1\)\}`\}\}\}\}\)\}\);\n\}/,
  `options:baseOpts({plugins:{legend:{display:false},vlines:{},tooltip:{callbacks:{label:i=>{const b=B[i.dataIndex];return\`中位 \${f(b.med,1)}  Q1 \${f(b.q1,1)}  Q3 \${f(b.q3,1)}  範圍 \${f(b.min,1)}–\${f(b.max,1)}\`}}}}})});
  renderPadCpkRank();
  renderSidedPpmBlock();
}`
);

// Extract sided from renderStats to function - add renderSidedPpmBlock and renderPadCpkRank before renderCross
const injectFns = `
function renderPadCpkRank(){
  if(!$("#cPadCpk")||!hasData())return;
  const A=S.A;V=V||advAnalyze(S,A);
  const pc=V.padCpk.slice(0,15);if($("#pcSub"))$("#pcSub").textContent=\`\${METRICS[A.m].short} · \${V.padCpk.length} 個焊墊位置中 \${V.padCpk.filter(p=>p.cpk<1.33).length} 個 < 1.33\`;
  $("#cPadCpk").parentElement.style.height=Math.max(260,pc.length*24+60)+"px";
  const ng=css("--ng"),warn=css("--warn"),ok=css("--ok"),ink=css("--muted");
  mk("cPadCpk",{type:"bar",data:{labels:pc.map(p=>p.pad),datasets:[{data:pc.map(p=>p.cpk),backgroundColor:pc.map(p=>p.cpk<1?ng:p.cpk<1.33?warn:ok)}]},
    options:baseOpts({indexAxis:"y",scales:{x:{ticks:{color:ink,font:{family:"IBM Plex Mono",size:chartCaptionFontPx()}}},y:{ticks:{color:ink,font:{family:"IBM Plex Mono",size:chartCaptionFontPx()},autoSkip:false},grid:{display:false}}},plugins:{legend:{display:false},vlines:{lines:[{v:1,c:ng,t:"1.00"},{v:1.33,c:warn,t:"1.33"}]},tooltip:{callbacks:{label:i=>{const p=pc[i.dataIndex];return\`Cpk \${f(p.cpk)} · 平均 \${f(p.mean,1)} · σ \${f(p.sd,2)} · \${p.group}\`}}},
      onClick:(e,els)=>{if(els[0])goPad(pc[els[0].index].pad)},onHover:(e,els,ch)=>{ch.canvas.style.cursor=els.length?"pointer":"default"}}})});
}
function renderSidedPpmBlock(){
  if(!$("#sidedPpmKpis")||!hasData())return;
  const curSp=specOfGroup(S,isAllGrp(S.group)?null:S.group,S.metric),rows=S.rows.filter(r=>(isAllGrp(S.group)||r.group===S.group));
  const sided=computeSidedPpmBlock(rows,curSp,S.metric,{boards:[...new Set(rows.map(r=>r.board))]});
  const fmtSide=formatSidedPpmBlock(sided,fmtPpm);
  $("#sidedPpmKpis").innerHTML=kpi("低於下限 PPM",fmtSide.belowLslPpm,"")+kpi("高於上限 PPM",fmtSide.aboveUslPpm,"")+kpi("合併事件 DPMO",fmtSide.eventDpmo,"")+kpi("合併板 DPMO",fmtSide.boardDpmo,"");
  if($("#sidedPpmNote"))$("#sidedPpmNote").textContent=fmtSide.note||"";
}
`;

html = html.replace("/* ---------- 交叉驗證 ---------- */", injectFns + "\n/* ---------- 交叉驗證 ---------- */");

html = html.replace(
  /const curSp=specOfGroup\(S,isAllGrp\(S\.group\)\?null:S\.group,S\.metric\),rows=S\.rows\.filter\(r=>\(isAllGrp\(S\.group\)\|\|r\.group===S\.group\)\);\s*const sided=computeSidedPpmBlock\(rows,curSp,S\.metric,\{boards:\[\.\.\.new Set\(rows\.map\(r=>r\.board\)\)\]\}\);\s*const fmtSide=formatSidedPpmBlock\(sided,fmtPpm\);\s*if\(\$\("#sidedPpmKpis"\)\)\$\("#sidedPpmKpis"\)\.innerHTML=kpi\("低於下限 PPM",fmtSide\.belowLslPpm,""\)\+kpi\("高於上限 PPM",fmtSide\.aboveUslPpm,""\)\+kpi\("合併事件 DPMO",fmtSide\.eventDpmo,""\)\+kpi\("合併板 DPMO",fmtSide\.boardDpmo,""\);\s*if\(\$\("#sidedPpmNote"\)\)\$\("#sidedPpmNote"\)\.textContent=fmtSide\.note\|\|"";\s*\}/,
  `}`
);

// settings modal
const settingsModalJs = `
function openAppSettings(section){
  const m=$("#appSettingsModal");if(!m)return;
  m.hidden=false;document.body.classList.add("modal-open");
  updateSettingsUi();initAiPage();
  const id=section==="ai"?"aiSettingsCard":"settingsAnchorUi";
  const el=$("#"+id);if(el)nextFrame(()=>el.scrollIntoView({block:"start"}));
}
function closeAppSettings(){const m=$("#appSettingsModal");if(!m)return;m.hidden=true;document.body.classList.remove("modal-open")}
if($("#appSettingsClose"))$("#appSettingsClose").onclick=closeAppSettings;
if($("#appSettingsDone"))$("#appSettingsDone").onclick=closeAppSettings;
if($("#btnOpenUiSettings"))$("#btnOpenUiSettings").onclick=()=>{closeMore();openAppSettings("ui")};
if($("#btnOpenAiSettings"))$("#btnOpenAiSettings").onclick=()=>{closeMore();openAppSettings("ai")};
if($("#mBtnUiSettings"))$("#mBtnUiSettings").onclick=()=>{if(moreSheetCtrl)moreSheetCtrl.close();openAppSettings("ui")};
if($("#mBtnAiSettings"))$("#mBtnAiSettings").onclick=()=>{if(moreSheetCtrl)moreSheetCtrl.close();openAppSettings("ai")};
`;

html = html.replace(
  `if ($("#btnGoAiCfg")) {
  $("#btnGoAiCfg").onclick = () => {
    setTab("data");
    setSub("settings","ai");
    initAiPage();
  };
}`,
  `if ($("#btnGoAiCfg")) {
  $("#btnGoAiCfg").onclick = () => openAppSettings("ai");
}
${settingsModalJs}`
);

html = html.replace(
  `if($("#mBtnTheme"))$("#mBtnTheme").onclick=()=>{if(typeof moreSheetCtrl!=="undefined"&&moreSheetCtrl)moreSheetCtrl.close();setTab("data");setSub("settings","ui");const el=$("#btnThemeSettings");if(el)el.focus({preventScroll:true})};`,
  ""
);

html = html.replace(
  `function cycleDuoRightTab(){const cycle=["sim3d","deep/cross","control","capability","deep/adv"];`,
  `function cycleDuoRightTab(){const cycle=["sim3d","issues/cross","control","capability","deep"];`
);

html = html.replace(
  `const rLabels={sim3d:"3D",control:"管制圖",capability:"能力",cross:"交叉佐證",adv:"進階"};`,
  `const rLabels={sim3d:"3D",control:"管制圖",capability:"能力",issues:"問題","issues/cross":"交叉驗證",deep:"製程跡象","control/multi":"多變量"};`
);

html = html.replace(
  `if(sub==="settings"&&scrollA)nextFrame(()=>scrollSettingsAnchor(scrollA));`,
  `if(sub==="settings"&&scrollA==="ai")openAppSettings("ai");
  else if(sub==="settings"&&scrollA==="ui")openAppSettings("ui");
  else if(sub==="settings"&&scrollA)nextFrame(()=>scrollSettingsAnchor(scrollA));`
);

fs.writeFileSync(htmlPath, html);
console.log("Patched JS in", htmlPath);

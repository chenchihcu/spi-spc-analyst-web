/** Windows 桌面對照行為 — 純函式（FR-1～FR-11）。瀏覽器端由 spi-spc.html 內嵌同內容。 */

export const EVIDENCE_KINDS = Object.freeze([
  "統計計算",
  "圖表證據",
  "規則推論",
  "未納入",
]);

export const PENDING_VERIFY_LABEL = "待查";

/** FR-1：熱圖／LISA 缺有效座標時的圖卡文字 */
export function spatialChartUnavailableText() {
  return { short: "不適用（缺座標）", long: "不適用（缺座標）— 無法做空間分析" };
}

export function hasValidSpatialXY(rows, isRealXY) {
  if (!rows || !rows.length || typeof isRealXY !== "function") return false;
  return rows.some((r) => isRealXY(r));
}

/** FR-2：問題卡事實區塊的證據種類（僅統計計算或圖表證據） */
export function issueFactsEvidenceKind(issue) {
  if (issue && issue.ev && Array.isArray(issue.ev.values) && issue.ev.values.some(Number.isFinite)) {
    return "圖表證據";
  }
  return "統計計算";
}

/** FR-2：推論區塊固定為規則推論 */
export function issueInferenceEvidenceKind() {
  return "規則推論";
}

/** FR-2：交叉驗證列或 FM 證據列 */
export function crossEvidenceKind(row) {
  if (!row) return "未納入";
  const st = row.st;
  const src = String(row.src || row.d || "");
  const ev = String(row.ev || row.txt || "");
  if (st === "na" || /不適用|未納入|無法計算|無座標|資料不足/.test(ev)) return "未納入";
  if (/熱圖|LISA|散佈|圖表|Moran|空間聚類/.test(src + ev)) return "圖表證據";
  if (/知識庫|規則 R\d+|SPI 製程/.test(src + ev)) return "規則推論";
  return "統計計算";
}

export function evidenceKindBadge(kind) {
  const k = EVIDENCE_KINDS.includes(kind) ? kind : "未納入";
  return k;
}

/** FR-3：報告「資料範圍揭露」空間段落 */
export function reportSpatialExclusionLines(hasXY) {
  if (hasXY) return [];
  return [
    "空間熱圖：未納入 — 本回合無有效焊墊 X/Y 座標",
    "LISA 空間自相關：未納入 — 本回合無有效焊墊 X/Y 座標",
  ];
}

/** FR-4：散佈圖分析筆數 vs 顯示筆數 */
export function scatterDisplayDisclosure(analysisCount, displayCount) {
  const a = Math.max(0, analysisCount | 0);
  const d = Math.max(0, displayCount | 0);
  if (d >= a) return null;
  return {
    analysisCount: a,
    displayCount: d,
    text: `分析筆數 ${a.toLocaleString()} · 圖上顯示 ${d.toLocaleString()}（已抽樣）`,
    reportText: `交叉驗證高度×面積散佈：分析筆數 ${a.toLocaleString()}，圖上顯示 ${d.toLocaleString()}（已抽樣）`,
  };
}

/** FR-5：總覽 CPK KPI 快照（僅切頁時沿用） */
export function overviewCpkSnapshotKey(st) {
  if (!st) return "";
  return JSON.stringify([
    st.metric,
    st.group,
    st.specs,
    st.specSrc,
    st.specsG,
    st.stencil,
    st.htol,
    st.step,
    st.rows && st.rows.length,
    st.pendingVerify,
  ]);
}

export function formatOverviewCpkKpi(cap, pendingVerify) {
  if (pendingVerify) {
    return { value: PENDING_VERIFY_LABEL, sub: "開孔覆蓋率未滿，能力指標待現場查核", cls: "warn" };
  }
  if (!cap || !Number.isFinite(cap.cpk)) {
    return { value: "—", sub: cap && cap.reason ? cap.reason : "未設定規格", cls: "" };
  }
  return { value: cap.cpk, sub: "", cls: "" };
}

/** FR-6：知識庫 JSON 載入 */
export function validateKbRulesPayload(payload, expectedFingerprint) {
  if (!payload || typeof payload !== "object") {
    return { ok: false, error: "規則檔格式不正確" };
  }
  if (expectedFingerprint && payload.fingerprint && payload.fingerprint !== expectedFingerprint) {
    return { ok: false, error: "規則檔指紋不符，無法載入" };
  }
  if (!Array.isArray(payload.rules) || !payload.rules.length) {
    return { ok: false, error: "規則檔沒有規則清單" };
  }
  const version = String(payload.version || "").trim();
  if (!version) return { ok: false, error: "規則檔缺少版本" };
  return { ok: true, version, rules: payload.rules, fingerprint: payload.fingerprint || null };
}

/** FR-7：問題卡／總覽優先問題的量測項目標籤 */
export function issueMetricLabel(issue, metricsMap) {
  const m = issue && issue.metric;
  if (!m) return "—";
  const meta = metricsMap && metricsMap[m];
  return meta && meta.short ? meta.short : m;
}

export function issueCollapsedSummary(issue, metricsMap) {
  const metric = issueMetricLabel(issue, metricsMap);
  const fact = String((issue && issue.facts && issue.facts[0]) || "").split(/[，,；;]/)[0];
  const clip = fact.length > 36 ? fact.slice(0, 36) + "…" : fact;
  return `${metric} · ${clip}`;
}

/** FR-8：關係圖軸與既有圖重複檢查 */
export const REL_CHART_TYPES = Object.freeze([
  "specScatter",
  "quad",
  "corr",
  "parallel",
  "radar",
]);

const RESERVED_AXIS_KEYS = new Set([
  "height,area",
  "area,height",
  "ar,te",
  "area_ratio,transfer",
  "corr_matrix",
]);

export function relChartAxisKey(kind, opts = {}) {
  if (kind === "specScatter") return `${opts.x || "volume"},${opts.y || "height"}`;
  if (kind === "quad") return "ar,te";
  if (kind === "corr") return "corr_matrix";
  if (kind === "parallel") return (opts.dims || []).join(",");
  if (kind === "radar") return (opts.dims || []).join(",");
  return kind;
}

export function relChartDuplicateReason(kind, opts = {}) {
  const key = relChartAxisKey(kind, opts);
  if (kind === "specScatter" && (key === "area,height" || key === "height,area")) {
    return "與交叉驗證「高度 × 面積」散佈軸相同，不另繪製";
  }
  if (kind === "quad") return "與進階分析「面積比 × 轉移效率」軸相同，不另繪製";
  if (kind === "corr") return "與進階分析「量測項目相關矩陣」相同，不另繪製";
  if (RESERVED_AXIS_KEYS.has(key)) return "與既有圖軸相同，不另繪製";
  return null;
}

export function relChartCollinearityReject(dims, conditionNumber, threshold = 1e12) {
  if (!(conditionNumber > threshold)) return null;
  return `選定特徵共線（條件數 ${conditionNumber.toExponential(1)}），Hotelling 會拒絕計算，無法繪製可判讀的${dims.length > 2 ? " Radar" : "相關"}圖`;
}

/** FR-9：幾何焊墊清單覆蓋率（分母始終為幾何相異焊墊） */
export function normPadKeyForCoverage(pad) {
  return String(pad || "").trim().toUpperCase();
}

export function computePadCoverage(geometryPadKeys, measuredPadKeys) {
  const denom = new Set((geometryPadKeys || []).map(normPadKeyForCoverage).filter(Boolean));
  const meas = new Set((measuredPadKeys || []).map(normPadKeyForCoverage).filter(Boolean));
  if (!denom.size) {
    return { rate: null, pendingVerify: false, uncovered: [], reason: "尚未匯入幾何焊墊清單" };
  }
  const uncovered = [];
  for (const p of denom) if (!meas.has(p)) uncovered.push(p);
  uncovered.sort();
  const hit = denom.size - uncovered.length;
  const rate = hit / denom.size;
  return {
    rate,
    pendingVerify: rate < 1,
    uncovered,
    covered: hit,
    total: denom.size,
    reason: rate >= 1 ? null : `幾何焊墊 ${denom.size} 個，量測涵蓋 ${hit} 個（${(rate * 100).toFixed(1)}%）`,
  };
}

export function parseGeometryPadListCsv(text) {
  const lines = String(text || "")
    .replace(/^\uFEFF/, "")
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  if (!lines.length) return { ok: false, error: "空檔", pads: [] };
  const head = lines[0].split(/[,;\t]/).map((h) => h.trim().toLowerCase());
  let padCol = head.findIndex((h) => /^(pad|padid|焊墊|pin|pinnumber)$/.test(h));
  if (padCol < 0) padCol = 0;
  const pads = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(/[,;\t]/);
    const p = cols[padCol];
    if (p) pads.push(String(p).trim());
  }
  if (!pads.length) return { ok: false, error: "找不到焊墊欄位或沒有資料列", pads: [] };
  return { ok: true, pads: [...new Set(pads.map(normPadKeyForCoverage))] };
}

export function gateKpiPendingVerify(pendingVerify, numericValue, formatter) {
  if (pendingVerify) return PENDING_VERIFY_LABEL;
  if (numericValue == null || !Number.isFinite(numericValue)) return "—";
  return typeof formatter === "function" ? formatter(numericValue) : String(numericValue);
}

/** FR-10：立榮／振順豐子板柏拉圖分組 */
export function paretoGroupKey(refdes, vendor) {
  const raw = String(refdes || "未知").trim();
  if (vendor === "lirong" || vendor === "zsf") {
    const m = raw.match(/^(.+?)([_-])(\d+)$/);
    if (m) return { key: `${m[1]}${m[2]}${m[3]}`, suffix: m[3], subpanel: m[3] };
  }
  return { key: raw, suffix: null, subpanel: null };
}

export function aggregateParetoByVendor(defRows, vendor, countFn) {
  const counts = {};
  const count = typeof countFn === "function" ? countFn : (r) => (r.codes ? r.codes.length : 1);
  for (const r of defRows || []) {
    const ref = r.comp || r.refdes || "未知";
    const { key } = paretoGroupKey(ref, vendor);
    counts[key] = (counts[key] || 0) + count(r);
  }
  return Object.entries(counts).sort((a, b) => b[1] - a[1]);
}

/** FR-11：雙邊規格分側 PPM / DPMO */
export function isTwoSidedSpec(spec) {
  if (!spec) return false;
  return Number.isFinite(spec.lsl) && Number.isFinite(spec.usl) && spec.usl > spec.lsl;
}

export function computeSidedPpmBlock(rows, spec, metric, { boards = null } = {}) {
  if (!isTwoSidedSpec(spec)) {
    return {
      ok: false,
      reason: "單邊或未設定雙邊規格，分側 PPM 不可算",
      belowLslPpm: null,
      aboveUslPpm: null,
      eventDpmo: null,
      boardDpmo: null,
    };
  }
  const vals = (rows || []).filter((r) => r[metric] != null && Number.isFinite(r[metric]));
  if (!vals.length) {
    return {
      ok: false,
      reason: "有效樣本為 0，不可算",
      belowLslPpm: null,
      aboveUslPpm: null,
      eventDpmo: null,
      boardDpmo: null,
    };
  }
  const n = vals.length;
  let below = 0;
  let above = 0;
  for (const r of vals) {
    const x = r[metric];
    if (x < spec.lsl) below++;
    if (x > spec.usl) above++;
  }
  const belowLslPpm = (below / n) * 1e6;
  const aboveUslPpm = (above / n) * 1e6;
  const events = below + above;
  const eventDpmo = (events / n) * 1e6;
  let boardDpmo = null;
  if (boards && boards.length) {
    let badBoards = 0;
    for (const b of boards) {
      const br = vals.filter((r) => r.board === b);
      if (!br.length) continue;
      if (br.some((r) => r[metric] < spec.lsl || r[metric] > spec.usl)) badBoards++;
    }
    boardDpmo = (badBoards / boards.length) * 1e6;
  }
  return {
    ok: true,
    reason: null,
    belowLslPpm,
    aboveUslPpm,
    eventDpmo,
    boardDpmo,
    n,
  };
}

export function formatSidedPpmBlock(block, fmt = (v) => String(Math.round(v))) {
  if (!block || !block.ok) {
    return {
      belowLslPpm: "不可算",
      aboveUslPpm: "不可算",
      eventDpmo: "不可算",
      boardDpmo: "不可算",
      note: block && block.reason ? block.reason : "不可算",
    };
  }
  return {
    belowLslPpm: fmt(block.belowLslPpm),
    aboveUslPpm: fmt(block.aboveUslPpm),
    eventDpmo: fmt(block.eventDpmo),
    boardDpmo: block.boardDpmo != null ? fmt(block.boardDpmo) : "—",
    note: "",
  };
}

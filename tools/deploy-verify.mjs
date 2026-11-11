// 正式站驗收的判定。未送登入的 401、以及 Actions dry-run，都不能寫成已驗證或未驗證的結論。

export function classifyRecordsProbe({ attemptedLogin, loginStatus, recordsStatus, recordsIsArray }) {
  if (!attemptedLogin) {
    return {
      state: "not_done",
      detail: "未送出 POST /__login。未帶 cookie 的 GET /api/records 401 不是資料庫路徑結果。",
    };
  }
  if (loginStatus !== 200) {
    return { state: "unverified", detail: `POST /__login HTTP ${loginStatus}` };
  }
  if (recordsStatus === 200 && recordsIsArray) {
    return { state: "verified", detail: "GET /api/records HTTP 200，records 為陣列" };
  }
  return { state: "unverified", detail: `GET /api/records HTTP ${recordsStatus ?? "未送出"}` };
}

export function classifyWorkersSync({ dryRunOnly, buildStatus, buildOutcome }) {
  const pending = buildStatus === "queued" || buildStatus === "initializing" || buildStatus === "running";
  if (pending) return { state: "in_progress", detail: `Workers Build ${buildStatus}` };
  if (buildOutcome === "success") return { state: "deployed", detail: "Workers Build success" };
  if (buildOutcome === "fail" || buildOutcome === "terminated") {
    return { state: "failed", detail: `Workers Build ${buildOutcome}` };
  }
  if (dryRunOnly) {
    return {
      state: "not_deployed",
      detail: "GitHub Actions 的 wrangler deploy --dry-run 不是正式部署。讀同一 commit 的 Workers Build。",
    };
  }
  return { state: "not_deployed", detail: "沒有這個 commit 的 Workers Build 結果" };
}

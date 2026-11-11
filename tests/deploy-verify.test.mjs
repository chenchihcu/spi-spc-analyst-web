import test from "node:test";
import assert from "node:assert/strict";
import { classifyRecordsProbe, classifyWorkersSync } from "../tools/deploy-verify.mjs";

test("2026-11-11 未登入的 /api/records 401 不是資料庫路徑未驗證", () => {
  const r = classifyRecordsProbe({ attemptedLogin: false, recordsStatus: 401, recordsIsArray: false });
  assert.equal(r.state, "not_done");
  assert.notEqual(r.state, "unverified");
  assert.notEqual(r.state, "verified");
});

test("登入成功且 records 為陣列才算走過資料庫路徑", () => {
  assert.equal(classifyRecordsProbe({
    attemptedLogin: true, loginStatus: 200, recordsStatus: 200, recordsIsArray: true,
  }).state, "verified");
  assert.equal(classifyRecordsProbe({
    attemptedLogin: true, loginStatus: 401, recordsStatus: null, recordsIsArray: false,
  }).state, "unverified");
});

test("2026-11-11 Actions dry-run 且 Workers Build 尚未結束不是正式部署", () => {
  const r = classifyWorkersSync({ dryRunOnly: true, buildStatus: "running", buildOutcome: null });
  assert.equal(r.state, "in_progress");
  assert.notEqual(r.state, "deployed");
  const dry = classifyWorkersSync({ dryRunOnly: true, buildStatus: null, buildOutcome: null });
  assert.equal(dry.state, "not_deployed");
});

test("Workers Build success 才是已部署", () => {
  assert.equal(classifyWorkersSync({
    dryRunOnly: true, buildStatus: "stopped", buildOutcome: "success",
  }).state, "deployed");
});

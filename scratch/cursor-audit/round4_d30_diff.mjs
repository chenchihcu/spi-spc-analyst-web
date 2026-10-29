#!/usr/bin/env node
/** Compare user export D-30 hpct pad list vs db17c7ba replay @120µm */
import fs from "node:fs";
import { createRequire } from "node:module";
import { fullPipeline, PATHS } from "./html-core.mjs";

const require = createRequire(import.meta.url);
const { loadCore } = require("../../tests/_load.js");
const core = loadCore();
const HTML = "/tmp/spi-db17c7ba.html";

function csvRows(path) {
  const tab = core.csvTable(fs.readFileSync(path, "utf8"));
  return tab.data.map((cells) => Object.fromEntries(tab.head.map((h, i) => [h, cells[i] ?? ""])));
}

const user = csvRows(PATHS.userExport);
const userD30 = user.find((r) => r.rule_id === "孤立極端焊墊（D-30）" && r.metric === "高度%厚");
const userPads = new Set(
  (userD30?.pads || "")
    .split(";")
    .map((s) => s.trim().split("(")[0].trim())
    .filter(Boolean),
);

const { F, st } = fullPipeline({ htmlPath: HTML, stencilUm: 120 });
const genD30 = F.find((x) => x.rule_id === "孤立極端焊墊（D-30）" && x.metric === "高度%厚");
const genPads = new Set(
  (genD30?.pads || "")
    .split(";")
    .map((s) => s.trim().split("(")[0].trim())
    .filter(Boolean),
);

// isoScan final rows for hpct — approximate via card sig if present
const onlyUser = [...userPads].filter((p) => !genPads.has(p));
const onlyGen = [...genPads].filter((p) => !userPads.has(p));

const out = {
  userTitle: userD30?.title,
  genTitle: genD30?.title,
  userPadTokens: userPads.size,
  genPadTokens: genPads.size,
  onlyInUserExport: onlyUser.slice(0, 20),
  onlyInReplay: onlyGen.slice(0, 20),
  note: "Export pads field may truncate with '等 N 處'; counts from title are authoritative for user (70) vs replay (69)",
};

fs.writeFileSync("/workspace/artifacts/round4-d30-diff.json", JSON.stringify(out, null, 2));
console.log(JSON.stringify(out, null, 2));

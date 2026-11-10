import fs from "node:fs";
const h = fs.readFileSync("spi-spc.html", "utf8");
const scripts = [...h.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
const s = scripts.find((x) => !x.includes("独立 script"));
try {
  new Function(s);
  console.log("OK");
} catch (e) {
  console.error(e.message);
  const m = /Unexpected token|'[^']+'/.exec(e.message);
  console.error(m);
  // brute: find line
  const lines = s.split("\n");
  for (let i = 0; i < lines.length; i++) {
  try {
    new Function(lines.slice(0, i + 1).join("\n"));
  } catch (err) {
    if (String(err.message).includes("Unexpected end")) continue;
    console.error("First error near line", i + 1, lines[i].slice(0, 120));
    console.error(err.message);
    break;
  }
  }
}

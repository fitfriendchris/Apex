// Extracts every inline <script> (without a src) from index.html and runs each
// through `node --check` to catch syntax errors before they ship.
// Usage: node scripts/check-html-js.mjs
import { readFileSync, writeFileSync, mkdtempSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";

const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
const re = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi;
const dir = mkdtempSync(join(tmpdir(), "apex-jscheck-"));
let idx = 0, failures = 0, checked = 0;

for (const m of html.matchAll(re)) {
  const attrs = m[1] || "";
  const code = m[2] || "";
  // Skip external scripts and non-JS blocks (e.g. application/ld+json).
  if (/\bsrc=/.test(attrs)) continue;
  if (/\btype=/.test(attrs) && !/\btype=["']?(text\/javascript|module|application\/javascript)["']?/i.test(attrs)) continue;
  if (!code.trim()) continue;

  const file = join(dir, `block-${idx++}.js`);
  writeFileSync(file, code);
  checked++;
  try {
    execFileSync(process.execPath, ["--check", file], { stdio: "pipe" });
  } catch (err) {
    failures++;
    console.error(`\n❌ Syntax error in inline <script> block #${idx}:\n${err.stderr?.toString() || err.message}`);
  }
}

if (failures) {
  console.error(`\n${failures} inline script block(s) failed syntax check.`);
  process.exit(1);
}
console.log(`✅ ${checked} inline script block(s) passed syntax check.`);

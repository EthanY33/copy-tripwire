#!/usr/bin/env node
// copy-tripwire: pre-commit check against currently-staged copy files
// (.md, .html, .txt) under brand/goneidle-landing/. Same shape as
// trailer-tripwire and screenshot-tripwire. Exits 0 if no CRITICAL
// findings, 2 if any.

import { execSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { auditFile } from "./audit.mjs";

const STAGED_GLOB_PREFIX = "brand/goneidle-landing/";
const COPY_EXTS = [".md", ".html", ".htm", ".txt"];
const PATCH_HISTORY_PATH = "brand/goneidle-landing/version.json";

function getStagedCopy() {
  const out = execSync("git diff --cached --name-only --diff-filter=ACMR", { encoding: "utf8" });
  return out.split("\n")
    .map(s => s.trim())
    .filter(Boolean)
    .filter(p => p.startsWith(STAGED_GLOB_PREFIX))
    .filter(p => COPY_EXTS.includes(path.extname(p).toLowerCase()));
}

async function loadOptionalPatchHistory() {
  if (!existsSync(PATCH_HISTORY_PATH)) return null;
  // Defer to lib/audit.mjs's parser. Re-importing avoids duplicating the
  // shape-tolerance logic.
  const { auditFile: _unused } = await import("./audit.mjs");
  // Re-implement just the loader so we don't expose internals.
  const { readFile } = await import("node:fs/promises");
  let body, json;
  try { body = await readFile(PATCH_HISTORY_PATH, "utf8"); json = JSON.parse(body); }
  catch { return null; }
  const arr = json.patchHistory || json.versions || (Array.isArray(json) ? json : []);
  const set = new Set();
  for (const e of arr) {
    if (typeof e === "string") set.add(e);
    else if (e && typeof e.version === "string") set.add(e.version);
  }
  if (typeof json.version === "string") set.add(json.version);
  return set.size === 0 ? null : set;
}

async function main() {
  const files = getStagedCopy();
  if (files.length === 0) {
    console.log("copy-tripwire: no staged .md/.html/.txt under brand/goneidle-landing/ — skipping");
    process.exit(0);
  }
  console.log(`copy-tripwire: auditing ${files.length} staged file(s)`);

  const patchHistory = await loadOptionalPatchHistory();
  const opts = patchHistory ? { patchHistory } : {};

  let totalCritical = 0;
  for (const f of files) {
    try {
      const r = await auditFile(f, opts);
      const head = `${f}${r.wordCount !== undefined ? ` [${r.wordCount} words]` : ""}`;
      console.log(head);
      if (r.findings.length === 0) { console.log("  ok"); continue; }
      for (const finding of r.findings) {
        console.log(`  ${finding.level.padEnd(8)} ${finding.code.padEnd(20)} ${finding.msg}`);
        if (finding.level === "CRITICAL") totalCritical++;
      }
    } catch (e) {
      console.log(`${f}\n  CRITICAL AUDIT_FAIL ${e.message}`);
      totalCritical++;
    }
  }

  console.log(`\ncopy-tripwire: ${totalCritical} CRITICAL finding(s)`);
  if (totalCritical > 0) {
    console.log("\nFix CRITICALs or commit with --no-verify (and document why in the message).");
  }
  process.exit(totalCritical > 0 ? 2 : 0);
}

main().catch(e => { console.error(e); process.exit(1); });

#!/usr/bin/env node
// copy-tripwire: pre-commit check against currently-staged copy files
// (.md, .html, .txt) under brand/goneidle-landing/. Same shape as
// trailer-tripwire and screenshot-tripwire. Exits 0 if no CRITICAL
// findings, 2 if any.

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { auditText, parsePatchHistoryText } from "./audit.mjs";

const STAGED_GLOB_PREFIX = "brand/goneidle-landing/";
const COPY_EXTS = [".md", ".html", ".htm", ".txt"];
const PATCH_HISTORY_PATH = "brand/goneidle-landing/version.json";
const MAX_BUFFER = 64 * 1024 * 1024;

// Run git without a shell, cwd = repo root. Returns the spawnSync result.
function git(root, args) {
  return spawnSync("git", args, { cwd: root, maxBuffer: MAX_BUFFER });
}

function gitFailure(r) {
  if (r.error) return r.error.message;
  if (r.signal) return `git killed by signal ${r.signal}`;
  const err = r.stderr ? r.stderr.toString("utf8").trim() : "";
  return err || `git exited ${r.status}`;
}

function getRepoRoot() {
  const r = spawnSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" });
  if (r.error || r.status !== 0) return null;
  return r.stdout.trim() || null;
}

function getStagedCopy(root) {
  const r = git(root, ["diff", "--cached", "--name-only", "-z", "--diff-filter=ACMR", "--", STAGED_GLOB_PREFIX]);
  if (r.error || r.status !== 0) throw new Error(`git diff --cached failed: ${gitFailure(r)}`);
  return r.stdout.toString("utf8").split("\0")
    .filter(Boolean)
    .filter(p => p.startsWith(STAGED_GLOB_PREFIX))
    .filter(p => COPY_EXTS.includes(path.extname(p).toLowerCase()));
}

// Staged blob as a Buffer. Smudge filters applied first (so LFS content is
// real content); falls back to the raw blob.
function readStagedBlob(root, p) {
  let r = git(root, ["cat-file", "--filters", ":" + p]);
  if (r.error || r.status !== 0) r = git(root, ["cat-file", "blob", ":" + p]);
  if (r.error || r.status !== 0) throw new Error(`could not read staged blob ${p}: ${gitFailure(r)}`);
  return r.stdout;
}

const UTF8_STRICT = new TextDecoder("utf-8", { fatal: true });

// Strict decode: fail instead of silently mangling UTF-16 or binary content.
// The NUL check is needed because BOM-less UTF-16 of ASCII text is valid UTF-8.
function decodeText(buf, p) {
  if (buf.includes(0)) throw new Error(`${p} is not UTF-8 text (NUL byte found; UTF-16 or binary?)`);
  try { return UTF8_STRICT.decode(buf); }
  catch { throw new Error(`${p} is not valid UTF-8 text`); }
}

// Returns { set } | { skip: true } | { error }. Prefers the staged version.json,
// falls back to the working tree when it is not in the index.
function loadOptionalPatchHistory(root) {
  let body;
  try {
    const ls = git(root, ["ls-files", "--cached", "-z", "--", PATCH_HISTORY_PATH]);
    if (ls.error || ls.status !== 0) throw new Error(gitFailure(ls));
    if (ls.stdout.toString("utf8").split("\0").includes(PATCH_HISTORY_PATH)) {
      body = decodeText(readStagedBlob(root, PATCH_HISTORY_PATH), PATCH_HISTORY_PATH);
    } else {
      const wt = path.join(root, PATCH_HISTORY_PATH);
      if (!existsSync(wt)) return { skip: true };
      body = readFileSync(wt, "utf8");
    }
    const set = parsePatchHistoryText(body, PATCH_HISTORY_PATH);
    return { set };
  } catch (e) {
    return { error: e.message };
  }
}

async function main() {
  const root = getRepoRoot();
  if (!root) {
    console.error("copy-tripwire: not inside a git repository");
    process.exit(1);
  }
  const files = getStagedCopy(root);
  if (files.length === 0) {
    console.log("copy-tripwire: no staged .md/.html/.txt under brand/goneidle-landing/ - skipping");
    process.exit(0);
  }
  console.log(`copy-tripwire: auditing ${files.length} staged file(s)`);

  const ph = loadOptionalPatchHistory(root);
  const opts = ph.set ? { patchHistory: ph.set } : {};

  let totalCritical = 0;
  if (ph.error) {
    console.log(`${PATCH_HISTORY_PATH}
  CRITICAL AUDIT_FAIL cannot load version history: ${ph.error}`);
    totalCritical++;
  }
  for (const f of files) {
    try {
      const r = auditText(f, decodeText(readStagedBlob(root, f), f), opts);
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

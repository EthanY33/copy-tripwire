// Tests for `copy-tripwire check` in throwaway git repos. Each test stages
// files in a fresh repo and runs bin/cli.mjs check against it.

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const CLI = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "bin", "cli.mjs");
const DIR = "brand/goneidle-landing";
const BAD = "Let us delve into the tapestry.\n";
const CLEAN = "Clean copy here.\n";

const repos = [];
function makeRepo() {
  const root = mkdtempSync(path.join(tmpdir(), "ct-check-"));
  repos.push(root);
  const r = spawnSync("git", ["init", "-q"], { cwd: root });
  assert.equal(r.status, 0);
  git(root, "config", "core.autocrlf", "false");
  mkdirSync(path.join(root, DIR), { recursive: true });
  return root;
}
function git(root, ...args) {
  const r = spawnSync("git", args, { cwd: root, encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
  return r.stdout;
}
function write(root, rel, text) {
  const fp = path.join(root, rel);
  mkdirSync(path.dirname(fp), { recursive: true });
  writeFileSync(fp, text);
}
function check(root, cwd = root) {
  const r = spawnSync(process.execPath, [CLI, "check"], { cwd, encoding: "utf8" });
  return { code: r.status, out: r.stdout + r.stderr };
}
test.after(() => { for (const r of repos) rmSync(r, { recursive: true, force: true }); });

test("check audits the staged blob, not a fixed working copy (copy-tripwire-01)", () => {
  const root = makeRepo();
  const rel = `${DIR}/post.md`;
  write(root, rel, BAD);
  git(root, "add", rel);
  write(root, rel, CLEAN);
  const r = check(root);
  assert.equal(r.code, 2, r.out);
  assert.match(r.out, /BANNED_PHRASE/);
});

test("check ignores a dirty working copy when the staged blob is clean (copy-tripwire-01)", () => {
  const root = makeRepo();
  const rel = `${DIR}/post.md`;
  write(root, rel, CLEAN);
  git(root, "add", rel);
  write(root, rel, BAD);
  const r = check(root);
  assert.equal(r.code, 0, r.out);
});

test("check does not fail on a staged file deleted from the working tree (copy-tripwire-01)", () => {
  const root = makeRepo();
  const rel = `${DIR}/post.md`;
  write(root, rel, CLEAN);
  git(root, "add", rel);
  rmSync(path.join(root, rel));
  const r = check(root);
  assert.equal(r.code, 0, r.out);
  assert.doesNotMatch(r.out, /ENOENT/);
});

test("check works from a subdirectory", () => {
  const root = makeRepo();
  const rel = `${DIR}/post.md`;
  write(root, rel, BAD);
  git(root, "add", rel);
  const r = check(root, path.join(root, DIR));
  assert.equal(r.code, 2, r.out);
  assert.match(r.out, /BANNED_PHRASE/);
  assert.doesNotMatch(r.out, /AUDIT_FAIL|ENOENT/);
});

test("check passes clean staged copy from a subdirectory", () => {
  const root = makeRepo();
  const rel = `${DIR}/post.md`;
  write(root, rel, CLEAN);
  git(root, "add", rel);
  const r = check(root, path.join(root, DIR));
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /ok/);
});

test("check fails closed on an empty version set (copy-tripwire-06)", () => {
  const root = makeRepo();
  write(root, `${DIR}/version.json`, JSON.stringify({ patchHistory: [] }));
  write(root, `${DIR}/post.md`, "TideWane v9.9.9 ships today.\n");
  git(root, "add", `${DIR}/version.json`, `${DIR}/post.md`);
  const r = check(root);
  assert.equal(r.code, 2, r.out);
  assert.match(r.out, /UNLISTED_VERSION/);
  const a = spawnSync(process.execPath, [CLI, "audit", "--patch-history", `${DIR}/version.json`, `${DIR}/post.md`], { cwd: root, encoding: "utf8" });
  assert.equal(a.status, 2, a.stdout + a.stderr);
});

test("check fails closed on UTF-16 copy (decode failure)", () => {
  const root = makeRepo();
  const rel = `${DIR}/post.txt`;
  const buf = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from("Let us delve into the tapestry.", "utf16le")]);
  mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
  writeFileSync(path.join(root, rel), buf);
  git(root, "add", rel);
  const r = check(root);
  assert.equal(r.code, 2, r.out);
  assert.match(r.out, /AUDIT_FAIL/);
});

test("check audits staged files with non-ASCII names (copy-tripwire-04, tripwire-family-09)", () => {
  const root = makeRepo();
  const rel = `${DIR}/caf\u00e9.md`;
  write(root, rel, BAD);
  git(root, "add", rel);
  const r = check(root);
  assert.equal(r.code, 2, r.out);
  assert.ok(r.out.includes("caf\u00e9.md"), r.out);
});

test("check skips with exit 0 when nothing under the prefix is staged", () => {
  const root = makeRepo();
  write(root, "other/post.md", BAD);
  git(root, "add", "other/post.md");
  const r = check(root);
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /skipping/);
});

test("check fails closed on a BOM-prefixed version.json that parses once stripped (copy-tripwire-06)", () => {
  const root = makeRepo();
  write(root, `${DIR}/version.json`, "\uFEFF" + JSON.stringify({ version: "1.2.2", patchHistory: [{ version: "1.2.2" }] }));
  write(root, `${DIR}/post.md`, "TideWane v9.9.9 ships today.\n");
  git(root, "add", DIR);
  const r = check(root);
  assert.equal(r.code, 2, r.out);
  assert.match(r.out, /UNLISTED_VERSION/);
});

test("check exits 2 when version.json is unparseable (copy-tripwire-06)", () => {
  const root = makeRepo();
  write(root, `${DIR}/version.json`, '{"patchHistory":[{"version":"1.2.2"},]}');
  write(root, `${DIR}/post.md`, CLEAN);
  git(root, "add", DIR);
  const r = check(root);
  assert.equal(r.code, 2, r.out);
  assert.match(r.out, /AUDIT_FAIL/);
});

test("check and audit agree on a top-level-only version.json (copy-tripwire-06)", () => {
  const root = makeRepo();
  write(root, `${DIR}/version.json`, '{"version":"1.2.2"}');
  write(root, `${DIR}/post.md`, "TideWane v9.9.9 ships today.\n");
  git(root, "add", DIR);
  const c = check(root);
  assert.equal(c.code, 2, c.out);
  assert.match(c.out, /UNLISTED_VERSION/);
  const a = spawnSync(process.execPath, [CLI, "audit", "--patch-history", `${DIR}/version.json`, `${DIR}/post.md`],
    { cwd: root, encoding: "utf8" });
  assert.equal(a.status, 2, a.stdout + a.stderr);
});

test("check reads version.json from the index, falling back to the working tree", () => {
  const root = makeRepo();
  write(root, `${DIR}/version.json`, JSON.stringify({ version: "9.9.9" }));
  write(root, `${DIR}/post.md`, "TideWane v9.9.9 ships today.\n");
  git(root, "add", `${DIR}/post.md`);
  // version.json untracked: working-tree fallback lists 9.9.9.
  assert.equal(check(root).code, 0);
  // Staged version.json lists 1.0.0; a later working-tree edit must not win.
  write(root, `${DIR}/version.json`, JSON.stringify({ version: "1.0.0" }));
  git(root, "add", `${DIR}/version.json`);
  write(root, `${DIR}/version.json`, JSON.stringify({ version: "9.9.9" }));
  const r = check(root);
  assert.equal(r.code, 2, r.out);
});

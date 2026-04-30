#!/usr/bin/env node
// copy-tripwire: pre-commit hook installer.
// Marks its own hook with "# copy-tripwire:v1" so reinstall is idempotent and
// refuses to overwrite an unrelated pre-commit hook. Composes with
// trailer-tripwire and screenshot-tripwire if either is already installed.

import { readFileSync, writeFileSync, existsSync, chmodSync } from "node:fs";
import path from "node:path";

const HOOK_MARKER = "# copy-tripwire:v1";
const TRAILER_MARKER = "# trailer-tripwire:v1";
const SCREENSHOT_MARKER = "# screenshot-tripwire:v1";

const HOOK_BODY_SOLO = `#!/bin/sh
${HOOK_MARKER}
# Auto-installed by 'npx copy-tripwire install-hooks'.
# Audits staged .md / .html / .txt under brand/goneidle-landing/ for AI-default
# tells (banned phrases, em-dash overdose, fabricated versions, over-bulleting).
# Bypass: git commit --no-verify (document why in the commit message).

set -e
exec npx copy-tripwire check
`;

function composedHook(includeTrailer, includeScreenshot) {
  const lines = ["#!/bin/sh", HOOK_MARKER];
  if (includeTrailer)    lines.push(TRAILER_MARKER);
  if (includeScreenshot) lines.push(SCREENSHOT_MARKER);
  lines.push("# Composed pre-commit hook.");
  lines.push("set -e");
  // Order: image checks first (they're cheap and visual), then prose.
  if (includeScreenshot) lines.push("npx screenshot-tripwire check");
  if (includeTrailer)    lines.push("npx trailer-tripwire check");
  lines.push("exec npx copy-tripwire check");
  return lines.join("\n") + "\n";
}

function main() {
  const hooksDir = path.join(process.cwd(), ".git", "hooks");
  if (!existsSync(hooksDir)) {
    console.error("copy-tripwire: .git/hooks not found. Run from a git repo root.");
    process.exit(1);
  }
  const hookPath = path.join(hooksDir, "pre-commit");

  if (existsSync(hookPath)) {
    const existing = readFileSync(hookPath, "utf8");
    const hasTrailer    = existing.includes(TRAILER_MARKER);
    const hasScreenshot = existing.includes(SCREENSHOT_MARKER);
    const hasSelf       = existing.includes(HOOK_MARKER);

    if (hasSelf) {
      // Idempotent reinstall — preserve composition with whatever else is there.
      writeFileSync(hookPath, composedHook(hasTrailer, hasScreenshot));
      try { chmodSync(hookPath, 0o755); } catch {}
      console.log(`copy-tripwire: replaced existing v1 hook at ${hookPath}`);
      return;
    }
    if (hasTrailer || hasScreenshot) {
      writeFileSync(hookPath, composedHook(hasTrailer, hasScreenshot));
      try { chmodSync(hookPath, 0o755); } catch {}
      const composed = [hasTrailer && "trailer-tripwire", hasScreenshot && "screenshot-tripwire"].filter(Boolean).join(" + ");
      console.log(`copy-tripwire: composed with existing ${composed} hook at ${hookPath}`);
      return;
    }
    console.error(`copy-tripwire: refusing to overwrite unrelated pre-commit hook at ${hookPath}`);
    console.error(`  (Hook does not contain ${HOOK_MARKER}, ${TRAILER_MARKER}, or ${SCREENSHOT_MARKER}.)`);
    console.error("  Inspect manually and merge by hand if you want both to run.");
    process.exit(1);
  }

  writeFileSync(hookPath, HOOK_BODY_SOLO);
  try { chmodSync(hookPath, 0o755); } catch {}
  console.log(`copy-tripwire: installed v1 hook at ${hookPath}`);
}

main();

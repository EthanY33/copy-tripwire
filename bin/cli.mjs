#!/usr/bin/env node
// copy-tripwire CLI dispatcher.
//   copy-tripwire audit [--json] [--patch-history <path>] [--max-em-dash <n>] [--max-bullets <n>] <file>...
//   copy-tripwire check                       # audit currently-staged copy under brand/goneidle-landing/
//   copy-tripwire install-hooks               # install pre-commit gate
//   copy-tripwire help

import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);
const LIB        = path.resolve(__dirname, "..", "lib");

const COMMANDS = {
  audit:           "audit.mjs",
  check:           "check.mjs",
  "install-hooks": "install-hooks.mjs",
};

function help(exit = 0) {
  console.log(`copy-tripwire — pattern-checker for marketing copy

Usage:
  copy-tripwire audit [--json] [--patch-history <path>] [--max-em-dash <n>] [--max-bullets <n>] <file>...
  copy-tripwire check                            Audit staged .md/.html/.txt under brand/goneidle-landing/
  copy-tripwire install-hooks                    Install pre-commit gate (composes with trailer-tripwire / screenshot-tripwire)
  copy-tripwire help                             Show this message

Short alias: \`ct\` works the same as \`copy-tripwire\`.

Findings levels: CRITICAL (block, exit 2), WARN (advisory), NOTE (informational).
Catches: AI-overused phrases ("delve" / "tapestry" / "supercharge" / etc.),
em-dash overdose, fabricated roadmap versions (cross-checks against
--patch-history JSON), heavy bullet density. See README for the full
heuristic table.
`);
  process.exit(exit);
}

const [, , cmd, ...rest] = process.argv;

if (!cmd || cmd === "help" || cmd === "--help" || cmd === "-h") help(0);

const script = COMMANDS[cmd];
if (!script) {
  console.error(`copy-tripwire: unknown command "${cmd}"\n`);
  help(64);
}

const child = spawn(process.execPath, [path.join(LIB, script), ...rest], {
  stdio: "inherit",
});
child.on("exit", (code) => process.exit(code ?? 0));

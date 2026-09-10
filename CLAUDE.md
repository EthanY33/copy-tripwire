# CLAUDE.md — copy-tripwire project memory

Node CLI. Pre-commit gate that catches AI-default patterns in marketing prose. Sibling to `trailer-tripwire` and `screenshot-tripwire`.

Layout: `bin/cli.mjs` is a thin dispatcher; subcommands live in `lib/audit.mjs`, `lib/check.mjs`, `lib/install-hooks.mjs`. ESM only, Node >=18, zero dependencies.

## Commands

```
npx copy-tripwire audit <files...>          # exit 2 on CRITICAL
npx copy-tripwire audit --json <files...>   # machine-readable
npx copy-tripwire check                     # audit staged .md/.html/.htm/.txt under brand/goneidle-landing/ ONLY (path hardcoded in lib/check.mjs)
npx copy-tripwire install-hooks             # idempotent pre-commit hook
npx ct audit <files...>                     # short alias
npm test                                    # node --test test/audit.test.mjs (CI: Node 18/20/22 on ubuntu+windows)
```

Flags: `--max-em-dash N`, `--max-bullets N`, `--patch-history path/to/version.json`.

## Heuristic codes

CRITICAL: `BANNED_PHRASE`, `UNLISTED_VERSION`, `AUDIT_FAIL`.
WARN: `EM_DASH_DENSITY`, `OVER_BULLETED`, `ROADMAP_PHRASE`, `EMPTY_FILE`.

Edit the banned-phrase list and roadmap-marker list in `lib/audit.mjs` (each entry is `{ pattern, hint }`).

## Pre-commit hook contract (load-bearing)

The hook is marked `# copy-tripwire:v1` and is **idempotent** — re-running the installer replaces its own hook only. It **composes** with `# trailer-tripwire:v1` and `# screenshot-tripwire:v1` (all three run on commit). It **refuses** to overwrite an unrelated pre-commit hook. **Do not break this contract** — the sibling tripwires depend on it.

If `brand/goneidle-landing/version.json` exists, the hook reads it automatically for `UNLISTED_VERSION` cross-check. Supported shapes: `patchHistory[].version`, `versions[]`, root array, or top-level `version`.

## Text extraction (do not regress)

- Markdown fenced code blocks (` ``` `) and inline code (` ` `) are stripped before phrase matching.
- HTML `<script>` / `<style>` bodies are stripped.
- HTML tags are stripped to prose before word-counting for density metrics.

A banned phrase in a CSS class name or JS string literal must **not** trip the audit. The README documents this — don't break it.

## Pending / out of scope

README "Roadmap" lists sentiment audit, reading-level check, brand-voice deviations, sentence-shape statistics, Node API docs. **Add only if a real failure case appears** — that's the project's explicit philosophy.

## Install / publish state

Not yet on npm registry. Users install via tarball (`https://github.com/EthanY33/copy-tripwire/archive/<commit-sha>.tar.gz`). First npm publish is a deliberate, not-yet-taken step.

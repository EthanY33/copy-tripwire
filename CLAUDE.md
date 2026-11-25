# copy-tripwire

Node CLI pre-commit gate catching AI-default patterns in marketing prose. Sibling of `trailer-tripwire`, `screenshot-tripwire`. `bin/cli.mjs` dispatches to `lib/audit.mjs`, `lib/check.mjs`, `lib/install-hooks.mjs`. ESM only, Node >=18, zero deps.

## Commands
```
npx copy-tripwire audit [--json] <files...>  # exit 2 on CRITICAL
npx copy-tripwire check                      # staged blobs (index content, not working tree) of .md/.html/.htm/.txt under brand/goneidle-landing/ ONLY (hardcoded in lib/check.mjs)
npx copy-tripwire install-hooks              # idempotent pre-commit hook (managed block)
npx ct ...                                   # alias
npm test                                     # node --test test/*.test.mjs, 4 files  (CI: Node 18/20/22, ubuntu+windows)
```
Flags: `--max-em-dash N`, `--max-bullets N`, `--patch-history path/to/version.json`.

## Heuristics
CRITICAL: `BANNED_PHRASE`, `UNLISTED_VERSION`, `AUDIT_FAIL`. WARN: `EM_DASH_DENSITY`, `OVER_BULLETED`, `ROADMAP_PHRASE`, `EMPTY_FILE`.
Banned-phrase and roadmap-marker lists: `lib/audit.mjs`, entries `{ pattern, hint }`.

## Hook contract (sibling tripwires depend on it; do not break)
- `lib/hook-compose.mjs` is shared byte for byte with trailer-tripwire and screenshot-tripwire (pure functions, no fs). Never edit it here; change it in trailer-tripwire and copy it. `lib/install-hooks.mjs` is the thin wrapper.
- Hook file: `git rev-parse --git-path hooks` + `/pre-commit` (honours core.hooksPath and linked worktrees).
- Own block: `# copy-tripwire:v1` / `npx --no -- copy-tripwire check || exit $?` / `# copy-tripwire:v1 end`. Reinstall rewrites only that block.
- Siblings' blocks and hand-written lines are never changed. Old generated hooks migrate to one block per gate (screenshot, trailer, copy). An unrelated hook is refused untouched.
- Auto-reads `brand/goneidle-landing/version.json` if present for `UNLISTED_VERSION`. Shapes: `patchHistory[].version`, `versions[]`, root array, top-level `version`.

## Text extraction (do not regress; README documents it)
Before phrase matching, strip Markdown fenced and inline code and HTML `<script>`/`<style>` bodies. Strip HTML tags before density word counts. A banned phrase in a CSS class or JS string must not trip.
Encoding: `audit` decodes UTF-8 (BOM dropped) and BOM-marked UTF-16; `check` is UTF-8 only. Anything undecodable is `AUDIT_FAIL`, never a clean result.

## Scope
- README Roadmap items (sentiment, reading level, brand-voice deviation, sentence-shape stats, Node API docs): add only when a real failure case appears.
- Not on npm. Install via tarball `https://github.com/EthanY33/copy-tripwire/archive/<commit-sha>.tar.gz`. First npm publish is a deliberate, not-yet-taken step.

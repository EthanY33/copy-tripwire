# copy-tripwire

Node CLI pre-commit gate catching AI-default patterns in marketing prose. Sibling of `trailer-tripwire`, `screenshot-tripwire`. `bin/cli.mjs` dispatches to `lib/audit.mjs`, `lib/check.mjs`, `lib/install-hooks.mjs`. ESM only, Node >=18, zero deps.

## Commands
```
npx copy-tripwire audit [--json] <files...>  # exit 2 on CRITICAL
npx copy-tripwire check                      # staged blobs (index content, not working tree) of .md/.html/.htm/.txt under brand/goneidle-landing/ ONLY (hardcoded in lib/check.mjs)
npx copy-tripwire install-hooks              # idempotent pre-commit hook
npx ct ...                                   # alias
npm test                                     # node --test test/audit.test.mjs test/check.test.mjs  (CI: Node 18/20/22, ubuntu+windows)
```
Flags: `--max-em-dash N`, `--max-bullets N`, `--patch-history path/to/version.json`.

## Heuristics
CRITICAL: `BANNED_PHRASE`, `UNLISTED_VERSION`, `AUDIT_FAIL`. WARN: `EM_DASH_DENSITY`, `OVER_BULLETED`, `ROADMAP_PHRASE`, `EMPTY_FILE`.
Banned-phrase and roadmap-marker lists: `lib/audit.mjs`, entries `{ pattern, hint }`.

## Hook contract (sibling tripwires depend on it; do not break)
- Marked `# copy-tripwire:v1`; reinstall replaces only its own hook.
- Composes with `# trailer-tripwire:v1` and `# screenshot-tripwire:v1` (all three run).
- Refuses to overwrite an unrelated pre-commit hook.
- Auto-reads `brand/goneidle-landing/version.json` if present for `UNLISTED_VERSION`. Shapes: `patchHistory[].version`, `versions[]`, root array, top-level `version`.

## Text extraction (do not regress; README documents it)
Before phrase matching, strip Markdown fenced and inline code and HTML `<script>`/`<style>` bodies. Strip HTML tags before density word counts. A banned phrase in a CSS class or JS string must not trip.

## Scope
- README Roadmap items (sentiment, reading level, brand-voice deviation, sentence-shape stats, Node API docs): add only when a real failure case appears.
- Not on npm. Install via tarball `https://github.com/EthanY33/copy-tripwire/archive/<commit-sha>.tar.gz`. First npm publish is a deliberate, not-yet-taken step.

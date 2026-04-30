#!/usr/bin/env node
// copy-tripwire: catches AI-default tells in marketing prose before it ships.
// Sibling to trailer-tripwire and screenshot-tripwire. Pattern checker, not a
// taste checker — flags measurable tells, not whether the writing is good.
//
// Heuristics:
//   - BANNED_PHRASE        CRITICAL  AI-overused phrase ("delve", "tapestry", ...)
//   - UNLISTED_VERSION     CRITICAL  Mentions a version not in --patch-history JSON
//   - EM_DASH_DENSITY      WARN      em-dashes per 100 words above threshold
//   - OVER_BULLETED        WARN      bullet density above threshold
//   - ROADMAP_PHRASE       WARN      future-tense roadmap markers ("coming soon", etc.)
//
// Exit codes: 0 if no CRITICAL findings, 2 if any CRITICAL.
//
// File handling: HTML / Markdown / .txt are all read as text. HTML tags are
// stripped before counting words and matching phrases (so a banned phrase that
// happens to be a CSS class name doesn't trip the audit).

import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

// --- defaults --------------------------------------------------------------

// AI-overused phrases. Case-insensitive whole-word match where possible.
// Each entry: { pattern, hint }. Pattern is a RegExp source (without flags).
const BANNED_PHRASES = [
  { pattern: "\\bdelve\\b",                              hint: "AI-default verb. Replace with 'dig into' / 'explore' / cut entirely." },
  { pattern: "\\btapestry\\b",                           hint: "AI cliche. Pick a literal noun." },
  { pattern: "\\bever[- ]evolving\\b",                   hint: "AI cliche. Use 'changing' / 'updated regularly' / drop the qualifier." },
  { pattern: "\\bin the fast[- ]paced world\\b",         hint: "Hallmark AI opener. Cut the entire sentence." },
  { pattern: "\\bsupercharge\\b",                        hint: "AI marketing verb. Use 'speed up' / 'boost' / a concrete metric." },
  { pattern: "\\bunleash\\b",                            hint: "AI marketing verb. Use a literal verb." },
  { pattern: "\\bseamlessly\\b",                         hint: "AI cliche. Either show the integration or drop the adverb." },
  { pattern: "\\belevate\\b",                            hint: "AI marketing verb. Use 'improve' / a concrete claim." },
  { pattern: "\\bdive deep into\\b",                     hint: "AI cliche. Cut to 'dig into' / 'explore'." },
  { pattern: "\\bgame[- ]changer\\b",                    hint: "AI cliche. State the actual change." },
  { pattern: "\\bunlock the power of\\b",                hint: "AI cliche. State what the user gets." },
  { pattern: "\\bharness\\s+the\\s+power\\b",            hint: "AI cliche. State what the user gets." },
];

// Future-tense markers that signal fabricated roadmap commitments. These are
// WARN-level — sometimes legit, sometimes a tell.
const ROADMAP_MARKERS = [
  { pattern: "\\bcoming soon\\b",                        hint: "Vague future commitment. Either ship a date or remove." },
  { pattern: "\\bin the next release\\b",                hint: "Tie to a specific version or remove." },
  { pattern: "\\bplanned for\\b",                        hint: "Specific feature or omit." },
  { pattern: "\\bwe['\\u2019]?re working on\\b",          hint: "If not in the next release, leave out per feedback_no_fabricated_roadmap.md." },
  { pattern: "\\b(?:still |currently )?ongoing\\b",      hint: "Vague status. State what shipped, not what's in flight." },
  { pattern: "\\bin (?:active )?development\\b",         hint: "Vague status. Anchor to a milestone." },
  { pattern: "\\bnext up:?\\s",                          hint: "Roadmap teaser. Confirm it's actually next." },
];

// Em-dash characters: U+2014 (—), U+2013 (–) used as em-dash, three hyphens (---).
// We count true em-dashes only — `—` U+2014. Hyphens and en-dashes don't count.
const EM_DASH = /—/g;

// Bullets: lines starting with -, *, +, • after optional whitespace. Markdown
// or HTML <li>.
const BULLET_LINE   = /^\s*[-*+•]\s+/m;
const BULLET_LINE_G = /^\s*[-*+•]\s+/gm;
const HTML_LI       = /<li\b[^>]*>/gi;

// Defaults — calibrated on existing goneIdle prose; tunable per-project.
const DEFAULT_MAX_EM_DASH_PER_100W = 3;
const DEFAULT_MAX_BULLETS_PER_100W = 8;

// --- text extraction -------------------------------------------------------

function stripHtml(s) {
  // Strip <script>/<style> bodies first — banned phrases inside JS/CSS shouldn't fire.
  let t = s.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "");
  t = t.replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, "");
  // Strip HTML comments.
  t = t.replace(/<!--[\s\S]*?-->/g, "");
  // Strip tags but preserve their text content. Keep newlines from <br>/<p>/<li>.
  t = t.replace(/<\/?(?:br|p|div|li|h[1-6]|tr|section|article)\b[^>]*>/gi, "\n");
  t = t.replace(/<[^>]+>/g, "");
  // Decode the most common HTML entities.
  t = t.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
       .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, " ");
  return t;
}

function stripMarkdownNoise(s) {
  // Drop fenced code blocks AND inline code — banned phrases inside code aren't prose.
  let t = s.replace(/```[\s\S]*?```/g, "");
  t = t.replace(/`[^`\n]+`/g, "");
  // Drop link URLs (keep label): [label](url) -> label
  t = t.replace(/\[([^\]]+)\]\(([^)]+)\)/g, "$1");
  return t;
}

function isHtml(filepath, raw) {
  if (/\.html?$/i.test(filepath)) return true;
  return /<\/?(?:html|body|div|p|h[1-6]|li|a)\b/i.test(raw.slice(0, 2000));
}

function isMarkdown(filepath) {
  return /\.(md|markdown)$/i.test(filepath);
}

function extractProse(filepath, raw) {
  if (isHtml(filepath, raw)) return stripHtml(raw);
  if (isMarkdown(filepath))  return stripMarkdownNoise(raw);
  return raw;
}

function wordCount(s) {
  // Split on whitespace AND non-word punctuation. Match the conventional
  // "word ≈ run of alphanumeric chars" definition.
  const tokens = s.match(/[A-Za-z0-9][A-Za-z0-9'-]*/g);
  return tokens ? tokens.length : 0;
}

// --- version-history loader ------------------------------------------------

async function loadPatchHistory(p) {
  if (!p) return null;
  let body;
  try { body = await readFile(p, "utf8"); }
  catch (e) { throw new Error(`could not read --patch-history ${p}: ${e.message}`); }
  let json;
  try { json = JSON.parse(body); }
  catch (e) { throw new Error(`--patch-history ${p} is not JSON: ${e.message}`); }
  // Accept either {patchHistory:[{version,...}]} or {versions:[...]} or [...].
  let arr = null;
  if (Array.isArray(json.patchHistory)) arr = json.patchHistory;
  else if (Array.isArray(json.versions)) arr = json.versions;
  else if (Array.isArray(json))          arr = json;
  if (!arr) throw new Error(`--patch-history ${p}: no patchHistory[] or versions[] array, and root isn't an array`);
  const set = new Set();
  for (const e of arr) {
    if (typeof e === "string") set.add(e);
    else if (e && typeof e.version === "string") set.add(e.version);
  }
  // Also include the top-level current version if present.
  if (typeof json.version === "string") set.add(json.version);
  return set;
}

// Find vN.N.N or vN.N or "version N.N.N" mentions in prose.
function findVersionMentions(prose) {
  const out = new Set();
  const re = /\bv(\d+\.\d+(?:\.\d+)?)\b|\bversion\s+(\d+\.\d+(?:\.\d+)?)\b/gi;
  let m;
  while ((m = re.exec(prose)) !== null) {
    out.add(m[1] || m[2]);
  }
  return [...out];
}

// --- audit -----------------------------------------------------------------

export async function auditFile(filepath, opts = {}) {
  const findings = [];
  const fileStats = await stat(filepath);

  if (fileStats.size === 0) {
    findings.push({ level: "WARN", code: "EMPTY_FILE", msg: "0 bytes" });
    return { filepath, findings, sizeBytes: 0 };
  }

  const raw = await readFile(filepath, "utf8");
  const prose = extractProse(filepath, raw);
  const words = wordCount(prose);

  // Banned phrases (CRITICAL).
  for (const { pattern, hint } of BANNED_PHRASES) {
    const re = new RegExp(pattern, "gi");
    const matches = prose.match(re);
    if (matches && matches.length > 0) {
      // Show the first hit verbatim — case may differ from the canonical form.
      findings.push({
        level: "CRITICAL", code: "BANNED_PHRASE",
        msg: `"${matches[0]}" appears ${matches.length}x — ${hint}`,
      });
    }
  }

  // Roadmap markers (WARN).
  for (const { pattern, hint } of ROADMAP_MARKERS) {
    const re = new RegExp(pattern, "gi");
    const matches = prose.match(re);
    if (matches && matches.length > 0) {
      findings.push({
        level: "WARN", code: "ROADMAP_PHRASE",
        msg: `"${matches[0]}" appears ${matches.length}x — ${hint}`,
      });
    }
  }

  // Em-dash density (WARN).
  const emDashCount = (prose.match(EM_DASH) || []).length;
  const maxEmDash   = opts.maxEmDashPer100W ?? DEFAULT_MAX_EM_DASH_PER_100W;
  if (words > 0) {
    const density = (emDashCount / words) * 100;
    if (density > maxEmDash) {
      findings.push({
        level: "WARN", code: "EM_DASH_DENSITY",
        msg: `${emDashCount} em-dashes in ${words} words (${density.toFixed(1)} per 100, threshold ${maxEmDash}). AI default leans heavily on —; vary with periods or commas.`,
      });
    }
  }

  // Bullet density (WARN). Count both markdown bullets and HTML <li>.
  const mdBullets = (prose.match(BULLET_LINE_G) || []).length;
  const htmlBullets = (raw.match(HTML_LI) || []).length; // measure original HTML, not stripped
  const totalBullets = mdBullets + htmlBullets;
  const maxBullets = opts.maxBulletsPer100W ?? DEFAULT_MAX_BULLETS_PER_100W;
  if (words > 0) {
    const density = (totalBullets / words) * 100;
    if (density > maxBullets) {
      findings.push({
        level: "WARN", code: "OVER_BULLETED",
        msg: `${totalBullets} bullets in ${words} words (${density.toFixed(1)} per 100, threshold ${maxBullets}). Heavy bullet density is a typical AI list-output tell.`,
      });
    }
  }

  // Unlisted versions (CRITICAL when --patch-history is provided).
  if (opts.patchHistory) {
    const mentioned = findVersionMentions(prose);
    const unlisted  = mentioned.filter(v => !opts.patchHistory.has(v));
    if (unlisted.length > 0) {
      findings.push({
        level: "CRITICAL", code: "UNLISTED_VERSION",
        msg: `mentions version(s) not in patch history: ${unlisted.map(v => "v" + v).join(", ")}. ` +
             `Either ship the version first, or remove the mention. Per feedback_no_fabricated_roadmap.md.`,
      });
    }
  }

  return { filepath, findings, sizeBytes: fileStats.size, wordCount: words };
}

// --- CLI -------------------------------------------------------------------

function parseFlag(args, name) {
  const i = args.indexOf(name);
  if (i === -1) return null;
  const v = args[i + 1];
  args.splice(i, 2);
  return v;
}

async function main() {
  const args = process.argv.slice(2);
  const jsonMode = args.includes("--json");
  if (jsonMode) args.splice(args.indexOf("--json"), 1);

  const patchHistoryPath = parseFlag(args, "--patch-history");
  const maxEmDash        = parseFlag(args, "--max-em-dash");
  const maxBullets       = parseFlag(args, "--max-bullets");

  const files = args.filter(a => !a.startsWith("--"));
  if (files.length === 0) {
    console.error("usage: audit.mjs [--json] [--patch-history <path>] [--max-em-dash <n>] [--max-bullets <n>] <file>...");
    process.exit(64);
  }

  let patchHistory = null;
  try { patchHistory = await loadPatchHistory(patchHistoryPath); }
  catch (e) {
    console.error(`copy-tripwire: ${e.message}`);
    process.exit(1);
  }

  const opts = {
    patchHistory,
    maxEmDashPer100W: maxEmDash ? Number(maxEmDash) : undefined,
    maxBulletsPer100W: maxBullets ? Number(maxBullets) : undefined,
  };

  const reports = [];
  for (const f of files) {
    try { reports.push(await auditFile(f, opts)); }
    catch (e) { reports.push({ filepath: f, findings: [{ level: "CRITICAL", code: "AUDIT_FAIL", msg: e.message }] }); }
  }

  const totalCritical = reports.reduce((n, r) => n + r.findings.filter(f => f.level === "CRITICAL").length, 0);

  if (jsonMode) {
    console.log(JSON.stringify({ reports, totalCritical }, null, 2));
  } else {
    for (const r of reports) {
      const head = `${r.filepath}${r.wordCount !== undefined ? ` [${r.wordCount} words, ${(r.sizeBytes/1024).toFixed(1)} KB]` : ""}`;
      console.log(head);
      if (r.findings.length === 0) { console.log("  ok"); continue; }
      for (const f of r.findings) console.log(`  ${f.level.padEnd(8)} ${f.code.padEnd(20)} ${f.msg}`);
    }
    console.log(`\n${reports.length} file(s) audited — ${totalCritical} CRITICAL finding(s)`);
  }

  process.exit(totalCritical > 0 ? 2 : 0);
}

const invokedDirectly = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) {
  main().catch(e => { console.error(e); process.exit(1); });
}

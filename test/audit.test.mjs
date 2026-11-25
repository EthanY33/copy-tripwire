// Smoke tests for copy-tripwire's heuristics. Synthesizes prose fixtures in a
// tmpdir, runs auditFile against them, and asserts findings match expectations.
//
// Uses Node's built-in test runner (node:test) — no external deps.

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { auditFile, auditText } from "../lib/audit.mjs";

const AUDIT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "lib", "audit.mjs");

let TMP;
test("setup", async () => { TMP = await mkdtemp(path.join(tmpdir(), "ct-test-")); });

const findingCodes = r => r.findings.map(f => f.code);
async function fixture(name, content) {
  const fp = path.join(TMP, name);
  await writeFile(fp, content);
  return fp;
}
// Run lib/audit.mjs as a CLI, cwd = the fixture dir.
function runAudit(...args) {
  const r = spawnSync(process.execPath, [AUDIT, ...args], { cwd: TMP, encoding: "utf8" });
  return { code: r.status, out: r.stdout + r.stderr };
}

// --- BANNED_PHRASE ---------------------------------------------------------

test("BANNED_PHRASE fires on 'delve'", async () => {
  const fp = await fixture("delve.md", "Let's delve into the inner workings of the system.");
  const r = await auditFile(fp);
  assert.ok(findingCodes(r).includes("BANNED_PHRASE"), JSON.stringify(r.findings));
  assert.match(r.findings[0].msg, /delve/i);
});

test("BANNED_PHRASE fires on multiple offenders independently", async () => {
  const fp = await fixture("multi.md", "Supercharge your workflow and unleash your potential.");
  const r = await auditFile(fp);
  const banned = r.findings.filter(f => f.code === "BANNED_PHRASE");
  assert.equal(banned.length, 2, JSON.stringify(r.findings));
});

test("BANNED_PHRASE does NOT fire on innocuous text", async () => {
  const fp = await fixture("clean.md", "TideWane v1.2.2 ships with five fixes and a UI scale repair.");
  const r = await auditFile(fp);
  assert.ok(!findingCodes(r).includes("BANNED_PHRASE"), JSON.stringify(r.findings));
});

test("BANNED_PHRASE in HTML <script> is ignored", async () => {
  const fp = await fixture("script.html",
    `<html><body><p>clean text</p><script>const slogan = "supercharge your workflow"</script></body></html>`);
  const r = await auditFile(fp);
  assert.ok(!findingCodes(r).includes("BANNED_PHRASE"), JSON.stringify(r.findings));
});

test("BANNED_PHRASE in markdown code fence is ignored", async () => {
  const fp = await fixture("code.md", "Here's the example:\n```js\nconst slogan = 'unleash power';\n```\n");
  const r = await auditFile(fp);
  assert.ok(!findingCodes(r).includes("BANNED_PHRASE"), JSON.stringify(r.findings));
});

// --- ROADMAP_PHRASE --------------------------------------------------------

test("ROADMAP_PHRASE fires on 'coming soon'", async () => {
  const fp = await fixture("roadmap.md", "More zones coming soon!");
  const r = await auditFile(fp);
  assert.ok(findingCodes(r).includes("ROADMAP_PHRASE"), JSON.stringify(r.findings));
});

test("ROADMAP_PHRASE fires on 'we're working on'", async () => {
  const fp = await fixture("roadmap2.md", "We're working on a new boss for the next patch.");
  const r = await auditFile(fp);
  assert.ok(findingCodes(r).includes("ROADMAP_PHRASE"), JSON.stringify(r.findings));
});

test("ROADMAP_PHRASE fires on smart-quote 'we’re working on'", async () => {
  const fp = await fixture("roadmap3.md", "We’re working on a new boss for the next patch.");
  const r = await auditFile(fp);
  assert.ok(findingCodes(r).includes("ROADMAP_PHRASE"), JSON.stringify(r.findings));
});

// --- EM_DASH_DENSITY -------------------------------------------------------

test("EM_DASH_DENSITY fires when >threshold per 100 words", async () => {
  // 10 words, 1 em-dash = 10 per 100 (above default of 3).
  const fp = await fixture("dash.md", "one two three four five six seven eight nine ten — done.");
  const r = await auditFile(fp);
  assert.ok(findingCodes(r).includes("EM_DASH_DENSITY"), JSON.stringify(r.findings));
});

test("EM_DASH_DENSITY does NOT fire below threshold", async () => {
  // 100+ words, 1 em-dash = 1 per 100 (below 3).
  const long = Array.from({ length: 100 }, (_, i) => `word${i}`).join(" ") + " — end";
  const fp = await fixture("dash-low.md", long);
  const r = await auditFile(fp);
  assert.ok(!findingCodes(r).includes("EM_DASH_DENSITY"), JSON.stringify(r.findings));
});

test("EM_DASH_DENSITY counts U+2014 only — hyphens and en-dashes don't trip", async () => {
  // 5 words, 3 hyphens, 0 em-dash. Should NOT fire.
  const fp = await fixture("hyphens.md", "well-known low-cost no-frills text-only here");
  const r = await auditFile(fp);
  assert.ok(!findingCodes(r).includes("EM_DASH_DENSITY"), JSON.stringify(r.findings));
});

// --- OVER_BULLETED ---------------------------------------------------------

test("OVER_BULLETED fires on bullet-heavy markdown", async () => {
  // 8 bullet items, ~3 words each = 24 words; 8 bullets / 24 words = 33 per 100. Above default 8.
  const fp = await fixture("bullets.md",
    "- one item\n- two item\n- three item\n- four item\n- five item\n- six item\n- seven item\n- eight item\n");
  const r = await auditFile(fp);
  assert.ok(findingCodes(r).includes("OVER_BULLETED"), JSON.stringify(r.findings));
});

test("OVER_BULLETED does NOT fire on prose with a few bullets", async () => {
  const text =
    "Long intro paragraph that has many words and gives plenty of context " +
    "about what is going on with this body of text " + Array.from({length:80},(_,i)=>"word"+i).join(" ") +
    "\n\n- bullet a\n- bullet b\n";
  const fp = await fixture("bullets-low.md", text);
  const r = await auditFile(fp);
  assert.ok(!findingCodes(r).includes("OVER_BULLETED"), JSON.stringify(r.findings));
});

test("OVER_BULLETED counts HTML <li> too", async () => {
  const fp = await fixture("bullets.html",
    "<ul><li>a</li><li>b</li><li>c</li><li>d</li><li>e</li><li>f</li><li>g</li><li>h</li></ul>");
  const r = await auditFile(fp);
  assert.ok(findingCodes(r).includes("OVER_BULLETED"), JSON.stringify(r.findings));
});

// --- UNLISTED_VERSION ------------------------------------------------------

test("UNLISTED_VERSION fires when version not in patch history", async () => {
  const ph = new Set(["1.0.0", "1.1.0", "1.2.0"]);
  const fp = await fixture("unlisted.md", "We just shipped TideWane v9.9.9!");
  const r = await auditFile(fp, { patchHistory: ph });
  assert.ok(findingCodes(r).includes("UNLISTED_VERSION"), JSON.stringify(r.findings));
  assert.match(r.findings.find(f => f.code === "UNLISTED_VERSION").msg, /v9\.9\.9/);
});

test("UNLISTED_VERSION does NOT fire when version IS in patch history", async () => {
  const ph = new Set(["1.0.0", "1.1.0", "1.2.0", "1.2.2"]);
  const fp = await fixture("listed.md", "TideWane v1.2.2 ships with UI Scale fixes.");
  const r = await auditFile(fp, { patchHistory: ph });
  assert.ok(!findingCodes(r).includes("UNLISTED_VERSION"), JSON.stringify(r.findings));
});

test("UNLISTED_VERSION skipped entirely when no patchHistory provided", async () => {
  const fp = await fixture("noph.md", "TideWane v9.9.9 is amazing.");
  const r = await auditFile(fp); // no opts
  assert.ok(!findingCodes(r).includes("UNLISTED_VERSION"), JSON.stringify(r.findings));
});

test("UNLISTED_VERSION matches both 'v1.2.3' and 'version 1.2.3' forms", async () => {
  const ph = new Set(["1.0.0"]);
  const fp = await fixture("vform.md", "Try version 7.7.7 today!");
  const r = await auditFile(fp, { patchHistory: ph });
  assert.ok(findingCodes(r).includes("UNLISTED_VERSION"), JSON.stringify(r.findings));
  assert.match(r.findings.find(f => f.code === "UNLISTED_VERSION").msg, /v7\.7\.7/);
});

test("UNLISTED_VERSION accepts a history that stores a leading v (copy-tripwire-11)", async () => {
  const fp = await fixture("vhist.md", "TideWane v1.2.2 ships today. Version 1.3.0 followed.");
  const r = await auditFile(fp, { patchHistory: new Set(["v1.2.2", " V1.3.0 "]) });
  assert.ok(!findingCodes(r).includes("UNLISTED_VERSION"), JSON.stringify(r.findings));
});

test("UNLISTED_VERSION still fires against a v-prefixed history (copy-tripwire-11)", async () => {
  const fp = await fixture("vhist-unlisted.md", "TideWane v1.2.2 shipped, v9.9.9 is next.");
  const r = await auditFile(fp, { patchHistory: new Set(["v1.2.2"]) });
  const f = r.findings.find(x => x.code === "UNLISTED_VERSION");
  assert.ok(f, JSON.stringify(r.findings));
  assert.match(f.msg, /history: v9\.9\.9\. /);
});

test("UNLISTED_VERSION reads a two-part version as N.N.0 (copy-tripwire-11)", async () => {
  const short = await fixture("twopart.md", "TideWane v1.2 ships today.");
  const long = await fixture("threepart.md", "TideWane v1.2.0 ships today.");
  assert.deepEqual(findingCodes(await auditFile(short, { patchHistory: new Set(["1.2.0"]) })), []);
  assert.deepEqual(findingCodes(await auditFile(long, { patchHistory: new Set(["1.2"]) })), []);
  // 1.2 is 1.2.0, not any 1.2.x: the mention is reported as written.
  const r = await auditFile(short, { patchHistory: new Set(["1.2.2"]) });
  const f = r.findings.find(x => x.code === "UNLISTED_VERSION");
  assert.ok(f, JSON.stringify(r.findings));
  assert.match(f.msg, /history: v1\.2\. /);
});

test("CLI accepts a version listed with a leading v in --patch-history (copy-tripwire-11)", async () => {
  await fixture("vh-v.json", JSON.stringify({ patchHistory: [{ version: "v1.2.2" }] }));
  await fixture("vh-listed.md", "TideWane v1.2.2 ships today.");
  await fixture("vh-unlisted.md", "TideWane v9.9.9 ships today.");
  const ok = runAudit("--patch-history", "vh-v.json", "vh-listed.md");
  assert.equal(ok.code, 0, ok.out);
  const bad = runAudit("--patch-history", "vh-v.json", "vh-unlisted.md");
  assert.equal(bad.code, 2, bad.out);
  assert.match(bad.out, /UNLISTED_VERSION/);
});

// --- File handling ---------------------------------------------------------

test("EMPTY_FILE warns on 0 bytes", async () => {
  const fp = await fixture("empty.md", "");
  const r = await auditFile(fp);
  assert.ok(findingCodes(r).includes("EMPTY_FILE"), JSON.stringify(r.findings));
});

test("clean prose returns no CRITICAL findings", async () => {
  const fp = await fixture("clean-prose.md",
    "TideWane is a deep-sea idle dungeon crawler. v1.2.2 ships UI scale " +
    "fixes for the Dive view at non-100% scales. No save migration. Get it on Steam.");
  const r = await auditFile(fp);
  const criticals = r.findings.filter(f => f.level === "CRITICAL");
  assert.equal(criticals.length, 0, JSON.stringify(criticals));
});

// --- Encoding (copy-tripwire-05) -------------------------------------------

const TELLS = "Let us delve into the tapestry.";
const utf16le = s => Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(s, "utf16le")]);
const utf16be = s => Buffer.concat([Buffer.from([0xfe, 0xff]), Buffer.from(s, "utf16le").swap16()]);

test("UTF-16LE file with a BOM is decoded and audited (copy-tripwire-05)", async () => {
  const fp = await fixture("u16le.md", utf16le(TELLS));
  const r = await auditFile(fp);
  assert.equal(r.findings.filter(f => f.code === "BANNED_PHRASE").length, 2, JSON.stringify(r.findings));
});

test("UTF-16BE file with a BOM is decoded and audited (copy-tripwire-05)", async () => {
  const fp = await fixture("u16be.md", utf16be(TELLS));
  const r = await auditFile(fp);
  assert.equal(r.findings.filter(f => f.code === "BANNED_PHRASE").length, 2, JSON.stringify(r.findings));
});

test("UTF-16 file keeps the version cross-check (copy-tripwire-05)", async () => {
  const fp = await fixture("u16ver.md", utf16le("TideWane v9.9.9 ships today."));
  const r = await auditFile(fp, { patchHistory: new Set(["1.0.0"]) });
  assert.ok(findingCodes(r).includes("UNLISTED_VERSION"), JSON.stringify(r.findings));
});

test("UTF-8 file with a BOM audits like one without", async () => {
  const fp = await fixture("u8bom.md", Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(TELLS, "utf8")]));
  const r = await auditFile(fp);
  assert.equal(r.findings.filter(f => f.code === "BANNED_PHRASE").length, 2, JSON.stringify(r.findings));
  assert.equal(r.wordCount, 6);
});

test("UTF-16 without a BOM is AUDIT_FAIL, never a clean result (copy-tripwire-05)", async () => {
  const fp = await fixture("u16nobom.md", Buffer.from(TELLS, "utf16le"));
  const r = await auditFile(fp);
  const fail = r.findings.find(f => f.code === "AUDIT_FAIL");
  assert.ok(fail, JSON.stringify(r.findings));
  assert.equal(fail.level, "CRITICAL");
});

test("invalid UTF-8 bytes are AUDIT_FAIL, never a clean result (copy-tripwire-05)", async () => {
  // Windows-1252 "cafe" with an e-acute (0xE9) and a curly apostrophe (0x92).
  const fp = await fixture("cp1252.txt", Buffer.from([0x63, 0x61, 0x66, 0xe9, 0x20, 0x77, 0x65, 0x92, 0x72, 0x65]));
  const r = await auditFile(fp);
  const fail = r.findings.find(f => f.code === "AUDIT_FAIL");
  assert.ok(fail, JSON.stringify(r.findings));
  assert.equal(fail.level, "CRITICAL");
});

test("CLI exits 2 on UTF-16 copy with banned phrases (copy-tripwire-05)", async () => {
  await fixture("cli-u16.md", utf16le(TELLS));
  const r = runAudit("cli-u16.md");
  assert.equal(r.code, 2, r.out);
  assert.match(r.out, /BANNED_PHRASE/);
});

test("CLI exits 2 with AUDIT_FAIL on undecodable copy (copy-tripwire-05)", async () => {
  await fixture("cli-u16nobom.md", Buffer.from("Clean copy here.", "utf16le"));
  const r = runAudit("cli-u16nobom.md");
  assert.equal(r.code, 2, r.out);
  assert.match(r.out, /CRITICAL\s+AUDIT_FAIL/);
  const j = JSON.parse(runAudit("--json", "cli-u16nobom.md").out);
  assert.equal(j.totalCritical, 1);
  assert.equal(j.reports[0].findings[0].code, "AUDIT_FAIL");
});

// --- Linear-time extraction and size cap (copy-tripwire-12) ----------------

// Each input made one of the old patterns rescan the rest of the file from
// every start position: 200 KB took from seconds to over a minute.
const SLOW_INPUTS = [
  ["blank lines",                 "blank.txt",    () => "hello world" + "\n".repeat(200_000)],
  ["bare '<' characters",         "lt.html",      () => "<".repeat(200_000)],
  ["unclosed '<!--'",             "comment.html", () => "<!--".repeat(50_000)],
  ["unclosed '<script>'",         "script.html",  () => "<script>".repeat(25_000)],
  ["unclosed '<style>'",          "style.html",   () => "<style>".repeat(28_000)],
  ["unterminated tag openers",    "open.html",    () => "<script <p <li ".repeat(13_000)],
  ["unclosed '[a]('",             "link.md",      () => "[a](".repeat(50_000)],
  ["unclosed '['",                "bracket.md",   () => "[".repeat(200_000)],
];
for (const [what, name, make] of SLOW_INPUTS) {
  test(`200 KB of ${what} audits in under 1 s (copy-tripwire-12)`, async () => {
    const fp = await fixture("slow-" + name, make());
    const t0 = performance.now();
    const r = await auditFile(fp);
    const ms = performance.now() - t0;
    assert.ok(ms < 1000, `took ${Math.round(ms)} ms`);
    assert.ok(!findingCodes(r).includes("AUDIT_FAIL"), JSON.stringify(r.findings));
  });
}

test("a file over the 5 MB cap is AUDIT_FAIL (copy-tripwire-12)", async () => {
  const fp = await fixture("huge.txt", "word ".repeat(1_100_000)); // 5.5 MB
  const r = await auditFile(fp);
  const fail = r.findings.find(f => f.code === "AUDIT_FAIL");
  assert.ok(fail, JSON.stringify(r.findings));
  assert.equal(fail.level, "CRITICAL");
});

test("auditText applies the 5 MB cap to already-loaded text (copy-tripwire-12)", () => {
  const r = auditText("staged.txt", "word ".repeat(1_100_000));
  assert.deepEqual(findingCodes(r), ["AUDIT_FAIL"]);
  const ok = auditText("staged.txt", "word ".repeat(1_000_000)); // 5.0 MB decimal, under the cap
  assert.deepEqual(findingCodes(ok), []);
});

test("script, style and comment bodies are still stripped, any case, more than one", async () => {
  const fp = await fixture("blocks.html",
    `<p>keep one</p><SCRIPT type="x">supercharge()</SCRIPT><p>We delve.</p>` +
    `<style>.tapestry{color:red}</style><!-- unleash --><script>elevate()</script><p>end</p>`);
  const r = await auditFile(fp);
  const banned = r.findings.filter(f => f.code === "BANNED_PHRASE");
  assert.equal(banned.length, 1, JSON.stringify(r.findings));
  assert.match(banned[0].msg, /delve/);
});

test("an unclosed <script> does not hide the text after it", async () => {
  const fp = await fixture("unclosed.html", `<p>hi</p><script>var a = 1;\n<p>We delve.</p>`);
  const r = await auditFile(fp);
  assert.ok(findingCodes(r).includes("BANNED_PHRASE"), JSON.stringify(r.findings));
});

test("Markdown link URLs are still dropped, including one with parentheses", async () => {
  const fp = await fixture("links.md",
    "Read [the notes](https://example.com/delve) and [the song](https://example.org/wiki/Elevate_(song)) today.");
  const r = await auditFile(fp);
  assert.ok(!findingCodes(r).includes("BANNED_PHRASE"), JSON.stringify(r.findings));
});

test("OVER_BULLETED still counts indented, CRLF and blank-line-separated bullets", async () => {
  const fp = await fixture("bullets-mixed.md",
    "- one item\r\n\r\n  - two item\r\n\r\n\t* three item\r\n+\tfour item\r\n\r\n\r\n- five item\r\n");
  const r = await auditFile(fp);
  const over = r.findings.find(f => f.code === "OVER_BULLETED");
  assert.ok(over, JSON.stringify(r.findings));
  assert.match(over.msg, /^5 bullets in 10 words/);
});

// --- Markdown with embedded HTML (copy-tripwire-08) ------------------------

test("code in Markdown is ignored when the file opens with HTML (copy-tripwire-08)", async () => {
  const fp = await fixture("html-header.md",
    '<p align="center"><img src="x.png" alt="logo"></p>\n\n# Title\n\nPlain intro text.\n\n' +
    "```js\nconst slogan = 'unleash power';\n```\n\nCall `supercharge()` to start.\n");
  const r = await auditFile(fp);
  assert.ok(!findingCodes(r).includes("BANNED_PHRASE"), JSON.stringify(r.findings));
});

test("HTML embedded late in Markdown is stripped (copy-tripwire-08)", async () => {
  // Past the first 2000 characters, where the content sniff never looked.
  const words = Array.from({ length: 450 }, (_, i) => `word${i}`).join(" ");
  const fp = await fixture("late-html.md",
    words + '\n\n<div class="elevate game-changer">clean</div>\n<style>.tapestry{color:red}</style>\n');
  const r = await auditFile(fp);
  assert.ok(!findingCodes(r).includes("BANNED_PHRASE"), JSON.stringify(r.findings));
  assert.equal(r.wordCount, 451);
});

test("a bare '<' in prose does not hide the text up to the next '>' (copy-tripwire-08)", async () => {
  const body = "<p>hi</p>\n\nSetup takes < 5 minutes. We delve into the tapestry and supercharge everything.\n\n> a quote line\n";
  for (const name of ["bare-lt.md", "bare-lt.html", "bare-lt.txt"]) {
    const r = await auditFile(await fixture(name, body));
    const banned = r.findings.filter(f => f.code === "BANNED_PHRASE");
    assert.equal(banned.length, 3, `${name}: ${JSON.stringify(r.findings)}`);
  }
});

test("doctype, processing instructions and closing tags are still stripped", async () => {
  const fp = await fixture("doctype.html",
    '<!DOCTYPE html>\n<?xml version="1.0"?>\n<html lang="en"><body><span class="elevate">one</span> <b>two</b></body></html>');
  const r = await auditFile(fp);
  assert.deepEqual(findingCodes(r), []);
  assert.equal(r.wordCount, 2);
});

// --- Line wrapping and HTML entities (copy-tripwire-09) --------------------

test("phrases split across a line break are matched (copy-tripwire-09)", async () => {
  const fp = await fixture("wrapped.md",
    "We dive deep\ninto the data and unlock the power\nof search. It is a game\nchanger. " +
    "In the fast-paced\nworld of tools, more zones are coming\nsoon.\n");
  const r = await auditFile(fp);
  const banned = r.findings.filter(f => f.code === "BANNED_PHRASE").map(f => f.msg).join("\n");
  for (const phrase of ["dive deep into", "unlock the power of", "game changer", "In the fast-paced world"]) {
    assert.ok(banned.includes(`"${phrase}"`), `${phrase}: ${JSON.stringify(r.findings)}`);
  }
  const roadmap = r.findings.filter(f => f.code === "ROADMAP_PHRASE").map(f => f.msg).join("\n");
  assert.ok(roadmap.includes('"coming soon"'), JSON.stringify(r.findings));
});

test("phrases wrapped inside indented HTML are matched (copy-tripwire-09)", async () => {
  const fp = await fixture("wrapped.html",
    "<p>\r\n    We dive deep\r\n    into the data. Try version\r\n    9.9.9 today.\r\n</p>\r\n");
  const r = await auditFile(fp, { patchHistory: new Set(["1.0.0"]) });
  assert.deepEqual(findingCodes(r), ["BANNED_PHRASE", "UNLISTED_VERSION"], JSON.stringify(r.findings));
});

test("EM_DASH_DENSITY counts entity-encoded em dashes (copy-tripwire-09)", async () => {
  for (const [name, dash] of [["named", "&mdash;"], ["decimal", "&#8212;"], ["hex", "&#x2014;"]]) {
    const fp = await fixture(`dash-${name}.html`,
      `<p>one two ${dash} three four ${dash} five six ${dash} seven eight ${dash} nine ten ${dash} done</p>`);
    const r = await auditFile(fp);
    const dense = r.findings.find(f => f.code === "EM_DASH_DENSITY");
    assert.ok(dense, `${name}: ${JSON.stringify(r.findings)}`);
    assert.match(dense.msg, /^5 em-dashes in 11 words/);
  }
});

test("ROADMAP_PHRASE sees an entity-encoded apostrophe (copy-tripwire-09)", async () => {
  for (const [name, apos] of [["rsquo", "&rsquo;"], ["apos", "&apos;"], ["decimal", "&#39;"], ["hex", "&#x2019;"]]) {
    const fp = await fixture(`apos-${name}.html`, `<p>We${apos}re working on a new boss.</p>`);
    const r = await auditFile(fp);
    assert.ok(findingCodes(r).includes("ROADMAP_PHRASE"), `${name}: ${JSON.stringify(r.findings)}`);
  }
});

test("an escaped entity is text, not a second entity (copy-tripwire-09)", async () => {
  // "&amp;mdash;" reads as the text "&mdash;"; unknown and out-of-range entities stay as written.
  const fp = await fixture("escaped.html",
    "<p>one &amp;mdash; two &amp;mdash; three &amp;mdash; four &bogus; &#99999999; &#0; five</p>");
  const r = await auditFile(fp);
  assert.deepEqual(findingCodes(r), [], JSON.stringify(r.findings));
});

test("OVER_BULLETED still counts lines after whitespace is collapsed for phrases", async () => {
  const fp = await fixture("bullets-wrapped.md", "- game\n- changer\n- three item\n- four item\n");
  const r = await auditFile(fp);
  assert.deepEqual(findingCodes(r), ["OVER_BULLETED"], JSON.stringify(r.findings));
});

// --- CLI arguments (copy-tripwire-10) --------------------------------------

test("CLI accepts --patch-history=PATH (copy-tripwire-10)", async () => {
  await fixture("cli-vh.json", JSON.stringify({ patchHistory: [{ version: "1.0.0" }] }));
  await fixture("cli-unlisted.md", "TideWane v9.9.9 ships today.");
  for (const args of [["--patch-history=cli-vh.json"], ["--patch-history", "cli-vh.json"]]) {
    const r = runAudit(...args, "cli-unlisted.md");
    assert.equal(r.code, 2, `${args}: ${r.out}`);
    assert.match(r.out, /UNLISTED_VERSION/);
  }
});

test("CLI accepts --max-em-dash=N and --max-bullets=N (copy-tripwire-10)", async () => {
  // 1 em dash in 11 words (9.1 per 100) and 4 bullets in 12 words (33.3 per 100).
  await fixture("cli-dash.md", "one two three four five six seven eight nine ten — done.");
  await fixture("cli-bullets.md", "- one item here\n- two item here\n- three item here\n- four item here\n");
  const codes = (...args) => JSON.parse(runAudit("--json", ...args).out).reports[0].findings.map(f => f.code);
  assert.deepEqual(codes("cli-dash.md"), ["EM_DASH_DENSITY"]);
  assert.deepEqual(codes("--max-em-dash=10", "cli-dash.md"), []);
  assert.deepEqual(codes("--max-em-dash", "10", "cli-dash.md"), []);
  assert.deepEqual(codes("cli-bullets.md"), ["OVER_BULLETED"]);
  assert.deepEqual(codes("--max-bullets=50", "cli-bullets.md"), []);
});

test("CLI rejects an unknown option with exit 64 (copy-tripwire-10)", async () => {
  await fixture("cli-ok.md", "Clean copy here.");
  const r = runAudit("--bogus", "cli-ok.md");
  assert.equal(r.code, 64, r.out);
  assert.match(r.out, /unknown option --bogus/);
});

test("CLI rejects a missing or non-numeric option value with exit 64 (copy-tripwire-10)", async () => {
  await fixture("cli-ok.md", "Clean copy here.");
  const cases = [
    ["--max-em-dash", "abc", "cli-ok.md"],
    ["--max-em-dash=abc", "cli-ok.md"],
    ["--max-bullets", "cli-ok.md"],          // the file name is not a number
    ["--max-bullets=", "cli-ok.md"],
    ["--max-bullets=Infinity", "cli-ok.md"],
    ["cli-ok.md", "--max-bullets"],
    ["cli-ok.md", "--patch-history"],
    ["--patch-history=", "cli-ok.md"],
    ["--patch-history", "--json", "cli-ok.md"],
    ["--json=1", "cli-ok.md"],
  ];
  for (const args of cases) {
    const r = runAudit(...args);
    assert.equal(r.code, 64, `${args.join(" ")}: ${r.out}`);
  }
});

test("CLI audits a file named like an option after a -- terminator (copy-tripwire-10)", async () => {
  await fixture("cli-ok.md", "Clean copy here.");
  await fixture("--promo.md", "We delve.");
  const dropped = runAudit("cli-ok.md", "--promo.md");
  assert.equal(dropped.code, 64, dropped.out);
  const r = runAudit("cli-ok.md", "--", "--promo.md");
  assert.equal(r.code, 2, r.out);
  assert.match(r.out, /BANNED_PHRASE/);
});

test("a directory is AUDIT_FAIL, not an empty file (copy-tripwire-10)", async () => {
  await mkdir(path.join(TMP, "adir", "sub"), { recursive: true });
  await writeFile(path.join(TMP, "adir", "sub", "x.md"), "We delve.");
  await assert.rejects(auditFile(path.join(TMP, "adir")), /not a regular file/);
  const r = runAudit("adir");
  assert.equal(r.code, 2, r.out);
  assert.match(r.out, /CRITICAL\s+AUDIT_FAIL/);
});

// --- teardown --------------------------------------------------------------

test("cleanup", async () => { await rm(TMP, { recursive: true, force: true }); });

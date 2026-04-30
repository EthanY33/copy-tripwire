// Smoke tests for copy-tripwire's heuristics. Synthesizes prose fixtures in a
// tmpdir, runs auditFile against them, and asserts findings match expectations.
//
// Uses Node's built-in test runner (node:test) — no external deps.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { auditFile } from "../lib/audit.mjs";

let TMP;
test("setup", async () => { TMP = await mkdtemp(path.join(tmpdir(), "ct-test-")); });

const findingCodes = r => r.findings.map(f => f.code);
async function fixture(name, content) {
  const fp = path.join(TMP, name);
  await writeFile(fp, content);
  return fp;
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

// --- teardown --------------------------------------------------------------

test("cleanup", async () => { await rm(TMP, { recursive: true, force: true }); });

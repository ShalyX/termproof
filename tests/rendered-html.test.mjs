import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const title = /<title>Termproof — Terms, tested\.<\/title>/i;
const description = /<meta(?=[^>]*\bname=["']description["'])(?=[^>]*Proof before release)/i;

test("renders public production metadata", async () => {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);

  const response = await worker.fetch(
    new Request("http://localhost/", {
      headers: { accept: "text/html" },
    }),
    {
      ASSETS: {
        fetch: async () => new Response("Not found", { status: 404 }),
      },
    },
    {
      waitUntil() {},
      passThroughOnException() {},
    },
  );

  assert.equal(response.status, 200);
  assert.match(
    response.headers.get("content-type") ?? "",
    /^text\/html\b/i,
  );
  const html = await response.text();
  assert.match(html, title);
  assert.match(html, description);
  assert.match(html, /Termproof/i);
  assert.match(html, /Terms, tested\./i);
  assert.match(html, /PROMISE[\s\S]*TEST[\s\S]*EVIDENCE[\s\S]*VERDICT/i);
  assert.match(html, /href=["'][^"']*\/favicon\.svg["']/i);
  assert.doesNotMatch(html, /Grant Milestone Verifier|codex-preview|SLICE 1|Starter Project/i);
});

test("ships deterministic vector brand assets without decorative effects", async () => {
  const assets = [
    "condition-cut-primary.svg",
    "condition-cut-inverse.svg",
    "condition-cut-symbol.svg",
    "termproof-lockup.svg",
    "termproof-app-icon.svg",
  ];

  for (const asset of assets) {
    const svg = await readFile(new URL(`../public/brand/${asset}`, import.meta.url), "utf8");
    assert.match(svg, /<svg\b/i, asset);
    assert.match(svg, /viewBox=["']/i, asset);
    assert.doesNotMatch(svg, /(?:linear|radial)Gradient|filter\s*=|<image\b/i, asset);
  }

  const favicon = await readFile(new URL("../public/favicon.svg", import.meta.url), "utf8");
  assert.match(favicon, /viewBox=["']0 0 32 32["']/i);
  assert.doesNotMatch(favicon, /(?:linear|radial)Gradient|filter\s*=|<image\b/i);
});

test("defines the approved accessible production palette", async () => {
  const css = await readFile(new URL("../src/app/styles.css", import.meta.url), "utf8");
  for (const token of ["--ink", "--bone", "--oxblood", "--slate", "--warm-gray", "--pass-on-ink", "--fail-on-ink", "--needs-on-ink", "--partial-on-ink"]) {
    assert.match(css, new RegExp(`${token}\\s*:`));
  }
  assert.doesNotMatch(css, /(?:linear|radial)-gradient|glassmorphism|backdrop-filter/i);

  const color = (token) => css.match(new RegExp(`${token}\\s*:\\s*(#[0-9a-f]{6})`, "i"))?.[1];
  const luminance = (hex) => [1, 3, 5]
    .map((index) => Number.parseInt(hex.slice(index, index + 2), 16) / 255)
    .map((channel) => channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4)
    .reduce((sum, channel, index) => sum + channel * [0.2126, 0.7152, 0.0722][index], 0);
  const contrast = (first, second) => {
    const values = [luminance(color(first)), luminance(color(second))];
    return (Math.max(...values) + 0.05) / (Math.min(...values) + 0.05);
  };

  for (const pair of [
    ["--ink", "--bone"],
    ["--slate", "--bone"],
    ["--oxblood", "--bone"],
    ["--pass", "--pass-surface"],
    ["--fail", "--fail-surface"],
    ["--needs", "--needs-surface"],
    ["--neutral", "--neutral-surface"],
    ["--pass-on-ink", "--ink"],
    ["--fail-on-ink", "--ink"],
    ["--needs-on-ink", "--ink"],
    ["--partial-on-ink", "--ink"],
  ]) {
    assert.ok(contrast(...pair) >= 4.5, `${pair.join(" on ")} must meet WCAG AA text contrast`);
  }
});

test("presents the Condition Cut as a causal four-adapter verification machine without fixture leakage", async () => {
  const page = await readFile(new URL("../src/app/page.tsx", import.meta.url), "utf8");

  assert.match(page, /Condition enters unresolved/i);
  assert.match(page, /Four bounded routes/i);
  assert.match(page, /Evidence returns/i);
  assert.match(page, /Policy resolves/i);
  assert.match(page, /data-adapter=\{adapter\.id\}/i);
  for (const [id, label] of [["github", "GitHub"], ["http", "HTTP"], ["base", "EVM"], ["npm", "npm"]]) {
    assert.match(page, new RegExp(`id:\\s*["']${id}["']`, "i"), label);
  }
  assert.match(page, /label:\s*["']EVM["']/i);
  assert.doesNotMatch(page, /label:\s*["']Base["']/i);
  assert.match(page, /INPUT READY/i);
  assert.match(page, /Mandate has a public implementation repository/i);
  assert.match(page, /mandate-closeout\.vercel\.app\/api\/health/i);
  assert.doesNotMatch(page, /Prooflet|Golden judge protocol|CONTROL [AB]|change only[\s\S]*200[\s\S]*to[\s\S]*201/i);
});

test("choreographs claims into proof receipts and a decisive deterministic verdict", async () => {
  const page = await readFile(new URL("../src/app/page.tsx", import.meta.url), "utf8");

  assert.match(page, /className="runRail"/i);
  assert.match(page, /claimMachineRow/i);
  assert.match(page, /data-result=\{claim\.result\}/i);
  assert.match(page, /CONTRADICTION/i);
  assert.match(page, /<details className="evidenceRecord"/i);
  assert.match(page, /Evidence receipt/i);
  assert.match(page, /Extracted facts/i);
  assert.match(page, /Full provenance/i);
  assert.match(page, /HOLD RELEASE/i);
  assert.match(page, /CONDITION RESOLVED/i);
  assert.match(page, /EVIDENCE REQUIRED/i);
  assert.match(page, /PARTIAL VERIFICATION/i);
});

test("exposes complete acceptance coverage without a runtime demo planner label", async () => {
  const page = await readFile(new URL("../src/app/page.tsx", import.meta.url), "utf8");

  assert.match(page, /className="coverageSummary"/i);
  assert.match(page, /ACCEPTANCE-TERM ACCOUNTING/i);
  assert.match(page, /identified.*covered/i);
  assert.match(page, /Term coverage map/i);
  assert.match(page, /data-planner-kind={run\.provenance\.planner\.kind}/i);
  assert.doesNotMatch(page, /bounded demo|DemoPlanner/i);
});

test("treats milestone input, loading, and errors as machine states", async () => {
  const page = await readFile(new URL("../src/app/page.tsx", import.meta.url), "utf8");

  assert.match(page, /promiseComposer/i);
  assert.match(page, /INPUT CHANNEL/i);
  assert.match(page, /INPUT READY/i);
  assert.match(page, /className="loadingMachine"/i);
  assert.match(page, /RUN ACTIVE/i);
  assert.match(page, /NO VERDICT ISSUED/i);
  assert.match(page, /No result was fabricated/i);
});

test("does not overstate adapter or infrastructure readiness before a run", async () => {
  const page = await readFile(new URL("../src/app/page.tsx", import.meta.url), "utf8");

  assert.match(page, /POLICY BOUND/i);
  assert.doesNotMatch(page, /SYSTEM READY/i);
  assert.match(page, /No verdict exists until deterministic policy evaluates/i);
});

test("uses causal one-shot motion with a reduced-motion resolution path", async () => {
  const css = await readFile(new URL("../src/app/styles.css", import.meta.url), "utf8");

  for (const motion of [
    "wire-draw",
    "module-online",
    "evidence-return",
    "claim-row-resolve",
    "contradiction-cut",
    "verdict-orbit-close",
  ]) {
    assert.match(css, new RegExp(`@keyframes\\s+${motion}`), motion);
  }

  assert.match(css, /@media\s*\(prefers-reduced-motion:\s*reduce\)[\s\S]*animation-duration:\s*0\.01ms\s*!important/i);
  assert.match(css, /animation-iteration-count:\s*1\s*!important/i);
  assert.doesNotMatch(css, /particle|glow|(?:linear|radial)-gradient|backdrop-filter/i);
});

test("tightens the editorial section rhythm without collapsing the verification sequence", async () => {
  const css = await readFile(new URL("../src/app/styles.css", import.meta.url), "utf8");

  assert.match(css, /--section-space:\s*clamp\(72px,\s*8\.5vw,\s*108px\)/i);
  assert.match(css, /\.hero\s*\{[\s\S]*?min-height:\s*min\(760px,\s*calc\(100svh\s*-\s*97px\)\)/i);
  assert.match(css, /\.workbench\s*\{[\s\S]*?padding:\s*var\(--section-space\)\s+0/i);
});

test("renders the promise intake and supported routes as one machine surface", async () => {
  const page = await readFile(new URL("../src/app/page.tsx", import.meta.url), "utf8");
  const css = await readFile(new URL("../src/app/styles.css", import.meta.url), "utf8");

  assert.match(page, /className="fieldGroup conditionField intakeModule is-primary"/i);
  assert.match(page, /className="fieldGroup anchorField intakeModule is-secondary"/i);
  assert.match(page, /data-adapter=\{adapter\.id\}/i);
  assert.match(css, /\.intakeModule\s*\{[\s\S]*?border:\s*1px solid var\(--line-strong\)/i);
  assert.match(css, /\.sourceRack\s*>\s*span::after/i);
});

test("keeps technical microcopy legible across the promise intake", async () => {
  const css = await readFile(new URL("../src/app/styles.css", import.meta.url), "utf8");

  assert.match(css, /--microcopy:\s*#4f4a43/i);
  for (const selector of [
    "\\.composerHeader\\s*>\\s*p",
    "\\.verificationForm label small",
    "\\.promiseComposer \\.formFooter\\s*>\\s*p",
  ]) {
    assert.match(css, new RegExp(`${selector}\\s*\\{[\\s\\S]*?color:\\s*var\\(--microcopy\\)`, "i"));
  }
});

test("finishes the page with a restrained Condition Cut footer composition", async () => {
  const page = await readFile(new URL("../src/app/page.tsx", import.meta.url), "utf8");
  const css = await readFile(new URL("../src/app/styles.css", import.meta.url), "utf8");

  assert.match(page, /<footer className="siteFooter">[\s\S]*?Termproof[\s\S]*?Terms, tested\.[\s\S]*?Does not release funds or execute third-party code\./i);
  assert.match(css, /\.siteFooter\s*\{[\s\S]*?position:\s*relative/i);
  assert.match(css, /\.siteFooter::before\s*\{[\s\S]*?background:\s*var\(--oxblood\)/i);
  assert.match(css, /\.siteFooter\s*>\s*div\s*\{[\s\S]*?border-left:\s*1px solid/i);
});

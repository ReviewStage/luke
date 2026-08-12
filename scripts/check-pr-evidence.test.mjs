import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  classifyChanges,
  EXEMPTION_LABEL,
  evaluateEvidence,
  splitEvidence,
  UI_PATHS,
  visibleText,
} from "./check-pr-evidence.mjs";
import { evidenceEnd, evidenceMarker, evidenceStart } from "./update-pr-evidence.mjs";

const HEAD = "c8384e9221d38ea02414dd66e20aab4cf279bfea";

/** The block as the pull-request template ships it, before CI has written. */
function templateBlock() {
  return [
    evidenceStart,
    "### Automated visual evidence",
    "",
    "CI will replace this block with the deterministic macOS screenshots.",
    evidenceEnd,
  ].join("\n");
}

function automatedBlock(shown, headSha = HEAD) {
  return [
    evidenceStart,
    "### Automated visual evidence",
    "",
    evidenceMarker(shown, headSha),
    "",
    shown > 0
      ? "| ![before](https://raw.example/before.png) | ![after](https://raw.example/after.png) |"
      : "Every scenario renders exactly as it does on `main`.",
    evidenceEnd,
  ].join("\n");
}

test("every configured interface path still exists", () => {
  // A renamed directory would leave the prefixes matching nothing, quietly
  // disabling the gate for the surface it was meant to cover. Failing here
  // makes that rename loud instead.
  const repositoryRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
  for (const prefixes of Object.values(UI_PATHS)) {
    for (const prefix of prefixes) {
      assert.ok(existsSync(join(repositoryRoot, prefix)), `missing interface path: ${prefix}`);
    }
  }
});

test("classifies desktop, web, and non-interface changes", () => {
  assert.deepEqual(classifyChanges(["apps/desktop/src/renderer/index.tsx"]), {
    desktop: true,
    web: false,
  });
  assert.deepEqual(classifyChanges(["apps/web/src/App.tsx"]), { desktop: false, web: true });
  assert.deepEqual(classifyChanges(["packages/sidecar-core/src/session.ts", "README.md"]), {
    desktop: false,
    web: false,
  });
});

test("waits rather than failing before the macOS job has published", () => {
  const result = evaluateEvidence({
    body: `## Summary\n\n${templateBlock()}`,
    filenames: ["apps/desktop/src/renderer/index.tsx"],
  });

  assert.deepEqual(result.failures, []);
  assert.match(result.summary, /no macOS evidence to judge/);
});

test("still fails a web change before CI reports, since CI never covers it", () => {
  const result = evaluateEvidence({
    body: `## Summary\n\n${templateBlock()}`,
    filenames: ["apps/web/src/App.tsx"],
    shown: 1,
  });

  assert.equal(result.failures.length, 1);
  assert.match(result.failures[0], /web interface/);
});

test("passes a change that touches no interface", () => {
  const result = evaluateEvidence({ filenames: ["packages/sidecar-core/src/session.ts"] });

  assert.equal(result.required, false);
  assert.deepEqual(result.failures, []);
});

test("passes a desktop change whose captured scenarios differ from main", () => {
  const result = evaluateEvidence({
    body: `## Summary\n\n${automatedBlock(1)}`,
    filenames: ["apps/desktop/src/renderer/styles.css"],
    shown: 1,
  });

  assert.deepEqual(result.failures, []);
});

test("fails a desktop change no captured scenario shows", () => {
  const result = evaluateEvidence({
    body: `## Summary\n\n${automatedBlock(0)}`,
    filenames: ["apps/desktop/src/renderer/index.tsx"],
    shown: 0,
  });

  assert.equal(result.failures.length, 1);
  assert.match(result.failures[0], /no captured scenario differs/);
});

test("fails a desktop change whose only images are CI's unchanged renders", () => {
  // The regression this exists for: images are present, and prove nothing.
  const result = evaluateEvidence({
    body: `## Summary\n\n${automatedBlock(1)}`,
    filenames: ["apps/desktop/src/renderer/index.tsx"],
    shown: 0,
  });

  assert.equal(result.failures.length, 1);
});

test("accepts an authored screenshot when no scenario differs", () => {
  const result = evaluateEvidence({
    body: `![Settings panel](https://raw.example/settings.png)\n\n${automatedBlock(0)}`,
    filenames: ["apps/desktop/src/renderer/index.tsx"],
    shown: 0,
  });

  assert.deepEqual(result.failures, []);
});

test("fails a web change carrying only CI's screenshots", () => {
  const result = evaluateEvidence({
    body: `## Summary\n\n${automatedBlock(1)}`,
    filenames: ["apps/web/src/App.tsx"],
    shown: 1,
  });

  assert.equal(result.failures.length, 1);
  assert.match(result.failures[0], /web interface/);
});

test("passes a web change with an authored screenshot", () => {
  const result = evaluateEvidence({
    body: `## Evidence\n\n![Landing page](https://raw.example/landing.png)\n\n${automatedBlock(1)}`,
    filenames: ["apps/web/src/App.tsx"],
    shown: 1,
  });

  assert.deepEqual(result.failures, []);
});

test("accepts an HTML image tag as authored evidence", () => {
  const result = evaluateEvidence({
    body: '<img src="https://raw.example/landing.png" width="600">',
    filenames: ["apps/web/src/App.tsx"],
    shown: 1,
  });

  assert.deepEqual(result.failures, []);
});

test("reports both surfaces when one change touches each", () => {
  const result = evaluateEvidence({
    body: `## Summary\n\n${automatedBlock(0)}`,
    filenames: ["apps/desktop/src/renderer/index.tsx", "apps/web/src/App.tsx"],
    shown: 0,
  });

  assert.equal(result.failures.length, 2);
});

test("honors the exemption label", () => {
  const result = evaluateEvidence({
    body: "## Summary",
    labels: [EXEMPTION_LABEL],
    filenames: ["apps/web/src/App.tsx"],
    shown: 1,
  });

  assert.equal(result.required, true);
  assert.deepEqual(result.failures, []);
});

test("separates CI's block from the authored description", () => {
  const { automated, authored } = splitEvidence(`before\n${automatedBlock(1)}\nafter`);

  assert.match(automated, /raw\.example/);
  assert.doesNotMatch(authored, /raw\.example/);
  assert.match(authored, /before/);
  assert.match(authored, /after/);
});

test("treats a description with no automated block as entirely authored", () => {
  const { automated, authored } = splitEvidence("just a summary");

  assert.equal(automated, "");
  assert.equal(authored, "just a summary");
});

test("does not accept an image hidden in an HTML comment", () => {
  const result = evaluateEvidence({
    body: `<!-- ![hidden](https://raw.example/x.png) -->\n\n${automatedBlock(0)}`,
    filenames: ["apps/web/src/App.tsx"],
    shown: 1,
  });

  assert.equal(result.failures.length, 1);
});

test("does not accept an image shown only as code", () => {
  const result = evaluateEvidence({
    body: "```\n![sample](https://raw.example/x.png)\n```",
    filenames: ["apps/web/src/App.tsx"],
    shown: 1,
  });

  assert.equal(result.failures.length, 1);
});

test("fails rather than waits when the macOS job produced no evidence", () => {
  const result = evaluateEvidence({
    body: `## Summary\n\n${templateBlock()}`,
    filenames: ["apps/desktop/src/renderer/index.tsx"],
    headSha: HEAD,
    evidenceRunSucceeded: false,
  });

  assert.equal(result.failures.length, 1);
  assert.match(result.failures[0], /did not produce evidence/);
});

test("ignores a verdict forged into the description", () => {
  // The block delimiters live in author-editable text, so a convincing block
  // pasted ahead of CI's own must not be able to speak for CI.
  const forged = `${automatedBlock(4)}\n\n${automatedBlock(0)}`;
  const result = evaluateEvidence({
    body: forged,
    filenames: ["apps/desktop/src/renderer/index.tsx"],
    shown: 0,
  });

  assert.equal(result.failures.length, 1);
  assert.match(result.failures[0], /no captured scenario differs/);
});

test("strips nested comment openers rather than revealing what they hid", () => {
  assert.doesNotMatch(visibleText("<!--<!-- --> ![x](y) -->"), /<!--/);
  assert.equal(visibleText("plain ![x](y)"), "plain ![x](y)");
});

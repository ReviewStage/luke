import assert from "node:assert/strict";
import test from "node:test";
import {
  classifyChanges,
  EXEMPTION_LABEL,
  evaluateEvidence,
  scenariosShown,
  splitEvidence,
} from "./check-pr-evidence.mjs";
import { changedMarker, evidenceEnd, evidenceStart } from "./update-pr-evidence.mjs";

function automatedBlock(shown) {
  return [
    evidenceStart,
    "### Automated visual evidence",
    "",
    `<!-- ${changedMarker}: ${shown} -->`,
    "",
    shown > 0
      ? "| ![before](https://raw.example/before.png) | ![after](https://raw.example/after.png) |"
      : "Every scenario renders exactly as it does on `main`.",
    evidenceEnd,
  ].join("\n");
}

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

test("reads how many scenarios CI reported as differing", () => {
  assert.equal(scenariosShown(automatedBlock(2)), 2);
  assert.equal(scenariosShown(automatedBlock(0)), 0);
  assert.equal(scenariosShown("## Summary"), 0);
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
  });

  assert.deepEqual(result.failures, []);
});

test("fails a desktop change no captured scenario shows", () => {
  const result = evaluateEvidence({
    body: `## Summary\n\n${automatedBlock(0)}`,
    filenames: ["apps/desktop/src/renderer/index.tsx"],
  });

  assert.equal(result.failures.length, 1);
  assert.match(result.failures[0], /no captured scenario differs/);
});

test("fails a desktop change whose only images are CI's unchanged renders", () => {
  // The regression the marker exists for: images are present, and prove nothing.
  const body = `## Summary\n\n${automatedBlock(0)}\n\n![session list](https://raw.example/x.png)`;
  const result = evaluateEvidence({
    body: body.replace("![session list](https://raw.example/x.png)", ""),
    filenames: ["apps/desktop/src/renderer/index.tsx"],
  });

  assert.equal(result.failures.length, 1);
});

test("accepts an authored screenshot when no scenario differs", () => {
  const result = evaluateEvidence({
    body: `![Settings panel](https://raw.example/settings.png)\n\n${automatedBlock(0)}`,
    filenames: ["apps/desktop/src/renderer/index.tsx"],
  });

  assert.deepEqual(result.failures, []);
});

test("fails a web change carrying only CI's screenshots", () => {
  const result = evaluateEvidence({
    body: `## Summary\n\n${automatedBlock(1)}`,
    filenames: ["apps/web/src/App.tsx"],
  });

  assert.equal(result.failures.length, 1);
  assert.match(result.failures[0], /web interface/);
});

test("passes a web change with an authored screenshot", () => {
  const result = evaluateEvidence({
    body: `## Evidence\n\n![Landing page](https://raw.example/landing.png)\n\n${automatedBlock(1)}`,
    filenames: ["apps/web/src/App.tsx"],
  });

  assert.deepEqual(result.failures, []);
});

test("accepts an HTML image tag as authored evidence", () => {
  const result = evaluateEvidence({
    body: '<img src="https://raw.example/landing.png" width="600">',
    filenames: ["apps/web/src/App.tsx"],
  });

  assert.deepEqual(result.failures, []);
});

test("reports both surfaces when one change touches each", () => {
  const result = evaluateEvidence({
    body: `## Summary\n\n${automatedBlock(0)}`,
    filenames: ["apps/desktop/src/renderer/index.tsx", "apps/web/src/App.tsx"],
  });

  assert.equal(result.failures.length, 2);
});

test("honors the exemption label", () => {
  const result = evaluateEvidence({
    body: "## Summary",
    labels: [EXEMPTION_LABEL],
    filenames: ["apps/web/src/App.tsx"],
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

import assert from "node:assert/strict";
import test from "node:test";
import {
  buildEvidenceBlock,
  caption,
  changedMarker,
  compareEvidence,
  countShown,
  EVIDENCE_STATUS,
  evidenceEnd,
  evidenceStart,
  isCurrentPullHead,
  orderEvidenceFiles,
  updateEvidenceBlock,
} from "./update-pr-evidence.mjs";

const base = {
  artifactUrl: "https://github.example/artifact/1",
  runUrl: "https://github.example/run/2",
  headSha: "0123456789abcdef",
};

const changedScenario = {
  name: "app-smoke-settings.png",
  status: EVIDENCE_STATUS.CHANGED,
  beforeUrl: "https://raw.example/before-settings.png",
  afterUrl: "https://raw.example/settings.png",
};

const unchangedScenario = {
  name: "app-smoke-compact.png",
  status: EVIDENCE_STATUS.UNCHANGED,
};

test("reports equal renders as unchanged and different renders as changed", () => {
  const current = Buffer.from([1, 2, 3]);

  assert.equal(compareEvidence(current, Buffer.from([1, 2, 3])), EVIDENCE_STATUS.UNCHANGED);
  assert.equal(compareEvidence(current, Buffer.from([1, 2, 4])), EVIDENCE_STATUS.CHANGED);
  assert.equal(compareEvidence(current, undefined), EVIDENCE_STATUS.NEW);
});

test("counts every scenario that is not unchanged as shown", () => {
  assert.equal(countShown([changedScenario, unchangedScenario]), 1);
  assert.equal(countShown([unchangedScenario]), 0);
  assert.equal(countShown([{ name: "app-smoke-expanded.png", status: EVIDENCE_STATUS.NEW }]), 1);
});

test("renders a changed scenario as a before and after pair", () => {
  const result = buildEvidenceBlock({ ...base, scenarios: [changedScenario, unchangedScenario] });

  assert.match(result, /#### Settings view \(smoke fixture\)/);
  assert.match(result, /\| Before \(`main`\) \| After \|/);
  assert.match(result, /!\[before\]\(https:\/\/raw\.example\/before-settings\.png\)/);
  assert.match(result, /!\[after\]\(https:\/\/raw\.example\/settings\.png\)/);
  assert.match(result, new RegExp(`${changedMarker}: 1`));
});

test("names the scenarios that did not change without embedding them", () => {
  const result = buildEvidenceBlock({ ...base, scenarios: [changedScenario, unchangedScenario] });

  assert.match(result, /Unchanged since `main`: Compact panel \(smoke fixture\)\./);
  assert.doesNotMatch(result, /!\[Compact panel/);
});

test("says plainly when nothing differs from the default branch", () => {
  const result = buildEvidenceBlock({ ...base, scenarios: [unchangedScenario] });

  assert.match(result, /do not show this change/);
  assert.match(result, new RegExp(`${changedMarker}: 0`));
  assert.doesNotMatch(result, /!\[/);
});

test("embeds a scenario with no baseline on its own", () => {
  const result = buildEvidenceBlock({
    ...base,
    scenarios: [
      {
        name: "app-smoke-settings.png",
        status: EVIDENCE_STATUS.NEW,
        afterUrl: "https://raw.example/new.png",
      },
    ],
  });

  assert.match(result, /!\[Settings view \(smoke fixture\)\]\(https:\/\/raw\.example\/new\.png\)/);
  assert.doesNotMatch(result, /Before \(`main`\)/);
  assert.match(result, new RegExp(`${changedMarker}: 1`));
});

test("reports a run that produced no screenshots", () => {
  const result = buildEvidenceBlock({ ...base, scenarios: [] });

  assert.match(result, /produced no screenshots/);
  assert.match(result, new RegExp(`${changedMarker}: 0`));
});

test("captions an unrecognized screenshot with its filename", () => {
  assert.equal(caption("app-smoke-future.png"), "app-smoke-future.png");
  assert.equal(caption("app-smoke-compact.png"), "Compact panel (smoke fixture)");
});

test("orders screenshots by the caption table and unknown names last", () => {
  const ordered = orderEvidenceFiles([
    "app-smoke-speaking.png",
    "zzz-extra.png",
    "app-smoke-expanded.png",
    "app-smoke-settings.png",
    "app-smoke-compact.png",
  ]);

  assert.deepEqual(ordered, [
    "app-smoke-expanded.png",
    "app-smoke-settings.png",
    "app-smoke-compact.png",
    "app-smoke-speaking.png",
    "zzz-extra.png",
  ]);
});

test("appends automated evidence without replacing author content", () => {
  const result = updateEvidenceBlock("## Summary\n\nAuthor notes\n", {
    ...base,
    scenarios: [changedScenario],
  });

  assert.match(result, /Author notes/);
  assert.equal(result.match(new RegExp(evidenceStart, "g"))?.length, 1);
});

test("replaces only the existing automated evidence block", () => {
  const initial = [
    "## Summary",
    "",
    evidenceStart,
    "stale evidence",
    evidenceEnd,
    "",
    "## Human notes",
    "Keep this",
  ].join("\n");
  const result = updateEvidenceBlock(initial, { ...base, scenarios: [changedScenario] });

  assert.doesNotMatch(result, /stale evidence/);
  assert.match(result, /Keep this/);
  assert.equal(result.match(new RegExp(evidenceStart, "g"))?.length, 1);
});

test("updates evidence only for the current pull request head", () => {
  assert.equal(isCurrentPullHead({ head: { sha: "current" } }, "current"), true);
  assert.equal(isCurrentPullHead({ head: { sha: "newer" } }, "stale"), false);
  assert.equal(isCurrentPullHead({}, "missing"), false);
});

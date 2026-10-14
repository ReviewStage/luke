import assert from "node:assert/strict";
import { Schema as EffectSchema, Result } from "effect";
import { test } from "vitest";
import { REPORT_KIND, type Report, reportLine, reportSchema, reportText } from "./rollout-wire.js";

const decode = EffectSchema.decodeUnknownResult(reportSchema);

test("a report's first line names the worker by its position, what happened, and the pull request where it names one", () => {
  const cases: ReadonlyArray<readonly [Report, string]> = [
    [
      { kind: REPORT_KIND.PR_OPENED, position: 3, pullRequest: 415, text: "Open." },
      "[worker 3] opened #415",
    ],
    [
      { kind: REPORT_KIND.CI_GREEN, position: 2, pullRequest: 77, text: "Green." },
      "[worker 2] checks green on #77",
    ],
    [
      { kind: REPORT_KIND.MERGED, position: 1, pullRequest: 9, text: "Squashed." },
      "[worker 1] merged #9",
    ],
    [{ kind: REPORT_KIND.QUESTION, position: 4, text: "Which table?" }, "[worker 4] asks"],
    [{ kind: REPORT_KIND.FAILED, position: 5, text: "failed: sandbox" }, "[worker 5] failed"],
    [
      {
        kind: REPORT_KIND.MERGED,
        github: "acme/widgets",
        pullRequest: 12,
        text: "Merged by hand.",
      },
      "[github] merged #12",
    ],
    [{ kind: REPORT_KIND.RESTACKED, keeper: true, text: "Restacked." }, "[keeper] restacked"],
    [
      { kind: REPORT_KIND.CONFLICT, keeper: true, pullRequest: 415, text: "Both edit start.ts." },
      "[keeper] conflict on #415",
    ],
    [
      { kind: REPORT_KIND.MERGED, keeper: true, pullRequest: 413, text: "Squashed." },
      "[keeper] merged #413",
    ],
  ];
  for (const [report, line] of cases) assert.equal(reportLine(report), line);
});

test("the text a report turn receives is its first line, the reporter's words, and a question's options one to a line", () => {
  assert.equal(
    reportText({
      kind: REPORT_KIND.QUESTION,
      position: 2,
      pullRequest: 416,
      text: "The brief says one table; the code has two.",
      options: ["Fold them", "Keep both"],
    }),
    "[worker 2] asks on #416\n\nThe brief says one table; the code has two.\n\n- Fold them\n- Keep both",
  );
  assert.equal(
    reportText({ kind: REPORT_KIND.RESTACKED, keeper: true, text: "Chain 1-4 onto main." }),
    "[keeper] restacked\n\nChain 1-4 onto main.",
  );
});

test("a report names a position of the rollout, the keeper, or a repository, never none, and words within their bounds", () => {
  assert.ok(
    Result.isSuccess(decode({ kind: "pr_opened", position: 20, pullRequest: 1, text: "Open." })),
  );
  assert.ok(Result.isSuccess(decode({ kind: "merged", github: "acme/widgets", text: "Merged." })));
  assert.ok(Result.isSuccess(decode({ kind: "conflict", keeper: true, text: "Both edit it." })));
  for (const refused of [
    { kind: "pr_opened", text: "Open." },
    { kind: "pr_opened", position: 0, text: "Open." },
    { kind: "pr_opened", position: 21, text: "Open." },
    { kind: "pr_opened", position: 1, pullRequest: 0, text: "Open." },
    { kind: "landed", position: 1, text: "Open." },
    { kind: "question", position: 1, text: "   " },
    { kind: "question", position: 1, text: "Which?", options: [] },
    { kind: "question", position: 1, text: "Which?", options: ["a", "b", "c", "d", "e", "f", "g"] },
    { kind: "merged", github: "not a repository", text: "Merged." },
    { kind: "restacked", keeper: false, text: "Restacked." },
    { kind: "rebased", position: 1, text: "Onto main." },
  ]) {
    assert.ok(Result.isFailure(decode(refused)), JSON.stringify(refused));
  }
});

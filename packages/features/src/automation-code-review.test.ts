import assert from "node:assert/strict";
import { test } from "vitest";
import {
  codeReviewPreset,
  readCodeReviewSettings,
  withCodeReviewSettings,
} from "./automation-code-review.js";

const CODE_REVIEW_PRESET = codeReviewPreset();

/**
 * automation-code-review.test.ts -- the code review's settings as the lines its task opens with: read where the preset wrote them, written back with the rest of the task as it was, a line that no longer reads at its default, and no settings for a task that opens with none.
 */

test("the code review's task opens with its settings, which read back, change in place, and leave the rest of the task as it was", () => {
  const read = readCodeReviewSettings(CODE_REVIEW_PRESET.prompt);
  assert.deepEqual(read, {
    commentWhenClean: true,
    mostFindings: 5,
    rulesFile: "REVIEW.md",
    fix: false,
  });

  const changed = withCodeReviewSettings(CODE_REVIEW_PRESET.prompt, {
    commentWhenClean: false,
    mostFindings: 3,
    rulesFile: ".cursor/BUGBOT.md",
    fix: true,
  });

  assert.deepEqual(readCodeReviewSettings(changed), {
    commentWhenClean: false,
    mostFindings: 3,
    rulesFile: ".cursor/BUGBOT.md",
    fix: true,
  });
  const rest = (prompt: string) => prompt.slice(prompt.indexOf("\n\n"));
  assert.equal(rest(changed), rest(CODE_REVIEW_PRESET.prompt));
});

test("a settings line that no longer reads stands at its default, and a task with no settings has none", () => {
  const edited = CODE_REVIEW_PRESET.prompt
    .replace("Most findings to post: 5", "Most findings to post: lots")
    .replace("Rules file: REVIEW.md", "Rules file:");

  assert.deepEqual(readCodeReviewSettings(edited), {
    commentWhenClean: true,
    mostFindings: 5,
    rulesFile: "REVIEW.md",
    fix: false,
  });
  assert.equal(readCodeReviewSettings("Fix the flakiest test."), undefined);
  assert.equal(
    withCodeReviewSettings("Fix the flakiest test.", {
      commentWhenClean: false,
      mostFindings: 1,
      rulesFile: "x",
      fix: true,
    }),
    "Fix the flakiest test.",
  );
});

import path from "node:path";
import { fileURLToPath } from "node:url";

import { RuleTester } from "oxlint/plugins-dev";
import { describe, it } from "vitest";

import { noFocusedOrSkippedTestRule } from "./no-focused-or-skipped-test.ts";

const REPOSITORY_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "..",
);
const TEST_FILE = path.join(REPOSITORY_ROOT, "packages/service/src/example.test.ts");

RuleTester.describe = describe;
RuleTester.it = it;

const tester = new RuleTester();

tester.run("no-focused-or-skipped-test", noFocusedOrSkippedTestRule, {
  valid: [
    { code: 'it.effect("answers", () => Effect.void);', filename: TEST_FILE },
    { code: 'test.each([1, 2])("takes %d", () => {});', filename: TEST_FILE },
    // A platform's gate is a condition, not a weakening.
    { code: 'describe.skipIf(process.platform !== "darwin")("on a Mac", () => {});', filename: TEST_FILE },
    // A skip that is no test declaration's.
    { code: "context.skip(); reader.skip(4);", filename: TEST_FILE },
  ],
  invalid: [
    { code: 'it.only("answers", () => {});', filename: TEST_FILE, errors: [{ messageId: "weakened" }] },
    {
      code: 'it.effect.skip("answers", () => Effect.void);',
      filename: TEST_FILE,
      errors: [{ messageId: "weakened" }],
    },
    {
      code: 'test.skip.each([1])("takes %d", () => {});',
      filename: TEST_FILE,
      errors: [{ messageId: "weakened" }],
    },
    { code: 'describe.todo("later");', filename: TEST_FILE, errors: [{ messageId: "weakened" }] },
    {
      code: 'it.flakyTest("passes once in three", () => Effect.void);',
      filename: TEST_FILE,
      errors: [{ messageId: "weakened" }],
    },
  ],
});

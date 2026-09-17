import { defineRule } from "@oxlint/plugins";

import { runningMemberName } from "../../anti-slop/rules/no-run-promise-outside-edges.ts";
import { isTestFileOutside, RUNNER_HOLDOUTS } from "../shared/test-edges.ts";

/**
 * A test body is not a runtime edge: `it.effect` runs the Effect a test
 * describes, on a `TestClock` the test advances. `anti-slop/no-run-promise-outside-edges`
 * exempts test files by extension and keeps doing so; this rule is the test
 * half of the same ban, reading the same detector, over the files
 * `runnerHoldouts` in test-edges.json does not hold out.
 */
export const noRunnerRule = defineRule({
  meta: {
    type: "problem",
    docs: {
      description:
        "Disallow Effect.run*, Runtime.makeRunMain, NodeRuntime.runMain, and ManagedRuntime.make in a test file; a suite runs on it.effect.",
    },
    messages: {
      runner:
        "`{{name}}` runs an Effect in a test body. Write the test on `it.effect` from `@effect/vitest`, and drive time with `TestClock.adjust`.",
    },
  },
  createOnce(context) {
    return {
      before() {
        return isTestFileOutside(context.filename, RUNNER_HOLDOUTS);
      },
      CallExpression(node) {
        const name = runningMemberName(node.callee);
        if (name !== null) context.report({ node, messageId: "runner", data: { name } });
      },
    };
  },
});

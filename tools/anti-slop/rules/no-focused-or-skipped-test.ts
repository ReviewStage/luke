import type { ESTree } from "@oxlint/plugins";
import { defineRule } from "@oxlint/plugins";

import { isWatchedTest } from "../shared/test-guard.ts";

/** The names a suite or a case is declared through, vitest's and `@effect/vitest`'s alike. */
const DECLARERS: ReadonlySet<string> = new Set(["it", "test", "describe", "suite", "bench"]);

/**
 * Members that run less than the file declares: one case alone, a case
 * skipped or left to do, or a flaky one retried until it passes. A
 * condition (`skipIf`, `runIf`) is a platform's gate rather than a
 * weakening, and stays allowed.
 */
const WEAKENING_MEMBERS: ReadonlySet<string> = new Set(["only", "skip", "todo", "flakyTest"]);

/** The first weakening member a declarer's chain reaches, `it.effect.skip` and `test.skip.each` alike. */
function weakeningMember(callee: ESTree.Node): ESTree.IdentifierName | undefined {
  let found: ESTree.IdentifierName | undefined;
  let node: ESTree.Node = callee;
  while (node.type === "MemberExpression" && !node.computed) {
    if (node.property.type === "Identifier" && WEAKENING_MEMBERS.has(node.property.name))
      found = node.property;
    node = node.object;
  }
  return node.type === "Identifier" && DECLARERS.has(node.name) ? found : undefined;
}

/**
 * Root AGENTS.md's "Testing": never make a test pass by weakening it. A
 * focused case silences every other one in its file, and a skipped, to-do,
 * or retried one stays green over the regression it was written to catch;
 * a flaky test is fixed or deleted instead.
 */
export const noFocusedOrSkippedTestRule = defineRule({
  meta: {
    type: "problem",
    docs: {
      description: "Disallow .only, .skip, .todo and .flakyTest on a test or a suite.",
    },
    messages: {
      weakened:
        "`.{{member}}` runs less than this file declares. Fix the test or delete it; never weaken one to pass (root AGENTS.md's \"Testing\").",
    },
  },
  createOnce(context) {
    return {
      before() {
        return isWatchedTest(context.filename);
      },
      CallExpression(node) {
        const member = weakeningMember(node.callee);
        if (member === undefined) return;
        context.report({ node: member, messageId: "weakened", data: { member: member.name } });
      },
    };
  },
});

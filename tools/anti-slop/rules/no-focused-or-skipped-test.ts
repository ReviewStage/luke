import type { ESTree } from "@oxlint/plugins";
import { defineRule } from "@oxlint/plugins";

import { isWatchedTest } from "../shared/test-guard.ts";

const DECLARERS: ReadonlySet<string> = new Set(["it", "test", "describe", "suite", "bench"]);

const WEAKENING_MEMBERS: ReadonlySet<string> = new Set(["only", "skip", "todo", "flakyTest"]);

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

export const noFocusedOrSkippedTestRule = defineRule({
  meta: {
    type: "problem",
    docs: {
      description: "Disallow .only, .skip, .todo and .flakyTest on a test or a suite.",
    },
    messages: {
      weakened:
        '`.{{member}}` runs less than this file declares. Fix the test or delete it; never weaken one to pass (root AGENTS.md\'s "Testing").',
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

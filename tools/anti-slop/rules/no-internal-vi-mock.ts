import type { ESTree } from "@oxlint/plugins";
import { defineRule } from "@oxlint/plugins";

import { isWatchedTest, literalText } from "../shared/test-guard.ts";

const MOCKING_MEMBERS: ReadonlySet<string> = new Set(["mock", "doMock"]);

const INTERNAL_MODULE = /^(?:\.{1,2}\/|\/|#|@repo\/)/u;

function mockedModule(argument: ESTree.Node | undefined): string | undefined {
  if (argument === undefined) return undefined;
  if (argument.type === "ImportExpression") return literalText(argument.source);
  return literalText(argument);
}

export const noInternalViMockRule = defineRule({
  meta: {
    type: "problem",
    docs: {
      description:
        "Disallow vi.mock and vi.doMock of a module of this repository in a test; an outside package may still be mocked.",
    },
    messages: {
      internalMock:
        '`vi.{{member}}("{{module}}")` swaps a module of this repository for a copy. Use the real module, a test `Layer` on its service\'s tag, or `vi.spyOn` at the process boundary it crosses (root AGENTS.md\'s "Testing").',
    },
  },
  createOnce(context) {
    return {
      before() {
        return isWatchedTest(context.filename);
      },
      CallExpression(node) {
        const callee = node.callee;
        if (callee.type !== "MemberExpression" || callee.computed) return;
        if (callee.object.type !== "Identifier" || callee.object.name !== "vi") return;
        if (callee.property.type !== "Identifier" || !MOCKING_MEMBERS.has(callee.property.name))
          return;
        const module = mockedModule(node.arguments[0]);
        if (module === undefined || !INTERNAL_MODULE.test(module)) return;
        context.report({
          node,
          messageId: "internalMock",
          data: { member: callee.property.name, module },
        });
      },
    };
  },
});

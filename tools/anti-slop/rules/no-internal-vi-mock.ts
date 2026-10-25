import type { ESTree } from "@oxlint/plugins";
import { defineRule } from "@oxlint/plugins";

import { isWatchedTest, literalText } from "../shared/test-guard.ts";

/** The `vi` members that swap a module for another before the test imports it. */
const MOCKING_MEMBERS: ReadonlySet<string> = new Set(["mock", "doMock"]);

/**
 * A module of this repository: a relative or absolute path, a package
 * `imports` alias (`#main/…`), or a workspace package (`@luke/…`).
 */
const INTERNAL_MODULE = /^(?:\.{1,2}\/|\/|#|@luke\/)/u;

/** The module a mock names: a specifier, or the `import("…")` vitest also takes. */
function mockedModule(argument: ESTree.Node | undefined): string | undefined {
  if (argument === undefined) return undefined;
  if (argument.type === "ImportExpression") return literalText(argument.source);
  return literalText(argument);
}

/**
 * Root AGENTS.md's "Testing": use real code first, then a fake, then a stub,
 * and replace only what crosses a process boundary. A test that swaps a
 * module of this repository for one of its own tests that module's callers
 * against a copy of it, so `vi.mock` names only an outside package
 * (`electron`, a provider's SDK).
 */
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

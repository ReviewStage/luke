import type { ESTree } from "@oxlint/plugins";
import { defineRule } from "@oxlint/plugins";

import { isTestFile } from "../shared/test-edges.ts";

/** The vitest names a focus, a skip, or a retry hangs off. */
const TEST_ROOTS: ReadonlySet<string> = new Set(["it", "test", "describe", "suite", "bench", "vi"]);

const FOCUS_MEMBER = {
  ONLY: "only",
  SKIP: "skip",
  TODO: "todo",
  FLAKY_TEST: "flakyTest",
} as const;

const FOCUS_MEMBERS: ReadonlySet<string> = new Set(Object.values(FOCUS_MEMBER));

const RETRY_OPTION = "retry";

/** `describe.sequential.only` and `it.effect.skip` end in the member; the root names the runner. */
function testRootName(callee: ESTree.Expression | ESTree.Super): string | null {
  let current: ESTree.Expression | ESTree.Super = callee;
  while (current.type === "MemberExpression") current = current.object;
  return current.type === "Identifier" && TEST_ROOTS.has(current.name) ? current.name : null;
}

function focusMemberName(callee: ESTree.Expression | ESTree.Super): string | null {
  if (callee.type !== "MemberExpression" || callee.computed) return null;
  const property = callee.property;
  if (property.type !== "Identifier" || !FOCUS_MEMBERS.has(property.name)) return null;
  return testRootName(callee) === null ? null : property.name;
}

function isRetryProperty(property: ESTree.ObjectExpression["properties"][number]): boolean {
  if (property.type !== "Property" || property.computed) return false;
  const key = property.key;
  return (
    (key.type === "Identifier" && key.name === RETRY_OPTION) ||
    (key.type === "Literal" && key.value === RETRY_OPTION)
  );
}

/**
 * A focused, skipped, or todo test is a suite that is not running, and a
 * retry is a flaky test dressed as a passing one. `it.skipIf(reason)` stays
 * legal: it names the condition a test cannot run under, which a reviewer can
 * read, where `.skip` names nothing.
 */
export const noFocusOrRetryRule = defineRule({
  meta: {
    type: "problem",
    docs: {
      description:
        "Disallow .only, .skip, .todo, it.flakyTest, and a retry option in a test file; it.skipIf(reason) stays legal.",
    },
    messages: {
      focus:
        "`.{{name}}` leaves a test not running. Fix or delete it the same day; a test that cannot run under a condition says so with `it.skipIf(reason)`.",
      retry:
        "A `retry` option is a flaky test dressed as a passing one. Fix the test or delete it; never retry it.",
    },
  },
  createOnce(context) {
    return {
      before() {
        return isTestFile(context.filename);
      },
      CallExpression(node) {
        const name = focusMemberName(node.callee);
        if (name !== null) {
          context.report({ node: node.callee, messageId: "focus", data: { name } });
          return;
        }
        if (testRootName(node.callee) === null) return;
        for (const argument of node.arguments) {
          if (argument.type !== "ObjectExpression") continue;
          for (const property of argument.properties) {
            if (isRetryProperty(property)) context.report({ node: property, messageId: "retry" });
          }
        }
      },
    };
  },
});

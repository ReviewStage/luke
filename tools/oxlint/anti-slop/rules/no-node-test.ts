import type { ESTree } from "@oxlint/plugins";
import { defineRule } from "@oxlint/plugins";

import { repositoryPathOf, TYPESCRIPT_SOURCE } from "../shared/effect-edges.ts";

function isNodeTestLiteral(node: ESTree.Node | undefined): boolean {
  return node !== undefined && node.type === "Literal" && node.value === "node:test";
}

/**
 * Every TypeScript test in the repository runs on vitest; `node:test` is
 * retired. The `.mjs` harness under `test:harness` is the one holdout, and it
 * is exempt by extension alone, never by path.
 */
export const noNodeTestRule = defineRule({
  meta: {
    type: "problem",
    docs: {
      description:
        "Disallow importing node:test from TypeScript; every TypeScript test runs on vitest.",
    },
    messages: {
      nodeTest:
        "Take `test`, `describe`, and the rest from `vitest` rather than `node:test`. An Effect suite takes `it.effect` from `@effect/vitest`.",
    },
  },
  createOnce(context) {
    return {
      before() {
        return TYPESCRIPT_SOURCE.test(repositoryPathOf(context.filename));
      },
      ImportDeclaration(node) {
        if (isNodeTestLiteral(node.source)) context.report({ node, messageId: "nodeTest" });
      },
      ImportExpression(node) {
        if (isNodeTestLiteral(node.source)) context.report({ node, messageId: "nodeTest" });
      },
      CallExpression(node) {
        const callee = node.callee;
        if (callee.type !== "Identifier" || callee.name !== "require") return;
        if (isNodeTestLiteral(node.arguments[0])) context.report({ node, messageId: "nodeTest" });
      },
    };
  },
});

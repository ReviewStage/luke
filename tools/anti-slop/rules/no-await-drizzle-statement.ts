import type { ESTree } from "@oxlint/plugins";
import { defineRule } from "@oxlint/plugins";

/**
 * The `Database` service (`@luke/database/core/query`), read as `db`,
 * builds statements that are Effects of Drizzle's Effect driver, so a
 * statement is yielded, never awaited. Examples of plain Drizzle await it, and this is the
 * line an agent copying one would get wrong. `authDatabase`, Better Auth's
 * own promise-shaped handle, is not this handle and is left alone.
 */
const EFFECT_HANDLE = "db";

/** The identifier a member-and-call chain such as `db.select().from(t)` starts from. */
function chainRoot(expression: ESTree.Expression): ESTree.Expression {
  let link = expression;
  while (true) {
    if (
      link.type === "CallExpression" &&
      link.callee.type !== "Super" &&
      link.callee.type !== "V8IntrinsicExpression"
    ) {
      link = link.callee;
    } else if (link.type === "MemberExpression") {
      link = link.object;
    } else if (link.type === "ChainExpression") {
      link = link.expression;
    } else {
      return link;
    }
  }
}

function isStatementChain(expression: ESTree.Expression): boolean {
  if (expression.type !== "CallExpression" && expression.type !== "MemberExpression") return false;
  const root = chainRoot(expression);
  return root.type === "Identifier" && root.name === EFFECT_HANDLE;
}

/** Ban awaiting a statement built on the Effect handle, which is yielded instead. */
export const noAwaitDrizzleStatementRule = defineRule({
  meta: {
    type: "problem",
    docs: {
      description:
        "Disallow `await` and `.then` on a statement built on `db`; the handle's statements are Effects, so yield one with `yield*`.",
    },
    messages: {
      awaitedStatement:
        "A statement built on `db` is an Effect from Drizzle's Effect driver: `yield*` it inside `Effect.gen`, never `await` it.",
    },
  },
  createOnce(context) {
    return {
      AwaitExpression(node) {
        if (isStatementChain(node.argument))
          context.report({ node, messageId: "awaitedStatement" });
      },
      CallExpression(node) {
        const callee = node.callee;
        if (callee.type !== "MemberExpression" || callee.computed) return;
        if (callee.property.type !== "Identifier" || callee.property.name !== "then") return;
        if (isStatementChain(callee.object))
          context.report({ node, messageId: "awaitedStatement" });
      },
    };
  },
});

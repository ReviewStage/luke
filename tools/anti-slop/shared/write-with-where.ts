import type { ESTree } from "@oxlint/plugins";
import { defineRule } from "@oxlint/plugins";

const DRIZZLE_HANDLES: ReadonlySet<string> = new Set(["db", "authDatabase"]);

function isHandleMethod(callee: ESTree.Expression, method: string): boolean {
  if (callee.type !== "MemberExpression" || callee.computed) return false;
  if (callee.property.type !== "Identifier" || callee.property.name !== method) return false;
  return callee.object.type === "Identifier" && DRIZZLE_HANDLES.has(callee.object.name);
}

function chainHasWhere(call: ESTree.Node): boolean {
  let link: ESTree.Node = call;
  let parent = link.parent;
  while (parent !== null && parent !== undefined) {
    if (parent.type === "MemberExpression" && parent.object === link) {
      if (parent.property.type === "Identifier" && parent.property.name === "where") return true;
    } else if (!(parent.type === "CallExpression" && parent.callee === link)) {
      return false;
    }
    link = parent;
    parent = link.parent;
  }
  return false;
}

export function writeWithWhereRule(method: "delete" | "update") {
  return defineRule({
    meta: {
      type: "problem",
      docs: {
        description: `Enforce that \`${method}\` is used with \`where\`, so a statement cannot reach every row of a table.`,
      },
      messages: {
        missingWhere: `Without \`.where(...)\` you will ${method} all the rows in a table. Use \`db.${method}(...).where(...)\`; a test that means to clear a table is exempt.`,
      },
    },
    createOnce(context) {
      return {
        CallExpression(node) {
          if (node.callee.type === "Super" || node.callee.type === "V8IntrinsicExpression") return;
          if (!isHandleMethod(node.callee, method) || chainHasWhere(node)) return;
          context.report({ node, messageId: "missingWhere" });
        },
      };
    },
  });
}

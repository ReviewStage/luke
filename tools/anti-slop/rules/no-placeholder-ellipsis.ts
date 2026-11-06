import { defineRule, type ESTree } from "@oxlint/plugins";

import { attributeName } from "../shared/jsx.ts";
import { PLACEHOLDER_NAME, TRAILING_ELLIPSIS } from "../shared/placeholder-guard.ts";

function endingsOf(node: ESTree.Node | null | undefined): readonly string[] {
  if (node === null || node === undefined) return [];
  if (node.type === "Literal") return typeof node.value === "string" ? [node.value] : [];
  if (node.type === "JSXExpressionContainer") return endingsOf(node.expression);
  if (node.type === "TemplateLiteral") return [node.quasis.at(-1)?.value.cooked ?? ""];
  if (node.type === "ConditionalExpression") {
    return [...endingsOf(node.consequent), ...endingsOf(node.alternate)];
  }
  if (node.type === "LogicalExpression") return [...endingsOf(node.left), ...endingsOf(node.right)];
  if (node.type === "AssignmentPattern") return endingsOf(node.right);
  return [];
}

function propertyName(property: { computed: boolean; key: ESTree.Node }): string | undefined {
  if (property.computed) return undefined;
  if (property.key.type === "Identifier") return property.key.name;
  return property.key.type === "Literal" && typeof property.key.value === "string"
    ? property.key.value
    : undefined;
}

export const noPlaceholderEllipsisRule = defineRule({
  meta: {
    type: "problem",
    docs: {
      description:
        "Disallow a placeholder ending in an ellipsis; an instruction or a search prompt ends on its last word.",
    },
    messages: {
      trailingEllipsis:
        'The placeholder "{{words}}" ends in an ellipsis. Drop it: a placeholder that asks for something ends on its last word, and only a value\'s shape (`ghp_…`) keeps one.',
    },
  },
  createOnce(context) {
    const check = (node: ESTree.Node, value: ESTree.Node | null | undefined) => {
      for (const words of endingsOf(value)) {
        if (!TRAILING_ELLIPSIS.test(words)) continue;
        context.report({ node, messageId: "trailingEllipsis", data: { words } });
      }
    };
    return {
      JSXAttribute(node) {
        if (attributeName(node) === PLACEHOLDER_NAME) check(node, node.value);
      },
      Property(node) {
        if (propertyName(node) === PLACEHOLDER_NAME) check(node, node.value);
      },
    };
  },
});

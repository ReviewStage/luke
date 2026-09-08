import { defineRule } from "@oxlint/plugins";

import { isGlobalReflectMethodCall } from "../shared/reflect-method.ts";

/** Ban the Reflect calls that bypass typed calls and typed property access. */
export const noReflectRule = defineRule({
  meta: {
    type: "problem",
    docs: {
      description:
        "Disallow Reflect.apply and Reflect.get; call typed functions directly and read typed properties, or parse dynamic input into a domain type.",
    },
    messages: {
      reflectApply:
        "Replace `Reflect.apply` with a typed function call. Model dynamic dispatch behind a named interface.",
      reflectGet:
        "Replace `Reflect.get` with typed property access. Parse dynamic input into a named domain type before reading it.",
    },
  },
  createOnce(context) {
    return {
      CallExpression(node) {
        if (node.callee.type === "Super" || node.callee.type === "V8IntrinsicExpression") return;
        if (isGlobalReflectMethodCall(context.sourceCode, node.callee, "apply")) {
          context.report({ node, messageId: "reflectApply" });
          return;
        }
        if (isGlobalReflectMethodCall(context.sourceCode, node.callee, "get")) {
          context.report({ node, messageId: "reflectGet" });
        }
      },
    };
  },
});

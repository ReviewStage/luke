import type { ESTree, Scope, SourceCode, Variable } from "@oxlint/plugins";
import { defineRule } from "@oxlint/plugins";

function resolveVariable(
  sourceCode: SourceCode,
  identifier: ESTree.IdentifierReference,
): Variable | null {
  let scope: Scope | null = sourceCode.getScope(identifier);
  while (scope !== null) {
    const variable = scope.set.get(identifier.name);
    if (variable !== undefined) return variable;
    scope = scope.upper;
  }
  return null;
}

function isGlobalReflect(sourceCode: SourceCode, expression: ESTree.Expression): boolean {
  if (expression.type !== "Identifier" || expression.name !== "Reflect") return false;
  if (sourceCode.isGlobalReference(expression)) return true;
  const variable = resolveVariable(sourceCode, expression);
  return variable === null || variable.defs.length === 0;
}

function isGlobalReflectMethodCall(
  sourceCode: SourceCode,
  callee: ESTree.Expression,
  methodName: string,
): boolean {
  if (!("property" in callee) || !("object" in callee) || !("computed" in callee)) return false;
  if (!isGlobalReflect(sourceCode, callee.object)) return false;
  const property = callee.property;
  return callee.computed
    ? property.type === "Literal" && property.value === methodName
    : property.type === "Identifier" && property.name === methodName;
}

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
        const callee = node.callee;
        if (callee.type === "Super" || callee.type === "V8IntrinsicExpression") return;
        if (isGlobalReflectMethodCall(context.sourceCode, callee, "apply")) {
          context.report({ node, messageId: "reflectApply" });
          return;
        }
        if (isGlobalReflectMethodCall(context.sourceCode, callee, "get")) {
          context.report({ node, messageId: "reflectGet" });
        }
      },
    };
  },
});

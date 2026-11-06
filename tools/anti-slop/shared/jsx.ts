import type { ESTree } from "@oxlint/plugins";

export function isNode(value: unknown): value is ESTree.Node {
  return typeof value === "object" && value !== null && "type" in value;
}

export function isFunction(node: ESTree.Node): boolean {
  return (
    node.type === "ArrowFunctionExpression" ||
    node.type === "FunctionExpression" ||
    node.type === "FunctionDeclaration"
  );
}

export function calleeName(callee: ESTree.Node): string | undefined {
  if (callee.type === "Identifier") return callee.name;
  if (callee.type !== "MemberExpression" || callee.computed) return undefined;
  return callee.property.type === "Identifier" ? callee.property.name : undefined;
}

function rootOf(name: ESTree.JSXMemberExpression): string {
  return name.object.type === "JSXIdentifier" ? name.object.name : rootOf(name.object);
}

export function intrinsicTagOf(name: ESTree.JSXElementName): string | undefined {
  const lowercase = /^[a-z]/u;
  const tag =
    name.type === "JSXMemberExpression" && lowercase.test(rootOf(name))
      ? name.property.name
      : undefined;
  const plain = name.type === "JSXIdentifier" ? name.name : tag;
  if (plain === undefined || !lowercase.test(plain)) return undefined;
  return plain;
}

export function attributeName(attribute: ESTree.JSXAttribute): string {
  return attribute.name.type === "JSXIdentifier"
    ? attribute.name.name
    : `${attribute.name.namespace.name}:${attribute.name.name.name}`;
}

export function literalValuesOf(
  node: ESTree.Node | null | undefined,
): readonly string[] | undefined {
  if (node === null || node === undefined) return [];
  if (node.type === "Identifier" && node.name === "undefined") return [];
  if (node.type === "Literal") {
    if (node.value === null) return [];
    return typeof node.value === "string" ? [node.value] : undefined;
  }
  if (node.type === "JSXExpressionContainer") return literalValuesOf(node.expression);
  if (node.type === "TemplateLiteral" && node.expressions.length === 0) {
    return node.quasis.map((quasi) => quasi.value.cooked ?? "");
  }
  const branches =
    node.type === "ConditionalExpression"
      ? [node.consequent, node.alternate]
      : node.type === "LogicalExpression"
        ? [node.left, node.right]
        : undefined;
  if (branches === undefined) return undefined;
  const values = branches.map((branch) => literalValuesOf(branch));
  return values.some((value) => value === undefined) ? undefined : values.flatMap((v) => v ?? []);
}

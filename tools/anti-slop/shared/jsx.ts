import type { ESTree } from "@oxlint/plugins";

/**
 * jsx.ts -- what the design system's guards read off a JSX element: the
 * intrinsic tag it renders, an attribute's name, and the literal strings an
 * attribute's value can be.
 */

/** The name a member tag hangs from: `motion` for `motion.button`. */
function rootOf(name: ESTree.JSXMemberExpression): string {
  return name.object.type === "JSXIdentifier" ? name.object.name : rootOf(name.object);
}

/**
 * The tag an intrinsic element renders, or undefined for a component. A
 * lowercase name is an intrinsic, and so is a lowercase member of a
 * lowercase factory such as `motion.button`, which renders the element it
 * names; a member of a capitalized namespace (`Controls.button`) is a
 * component.
 */
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

/**
 * The strings an attribute's value can be, or undefined where some branch of
 * it is no literal, so the rule cannot tell. `undefined` and `null` are no
 * value at all, as an attribute left off is.
 */
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

import type { ESTree } from "@oxlint/plugins";

import { repositoryPathOf } from "./effect-edges.ts";

export const INTERNAL_MOCK_GUARD_RULE = "anti-slop/no-internal-vi-mock";
export const SKIPPED_TEST_GUARD_RULE = "anti-slop/no-focused-or-skipped-test";
export const SOURCE_READ_GUARD_RULE = "anti-slop/no-source-read-in-test";

export const TEST_SOURCE = /\.test\.(?:[cm]?[jt]sx?)$/u;

const GUARD_TREE = "tools/anti-slop/";

export function isWatchedTest(filename: string): boolean {
  const file = repositoryPathOf(filename);
  return TEST_SOURCE.test(file) && !file.startsWith(GUARD_TREE);
}

export function literalText(node: ESTree.Node | null | undefined): string | undefined {
  if (node === null || node === undefined) return undefined;
  if (node.type === "Literal") return typeof node.value === "string" ? node.value : undefined;
  if (node.type === "TemplateLiteral") return node.quasis.map((quasi) => quasi.value.raw).join("");
  return undefined;
}

export function calleeName(callee: ESTree.Node): string | undefined {
  if (callee.type === "Identifier") return callee.name;
  if (
    callee.type === "MemberExpression" &&
    !callee.computed &&
    callee.property.type === "Identifier"
  )
    return callee.property.name;
  return undefined;
}

export function nodesWithin(
  node: ESTree.Node | null | undefined,
  resolve: (name: string) => ESTree.Node | undefined = () => undefined,
): { readonly nodes: readonly ESTree.Node[]; readonly strings: readonly string[] } {
  const nodes: ESTree.Node[] = [];
  const strings: string[] = [];
  const resolved = new Set<string>();
  const visit = (value: unknown): void => {
    if (value === null || typeof value !== "object") return;
    if (Array.isArray(value)) {
      for (const item of value) visit(item);
      return;
    }
    const child = value as ESTree.Node;
    nodes.push(child);
    const text = literalText(child);
    if (text !== undefined) strings.push(text);
    if (text !== undefined && child.type !== "TemplateLiteral") return;
    if (child.type === "Identifier" && !resolved.has(child.name)) {
      resolved.add(child.name);
      visit(resolve(child.name));
      return;
    }
    for (const [key, grandchild] of Object.entries(child)) {
      if (key !== "parent") visit(grandchild);
    }
  };
  visit(node);
  return { nodes, strings };
}

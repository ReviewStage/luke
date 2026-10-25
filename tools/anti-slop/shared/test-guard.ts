import type { ESTree } from "@oxlint/plugins";

import { repositoryPathOf } from "./effect-edges.ts";

/**
 * The testing policy's guards: root AGENTS.md's "Testing" section states
 * each rule in prose and tags it with the rule that holds it; this holds the
 * rules' ids and what they share, read by the rules and by the suppression
 * check beside them.
 */
export const INTERNAL_MOCK_GUARD_RULE = "anti-slop/no-internal-vi-mock";
export const SKIPPED_TEST_GUARD_RULE = "anti-slop/no-focused-or-skipped-test";
export const SOURCE_READ_GUARD_RULE = "anti-slop/no-source-read-in-test";

/** A test file, in any language vitest runs: the files the policy's rules watch. */
export const TEST_SOURCE = /\.test\.(?:[cm]?[jt]sx?)$/u;

/** The guards' own tests spell what they refuse as fixtures, and oxlint ignores their tree anyway. */
const GUARD_TREE = "tools/anti-slop/";

export function isWatchedTest(filename: string): boolean {
  const file = repositoryPathOf(filename);
  return TEST_SOURCE.test(file) && !file.startsWith(GUARD_TREE);
}

/** A string literal's value, or a template's text with its holes taken out. */
export function literalText(node: ESTree.Node | null | undefined): string | undefined {
  if (node === null || node === undefined) return undefined;
  if (node.type === "Literal") return typeof node.value === "string" ? node.value : undefined;
  if (node.type === "TemplateLiteral") return node.quasis.map((quasi) => quasi.value.raw).join("");
  return undefined;
}

/** The name a call is made through: `name(…)`, or `object.name(…)` however deep. */
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

/**
 * Every node a subtree holds, and every string it spells as literals and as
 * templates' text, in order, reading through each name `resolve` answers a
 * value for, so a path held in a constant counts where it is used.
 */
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
    // Note that a template's holes are read on, since the place a path starts from is often one.
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

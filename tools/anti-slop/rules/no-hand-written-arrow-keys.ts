import type { ESTree } from "@oxlint/plugins";
import { defineRule } from "@oxlint/plugins";

import {
  ARROW_KEY_BASELINE,
  ARROW_KEYS,
  isExempt,
  isTestFile,
  isUiFile,
  KEY_PROPERTIES,
  SHORTCUT_ARROW_NAMES,
  SHORTCUT_KEY_REGISTRY,
} from "../shared/arrow-key-guard.ts";
import { baselineProblems } from "../shared/baseline.ts";
import { repositoryPathOf, TYPESCRIPT_SOURCE } from "../shared/effect-edges.ts";

function readsKey(node: ESTree.Node): boolean {
  if (node.type === "ChainExpression") return readsKey(node.expression);
  if (node.type === "Identifier") return KEY_PROPERTIES.has(node.name);
  if (node.type !== "MemberExpression" || node.computed) return false;
  return node.property.type === "Identifier" && KEY_PROPERTIES.has(node.property.name);
}

function shortcutArrowOf(node: ESTree.Node): string | undefined {
  if (node.type !== "MemberExpression" || node.computed) return undefined;
  if (node.property.type !== "Identifier" || !KEY_PROPERTIES.has(node.property.name)) {
    return undefined;
  }
  const entry = node.object;
  if (entry.type !== "MemberExpression" || entry.computed) return undefined;
  if (entry.property.type !== "Identifier" || !SHORTCUT_ARROW_NAMES.has(entry.property.name)) {
    return undefined;
  }
  const registry = entry.object;
  return registry.type === "Identifier" && registry.name === SHORTCUT_KEY_REGISTRY
    ? entry.property.name
    : undefined;
}

function arrowKeyOf(node: ESTree.Node | null | undefined): string | undefined {
  if (node !== null && node !== undefined) {
    const named = shortcutArrowOf(node);
    if (named !== undefined) return named;
  }
  if (node?.type === "Literal" && typeof node.value === "string" && ARROW_KEYS.has(node.value)) {
    return node.value;
  }
  return undefined;
}

const COMPARISONS: ReadonlySet<string> = new Set(["===", "!==", "==", "!="]);

export const noHandWrittenArrowKeysRule = defineRule({
  meta: {
    type: "problem",
    docs: {
      description:
        "Disallow stepping a list with hand-matched arrow keys outside @repo/ui; use useRovingKeys and List.",
    },
    messages: {
      arrowKey:
        "`{{key}}` is matched by hand. Step a list or menu with `useRovingKeys` or `List` from `@repo/ui` (`rovingStep` where the focus stays in a field). A file that needs the raw key for a caret, a date or a pty is named in `tools/anti-slop/arrow-keys.json` with its reason; otherwise this file's arrow keys are more than its baseline holds.",
      staleBaseline:
        "This file matches {{found}} arrow key(s) by hand, fewer than `tools/anti-slop/arrow-keys.json` allows ({{expected}}). Lower its count to {{found}}, or delete the row at 0.",
    },
  },
  createOnce(context) {
    let file = "";
    let matches: { node: ESTree.Node; key: string }[] = [];
    let expected = 0;

    return {
      before() {
        file = repositoryPathOf(context.filename);
        if (!TYPESCRIPT_SOURCE.test(file) || isUiFile(file) || isTestFile(file)) return false;
        if (isExempt(file)) return false;
        matches = [];
        expected = ARROW_KEY_BASELINE[file] ?? 0;
        return true;
      },
      BinaryExpression(node) {
        if (!COMPARISONS.has(node.operator)) return;
        const key = readsKey(node.left) ? arrowKeyOf(node.right) : undefined;
        const flipped = readsKey(node.right) ? arrowKeyOf(node.left) : undefined;
        const found = key ?? flipped;
        if (found !== undefined) matches.push({ node, key: found });
      },
      SwitchStatement(node) {
        if (!readsKey(node.discriminant)) return;
        for (const switchCase of node.cases) {
          const key = arrowKeyOf(switchCase.test);
          if (key !== undefined) matches.push({ node: switchCase, key });
        }
      },
      ArrayExpression(node) {
        const [first, second] = node.elements;
        if (node.elements.length !== 2 || first === null || second === null) return;
        if (first === undefined || second === undefined) return;
        if (second.type === "Literal" && typeof second.value === "string") return;
        if (second.type === "TemplateLiteral") return;
        const key = arrowKeyOf(first);
        if (key !== undefined) matches.push({ node, key });
      },
      "Program:exit"(program) {
        const counts = new Map([[file, matches.length]]);
        const baseline = expected === 0 ? {} : { [file]: expected };
        for (const problem of baselineProblems(counts, baseline, true)) {
          if (problem.grew) {
            for (const { node, key } of matches.slice(expected)) {
              context.report({ node, messageId: "arrowKey", data: { key } });
            }
          } else {
            context.report({
              node: program,
              messageId: "staleBaseline",
              data: { found: String(matches.length), expected: String(expected) },
            });
          }
        }
      },
    };
  },
});

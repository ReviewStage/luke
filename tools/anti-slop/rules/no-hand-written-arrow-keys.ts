import type { ESTree } from "@oxlint/plugins";
import { defineRule } from "@oxlint/plugins";

import {
  ARROW_KEY_BASELINE,
  ARROW_KEYS,
  isExempt,
  isTestFile,
  isUiFile,
  KEY_PROPERTIES,
} from "../shared/arrow-key-guard.ts";
import { baselineProblems } from "../shared/baseline.ts";
import { repositoryPathOf, TYPESCRIPT_SOURCE } from "../shared/effect-edges.ts";

/**
 * A list or menu is stepped by `useRovingKeys` and `List` (`@luke/ui`), never
 * a handler that matches `ArrowUp`, `ArrowDown`, `ArrowLeft`, `ArrowRight`,
 * `Home` or `End` itself. Outside `@luke/ui` a key read off an event
 * (`event.key`, `event.code`, or a `key` bound from one) that is compared to
 * one of them, switched on, or listed as a key-to-step row is refused. The
 * files that need the raw keys for a purpose of their own are exempt by name
 * in `arrow-keys.json`, each with a reason; the files that still step a list
 * by hand sit on that file's baseline, which only shrinks.
 */

/** Whether `node` reads a key's name: `event.key`, `e.code`, `event?.key`, or a bare `key` or `code`. */
function readsKey(node: ESTree.Node): boolean {
  if (node.type === "ChainExpression") return readsKey(node.expression);
  if (node.type === "Identifier") return KEY_PROPERTIES.has(node.name);
  if (node.type !== "MemberExpression" || node.computed) return false;
  return node.property.type === "Identifier" && KEY_PROPERTIES.has(node.property.name);
}

/** The arrow key a node spells as a string, where it does. */
function arrowKeyOf(node: ESTree.Node | null | undefined): string | undefined {
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
        "Disallow stepping a list with hand-matched arrow keys outside @luke/ui; use useRovingKeys and List.",
    },
    messages: {
      arrowKey:
        "`{{key}}` is matched by hand. Step a list or menu with `useRovingKeys` or `List` from `@luke/ui` (`rovingStep` where the focus stays in a field). A file that needs the raw key for a caret, a date or a pty is named in `tools/anti-slop/arrow-keys.json` with its reason; otherwise this file's arrow keys are more than its baseline holds.",
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
        // A `["ArrowDown", 1]` row: the key-to-step table a handler looks `event.key` up in.
        const [first, second] = node.elements;
        if (node.elements.length !== 2 || first === null || second === null) return;
        const key = arrowKeyOf(first);
        if (key !== undefined) matches.push({ node, key });
      },
      "Program:exit"(program) {
        const counts = new Map([[file, matches.length]]);
        const baseline = expected === 0 ? {} : { [file]: expected };
        for (const problem of baselineProblems(counts, baseline, true)) {
          if (problem.grew) {
            // Note that the places past the baseline's count are the ones reported, since the ones before it were already there.
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

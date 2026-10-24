import type { ESTree } from "@oxlint/plugins";
import { defineRule } from "@oxlint/plugins";

import { baselineProblems } from "../shared/baseline.ts";
import { repositoryPathOf, TYPESCRIPT_SOURCE } from "../shared/effect-edges.ts";
import {
  isTestFile,
  isUiFile,
  PRESS_EVENTS,
  PRESS_LISTENER_BASELINE,
  WINDOW_GLOBALS,
  WINDOW_OF_ELEMENT,
} from "../shared/press-listener-guard.ts";

/**
 * A popover, menu or card closes on a press outside it through the layer it
 * hangs from (`AnchoredPopover`, `RectFloat`: `onPressAway`, which
 * `usePressAway` hears once for the whole window), never a listener of its
 * own. A `pointerdown`, `mousedown`, `touchstart` or `click` listener on the
 * document or the window is refused outside `@luke/ui`, from a baseline of
 * the files that still hold one (`press-listener-baseline.json`), which only
 * shrinks.
 */

/** Whether `node` is the whole window's event target: `document`, `window`, `globalThis`, or an element's `ownerDocument`. */
function hearsWholeWindow(node: ESTree.Node): boolean {
  if (node.type === "Identifier") return WINDOW_GLOBALS.has(node.name);
  if (node.type !== "MemberExpression" || node.computed) return false;
  if (node.property.type !== "Identifier") return false;
  if (WINDOW_OF_ELEMENT.has(node.property.name)) return true;
  // Note that `window.document` and `globalThis.window` are the same target, spelled longer.
  return node.object.type === "Identifier" && WINDOW_GLOBALS.has(node.object.name)
    ? WINDOW_GLOBALS.has(node.property.name)
    : false;
}

/** The event a listener hears, where it is spelled out: a string, or a template with nothing in it. */
function eventNamed(node: ESTree.Node | undefined): string | undefined {
  if (node?.type === "Literal" && typeof node.value === "string") return node.value;
  if (node?.type === "TemplateLiteral" && node.expressions.length === 0) {
    return node.quasis[0]?.value.cooked ?? undefined;
  }
  return undefined;
}

export const noDocumentPressListenerRule = defineRule({
  meta: {
    type: "problem",
    docs: {
      description:
        "Disallow a press listener on the document or window outside @luke/ui, from a baseline that only shrinks.",
    },
    messages: {
      newListener:
        "Close a popover, menu or card on a press outside it with `onPressAway` on its `AnchoredPopover` or `RectFloat`, or `usePressAway` from `@luke/ui`, not a `{{event}}` listener on the {{target}}. This file's press listeners are more than the baseline holds.",
      staleBaseline:
        "This file holds {{found}} press listener(s) on the document or window, fewer than `tools/anti-slop/press-listener-baseline.json` allows ({{expected}}). Lower its count to {{found}}, or delete the row at 0.",
    },
  },
  createOnce(context) {
    let file = "";
    let listeners: { node: ESTree.Node; event: string; target: string }[] = [];
    let expected = 0;

    return {
      before() {
        file = repositoryPathOf(context.filename);
        if (!TYPESCRIPT_SOURCE.test(file) || isUiFile(file) || isTestFile(file)) return false;
        listeners = [];
        expected = PRESS_LISTENER_BASELINE[file] ?? 0;
        return true;
      },
      CallExpression(node) {
        const callee = node.callee;
        if (callee.type !== "MemberExpression" || callee.computed) return;
        if (callee.property.type !== "Identifier" || callee.property.name !== "addEventListener") {
          return;
        }
        if (!hearsWholeWindow(callee.object)) return;
        const event = eventNamed(node.arguments[0]);
        if (event === undefined || !PRESS_EVENTS.has(event)) return;
        const target = callee.object.type === "Identifier" ? callee.object.name : "document";
        listeners.push({ node, event, target });
      },
      "Program:exit"(program) {
        const counts = new Map([[file, listeners.length]]);
        const baseline = expected === 0 ? {} : { [file]: expected };
        for (const problem of baselineProblems(counts, baseline, true)) {
          if (problem.grew) {
            // Note that the listeners past the baseline's count are the ones reported, since the ones before it were already there.
            for (const { node, event, target } of listeners.slice(expected)) {
              context.report({ node, messageId: "newListener", data: { event, target } });
            }
          } else {
            context.report({
              node: program,
              messageId: "staleBaseline",
              data: { found: String(listeners.length), expected: String(expected) },
            });
          }
        }
      },
    };
  },
});

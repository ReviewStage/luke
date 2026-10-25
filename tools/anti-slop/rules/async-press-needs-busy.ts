import type { ESTree } from "@oxlint/plugins";
import { defineRule } from "@oxlint/plugins";

import { baselineProblems } from "../shared/baseline.ts";
import {
  ACT_CALLS,
  BUSY_BASELINE,
  BUSY_BUTTONS,
  BUSY_PROP,
  HANDLER_HOOKS,
  isTestFile,
  isUiModule,
  PRESS_PROPS,
  PROMISE_CHAIN,
} from "../shared/busy-guard.ts";
import { repositoryPathOf } from "../shared/effect-edges.ts";
import { attributeName, calleeName, isFunction, isNode } from "../shared/jsx.ts";
import { JSX_SOURCE } from "../shared/press-guard.ts";

/** How many names a handler is followed through before the rule gives up on it. */
const FOLLOW_DEPTH = 4;

type Node = ESTree.Node;

/**
 * The rule: a `@luke/ui` button whose press is async, or hands back a
 * promise (`pressAct`, `useAct().press`, an awaited act, a `.then`), passes
 * `busy`, so a slow answer is seen working in the one busy shape every kind of
 * button takes. A handler is read where it is written, or by the name it is
 * held under in the same file; a press the rule cannot read (a prop, a
 * member) is no place. A spread may carry `busy`, so it is allowed. Files
 * that still hold such a button stand in `busy-baseline.json`, which only shrinks.
 */
export const asyncPressNeedsBusyRule = defineRule({
  meta: {
    type: "problem",
    docs: {
      description:
        "Disallow a @luke/ui button with an async press and no `busy`, from a baseline that only shrinks.",
    },
    messages: {
      noBusy:
        "`<{{tag}}>`'s press is async and the button passes no `busy`. Pass `busy` and `busyLabel` (`useBusyPress` holds them) so a slow answer shows it is working.",
      staleBaseline:
        "This file holds {{found}} such button(s), {{says}} (tools/anti-slop/busy-baseline.json; delete the row at 0).",
    },
  },
  createOnce(context) {
    let file = "";
    let kinds = new Map<string, string>();
    let held = new Map<string, Node | null>();
    let buttons: ESTree.JSXOpeningElement[] = [];

    function hold(name: string, value: Node): void {
      // Note that a name declared twice is no one function, so it is left unread.
      held.set(name, held.has(name) ? null : value);
    }

    /**
     * Whether `node`, a handler's body, awaits something, starts an act,
     * chains a promise, or calls a function of this file that does, outside
     * any function it only defines: what a press does that takes time. Note
     * that a `void`ed act counts, since it is the unawaited promise a person
     * is left waiting on.
     */
    function startsWait(node: Node, depth: number): boolean {
      if (node.type === "AwaitExpression") return true;
      if (node.type === "CallExpression") {
        const name = calleeName(node.callee);
        if (name !== undefined && (ACT_CALLS.has(name) || PROMISE_CHAIN.has(name))) return true;
        if (node.callee.type === "Identifier" && isAsync(node.callee, depth)) return true;
      }
      for (const [key, child] of Object.entries(node)) {
        if (key === "parent") continue;
        const children = Array.isArray(child) ? child : [child];
        for (const each of children) {
          if (isNode(each) && !isFunction(each) && startsWait(each, depth)) return true;
        }
      }
      return false;
    }

    /** Whether the press `node` names or writes is async, following a name held in this file. */
    function isAsync(node: Node | null | undefined, depth: number): boolean {
      if (node === null || node === undefined) return false;
      switch (node.type) {
        case "JSXExpressionContainer":
          return isAsync(node.expression, depth);
        case "ArrowFunctionExpression":
        case "FunctionExpression":
        case "FunctionDeclaration":
          return node.async || (node.body !== null && startsWait(node.body, depth));
        case "ConditionalExpression":
          return isAsync(node.consequent, depth) || isAsync(node.alternate, depth);
        case "LogicalExpression":
          return isAsync(node.left, depth) || isAsync(node.right, depth);
        case "Identifier":
          return depth < FOLLOW_DEPTH && isAsync(held.get(node.name), depth + 1);
        case "CallExpression": {
          // A handler hook hands back the function it was given.
          const name = calleeName(node.callee);
          return name !== undefined && HANDLER_HOOKS.has(name) && isAsync(node.arguments[0], depth);
        }
        default:
          return false;
      }
    }

    function hasBusy(element: ESTree.JSXOpeningElement): boolean {
      // Note that a spread may carry `busy`, and is invisible here, so it counts as passing it.
      return element.attributes.some(
        (attribute) =>
          attribute.type === "JSXSpreadAttribute" || attributeName(attribute) === BUSY_PROP,
      );
    }

    function pressesAsync(element: ESTree.JSXOpeningElement): boolean {
      return element.attributes.some(
        (attribute) =>
          attribute.type === "JSXAttribute" &&
          PRESS_PROPS.has(attributeName(attribute)) &&
          isAsync(attribute.value, 0),
      );
    }

    return {
      before() {
        file = repositoryPathOf(context.filename);
        if (!JSX_SOURCE.test(file) || isTestFile(file)) return false;
        kinds = new Map();
        held = new Map();
        buttons = [];
        return true;
      },
      ImportDeclaration(node) {
        if (!isUiModule(String(node.source.value), file)) return;
        for (const binding of node.specifiers) {
          if (binding.type !== "ImportSpecifier") continue;
          const imported =
            binding.imported.type === "Identifier"
              ? binding.imported.name
              : String(binding.imported.value);
          if (BUSY_BUTTONS.has(imported)) kinds.set(binding.local.name, imported);
        }
      },
      VariableDeclarator(node) {
        if (node.id.type === "Identifier" && node.init) hold(node.id.name, node.init);
      },
      FunctionDeclaration(node) {
        if (node.id) hold(node.id.name, node);
      },
      JSXOpeningElement(node) {
        if (node.name.type === "JSXIdentifier" && kinds.has(node.name.name)) buttons.push(node);
      },
      "Program:exit"(program) {
        const found = buttons.filter((button) => !hasBusy(button) && pressesAsync(button));
        const allowed = BUSY_BASELINE[file];
        const baseline = allowed === undefined ? {} : { [file]: allowed };
        for (const problem of baselineProblems(new Map([[file, found.length]]), baseline, true)) {
          if (!problem.grew) {
            context.report({
              node: program,
              messageId: "staleBaseline",
              data: { found: String(found.length), says: problem.says },
            });
            continue;
          }
          // Note that the buttons past the baseline's count are the ones reported, since the ones before it were already there.
          for (const button of found.slice(allowed ?? 0)) {
            const tag = button.name.type === "JSXIdentifier" ? button.name.name : "Button";
            context.report({ node: button.name, messageId: "noBusy", data: { tag } });
          }
        }
      },
    };
  },
});

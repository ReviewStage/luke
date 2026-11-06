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

const FOLLOW_DEPTH = 4;

type Node = ESTree.Node;

export const asyncPressNeedsBusyRule = defineRule({
  meta: {
    type: "problem",
    docs: {
      description:
        "Disallow a @repo/ui button with an async press and no `busy`, from a baseline that only shrinks.",
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
      held.set(name, held.has(name) ? null : value);
    }

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
          const name = calleeName(node.callee);
          return name !== undefined && HANDLER_HOOKS.has(name) && isAsync(node.arguments[0], depth);
        }
        default:
          return false;
      }
    }

    function hasBusy(element: ESTree.JSXOpeningElement): boolean {
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
          for (const button of found.slice(allowed ?? 0)) {
            const tag = button.name.type === "JSXIdentifier" ? button.name.name : "Button";
            context.report({ node: button.name, messageId: "noBusy", data: { tag } });
          }
        }
      },
    };
  },
});

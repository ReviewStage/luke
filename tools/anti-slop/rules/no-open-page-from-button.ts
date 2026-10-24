import type { ESTree } from "@oxlint/plugins";
import { defineRule } from "@oxlint/plugins";

import { HANDLER_HOOKS, isTestFile, isUiModule, PRESS_PROPS } from "../shared/busy-guard.ts";
import { repositoryPathOf } from "../shared/effect-edges.ts";
import { attributeName, calleeName, isFunction, isNode } from "../shared/jsx.ts";
import { BUTTON_COMPONENTS, OPEN_PAGE_CALLS, WINDOW_GLOBALS } from "../shared/open-page-guard.ts";
import { isOutsideUi, JSX_SOURCE } from "../shared/press-guard.ts";

/** How many names a handler is followed through before the rule gives up on it. */
const FOLLOW_DEPTH = 4;

type Node = ESTree.Node;

/** Whether `callee` is the browser's `window.open`. */
function isWindowOpen(callee: Node): boolean {
  return (
    callee.type === "MemberExpression" &&
    !callee.computed &&
    callee.object.type === "Identifier" &&
    WINDOW_GLOBALS.has(callee.object.name) &&
    callee.property.type === "Identifier" &&
    callee.property.name === "open"
  );
}

/**
 * The rule: outside `@luke/ui`, a button's press never opens a page. A page
 * to open is a link, `ButtonLink`, `TextLink` or `Chip`'s `href`, so a
 * right-click, ⌘-click and a reader's link list find it. A handler is read
 * where it is written, or by the name it is held under in the same file, and
 * a press the rule cannot read (a prop, a member) is no place. The rule
 * started clean, so it takes no baseline.
 */
export const noOpenPageFromButtonRule = defineRule({
  meta: {
    type: "problem",
    docs: {
      description: "Disallow opening a page from a @luke/ui button's press outside @luke/ui.",
    },
    messages: {
      opensPage:
        "`<{{tag}}>`'s press opens a page. Draw a link instead: `ButtonLink` or `TextLink`, or `Chip`'s `href`, with `linkPressOf` to open it through the window.",
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
     * Whether `node`, a handler's body, calls something that opens a page, or
     * a function of this file that does, outside any function it only
     * defines: what the press does itself.
     */
    function opensPage(node: Node, depth: number): boolean {
      if (node.type === "CallExpression") {
        const name = calleeName(node.callee);
        if (isWindowOpen(node.callee)) return true;
        if (name !== undefined && OPEN_PAGE_CALLS.has(name)) return true;
        if (node.callee.type === "Identifier" && pressOpens(node.callee, depth)) return true;
      }
      for (const [key, child] of Object.entries(node)) {
        if (key === "parent") continue;
        const children = Array.isArray(child) ? child : [child];
        for (const each of children) {
          if (isNode(each) && !isFunction(each) && opensPage(each, depth)) return true;
        }
      }
      return false;
    }

    /** Whether the press `node` names or writes opens a page, following a name held in this file. */
    function pressOpens(node: Node | null | undefined, depth: number): boolean {
      if (node === null || node === undefined) return false;
      switch (node.type) {
        case "JSXExpressionContainer":
          return pressOpens(node.expression, depth);
        case "ArrowFunctionExpression":
        case "FunctionExpression":
        case "FunctionDeclaration":
          return node.body !== null && opensPage(node.body, depth);
        case "ConditionalExpression":
          return pressOpens(node.consequent, depth) || pressOpens(node.alternate, depth);
        case "LogicalExpression":
          return pressOpens(node.left, depth) || pressOpens(node.right, depth);
        case "Identifier":
          return depth < FOLLOW_DEPTH && pressOpens(held.get(node.name), depth + 1);
        case "CallExpression": {
          // A handler hook hands back the function it was given.
          const name = calleeName(node.callee);
          return (
            name !== undefined && HANDLER_HOOKS.has(name) && pressOpens(node.arguments[0], depth)
          );
        }
        default:
          return false;
      }
    }

    function pressesOpen(element: ESTree.JSXOpeningElement): boolean {
      return element.attributes.some(
        (attribute) =>
          attribute.type === "JSXAttribute" &&
          PRESS_PROPS.has(attributeName(attribute)) &&
          pressOpens(attribute.value, 0),
      );
    }

    return {
      before() {
        file = repositoryPathOf(context.filename);
        if (!JSX_SOURCE.test(file) || isTestFile(file) || !isOutsideUi(file)) return false;
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
          if (BUTTON_COMPONENTS.has(imported)) kinds.set(binding.local.name, imported);
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
      "Program:exit"() {
        for (const button of buttons.filter((each) => pressesOpen(each))) {
          const tag = button.name.type === "JSXIdentifier" ? button.name.name : "Button";
          context.report({ node: button.name, messageId: "opensPage", data: { tag } });
        }
      },
    };
  },
});

import type { ESTree } from "@oxlint/plugins";
import { defineRule } from "@oxlint/plugins";

import {
  ANCHOR_ELEMENT,
  FOCUS_ATTRIBUTES,
  HIDDEN_INPUT,
  isOutsideUi,
  KEY_EVENTS,
  LINK_ROLE,
  PRESS_EVENTS,
  PRESSABLE_ROLES,
  RAW_CONTROL_ELEMENTS,
} from "../shared/press-guard.ts";

/**
 * The tag an intrinsic element renders, or undefined for a component. A
 * lowercase name is an intrinsic, and so is a lowercase member such as
 * `motion.button`, which renders the element it names.
 */
function intrinsicTagOf(name: ESTree.JSXElementName): string | undefined {
  const tag = name.type === "JSXMemberExpression" ? name.property.name : undefined;
  const plain = name.type === "JSXIdentifier" ? name.name : tag;
  if (plain === undefined || !/^[a-z]/u.test(plain)) return undefined;
  return plain;
}

function attributeName(attribute: ESTree.JSXAttribute): string {
  return attribute.name.type === "JSXIdentifier"
    ? attribute.name.name
    : `${attribute.name.namespace.name}:${attribute.name.name.name}`;
}

/** Every string an attribute's value can be, as far as its literals say. */
function literalValuesOf(node: ESTree.Node | null | undefined): readonly string[] {
  if (node === null || node === undefined) return [];
  if (node.type === "Literal") return typeof node.value === "string" ? [node.value] : [];
  if (node.type === "JSXExpressionContainer") return literalValuesOf(node.expression);
  if (node.type === "TemplateLiteral" && node.expressions.length === 0) {
    return node.quasis.map((quasi) => quasi.value.cooked ?? "");
  }
  if (node.type === "ConditionalExpression") {
    return [...literalValuesOf(node.consequent), ...literalValuesOf(node.alternate)];
  }
  if (node.type === "LogicalExpression") {
    return [...literalValuesOf(node.left), ...literalValuesOf(node.right)];
  }
  return [];
}

/** Note that a hidden input's type must be a plain literal, never one that may vary. */
function isHiddenInput(tag: string, attributes: readonly ESTree.JSXAttribute[]): boolean {
  if (tag !== HIDDEN_INPUT.ELEMENT) return false;
  const type = attributes.find((attribute) => attributeName(attribute) === "type");
  const values = type === undefined ? [] : literalValuesOf(type.value);
  return values.length > 0 && values.every((value) => value === HIDDEN_INPUT.TYPE);
}

/** Note that `contentEditable={false}` takes no focus, so it is not counted. */
function takesFocus(attribute: ESTree.JSXAttribute): boolean {
  const value = attribute.value;
  if (value === null || value.type !== "JSXExpressionContainer") return true;
  const expression = value.expression;
  return !(expression.type === "Literal" && expression.value === false);
}

/**
 * Outside `@luke/ui`, an intrinsic JSX element is drawn and never pressed:
 * no raw control, no pressable role, no press event, and no key event on an
 * element that takes the focus itself. A ui component or variant is where a
 * press lives. A spread is invisible here and allowed, which is how a ui
 * helper such as `menu.contextMenu()` hands its handlers on.
 */
export const noRawPressOutsideUiRule = defineRule({
  meta: {
    type: "problem",
    docs: {
      description:
        "Disallow raw controls and press handlers on intrinsic JSX elements outside @luke/ui.",
    },
    messages: {
      rawControl:
        "`<{{tag}}>` is a raw control. Draw it with a `@luke/ui` component, or add the component or variant to `@luke/ui`.",
      pressableRole:
        '`role="{{role}}"` makes `<{{tag}}>` a hand-built control. Draw it with a `@luke/ui` component, or add the component or variant to `@luke/ui`.',
      pressEvent:
        "`{{event}}` on `<{{tag}}>` hears a press outside `@luke/ui`. Give the press a home in `@luke/ui`: an existing component's prop, or a new component or variant named for what it does.",
      focusableKey:
        "`{{event}}` on a `<{{tag}}>` that takes the focus (`{{focus}}`) makes it a hand-built control. Draw it with a `@luke/ui` component, or add one; key events are allowed only on a container that takes no focus itself.",
    },
  },
  createOnce(context) {
    return {
      before() {
        return isOutsideUi(context.filename);
      },
      JSXOpeningElement(node) {
        const tag = intrinsicTagOf(node.name);
        if (tag === undefined) return;
        const attributes = node.attributes.filter(
          (attribute): attribute is ESTree.JSXAttribute => attribute.type === "JSXAttribute",
        );
        if (RAW_CONTROL_ELEMENTS.has(tag) && !isHiddenInput(tag, attributes)) {
          context.report({ node: node.name, messageId: "rawControl", data: { tag } });
        }
        const focus = attributes.find(
          (attribute) => FOCUS_ATTRIBUTES.has(attributeName(attribute)) && takesFocus(attribute),
        );
        for (const attribute of attributes) {
          const name = attributeName(attribute);
          if (name === "role") {
            for (const role of literalValuesOf(attribute.value)) {
              if (!PRESSABLE_ROLES.has(role)) continue;
              if (role === LINK_ROLE && tag === ANCHOR_ELEMENT) continue;
              context.report({ node: attribute, messageId: "pressableRole", data: { role, tag } });
            }
          } else if (PRESS_EVENTS.has(name)) {
            context.report({
              node: attribute,
              messageId: "pressEvent",
              data: { event: name, tag },
            });
          } else if (KEY_EVENTS.has(name) && focus !== undefined) {
            context.report({
              node: attribute,
              messageId: "focusableKey",
              data: { event: name, tag, focus: attributeName(focus) },
            });
          }
        }
      },
    };
  },
});

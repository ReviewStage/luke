import type { ESTree } from "@oxlint/plugins";
import { defineRule } from "@oxlint/plugins";
import { attributeName, intrinsicTagOf, literalValuesOf } from "../shared/jsx.ts";
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

function isHiddenInput(tag: string, element: ESTree.JSXOpeningElement): boolean {
  if (tag !== HIDDEN_INPUT.ELEMENT) return false;
  if (element.attributes.some((attribute) => attribute.type === "JSXSpreadAttribute")) return false;
  const type = element.attributes.find(
    (attribute): attribute is ESTree.JSXAttribute =>
      attribute.type === "JSXAttribute" && attributeName(attribute) === "type",
  );
  const values = type === undefined ? undefined : literalValuesOf(type.value);
  return values !== undefined && values.length > 0 && values.every((v) => v === HIDDEN_INPUT.TYPE);
}

function takesFocus(attribute: ESTree.JSXAttribute): boolean {
  const value = attribute.value;
  if (value === null || value.type !== "JSXExpressionContainer") return true;
  const expression = value.expression;
  return !(expression.type === "Literal" && expression.value === false);
}

export const noRawPressOutsideUiRule = defineRule({
  meta: {
    type: "problem",
    docs: {
      description:
        "Disallow raw controls and press handlers on intrinsic JSX elements outside @repo/ui.",
    },
    messages: {
      rawControl:
        "`<{{tag}}>` is a raw control. Draw it with a `@repo/ui` component, or add the component or variant to `@repo/ui`.",
      pressableRole:
        '`role="{{role}}"` makes `<{{tag}}>` a hand-built control. Draw it with a `@repo/ui` component, or add the component or variant to `@repo/ui`.',
      unknownRole:
        "`<{{tag}}>`'s `role` is no literal, so it may be a pressable one. Spell it as a literal, or draw the element with a `@repo/ui` component.",
      pressEvent:
        "`{{event}}` on `<{{tag}}>` hears a press outside `@repo/ui`. Give the press a home in `@repo/ui`: an existing component's prop, or a new component or variant named for what it does.",
      focusableKey:
        "`{{event}}` on a `<{{tag}}>` that takes the focus (`{{focus}}`) makes it a hand-built control. Draw it with a `@repo/ui` component, or add one; key events are allowed only on a container that takes no focus itself.",
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
        if (RAW_CONTROL_ELEMENTS.has(tag) && !isHiddenInput(tag, node)) {
          context.report({ node: node.name, messageId: "rawControl", data: { tag } });
        }
        const focus = attributes.find(
          (attribute) => FOCUS_ATTRIBUTES.has(attributeName(attribute)) && takesFocus(attribute),
        );
        for (const attribute of attributes) {
          const name = attributeName(attribute);
          if (name === "role") {
            const roles = literalValuesOf(attribute.value);
            if (roles === undefined) {
              context.report({ node: attribute, messageId: "unknownRole", data: { tag } });
              continue;
            }
            for (const role of roles) {
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

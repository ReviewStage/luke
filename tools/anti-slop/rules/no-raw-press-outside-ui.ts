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

/** The name a member tag hangs from: `motion` for `motion.button`. */
function rootOf(name: ESTree.JSXMemberExpression): string {
  return name.object.type === "JSXIdentifier" ? name.object.name : rootOf(name.object);
}

/**
 * The tag an intrinsic element renders, or undefined for a component. A
 * lowercase name is an intrinsic, and so is a lowercase member of a
 * lowercase factory such as `motion.button`, which renders the element it
 * names; a member of a capitalized namespace (`Controls.button`) is a
 * component.
 */
function intrinsicTagOf(name: ESTree.JSXElementName): string | undefined {
  const lowercase = /^[a-z]/u;
  const tag =
    name.type === "JSXMemberExpression" && lowercase.test(rootOf(name))
      ? name.property.name
      : undefined;
  const plain = name.type === "JSXIdentifier" ? name.name : tag;
  if (plain === undefined || !lowercase.test(plain)) return undefined;
  return plain;
}

function attributeName(attribute: ESTree.JSXAttribute): string {
  return attribute.name.type === "JSXIdentifier"
    ? attribute.name.name
    : `${attribute.name.namespace.name}:${attribute.name.name.name}`;
}

/**
 * The strings an attribute's value can be, or undefined where some branch of
 * it is no literal, so the rule cannot tell. `undefined` and `null` are no
 * value at all, as an attribute left off is.
 */
function literalValuesOf(node: ESTree.Node | null | undefined): readonly string[] | undefined {
  if (node === null || node === undefined) return [];
  if (node.type === "Identifier" && node.name === "undefined") return [];
  if (node.type === "Literal") {
    if (node.value === null) return [];
    return typeof node.value === "string" ? [node.value] : undefined;
  }
  if (node.type === "JSXExpressionContainer") return literalValuesOf(node.expression);
  if (node.type === "TemplateLiteral" && node.expressions.length === 0) {
    return node.quasis.map((quasi) => quasi.value.cooked ?? "");
  }
  const branches =
    node.type === "ConditionalExpression"
      ? [node.consequent, node.alternate]
      : node.type === "LogicalExpression"
        ? [node.left, node.right]
        : undefined;
  if (branches === undefined) return undefined;
  const values = branches.map((branch) => literalValuesOf(branch));
  return values.some((value) => value === undefined) ? undefined : values.flatMap((v) => v ?? []);
}

/**
 * Note that a hidden input's type must be the literal `hidden` on every
 * branch, and no spread may stand on it, since a spread may set its type.
 */
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
      unknownRole:
        "`<{{tag}}>`'s `role` is no literal, so it may be a pressable one. Spell it as a literal, or draw the element with a `@luke/ui` component.",
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

import type { ESTree } from "@oxlint/plugins";
import { defineRule } from "@oxlint/plugins";

import { attributeName, intrinsicTagOf, literalValuesOf } from "../shared/jsx.ts";
import { isSkeletonClass, isSkeletonComponent, SKELETON_BLOCKS } from "../shared/skeleton-guard.ts";

/** A function's own name, or the name of the binding it is assigned to, or undefined where it has none. */
function functionNameOf(node: ESTree.Node): string | undefined {
  if (
    node.type !== "FunctionDeclaration" &&
    node.type !== "FunctionExpression" &&
    node.type !== "ArrowFunctionExpression"
  ) {
    return undefined;
  }
  if (node.type !== "ArrowFunctionExpression" && node.id) return node.id.name;
  const binding = node.parent;
  return binding?.type === "VariableDeclarator" && binding.id.type === "Identifier"
    ? binding.id.name
    : undefined;
}

/**
 * The component a JSX element is drawn in: the nearest enclosing function
 * named as a component is (capitalized), so a row's callback or a
 * lowercase helper inside a skeleton counts as the skeleton's own.
 */
function componentOf(node: ESTree.Node): string | undefined {
  for (let at = node.parent; at; at = at.parent) {
    const name = functionNameOf(at);
    if (name !== undefined && /^[A-Z]/u.test(name)) return name;
  }
  return undefined;
}

/**
 * A loading skeleton stands in the shape of what replaces it only while it
 * is drawn through the same components, because a skeleton that copies its
 * surface's boxes is a second description of that surface that the surface
 * never reads, and it drifts the first time either changes. So a skeleton's
 * blocks (`Skeleton`, `SkeletonRegion`) are drawn only by a component named
 * `*Skeleton`, and inside one an intrinsic element wears only a class of the
 * skeleton's own, one naming itself a skeleton's; every other box comes from
 * the component the loaded state draws with.
 */
export const skeletonThroughComponentsRule = defineRule({
  meta: {
    type: "problem",
    docs: {
      description:
        "Require loading skeletons to be drawn by `*Skeleton` components, through the components the loaded state draws with.",
    },
    messages: {
      blockOutsideSkeleton:
        "`<{{tag}}>` is drawn in `{{component}}`, which is no `*Skeleton` component. Draw a skeleton's blocks in a component named `*Skeleton`, which the surface renders while it reads.",
      copiedBox:
        '`class="{{name}}"` on `<{{tag}}>` in `{{component}}` copies a box of the surface it stands for. Draw the box through the component the loaded state draws it with, factoring one out where the surface builds it by hand; a class of the skeleton\'s own names itself one (`…-skeleton…`).',
      unknownClass:
        "`<{{tag}}>`'s `className` in `{{component}}` is no literal, so it may copy a box of the surface it stands for. Spell the skeleton's own class as a literal, or draw the box through a component.",
    },
  },
  createOnce(context) {
    return {
      JSXOpeningElement(node) {
        const component = componentOf(node) ?? "the module";
        const skeleton = isSkeletonComponent(component);
        if (node.name.type === "JSXIdentifier" && SKELETON_BLOCKS.has(node.name.name)) {
          if (!skeleton) {
            context.report({
              node: node.name,
              messageId: "blockOutsideSkeleton",
              data: { tag: node.name.name, component },
            });
          }
          return;
        }
        const tag = intrinsicTagOf(node.name);
        if (!skeleton || tag === undefined) return;
        for (const attribute of node.attributes) {
          if (attribute.type !== "JSXAttribute" || attributeName(attribute) !== "className") {
            continue;
          }
          const values = literalValuesOf(attribute.value);
          if (values === undefined) {
            context.report({
              node: attribute,
              messageId: "unknownClass",
              data: { tag, component },
            });
            continue;
          }
          const copied = values
            .flatMap((value) => value.split(/\s+/u))
            .find((name) => name.length > 0 && !isSkeletonClass(name));
          if (copied !== undefined) {
            context.report({
              node: attribute,
              messageId: "copiedBox",
              data: { name: copied, tag, component },
            });
          }
        }
      },
    };
  },
});

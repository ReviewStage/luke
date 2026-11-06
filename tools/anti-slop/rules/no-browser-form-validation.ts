import { defineRule } from "@oxlint/plugins";

import { attributeName, intrinsicTagOf } from "../shared/jsx.ts";

export const noBrowserFormValidationRule = defineRule({
  meta: {
    type: "problem",
    docs: {
      description:
        "Require noValidate on every form, so the browser never draws its own validation bubble.",
    },
    messages: {
      browserChecked:
        "A `<form>` without `noValidate` lets the browser draw its own bubble over a field. Add `noValidate`, check the value on submit, and say what is wrong in the field's error (`FormField`'s `error`, an `inputProblem`).",
    },
  },
  createOnce(context) {
    return {
      JSXOpeningElement(node) {
        if (intrinsicTagOf(node.name) !== "form") return;
        const unchecked = node.attributes.some(
          (attribute) =>
            attribute.type === "JSXAttribute" &&
            attributeName(attribute) === "noValidate" &&
            !(
              attribute.value?.type === "JSXExpressionContainer" &&
              attribute.value.expression.type === "Literal" &&
              attribute.value.expression.value === false
            ),
        );
        if (unchecked) return;
        context.report({ node: node.name, messageId: "browserChecked" });
      },
    };
  },
});

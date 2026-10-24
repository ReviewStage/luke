import { defineRule } from "@oxlint/plugins";

import { RAW_HEADING_ELEMENTS } from "../shared/heading-guard.ts";
import { intrinsicTagOf } from "../shared/jsx.ts";
import { isOutsideUi } from "../shared/press-guard.ts";

/**
 * Outside `@luke/ui`, an intrinsic `h1`–`h6` is never drawn: a heading is
 * `Text` in the role that sizes it, standing in the element the outline
 * needs (`as`). Note that a heading inside an HTML string is page content,
 * not JSX, so the rule never sees it.
 */
export const noRawHeadingOutsideUiRule = defineRule({
  meta: {
    type: "problem",
    docs: {
      description:
        "Disallow intrinsic heading elements outside @luke/ui; headings go through Text.",
    },
    messages: {
      rawHeading:
        "`<{{tag}}>` is a raw heading. Draw it with `Text` from `@luke/ui`: `as={TEXT_ELEMENT.{{element}}}` for the outline, and the type role that sizes it (`TEXT_VARIANT.GROUP`, `SECTION`, `DIALOG`, `TITLE`).",
    },
  },
  createOnce(context) {
    return {
      before() {
        return isOutsideUi(context.filename);
      },
      JSXOpeningElement(node) {
        const tag = intrinsicTagOf(node.name);
        if (tag === undefined || !RAW_HEADING_ELEMENTS.has(tag)) return;
        context.report({
          node: node.name,
          messageId: "rawHeading",
          data: { tag, element: tag.toUpperCase() },
        });
      },
    };
  },
});

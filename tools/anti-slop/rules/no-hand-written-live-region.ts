import { defineRule } from "@oxlint/plugins";

import { attributeName, intrinsicTagOf, literalValuesOf } from "../shared/jsx.ts";
import { LIVE_ATTRIBUTE, LIVE_REGION_ROLES } from "../shared/live-region-guard.ts";
import { isOutsideUi } from "../shared/press-guard.ts";

/**
 * Outside `@luke/ui`, an intrinsic element is never a live region: no
 * `role="status"`, `role="alert"` or `role="log"`, and no `aria-live`. What a
 * reader should hear goes through `announce` and the one `Announcer`, and a
 * block that stands in the page keeps its words in a `@luke/ui` component
 * (`ErrorState`, `FailureNote`, `EmptyState`, `NoteLine`) that owns its role.
 * Note that a role the rule cannot read as a literal is left alone, as is a
 * component's own `role` prop: it names no intrinsic element.
 */
export const noHandWrittenLiveRegionRule = defineRule({
  meta: {
    type: "problem",
    docs: {
      description:
        "Disallow live regions on intrinsic elements outside @luke/ui; words read aloud go through announce.",
    },
    messages: {
      liveRegion:
        "`<{{tag}}>` is a hand-written live region ({{what}}). Say it with `announce(ANNOUNCE.POLITE | ANNOUNCE.ALERT, words)` from `@luke/ui`, or draw the words in `FailureNote`, `ErrorState`, `EmptyState` or `NoteLine`.",
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
        for (const attribute of node.attributes) {
          if (attribute.type !== "JSXAttribute") continue;
          const name = attributeName(attribute);
          if (name === LIVE_ATTRIBUTE) {
            context.report({
              node: attribute,
              messageId: "liveRegion",
              data: { tag, what: LIVE_ATTRIBUTE },
            });
            continue;
          }
          if (name !== "role") continue;
          const roles = literalValuesOf(attribute.value)?.flatMap((value) => value.split(/\s+/u));
          const live = roles?.find((role) => LIVE_REGION_ROLES.has(role));
          if (live === undefined) continue;
          context.report({
            node: attribute,
            messageId: "liveRegion",
            data: { tag, what: `role="${live}"` },
          });
        }
      },
    };
  },
});

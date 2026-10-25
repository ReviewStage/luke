import type { ESTree } from "@oxlint/plugins";
import { defineRule } from "@oxlint/plugins";

import { repositoryPathOf } from "../shared/effect-edges.ts";
import { SHADCN_SOURCE } from "../shared/shadcn-focus-guard.ts";
import { literalText, TEST_SOURCE } from "../shared/test-guard.ts";

/**
 * The utilities that hide the browser's outline or draw a ring of their own,
 * behind any variant (`focus-visible:ring-3`).
 */
const RING_UTILITY = /^(?:\S*:)?(?:outline-none|outline-hidden|ring-\d+|ring-ring)(?:\/\S+)?$/u;

function ringUtility(text: string): string | undefined {
  return text.split(/\s+/u).find((token) => RING_UTILITY.test(token));
}

/**
 * shadcn's source suppresses the browser's outline and draws a ring of its
 * own. The window draws one ring for every control, the keyboard's, in a
 * sheet Tailwind's utilities outrank (`packages/ui/README.md`: "the
 * keyboard's ring stays in its own sheet"), so a vendored component that
 * kept either would hide that ring or draw a second, and a keyboard user
 * would lose where focus is.
 */
export const noShadcnFocusRingRule = defineRule({
  meta: {
    type: "problem",
    docs: {
      description:
        "Disallow outline-none, outline-hidden, ring-<n> and ring-ring in a vendored shadcn/ui component.",
    },
    messages: {
      ring: "`{{utility}}` hides the keyboard's focus ring or draws a second one. Drop it: the window's own ring stands for every control.",
    },
  },
  createOnce(context) {
    function check(node: ESTree.Node): void {
      const text = literalText(node);
      const utility = text === undefined ? undefined : ringUtility(text);
      if (utility !== undefined) context.report({ node, messageId: "ring", data: { utility } });
    }

    return {
      before() {
        const file = repositoryPathOf(context.filename);
        return SHADCN_SOURCE.test(file) && !TEST_SOURCE.test(file);
      },
      Literal: check,
      TemplateLiteral: check,
    };
  },
});

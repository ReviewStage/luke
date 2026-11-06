import type { ESTree } from "@oxlint/plugins";
import { defineRule } from "@oxlint/plugins";

import { repositoryPathOf } from "../shared/effect-edges.ts";
import { SHADCN_SOURCE } from "../shared/shadcn-focus-guard.ts";
import { literalText, TEST_SOURCE } from "../shared/test-guard.ts";

const RING_UTILITY = /^(?:\S*:)?(?:outline-none|outline-hidden|ring-\d+|ring-ring)(?:\/\S+)?$/u;

function ringUtility(text: string): string | undefined {
  return text.split(/\s+/u).find((token) => RING_UTILITY.test(token));
}

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

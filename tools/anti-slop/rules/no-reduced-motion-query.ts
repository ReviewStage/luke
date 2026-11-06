import type { ESTree } from "@oxlint/plugins";
import { defineRule } from "@oxlint/plugins";

import { repositoryPathOf } from "../shared/effect-edges.ts";
import { literalText, TEST_SOURCE } from "../shared/test-guard.ts";

const REDUCED_MOTION_QUERY = /prefers-reduced-motion/u;

const QUERY_LISTENER = "packages/ui/src/use-motion-held.ts";

export const noReducedMotionQueryRule = defineRule({
  meta: {
    type: "problem",
    docs: {
      description: "Disallow asking prefers-reduced-motion from a script; ask motionHeld instead.",
    },
    messages: {
      query:
        "A script asks `motionHeld` (`@repo/ui`) whether to move, never the OS setting, which a capture run does not touch.",
    },
  },
  createOnce(context) {
    function check(node: ESTree.Node): void {
      const text = literalText(node);
      if (text !== undefined && REDUCED_MOTION_QUERY.test(text))
        context.report({ node, messageId: "query" });
    }

    return {
      before() {
        const file = repositoryPathOf(context.filename);
        return file !== QUERY_LISTENER && !TEST_SOURCE.test(file);
      },
      Literal: check,
      TemplateLiteral: check,
    };
  },
});

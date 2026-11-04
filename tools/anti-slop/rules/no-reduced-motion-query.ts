import type { ESTree } from "@oxlint/plugins";
import { defineRule } from "@oxlint/plugins";

import { repositoryPathOf } from "../shared/effect-edges.ts";
import { literalText, TEST_SOURCE } from "../shared/test-guard.ts";

/** The OS setting's media feature, however a script spells the query around it. */
const REDUCED_MOTION_QUERY = /prefers-reduced-motion/u;

/**
 * The one script that may name the query: it reads `motionHeld` and listens
 * to the setting only to know when to read the tokens again.
 */
const QUERY_LISTENER = "packages/ui/src/use-motion-held.ts";

/**
 * A script that chooses between motion and none asks `motionHeld`
 * (`@repo/ui`), which reads the motion tokens, never the OS setting
 * (`docs/DESIGN.md`, "The vocabulary"): reduced motion and a capture run
 * both zero the tokens, but a capture run never touches the setting, so a
 * script that asks the setting plays on in every capture.
 */
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

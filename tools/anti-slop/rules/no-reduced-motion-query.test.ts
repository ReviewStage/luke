import path from "node:path";
import { fileURLToPath } from "node:url";

import { RuleTester } from "oxlint/plugins-dev";
import { describe, it } from "vitest";

import { noReducedMotionQueryRule } from "./no-reduced-motion-query.ts";

const REPOSITORY_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "..",
);
const SCRIPT = path.join(REPOSITORY_ROOT, "packages/ui/src/components/landing/landing-paint.ts");

RuleTester.describe = describe;
RuleTester.it = it;

const tester = new RuleTester();

tester.run("no-reduced-motion-query", noReducedMotionQueryRule, {
  valid: [
    { code: "const still = motionHeld();", filename: SCRIPT },
    {
      code: 'window.matchMedia("(prefers-reduced-motion: reduce)");',
      filename: path.join(REPOSITORY_ROOT, "packages/ui/src/use-motion-held.ts"),
    },
    {
      code: 'const query = "(prefers-reduced-motion: reduce)";',
      filename: path.join(REPOSITORY_ROOT, "packages/panel/src/tasks/agent-composer.test.ts"),
    },
  ],
  invalid: [
    {
      code: 'window.matchMedia("(prefers-reduced-motion: reduce)").matches;',
      filename: SCRIPT,
      errors: [{ messageId: "query" }],
    },
    {
      code: "window.matchMedia(`(prefers-reduced-motion: ${value})`);",
      filename: SCRIPT,
      errors: [{ messageId: "query" }],
    },
  ],
});

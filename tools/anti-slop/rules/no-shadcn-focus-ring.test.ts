import path from "node:path";
import { fileURLToPath } from "node:url";

import { RuleTester } from "oxlint/plugins-dev";
import { describe, it } from "vitest";

import { noShadcnFocusRingRule } from "./no-shadcn-focus-ring.ts";

const REPOSITORY_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "..",
);
const SHADCN_FILE = path.join(REPOSITORY_ROOT, "packages/ui/src/shadcn/input.tsx");

RuleTester.describe = describe;
RuleTester.it = it;

const tester = new RuleTester();

tester.run("no-shadcn-focus-ring", noShadcnFocusRingRule, {
  valid: [
    { code: 'const box = "h-control rounded-control border-input bg-transparent";', filename: SHADCN_FILE },
    // A ring's colour or offset alone draws no ring, and a name merely holding the words is no utility.
    { code: 'const box = "ring-offset-background focus-visible:ring-offset-2 my-ring-1x";', filename: SHADCN_FILE },
    // Outside the vendored folder, the rule has nothing to say.
    {
      code: 'const box = "outline-none";',
      filename: path.join(REPOSITORY_ROOT, "packages/ui/src/components/button/button.tsx"),
    },
  ],
  invalid: [
    { code: 'const box = "border outline-none";', filename: SHADCN_FILE, errors: [{ messageId: "ring" }] },
    {
      code: "const box = `${base} focus-visible:ring-3 focus-visible:ring-ring/50`;",
      filename: SHADCN_FILE,
      errors: [{ messageId: "ring" }],
    },
    { code: 'cn("data-[open]:outline-hidden", size);', filename: SHADCN_FILE, errors: [{ messageId: "ring" }] },
  ],
});

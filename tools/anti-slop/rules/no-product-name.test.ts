import path from "node:path";
import { fileURLToPath } from "node:url";

import { RuleTester } from "oxlint/plugins-dev";
import { describe, it } from "vitest";

import { noProductNameRule } from "./no-product-name.ts";

const REPOSITORY_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "..",
);
const SOURCE = path.join(REPOSITORY_ROOT, "packages/panel/src/desktop/thing.tsx");
const TEST_FILE = path.join(REPOSITORY_ROOT, "packages/panel/src/desktop/thing.test.tsx");

RuleTester.describe = describe;
RuleTester.it = it;

const tester = new RuleTester();

tester.run("no-product-name", noProductNameRule, {
  valid: [
    { code: "const quit = `Quit ${PRODUCT_NAME}?`;", filename: SOURCE },
    { code: 'const failed = "The service did not answer.";', filename: SOURCE },
    { code: "// The bundle is `Vespin.app`.\nconst a = 1;", filename: SOURCE },
    { code: 'const title = "Quit Vespin?";', filename: TEST_FILE },
  ],
  invalid: [
    {
      code: 'const title = "Quit Vespin?";',
      filename: SOURCE,
      errors: [{ messageId: "productName" }],
    },
    {
      code: "const line = `Vespin host ${1}`;",
      filename: SOURCE,
      errors: [{ messageId: "productName" }],
    },
    {
      code: "const a = <p>Sign in to Vespin</p>;",
      filename: SOURCE,
      errors: [{ messageId: "productName" }],
    },
    {
      code: "/** Vespin keeps this. */\nconst a = 1;",
      filename: TEST_FILE,
      errors: [{ messageId: "productNameInComment" }],
    },
  ],
});

import path from "node:path";
import { fileURLToPath } from "node:url";

import { RuleTester } from "oxlint/plugins-dev";
import { describe, it } from "vitest";

import { noSourceReadInTestRule } from "./no-source-read-in-test.ts";

const REPOSITORY_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "..",
);
const TEST_FILE = path.join(REPOSITORY_ROOT, "packages/ui/src/tokens/example.test.ts");

RuleTester.describe = describe;
RuleTester.it = it;

const tester = new RuleTester();

tester.run("no-source-read-in-test", noSourceReadInTestRule, {
  valid: [
    // A fixture or a recording is data, not source.
    {
      code: 'readFileSync(new URL("./fixtures/stream.jsonl", import.meta.url), "utf8");',
      filename: TEST_FILE,
    },
    { code: 'await readFile(path.join(directory, "settings.json"), "utf8");', filename: TEST_FILE },
    { code: 'readdirSync(path.join(temporary, "out"));', filename: TEST_FILE },
    // A module in a checkout the test made is the test's own data.
    {
      code: 'const fresh = cloned(checkout); readFileSync(join(fresh, "src", "invites.ts"), "utf8");',
      filename: TEST_FILE,
    },
    // A module that is no test may read what it likes.
    {
      code: 'readFileSync("./tokens.css", "utf8");',
      filename: path.join(REPOSITORY_ROOT, "scripts/example.ts"),
    },
  ],
  invalid: [
    {
      code: 'readFileSync(new URL("./roles.css", import.meta.url), "utf8");',
      filename: TEST_FILE,
      errors: [{ messageId: "sourceRead" }],
    },
    // The path held in a constant above the read.
    {
      code: 'const ROOT = path.dirname(fileURLToPath(import.meta.url)); const SHEET = path.join(ROOT, "src", "text.css"); const text = fs.readFileSync(SHEET, "utf8");',
      filename: TEST_FILE,
      errors: [{ messageId: "sourceRead" }],
    },
    {
      code: 'await readFile(`${root}/packages/panel/src/app.tsx`, "utf8");',
      filename: TEST_FILE,
      errors: [{ messageId: "sourceRead" }],
    },
    {
      code: 'readFileSync(`${__dirname}/../styles/tasks.css`, "utf8");',
      filename: TEST_FILE,
      errors: [{ messageId: "sourceRead" }],
    },
    {
      code: 'globSync("packages/ui/src/**/*.tsx");',
      filename: TEST_FILE,
      errors: [{ messageId: "sourceRead" }],
    },
  ],
});

import path from "node:path";
import { fileURLToPath } from "node:url";

import { RuleTester } from "oxlint/plugins-dev";
import { describe, it } from "vitest";

import { noInternalViMockRule } from "./no-internal-vi-mock.ts";

const REPOSITORY_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "..",
);
const TEST_FILE = path.join(REPOSITORY_ROOT, "packages/panel/src/tasks/example.test.ts");

RuleTester.describe = describe;
RuleTester.it = it;

const tester = new RuleTester();

tester.run("no-internal-vi-mock", noInternalViMockRule, {
  valid: [
    // An outside package crosses a process boundary of its own.
    { code: 'vi.mock("electron", () => ({}));', filename: TEST_FILE },
    { code: 'vi.mock("posthog-js/dist/module.no-external");', filename: TEST_FILE },
    // A module that is no test's is no business of the rule's.
    {
      code: 'vi.mock("./tasks-page.js");',
      filename: path.join(REPOSITORY_ROOT, "packages/panel/src/testing/example.ts"),
    },
  ],
  invalid: [
    // A module of this repository, by each way a specifier names one.
    {
      code: 'vi.mock("./tasks-page.js", () => { throw new Error("x"); });',
      filename: TEST_FILE,
      errors: [{ messageId: "internalMock" }],
    },
    { code: 'vi.doMock("@luke/wire");', filename: TEST_FILE, errors: [{ messageId: "internalMock" }] },
    { code: 'vi.mock("#main/app.js");', filename: TEST_FILE, errors: [{ messageId: "internalMock" }] },
    {
      code: 'vi.mock(import("../app-bridge.js"));',
      filename: TEST_FILE,
      errors: [{ messageId: "internalMock" }],
    },
  ],
});

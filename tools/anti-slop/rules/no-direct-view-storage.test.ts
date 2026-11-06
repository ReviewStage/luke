import path from "node:path";
import { fileURLToPath } from "node:url";

import { RuleTester } from "oxlint/plugins-dev";
import { describe, it } from "vitest";

import { KEPT_STORAGE_BASELINE, NOT_VIEW_STORAGE } from "../shared/kept-guard.ts";
import { noDirectViewStorageRule } from "./no-direct-view-storage.ts";

const REPOSITORY_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "..",
);
const DOOR_FILE = path.join(REPOSITORY_ROOT, "packages/panel/src/use-kept.ts");
const NEW_FILE = path.join(REPOSITORY_ROOT, "packages/panel/src/desktop/not-on-a-list.ts");
const TEST_FILE = path.join(REPOSITORY_ROOT, "packages/panel/src/desktop/thing.test.ts");
const SUPPORT_FILE = path.join(REPOSITORY_ROOT, "apps/web/tests/support/thing.ts");

const [BASELINED_PATH, BASELINED_COUNT] = Object.entries(KEPT_STORAGE_BASELINE)[0] ?? ["", 0];
const BASELINED_FILE = path.join(REPOSITORY_ROOT, BASELINED_PATH);
const ALLOWED_FILE = path.join(REPOSITORY_ROOT, Object.keys(NOT_VIEW_STORAGE)[0] ?? "");

const READ = 'window.localStorage.getItem("luke.folded");\n';

function reads(count: number): string {
  return READ.repeat(count);
}

RuleTester.describe = describe;
RuleTester.it = it;

const tester = new RuleTester();

tester.run("no-direct-view-storage", noDirectViewStorageRule, {
  valid: [
    { code: READ, filename: DOOR_FILE },
    { code: READ, filename: TEST_FILE },
    { code: READ, filename: SUPPORT_FILE },
    { code: `${READ}sessionStorage.setItem("a", "b");`, filename: ALLOWED_FILE },
    { code: reads(BASELINED_COUNT), filename: BASELINED_FILE },
    {
      code: 'const where = "localStorage"; interface Tab { readonly sessionStorage: Pick<Storage, "setItem"> }',
      filename: NEW_FILE,
    },
    { code: READ, filename: path.join(REPOSITORY_ROOT, "scripts/example.mjs") },
  ],
  invalid: [
    { code: READ, filename: NEW_FILE, errors: [{ messageId: "newStorage" }] },
    {
      code: 'localStorage.setItem("luke.sort", "oldest");',
      filename: NEW_FILE,
      errors: [{ messageId: "newStorage" }],
    },
    {
      code: 'globalThis["sessionStorage"].getItem("luke.fold");',
      filename: NEW_FILE,
      errors: [{ messageId: "newStorage" }],
    },
    {
      code: 'import { readKept, writeKept } from "../kept-storage.js";',
      filename: NEW_FILE,
      errors: [{ messageId: "newStorage" }],
    },
    {
      code: reads(BASELINED_COUNT + 1),
      filename: BASELINED_FILE,
      errors: [{ messageId: "newStorage" }],
    },
    {
      code: "export const none = 1;",
      filename: BASELINED_FILE,
      errors: [
        { messageId: "staleBaseline", data: { found: "0", expected: String(BASELINED_COUNT) } },
      ],
    },
    {
      code: "export const none = 1;",
      filename: ALLOWED_FILE,
      errors: [{ messageId: "staleAllowed" }],
    },
  ],
});

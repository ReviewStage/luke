import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { RuleTester } from "oxlint/plugins-dev";
import { describe, expect, it } from "vitest";

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

// A file the baseline still holds, with how many places it holds it to.
const [BASELINED_PATH, BASELINED_COUNT] = Object.entries(KEPT_STORAGE_BASELINE)[0] ?? ["", 0];
const BASELINED_FILE = path.join(REPOSITORY_ROOT, BASELINED_PATH);
// A file that keeps storage that is no view choice.
const ALLOWED_FILE = path.join(REPOSITORY_ROOT, Object.keys(NOT_VIEW_STORAGE)[0] ?? "");

const READ = 'window.localStorage.getItem("luke.folded");\n';

/** `count` reads of the window's storage. */
function reads(count: number): string {
  return READ.repeat(count);
}

RuleTester.describe = describe;
RuleTester.it = it;

const tester = new RuleTester();

tester.run("no-direct-view-storage", noDirectViewStorageRule, {
  valid: [
    // useKept is the one door a view choice is stored through.
    { code: READ, filename: DOOR_FILE },
    // A test seeds storage to drive a surface, and so does what tests share.
    { code: READ, filename: TEST_FILE },
    { code: READ, filename: SUPPORT_FILE },
    // A file that stores no view choice is named with its reason, and may touch storage as it likes.
    { code: `${READ}sessionStorage.setItem("a", "b");`, filename: ALLOWED_FILE },
    // A file the baseline holds, at exactly the count it holds it to.
    { code: reads(BASELINED_COUNT), filename: BASELINED_FILE },
    // A name that is no storage, and a type that only names one.
    {
      code: 'const where = "localStorage"; interface Tab { readonly sessionStorage: Pick<Storage, "setItem"> }',
      filename: NEW_FILE,
    },
    // A plain script is outside the migration, as it is for every rule here.
    { code: READ, filename: path.join(REPOSITORY_ROOT, "scripts/example.mjs") },
  ],
  invalid: [
    // A file not on the baseline, whichever way it names the storage.
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
    // The helpers `useKept` is built on are no way around it.
    {
      code: 'import { readKept, writeKept } from "../kept-storage.js";',
      filename: NEW_FILE,
      errors: [{ messageId: "newStorage" }],
    },
    // A file on the baseline taking one place more than its count.
    {
      code: reads(BASELINED_COUNT + 1),
      filename: BASELINED_FILE,
      errors: [{ messageId: "newStorage" }],
    },
    // A file on the baseline holding fewer than its count: the count comes down with it.
    {
      code: "export const none = 1;",
      filename: BASELINED_FILE,
      errors: [
        { messageId: "staleBaseline", data: { found: "0", expected: String(BASELINED_COUNT) } },
      ],
    },
    // A file named as keeping no view choice that touches no storage: its row goes.
    {
      code: "export const none = 1;",
      filename: ALLOWED_FILE,
      errors: [{ messageId: "staleAllowed" }],
    },
  ],
});

describe("the guard's lists", () => {
  it("name files that exist, so a deleted file leaves them", () => {
    const named = [...Object.keys(KEPT_STORAGE_BASELINE), ...Object.keys(NOT_VIEW_STORAGE)];
    expect(named.filter((file) => !existsSync(path.join(REPOSITORY_ROOT, file)))).toEqual([]);
  });

  it("name no file twice", () => {
    const both = Object.keys(KEPT_STORAGE_BASELINE).filter((file) => file in NOT_VIEW_STORAGE);
    expect(both).toEqual([]);
  });
});

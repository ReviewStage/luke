import path from "node:path";
import { fileURLToPath } from "node:url";

import { RuleTester } from "oxlint/plugins-dev";
import { describe, it } from "vitest";

import { LUCIDE_BASELINE } from "../shared/lucide-guard.ts";
import { noLucideOutsideDoorRule } from "./no-lucide-outside-door.ts";

const REPOSITORY_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "..",
);
const DOOR_FILE = path.join(REPOSITORY_ROOT, "packages/ui/src/icons/lucide-glyph.tsx");
const NEW_FILE = path.join(REPOSITORY_ROOT, "packages/panel/src/tasks/not-on-the-baseline.tsx");

// A file the baseline still holds, with the number of imports it holds it to.
const [BASELINED_PATH, BASELINED_COUNT] = [...LUCIDE_BASELINE.entries()][0] ?? ["", 0];
const BASELINED_FILE = path.join(REPOSITORY_ROOT, BASELINED_PATH);
const IMPORT = 'import { Bot } from "lucide-react";\n';

/** `count` imports of Lucide, each binding a name of its own. */
function imports(count: number): string {
  return Array.from(
    { length: count },
    (_, at) => `import { Bot as Bot${at} } from "lucide-react";\n`,
  ).join("");
}

RuleTester.describe = describe;
RuleTester.it = it;

const tester = new RuleTester();

tester.run("no-lucide-outside-door", noLucideOutsideDoorRule, {
  valid: [
    // The door and what stands behind it import Lucide.
    { code: IMPORT, filename: DOOR_FILE },
    // Icons through the door, and other libraries, are no business of the rule's.
    {
      code: 'import { Bot } from "@luke/ui/icons"; import { x } from "lucide-react-native-not";',
      filename: NEW_FILE,
    },
    // A file the baseline holds, at exactly the count it holds it to.
    { code: imports(BASELINED_COUNT), filename: BASELINED_FILE },
    // A plain script is outside the migration, as it is for every rule here.
    { code: IMPORT, filename: path.join(REPOSITORY_ROOT, "scripts/example.mjs") },
  ],
  invalid: [
    // A file not on the baseline, whichever way it reaches the library.
    { code: IMPORT, filename: NEW_FILE, errors: [{ messageId: "newImport" }] },
    {
      code: 'import type { LucideIcon } from "lucide-react";',
      filename: NEW_FILE,
      errors: [{ messageId: "newImport" }],
    },
    {
      code: 'export { Bot } from "lucide-react";',
      filename: NEW_FILE,
      errors: [{ messageId: "newImport" }],
    },
    {
      code: 'export * from "lucide-react";',
      filename: NEW_FILE,
      errors: [{ messageId: "newImport" }],
    },
    {
      code: 'const icons = await import("lucide-react/dynamic");',
      filename: NEW_FILE,
      errors: [{ messageId: "newImport" }],
    },
    {
      code: 'const lucide = require("lucide-react");',
      filename: NEW_FILE,
      errors: [{ messageId: "newImport" }],
    },
    // A file on the baseline taking one import more than its count.
    {
      code: imports(BASELINED_COUNT + 1),
      filename: BASELINED_FILE,
      errors: [{ messageId: "newImport" }],
    },
    // A file on the baseline holding fewer than its count: the count comes down with it.
    {
      code: "export const none = 1;",
      filename: BASELINED_FILE,
      errors: [
        { messageId: "staleBaseline", data: { found: "0", expected: String(BASELINED_COUNT) } },
      ],
    },
  ],
});

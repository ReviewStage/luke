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

const [BASELINED_PATH, BASELINED_COUNT] = [...LUCIDE_BASELINE.entries()][0] ?? ["", 0];
const BASELINED_FILE = path.join(REPOSITORY_ROOT, BASELINED_PATH);
const IMPORT = 'import { Bot } from "lucide-react";\n';

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
    { code: IMPORT, filename: DOOR_FILE },
    {
      code: 'import { Bot } from "@repo/ui/icons"; import { x } from "lucide-react-native-not";',
      filename: NEW_FILE,
    },
    { code: imports(BASELINED_COUNT), filename: BASELINED_FILE },
    { code: IMPORT, filename: path.join(REPOSITORY_ROOT, "scripts/example.mjs") },
  ],
  invalid: [
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
    {
      code: imports(BASELINED_COUNT + 1),
      filename: BASELINED_FILE,
      errors: [{ messageId: "newImport" }],
    },
    {
      code: "export const none = 1;",
      filename: BASELINED_FILE,
      errors: [
        { messageId: "staleBaseline", data: { found: "0", expected: String(BASELINED_COUNT) } },
      ],
    },
  ],
});

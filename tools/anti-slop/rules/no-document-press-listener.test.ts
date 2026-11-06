import path from "node:path";
import { fileURLToPath } from "node:url";

import { RuleTester } from "oxlint/plugins-dev";
import { describe, it } from "vitest";

import { PRESS_LISTENER_BASELINE } from "../shared/press-listener-guard.ts";
import { noDocumentPressListenerRule } from "./no-document-press-listener.ts";

const REPOSITORY_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "..",
);
const UI_FILE = path.join(
  REPOSITORY_ROOT,
  "packages/ui/src/components/anchored-popover/press-away.ts",
);
const NEW_FILE = path.join(REPOSITORY_ROOT, "packages/panel/src/tasks/not-on-the-baseline.tsx");
const TEST_FILE = path.join(REPOSITORY_ROOT, "packages/panel/src/tasks/thing.test.ts");

const [BASELINED_PATH, BASELINED_COUNT] = Object.entries(PRESS_LISTENER_BASELINE)[0] ?? ["", 0];
const BASELINED_FILE = path.join(REPOSITORY_ROOT, BASELINED_PATH);
const PRESS = 'document.addEventListener("pointerdown", close, true);\n';

function listeners(count: number): string {
  return PRESS.repeat(count);
}

RuleTester.describe = describe;
RuleTester.it = it;

const tester = new RuleTester();

tester.run("no-document-press-listener", noDocumentPressListenerRule, {
  valid: [
    { code: PRESS, filename: UI_FILE },
    { code: PRESS, filename: TEST_FILE },
    {
      code: 'host.addEventListener("pointerdown", press); document.addEventListener("keydown", key); document.addEventListener("pointerup", up);',
      filename: NEW_FILE,
    },
    { code: listeners(BASELINED_COUNT), filename: BASELINED_FILE },
    { code: PRESS, filename: path.join(REPOSITORY_ROOT, "scripts/example.mjs") },
  ],
  invalid: [
    { code: PRESS, filename: NEW_FILE, errors: [{ messageId: "newListener" }] },
    {
      code: 'window.addEventListener("mousedown", close);',
      filename: NEW_FILE,
      errors: [{ messageId: "newListener" }],
    },
    {
      code: "element.ownerDocument.addEventListener(`click`, close);",
      filename: NEW_FILE,
      errors: [{ messageId: "newListener" }],
    },
    {
      code: 'globalThis.document.addEventListener("touchstart", close, { passive: true });',
      filename: NEW_FILE,
      errors: [{ messageId: "newListener" }],
    },
    {
      code: listeners(BASELINED_COUNT + 1),
      filename: BASELINED_FILE,
      errors: [{ messageId: "newListener" }],
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

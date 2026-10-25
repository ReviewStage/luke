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

// A file the baseline still holds, with the number of listeners it holds it to.
const [BASELINED_PATH, BASELINED_COUNT] = Object.entries(PRESS_LISTENER_BASELINE)[0] ?? ["", 0];
const BASELINED_FILE = path.join(REPOSITORY_ROOT, BASELINED_PATH);
const PRESS = 'document.addEventListener("pointerdown", close, true);\n';

/** `count` press listeners on the document. */
function listeners(count: number): string {
  return PRESS.repeat(count);
}

RuleTester.describe = describe;
RuleTester.it = it;

const tester = new RuleTester();

tester.run("no-document-press-listener", noDocumentPressListenerRule, {
  valid: [
    // @luke/ui is where a press anywhere is heard.
    { code: PRESS, filename: UI_FILE },
    // A test dispatches presses and may stand a listener to see them.
    { code: PRESS, filename: TEST_FILE },
    // A listener on an element, or for a key, a scroll or the pointer's release, is no click-away.
    {
      code: 'host.addEventListener("pointerdown", press); document.addEventListener("keydown", key); document.addEventListener("pointerup", up);',
      filename: NEW_FILE,
    },
    // A file the baseline holds, at exactly the count it holds it to.
    { code: listeners(BASELINED_COUNT), filename: BASELINED_FILE },
    // A plain script is outside the migration, as it is for every rule here.
    { code: PRESS, filename: path.join(REPOSITORY_ROOT, "scripts/example.mjs") },
  ],
  invalid: [
    // A file not on the baseline, whichever target and press it hears.
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
    // A file on the baseline taking one listener more than its count.
    {
      code: listeners(BASELINED_COUNT + 1),
      filename: BASELINED_FILE,
      errors: [{ messageId: "newListener" }],
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

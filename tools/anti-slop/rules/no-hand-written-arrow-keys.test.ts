import path from "node:path";
import { fileURLToPath } from "node:url";

import { RuleTester } from "oxlint/plugins-dev";
import { describe, it } from "vitest";

import { noHandWrittenArrowKeysRule } from "./no-hand-written-arrow-keys.ts";

const REPOSITORY_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "..",
);
const PANEL_FILE = path.join(REPOSITORY_ROOT, "packages/panel/src/tasks/example-list.tsx");
const EDITOR_FILE = path.join(REPOSITORY_ROOT, "packages/panel/src/plan-editor/plan-editor.ts");
const TERMINAL_FILE = path.join(REPOSITORY_ROOT, "packages/panel/src/terminal/terminal-keys.ts");
const UI_FILE = path.join(REPOSITORY_ROOT, "packages/ui/src/components/example/example.tsx");
const TEST_FILE = path.join(REPOSITORY_ROOT, "packages/panel/src/tasks/example-list.test.ts");

RuleTester.describe = describe;
RuleTester.it = it;

const tester = new RuleTester();

const STEPPING_BY_HAND = `
function List({ rows, move }) {
  const onKeyDown = (event) => {
    if (event.key === "ArrowDown") move(1);
  };
  return createList(rows, { onKeyDown });
}`;

tester.run("no-hand-written-arrow-keys", noHandWrittenArrowKeysRule, {
  valid: [
    // `@luke/ui` writes the walk once.
    { code: STEPPING_BY_HAND, filename: UI_FILE },
    // The editor and the terminal need the raw keys, and are named for it in arrow-keys.json.
    { code: STEPPING_BY_HAND, filename: EDITOR_FILE },
    { code: 'const KEYS = [["ArrowLeft", "\\x01"]];', filename: TERMINAL_FILE },
    // A test drives a key by dispatching it.
    {
      code: 'press({ key: "ArrowDown" }); expect(event.key === "ArrowDown").toBe(true);',
      filename: TEST_FILE,
    },
    // Other keys, and a string that is no key read off an event.
    {
      code: 'function f(event) { return event.key === "Enter" || event.key === "Escape"; }',
      filename: PANEL_FILE,
    },
    { code: 'const label = "End"; const same = label === "End";', filename: PANEL_FILE },
    // A row of words is data, even where the first word is a key's name.
    { code: 'const pages = [["Home", "/"], ["End", "/end"]];', filename: PANEL_FILE },
    // A list stepped through the helper names no key.
    {
      code: "function List({ rows }) { const roving = useRovingKeys({ orientation: ROVING_ORIENTATION.VERTICAL }); return <ul ref={roving.box}>{rows}</ul>; }",
      filename: PANEL_FILE,
    },
  ],
  invalid: [
    {
      code: STEPPING_BY_HAND,
      filename: PANEL_FILE,
      errors: [{ messageId: "arrowKey", data: { key: "ArrowDown" } }],
    },
    {
      code: 'function f(event) { if (event.key !== "ArrowUp" && event.code !== "Home") return; }',
      filename: PANEL_FILE,
      errors: [
        { messageId: "arrowKey", data: { key: "ArrowUp" } },
        { messageId: "arrowKey", data: { key: "Home" } },
      ],
    },
    {
      code: 'function f(event) { switch (event.key) { case "ArrowLeft": return -1; case "ArrowRight": return 1; case "Enter": return 0; } }',
      filename: PANEL_FILE,
      errors: [
        { messageId: "arrowKey", data: { key: "ArrowLeft" } },
        { messageId: "arrowKey", data: { key: "ArrowRight" } },
      ],
    },
    {
      code: 'const STEP = new Map([["ArrowDown", 1], ["ArrowUp", -1]]);',
      filename: PANEL_FILE,
      errors: [
        { messageId: "arrowKey", data: { key: "ArrowDown" } },
        { messageId: "arrowKey", data: { key: "ArrowUp" } },
      ],
    },
    {
      code: "function f(event) { if (event.key === SHORTCUT_KEY.LEFT.key) return -1; }",
      filename: PANEL_FILE,
      errors: [{ messageId: "arrowKey", data: { key: "LEFT" } }],
    },
    {
      code: 'const down = "ArrowDown" === key;',
      filename: PANEL_FILE,
      errors: [{ messageId: "arrowKey", data: { key: "ArrowDown" } }],
    },
  ],
});

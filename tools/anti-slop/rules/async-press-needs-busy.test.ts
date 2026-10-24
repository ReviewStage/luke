import path from "node:path";
import { fileURLToPath } from "node:url";

import { RuleTester } from "oxlint/plugins-dev";
import { describe, it } from "vitest";

import { BUSY_BASELINE } from "../shared/busy-guard.ts";
import { asyncPressNeedsBusyRule } from "./async-press-needs-busy.ts";

const REPOSITORY_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "..",
);
const PANEL_FILE = path.join(REPOSITORY_ROOT, "packages/panel/src/tasks/example.tsx");
const UI_FILE = path.join(REPOSITORY_ROOT, "packages/ui/src/components/example/example.tsx");
const TEST_FILE = path.join(REPOSITORY_ROOT, "packages/panel/src/tasks/example.test.tsx");

// A file the baseline still holds, with how many buttons it holds it to.
const [BASELINED_PATH, BASELINED_COUNT] = [...Object.entries(BUSY_BASELINE)][0] ?? ["", 0];
const BASELINED_FILE = path.join(REPOSITORY_ROOT, BASELINED_PATH);

RuleTester.describe = describe;
RuleTester.it = it;

const tester = new RuleTester();

const IMPORT = 'import { Button, IconButton, ProviderButton } from "@luke/ui";\n';

function panel(code: string): { code: string; filename: string } {
  return { code: IMPORT + code, filename: PANEL_FILE };
}

/** `count` buttons that press an act and are not busy. */
function unbusy(count: number): string {
  return `${IMPORT}function A({ press }) { return <>${"<Button onClick={() => press(K)} />".repeat(count)}</>; }`;
}

tester.run("async-press-needs-busy", asyncPressNeedsBusyRule, {
  valid: [
    // An async press that says it is busy, however it holds the flag.
    panel(
      "function A({ press, busy }) { return <Button busy={busy} busyLabel='Saving' onClick={() => press(K)} />; }",
    ),
    panel(
      "function A({ save, busy }) { return <IconButton busy={busy} onClick={async () => { await save(); }} />; }",
    ),
    // A spread may carry busy, so it is allowed.
    panel("function A({ press, busy }) { return <Button {...busy} onClick={() => press(K)} />; }"),
    // A press that waits on nothing needs no busy.
    panel("function A({ open }) { return <Button onClick={() => open(K)} />; }"),
    panel("function A({ set }) { return <Button onClick={() => { set(1); }} />; }"),
    // A press the rule cannot read is no place: a prop, a member, an import.
    panel("function A({ onSave }) { return <Button onClick={onSave} />; }"),
    panel("function A({ save }) { return <Button onClick={save.onPress} />; }"),
    // An act started only inside a function the press defines is not the press's wait.
    panel(
      "function A({ press }) { return <Button onClick={() => { const later = () => press(K); later; }} />; }",
    ),
    // A name that is no `@luke/ui` button, or a lowercase element, is not the rule's.
    {
      code: 'import { Button } from "./my-button.js"; function A({ press }) { return <Button onClick={() => press(K)} />; }',
      filename: PANEL_FILE,
    },
    {
      code: 'import { TextButton } from "@luke/ui"; function A({ press }) { return <TextButton onClick={() => press(K)} />; }',
      filename: PANEL_FILE,
    },
    // A handler held under a name that is declared twice is no one function.
    panel(
      "function A({ press }) { const go = async () => press(K); return <Button onClick={go} />; } function B() { const go = () => 1; return null; }",
    ),
    // A test draws buttons for what they do.
    { code: unbusy(1), filename: TEST_FILE },
    // A file the baseline holds, at exactly the count it holds it to.
    ...(BASELINED_COUNT === 0 ? [] : [{ code: unbusy(BASELINED_COUNT), filename: BASELINED_FILE }]),
  ],
  invalid: [
    // An async function, an act, an await, a chained promise.
    {
      ...panel(
        "function A({ save }) { return <Button onClick={async () => { await save(); }} />; }",
      ),
      errors: [{ messageId: "noBusy", data: { tag: "Button" } }],
    },
    {
      ...panel("function A({ press }) { return <Button onClick={() => press(K)} />; }"),
      errors: [{ messageId: "noBusy" }],
    },
    {
      ...panel("function A({ press }) { return <IconButton onClick={() => void press(K)} />; }"),
      errors: [{ messageId: "noBusy", data: { tag: "IconButton" } }],
    },
    {
      ...panel(
        "function A({ save }) { return <Button onClick={() => { save().then(done); }} />; }",
      ),
      errors: [{ messageId: "noBusy" }],
    },
    {
      ...panel(
        "function A() { const { act } = useAct(); return <Button onClick={() => act.press(K)} />; }",
      ),
      errors: [{ messageId: "noBusy" }],
    },
    // A provider button's press is its `onPress`.
    {
      ...panel("function A({ press }) { return <ProviderButton onPress={() => press(K)} />; }"),
      errors: [{ messageId: "noBusy", data: { tag: "ProviderButton" } }],
    },
    // A handler held under a name in the same file, as a function, a constant, or one a hook hands back.
    {
      ...panel(
        "function A({ press }) { async function save() { await press(K); } return <Button onClick={save} />; }",
      ),
      errors: [{ messageId: "noBusy" }],
    },
    {
      ...panel(
        "function A({ press }) { const save = async () => { await press(K); }; return <Button onClick={save} />; }",
      ),
      errors: [{ messageId: "noBusy" }],
    },
    {
      ...panel(
        "function A({ press }) { const save = useCallback(() => press(K), []); return <Button onClick={save} />; }",
      ),
      errors: [{ messageId: "noBusy" }],
    },
    // Either branch of a conditional press.
    {
      ...panel(
        "function A({ press, on }) { return <Button onClick={on ? () => press(K) : undefined} />; }",
      ),
      errors: [{ messageId: "noBusy" }],
    },
    // A button under a `@luke/ui` subpath, or renamed on import.
    {
      code: 'import { Button as Press } from "@luke/ui/button"; function A({ press }) { return <Press onClick={() => press(K)} />; }',
      filename: PANEL_FILE,
      errors: [{ messageId: "noBusy" }],
    },
    // Inside `@luke/ui` a relative import is the button.
    {
      code: 'import { Button } from "../button/button.js"; function A({ press }) { return <Button onClick={() => press(K)} />; }',
      filename: UI_FILE,
      errors: [{ messageId: "noBusy" }],
    },
    // A file not on the baseline reports each button.
    {
      code: unbusy(2),
      filename: PANEL_FILE,
      errors: [{ messageId: "noBusy" }, { messageId: "noBusy" }],
    },
    // A baselined file holding one more than its count reports the one past it.
    {
      code: unbusy(BASELINED_COUNT + 1),
      filename: BASELINED_FILE,
      errors: [{ messageId: "noBusy" }],
    },
    // A baselined file holding fewer than its count says to lower it.
    {
      code: unbusy(BASELINED_COUNT - 1),
      filename: BASELINED_FILE,
      errors: [{ messageId: "staleBaseline" }],
    },
  ],
});

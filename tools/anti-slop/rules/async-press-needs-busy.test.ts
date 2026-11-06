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

const [BASELINED_PATH, BASELINED_COUNT] = [...Object.entries(BUSY_BASELINE)][0] ?? ["", 0];
const BASELINED_FILE = path.join(REPOSITORY_ROOT, BASELINED_PATH);

RuleTester.describe = describe;
RuleTester.it = it;

const tester = new RuleTester();

const IMPORT = 'import { Button, IconButton, ProviderButton } from "@repo/ui";\n';

function panel(code: string): { code: string; filename: string } {
  return { code: IMPORT + code, filename: PANEL_FILE };
}

function unbusy(count: number): string {
  return `${IMPORT}function A({ press }) { return <>${"<Button onClick={() => press(K)} />".repeat(count)}</>; }`;
}

tester.run("async-press-needs-busy", asyncPressNeedsBusyRule, {
  valid: [
    panel(
      "function A({ press, busy }) { return <Button busy={busy} busyLabel='Saving' onClick={() => press(K)} />; }",
    ),
    panel(
      "function A({ save, busy }) { return <IconButton busy={busy} onClick={async () => { await save(); }} />; }",
    ),
    panel("function A({ press, busy }) { return <Button {...busy} onClick={() => press(K)} />; }"),
    panel("function A({ open }) { return <Button onClick={() => open(K)} />; }"),
    panel("function A({ set }) { return <Button onClick={() => { set(1); }} />; }"),
    panel("function A({ onSave }) { return <Button onClick={onSave} />; }"),
    panel("function A({ save }) { return <Button onClick={save.onPress} />; }"),
    panel(
      "function A({ press }) { return <Button onClick={() => { const later = () => press(K); later; }} />; }",
    ),
    panel("function A() { const open = () => set(1); return <Button onClick={() => open()} />; }"),
    panel(
      "function A() { function again() { again(); } return <Button onClick={() => again()} />; }",
    ),
    {
      code: 'import { Button } from "./my-button.js"; function A({ press }) { return <Button onClick={() => press(K)} />; }',
      filename: PANEL_FILE,
    },
    {
      code: 'import { TextButton } from "@repo/ui"; function A({ press }) { return <TextButton onClick={() => press(K)} />; }',
      filename: PANEL_FILE,
    },
    panel(
      "function A({ press }) { const go = async () => press(K); return <Button onClick={go} />; } function B() { const go = () => 1; return null; }",
    ),
    { code: unbusy(1), filename: TEST_FILE },
    ...(BASELINED_COUNT === 0 ? [] : [{ code: unbusy(BASELINED_COUNT), filename: BASELINED_FILE }]),
  ],
  invalid: [
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
    {
      ...panel("function A({ press }) { return <ProviderButton onPress={() => press(K)} />; }"),
      errors: [{ messageId: "noBusy", data: { tag: "ProviderButton" } }],
    },
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
    {
      ...panel(
        "function A() { const send = async () => { await go(); }; return <Button onClick={() => void send()} />; }",
      ),
      errors: [{ messageId: "noBusy" }],
    },
    {
      ...panel(
        "function A({ press, on }) { return <Button onClick={on ? () => press(K) : undefined} />; }",
      ),
      errors: [{ messageId: "noBusy" }],
    },
    {
      code: 'import { Button as Press } from "@repo/ui/button"; function A({ press }) { return <Press onClick={() => press(K)} />; }',
      filename: PANEL_FILE,
      errors: [{ messageId: "noBusy" }],
    },
    {
      code: 'import { Button } from "../button/button.js"; function A({ press }) { return <Button onClick={() => press(K)} />; }',
      filename: UI_FILE,
      errors: [{ messageId: "noBusy" }],
    },
    {
      code: unbusy(2),
      filename: PANEL_FILE,
      errors: [{ messageId: "noBusy" }, { messageId: "noBusy" }],
    },
    ...(BASELINED_COUNT === 0
      ? []
      : [
          {
            code: unbusy(BASELINED_COUNT + 1),
            filename: BASELINED_FILE,
            errors: [{ messageId: "noBusy" }],
          },
          {
            code: unbusy(BASELINED_COUNT - 1),
            filename: BASELINED_FILE,
            errors: [{ messageId: "staleBaseline" }],
          },
        ]),
  ],
});

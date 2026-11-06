import path from "node:path";
import { fileURLToPath } from "node:url";

import { RuleTester } from "oxlint/plugins-dev";
import { describe, it } from "vitest";

import { noOpenPageFromButtonRule } from "./no-open-page-from-button.ts";

const REPOSITORY_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "..",
);
const PANEL_FILE = path.join(REPOSITORY_ROOT, "packages/panel/src/tasks/example.tsx");
const UI_FILE = path.join(REPOSITORY_ROOT, "packages/ui/src/components/example/example.tsx");
const TEST_FILE = path.join(REPOSITORY_ROOT, "packages/panel/src/tasks/example.test.tsx");

RuleTester.describe = describe;
RuleTester.it = it;

const tester = new RuleTester();

const IMPORT = 'import { Button, ButtonLink, Chip, TextButton, TextLink } from "@repo/ui";\n';

function panel(code: string): { code: string; filename: string } {
  return { code: IMPORT + code, filename: PANEL_FILE };
}

tester.run("no-open-page-from-button", noOpenPageFromButtonRule, {
  valid: [
    panel(
      "function A({ openLink }) { return <ButtonLink href={U} onClick={(event) => { event.preventDefault(); openLink(U); }} />; }",
    ),
    panel("function A({ openLink }) { return <TextLink href={U} onClick={() => openLink(U)} />; }"),
    panel("function A() { return <Chip href={U} />; }"),
    panel("function A({ select }) { return <Button onClick={() => select(K)} />; }"),
    panel("function A({ openTab }) { return <TextButton onClick={() => openTab(K)} />; }"),
    panel("function A({ onOpen }) { return <Button onClick={onOpen} />; }"),
    panel("function A({ doors }) { return <Button onClick={doors.open} />; }"),
    panel(
      "function A({ openLink }) { return <Button onClick={() => { const later = () => openLink(U); later; }} />; }",
    ),
    {
      code: 'import { Button } from "./my-button.js"; function A({ openLink }) { return <Button onClick={() => openLink(U)} />; }',
      filename: PANEL_FILE,
    },
    panel(
      "function A({ openLink }) { const go = () => openLink(U); return <Button onClick={go} />; } function B() { const go = () => 1; return null; }",
    ),
    {
      code: 'import { Button } from "../button/button.js"; function A({ openLink }) { return <Button onClick={() => openLink(U)} />; }',
      filename: UI_FILE,
    },
    {
      code: `${IMPORT}function A({ openLink }) { return <Button onClick={() => openLink(U)} />; }`,
      filename: TEST_FILE,
    },
  ],
  invalid: [
    {
      ...panel("function A({ openLink }) { return <Button onClick={() => openLink(U)} />; }"),
      errors: [{ messageId: "opensPage", data: { tag: "Button" } }],
    },
    {
      ...panel(
        "function A() { return <TextButton onClick={() => appPlatform().openGitHub(U)} />; }",
      ),
      errors: [{ messageId: "opensPage", data: { tag: "TextButton" } }],
    },
    {
      ...panel(
        "function A({ shell }) { return <Button onClick={() => shell.openExternal(U)} />; }",
      ),
      errors: [{ messageId: "opensPage" }],
    },
    {
      ...panel("function A() { return <Chip onClick={() => window.open(U, '_blank')} />; }"),
      errors: [{ messageId: "opensPage", data: { tag: "Chip" } }],
    },
    {
      ...panel(
        "function A({ openUrl, track }) { return <Button onClick={() => { track(); openUrl(U); }} />; }",
      ),
      errors: [{ messageId: "opensPage" }],
    },
    {
      ...panel(
        "function A({ openLink }) { function go() { openLink(U); } return <Button onClick={go} />; }",
      ),
      errors: [{ messageId: "opensPage" }],
    },
    {
      ...panel(
        "function A({ openLink }) { const go = useCallback(() => openLink(U), []); return <Button onClick={go} />; }",
      ),
      errors: [{ messageId: "opensPage" }],
    },
    {
      ...panel(
        "function A({ openLink }) { const go = () => openLink(U); return <Button onClick={() => go()} />; }",
      ),
      errors: [{ messageId: "opensPage" }],
    },
    {
      ...panel(
        "function A({ openLink, on }) { return <Button onClick={on ? () => openLink(U) : undefined} />; }",
      ),
      errors: [{ messageId: "opensPage" }],
    },
    {
      code: 'import { Button as Press } from "@repo/ui/button"; function A({ openLink }) { return <Press onClick={() => openLink(U)} />; }',
      filename: PANEL_FILE,
      errors: [{ messageId: "opensPage" }],
    },
    {
      ...panel(
        "function A({ openLink }) { return <><Button onClick={() => openLink(U)} /><Button onClick={() => openLink(V)} /></>; }",
      ),
      errors: [{ messageId: "opensPage" }, { messageId: "opensPage" }],
    },
  ],
});

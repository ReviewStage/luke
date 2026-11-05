import path from "node:path";
import { fileURLToPath } from "node:url";

import { RuleTester } from "oxlint/plugins-dev";
import { describe, it } from "vitest";

import { noPlaceholderEllipsisRule } from "./no-placeholder-ellipsis.ts";

const REPOSITORY_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "..",
);
const PANEL_FILE = path.join(REPOSITORY_ROOT, "packages/panel/src/tasks/example.tsx");

RuleTester.describe = describe;
RuleTester.it = it;

const tester = new RuleTester();

function panel(code: string): { code: string; filename: string } {
  return { code, filename: PANEL_FILE };
}

tester.run("no-placeholder-ellipsis", noPlaceholderEllipsisRule, {
  valid: [
    // An instruction ends on its last word.
    panel('function A() { return <SearchField placeholder="Search workspaces" />; }'),
    // A value's shape keeps its elided rest.
    panel('function A() { return <SecretField placeholder="ghp_…" />; }'),
    // Words that are no placeholder are another rule's.
    panel('function A() { return <Button label="Delete task…" />; }'),
    // A value read off a name cannot be told.
    panel("function A() { return <TextField placeholder={WORDS.SEARCH} />; }"),
  ],
  invalid: [
    {
      code: 'function A() { return <Combobox placeholder="Assign to…" />; }',
      filename: PANEL_FILE,
      errors: [{ messageId: "trailingEllipsis", data: { words: "Assign to…" } }],
    },
    // Three dots, an object's property, and a built template's tail are refused alike.
    {
      code: [
        'const COPY = { placeholder: "Search by name or email..." };',
        "const field = { placeholder: `Search ${count} skills…` };",
        'function A() { return <TextField placeholder={open ? "Reply" : "Comment …"} />; }',
      ].join("\n"),
      filename: PANEL_FILE,
      errors: [
        { messageId: "trailingEllipsis", data: { words: "Search by name or email..." } },
        { messageId: "trailingEllipsis", data: { words: " skills…" } },
        { messageId: "trailingEllipsis", data: { words: "Comment …" } },
      ],
    },
  ],
});

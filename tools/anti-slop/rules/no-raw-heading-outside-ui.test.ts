import path from "node:path";
import { fileURLToPath } from "node:url";

import { RuleTester } from "oxlint/plugins-dev";
import { describe, it } from "vitest";

import { noRawHeadingOutsideUiRule } from "./no-raw-heading-outside-ui.ts";

const REPOSITORY_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "..",
);
const PANEL_FILE = path.join(REPOSITORY_ROOT, "packages/panel/src/tasks/example.tsx");
const WEB_FILE = path.join(REPOSITORY_ROOT, "apps/web/src/example.tsx");
const CATALOG_FILE = path.join(REPOSITORY_ROOT, "apps/catalog/src/examples/example.tsx");
const UI_FILE = path.join(REPOSITORY_ROOT, "packages/ui/src/components/example/example.tsx");

RuleTester.describe = describe;
RuleTester.it = it;

const tester = new RuleTester();

function panel(code: string): { code: string; filename: string } {
  return { code, filename: PANEL_FILE };
}

tester.run("no-raw-heading-outside-ui", noRawHeadingOutsideUiRule, {
  valid: [
    panel(
      "function A() { return <Text variant={TEXT_VARIANT.GROUP} as={TEXT_ELEMENT.H2}>Settings</Text>; }",
    ),
    panel("function A() { return <div><p>Words</p><span>More</span></div>; }"),
    panel('const PAGE = "<h1>A page</h1>"; function A() { return <iframe srcDoc={PAGE} />; }'),
    panel("function A() { return <H2>Words</H2>; }"),
    { code: "function A() { return <h2 id={titleId}>Words</h2>; }", filename: UI_FILE },
  ],
  invalid: [
    {
      code: "function A() { return <h2>Settings</h2>; }",
      filename: PANEL_FILE,
      errors: [{ messageId: "rawHeading", data: { tag: "h2", element: "H2" } }],
    },
    {
      code: 'function A() { return <h1 className="title">Vespin</h1>; }',
      filename: WEB_FILE,
      errors: [{ messageId: "rawHeading", data: { tag: "h1", element: "H1" } }],
    },
    {
      code: "function A() { return <section><h3>One</h3><h6>Two</h6></section>; }",
      filename: CATALOG_FILE,
      errors: [
        { messageId: "rawHeading", data: { tag: "h3", element: "H3" } },
        { messageId: "rawHeading", data: { tag: "h6", element: "H6" } },
      ],
    },
    {
      code: "function A() { return <h4>Words</h4>; }",
      filename: path.join(REPOSITORY_ROOT, "packages/panel/src/tasks/example.test.tsx"),
      errors: [{ messageId: "rawHeading", data: { tag: "h4", element: "H4" } }],
    },
  ],
});

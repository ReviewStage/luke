import path from "node:path";
import { fileURLToPath } from "node:url";

import { RuleTester } from "oxlint/plugins-dev";
import { describe, it } from "vitest";

import { noBrowserFormValidationRule } from "./no-browser-form-validation.ts";

const REPOSITORY_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "..",
);
const PANEL_FILE = path.join(REPOSITORY_ROOT, "packages/panel/src/settings/example.tsx");
const UI_FILE = path.join(REPOSITORY_ROOT, "packages/ui/src/components/example/example.tsx");

RuleTester.describe = describe;
RuleTester.it = it;

const tester = new RuleTester();

tester.run("no-browser-form-validation", noBrowserFormValidationRule, {
  valid: [
    {
      code: "function A() { return <form noValidate onSubmit={save}><Field /></form>; }",
      filename: PANEL_FILE,
    },
    { code: "function A() { return <Form onSubmit={save} />; }", filename: PANEL_FILE },
  ],
  invalid: [
    {
      code: "function A() { return <form onSubmit={save}><Field /></form>; }",
      filename: PANEL_FILE,
      errors: [{ messageId: "browserChecked" }],
    },
    {
      code: "function A() { return <form noValidate={false} />; }",
      filename: UI_FILE,
      errors: [{ messageId: "browserChecked" }],
    },
  ],
});

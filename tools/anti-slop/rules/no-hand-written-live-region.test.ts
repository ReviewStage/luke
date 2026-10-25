import path from "node:path";
import { fileURLToPath } from "node:url";

import { RuleTester } from "oxlint/plugins-dev";
import { describe, it } from "vitest";

import { noHandWrittenLiveRegionRule } from "./no-hand-written-live-region.ts";

const REPOSITORY_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "..",
);
const PANEL_FILE = path.join(REPOSITORY_ROOT, "packages/panel/src/tasks/example.tsx");
const WEB_FILE = path.join(REPOSITORY_ROOT, "apps/web/src/example.tsx");
const UI_FILE = path.join(REPOSITORY_ROOT, "packages/ui/src/components/example/example.tsx");

RuleTester.describe = describe;
RuleTester.it = it;

const tester = new RuleTester();

function panel(code: string): { code: string; filename: string } {
  return { code, filename: PANEL_FILE };
}

tester.run("no-hand-written-live-region", noHandWrittenLiveRegionRule, {
  valid: [
    // `@luke/ui` draws the visible blocks and the announcer, which keep their roles.
    { code: 'function A() { return <p role="alert">Words</p>; }', filename: UI_FILE },
    { code: 'function A() { return <div aria-live="polite" />; }', filename: UI_FILE },
    // Other roles are no live region.
    panel('function A() { return <div role="dialog"><ul role="list" /></div>; }'),
    // A component's own props name no intrinsic element.
    panel('function A() { return <ScrollArea role="log" aria-live="off" />; }'),
    // A role no one can read as a literal is left alone.
    panel("function A() { return <div role={role} />; }"),
    // Words said through the announcer.
    panel("function A() { announce(ANNOUNCE.POLITE, words); return <div>{words}</div>; }"),
  ],
  invalid: [
    {
      code: 'function A() { return <div role="status">Saving</div>; }',
      filename: PANEL_FILE,
      errors: [{ messageId: "liveRegion", data: { tag: "div", what: 'role="status"' } }],
    },
    {
      code: 'function A() { return <p role="alert">Failed</p>; }',
      filename: WEB_FILE,
      errors: [{ messageId: "liveRegion", data: { tag: "p", what: 'role="alert"' } }],
    },
    {
      code: 'function A() { return <ol role="log" />; }',
      filename: PANEL_FILE,
      errors: [{ messageId: "liveRegion", data: { tag: "ol", what: 'role="log"' } }],
    },
    // Any `aria-live` is one, even one that says `off`.
    {
      code: 'function A() { return <div aria-live="off" />; }',
      filename: PANEL_FILE,
      errors: [{ messageId: "liveRegion", data: { tag: "div", what: "aria-live" } }],
    },
    // A role chosen between two literals, one of them live.
    {
      code: 'function A({ s }) { return <span role={s ? "status" : undefined}>x</span>; }',
      filename: PANEL_FILE,
      errors: [{ messageId: "liveRegion", data: { tag: "span", what: 'role="status"' } }],
    },
    // A test's fixture is drawn like any other file.
    {
      code: 'function A() { return <div role="status" />; }',
      filename: path.join(REPOSITORY_ROOT, "packages/panel/src/tasks/example.test.tsx"),
      errors: [{ messageId: "liveRegion", data: { tag: "div", what: 'role="status"' } }],
    },
  ],
});

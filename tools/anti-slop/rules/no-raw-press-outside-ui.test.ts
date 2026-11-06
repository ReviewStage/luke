import path from "node:path";
import { fileURLToPath } from "node:url";

import { RuleTester } from "oxlint/plugins-dev";
import { describe, it } from "vitest";

import { noRawPressOutsideUiRule } from "./no-raw-press-outside-ui.ts";

const REPOSITORY_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "..",
);
const PANEL_FILE = path.join(REPOSITORY_ROOT, "packages/panel/src/tasks/example.tsx");
const WEB_FILE = path.join(REPOSITORY_ROOT, "apps/web/src/example.tsx");
const DESKTOP_FILE = path.join(REPOSITORY_ROOT, "apps/desktop/src/renderer/example.tsx");
const CATALOG_FILE = path.join(REPOSITORY_ROOT, "apps/catalog/src/examples/example.tsx");
const PANEL_TEST_FILE = path.join(REPOSITORY_ROOT, "packages/panel/src/tasks/example.test.tsx");
const UI_FILE = path.join(REPOSITORY_ROOT, "packages/ui/src/components/example/example.tsx");

RuleTester.describe = describe;
RuleTester.it = it;

const tester = new RuleTester();

function panel(code: string): { code: string; filename: string } {
  return { code, filename: PANEL_FILE };
}

tester.run("no-raw-press-outside-ui", noRawPressOutsideUiRule, {
  valid: [
    panel("<Button onClick={go} />"),
    panel("<Chip onPointerDown={go} onContextMenu={menu} />"),
    panel("<Menu.Item onClick={go} />"),
    panel(
      "<div onPointerEnter={a} onPointerLeave={a} onPointerMove={a} onMouseOver={a} onMouseOut={a} />",
    ),
    panel("<li onDragStart={a} onDragOver={a} onDrop={a} onDragEnd={a} />"),
    panel("<section onFocus={a} onBlur={a} onWheel={a} onScroll={a} />"),
    panel("<div onPaste={a} onCopy={a} onCut={a} onAnimationEnd={a} onTransitionEnd={a} />"),
    panel("<div onKeyDown={rove} />"),
    panel("<search onKeyUpCapture={escape} />"),
    panel("<div contentEditable={false} onKeyDown={rove} />"),
    panel("<li {...menu.contextMenu()} />"),
    panel("<div tabIndex={0} />"),
    panel('<input type="hidden" name="width" value={width} />'),
    panel('<div role="group" />'),
    panel('<a role="link" href={url} />'),
    panel('<div role={narrow ? "tabpanel" : undefined} />'),
    panel('<span role={gone ? null : "status"} />'),
    panel("<Controls.button onClick={go} />"),
    panel("<example.Render />"),
    { code: "<button onClick={go} />", filename: UI_FILE },
    {
      code: '<div role="tab" tabIndex={0} onKeyDown={key} onPointerDown={go} />',
      filename: UI_FILE,
    },
  ],
  invalid: [
    { ...panel("<button>Go</button>"), errors: [{ messageId: "rawControl" }] },
    { code: "<input />", filename: WEB_FILE, errors: [{ messageId: "rawControl" }] },
    { code: "<select />", filename: DESKTOP_FILE, errors: [{ messageId: "rawControl" }] },
    { code: "<textarea />", filename: CATALOG_FILE, errors: [{ messageId: "rawControl" }] },
    { code: "<summary />", filename: PANEL_TEST_FILE, errors: [{ messageId: "rawControl" }] },
    { ...panel("<motion.button />"), errors: [{ messageId: "rawControl" }] },
    { ...panel("<input type={kind} />"), errors: [{ messageId: "rawControl" }] },
    {
      ...panel('<input type={secret ? "hidden" : "text"} />'),
      errors: [{ messageId: "rawControl" }],
    },
    {
      ...panel("<button {...menu.contextMenu()} />"),
      errors: [{ messageId: "rawControl" }],
    },
    {
      ...panel("<button onClick={go} />"),
      errors: [{ messageId: "rawControl" }, { messageId: "pressEvent" }],
    },
    {
      ...panel('<input type={hidden ? "hidden" : kind} />'),
      errors: [{ messageId: "rawControl" }],
    },
    {
      ...panel('<input type="hidden" {...props} />'),
      errors: [{ messageId: "rawControl" }],
    },
    { ...panel("<div role={role} />"), errors: [{ messageId: "unknownRole" }] },
    {
      ...panel('<div role={open ? "group" : role} />'),
      errors: [{ messageId: "unknownRole" }],
    },
    { ...panel("<motion.div onClick={go} />"), errors: [{ messageId: "pressEvent" }] },
    ...[
      "button",
      "tab",
      "option",
      "menuitem",
      "menuitemcheckbox",
      "menuitemradio",
      "radio",
      "checkbox",
      "switch",
      "slider",
      "link",
    ].map((role) => ({
      ...panel(`<div role="${role}" />`),
      errors: [{ messageId: "pressableRole", data: { role, tag: "div" } }],
    })),
    {
      ...panel('<span role={open ? "tab" : "presentation"} />'),
      errors: [{ messageId: "pressableRole" }],
    },
    ...[
      "onClick",
      "onDoubleClick",
      "onAuxClick",
      "onContextMenu",
      "onMouseDown",
      "onMouseUp",
      "onPointerDown",
      "onPointerUp",
      "onTouchStart",
      "onTouchEnd",
    ].flatMap((event) =>
      [event, `${event}Capture`].map((name) => ({
        ...panel(`<div ${name}={handle} />`),
        errors: [{ messageId: "pressEvent", data: { event: name, tag: "div" } }],
      })),
    ),
    { code: "<li onClick={go} />", filename: WEB_FILE, errors: [{ messageId: "pressEvent" }] },
    {
      ...panel("<div tabIndex={0} onKeyDown={key} />"),
      errors: [
        { messageId: "focusableKey", data: { event: "onKeyDown", tag: "div", focus: "tabIndex" } },
      ],
    },
    {
      ...panel("<div tabIndex={-1} onKeyUp={key} />"),
      errors: [{ messageId: "focusableKey" }],
    },
    {
      ...panel("<div contentEditable onKeyDownCapture={key} />"),
      errors: [{ messageId: "focusableKey" }],
    },
    {
      ...panel('<div contentEditable="plaintext-only" onKeyUpCapture={key} />'),
      errors: [{ messageId: "focusableKey" }],
    },
  ],
});

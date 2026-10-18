// @vitest-environment jsdom

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, test } from "vitest";
import {
  BUTTON_SHAPE,
  BUTTON_SIZE,
  BUTTON_TYPE,
  BUTTON_VARIANT,
  Button,
  ButtonLink,
  IconButton,
  IconButtonLink,
  SUBMIT_STATE,
} from "./button.js";

/**
 * button.test.ts -- a ButtonLink is a link a reader finds by its words,
 * going where its address says, and its press is heard before the browser
 * follows it. A button that is not tabbable is left out of the tab order,
 * yet takes the focus a roving group hands it and is pressed as any other;
 * an ordinary button stays a Tab stop. A button that keeps focus leaves it
 * on the field that held it when a pointer presses it. A labelled button
 * given a label is named by it, which holds its words. An IconButtonLink is
 * a link named by its label, and one in a new tab opens there. A compact row
 * mark is a button named by its label like any other, its right-click heard
 * so it can offer its row's menu, and an unavailable one is pressed to no
 * effect, as is an unavailable compact labelled button, which is named by
 * its words. A submit sends its form while it takes a press, sends nothing
 * while it is unavailable, and made a Stop does its own act without
 * sending the form.
 */

const roots: Root[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount());
  document.body.replaceChildren();
});

/** Draws `element` into a fresh container on the page. */
function mount(element: React.ReactElement): HTMLElement {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  act(() => root.render(element));
  return container;
}

test("a ButtonLink is a link named by its words, going to its address", () => {
  const container = mount(
    createElement(ButtonLink, {
      href: "https://example.com/luke.dmg",
      variant: BUTTON_VARIANT.PRIMARY,
      icon: createElement("svg", { "aria-hidden": true }),
      children: "Download for macOS",
    }),
  );

  const links = Array.from(container.querySelectorAll("a"));
  expect(links.map((link) => [link.textContent, link.getAttribute("href")])).toEqual([
    ["Download for macOS", "https://example.com/luke.dmg"],
  ]);
  expect(container.querySelector("button")).toBeNull();
});

test("a press on a ButtonLink is heard, and the link is still followed", () => {
  const presses: boolean[] = [];
  const container = mount(
    createElement(ButtonLink, {
      href: "tryluke://tryluke.dev/acme",
      onClick: (event) => presses.push(event.defaultPrevented),
      children: "Open in Luke",
    }),
  );
  const link = container.querySelector("a");
  expect(link).not.toBeNull();
  // Note that jsdom cannot follow a link, so the page stops it once the press has bubbled past the component.
  document.addEventListener("click", (event) => event.preventDefault(), { once: true });

  act(() => link?.click());

  expect(presses).toEqual([false]);
});

test("a button that is not tabbable is skipped by Tab, yet takes the focus handed to it and its press", () => {
  const pressed: string[] = [];
  const container = mount(
    createElement(
      "div",
      null,
      createElement(Button, { onClick: () => pressed.push("Save"), children: "Save" }),
      createElement(IconButton, {
        icon: createElement("svg"),
        label: "Section actions",
        tabbable: false,
        onClick: () => pressed.push("Section actions"),
      }),
    ),
  );
  const [save, more] = Array.from(container.querySelectorAll("button"));

  expect(save?.tabIndex).toBe(0);
  expect(more?.tabIndex).toBe(-1);

  act(() => more?.focus());
  expect(document.activeElement).toBe(more);
  act(() => more?.click());
  expect(pressed).toEqual(["Section actions"]);
});

test("a button that keeps focus, pressed with the pointer, leaves the focus on the field and is pressed", () => {
  const pressed: string[] = [];
  const container = mount(
    createElement(
      "div",
      null,
      createElement("input", { "aria-label": "Search" }),
      createElement(IconButton, {
        icon: createElement("svg"),
        label: "Back",
        keepFocus: true,
        onClick: () => pressed.push("Back"),
      }),
      createElement(Button, { onClick: () => pressed.push("Connect"), children: "Connect" }),
    ),
  );
  const field = container.querySelector("input");
  const [back, connect] = Array.from(container.querySelectorAll("button"));
  if (field === null || back === undefined || connect === undefined) throw new Error("not drawn");
  act(() => field.focus());

  // Note that jsdom moves no focus on a mousedown, so the browser's move is read as the press's default action.
  const press = (button: HTMLButtonElement) => {
    const down = new MouseEvent("mousedown", { bubbles: true, cancelable: true });
    act(() => {
      button.dispatchEvent(down);
      if (!down.defaultPrevented) button.focus();
      button.click();
    });
  };

  press(back);
  expect(document.activeElement).toBe(field);
  press(connect);
  expect(document.activeElement).toBe(connect);
  expect(pressed).toEqual(["Back", "Connect"]);
});

test("a toggle is announced pressed while it is on, in any look, and a plain button as no toggle at all", () => {
  const container = mount(
    createElement(
      "div",
      null,
      createElement(IconButton, {
        icon: createElement("svg"),
        label: "Mute microphone",
        variant: BUTTON_VARIANT.DANGER,
        shape: BUTTON_SHAPE.ROUND,
        pressed: false,
      }),
      createElement(IconButton, {
        icon: createElement("svg"),
        label: "Unmute speaker",
        variant: BUTTON_VARIANT.DANGER,
        shape: BUTTON_SHAPE.ROUND,
        pressed: true,
      }),
      createElement(IconButton, {
        icon: createElement("svg"),
        label: "End call",
        variant: BUTTON_VARIANT.INK,
        shape: BUTTON_SHAPE.ROUND,
      }),
    ),
  );

  expect(
    container.querySelector('button[aria-label="Mute microphone"]')?.getAttribute("aria-pressed"),
  ).toBe("false");
  expect(
    container.querySelector('button[aria-label="Unmute speaker"]')?.getAttribute("aria-pressed"),
  ).toBe("true");
  expect(
    container.querySelector('button[aria-label="End call"]')?.hasAttribute("aria-pressed"),
  ).toBe(false);
});

test("a labelled button given a label is named by it, its words within it, and by its busy words while busy", () => {
  const container = mount(
    createElement(
      "div",
      null,
      createElement(Button, { label: "Start a coding agent", children: "Start" }),
      createElement(Button, {
        label: "Start a coding agent",
        busy: true,
        busyLabel: "Starting",
        children: "Start",
      }),
    ),
  );
  const said = Array.from(container.querySelectorAll("button"), (button) => [
    button.getAttribute("aria-label"),
    button.textContent,
  ]);

  expect(said).toEqual([
    ["Start a coding agent", "Start"],
    ["Starting", "Start"],
  ]);
  expect(said[0]?.[0]).toContain(said[0]?.[1]);
});

test("an IconButtonLink is a link named by its label, and one in a new tab opens there", () => {
  const container = mount(
    createElement(
      "div",
      null,
      createElement(IconButtonLink, {
        href: "https://github.com/example/luke",
        icon: createElement("svg", { "aria-hidden": true }),
        label: "Luke on GitHub",
      }),
      createElement(IconButtonLink, {
        href: "https://x.com/example",
        icon: createElement("svg", { "aria-hidden": true }),
        label: "Example on X",
        newTab: true,
      }),
    ),
  );

  const links = Array.from(container.querySelectorAll("a"));
  expect(
    links.map((link) => [
      link.getAttribute("aria-label"),
      link.getAttribute("href"),
      link.getAttribute("target"),
    ]),
  ).toEqual([
    ["Luke on GitHub", "https://github.com/example/luke", null],
    ["Example on X", "https://x.com/example", "_blank"],
  ]);
  expect(container.querySelector("button")).toBeNull();
});

test("a compact row mark is found by its label, pressed, and right-clicked, and refuses its press while unavailable", () => {
  const pressed: string[] = [];
  const container = mount(
    createElement(
      "div",
      null,
      createElement(IconButton, {
        icon: createElement("svg"),
        label: "Pin Launch notes",
        size: BUTTON_SIZE.COMPACT,
        onClick: () => pressed.push("Pin"),
        onContextMenu: () => pressed.push("Row menu"),
      }),
      createElement(IconButton, {
        icon: createElement("svg"),
        label: "Archive Launch notes",
        size: BUTTON_SIZE.COMPACT,
        disabled: true,
        onClick: () => pressed.push("Archive"),
      }),
    ),
  );
  const pin = container.querySelector<HTMLButtonElement>('button[aria-label="Pin Launch notes"]');
  const archive = container.querySelector<HTMLButtonElement>(
    'button[aria-label="Archive Launch notes"]',
  );

  act(() => pin?.click());
  act(() => pin?.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true })));
  act(() => archive?.click());

  expect(archive?.disabled).toBe(true);
  expect(pressed).toEqual(["Pin", "Row menu"]);
});

test("a compact labelled button is named by its words, pressed, and refuses its press while unavailable", () => {
  const pressed: string[] = [];
  const container = mount(
    createElement(
      "div",
      null,
      createElement(Button, {
        size: BUTTON_SIZE.COMPACT,
        onClick: () => pressed.push("Restart"),
        children: "Restart",
      }),
      createElement(Button, {
        size: BUTTON_SIZE.COMPACT,
        disabled: true,
        onClick: () => pressed.push("Download"),
        children: "Download",
      }),
    ),
  );
  const [restart, download] = [...container.querySelectorAll("button")];

  act(() => restart?.click());
  act(() => download?.click());

  expect(restart?.textContent).toBe("Restart");
  expect(download?.disabled).toBe(true);
  expect(pressed).toEqual(["Restart"]);
});

/** Draws a form holding `submit`, and answers how many times the form was sent. */
function mountForm(submit: React.ReactElement) {
  let sent = 0;
  const container = mount(
    createElement(
      "form",
      {
        onSubmit: (event: React.FormEvent) => {
          event.preventDefault();
          sent += 1;
        },
      },
      submit,
    ),
  );
  return { container, sent: () => sent };
}

test("a ready submit sends its form, and an unavailable one sends nothing", () => {
  const ready = mountForm(
    createElement(IconButton, {
      submit: SUBMIT_STATE.READY,
      type: BUTTON_TYPE.SUBMIT,
      label: "Send",
      variant: BUTTON_VARIANT.INK,
    }),
  );
  const held = mountForm(
    createElement(IconButton, {
      submit: SUBMIT_STATE.READY,
      type: BUTTON_TYPE.SUBMIT,
      label: "Send",
      variant: BUTTON_VARIANT.INK,
      disabled: true,
    }),
  );

  act(() => ready.container.querySelector("button")?.click());
  act(() => held.container.querySelector("button")?.click());

  expect(ready.sent()).toBe(1);
  expect(held.sent()).toBe(0);
});

test("a streaming submit made the Stop does its own act, named Stop, without sending the form", () => {
  const stops: string[] = [];
  const form = mountForm(
    createElement(IconButton, {
      submit: SUBMIT_STATE.STREAMING,
      label: "Stop",
      variant: BUTTON_VARIANT.INK,
      onClick: () => stops.push("Stop"),
    }),
  );
  const stop = form.container.querySelector<HTMLButtonElement>('button[aria-label="Stop"]');

  act(() => stop?.click());

  expect(stops).toEqual(["Stop"]);
  expect(form.sent()).toBe(0);
});

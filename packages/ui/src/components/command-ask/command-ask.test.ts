// @vitest-environment jsdom

import assert from "node:assert/strict";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, test } from "vitest";
import { CommandAsk } from "./command-ask.js";

/**
 * command-ask.test.ts -- the ask lands on Deny, names itself and shows the
 * command as written; each answer is heard as its own; and Escape, which
 * waves the card away, denies rather than runs.
 */

const COMMAND = "git -C ~/code/app status";

const roots: Root[] = [];

beforeAll(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
});

afterEach(() => {
  act(() => {
    for (const root of roots.splice(0)) root.unmount();
  });
  document.body.replaceChildren();
});

/** The button whose name is `name`, wherever it stands. */
function button(name: string): HTMLButtonElement {
  return (
    [...document.querySelectorAll("button")].find((each) => each.textContent === name) ??
    assert.fail(`no ${name} button`)
  );
}

/** The ask drawn, each answer counted under its name. */
function asked(command = COMMAND): Record<"once" | "always" | "deny", number> {
  const heard = { once: 0, always: 0, deny: 0 };
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  act(() =>
    root.render(
      createElement(CommandAsk, {
        open: true,
        command,
        onAllowOnce: () => {
          heard.once += 1;
        },
        onAllowAlways: () => {
          heard.always += 1;
        },
        onDeny: () => {
          heard.deny += 1;
        },
      }),
    ),
  );
  return heard;
}

test("it lands on Deny, names itself, and shows the command as written", () => {
  asked();
  const card = document.querySelector('[role="alertdialog"]') ?? assert.fail("no card");
  const title = document.getElementById(card.getAttribute("aria-labelledby") ?? "");
  assert.equal(title?.textContent, "Run this command on your Mac?");
  assert.equal(document.activeElement, button("Deny"));
  assert.equal(document.querySelector(".luke-file-text-words")?.textContent, COMMAND);
});

test("each answer is heard as its own, and Escape denies", () => {
  const heard = asked();
  act(() => button("Allow once").click());
  act(() => button("Always allow").click());
  act(() => button("Deny").click());
  assert.deepEqual(heard, { once: 1, always: 1, deny: 1 });

  act(() => {
    (document.activeElement ?? document.body).dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
    );
  });
  assert.deepEqual(heard, { once: 1, always: 1, deny: 2 });
});

test("a long encoded payload is shortened until Show all brings it back", () => {
  const payload = "H4sIA".padEnd(2000, "QUJD");
  const command = `echo '${payload}' | base64 -d | tar xz`;
  asked(command);
  const words = () => document.querySelector(".luke-file-text-words")?.textContent ?? "";
  assert.equal(words(), "echo 'H4sIAQUJDQUJDQUJDQUJDQUJ… (1,976 more)' | base64 -d | tar xz");
  act(() => button("Show all").click());
  assert.equal(words(), command);
});

test("a line after a payload is never shortened into it", () => {
  const payload = "H4sIA".padEnd(200, "QUJD");
  asked(`echo ${payload}\nreboot`);
  const words = document.querySelector(".luke-file-text-words")?.textContent ?? "";
  assert.ok(words.endsWith("\nreboot"), words);
});

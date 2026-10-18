// @vitest-environment jsdom

import { ISSUE_PRIORITY, ISSUE_STATUS } from "@luke/features/issue-wire";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, expect, test } from "vitest";
import { type IssueDraft, NewIssueDialog } from "./new-issue-dialog";

/**
 * new-issue-dialog.test.ts -- New issue opens named by its title on its
 * title field; Create issue waits for a title, files it on Return or a
 * press, and is busy while the filing is out; a refused filing keeps the
 * words and says so; Cancel puts the card away unfiled.
 */

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

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

/** A filing the test answers by hand, and every draft it was asked to file. */
function filing() {
  const drafts: IssueDraft[] = [];
  let answer: (created: boolean) => void = () => undefined;
  const onCreate = (draft: IssueDraft) => {
    drafts.push(draft);
    return new Promise<boolean>((resolve) => {
      answer = resolve;
    });
  };
  return { drafts, onCreate, answer: (created: boolean) => answer(created) };
}

/** The dialog drawn open, with whether it has asked to close. */
function opened(onCreate: (draft: IssueDraft) => Promise<boolean>) {
  const closed = { count: 0 };
  const container = document.body.appendChild(document.createElement("div"));
  const root = createRoot(container);
  roots.push(root);
  act(() =>
    root.render(
      createElement(NewIssueDialog, {
        open: true,
        onCreate,
        onClose: () => {
          closed.count += 1;
        },
      }),
    ),
  );
  return closed;
}

function dialog(): HTMLElement {
  return document.querySelector<HTMLElement>('[role="dialog"]') ?? expect.fail("no dialog");
}

function field(): HTMLInputElement {
  return (
    document.querySelector<HTMLInputElement>('input[aria-label="New issue title"]') ??
    expect.fail("no title field")
  );
}

/** What a reader hears a button named: its label, or its words less what is hidden from them. */
function nameOf(each: HTMLButtonElement): string {
  const label = each.getAttribute("aria-label");
  if (label !== null) return label;
  const heard = each.cloneNode(true);
  if (!(heard instanceof HTMLElement)) return "";
  for (const hidden of heard.querySelectorAll('[aria-hidden="true"]')) hidden.remove();
  return heard.textContent ?? "";
}

/** The button whose name (its words, or its busy label) is `name`. */
function button(name: string): HTMLButtonElement {
  const found = [...dialog().querySelectorAll("button")].find((each) => nameOf(each) === name);
  return found ?? expect.fail(`no ${name} button`);
}

/** Types `words` into the title field as a person would. */
function type(words: string): void {
  const input = field();
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  act(() => {
    setter?.call(input, words);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

function pressReturn(): void {
  act(() => {
    field().dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
  });
}

/** Lets a filing's answer land. */
async function settle(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
  });
}

test("it opens named New issue on its title field, and Create issue waits for a title", () => {
  opened(filing().onCreate);
  const id = dialog().getAttribute("aria-labelledby");
  expect(id && document.getElementById(id)?.textContent).toBe("New issue");
  expect(document.activeElement).toBe(field());
  expect(button("Create issue").disabled).toBe(true);
  type("Retry the webhook");
  expect(button("Create issue").disabled).toBe(false);
});

test("Return files the title, Create issue is busy while it is out, and a filing kept closes the card", async () => {
  const filed = filing();
  const closed = opened(filed.onCreate);
  type("  Retry the webhook ");
  pressReturn();
  expect(filed.drafts).toEqual([
    { title: "Retry the webhook", status: ISSUE_STATUS.BACKLOG, priority: ISSUE_PRIORITY.NONE },
  ]);
  expect(button("Creating").getAttribute("aria-busy")).toBe("true");
  expect(button("Cancel").disabled).toBe(true);
  filed.answer(true);
  await settle();
  expect(closed.count).toBe(1);
});

test("a refused filing keeps the words and says so, and Cancel puts the card away unfiled", async () => {
  const filed = filing();
  const closed = opened(filed.onCreate);
  type("Retry the webhook");
  act(() => button("Create issue").click());
  filed.answer(false);
  await settle();
  expect(field().value).toBe("Retry the webhook");
  expect(dialog().querySelector('[role="alert"]')?.textContent).toBe(
    "Couldn't create the issue. Try again.",
  );
  expect(closed.count).toBe(0);
  act(() => button("Cancel").click());
  expect(closed.count).toBe(1);
  expect(filed.drafts).toHaveLength(1);
});

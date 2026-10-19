// @vitest-environment jsdom

import assert from "node:assert/strict";
import type { Task } from "@luke/features/task-wire";
import { ACT_OUTCOME_STATUS } from "@luke/host/acts";
import type { Editor, TiptapEditorHTMLElement } from "@tiptap/core";
import { TextSelection } from "@tiptap/pm/state";
import { Effect } from "effect";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, test, vi } from "vitest";
import { fakeAppBridge } from "../testing/app-bridge.js";
import { editorBundleLanded, installEditorLayout } from "../testing/composer.js";
import { DOCUMENT_TASK } from "../testing/document-task.js";
import { PlanBody } from "./plan-body.js";

/**
 * A date chip in the plan's editor, pressed, opens its picker over the real
 * editor bundle: a day picked, an end date, a time, typed words, or Clear
 * change the chip in place once the picker closes, and the `@` list narrowed
 * to dates opens the same picker to write a new one. A date in words that
 * take no change opens nothing. Synthetic plan; day-only dates wherever the
 * reader's zone would otherwise change what is written.
 */

/** Monday, October 19, 2026, at noon in UTC: the same day in any zone within eleven hours of it. */
const MONDAY_NOON = Date.parse("2026-10-19T12:00:00Z");

const TASK: Task = {
  ...DOCUMENT_TASK,
  repository: "acme/relay",
  document: {
    body: "## Goal\n\nInvite by email.\n\n## Rollout\n\nShip by [@Oct 23, 2026](luke://date/2026-10-23).",
    assumptions: [],
  },
};

const roots: Root[] = [];

beforeAll(() => Effect.runPromise(editorBundleLanded));

beforeEach(() => {
  vi.useFakeTimers({ now: MONDAY_NOON, toFake: ["Date"] });
  installEditorLayout();
  fakeAppBridge({ act: () => Promise.resolve({ status: ACT_OUTCOME_STATUS.UNKNOWN_ACT }) });
});

afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount());
  document.body.innerHTML = "";
  vi.useRealTimers();
});

/** The plan's page drawn, editable. */
function drawn(): HTMLElement {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  act(() =>
    root.render(
      createElement(PlanBody, {
        task: TASK,
        live: false,
        onEdit: () => Promise.reject(new Error("Nothing is saved in this test.")),
        sectionLinks: {
          workspace: "acme",
          onOpen: () => undefined,
          onOpenFile: () => undefined,
          reveal: undefined,
        },
      }),
    ),
  );
  return container;
}

/** The plan's editor, opened on Rollout by Enter on its block. */
async function opened(): Promise<{ container: HTMLElement; editor: Editor }> {
  const container = drawn();
  const rollout = container.querySelector<HTMLElement>('[role="group"][aria-label="Rollout"]');
  assert.ok(rollout);
  act(() => rollout.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })));
  await act(async () => undefined);
  const editor = container.querySelector<TiptapEditorHTMLElement>(".plan-document-text")?.editor;
  assert.ok(editor, "the plan's editor is open");
  return { container, editor };
}

/** The editor's date chip. */
function chipIn(container: HTMLElement): HTMLElement {
  const chip = container.querySelector<HTMLElement>(".plan-document-text [data-mention-ref]");
  assert.ok(chip, "the text holds a chip");
  return chip;
}

/** The picker, where it stands. */
function picker(container: HTMLElement): HTMLElement | null {
  return container.querySelector<HTMLElement>('[role="dialog"]');
}

/** The chip pressed, and its picker as it opens. */
async function pressChip(container: HTMLElement): Promise<HTMLElement> {
  act(() => chipIn(container).click());
  await act(async () => undefined);
  const opening = picker(container);
  assert.ok(opening, "the picker is open");
  return opening;
}

/** A control of the picker, by its role and name. */
function control(dialog: HTMLElement, selector: string): HTMLElement {
  const found = dialog.querySelector<HTMLElement>(selector);
  assert.ok(found, `the picker holds ${selector}`);
  return found;
}

/** A field of the picker, by its name. */
function fieldOf(dialog: HTMLElement, name: string): HTMLInputElement {
  const found = dialog.querySelector<HTMLInputElement>(`input[aria-label="${name}"]`);
  assert.ok(found, `the picker holds the ${name} field`);
  return found;
}

/** A day of the picker's month pressed, by the name a reader hears. */
function pickDay(dialog: HTMLElement, day: string): void {
  act(() => control(dialog, `button[aria-label="${day}"]`).click());
}

/** A key pressed where the picker's focus stands. */
async function pressKey(dialog: HTMLElement, key: string): Promise<void> {
  const at = dialog.contains(document.activeElement) ? document.activeElement : dialog;
  act(() => {
    at?.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));
  });
  await act(async () => undefined);
}

/** Words typed into the picker's field, as the field's own input hands them over. */
function typeWords(dialog: HTMLElement, words: string): void {
  const field = fieldOf(dialog, "Date");
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  act(() => {
    setter?.call(field, words);
    field.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

/** Each mention the editor holds, as the saved text writes it. */
function mentionsIn(editor: Editor): { name: string; target: string }[] {
  const found: { name: string; target: string }[] = [];
  editor.state.doc.descendants((node) => {
    if (node.type.name === "mention") {
      found.push({ name: String(node.attrs.name), target: String(node.attrs.target) });
    }
  });
  return found;
}

/** The offset the reader's zone stands at on `at`, as a mention spells one: `-07:00`, or `+00:00` in UTC. */
function readerOffset(at: number): string {
  const named =
    new Intl.DateTimeFormat("en-US", { timeZoneName: "longOffset" })
      .formatToParts(at)
      .find((part) => part.type === "timeZoneName")?.value ?? "";
  const offset = named.replace("GMT", "");
  return offset === "" ? "+00:00" : offset;
}

test("a date chip pressed in the plan's editor opens its picker on the date, its words and its month", async () => {
  const { container } = await opened();

  const dialog = await pressChip(container);

  assert.equal(fieldOf(dialog, "Date").value, "Oct 23, 2026");
  assert.match(dialog.textContent ?? "", /October 2026/u);
  assert.equal(
    control(dialog, '[aria-selected="true"] button').getAttribute("aria-label"),
    "Friday, October 23, 2026",
  );
});

test("a day picked names the chip anew in place once the picker closes, and undo brings the date back", async () => {
  const { container, editor } = await opened();

  const dialog = await pressChip(container);
  pickDay(dialog, "Saturday, October 24, 2026");
  await pressKey(dialog, "Escape");
  const picked = mentionsIn(editor);
  const chip = chipIn(container).textContent;
  act(() => {
    editor.commands.undo();
  });

  assert.equal(picker(container), null);
  assert.deepEqual(picked, [{ name: "Oct 24, 2026", target: "luke://date/2026-10-24" }]);
  assert.equal(chip, "Saturday");
  assert.deepEqual(mentionsIn(editor), [
    { name: "Oct 23, 2026", target: "luke://date/2026-10-23" },
  ]);
});

test("End date makes the date a range, the next day picked its end", async () => {
  const { container, editor } = await opened();

  const dialog = await pressChip(container);
  act(() => control(dialog, 'button[role="switch"][aria-label="End date"]').click());
  pickDay(dialog, "Monday, October 26, 2026");
  await pressKey(dialog, "Escape");

  assert.deepEqual(mentionsIn(editor), [
    { name: "Oct 23, 2026 → Oct 26, 2026", target: "luke://date/2026-10-23/2026-10-26" },
  ]);
});

test("End date switched on and closed at once writes the range it shows, to the next day", async () => {
  const { container, editor } = await opened();

  const dialog = await pressChip(container);
  act(() => control(dialog, 'button[role="switch"][aria-label="End date"]').click());
  const shown = fieldOf(dialog, "Date").value;
  await pressKey(dialog, "Escape");

  assert.equal(shown, "Oct 23, 2026 → Oct 24, 2026");
  assert.deepEqual(mentionsIn(editor), [
    { name: "Oct 23, 2026 → Oct 24, 2026", target: "luke://date/2026-10-23/2026-10-24" },
  ]);
});

test("an end picked before the start becomes the start, so the range stays in order", async () => {
  const { container, editor } = await opened();

  const dialog = await pressChip(container);
  act(() => control(dialog, 'button[role="switch"][aria-label="End date"]').click());
  pickDay(dialog, "Tuesday, October 20, 2026");
  await pressKey(dialog, "Escape");

  assert.deepEqual(mentionsIn(editor), [
    { name: "Oct 20, 2026 → Oct 23, 2026", target: "luke://date/2026-10-20/2026-10-23" },
  ]);
});

test("the picker stays hung from its chip as the words under it scroll", async () => {
  const { container } = await opened();
  const chip = chipIn(container);
  let top = 120;
  vi.spyOn(chip, "getBoundingClientRect").mockImplementation(() => new DOMRect(40, top, 60, 20));

  const dialog = await pressChip(container);
  const hung = dialog.closest<HTMLElement>(".date-picker-anchor");
  const before = hung?.style.top;
  top = 60;
  act(() => {
    container.querySelector(".plan-document-text")?.dispatchEvent(new Event("scroll"));
  });
  vi.restoreAllMocks();

  assert.equal(before, "120px");
  assert.equal(hung?.style.top, "60px");
});

test("Include time puts a time on the day, spelled with the offset the reader's zone stands at then", async () => {
  const { container, editor } = await opened();

  const dialog = await pressChip(container);
  act(() => control(dialog, 'button[role="switch"][aria-label="Include time"]').click());
  const time = fieldOf(dialog, "Start time").value;
  await pressKey(dialog, "Escape");
  const [mention] = mentionsIn(editor);
  const offset = readerOffset(Date.parse("2026-10-23T12:00:00Z"));

  assert.equal(time, "09:00");
  assert.equal(mention?.target, `luke://date/2026-10-23T09:00${offset}`);
  assert.match(mention?.name ?? "", /^Oct 23, 2026, 9:00 AM /u);
  assert.equal(chipIn(container).textContent, "Friday 9:00 AM");
});

test("words typed in the picker that name a date are written as it on Enter", async () => {
  const { container, editor } = await opened();

  const dialog = await pressChip(container);
  typeWords(dialog, "oct 28");
  await pressKey(dialog, "Enter");

  assert.equal(picker(container), null);
  assert.deepEqual(mentionsIn(editor), [
    { name: "Oct 28, 2026", target: "luke://date/2026-10-28" },
  ]);
});

test("words typed in the picker that name no date are marked and change nothing", async () => {
  const { container, editor } = await opened();

  const dialog = await pressChip(container);
  typeWords(dialog, "someday");
  await pressKey(dialog, "Enter");

  assert.equal(fieldOf(dialog, "Date").getAttribute("aria-invalid"), "true");
  assert.deepEqual(mentionsIn(editor), [
    { name: "Oct 23, 2026", target: "luke://date/2026-10-23" },
  ]);
});

test("Clear takes the chip out of the words", async () => {
  const { container, editor } = await opened();

  const dialog = await pressChip(container);
  act(() =>
    [...dialog.querySelectorAll<HTMLButtonElement>("button")]
      .find((button) => button.textContent === "Clear")
      ?.click(),
  );
  await act(async () => undefined);

  assert.equal(picker(container), null);
  assert.deepEqual(mentionsIn(editor), []);
  assert.equal(editor.getText().includes("Ship by"), true);
});

test("the picker closed with nothing changed leaves the chip as it was", async () => {
  const { container, editor } = await opened();

  const dialog = await pressChip(container);
  await pressKey(dialog, "Escape");

  assert.equal(picker(container), null);
  assert.deepEqual(mentionsIn(editor), [
    { name: "Oct 23, 2026", target: "luke://date/2026-10-23" },
  ]);
});

test("a date chip in the plan's words while they are not being edited opens no picker", () => {
  const container = drawn();

  const chip = container.querySelector<HTMLElement>("[data-mention-ref]");

  assert.equal(chip?.tagName, "SPAN");
  assert.equal(chip?.textContent, "Friday");
  assert.equal(picker(container), null);
});

test("Pick a date… in the @ list narrowed to dates opens the picker, and the day picked is written in the word's place", async () => {
  const { container, editor } = await opened();

  act(() => {
    editor.view.focus();
    editor.view.dispatch(editor.state.tr.setSelection(TextSelection.atEnd(editor.state.doc)));
    editor.view.dispatch(editor.state.tr.insertText(" Due @dates:"));
  });
  await act(async () => undefined);
  const rows = [...container.querySelectorAll(".mention-menu .luke-combobox-option-label")].map(
    (row) => row.textContent,
  );
  const key = (name: string) =>
    act(() => {
      editor.view.dom.dispatchEvent(
        new KeyboardEvent("keydown", { key: name, bubbles: true, cancelable: true }),
      );
    });
  key("End");
  key("Enter");
  await act(async () => undefined);
  const dialog = picker(container);
  assert.ok(dialog, "the picker is open");
  pickDay(dialog, "Thursday, October 29, 2026");
  await pressKey(dialog, "Escape");

  assert.deepEqual(rows, ["Today", "Tomorrow", "Oct 26", "Pick a date…"]);
  assert.equal(picker(container), null);
  assert.deepEqual(mentionsIn(editor), [
    { name: "Oct 23, 2026", target: "luke://date/2026-10-23" },
    { name: "Oct 29, 2026", target: "luke://date/2026-10-29" },
  ]);
  assert.equal(editor.getText().includes("@dates:"), false);
});

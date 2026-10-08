// @vitest-environment jsdom

import assert from "node:assert/strict";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, test } from "vitest";
import { NewPlanForm } from "./new-plan-form";
import type { PlansControl } from "./use-plans-tab";

const RELAY = "/Users/dev/relay";
const BILLING = "/Users/dev/billing";

type NewPlan = PlansControl["newPlan"];

/** A new-plan page over a fake host that keeps every start it was asked for. */
function mount(patch: Partial<NewPlan> = {}) {
  const started: [string, string][] = [];
  let newPlan: NewPlan = {
    presses: 0,
    recentFolders: [],
    pickFolder: () => Promise.resolve(RELAY),
    start: (name, folderPath) => {
      started.push([name, folderPath]);
      return Promise.resolve(undefined);
    },
    ...patch,
  };
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const render = () => root.render(createElement(NewPlanForm, { newPlan }));
  act(render);
  const find = <Element extends HTMLElement>(selector: string): Element => {
    const found = container.querySelector<Element>(selector);
    assert.ok(found, `the page draws ${selector}`);
    return found;
  };
  return {
    container,
    started,
    find,
    nameField: () => find<HTMLInputElement>("input[aria-label='Plan name']"),
    startButton: () => find<HTMLButtonElement>("button[aria-label='Start plan']"),
    chip: () => find<HTMLButtonElement>(".plan-compose-chip"),
    restand: (next: Partial<NewPlan>) => {
      newPlan = { ...newPlan, ...next };
      act(render);
    },
  };
}

/** Types into a field the way a key press does, through the setter React watches. */
function type(field: HTMLInputElement, words: string): void {
  const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  act(() => {
    setValue?.call(field, words);
    field.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

afterEach(() => {
  document.body.innerHTML = "";
});

test("the page asks what to plan, focuses the name field, and offers Choose folder while no plan has a folder here", () => {
  const page = mount();

  assert.equal(page.find("h1").textContent, "What are we planning?");
  assert.ok(document.activeElement === page.nameField(), "the name field holds focus");
  assert.equal(page.chip().textContent, "Choose folder");
  assert.equal(page.startButton().disabled, true);
});

test("start waits for both a name and a folder, and submitting starts the plan in the chosen folder", async () => {
  const page = mount();

  type(page.nameField(), "  Teammate invitations ");
  assert.equal(page.startButton().disabled, true);
  await act(async () => page.chip().click());
  assert.equal(page.chip().textContent, "relay");
  assert.equal(page.startButton().disabled, false);

  type(page.nameField(), " ");
  assert.equal(page.startButton().disabled, true);
  type(page.nameField(), "Teammate invitations");
  await act(async () => page.find<HTMLFormElement>("form").requestSubmit());

  assert.deepEqual(page.started, [["Teammate invitations", RELAY]]);
});

test("the folder starts on the last one used, and the chip's menu offers the others and the picker", async () => {
  let picked = 0;
  const page = mount({
    recentFolders: [RELAY, BILLING],
    pickFolder: () => {
      picked += 1;
      return Promise.resolve(null);
    },
  });
  assert.equal(page.chip().textContent, "relay");

  act(() => page.chip().click());
  const rows = [...page.container.querySelectorAll<HTMLButtonElement>("[role=menuitem]")];
  assert.deepEqual(
    rows.map((row) => row.textContent),
    ["relay~/relay", "billing~/billing", "Choose another folder…"],
  );
  act(() => rows[1]?.click());
  assert.equal(page.container.querySelector("[role=menu]"), null);
  assert.equal(page.chip().textContent, "billing");

  type(page.nameField(), "Billing export");
  await act(async () => page.find<HTMLFormElement>("form").requestSubmit());
  assert.deepEqual(page.started, [["Billing export", BILLING]]);

  // A cancelled picker keeps the folder already chosen.
  act(() => page.chip().click());
  await act(async () => page.find<HTMLButtonElement>("[role=menuitem]:last-child").click());
  assert.equal(picked, 1);
  assert.equal(page.chip().textContent, "billing");
});

test("Escape closes the folder menu, goes no further than it, and hands focus back to the chip", () => {
  const page = mount({ recentFolders: [RELAY] });
  const reachedWindow: string[] = [];
  const listen = (event: KeyboardEvent) => reachedWindow.push(event.key);
  window.addEventListener("keydown", listen);

  act(() => page.chip().click());
  act(() => {
    page
      .find("[role=menuitem]")
      .dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  });
  window.removeEventListener("keydown", listen);

  assert.equal(page.container.querySelector("[role=menu]"), null);
  assert.deepEqual(reachedWindow, []);
  assert.ok(document.activeElement === page.chip(), "focus is back on the chip");
});

test("a refused start keeps the page, with the reason under the composer", async () => {
  const page = mount({
    recentFolders: [RELAY],
    start: () => Promise.resolve("Luke's service could not be reached. Try again."),
  });

  type(page.nameField(), "Invites");
  await act(async () => page.find<HTMLFormElement>("form").requestSubmit());

  assert.equal(
    page.find("[role=alert]").textContent,
    "Luke's service could not be reached. Try again.",
  );
  assert.equal(page.startButton().disabled, false);
});

test("each press of New plan brings focus back to the name field", () => {
  const page = mount();
  page.chip().focus();
  assert.ok(document.activeElement !== page.nameField(), "focus starts elsewhere");

  page.restand({ presses: 1 });

  assert.ok(document.activeElement === page.nameField(), "the name field holds focus");
});

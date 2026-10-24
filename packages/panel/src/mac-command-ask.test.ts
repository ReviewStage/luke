// @vitest-environment jsdom

import assert from "node:assert/strict";
import { ACT_KIND } from "@luke/host/acts";
import type { MacCommandAsk } from "@luke/host/app-state";
import { MAC_COMMAND_DECISION, type MacCommandAnswer } from "@luke/host/contract";
import * as AtomRegistry from "effect/reactivity/AtomRegistry";
import { act, createElement, Fragment } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, test } from "vitest";
import { tellAct } from "./act.js";
import { MacCommandAskDialog } from "./mac-command-ask.js";
import { rendererRegistry } from "./renderer-runtime.js";
import { fakeActPort, refusedOnPort } from "./testing/app-bridge.js";
import { handState } from "./testing/app-state.js";
import { onRegistry } from "./testing/copy-feedback.js";
import { ToastHost } from "./toast.js";

/**
 * The prompt for a command an agent asked to run on this Mac is drawn from
 * what main holds: nothing while no ask waits, the earliest ask while some
 * do, and each answer goes back to main by the ask's id; an answer main
 * refuses says why in a toast, where a report nobody pressed for stays quiet.
 * Synthetic commands.
 */

const FIRST: MacCommandAsk = {
  id: "2f6a1c7e-9b3d-4e8f-a5c1-7d2e9b4f6a03",
  command: "node --version",
  askedAt: 1_800_000_000_000,
};

const SECOND: MacCommandAsk = {
  id: "7c1d2e3f-4a5b-4c6d-8e7f-9a0b1c2d3e4f",
  command: "pnpm --version",
  askedAt: 1_800_000_001_000,
};

const roots: Root[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount());
  document.body.innerHTML = "";
});

/** The dialog drawn over main's document holding `asks`, with what it answered main. */
async function mount(asks: readonly MacCommandAsk[]): Promise<MacCommandAnswer[]> {
  handState({}, { macCommands: { asks } });
  const answered: MacCommandAnswer[] = [];
  fakeActPort({
    [ACT_KIND.MAC_COMMAND_ANSWER]: (payload) => {
      answered.push(payload);
      return Promise.resolve();
    },
  });
  const container = document.body.appendChild(document.createElement("div"));
  const root = createRoot(container);
  roots.push(root);
  await act(async () =>
    root.render(onRegistry(AtomRegistry.make(), createElement(MacCommandAskDialog))),
  );
  return answered;
}

/**
 * The dialog over main's document holding `FIRST`, main refusing every answer
 * in `sentence`, beside the window's toasts on the window's own registry, the
 * one its root provides and a press's toast is raised on.
 */
async function mountRefusing(sentence: string): Promise<void> {
  handState({}, { macCommands: { asks: [FIRST] } });
  fakeActPort({
    [ACT_KIND.MAC_COMMAND_ANSWER]: () => Promise.reject(refusedOnPort(sentence)),
  });
  const container = document.body.appendChild(document.createElement("div"));
  const root = createRoot(container);
  roots.push(root);
  await act(async () =>
    root.render(
      createElement(
        Fragment,
        null,
        onRegistry(AtomRegistry.make(), createElement(MacCommandAskDialog)),
        onRegistry(rendererRegistry, createElement(ToastHost)),
      ),
    ),
  );
}

/** What each toast standing says, oldest first. */
function toasts(): string[] {
  return [...document.querySelectorAll(".luke-toast:not([data-leaving]) .luke-toast-words")].map(
    (words) => words.textContent ?? "",
  );
}

function button(name: string): HTMLButtonElement {
  return (
    [...document.querySelectorAll("button")].find((each) => each.textContent === name) ??
    assert.fail(`no ${name} button`)
  );
}

test("nothing is drawn while no ask waits", async () => {
  await mount([]);
  assert.equal(document.querySelector('[role="alertdialog"]'), null);
});

test("the earliest ask is drawn with its command, and each answer goes back by the ask's id", async () => {
  const answered = await mount([FIRST, SECOND]);
  assert.ok(document.querySelector('[role="alertdialog"]'), "the prompt stands");
  assert.equal(document.querySelector(".luke-file-text-words")?.textContent, FIRST.command);

  await act(async () => button("Allow once").click());
  await act(async () => button("Always allow").click());
  await act(async () => button("Deny").click());
  assert.deepEqual(answered, [
    { id: FIRST.id, decision: MAC_COMMAND_DECISION.ALLOW_ONCE },
    { id: FIRST.id, decision: MAC_COMMAND_DECISION.ALLOW_ALWAYS },
    { id: FIRST.id, decision: MAC_COMMAND_DECISION.DENY },
  ]);
});

test("an answer main refuses raises a toast in main's own words", async () => {
  const refusal = "That command already ran out of time.";
  await mountRefusing(refusal);

  await act(async () => button("Deny").click());

  assert.ok(toasts().includes(refusal), `toasts stood: ${toasts().join(" | ")}`);
});

test("an answer main refuses as a report nobody pressed for raises no toast", async () => {
  const refusal = "That command was answered on another window.";
  await mountRefusing(refusal);

  await act(async () => {
    tellAct(ACT_KIND.MAC_COMMAND_ANSWER, { id: FIRST.id, decision: MAC_COMMAND_DECISION.DENY });
  });

  assert.ok(!toasts().includes(refusal), `toasts stood: ${toasts().join(" | ")}`);
});

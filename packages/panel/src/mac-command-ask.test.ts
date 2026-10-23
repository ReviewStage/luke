// @vitest-environment jsdom

import assert from "node:assert/strict";
import { ACT_KIND } from "@luke/host/acts";
import type { MacCommandAsk } from "@luke/host/app-state";
import { MAC_COMMAND_DECISION, type MacCommandAnswer } from "@luke/host/contract";
import * as AtomRegistry from "effect/reactivity/AtomRegistry";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, test } from "vitest";
import { MacCommandAskDialog } from "./mac-command-ask.js";
import { fakeActPort } from "./testing/app-bridge.js";
import { handState } from "./testing/app-state.js";
import { onRegistry } from "./testing/copy-feedback.js";

/**
 * The prompt for a command an agent asked to run on this Mac is drawn from
 * what main holds: nothing while no ask waits, the earliest ask while some
 * do, and each answer goes back to main by the ask's id. Synthetic commands.
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

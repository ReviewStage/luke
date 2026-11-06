// @vitest-environment jsdom

import assert from "node:assert/strict";
import { ACT_KIND } from "@repo/host/acts";
import type { AppStateDelivery, MacCommandAsk } from "@repo/host/app-state";
import { MAC_COMMAND_DECISION, type MacCommandAnswer } from "@repo/host/contract";
import { holdExits } from "@repo/ui/testing/held-exits";
import * as AtomRegistry from "effect/reactivity/AtomRegistry";
import { act, createElement, Fragment } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, test, vi } from "vitest";
import { tellAct } from "./act.js";
import { MacCommandAskDialog } from "./mac-command-ask.js";
import { rendererRegistry } from "./renderer-runtime.js";
import {
  fakeActPort,
  fakeAppBridge,
  fakeAppBridgeCalls,
  refusedOnPort,
} from "./testing/app-bridge.js";
import { deliveryOf, handState, stateWith } from "./testing/app-state.js";
import { onRegistry } from "./testing/copy-feedback.js";
import { ToastHost } from "./toast.js";

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
  Reflect.deleteProperty(Element.prototype, "getAnimations");
  vi.useRealTimers();
});

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
  if (asks.length > 0) await vi.waitFor(() => assert.equal(promptStands(), true));
  return answered;
}

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
  await vi.waitFor(() => assert.equal(promptStands(), true));
}

function promptStands(): boolean {
  return document.querySelector('[role="alertdialog"]') !== null;
}

function toasts(): string[] {
  return [...document.querySelectorAll(".ui-toast:not([data-leaving]) .ui-toast-words")].map(
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
  assert.equal(promptStands(), false);
});

test("the earliest ask is drawn with its command, and each answer goes back by the ask's id", async () => {
  const answered = await mount([FIRST, SECOND]);
  assert.equal(promptStands(), true);
  assert.equal(document.querySelector(".ui-file-text-words")?.textContent, FIRST.command);

  await act(async () => button("Allow once").click());
  await act(async () => button("Allow all commands").click());
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

test("an ask main drops fades its card out in place, its words as they were, before the card goes", async () => {
  vi.useFakeTimers({ toFake: ["requestAnimationFrame", "cancelAnimationFrame"] });
  const exits = holdExits();
  let push: ((delivery: AppStateDelivery) => void) | undefined;
  const snapshot = stateWith({}, { macCommands: { asks: [FIRST] } });
  fakeAppBridge({
    ...fakeAppBridgeCalls(),
    onAppState: (heard: (delivery: AppStateDelivery) => void) => {
      push = heard;
      return () => undefined;
    },
    requestAppState: () => Promise.resolve(snapshot),
  });
  fakeActPort({});
  const container = document.body.appendChild(document.createElement("div"));
  const root = createRoot(container);
  roots.push(root);
  await act(async () =>
    root.render(onRegistry(AtomRegistry.make(), createElement(MacCommandAskDialog))),
  );
  await vi.waitFor(() => assert.equal(promptStands(), true));
  await act(async () => vi.advanceTimersToNextFrame());
  const card = document.querySelector('[role="alertdialog"]') ?? assert.fail("the prompt stands");

  await act(async () =>
    push?.({
      ...deliveryOf(stateWith({}, { macCommands: { asks: [] } })),
      version: snapshot.version + 1,
    }),
  );
  await vi.waitFor(() => assert.equal(card.hasAttribute("data-closed"), true));
  await act(async () => vi.advanceTimersToNextFrame());
  assert.ok(card.isConnected, "the card goes the moment the ask does");
  assert.equal(document.querySelector(".ui-file-text-words")?.textContent, FIRST.command);

  await act(async () => exits.finish());
  await act(async () => vi.advanceTimersToNextFrame());
  assert.equal(promptStands(), false);
});

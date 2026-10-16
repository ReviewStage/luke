// @vitest-environment jsdom

import assert from "node:assert/strict";
import * as AtomRegistry from "effect/reactivity/AtomRegistry";
import { act, createElement, Fragment } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, test } from "vitest";
import { onRegistry } from "#testing/copy-feedback";
import { ToastHost } from "../toast";
import { type AgentPlace, useAgentEndToasts } from "./agent-end-toast";

/** An agent's end as main hands it to the window. */
interface AgentEnded extends AgentPlace {
  readonly words: string;
  readonly detail: string;
  readonly failed: boolean;
}

const AGENT_ID = "8c1a6a4f-3d2e-4d8b-8b66-6f4c7a2e3b21";

let ended: ((end: AgentEnded) => void) | undefined;
let viewed: AgentPlace[] = [];
let root: Root | undefined;
let registry: AtomRegistry.AtomRegistry | undefined;

beforeEach(() => {
  viewed = [];
  Object.defineProperty(window, "luke", {
    configurable: true,
    value: {
      onAgentEnded: (listener: (end: AgentEnded) => void) => {
        ended = listener;
        return () => {
          ended = undefined;
        };
      },
    },
  });
});

afterEach(() => {
  act(() => root?.unmount());
  registry?.dispose();
  document.body.innerHTML = "";
});

/** The toasts, wired as the app wires them: View hands on where the agent stands. */
function Harness(): React.JSX.Element {
  useAgentEndToasts((place) => viewed.push(place), []);
  return createElement(Fragment, null, createElement(ToastHost));
}

function mount(): void {
  const container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  registry = AtomRegistry.make();
  const held = registry;
  act(() => root?.render(onRegistry(held, createElement(Harness))));
}

test("an automation's agent with no plan is toasted under the automation's name, and View opens the agent where it stands, on no plan", () => {
  mount();

  act(() =>
    ended?.({
      taskId: null,
      agentId: AGENT_ID,
      words: "Triage overnight issues failed",
      detail: "Morning Sentry triage",
      failed: true,
    }),
  );
  const toast = document.querySelector<HTMLElement>(".toast");
  assert.ok(toast);
  assert.deepEqual(
    [
      toast.querySelector(".toast-words")?.textContent,
      toast.querySelector(".toast-detail")?.textContent,
      toast.dataset.tone,
    ],
    ["Triage overnight issues failed", "Morning Sentry triage", "failed"],
  );
  const view = toast.querySelector<HTMLButtonElement>(".toast-action");
  assert.equal(view?.textContent, "View");
  act(() => view?.click());

  assert.deepEqual(viewed, [{ taskId: null, agentId: AGENT_ID }]);
});

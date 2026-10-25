// @vitest-environment jsdom

import assert from "node:assert/strict";
import { CODING_AGENT_MACHINE, type CodingAgentMachine } from "@luke/features/coding-agent-wire";
import { type CatalogModel, MODEL_PROVIDER } from "@luke/features/models-wire";
import { EXPERIMENT } from "@luke/settings";
import { experimentsOn } from "@luke/settings/testing";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { beforeAll, expect, test } from "vitest";
import { handState } from "../testing/app-state.js";
import { installScrollIntoView } from "../testing/scroll-into-view.js";
import { codingAgentsControl } from "../testing/tasks-control.js";
import { StartAgentButton } from "./start-agent-button.js";

/**
 * start-agent-run-on.test.ts -- Start's Run on, with local agents on and the
 * service offering this Mac: a press starts in the cloud until This Mac is
 * picked, and on the Mac after. Note that it stands in a file of its own,
 * because a window reads its document once, and the gate reads the
 * experiment off that document.
 */

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

beforeAll(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  installScrollIntoView();
});

const MODELS: readonly CatalogModel[] = [
  {
    id: "anthropic/claude-opus-5.5",
    name: "Claude Opus 5.5",
    provider: MODEL_PROVIDER.ANTHROPIC,
    efforts: ["high"],
  },
];

/** The button named `name`. */
function button(name: string): HTMLButtonElement {
  const found = document.querySelector<HTMLButtonElement>(`button[aria-label="${name}"]`);
  if (found === null) throw new Error(`no button named ${name}`);
  return found;
}

/** A key pressed in the menu's field, which holds its keys. */
function press(key: string): void {
  const field = document.querySelector<HTMLElement>('[role="combobox"]') ?? assert.fail("no field");
  act(() => {
    field.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key }));
  });
}

/** Lets the window's document and the default's read land. */
async function settle(): Promise<void> {
  await act(async () => {
    for (let tick = 0; tick < 12; tick += 1) await Promise.resolve();
  });
}

test("a press starts in the cloud until Run on picks This Mac, and on the Mac after", async () => {
  handState(experimentsOn(EXPERIMENT.LOCAL_AGENTS));
  const started: (CodingAgentMachine | undefined)[] = [];
  const control = codingAgentsControl({
    models: MODELS,
    thisMac: { deviceId: "6f0c1d0e-6b1a-4d43-9a49-2b7b6f1f0a11", name: "Studio" },
    readDefault: () => Promise.resolve({ choice: { model: MODELS[0]?.id ?? "", effort: "high" } }),
    start: {
      available: true,
      reason: undefined,
      busy: false,
      note: undefined,
      succeeded: false,
      onPress: (_choice, machine) => started.push(machine),
    },
  });
  const container = document.createElement("div");
  document.body.append(container);
  act(() => createRoot(container).render(createElement(StartAgentButton, { control })));
  await settle();

  act(() => button("Start a coding agent").click());
  act(() => button("Choose a model to start with").click());
  await settle();
  // Note that the menu's keys stay in its field: up past Effort to Run on, right into its choices, down to This Mac.
  for (const key of ["ArrowUp", "ArrowUp", "ArrowRight", "ArrowDown", "Enter"]) press(key);
  await act(async () => button("Start a coding agent").click());

  expect(started).toEqual([undefined, CODING_AGENT_MACHINE.MAC]);
});

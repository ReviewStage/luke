// @vitest-environment jsdom

import assert from "node:assert/strict";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, test } from "vitest";
import { ACT_KIND, ACT_OUTCOME_STATUS, type Act, type ActOutcome } from "#shared/messages/acts";
import { LID_STATE, MICROPHONE_STATUS, MICROPHONE_TRANSPORT } from "#shared/messages/audio";
import { type ActHandle, useAct } from "./act";

/** One act the bridge is holding, answered when the test chooses. */
interface Held {
  request: Act;
  answer: (outcome: ActOutcome) => void;
}

let held: Held[] = [];
let root: Root | undefined;

beforeEach(() => {
  held = [];
  Object.defineProperty(window, "sidecar", {
    configurable: true,
    value: {
      act: (request: Act) =>
        new Promise<ActOutcome>((answer) => {
          held.push({ request, answer });
        }),
      recordSurfaceEvent: () => undefined,
    },
  });
});

afterEach(() => {
  act(() => root?.unmount());
  root = undefined;
  document.body.innerHTML = "";
});

function mountHandle(): ActHandle {
  let handle: ActHandle | undefined;
  function Probe() {
    handle = useAct();
    return null;
  }
  const container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  act(() => root?.render(createElement(Probe)));
  assert.ok(handle);
  return handle;
}

test("two acts out at once each hear their own answer, however long the first is held", async () => {
  const handle = mountHandle();
  const status = handle.act(ACT_KIND.MICROPHONE_REQUEST);
  const route = handle.act(ACT_KIND.MICROPHONE_ROUTE);
  assert.deepEqual(
    held.map((each) => each.request.kind),
    [ACT_KIND.MICROPHONE_REQUEST, ACT_KIND.MICROPHONE_ROUTE],
  );

  // The later act answers first, as a short act does while a long one is held.
  held[1]?.answer({
    status: ACT_OUTCOME_STATUS.DONE,
    value: { defaultTransport: MICROPHONE_TRANSPORT.BUILT_IN, lid: LID_STATE.OPEN },
  });
  assert.deepEqual(await route, {
    defaultTransport: MICROPHONE_TRANSPORT.BUILT_IN,
    lid: LID_STATE.OPEN,
  });
  held[0]?.answer({ status: ACT_OUTCOME_STATUS.DONE, value: MICROPHONE_STATUS.GRANTED });
  assert.equal(await status, MICROPHONE_STATUS.GRANTED);
});

test("a refused act rejects with the sentence its row gave, and an answer outside the kind's shape rejects too", async () => {
  const handle = mountHandle();
  const refused = handle.act(ACT_KIND.PLANNING_SELECT, {
    planId: "8c1a6a4f-3d2e-4d8b-8b66-6f4c7a2e3b21",
  });
  held[0]?.answer({ status: ACT_OUTCOME_STATUS.REFUSED, reason: "Could not open that plan." });
  await assert.rejects(refused, { message: "Could not open that plan." });

  const invalid = handle.act(ACT_KIND.VOICE_STOP_SPEAKING);
  // SAFETY: the test hands the kind an answer outside its own shape on purpose, which is what the guard refuses.
  held[1]?.answer({ status: ACT_OUTCOME_STATUS.DONE, value: "spoken" as never });
  await assert.rejects(invalid, { message: "Invalid answer to the act voice.stopSpeaking." });
});

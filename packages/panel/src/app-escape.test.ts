// @vitest-environment jsdom

/**
 * app-escape.test.ts -- the window's own Escape, which stops a call, leaves the call running when a field or dialog already took the press for itself, or an input method did.
 *
 * The window is drawn whole through `App`, on a fake bridge that delivers a
 * document with the microphone open, and every act the window sends is written
 * down. An Escape nothing took is the control: it must stop the call, or the
 * presses that leave it running prove nothing.
 */

import assert from "node:assert/strict";
import { RegistryContext } from "@effect/atom-react/RegistryContext";
import { ACT_KIND } from "@luke/host/acts";
import { type AppStateDelivery, type AppStateSnapshot, RUN_PROFILE } from "@luke/host/app-state";
import { type AppBridge, bridgeEntries } from "@luke/host/bridge";
import { PUSH_METHOD } from "@luke/host/contract";
import { LIVE_STATUS } from "@luke/live";
import { memoryHistory } from "@luke/ui/history-adapter";
import { AVATAR_OFF } from "@luke/voice/avatar";
import { IDLE_VOICE_VIEW, VOICE_COMMAND } from "@luke/voice/voice-view";
import * as AtomRegistry from "effect/reactivity/AtomRegistry";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, test, vi } from "vitest";
import { App } from "./app.js";
import { installWindowHistory } from "./navigation-history.js";
import {
  fakeActPortAnswering,
  fakeAppBridge,
  refusedOnPort,
  type SentPortAct,
} from "./testing/app-bridge.js";
import { fakeAppPlatform, QUIET_PANEL } from "./testing/app-platform.js";
import { deliveryOf, stateWith } from "./testing/app-state.js";

/** A signed-in account on a fixture run, its microphone open on a call, nothing said yet. */
const LISTENING: AppStateSnapshot = {
  ...stateWith({}, {}),
  run: { ...stateWith({}, {}).run, fixtureMode: true, profile: RUN_PROFILE.TASKS_WORK },
  voice: {
    avatar: AVATAR_OFF,
    view: {
      ...IDLE_VOICE_VIEW,
      voiceStatus: LIVE_STATUS.LISTENING,
      listening: true,
      call: { taskId: "task-on-call", agentId: "agent-on-call" },
    },
  },
};

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

let root: Root | undefined;
let sent: SentPortAct[] = [];

beforeAll(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
});

beforeEach(() => {
  sent = [];
  fakeAppPlatform({ ...QUIET_PANEL, applySessionReplay: () => undefined });
  installWindowHistory(memoryHistory());
  // Every bridge call is quiet but the two the document is read through, as a window with nothing else to hear.
  const quiet = Object.fromEntries([
    ...Object.keys(PUSH_METHOD).map((method) => [method, () => () => undefined]),
    ...bridgeEntries().map(([method, entry]) => [
      method,
      entry.kind === "invoke" ? () => Promise.resolve(undefined) : () => undefined,
    ]),
  ]);
  fakeAppBridge({
    ...quiet,
    requestAppState: () => Promise.resolve(structuredClone(LISTENING)),
    onAppState: (heard: (delivery: AppStateDelivery) => void) => {
      heard(deliveryOf(LISTENING));
      return () => undefined;
    },
  } satisfies Partial<AppBridge>);
  fakeActPortAnswering((request) => {
    sent.push(request);
    // Every act is refused, as a service that answers nothing would.
    return Promise.reject(refusedOnPort("Not here."));
  });
});

afterEach(() => {
  act(() => root?.unmount());
  root = undefined;
  document.body.innerHTML = "";
});

/** Lets every promise settled so far run its continuations, the window's state among them. */
async function settle(): Promise<void> {
  await act(async () => {
    for (let tick = 0; tick < 24; tick += 1) await Promise.resolve();
  });
}

/** How many times the window has asked the call to stop speaking or listening. */
function stops(): number {
  return sent.filter(({ kind, payload }) => {
    if (kind !== ACT_KIND.VOICE_COMMAND) return false;
    return (
      typeof payload === "object" &&
      payload !== null &&
      "command" in payload &&
      payload.command === VOICE_COMMAND.STOP_SPEAKING
    );
  }).length;
}

/** Presses Escape on `target`, which bubbles to the window as a typed key does. */
function pressEscape(target: Element, init: KeyboardEventInit = {}): void {
  act(() => {
    target.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true, ...init }),
    );
  });
}

/** The window drawn, and shown ready by an Escape nothing took stopping the call, which is then forgotten. */
async function drawWindowOnCall(): Promise<void> {
  root = createRoot(document.body.appendChild(document.createElement("div")));
  act(() =>
    root?.render(
      createElement(RegistryContext.Provider, { value: AtomRegistry.make() }, createElement(App)),
    ),
  );
  await vi.waitFor(async () => {
    await settle();
    pressEscape(document.body);
    assert.ok(stops() > 0, "an Escape nothing took stops the call");
  });
  sent = [];
}

test("an Escape a field already took for itself leaves the call running", async () => {
  await drawWindowOnCall();
  const field = document.body.appendChild(document.createElement("input"));
  // A field that answers its own Escape marks it taken, as `TextField` does.
  field.addEventListener("keydown", (event) => event.preventDefault());
  pressEscape(field);
  await settle();
  assert.equal(stops(), 0, "the call is left running");
});

test("an Escape an input method took leaves the call running", async () => {
  await drawWindowOnCall();
  pressEscape(document.body, { isComposing: true });
  pressEscape(document.body, { keyCode: 229 });
  await settle();
  assert.equal(stops(), 0, "the call is left running");
});

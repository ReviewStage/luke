/**
 * copy-feedback.ts -- what a test of a copy stands on: main's clipboard on the act channel, and the renderer's atoms on the test's own clock.
 *
 * A copy's check and its toast stand for a hold the renderer's runtime waits
 * out, so a test that watches one leave runs on `it.effect` and hands the
 * atoms its own services, `TestClock` among them; `TestClock.adjust` then
 * reaches every wait an atom forked.
 */

import { RegistryContext } from "@effect/atom-react/RegistryContext";
import { Effect } from "effect";
import * as AsyncResult from "effect/unstable/reactivity/AsyncResult";
import * as AtomRegistry from "effect/unstable/reactivity/AtomRegistry";
import { createElement, type ReactElement } from "react";
import { ACT_KIND, ACT_OUTCOME_STATUS, type Act, type ActOutcome } from "#shared/messages/acts";
import { rendererRuntime } from "../renderer/renderer-runtime";

/** What main's clipboard was handed, in order, and whether it takes the next copy. */
export interface TestClipboard {
  readonly copied: string[];
  refuse(refusing: boolean): void;
}

/**
 * Puts a clipboard on the window's act channel, answering every other act as
 * whatever channel stood before it does, or as done where none stood.
 */
export function installClipboard(): TestClipboard {
  const copied: string[] = [];
  let refusing = false;
  // Note that a test that stood no channel up has none, whatever the bridge's type says.
  const before: Partial<Window["sidecar"]> | undefined =
    "sidecar" in window ? window.sidecar : undefined;
  const done: ActOutcome = { status: ACT_OUTCOME_STATUS.DONE, value: undefined };
  const answer = (request: Act): Promise<ActOutcome> => {
    if (request.kind !== ACT_KIND.WINDOW_COPY_TEXT) {
      return before?.act === undefined ? Promise.resolve(done) : before.act(request);
    }
    if (refusing) {
      return Promise.resolve({ status: ACT_OUTCOME_STATUS.REFUSED, reason: "No clipboard." });
    }
    copied.push(request.payload.words);
    return Promise.resolve(done);
  };
  Object.defineProperty(window, "sidecar", {
    configurable: true,
    value: { ...before, act: answer },
  });
  return {
    copied,
    refuse: (next) => {
      refusing = next;
    },
  };
}

/** The renderer's atoms on the calling test's services, so `TestClock.adjust` reaches their waits. */
export const registryOnTestClock: Effect.Effect<AtomRegistry.AtomRegistry> = Effect.map(
  Effect.context<never>(),
  (services) =>
    AtomRegistry.make({ initialValues: [[rendererRuntime, AsyncResult.success(services)]] }),
);

/** `element` under that registry, as the window's root provides its own. */
export function onRegistry(
  registry: AtomRegistry.AtomRegistry,
  element: ReactElement,
): ReactElement {
  return createElement(RegistryContext.Provider, { value: registry }, element);
}

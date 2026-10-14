/**
 * copy-feedback.ts -- what a test of a copy stands on: the renderer's atoms under a registry the test supplies, on the test's own clock where it asks.
 *
 * A test that waits on an atom's own timer runs on `it.effect` and hands the
 * atoms its own services, `TestClock` among them, so `TestClock.adjust`
 * reaches every wait an atom forked.
 */

import { RegistryContext } from "@effect/atom-react/RegistryContext";
import { Effect } from "effect";
import * as AsyncResult from "effect/reactivity/AsyncResult";
import * as AtomRegistry from "effect/reactivity/AtomRegistry";
import { createElement, type ReactElement } from "react";
import { rendererRuntime } from "../renderer/renderer-runtime";

/** A registry whose renderer runtime is the test's own services, so the atoms' timers run on its `TestClock`. */
export const registryOnTestClock: Effect.Effect<AtomRegistry.AtomRegistry> = Effect.map(
  Effect.context<never>(),
  (services) =>
    AtomRegistry.make({ initialValues: [[rendererRuntime, AsyncResult.success(services)]] }),
);

/** `element` under `registry`, as the window's root provides its own. */
export function onRegistry(
  registry: AtomRegistry.AtomRegistry,
  element: ReactElement,
): ReactElement {
  return createElement(RegistryContext.Provider, { value: registry }, element);
}

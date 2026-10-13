/**
 * copy-feedback.ts -- what a test of a copy stands on: the renderer's atoms under a registry the test supplies.
 */

import { RegistryContext } from "@effect/atom-react/RegistryContext";
import type * as AtomRegistry from "effect/reactivity/AtomRegistry";
import { createElement, type ReactElement } from "react";

/** `element` under `registry`, as the window's root provides its own. */
export function onRegistry(
  registry: AtomRegistry.AtomRegistry,
  element: ReactElement,
): ReactElement {
  return createElement(RegistryContext.Provider, { value: registry }, element);
}

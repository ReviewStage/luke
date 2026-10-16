/**
 * browser.ts -- what a browser test of a shared component stands on: the
 * component mounted in a real page at a profile and theme, and that page's
 * accessibility as axe reads it.
 *
 * A component is mounted under the document's own profile and theme, as an
 * app root carries them, so anything it portals into the body reads the same
 * tokens; the stylesheet it is drawn with is the one the apps import.
 */

import axe from "axe-core";
import { act, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { PROFILE, type SurfaceAttributes, surfaceAttributes, THEME } from "../tokens/surface.js";
import "../tokens/tokens.css";

/** A component mounted for a test: the element it was drawn into. */
export interface Mounted {
  readonly container: HTMLElement;
}

const roots: Root[] = [];

/** Draws `element` into a fresh container on a page at `surface`, the desktop's dark unless asked. */
export async function mount(
  element: ReactElement,
  surface: SurfaceAttributes = surfaceAttributes(PROFILE.DESKTOP, THEME.DARK),
): Promise<Mounted> {
  for (const [name, value] of Object.entries(surface)) {
    document.documentElement.setAttribute(name, value);
  }
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  await act(async () => root.render(element));
  return { container };
}

/** Unmounts every component mounted since the last call and empties the page. */
export async function unmountAll(): Promise<void> {
  for (const root of roots.splice(0)) {
    await act(async () => root.unmount());
  }
  document.body.replaceChildren();
}

/** What axe finds wrong in `within`, by rule: an empty list is a pass. */
export async function accessibilityViolations(within: Element): Promise<readonly string[]> {
  const results = await axe.run(within, { resultTypes: ["violations"] });
  return results.violations.map((violation) => violation.id);
}

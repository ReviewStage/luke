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
import "../styles.css";
import "./page.css";

/** A component mounted for a test: the element it was drawn into. */
export interface Mounted {
  readonly container: HTMLElement;
}

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

const roots: Root[] = [];

/**
 * Runs `work` under React's `act`, and tells React it is under one only for
 * as long as it is. Note that the flag is not left on, because a browser
 * test's updates come from trusted events the page dispatches outside any
 * `act`, and React would report each of those as a mistake.
 */
async function inAct(work: () => void): Promise<void> {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  try {
    await act(async () => work());
  } finally {
    globalThis.IS_REACT_ACT_ENVIRONMENT = false;
  }
}

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
  await inAct(() => root.render(element));
  return { container };
}

/** Unmounts every component mounted since the last call and empties the page. */
export async function unmountAll(): Promise<void> {
  for (const root of roots.splice(0)) {
    await inAct(() => root.unmount());
  }
  document.body.replaceChildren();
}

/** What axe finds wrong in `within`, each as its rule and the element it found it on: an empty list is a pass. */
export async function accessibilityViolations(within: Element): Promise<readonly string[]> {
  const results = await axe.run(within, { resultTypes: ["violations"] });
  return results.violations.flatMap((violation) =>
    violation.nodes.map((node) => `${violation.id} ${node.target.join(" ")}`),
  );
}

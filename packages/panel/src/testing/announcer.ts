/**
 * announcer.ts -- what a test of words said aloud reads: the window's one `Announcer`, mounted beside the surface under test, and what its two regions say now.
 *
 * `announce` says nothing before an `Announcer` stands, and a window holds one
 * pair of regions however many mount, so the helper mounts one in a container
 * of its own, outside the surface a test queries, and unmounts it after the
 * test, so a later test's `Announcer` is not left waiting on a region no one
 * draws.
 */

import { Announcer } from "@luke/ui";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach } from "vitest";

const roots: Root[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount());
});

/** Mounts the window's `Announcer`, whose regions start empty. */
export function mountAnnouncer(): void {
  const root = createRoot(document.body.appendChild(document.createElement("div")));
  roots.push(root);
  act(() => root.render(createElement(Announcer)));
}

/** What the polite region says now: what was done or is asked, once the reader is free. */
export function announcedPolitely(): string {
  return document.querySelector('[role="status"][aria-live="polite"]')?.textContent ?? "";
}

/** What the alert region says now: what was refused. */
export function announcedAsAlert(): string {
  return document.querySelector('[role="alert"][aria-live="assertive"]')?.textContent ?? "";
}

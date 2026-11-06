import { Announcer } from "@repo/ui";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach } from "vitest";

const roots: Root[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount());
});

export function mountAnnouncer(): void {
  const root = createRoot(document.body.appendChild(document.createElement("div")));
  roots.push(root);
  act(() => root.render(createElement(Announcer)));
}

export function announcedPolitely(): string {
  return document.querySelector('[role="status"][aria-live="polite"]')?.textContent ?? "";
}

export function announcedAsAlert(): string {
  return document.querySelector('[role="alert"][aria-live="assertive"]')?.textContent ?? "";
}

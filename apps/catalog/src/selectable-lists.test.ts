// @vitest-environment jsdom

import { selectableListBehavior } from "@repo/ui/testing/selectable-list";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { vi } from "vitest";
import { SELECTION_EXAMPLE } from "./examples/selection.js";

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function drawn(id: string) {
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe(): void {}
      disconnect(): void {}
    },
  );
  const container = document.body.appendChild(document.createElement("div"));
  const root: Root = createRoot(container);
  act(() => root.render(createElement(SELECTION_EXAMPLE.Render)));
  const box = container.querySelector<HTMLElement>(`#${id}`);
  if (box === null) throw new Error(`The example draws no box ${id}`);
  return {
    root: box,
    opened: () =>
      [...box.querySelectorAll<HTMLElement>("[data-select-key]")]
        .filter((press) => press.textContent?.includes("(open)"))
        .map((press) => press.getAttribute("data-select-key") ?? ""),
    unmount: () => {
      act(() => root.unmount());
      container.remove();
      vi.unstubAllGlobals();
    },
  };
}

selectableListBehavior("CATALOG", { part: "List", mount: () => drawn("selection-tasks-list") });
selectableListBehavior("CATALOG", { part: "cards", mount: () => drawn("selection-cards-region") });

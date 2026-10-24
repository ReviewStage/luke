// @vitest-environment jsdom

import { selectableListBehaviour } from "@luke/ui/testing/selectable-list";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { vi } from "vitest";
import { SELECTION_EXAMPLE } from "./examples/selection.js";

/**
 * selectable-lists.test.ts -- the catalog's two selectable lists, the `List`
 * of rows and the cards of the app's own in a `SelectionRegion`, are chosen
 * as every selectable list is (`@luke/ui/testing/selectable-list`), the
 * example's opening choice of two rows let go before each test.
 */

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

/** The example drawn, handing over the box with the id given and the rows whose title says they opened. */
function drawn(id: string) {
  // Note that every row measures its title, so the example draws beside a ResizeObserver, which jsdom lacks.
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

selectableListBehaviour("CATALOG", { part: "List", mount: () => drawn("selection-tasks-list") });
selectableListBehaviour("CATALOG", { part: "cards", mount: () => drawn("selection-cards-region") });

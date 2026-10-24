// @vitest-environment jsdom

import assert from "node:assert/strict";
import { CommandDialog } from "@luke/ui/command";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, test } from "vitest";
import { layContainersAt, shown } from "../testing/container-width.js";

/**
 * narrow-room-sheets.test.ts -- in a narrow room, a phone's, Settings' page
 * list leads with its one Back, the history's Back and Forward left out,
 * and ⌘K's palette (`@luke/ui/command`'s CommandDialog) is a sheet across
 * the screen's whole width from its top, its corners rounded only where it
 * ends; in a wide room both stand as they always have. The shell's room is
 * its `data-room`, and the document's root wears it too as `data-luke-room`
 * (`stage-room.ts`), which the palette, drawn at the body outside the
 * shell, answers. jsdom lays nothing out, so the stylesheets are laid
 * (`testing/container-width.ts`) and what each draws is read from its
 * computed style. Synthetic throughout.
 */

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

const roots: Root[] = [];

let laid: HTMLStyleElement | undefined;

beforeAll(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  // Note that jsdom lays nothing out: cmdk measures its list, which does nothing here.
  globalThis.ResizeObserver = class {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  };
});

afterEach(() => {
  act(() => {
    for (const root of roots.splice(0)) root.unmount();
  });
  document.body.innerHTML = "";
  document.documentElement.removeAttribute("data-luke-room");
  laid?.remove();
  laid = undefined;
});

/** The shell in the room given, its Settings list leading with the history's buttons, and the palette open at the body beside it. */
function drawnIn(room: "narrow" | "wide") {
  laid = layContainersAt({});
  document.documentElement.setAttribute("data-luke-room", room);
  const shell = document.body.appendChild(document.createElement("div"));
  shell.className = "desktop-shell";
  shell.dataset.room = room;
  const list = shell.appendChild(document.createElement("nav"));
  list.className = "settings-pages";
  const history = list.appendChild(document.createElement("div"));
  history.className = "title-bar-controls";
  const root = createRoot(document.body.appendChild(document.createElement("div")));
  roots.push(root);
  act(() =>
    root.render(
      createElement(CommandDialog, {
        open: true,
        onOpenChange: () => undefined,
        label: "Command palette",
        placeholder: "Search",
        groups: [],
      }),
    ),
  );
  const card = document.querySelector('[data-slot="dialog-content"]');
  assert.ok(card, "the palette's card stands");
  const style = getComputedStyle(card);
  return {
    history: shown(history),
    palette: { width: style.width, topCorner: style.borderTopLeftRadius },
  };
}

test("in a narrow room Settings' list draws no history buttons beside its Back, and the palette spans the screen, rounded only at its foot", () => {
  assert.deepEqual(drawnIn("narrow"), {
    history: false,
    palette: { width: "100%", topCorner: "0px" },
  });
});

test("in a wide room the history buttons stand and the palette is a card at its own measure, rounded all round, as before", () => {
  const wide = drawnIn("wide");
  assert.equal(wide.history, true);
  assert.notEqual(wide.palette.width, "100%");
  assert.notEqual(wide.palette.topCorner, "0px");
});

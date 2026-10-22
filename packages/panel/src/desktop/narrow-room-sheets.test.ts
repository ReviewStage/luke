// @vitest-environment jsdom

import assert from "node:assert/strict";
import { afterEach, test } from "vitest";
import { layContainersAt, shown } from "../testing/container-width.js";

/**
 * narrow-room-sheets.test.ts -- in a narrow room, a phone's, Settings' page
 * list leads with its one Back, the history's Back and Forward left out,
 * and the command palette is a sheet across the screen's whole width from
 * its top; in a wide room both stand as they always have. The shell's room
 * is its `data-room`, which `shell-room.ts` sets; the palette is drawn at
 * the body, outside the shell. jsdom lays nothing out, so the stylesheets
 * are laid (`testing/container-width.ts`) and what each draws is read from
 * its computed style. Synthetic throughout.
 */

let laid: HTMLStyleElement | undefined;

afterEach(() => {
  document.body.innerHTML = "";
  laid?.remove();
  laid = undefined;
});

/** The shell in the room given, its Settings list leading with the history's buttons, and the palette at the body beside it. */
function drawnIn(room: "narrow" | "wide") {
  laid = layContainersAt({});
  const shell = document.body.appendChild(document.createElement("div"));
  shell.className = "desktop-shell";
  shell.dataset.room = room;
  const list = shell.appendChild(document.createElement("nav"));
  list.className = "settings-pages";
  const history = list.appendChild(document.createElement("div"));
  history.className = "title-bar-controls";
  const palette = document.body.appendChild(document.createElement("div"));
  palette.className = "command-palette";
  const style = getComputedStyle(palette);
  return {
    history: shown(history),
    palette: { left: style.left, width: style.width, transform: style.transform },
  };
}

test("in a narrow room Settings' list draws no history buttons beside its Back, and the palette spans the screen from its left edge", () => {
  assert.deepEqual(drawnIn("narrow"), {
    history: false,
    palette: { left: "0px", width: "100%", transform: "none" },
  });
});

test("in a wide room the history buttons stand and the palette floats centred, as before", () => {
  const wide = drawnIn("wide");
  assert.equal(wide.history, true);
  assert.equal(wide.palette.left, "50%");
  assert.equal(wide.palette.transform, "translateX(-50%)");
});

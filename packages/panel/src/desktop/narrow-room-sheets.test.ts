// @vitest-environment jsdom

import assert from "node:assert/strict";
import { afterEach, test } from "vitest";
import { layContainersAt } from "../testing/container-width.js";

/**
 * narrow-room-sheets.test.ts -- in a narrow room, a phone's, the command
 * palette is a sheet across the screen's whole width from its top; in a
 * wide room it floats centred as it always has. The shell's room is its
 * `data-room`, which `shell-room.ts` sets; the palette is drawn at the body,
 * outside the shell. jsdom lays nothing out, so the stylesheets are laid
 * (`testing/container-width.ts`) and what it draws is read from its
 * computed style. Synthetic throughout.
 */

let laid: HTMLStyleElement | undefined;

afterEach(() => {
  document.body.innerHTML = "";
  laid?.remove();
  laid = undefined;
});

/** The shell in the room given, and the palette at the body beside it, as the palette is drawn. */
function drawnIn(room: "narrow" | "wide") {
  laid = layContainersAt({});
  const shell = document.body.appendChild(document.createElement("div"));
  shell.className = "desktop-shell";
  shell.dataset.room = room;
  const palette = document.body.appendChild(document.createElement("div"));
  palette.className = "command-palette";
  const style = getComputedStyle(palette);
  return { left: style.left, width: style.width, transform: style.transform };
}

test("in a narrow room the palette spans the screen from its left edge", () => {
  assert.deepEqual(drawnIn("narrow"), { left: "0px", width: "100%", transform: "none" });
});

test("in a wide room the palette floats centred, as before", () => {
  const wide = drawnIn("wide");
  assert.equal(wide.left, "50%");
  assert.equal(wide.transform, "translateX(-50%)");
});

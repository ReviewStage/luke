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
 * its computed style. A task's Chat tab, headed on a phone by the task's
 * header alone, draws no channel head under it, where the window's Chat
 * keeps its own. Synthetic throughout.
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

/** A channel's head in the room given: a task's Chat tab's, and the window's Chat's beside it. */
function chatHeadsIn(room: "narrow" | "wide") {
  laid?.remove();
  document.body.innerHTML = "";
  laid = layContainersAt({});
  const shell = document.body.appendChild(document.createElement("div"));
  shell.className = "desktop-shell";
  shell.dataset.room = room;
  const head = (inside: HTMLElement) => {
    const header = inside.appendChild(document.createElement("header"));
    header.className = "desktop-toolbar chat-head";
    return header;
  };
  const tab = shell.appendChild(document.createElement("section"));
  tab.className = "desktop-task-chat";
  const place = shell.appendChild(document.createElement("section"));
  place.className = "chat-stream";
  return { tab: shown(head(tab)), place: shown(head(place)) };
}

test("in a narrow room a task's Chat tab draws no channel head under the task's header, and the window's Chat keeps its own", () => {
  assert.deepEqual(chatHeadsIn("narrow"), { tab: false, place: true });
  assert.deepEqual(chatHeadsIn("wide"), { tab: true, place: true });
});

/** A Terminal tab's shells in the room given, its panel as wide as a phone on its side leaves it, shut or floated open over the screen. */
function shellsIn(room: "narrow" | "wide", over: "closed" | "open") {
  laid?.remove();
  document.body.innerHTML = "";
  laid = layContainersAt({ "side-panel": 800 });
  const shell = document.body.appendChild(document.createElement("div"));
  shell.className = "desktop-shell";
  shell.dataset.room = room;
  const tab = shell.appendChild(document.createElement("section"));
  tab.className = "terminal-tab file-view";
  tab.dataset.paneOver = over;
  const shells = tab.appendChild(document.createElement("aside"));
  shells.className = "terminal-shells";
  return { shown: shown(shells), floats: getComputedStyle(shells).position === "absolute" };
}

test("on a phone on its side, wider than the panel's own line, a Terminal tab's shells still float over the screen, shut until asked, and a wide room docks them as before", () => {
  assert.deepEqual(shellsIn("narrow", "closed"), { shown: false, floats: true });
  assert.deepEqual(shellsIn("narrow", "open"), { shown: true, floats: true });
  assert.equal(shellsIn("wide", "open").floats, false);
});

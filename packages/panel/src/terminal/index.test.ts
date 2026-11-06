// @vitest-environment jsdom

import assert from "node:assert/strict";
import { COMMAND_KEY, installCommandKey } from "@repo/settings/shortcuts";
import { FitAddon } from "@xterm/addon-fit";
import { afterEach, beforeEach, test, vi } from "vitest";
import { relayout } from "../testing/resize-observer.js";
import { TERMINAL_FIND, type TerminalHandle, type TerminalSize } from "./contract.js";
import { terminal } from "./index.js";

/**
 * The terminal bundle, through the one door a terminal session makes its
 * screen by (its entry's `terminal`): which keys reach the shell, which pass
 * to the window, a palette color drawn by its class rather than a style
 * attribute, a screen moved out of its box and into another keeping
 * what it drew, and the sizes it says as its box is fitted.
 */

/** A key press as the window reports one: the key, its legacy code, and the modifiers held. */
interface Press {
  readonly key: string;
  readonly keyCode: number;
  readonly metaKey?: boolean;
  readonly shiftKey?: boolean;
  readonly ctrlKey?: boolean;
}

const ENTER = { key: "Enter", keyCode: 13 } as const;

let mounted: TerminalHandle | undefined;

beforeEach(() => {
  // jsdom has no constructed-sheet adoption and no media queries; the window has both.
  Object.defineProperty(document, "adoptedStyleSheets", {
    configurable: true,
    writable: true,
    value: [],
  });
  // The terminal asks after the appearance and the display's resolution, which never change here.
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: () => ({
      matches: false,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      addListener: () => undefined,
      removeListener: () => undefined,
    }),
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  mounted?.dispose();
  mounted = undefined;
  document.body.innerHTML = "";
});

/** A terminal shown in a host of its own, with what it sent the shell, the sizes it said, and what the window heard. */
function mountTerminal() {
  const host = document.createElement("div");
  document.body.append(host);
  const sent: string[] = [];
  const sizes: TerminalSize[] = [];
  const heard: KeyboardEvent[] = [];
  const hear = (event: KeyboardEvent) => heard.push(event);
  window.addEventListener("keydown", hear);
  mounted = terminal.create({
    onInput: (data) => sent.push(data),
    onResize: (size) => sizes.push(size),
    onLink: () => undefined,
  });
  mounted.attach(host);
  const keyboard = host.querySelector("textarea");
  assert.ok(keyboard, "the terminal takes the keyboard through its own field");
  const press = (key: Press): KeyboardEvent => {
    const event = new KeyboardEvent("keydown", { ...key, bubbles: true, cancelable: true });
    keyboard.dispatchEvent(event);
    if (!event.defaultPrevented) {
      keyboard.dispatchEvent(
        new KeyboardEvent("keypress", { ...key, bubbles: true, cancelable: true }),
      );
    }
    return event;
  };
  return {
    host,
    sent,
    sizes,
    heard,
    press,
    done: () => window.removeEventListener("keydown", hear),
  };
}

test("a Command chord passes to the window, and the shell hears nothing of it", () => {
  const terminal = mountTerminal();
  const palette = terminal.press({ key: "k", keyCode: 75, metaKey: true });
  // ⇧⌘⏎ fills the window with the panel, a Return the terminal would otherwise send the shell.
  const fullScreen = terminal.press({ ...ENTER, metaKey: true, shiftKey: true });
  terminal.done();
  assert.deepEqual(terminal.sent, []);
  assert.deepEqual(terminal.heard, [palette, fullScreen]);
  assert.equal(palette.defaultPrevented, false);
});

test("⌃Tab and ⌃⇧Tab pass to the window's tab switcher, and the shell hears no Tab of them", () => {
  const terminal = mountTerminal();
  const on = terminal.press({ key: "Tab", keyCode: 9, ctrlKey: true });
  const back = terminal.press({ key: "Tab", keyCode: 9, ctrlKey: true, shiftKey: true });
  terminal.press({ key: "Tab", keyCode: 9 });
  terminal.done();
  assert.deepEqual(terminal.heard.slice(0, 2), [on, back]);
  assert.deepEqual(terminal.sent, ["\t"]);
});

test("off a Mac, where the window's chords are Ctrl ones, every Ctrl chord is the shell's, Ctrl+K and ⌃Tab included, and the window hears none of them", () => {
  const restore = installCommandKey(COMMAND_KEY.CONTROL);
  const terminal = mountTerminal();
  terminal.press({ key: "k", keyCode: 75, ctrlKey: true });
  terminal.press({ key: "Tab", keyCode: 9, ctrlKey: true });
  terminal.done();
  restore();
  assert.equal(terminal.sent[0], "\x0b");
  assert.equal(terminal.sent.length, 2);
  assert.deepEqual(terminal.heard, []);
});

test("Shift+Return sends a line feed where Return sends a carriage return", () => {
  const terminal = mountTerminal();
  terminal.press({ ...ENTER, shiftKey: true });
  terminal.press(ENTER);
  terminal.done();
  assert.deepEqual(terminal.sent, ["\n", "\r"]);
});

test("⌘←, ⌘→, and ⌘⌫ are the shell's line keys and never the window's", () => {
  const terminal = mountTerminal();
  terminal.press({ key: "ArrowLeft", keyCode: 37, metaKey: true });
  terminal.press({ key: "ArrowRight", keyCode: 39, metaKey: true });
  terminal.press({ key: "Backspace", keyCode: 8, metaKey: true });
  terminal.done();
  assert.deepEqual(terminal.sent, ["\x01", "\x05", "\x15"]);
  assert.deepEqual(terminal.heard, []);
});

test("Escape and Control chords are the shell's, and Escape never reaches the window's layers", () => {
  const terminal = mountTerminal();
  terminal.press({ key: "Escape", keyCode: 27 });
  terminal.press({ key: "c", keyCode: 67, ctrlKey: true });
  terminal.done();
  assert.deepEqual(terminal.sent, ["\x1b", "\x03"]);
  assert.deepEqual(terminal.heard, []);
});

test("without WebGL a palette color is drawn by its class, never by a style attribute the panel's policy refuses", async () => {
  const terminal = mountTerminal();
  terminal.done();
  // The default palette's black on its black ground, a pair that falls short of any contrast asked for.
  await new Promise<void>((resolve) => mounted?.write("\x1b[30mshadow\x1b[0m", resolve));
  await new Promise((resolve) => requestAnimationFrame(resolve));
  const cell = [...terminal.host.querySelectorAll(".xterm-rows span")].find(
    (span) => span.textContent === "shadow",
  );
  assert.ok(cell, "the line is drawn");
  assert.equal(cell.getAttribute("style"), null);
});

/** The face the screen's rows are drawn in, as the DOM renderer's own rules name it. */
function drawnFace(host: HTMLElement): string | undefined {
  const rules = [...host.querySelectorAll("style")].map((style) => style.textContent ?? "");
  const rows = rules.find((text) => text.includes(".xterm-rows {"));
  return rows?.match(/font-family: ([^;]+);/)?.[1];
}

/** A host whose window's monospace stack is a web font, as the web app's profile names it. */
function webFontHost(): HTMLElement {
  const host = document.createElement("div");
  host.style.setProperty("--ui-font-mono", '"JetBrains Mono Variable", monospace');
  document.body.append(host);
  return host;
}

const QUIET = { onInput: () => undefined, onResize: () => undefined, onLink: () => undefined };

test("a face the page is still fetching is stood in for by the system's monospace, and drawn in once it lands", async () => {
  const landed = Promise.withResolvers<FontFace[]>();
  const asked: string[] = [];
  Object.defineProperty(document, "fonts", {
    configurable: true,
    value: {
      check: () => false,
      load: (face: string) => {
        asked.push(face);
        return landed.promise;
      },
    },
  });
  const host = webFontHost();
  mounted = terminal.create(QUIET);
  mounted.attach(host);

  assert.equal(drawnFace(host), "monospace", "the cells are measured in a face the page holds");
  landed.resolve([]);
  await landed.promise;
  await Promise.resolve();

  assert.equal(drawnFace(host), '"JetBrains Mono Variable", monospace');
  assert.deepEqual(asked, ['12px "JetBrains Mono Variable", monospace']);
  Reflect.deleteProperty(document, "fonts");
});

test("a face already loaded is drawn in at once, and nothing is fetched", () => {
  const asked: string[] = [];
  Object.defineProperty(document, "fonts", {
    configurable: true,
    value: {
      check: () => true,
      load: (face: string) => {
        asked.push(face);
        return Promise.resolve([]);
      },
    },
  });
  const host = webFontHost();
  mounted = terminal.create(QUIET);
  mounted.attach(host);

  assert.equal(drawnFace(host), '"JetBrains Mono Variable", monospace');
  assert.deepEqual(asked, []);
  Reflect.deleteProperty(document, "fonts");
});

test("a screen taken out of its box and shown in another keeps what it drew", async () => {
  const terminal = mountTerminal();
  terminal.done();
  assert.ok(mounted);
  await new Promise<void>((resolve) => mounted?.write("kept across tabs\r\n", resolve));
  mounted.detach();
  assert.equal(terminal.host.childElementCount, 0, "the old box holds nothing of the screen");
  const other = document.createElement("div");
  document.body.append(other);
  mounted.attach(other);

  const tallies: number[] = [];
  const stop = mounted.find.onTally((tally) => tallies.push(tally.count));
  mounted.find.find("kept across tabs", TERMINAL_FIND.TYPED);
  stop();
  assert.deepEqual(tallies, [1]);
});

test("a screen fitted again says its new size as columns and rows alone, the shape a shell's attach takes", async () => {
  // jsdom lays out no box and measures no cell, so the window's layout is staged: a box with room, and the cells it fits.
  vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(800);
  vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockReturnValue(400);
  const fits = vi
    .spyOn(FitAddon.prototype, "proposeDimensions")
    .mockReturnValue({ cols: 80, rows: 24 });
  const terminal = mountTerminal();
  terminal.done();
  const frame = () => new Promise((resolve) => requestAnimationFrame(resolve));
  relayout();
  await frame();
  fits.mockReturnValue({ cols: 100, rows: 30 });
  relayout();
  await frame();

  assert.deepEqual(terminal.sizes, [
    { cols: 80, rows: 24 },
    { cols: 100, rows: 30 },
  ]);
});

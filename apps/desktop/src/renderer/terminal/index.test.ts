// @vitest-environment jsdom

import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "vitest";
import type { TerminalHandle } from "./contract";
import "./index";

/**
 * The terminal bundle, through the one door a Terminal tab mounts it by
 * (`window.lukeTerminal`): which keys reach the shell, which pass to the
 * window, and the colours it draws in as the appearance flips.
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

/** The query whose answer flips with the system's appearance. */
const LIGHT_APPEARANCE = "(prefers-color-scheme: light)";

/** The appearance query's listeners, so a test can flip it as macOS would. */
const appearanceListeners = new Set<() => void>();

let mounted: TerminalHandle | undefined;

beforeEach(() => {
  // jsdom has no constructed-sheet adoption and no media queries; the window has both.
  Object.defineProperty(document, "adoptedStyleSheets", {
    configurable: true,
    writable: true,
    value: [],
  });
  // The terminal also asks after the display's resolution, which never changes here.
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: (query: string) => ({
      matches: false,
      addEventListener: (_type: string, listener: () => void) => {
        if (query === LIGHT_APPEARANCE) appearanceListeners.add(listener);
      },
      removeEventListener: (_type: string, listener: () => void) =>
        appearanceListeners.delete(listener),
      addListener: () => undefined,
      removeListener: () => undefined,
    }),
  });
});

afterEach(() => {
  mounted?.unmount();
  mounted = undefined;
  appearanceListeners.clear();
  document.body.innerHTML = "";
});

/** A terminal mounted in a host of its own, with what it sent the shell and what the window heard. */
function mountTerminal() {
  const module = window.lukeTerminal;
  assert.ok(module, "the bundle sets its module on the window");
  const host = document.createElement("div");
  document.body.append(host);
  const sent: string[] = [];
  const heard: KeyboardEvent[] = [];
  const hear = (event: KeyboardEvent) => heard.push(event);
  window.addEventListener("keydown", hear);
  mounted = module.mount(host, {
    onInput: (data) => sent.push(data),
    onResize: () => undefined,
    onLink: () => undefined,
  });
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
  return { host, sent, heard, press, done: () => window.removeEventListener("keydown", hear) };
}

/** A red the stylesheet never sets, as the document may spell it back. */
const RED = /#123456|rgb\(18, 52, 86\)/;

/** Every rule the document adopted, as text. */
function adoptedRules(): string {
  return document.adoptedStyleSheets
    .flatMap((sheet) => [...sheet.cssRules].map((rule) => rule.cssText))
    .join("\n");
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

test("the terminal draws in the tokens as they stand, again when the appearance flips, and lets its rules go when taken down", async () => {
  const terminal = mountTerminal();
  terminal.done();
  // The rules are adopted as the document reports the terminal wrote them, after the statement that did.
  await Promise.resolve();
  const drawn = adoptedRules();
  terminal.host.style.setProperty("--terminal-red", "#123456");
  for (const listener of appearanceListeners) listener();
  await Promise.resolve();
  assert.match(drawn, /\.xterm-fg-1\b/);
  assert.doesNotMatch(drawn, RED);
  assert.match(adoptedRules(), RED);
  mounted?.unmount();
  mounted = undefined;
  assert.equal(document.adoptedStyleSheets.length, 0);
});

test("without WebGL a palette colour is drawn by its class, never by a style attribute the panel's policy refuses", async () => {
  const terminal = mountTerminal();
  terminal.done();
  // The default palette's black on its black ground, a pair that falls short of any contrast asked for.
  await new Promise<void>((resolve) => mounted?.write("\x1b[30mshadow\x1b[0m", resolve));
  await new Promise((resolve) => requestAnimationFrame(resolve));
  const cell = [...terminal.host.querySelectorAll(".xterm-rows span")].find(
    (span) => span.textContent === "shadow",
  );
  assert.ok(cell, "the line is drawn");
  assert.ok(cell.classList.contains("xterm-fg-0"));
  assert.equal(cell.getAttribute("style"), null);
});

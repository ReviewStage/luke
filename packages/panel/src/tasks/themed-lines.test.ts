/**
 * themed-lines.test.ts -- a File tab's lines in the syntax themes View settings chose: as the host coloured them in the default themes, the diff bundle never loaded; coloured again a window at a time in any other pair, the host's colours standing until each lands and wherever one gives none; and coloured again when the themes change. Synthetic files only.
 */

// @vitest-environment jsdom

import assert from "node:assert/strict";
import type { CodeLines } from "@luke/features/tasks-view";
import * as AtomRegistry from "effect/reactivity/AtomRegistry";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, test } from "vitest";
import { sideBundles } from "../bundle-loader.js";
import type { ColouredLines, ColourRequest, DiffViewModule } from "../diff-view/contract.js";
import { fakeAppBridge } from "../testing/app-bridge.js";
import { handSettings } from "../testing/app-state.js";
import { onRegistry } from "../testing/copy-feedback.js";
import { onSideBundles } from "../testing/side-bundles.js";
import { useFileViewSettings } from "./file-view-settings.js";
import { type RunRead, ThemedCodeLinesView, ThemeWarmer } from "./themed-lines.js";

const roots: Root[] = [];

/** Each colouring the bundle was asked for, how many times the bundle was imported, and what its import waits on. */
let asked: ColourRequest[] = [];
let imported = 0;
let landing: Promise<void> = Promise.resolve();

/** How many runs were drawn, which names each its own unless a test names one. */
let runs = 0;

/** A read no other drawn run came from. */
function nextRun(): RunRead {
  runs += 1;
  return { source: "src/seats.ts", revision: String(runs) };
}

/** What the bundle answers a colouring with unless a test says otherwise: each line in one run of Dracula's pink. */
const PINK = (request: ColourRequest): ColouredLines | undefined => ({
  lines: request.lines.map((text) =>
    text === "" ? [] : [{ text, color: "#ff79c6", lightColor: "#859900" }],
  ),
  ground: { dark: "#282a36", light: "#fdf6e3" },
});

/** What the bundle answers a colouring with. */
let answer = PINK;

const STAND_IN: DiffViewModule = {
  mount: () => ({ update: () => undefined, unmount: () => undefined }),
  mountList: () => ({ update: () => 0, reveal: () => 0, unmount: () => undefined }),
  colourLines: (request) => {
    asked.push(request);
    return Promise.resolve(answer(request));
  },
};

/** Lines as the host coloured them: each its own text, coloured in GitHub's dark red. */
function hostLines(count: number, from = 1): CodeLines {
  return Array.from({ length: count }, (_, index) => [
    { text: `line ${from + index}`, color: "#ff7b72", lightColor: "#cf222e" },
  ]);
}

/** The settings' door, held so a test can change the themes as View settings would. */
let settingsDoor: ReturnType<typeof useFileViewSettings> | undefined;

function Settings(): null {
  settingsDoor = useFileViewSettings();
  return null;
}

beforeEach(() => {
  // Note that act settles a render only where the window says it runs under act.
  Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);
  landing = Promise.resolve();
  answer = PINK;
  asked = [];
  imported = 0;
  fakeAppBridge({});
});

afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount());
  document.body.innerHTML = "";
});

/** Lets the bundle's import and its colourings land and be drawn. */
async function flush(): Promise<void> {
  await act(async () => {
    for (let tick = 0; tick < 20; tick += 1) await Promise.resolve();
  });
}

/** Draws `lines` from line 1 in the themes the settings hold, from `read` or a read of its own, and lets what it asks for land. */
async function draw(lines: CodeLines, { read }: { read?: RunRead } = {}): Promise<HTMLElement> {
  const container = document.body.appendChild(document.createElement("div"));
  const root = createRoot(container);
  roots.push(root);
  const bundles = sideBundles({
    diffView: () => {
      imported += 1;
      return landing.then(() => STAND_IN);
    },
  });
  act(() =>
    root.render(
      onRegistry(
        AtomRegistry.make(),
        onSideBundles(
          bundles,
          createElement(
            "div",
            null,
            createElement(Settings),
            createElement(ThemedCodeLinesView, {
              name: "src/seats.ts",
              read: read ?? nextRun(),
              look: { lineNumbers: true, wrap: true },
              firstLine: 1,
              lines,
              pointed: { path: "src/seats.ts" },
            }),
          ),
        ),
      ),
    ),
  );
  await flush();
  return container;
}

/** Each drawn line's first run's dark colour. */
function drawnColours(container: HTMLElement): (string | undefined)[] {
  return [...container.querySelectorAll(".code-line-text")].map(
    (line) => line.querySelector("span")?.style.getPropertyValue("--run-dark") || undefined,
  );
}

test("in the default themes the host's colours are drawn and the diff bundle is never loaded", async () => {
  handSettings();
  const container = await draw(hostLines(3));

  assert.equal(imported, 0);
  assert.deepEqual(drawnColours(container), ["#ff7b72", "#ff7b72", "#ff7b72"]);
  assert.equal(container.querySelector(".code-lines-ground"), null);
});

test("in another pair each window held is coloured again, its words the same, on the theme's ground", async () => {
  handSettings({ diffDarkTheme: "dracula", diffLightTheme: "solarized-light" });
  const container = await draw(hostLines(700));

  assert.equal(imported, 1);
  assert.deepEqual(
    asked.map((request) => [request.lines.length, request.lines[0], request.look.themes]),
    [
      [500, "line 1", { dark: "dracula", light: "solarized-light" }],
      [200, "line 501", { dark: "dracula", light: "solarized-light" }],
    ],
    "one colouring per window, each its own lines' words",
  );
  assert.ok(drawnColours(container).every((colour) => colour === "#ff79c6"));
  const ground =
    container.querySelector<HTMLElement>(".code-lines-ground") ?? assert.fail("a ground");
  assert.equal(ground.style.getPropertyValue("--theme-ground-dark"), "#282a36");
});

test("a window given no colours, or other words, or drawn plain by the host, keeps the host's", async () => {
  handSettings({ diffDarkTheme: "dracula", diffLightTheme: "solarized-light" });
  answer = (request) =>
    request.lines[0] === "line 1"
      ? undefined
      : {
          lines: request.lines.map(() => [{ text: "other words", color: "#ff79c6" }]),
          ground: { dark: "#282a36", light: "#fdf6e3" },
        };
  const plain = Array.from({ length: 3 }, (_, index) => [{ text: `plain ${index}` }]);
  const container = await draw([...hostLines(500), ...hostLines(2, 501), ...plain]);

  assert.equal(asked.length, 2, "the host's plain window is never asked for");
  assert.ok(
    drawnColours(container)
      .slice(0, 502)
      .every((colour) => colour === "#ff7b72"),
  );
  assert.deepEqual(drawnColours(container).slice(502), [undefined, undefined, undefined]);
});

test("changing the themes colours the lines again in the pair chosen", async () => {
  answer = (request) => ({
    lines: request.lines.map((text) => [
      { text, color: request.look.themes.dark === "nord" ? "#88c0d0" : "#ff79c6" },
    ]),
    ground: { dark: "#282a36", light: "#fdf6e3" },
  });
  handSettings({ diffDarkTheme: "dracula", diffLightTheme: "solarized-light" });
  const container = await draw(hostLines(2));
  assert.equal(drawnColours(container)[0], "#ff79c6");

  await act(async () => {
    await settingsDoor?.change("diffDarkTheme", "nord");
  });
  await flush();

  assert.equal(asked.at(-1)?.look.themes.dark, "nord");
  assert.equal(drawnColours(container)[0], "#88c0d0");
});

test("the window in view is asked for first, and no more than two are out at once", async () => {
  handSettings({ diffDarkTheme: "dracula", diffLightTheme: "solarized-light" });
  const landed = Promise.withResolvers<void>();
  landing = landed.promise;
  const container = await draw(hostLines(2000));
  const scroller =
    container.querySelector<HTMLElement>(".luke-scroll-area") ?? assert.fail("a scroller");
  // Scrolled to about line 1,600 of 2,000, which the fourth window holds.
  Object.defineProperty(scroller, "scrollHeight", { value: 20000 });
  Object.defineProperty(scroller, "clientHeight", { value: 600 });
  scroller.scrollTop = 15700;
  landed.resolve();
  await flush();

  assert.deepEqual(
    asked.slice(0, 2).map((request) => request.lines[0]),
    ["line 1501", "line 1001"],
    "the window in view, then the nearest",
  );
  assert.equal(asked.length, 4, "every window, two at a time");
});

/** The read a kept run comes from. */
const KEPT_READ: RunRead = { source: "src/kept.ts", revision: "abc" };

test("a run drawn again, as a File tab opened again, takes its kept colours at once without asking", async () => {
  handSettings({ diffDarkTheme: "dracula", diffLightTheme: "solarized-light" });
  await draw(hostLines(3), { read: KEPT_READ });
  const before = asked.length;
  for (const root of roots.splice(0)) act(() => root.unmount());

  const container = await draw(hostLines(3), { read: KEPT_READ });

  assert.equal(asked.length, before, "nothing is asked again");
  assert.deepEqual(drawnColours(container), ["#ff79c6", "#ff79c6", "#ff79c6"]);
});

test("a file opened in a chosen pair warms its colouring before its lines land, and in the default pair loads nothing", async () => {
  /** Draws the warmer alone, as a File tab does before its read lands. */
  const warm = async () => {
    const container = document.body.appendChild(document.createElement("div"));
    const root = createRoot(container);
    roots.push(root);
    const bundles = sideBundles({
      diffView: () => {
        imported += 1;
        return Promise.resolve(STAND_IN);
      },
    });
    act(() =>
      root.render(
        onRegistry(
          AtomRegistry.make(),
          onSideBundles(bundles, createElement(ThemeWarmer, { name: "src/seats.ts" })),
        ),
      ),
    );
    await flush();
  };
  handSettings();
  await warm();
  assert.equal(imported, 0);

  handSettings({ diffDarkTheme: "dracula", diffLightTheme: "solarized-light" });
  await warm();
  assert.equal(imported, 1);
  assert.deepEqual(
    asked.map((request) => [request.name, request.lines]),
    [["src/seats.ts", [""]]],
  );
});

test("kept colours over words the read no longer holds are not drawn, and the window is coloured again", async () => {
  handSettings({ diffDarkTheme: "dracula", diffLightTheme: "solarized-light" });
  const reloaded: RunRead = { source: "page-1", revision: "3" };
  await draw([[{ text: "hello", color: "#ff7b72" }]], { read: reloaded });
  for (const root of roots.splice(0)) act(() => root.unmount());
  asked = [];

  const container = await draw([[{ text: "goodbye", color: "#ff7b72" }]], { read: reloaded });

  assert.deepEqual(
    [...container.querySelectorAll(".code-line-text")].map((line) => line.textContent),
    ["goodbye"],
  );
  assert.deepEqual(
    asked.map((request) => request.lines),
    [["goodbye"]],
  );
});

test("a window left in the host's colours keeps the host's ink beside one coloured in the theme", async () => {
  handSettings({ diffDarkTheme: "dracula", diffLightTheme: "solarized-light" });
  answer = (request) => (request.lines[0]?.startsWith("plain") ? undefined : PINK(request));
  const container = await draw([
    ...hostLines(500),
    [{ text: "plain run" }, { text: "x", color: "#ff7b72" }],
  ]);

  const ground =
    container.querySelector<HTMLElement>(".code-lines-ground") ?? assert.fail("a ground");
  assert.equal(ground.style.getPropertyValue("--code-text"), "", "the theme's ink is not taken");
  assert.equal(drawnColours(container)[500], undefined, "the host's own-ink run names none");
});

test("a run's own colours outlast their being let go from the kept windows, so it never asks for a window twice", async () => {
  handSettings({ diffDarkTheme: "dracula", diffLightTheme: "solarized-light" });
  const container = await draw(hostLines(1000));
  assert.equal(asked.length, 2);
  // Sixty-four other runs of a line each, as many windows as are kept, let the first run's go.
  for (let other = 0; other < 64; other += 1) await draw(hostLines(1));
  const before = asked.length;

  const scroller =
    container.querySelector<HTMLElement>(".luke-scroll-area") ?? assert.fail("a scroller");
  act(() => scroller.dispatchEvent(new Event("scroll")));
  await flush();

  assert.equal(asked.length, before, "nothing is asked again");
  assert.equal(drawnColours(container)[0], "#ff79c6");
});

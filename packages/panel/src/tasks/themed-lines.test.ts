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
import { ThemedCodeLinesView } from "./themed-lines.js";

const roots: Root[] = [];

/** Each colouring the bundle was asked for, and how many times the bundle was imported. */
let asked: ColourRequest[] = [];
let imported = 0;

/** What the bundle answers a colouring with unless a test says otherwise: each line in one run of Dracula's pink. */
const PINK = (request: ColourRequest): ColouredLines | undefined => ({
  lines: request.lines.map((text) =>
    text === "" ? [] : [{ text, color: "#ff79c6", lightColor: "#859900" }],
  ),
  ground: { dark: "#282a36", light: "#fdf6e3" },
  ink: { dark: "#f8f8f2", light: "#657b83" },
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

/** Draws `lines` from line 1 in the themes the settings hold. */
async function draw(lines: CodeLines): Promise<HTMLElement> {
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
        onSideBundles(
          bundles,
          createElement(
            "div",
            null,
            createElement(Settings),
            createElement(ThemedCodeLinesView, {
              name: "src/seats.ts",
              runKey: "src/seats.ts@abc",
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
  assert.equal(container.querySelector(".code-lines-palette"), null);
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
  const frame =
    container.querySelector<HTMLElement>(".code-lines-palette") ?? assert.fail("a palette");
  assert.equal(frame.style.getPropertyValue("--palette-ground-dark"), "#282a36");
});

test("a window given no colours, or other words, or drawn plain by the host, keeps the host's", async () => {
  handSettings({ diffDarkTheme: "dracula", diffLightTheme: "solarized-light" });
  answer = (request) =>
    request.lines[0] === "line 1"
      ? undefined
      : {
          lines: request.lines.map(() => [{ text: "other words", color: "#ff79c6" }]),
          ground: { dark: "#282a36", light: "#fdf6e3" },
          ink: { dark: "#f8f8f2", light: "#657b83" },
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
    ink: { dark: "#f8f8f2", light: "#657b83" },
  });
  handSettings({ diffDarkTheme: "dracula", diffLightTheme: "solarized-light" });
  const container = await draw(hostLines(2));
  assert.equal(drawnColours(container)[0], "#ff79c6");

  act(() => settingsDoor?.change("diffDarkTheme", "nord"));
  await flush();

  assert.equal(asked.at(-1)?.look.themes.dark, "nord");
  assert.equal(drawnColours(container)[0], "#88c0d0");
});

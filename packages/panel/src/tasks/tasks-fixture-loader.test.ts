// @vitest-environment jsdom

import assert from "node:assert/strict";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, test } from "vitest";
import {
  loadedTasksFixture,
  loadTasksFixture,
  useTasksFixtureLanded,
} from "./tasks-fixture-loader.js";

let root: Root | undefined;

afterEach(() => {
  act(() => root?.unmount());
  root = undefined;
});

function Window({ fixtureMode, seen }: { fixtureMode: boolean; seen: boolean[] }): null {
  seen.push(useTasksFixtureLanded(fixtureMode));
  return null;
}

function draw(fixtureMode: boolean, seen: boolean[]): void {
  root ??= createRoot(document.createElement("div"));
  act(() => root?.render(createElement(Window, { fixtureMode, seen })));
}

test("a live run is drawn at once and imports no fixture; a fixture run is drawn only once its tasks have landed", async () => {
  const live: boolean[] = [];
  draw(false, live);
  assert.deepEqual(live, [true]);
  assert.equal(loadedTasksFixture(), undefined);
  act(() => root?.unmount());
  root = undefined;

  const fixture: boolean[] = [];
  draw(true, fixture);
  assert.equal(fixture[0], false, "not drawn before the tasks land");
  await act(async () => {
    await loadTasksFixture();
  });
  assert.equal(fixture.at(-1), true);
  assert.notEqual(loadedTasksFixture(), undefined);
});

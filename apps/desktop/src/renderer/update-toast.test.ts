// @vitest-environment jsdom

import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import { MOTION_DURATION_MS } from "@sidecar/surface";
import { Duration, Effect } from "effect";
import { TestClock } from "effect/testing";
import type { AtomRegistry } from "effect/unstable/reactivity/AtomRegistry";
import { act, createElement, Fragment } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach } from "vitest";
import { UPDATE_STATUS, type UpdateSnapshot } from "#shared/messages/update";
import { onRegistry, registryOnTestClock } from "#testing/copy-feedback";
import { ToastHost } from "./toast";
import { useUpdatedToast } from "./update-toast";

/** The first launch after an update to `version`, as main reports it. */
function updated(version: string): UpdateSnapshot {
  return {
    status: UPDATE_STATUS.UPDATED,
    currentVersion: version,
    installSupported: true,
    previousVersion: "0.4.0",
  };
}

const roots: Root[] = [];

/** A window drawn over `update`, with its toast, its atoms on `registry`. */
function launch(update: UpdateSnapshot, registry: AtomRegistry): void {
  function Probe() {
    useUpdatedToast(update);
    return null;
  }
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  const surface = createElement(Fragment, null, createElement(Probe), createElement(ToastHost));
  act(() => root.render(onRegistry(registry, surface)));
}

function quit(): void {
  for (const root of roots.splice(0)) act(() => root.unmount());
}

/** Lets what fell due land and redraw. */
const landed = Effect.promise(() =>
  act(async () => {
    for (let turn = 0; turn < 8; turn += 1) await Promise.resolve();
  }),
);

function toast(): string | undefined {
  return document.querySelector(".toast")?.textContent ?? undefined;
}

afterEach(() => {
  quit();
  document.body.innerHTML = "";
  window.localStorage.clear();
});

it.effect(
  "the first launch after an update says so in a toast that leaves on its own, once for each version, and a launch with no update says nothing",
  () =>
    Effect.gen(function* () {
      launch(updated("0.5.0"), yield* registryOnTestClock);
      yield* landed;
      assert.equal(toast(), "Updated to version 0.5.0");
      yield* TestClock.adjust(Duration.millis(4_000 + MOTION_DURATION_MS.EXIT));
      yield* landed;
      assert.equal(toast(), undefined);
      quit();

      launch(updated("0.5.0"), yield* registryOnTestClock);
      yield* landed;
      assert.equal(toast(), undefined, "said once for 0.5.0");
      quit();

      launch(
        {
          status: UPDATE_STATUS.IDLE,
          currentVersion: "0.5.0",
          installSupported: true,
          upToDate: true,
        },
        yield* registryOnTestClock,
      );
      yield* landed;
      assert.equal(toast(), undefined);
      quit();

      launch(updated("0.6.0"), yield* registryOnTestClock);
      yield* landed;
      assert.equal(toast(), "Updated to version 0.6.0");
    }),
);

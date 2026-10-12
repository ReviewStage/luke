// @vitest-environment jsdom

import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import { Effect } from "effect";
import { TestClock } from "effect/testing";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach } from "vitest";
import { UPDATE_STATUS, type UpdateSnapshot } from "#shared/messages/update";
import { onRegistry, registryOnTestClock } from "#testing/copy-feedback";
import { PAST_SPINNER_DELAY } from "#testing/spinner";
import { UpdatesSection } from "./updates";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const roots: Root[] = [];

/** Lets a wait that ended, and the redraw it causes, land with no time passing. */
const settle = Effect.promise(() =>
  act(async () => {
    for (let turn = 0; turn < 8; turn += 1) await Promise.resolve();
  }),
);

afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount());
  document.body.innerHTML = "";
});

const ignore = () => undefined;

/** The section over `update`, on the test's clock, and its first row's button. */
const mount = (update: UpdateSnapshot) =>
  Effect.gen(function* () {
    const registry = yield* registryOnTestClock;
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    roots.push(root);
    const control = {
      update,
      onCheck: () => Promise.resolve(),
      onInstall: ignore,
      onOpenLatest: ignore,
    };
    act(() => root.render(onRegistry(registry, createElement(UpdatesSection, { control }))));
    const button = container.querySelector<HTMLButtonElement>(".settings-row button");
    assert.ok(button);
    return button;
  });

it.effect(
  "a check under way draws the spinner in its button once it has stood, saying Checking for updates to a reader",
  () =>
    Effect.gen(function* () {
      const button = yield* mount({
        status: UPDATE_STATUS.CHECKING,
        currentVersion: "1.2.0",
        installSupported: true,
      });
      assert.equal(button.disabled, true);
      assert.equal(button.textContent, "Check for updates", "a quick check flashes nothing");

      yield* TestClock.adjust(PAST_SPINNER_DELAY);
      yield* settle;
      assert.ok(button.querySelector(".spinner-ring"));
      assert.equal(button.querySelector(".visually-hidden")?.textContent, "Checking for updates");
      assert.doesNotMatch(button.textContent ?? "", /…/u);
    }),
);

it.effect("with no check out the button offers the check, with no spinner", () =>
  Effect.gen(function* () {
    const button = yield* mount({
      status: UPDATE_STATUS.IDLE,
      currentVersion: "1.2.0",
      installSupported: true,
      upToDate: true,
    });
    yield* TestClock.adjust(PAST_SPINNER_DELAY);
    yield* settle;
    assert.equal(button.disabled, false);
    assert.equal(button.textContent, "Check for updates");
    assert.equal(button.querySelector(".spinner-ring"), null);
  }),
);

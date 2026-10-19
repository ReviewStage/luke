// @vitest-environment jsdom
import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import { RUN_PROFILE } from "@luke/host/app-state";
import { appStateFirstRead } from "@luke/panel/use-app-state";
import { Effect } from "effect";
import { afterEach, vi } from "vitest";
import {
  addressBar,
  drawPanel,
  installPanelDoors,
  openAt,
  travel,
  unmountPanels,
} from "./support/web-panel";

/**
 * On a phone's width the side panel opened over the plan is a step of the
 * tab's own history, which the browser's Back shuts and its Forward opens
 * again, without a step of either's own. Its own file, because the panel's
 * state lives as long as the page does, as a tab's does.
 */

/** A task of the fixture run's, which its tasks profile opens with its side panel. */
const FIXTURE_TASK_PATH = "/personal/plan/0f6a2c4e-8b1d-4e3f-9a57-1c2b3d4e5f60";

/** A phone's width, narrower than the panel stands two panes side by side at. */
const PHONE_WIDTH = 390;

afterEach(() => {
  unmountPanels();
  vi.restoreAllMocks();
});

it.effect(
  "on a phone's width the browser's Back shuts the side panel opened over the plan, and Forward opens it again",
  () =>
    Effect.gen(function* () {
      vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue(
        new DOMRect(0, 0, PHONE_WIDTH, 800),
      );
      openAt("/app");
      // The tasks profile opens the fixture's task with its side panel over it.
      installPanelDoors(RUN_PROFILE.TASKS);
      yield* appStateFirstRead;
      yield* Effect.promise(async () => {
        const panel = await drawPanel();
        await panel.press("Close");
        assert.equal(addressBar(), FIXTURE_TASK_PATH);
        await panel.press("Show panel");
        const shown = addressBar();
        const entries = window.history.length;

        await travel(() => window.history.back());
        assert.ok(panel.offers("Show panel"), "Back shuts the side panel");
        assert.equal(addressBar(), FIXTURE_TASK_PATH);
        assert.equal(window.history.length, entries, "and pushes nothing");

        await travel(() => window.history.forward());
        assert.ok(!panel.offers("Show panel"), "Forward opens it again");
        assert.equal(addressBar(), shown);
      });
    }),
);

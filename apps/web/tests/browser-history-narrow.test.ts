// @vitest-environment jsdom
import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import { RUN_PROFILE } from "@luke/host/app-state";
import { appStateFirstRead } from "@luke/panel/use-app-state";
import { Effect } from "effect";
import { act } from "react";
import { afterEach, vi } from "vitest";
import {
  addressBar,
  drawPanel,
  installPanelDoors,
  openAt,
  settle,
  travel,
  unmountPanels,
} from "./support/web-panel";

/**
 * On a phone's width the task's header leads with the way back to the page
 * it was opened from, the Tasks page where the tab opened on the task
 * (`browser-history-narrow-panel.test.ts` holds a tab of the side panel
 * pushed over it). Its own file, because the panel's state lives as long as the page does, as a tab's
 * does.
 */

/** A task of the fixture run's, which its tasks profile opens on its Overview. */
const FIXTURE_TASK_PATH = "/personal/plan/0f6a2c4e-8b1d-4e3f-9a57-1c2b3d4e5f60";

/** A phone's width, narrower than the panel stands two panes side by side at. */
const PHONE_WIDTH = 390;

/** Whether a tab of the side panel stands pushed over the task's column, as it does once the panel opens on a phone. */
async function panelPushed(): Promise<boolean> {
  await act(async () => undefined);
  return document.querySelector("aside.side-panel") !== null;
}

/** The way back leading the phone's task's header. */
function back(): HTMLButtonElement {
  const found = document.querySelector<HTMLButtonElement>(".task-head .luke-toolbar-lead button");
  assert.ok(found, "the task's header leads with its way back");
  return found;
}

afterEach(() => {
  unmountPanels();
  vi.restoreAllMocks();
});

it.effect(
  "on a phone's width a task the tab opened on, with no page behind it, leads with the way to the Tasks page, which Back leaves for the task again",
  () =>
    Effect.gen(function* () {
      vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue(
        new DOMRect(0, 0, PHONE_WIDTH, 800),
      );
      openAt("/app");
      installPanelDoors(RUN_PROFILE.TASKS);
      yield* appStateFirstRead;
      yield* Effect.promise(async () => {
        await drawPanel();
        assert.equal(await panelPushed(), false);
        assert.equal(back().textContent, "Tasks");

        await act(async () => back().click());
        await settle();
        assert.equal(document.querySelector(".task-head"), null, "the task is left");
        assert.ok(document.querySelector('[aria-label="Tasks"]'), "for the Tasks page");

        await travel(() => window.history.back());
        assert.equal(addressBar(), FIXTURE_TASK_PATH, "Back opens the task again");
        assert.equal(await panelPushed(), false);
      });
    }),
);
